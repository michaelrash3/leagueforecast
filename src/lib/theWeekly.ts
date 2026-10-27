import { shiftIsoDay } from "./date";
import {
  countsTowardRating,
  inSegment,
  isScoutGamePlayed,
  previewMatchup,
  scoreSeenBy,
  type ScoutGame,
  type ScoutRankingRow,
  type SeasonSegment,
} from "./teamRankings";

/*
 * The Weekly (README, "The Weekly"): a page's week, read off its board and its games. The upsets of
 * the week just played, the game of the week ahead and the longest winning streaks still running,
 * beside the moves the "This week" card names (`weekMovers`), and the week of the page's own club.
 * A device works it out from its pool; a published board carries it (`BoardView.weekly`), worked
 * out where the board is built from the games the build already holds, so a member's Rankings tab
 * reads nothing more than its board.
 */

/** The days a week looks back over, ending yesterday, and forward over, starting today. */
export const WEEK_DAYS = 7;

/** A win the ratings gave its winner less than this chance of is an upset. */
export const UPSET_CHANCE = 0.25;

/** How many upsets and streaks are named. */
export const UPSETS_SHOWN = 3;
export const STREAKS_SHOWN = 3;

/** The fewest wins running that are a streak worth naming. */
export const STREAK_LEAST = 5;

/** The game of the week ahead is between two clubs this high on the board. */
export const MARQUEE_WITHIN = 50;

/** A result the ratings called the other way: who won, by what score, on what day, and the odds. */
export type WeeklyUpset = {
  winnerId: string;
  loserId: string;
  winnerRuns: number;
  loserRuns: number;
  date: string;
  /** The winner's chance by the board's ratings, as the page's odds read them (`previewMatchup`). */
  chance: number;
};

/** The game ahead between two of the board's top clubs whose odds are nearest even. */
export type WeeklyGame = {
  teamAId: string;
  teamBId: string;
  date: string;
  /** Side A's chance, and the margin the ratings project for it. */
  chanceA: number;
  margin: number;
};

/** A club's wins running, as of its latest game that counts. */
export type WeeklyStreak = { teamId: string; wins: number };

/** A page's week: the last day of the week just played, and what it held. */
export type Weekly = {
  asOf: string;
  upsets: WeeklyUpset[];
  ahead: WeeklyGame | null;
  streaks: WeeklyStreak[];
};

const placeOf = (row: ScoutRankingRow): number => row.overallRank ?? row.rank;

/**
 * The winner's chance in a game, by the board's ratings as the page reads a matchup: undefined for
 * a game that does not count, a tie, a club the board has no row for, two clubs nothing in the pool
 * compares (`previewMatchup`'s `unconnected`), whose odds are a guess, or a game whose two clubs'
 * own schedules (`scoreSeenBy`) do not agree who won, which is no upset of either's.
 */
export const winnerChance = (
  game: ScoutGame,
  rowOf: (teamId: string) => ScoutRankingRow | undefined,
  today?: string
): number | undefined => {
  if (!countsTowardRating(game, today)) return undefined;
  const byA = scoreSeenBy(game, game.teamAId)!;
  const byB = scoreSeenBy(game, game.teamBId)!;
  if (byA.own === byA.opponent || byB.own === byB.opponent) return undefined;
  const aWon = byA.own > byA.opponent;
  if (aWon === byB.own > byB.opponent) return undefined;
  const a = rowOf(game.teamAId);
  const b = rowOf(game.teamBId);
  if (!a || !b || a.teamId === b.teamId) return undefined;
  const odds = previewMatchup(a, b);
  if (odds.unconnected) return undefined;
  return aWon ? odds.winProb : 1 - odds.winProb;
};

/** A club's runs and its opponent's in a game, as its own schedule gave them (`scoreSeenBy`). */
const ownScore = (game: ScoutGame, teamId: string) => scoreSeenBy(game, teamId)!;

/** Whether a game is one the ratings called the other way (`UPSET_CHANCE`). */
export const isUpset = (
  game: ScoutGame,
  rowOf: (teamId: string) => ScoutRankingRow | undefined,
  today?: string
): boolean => {
  const chance = winnerChance(game, rowOf, today);
  return chance !== undefined && chance < UPSET_CHANCE;
};

/** Oldest first, by day and then start, so a club's latest game is its last. */
const byWhen = (a: ScoutGame, b: ScoutGame): number =>
  (a.date ?? "").localeCompare(b.date ?? "") || (a.startTs ?? "").localeCompare(b.startTs ?? "");

/** The half of a year a board is fitted on, as `inSegment` reads one: none for the whole year. */
export type WeeklyHalf = { year: number | undefined; segment: SeasonSegment | undefined };

/**
 * The page's week, from its board's rows and its rating pool's games of the board's half: the
 * upsets and the game ahead off the page's own, a streak off every page of the pool, as the
 * board's record is. `today` is an ISO day: the
 * week just played is the `WEEK_DAYS` before it, and the week ahead starts on it.
 */
