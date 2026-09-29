import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { mixCountBatch } from "./mix-count.server";

const schema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().transform((s) => s.slice(0, 400)),
        artist: z
          .string()
          .catch("")
          .transform((s) => s.trim().slice(0, 200)),
        title: z
          .string()
          .catch("")
          .transform((s) => s.trim().slice(0, 300)),
      }),
    )
    .max(25)
    .catch([]),
});

export const lookupMixCounts = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data ?? {}))
  .handler(async ({ data }) => {
    if (!data.items.length) return [];
    return mixCountBatch(data.items);
  });
