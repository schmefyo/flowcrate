import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { TrackRow } from "./atlas";
import type { DiscoveryRecord, DiscoverySource } from "./discovery-provenance";
import { readLibraryPages } from "./label-library";

// Additive schema typing kept separate from the generated database types.
type DiscoveryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      track_discovery_sources: {
        Row: DiscoveryRecord & { id: string; user_id: string; created_at: string };
        Insert: DiscoveryRecord & { user_id: string };
        Update: Partial<DiscoveryRecord>;
        Relationships: [];
      };
    };
    Functions: Database["public"]["Functions"] & {
      save_discovered_track: {
        Args: {
          p_artist: string;
          p_title: string;
          p_sources: Json;
          p_preview_url: string | null;
          p_artwork_url: string | null;
          p_notes: string | null;
          p_source: string | null;
        };
        Returns: Json;
      };
    };
  };
};
const db = supabase as unknown as SupabaseClient<DiscoveryDatabase>;

export function readDiscoveryHistory() {
  return readLibraryPages((from, to) =>
    db.from("track_discovery_sources").select("*").order("id").range(from, to),
  );
}

export async function saveDiscoveredTrack(
  input: {
    artist: string;
    title: string;
    sources: DiscoverySource[];
    previewUrl?: string | null;
    artworkUrl?: string | null;
    notes?: string | null;
    source?: string | null;
  },
  client = db,
) {
  const { data, error } = await client.rpc("save_discovered_track", {
    p_artist: input.artist,
    p_title: input.title,
    p_sources: input.sources as unknown as Json,
    p_preview_url: input.previewUrl ?? null,
    p_artwork_url: input.artworkUrl ?? null,
    p_notes: input.notes ?? null,
    p_source: input.source ?? null,
  });
  if (error) throw new Error("Couldn't save this track's discovery context. Please try again.");
  return data as unknown as { track: TrackRow; created: boolean };
}