export const theWeekly = (
  pageId: string,
  rows: readonly ScoutRankingRow[],
  games: readonly ScoutGame[],
  today: string,
  half?: WeeklyHalf
): Weekly => {
  const byId = new Map(rows.map((row) => [row.teamId, row]));
  const rowOf = (teamId: string) => byId.get(teamId);
  const since = shiftIsoDay(today, -WEEK_DAYS);
  const until = shiftIsoDay(today, WEEK_DAYS);
  // The pool's games of the board's half, as its record reads them, and of those the page's own.
  const pool = games.filter(
    (game) => half === undefined || inSegment(game.date, half.year, half.segment)
  );
  const page = pool.filter((game) => game.ageGroupId === pageId);

  // The least likely first, and a result both schedules hold is one upset.
  const upsets = new Map<string, WeeklyUpset>();
  for (const game of page) {
    if (game.date === undefined || game.date < since || game.date >= today) continue;
    const chance = winnerChance(game, rowOf, today);
    if (chance === undefined || chance >= UPSET_CHANCE) continue;
    const aWon = game.teamAScore! > game.teamBScore!;
    const upset: WeeklyUpset = {
      winnerId: aWon ? game.teamAId : game.teamBId,
      loserId: aWon ? game.teamBId : game.teamAId,
      winnerRuns: Math.max(game.teamAScore!, game.teamBScore!),
      loserRuns: Math.min(game.teamAScore!, game.teamBScore!),
      date: game.date,
      chance,
    };
    const key = [upset.winnerId, upset.loserId, upset.date, upset.winnerRuns, upset.loserRuns];
    upsets.set(key.join("|"), upset);
  }

  let ahead: WeeklyGame | null = null;
  let nearest = { far: Infinity, pair: Infinity };
  for (const game of page) {
    if (game.date === undefined || game.date < today || game.date >= until) continue;
    if (isScoutGamePlayed(game) || game.excluded === true || game.countedElsewhere === true)
      continue;
    const a = rowOf(game.teamAId);
    const b = rowOf(game.teamBId);
    if (!a || !b || a.teamId === b.teamId) continue;
    if (placeOf(a) > MARQUEE_WITHIN || placeOf(b) > MARQUEE_WITHIN) continue;
    const odds = previewMatchup(a, b);
    if (odds.unconnected) continue;
    // Nearest even first; on a tie of that, the higher pair; on a tie of both, the sooner.
    const far = Math.abs(odds.winProb - 0.5);
    const pair = placeOf(a) + placeOf(b);
    const nearer =
      far < nearest.far ||
      (far === nearest.far &&
        (pair < nearest.pair ||
          (pair === nearest.pair && ahead !== null && game.date < ahead.date)));
    if (nearer) {
      nearest = { far, pair };
      ahead = {
        teamAId: a.teamId,
        teamBId: b.teamId,
        date: game.date,
        chanceA: odds.winProb,
        margin: odds.projectedMargin,
      };
    }
  }

  /*
   * Each ranked club's games that count, read back from its latest until one it did not win: its
   * games on every page of the pool, as the board's record counts them (`recordsFor`), so a loss
   * filed on another age's page ends a run as it does on the club's record.
   */
  const played = new Map<string, ScoutGame[]>();
  for (const game of pool) {
    if (game.date === undefined || !countsTowardRating(game, today)) continue;
    for (const club of new Set([game.teamAId, game.teamBId])) {
      if (!byId.has(club)) continue;
      const list = played.get(club);
      if (list) list.push(game);
      else played.set(club, [game]);
    }
  }
  const streaks: WeeklyStreak[] = [];
  for (const [teamId, list] of played) {
    list.sort(byWhen);
    let wins = 0;
    for (let at = list.length - 1; at >= 0; at -= 1) {
      const game = list[at]!;
      // Its own schedule's word, as its record on the board reads it.
      const { own, opponent } = ownScore(game, teamId);
      if (own <= opponent) break;
      wins += 1;
    }
    if (wins >= STREAK_LEAST) streaks.push({ teamId, wins });
  }

  return {
    asOf: shiftIsoDay(today, -1),
    upsets: [...upsets.values()]
      .sort((x, y) => x.chance - y.chance || y.date.localeCompare(x.date))
      .slice(0, UPSETS_SHOWN),
    ahead,
    streaks: streaks
      .sort(
        (x, y) => y.wins - x.wins || placeOf(byId.get(x.teamId)!) - placeOf(byId.get(y.teamId)!)
      )
      .slice(0, STREAKS_SHOWN),
  };
};

/** A club's week just played: its record in the games that count, and its best win by place. */
export type TeamWeek = {
  wins: number;
  losses: number;
  ties: number;
  /** The best-placed club it beat this week, and that club's place on the board. */
  bestWin?: { teamId: string; place: number };
};

/**
 * One club's week just played (`WEEK_DAYS` before `today`), from any games that hold its own, with
 * the board's rows for its best win; null for a week it played no game that counts.
 */
export const teamWeek = (
  teamId: string,
  games: readonly ScoutGame[],
  rows: readonly ScoutRankingRow[],
  today: string
): TeamWeek | null => {
  const since = shiftIsoDay(today, -WEEK_DAYS);
  const placeById = new Map(rows.map((row) => [row.teamId, placeOf(row)]));
  const week: TeamWeek = { wins: 0, losses: 0, ties: 0 };
  let any = false;
  for (const game of games) {
    if (game.teamAId !== teamId && game.teamBId !== teamId) continue;
    if (game.teamAId === game.teamBId) continue;
    if (game.date === undefined || game.date < since || game.date >= today) continue;
    if (!countsTowardRating(game, today)) continue;
    any = true;
    // Its own schedule's word, as its record on the board reads it.
    const { own, opponent: theirs } = ownScore(game, teamId);
    const opponent = game.teamAId === teamId ? game.teamBId : game.teamAId;
    if (own === theirs) week.ties += 1;
    else if (own < theirs) week.losses += 1;
    else {
      week.wins += 1;
      const place = placeById.get(opponent);
      if (place !== undefined && (week.bestWin === undefined || place < week.bestWin.place))
        week.bestWin = { teamId: opponent, place };
    }
  }
  return any ? week : null;
};
