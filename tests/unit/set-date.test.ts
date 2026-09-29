import { describe, expect, it } from "vitest";
import { eventDateForSet, eventDateFromTitle } from "../../src/lib/set-date.ts";
import { isSourceCacheFresh } from "../../src/lib/source-cache-refresh-core.ts";

describe("set event dates", () => {
  it("derives dates from titles, never category-membership timestamps", () => {
    const title = "2018-06-01 - Powder at Contact";
    expect(eventDateFromTitle(title)).toBe("2018-06-01");
    expect(eventDateForSet({ title, date: "2026-09-24" })).toBe("2018-06-01");
  });

  it("keeps an old but valid Powder set date separate from cache freshness", () => {
    expect(eventDateFromTitle("2011-03-04 - Powder live")).toBe("2011-03-04");
    expect(
      isSourceCacheFresh(
        "2026-09-24T11:00:00.000Z",
        12 * 60 * 60 * 1000,
        Date.parse("2026-09-24T12:00:00.000Z"),
      ),
    ).toBe(true);
  });
});
