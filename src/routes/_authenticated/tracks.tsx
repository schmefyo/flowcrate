import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lookupTrackByUrl, enrichTrackByNameFn } from "@/lib/track-import.functions";
import { enrichExistingTrack } from "@/lib/enrich-track";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lookupMixCounts } from "@/lib/mix-count.functions";
import type { MixCount } from "@/lib/mix-count.server";
import {
  mixCountRequest,
  mixCountSuffix,
  shouldRequestMixCount,
  type MixCountStatus,
} from "@/lib/mix-count-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { MoodManager } from "@/components/atlas/MoodManager";
import { playingRowClass, useNowPlaying } from "@/lib/playback";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { useMoods } from "@/lib/moods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KEYS, ratingStars, sourceFromUrl, type LabelRow, type TrackWithLabel } from "@/lib/atlas";
import { EditTrackDialog } from "@/components/atlas/EditTrackDialog";
import { MixesDialog } from "@/components/atlas/MixesDialog";
import { SourceIcon } from "@/components/atlas/SourceIcon";
import { SpotifyLink } from "@/components/atlas/SpotifyLink";
import { FullTrackPlayer } from "@/components/atlas/FullTrackPlayer";
import { AddToCrateButton } from "@/components/atlas/AddToCrateButton";
import { ImportPlaylistDialog } from "@/components/atlas/ImportPlaylistDialog";

export const Route = createFileRoute("/_authenticated/tracks")({
  head: () => ({
    meta: [
      { title: "Tracks — FlowCrate" },
      {
        name: "description",
        content: "Every track you've discovered: artist, label, key, BPM and mood.",
      },
      { property: "og:title", content: "Tracks — FlowCrate" },
      { property: "og:description", content: "Your saved tracks in one place." },
    ],
  }),
  component: TracksPage,
});

type Prefill = {
  title: string;
  artist: string;
  bpm: string;
  musical_key: string;
  genre: string;
  mix_name: string;
  artwork_url: string;
  preview_url: string;
  duration_ms: string;
  release_year: string;
  label_name: string;
};

const EMPTY_PREFILL: Prefill = {
  title: "",
  artist: "",
  bpm: "",
  musical_key: "",
  genre: "",
  mix_name: "",
  artwork_url: "",
  preview_url: "",
  duration_ms: "",
  release_year: "",
  label_name: "",
};

type SortKey =
  | "created_at"
  | "title"
  | "artist"
  | "label"
  | "bpm"
  | "duration_ms"
  | "release_year"
  | "rating"
  | "mixes";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "created_at", label: "Date added" },
  { key: "title", label: "Track" },
  { key: "artist", label: "Artist" },
  { key: "label", label: "Label" },
  { key: "bpm", label: "BPM" },
  { key: "duration_ms", label: "Length" },
  { key: "release_year", label: "Year" },
  { key: "rating", label: "Energy" },
  { key: "mixes", label: "Most mixes" },
];

const TRACK_BATCH_SIZE = 50;
const MIX_COUNT_BATCH_SIZE = 25;

type MixSortState = {
  running: boolean;
  complete: boolean;
  scope: string;
  done: number;
  total: number;
  failed: number;
};

