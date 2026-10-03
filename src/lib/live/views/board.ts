import {
  ageGroupYear,
  fitScoutYearFor,
  rankingPoolGroupIds,
  rowsOfYearFit,
  scoutFitYear,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type ScoutYearFit,
  type SeasonSegment,
} from "../../teamRankings";
import {
  decodePoolGames,
  decodePoolTeams,
  encodeScoutGames,
  encodeScoutTeams,
} from "../../teamRankingsCompact";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "../allKnown";

/**
 * The rankings boards as a view: every page's table for the whole year and for each half, built
 * from the stored pool by the same functions, in the same order, as the rankings worker builds the
 * one on screen, so a server holding the cloud copy publishes the rows a browser would have drawn.
 * `boardParity.test.ts` holds the two to each other to the last digit of one JavaScript engine.
 * Engines round `0.5 ** x` differently in that digit, so across them the numbers agree to about the
 * fifteenth place, and clubs tied but for it can swap ranks: on seeds 1 to 40 of the test's
 * fixture, Node 22 and Node 24 put schedule ranks in a different order on 11, and the boards' own
 * ranks and row order never.
 *
 * Three things a server could get wrong that the browser never decides for itself:
 * - The day. A game scored on a day still to come rates nobody (`countsTowardRating`), and the
 *   worker reads that day off its own clock, in the browser's zone. Here it is an argument, and a
 *   server must pass the day its members are in, not its own.
 * - The pool's shape. The worker fits the pool after the trip through the compact codec the page
 *   ships it in (`asWorkerSees`), which marks slot-like names as placeholders and drops empty
 *   fields; raw arrays can rank a slot the worker hides.
 * - The locale. Rows that tie on rating and margin are put in name order by `localeCompare` with
 *   the runtime's own locale (`rankRows`), so a server must run under the browser's, en-US.
 */

/** The pool as the rankings worker holds it, after the codec the page ships it to the worker in. */
export const asWorkerSees = (
  teams: ScoutTeam[],
  games: ScoutGame[]
): { teams: ScoutTeam[]; games: ScoutGame[] } => ({
  teams: decodePoolTeams(encodeScoutTeams(teams)),
  games: decodePoolGames(encodeScoutGames(games)),
});

/**
 * The version of the rules that turn a stored pool into boards, raised by any change meant to move
 * a board's numbers, rows or order: the commit that says so under "Pin, then change" raises it too,
 * and `boardParity.test.ts` keeps one fingerprint of the fixture's boards for each. A publish of
 * boards records it (`BuiltFrom.rules`), and one under older rules than the boards already
 * published writes nothing, so code left running after a failed deploy cannot undo newer boards.
 * It only ever goes up: undoing a change that raised it raises it again, with a fingerprint of its
 * own, or every publish after would be refused as older.
 */
export const BOARD_RULES = 1;

/** A board's span: the whole squad year, or one half of it. */
export type BoardHalf = "year" | SeasonSegment;

/** Every span a page has a board for, each the `segment` the worker is asked with. */
export const BOARD_HALVES: ReadonlyArray<{ half: BoardHalf; segment: SeasonSegment | undefined }> =
  [
    { half: "year", segment: undefined },
    { half: "fall", segment: "fall" },
    { half: "spring", segment: "spring" },
  ];

/** One page's table for one span. */
export type PageBoard = { pageId: string; half: BoardHalf; rows: ScoutRankingRow[] };

/**
 * The age groups by id, the first of any repeated id winning, as the page finds one
 * (`ageGroups.find`). Ids are minted unique, but a hand-edited restore can repeat one.
 */
const groupsById = (ageGroups: AgeGroup[]): Map<string, AgeGroup> => {
  const byId = new Map<string, AgeGroup>();
  ageGroups.forEach((group) => {
    if (!byId.has(group.id)) byId.set(group.id, group);
  });
  return byId;
};

/**
 * The rating pools of a set of pages: the pages fitted together, each list as
 * `rankingPoolGroupIds` gives it, youngest first, in the order their first page is stored. Every
 * page of a squad year shares one pool, and a page with no year is a pool of its own. It is the
 * order the boards come out in, each page once: a repeated id has a tab for every copy, but every
 * one of them opens the same page, so it is listed once, in the first pool that names it.
 */
export const ratingPools = (ageGroups: AgeGroup[]): string[][] => {
  const seen = new Set<string>();
  const pools: string[][] = [];
  ageGroups.forEach((group) => {
    if (seen.has(group.id)) return;
    const pool = [...new Set(rankingPoolGroupIds(group.id, ageGroups))].filter(
      (id) => !seen.has(id)
    );
    pool.forEach((id) => seen.add(id));
    pools.push(pool);
  });
  return pools;
};

