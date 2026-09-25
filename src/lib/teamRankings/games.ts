/**
 * When two rows are the same game.
 *
 * The pool collects the same fixture from several directions: both clubs' GameChanger schedules,
 * a pasted list, and the league's own results copied across. They arrive with different ids,
 * sometimes different dates, and one side often has the score while the other does not — so "the
 * same game" has to be decided on what the rows say rather than on anything either of them
 * carries as an identifier.
 *
 * Split out of `teamRankings.ts` because this is a closed question over a list of games and
 * nothing else in the pool: no ratings, no age arithmetic, no roster. `teamRankings.ts`
 * re-exports it, so no caller changed.
 */
import { normalizeDateInput, todayIsoDay } from "../date";
import { isDatedAhead } from "../deletedGames";
import { isScoutGamePlayed, type ScoutGame } from "./types";

/**
 * The id prefix a game derived from a League Standings fixture carries.
 *
 * Here because it is how a row says where it came from, which is the question this module exists
 * to answer: a league-derived row and a pulled row can describe the same fixture, and which one
 * survives a collapse depends on knowing which is which.
 */
export const LEAGUE_GAME_PREFIX = "league_";

/**
 * Whether a game feeds the ratings and records: it has to have been played, not be one of the
 * cross-age tournament games kept only for the record, and not be dated in a day that has not
 * happened yet. Every ranking calculation goes through this, so there is one answer to the
 * question rather than four filters that can drift apart.
 *
 * The date is here because "played" used to mean nothing more than "both scores are numbers", and
 * a pull brings back rows that carry a score on a date still to come — a schedule somebody filled
 * in ahead, or a club that exists only on paper. You cannot score a game early; this is sports. A
 * single 20-0 dated eight months out was enough to take a club's rating from 0.29 to 2.61, and it
 * went on doing that until somebody noticed it in Pool Health and deleted it. Now it never counts,
 * and Pool Health still lists it so it can be cleared out for good.
 *
 * `today` defaults to the clock, which is what makes the rule hold at every call site rather than
 * at the few that remember to ask. It is an ISO day, the shape a pool game's date is stored in, so
 * the two compare as strings; tests pass their own.
 */
export const countsTowardRating = (game: ScoutGame, today: string = todayIsoDay()): boolean =>
  isScoutGamePlayed(game) && game.excluded !== true && !isDatedAhead(game, today);

export const scoreOf = (game: ScoutGame, teamId: string): number | undefined =>
  game.teamAId === teamId ? game.teamAScore : game.teamBScore;

/**
 * The score one side's own schedule gave it — its runs, then its opponent's — or undefined for a
 * game not played. Side B reads `reportedByB` where its schedule said something different, so
 * neither club's page shows the other's version of its own game.
 */
export const scoreSeenBy = (
  game: ScoutGame,
  teamId: string
): { own: number; opponent: number } | undefined => {
  if (game.teamAScore === undefined || game.teamBScore === undefined) return undefined;
  if (game.teamAId === teamId) return { own: game.teamAScore, opponent: game.teamBScore };
  const seen = game.reportedByB ?? game;
  return { own: seen.teamBScore!, opponent: seen.teamAScore! };
};

/** A game with side B's own report taken off, for a score that now answers for both clubs. */
export const withoutReportedByB = (game: ScoutGame): ScoutGame => {
  if (game.reportedByB === undefined) return game;
  const { reportedByB: _dropped, ...rest } = game;
  return rest;
};

/**
 * A game with a score typed in by hand: the one answer for both clubs.
 *
 * Side B's report goes, and so does the mark that the score was borrowed from side B — the tidy
 * takes a borrowed score off with side B's row (`bareRow`), which took the typed score with it. The
 * record of each row side B's schedule filed for it that carried a score is given the typed score
 * from that club's seat, or the next tidy stands that row up again and puts its old score back
 * beside this one. The record keeps the row, so the regroup still finds it; the club's next pull
 * brings its schedule's score back in, as it does for any game.
 */
export const withScoreTyped = (
  game: ScoutGame,
  teamAScore: number,
  teamBScore: number
): ScoutGame => {
  const { scoreFromB: _borrowed, ...rest } = withoutReportedByB(game);
  const alsoRows = game.alsoRows?.map((record) =>
    record.onSideB && record.ownScore !== undefined
      ? { ...record, ownScore: teamBScore, opponentScore: teamAScore }
      : record
  );
  return { ...rest, teamAScore, teamBScore, ...(alsoRows ? { alsoRows } : {}) };
};

