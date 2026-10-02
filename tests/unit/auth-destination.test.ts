import { describe, expect, it } from "vitest";
import {
  authCallbackUrl,
  authenticatedDestination,
  DEFAULT_AUTHENTICATED_DESTINATION,
} from "../../src/lib/auth-destination.ts";

describe("authenticatedDestination", () => {
  it("uses Discover as the default authenticated entry point", () => {
    expect(DEFAULT_AUTHENTICATED_DESTINATION).toBe("/discover");
    expect(authenticatedDestination()).toBe("/discover");
  });

  it("preserves an explicit internal authenticated destination", () => {
    expect(authenticatedDestination("/tracks")).toBe("/tracks");
    expect(authenticatedDestination("/crates/example")).toBe("/crates/example");
  });

  it("uses the default destination for Supabase auth callbacks", () => {
    expect(authCallbackUrl("https://flowcrate.example")).toBe(
      "https://flowcrate.example/discover",
    );
  });
});
