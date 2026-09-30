import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ratingStars, sourceFromUrl, type CrateRow, type TrackWithLabel } from "@/lib/atlas";
import { CrateMatches } from "@/components/atlas/CrateMatches";
import { playingRowClass, useNowPlaying } from "@/lib/playback";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { FullTrackPlayer } from "@/components/atlas/FullTrackPlayer";
import { SpotifyLink } from "@/components/atlas/SpotifyLink";
import { SourceIcon } from "@/components/atlas/SourceIcon";

export const Route = createFileRoute("/_authenticated/crates/$crateId")({
  head: () => ({
    meta: [
      { title: "Crate — Flowcrate" },
      { name: "description", content: "The tracks inside this crate, in playing order." },
      { property: "og:title", content: "Crate — Flowcrate" },
      { property: "og:description", content: "The tracks inside this crate, in playing order." },
    ],
  }),
  component: CrateDetail,
});

type CrateEntry = { id: string; position: number; tracks: TrackWithLabel };

function CrateDetail() {
  const nowPlaying = useNowPlaying();
  const { crateId } = Route.useParams();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  /** Local playing order so drag-and-drop feels instant before the save lands. */
  const [order, setOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  const crateQuery = useQuery({
    queryKey: ["crate", crateId],
    queryFn: async () => {
      const { data, error } = await supabase.from("crates").select("*").eq("id", crateId).single();
      if (error) throw error;
      return data as CrateRow;
    },
  });

  const contentsQuery = useQuery({
    queryKey: ["crate-tracks", crateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crate_tracks")
        .select("id, position, tracks(*, labels(id, name))")
        .eq("crate_id", crateId)
        .order("position");
      if (error) throw error;
      return data as unknown as CrateEntry[];
    },
  });

  const allTracksQuery = useQuery({
    queryKey: ["tracks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracks")
        .select("*, labels(id, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as TrackWithLabel[];
    },
  });

  const rowsFromServer = contentsQuery.data ?? [];

  useEffect(() => {
    setOrder(rowsFromServer.map((r) => r.id));
  }, [contentsQuery.data]);

  const byId = new Map(rowsFromServer.map((r) => [r.id, r]));
  const contents: CrateEntry[] = order.length
    ? order
        .map((id) => byId.get(id))
        .filter(Boolean as unknown as (v: CrateEntry | undefined) => v is CrateEntry)
    : rowsFromServer;

  const saveOrder = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id, i) => supabase.from("crate_tracks").update({ position: i }).eq("id", id)),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...order];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, next.splice(from, 1)[0]!);
    setOrder(next);
    setDragId(null);
    saveOrder.mutate(next);
  }

  const addTrack = useMutation({
    mutationFn: async (trackId: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("crate_tracks").insert({
        user_id: userId,
        crate_id: crateId,
        track_id: trackId,
        position: contentsQuery.data?.length ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      qc.invalidateQueries({ queryKey: ["crates"] });
      toast.success("Added to crate");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeLink = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from("crate_tracks").delete().eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      qc.invalidateQueries({ queryKey: ["crates"] });
    },
  });

  const inCrate = new Set(contents.map((c) => c.tracks?.id));
  const available = (allTracksQuery.data ?? []).filter((t) => !inCrate.has(t.id));

  const crateName = crateQuery.data?.name ?? "crate";

  /** CSV in the column order Spotify importers (Soundiiz, TuneMyMusic) expect. */
  function exportCsv() {
    if (!contents.length) {
      toast.error("This crate is empty.");
      return;
    }
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Position",
      "Title",
      "Artist",
      "Album",
      "Label",
      "Year",
      "BPM",
      "Key",
      "Rating",
      "Tags",
      "URL",
    ];
    const lines = [
      header.join(","),
      ...contents.map((row, i) =>
        [
          i + 1,
          row.tracks?.title,
          row.tracks?.artist,
          "",
          row.tracks?.labels?.name ?? "",
          row.tracks?.release_year ?? "",
          row.tracks?.bpm ?? "",
          row.tracks?.musical_key ?? "",
          row.tracks?.rating ?? "",
          (row.tracks?.moods ?? []).join(" "),
          row.tracks?.url ?? "",
        ]
          .map(cell)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${crateName.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyTracklist() {
    if (!contents.length) {
      toast.error("This crate is empty.");
      return;
    }
    const text = contents.map((row) => `${row.tracks?.artist} - ${row.tracks?.title}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Tracklist copied — paste it into a playlist importer");
    } catch {
      toast.error("Couldn't copy — try the CSV export");
    }
  }

  return (
    <AppShell
      title={crateQuery.data?.name ?? "Crate"}
      subtitle={crateQuery.data?.description ?? undefined}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/crates">All crates</Link>
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
          <Button variant="outline" onClick={copyTracklist}>
            Copy tracklist
          </Button>
          <Button onClick={() => setPicking((p) => !p)}>{picking ? "Done" : "Add tracks"}</Button>
        </div>
      }
    >
      {picking ? (
        <div className="fc-picker-panel mb-8 border border-border p-4">
          <p className="label-mono mb-3 text-muted-foreground">Pick from your tracks</p>
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Everything you've saved is already in here.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {available.map((t) => (
                <li
                  key={t.id}
                  className={`fc-catalogue-row flex flex-wrap items-center gap-2 border border-border px-3 py-2 ${
                    nowPlaying === `pick-${t.id}` ? playingRowClass : ""
                  }`}
                >
                  <DiscoverPreview
                    playbackKey={`pick-${t.id}`}
                    artist={t.artist}
                    title={t.title}
                    initialSrc={t.preview_url || null}
                  />
                  <FullTrackPlayer
                    playbackKey={`pick-${t.id}`}
                    artist={t.artist}
                    title={t.title}
                    url={t.url}
                  />
                  <span className="min-w-32 flex-1 text-sm">
                    {t.artist} — {t.title}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => addTrack.mutate(t.id)}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <CrateMatches
        crateId={crateId}
        seeds={contents
          .map((c) => ({ artist: c.tracks?.artist ?? "", title: c.tracks?.title ?? "" }))
          .filter((s) => s.artist && s.title)}
      />

      {contentsQuery.isLoading ? (
        <EmptyState text="Loading crate…" />
      ) : contents.length === 0 ? (
        <EmptyState text="This crate is empty. Add tracks to fill it." />
      ) : (
        <>
          <p className="label-mono mb-2 text-muted-foreground">
            Drag a row by its handle to reorder{saveOrder.isPending ? " · saving…" : ""}
          </p>
          <ol className="fc-catalogue-list divide-y divide-border border border-border">
            {contents.map((row, i) => (
              <li
                key={row.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(row.id)}
                className={`fc-catalogue-row flex flex-wrap items-center gap-4 p-4 ${
                  dragId === row.id ? "opacity-50" : ""
                } ${nowPlaying === `crate-${row.id}` ? playingRowClass : ""}`}
              >
                <span
                  draggable
                  onDragStart={() => setDragId(row.id)}
                  onDragEnd={() => setDragId(null)}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  className="label-mono cursor-grab select-none text-muted-foreground active:cursor-grabbing"
                >
                  ⠿ {String(i + 1).padStart(2, "0")}
                </span>
                <DiscoverPreview
                  playbackKey={`crate-${row.id}`}
                  artist={row.tracks?.artist ?? ""}
                  title={row.tracks?.title ?? ""}
                  initialSrc={row.tracks?.preview_url || null}
                />
                <FullTrackPlayer
                  playbackKey={`crate-${row.id}`}
                  artist={row.tracks?.artist ?? ""}
                  title={row.tracks?.title ?? ""}
                  url={row.tracks?.url}
                />
                <div className="min-w-52 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {row.tracks?.title}
                    <SourceIcon
                      source={row.tracks?.source ?? sourceFromUrl(row.tracks?.url)}
                      url={row.tracks?.url}
                    />
                    {(row.tracks?.source ?? sourceFromUrl(row.tracks?.url)) !== "spotify" ? (
                      <SpotifyLink
                        artist={row.tracks?.artist ?? ""}
                        title={row.tracks?.title ?? ""}
                        url={row.tracks?.url}
                      />
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {row.tracks?.artist}
                    {row.tracks?.labels ? ` · ${row.tracks.labels.name}` : ""}
                    {row.tracks?.release_year ? ` · ${row.tracks.release_year}` : ""}
                  </div>
                </div>
                <div className="label-mono text-muted-foreground">
                  {row.tracks?.bpm ? `${row.tracks.bpm} bpm` : ""} {row.tracks?.musical_key ?? ""}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(row.tracks?.moods ?? []).map((m) => (
                    <Badge key={m} variant="outline" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm text-primary">
                  {ratingStars(row.tracks?.rating ?? null)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeLink.mutate(row.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}
    </AppShell>
  );
}
