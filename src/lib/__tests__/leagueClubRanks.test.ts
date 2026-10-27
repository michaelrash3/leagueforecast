import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clubRankPage,
  nationalRankText,
  leagueClubRankFor,
  leagueClubRanksFrom,
  leagueStrength,
  readLeagueClubRanks,
  scoutRoute,
  writeLeagueClubRanks,
  type LeagueClubRank,
} from "../leagueClubRanks";
import type { ScoutRankingRow } from "../teamRankings";

/** A board's rows, best first; only what the places are read from. Invented names. */
const row = (teamId: string, rank: number): ScoutRankingRow =>
  ({
    teamId,
    teamName: teamId,
    rank,
    isMine: false,
    rating: 10 - rank,
    record: "1-0",
  }) as unknown as ScoutRankingRow;
const board = ["S-ACES", "S-OWLS", "S-HIVE", "S-FOXES", "S-BEARS"].map((id, at) => row(id, at + 1));
const states: Record<string, string> = {
  "S-ACES": "KY",
  "S-OWLS": "OH",
  "S-HIVE": "OH",
  "S-FOXES": "OH",
};

describe("where a league's clubs stand on a board", () => {
  it("reads each linked team's national and state place, and its week's movement", () => {
    const places = leagueClubRanksFrom(
      board,
      new Map([
        ["L-HIVE", "S-HIVE"],
        ["L-ACES", "S-ACES"],
        ["L-GONE", "S-NOT-ON-BOARD"],
      ]),
      (teamId) => states[teamId],
      { "S-HIVE": 5, "S-ACES": 1 },
      "9U 2027 · Fall 2026",
      "2026-09-28T12:00:00.000Z"
    );
    expect(places["L-HIVE"]).toEqual({
      clubId: "S-HIVE",
      board: "9U 2027 · Fall 2026",
      rank: 3,
      of: 5,
      state: "OH",
      stateRank: 2,
      stateOf: 3,
      movement: 2,
      at: "2026-09-28T12:00:00.000Z",
    });
    expect(places["L-ACES"]).toMatchObject({ rank: 1, state: "KY", stateRank: 1, stateOf: 1 });
    expect(places["L-ACES"]?.movement).toBe(0);
    // A club with no place on the board has none to carry.
    expect(places["L-GONE"]).toBeUndefined();
  });

  it("carries the page the board is, for the Scout button to open", () => {
    const places = leagueClubRanksFrom(
      board,
      new Map([["L-HIVE", "S-HIVE"]]),
      (teamId) => states[teamId],
      null,
      "9U 2027 · Fall 2026",
      "2026-09-28T12:00:00.000Z",
      clubRankPage(9, 2027, "fall")
    );
    expect(places["L-HIVE"]).toMatchObject({ ageLevel: 9, year: 2027, segment: "fall" });
    // What a writer does not know is left out rather than written as nothing.
    expect(clubRankPage(undefined, 2027, undefined)).toEqual({ year: 2027 });
  });
});

describe("scoutRoute", () => {
  const rank: LeagueClubRank = { clubId: "c", board: "9U 2027", rank: 3, of: 5, at: "2026-10-11" };

  it("opens Scouting on the page the club's place was read off", () => {
    expect(scoutRoute({ ...rank, ageLevel: 9, year: 2027, segment: "spring" })).toEqual({
      mode: "rankings",
      ageLevel: 9,
      year: 2027,
      segment: "spring",
      section: "scouting",
    });
  });

  it("opens Scouting on whatever page Team Rankings would, for a place kept before pages were", () => {
    expect(scoutRoute(rank)).toEqual({ mode: "rankings", section: "scouting" });
  });
});

