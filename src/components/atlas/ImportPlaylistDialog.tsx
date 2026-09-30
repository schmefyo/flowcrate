import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lookupPlaylistByUrl } from "@/lib/playlist-import.functions";
import type { PlaylistTrack } from "@/lib/playlist-import.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

export function ImportPlaylistDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const lookup = useServerFn(lookupPlaylistByUrl);

  const selected = useMemo(
    () => tracks.filter((_, i) => !skipped.has(i)),
    [tracks, skipped],
  );

  const fetchPlaylist = useMutation({
    mutationFn: async () => lookup({ data: { url: url.trim() } }),
    onSuccess: (res) => {
      setName(res.name);
      setTracks(res.tracks);
      setSkipped(new Set());
      toast.success(`Found ${res.tracks.length} tracks in "${res.name}"`);
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't read that playlist"),
  });

  const importSelected = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      const { data: existing } = await supabase.from("tracks").select("url, title, artist");
      const have = new Set(
        (existing ?? []).map((t) =>
          `${(t.url ?? "").toLowerCase()}|${t.title.toLowerCase()}|${(t.artist ?? "").toLowerCase()}`,
        ),
      );
      const seenUrls = new Set(
        (existing ?? []).map((t) => (t.url ?? "").toLowerCase()).filter(Boolean),
      );

      const rows = selected
        .filter((t) => {
          const key = `${t.url.toLowerCase()}|${t.title.toLowerCase()}|${t.artist.toLowerCase()}`;
          return !have.has(key) && !seenUrls.has(t.url.toLowerCase());
        })
        .map((t) => ({
          user_id: userId,
          title: t.title,
          artist: t.artist,
          url: t.url,
          source: t.source,
          duration_ms: t.durationMs,
          preview_url: t.previewUrl,
          artwork_url: t.artworkUrl,
          moods: [] as string[],
        }));

      if (!rows.length) return { added: 0, duplicates: selected.length };
      const { error } = await supabase.from("tracks").insert(rows);
      if (error) throw error;
      return { added: rows.length, duplicates: selected.length - rows.length };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      setOpen(false);
      setUrl("");
      setTracks([]);
      setName("");
      toast.success(
        `Added ${res.added} track${res.added === 1 ? "" : "s"}${
          res.duplicates ? ` — skipped ${res.duplicates} already saved` : ""
        }`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Import playlist</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a Spotify playlist</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3">
          <Label htmlFor="playlist_url">Playlist or album link</Label>
          <div className="flex gap-2">
            <Input
              id="playlist_url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/…"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!url.trim() || fetchPlaylist.isPending}
              onClick={() => fetchPlaylist.mutate()}
            >
              {fetchPlaylist.isPending ? "Reading…" : "Fetch"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The playlist has to be public. Untick anything you don't want.
          </p>
        </div>

        {tracks.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{name}</span>
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() =>
                  setSkipped(
                    skipped.size ? new Set() : new Set(tracks.map((_, i) => i)),
                  )
                }
              >
                {skipped.size ? "Select all" : "Deselect all"}
              </button>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {tracks.map((t, i) => (
                <li key={`${t.url}-${i}`} className="flex items-center gap-3 p-2">
                  <Checkbox
                    checked={!skipped.has(i)}
                    onCheckedChange={(checked) =>
                      setSkipped((prev) => {
                        const next = new Set(prev);
                        if (checked) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    aria-label={`Import ${t.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.artist}</p>
                  </div>
                  {t.durationMs ? (
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(t.durationMs)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              className="w-full"
              disabled={!selected.length || importSelected.isPending}
              onClick={() => importSelected.mutate()}
            >
              {importSelected.isPending
                ? "Importing…"
                : `Import ${selected.length} track${selected.length === 1 ? "" : "s"}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              BPM, key, genre, and label aren't in Spotify's playlist data — use “Fill missing
              info” on the Tracks page afterwards.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
