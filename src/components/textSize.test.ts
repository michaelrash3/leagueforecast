import { describe, expect, it } from "vitest";

/*
 * No text under 12px (2.5).
 *
 * The app set 10px and 11px type in about ninety places: table headings, the names of figures, a
 * game's score labels, a team's record. Too small to read at arm's length at a ballfield, and some
 * of it the only place a figure was named. The browser checks (`e2e/design.spec.ts`) measure
 * League's pages as drawn; this reads every component, Team Rankings' too, for a size set below
 * 12px, and the shared styles beside them (`src/styles/tokens.ts`), where the app-mode switch's
 * size lives. A size sized with the screen counts by its floor: the switch's
 * `clamp(11px,3.6vw,14px)` was 11.52px on a 320px phone, and the browser checks, run at 360px, saw
 * it at 12.96px. A line chart's labels are drawn in its SVG at the chart's own scale and are left
 * to it, and the phone's tab bar sizes its labels with the screen down to 9px (`TabNav`), the one
 * size let under 12px.
 */
const sources = import.meta.glob<string>(
  ["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/components/charts/LineChart.tsx"],
  { query: "?raw", import: "default", eager: true }
);

/** A size in pixels, or the least of one sized with the screen: `text-[clamp(11px,…)]` is 11. */
const SIZE = /(?<![\w-])text-\[(?:clamp\()?(\d+(?:\.\d+)?)px/g;

/** The tab bar's labels: five to a 288px row (2.4), measured to fit no larger. */
const ALLOWED = new Set(["/src/components/TabNav.tsx text-[clamp(9px"]);

describe("text size", () => {
  it("reads the components and the shared styles", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain("/src/styles/tokens.ts");
  });

  it("is 12px or more", () => {
    const tiny = Object.entries(sources).flatMap(([file, source]) =>
      [...source.matchAll(SIZE)]
        .filter(([size, px]) => Number(px) < 12 && !ALLOWED.has(`${file} ${size}`))
        .map((match) => `${file}:${source.slice(0, match.index).split("\n").length} ${match[0]}`)
    );
    expect(tiny).toEqual([]);
  });
});
