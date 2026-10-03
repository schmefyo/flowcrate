import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getUser: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
}));
vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: store.getUser }, from: store.from },
}));
import { followArtist, unfollowArtist } from "../../src/lib/artist-follow";

beforeEach(() => {
  vi.resetAllMocks();
  store.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
  store.insert.mockResolvedValue({ error: null });
  store.eq.mockResolvedValue({ error: null });
  store.update.mockReturnValue({ eq: store.eq });
  store.remove.mockReturnValue({ eq: store.eq });
  const query = { order: store.order, range: store.range };
  store.select.mockReturnValue(query);
  store.order.mockReturnValue(query);
  store.range.mockResolvedValue({ data: [], error: null });
  store.from.mockReturnValue({
    insert: store.insert,
    update: store.update,
    delete: store.remove,
    select: store.select,
  });
});

describe("shared artist follow operations", () => {
  it("follows a safe library artist through the shared insert without adding aliases", async () => {
    const result = await followArtist(
      { name: "Ne/Re/A", url: "category-url", aliases: ["Nerea"] },
      undefined,
      { identity: "library" },
    );
    expect(store.insert).toHaveBeenCalledWith({
      user_id: "user",
      name: "Ne/Re/A",
      url: "category-url",
      aliases: [],
    });
    expect(result.names).toEqual(["Ne/Re/A"]);
    expect(store.update).not.toHaveBeenCalled();
  });
  it("reuses an exact stored alias without making another write", async () => {
    store.range.mockResolvedValue({
      data: [{ id: "existing", name: "D. Tiffany", aliases: ["D.Tiffany"] }],
      error: null,
    });
    const result = await followArtist({ name: "D.Tiffany", url: "category-url" }, undefined, {
      identity: "library",
    });
    expect(result).toEqual({ kind: "existing", names: ["D. Tiffany", "D.Tiffany"] });
    expect(store.insert).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });
  it("rechecks library identity against stored follows and refuses automatic alias creation", async () => {
    store.range.mockResolvedValue({
      data: [{ id: "existing", name: "D. Tiffany", aliases: [] }],
      error: null,
    });
    await expect(
      followArtist({ name: "D.Tiffany", url: "category-url" }, undefined, { identity: "library" }),
    ).rejects.toThrow("needs clarification");
    expect(store.insert).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });
  it("checks stored follows before merging a profile-page follow", async () => {
    store.range.mockResolvedValue({
      data: [{ id: "existing", name: "D. Tiffany", aliases: [] }],
      error: null,
    });
    await followArtist({ name: "D.Tiffany", url: "category-url" });
    expect(store.select).toHaveBeenCalledWith("id, name, aliases");
    expect(store.insert).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith({ aliases: ["D.Tiffany"] });
  });
  it("follows through the existing followed_djs contract", async () => {
    const result = await followArtist({ name: "Ne/Re/A", url: "category-url" }, []);
    expect(store.from).toHaveBeenCalledWith("followed_djs");
    expect(store.insert).toHaveBeenCalledWith({
      user_id: "user",
      name: "Ne/Re/A",
      url: "category-url",
      aliases: [],
    });
    expect(result.names).toEqual(["Ne/Re/A"]);
  });
  it("merges a known spelling instead of creating another followed artist", async () => {
    const result = await followArtist(
      { name: "D.Tiffany", url: "category-url", aliases: ["D. Tiffany", "Unrelated"] },
      [{ id: "existing", name: "D. Tiffany", aliases: [] }],
    );
    expect(store.insert).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith({ aliases: ["D.Tiffany"] });
    expect(store.eq).toHaveBeenCalledWith("id", "existing");
    expect(result).toEqual({ kind: "merged", names: ["D. Tiffany", "D.Tiffany"] });
  });
  it("unfollows only the followed row, leaving tracks and crates untouched", async () => {
    await unfollowArtist("existing");
    expect(store.from).toHaveBeenCalledTimes(1);
    expect(store.from).toHaveBeenCalledWith("followed_djs");
    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.eq).toHaveBeenCalledWith("id", "existing");
  });
  it("surfaces follow and unfollow failures without claiming success", async () => {
    store.insert.mockResolvedValue({ error: new Error("Follow failed") });
    await expect(followArtist({ name: "Powder", url: "category-url" }, [])).rejects.toThrow(
      "Follow failed",
    );
    store.eq.mockResolvedValue({ error: new Error("Unfollow failed") });
    await expect(unfollowArtist("existing")).rejects.toThrow("Unfollow failed");
  });
});
