import { describe, expect, it } from "vitest";
import {
  applyLeagueScoreFill,
  defaultFillSelection,
  planLeagueScoreFill,
  summarizeLeagueFill,
  type LeagueScoreFillInput,
} from "../leagueScoreFill";
import { LEAGUE_GAME_PREFIX, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import type { GameLog, Matchup, TeamBase } from "../types";
import { blankLog } from "../util";

const SEASON = "fall2026";

const leagueTeams: TeamBase[] = [
  { id: "ACES", name: "Aces" },
  { id: "BEAR", name: "Bears" },
  { id: "CUBS", name: "Cubs" },
];

const scoutTeams: ScoutTeam[] = [
  // The pool keeps age labels out of names, and the league does not always; both sides go through
  // the same key, so "Aces 9U" here still means the league's "Aces".
  { id: "S-ACES", name: "Aces" },
  { id: "S-BEAR", name: "Bears" },
  { id: "S-CUBS", name: "Cubs" },
];

const ageGroups: AgeGroup[] = [
  { id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [SEASON] },
  { id: "ag2", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];

const matchup = (id: string, date: string, away: string, home: string): Matchup => ({
  id,
  date,
  away,
  home,
});

const scoutGame = (
  id: string,
  teamAId: string,
  teamBId: string,
  teamAScore: number | undefined,
  teamBScore: number | undefined,
  date: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  teamAId,
  teamBId,
  ageGroupId: "ag1",
  date,
  ...(teamAScore === undefined ? {} : { teamAScore }),
  ...(teamBScore === undefined ? {} : { teamBScore }),
  ...extra,
});

const input = (over: Partial<LeagueScoreFillInput> = {}): LeagueScoreFillInput => ({
  seasonId: SEASON,
  teams: leagueTeams,
  matchups: [matchup("g1", "5/1", "ACES", "BEAR")],
  logs: {},
  ageGroups,
  scoutTeams,
  scoutGames: [scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01")],
  ...over,
});

describe("planLeagueScoreFill", () => {
  it("fills a blank league game from a pool result", () => {
    const plan = planLeagueScoreFill(input());
    expect(plan.seasonLinked).toBe(true);
    expect(plan.rows).toHaveLength(1);
    const row = plan.rows[0]!;
    expect(row.action).toBe("fill");
    expect(row.awayRuns).toBe(7);
    expect(row.homeRuns).toBe(3);
    expect(plan.unmatched).toBe(0);
    expect(plan.unusedResults).toBe(0);
  });

  it("turns the sides around when the pool listed the home team first", () => {
    // The pool stores whichever team was pulled first, which has nothing to do with who was home.
    const plan = planLeagueScoreFill(
      input({ scoutGames: [scoutGame("s1", "S-BEAR", "S-ACES", 3, 7, "2026-05-01")] })
    );
    const row = plan.rows[0]!;
    expect(row.awayRuns).toBe(7);
    expect(row.homeRuns).toBe(3);
  });

  it("matches an ISO date against the league's month-and-day", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("g1", "8/22", "ACES", "BEAR")],
        scoutGames: [scoutGame("s1", "S-ACES", "S-BEAR", 12, 2, "2026-08-22")],
      })
    );
    expect(plan.rows[0]!.action).toBe("fill");
  });

  it("carries GameChanger's own ids through, so a row can be traced back", () => {
    const plan = planLeagueScoreFill(
      input({
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01", {
            source: { kind: "gamechanger", teamId: "gsUthn4XoIxS", gameId: "59cdce43" },
            event: "Bourbon Classic",
          }),
        ],
      })
    );
    const row = plan.rows[0]!;
    expect(row.gcTeamId).toBe("gsUthn4XoIxS");
    expect(row.gcGameId).toBe("59cdce43");
    expect(row.event).toBe("Bourbon Classic");
  });

  it("reports a disagreement instead of replacing a score already entered", () => {
    const logs: Record<string, GameLog> = {
      g1: { ...blankLog(), awayRuns: "5", homeRuns: "4", isFinal: true },
    };
    const plan = planLeagueScoreFill(input({ logs }));
    const row = plan.rows[0]!;
    expect(row.action).toBe("overwrite");
    expect(row.currentAwayRuns).toBe("5");
    expect(row.currentHomeRuns).toBe("4");
    expect(row.detail).toContain("marked final");
    // And it is not offered by default, because a typed score is somebody's own record.
    expect(defaultFillSelection(plan)).toEqual([]);
  });

  it("says nothing needs doing when the score already agrees", () => {
    const logs: Record<string, GameLog> = {
      g1: { ...blankLog(), awayRuns: "7", homeRuns: "3", isFinal: true },
    };
    const plan = planLeagueScoreFill(input({ logs }));
    expect(plan.rows[0]!.action).toBe("unchanged");
    expect(defaultFillSelection(plan)).toEqual([]);
  });

  it("flags a matching score that was never verified", () => {
    const logs: Record<string, GameLog> = {
      g1: { ...blankLog(), awayRuns: "7", homeRuns: "3" },
    };
    const plan = planLeagueScoreFill(input({ logs }));
    const row = plan.rows[0]!;
    expect(row.action).toBe("unchanged");
    expect(row.detail).toContain("not yet marked final");
  });

  it("pairs a doubleheader in order when both sides have two", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("g1", "5/1", "ACES", "BEAR"), matchup("g2", "5/1", "ACES", "BEAR")],
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-ACES", "S-BEAR", 2, 6, "2026-05-01"),
        ],
      })
    );
    expect(plan.rows.map((row) => row.action)).toEqual(["fill", "fill"]);
    expect(plan.rows.map((row) => [row.awayRuns, row.homeRuns])).toEqual([
      [7, 3],
      [2, 6],
    ]);
  });

  it("refuses to guess when a pairing's counts do not line up", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("g1", "5/1", "ACES", "BEAR"), matchup("g2", "5/1", "ACES", "BEAR")],
        scoutGames: [scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01")],
      })
    );
    expect(plan.rows.every((row) => row.action === "ambiguous")).toBe(true);
    expect(plan.rows[0]!.detail).toContain("only 1 result");
    expect(defaultFillSelection(plan)).toEqual([]);
  });

  it("offers a club the two halves spell differently, instead of saying nothing", () => {
    // What a GameChanger pull actually stores: the club's full GameChanger name. A league typed by
    // hand says "Trash Pandas". Left to an exact match this game silently reads as unplayed.
    const plan = planLeagueScoreFill(
      input({
        teams: [
          { id: "ACES", name: "Aces" },
          { id: "TP", name: "Trash Pandas" },
        ],
        matchups: [matchup("g1", "9/5", "ACES", "TP")],
        scoutTeams: [
          { id: "S-ACES", name: "Aces" },
          { id: "S-TP", name: "Trash Pandas Baseball Club" },
        ],
        scoutGames: [scoutGame("s1", "S-ACES", "S-TP", 13, 2, "2026-09-05")],
      })
    );
    const row = plan.rows[0]!;
    expect(row.action).toBe("suggested");
    expect(row.awayRuns).toBe(13);
    expect(row.homeRuns).toBe(2);
    expect(row.poolHomeName).toBe("Trash Pandas Baseball Club");
    expect(row.detail).toContain("Trash Pandas Baseball Club");
    // Offered, never applied unasked — the reader decides whether it is the same club.
    expect(defaultFillSelection(plan)).toEqual([]);
    expect(plan.unmatched).toBe(0);
  });

  it("fills a suggested row once it is chosen", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: [
          { id: "ACES", name: "Aces" },
          { id: "TP", name: "Trash Pandas" },
        ],
        matchups: [matchup("g1", "9/5", "ACES", "TP")],
        scoutTeams: [
          { id: "S-ACES", name: "Aces" },
          { id: "S-TP", name: "Trash Pandas Baseball Club" },
        ],
        scoutGames: [scoutGame("s1", "S-ACES", "S-TP", 13, 2, "2026-09-05")],
      })
    );
    const result = applyLeagueScoreFill(plan, ["g1"], {}, 6);
    expect(result.logs.g1!.awayRuns).toBe("13");
    expect(result.logs.g1!.homeRuns).toBe("2");
    expect(result.logs.g1!.isFinal).toBe(true);
  });

  it("keeps two genuinely different clubs apart", () => {
    // Four characters apart and two real teams. Nothing here may offer one as the other.
    const plan = planLeagueScoreFill(
      input({
        teams: [
          { id: "ACES", name: "Aces" },
          { id: "SLR", name: "South Lexington Red" },
        ],
        matchups: [matchup("g1", "9/5", "ACES", "SLR")],
        scoutTeams: [
          { id: "S-ACES", name: "Aces" },
          { id: "S-SLB", name: "South Lexington Blue" },
        ],
        scoutGames: [scoutGame("s1", "S-ACES", "S-SLB", 13, 2, "2026-09-05")],
      })
    );
    expect(plan.rows).toEqual([]);
    expect(plan.unmatched).toBe(1);
  });

  it("will not resolve a near name when two on the day could be it", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: [
          { id: "ACES", name: "Aces" },
          { id: "TP", name: "Trash Pandas" },
        ],
        matchups: [matchup("g1", "9/5", "ACES", "TP")],
        scoutTeams: [
          { id: "S-ACES", name: "Aces" },
          { id: "S-TP1", name: "Trash Pandas Baseball Club" },
          { id: "S-TP2", name: "Trash Pandas Select" },
        ],
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-TP1", 13, 2, "2026-09-05"),
          scoutGame("s2", "S-ACES", "S-TP2", 4, 5, "2026-09-05"),
        ],
      })
    );
    expect(plan.rows[0]!.action).toBe("ambiguous");
    expect(plan.rows[0]!.detail).toContain("could be this game");
  });

  it("leaves a close name on another day alone, since that is a game outside league play", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: [
          { id: "ACES", name: "Aces" },
          { id: "TP", name: "Trash Pandas" },
        ],
        matchups: [matchup("g1", "9/5", "ACES", "TP")],
        scoutTeams: [
          { id: "S-ACES", name: "Aces" },
          { id: "S-TP", name: "Trash Pandas Baseball Club" },
        ],
        // A tournament meeting three weeks earlier is not this league game.
        scoutGames: [scoutGame("s1", "S-ACES", "S-TP", 13, 2, "2026-08-15")],
      })
    );
    expect(plan.rows).toEqual([]);
    expect(plan.unmatched).toBe(1);
    expect(plan.unusedResults).toBe(1);
  });

  it("never feeds the league its own games back", () => {
    // The pool carries the league's schedule already; those rows must not become evidence here.
    const plan = planLeagueScoreFill(
      input({
        scoutGames: [
          scoutGame(`${LEAGUE_GAME_PREFIX}${SEASON}_g1`, "S-ACES", "S-BEAR", 9, 9, "2026-05-01"),
        ],
      })
    );
    expect(plan.rows).toEqual([]);
    expect(plan.unmatched).toBe(1);
  });

  it("ignores results filed under an age group that does not claim this season", () => {
    const plan = planLeagueScoreFill(
      input({
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01", { ageGroupId: "ag2" }),
        ],
      })
    );
    expect(plan.rows).toEqual([]);
    expect(plan.unmatched).toBe(1);
  });

  it("says when no age group claims the season at all", () => {
    const plan = planLeagueScoreFill(
      input({ ageGroups: [{ id: "ag1", name: "9U 2027", seasonIds: [] }] })
    );
    expect(plan.seasonLinked).toBe(false);
    expect(plan.rows).toEqual([]);
  });

  it("leaves a scheduled pool game alone and counts the league game as unmatched", () => {
    const plan = planLeagueScoreFill(
      input({
        scoutGames: [scoutGame("s1", "S-ACES", "S-BEAR", undefined, undefined, "2026-05-01")],
      })
    );
    expect(plan.rows).toEqual([]);
    expect(plan.unmatched).toBe(1);
  });

  it("counts pool results no league game claimed", () => {
    const plan = planLeagueScoreFill(
      input({
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          // A tournament game against a team the league never plays.
          scoutGame("s2", "S-ACES", "S-CUBS", 4, 1, "2026-06-14"),
        ],
      })
    );
    expect(plan.unusedResults).toBe(1);
  });

  it("keeps the review in schedule order", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("g1", "5/3", "ACES", "BEAR"), matchup("g2", "5/1", "BEAR", "CUBS")],
        scoutGames: [
          scoutGame("s2", "S-BEAR", "S-CUBS", 1, 0, "2026-05-01"),
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-03"),
        ],
      })
    );
    expect(plan.rows.map((row) => row.matchupId)).toEqual(["g1", "g2"]);
  });

  it("skips a game with no date on either side, since the day is what ties them together", () => {
    expect(
      planLeagueScoreFill(input({ matchups: [matchup("g1", "", "ACES", "BEAR")] })).rows
    ).toEqual([]);
    expect(
      planLeagueScoreFill(input({ scoutGames: [scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "")] }))
        .rows
    ).toEqual([]);
  });
});

