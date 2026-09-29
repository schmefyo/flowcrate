import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { findYouTube } from "./preview.server";

const schema = z.object({
  artist: z.string().catch("").transform((s) => s.trim().slice(0, 200)),
  title: z.string().catch("").transform((s) => s.trim().slice(0, 300)),
});

/** Resolve a full-length YouTube video for a track (scrubbable, unlike 30s clips). */
export const lookupFullTrack = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data ?? {}))
  .handler(async ({ data }) => {
    try {
      if (!data.artist && !data.title) return { youtubeId: null, youtubeTitle: null };
      const yt = await findYouTube(data.artist, data.title);
      return { youtubeId: yt?.videoId ?? null, youtubeTitle: yt?.videoTitle ?? null };
    } catch {
      return { youtubeId: null, youtubeTitle: null };
    }
  });
