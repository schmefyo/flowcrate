import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { radarFeed, radarSets } from "./radar.server";

export const radarSetsFn = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        djs: z.array(z.string().trim().min(1).max(160)).min(1).max(80),
        setLimit: z.number().int().min(5).max(200).optional(),
        sinceMonths: z.number().int().min(0).max(120).optional(),
        // Only the Artist page uses this to handle a newly followed artist
        // before the global scheduler has populated its cache rows.
        fallbackMissing: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    radarSets(data.djs, data.setLimit ?? 15, data.sinceMonths ?? 0, data.fallbackMissing ?? false),
  );


export const radarFeedFn = createServerFn({ method: "POST" })
  .validator((data) =>
    z
      .object({
        djs: z.array(z.string().trim().min(1).max(160)).min(1).max(40),
        // Zero is the internal unlimited value used by Discover's full-history scan.
        setLimit: z.number().int().min(0).max(200).optional(),
        sinceMonths: z.number().int().min(0).max(120).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) =>
    radarFeed(data.djs, data.setLimit ?? 25, data.sinceMonths ?? 0),
  );
