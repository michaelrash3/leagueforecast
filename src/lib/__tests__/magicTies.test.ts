import { describe, expect, it } from "vitest";
import { clinchingPathForTeam } from "../clinchingPaths";
import { eliminationNumberForGold, magicForGold } from "../magic";
import { calculateTeams, createTeamId, rankOptionsFromSettings, rankTeams } from "../sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type Settings,
  type TeamBase,
  type TeamWithProjection,
} from "../types";

/*
 * A tie on points is the tiebreakers' to settle, not the alphabet's.
 *
 * The solver ranked every branch on points and gave a tie to the lower team id, and a league id
 * is the first four letters of the name: "513F" sorted ahead of every other club in this league,
 * so 513 FORCE - BOULEY was told it had clinched wherever it was level, and the Trash Pandas who
 * beat it were told they were out. The table breaks the same tie by fewer losses and then the
 * league's tiebreakers.
 */
const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "",
  awayK: "",
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const names = [
  "Trash Pandas Baseball Club",
  "The Generals",
  "Cincinnati Angels- Red",
  "513 FORCE - BOULEY",
  "Yeager Dreyer",
  "Cincinnati Hornets",
];
const taken = new Set<string>();
const bases = names.map((name) => ({ id: createTeamId(name, taken), name }));
const [PANDAS, GENERALS, ANGELS, FORCE, YEAGER, HORNETS] = bases.map((team) => team.id) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const settings: Settings = { ...DEFAULT_SETTINGS, goldCutoff: 3 };

/**
 * One round robin. The Generals win everything and the Angels everything else; the Pandas beat
 * Force and Yeager and lose to the Hornets; Force beat Yeager and the Hornets; Yeager beat the
 * Hornets. That leaves the Pandas and Force 2-3, level, with the Pandas holding the head-to-head.
 */
const winnerOf = (a: string, b: string) => {
  const pair = (x: string, y: string) => (a === x && b === y) || (a === y && b === x);
  if (pair(PANDAS, HORNETS)) return HORNETS;
  const order = [GENERALS, ANGELS, PANDAS, FORCE, YEAGER, HORNETS];
  return order.indexOf(a) < order.indexOf(b) ? a : b;
};
const roundRobin: Matchup[] = bases.flatMap((home, i) =>
  bases.slice(i + 1).map((away) => ({
    id: `${away.id}-${home.id}`,
    date: "9/5",
    away: away.id,
    home: home.id,
  }))
);
const between = (x: string, y: string) => (game: Matchup) =>
  (game.away === x && game.home === y) || (game.away === y && game.home === x);
const played = (games: Matchup[]) =>
  Object.fromEntries(
    games.map((game) => [
      game.id,
      winnerOf(game.away, game.home) === game.away ? final(6, 4) : final(4, 6),
    ])
  );
const table = (teams: TeamBase[], matchups: Matchup[], logs: Record<string, GameLog>) =>
  rankTeams(calculateTeams(teams, matchups, logs, settings), rankOptionsFromSettings(settings));
/** The rows Clinching Paths reads, with nothing decided by the odds. */
const bubbleRows = (ranked: ReturnType<typeof table>) =>
  ranked.map((team) => ({
    ...team,
    goldStatus: "Bubble",
    goldPct: 50,
    projectedRank: team.rank,
  })) as unknown as TeamWithProjection[];
const pathOf = (rows: TeamWithProjection[], id: string, remaining: Matchup[], cutoff: number) =>
  clinchingPathForTeam({
    team: rows.find((row) => row.id === id)!,
    teams: rows,
    remaining,
    cutoff,
    settings,
    swings: [],
  });

describe("a tie on points at the cut line", () => {
  it("is ranked as the table ranks it once the season is over", () => {
    const ranked = table(bases, roundRobin, played(roundRobin));
    const place = (id: string) => ranked.find((team) => team.id === id)!;
    expect([place(PANDAS).w, place(PANDAS).l, place(FORCE).w, place(FORCE).l]).toEqual([
      2, 3, 2, 3,
    ]);
    // Level on points and losses; the Pandas hold the head-to-head, so the table has them third.
    expect([place(PANDAS).rank, place(FORCE).rank]).toEqual([3, 4]);
    // This used to read the other way round: "513F" sorts before "TRAS".
    expect(magicForGold(PANDAS, ranked, [], 3, settings).description).toBe("Already clinched.");
    expect(magicForGold(FORCE, ranked, [], 3, settings).type).toBe("impossible");
    expect(eliminationNumberForGold(FORCE, ranked, [], 3, settings).description).toBe(
      "Already eliminated from the Gold Bracket."
    );
    expect(eliminationNumberForGold(PANDAS, ranked, [], 3, settings).type).toBe("magic");
  });

  it("with games left, is left to the tiebreakers rather than to the name", () => {
    // Still to play: the Pandas against Yeager, Force against the Hornets. The Pandas, Force,
    // Yeager and the Hornets are all 1-3, so one win puts a club level with one other at worst.
    const left = roundRobin.filter(
      (game) => between(PANDAS, YEAGER)(game) || between(FORCE, HORNETS)(game)
    );
    const ranked = table(
      bases,
      roundRobin,
      played(roundRobin.filter((game) => !left.includes(game)))
    );
    const share =
      "1 more win guarantees at least a share of the last Gold Bracket spot; the tiebreakers decide.";
    [PANDAS, FORCE].forEach((id) => {
      const magic = magicForGold(id, ranked, left, 3, settings);
      expect(magic.type).toBe("magic");
      expect(magic.tiebreak).toBe(true);
      expect(magic.description).toBe(share);
    });

    const rows = bubbleRows(ranked);
    expect(pathOf(rows, FORCE, left, 3).notes).toContain(
      "1 win guarantees at least a share of the last spot; the tiebreakers decide."
    );
    expect(pathOf(rows, FORCE, left, 3).notes).not.toContain("Clinches with 1 win.");
  });

  it("does not eliminate a team that only a tiebreak keeps out", () => {
    // A beat C and B beat D, one place: A and B are level on points whatever C and D do.
    const four = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
    const games: Matchup[] = [
      { id: "g1", date: "9/5", away: "A", home: "C" },
      { id: "g2", date: "9/5", away: "B", home: "D" },
      { id: "g3", date: "9/12", away: "C", home: "D" },
    ];
    const ranked = table(four, games, { g1: final(6, 4), g2: final(6, 4) });
    const left = [games[2]!];

    const out = eliminationNumberForGold("A", ranked, left, 1, settings);
    expect(out.type).toBe("elimination");
    expect(out.tiebreak).toBe(true);
    expect(out.opponentLossesNeeded).toBe(0);
    expect(out.description).toBe("Only a won tiebreak can still put the team in the Gold Bracket.");
    expect(magicForGold("A", ranked, left, 1, settings).description).toBe(
      "Level for the last Gold Bracket spot at worst; the tiebreakers decide."
    );

    const path = pathOf(bubbleRows(ranked), "A", left, 1);
    expect(path.status).not.toBe("Eliminated");
    expect(path.notes).toContain("Only a won tiebreak can still put them in.");
  });
});
