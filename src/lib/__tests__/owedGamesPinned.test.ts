import { describe, expect, it } from "vitest";
import { clinchingPathsForTeams } from "../clinchingPaths";
import { eliminationNumberForGold, magicForGold, neededResults } from "../magic";
import {
  calculateTeams,
  getMathGoldStatus,
  getRemainingCounts,
  rankOptionsFromSettings,
  rankTeams,
  simulateBracketOdds,
  simulateGoldOddsRun,
} from "../sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type TeamBase,
  type TeamWithProjection,
} from "../types";
import { isFinal } from "../util";

/*
 * What a league that sets games per team, and has entered only part of its schedule, is told: the
 * Gold odds, the title odds, the magic and elimination numbers, the needed results and the Forecast's
 * Gold Bracket paths, each pinned to the digit for leagues that owe games beyond the schedule and for
 * leagues that owe none. A change meant to move a number for the leagues that owe games updates this
 * file, and its commit says which moved; a league that owes none must not move at all, whether the
 * setting is off or set to what its schedule already has. Placeholder names.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const TEAMS: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Ducks" },
];

/** One round robin, every game of it played: the Aces win all three, the Bears two, the Comets one. */
const ROUND: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/1", away: "C", home: "D" },
  { id: "g3", date: "5/8", away: "A", home: "C" },
  { id: "g4", date: "5/8", away: "B", home: "D" },
  { id: "g5", date: "5/15", away: "A", home: "D" },
  { id: "g6", date: "5/15", away: "B", home: "C" },
];

/** The same, with the Aces and the Bears to meet twice more: five games for them, three for the rest. */
const TWICE: Matchup[] = [
  ...ROUND,
  { id: "g7", date: "5/22", away: "B", home: "A" },
  { id: "g8", date: "5/29", away: "A", home: "B" },
];

const SCORES: Record<string, GameLog> = {
  g1: final(6, 2),
  g2: final(5, 3),
  g3: final(7, 1),
  g4: final(4, 2),
  g5: final(8, 3),
  g6: final(5, 4),
};

const CUTOFF = 2;
const rounded = (values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([id, value]) => [id, Number(value.toFixed(3))]));

/**
 * Every number pinned, for one league. `exact` is false where the games left, owed ones counted, are
 * more than the exact search is ever asked about on the page (`EXACT_MAGIC_REMAINING_GAME_LIMIT`).
 */
const pins = (matchups: Matchup[], gamesPerTeam: number, exact = true) => {
  const settings = {
    ...DEFAULT_SETTINGS,
    goldCutoff: CUTOFF,
    regularSeasonGamesPerTeam: gamesPerTeam,
  };
  const live = calculateTeams(TEAMS, matchups, SCORES, settings);
  const ranked = rankTeams(live, rankOptionsFromSettings(settings));
  const remaining = matchups.filter((game) => !isFinal(SCORES[game.id]));
  const counts = getRemainingCounts(live, remaining, gamesPerTeam);
  const rows: TeamWithProjection[] = ranked.map((team) => ({
    ...team,
    ...getMathGoldStatus(team, ranked, counts, CUTOFF, settings),
    projectedRank: team.rank,
    projectedRecord: "",
    projectedRunDiff: 0,
    // Held, so a path's place in the list moves only with the exact search, not with the odds.
    goldPct: 50,
    goldTrend: [],
  }));
  const run = simulateGoldOddsRun(live, remaining, 400, "owed", CUTOFF, settings, "C");
  const bracket = simulateBracketOdds(live, remaining, 100, "owed", CUTOFF, settings);
  return {
    status: rows.map((row) => `${row.id} ${row.goldStatus}, ${counts[row.id]} left`),
    odds: rounded(run.odds),
    places: rounded(run.places),
    iterations: run.iterations,
    swing: run.swing?.gameIds ?? [],
    champion: rounded(bracket.championOdds),
    finals: rounded(bracket.finalsOdds),
    exact: exact
      ? rows.map((row) =>
          [
            row.id,
            `M ${magicForGold(row.id, rows, remaining, CUTOFF, settings).description}`,
            `E ${eliminationNumberForGold(row.id, rows, remaining, CUTOFF, settings).description}`,
            `needs ${JSON.stringify(neededResults(row.id, rows, remaining, CUTOFF, settings))}`,
          ].join(" | ")
        )
      : "not asked",
    paths: clinchingPathsForTeams(rows, remaining, CUTOFF, settings, () => [], {
      limit: 8,
      exactLimit: 15,
      // Every game today, as the clinching paths' own tests read them: the stored order stands.
      daysFromToday: () => 0,
    }).map((path) => `${path.teamId} ${path.status}: ${path.notes.join(" ")}`),
  };
};

