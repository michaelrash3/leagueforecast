import { describe, expect, it } from "vitest";
import { seasonFromStart, type StartDraft } from "../leagueStart";
import {
  missingGamesToAdd,
  startsFromFill,
  type LeagueFillPlan,
  type LeagueFillRow,
} from "../leagueScoreFill";
import { coerceMatchups } from "../validate";
import type { Matchup } from "../types";
import { inTimeZone } from "../../test/timeZone";

/*
 * A League game keeps the start GameChanger gave it: from a start's draft, from Fill, and through
 * storage, so the Schedule can list a day's games in the order they are played. Placeholder names.
 */
const AT_TEN = "2026-10-24T14:00:00Z";
const AT_TWO = "2026-10-24T18:00:00Z";

/**
 * Zones a device can read the league from: the league's own and its neighbours, UTC, and zones far
 * enough east that a start of the league's day falls on the next day there (all of a morning's in
 * Sydney and Auckland, an evening's from Berlin on), or two starts of one day on two (Tokyo). Fill's
 * starts are read in each, so a test says the same on any machine.
 */
const ZONES = [
  "America/Los_Angeles",
  "America/Chicago",
  "America/New_York",
  "UTC",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
const inEachZone = (zones: readonly string[], check: (zone: string) => void) =>
  zones.forEach((zone) => inTimeZone(zone, () => check(zone)));

/** A row of Fill's plan for game `matchupId` on 10/24, with the pool game's start. */
const fillRow = (matchupId: string, startTs?: string): LeagueFillRow =>
  ({
    matchupId,
    date: "10/24",
    awayTeamId: "A",
    awayName: "Aces",
    homeTeamId: "B",
    homeName: "Bears",
    awayRuns: 3,
    homeRuns: 2,
    action: "fill",
    ...(startTs ? { startTs } : {}),
  }) as LeagueFillRow;

describe("a League game's start", () => {
  it("is kept by storage where it reads as a time, and dropped where it does not", () => {
    const read = coerceMatchups([
      { id: "g1", date: "10/24", away: "A", home: "B", startTs: AT_TEN },
      { id: "g2", date: "10/24", away: "B", home: "A", startTs: "soon" },
    ]);
    expect(read.map((game) => game.startTs)).toEqual([AT_TEN, undefined]);
  });

  it("comes with each game of a season started from its clubs", () => {
    const draft: StartDraft = {
      games: [
        { gameId: "p1", date: "2026-10-24", away: "c1", home: "c2", startTs: AT_TWO },
        { gameId: "p2", date: "2026-10-24", away: "c2", home: "c1" },
      ],
      outside: 0,
    };
    const built = seasonFromStart(
      [
        { id: "c1", name: "Aces" },
        { id: "c2", name: "Bears" },
      ],
      draft,
      [
        { gameId: "p1", keep: true, swap: false },
        { gameId: "p2", keep: true, swap: false },
      ],
      6
    );
    expect(built.matchups.map((game) => game.startTs)).toEqual([AT_TWO, undefined]);
  });

  it("is given by Fill to each matched game that has none, and never over one it has", () => {
    const plan = {
      rows: [fillRow("g1", AT_TEN), fillRow("g2", AT_TWO), fillRow("g3")],
    } as LeagueFillPlan;
    const schedule: Matchup[] = [
      { id: "g1", date: "10/24", away: "A", home: "B" },
      { id: "g2", date: "10/24", away: "B", home: "A", startTs: AT_TEN },
      { id: "g3", date: "10/24", away: "A", home: "B" },
    ];
    inEachZone(ZONES, (zone) =>
      expect(startsFromFill(plan, schedule), zone).toEqual({ g1: AT_TEN })
    );
  });

  it("is given by Fill over one that falls on another day than its game", () => {
    const plan = { rows: [fillRow("g1", AT_TEN), fillRow("g2", AT_TWO)] } as LeagueFillPlan;
    const schedule: Matchup[] = [
      // Moved to the 24th from the 17th, still at the start it had that day: the pool's replaces it.
      { id: "g1", date: "10/24", away: "A", home: "B", startTs: "2026-10-17T14:00:00Z" },
      // A start on its own day: kept, whatever the pool says.
      { id: "g2", date: "10/24", away: "B", home: "A", startTs: AT_TEN },
    ];
    inEachZone(ZONES, (zone) =>
      expect(startsFromFill(plan, schedule), zone).toEqual({ g1: AT_TEN })
    );
  });

  it("is kept on a game late in the league's evening, read past midnight further east", () => {
    // 6:30 PM in Chicago on the 24th is 1:30 AM on the 25th in Berlin, and later still in Sydney.
    // Read against the game's date alone, the start was another day's there, and Fill wrote the
    // pool's over it (15 minutes later, the same evening's), on every Fill.
    const plan = { rows: [fillRow("g1", "2026-10-24T23:45:00Z")] } as LeagueFillPlan;
    const schedule: Matchup[] = [
      { id: "g1", date: "10/24", away: "A", home: "B", startTs: "2026-10-24T23:30:00Z" },
    ];
    inEachZone(ZONES, (zone) => expect(startsFromFill(plan, schedule), zone).toEqual({}));
  });

  it("is given by Fill over a Friday night's start left on a game moved to the Saturday", () => {
    // 8 PM in Chicago on Friday the 23rd is 1 AM on Saturday the 24th in UTC. Read in the time of a
    // device where the league plays, it is the Friday's, and the pool's Saturday start replaces it.
    const saturday = "2026-10-24T15:00:00Z";
    const plan = { rows: [fillRow("g1", saturday)] } as LeagueFillPlan;
    const schedule: Matchup[] = [
      { id: "g1", date: "10/24", away: "A", home: "B", startTs: "2026-10-24T01:00:00Z" },
    ];
    inEachZone(["America/Los_Angeles", "America/Chicago", "America/New_York"], (zone) =>
      expect(startsFromFill(plan, schedule), zone).toEqual({ g1: saturday })
    );
  });

  it("is never written over by a pool start that does not read as a time", () => {
    // A morning start of its own day, the next day's in Sydney: nothing to put it against.
    const plan = { rows: [fillRow("g1", "soon")] } as LeagueFillPlan;
    const schedule: Matchup[] = [
      { id: "g1", date: "10/24", away: "A", home: "B", startTs: AT_TEN },
    ];
    inEachZone(ZONES, (zone) => expect(startsFromFill(plan, schedule), zone).toEqual({}));
  });

  it("comes with a game Fill adds", () => {
    const plan = {
      rows: [],
      missing: [
        {
          scoutGameId: "p9",
          date: "10/24",
          awayTeamId: "A",
          homeTeamId: "B",
          awayName: "Aces",
          homeName: "Bears",
          awayRuns: 4,
          homeRuns: 1,
          startTs: AT_TWO,
        },
      ],
    } as unknown as LeagueFillPlan;
    const added = missingGamesToAdd(plan, [], ["p9"], [], 6, (index) => `new_${index}`);
    expect(added.matchups[0]?.startTs).toBe(AT_TWO);
  });
});
