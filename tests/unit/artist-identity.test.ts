import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtistIdentity } from "../../src/components/atlas/ArtistIdentity";

describe("artist profile header", () => {
  it("renders the name, portrait fallback, and relationship action together without another title", () => {
    const html = renderToStaticMarkup(
      createElement(ArtistIdentity, {
        name: "Powder",
        profile: null,
        links: [],
        action: createElement("button", { type: "button" }, "Follow"),
      }),
    );
    expect(html).toContain('aria-label="Artist profile"');
    expect(html).toContain('aria-label="Powder artist profile"');
    expect(html).toContain('class="fc-page-title break-words">Powder</h1>');
    expect(html).toContain('<button type="button">Follow</button>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
  it("accepts the existing unfollow action while retaining alias identity", () => {
    const html = renderToStaticMarkup(
      createElement(ArtistIdentity, {
        name: "D. Tiffany",
        profile: { aliases: ["D.Tiffany"] },
        links: [],
        action: createElement("button", { type: "button" }, "Unfollow"),
      }),
    );
    expect(html).toContain("Unfollow");
    expect(html).toContain("D.Tiffany");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});
