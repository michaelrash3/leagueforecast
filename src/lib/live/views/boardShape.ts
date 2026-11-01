import type { Weekly, WeeklyGame, WeeklyStreak, WeeklyUpset } from "../../theWeekly";
import type { ScoutRankingRow, SeasonSegment } from "../../teamRankings";

/**
 * What a published board is, as both its publisher and a member's device read it: its key, its
 * shape and the check of that shape, and how a device puts its own star on its rows. Kept apart
 * from the builder (`board.ts`), which imports the pool's derivation and codec, so a page that
 * only reads boards pays for neither. It imports types alone, besides two parts of it League
 * Standings reads as it starts, which are modules of their own so that the first download carries
 * only those: the version of the rules the boards are built by (`boardRules.ts`) and the check of a
 * stored row (`rankingRow.ts`).
 */

export { BOARD_RULES } from "./boardRules";

/**
 * The shape of the boards this build publishes, raised when a board gains something a device of
 * this build reads and a device of an older build can leave unread. The publish of the boards
 * records it (`BuiltFrom.shape`), and the republish after a deploy publishes the boards again at
 * once over boards recorded under an older shape, or under none (`needsRepublish`), so what the
 * new build adds is on every board as soon as the build is out rather than after the next save's
 * rebuild or the night's. Devices never read it: a board of any shape reads as one
 * (`coerceBoardView`).
 *
 * A change older builds could not read raises `LIVE_SCHEMA` instead, and one that moves a number,
 * row or order raises `BOARD_RULES`.
 *
 * An addition that can wait a night need not raise it, since the boards are built again for each
 * new members' day (`boardsState`): the start of The Weekly's game ahead (`WeeklyGame.start`, 1
 * November 2026) raised nothing, so that the deploy reads nothing more for it. It goes on each
 * board with the boards' next rebuild or the night's, where a raise would have had the republish
 * after the deploy read the whole cloud copy at once, to put a time beside a day.
 *
 * 0, or none recorded: the boards before it. 1: each board carries what its rows' games were
 * fitted against (`BoardFit`).
 */
export const BOARD_SHAPE = 1;

/** The family of views the boards are: every key under this prefix (`boardKey`). */
export const BOARD_FAMILY = "board:";

/** A board's span: the whole squad year, or one half of it. */
export type BoardHalf = "year" | SeasonSegment;

/** Every span a page has a board for, each the `segment` the worker is asked with. */
export const BOARD_HALVES: ReadonlyArray<{ half: BoardHalf; segment: SeasonSegment | undefined }> =
  [
    { half: "year", segment: undefined },
    { half: "fall", segment: "fall" },
    { half: "spring", segment: "spring" },
  ];

/**
 * A board's key in `live/meta`: `board:{year}:{page}:{half}`, the year first so a device can ask
 * for one squad year's boards, and "none" for a page with no year, as its games' shard is named.
 */
export const boardKey = (year: number | undefined, pageId: string, half: BoardHalf): string =>
  `board:${year ?? "none"}:${pageId}:${half}`;

/**
 * What a published row says about its club beside its numbers, each as the page reads it off the
 * roster of the page's year: its town and its state, which the page shows with its name and ranks
 * its state's top ten and state filter by, and whether its games on this page came from a League
 * Standings season (`leagueTeamIdsOn`), which the page badges. A field the club has none of is
 * left out, as is `league` for a club with no league game here.
 *
 * `was` is its place on the board a week before (`BoardView.past`), as the page's movement arrows
 * read it (`ranksAsOf`), left out for a club that was not on it.
 */
export type BoardFacts = { city?: string; state?: string; league?: true; was?: number };

/** A board's row as published: the owner's star left for each member's device to set. */
export type BoardRow = Omit<ScoutRankingRow, "isMine"> & BoardFacts;

/**
 * A week of a club's place, oldest first in a rank line; null where it was not on the board. `of`
 * is how many clubs that week's board held (`RankLinePoint.of`); a board published before it was
 * counted has none, and an older build drops it unread.
 */
export type HistoryPoint = { asOf: string; rank: number | null; of?: number };

