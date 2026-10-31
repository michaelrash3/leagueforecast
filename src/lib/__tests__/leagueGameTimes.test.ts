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

/*
 * A League game keeps the start GameChanger gave it: from a start's draft, from Fill, and through
 * storage, so the Schedule can list a day's games in the order they are played. Placeholder names.
 */
const AT_TEN = "2026-10-24T14:00:00Z";
const AT_TWO = "2026-10-24T18:00:00Z";

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
    const row = (matchupId: string, startTs?: string): LeagueFillRow =>
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
    const plan = { rows: [row("g1", AT_TEN), row("g2", AT_TWO), row("g3")] } as LeagueFillPlan;
    const schedule: Matchup[] = [
      { id: "g1", date: "10/24", away: "A", home: "B" },
      { id: "g2", date: "10/24", away: "B", home: "A", startTs: AT_TEN },
      { id: "g3", date: "10/24", away: "A", home: "B" },
    ];
    expect(startsFromFill(plan, schedule)).toEqual({ g1: AT_TEN });
  });

  it("is given by Fill over one that falls on another day than its game", () => {
    const row = (matchupId: string, startTs: string): LeagueFillRow =>
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
        startTs,
      }) as LeagueFillRow;
    const plan = { rows: [row("g1", AT_TEN), row("g2", AT_TWO)] } as LeagueFillPlan;
    const schedule: Matchup[] = [
      // Moved to the 24th from the 17th, still at the start it had that day: the pool's replaces it.
      { id: "g1", date: "10/24", away: "A", home: "B", startTs: "2026-10-17T14:00:00Z" },
      // A start on its own day: kept, whatever the pool says.
      { id: "g2", date: "10/24", away: "B", home: "A", startTs: AT_TEN },
    ];
    expect(startsFromFill(plan, schedule)).toEqual({ g1: AT_TEN });
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
