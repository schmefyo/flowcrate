import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { sourceCacheStatusFn } from "./source-cache-status.functions";

const ATTEMPTS = 8;
const RETRY_MS = 3_000;

/**
 * Batches quick follow actions into one short-lived readiness watcher. Once a
 * warm-up writes any source row, active artist, Radar, and Discover queries
 * are refetched.
 */
export function useSourceCacheWarmup() {
  const queryClient = useQueryClient();
  const status = useServerFn(sourceCacheStatusFn);
  const pending = useRef(new Set<string>());
  const announced = useRef(new Set<string>());
  const running = useRef(false);

  return useCallback(
    (names: string[]) => {
      for (const name of names) {
        const clean = name.trim().replace(/^Category:/, "");
        if (clean) pending.current.add(clean);
      }
      if (running.current || !pending.current.size) return;
      running.current = true;

      void (async () => {
        try {
          for (let attempt = 0; attempt < ATTEMPTS && pending.current.size; attempt += 1) {
            if (attempt) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
            const namesToCheck = [...pending.current];
            try {
              const result = await status({ data: { names: namesToCheck } });
              const newlyAvailable = result.available.filter(
                (name) => !announced.current.has(name),
              );
              for (const name of result.available) announced.current.add(name);
              for (const name of result.complete) pending.current.delete(name);

              if (newlyAvailable.length) {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["radar-sets"] }),
                  queryClient.invalidateQueries({ queryKey: ["discover-scan"] }),
                  queryClient.invalidateQueries({ queryKey: ["artist-sets"] }),
                  queryClient.invalidateQueries({ queryKey: ["dj-feed"] }),
                ]);
                await Promise.all([
                  queryClient.refetchQueries({ queryKey: ["radar-sets"], type: "active" }),
                  queryClient.refetchQueries({ queryKey: ["discover-scan"], type: "active" }),
                  queryClient.refetchQueries({ queryKey: ["artist-sets"], type: "active" }),
                  queryClient.refetchQueries({ queryKey: ["dj-feed"], type: "active" }),
                ]);
              }
            } catch {
              // The follow already succeeded. Retry briefly, then let the
              // normal scheduled refresh handle an unavailable provider.
            }
          }
        } finally {
          pending.current.clear();
          announced.current.clear();
          running.current = false;
        }
      })();
    },
    [queryClient, status],
  );
}