/**
 * Side A's margin as the rating reads it: the one score, or where the two clubs' schedules
 * disagree, the average of the two — the game counts once, and neither schedule is taken at its
 * word over the other. Undefined for a game not played.
 */
export const ratedMargin = (game: ScoutGame): number | undefined => {
  if (game.teamAScore === undefined || game.teamBScore === undefined) return undefined;
  const margin = game.teamAScore - game.teamBScore;
  const other = game.reportedByB;
  return other ? (margin + other.teamAScore - other.teamBScore) / 2 : margin;
};

const MINUTE_MS = 60_000;

/** A start as an instant, or undefined when there is none or it is not a time. */
const instantOf = (startTs: string | undefined): number | undefined => {
  if (startTs === undefined) return undefined;
  const at = Date.parse(startTs);
  return Number.isFinite(at) ? at : undefined;
};

/** Minutes between two starts; undefined when either is missing or is not a time. */
export const minutesApart = (a: string | undefined, b: string | undefined): number | undefined => {
  const x = instantOf(a);
  const y = instantOf(b);
  return x === undefined || y === undefined ? undefined : Math.abs(x - y) / MINUTE_MS;
};

/** A start rounded to its minute, so an index can be keyed on what `sameStart` compares. */
export const startMinuteOf = (startTs: string | undefined): number | undefined => {
  const at = instantOf(startTs);
  return at === undefined ? undefined : Math.round(at / MINUTE_MS);
};

/**
 * Whether two rows give the same start: the same minute, to the nearest.
 *
 * Read as instants rather than as equal strings. The pool of 24 September 2026 stores every start
 * in one spelling, but 1,013 of its rows start at an odd second or millisecond, and 54 pairs of rows
 * between the same two clubs on the same day were under a minute apart — 12 of them off one
 * schedule, which is one game listed twice however the strings compare. The nearest minute rather
 * than "under a minute apart" so that an index keyed on `startMinuteOf` finds exactly the pairs this
 * matches. A start that is not a time matches only its own spelling.
 */
export const sameStart = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  const x = startMinuteOf(a);
  const y = startMinuteOf(b);
  return x === undefined || y === undefined ? a === b : x === y;
};

/**
 * How far apart two clubs' schedules can put one game and still mean it.
 *
 * A start on a schedule is when the game was planned, not when it began: a tournament runs behind
 * and nobody moves the placeholder, so the two coaches' copies of one game drift apart. On the pool
 * of 24 September 2026, 1,213 pairs of rows off two schedules gave the same pair of clubs the same
 * result on the same day at different starts, and 1,115 of them were an hour apart or less; the
 * same search a week off, where no game is, found 7. A game runs longer than an hour, so two
 * starts within one of each other on two schedules are one game — inclusive, because the pair that
 * brought this to light, Legacy Baseball Club and River City Raptors, was exactly sixty minutes out.
 *
 * One club's own schedule is held to more. The same pool had 109 pairs of rows off one schedule,
 * against one opponent, exactly an hour apart with two different results — 23-6 and 12-2 — which
 * is a doubleheader written down at its slot times, so there the hour only counts where the two
 * rows give the same result. Of 212 such scored pairs within the hour, 34 did (16%); of 6,044 two
 * hours or more apart, which are doubleheaders, 81 did (1.3%). A repeated result that much more
 * often than doubleheaders produce one is the same game listed twice.
 */
export const ONE_GAME_WINDOW_MINUTES = 60;

export const startsWithinTheHour = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  const gap = minutesApart(a, b);
  return gap === undefined ? a === b : gap <= ONE_GAME_WINDOW_MINUTES;
};

/**
 * Finds an existing game that looks like the same game as `candidate` — same two teams (in either
 * order), same date, same score. That is the shape a double-entry takes, whether it came from
 * typing a game twice, importing a screenshot twice, or re-entering one the league schedule
 * already supplied. Two scoreless scheduled games on the same date count as a match too, since
 * "no score yet" is the same on both sides.
 */
/** The two sides of a game as one order-free key, so A-vs-B and B-vs-A compare equal. */
export const pairKeyOf = (game: ScoutGame): string =>
  [game.teamAId, game.teamBId].slice().sort().join("|");

