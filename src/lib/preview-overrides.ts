import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Stable id for a track we might have a hand-picked link for. */
export function overrideKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|||${title.trim().toLowerCase()}`;
}

/** Pull a video id out of any common YouTube URL shape. */
export function youtubeIdFrom(url: string): string | null {
  const trimmed = url.trim();
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*\bv=)([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/(?:embed|shorts|live)\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export type OverrideMap = Record<string, string>;

/** Every correction this user saved, keyed by artist|||title. */
export function usePreviewOverrides() {
  return useQuery({
    queryKey: ["preview-overrides"],
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<OverrideMap> => {
      const { data, error } = await supabase.from("preview_overrides").select("track_key, url");
      if (error) throw error;
      const map: OverrideMap = {};
      for (const row of data ?? []) map[row.track_key] = row.url;
      return map;
    },
  });
}

export function useSaveOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, url }: { key: string; url: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("You need to be signed in");
      if (!url) {
        const { error } = await supabase
          .from("preview_overrides")
          .delete()
          .eq("user_id", userId)
          .eq("track_key", key);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("preview_overrides")
        .upsert({ user_id: userId, track_key: key, url }, { onConflict: "user_id,track_key" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preview-overrides"] }),
  });
}
