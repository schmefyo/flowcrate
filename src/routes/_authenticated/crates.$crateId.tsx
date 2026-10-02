import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ratingStars, sourceFromUrl, type CrateRow, type TrackWithLabel } from "@/lib/atlas";
import { CrateMatches } from "@/components/atlas/CrateMatches";
import { playingRowClass, useNowPlaying } from "@/lib/playback";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { FullTrackPlayer } from "@/components/atlas/FullTrackPlayer";
import { SpotifyLink } from "@/components/atlas/SpotifyLink";
import { SourceIcon } from "@/components/atlas/SourceIcon";
import { useMoods } from "@/lib/moods";
import { CrateMoodPicker } from "@/components/atlas/CrateMoodPicker";
import { crateEditDraft, crateMoods as normalizeCrateMoods } from "@/lib/crate-moods";

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
  const navigate = useNavigate();
  const moods = (useMoods().data ?? []).map((m) => m.name);
  const [picking, setPicking] = useState(false);
  const [trackSearch, setTrackSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removeLinkId, setRemoveLinkId] = useState<string | null>(null);
  const [crateNameInput, setCrateNameInput] = useState("");
  const [crateMoodsInput, setCrateMoodsInput] = useState<string[]>([]);
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
  // The new column is additive. Preserve the legacy single mood while a local
  // database is waiting for the migration to be applied.
  const crateMoods = useMemo(() => normalizeCrateMoods(crateQuery.data), [crateQuery.data]);

  useEffect(() => {
    setOrder(rowsFromServer.map((r) => r.id));
  }, [contentsQuery.data]);

  useEffect(() => {
    if (!crateQuery.data) return;
    const draft = crateEditDraft(crateQuery.data);
    setCrateNameInput(draft.name);
    setCrateMoodsInput(draft.moods);
  }, [crateQuery.data, crateMoods]);

  function setEditDialogOpen(open: boolean) {
    if (open && crateQuery.data) {
      const draft = crateEditDraft(crateQuery.data);
      setCrateNameInput(draft.name);
      setCrateMoodsInput(draft.moods);
    }
    setEditing(open);
  }

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
      setTrackSearch("");
      toast.success("Added to crate", {
        action: {
          label: "Go to Crate",
          onClick: () => navigate({ to: "/crates/$crateId", params: { crateId } }),
        },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeLink = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from("crate_tracks").delete().eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      setRemoveLinkId(null);
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      qc.invalidateQueries({ queryKey: ["crates"] });
    },
  });

  const updateCrate = useMutation({
    mutationFn: async () => {
      const name = crateNameInput.trim();
      if (!name) throw new Error("Give the crate a name first");
      const { error } = await supabase
        .from("crates")
        .update({ name, moods: crateMoodsInput })
        .eq("id", crateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crate", crateId] });
      qc.invalidateQueries({ queryKey: ["crates"] });
      setEditing(false);
      toast.success("Crate updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCrate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("crates").delete().eq("id", crateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crates"] });
      toast.success("Crate deleted");
      navigate({ to: "/crates" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inCrate = new Set(contents.map((c) => c.tracks?.id));
  const available = (allTracksQuery.data ?? []).filter((t) => !inCrate.has(t.id));
  const availableMatches = useMemo(() => {
    const query = trackSearch.trim().toLowerCase();
    if (!query) return available;
    return available.filter(
      (track) =>
        track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query),
    );
  }, [available, trackSearch]);

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
    <>
      <AppShell
        title={crateQuery.data?.name ?? "Crate"}
        subtitle={crateQuery.data?.description ?? undefined}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
              Edit crate
            </Button>
            <Button variant="outline" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button variant="outline" onClick={copyTracklist}>
              Copy tracklist
            </Button>
            <Button onClick={() => setPicking((p) => !p)}>{picking ? "Done" : "Add tracks"}</Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleting(true)}
            >
              Delete crate
            </Button>
          </div>
        }
      >
        {crateMoods.length ? (
          <div className="mb-5 flex flex-wrap gap-1">
            {crateMoods.map((mood) => (
              <Badge key={mood} variant="outline">
                {mood}
              </Badge>
            ))}
          </div>
        ) : null}
        {picking ? (
          <div className="fc-picker-panel mb-8 border border-border p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono text-muted-foreground">Pick from your tracks</p>
              <Input
                value={trackSearch}
                onChange={(event) => setTrackSearch(event.target.value)}
                placeholder="Search saved tracks…"
                className="max-w-xs"
              />
            </div>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Everything you've saved is already in here.
              </p>
            ) : availableMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved tracks match that search.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {availableMatches.map((t) => (
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
                      Add to Crate
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
                    onClick={() => setRemoveLinkId(row.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          </>
        )}
      </AppShell>

      <Dialog open={editing} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit crate</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateCrate.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="crate-name">Name</Label>
              <Input
                id="crate-name"
                value={crateNameInput}
                onChange={(event) => setCrateNameInput(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Moods</Label>
              <CrateMoodPicker
                moods={moods}
                selected={crateMoodsInput}
                onChange={setCrateMoodsInput}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateCrate.isPending || !crateNameInput.trim()}>
                {updateCrate.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete crate?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This deletes the crate. Its tracks will remain in your Tracks library.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteCrate.isPending}
              onClick={() => deleteCrate.mutate()}
            >
              {deleteCrate.isPending ? "Deleting…" : "Delete crate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeLinkId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveLinkId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from crate?</AlertDialogTitle>
            <AlertDialogDescription>
              This track will stay in your Tracks library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRemoveLinkId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removeLink.isPending || !removeLinkId}
              onClick={() => removeLinkId && removeLink.mutate(removeLinkId)}
            >
              {removeLink.isPending ? "Removing…" : "Remove"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
