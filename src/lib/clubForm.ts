import { weekEndingSunday } from "./nextWeekend";
import type { MyTeamGlance } from "./myTeamGlance";
import {
  countsTowardRating,
  MATCHUP_MARGIN_CAP,
  previewMatchup,
  scoreSeenBy,
  type ScoutGame,
  type ScoutRankingRow,
  type UpcomingMatchup,
} from "./teamRankings";

/*
 * What the My Team card and a club's panel say of how a club's season has gone beside what its
 * ratings say (README, "The My Team card"): how hard its schedule has been, its record beside the
 * one the ratings expected, its one-run games, its form over its last games, and its next weekend.
 * Read off the board's rows and the club's own games, which the card and the panel already hold.
 */

/** The games a club's form reads, newest first. */
export const FORM_GAMES = 5;

/** Where a club's schedule ranks for toughness among the clubs of its state on the board. */
export type ScheduleRank = { rank: number; of: number };

/**
 * A club's schedule's toughness among its state's clubs on the board (`strengthOfSchedule`, the
 * fit's own), 1 the toughest; undefined for a club with no state or no row.
 */
export const scheduleRankInState = (
  rows: readonly ScoutRankingRow[],
  teamId: string,
  stateOf: (teamId: string) => string | undefined
): ScheduleRank | undefined => {
  const state = stateOf(teamId);
  if (!state) return undefined;
  const inState = rows.filter((row) => stateOf(row.teamId) === state);
  const mine = inState.find((row) => row.teamId === teamId);
  if (!mine) return undefined;
  const tougher = inState.filter((row) => row.strengthOfSchedule > mine.strengthOfSchedule).length;
  return { rank: tougher + 1, of: inState.length };
};

/** One game of a club's, as its form and its expected record read it. */
type Rated = {
  game: ScoutGame;
  won: boolean;
  tied: boolean;
  chance: number;
  margin: number;
  expected: number;
};

/**
 * A club's games that count against clubs the board rates and compares with it, oldest first,
 * each with its chance and projected margin by the ratings now and the margin it won or lost by.
 */
const ratedGames = (
  teamId: string,
  games: readonly ScoutGame[],
  rowOf: (teamId: string) => ScoutRankingRow | undefined,
  today: string | undefined
): Rated[] => {
  const mine = rowOf(teamId);
  if (!mine) return [];
  const out: Rated[] = [];
  for (const game of games) {
    if (game.teamAId !== teamId && game.teamBId !== teamId) continue;
    if (game.teamAId === game.teamBId || !countsTowardRating(game, today)) continue;
    const opponent = rowOf(game.teamAId === teamId ? game.teamBId : game.teamAId);
    if (!opponent) continue;
    const odds = previewMatchup(mine, opponent);
    if (odds.unconnected) continue;
    // Its own schedule's word, as its record on the board reads it (`scoreSeenBy`).
    const seen = scoreSeenBy(game, teamId)!;
    const margin = seen.own - seen.opponent;
    out.push({
      game,
      won: margin > 0,
      tied: margin === 0,
      chance: odds.winProb,
      margin,
      expected: odds.projectedMargin,
    });
  }
  return out.sort(
    (a, b) =>
      (a.game.date ?? "").localeCompare(b.game.date ?? "") ||
      (a.game.startTs ?? "").localeCompare(b.game.startTs ?? "")
  );
};

/**
 * A club's record against the clubs the board rates and compares with it, beside the wins its
 * ratings expected of those games (each game's chance, summed), and its record in games decided by
 * one run. Undefined with no such game.
 */
export type ExpectedRecord = {
  wins: number;
  losses: number;
  ties: number;
  expectedWins: number;
  oneRun: { wins: number; losses: number };
};

