import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { lookupFullTrack } from "@/lib/youtube.functions";
import { claimPlayback, clearNowPlaying, releasePlayback, setNowPlaying } from "@/lib/playback";
import { Button } from "@/components/ui/button";

/**
 * Deezer only ever hands out a 30s clip, so full playback (with scrubbing)
 * comes from a YouTube embed resolved on demand for the artist + title.
 */
export function FullTrackPlayer({
  artist,
  title,
  url,
  playbackKey,
}: {
  artist: string;
  title: string;
  /** The track's own link — a YouTube URL plays directly, no lookup needed. */
  url?: string | null;
  /** Identifies this row so the page can highlight it while it plays. */
  playbackKey?: string;
}) {
  const lookup = useServerFn(lookupFullTrack);
  const [open, setOpen] = useState(false);
  const ownId = idFromUrl(url);

  const keyRef = useRef(playbackKey);
  keyRef.current = playbackKey;

  const stop = useRef(() => {
    setOpen(false);
    clearNowPlaying(keyRef.current);
  });

  const find = useMutation({
    mutationFn: async () => lookup({ data: { artist, title } }),
    onSuccess: (res) => {
      if (res.youtubeId) {
        claimPlayback(stop.current);
        setNowPlaying(playbackKey);
        setOpen(true);
      }
    },
  });

  useEffect(() => {
    const handler = stop.current;
    return () => {
      releasePlayback(handler);
      clearNowPlaying(keyRef.current);
    };
  }, []);

  const videoId = ownId ?? find.data?.youtubeId ?? null;
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${artist} - ${title}`.trim(),
  )}`;

  if (open && videoId) {
    return (
      <div className="w-full">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title={find.data?.youtubeTitle ?? `${artist} - ${title}`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full max-w-sm rounded-sm border border-border"
        />
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground hover:text-primary"
          onClick={() => {
            releasePlayback(stop.current);
            clearNowPlaying(playbackKey);
            setOpen(false);
          }}
        >
          Close player
        </button>
      </div>
    );
  }

  if (find.isSuccess && !videoId) {
    return (
      <a
        href={searchUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="label-mono text-[10px] text-muted-foreground hover:text-primary"
        title="No full track found — search YouTube"
      >
        YT?
      </a>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={find.isPending}
      title="Play full track (YouTube)"
      aria-label={`Play full track of ${title}`}
      className="h-8 shrink-0 rounded-full border border-border px-2 text-[10px] uppercase text-muted-foreground hover:text-primary disabled:opacity-40"
      onClick={() => {
        if (videoId) {
          claimPlayback(stop.current);
          setNowPlaying(playbackKey);
          setOpen(true);
          return;
        }
        if (!find.isPending) find.mutate();
      }}
    >
      {find.isPending ? "…" : "Full"}
    </Button>
  );
}

function idFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const m =
    url.match(/youtube\.com\/watch\?v=([\w-]{6,})/) || url.match(/youtu\.be\/([\w-]{6,})/);
  return m?.[1] ?? null;
}