describe("applyLeagueScoreFill", () => {
  it("writes runs and marks the game final, leaving everything else as it was", () => {
    const logs: Record<string, GameLog> = {
      // Hits were typed by hand for this game; filling the score must not throw them away.
      g1: { ...blankLog("7"), awayHits: "8", homeHits: "5" },
    };
    const plan = planLeagueScoreFill(input({ logs }));
    const result = applyLeagueScoreFill(plan, defaultFillSelection(plan), logs, 6);
    const written = result.logs.g1!;
    expect(written.awayRuns).toBe("7");
    expect(written.homeRuns).toBe("3");
    expect(written.isFinal).toBe(true);
    expect(written.awayHits).toBe("8");
    expect(written.homeHits).toBe("5");
    expect(written.innings).toBe("7");
    expect(result.filled).toBe(1);
  });

  it("creates a log for a game that never had one, at the season's innings", () => {
    const plan = planLeagueScoreFill(input());
    const result = applyLeagueScoreFill(plan, defaultFillSelection(plan), {}, 5);
    expect(result.logs.g1!.innings).toBe("5");
    expect(result.logs.g1!.awayRuns).toBe("7");
  });

  it("does not touch the logs it was not asked about", () => {
    const logs: Record<string, GameLog> = { g1: blankLog() };
    const plan = planLeagueScoreFill(input({ logs }));
    const result = applyLeagueScoreFill(plan, [], logs, 6);
    expect(result.filled).toBe(0);
    expect(result.logs).toEqual(logs);
    // The original map is never mutated, so an undo can hold on to it.
    expect(result.logs).not.toBe(logs);
  });

  it("overwrites only when that row is asked for by name", () => {
    const logs: Record<string, GameLog> = {
      g1: { ...blankLog(), awayRuns: "5", homeRuns: "4", isFinal: true },
    };
    const plan = planLeagueScoreFill(input({ logs }));
    const result = applyLeagueScoreFill(plan, ["g1"], logs, 6);
    expect(result.logs.g1!.awayRuns).toBe("7");
    expect(result.filled).toBe(1);
  });

  it("writes nothing for an ambiguous row even if it is selected", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("g1", "5/1", "ACES", "BEAR"), matchup("g2", "5/1", "ACES", "BEAR")],
        scoutGames: [scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01")],
      })
    );
    const result = applyLeagueScoreFill(plan, ["g1", "g2"], {}, 6);
    expect(result.filled).toBe(0);
    expect(result.logs).toEqual({});
  });
});

describe("summarizeLeagueFill", () => {
  it("names what was written and what was left", () => {
    const logs: Record<string, GameLog> = {
      g2: { ...blankLog(), awayRuns: "5", homeRuns: "4", isFinal: true },
    };
    const plan = planLeagueScoreFill(
      input({
        matchups: [
          matchup("g1", "5/1", "ACES", "BEAR"),
          matchup("g2", "5/2", "BEAR", "CUBS"),
          matchup("g3", "5/3", "ACES", "CUBS"),
        ],
        logs,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-BEAR", "S-CUBS", 1, 0, "2026-05-02"),
        ],
      })
    );
    expect(summarizeLeagueFill(plan, 1)).toBe(
      "Filled 1 game · 1 left as entered · 1 with no result yet."
    );
  });
});
