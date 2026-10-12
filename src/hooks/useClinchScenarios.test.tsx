import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useClinchScenarios, type ScenarioImpact } from "./useClinchScenarios";
import {
  calculateTeams,
  getMathGoldStatus,
  getRemainingCounts,
  rankOptionsFromSettings,
  rankTeams,
} from "../lib/sim";
import { blankLog } from "../lib/util";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type TeamWithProjection,
} from "../lib/types";

/**
 * A four-team round robin, four games played and two left, built so every answer is checkable by
 * hand rather than by running the code and writing down what came out.
 *
 *   A beat C, A beat D  →  A 4 points, two wins
 *   C beat B, D beat B  →  C 2, D 2, B 0
 *   left to play: A v B, and C v D
 *
 * With two points a win and a cut line at two of four:
 *
 *   A wins its last game → 6 points, while B can reach 0, C 4 and D 4. Nobody can catch it, so
 *   that game is a title clinch, and it takes precedence over everything else a game can be.
 *   B loses it → 0 points and no games left, below C and D whatever they do, so B is out.
 *   C beats D → 4 points, and B and D can no longer pass it, so C clinches a place in a game A
 *   is not playing in. That is the one a naive reading misses: a result can clinch for somebody
 *   who is not on the field.
 */
const SETTINGS = { ...DEFAULT_SETTINGS, goldCutoff: 2, postseasonFormat: "cut" as const };
const CUTOFF = 2;

const bases = ["A", "B", "C", "D"].map((id) => ({ id, name: `Team ${id}` }));

const game = (id: string, away: string, home: string, date: string): Matchup => ({
  id,
  date,
  away,
  home,
});

const played = (awayRuns: string, homeRuns: string): GameLog => ({
  ...blankLog(),
  awayRuns,
  homeRuns,
  isFinal: true,
});

const ALL_GAMES: Matchup[] = [
  game("a-c", "A", "C", "5/1"),
  game("a-d", "A", "D", "5/2"),
  game("c-b", "C", "B", "5/3"),
  game("d-b", "D", "B", "5/4"),
  game("a-b", "A", "B", "6/1"),
  game("c-d", "C", "D", "6/2"),
];

const LOGS: Record<string, GameLog> = {
  "a-c": played("6", "2"),
  "a-d": played("6", "2"),
  "c-b": played("6", "2"),
  "d-b": played("6", "2"),
};

const REMAINING = ALL_GAMES.filter((entry) => !LOGS[entry.id]);

/** The standings as App builds them: ranked, with the clinching status attached to each row. */
const dashboard = () => {
  const ranked = rankTeams(
    calculateTeams(bases, ALL_GAMES, LOGS, SETTINGS),
    rankOptionsFromSettings(SETTINGS)
  );
  const counts = getRemainingCounts(ranked, REMAINING);
  const rows = ranked.map((team, index) => {
    const math = getMathGoldStatus(team, ranked, counts, CUTOFF, SETTINGS);
    return {
      ...team,
      rank: index + 1,
      projectedRank: index + 1,
      projectedRecord: "",
      projectedRunDiff: 0,
      goldPct: 50,
      goldTrend: [],
      goldStatus: math.goldStatus,
      maxPoints: math.maxPoints,
      blockersAhead: math.blockersAhead,
      maxPct: math.maxPct,
      minPct: math.minPct,
    } as TeamWithProjection;
  });
  return { ranked, rows, byId: new Map(rows.map((row) => [row.id, row])) };
};

const NO_IMPACT = new Map<string, ScenarioImpact>();

const setup = (over: { hasCutLine?: boolean; impact?: Map<string, ScenarioImpact> } = {}) => {
  const { ranked, byId } = dashboard();
  // Hoisted, all of it: a fresh object or Map built inside the callback would change identity on
  // every render, which is the very thing the last test here is about.
  const impact = over.impact ?? NO_IMPACT;
  const hasCutLine = over.hasCutLine ?? true;
  return renderHook(() =>
    useClinchScenarios({
      liveTeams: ranked,
      settings: SETTINGS,
      remainingGames: REMAINING,
      goldCutoff: CUTOFF,
      hasCutLine,
      dashboardById: byId,
      scenarioImpact: impact,
    })
  );
};

