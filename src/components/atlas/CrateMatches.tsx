import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { crateMatchesFn } from "@/lib/crate-match.functions";
import { enrichTrackByNameFn } from "@/lib/track-import.functions";
import { enrichExistingTrack } from "@/lib/enrich-track";
import { playingRowClass, useNowPlaying } from "@/lib/playback";
import { setDateLabel } from "@/lib/set-date";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { lookupMixCounts } from "@/lib/mix-count.functions";
import { lookupMixCountsWithFallback } from "@/lib/mixesdb-browser-fallback";
import type { MixCount } from "@/lib/mix-count.server";

type Seed = { artist: string; title: string };

/** Rows revealed per "Load more" click in either intelligence tab. */
const PAGE = 10;

/**
 * Crate-level MixesDB intelligence: sets that share the most tracks with this
 * crate, and the tracks that most often appear alongside it (gap filling).
 */
export function CrateMatches({ crateId, seeds }: { crateId: string; seeds: Seed[] }) {
  const run = useServerFn(crateMatchesFn);
  const enrich = useServerFn(enrichTrackByNameFn);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"sets" | "gaps">("sets");
  const [setsShown, setSetsShown] = useState(PAGE);
  const [gapsShown, setGapsShown] = useState(PAGE);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const nowPlaying = useNowPlaying();
  const [resolved, setResolved] = useState<
    Record<string, { previewUrl: string | null; artworkUrl: string | null }>
  >({});
  const [gapSort, setGapSort] = useState<"coplays" | "mixes">("coplays");
  const [mixTotals, setMixTotals] = useState<Record<string, number>>({});
  const countsRequested = useRef<Set<string>>(new Set());

  const analyze = useMutation({
    mutationFn: async () => run({ data: { tracks: seeds } }),
    onSuccess: () => {
      setSetsShown(PAGE);
      setGapsShown(PAGE);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTrack = useMutation({
    mutationFn: async (t: { key: string; artist: string; title: string; label: string | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const extra = resolved[t.key];
      const { data: inserted, error } = await supabase
        .from("tracks")
        .insert({
          user_id: userId,
          title: t.title,
          artist: t.artist,
          source: "mixesdb",
          notes: t.label ? `Label (MixesDB): ${t.label}` : null,
          preview_url: extra?.previewUrl ?? null,
          artwork_url: extra?.artworkUrl ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      const { error: linkError } = await supabase.from("crate_tracks").insert({
        user_id: userId,
        crate_id: crateId,
        track_id: inserted!.id,
        position: 999,
      });
      if (linkError) throw linkError;
      // Same metadata chase as Discover, so the track lands complete in both places.
      let found: string[] = [];
      try {
        found = await enrichExistingTrack(enrich, inserted as never);
      } catch {
        found = [];
      }
      return { key: t.key, found };
    },
    onSuccess: ({ key, found }) => {
      setAdded((prev) => ({ ...prev, [key]: true }));
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["labels"] });
      toast.success(
        found.length ? `Added to crate — found ${found.join(", ")}` : "Added to crate",
        {
          action: {
            label: "Go to Crate",
            onClick: () => navigate({ to: "/crates/$crateId", params: { crateId } }),
          },
        },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const result = analyze.data;
  const setsRead = result?.setsRead ?? [];

  const gaps = useMemo(() => {
    const list = [...(result?.gaps ?? [])];
    if (gapSort === "mixes")
      list.sort((a, b) => (mixTotals[b.key] ?? -1) - (mixTotals[a.key] ?? -1) || b.sets - a.sets);
    return list;
  }, [result, gapSort, mixTotals]);
  const gapRows = gaps.slice(0, gapsShown);

  // Total MixesDB appearances for the suggestions currently on screen.
  const counts = useServerFn(lookupMixCounts);
  useEffect(() => {
    const missing = gapRows
      .filter((g) => !countsRequested.current.has(g.key))
      .slice(0, 20)
      .map((g) => ({ key: g.key, artist: g.artist, title: g.title }));
    if (!missing.length) return;
    for (const m of missing) countsRequested.current.add(m.key);
    let cancelled = false;
    void (async () => {
      try {
        const found = (await lookupMixCountsWithFallback(
          { data: { items: missing } },
          counts,
        )) as MixCount[];
        if (cancelled) return;
        setMixTotals((prev) => {
          const next = { ...prev };
          for (const c of found) if (c.ok) next[c.key] = c.total;
          return next;
        });
      } catch {
        /* counts are decoration */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gapRows, counts]);

  return (
    <section className="fc-detail-panel mb-8 border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="fc-section-title">Crate intelligence</h2>
          <p className="text-sm text-muted-foreground">
            Find sets built like this crate, and the tracks artists play alongside them.
          </p>
        </div>
        <Button onClick={() => analyze.mutate()} disabled={analyze.isPending || seeds.length === 0}>
          {analyze.isPending ? "Finding matches…" : result ? "Find matches again" : "Find matches"}
        </Button>
      </div>

      {seeds.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Add tracks first — this needs seeds.</p>
      ) : null}

      {result ? (
        <div className="mt-4">
          <p className="label-mono mb-1 text-muted-foreground">
            {result.tracksProbed} tracks searched · {result.similarSets.length} sets matched ·{" "}
            {result.setsScanned} tracklists read
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Each crate track is used to find sets. Matches are ranked by how many of your tracks
            they contain, then the top sets have their tracklists read — the tracks that turn up
            most often become the similar-track suggestions. Not every set has a usable tracklist,
            which is why fewer tracklists get read than sets matched.
          </p>
          {setsRead.length ? (
            <details className="mb-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-primary">
                Which {setsRead.length} tracklists were read?
              </summary>
              <ul className="mt-2 space-y-1 pl-3">
                {setsRead.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-primary">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mb-4 flex gap-2">
            <Button
              size="sm"
              variant={tab === "sets" ? "default" : "outline"}
              onClick={() => setTab("sets")}
            >
              Similar sets ({result.similarSets.length})
            </Button>
            <Button
              size="sm"
              variant={tab === "gaps" ? "default" : "outline"}
              onClick={() => setTab("gaps")}
            >
              Similar tracks ({result.gaps.length})
            </Button>
          </div>

          {tab === "sets" ? (
            result.similarSets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sets matched these tracks.</p>
            ) : (
              <ul className="divide-y divide-border rounded-sm border border-border">
                {result.similarSets.slice(0, setsShown).map((s) => (
                  <li key={s.url} className="flex flex-wrap items-center gap-3 p-3">
                    <Badge variant="outline" className="label-mono shrink-0">
                      {s.matches} shared
                    </Badge>
                    {setDateLabel(s.title) ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {setDateLabel(s.title)}
                      </span>
                    ) : null}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-52 flex-1 text-sm font-medium hover:text-primary"
                    >
                      {s.title}
                    </a>
                    <span className="text-xs text-muted-foreground">{s.matched.join(" · ")}</span>
                  </li>
                ))}
                {setsShown < result.similarSets.length ? (
                  <li className="p-3 text-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSetsShown((n) => n + PAGE)}
                    >
                      Load more ({result.similarSets.length - setsShown} left)
                    </Button>
                  </li>
                ) : null}
              </ul>
            )
          ) : gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recurring turned up — try again once the crate has more tracks.
            </p>
          ) : (
            <>
              <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                Sort
                <select
                  value={gapSort}
                  onChange={(e) => {
                    setGapSort(e.target.value as "coplays" | "mixes");
                    setGapsShown(PAGE);
                  }}
                  className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="coplays">Most co-plays</option>
                  <option value="mixes">Most mixes</option>
                </select>
              </label>
              <ul className="divide-y divide-border rounded-sm border border-border">
                {gapRows.map((g) => (
                  <li
                    key={g.key}
                    className={`flex flex-wrap items-center gap-3 p-3 ${
                      nowPlaying === `gap-${g.key}` ? playingRowClass : ""
                    }`}
                  >
                    <Badge
                      variant="outline"
                      className="label-mono shrink-0"
                      title={`Appeared in ${g.sets} of the ${result.setsScanned} tracklists read`}
                    >
                      in {g.sets}/{result.setsScanned}
                    </Badge>
                    {mixTotals[g.key] !== undefined ? (
                      <Badge
                        variant="outline"
                        className="label-mono shrink-0"
                        title="Mix appearances for this track"
                      >
                        In mixes ({mixTotals[g.key]})
                      </Badge>
                    ) : null}
                    <DiscoverPreview
                      playbackKey={`gap-${g.key}`}
                      artist={g.artist}
                      title={g.title}
                      onResolved={(data) => setResolved((prev) => ({ ...prev, [g.key]: data }))}
                    />
                    <div className="min-w-52 flex-1">
                      <div className="text-sm font-medium">{g.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.artist}
                        {g.label ? ` · ${g.label}` : ""}
                      </div>
                    </div>
                    <a
                      href={g.examples[0]?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-primary"
                    >
                      heard in {g.examples[0]?.title}
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={added[g.key] || addTrack.isPending}
                      onClick={() => addTrack.mutate(g)}
                    >
                      {added[g.key] ? "Added to Crate" : "Add to Crate"}
                    </Button>
                  </li>
                ))}
                {gapsShown < gaps.length ? (
                  <li className="p-3 text-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setGapsShown((n) => n + PAGE)}
                    >
                      Load more ({gaps.length - gapsShown} left)
                    </Button>
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
