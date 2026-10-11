import type { ScoutRankingRow, SeasonSegment } from "../../teamRankings";

/**
 * What a published board is, as both its publisher and a member's device read it: its key, its
 * shape and the check of that shape, and how a device puts its own star on its rows. Kept apart
 * from the builder (`board.ts`), which imports the pool's derivation and codec, so a page that
 * only reads boards pays for neither. It imports types alone.
 */

/**
 * The version of the rules that turn a stored pool into boards, raised by any change meant to move
 * a board's numbers, rows or order: the commit that says so under "Pin, then change" raises it too,
 * and `boardParity.test.ts` keeps one fingerprint of the fixture's boards for each. A publish of
 * boards records it (`BuiltFrom.rules`), and one under older rules than the boards already
 * published writes nothing, so code left running after a failed deploy cannot undo newer boards.
 * It only ever goes up: undoing a change that raised it raises it again, with a fingerprint of its
 * own, or every publish after would be refused as older. What a row says about its club beside
 * its numbers (`BoardFacts`) moves no number, row or order, so it raises nothing here; a change to
 * that shape raises `LIVE_SCHEMA`.
 *
 * It was raised once without moving anything, to 3, as a barrier to the publishers from before the
 * boards' shape (`BOARD_SHAPE`). Those know nothing of a shape. One still running once the boards
 * carried a fit (a rebuild or a nightly on the older build, a GitHub re-run of an older run, which
 * checks out that run's own commit, or a rollback) found the boards stale or current by their rules
 * alone, which were its own, so its publish was let through: it wrote boards with no fit over them,
 * and a meta that had dropped the shape it could not read, and members went without what each game
 * did until a publisher of the new build ran again (found by Codex on #371). A raise of the rules is
 * the one thing such a publisher stands aside for, its rebuild before it builds and its publish
 * before it writes, and neither its rebuilds nor its nightly count that as a failure. So 3 moved no
 * number, row or order, and `boardParity.test.ts` holds it to 2's fingerprint. A device of a build
 * from before it labels the boards as built by another version of the app (`liveLabel`) until it
 * loads a newer build, which is so.
 *
 * A later change of shape needs no such raise: every build that records the shape refuses a publish
 * of an older shape than the boards published, as it refuses one under older rules.
 *
 * 1: the boards as L2 first built them. 2: a league team said not to be in Team Rankings carried
 * onto a club of its own (`offClubIdFor`), not onto a club of its name. 3: nothing moved; raised so
 * that the publishers from before the boards' shape stand aside for boards that carry a fit
 * (`BOARD_SHAPE` 1).
 */
export const BOARD_RULES = 3;

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

/** A week of a club's place, oldest first in a rank line; null where it was not on the board. */
export type HistoryPoint = { asOf: string; rank: number | null };

/**
 * The version of a board's `fit` (`BoardFit.v`), raised by any change to what its fields hold or
 * mean. A device works out what each game did only from a fit of its own build's version, and
 * leaves one of any other alone, which costs it the lines and never the board.
 */
export const BOARD_FIT_VERSION = 1;

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
  fit?: BoardFit;
};

type FieldKind = "string" | "number" | "boolean" | "number?";

/**
 * What each field of a ranking row must be. Every field of `ScoutRankingRow`, whether or not the
 * board draws it today, so a row this check passes is a row the board can read whole: the compiler
 * holds the list to the type, and a field added to the row fails the build here until it is
 * listed.
 *
 * The first check of a saved board asked only for the id, name, rank and rating, and Codex's
 * review of #340 found the hole: a row cut short in storage, or kept by a build whose rows lacked
 * `pointRating`, passed, and the board's `formatRating(row.pointRating)` threw on it.
 */
const ROW_FIELDS: { [K in keyof ScoutRankingRow]-?: FieldKind } = {
  overallRank: "number?",
  teamId: "string",
  teamName: "string",
  isMine: "boolean",
  rank: "number",
  rating: "number",
  pointRating: "number",
  record: "string",
  wins: "number",
  losses: "number",
  ties: "number",
  games: "number",
  rawMargin: "number",
  strengthOfSchedule: "number",
  sosRank: "number",
  ageLevel: "number?",
  crossAgeGames: "number",
  componentSize: "number",
  componentId: "string",
  comparable: "boolean",
  fromGameChanger: "boolean",
};

/** What each fact a published row may carry must be, when it is there. */
const FACT_FIELDS: { [K in keyof BoardFacts]-?: (value: unknown) => boolean } = {
  city: (value) => typeof value === "string" && value !== "",
  state: (value) => typeof value === "string" && value !== "",
  league: (value) => value === true,
  was: (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
};

const holds = (record: Record<string, unknown>, field: string, kind: FieldKind): boolean => {
  const value = record[field];
  return kind === "number?"
    ? value === undefined || typeof value === "number"
    : typeof value === kind;
};

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/** Whether `raw` is a ranking row a board can draw whole, star and all (`ROW_FIELDS`). */
export const isRankingRow = (raw: unknown): raw is ScoutRankingRow =>
  isRecord(raw) && Object.entries(ROW_FIELDS).every(([field, kind]) => holds(raw, field, kind));

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
    points.push({ asOf: point.asOf, rank: point.rank as number | null });
  }
  return { teamId: raw.teamId, points };
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

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
  return {
    rows,
    ...(past ? { past } : {}),
    ...(history ? { history } : {}),
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