describe("leagues that owe no games beyond the schedule", () => {
  it("are told the same with games per team set to what the schedule has as with it off", () => {
    expect(pins(ROUND, 3)).toEqual(pins(ROUND, 0));
    // The Aces and the Bears are scheduled past three; that owes nobody anything either.
    expect(pins(TWICE, 3)).toEqual(pins(TWICE, 0));
    // Five each, two of them still to play: owed by the setting, but on the schedule already.
    const full: Matchup[] = [
      ...TWICE,
      { id: "g9", date: "5/22", away: "D", home: "C" },
      { id: "g10", date: "5/29", away: "C", home: "D" },
    ];
    expect(pins(full, 5)).toEqual(pins(full, 0));
  });

  it("a finished round robin", () => {
    expect(pins(ROUND, 0)).toMatchInlineSnapshot(`
      {
        "champion": {
          "A": 51,
          "B": 49,
          "C": 0,
          "D": 0,
        },
        "exact": [
          "A | M Already clinched. | E Cannot be eliminated from the Gold Bracket this season. | needs null",
          "B | M Already clinched. | E Cannot be eliminated from the Gold Bracket this season. | needs null",
          "C | M Cannot mathematically clinch a Gold Bracket spot. | E Already eliminated from the Gold Bracket. | needs null",
          "D | M Cannot mathematically clinch a Gold Bracket spot. | E Already eliminated from the Gold Bracket. | needs null",
        ],
        "finals": {
          "A": 100,
          "B": 100,
          "C": 0,
          "D": 0,
        },
        "iterations": 200,
        "odds": {
          "A": 100,
          "B": 100,
          "C": 0,
          "D": 0,
        },
        "paths": [],
        "places": {
          "A": 1,
          "B": 2,
          "C": 3,
          "D": 4,
        },
        "status": [
          "A Clinched, 0 left",
          "B Clinched, 0 left",
          "C Eliminated, 0 left",
          "D Eliminated, 0 left",
        ],
        "swing": [],
      }
    `);
  });

  it("two more games between the Aces and the Bears", () => {
    expect(pins(TWICE, 0)).toMatchInlineSnapshot(`
      {
        "champion": {
          "A": 54,
          "B": 46,
          "C": 0,
          "D": 0,
        },
        "exact": [
          "A | M Already clinched. | E Cannot be eliminated from the Gold Bracket this season. | needs null",
          "B | M Already clinched. | E Cannot be eliminated from the Gold Bracket this season. | needs null",
          "C | M Cannot mathematically clinch a Gold Bracket spot. | E Already eliminated from the Gold Bracket. | needs null",
          "D | M Cannot mathematically clinch a Gold Bracket spot. | E Already eliminated from the Gold Bracket. | needs null",
        ],
        "finals": {
          "A": 100,
          "B": 100,
          "C": 0,
          "D": 0,
        },
        "iterations": 200,
        "odds": {
          "A": 100,
          "B": 100,
          "C": 0,
          "D": 0,
        },
        "paths": [],
        "places": {
          "A": 1.17,
          "B": 1.83,
          "C": 3,
          "D": 4,
        },
        "status": [
          "A Clinched, 2 left",
          "B Clinched, 2 left",
          "C Eliminated, 0 left",
          "D Eliminated, 0 left",
        ],
        "swing": [
          "g7",
          "g8",
        ],
      }
    `);
  });
});

