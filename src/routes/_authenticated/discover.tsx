import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { radarFeedFn } from "@/lib/radar.functions";
import { playingRowClass, useNowPlaying } from "@/lib/playback";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { FixLinkButton } from "@/components/atlas/FixLinkButton";
import { SetsDialog } from "@/components/atlas/SetsDialog";
import { enrichTrackByNameFn } from "@/lib/track-import.functions";
import { enrichExistingTrack } from "@/lib/enrich-track";
import type { Radar, RadarTrack } from "@/lib/radar.server";
import {
  allNamesFor,
  canonicalName,
  canonicalNameMap,
  normalizeArtistName,
} from "@/lib/artist-name";
import { loadDiscoverPrefs, saveDiscoverPrefs } from "@/lib/discover-prefs";
import { eventDateForSet } from "@/lib/set-date";
import { popularityScore, slotCount, type Slot } from "@/lib/discover-rank";
import { lookupPopularity } from "@/lib/popularity.functions";
import { lookupMixCounts } from "@/lib/mix-count.functions";
import type { MixCount } from "@/lib/mix-count.server";
import type { Popularity } from "@/lib/popularity.server";

export const Route = createFileRoute("/_authenticated/discover")({
  head: () => ({
    meta: [
      { title: "Discover — FlowCrate" },
      {
        name: "description",
        content:
          "See the tracks played most across the DJs and artists you pick, mined from their tracklists.",
      },
      { property: "og:title", content: "Discover — FlowCrate" },
      {
        property: "og:description",
        content: "Most played tracks across the artists you choose to scan.",
      },
    ],
  }),
  component: DiscoverPage,
});

type Sort = "djs" | "newest" | "popular" | "mixes";

const SORTS: { value: Sort; label: string }[] = [
  { value: "djs", label: "Most DJ plays" },
  { value: "mixes", label: "Most mixes" },
  { value: "popular", label: "Most popular" },
  { value: "newest", label: "Newest sets" },
];

/** Scans use every available cached set per artist, with no date window. */
const SET_LIMIT = 0;

const SLOTS: { value: Slot; label: string }[] = [
  { value: "any", label: "Anywhere in set" },
  { value: "opener", label: "Openers" },
  { value: "peak", label: "Peak-time" },
  { value: "closer", label: "Closers" },
];

