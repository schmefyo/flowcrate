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
import { saveDiscoveredTrack } from "@/lib/discovery-storage";
import { discoverySources } from "@/lib/discovery-provenance";
import { AddToCrateDialog } from "@/components/atlas/AddToCrateButton";
import { enrichTrackByNameFn } from "@/lib/track-import.functions";
import { enrichExistingTrack } from "@/lib/enrich-track";
import { useSourceCacheWarmup } from "@/lib/source-cache-warmup";
import { artistLinks } from "@/lib/artist-links";
import { sortSetsByTitleDate } from "@/lib/set-date";
import { allNamesFor } from "@/lib/artist-name";
import { artistTrackDisplayState } from "@/lib/artist-track-state";
import { ArtistIdentity } from "@/components/atlas/ArtistIdentity";
import { artistLabelContext, artistSetContext, resolveLocalLabel } from "@/lib/artist-profile";
import { followArtist, unfollowArtist } from "@/lib/artist-follow";
import { readLibraryPages, resolveLocalArtist } from "@/lib/label-library";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
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
  const [confirmUnfollow, setConfirmUnfollow] = useState(false);
  const [justSaved, setJustSaved] = useState<Set<string>>(() => new Set());
  const [resolved, setResolved] = useState<
    Record<string, { previewUrl: string | null; artworkUrl: string | null }>
  >({});
  const [selected, setSelected] = useState<FeedTrack | null>(null);
  const [addToCrateTrack, setAddToCrateTrack] = useState<{ id: string; title: string } | null>(
    null,
  );

  const artist = useQuery({
    queryKey: ["artist", name],
    queryFn: async () => {
      const rows = await readLibraryPages((from, to) =>
        supabase
          .from("followed_djs")
          .select("id, name, url, notes, links, aliases, scenes")
          .order("id")
          .range(from, to),
      );
      const target = resolveLocalArtist(name, rows);
      const match = rows.find((row) => row.name === target);
      return match ? { ...match, identityRows: rows } : null;
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
    queryKey: ["tracks", "artist-context"],
    queryFn: async () => {
      return readLibraryPages((from, to) =>
        supabase.from("tracks").select("id, title, artist, label_id").order("id").range(from, to),
      );
    },
  });

  const labelsQuery = useQuery({
    queryKey: ["labels"],
    queryFn: async () =>
      readLibraryPages((from, to) =>
        supabase.from("labels").select("*").order("name").order("id").range(from, to),
      ),
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
  const rows = allRows.filter(
    (track) => artistTrackDisplayState(track.key, { hideOwned, owned, justSaved }).isVisible,
  );
  const pageRows = rows.slice(0, visible);
  const nowPlaying = useNowPlaying();
  const labelContext = useMemo(
    () => artistLabelContext(scanNames, allRows, tracksQuery.data ?? [], labelsQuery.data ?? []),
    [scanNames, allRows, tracksQuery.data, labelsQuery.data],
  );

  const invalidateFollowing = () => {
    qc.invalidateQueries({ queryKey: ["artist"] });
    qc.invalidateQueries({ queryKey: ["artists"] });
    qc.invalidateQueries({ queryKey: ["followed-djs"] });
  };

  const follow = useMutation({
    mutationFn: () =>
      followArtist({
        name,
        url: `https://www.mixesdb.com/w/Category:${encodeURIComponent(name.replace(/ /g, "_"))}`,
      }),
    onSuccess: (result) => {
      invalidateFollowing();
      warmSourceCache(result.names);
      toast.success("Following — finding sets…");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unfollow = useMutation({
    mutationFn: async () => {
      if (artist.data) await unfollowArtist(artist.data.id);
    },
    onSuccess: () => {
      invalidateFollowing();
      setConfirmUnfollow(false);
      toast.success("Unfollowed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addTrack = useMutation({
    mutationFn: async (track: FeedTrack) => {
      const extra = resolved[track.key];
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("You need to be signed in");
      const { track: inserted, created } = await saveDiscoveredTrack({
        title: track.title,
        artist: track.artist,
        sources: discoverySources(
          (track.discoverySources ?? []).map((s) => ({
            title: s.set_title,
            url: s.set_url,
            dj: s.dj_name ?? undefined,
            source: s.provider,
          })),
          artist.data?.identityRows ?? [],
        ),
        notes: `Played by ${name} (${track.plays}×, via MixesDB)`,
        previewUrl: extra?.previewUrl ?? null,
        artworkUrl: extra?.artworkUrl ?? null,
      });
      if (!created)
        return {
          created,
          found: [],
          track: { id: inserted.id, title: inserted.title, key: track.key },
        };
      try {
        const found = await enrichExistingTrack(enrich, inserted as never);
        return {
          created,
          found,
          track: { id: inserted.id, title: inserted.title, key: track.key },
        };
      } catch {
        return {
          created,
          found: [],
          track: { id: inserted.id, title: inserted.title, key: track.key },
        };
      }
    },
    onSuccess: ({ track, created }) => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["discovery-history"] });
      setJustSaved((previous) => new Set(previous).add(track.key));
      toast.success(created ? "Saved to Tracks" : "Discovery context saved", {
        action: {
          label: "Add to Crate",
          onClick: () => setAddToCrateTrack(track),
        },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const links = artistLinks(name, artist.data?.url ?? null, artist.data?.links).filter((link) =>
    /^https?:\/\//i.test(link.url),
  );

  const labelName = (label: { name: string; labelId: string | null }) =>
    label.labelId ? (
      <Link
        to="/labels/$labelId"
        params={{ labelId: label.labelId }}
        className="underline decoration-dotted hover:text-primary"
      >
        {label.name}
      </Link>
    ) : (
      label.name
    );

  return (
    <AppShell
      title={artist.data?.name ?? name}
      header={
        <ArtistIdentity
          name={artist.data?.name ?? name}
          profile={artist.data}
          links={links}
          navigation={
            <Button variant="outline" size="sm" asChild>
              <Link to="/artists">All artists</Link>
            </Button>
          }
          action={
            artist.isError ? (
              <p className="text-sm text-destructive">Couldn't load follow status right now.</p>
            ) : artist.isLoading ? (
              <span className="label-mono text-xs text-muted-foreground">Loading profile…</span>
            ) : artist.data ? (
              <>
                <span className="label-mono text-xs text-primary">Following</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unfollow.isPending}
                  onClick={() => setConfirmUnfollow(true)}
                >
                  Unfollow
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={follow.isPending} onClick={() => follow.mutate()}>
                {follow.isPending ? "Following…" : "Follow"}
              </Button>
            )
          }
        />
      }
    >
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["sets", "tracks"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? "default" : "ghost"}
              onClick={() => setTab(t)}
            >
              {t === "sets"
                ? `Newest known sets (${sets.data?.length ?? 0})`
                : "Most played tracks"}
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
          ) : sets.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              Couldn't load sets right now
            </p>
          ) : !setRows.length ? (
            <EmptyState text="No sets found" />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {setRows.map((set) => (
                <li
                  key={`${set.source}:${set.url}`}
                  className="flex flex-wrap items-center gap-3 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={set.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:text-primary"
                    >
                      {set.title}
                    </a>
                    <p className="label-mono mt-2 text-xs text-muted-foreground">
                      {artistSetContext(set).source}
                      {artistSetContext(set).date
                        ? ` · ${artistSetContext(set).dateLabel}: ${artistSetContext(set).date}`
                        : ""}{" "}
                      · Source link ↗
                    </p>
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
                const { isSaved: already } = artistTrackDisplayState(track.key, {
                  hideOwned,
                  owned,
                  justSaved,
                });
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
                          <Badge variant="secondary">
                            In {track.plays} known {track.plays === 1 ? "set" : "sets"}
                          </Badge>
                        </button>
                        {track.label ? (
                          <span>
                            {labelName({
                              name: track.label,
                              labelId: resolveLocalLabel(track.label, labelsQuery.data ?? []),
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={already ? "ghost" : "secondary"}
                      className={
                        already
                          ? undefined
                          : "transition-colors hover:bg-primary hover:text-primary-foreground"
                      }
                      disabled={addTrack.isPending}
                      onClick={() => addTrack.mutate(track)}
                    >
                      {already ? "Saved · save discovery context" : "Add to Tracks"}
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

      <section className="mt-10 border-t border-border pt-6" aria-label="Label connections">
        <h2 className="fc-section-title text-xl">Label connections</h2>
        {labelsQuery.isError || tracksQuery.isError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Couldn't load library label connections right now.
          </p>
        ) : labelsQuery.isLoading || tracksQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading label connections…</p>
        ) : (
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <section>
              <h3 className="font-semibold">Labels in known tracklists</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Label text observed in the current Most played tracks scan; these aren't confirmed
                artist affiliations.
              </p>
              {labelContext.known.length ? (
                <ul className="mt-3 divide-y divide-border">
                  {labelContext.known.map((label) => (
                    <li key={label.name} className="flex flex-wrap justify-between gap-2 py-3">
                      {labelName(label)}
                      <span className="label-mono text-xs text-muted-foreground">
                        {label.trackCount} {label.trackCount === 1 ? "track" : "tracks"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  {feed.isError
                    ? "Tracklist label data is temporarily unavailable."
                    : feed.isLoading
                      ? "Finding tracklists…"
                      : !feed.data
                        ? "Open Most played tracks to explore observed labels."
                        : "No label text found in this scan."}
                </p>
              )}
            </section>
            <section>
              <h3 className="font-semibold">Labels in your library</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Your label assignments on saved tracks credited to this artist or their stored
                aliases.
              </p>
              <ul className="mt-3 divide-y divide-border">
                {labelContext.library.map((label) => (
                  <li key={label.labelId} className="flex flex-wrap justify-between gap-2 py-3">
                    {labelName(label)}
                    <span className="label-mono text-xs text-muted-foreground">
                      {label.trackCount} {label.trackCount === 1 ? "track" : "tracks"}
                    </span>
                  </li>
                ))}
              </ul>
              {!labelContext.library.length && (
                <p className="mt-3 text-sm text-muted-foreground">
                  No label assignments for this artist's tracks yet.
                </p>
              )}
            </section>
          </div>
        )}
      </section>

      <AlertDialog open={confirmUnfollow} onOpenChange={setConfirmUnfollow}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unfollow {artist.data?.name ?? name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your saved tracks and crates will stay in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={unfollow.isPending} onClick={() => unfollow.mutate()}>
              {unfollow.isPending ? "Unfollowing…" : "Unfollow"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SetsDialog
        track={selected}
        dj={name}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
      {addToCrateTrack ? (
        <AddToCrateDialog
          trackId={addToCrateTrack.id}
          title={addToCrateTrack.title}
          open
          onOpenChange={(open) => !open && setAddToCrateTrack(null)}
        />
      ) : null}
    </AppShell>
  );
}
