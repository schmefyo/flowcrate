import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { crateMatches } from "./crate-match.server";

export const crateMatchesFn = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        tracks: z
          .array(
            z.object({
              artist: z.string().trim().min(1).max(200),
              title: z.string().trim().min(1).max(200),
            }),
          )
          .min(1)
          .max(60),
      })
      .parse(data),
  )
  .handler(async ({ data }) => crateMatches(data.tracks));
