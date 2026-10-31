import { describe, expect, it } from "vitest";
import {
  applyLeagueScoreFill,
  defaultFillSelection,
  missingGamesToAdd,
  movedGames,
  movesToApply,
  planLeagueScoreFill,
  startsFromFill,
  summarizeLeagueFill,
  type LeagueFillPlan,
  type LeagueScoreFillInput,
} from "../leagueScoreFill";
import {
  cleanTeamName,
  LEAGUE_GAME_PREFIX,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
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

  /*
   * GameChanger's ids for one day's two games say nothing of which was played first, and the
   * schedule's two games are in its own order, the first one first: the results go in by when each
   * started, where the pull knows it.
   */
  it("pairs a doubleheader by start time, not by GameChanger's ids", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("g1", "5/1", "ACES", "BEAR"), matchup("g2", "5/1", "ACES", "BEAR")],
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01", {
            startTs: "2026-05-01T22:00:00.000Z",
          }),
          scoutGame("s2", "S-ACES", "S-BEAR", 2, 6, "2026-05-01", {
            startTs: "2026-05-01T19:00:00.000Z",
          }),
        ],
      })
    );
    expect(plan.rows.map((row) => [row.matchupId, row.awayRuns, row.homeRuns])).toEqual([
      ["g1", 2, 6],
      ["g2", 7, 3],
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

  /*
   * Two league teams of one name to the pool, told apart only by an aside or an age: the pool
   * cleans both off ("Heat 9U (Coach A)" is stored as "Heat"), so either team matches either club,
   * and the side was taken as the pool listed it, which is the pulled club first and nothing to do
   * with who was at home. Placeholder names. The away team lost 3-8 in every case below.
   */
  describe("two teams one name apart", () => {
    const listing = (id: string, listed: string): ScoutTeam => ({
      id,
      name: cleanTeamName(listed),
      gcTeams: [{ teamId: `gc-${id}`, name: listed, ageGroupId: "ag1" }],
    });
    const heatClubs = [listing("P-A", "Heat 9U (Coach A)"), listing("P-B", "Heat 9U (Coach B)")];
    const heat = (link: boolean): TeamBase[] => [
      { id: "HA", name: "Heat (Coach A)", ...(link ? { scoutTeamId: "P-A" } : {}) },
      { id: "HB", name: "Heat (Coach B)", ...(link ? { scoutTeamId: "P-B" } : {}) },
    ];
    // Coach A's team at Coach B's; the pool lists Coach B's club first, as its pull's.
    const heatGame = (over: Partial<LeagueScoreFillInput> = {}) =>
      planLeagueScoreFill(
        input({
          teams: heat(true),
          matchups: [matchup("g1", "9/12", "HA", "HB")],
          scoutTeams: heatClubs,
          scoutGames: [scoutGame("s1", "P-B", "P-A", 8, 3, "2026-09-12")],
          ...over,
        })
      );
    const runs = (plan: LeagueFillPlan) =>
      plan.rows.map((row) => [row.action, row.awayRuns, row.homeRuns]);

    it("puts the score the right way round where both teams are linked to their clubs", () => {
      expect(heatClubs.map((club) => club.name)).toEqual(["Heat", "Heat"]);
      expect(runs(heatGame())).toEqual([["fill", 3, 8]]);
      expect(defaultFillSelection(heatGame())).toEqual(["g1"]);
      // Listed the other way, as before.
      const listedFirst = heatGame({
        scoutGames: [scoutGame("s1", "P-A", "P-B", 3, 8, "2026-09-12")],
      });
      expect(runs(listedFirst)).toEqual([["fill", 3, 8]]);
    });

    it("tells the clubs apart by their GameChanger names where neither team is linked", () => {
      expect(runs(heatGame({ teams: heat(false) }))).toEqual([["fill", 3, 8]]);
      expect(
        runs(
          heatGame({
            teams: heat(false),
            scoutGames: [scoutGame("s1", "P-A", "P-B", 3, 8, "2026-09-12")],
          })
        )
      ).toEqual([["fill", 3, 8]]);
    });

    it("tells two ages apart, linked or by their GameChanger names", () => {
      const wolvesClubs = [listing("W9", "Wolves 9U"), listing("W10", "Wolves 10U")];
      const wolves = (link: boolean): TeamBase[] => [
        { id: "W9T", name: "Wolves 9U", ...(link ? { scoutTeamId: "W9" } : {}) },
        { id: "W10T", name: "Wolves 10U", ...(link ? { scoutTeamId: "W10" } : {}) },
      ];
      // The 9U at the 10U, which won 8-3; the pool lists the 10U first.
      const wolvesGame = (link: boolean) =>
        planLeagueScoreFill(
          input({
            teams: wolves(link),
            matchups: [matchup("g1", "9/12", "W9T", "W10T")],
            scoutTeams: wolvesClubs,
            scoutGames: [scoutGame("s1", "W10", "W9", 8, 3, "2026-09-12")],
          })
        );
      expect(runs(wolvesGame(true))).toEqual([["fill", 3, 8]]);
      expect(runs(wolvesGame(false))).toEqual([["fill", 3, 8]]);
    });

    it("says it cannot tell when nothing tells the two clubs apart, and fills nothing", () => {
      // Two clubs known by the name alone: either way round fits as well as the other.
      const bare: ScoutTeam[] = [
        { id: "P-A", name: "Heat" },
        { id: "P-B", name: "Heat" },
      ];
      const plan = heatGame({ teams: heat(false), scoutTeams: bare });
      expect(plan.rows).toMatchObject([
        { matchupId: "g1", action: "ambiguous", awayRuns: 0, homeRuns: 0 },
      ]);
      expect(plan.rows[0]!.detail).toContain("either way round");
      expect(defaultFillSelection(plan)).toEqual([]);
      expect(applyLeagueScoreFill(plan, ["g1"], {}, 6).filled).toBe(0);
      // The result is this game's, the way round aside, so it is not counted as unused.
      expect(plan.unusedResults).toBe(0);
      expect(plan.unmatched).toBe(0);
    });

    /*
     * What the Can't tell row promises: link the teams to their clubs in Settings and it fills. A
     * side linked counts for more than both names alike, so the links settle what names cannot,
     * even one link alone; no other case here would notice a link that counted for no more.
     */
    it("fills the way round the Settings links say where nothing else tells the clubs apart", () => {
      const bare: ScoutTeam[] = [
        { id: "P-A", name: "Heat" },
        { id: "P-B", name: "Heat" },
      ];
      const plan = heatGame({ scoutTeams: bare });
      expect(runs(plan)).toEqual([["fill", 3, 8]]);
      expect(defaultFillSelection(plan)).toEqual(["g1"]);
      const listedFirst = heatGame({
        scoutTeams: bare,
        scoutGames: [scoutGame("s1", "P-A", "P-B", 3, 8, "2026-09-12")],
      });
      expect(runs(listedFirst)).toEqual([["fill", 3, 8]]);
      // Coach A's team alone linked: one link still outweighs two names alike.
      const oneLinked = heatGame({
        teams: [
          { id: "HA", name: "Heat (Coach A)", scoutTeamId: "P-A" },
          { id: "HB", name: "Heat (Coach B)" },
        ],
        scoutTeams: bare,
      });
      expect(runs(oneLinked)).toEqual([["fill", 3, 8]]);
    });

    /*
     * The result fits the game either way round, so the game is the pool's game whichever it is:
     * when it started is known, and where the league already has the score one way round, that is
     * the way, with nothing to do. Can't tell lost both, the start never reaching the schedule.
     */
    it("keeps what an either-way result settles: its start, and a score already recorded", () => {
      const bare: ScoutTeam[] = [
        { id: "P-A", name: "Heat" },
        { id: "P-B", name: "Heat" },
      ];
      const START = "2026-09-12T15:00:00Z";
      const timed = [
        scoutGame("s1", "P-B", "P-A", 8, 3, "2026-09-12", {
          startTs: START,
          event: "Placeholder Fall League",
        }),
      ];
      const game = (over: Partial<LeagueScoreFillInput>) =>
        heatGame({ teams: heat(false), scoutTeams: bare, scoutGames: timed, ...over });
      const blank = game({});
      expect(blank.rows).toMatchObject([
        {
          action: "ambiguous",
          scoutGameId: "s1",
          startTs: START,
          event: "Placeholder Fall League",
        },
      ]);
      expect(startsFromFill(blank, [matchup("g1", "9/12", "HA", "HB")])).toEqual({ g1: START });
      // Recorded either way round, it is the league's own score: nothing to fill.
      const final = (away: string, home: string) => ({
        g1: { ...blankLog("6"), awayRuns: away, homeRuns: home, isFinal: true },
      });
      expect(runs(game({ logs: final("3", "8") }))).toEqual([["unchanged", 3, 8]]);
      expect(runs(game({ logs: final("8", "3") }))).toEqual([["unchanged", 8, 3]]);
      // A score that is neither way round is still nothing to write over, and says so.
      const other = game({ logs: final("5", "2") });
      expect(runs(other)).toEqual([["ambiguous", 0, 0]]);
      expect(other.rows[0]!.detail).toContain("Already recorded as 5–2 and marked final");
      expect(other.rows[0]!.detail).not.toContain("it fills");
    });

    it("takes the way round both names fit over one that fits them only loosely", () => {
      // Comets at Comets Elite, which won 8-3 and is listed first: as listed, each name is only
      // close to the other club's; turned round, both are exact.
      const plan = planLeagueScoreFill(
        input({
          teams: [
            { id: "CO", name: "Comets" },
            { id: "CE", name: "Comets Elite" },
          ],
          matchups: [matchup("g1", "9/12", "CO", "CE")],
          scoutTeams: [
            { id: "S-CE", name: "Comets Elite" },
            { id: "S-CO", name: "Comets" },
          ],
          scoutGames: [scoutGame("s1", "S-CE", "S-CO", 8, 3, "2026-09-12")],
        })
      );
      expect(runs(plan)).toEqual([["fill", 3, 8]]);
    });
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

  it("fills no game whose score has changed since the plan was made", () => {
    // Three games with nothing recorded when the plan was asked for, each offered as a fill.
    const seen: Record<string, GameLog> = {};
    const plan = planLeagueScoreFill(
      input({
        matchups: [
          matchup("g1", "5/1", "ACES", "BEAR"),
          matchup("g2", "5/2", "BEAR", "CUBS"),
          matchup("g3", "5/3", "ACES", "CUBS"),
        ],
        logs: seen,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-BEAR", "S-CUBS", 1, 0, "2026-05-02"),
          scoutGame("s3", "S-ACES", "S-CUBS", 4, 2, "2026-05-03"),
        ],
      })
    );
    expect(defaultFillSelection(plan)).toEqual(["g1", "g2", "g3"]);
    /*
     * Meanwhile, before the server's answer came or with the panel open: g1 typed in by hand, g2
     * marked final with its boxes still empty, g3 given hits and nothing that the plan reads.
     */
    const now: Record<string, GameLog> = {
      g1: { ...blankLog(), awayRuns: "3", homeRuns: "1" },
      g2: { ...blankLog(), isFinal: true },
      g3: { ...blankLog(), awayHits: "6" },
    };
    const result = applyLeagueScoreFill(plan, defaultFillSelection(plan), now, 6, [], seen);
    expect(result.logs.g1).toEqual(now.g1);
    expect(result.logs.g2).toEqual(now.g2);
    expect(result.logs.g3).toMatchObject({ awayRuns: "4", homeRuns: "2", awayHits: "6" });
    expect(result).toMatchObject({ filled: 1, changed: 2 });
    expect(summarizeLeagueFill(plan, result.filled, result.changed)).toBe(
      "Filled 1 game · 2 changed here since, left as they are."
    );
    // As the plan saw them, every one is filled; and a log taken away is one changed too.
    expect(applyLeagueScoreFill(plan, ["g1", "g2", "g3"], seen, 6, [], seen).filled).toBe(3);
    const finalSeen = { g1: { ...blankLog(), isFinal: true } };
    expect(applyLeagueScoreFill(plan, ["g1"], {}, 6, [], finalSeen)).toMatchObject({
      filled: 0,
      changed: 1,
    });
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

/**
 * The pool carries rows with a score on a day still to come — a schedule opened ahead, or a club
 * that exists only on paper. Offering one here is the worst place it lands: it goes into the
 * league's own book, selected by default, marked final, and the standings and the forecast take
 * it from there. A 17-0 dated eight months out did exactly that.
 */
describe("a pool result on a day that has not happened", () => {
  const AHEAD = "2027-06-01";
  const TODAY = "2026-09-20";

  it("is not offered to fill anything", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("m1", "6/1", "ACES", "BEAR")],
        logs: { m1: blankLog("6") },
        scoutGames: [scoutGame("ahead", "S-ACES", "S-BEAR", 17, 0, AHEAD)],
        today: TODAY,
      })
    );

    expect(plan.rows.filter((row) => row.action === "fill")).toHaveLength(0);
    expect(defaultFillSelection(plan)).toEqual([]);
  });

  it("is offered once its day has been and gone", () => {
    // The same row, read a year later: now it is a game that happened.
    const plan = planLeagueScoreFill(
      input({
        matchups: [matchup("m1", "6/1", "ACES", "BEAR")],
        logs: { m1: blankLog("6") },
        scoutGames: [scoutGame("ahead", "S-ACES", "S-BEAR", 17, 0, AHEAD)],
        today: "2027-09-20",
      })
    );

    expect(plan.rows.filter((row) => row.action === "fill")).toHaveLength(1);
  });
});

