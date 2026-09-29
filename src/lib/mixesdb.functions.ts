import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { findMixesForTrack } from "./mixesdb.server";

export const lookupMixes = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        artist: z.string().trim().min(1).max(200),
        title: z.string().trim().min(1).max(300),
      })
      .parse(data),
  )
  .handler(async ({ data }) => findMixesForTrack(data.artist, data.title));
