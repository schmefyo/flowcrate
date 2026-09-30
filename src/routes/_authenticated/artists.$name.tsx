import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { djFeedFn } from "@/lib/discover.functions";
import { radarSetsFn } from "@/lib/radar.functions";
import { playingRowClass, useNowPlaying } from "@/lib/playback";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { SetsDialog } from "@/components/atlas/SetsDialog";
import { enrichTrackByNameFn } from "@/lib/track-import.functions";
import { enrichExistingTrack } from "@/lib/enrich-track";
import { useSourceCacheWarmup } from "@/lib/source-cache-warmup";
import { artistLinks } from "@/lib/artist-links";
import { sortSetsByTitleDate } from "@/lib/set-date";
import { allNamesFor, normalizeArtistName } from "@/lib/artist-name";
import type { FeedTrack } from "@/lib/discover.server";

export const Route = createFileRoute("/_authenticated/artists/$name")({
  head: ({ params }) => {
    const name = decodeURIComponent(params.name);
    return {
      meta: [
        { title: `${name} — Flowcrate` },
        {
          name: "description",
          content: `Newest sets and most played tracks from ${name}, built from set tracklists.`,
        },
        { property: "og:title", content: `${name} — Flowcrate` },
        {
          property: "og:description",
          content: `Newest sets and most played tracks from ${name}.`,
        },
      ],
    };
  },
  component: ArtistPage,
});

