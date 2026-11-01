import { describe, expect, it } from "vitest";
import {
  ageFitsBand,
  ageFromOrgName,
  ageLevelFromLooseName,
  ageLevelFromName,
  ageSpanFromName,
} from "../gameChangerApi";
import { describeTidy, poolSignature, stampFromNewerRules, tidyPool } from "../gameChangerImport";
import { buildPredictionEngine } from "../predictionEngine";
import { attachAdjustedRatings, calculateTeams, predictGame } from "../sim";
import {
  buildTeamRankings,
  cleanTeamName,
  finalScoresKey,
  countsTowardRating,
  isPlaceholderName,
  leagueFixturesOf,
  leagueScoutBridge,
  predictMatchup,
  ratedMargin,
  scoutLinkCandidates,
  teamNameKey,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type Team } from "../types";

/*
 * What League Standings and Team Rankings work out from one small pool, to the digit, pinned before
 * the code that works it out was split between League's first download and Team Rankings' own
 * chunks (README "Performance notes"). The split moved code and nothing else, so every number here
 * holds through it: the bridge that hands League the pool's results, the forecast that reads them,
 * a page's board, a matchup's odds, the ages read off names, the names' keys and the tidy's stamp.
 * Each is read through the module it was always imported from, which re-exports what moved.
 */