/**
 * The version of a board's `fit` (`BoardFit.v`), raised by any change to what its fields hold or
 * mean. A device works out what each game did only from a fit of its own build's version, and
 * leaves one of any other alone, which costs it the lines and never the board.
 *
 * 1: the fit as it first went out. 2: a game's age gap read through each level's step
 * (`ageGapYears`, `AGE_STEP_RUNS`) rather than the plain difference in levels, which a device of an
 * older build would work its games out with and find matching nothing (found by Codex on #379).
 * 3: a club's virtual games played at its starting level (its row's `levelPrior`) rather than at
 * nought (board rules 7), which a device of an older build would leave out of the rating it
 * rebuilds, and then either find matching nothing or, for a club whose start is near average and
 * whose record is long, draw lines a hair off the fit's.
 */
export const BOARD_FIT_VERSION = 3;

/**
 * What the fit a board's rows were cut from read beyond the rows themselves (`boardFitOf`): the
 * numbers a device needs to work out, from the board and a club's card alone, what each of the
 * club's games did to its rating.
 * - `v`: `BOARD_FIT_VERSION`.
 * - `day`: the members' day the board was built for, which decided whether a game had been played
 *   yet (`countsTowardRating`). The board's own, since the meta's day (`LiveMeta.today`) can be a
 *   later publish's.
 * - `scale`, `middle`, `errors`: the discount from the fit's rating to the one shown, the residual
 *   scale (`residualScale`), the centre of the clubs' spreads (`discountMiddle`) and how many
 *   standard errors (`EVIDENCE_STANDARD_ERRORS`).
 * - `gapRuns`, `cap`, `shrink`: the runs a year of age gap was worth (`ageGapRuns`), the most one
 *   game's margin counts (`RATING_CAP`) and the ridge (`DEFAULT_SHRINKAGE`).
 * - `recency`: what each game's weight was built from (`recencyBasisFor`), or null where the
 *   games were weighed alike.
 * - `away`: every side a row's rated game names that has no row on this board (a club known only
 *   from somebody else's schedule, a stand-in, a club at home on another page of the pool), with
 *   its fitted rating to 4 places and its rated games, in three lists of one length. With the rows
 *   it is every opponent of every row's rated games, which is what lets a device tell the games
 *   the fit read from the rest without the roster.
 */
export type BoardFit = {
  v: number;
  day: string;
  scale: number;
  middle: number;
  errors: number;
  gapRuns: number;
  cap: number;
  shrink: number;
  recency: { halfLifeDays: number; newest: string; mean: number } | null;
  away: { ids: string[]; ratings: number[]; games: number[] };
};

/**
 * A board as published (`publishViews`).
 * - `past`: the board a week before, as the page's arrows read it: the day it stood on, and
 *   whether anyone was on it in the whole year then, which decides whether a club with no `was`
 *   is new or the half had not begun. Empty for a page too young to rank, as the worker's answer
 *   is, and left out by a build not asked for it (`past: false`).
 * - `history`: the page's own club's place week by week, oldest first and ending a week ago, as
 *   the page's rank line walks it (`useRankingsWorker`), for the club the page names as its own.
 * - `weekly`: the page's week (`theWeekly`): the upsets of the week just played, the game of the
 *   week ahead and the winning streaks still running, on a board with rows. One this build cannot
 *   read is dropped and the board still reads, as an older build drops it unread. A build from
 *   before the game ahead's start (`WeeklyGame.start`) passes over it, reading the game's other
 *   fields by name, and says the game by its day as it always did.
 * - `fit`: what its rows' games were fitted against (`BoardFit`), left out of a board with no
 *   rows. It raised no `LIVE_SCHEMA`: a device of an older build rebuilds a board field by field
 *   (`coerceBoardView`) and so drops it unread, and a board without it draws exactly as before.
 *   The app and the boards' publishers deploy apart, and a raise would have shown every device of
 *   the new build a notice in place of the boards until the publishers caught up, and told every
 *   older one to reload. It carries its own version (`BOARD_FIT_VERSION`) instead, a fit this build
 *   cannot read is dropped while the board still reads, and the boards' shape (`BOARD_SHAPE`) has
 *   the republish after a deploy put it on every board at once.
 */
export type BoardView = {
  rows: BoardRow[];
  past?: { asOf: string; empty: boolean };
  history?: { teamId: string; points: HistoryPoint[] };
  weekly?: Weekly;
  fit?: BoardFit;
};

/* The check of a stored row is a module of its own; a published row's check below builds on it. */
import { holds, isRecord, ROW_FIELDS } from "./rankingRow";
export { isRankingRow } from "./rankingRow";