function ArtistPage() {
  const { name: rawName } = Route.useParams();
  const name = decodeURIComponent(rawName);
  const qc = useQueryClient();
  const djFeed = useServerFn(djFeedFn);
  const radarSets = useServerFn(radarSetsFn);
  const enrich = useServerFn(enrichTrackByNameFn);
  const warmSourceCache = useSourceCacheWarmup();

  const [tab, setTab] = useState<"sets" | "tracks">("sets");
  const [setLimit, setSetLimit] = useState(50);
  const [visible, setVisible] = useState(50);
  const [hideOwned, setHideOwned] = useState(true);
  const [resolved, setResolved] = useState<
    Record<string, { previewUrl: string | null; artworkUrl: string | null }>
  >({});
  const [selected, setSelected] = useState<FeedTrack | null>(null);

  const artist = useQuery({
    queryKey: ["artist", name],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("followed_djs")
        .select("id, name, url, on_radar, notes, links, aliases")
        .eq("name", name)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // A merged artist has several MixesDB spellings — scan them all.
  const scanNames = useMemo(
    () => (artist.data ? allNamesFor(artist.data) : [name]),
    [artist.data, name],
  );
  const aliases = useMemo(() => scanNames.filter((n) => n !== name), [scanNames, name]);

  const sets = useQuery({
    queryKey: ["artist-sets", scanNames],
    staleTime: 1000 * 60 * 30,
    queryFn: async () => radarSets({ data: { djs: scanNames, setLimit: 60 } }),
  });

  const feed = useQuery({
    queryKey: ["dj-feed", name, aliases, setLimit],
    enabled: tab === "tracks",
    staleTime: 1000 * 60 * 30,
    queryFn: async () => djFeed({ data: { dj: name, setLimit, aliases } }),
  });

  const tracksQuery = useQuery({
    queryKey: ["tracks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tracks").select("id, title, artist");
      if (error) throw error;
      return data ?? [];
    },
  });

  const owned = useMemo(
    () =>
      new Set(
        (tracksQuery.data ?? []).map((t) => `${t.artist.toLowerCase()}|||${t.title.toLowerCase()}`),
      ),
    [tracksQuery.data],
  );

  const setRows = useMemo(() => sortSetsByTitleDate(sets.data ?? []), [sets.data]);

  const allRows = feed.data?.tracks ?? [];
  const ownedCount = useMemo(
    () => allRows.filter((t) => owned.has(t.key)).length,
    [allRows, owned],
  );
  const rows = hideOwned ? allRows.filter((t) => !owned.has(t.key)) : allRows;
  const pageRows = rows.slice(0, visible);
  const nowPlaying = useNowPlaying();

  const follow = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("You need to be signed in");
      const { error } = await supabase.from("followed_djs").insert({
        user_id: userId,
        name,
        url: `https://www.mixesdb.com/w/Category:${encodeURIComponent(name.replace(/ /g, "_"))}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist", name] });
      qc.invalidateQueries({ queryKey: ["artists"] });
      qc.invalidateQueries({ queryKey: ["followed-djs"] });
      warmSourceCache([name]);
      toast.success("Following");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTrack = useMutation({
    mutationFn: async (track: FeedTrack) => {
      const extra = resolved[track.key];
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("You need to be signed in");
      const { data: inserted, error } = await supabase
        .from("tracks")
        .insert({
          user_id: userId,
          title: track.title,
          artist: track.artist,
          notes: `Played by ${name} (${track.plays}×, via MixesDB)`,
          preview_url: extra?.previewUrl ?? null,
          artwork_url: extra?.artworkUrl ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      try {
        return await enrichExistingTrack(enrich, inserted as never);
      } catch {
        return [];
      }
    },
    onSuccess: (found) => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      toast.success(found?.length ? `Added — found ${found.join(", ")}` : "Added to your tracks");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const links = artistLinks(name, artist.data?.url ?? null, artist.data?.links);

  return (
    <AppShell
      title={name}
      subtitle="Their newest sets and the tracks they play the most."
      action={
        artist.data ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/artists">All artists</Link>
          </Button>
        ) : (
          <Button size="sm" disabled={follow.isPending} onClick={() => follow.mutate()}>
            Follow
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
        {artist.data && !artist.data.on_radar ? <span>not on radar</span> : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["sets", "tracks"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? "default" : "ghost"}
              onClick={() => setTab(t)}
            >
              {t === "sets" ? `Newest sets (${sets.data?.length ?? 0})` : "Most played tracks"}
            </Button>
          ))}
        </div>
        {tab === "tracks" ? (
          <>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Sets to scan
              <select
                value={setLimit}
                onChange={(e) => {
                  setSetLimit(Number(e.target.value));
                  setVisible(50);
                }}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
              >
                {[10, 25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value={0}>All history</option>
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setHideOwned((v) => !v);
                setVisible(50);
              }}
            >
              {hideOwned
                ? `New only (${ownedCount} owned hidden)`
                : `Showing all (${ownedCount} owned)`}
            </Button>
          </>
        ) : null}
      </div>

      <div className="mt-6">
        {tab === "sets" ? (
          sets.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Finding sets…</p>
          ) : !setRows.length ? (
            <EmptyState text="No sets found" />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {setRows.map((set) => (
                <li key={set.title} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <a
                      href={set.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:text-primary"
                    >
                      {set.title}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : feed.isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Finding tracklists…</p>
        ) : feed.isError ? (
          <p className="py-10 text-center text-sm text-destructive">Couldn't load sets right now</p>
        ) : !rows.length ? (
          <EmptyState text="No tracks found in these sets." />
        ) : (
          <>
            <p className="mb-3 label-mono text-xs text-muted-foreground">
              {feed.data?.setsScanned ?? 0} of {feed.data?.setsFound ?? 0} sets had tracklists ·
              showing {pageRows.length} of {rows.length} tracks
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {pageRows.map((track) => {
                const already = owned.has(track.key);
                return (
                  <li
                    key={track.key}
                    className={`flex flex-wrap items-start gap-3 p-4 ${
                      nowPlaying === `artist-${track.key}` ? playingRowClass : ""
                    }`}
                  >
                    {resolved[track.key]?.artworkUrl ? (
                      <img
                        src={resolved[track.key]!.artworkUrl!}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-sm object-cover"
                      />
                    ) : null}
                    <DiscoverPreview
                      playbackKey={`artist-${track.key}`}
                      artist={track.artist}
                      title={track.title}
                      onResolved={(data) => setResolved((prev) => ({ ...prev, [track.key]: data }))}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {track.artist} — {track.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => setSelected(track)}
                          className="inline-flex cursor-pointer"
                        >
                          <Badge variant="secondary">{track.plays}× in their sets</Badge>
                        </button>
                        {track.label ? <span>{track.label}</span> : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={already ? "ghost" : "secondary"}
                      disabled={already || addTrack.isPending}
                      onClick={() => addTrack.mutate(track)}
                    >
                      {already ? "In your crate" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {rows.length > pageRows.length ? (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={() => setVisible((v) => v + 50)}>
                  Load more ({rows.length - pageRows.length} left)
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <SetsDialog
        track={selected}
        dj={name}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </AppShell>
  );
}