/**
 * The same four teams before anybody has played, where nothing is clinched and nothing is over.
 *
 * Needed because in the season above every remaining game clinches something for somebody — with
 * four teams and a cut line at two, one result settles most of it — so there is no quiet game left
 * to ask what a game is worth when it is worth nothing in particular.
 */
const earlySetup = (over: { hasCutLine?: boolean; impact?: Map<string, ScenarioImpact> } = {}) => {
  const ranked = rankTeams(
    calculateTeams(bases, ALL_GAMES, {}, SETTINGS),
    rankOptionsFromSettings(SETTINGS)
  );
  const counts = getRemainingCounts(ranked, ALL_GAMES);
  const byId = new Map(
    ranked.map((team, index) => {
      const math = getMathGoldStatus(team, ranked, counts, CUTOFF, SETTINGS);
      return [
        team.id,
        {
          ...team,
          rank: index + 1,
          projectedRank: index + 1,
          projectedRecord: "",
          projectedRunDiff: 0,
          goldPct: 50,
          goldTrend: [],
          goldStatus: math.goldStatus,
          maxPoints: math.maxPoints,
          blockersAhead: math.blockersAhead,
          maxPct: math.maxPct,
          minPct: math.minPct,
        } as TeamWithProjection,
      ];
    })
  );
  const impact = over.impact ?? NO_IMPACT;
  const hasCutLine = over.hasCutLine ?? true;
  return renderHook(() =>
    useClinchScenarios({
      liveTeams: ranked,
      settings: SETTINGS,
      remainingGames: ALL_GAMES,
      goldCutoff: CUTOFF,
      hasCutLine,
      dashboardById: byId,
      scenarioImpact: impact,
    })
  );
};

const statusOf = (result: ReturnType<typeof setup>["result"], id: "a-b" | "c-d"): string =>
  result.current.gameStatusForGame(ALL_GAMES.find((entry) => entry.id === id)!);

describe("what one more result would do", () => {
  it("calls the game that settles the title a title clinch, ahead of anything else", () => {
    const { result } = setup();

    // A also clinches a place and B also goes out in this game; the title is the bigger claim.
    expect(statusOf(result, "a-b")).toBe("Title Clinch-Team A");
  });

  it("names a team clinched by a game it is not playing in", () => {
    const { result } = setup();

    /*
     * Team A is the point. It is not playing in C v D, and it has not clinched yet — but once
     * that game is decided, one of C and D is stuck on two, and A on four with a game in hand
     * can no longer be caught by both. A reading that only asked about the two sides on the field
     * would name C and D and miss the team the result actually settles.
     */
    expect(statusOf(result, "c-d")).toContain("Clinch Scenario");
    expect(statusOf(result, "c-d")).toContain("Team A");
  });

  it("falls back to the seed impact when nothing is clinched or ended", () => {
    const quiet = new Map<string, ScenarioImpact>([["c-d", { seedImpact: 2 }]]);
    const { result } = earlySetup({ impact: quiet, hasCutLine: false });

    // No cut line, so no bubble; the impact number is all that is left to say.
    expect(statusOf(result, "c-d")).toBe("High Impact");
  });

  it("says a game is near the cut line only when there is a cut line to be near", () => {
    const withLine = earlySetup({ impact: new Map([["c-d", { seedImpact: 1 }]]) });
    const withoutLine = earlySetup({
      impact: new Map([["c-d", { seedImpact: 1 }]]),
      hasCutLine: false,
    });

    /*
     * The bug this whole area produced once: switching a league's postseason format flipped
     * `hasCutLine` without moving anything a memo watched, so "Bubble Game" stayed on games that
     * no longer had a line to be near. Here the two readings are taken side by side.
     */
    expect(statusOf(withLine.result, "c-d")).toBe("Bubble Game");
    expect(statusOf(withoutLine.result, "c-d")).toBe("Seeding Game");
  });

  it("says a game is worth nothing when it is worth nothing", () => {
    const { result } = earlySetup({ hasCutLine: false });

    expect(statusOf(result, "c-d")).toBe("Low Impact");
  });

  it("hands back the same function until something it reads changes", () => {
    const { result, rerender } = setup();
    const first = result.current.gameStatusForGame;

    rerender();

    // It is read inside memos, so a new identity on every render would rebuild all of them — and
    // is what forced the hand-kept dependency lists this replaced.
    expect(result.current.gameStatusForGame).toBe(first);
  });
});