const groups: AgeGroup[] = [
  { id: "ag_9_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["season-1"] },
  { id: "ag_10_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];

/** A club, and the GameChanger team it was pulled from, where it was pulled. */
const club = (id: string, name: string, gcId?: string): ScoutTeam => ({
  id,
  name,
  ...(gcId
    ? {
        gcTeams: [
          {
            teamId: gcId,
            name: `${name} 9U`,
            ageGroupId: "ag_9_2027",
            season: "fall",
            seasonYear: 2026,
            ageLevel: 9,
            importedAt: "2026-10-26T12:00:00.000Z",
          },
        ],
      }
    : {}),
});

const teams: ScoutTeam[] = [
  club("S-ACES", "Aces", "gc-aces"),
  club("S-BEARS", "Bears", "gc-bears"),
  club("S-COMETS", "Comets", "gc-comets"),
  club("S-DUCKS", "Ducks", "gc-ducks"),
  club("S-ELKS", "Elks"),
  club("S-FOXES", "Foxes"),
  { id: "S-TBD", name: "TBD", placeholder: true },
];

let nextGame = 0;
const game = (
  a: string,
  b: string,
  aScore: number,
  bScore: number,
  date: string,
  ageGroupId = "ag_9_2027"
): ScoutGame => {
  nextGame += 1;
  return {
    id: `g${nextGame}`,
    ageGroupId,
    teamAId: a,
    teamBId: b,
    teamAScore: aScore,
    teamBScore: bScore,
    date,
  };
};

const games: ScoutGame[] = [
  game("S-ACES", "S-BEARS", 6, 2, "2026-09-12"),
  game("S-BEARS", "S-COMETS", 3, 1, "2026-09-13"),
  game("S-COMETS", "S-DUCKS", 5, 4, "2026-09-19"),
  game("S-DUCKS", "S-ACES", 2, 9, "2026-09-26"),
  game("S-ELKS", "S-FOXES", 7, 7, "2026-10-03"),
  game("S-FOXES", "S-ACES", 1, 4, "2026-10-04"),
  game("S-ELKS", "S-COMETS", 8, 3, "2026-10-10"),
  game("S-BEARS", "S-DUCKS", 10, 0, "2026-10-18"),
  game("S-ACES", "S-COMETS", 3, 5, "2026-10-24"),
  game("S-TBD", "S-BEARS", 2, 6, "2026-10-25"),
  game("S-FOXES", "S-DUCKS", 45, 1, "2026-10-11"),
  game("S-ELKS", "S-BEARS", 4, 6, "2026-10-17", "ag_10_2027"),
];

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const leagueTeams = [
  { id: "L-ACES", name: "Aces", scoutTeamId: "S-ACES" },
  { id: "L-BEARS", name: "Bears" },
  { id: "L-COMETS", name: "Comets", scoutTeamId: "S-COMETS" },
];
const matchups: Matchup[] = [
  { id: "m1", date: "9/20", away: "L-ACES", home: "L-BEARS" },
  { id: "m2", date: "9/27", away: "L-COMETS", home: "L-ACES" },
  { id: "m3", date: "10/11", away: "L-BEARS", home: "L-COMETS" },
];
const logs: Record<string, GameLog> = { m1: final(4, 5), m2: final(2, 3) };

const millionth = (value: number) => Number(value.toFixed(6));

describe("the numbers worked out from one pool, pinned before the boot split", () => {
  it("hands League Standings the same results and links from the pool", () => {
    const fixtures = leagueFixturesOf(leagueTeams, matchups, finalScoresKey(matchups, logs));
    const bridge = leagueScoutBridge("season-1", groups, teams, games, leagueTeams, fixtures);
    expect({
      results: bridge.results,
      rows: bridge.rows.map((row) => [row.leagueTeamId, row.how, row.scoutTeamId ?? null]),
      linkedCount: bridge.linkedCount,
      countedResults: bridge.countedResults,
      squadYear: bridge.squadYear,
    }).toMatchInlineSnapshot(`
      {
        "countedResults": 10,
        "linkedCount": 3,
        "results": [
          {
            "away": "L-BEARS",
            "date": "2026-09-12",
            "home": "L-ACES",
            "homeMargin": 4,
            "neutral": true,
          },
          {
            "away": "L-COMETS",
            "date": "2026-09-13",
            "home": "L-BEARS",
            "homeMargin": 2,
            "neutral": true,
          },
          {
            "away": "S-S-DUCKS",
            "date": "2026-09-19",
            "home": "L-COMETS",
            "homeMargin": 1,
            "neutral": true,
          },
          {
            "away": "L-ACES",
            "date": "2026-09-26",
            "home": "S-S-DUCKS",
            "homeMargin": -7,
            "neutral": true,
          },
          {
            "away": "S-S-FOXES",
            "date": "2026-10-03",
            "home": "S-S-ELKS",
            "homeMargin": 0,
            "neutral": true,
          },
          {
            "away": "L-ACES",
            "date": "2026-10-04",
            "home": "S-S-FOXES",
            "homeMargin": -3,
            "neutral": true,
          },
          {
            "away": "L-COMETS",
            "date": "2026-10-10",
            "home": "S-S-ELKS",
            "homeMargin": 5,
            "neutral": true,
          },
          {
            "away": "S-S-DUCKS",
            "date": "2026-10-18",
            "home": "L-BEARS",
            "homeMargin": 10,
            "neutral": true,
          },
          {
            "away": "L-COMETS",
            "date": "2026-10-24",
            "home": "L-ACES",
            "homeMargin": -2,
            "neutral": true,
          },
          {
            "away": "L-BEARS",
            "date": "2026-10-25",
            "home": "S-S-TBD",
            "homeMargin": -4,
            "neutral": true,
          },
        ],
        "rows": [
          [
            "L-ACES",
            "picked",
            "S-ACES",
          ],
          [
            "L-BEARS",
            "guessed",
            "S-BEARS",
          ],
          [
            "L-COMETS",
            "picked",
            "S-COMETS",
          ],
        ],
        "squadYear": 2027,
      }
    `);
    expect(
      scoutLinkCandidates("Bears", "season-1", groups, teams, games, fixtures).map((candidate) => [
        candidate.scoutTeamId,
        candidate.sharedOpponents,
        candidate.games,
      ])
    ).toMatchInlineSnapshot(`
      [
        [
          "S-BEARS",
          [
            "Aces",
            "Comets",
          ],
          4,
        ],
        [
          "S-DUCKS",
          [
            "Aces",
            "Comets",
          ],
          4,
        ],
        [
          "S-ACES",
          [
            "Comets",
          ],
          4,
        ],
        [
          "S-COMETS",
          [
            "Aces",
          ],
          4,
        ],
      ]
    `);
  });

  it("forecasts the League season from them as it did", () => {
    const fixtures = leagueFixturesOf(leagueTeams, matchups, finalScoresKey(matchups, logs));
    const bridge = leagueScoutBridge("season-1", groups, teams, games, leagueTeams, fixtures);
    const bases = leagueTeams.map(({ id, name }) => ({ id, name }));
    const records = calculateTeams(bases, matchups, logs, DEFAULT_SETTINGS);
    const engine = buildPredictionEngine(
      records,
      matchups,
      logs,
      DEFAULT_SETTINGS,
      bridge.results,
      bridge.squadYear
    );
    const rated: Team[] = attachAdjustedRatings(records, engine.ratings);
    const pick = predictGame(matchups[2]!, rated, DEFAULT_SETTINGS);
    expect({
      ratings: Object.fromEntries(
        [...engine.ratings.byTeam].map(([id, rating]) => [id, millionth(rating)])
      ),
      awayWinPct: millionth(pick.awayWinPct),
      winnerId: pick.winnerId,
      scores: [millionth(pick.awayScore), millionth(pick.homeScore)],
    }).toMatchInlineSnapshot(`
      {
        "awayWinPct": 0.631784,
        "ratings": {
          "L-ACES": 1.529719,
          "L-BEARS": 1.767064,
          "L-COMETS": -0.33788,
          "S-S-DUCKS": -3.342466,
          "S-S-ELKS": 1.319746,
          "S-S-FOXES": -0.04301,
          "S-S-TBD": -0.893174,
        },
        "scores": [
          4,
          3,
        ],
        "winnerId": "L-BEARS",
      }
    `);
  });

  it("rates a page and a matchup as it did", () => {
    const rows = buildTeamRankings("ag_9_2027", teams, games, undefined, groups);
    expect(
      rows.map((row) => ({
        teamId: row.teamId,
        rank: row.rank,
        rating: millionth(row.rating),
        pointRating: millionth(row.pointRating),
        record: row.record,
        strengthOfSchedule: millionth(row.strengthOfSchedule),
      }))
    ).toMatchInlineSnapshot(`
      [
        {
          "pointRating": 0.486523,
          "rank": 1,
          "rating": 0.637077,
          "record": "4-1",
          "strengthOfSchedule": -1.995196,
          "teamId": "S-BEARS",
        },
        {
          "pointRating": -0.016981,
          "rank": 2,
          "rating": 0.054339,
          "record": "3-1",
          "strengthOfSchedule": -2.046166,
          "teamId": "S-ACES",
        },
        {
          "pointRating": -0.563034,
          "rank": 3,
          "rating": -0.614066,
          "record": "1-1-1",
          "strengthOfSchedule": -1.064784,
          "teamId": "S-ELKS",
        },
        {
          "pointRating": -1.970329,
          "rank": 4,
          "rating": -1.890379,
          "record": "2-2",
          "strengthOfSchedule": -1.270951,
          "teamId": "S-COMETS",
        },
        {
          "pointRating": -1.710545,
          "rank": 5,
          "rating": -1.9287,
          "record": "0-1-1",
          "strengthOfSchedule": -0.290008,
          "teamId": "S-FOXES",
        },
        {
          "pointRating": -4.990313,
          "rank": 6,
          "rating": -5.02295,
          "record": "0-3",
          "strengthOfSchedule": -0.500263,
          "teamId": "S-DUCKS",
        },
      ]
    `);
    const [first, second] = rows;
    const odds = predictMatchup(first!.rating, second!.rating, 9);
    expect({
      projectedMargin: millionth(odds.projectedMargin),
      winProbA: millionth(odds.winProbA),
    }).toMatchInlineSnapshot(`
      {
        "projectedMargin": 0.582739,
        "winProbA": 0.534346,
      }
    `);
  });

  it("reads ages, names and scores as it did", () => {
    const names = [
      "Aces 9U",
      "Bears 10u Navy",
      "Comets 9U/10U",
      "2033 Ducks",
      "U11 Elks",
      "Foxes (Coach A) 12U",
      "TBD- 09/25/26, 7:15 PM",
      "Gulls 13u - 14u",
      "Herons Baseball Club",
    ];
    expect(
      names.map((name) => [
        name,
        ageLevelFromName(name) ?? null,
        ageSpanFromName(name) ?? null,
        ageLevelFromLooseName(name) ?? null,
        ageFromOrgName(name) ?? null,
        cleanTeamName(name),
        teamNameKey(name),
        isPlaceholderName(name),
      ])
    ).toMatchInlineSnapshot(`
      [
        [
          "Aces 9U",
          9,
          null,
          9,
          9,
          "Aces",
          "aces",
          false,
        ],
        [
          "Bears 10u Navy",
          10,
          null,
          10,
          10,
          "Bears Navy",
          "bears navy",
          false,
        ],
        [
          "Comets 9U/10U",
          10,
          {
            "high": 10,
            "low": 9,
          },
          9,
          null,
          "Comets",
          "comets",
          false,
        ],
        [
          "2033 Ducks",
          null,
          null,
          null,
          null,
          "2033 Ducks",
          "2033 ducks",
          false,
        ],
        [
          "U11 Elks",
          11,
          null,
          11,
          11,
          "Elks",
          "elks",
          false,
        ],
        [
          "Foxes (Coach A) 12U",
          12,
          null,
          12,
          12,
          "Foxes",
          "foxes",
          false,
        ],
        [
          "TBD- 09/25/26, 7:15 PM",
          null,
          null,
          null,
          null,
          "TBD- 09/25/26, 7:15 PM",
          "tbd 09 25 26, 7:15 pm",
          true,
        ],
        [
          "Gulls 13u - 14u",
          14,
          {
            "high": 14,
            "low": 13,
          },
          13,
          null,
          "Gulls",
          "gulls",
          false,
        ],
        [
          "Herons Baseball Club",
          null,
          null,
          null,
          null,
          "Herons Baseball Club",
          "herons baseball club",
          false,
        ],
      ]
    `);
    expect(
      ["9-11", "12U", "Open", "High School"].map((label) =>
        [9, 12].map((level) => ageFitsBand(level, label))
      )
    ).toMatchInlineSnapshot(`
      [
        [
          true,
          true,
        ],
        [
          true,
          true,
        ],
        [
          true,
          true,
        ],
        [
          false,
          false,
        ],
      ]
    `);
    expect(games.map((row) => [row.id, countsTowardRating(row), ratedMargin(row) ?? null]))
      .toMatchInlineSnapshot(`
        [
          [
            "g1",
            true,
            4,
          ],
          [
            "g2",
            true,
            2,
          ],
          [
            "g3",
            true,
            1,
          ],
          [
            "g4",
            true,
            -7,
          ],
          [
            "g5",
            true,
            0,
          ],
          [
            "g6",
            true,
            -3,
          ],
          [
            "g7",
            true,
            5,
          ],
          [
            "g8",
            true,
            10,
          ],
          [
            "g9",
            true,
            -2,
          ],
          [
            "g10",
            true,
            -4,
          ],
          [
            "g11",
            false,
            44,
          ],
          [
            "g12",
            true,
            -2,
          ],
        ]
      `);
  });

  it("tidies the pool and stamps it as it did", () => {
    const state = { ageGroups: groups, teams, games };
    expect(poolSignature(state)).toMatchInlineSnapshot(`"r38|2|7|12|2026-10-26T12:00:00.000Z"`);
    expect([stampFromNewerRules("r999|1"), stampFromNewerRules(poolSignature(state))]).toEqual([
      true,
      false,
    ]);
    const { state: tidied, ...counts } = tidyPool(state);
    expect({
      teams: tidied.teams.map((team) => team.id),
      games: tidied.games.map((row) => [row.id, row.teamAId, row.teamBId]),
      said: describeTidy(counts),
    }).toMatchInlineSnapshot(`
      {
        "games": [
          [
            "g1",
            "S-ACES",
            "S-BEARS",
          ],
          [
            "g2",
            "S-BEARS",
            "S-COMETS",
          ],
          [
            "g3",
            "S-COMETS",
            "S-DUCKS",
          ],
          [
            "g4",
            "S-DUCKS",
            "S-ACES",
          ],
          [
            "g5",
            "S-ELKS",
            "S-FOXES",
          ],
          [
            "g6",
            "S-FOXES",
            "S-ACES",
          ],
          [
            "g7",
            "S-ELKS",
            "S-COMETS",
          ],
          [
            "g8",
            "S-BEARS",
            "S-DUCKS",
          ],
          [
            "g9",
            "S-ACES",
            "S-COMETS",
          ],
          [
            "g10",
            "S-TBD",
            "S-BEARS",
          ],
          [
            "g11",
            "S-FOXES",
            "S-DUCKS",
          ],
          [
            "g12",
            "S-ELKS",
            "S-BEARS",
          ],
        ],
        "said": [
          "1 game against a TBD slot set not to count: a game another team's schedule holds at that date and time counts in its place, and one nobody's does counts for nothing.",
        ],
        "teams": [
          "S-ACES",
          "S-BEARS",
          "S-COMETS",
          "S-DUCKS",
          "S-ELKS",
          "S-FOXES",
          "S-TBD",
        ],
      }
    `);
  });
});
