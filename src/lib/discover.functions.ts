import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { djFeedFromSets, searchDjs } from "./discover.server";
import { cachedMixesdbSets } from "./source-cache.server";

export const searchDjsFn = createServerFn({ method: "POST" })
  .validator((data) => z.object({ query: z.string().trim().min(1).max(120) }).parse(data))
  .handler(async ({ data }) => searchDjs(data.query));

export const djFeedFn = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        dj: z.string().trim().min(1).max(160),
        // Zero is the Artist page's explicit "All history" choice.
        setLimit: z.number().int().min(0).max(200).optional(),
        aliases: z.array(z.string().trim().min(1).max(160)).max(10).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const names = [data.dj, ...(data.aliases ?? [])];
    const sets = await cachedMixesdbSets(names);
    return djFeedFromSets(data.dj, data.setLimit ?? 50, data.aliases ?? [], sets);
  });