/** What each fact a published row may carry must be, when it is there. */
const FACT_FIELDS: { [K in keyof BoardFacts]-?: (value: unknown) => boolean } = {
  city: (value) => typeof value === "string" && value !== "",
  state: (value) => typeof value === "string" && value !== "",
  league: (value) => value === true,
  was: (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
};

/**
 * Whether `raw` is a published board's row: every field of a ranking row but the star, which a
 * published row never carries, and each fact it carries what that fact should be. A field this
 * build does not know is let through, so a newer publisher's addition does not hide the board.
 */
export const isBoardRow = (raw: unknown): raw is BoardRow =>
  isRecord(raw) &&
  raw.isMine === undefined &&
  Object.entries(ROW_FIELDS).every(
    ([field, kind]) => field === "isMine" || holds(raw, field, kind)
  ) &&
  Object.entries(FACT_FIELDS).every(
    ([field, valid]) => raw[field] === undefined || valid(raw[field])
  );

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isPlace = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const pastOf = (raw: unknown): BoardView["past"] | null => {
  if (!isRecord(raw) || typeof raw.asOf !== "string" || !ISO_DAY.test(raw.asOf)) return null;
  return typeof raw.empty === "boolean" ? { asOf: raw.asOf, empty: raw.empty } : null;
};

const historyOf = (raw: unknown): BoardView["history"] | null => {
  if (!isRecord(raw) || typeof raw.teamId !== "string" || raw.teamId === "") return null;
  if (!Array.isArray(raw.points)) return null;
  const points: HistoryPoint[] = [];
  for (const point of raw.points as unknown[]) {
    if (!isRecord(point) || typeof point.asOf !== "string" || !ISO_DAY.test(point.asOf))
      return null;
    if (point.rank !== null && !isPlace(point.rank)) return null;
    if (point.of !== undefined && !isPlace(point.of)) return null;
    points.push({
      asOf: point.asOf,
      rank: point.rank as number | null,
      ...(point.of === undefined ? {} : { of: point.of as number }),
    });
  }
  return { teamId: raw.teamId, points };
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRuns = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isDay = (value: unknown): value is string => typeof value === "string" && ISO_DAY.test(value);

const isChance = (value: unknown): value is number => isNumber(value) && value > 0 && value < 1;

const upsetOf = (raw: unknown): WeeklyUpset | null =>
  isRecord(raw) &&
  isId(raw.winnerId) &&
  isId(raw.loserId) &&
  isRuns(raw.winnerRuns) &&
  isRuns(raw.loserRuns) &&
  isDay(raw.date) &&
  isChance(raw.chance)
    ? {
        winnerId: raw.winnerId,
        loserId: raw.loserId,
        winnerRuns: raw.winnerRuns,
        loserRuns: raw.loserRuns,
        date: raw.date,
        chance: raw.chance,
      }
    : null;

/** A start as the published lists carry one: whole minutes since 1970 (`startMinutes`). */
const isMinute = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

/**
 * The game ahead as published. Its start is read where it is there, and one that is not whole
 * minutes leaves the week unread, as any other field of it that is not what it should be does.
 */
const aheadOf = (raw: unknown): WeeklyGame | null | undefined => {
  if (raw === null) return null;
  return isRecord(raw) &&
    isId(raw.teamAId) &&
    isId(raw.teamBId) &&
    isDay(raw.date) &&
    isChance(raw.chanceA) &&
    isNumber(raw.margin) &&
    (raw.start === undefined || isMinute(raw.start))
    ? {
        teamAId: raw.teamAId,
        teamBId: raw.teamBId,
        date: raw.date,
        chanceA: raw.chanceA,
        margin: raw.margin,
        ...(raw.start === undefined ? {} : { start: raw.start as number }),
      }
    : undefined;
};

/** A board's week as published, or undefined for one this build cannot read (`BoardView`). */
const weeklyOf = (raw: unknown): Weekly | undefined => {
  if (!isRecord(raw) || !isDay(raw.asOf)) return undefined;
  if (!Array.isArray(raw.upsets) || !Array.isArray(raw.streaks)) return undefined;
  const upsets: WeeklyUpset[] = [];
  for (const one of raw.upsets as unknown[]) {
    const upset = upsetOf(one);
    if (!upset) return undefined;
    upsets.push(upset);
  }
  const streaks: WeeklyStreak[] = [];
  for (const one of raw.streaks as unknown[]) {
    if (!isRecord(one) || !isId(one.teamId) || !isPlace(one.wins)) return undefined;
    streaks.push({ teamId: one.teamId, wins: one.wins as number });
  }
  const ahead = aheadOf(raw.ahead);
  if (ahead === undefined) return undefined;
  return { asOf: raw.asOf, upsets, ahead, streaks };
};

const isPositive = (value: unknown): value is number => isNumber(value) && value > 0;

const basisOf = (raw: unknown): BoardFit["recency"] | undefined => {
  if (raw === null) return null;
  if (!isRecord(raw) || !isPositive(raw.halfLifeDays) || !isPositive(raw.mean)) return undefined;
  if (typeof raw.newest !== "string" || !ISO_DAY.test(raw.newest)) return undefined;
  return { halfLifeDays: raw.halfLifeDays, newest: raw.newest, mean: raw.mean };
};

const awayOf = (raw: unknown): BoardFit["away"] | null => {
  if (!isRecord(raw)) return null;
  const { ids, ratings, games } = raw;
  if (!Array.isArray(ids) || !Array.isArray(ratings) || !Array.isArray(games)) return null;
  if (ratings.length !== ids.length || games.length !== ids.length) return null;
  if (!ids.every((id) => typeof id === "string" && id !== "")) return null;
  if (!ratings.every(isNumber) || !games.every(isPlace)) return null;
  return { ids: ids as string[], ratings: ratings as number[], games: games as number[] };
};

/**
 * A board's `fit` as this build reads it, or null for anything else: another version, a number
 * that is not one, a day that is not an ISO day, or lists of different lengths, an empty id or a
 * count of games that is not a whole number above nought among the sides away.
 */
export const coerceBoardFit = (raw: unknown): BoardFit | null => {
  if (!isRecord(raw) || raw.v !== BOARD_FIT_VERSION) return null;
  const { day, scale, middle, errors, gapRuns, cap, shrink } = raw;
  if (typeof day !== "string" || !ISO_DAY.test(day)) return null;
  if (!isNumber(scale) || !isNumber(middle) || !isNumber(errors)) return null;
  if (!isNumber(gapRuns) || !isNumber(cap) || !isNumber(shrink)) return null;
  const recency = basisOf(raw.recency);
  const away = awayOf(raw.away);
  if (recency === undefined || !away) return null;
  return { v: BOARD_FIT_VERSION, day, scale, middle, errors, gapRuns, cap, shrink, recency, away };
};

/**
 * A published board as read back, or null when any row of it is not one (`isBoardRow`), or what
 * it says of last week or the rank line is not what it should be. A `fit` this build cannot read
 * (`coerceBoardFit`) is left out and the board read without it, since a board draws whole without
 * one: a later change to its shape must never hide a board from a device of this build.
 */
export const coerceBoardView = (raw: unknown): BoardView | null => {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return null;
  const rows: unknown[] = raw.rows;
  if (!rows.every(isBoardRow)) return null;
  const past = raw.past === undefined ? undefined : pastOf(raw.past);
  const history = raw.history === undefined ? undefined : historyOf(raw.history);
  if (past === null || history === null) return null;
  const fit = raw.fit === undefined ? null : coerceBoardFit(raw.fit);
  const weekly = raw.weekly === undefined ? undefined : weeklyOf(raw.weekly);
  return {
    rows,
    ...(past ? { past } : {}),
    ...(history ? { history } : {}),
    ...(weekly ? { weekly } : {}),
    ...(fit ? { fit } : {}),
  };
};

/**
 * Last week's places on a published board as the page's arrows read them (`movementOf`): null
 * with no board a week before, none at all when nobody was on it, and otherwise each club's place
 * on this page. The page reads every club of the year, and asks only of its own rows; when last
 * week's board had clubs but none on this page, a key no club has keeps the map from reading as
 * empty, so each row reads as new, as the page's does.
 */
export const lastWeekOf = (view: BoardView): Record<string, number> | null => {
  if (!view.past) return null;
  if (view.past.empty) return {};
  const ranks: Record<string, number> = {};
  for (const row of view.rows) if (row.was !== undefined) ranks[row.teamId] = row.was;
  return Object.keys(ranks).length > 0 ? ranks : { "": 0 };
};

/**
 * A published board's rows with this device's star on them, by the rule the rankings worker
 * marks its own rows by: the club the page names as its own (`AgeGroup.myTeamId`), or, where the
 * page names none, the roster's own mark (`legacyMine`, the ids of clubs marked `isMine`).
 */
export const withMine = (
  rows: readonly BoardRow[],
  myTeamId: string | undefined,
  legacyMine?: ReadonlySet<string>
): Array<BoardRow & { isMine: boolean }> =>
  rows.map((row) => ({
    ...row,
    isMine: myTeamId ? row.teamId === myTeamId : (legacyMine?.has(row.teamId) ?? false),
  }));

/**
 * A League Standings season page `page` claims: the club each of the season's teams is there, by
 * league team id (`team`) and club id (`club`), and the halves its games are in. Each team and its
 * club are a record, not a [team, club] pair: these sit in a list in the meta's own fields, and
 * Firestore keeps no list directly inside another. Pairs were what 1.6e first published, and
 * Firestore refused every save of the meta that carried them with an HTTP 400, first seen on the
 * night of 10 October 2026, after it shipped.
 */
export type LeagueOnPage = {
  page: string;
  season: string;
  clubs: Array<{ team: string; club: string }>;
  halves: SeasonSegment[];
};

/**
 * What the boards' publisher says of every page beside its boards, under `inline.pages` in
 * `live/meta`, so a device can lay out the page before it reads a board: when the roster was
 * last pulled from GameChanger (`latestImportedAt`), left out when never, and for each page how
 * many counted games each half holds (`countedByHalf`), which decides the half the page opens on
 * and what an empty half says.
 */
export type LivePages = {
  pulledAt?: string;
  halves: Record<string, Record<SeasonSegment, number>>;
  /**
   * Each page's League Standings seasons and their clubs (`deriveAllKnown`'s `leagueClubs` and
   * `leagueHalves`): what a board's places of those clubs are written under for League Standings'
   * "Our team" card (`leagueClubRanksFrom`), as the device's own board writes them.
   */
  league?: LeagueOnPage[];
  /**
   * The copy's age groups as its store holds them, for a device that holds no copy to lay the page
   * out by. Read through the store's own check (`coerceAgeGroups`) where they are used, as a copy's
   * are, so this module reads no more than that they are a list.
   */
  groups?: unknown[];
};

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** `inline.pages` as this build reads it, or null for anything else. */
export const coerceLivePages = (raw: unknown): LivePages | null => {
  if (!isRecord(raw) || !isRecord(raw.halves)) return null;
  const { pulledAt } = raw;
  if (
    pulledAt !== undefined &&
    (typeof pulledAt !== "string" || Number.isNaN(Date.parse(pulledAt)))
  )
    return null;
  const halves: LivePages["halves"] = {};
  for (const [pageId, counts] of Object.entries(raw.halves)) {
    if (!isRecord(counts) || !isCount(counts.fall) || !isCount(counts.spring)) return null;
    halves[pageId] = { fall: counts.fall, spring: counts.spring };
  }
  if (raw.groups !== undefined && !Array.isArray(raw.groups)) return null;
  let league: LeagueOnPage[] | undefined;
  if (raw.league !== undefined) {
    if (!Array.isArray(raw.league)) return null;
    league = [];
    for (const entry of raw.league) {
      const read = leagueOnPage(entry);
      if (!read) return null;
      league.push(read);
    }
  }
  return {
    ...(pulledAt === undefined ? {} : { pulledAt }),
    halves,
    ...(league === undefined ? {} : { league }),
    ...(raw.groups === undefined ? {} : { groups: raw.groups as unknown[] }),
  };
};

const isId = (value: unknown): value is string => typeof value === "string" && value !== "";

/** One season's clubs on a page, as `livePagesOf` writes them, or null. */
const leagueOnPage = (raw: unknown): LeagueOnPage | null => {
  if (!isRecord(raw) || !isId(raw.page) || !isId(raw.season)) return null;
  const { clubs, halves } = raw;
  if (!Array.isArray(clubs) || !Array.isArray(halves)) return null;
  const read: LeagueOnPage["clubs"] = [];
  for (const entry of clubs) {
    if (!isRecord(entry) || !isId(entry.team) || !isId(entry.club)) return null;
    read.push({ team: entry.team, club: entry.club });
  }
  if (!halves.every((half) => half === "fall" || half === "spring")) return null;
  return { page: raw.page, season: raw.season, clubs: read, halves: halves as SeasonSegment[] };
};
