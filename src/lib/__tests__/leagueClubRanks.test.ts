import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  leagueClubRankFor,
  leagueClubRanksFrom,
  readLeagueClubRanks,
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
    store.set("lf_league_club_ranks_v1", "{not json");
    expect(readLeagueClubRanks()).toEqual({});
  });
});
