import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  importTrackFromUrl,
  enrichTrackByName,
  type ImportedTrack,
} from "./track-import.server";

export const lookupTrackByUrl = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ url: z.string().trim().min(5).max(2000) }).parse(data),
  )
  .handler(async ({ data }): Promise<ImportedTrack> => importTrackFromUrl(data.url));

export const enrichTrackByNameFn = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        artist: z.string().trim().min(1).max(300),
        title: z.string().trim().min(1).max(300),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<ImportedTrack> =>
    enrichTrackByName(data.artist, data.title),
  );
