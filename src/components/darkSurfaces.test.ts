import { describe, expect, it } from "vitest";

/*
 * No white box in dark mode.
 *
 * The page goes dark through `dark:` variants, one class string at a time, so a surface painted
 * `bg-white` or `bg-slate-50` with no dark background of its own stays white on a dark page while
 * the text inside it takes its dark-mode colour. The case that found it was League Settings' Data
 * card: its heading measured 1.05:1 and "Last backup: never", the one line meant to get a backup
 * taken, 1.38:1, pale yellow on white. The Schedule's prediction strip and the Forecast's tier pill
 * were the same. This reads every component's class strings and names any that do it again.
 */
const sources = import.meta.glob<string>(["/src/**/*.tsx", "!/src/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** An opaque light surface: `bg-white` or `bg-slate-50`, not a variant of one or a tint of white. */
const LIGHT_SURFACE = /(?<![\w:/-])bg-(?:white|slate-50)(?![\w/-])/;
const LITERAL = /"[^"\n]*"|`[^`]*`/g;

const whiteInDark = () =>
  Object.entries(sources).flatMap(([file, source]) =>
    [...source.matchAll(LITERAL)]
      .filter(([literal]) => LIGHT_SURFACE.test(literal) && !literal.includes("dark:bg-"))
      .map((match) => `${file}:${source.slice(0, match.index).split("\n").length}`)
  );

describe("light surfaces", () => {
  it("reads the components", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("each carry a dark background", () => {
    expect(whiteInDark()).toEqual([]);
  });
});
