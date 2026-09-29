import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { findPreview, findYouTube } from "./preview.server";

const schema = z.object({
  artist: z.string().catch("").transform((s) => s.trim().slice(0, 200)),
  title: z.string().catch("").transform((s) => s.trim().slice(0, 300)),
});

const EMPTY = {
  previewUrl: null,
  artworkUrl: null,
  deezerUrl: null,
  matchedArtist: null,
  matchedTitle: null,
  youtubeId: null as string | null,
  youtubeTitle: null as string | null,
};

export const lookupPreview = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data ?? {}))
  .handler(async ({ data }) => {
    try {
      if (!data.artist && !data.title) return EMPTY;
      const found = await findPreview(data.artist, data.title);
      if (found.previewUrl) return { ...found, youtubeId: null, youtubeTitle: null };
      const yt = await findYouTube(data.artist, data.title);
      return {
        ...found,
        youtubeId: yt?.videoId ?? null,
        youtubeTitle: yt?.videoTitle ?? null,
      };
    } catch {
      return EMPTY;
    }
  });