describe("the ranks kept for League Standings", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const hive: LeagueClubRank = {
    clubId: "S-HIVE",
    board: "9U 2027",
    rank: 3,
    of: 5,
    at: "2026-09-28T12:00:00.000Z",
  };

  it("keeps a season's places and gives one back by league team", () => {
    writeLeagueClubRanks("season-1", { "L-HIVE": hive });
    expect(leagueClubRankFor("season-1", "L-HIVE")).toEqual(hive);
    expect(leagueClubRankFor("season-2", "L-HIVE")).toBeUndefined();
  });

  it("replaces a season's places whole, so a club that left the board takes its place with it", () => {
    writeLeagueClubRanks("season-1", { "L-HIVE": hive, "L-OWLS": { ...hive, clubId: "S-OWLS" } });
    writeLeagueClubRanks("season-1", { "L-HIVE": { ...hive, rank: 2 } });
    expect(Object.keys(readLeagueClubRanks()["season-1"] ?? {})).toEqual(["L-HIVE"]);
    expect(leagueClubRankFor("season-1", "L-HIVE")?.rank).toBe(2);
  });

  it("leaves out what it cannot read rather than guessing", () => {
    store.set(
      "lf_league_club_ranks_v1",
      JSON.stringify({
        "season-1": { "L-HIVE": hive, "L-BAD": { clubId: "S-X", rank: 0, of: 5 } },
        "season-2": "nope",
      })
    );
    expect(readLeagueClubRanks()).toEqual({ "season-1": { "L-HIVE": hive } });
    // The page it was read off is kept when it reads as one, and left out when it does not.
    writeLeagueClubRanks("season-1", {
      "L-HIVE": { ...hive, ageLevel: 9, year: 2027, segment: "fall" },
    });
    expect(leagueClubRankFor("season-1", "L-HIVE")).toEqual({
      ...hive,
      ageLevel: 9,
      year: 2027,
      segment: "fall",
    });
    store.set(
      "lf_league_club_ranks_v1",
      JSON.stringify({
        "season-1": { "L-HIVE": { ...hive, ageLevel: 99, year: 12, segment: "summer" } },
      })
    );
    expect(leagueClubRankFor("season-1", "L-HIVE")).toEqual(hive);
    store.set("lf_league_club_ranks_v1", "{not json");
    expect(readLeagueClubRanks()).toEqual({});
  });
});

describe("nationalRankText", () => {
  it("says a club's place nationally with its board's size, as the standings show it", () => {
    expect(
      nationalRankText({ clubId: "c", board: "9U 2027", rank: 12, of: 3947, at: "2026-10-11" })
    ).toBe("#12 of 3,947 nationally · top 1%");
    expect(
      nationalRankText({ clubId: "c", board: "9U 2027", rank: 1204, of: 3947, at: "2026-10-11" })
    ).toBe("#1,204 of 3,947 nationally · top 31%");
  });
});

describe("a league's strength", () => {
  const rank = (place: number, more: Partial<LeagueClubRank> = {}): LeagueClubRank => ({
    clubId: `S-${place}`,
    board: "9U 2027",
    rank: place,
    of: 1000,
    at: "2026-10-11T00:00:00.000Z",
    ...more,
  });

  it("is the median team's share of its board, rounded up, of the teams placed", () => {
    expect(leagueStrength([rank(100), rank(300), rank(700), undefined])).toEqual({
      ranked: 3,
      of: 4,
      medianTop: 30,
    });
    // An even count reads the middle two.
    expect(leagueStrength([rank(100), rank(200), rank(400), rank(900)])?.medianTop).toBe(30);
  });

  it("says the state most of its teams are in, and how high in its clubs they stand", () => {
    const strength = leagueStrength([
      rank(10, { state: "KY", stateRank: 1, stateOf: 50 }),
      rank(20, { state: "KY", stateRank: 4, stateOf: 50 }),
      rank(30, { state: "OH", stateRank: 2, stateOf: 80 }),
    ]);
    expect(strength?.state).toEqual({ name: "KY", teams: 2, averageTop: 5 });
    // No state that half its placed teams share, no state.
    const split = leagueStrength([
      rank(10, { state: "KY", stateRank: 1, stateOf: 50 }),
      rank(20, { state: "OH", stateRank: 4, stateOf: 80 }),
      rank(30, { state: "IN", stateRank: 2, stateOf: 60 }),
    ]);
    expect(split).not.toHaveProperty("state");
  });

  it("is nothing with fewer than two teams placed", () => {
    expect(leagueStrength([rank(10), undefined])).toBeNull();
    expect(leagueStrength([])).toBeNull();
  });
});
