import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";
import { searchDjsFn } from "@/lib/discover.functions";
import { lookupArtistLinks } from "@/lib/artist-lookup.functions";
import { followArtist, unfollowArtist } from "@/lib/artist-follow";
import { useSourceCacheWarmup } from "@/lib/source-cache-warmup";
import { artistLinks } from "@/lib/artist-links";
import { groupByName, normalizeArtistName } from "@/lib/artist-name";

export const Route = createFileRoute("/_authenticated/artists/")({
  head: () => ({
    meta: [
      { title: "DJs & Artists — Flowcrate" },
      {
        name: "description",
        content:
          "Every DJ and artist you follow, with their real pages and a feed of their newest sets.",
      },
      { property: "og:title", content: "DJs & Artists — Flowcrate" },
      {
        property: "og:description",
        content: "Your roster of DJs and artists, with links and recent sets.",
      },
    ],
  }),
  component: ArtistsPage,
});

type ArtistRow = {
  id: string;
  name: string;
  url: string | null;
  notes: string | null;
  links: unknown;
  aliases: string[] | null;
  links_checked_at: string | null;
  created_at: string;
};

type SortKey = "name" | "recent";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently added" },
];

function ArtistsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const searchDjs = useServerFn(searchDjsFn);
  const lookup = useServerFn(lookupArtistLinks);
  const warmSourceCache = useSourceCacheWarmup();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const artists = useQuery({
    queryKey: ["artists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("followed_djs")
        .select("id, name, url, notes, links, links_checked_at, created_at, aliases")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ArtistRow[];
    },
  });

  const rows = artists.data ?? [];

  const visible = useMemo(() => {
    const sorted = [...rows];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "recent")
      sorted.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return sorted;
  }, [rows, sort]);

  const djSearch = useMutation({
    mutationFn: async (q: string) => searchDjs({ data: { query: q } }),
    onError: (e: Error) => toast.error(e.message),
  });

  const follow = useMutation({
    mutationFn: (hit: { name: string; url: string; aliases?: string[] }) => followArtist(hit, rows),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      qc.invalidateQueries({ queryKey: ["followed-djs"] });
      warmSourceCache(result.names);
      toast.success(
        result.kind === "merged"
          ? "Merged into the artist you follow — finding sets…"
          : "Following — finding sets…",
        {
          action: {
            label: "Open artist page",
            onClick: () =>
              navigate({ to: "/artists/$name", params: { name: result.names[0] ?? "" } }),
          },
        },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: unfollowArtist,
    onSuccess: () => {
      setConfirmRemoveId(null);
      qc.invalidateQueries({ queryKey: ["artists"] });
      qc.invalidateQueries({ queryKey: ["followed-djs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mergeDupes = useMutation({
    mutationFn: async (group: ArtistRow[]) => {
      const [primary, ...extras] = group;
      if (!primary) return;
      const aliases = [...new Set(group.flatMap((r) => [r.name, ...(r.aliases ?? [])]))].filter(
        (a) => a !== primary.name,
      );
      const { error } = await supabase
        .from("followed_djs")
        .update({ aliases })
        .eq("id", primary.id);
      if (error) throw error;
      if (extras.length) {
        const { error: delError } = await supabase
          .from("followed_djs")
          .delete()
          .in(
            "id",
            extras.map((r) => r.id),
          );
        if (delError) throw delError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      qc.invalidateQueries({ queryKey: ["followed-djs"] });
      toast.success("Merged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dupeGroups = useMemo(
    () =>
      groupByName(rows, (r) => r.name)
        .filter((g) => g.others.length > 0)
        .map((g) => [g.primary, ...g.others]),
    [rows],
  );

  // Resolve real external pages once per artist, in the background.
  const resolving = useRef(new Set<string>());
  useEffect(() => {
    const pending = rows.filter((a) => !a.links_checked_at).slice(0, 3);
    for (const artist of pending) {
      if (resolving.current.has(artist.id)) continue;
      resolving.current.add(artist.id);
      void (async () => {
        try {
          const found = await lookup({ data: { name: artist.name } });
          await supabase
            .from("followed_djs")
            .update({ links: found.links, links_checked_at: new Date().toISOString() })
            .eq("id", artist.id);
        } catch {
          await supabase
            .from("followed_djs")
            .update({ links_checked_at: new Date().toISOString() })
            .eq("id", artist.id);
        } finally {
          qc.invalidateQueries({ queryKey: ["artists"] });
        }
      })();
    }
  }, [rows, lookup, qc]);

  const followed = new Set(rows.flatMap((a) => [a.name, ...(a.aliases ?? [])]));

  // Collapse near-identical MixesDB spellings ("D. Tiffany" / "D.Tiffany") into one entry.
  const searchGroups = useMemo(
    () =>
      groupByName(djSearch.data ?? [], (h) => h.name).map((g) => ({
        hit: g.primary,
        variants: g.others.map((o) => o.name),
      })),
    [djSearch.data],
  );
  return (
    <AppShell title="DJs & Artists" subtitle="The artists you follow.">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) djSearch.mutate(query.trim());
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for an artist to follow…"
          className="max-w-sm flex-1"
        />
        <Button type="submit" disabled={djSearch.isPending}>
          {djSearch.isPending ? "Searching…" : "Search"}
        </Button>
      </form>

      {searchGroups.length ? (
        <div className="mt-4">
          {searchGroups.every(({ hit }) => hit.loose) ? (
            <p className="mb-2 text-sm text-muted-foreground">
              No exact name matches. Related artists:
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {searchGroups.map(({ hit, variants }) => (
              <span key={hit.name} className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={followed.has(hit.name) || follow.isPending}
                  onClick={() => follow.mutate({ ...hit, aliases: variants })}
                  title={
                    variants.length
                      ? `Also found as ${variants.join(", ")} — merged into one artist`
                      : undefined
                  }
                >
                  {followed.has(hit.name) ? `${hit.name} ✓` : `Follow ${hit.name}`}
                  {variants.length
                    ? ` (+${variants.length} spelling${variants.length === 1 ? "" : "s"})`
                    : ""}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/artists/$name" params={{ name: hit.name }}>
                    Open artist page
                  </Link>
                </Button>
              </span>
            ))}
          </div>
        </div>
      ) : djSearch.isSuccess ? (
        <p className="mt-4 text-sm text-muted-foreground">No artists found.</p>
      ) : null}

      <div className="mt-8">
        {!rows.length ? (
          <EmptyState text="No artists yet. Search above to follow your first artist." />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <p className="label-mono text-xs text-muted-foreground">{rows.length} followed</p>
              <Label htmlFor="artist_sort_key" className="text-xs text-muted-foreground">
                Sort by
              </Label>
              <select
                id="artist_sort_key"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {dupeGroups.length ? (
              <div className="mb-4 space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">
                  These look like the same artist spelled differently. Merge them to scan every
                  spelling as one artist.
                </p>
                {dupeGroups.map((group) => (
                  <div key={group[0]!.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{group.map((r) => r.name).join("  ·  ")}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={mergeDupes.isPending}
                      onClick={() => mergeDupes.mutate(group)}
                    >
                      Merge into “{group[0]!.name}”
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <ul className="divide-y divide-border rounded-md border border-border">
              {visible.map((artist) => {
                const links = artistLinks(artist.name, artist.url, artist.links);
                return (
                  <li key={artist.id} className="flex flex-wrap items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/artists/$name"
                        params={{ name: artist.name }}
                        className="font-medium hover:text-primary"
                      >
                        {artist.name}
                      </Link>
                      {artist.aliases?.length ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          also {artist.aliases.join(", ")}
                        </span>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {links.map((l) => (
                          <a
                            key={l.key}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted hover:text-primary"
                          >
                            {l.label}
                          </a>
                        ))}
                        {!artist.links_checked_at ? <span>finding links…</span> : null}
                      </div>
                      {artist.notes ? (
                        <p className="mt-2 text-sm text-muted-foreground">{artist.notes}</p>
                      ) : null}
                    </div>

                    {confirmRemoveId === artist.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(artist.id)}
                        >
                          {remove.isPending ? "Unfollowing…" : "Really unfollow"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRemoveId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setConfirmRemoveId(artist.id)}
                      >
                        Unfollow
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