describe("games between the league's clubs that the schedule does not have", () => {
  // Every team linked to its club, as a season started from Team Rankings is (3.7).
  const linked = leagueTeams.map((team) => ({ ...team, scoutTeamId: `S-${team.id}` }));

  it("are offered with their score, unless the schedule has the two meet that day", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: linked,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-CUBS", "S-ACES", 4, 2, "2026-05-08"),
          // Against a club no league team is, or still to play: not the league's to add.
          scoutGame("s3", "S-CUBS", "S-OTHER", 9, 0, "2026-05-08"),
          scoutGame("s4", "S-BEAR", "S-CUBS", undefined, undefined, "2026-05-15"),
        ],
      })
    );
    expect(plan.rows.map((row) => row.matchupId)).toEqual(["g1"]);
    expect(plan.missing).toEqual([
      {
        scoutGameId: "s2",
        date: "5/8",
        awayTeamId: "CUBS",
        homeTeamId: "ACES",
        awayName: "Cubs",
        homeName: "Aces",
        awayRuns: 4,
        homeRuns: 2,
        tournament: "One of the two played somebody else that day, so it was likely a tournament.",
      },
    ]);
  });

  /*
   * A playoff round played one game a day passes the tournament checks, and arrived ticked as a
   * game the schedule was missing; added, it changed the standings that seeded the bracket. A game
   * after the schedule's last day is offered unticked, said to be a likely playoff game.
   */
  it("are offered unticked after the schedule's last day, as likely playoff games", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: linked,
        matchups: [matchup("g1", "5/1", "ACES", "BEAR"), matchup("g2", "5/15", "BEAR", "CUBS")],
        scoutGames: [
          // Before the last day, and no tournament: the league's own, missing from the schedule.
          scoutGame("s1", "S-ACES", "S-CUBS", 5, 4, "2026-05-08"),
          // After it: a playoff round.
          scoutGame("s2", "S-ACES", "S-BEAR", 6, 1, "2026-05-22"),
        ],
      })
    );
    expect(plan.missing?.map((game) => [game.scoutGameId, game.tournament])).toEqual([
      ["s1", undefined],
      ["s2", "Played after the last game on the schedule, so it was likely a playoff game."],
    ]);
  });

  it("leave out a game the schedule already has that day, matched or not, and one unlinked", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: linked,
        matchups: [matchup("g1", "5/1", "ACES", "BEAR"), matchup("g2", "5/1", "BEAR", "ACES")],
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-BEAR", "S-ACES", 1, 0, "2026-05-01"),
        ],
      })
    );
    expect(plan.missing).toEqual([]);
    expect(planLeagueScoreFill(input()).missing).toEqual([]);
    // The second game of a doubleheader the league scheduled once: no game took it, and it is
    // still not offered, the two meeting on the schedule that day already.
    const twice = planLeagueScoreFill(
      input({
        teams: linked,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-ACES", "S-BEAR", 2, 4, "2026-05-01"),
        ],
      })
    );
    expect(twice.unusedResults).toBeGreaterThan(0);
    expect(twice.missing).toEqual([]);
  });

  it("go on the schedule as the review left them: final, turned round where swapped", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: linked,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-05-01"),
          scoutGame("s2", "S-CUBS", "S-ACES", 4, 2, "2026-05-08"),
          scoutGame("s3", "S-BEAR", "S-CUBS", 6, 5, "2026-05-15"),
        ],
      })
    );
    const added = missingGamesToAdd(plan, [], ["s2", "s3"], ["s3"], 6, (at) => `new-${at}`);
    expect(added.matchups).toEqual([
      { id: "new-0", date: "5/8", away: "CUBS", home: "ACES" },
      { id: "new-1", date: "5/15", away: "CUBS", home: "BEAR" },
    ]);
    expect(added.logs["new-0"]).toMatchObject({ awayRuns: "4", homeRuns: "2", isFinal: true });
    expect(added.logs["new-1"]).toMatchObject({
      awayRuns: "5",
      homeRuns: "6",
      innings: "6",
      isFinal: true,
    });
    expect(missingGamesToAdd(plan, [], [], [], 6, (at) => `new-${at}`).matchups).toEqual([]);
  });

  it("are not added where the schedule has gained the game since the review was made", () => {
    const plan = planLeagueScoreFill(
      input({
        teams: linked,
        scoutGames: [
          scoutGame("s2", "S-CUBS", "S-ACES", 4, 2, "2026-05-08"),
          scoutGame("s3", "S-BEAR", "S-CUBS", 6, 5, "2026-05-15"),
        ],
      })
    );
    expect(plan.missing?.map((game) => game.scoutGameId)).toEqual(["s2", "s3"]);
    // Typed in by hand while the review was open, the other way round.
    const since = [matchup("hand", "5/8", "ACES", "CUBS")];
    const added = missingGamesToAdd(plan, since, ["s2", "s3"], [], 6, (at) => `new-${at}`);
    expect(added.matchups).toEqual([{ id: "new-0", date: "5/15", away: "BEAR", home: "CUBS" }]);
    expect(Object.keys(added.logs)).toEqual(["new-0"]);
  });

  it("are offered to neither team where two are linked to the same club", () => {
    const games = [scoutGame("s4", "S-BEAR", "S-ACES", 6, 5, "2026-05-22")];
    const offered = planLeagueScoreFill(input({ teams: linked, scoutGames: games }));
    expect(offered.missing?.map((game) => game.scoutGameId)).toEqual(["s4"]);
    // The Cubs linked to the Aces' club as well: a clash, which neither link stands for.
    const clash = linked.map((team) =>
      team.id === "CUBS" ? { ...team, scoutTeamId: "S-ACES" } : team
    );
    expect(planLeagueScoreFill(input({ teams: clash, scoutGames: games })).missing).toEqual([]);
  });
});

