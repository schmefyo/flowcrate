import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMoods } from "@/lib/moods";
import { KEYS, SOURCES, sourceFromUrl, type TrackWithLabel } from "@/lib/atlas";

function msToClock(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function clockToMs(value: string): number | null {
  const clean = value.trim();
  if (!clean) return null;
  const parts = clean.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  const secs = parts.length === 2 ? (parts[0] ?? 0) * 60 + (parts[1] ?? 0) : (parts[0] ?? 0);
  return secs > 0 ? secs * 1000 : null;
}

type Props = {
  track: TrackWithLabel | null;
  onOpenChange: (open: boolean) => void;
};

export function EditTrackDialog({ track, onOpenChange }: Props) {
  const qc = useQueryClient();
  const moods = (useMoods().data ?? []).map((m) => m.name);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [energy, setEnergy] = useState("");
  const [notes, setNotes] = useState("");
  const [bpm, setBpm] = useState("");
  const [musicalKey, setMusicalKey] = useState("");
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [length, setLength] = useState("");

  useEffect(() => {
    if (!track) return;
    setTitle(track.title);
    setArtist(track.artist);
    setUrl(track.url ?? "");
    setSource(track.source ?? sourceFromUrl(track.url) ?? "");
    setTags(track.moods ?? []);
    setEnergy(track.rating ? String(track.rating) : "");
    setNotes(track.notes ?? "");
    setBpm(track.bpm ? String(track.bpm) : "");
    setMusicalKey(track.musical_key ?? "");
    setGenre(track.genre ?? "");
    setYear(track.release_year ? String(track.release_year) : "");
    setLength(msToClock(track.duration_ms));
  }, [track]);

  const save = useMutation({
    mutationFn: async () => {
      if (!track) return;
      if (!title.trim() || !artist.trim()) throw new Error("Track and artist are required");
      const { error } = await supabase
        .from("tracks")
        .update({
          title: title.trim(),
          artist: artist.trim(),
          url: url.trim() || null,
          source: source || null,
          moods: tags,
          rating: energy ? Number(energy) : null,
          notes: notes.trim() || null,
          bpm: bpm.trim() ? Number(bpm) : null,
          musical_key: musicalKey || null,
          genre: genre.trim() || null,
          release_year: year.trim() ? Number(year) : null,
          duration_ms: clockToMs(length),
        })
        .eq("id", track.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tracks"] });
      onOpenChange(false);
      toast.success("Track updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!track} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit track</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="edit_title">Track</Label>
            <Input id="edit_title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_artist">Artist</Label>
            <Input
              id="edit_artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_url">Link</Label>
            <Input
              id="edit_url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                const guess = sourceFromUrl(e.target.value);
                if (guess) setSource(guess);
              }}
              placeholder="https://open.spotify.com/track/…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_source">Source</Label>
            <select
              id="edit_source"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">—</option>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit_bpm">BPM</Label>
              <Input
                id="edit_bpm"
                inputMode="numeric"
                value={bpm}
                onChange={(e) => setBpm(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="140"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_key">Key</Label>
              <select
                id="edit_key"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={musicalKey}
                onChange={(e) => setMusicalKey(e.target.value)}
              >
                <option value="">—</option>
                {KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_genre">Genre</Label>
              <Input id="edit_genre" value={genre} onChange={(e) => setGenre(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_year">Year</Label>
              <Input
                id="edit_year"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                placeholder="2024"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_length">Length</Label>
              <Input
                id="edit_length"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="6:32"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {moods.map((m) => {
                const on = tags.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setTags((prev) => (on ? prev.filter((x) => x !== m) : [...prev, m]))
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      on
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_energy">Energy</Label>
            <select
              id="edit_energy"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={energy}
              onChange={(e) => setEnergy(e.target.value)}
            >
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  {"★".repeat(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_notes">When would I play this?</Label>
            <Textarea
              id="edit_notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="4am, room two, after the lights drop…"
            />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            Save changes
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