const INITIAL_MIX_SORT: MixSortState = {
  running: false,
  complete: false,
  scope: "",
  done: 0,
  total: 0,
  failed: 0,
};

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function TracksPage() {
  const nowPlaying = useNowPlaying();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TrackWithLabel | null>(null);
  const [mixesFor, setMixesFor] = useState<TrackWithLabel | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [moodFilter, setMoodFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [importUrl, setImportUrl] = useState("");
  const [prefill, setPrefill] = useState<Prefill>(EMPTY_PREFILL);
  const lookup = useServerFn(lookupTrackByUrl);
  const enrich = useServerFn(enrichTrackByNameFn);
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [mixTotals, setMixTotals] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState(TRACK_BATCH_SIZE);
  const [mixSort, setMixSort] = useState<MixSortState>(INITIAL_MIX_SORT);
  const countStatus = useRef(new Map<string, MixCountStatus>());
  const automaticCountQueue = useRef(Promise.resolve());
  const infiniteScrollTarget = useRef<HTMLDivElement | null>(null);
  const mixSortRun = useRef(0);

  const moods = (useMoods().data ?? []).map((m) => m.name);

  const importTrack = useMutation({
    mutationFn: async (url: string) => lookup({ data: { url } }),
    onSuccess: (res) => {
      setPrefill({
        title: res.title,
        artist: res.artist,
        bpm: res.bpm ? String(res.bpm) : "",
        musical_key: res.musicalKey ?? "",
        genre: res.genre ?? "",
        mix_name: res.mixName ?? "",
        artwork_url: res.artworkUrl ?? "",
        preview_url: res.previewUrl ?? "",
        duration_ms: res.durationMs ? String(res.durationMs) : "",
        release_year: res.releaseYear ? String(res.releaseYear) : "",
        label_name: res.labelName ?? "",
      });
      const got = [
        res.bpm && "bpm",
        res.musicalKey && "key",
        res.genre && "genre",
        res.labelName && "label",
        res.artworkUrl && "artwork",
        res.previewUrl && "preview",
      ].filter(Boolean);
      toast.success(`Pulled from ${res.source}${got.length ? ` — ${got.join(", ")}` : ""}`);
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't read that link"),
  });

  const tracksQuery = useQuery({
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

  const labelsQuery = useQuery({
    queryKey: ["labels"],
    queryFn: async () => {
      const { data, error } = await supabase.from("labels").select("*").order("name");
      if (error) throw error;
      return data as LabelRow[];
    },
  });

  const createTrack = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const bpm = String(form.get("bpm") ?? "").trim();
      const rating = String(form.get("rating") ?? "").trim();
      let labelId = String(form.get("label_id") ?? "");
      const importedLabel = String(form.get("imported_label") ?? "").trim();
      if (!labelId && importedLabel) {
        const existing = (labelsQuery.data ?? []).find(
          (l) => l.name.toLowerCase() === importedLabel.toLowerCase(),
        );
        if (existing) labelId = existing.id;
        else {
          const { data: created, error: labelError } = await supabase
            .from("labels")
            .insert({ user_id: userId, name: importedLabel })
            .select("id")
            .single();
          if (labelError) throw labelError;
          labelId = created.id;
          qc.invalidateQueries({ queryKey: ["labels"] });
        }
      }
      const num = (k: string) => {
        const v = String(form.get(k) ?? "").trim();
        return v ? Number(v) : null;
      };
      const text = (k: string) => String(form.get(k) ?? "").trim() || null;
      const { error } = await supabase.from("tracks").insert({
        user_id: userId,
        title: String(form.get("title") ?? "").trim(),
        artist: String(form.get("artist") ?? "").trim(),
        label_id: labelId || null,
        url: String(form.get("url") ?? "").trim() || null,
        bpm: bpm ? Number(bpm) : null,
        musical_key: String(form.get("musical_key") ?? "") || null,
        moods: form.getAll("moods").map(String),
        rating: rating ? Number(rating) : null,
        notes: String(form.get("notes") ?? "").trim() || null,
        genre: text("genre"),
        mix_name: text("mix_name"),
        artwork_url: text("artwork_url"),
        preview_url: text("preview_url"),
        duration_ms: num("duration_ms"),
        release_year: num("release_year"),
        source: sourceFromUrl(String(form.get("url") ?? "")),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      setOpen(false);
      setImportUrl("");
      setPrefill(EMPTY_PREFILL);
      toast.success("Track saved to the atlas");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTrack = useMutation({
    mutationFn: async (track: TrackWithLabel) => {
      const labelId = track.label_id;
      const { error } = await supabase.from("tracks").delete().eq("id", track.id);
      if (error) throw error;

      // Drop the label too once no other track references it.
      if (labelId) {
        const { count } = await supabase
          .from("tracks")
          .select("id", { count: "exact", head: true })
          .eq("label_id", labelId);
        if (!count) await supabase.from("labels").delete().eq("id", labelId);
      }
    },
    onSuccess: () => {
      setConfirmRemoveId(null);
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["labels"] });
      qc.invalidateQueries({ queryKey: ["labels-with-counts"] });
      toast.success("Track removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const rows = tracksQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((t) => {
      const matchesQ =
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        (t.labels?.name ?? "").toLowerCase().includes(q);
      const matchesMood = !moodFilter || (t.moods ?? []).includes(moodFilter);
      return matchesQ && matchesMood;
    });
  }, [tracksQuery.data, search, moodFilter]);

  const counts = useServerFn(lookupMixCounts);
  const countKey = useCallback(
    (track: TrackWithLabel) => ["mixesdb-count", track.id, track.artist, track.title],
    [],
  );

  const fetchMixCounts = useCallback(
    async (
      tracks: TrackWithLabel[],
      { retryFailed = false, onProgress }: { retryFailed?: boolean; onProgress?: () => void } = {},
    ) => {
      const cached: Record<string, number> = {};
      const pending: TrackWithLabel[] = [];
      for (const track of tracks) {
        const status = countStatus.current.get(track.id);
        if (!shouldRequestMixCount(status, retryFailed)) continue;
        const known = qc.getQueryData<number>(countKey(track));
        if (typeof known === "number") {
          countStatus.current.set(track.id, "ok");
          cached[track.id] = known;
          continue;
        }
        countStatus.current.set(track.id, "pending");
        pending.push(track);
      }
      if (Object.keys(cached).length) setMixTotals((previous) => ({ ...previous, ...cached }));

      for (let i = 0; i < pending.length; i += MIX_COUNT_BATCH_SIZE) {
        const batch = pending.slice(i, i + MIX_COUNT_BATCH_SIZE);
        try {
          const results = (await counts({
            data: mixCountRequest(batch),
          })) as MixCount[];
          const totals: Record<string, number> = {};
          const returned = new Set<string>();
          for (const result of results) {
            returned.add(result.key);
            if (result.ok) {
              countStatus.current.set(result.key, "ok");
              totals[result.key] = result.total;
              const track = batch.find((item) => item.id === result.key);
              if (track) qc.setQueryData(countKey(track), result.total);
            } else {
              countStatus.current.set(result.key, "failed");
            }
          }
          for (const track of batch) {
            if (!returned.has(track.id)) countStatus.current.set(track.id, "failed");
          }
          setMixTotals((previous) => ({ ...previous, ...totals }));
        } catch {
          for (const track of batch) countStatus.current.set(track.id, "failed");
        }
        onProgress?.();
      }
    },
    [countKey, counts, qc],
  );

  const mixSortScope = useMemo(() => filtered.map((track) => track.id).join("|"), [filtered]);

  const sorted = useMemo(() => {
    if (sortKey === "mixes" && (!mixSort.complete || mixSort.scope !== mixSortScope)) {
      return [...filtered].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }
    const dir = sortKey === "mixes" ? -1 : sortDir === "asc" ? 1 : -1;
    const value = (t: TrackWithLabel): string | number | null => {
      switch (sortKey) {
        case "title":
          return t.title.toLowerCase();
        case "artist":
          return t.artist.toLowerCase();
        case "label":
          return (t.labels?.name ?? "").toLowerCase() || null;
        case "bpm":
          return t.bpm;
        case "duration_ms":
          return t.duration_ms;
        case "release_year":
          return t.release_year;
        case "rating":
          return t.rating;
        case "mixes":
          return mixTotals[t.id] ?? null;
        default:
          return new Date(t.created_at).getTime();
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || va === "") return 1;
      if (vb === null || vb === "") return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [filtered, mixSort.complete, mixSort.scope, mixSortScope, mixTotals, sortKey, sortDir]);

  const pageRows = useMemo(() => sorted.slice(0, visible), [sorted, visible]);
  const hasMore = visible < sorted.length;

  useEffect(() => {
    if (sortKey === "mixes") return;
    const task = automaticCountQueue.current.then(() => fetchMixCounts(pageRows));
    automaticCountQueue.current = task.catch(() => {});
  }, [fetchMixCounts, pageRows, sortKey]);

  const findAllMixCounts = useCallback(async () => {
    const tracks = filtered;
    const scope = mixSortScope;
    const run = ++mixSortRun.current;
    setMixSort({ running: true, complete: false, scope, done: 0, total: tracks.length, failed: 0 });
    await automaticCountQueue.current;
    if (run !== mixSortRun.current) return;
    const completedBeforeSort = tracks.filter(
      (track) => countStatus.current.get(track.id) !== "pending",
    ).length;
    const failedBeforeSort = tracks.filter(
      (track) => countStatus.current.get(track.id) === "failed",
    ).length;
    setMixSort({
      running: true,
      complete: false,
      scope,
      done: completedBeforeSort,
      total: tracks.length,
      failed: failedBeforeSort,
    });
    await fetchMixCounts(tracks, {
      retryFailed: true,
      onProgress: () => {
        if (run !== mixSortRun.current) return;
        const done = tracks.filter(
          (track) => countStatus.current.get(track.id) !== "pending",
        ).length;
        const failed = tracks.filter(
          (track) => countStatus.current.get(track.id) === "failed",
        ).length;
        setMixSort({ running: true, complete: false, scope, done, total: tracks.length, failed });
      },
    });
    if (run !== mixSortRun.current) return;
    const failed = tracks.filter((track) => countStatus.current.get(track.id) === "failed").length;
    setMixSort({
      running: false,
      complete: failed === 0,
      scope,
      done: tracks.length,
      total: tracks.length,
      failed,
    });
  }, [fetchMixCounts, filtered, mixSortScope]);

  useEffect(() => {
    if (sortKey !== "mixes") return;
    void findAllMixCounts();
  }, [findAllMixCounts, sortKey]);

  useEffect(() => {
    const target = infiniteScrollTarget.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible((current) => Math.min(current + TRACK_BATCH_SIZE, sorted.length));
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, sorted.length]);

  return (
    <AppShell
      title="Tracks"
      subtitle="Everything you've dug up — searchable by artist, label or mood."
      action={
        <div className="flex items-center gap-2">
          <ImportPlaylistDialog />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Add track</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add a track</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3">
                <Label htmlFor="import_url">Paste a link</Label>
                <div className="flex gap-2">
                  <Input
                    id="import_url"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="Spotify, SoundCloud, Beatport, YouTube…"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!importUrl.trim() || importTrack.isPending}
                    onClick={() => importTrack.mutate(importUrl.trim())}
                  >
                    {importTrack.isPending ? "Reading…" : "Fetch"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll fill in what we can — you can edit everything below.
                </p>
              </div>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createTrack.mutate(new FormData(e.currentTarget));
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      name="title"
                      required
                      value={prefill.title}
                      onChange={(e) => setPrefill((p) => ({ ...p, title: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="artist">Artist</Label>
                    <Input
                      id="artist"
                      name="artist"
                      required
                      value={prefill.artist}
                      onChange={(e) => setPrefill((p) => ({ ...p, artist: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="bpm">BPM</Label>
                    <Input
                      id="bpm"
                      name="bpm"
                      type="number"
                      min={60}
                      max={220}
                      value={prefill.bpm}
                      onChange={(e) => setPrefill((p) => ({ ...p, bpm: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="musical_key">Key</Label>
                    <select
                      id="musical_key"
                      name="musical_key"
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      value={prefill.musical_key}
                      onChange={(e) => setPrefill((p) => ({ ...p, musical_key: e.target.value }))}
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
                    <Label htmlFor="rating">Energy</Label>
                    <select
                      id="rating"
                      name="rating"
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      defaultValue=""
                    >
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((r) => (
                        <option key={r} value={r}>
                          {"★".repeat(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="genre">Genre</Label>
                    <Input
                      id="genre"
                      name="genre"
                      value={prefill.genre}
                      onChange={(e) => setPrefill((p) => ({ ...p, genre: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mix_name">Mix / version</Label>
                    <Input
                      id="mix_name"
                      name="mix_name"
                      placeholder="Extended Mix"
                      value={prefill.mix_name}
                      onChange={(e) => setPrefill((p) => ({ ...p, mix_name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="release_year">Year</Label>
                    <Input
                      id="release_year"
                      name="release_year"
                      type="number"
                      min={1900}
                      max={2100}
                      value={prefill.release_year}
                      onChange={(e) => setPrefill((p) => ({ ...p, release_year: e.target.value }))}
                    />
                  </div>
                </div>
                <input type="hidden" name="artwork_url" value={prefill.artwork_url} />
                <input type="hidden" name="preview_url" value={prefill.preview_url} />
                <input type="hidden" name="duration_ms" value={prefill.duration_ms} />
                <input type="hidden" name="imported_label" value={prefill.label_name} />
                {(prefill.artwork_url || prefill.label_name || prefill.preview_url) && (
                  <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-3">
                    {prefill.artwork_url ? (
                      <img
                        src={prefill.artwork_url}
                        alt="Release artwork"
                        className="h-14 w-14 rounded object-cover"
                      />
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      {prefill.label_name ? (
                        <div>
                          Label <span className="text-foreground">{prefill.label_name}</span> will
                          be linked or created.
                        </div>
                      ) : null}
                      {prefill.duration_ms ? (
                        <div>{formatDuration(Number(prefill.duration_ms))}</div>
                      ) : null}
                      {prefill.preview_url ? <div>Preview audio attached</div> : null}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="label_id">Label / collective</Label>
                  <select
                    id="label_id"
                    name="label_id"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    defaultValue=""
                  >
                    <option value="">Unaffiliated</option>
                    {(labelsQuery.data ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">Link</Label>
                  <Input
                    id="url"
                    name="url"
                    placeholder="bandcamp / soundcloud"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Moods</Label>
                  <div className="flex flex-wrap gap-2">
                    {moods.map((m) => (
                      <label
                        key={m}
                        className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted-foreground has-[:checked]:border-primary has-[:checked]:text-primary"
                      >
                        <input type="checkbox" name="moods" value={m} className="sr-only" />
                        {m}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" rows={2} />
                </div>
                <Button type="submit" className="w-full" disabled={createTrack.isPending}>
                  Save track
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <div className="fc-control-deck mb-6 flex flex-wrap items-center gap-3 border-y py-3">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setVisible(TRACK_BATCH_SIZE);
          }}
          placeholder="Search tracks…"
          className="max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          {moods.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMoodFilter(moodFilter === m ? null : m);
                setVisible(TRACK_BATCH_SIZE);
              }}
              className={`fc-track-mood rounded-none border px-3 py-1 text-xs transition-colors ${
                moodFilter === m
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
          <MoodManager />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={bulkEnriching}
            onClick={async () => {
              const missing = (tracksQuery.data ?? []).filter(
                (t) => !t.bpm || !t.genre || !t.labels || !t.release_year,
              );
              if (!missing.length) {
                toast.message("Everything already has metadata");
                return;
              }
              setBulkEnriching(true);
              let filled = 0;
              for (const t of missing) {
                try {
                  const found = await enrichExistingTrack(enrich, t as never);
                  if (found.length) filled += 1;
                } catch {
                  /* keep going */
                }
              }
              setBulkEnriching(false);
              qc.invalidateQueries({ queryKey: ["tracks"] });
              qc.invalidateQueries({ queryKey: ["labels"] });
              toast.success(`Filled metadata on ${filled} of ${missing.length} tracks`);
            }}
          >
            {bulkEnriching ? "Filling…" : "Fill missing info"}
          </Button>
          <Label htmlFor="sort_key" className="text-xs text-muted-foreground">
            Sort by
          </Label>
          <select
            id="sort_key"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SortKey);
              setVisible(TRACK_BATCH_SIZE);
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            aria-label={
              sortKey === "mixes"
                ? "Sorted by most mixes first"
                : sortDir === "asc"
                  ? "Sort ascending"
                  : "Sort descending"
            }
            disabled={sortKey === "mixes"}
            onClick={() => {
              setSortDir(sortDir === "asc" ? "desc" : "asc");
              setVisible(TRACK_BATCH_SIZE);
            }}
          >
            {sortKey === "mixes" || sortDir === "desc" ? "↓" : "↑"}
          </Button>
          {sortKey === "mixes" ? (
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              {mixSort.running ? (
                <span>
                  Finding mix counts… {mixSort.done} / {mixSort.total}
                </span>
              ) : mixSort.complete ? (
                <span>Mix counts found for {mixSort.total} tracks</span>
              ) : mixSort.failed ? (
                <>
                  <span>Couldn’t find mix counts for {mixSort.failed} tracks.</span>
                  <Button variant="outline" size="sm" onClick={() => void findAllMixCounts()}>
                    Try again
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {tracksQuery.isLoading ? (
        <EmptyState text="Loading tracks…" />
      ) : sorted.length === 0 ? (
        <EmptyState text="No tracks yet." />
      ) : (
        <>
          <ul className="fc-catalogue-list divide-y divide-border border border-border">
            {pageRows.map((t) => (
              <li
                key={t.id}
                className={`fc-catalogue-row flex flex-wrap items-center gap-4 p-4 ${
                  nowPlaying === `track-${t.id}` ? playingRowClass : ""
                }`}
              >
                {t.artwork_url ? (
                  <img
                    src={t.artwork_url}
                    alt={`${t.title} artwork`}
                    loading="lazy"
                    className="h-12 w-12 shrink-0 object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 shrink-0 bg-secondary" aria-hidden="true" />
                )}
                <DiscoverPreview
                  playbackKey={`track-${t.id}`}
                  artist={t.artist}
                  title={t.title}
                  initialSrc={t.preview_url || null}
                  onResolved={({ previewUrl, artworkUrl }) => {
                    if (!previewUrl && !artworkUrl) return;
                    void supabase
                      .from("tracks")
                      .update({
                        ...(previewUrl ? { preview_url: previewUrl } : {}),
                        ...(artworkUrl && !t.artwork_url ? { artwork_url: artworkUrl } : {}),
                      })
                      .eq("id", t.id);
                  }}
                />
                <FullTrackPlayer
                  playbackKey={`track-${t.id}`}
                  artist={t.artist}
                  title={t.title}
                  url={t.url}
                />
                <div className="min-w-52 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {t.url ? (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary"
                      >
                        {t.title}
                      </a>
                    ) : (
                      t.title
                    )}
                    <SourceIcon source={t.source ?? sourceFromUrl(t.url)} url={t.url} />
                    {(t.source ?? sourceFromUrl(t.url)) !== "spotify" ? (
                      <SpotifyLink artist={t.artist} title={t.title} url={t.url} />
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t.artist}
                    {t.mix_name ? ` · ${t.mix_name}` : ""}
                    {t.labels ? ` · ${t.labels.name}` : ""}
                  </div>
                </div>
                <div className="label-mono text-xs text-muted-foreground">
                  {[
                    t.bpm ? `${t.bpm} bpm` : null,
                    t.musical_key,
                    t.duration_ms ? formatDuration(t.duration_ms) : null,
                    t.release_year ? String(t.release_year) : null,
                    t.genre,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(t.moods ?? []).map((m) => (
                    <Badge key={m} variant="outline" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm text-primary">{ratingStars(t.rating)}</div>
                <Button variant="ghost" size="sm" onClick={() => setMixesFor(t)}>
                  In mixes
                  {mixCountSuffix(mixTotals[t.id]) ? (
                    <span className="ml-1 text-primary">{mixCountSuffix(mixTotals[t.id])}</span>
                  ) : null}
                </Button>
                <AddToCrateButton trackId={t.id} title={t.title} />
                <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                  Edit
                </Button>

                {confirmRemoveId === t.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={removeTrack.isPending}
                      onClick={() => removeTrack.mutate(t)}
                    >
                      {removeTrack.isPending ? "Removing…" : "Really remove"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmRemoveId(t.id)}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="py-3 text-center text-xs text-muted-foreground" aria-live="polite">
            Showing {pageRows.length} of {sorted.length} tracks
          </div>
          {hasMore ? <div ref={infiniteScrollTarget} className="h-px" aria-hidden="true" /> : null}
        </>
      )}

      <EditTrackDialog track={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <MixesDialog
        track={mixesFor}
        knownTotal={mixesFor ? mixTotals[mixesFor.id] : undefined}
        onOpenChange={(o) => !o && setMixesFor(null)}
      />
    </AppShell>
  );
}
