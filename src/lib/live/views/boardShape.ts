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
 * 1: the boards as L2 first built them. 2: a league team said not to be in Team Rankings carried
 * onto a club of its own (`offClubIdFor`), not onto a club of its name.
 */
export const BOARD_RULES = 2;

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
 * A board as published (`publishViews`).
 * - `past`: the board a week before, as the page's arrows read it: the day it stood on, and
 *   whether anyone was on it in the whole year then, which decides whether a club with no `was`
 *   is new or the half had not begun. Empty for a page too young to rank, as the worker's answer
 *   is, and left out by a build not asked for it (`past: false`).
 * - `history`: the page's own club's place week by week, oldest first and ending a week ago, as
 *   the page's rank line walks it (`useRankingsWorker`), for the club the page names as its own.
 */
export type BoardView = {
  rows: BoardRow[];
  past?: { asOf: string; empty: boolean };
  history?: { teamId: string; points: HistoryPoint[] };
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

/**
 * A published board as read back, or null when any row of it is not one (`isBoardRow`), or what
 * it says of last week or the rank line is not what it should be.
 */
export const coerceBoardView = (raw: unknown): BoardView | null => {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return null;
  const rows: unknown[] = raw.rows;
  if (!rows.every(isBoardRow)) return null;
  const past = raw.past === undefined ? undefined : pastOf(raw.past);
  const history = raw.history === undefined ? undefined : historyOf(raw.history);
  if (past === null || history === null) return null;
  return { rows, ...(past ? { past } : {}), ...(history ? { history } : {}) };
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
