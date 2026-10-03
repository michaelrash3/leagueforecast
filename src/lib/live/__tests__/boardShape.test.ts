import { describe, expect, it } from "vitest";
import type { ScoutRankingRow } from "../../teamRankings";
import {
  coerceBoardView,
  coerceLivePages,
  isBoardRow,
  isRankingRow,
  withMine,
  type BoardRow,
} from "../views/boardShape";

/*
 * What a published board is, as a member's device checks it (`views/boardShape.ts`): every field
 * a row must carry, the facts it may, the star a device puts on it, and the pages' inline counts.
 */

const ROW: BoardRow = {
  teamId: "t1",
  teamName: "Placeholder Hawks",
  rank: 1,
  rating: 4.25,
  pointRating: 5.5,
  record: "10-2",
  wins: 10,
  losses: 2,
  ties: 0,
  games: 12,
  rawMargin: 3.1,
  strengthOfSchedule: 0.4,
  sosRank: 7,
  ageLevel: 10,
  crossAgeGames: 1,
  componentSize: 300,
  componentId: "t9",
  comparable: true,
  fromGameChanger: true,
};

describe("a published board's row", () => {
  it("is every field a ranking row has but the star, with the facts it carries", () => {
    expect(isBoardRow(ROW)).toBe(true);
    expect(isBoardRow({ ...ROW, city: "Springfield", state: "OH", league: true })).toBe(true);
    // Optional numbers may be left out; a field this build does not know is let through.
    const { ageLevel: _level, ...noLevel } = ROW;
    expect(isBoardRow(noLevel)).toBe(true);
    expect(isBoardRow({ ...ROW, overallRank: 3, somethingNewer: [1] })).toBe(true);
  });

  it("is not one with a field missing, of the wrong kind, a star, or a fact that says nothing", () => {
    const required = Object.keys(ROW).filter((field) => field !== "ageLevel");
    for (const field of required) {
      const { [field as keyof BoardRow]: _gone, ...short } = ROW;
      expect(isBoardRow(short), `without ${field}`).toBe(false);
    }
    const wrong: Array<[string, unknown]> = [
      ["rating", "4.25"],
      ["teamId", 1],
      ["comparable", "yes"],
      ["ageLevel", "10"],
      ["overallRank", null],
      ["isMine", false],
      ["city", ""],
      ["state", 39],
      ["league", false],
      ["league", "true"],
    ];
    for (const [field, value] of wrong) {
      expect(isBoardRow({ ...ROW, [field]: value }), `${field} = ${String(value)}`).toBe(false);
    }
    expect(isBoardRow(null)).toBe(false);
    expect(isBoardRow([ROW])).toBe(false);
  });

  it("is a ranking row once a device has put its star on it", () => {
    const [mine] = withMine([ROW], "t1");
    expect(isRankingRow(mine)).toBe(true);
    expect(isRankingRow(ROW)).toBe(false);
    expect(isRankingRow({ ...mine, pointRating: undefined })).toBe(false);
  });
});

describe("a published board", () => {
  it("is its rows when every one is a row, and nothing otherwise", () => {
    expect(coerceBoardView({ rows: [ROW] })).toEqual({ rows: [ROW] });
    expect(coerceBoardView({ rows: [] })).toEqual({ rows: [] });
    expect(coerceBoardView({ rows: [ROW, { ...ROW, rating: "x" }] })).toBeNull();
    expect(coerceBoardView({ rows: ROW })).toBeNull();
    expect(coerceBoardView([ROW])).toBeNull();
    expect(coerceBoardView(null)).toBeNull();
  });
});

describe("a device's star on a published board", () => {
  const rows: BoardRow[] = [ROW, { ...ROW, teamId: "t2", rank: 2 }];
  const stars = (marked: Array<ScoutRankingRow>) => marked.map((row) => row.isMine);

  it("is the page's own club where the page names one, whatever the roster marks", () => {
    expect(stars(withMine(rows, "t2", new Set(["t1"])))).toEqual([false, true]);
    expect(stars(withMine(rows, "nobody"))).toEqual([false, false]);
  });

  it("is the roster's own mark where the page names none, and nothing without one", () => {
    expect(stars(withMine(rows, undefined, new Set(["t1"])))).toEqual([true, false]);
    expect(stars(withMine(rows, "", new Set(["t2"])))).toEqual([false, true]);
    expect(stars(withMine(rows, undefined))).toEqual([false, false]);
  });

  it("leaves every other field as published", () => {
    const [marked] = withMine([{ ...ROW, city: "Springfield", league: true }], "t1");
    expect(marked).toEqual({ ...ROW, city: "Springfield", league: true, isMine: true });
  });
});

describe("the pages' inline counts", () => {
  const PAGES = {
    pulledAt: "2027-04-15T07:20:00.000Z",
    halves: { ag_9u: { fall: 714, spring: 1808 }, ag_showcase: { fall: 0, spring: 0 } },
  };

  it("are each page's counted games by half, and the roster's last pull when there was one", () => {
    expect(coerceLivePages(PAGES)).toEqual(PAGES);
    const { pulledAt: _never, ...unpulled } = PAGES;
    expect(coerceLivePages(unpulled)).toEqual(unpulled);
    expect(coerceLivePages({ halves: {} })).toEqual({ halves: {} });
  });

  it("are nothing when any page's counts, or the pull time, are not what they should be", () => {
    const bad: unknown[] = [
      null,
      {},
      { halves: [] },
      { ...PAGES, pulledAt: "whenever" },
      { ...PAGES, pulledAt: 5 },
      { ...PAGES, halves: { ag_9u: { fall: 1 } } },
      { ...PAGES, halves: { ag_9u: { fall: -1, spring: 0 } } },
      { ...PAGES, halves: { ag_9u: { fall: 1.5, spring: 0 } } },
      { ...PAGES, halves: { ag_9u: [1, 2] } },
    ];
    for (const raw of bad) expect(coerceLivePages(raw), JSON.stringify(raw)).toBeNull();
  });
});
