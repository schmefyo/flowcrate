import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MoodRow = {
  id: string;
  name: string;
  position: number;
};

export const moodsQueryKey = ["moods"] as const;

export async function fetchMoods(): Promise<MoodRow[]> {
  const { data, error } = await supabase
    .from("moods")
    .select("id, name, position")
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function useMoods() {
  return useQuery({ queryKey: moodsQueryKey, queryFn: fetchMoods });
}

export function normalizeMood(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
}
