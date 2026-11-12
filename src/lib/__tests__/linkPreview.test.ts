import { describe, expect, it } from "vitest";
import { PREVIEW_IMAGE, previewTags, siteOrigin } from "../linkPreview";

/*
 * A link's preview picture, which needs the site's whole address and so is written only by a build
 * that knows it. Placeholder hosts.
 */
const content = (tags: ReturnType<typeof previewTags>, name: string) =>
  tags.find((tag) => (tag.attrs.property ?? tag.attrs.name) === name)?.attrs.content;

describe("a link's preview", () => {
  it("is left as it was by a build that has not been told the site's address", () => {
    expect(previewTags({})).toEqual([]);
    expect(previewTags({ VITE_SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: " " })).toEqual([]);
  });

  it("names the picture by the address Vercel gives the project, which has no scheme", () => {
    const tags = previewTags({ VERCEL_PROJECT_PRODUCTION_URL: "forecast.example.org" });
    expect(content(tags, "og:image")).toBe("https://forecast.example.org/og.png");
    expect(content(tags, "og:url")).toBe("https://forecast.example.org/");
    expect(content(tags, "og:image:width")).toBe("1200");
    expect(content(tags, "og:image:height")).toBe("630");
    expect(content(tags, "og:image:alt")).toMatch(/^League Forecast/);
    expect(content(tags, "twitter:card")).toBe("summary_large_image");
  });

  it("takes an address set by hand over Vercel's, with its scheme or without", () => {
    const both = {
      VITE_SITE_URL: " https://League.Example.com/ ",
      VERCEL_PROJECT_PRODUCTION_URL: "forecast.example.org",
    };
    expect(siteOrigin(both)).toBe("https://league.example.com");
    expect(siteOrigin({ VITE_SITE_URL: "league.example.com" })).toBe("https://league.example.com");
  });

  it("turns away anything that is not plainly a host", () => {
    for (const raw of [
      "http://forecast.example.org",
      "forecast.example.org/path",
      'forecast.example.org"><script>',
      "localhost",
      "forecast example.org",
    ]) {
      expect(siteOrigin({ VITE_SITE_URL: raw })).toBeNull();
    }
    // And falls back to Vercel's where the one set by hand is turned away.
    expect(
      siteOrigin({ VITE_SITE_URL: "not a host", VERCEL_PROJECT_PRODUCTION_URL: "ok.example.org" })
    ).toBe("https://ok.example.org");
  });

  it("points at a picture that is in public/", () => {
    const pictures = Object.keys(import.meta.glob("/public/*.png"));
    expect(pictures).toContain(`/public${PREVIEW_IMAGE.path}`);
  });
});