describe("leagues that owe games the schedule does not show yet", () => {
  it("every team a game", () => {
    expect(pins(ROUND, 4)).toMatchInlineSnapshot(`
      {
        "champion": {
          "A": 57,
          "B": 43,
          "C": 0,
          "D": 0,
        },
        "exact": [
          "A | M Already clinched. | E Cannot be eliminated from the Gold Bracket this season. | needs null",
          "B | M 1 more win clinches a Gold Bracket spot. | E Its own losses cannot eliminate it, but other results still can. | needs []",
          "C | M Cannot mathematically clinch a Gold Bracket spot. | E 1 more loss would eliminate the team from the Gold Bracket. | needs [{"gameId":" owed B 1","date":"","side":" owed","against":"B","orTie":false,"owed":1},{"gameId":" owed C 1","date":"","side":"C","against":" owed","orTie":false,"owed":1}]",
          "D | M Cannot mathematically clinch a Gold Bracket spot. | E Already eliminated from the Gold Bracket. | needs null",
        ],
        "finals": {
          "A": 100,
          "B": 100,
          "C": 0,
          "D": 0,
        },
        "iterations": 200,
        "odds": {
          "A": 100,
          "B": 100,
          "C": 0,
          "D": 0,
        },
        "paths": [
          "B In: Controls a Gold spot by winning out.",
          "C Alive: Needs help from teams above the line. Out after 1 more loss.",
        ],
        "places": {
          "A": 1,
          "B": 2,
          "C": 3,
          "D": 4,
        },
        "status": [
          "A Clinched, 1 left",
          "B In, 1 left",
          "C Alive, 1 left",
          "D Eliminated, 1 left",
        ],
        "swing": [],
      }
    `);
  });

  it("every team nine, the sweep's reproduction", () => {
    expect(pins(ROUND, 12, false)).toMatchInlineSnapshot(`
      {
        "champion": {
          "A": 56,
          "B": 33,
          "C": 9,
          "D": 2,
        },
        "exact": "not asked",
        "finals": {
          "A": 95,
          "B": 80,
          "C": 22,
          "D": 3,
        },
        "iterations": 400,
        "odds": {
          "A": 91,
          "B": 72.25,
          "C": 27,
          "D": 9.75,
        },
        "paths": [
          "B In: Controls a Gold spot by protecting the current cut-line cushion.",
          "A In: Controls a Gold spot by protecting the current cut-line cushion.",
          "C Alive: Needs help from teams above the line.",
          "D Alive: Needs help from teams above the line.",
        ],
        "places": {
          "A": 1.413,
          "B": 2.12,
          "C": 2.89,
          "D": 3.578,
        },
        "status": [
          "A In, 9 left",
          "B In, 9 left",
          "C Alive, 9 left",
          "D Alive, 9 left",
        ],
        "swing": [],
      }
    `);
  });

  it("the Comets and the Ducks two each, while the Aces and the Bears play theirs", () => {
    expect(pins(TWICE, 5)).toMatchInlineSnapshot(`
      {
        "champion": {
          "A": 54,
          "B": 42,
          "C": 3,
          "D": 1,
        },
        "exact": [
          "A | M 1 more win clinches a Gold Bracket spot. | E Its own losses cannot eliminate it, but other results still can. | needs []",
          "B | M 2 more wins clinches a Gold Bracket spot. | E Its own losses cannot eliminate it, but other results still can. | needs []",
          "C | M Cannot mathematically clinch a Gold Bracket spot. | E 2 more losses would eliminate the team from the Gold Bracket. | needs []",
          "D | M Cannot mathematically clinch a Gold Bracket spot. | E 1 more loss would eliminate the team from the Gold Bracket. | needs [{"gameId":"g7","date":"5/22","side":"A","against":"B","orTie":false},{"gameId":"g8","date":"5/29","side":"A","against":"B","orTie":false},{"gameId":" owed D 1","date":"","side":"D","against":" owed","orTie":false,"owed":2}]",
        ],
        "finals": {
          "A": 100,
          "B": 90,
          "C": 8,
          "D": 2,
        },
        "iterations": 400,
        "odds": {
          "A": 100,
          "B": 87.25,
          "C": 9.75,
          "D": 3,
        },
        "paths": [
          "B In: Controls a Gold spot by winning out.",
          "A In: Clinches with 1 win.",
          "C Alive: Comets get help if Bears lose to Aces. Out after 2 more losses.",
          "D Alive: Ducks get help if Bears lose to Aces. Out after 1 more loss.",
        ],
        "places": {
          "A": 1.185,
          "B": 1.975,
          "C": 2.947,
          "D": 3.893,
        },
        "status": [
          "A In, 2 left",
          "B In, 2 left",
          "C Alive, 2 left",
          "D Alive, 2 left",
        ],
        "swing": [
          "g7",
          "g8",
        ],
      }
    `);
  });
});
