import { supabase } from "@/integrations/supabase/client";
import type { ImportedTrack } from "./track-import.server";

export type EnrichFn = (args: {
  data: { artist: string; title: string };
}) => Promise<ImportedTrack>;

async function ensureLabel(userId: string, name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const { data: existing } = await supabase
    .from("labels")
    .select("id")
    .ilike("name", clean)
    .limit(1);
  const hit = existing?.[0];
  if (hit) return hit.id;
  const { data: created, error } = await supabase
    .from("labels")
    .insert({ user_id: userId, name: clean })
    .select("id")
    .single();
  if (error) return null;
  return created.id;
}

/** Build a patch of only the fields we managed to resolve and that are still empty. */
export function metadataPatch(
  res: ImportedTrack,
  current: Record<string, unknown> = {},
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (current[key] !== null && current[key] !== undefined && current[key] !== "") return;
    patch[key] = value;
  };
  set("bpm", res.bpm);
  set("musical_key", res.musicalKey);
  set("genre", res.genre);
  set("mix_name", res.mixName);
  set("artwork_url", res.artworkUrl);
  set("preview_url", res.previewUrl);
  set("duration_ms", res.durationMs);
  set("release_year", res.releaseYear);
  return patch;
}

export function resolvedFields(patch: Record<string, unknown>, labelAdded: boolean): string[] {
  const names: Record<string, string> = {
    bpm: "bpm",
    musical_key: "key",
    genre: "genre",
    mix_name: "mix",
    artwork_url: "artwork",
    preview_url: "preview",
    duration_ms: "length",
    release_year: "year",
  };
  const out = Object.keys(patch).map((k) => names[k] ?? k);
  if (labelAdded) out.push("label");
  return out;
}

/** Look up metadata by artist/title and write whatever is missing onto an existing track row. */
export async function enrichExistingTrack(
  enrich: EnrichFn,
  track: { id: string; artist: string; title: string } & Record<string, unknown>,
): Promise<string[]> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You need to be signed in");

  const res = await enrich({ data: { artist: track.artist, title: track.title } });
  const patch = metadataPatch(res, track);

  let labelAdded = false;
  if (!track["label_id"] && res.labelName) {
    const labelId = await ensureLabel(userId, res.labelName);
    if (labelId) {
      patch["label_id"] = labelId;
      labelAdded = true;
    }
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from("tracks")
      .update(patch as never)
      .eq("id", track.id);
    if (error) throw error;
  }
  return resolvedFields(patch, labelAdded);
}
