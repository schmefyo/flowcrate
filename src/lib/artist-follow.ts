import { supabase } from "@/integrations/supabase/client";
import { allNamesFor, normalizeArtistName } from "./artist-name";
import { localArtistFollowState, readLibraryPages } from "./label-library";

/** The shared follow/alias-merge operation used by artist search and profiles. */
export async function followArtist(
  hit: { name: string; url: string; aliases?: string[] },
  current?: { id: string; name: string; aliases?: string[] | null }[],
  options?: { identity: "library" },
) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You need to be signed in");
  const rows =
    current ??
    (await readLibraryPages((from, to) =>
      supabase.from("followed_djs").select("id, name, aliases").order("id").range(from, to),
    ));
  if (options?.identity === "library") {
    const state = localArtistFollowState(hit.name, rows);
    if (state.status === "ambiguous")
      throw new Error("This artist name needs clarification before following.");
    if (state.status === "followed") {
      const existing = rows.find((row) => row.name === state.name)!;
      return { kind: "existing" as const, names: allNamesFor(existing) };
    }
    hit = { name: state.name, url: hit.url };
  }
  const aliases = (hit.aliases ?? []).filter(
    (alias) => normalizeArtistName(alias) === normalizeArtistName(hit.name) && alias !== hit.name,
  );
  const existing = rows.find(
    (row) => normalizeArtistName(row.name) === normalizeArtistName(hit.name),
  );
  if (existing) {
    const merged = [...new Set([...(existing.aliases ?? []), hit.name, ...aliases])].filter(
      (alias) => alias !== existing.name,
    );
    const { error } = await supabase
      .from("followed_djs")
      .update({ aliases: merged })
      .eq("id", existing.id);
    if (error) throw error;
    return { kind: "merged" as const, names: [existing.name, ...merged] };
  }
  const { error } = await supabase
    .from("followed_djs")
    .insert({ user_id: userId, name: hit.name, url: hit.url, aliases });
  if (error) throw error;
  return { kind: "followed" as const, names: [hit.name, ...aliases] };
}

export async function unfollowArtist(id: string) {
  const { error } = await supabase.from("followed_djs").delete().eq("id", id);
  if (error) throw error;
}
