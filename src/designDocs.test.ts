import { describe, expect, it } from "vitest";

/*
 * The design documents, held to the code where the code can say what they must name.
 *
 * On 8 November 2026 they were found describing an app that had moved on. The Forecast's Bubble
 * Watch, taken out on 29 October (e1010f13), was still named in the README's features, in League
 * Standings' account of the paused Range and in a comment beside the code that draws the Range;
 * and the AI write-ups' document told of two panels where the app draws three, with Team
 * Rankings' Why this ranking nowhere in it. Both are read here as text, as the workflow tests read
 * the workflows and the design tests read the components.
 */
const documents = import.meta.glob<string>(["/README.md", "/docs/**/*.md"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const AI_WRITE_UPS = "/docs/ai-write-ups.md";

/** How many AI write-up panels the components draw, and the title each is drawn under. */
const drawnPanels = () => {
  const code = Object.values(sources);
  return {
    count: code.reduce((sum, source) => sum + (source.match(/<AiStoryPanel\b/g)?.length ?? 0), 0),
    titles: code.flatMap((source) =>
      [...source.matchAll(/<AiStoryPanel\b[^>]*?\btitle="([^"]+)"/g)].map(
        ([, title]) => title ?? ""
      )
    ),
  };
};

describe("the AI write-ups' document", () => {
  it("is read, with the components", () => {
    expect(documents[AI_WRITE_UPS]).toBeTruthy();
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("gives every panel the app draws a section under its title", () => {
    const { count, titles } = drawnPanels();
    // Every panel's title read off its source: one given another way would be missed here.
    expect(titles).toHaveLength(count);
    expect(count).toBeGreaterThanOrEqual(3);
    const headings = (documents[AI_WRITE_UPS] ?? "").split("\n");
    expect(titles.filter((title) => !headings.includes(`## ${title}`))).toEqual([]);
  });
});

/*
 * What the app has taken out, by the name it was drawn under: named nowhere, in a document or in
 * the source, as though it were still there. The league story's own line, "Bubble watch: …", is a
 * sentence the recap still writes, and is told apart by its case.
 */
const RETIRED = [
  {
    what: "the Forecast's Bubble Watch, taken out on 29 October 2026 (e1010f13)",
    named: /\b(?:Bubble Watch|bubble watch)\b/,
  },
];

describe("what the app took out", () => {
  it("is named in no document and no source", () => {
    const naming = RETIRED.flatMap(({ what, named }) =>
      Object.entries({ ...documents, ...sources })
        .filter(([, text]) => named.test(text))
        .map(([file]) => `${file} names ${what}`)
    );
    expect(naming).toEqual([]);
  });
});