describe("games the schedule has, played on another day", () => {
  // The Aces at the Bears was rained out on 9/20 and played on 9/27, the Bears' club at home.
  const played = {
    scoutGameId: "s9",
    date: "9/27",
    awayTeamId: "BEAR",
    homeTeamId: "ACES",
    awayName: "Bears",
    homeName: "Aces",
    awayRuns: 2,
    homeRuns: 6,
  };
  const plan: LeagueFillPlan = {
    rows: [],
    missing: [played],
    unmatched: 0,
    unusedResults: 0,
    seasonLinked: true,
  };
  const schedule = [matchup("g1", "9/20", "ACES", "BEAR"), matchup("g2", "9/21", "BEAR", "CUBS")];

  it("pairs a played game with the one unscored, earlier game between the two teams", () => {
    expect(movedGames(plan, schedule, {}, [])).toEqual([
      { scoutGameId: "s9", matchupId: "g1", from: "9/20", to: "9/27" },
    ]);
  });

  it("pairs nothing where the earlier game is scored, or where two could be it", () => {
    expect(movedGames(plan, schedule, { g1: { awayRuns: "3", homeRuns: "1" } }, [])).toEqual([]);
    const twice = [...schedule, matchup("g3", "9/13", "BEAR", "ACES")];
    expect(movedGames(plan, twice, {}, [])).toEqual([]);
  });

  it("pairs nothing with a game the pool has its own result for on its day", () => {
    // The 9/20 game was played on its day after all: the pool's 7-3 fills it, so the 2-6 on 9/27
    // is another meeting, and moving the 9/20 game there would put the 2-6 over the 7-3.
    const linked = leagueTeams.map((team) => ({ ...team, scoutTeamId: `S-${team.id}` }));
    const both = planLeagueScoreFill(
      input({
        teams: linked,
        matchups: schedule,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-09-20"),
          scoutGame("s2", "S-ACES", "S-BEAR", 2, 6, "2026-09-27"),
        ],
        today: "2026-10-25",
      })
    );
    expect(defaultFillSelection(both)).toEqual(["g1"]);
    expect(both.missing?.map((game) => game.scoutGameId)).toEqual(["s2"]);
    expect(movedGames(both, schedule, {}, [])).toEqual([]);
  });

  it("pairs nothing with a game two results on its own day could each be", () => {
    // Two Aces-Bears results on 9/20 and one game there: which is which is not for a guess, but the
    // game was plainly played that day, so the 2-6 on 9/27 is another meeting, not its make-up.
    const linked = leagueTeams.map((team) => ({ ...team, scoutTeamId: `S-${team.id}` }));
    const twoThatDay = planLeagueScoreFill(
      input({
        teams: linked,
        matchups: schedule,
        scoutGames: [
          scoutGame("s1", "S-ACES", "S-BEAR", 7, 3, "2026-09-20"),
          scoutGame("s1b", "S-ACES", "S-BEAR", 4, 4, "2026-09-20"),
          scoutGame("s2", "S-ACES", "S-BEAR", 2, 6, "2026-09-27"),
        ],
        today: "2026-10-25",
      })
    );
    expect(twoThatDay.rows.map((row) => [row.matchupId, row.action])).toEqual([
      ["g1", "ambiguous"],
    ]);
    expect(twoThatDay.missing?.map((game) => game.scoutGameId)).toEqual(["s2"]);
    expect(movedGames(twoThatDay, schedule, {}, [])).toEqual([]);
  });

  it("lets a looser match on the game's day stand in the way only once it is ticked", () => {
    // A club named like the Bears' beat the Aces on 9/20: offered, never applied unasked. Unticked,
    // the 9/27 meeting is still the rained-out game's make-up; ticked, the game is filled where it
    // stands and the 9/27 meeting cannot be moved over it.
    const looser = (action: "suggested" | "slot"): LeagueFillPlan => ({
      ...plan,
      rows: [
        {
          matchupId: "g1",
          date: "9/20",
          awayTeamId: "ACES",
          awayName: "Aces",
          homeTeamId: "BEAR",
          homeName: "Bears",
          awayRuns: 7,
          homeRuns: 3,
          action,
          scoutGameId: "s1",
        },
      ],
    });
    for (const action of ["suggested", "slot"] as const) {
      expect(movedGames(looser(action), schedule, {}, []).map((move) => move.matchupId)).toEqual([
        "g1",
      ]);
      expect(movedGames(looser(action), schedule, {}, ["g1"])).toEqual([]);
    }
  });

  it("moves the schedule's game to its new day, its score the schedule's way round", () => {
    const moved = movedGames(plan, schedule, {}, []);
    const { dates, logs } = movesToApply(plan, moved, schedule, ["s9"], 6, {});

    expect(dates).toEqual({ g1: "9/27" });
    // The schedule has the Aces away: their 6 goes on the away side.
    expect(logs.g1).toMatchObject({ awayRuns: "6", homeRuns: "2", isFinal: true });
    // And it is not added as a new game as well.
    expect(
      missingGamesToAdd(plan, schedule, ["s9"], [], 6, (i) => `n${i}`, ["s9"]).matchups
    ).toEqual([]);
  });

  it("fills a moved game onto what was typed against it, leaving everything but runs as it was", () => {
    // Hits, strikeouts, errors and walks typed by hand for the rained-out game, at seven innings,
    // but no runs: only runs keep a game from moving, so it is still paired.
    const typed: GameLog = {
      ...blankLog("7"),
      awayHits: "8",
      homeHits: "5",
      awayK: "4",
      homeK: "9",
      awayErrors: "1",
      homeErrors: "3",
      awayWalksAllowed: "2",
      homeWalksAllowed: "6",
    };
    const current: Record<string, GameLog> = { g1: typed };
    const moved = movedGames(plan, schedule, current, []);
    expect(moved.map((move) => move.matchupId)).toEqual(["g1"]);

    const { logs } = movesToApply(plan, moved, schedule, ["s9"], 6, current);
    expect(logs.g1).toEqual({ ...typed, awayRuns: "6", homeRuns: "2", isFinal: true });
    // A game that never had a log still gets a blank one at the season's innings.
    expect(movesToApply(plan, moved, schedule, ["s9"], 6, {}).logs.g1).toEqual({
      ...blankLog("6"),
      awayRuns: "6",
      homeRuns: "2",
      isFinal: true,
    });
  });
});
