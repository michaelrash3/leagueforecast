import { DEFAULT_SHRINKAGE } from "../../powerRating";
import { recencyBasisFor, type RecencyBasis } from "../../ratingRecency";
import {
  ageGroupYear,
  EVIDENCE_STANDARD_ERRORS,
  fitScoutYearFor,
  rankingPoolGroupIds,
  rowsOfYearFit,
  scoutFitRanks,
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
import { countedByHalf } from "../../teamRankings/halves";
import type { AutoRemovals } from "../../autoRemoved";
import { daysBefore, rankLineStep, ranksAsOf } from "../../rankMovement";
import {
  deriveAllKnown,
  gamesOnPages,
  leagueTeamIdsOn,
  type AllKnown,
  type SeasonReader,
} from "../allKnown";
import {
  BOARD_FIT_VERSION,
  BOARD_HALVES,
  boardKey,
  type BoardFacts,
  type BoardFit,
  type BoardHalf,
  type BoardView,
  type HistoryPoint,
  type LivePages,
} from "./boardShape";

export * from "./boardShape";

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
 * One page's table for one span, and what its arrows and rank line read: every club of the year's
 * place a week before (`past`), and the page's own club's places week by week (`history`).
 */
export type PageBoard = {
  pageId: string;
  half: BoardHalf;
  rows: ScoutRankingRow[];
  past?: { asOf: string; ranks: Record<string, number> };
  history?: { teamId: string; points: HistoryPoint[] };
  /** What the rows' games were fitted against (`boardFitOf`), on a board with rows. */
  fit?: BoardFit;
};

/**
 * Each fit's recency basis (`recencyBasisFor`), read off its rated games once however many boards
 * are cut from it, since every page of a pool shares its fit. On the 29 September 2026 backup the
 * basis of the 2027 year's 171,571 rated games took 110 ms to read, which each of its 11 pages
 * would otherwise pay again.
 */
const recencyOfFit = new WeakMap<ScoutYearFit, RecencyBasis | null | undefined>();

const recencyOf = (fit: ScoutYearFit): RecencyBasis | null | undefined => {
  if (recencyOfFit.has(fit)) return recencyOfFit.get(fit);
  // The very games, in the order, the fit's own weights were read off (`recencyWeightsFor`).
  const basis = recencyBasisFor(fit.rated.map(({ game }) => game));
  recencyOfFit.set(fit, basis);
  return basis;
};

/**
 * What the fit `rows` were cut from read beyond the rows themselves (`BoardFit`), for a board
 * built for the members' day `day`: its constants, the basis of its games' weights, and every side
 * a row's rated game names that has no row here, with that side's fitted rating and rated games.
 *
 * The sides away are found in one pass over the games the fit read (`ScoutYearFit.rated`), never
 * the pool: a game the fit left out (unplayed by `day`, outside the half, with a side the roster
 * lacks) names nobody a device needs, and one between two rows needs nothing beyond the rows. They
 * come in the order of the first game that names each. On the 29 September 2026 backup a pass
 * took at most 58 ms on a page of the 2027 year's 171,571 rated games, and every board's fit of a
 * full build 1.0 to 1.2 s together (Node 22), against about 50 s for the build. Indexing each
 * fit's opponents once, so a board walks only its own rows' games, saved a fifth of that and held
 * 16 MiB more while the pool was built, so it was left out.
 *
 * Each rating is rounded to 4 places, so a game's played-like rating worked out from it is within
 * 5e-5 of the fit's. At 3 places it was off by up to 5e-4 (measured on the same backup), and the
 * fourth place costs the largest board 4.2 KiB gzipped: its fit adds 54.0 KiB, against 49.8 KiB
 * at 3 places.
 *
 * Undefined for a board with no rows, which no device works anything out for, and for a fit
 * weighed by a scheme a game's date alone does not decide (`recencyBasisFor`), whose weights no
 * device could rebuild: such a board carries no fit rather than one that would mislead.
 */
export const boardFitOf = (
  fit: ScoutYearFit,
  rows: readonly ScoutRankingRow[],
  day: string
): BoardFit | undefined => {
  if (rows.length === 0) return undefined;
  const recency = recencyOf(fit);
  if (recency === undefined) return undefined;
  const onBoard = new Set(rows.map((row) => row.teamId));
  const away = new Set<string>();
  for (const { game } of fit.rated) {
    const aHere = onBoard.has(game.teamAId);
    if (aHere === onBoard.has(game.teamBId)) continue;
    away.add(aHere ? game.teamBId : game.teamAId);
  }
  const ids = [...away];
  const { adjusted } = fit;
  return {
    v: BOARD_FIT_VERSION,
    day,
    scale: adjusted.residualScale,
    middle: fit.middle,
    errors: EVIDENCE_STANDARD_ERRORS,
    gapRuns: adjusted.ageGapRuns,
    cap: adjusted.cap,
    shrink: DEFAULT_SHRINKAGE,
    recency: recency && { ...recency },
    away: {
      ids,
      // `|| 0` so a rating that rounds to nothing is 0, never -0.
      ratings: ids.map((id) => Math.round((adjusted.ratings.get(id) ?? 0) * 1e4) / 1e4 || 0),
      games: ids.map((id) => adjusted.games.get(id) ?? 0),
    },
  };
};

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
 * What a page's boards say of it beside their rows, built in the same pass from what the page
 * knows (`deriveAllKnown` for its year), each as the page reads it:
 * - `halves`: how many counted games each half of its pool holds (`countedByHalf` over the games
 *   its boards are fitted from, the page's own `segmentGames`).
 * - `league`: the clubs whose games on this page came from a League Standings season.
 * - `places`: each club of its year's town and state, off the roster as the page looks a row's
 *   club up (a map of every known club, the last of a repeated id winning).
 */
export type PageFacts = {
  halves: Record<SeasonSegment, number>;
  league: ReadonlySet<string>;
  places: ReadonlyMap<string, { city?: string; state?: string }>;
  /**
   * The League Standings seasons the page claims, each with the club each of its teams is on the
   * page and the halves its games are in (`deriveAllKnown`'s `leagueClubs` and `leagueHalves`).
   */
  seasons: ReadonlyMap<
    string,
    { clubs: ReadonlyMap<string, string>; halves: ReadonlySet<SeasonSegment> }
  >;
};

/** Every board in a stored pool, and what its pages say beside them. */
/**
 * The boards, what their pages say, and what each squad year with a page knows (`deriveAllKnown`),
 * derived once for the boards and kept for the views built beside them (`clubViews`).
 */
export type BoardsBuilt = {
  boards: PageBoard[];
  facts: Map<string, PageFacts>;
  known: ReadonlyMap<number | undefined, AllKnown>;
};

type BuildInput = {
  ageGroups: AgeGroup[];
  /** The stored roster, as `loadScoutTeams` decodes it. */
  teams: ScoutTeam[];
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  readSeason: SeasonReader;
  /** The clubs taken off as plainly made up (`loadAutoRemoved`), which no board shows. */
  autoRemoved: AutoRemovals;
  /** The day the members are in, as an ISO day. Never the server's own. */
  today: string;
  /**
   * Whether to work out last week's places and the rank lines as well (`PageBoard.past`): a fit
   * of each pool and half for last week, and up to seven more for a page that names its own club.
   */
  past?: boolean;
};

/** A club's town and state, each only when it has one. */
const placeOf = ({ city, state }: ScoutTeam): { city?: string; state?: string } => ({
  ...(city ? { city } : {}),
  ...(state ? { state } : {}),
});

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
export const buildBoardsAndFacts = ({
  ageGroups,
  teams,
  gamesOfYear,
  readSeason,
  autoRemoved,
  today,
  past = true,
}: BuildInput): BoardsBuilt => {
  const known = new Map<number | undefined, AllKnown>();
  const knownFor = (year: number | undefined) => {
    const held = known.get(year);
    if (held) return held;
    const derived = deriveAllKnown({
      ageGroups,
      teams,
      yearGames: gamesOfYear(year),
      readSeason,
      autoRemoved,
    });
    known.set(year, derived);
    return derived;
  };
  const byId = groupsById(ageGroups);
  const placesOfYear = new Map<number | undefined, PageFacts["places"]>();
  const facts = new Map<string, PageFacts>();
  const factsOf = (pageId: string): PageFacts => {
    const year = ageGroupYear(byId.get(pageId));
    const known = knownFor(year);
    let places = placesOfYear.get(year);
    if (!places) {
      places = new Map(known.teams.map((team) => [team.id, placeOf(team)]));
      placesOfYear.set(year, places);
    }
    return {
      halves: countedByHalf(
        gamesOnPages(known.games, rankingPoolGroupIds(pageId, ageGroups)),
        year,
        today
      ),
      league: leagueTeamIdsOn(known.derivedGames, pageId),
      places,
      seasons: new Map(
        [...(known.leagueClubs.get(pageId) ?? new Map<string, Map<string, string>>())].map(
          ([season, clubs]) => [
            season,
            {
              clubs,
              halves: known.leagueHalves.get(pageId)?.get(season) ?? new Set<SeasonSegment>(),
            },
          ]
        )
      ),
    };
  };
  // Held for one rating pool at a time and let go before the next, as the worker lets a year's fit
  // go before it builds another (`rankingsProtocol.ts` measured one of 76,792 clubs at 44 MB).
  let shipped = new Map<string, { teams: ScoutTeam[]; games: ScoutGame[] }>();
  let fits = new Map<string, ScoutYearFit>();
  // Past boards' places, kept for the pool as the worker keeps them (`pastBoards`): one fit for
  // each half and day, shared by the pool's pages of the same fit year.
  let pastRanks = new Map<string, Record<string, number>>();

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
    const fitted = fit ? boardFitOf(fit, rows, today) : undefined;
    const board: PageBoard = { pageId, half, rows, ...(fitted ? { fit: fitted } : {}) };
    if (!past) return board;

    /*
     * Every club of the year's place on the board as it stood on `asOf`, as the worker answers
     * the page's movement request: none for a page too young to rank, and otherwise its pool
     * fitted as of that day (`ranksAsOf`), kept for the pool's other pages of the same fit year.
     */
    const ranksOn = (asOf: string): Record<string, number> => {
      if (!scoutFitRanks(pageId, ageGroups)) return {};
      const key = JSON.stringify([
        poolKey,
        segment ?? null,
        scoutFitYear(pageId, ageGroups) ?? null,
        asOf,
      ]);
      let ranks = pastRanks.get(key);
      if (!ranks) {
        ranks = ranksAsOf(pageId, pool.teams, pool.games, ageGroups, segment, asOf);
        pastRanks.set(key, ranks);
      }
      return ranks;
    };
    const lastWeek = { asOf: daysBefore(today), ranks: ranksOn(daysBefore(today)) };
    // A page that names no club of its own, the empty id a restore can leave included, has no line.
    const teamId = page?.myTeamId;
    if (!teamId) return { ...board, past: lastWeek };

    /*
     * The page's own club's rank line, walked with the page's own step (`rankLineStep`): a week
     * further back each time until the step says stop; then last week's place on the end.
     */
    let points: HistoryPoint[] = [];
    for (let weeksBack = 2; ; weeksBack += 1) {
      const asOf = daysBefore(today, 7 * weeksBack);
      const ranks = ranksOn(asOf);
      const step = rankLineStep({
        points,
        lastWeekRank: lastWeek.ranks[teamId] ?? null,
        weeksBack,
        asOf,
        rank: ranks[teamId] ?? null,
        empty: Object.keys(ranks).length === 0,
      });
      points = step.points;
      if (step.done) break;
    }
    points.push({ asOf: lastWeek.asOf, rank: lastWeek.ranks[teamId] ?? null });
    return { ...board, past: lastWeek, history: { teamId, points } };
  };

  const boards = ratingPools(ageGroups).flatMap((pageIds) => {
    shipped = new Map();
    fits = new Map();
    pastRanks = new Map();
    pageIds.forEach((pageId) => facts.set(pageId, factsOf(pageId)));
    return BOARD_HALVES.flatMap(({ half, segment }) =>
      pageIds.map((pageId) => boardOf(pageId, half, segment))
    );
  });
  return { boards, facts, known };
};

/** Every board in a stored pool (`buildBoardsAndFacts`), without what their pages say. */
export const buildAllBoards = (input: BuildInput): PageBoard[] => buildBoardsAndFacts(input).boards;

/**
 * The boards as views to publish, each under its page's year, read as the page reads it (the
 * first age group of its id), without `isMine`, which is the owner's star: every member's device
 * marks its own (`withMine`). Each row carries what its page says of its club (`BoardFacts`).
 */
export const boardViews = (
  ageGroups: AgeGroup[],
  { boards, facts }: BoardsBuilt
): Array<{ key: string; value: BoardView }> => {
  const byId = groupsById(ageGroups);
  return boards.map(({ pageId, half, rows, past, history, fit }) => {
    const page = facts.get(pageId);
    if (!page) throw new Error(`No facts were built for the page ${pageId}.`);
    return {
      key: boardKey(ageGroupYear(byId.get(pageId)), pageId, half),
      value: {
        rows: rows.map(({ isMine: _mine, ...row }) => {
          const was = past?.ranks[row.teamId];
          const told: BoardFacts = {
            ...page.places.get(row.teamId),
            ...(page.league.has(row.teamId) ? { league: true as const } : {}),
            ...(was === undefined ? {} : { was }),
          };
          return { ...row, ...told };
        }),
        ...(past ? { past: { asOf: past.asOf, empty: Object.keys(past.ranks).length === 0 } } : {}),
        ...(history ? { history } : {}),
        ...(fit ? { fit } : {}),
      },
    };
  });
};

/**
 * What the publisher says of every page beside its boards (`LivePages`), in the order the boards
 * come out in: the roster's last pull, each page's counted games by half, the clubs of the League
 * Standings seasons it claims, and, when given, the copy's age groups themselves.
 */
export const livePagesOf = (
  { facts }: BoardsBuilt,
  pulledAt: string | null,
  ageGroups?: AgeGroup[]
): LivePages => {
  const league = [...facts].flatMap(([page, { seasons }]) =>
    [...seasons].map(([season, { clubs, halves }]) => ({
      page,
      season,
      clubs: [...clubs].map(([team, club]) => ({ team, club })),
      halves: [...halves].sort(),
    }))
  );
  return {
    ...(pulledAt ? { pulledAt } : {}),
    halves: Object.fromEntries([...facts].map(([pageId, page]) => [pageId, { ...page.halves }])),
    ...(league.length > 0 ? { league } : {}),
    ...(ageGroups ? { groups: ageGroups } : {}),
  };
};
