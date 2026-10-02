import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { radarSetsFn } from "@/lib/radar.functions";
import { sortSetsByTitleDate } from "@/lib/set-date";
import { allNamesFor, canonicalName, canonicalNameMap } from "@/lib/artist-name";
import { eligibleFollowedArtists } from "@/lib/followed-artists";

export const Route = createFileRoute("/_authenticated/radar")({
  head: () => ({
    meta: [
      { title: "Radar — Flowcrate" },
      {
        name: "description",
        content: "The newest sets from every DJ and artist you follow, in one feed.",
      },
      { property: "og:title", content: "Radar — Flowcrate" },
      {
        property: "og:description",
        content: "One chronological feed of the newest sets from the artists you follow.",
      },
    ],
  }),
  component: RadarPage,
});

const WINDOWS = [
  { value: 0, label: "All time" },
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last year" },
  { value: 24, label: "Last 2 years" },
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

function RadarPage() {
  const radarSets = useServerFn(radarSetsFn);

  const [sinceMonths, setSinceMonths] = useState(0);
  const [visible, setVisible] = useState(60);

  const follows = useQuery({
    queryKey: ["followed-djs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("followed_djs")
        .select("id, name, url, aliases")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const artistRows = useMemo(() => eligibleFollowedArtists(follows.data), [follows.data]);
  const allNames = useMemo(() => artistRows.map((f) => f.name), [artistRows]);
  // Include every merged spelling in the scan, but label sets with the primary name.
  const scanNames = useMemo(
    () => [...new Set(artistRows.flatMap((f) => allNamesFor(f)))],
    [artistRows],
  );
  const canonical = useMemo(() => canonicalNameMap(artistRows), [artistRows]);

  const setsFeed = useQuery({
    queryKey: ["radar-sets", scanNames, sinceMonths],
    enabled: scanNames.length > 0,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => radarSets({ data: { djs: scanNames, setLimit: 15, sinceMonths } }),
  });

  const sets = useMemo(() => {
    const list = (setsFeed.data ?? []).map((s) => ({
      ...s,
      dj: canonicalName(canonical, s.dj),
    }));
    return sortSetsByTitleDate(list);
  }, [setsFeed.data, canonical]);
  const pageSets = sets.slice(0, visible);

  return (
    <AppShell
      title="Radar"
      subtitle="The newest sets from everyone you follow."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/artists">Manage artists</Link>
        </Button>
      }
    >
      {!allNames.length ? (
        <EmptyState text="Follow a few artists first — find them in DJs & Artists." />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <p className="label-mono text-xs text-muted-foreground">
              {allNames.length} artist{allNames.length === 1 ? "" : "s"} followed · {sets.length}{" "}
              sets
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Window
              <select
                value={sinceMonths}
                onChange={(e) => {
                  setSinceMonths(Number(e.target.value));
                  setVisible(60);
                }}
                className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
              >
                {WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/discover">Most played tracks →</Link>
            </Button>
          </div>

          {setsFeed.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Finding sets…</p>
          ) : setsFeed.isError ? (
            <p className="py-10 text-center text-sm text-destructive">
              Couldn't load sets right now
            </p>
          ) : !sets.length ? (
            <EmptyState text="No recent sets in that window — try a wider one." />
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {pageSets.map((set) => (
                  <li
                    key={`${set.source}:${set.title}`}
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
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Link to="/artists/$name" params={{ name: set.dj }}>
                          <Badge variant="secondary">{set.dj}</Badge>
                        </Link>
                        {set.source === "soundcloud" ? (
                          <>
                            <Badge variant="outline">SoundCloud</Badge>
                            {when(set.date) ? <span>Uploaded {when(set.date)}</span> : null}
                            {set.minutes ? <span>{set.minutes} min</span> : null}
                            {set.plays ? (
                              <span>
                                {set.plays.toLocaleString()} plays ·{" "}
                                {(set.likes ?? 0).toLocaleString()} likes
                              </span>
                            ) : null}
                          </>
                        ) : set.source === "ra" ? (
                          <>
                            <Badge variant="outline">RA Podcast</Badge>
                            {when(set.date) ? <span>Published {when(set.date)}</span> : null}
                            {set.minutes ? <span>{set.minutes} min</span> : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {sets.length > pageSets.length ? (
                <div className="mt-4 flex justify-center">
                  <Button variant="outline" onClick={() => setVisible((v) => v + 60)}>
                    Load more ({sets.length - pageSets.length} left)
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