/**
 * Every board in a stored pool: each page, for the year and each half, as the worker answers the
 * page's request for it.
 *
 * Each page is asked as the page asks. What it knows is its own year's (`deriveAllKnown`, which
 * links League Standings teams off that year's stored games), derived once for each year with a
 * page and walking every age group each time, as the page does. Its pool is its own
 * (`rankingPoolGroupIds`), after the codec the worker's pool takes (`asWorkerSees`). Its fit is
 * `fitScoutYearFor` from the page itself, which gives a page too young to rank no rows, and its
 * star is the club it names as its own (`AgeGroup.myTeamId`), or the roster's own mark where it
 * names none. That star is the owner's; a view for every member is for its publisher to clear.
 *
 * The worker fits a pool once per half and cuts every page from that fit, so this does too: a fit
 * is shared by the pages that would hand `fitScoutYearFor` the same pool, the same games and the
 * same year, as the worker's cache shares one (`yearFitKey`). The year is the one the fit reads
 * (`scoutFitYear`), off the last age group of a page's id, where the page reads everything else off
 * the first; the two differ only when a restore repeats an id across years, and each is read where
 * its reader reads it.
 *
 * `gamesOfYear` is one squad year's stored games, `loadScoutGamesForYear`'s answer: the games of
 * the pages with no year when `year` is undefined.
 */
export const buildAllBoards = ({
  ageGroups,
  teams,
  gamesOfYear,
  readSeason,
  today,
}: {
  ageGroups: AgeGroup[];
  /** The stored roster, as `loadScoutTeams` decodes it. */
  teams: ScoutTeam[];
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  readSeason: SeasonReader;
  /** The day the members are in, as an ISO day. Never the server's own. */
  today: string;
}): PageBoard[] => {
  const known = new Map<number | undefined, ReturnType<typeof deriveAllKnown>>();
  const knownFor = (year: number | undefined) => {
    const held = known.get(year);
    if (held) return held;
    const derived = deriveAllKnown({ ageGroups, teams, yearGames: gamesOfYear(year), readSeason });
    known.set(year, derived);
    return derived;
  };
  const byId = groupsById(ageGroups);
  // Held for one rating pool at a time and let go before the next, as the worker lets a year's fit
  // go before it builds another (`rankingsProtocol.ts` measured one of 76,792 clubs at 44 MB).
  let shipped = new Map<string, { teams: ScoutTeam[]; games: ScoutGame[] }>();
  let fits = new Map<string, ScoutYearFit>();

  const boardOf = (pageId: string, half: BoardHalf, segment: SeasonSegment | undefined) => {
    const page = byId.get(pageId);
    const year = ageGroupYear(page);
    const poolIds = rankingPoolGroupIds(pageId, ageGroups);
    const poolKey = JSON.stringify([year ?? null, poolIds]);
    let pool = shipped.get(poolKey);
    if (!pool) {
      const allKnown = knownFor(year);
      pool = asWorkerSees(allKnown.teams, gamesOnPages(allKnown.games, poolIds));
      shipped.set(poolKey, pool);
    }
    const fitKey = JSON.stringify([
      poolKey,
      segment ?? null,
      scoutFitYear(pageId, ageGroups) ?? null,
    ]);
    let fit = fits.get(fitKey) ?? null;
    if (!fit) {
      fit = fitScoutYearFor(pageId, pool.teams, pool.games, ageGroups, segment, today);
      if (fit) fits.set(fitKey, fit);
    }
    // A fit shared with an older page still gives this one none if it is too young to rank.
    const rows = fit ? rowsOfYearFit(fit, pageId, page?.myTeamId, ageGroups) : [];
    return { pageId, half, rows };
  };

  return ratingPools(ageGroups).flatMap((pageIds) => {
    shipped = new Map();
    fits = new Map();
    return BOARD_HALVES.flatMap(({ half, segment }) =>
      pageIds.map((pageId) => boardOf(pageId, half, segment))
    );
  });
};

/** A board's row as published: the owner's star left for each member's device to set. */
export type BoardRow = Omit<ScoutRankingRow, "isMine">;
/** A board as published (`publishViews`). */
export type BoardView = { rows: BoardRow[] };

/**
 * A board's key in `live/meta`: `board:{year}:{page}:{half}`, the year first so a device can ask
 * for one squad year's boards, and "none" for a page with no year, as its games' shard is named.
 */
export const boardKey = (year: number | undefined, pageId: string, half: BoardHalf): string =>
  `board:${year ?? "none"}:${pageId}:${half}`;

/**
 * The boards as views to publish, each under its page's year, read as the page reads it (the
 * first age group of its id), and without `isMine`, which is the owner's star: every member's
 * device marks its own.
 */
export const boardViews = (
  ageGroups: AgeGroup[],
  boards: PageBoard[]
): Array<{ key: string; value: BoardView }> => {
  const byId = groupsById(ageGroups);
  return boards.map(({ pageId, half, rows }) => ({
    key: boardKey(ageGroupYear(byId.get(pageId)), pageId, half),
    value: { rows: rows.map(({ isMine: _mine, ...row }) => row) },
  }));
};
