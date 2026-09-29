import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { popularityBatch } from "./popularity.server";

const schema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().transform((s) => s.slice(0, 400)),
        artist: z.string().catch("").transform((s) => s.trim().slice(0, 200)),
        title: z.string().catch("").transform((s) => s.trim().slice(0, 300)),
      }),
    )
    .max(25)
    .catch([]),
});

export const lookupPopularity = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data ?? {}))
  .handler(async ({ data }) => {
    try {
      if (!data.items.length) return [];
      return await popularityBatch(data.items);
    } catch {
      return [];
    }
  });
