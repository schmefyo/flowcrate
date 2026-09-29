import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { importPlaylistFromUrl, type ImportedPlaylist } from "./playlist-import.server";

export const lookupPlaylistByUrl = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({ url: z.string().trim().min(5).max(2000) }).parse(data),
  )
  .handler(async ({ data }): Promise<ImportedPlaylist> =>
    importPlaylistFromUrl(data.url),
  );
