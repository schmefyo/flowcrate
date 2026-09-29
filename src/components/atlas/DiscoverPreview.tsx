import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { lookupPreview } from "@/lib/preview.functions";
import { claimPlayback, clearNowPlaying, releasePlayback, setNowPlaying } from "@/lib/playback";
import { overrideKey, usePreviewOverrides, youtubeIdFrom } from "@/lib/preview-overrides";
import { FixLinkButton } from "@/components/atlas/FixLinkButton";
import { Button } from "@/components/ui/button";


/**
 * Lazily looks up a 30s clip (Deezer) for an artist + title and plays it inline.
 * Saved clip URLs expire, so a playback error re-resolves a fresh one.
 * Reports the resolved preview/artwork so the parent can save it with the track.
 */
export function DiscoverPreview({
  artist,
  title,
  initialSrc = null,
  onResolved,
  playbackKey,
  hideFix = false,
}: {
  artist: string;
  title: string;
  /** Previously saved preview URL, if any. May be expired. */
  initialSrc?: string | null;
  onResolved?: (data: { previewUrl: string | null; artworkUrl: string | null }) => void;
  /** Identifies this row so the page can highlight it while it sounds. */
  playbackKey?: string;
  /** The page renders its own ⚑ correction button elsewhere. */
  hideFix?: boolean;
}) {
  const lookup = useServerFn(lookupPreview);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [src, setSrc] = useState<string | null>(initialSrc);
  // Autoplay only ever happens as the direct result of a Play click.
  const wantsPlay = useRef(false);
  // A saved URL that failed is only refreshed once per mount.
  const refreshed = useRef(false);
  // The YouTube embed only mounts once the user asked for playback.
  const [showVideo, setShowVideo] = useState(false);

  // A hand-picked link the user saved after we matched the wrong track.
  const fixKey = overrideKey(artist, title);
  const overrides = usePreviewOverrides();
  const override = overrides.data?.[fixKey] ?? null;
  const [showFixVideo, setShowFixVideo] = useState(false);
  const overrideVideoId = override ? youtubeIdFrom(override) : null;


  useEffect(() => {
    setSrc(initialSrc);
    refreshed.current = false;
  }, [initialSrc]);

  const keyRef = useRef(playbackKey);
  keyRef.current = playbackKey;

  const stopAudio = useRef(() => {
    const el = audioRef.current;
    if (el) el.pause();
    setPlaying(false);
    clearNowPlaying(keyRef.current);
  });
  const stopVideo = useRef(() => {
    setShowVideo(false);
    clearNowPlaying(keyRef.current);
  });

  const find = useMutation({
    mutationFn: async () => lookup({ data: { artist, title } }),
    onSuccess: (res) => {
      onResolved?.({ previewUrl: res.previewUrl, artworkUrl: res.artworkUrl });
      if (res.previewUrl) {
        if (res.previewUrl === src) {
          // Same URL back: force the element to re-fetch it.
          const el = audioRef.current;
          if (el) {
            el.load();
            if (wantsPlay.current) {
              wantsPlay.current = false;
              claimPlayback(stopAudio.current);
              void el.play().catch(() => {});
            }
          }
        } else {
          setSrc(res.previewUrl);
        }
      } else if (res.youtubeId && wantsPlay.current) {
        claimPlayback(stopVideo.current);
        setNowPlaying(playbackKey);
        setShowVideo(true);
      }
    },
  });

  // The <audio> element only exists after src lands in state, so autoplay here
  // rather than in onSuccess — otherwise the first click never starts playback.
  useEffect(() => {
    if (!src || !wantsPlay.current) return;
    wantsPlay.current = false;
    const el = audioRef.current;
    if (!el) return;
    claimPlayback(stopAudio.current);
    void el.play().catch(() => {});
  }, [src]);

  // Never leave a stale stop handler registered when this row unmounts.
  useEffect(() => {
    const audioStop = stopAudio.current;
    const videoStop = stopVideo.current;
    return () => {
      releasePlayback(audioStop);
      releasePlayback(videoStop);
      clearNowPlaying(keyRef.current);
    };
  }, []);

  const noPreview = find.isSuccess && !find.data?.previewUrl;
  const searchTerm = `${artist} - ${title}`.trim();
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`;
  const videoId = find.data?.youtubeId ?? null;

  const fixButton = hideFix ? null : (
    <FixLinkButton artist={artist} title={title} className="self-center" />
  );
  // A saved correction always wins over whatever the lookup found.
  if (override) {
    return (
      <>
        <div className="flex flex-col gap-2">
          {overrideVideoId && showFixVideo ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${overrideVideoId}?autoplay=1`}
              title={searchTerm}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="aspect-video w-full max-w-sm rounded-sm border border-border"
            />
          ) : overrideVideoId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Play your link for ${title}`}
              title="Play your link"
              className="h-8 w-8 shrink-0 rounded-full border border-primary p-0 text-primary"
              onClick={() => {
                claimPlayback(() => setShowFixVideo(false));
                setNowPlaying(playbackKey);
                setShowFixVideo(true);
              }}
            >
              ▶
            </Button>
          ) : (
            <a
              href={override}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary font-mono text-[10px] text-primary"
              title="Open your link"
              aria-label={`Open your link for ${title}`}
            >
              ↗
            </a>
          )}
        </div>
        {fixButton}
      </>
    );
  }

  if (noPreview) {

    return (
      <>
      <div className="flex flex-col gap-2">

        {videoId && showVideo ? (
          <>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
              title={find.data?.youtubeTitle ?? searchTerm}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="aspect-video w-full max-w-sm rounded-sm border border-border"
            />
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              Not it? Search YouTube →
            </a>
          </>
        ) : videoId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Play YouTube video for ${title}`}
            title="Play video"
            className="h-8 w-8 shrink-0 rounded-full border border-border p-0 text-primary"
            onClick={() => {
              claimPlayback(stopVideo.current);
              setNowPlaying(playbackKey);
              setShowVideo(true);
            }}
          >
            ▶
          </Button>
        ) : (
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] uppercase text-muted-foreground hover:border-primary hover:text-primary"
            aria-label={`Search YouTube for ${searchTerm}`}
            title="No preview or video found"
          >
            YT
          </a>
        )}
      </div>
      {fixButton}
      </>
    );

  }

  return (
    <>
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="none"
          onEnded={() => {
            setPlaying(false);
            clearNowPlaying(playbackKey);
            releasePlayback(stopAudio.current);
          }}
          onPause={() => {
            setPlaying(false);
            clearNowPlaying(playbackKey);
          }}
          onPlay={() => {
            setPlaying(true);
            setNowPlaying(playbackKey);
          }}
          onError={() => {
            setPlaying(false);
            clearNowPlaying(playbackKey);
            // Saved Deezer clip URLs expire — resolve a fresh one and retry.
            if (!refreshed.current && !find.isPending) {
              refreshed.current = true;
              find.mutate();
            } else {
              wantsPlay.current = false;
            }
          }}
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={find.isPending}
        aria-label={playing ? "Pause preview" : `Play preview of ${title}`}
        title="Play 30s preview"
        className="h-8 w-8 shrink-0 rounded-full border border-border p-0 text-primary disabled:opacity-40"
        onClick={() => {
          const el = audioRef.current;
          if (!el || !src) {
            wantsPlay.current = true;
            if (!find.isPending) find.mutate();
            return;
          }
          if (el.paused) {
            wantsPlay.current = true;
            claimPlayback(stopAudio.current);
            void el
              .play()
              .then(() => {
                wantsPlay.current = false;
              })
              .catch(() => {
                // onError handles refreshing an expired URL.
              });
          } else {
            el.pause();
            wantsPlay.current = false;
            releasePlayback(stopAudio.current);
          }
        }}
      >
        {find.isPending ? "…" : playing ? "■" : "▶"}
      </Button>
      {fixButton}
    </>

  );
}