export const findDuplicateGame = (candidate: ScoutGame, games: ScoutGame[]): ScoutGame | null => {
  const pairKey = pairKeyOf(candidate);
  const found = games.find((game) => {
    if (game.id === candidate.id) return false;
    if (game.ageGroupId !== candidate.ageGroupId) return false;
    if (pairKeyOf(game) !== pairKey) return false;
    if ((game.date ?? "") !== (candidate.date ?? "")) return false;
    return (
      scoreOf(game, candidate.teamAId) === candidate.teamAScore &&
      scoreOf(game, candidate.teamBId) === candidate.teamBScore
    );
  });
  return found ?? null;
};

/**
 * One fixture's identity: the age group, the two sides in either order, and the calendar day.
 *
 * The day is what decides it. Two clubs that meet again in October are not playing the same game
 * over — that is a tournament meeting outside league play, and it has to stay a game of its own.
 * Dates run through `normalizeDateInput` because the two sources spell a day differently: the
 * league keeps month-and-day ("4/12") while a pulled game keeps an ISO date ("2027-04-12"), so a
 * raw string compare would never match the pair it is meant to catch.
 *
 * Returns "" for a game with no readable date, which callers read as "this one cannot be matched"
 * — better to leave a dateless game alone than to fold it into a fixture it may not belong to.
 */
const fixtureKeyOf = (game: ScoutGame): string => {
  const day = normalizeDateInput(game.date ?? "");
  return day ? `${game.ageGroupId}|${pairKeyOf(game)}|${day}` : "";
};

/**
 * Collapses a league-derived game and the stored game that is the same real fixture down to one
 * row.
 *
 * Team Rankings pools two sources: `deriveLeagueScoutGames` rebuilds a row for every League
 * Standings matchup on every render, and a GameChanger pull stores rows of its own. A club that
 * pulls the schedule of a team playing in a league it also tracks here ends up holding the same
 * real fixture twice, and once it goes final both copies carry a score — so the rating fits it
 * twice and the record counts the win twice. Filling in a league game from a pull is wanted;
 * adding a second league game is not.
 *
 * Which copy survives follows from which one is actually evidence:
 *  - Every league row for the fixture already scored: the league's own book is authoritative for
 *    its own games, so the league rows stay and the stored duplicates go.
 *  - Otherwise the stored row carries the only result anyone has, so it stays and the league row
 *    it stands in for — an unscored one first, since that is the row with nothing in it — goes.
 *    League rows beyond the number of stored rows stay put, so a fixture nobody has a result for
 *    still shows up as scheduled.
 *
 * Only a league row triggers any of this. Two stored games between the same pair on the same day
 * with no league row are a doubleheader somebody logged twice on purpose, and both are kept; a
 * doubleheader that the league *does* carry is resolved by count rather than by guessing which
 * stored row pairs with which league row, because nothing in either source says.
 */
export const dedupeLeagueFixtures = (games: ScoutGame[]): ScoutGame[] => {
  // Indexed in a single pass rather than scanned per game: this runs on every render over a pool
  // that can hold tens of thousands of rows, and comparing each game against all the others would
  // not survive that.
  const byFixture = new Map<string, { league: number[]; stored: number[] }>();
  games.forEach((game, index) => {
    const key = fixtureKeyOf(game);
    if (!key) return;
    let bucket = byFixture.get(key);
    if (!bucket) {
      bucket = { league: [], stored: [] };
      byFixture.set(key, bucket);
    }
    (game.id.startsWith(LEAGUE_GAME_PREFIX) ? bucket.league : bucket.stored).push(index);
  });

  const dropped = new Set<number>();
  byFixture.forEach(({ league, stored }) => {
    // A fixture only one source knows about is not a duplicate of anything.
    if (league.length === 0 || stored.length === 0) return;

    if (league.every((index) => isScoutGamePlayed(games[index]!))) {
      stored.forEach((index) => dropped.add(index));
      return;
    }

    // Unscored league rows are the ones the stored rows are standing in for, so they go first.
    const emptiestFirst = league
      .slice()
      .sort((a, b) => Number(isScoutGamePlayed(games[a]!)) - Number(isScoutGamePlayed(games[b]!)));
    emptiestFirst.slice(0, stored.length).forEach((index) => dropped.add(index));
  });

  // The common case is a pool with nothing to collapse; hand back the same array so callers that
  // memoize on identity are not re-run for a list that did not change.
  if (dropped.size === 0) return games;
  return games.filter((_, index) => !dropped.has(index));
};
