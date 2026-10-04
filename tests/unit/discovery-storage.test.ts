import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../src/integrations/supabase/client", () => ({ supabase: store }));
import { saveDiscoveredTrack } from "../../src/lib/discovery-storage.ts";
import { discoverySources } from "../../src/lib/discovery-provenance.ts";

beforeEach(() => vi.resetAllMocks());
describe("atomic discovered-track save contract", () => {
  it("saves a new track and its sources through one transaction without changing metadata", async () => {
    const track = { id: "saved", title: "Track", artist: "Artist" };
    store.rpc.mockResolvedValue({ data: { track, created: true }, error: null });
    const sources = discoverySources([
      { dj: "Eris Drew", title: "2026-01-01 - Set", url: "https://example.test/a" },
    ]);
    expect(
      await saveDiscoveredTrack({
        artist: "Artist",
        title: "Track",
        sources,
        previewUrl: "preview",
        notes: "notes",
      }),
    ).toEqual({ track, created: true });
    expect(store.rpc).toHaveBeenCalledWith("save_discovered_track", {
      p_artist: "Artist",
      p_title: "Track",
      p_sources: sources,
      p_preview_url: "preview",
      p_artwork_url: null,
      p_notes: "notes",
      p_source: null,
    });
  });

  it("accepts the existing track returned when saving a second DJ/set context", async () => {
    store.rpc.mockResolvedValue({
      data: { track: { id: "existing" }, created: false },
      error: null,
    });
    const sources = discoverySources([
      { dj: "Octo Octa", title: "Set B", url: "https://example.test/b" },
    ]);
    const saved = await saveDiscoveredTrack({ artist: "Artist", title: "Track", sources });
    expect(saved.track.id).toBe("existing");
    expect(saved.created).toBe(false);
    expect(store.rpc.mock.calls[0]![1].p_sources).toEqual(sources);
  });

  it("fails explicitly rather than silently losing provenance when the RPC fails", async () => {
    store.rpc.mockResolvedValue({ data: null, error: { message: "private database error" } });
    await expect(
      saveDiscoveredTrack({ artist: "Artist", title: "Track", sources: [] }),
    ).rejects.toThrow("Couldn't save this track's discovery context");
  });

  it("declares ownership, append-only conflict handling, and existing-track reuse in the migration", () => {
    const sql = readFileSync(
      new URL(
        "../../supabase/migrations/20261004000000_add_track_discovery_provenance.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("t.user_id = auth.uid()");
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("CREATE UNIQUE INDEX track_discovery_relationship_idx");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql).toContain("IF NOT FOUND THEN");
    expect(sql).not.toMatch(/UPDATE public\.tracks|DELETE FROM public\.track_discovery_sources/i);
    expect(sql).toContain("FROM PUBLIC, anon");
  });
});
