import { describe, expect, it } from "vitest";

/*
 * No text under 12px (2.5).
 *
 * The app set 10px and 11px type in about ninety places: table headings, the names of figures, a
 * game's score labels, a team's record. Too small to read at arm's length at a ballfield, and some
 * of it the only place a figure was named. The browser checks (`e2e/design.spec.ts`) measure
 * League's pages as drawn; this reads every component, Team Rankings' too, for a size set below
 * 12px. A line chart's labels are drawn in its SVG at the chart's own scale and are left to it, and
 * the phone's tab bar sizes its labels with the screen (`TabNav`, a `clamp`, not a size).
 */
const sources = import.meta.glob<string>(
  ["/src/**/*.tsx", "!/src/**/*.test.tsx", "!/src/components/charts/LineChart.tsx"],
  { query: "?raw", import: "default", eager: true }
);

const SIZE = /(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g;

describe("text size", () => {
  it("reads the components", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("is 12px or more", () => {
    const tiny = Object.entries(sources).flatMap(([file, source]) =>
      [...source.matchAll(SIZE)]
        .filter(([, px]) => Number(px) < 12)
        .map((match) => `${file}:${source.slice(0, match.index).split("\n").length} ${match[0]}`)
    );
    expect(tiny).toEqual([]);
  });
});