export const recordVsExpected = (
  teamId: string,
  games: readonly ScoutGame[],
  rowOf: (teamId: string) => ScoutRankingRow | undefined,
  today?: string
): ExpectedRecord | undefined => {
  const rated = ratedGames(teamId, games, rowOf, today);
  if (rated.length === 0) return undefined;
  const record: ExpectedRecord = {
    wins: 0,
    losses: 0,
    ties: 0,
    expectedWins: 0,
    oneRun: { wins: 0, losses: 0 },
  };
  for (const one of rated) {
    if (one.tied) record.ties += 1;
    else if (one.won) record.wins += 1;
    else record.losses += 1;
    record.expectedWins += one.chance;
    if (Math.abs(one.margin) === 1) {
      if (one.won) record.oneRun.wins += 1;
      else record.oneRun.losses += 1;
    }
  }
  return record;
};

/** A club's last games against the margins its ratings expected of them. */
export type Form = {
  /** Newest first: whether it won, and by how many runs it beat (or fell short of) the margin. */
  games: Array<{ gameId: string; won: boolean; tied: boolean; against: number }>;
  /** Of them, how many it beat the margin the ratings expected in. */
  beat: number;
  /** The runs a game it beat the expected margins by, on average (negative short of them). */
  average: number;
};

export const formOf = (
  teamId: string,
  games: readonly ScoutGame[],
  rowOf: (teamId: string) => ScoutRankingRow | undefined,
  today?: string,
  last = FORM_GAMES
): Form | undefined => {
  const rated = ratedGames(teamId, games, rowOf, today).slice(-last).reverse();
  if (rated.length === 0) return undefined;
  // A blowout read at the margin a projection can state, or one 20-run win would be the form.
  const cap = (runs: number) => Math.max(-MATCHUP_MARGIN_CAP, Math.min(MATCHUP_MARGIN_CAP, runs));
  const against = rated.map((one) => cap(one.margin) - one.expected);
  return {
    games: rated.map((one, at) => ({
      gameId: one.game.id,
      won: one.won,
      tied: one.tied,
      against: against[at]!,
    })),
    beat: against.filter((runs) => runs > 0).length,
    average: against.reduce((sum, runs) => sum + runs, 0) / against.length,
  };
};

/** A club's next playing weekend: its games, the wins they add up to, the hardest and easiest. */
export type WeekendAhead = {
  /** The Sunday ending it. */
  sunday: string;
  games: UpcomingMatchup[];
  /** The chances summed over the games the ratings can call. */
  expectedWins: number;
  /** The game it is least likely and most likely to win, where two or more can be called. */
  toughest?: UpcomingMatchup;
  likeliest?: UpcomingMatchup;
};

/**
 * The first weekend still to come with a dated game on it (`weekEndingSunday`, Friday to Sunday),
 * from the schedule the card already reads (`buildUpcomingSchedule`); undefined with none dated.
 */
export const weekendAhead = (upcoming: readonly UpcomingMatchup[]): WeekendAhead | undefined => {
  const dated = upcoming
    .filter((row) => weekEndingSunday(row.date) !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = dated[0];
  if (!first) return undefined;
  const sunday = weekEndingSunday(first.date)!;
  const games = dated.filter((row) => weekEndingSunday(row.date) === sunday);
  const called = games.filter((row) => row.winProb !== undefined && !row.unconnected);
  const byChance = [...called].sort((a, b) => a.winProb! - b.winProb!);
  return {
    sunday,
    games,
    expectedWins: called.reduce((sum, row) => sum + row.winProb!, 0),
    ...(byChance.length >= 2
      ? { toughest: byChance[0]!, likeliest: byChance[byChance.length - 1]! }
      : {}),
  };
};

/**
 * A glance at the page's own club with its season beside its ratings added: its schedule's rank in
 * its state and its next weekend, where it has two games or more on it. Apart from `myTeamGlance`,
 * which League Standings reads as well, so its first download carries none of this.
 */
export const withSeason = (
  glance: MyTeamGlance,
  rankings: readonly ScoutRankingRow[],
  stateOf: (teamId: string) => string | undefined,
  upcoming: readonly UpcomingMatchup[]
): MyTeamGlance => {
  const schedule = scheduleRankInState(rankings, glance.teamId, stateOf);
  const weekend = weekendAhead(upcoming);
  return {
    ...glance,
    ...(schedule ? { schedule } : {}),
    ...(weekend && weekend.games.length >= 2 ? { weekend } : {}),
  };
};
