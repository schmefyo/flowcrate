export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      crate_tracks: {
        Row: {
          crate_id: string
          created_at: string
          id: string
          position: number
          track_id: string
          user_id: string
        }
        Insert: {
          crate_id: string
          created_at?: string
          id?: string
          position?: number
          track_id: string
          user_id: string
        }
        Update: {
          crate_id?: string
          created_at?: string
          id?: string
          position?: number
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crate_tracks_crate_id_fkey"
            columns: ["crate_id"]
            isOneToOne: false
            referencedRelation: "crates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crate_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      crates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          mood: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          mood?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          mood?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      followed_djs: {
        Row: {
          aliases: string[]
          created_at: string
          id: string
          links: Json
          links_checked_at: string | null
          name: string
          notes: string | null
          on_radar: boolean
          scenes: string[]
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          id?: string
          links?: Json
          links_checked_at?: string | null
          name: string
          notes?: string | null
          on_radar?: boolean
          scenes?: string[]
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          id?: string
          links?: Json
          links_checked_at?: string | null
          name?: string
          notes?: string | null
          on_radar?: boolean
          scenes?: string[]
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      labels: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          following: boolean
          id: string
          kind: string
          links: Json
          links_checked_at: string | null
          name: string
          notes: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          following?: boolean
          id?: string
          kind?: string
          links?: Json
          links_checked_at?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          following?: boolean
          id?: string
          kind?: string
          links?: Json
          links_checked_at?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      moods: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      preview_overrides: {
        Row: {
          created_at: string
          id: string
          track_key: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          track_key: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          track_key?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      radar_cache: {
        Row: {
          cache_key: string
          created_at: string
          id: string
          payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          id?: string
          payload: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          id?: string
          payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      source_set_cache: {
        Row: {
          dj_name: string
          fetched_at: string
          payload: Json
          source: string
        }
        Insert: {
          dj_name: string
          fetched_at?: string
          payload?: Json
          source: string
        }
        Update: {
          dj_name?: string
          fetched_at?: string
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      tracks: {
        Row: {
          artist: string
          artwork_url: string | null
          bpm: number | null
          created_at: string
          duration_ms: number | null
          genre: string | null
          id: string
          label_id: string | null
          mix_name: string | null
          moods: string[]
          musical_key: string | null
          notes: string | null
          preview_url: string | null
          rating: number | null
          release_year: number | null
          source: string | null
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          artist: string
          artwork_url?: string | null
          bpm?: number | null
          created_at?: string
          duration_ms?: number | null
          genre?: string | null
          id?: string
          label_id?: string | null
          mix_name?: string | null
          moods?: string[]
          musical_key?: string | null
          notes?: string | null
          preview_url?: string | null
          rating?: number | null
          release_year?: number | null
          source?: string | null
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          artist?: string
          artwork_url?: string | null
          bpm?: number | null
          created_at?: string
          duration_ms?: number | null
          genre?: string | null
          id?: string
          label_id?: string | null
          mix_name?: string | null
          moods?: string[]
          musical_key?: string | null
          notes?: string | null
          preview_url?: string | null
          rating?: number | null
          release_year?: number | null
          source?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracks_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      detach_mood: { Args: { old_name: string }; Returns: undefined }
      rename_mood: {
        Args: { new_name: string; old_name: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
