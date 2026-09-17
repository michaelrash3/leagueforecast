import { describe, expect, it } from "vitest";
import {
  AGE_PARAM,
  RANKINGS_SECTIONS,
  SECTION_PARAM,
  VIEW_PARAM,
  YEAR_PARAM,
  parseRankingsRoute,
  rankingsSearch,
  sameRankingsRoute,
} from "../rankingsRoute";
import { MAX_AGE_LEVEL, MIN_AGE_LEVEL } from "../teamRankings";

describe("parseRankingsRoute", () => {
  it("reads a full page out of a query string", () => {
    expect(parseRankingsRoute("?view=rankings&age=10&year=2028&section=games")).toEqual({
      mode: "rankings",
      ageLevel: 10,
      year: 2028,
      section: "games",
    });
  });

  it("does not need the leading question mark", () => {
    expect(parseRankingsRoute("view=rankings&age=10&year=2028")).toEqual({
      mode: "rankings",
      ageLevel: 10,
      year: 2028,
    });
  });

  it("reads each half on its own", () => {
    expect(parseRankingsRoute("?year=2028")).toEqual({ year: 2028 });
    expect(parseRankingsRoute("?age=12")).toEqual({ ageLevel: 12 });
    expect(parseRankingsRoute("?view=league")).toEqual({ mode: "league" });
    expect(parseRankingsRoute("?section=setup")).toEqual({ section: "setup" });
  });

  it("reads every section there is", () => {
    // From the module, not a list copied here: a section added to the union and forgotten used to
    // be a section nothing tested.
    expect(RANKINGS_SECTIONS).toContain("archive");
    RANKINGS_SECTIONS.forEach((section) => {
      expect(parseRankingsRoute(`?section=${section}`).section).toBe(section);
    });
  });

  it("ignores parameters it does not own", () => {
    expect(parseRankingsRoute("?utm_source=text&age=9")).toEqual({ ageLevel: 9 });
  });

  it("is empty for a query string with nothing in it", () => {
    expect(parseRankingsRoute("")).toEqual({});
    expect(parseRankingsRoute("?")).toEqual({});
  });

  it("takes the whole ladder and nothing outside it", () => {
    expect(parseRankingsRoute(`?age=${MIN_AGE_LEVEL}`).ageLevel).toBe(MIN_AGE_LEVEL);
    expect(parseRankingsRoute(`?age=${MAX_AGE_LEVEL}`).ageLevel).toBe(MAX_AGE_LEVEL);
    expect(parseRankingsRoute(`?age=${MIN_AGE_LEVEL - 1}`).ageLevel).toBeUndefined();
    expect(parseRankingsRoute(`?age=${MAX_AGE_LEVEL + 1}`).ageLevel).toBeUndefined();
  });

  // A mistyped link should land on whatever page the app would have opened anyway, so a value that
  // cannot be read is left out rather than defaulted to something.
  it("drops values it cannot read instead of guessing", () => {
    expect(parseRankingsRoute("?age=ten&year=next")).toEqual({});
    expect(parseRankingsRoute("?age=&year=")).toEqual({});
    expect(parseRankingsRoute("?age=10.5")).toEqual({});
    expect(parseRankingsRoute("?age=-10")).toEqual({});
    expect(parseRankingsRoute("?year=99999999")).toEqual({});
    expect(parseRankingsRoute("?view=nonsense")).toEqual({});
    expect(parseRankingsRoute("?section=nonsense")).toEqual({});
    expect(parseRankingsRoute("?section=")).toEqual({});
  });

  it("reads a view in any case, with padding", () => {
    expect(parseRankingsRoute("?view=%20Rankings%20").mode).toBe("rankings");
  });

  it("reads a section in any case, with padding", () => {
    expect(parseRankingsRoute("?section=%20Scouting%20").section).toBe("scouting");
  });
});

describe("rankingsSearch", () => {
  it("writes a page into an empty query string", () => {
    expect(
      rankingsSearch("", { mode: "rankings", ageLevel: 10, year: 2028, section: "import" })
    ).toBe(`?${VIEW_PARAM}=rankings&${AGE_PARAM}=10&${YEAR_PARAM}=2028&${SECTION_PARAM}=import`);
  });

  it("round-trips through parse", () => {
    const route = {
      mode: "rankings" as const,
      ageLevel: 11,
      year: 2030,
      section: "games" as const,
    };
    expect(parseRankingsRoute(rankingsSearch("", route))).toEqual(route);
  });

  // The app is one page and other features may be using the query string, so this only ever
  // touches its own four keys.
  it("leaves other parameters alone", () => {
    const next = rankingsSearch("?utm_source=text", { mode: "rankings", ageLevel: 9 });
    const params = new URLSearchParams(next.slice(1));
    expect(params.get("utm_source")).toBe("text");
    expect(params.get(AGE_PARAM)).toBe("9");
  });

  it("removes the parameters a route leaves out", () => {
    const next = rankingsSearch("?view=rankings&age=10&year=2028&section=setup", {
      mode: "league",
    });
    expect(next).toBe(`?${VIEW_PARAM}=league`);
  });

  it("comes back empty rather than as a bare question mark", () => {
    expect(rankingsSearch("?age=10", {})).toBe("");
  });

  it("refuses to write a value it would not read back", () => {
    expect(rankingsSearch("", { ageLevel: 99, year: 99999999 })).toBe("");
  });

  it("replaces rather than appends when a parameter is already there", () => {
    const next = rankingsSearch("?age=9&age=10", { ageLevel: 12 });
    expect(next).toBe(`?${AGE_PARAM}=12`);
  });
});

describe("sameRankingsRoute", () => {
  it("is true for the same page", () => {
    expect(sameRankingsRoute({ ageLevel: 10, year: 2028 }, { ageLevel: 10, year: 2028 })).toBe(
      true
    );
  });

  it("is false when the section differs", () => {
    expect(
      sameRankingsRoute({ ageLevel: 10, section: "games" }, { ageLevel: 10, section: "setup" })
    ).toBe(false);
    expect(sameRankingsRoute({ ageLevel: 10 }, { ageLevel: 10, section: "rankings" })).toBe(false);
  });

  it("is false when any half differs", () => {
    expect(sameRankingsRoute({ ageLevel: 10, year: 2028 }, { ageLevel: 11, year: 2028 })).toBe(
      false
    );
    expect(sameRankingsRoute({ ageLevel: 10, year: 2028 }, { ageLevel: 10, year: 2029 })).toBe(
      false
    );
    expect(sameRankingsRoute({ ageLevel: 10 }, { ageLevel: 10, mode: "rankings" })).toBe(false);
  });
});
