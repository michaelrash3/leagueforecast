import { describe, expect, it } from "vitest";
import type { ScoutRankingRow } from "../../teamRankings";
import {
  coerceBoardView,
  coerceLivePages,
  isBoardRow,
  isRankingRow,
  lastWeekOf,
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
    expect(isBoardRow({ ...ROW, was: 4 })).toBe(true);
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
      ["was", 0],
      ["was", 2.5],
      ["was", "3"],
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

  it("says what last week's board and the rank line were, or is nothing when either is wrong", () => {
    const past = { asOf: "2027-04-08", empty: false };
    const history = {
      teamId: "t1",
      points: [
        { asOf: "2027-04-01", rank: null },
        { asOf: "2027-04-08", rank: 3 },
      ],
    };
    expect(coerceBoardView({ rows: [ROW], past, history })).toEqual({
      rows: [ROW],
      past,
      history,
    });
    for (const [field, value] of [
      ["past", { asOf: "2027-04-08" }],
      ["past", { asOf: "8 April", empty: false }],
      ["past", { asOf: "2027-04-08", empty: "no" }],
      ["history", { teamId: "", points: [] }],
      ["history", { teamId: "t1", points: "none" }],
      ["history", { teamId: "t1", points: [{ asOf: "2027-04-08", rank: 0 }] }],
      ["history", { teamId: "t1", points: [{ asOf: "2027-04-08" }] }],
      ["history", { teamId: "t1", points: [{ asOf: "April", rank: 2 }] }],
    ] as const) {
      expect(coerceBoardView({ rows: [ROW], [field]: value }), field).toBeNull();
    }
  });
});

describe("last week's places on a published board", () => {
  const rows: BoardRow[] = [
    { ...ROW, was: 2 },
    { ...ROW, teamId: "t2", rank: 2 },
  ];
  const past = (empty: boolean) => ({ asOf: "2027-04-08", empty });

  it("are each club's place a week before, by club, where it had one", () => {
    expect(lastWeekOf({ rows, past: past(false) })).toEqual({ t1: 2 });
  });

  it("are nothing without a board a week before, and none at all when it had nobody", () => {
    expect(lastWeekOf({ rows })).toBeNull();
    expect(lastWeekOf({ rows, past: past(true) })).toEqual({});
  });

  it("make every club new when last week's board had clubs, none of them here", () => {
    const fresh = lastWeekOf({ rows: rows.map(({ was: _was, ...row }) => row), past: past(false) });
    expect(fresh).not.toBeNull();
    expect(Object.keys(fresh ?? {})).toHaveLength(1);
    expect(fresh?.t1).toBeUndefined();
    expect(fresh?.t2).toBeUndefined();
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

  it("carry the copy's age groups as a list, which the copy's own check reads where they are used", () => {
    const groups = [{ id: "ag_9u", name: "9U", seasonIds: [] }, "not one"];
    expect(coerceLivePages({ ...PAGES, groups })).toEqual({ ...PAGES, groups });
  });

  it("carry each page's League Standings seasons, with the club each league team is there", () => {
    const league = [
      { page: "ag_9u", season: "spring", clubs: [["lt_1", "S-ACES"]], halves: ["fall", "spring"] },
      // A season none of whose teams is a club there yet, whose places the page writes away.
      { page: "ag_9u", season: "summer", clubs: [], halves: [] },
    ];
    expect(coerceLivePages({ ...PAGES, league })).toEqual({ ...PAGES, league });
    const entry = league[0];
    const bad: unknown[] = [
      {},
      [{ ...entry, page: "" }],
      [{ ...entry, season: 7 }],
      [{ ...entry, clubs: { lt_1: "S-ACES" } }],
      [{ ...entry, clubs: [["lt_1"]] }],
      [{ ...entry, clubs: [["lt_1", "S-ACES", "S-BEARS"]] }],
      [{ ...entry, clubs: [["lt_1", ""]] }],
      [{ ...entry, clubs: [[5, "S-ACES"]] }],
      [{ ...entry, halves: "fall" }],
      [{ ...entry, halves: ["summer"] }],
      [entry, null],
    ];
    for (const raw of bad) {
      expect(coerceLivePages({ ...PAGES, league: raw }), JSON.stringify(raw)).toBeNull();
    }
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
      { ...PAGES, groups: { ag_9u: {} } },
    ];
    for (const raw of bad) expect(coerceLivePages(raw), JSON.stringify(raw)).toBeNull();
  });
});
