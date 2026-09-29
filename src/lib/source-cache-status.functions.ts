import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({ names: z.array(z.string().trim().min(1).max(160)).min(1).max(240) });
const SOURCES = ["mixesdb", "soundcloud", "ra"] as const;

/**
 * Lightweight readiness check used only for the short post-follow refetch
 * window. It returns no cached payloads to the browser.
 */
export const sourceCacheStatusFn = createServerFn({ method: "POST" })
  .validator((data) => input.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const names = [...new Set(data.names.map((name) => name.replace(/^Category:/, "")))];
    const { data: rows, error } = await supabaseAdmin
      .from("source_set_cache")
      .select("source, dj_name")
      .in("dj_name", names)
      .in("source", [...SOURCES]);
    if (error) throw new Error(error.message);

    const sourcesByName = new Map<string, Set<string>>();
    for (const row of rows ?? []) {
      const sources = sourcesByName.get(row.dj_name) ?? new Set<string>();
      sources.add(row.source);
      sourcesByName.set(row.dj_name, sources);
    }
    const available = names.filter((name) => (sourcesByName.get(name)?.size ?? 0) > 0);
    const complete = names.filter((name) => SOURCES.every((source) => sourcesByName.get(name)?.has(source)));
    return { available, complete };
  });