function when(date: string | null): string {
  if (!date) return "";
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function setKey(set: RadarTrack["sets"][number]): string {
  const day = eventDateForSet(set);
  const dj = normalizeArtistName(set.dj);
  const fallback = set.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${dj}|${day ?? fallback}`;
}

function dedupeSets(sets: RadarTrack["sets"]): RadarTrack["sets"] {
  const seen = new Set<string>();
  return sets.filter((set) => {
    const key = setKey(set);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function DiscoverPage() {
  const qc = useQueryClient();
  const radar = useServerFn(radarFeedFn);
  const enrich = useServerFn(enrichTrackByNameFn);

  const [picked, setPicked] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("djs");
  const [slot, setSlot] = useState<Slot>("any");
  const [restored, setRestored] = useState(false);
  const [visible, setVisible] = useState(50);
  const [resolved, setResolved] = useState<
    Record<string, { previewUrl: string | null; artworkUrl: string | null }>
  >({});
  const [selected, setSelected] = useState<RadarTrack | null>(null);

  // Restore last visit's picks and filters (client-side only, after hydration).
  useEffect(() => {
    const prefs = loadDiscoverPrefs();
    if (prefs) {
      if (prefs.picked?.length) setPicked(prefs.picked);
      if (prefs.sort && SORTS.some((s) => s.value === prefs.sort)) setSort(prefs.sort as Sort);
      if (prefs.slot && SLOTS.some((s) => s.value === prefs.slot)) setSlot(prefs.slot as Slot);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    saveDiscoverPrefs({ picked, sort, slot });
  }, [restored, picked, sort, slot]);

  const follows = useQuery({
    queryKey: ["followed-djs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("followed_djs")
        .select("id, name, url, on_radar, aliases")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const candidates = useMemo(() => (follows.data ?? []).filter((f) => f.on_radar), [follows.data]);

  // Start with a single artist selected so the first scan stays fast.
  useEffect(() => {
    if (restored && !picked.length && candidates[0]) setPicked([candidates[0].name]);
  }, [restored, candidates, picked.length]);

  const canonical = useMemo(() => canonicalNameMap(candidates), [candidates]);

  // Expand each picked artist to all of its merged MixesDB spellings.
  const scanNames = useMemo(() => {
    const names = candidates.filter((c) => picked.includes(c.name)).flatMap((c) => allNamesFor(c));
    return [...new Set(names.length ? names : picked)].sort();
  }, [candidates, picked]);

  const feed = useQuery({
    queryKey: ["discover-scan", scanNames],
    enabled: scanNames.length > 0,
    staleTime: 1000 * 60 * 30,
    queryFn: async () =>
      (await radar({ data: { djs: scanNames, setLimit: SET_LIMIT, sinceMonths: 0 } })) as Radar,
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

  const allRows = useMemo(
    () =>
      (feed.data?.tracks ?? []).map((t) => {
        const sets = dedupeSets(
          t.sets.map((set) => ({ ...set, dj: canonicalName(canonical, set.dj) })),
        );
        const duplicateVisibleSets = t.sets.length - sets.length;
        return {
          ...t,
          djs: [...new Set(t.djs.map((d) => canonicalName(canonical, d)))],
          plays: Math.max(sets.length, t.plays - duplicateVisibleSets),
          sets,
        };
      }),
    [feed.data, canonical],
  );
  // Outside popularity (Deezer) for the rows currently on screen.
  const [pop, setPop] = useState<Record<string, Popularity>>({});
  const requested = useRef<Set<string>>(new Set());
  // Total MixesDB appearances (all mixes, not just the ones scanned).
  const [mixTotals, setMixTotals] = useState<Record<string, number>>({});
  const [findingMixes, setFindingMixes] = useState(false);

  const rows = useMemo(() => {
    let base = allRows;
    if (slot !== "any") base = base.filter((t) => slotCount(t, slot) > 0);
    const sorted = [...base];
    if (slot !== "any")
      sorted.sort((a, b) => slotCount(b, slot) - slotCount(a, slot) || b.djs.length - a.djs.length);
    else if (sort === "newest")
      sorted.sort((a, b) => Date.parse(b.latest ?? "0") - Date.parse(a.latest ?? "0"));
    else if (sort === "popular")
      sorted.sort(
        (a, b) => popularityScore(pop[b.key]) - popularityScore(pop[a.key]) || b.plays - a.plays,
      );
    else if (sort === "mixes")
      sorted.sort(
        (a, b) => (mixTotals[b.key] ?? -1) - (mixTotals[a.key] ?? -1) || b.plays - a.plays,
      );
    // "Most DJ plays": how many of your picks played it, then total plays.
    else sorted.sort((a, b) => b.djs.length - a.djs.length || b.plays - a.plays);
    return sorted;
  }, [allRows, sort, slot, pop, mixTotals]);
  const pageRows = rows.slice(0, visible);
  const nowPlaying = useNowPlaying();

  const lookupPop = useServerFn(lookupPopularity);
  useEffect(() => {
    const missing = pageRows
      .filter((t) => !requested.current.has(t.key))
      .slice(0, 20)
      .map((t) => ({ key: t.key, artist: t.artist, title: t.title }));
    if (!missing.length) return;
    for (const m of missing) requested.current.add(m.key);
    let cancelled = false;
    void (async () => {
      try {
        const found = (await lookupPop({ data: { items: missing } })) as Popularity[];
        if (cancelled) return;
        setPop((prev) => {
          const next = { ...prev };
          for (const p of found) next[p.key] = p;
          return next;
        });
      } catch {
        /* popularity is decoration — a failed batch just stays blank */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageRows, lookupPop]);

  const lookupCounts = useServerFn(lookupMixCounts);
  const findMixes = async () => {
    const pending = allRows
      .filter((track) => mixTotals[track.key] === undefined)
      .slice(0, 300)
      .map((track) => ({ key: track.key, artist: track.artist, title: track.title }));
    if (!pending.length) return;
    setFindingMixes(true);
    const totals: Record<string, number> = {};
    let failed = 0;
    try {
      for (let i = 0; i < pending.length; i += 25) {
        const found = (await lookupCounts({
          data: { items: pending.slice(i, i + 25) },
        })) as MixCount[];
        for (const count of found) {
          if (count.ok) totals[count.key] = count.total;
          else failed += 1;
        }
      }
      setMixTotals((previous) => ({ ...previous, ...totals }));
      if (failed) toast.message("Some mix totals could not be found. Try again later.");
    } catch {
      toast.error("Couldn't load mix counts right now.");
    } finally {
      setFindingMixes(false);
    }
  };

  const addTrack = useMutation({
    mutationFn: async (track: RadarTrack) => {
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
          notes: `Played by ${track.djs.join(", ")} (${track.plays}×, via MixesDB)`,
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

  const toggle = (name: string) => {
    setVisible(50);
    setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  return (
    <AppShell
      title="Discover"
      subtitle="The tracks played most across the artists you pick. Add or remove artists to widen the dig."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/artists">Manage artists</Link>
        </Button>
      }
    >
      {!candidates.length ? (
        <EmptyState text="No artists on radar yet — follow some in DJs & Artists and switch their Radar toggle on." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              className="fc-discover-control"
              size="sm"
              variant="outline"
              onClick={() => {
                setVisible(50);
                setPicked(candidates.map((c) => c.name));
              }}
            >
              Select all
            </Button>
            <Button
              className="fc-discover-control"
              size="sm"
              variant="outline"
              onClick={() => {
                setVisible(50);
                setPicked([]);
              }}
            >
              Deselect all
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {candidates.map((artist) => {
              const on = picked.includes(artist.name);
              return (
                <Button
                  className="fc-discover-control"
                  key={artist.id}
                  size="sm"
                  variant={on ? "default" : "secondary"}
                  onClick={() => toggle(artist.name)}
                >
                  {on ? `${artist.name} ✓` : artist.name}
                </Button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Sort
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as Sort);
                  setVisible(50);
                }}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {sort === "mixes" ? (
              <Button
                className="fc-discover-control"
                variant="outline"
                size="sm"
                disabled={findingMixes}
                onClick={() => void findMixes()}
              >
                {findingMixes ? "Finding mixes…" : "Find mixes"}
              </Button>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              In set
              <select
                value={slot}
                onChange={(e) => {
                  setSlot(e.target.value as Slot);
                  setVisible(50);
                }}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
              >
                {SLOTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-8">
            {!scanNames.length ? (
              <EmptyState text="Pick at least one artist to see tracks." />
            ) : feed.isLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Finding sets…</p>
            ) : feed.isError ? (
              <p className="py-10 text-center text-sm text-destructive">
                Couldn't load sets right now
              </p>
            ) : !allRows.length ? (
              <EmptyState text="No tracklists found in this selection. Try a wider window or more sets." />
            ) : (
              <>
                <p className="mb-3 label-mono text-xs text-muted-foreground">
                  {feed.data?.setsScanned ?? 0} sets scanned · showing {pageRows.length} of{" "}
                  {rows.length} tracks
                  {findingMixes ? " · Finding mix counts…" : ""}
                </p>

                {!rows.length ? (
                  <EmptyState text="Nothing matches these filters — try widening the set position or window." />
                ) : null}
                <ul className="divide-y divide-border rounded-md border border-border">
                  {pageRows.map((track) => {
                    const already = owned.has(track.key);
                    return (
                      <li
                        key={track.key}
                        className={`flex flex-wrap items-start gap-3 p-4 ${
                          nowPlaying === `discover-${track.key}` ? playingRowClass : ""
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
                          hideFix
                          playbackKey={`discover-${track.key}`}
                          artist={track.artist}
                          title={track.title}
                          onResolved={(data) =>
                            setResolved((prev) => ({ ...prev, [track.key]: data }))
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 font-medium">
                            <span>
                              {track.artist} — {track.title}
                            </span>
                            <FixLinkButton artist={track.artist} title={track.title} />
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <button
                              type="button"
                              onClick={() => setSelected(track)}
                              className="inline-flex cursor-pointer"
                            >
                              <Badge variant="secondary">
                                {track.plays}× across {track.djs.length} DJ
                                {track.djs.length === 1 ? "" : "s"}
                              </Badge>
                            </button>
                            {mixTotals[track.key] !== undefined ? (
                              <Badge variant="outline" title="Mix appearances for this track">
                                In mixes ({mixTotals[track.key]})
                              </Badge>
                            ) : null}
                            {track.slots?.closer ? (
                              <Badge variant="outline">closer ×{track.slots.closer}</Badge>
                            ) : null}
                            {track.slots?.opener ? (
                              <Badge variant="outline">opener ×{track.slots.opener}</Badge>
                            ) : null}
                            {track.slots?.peak ? (
                              <Badge variant="outline">peak ×{track.slots.peak}</Badge>
                            ) : null}
                            {/* Popularity still powers the "Most popular" sort, just isn't labelled here. */}
                            {(pop[track.key]?.genres ?? []).slice(0, 2).map((g) => (
                              <Badge key={g} variant="outline">
                                {g}
                              </Badge>
                            ))}

                            <span>{track.djs.slice(0, 3).join(", ")}</span>
                            {track.label ? <span>{track.label}</span> : null}
                            {when(track.latest) ? (
                              <span>last played {when(track.latest)}</span>
                            ) : null}
                          </div>
                        </div>
                        {already ? (
                          <span className="label-mono px-2 py-1 text-xs font-semibold text-primary">
                            Saved
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={addTrack.isPending}
                            onClick={() => addTrack.mutate(track)}
                          >
                            Add to Tracks
                          </Button>
                        )}
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
            dj={selected ? selected.djs.join(", ") : null}
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
          />
        </>
      )}
    </AppShell>
  );
}
