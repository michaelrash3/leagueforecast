import type { AutoRemovals } from "./autoRemoved";
import {
  FEW_OUTSIDE_GAMES,
  FEW_OUTSIDE_NATIONAL_TOP,
  FEW_OUTSIDE_STATE_TOP,
  type FewOutsideGroup,
  type FewOutsideLeader,
  type FewOutsideList,
  type FewOutsideOpponent,
  type FewOutsideSide,
} from "./fewOutside";
import { deriveAllKnown, gamesOnPages, type AllKnown, type SeasonReader } from "./live/allKnown";
import { asWorkerSees, ratingPools } from "./live/views/board";
import { countedByHalf, defaultSegmentFor, segmentWorthShowing } from "./teamRankings/halves";
import {
  ageGroupYear,
  fitScoutYearFor,
  hasGcLinks,
  rankingPoolGroupIds,
  rowsOfYearFit,
  scoutFitYear,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type ScoutYearFit,
  type SeasonSegment,
} from "./teamRankings";

/**
 * Pool health's leaders with few outside games (`fewOutside.ts`), worked out from the boards the
 * pages open on and the fit they were cut from: the boards say who leads (their order, each club's
 * state, and whether it is in the largest piece and how many games its community has played
 * outside itself); the fit says what each club's community is made of and whom it played
 * (`nodes`, `communities`, `rated`). Pure, and read by the server's answer to Pool health's look
 * (`health.inspect`) and by the device's tidy worker (`tidyProtocol.ts`) alike, through
 * `fewOutsideOfPool`, which builds those boards from a stored pool as the boards are built.
 */

/** One page's board, the one it opens on, as the list reads it. */
export type BoardPage = {
  pageId: string;
  /** The page's name, as its tab shows it. */
  page: string;
  year: number | null;
  /** The half the board is of; null for the whole year's, a page with no year's only board. */
  segment: SeasonSegment | null;
  /** Its rows in the board's order: a row's place is its national rank. */
  rows: ReadonlyArray<
    Pick<ScoutRankingRow, "teamId" | "teamName" | "record" | "comparable" | "outsideGames">
  >;
  /** Each club's state, as the board's rows say it (`BoardFacts`). */
  stateOf: (teamId: string) => string | undefined;
};

/** One fit, of a year or of a half, and the pages' boards cut from it. */
export type FitBoards = {
  fit: Pick<ScoutYearFit, "nodes" | "communities" | "rated">;
  pages: readonly BoardPage[];
};

type Kind = "pulled" | "byHand" | "nameOnly" | "slot";

/** Which of the four a side is, the slot first, as the boards tell them apart. */
const kindOf = (team: ScoutTeam): Kind =>
  team.placeholder ? "slot" : team.nameOnly ? "nameOnly" : hasGcLinks(team) ? "pulled" : "byHand";

/** A state rank to sort by: a club with no state after every club with one. */
const placed = (stateRank: number | null): number => stateRank ?? Number.MAX_SAFE_INTEGER;

/** Plain code-point order, the same on every engine and in every locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The most rated games first, then by name, then by id, so the order never rests on input order. */
const bySide = (a: FewOutsideSide, b: FewOutsideSide): number =>
  b.rated - a.rated || byText(a.name, b.name) || byText(a.teamId, b.teamId);

/**
 * Whether a board row puts its club on the list: in its state's top ten or the national top
 * twenty-five, and in a community short of outside games or off the largest piece. A row that
 * says nothing of its community (a board from before rules 7) is listed only when it is off the
 * largest piece; one from this fit always says.
 */
const listed = (
  row: Pick<ScoutRankingRow, "comparable" | "outsideGames">,
  stateRank: number | null,
  rank: number
): boolean =>
  ((stateRank !== null && stateRank <= FEW_OUTSIDE_STATE_TOP) ||
    rank <= FEW_OUTSIDE_NATIONAL_TOP) &&
  (!row.comparable || (row.outsideGames !== undefined && row.outsideGames < FEW_OUTSIDE_GAMES));

type Found = Omit<FewOutsideLeader, "group"> & { key: string; order: number };

/**
 * The list from every fit's boards, each fit let go as the next is read, so a caller that hands
 * over a generator holds one fit at a time. Leaders are sorted by state rank, a club with no
 * state after every club with one, then by national rank, then by the order their pages came in,
 * then by id; groups are numbered by the leader that comes first in them.
 */
export const fewOutsideLeaders = (years: Iterable<FitBoards>): FewOutsideList => {
  const found: Found[] = [];
  const groupsByKey = new Map<string, FewOutsideGroup>();
  let year = 0;
  let pageOrder = 0;
  for (const { fit, pages } of years) {
    const index = new Map<string, number>();
    fit.nodes.forEach((team, at) => {
      if (!index.has(team.id)) index.set(team.id, at);
    });
    const kinds = fit.nodes.map(kindOf);

    // Who leads onto the list, page by page, each club's state rank as its state board counts it.
    const picked: Array<{ at: number; leader: Omit<Found, "opponents" | "key"> }> = [];
    for (const page of pages) {
      const inState = new Map<string, number>();
      page.rows.forEach((row, at) => {
        const state = page.stateOf(row.teamId);
        const stateRank = state ? (inState.get(state) ?? 0) + 1 : null;
        if (state && stateRank !== null) inState.set(state, stateRank);
        const rank = at + 1;
        const node = index.get(row.teamId);
        // A row's club is a node of its fit; one that is not has no group to say anything of.
        if (node === undefined || !fit.communities.of.has(row.teamId)) return;
        if (!listed(row, stateRank, rank)) return;
        picked.push({
          at: node,
          leader: {
            teamId: row.teamId,
            name: row.teamName,
            pageId: page.pageId,
            page: page.page,
            year: page.year,
            segment: page.segment,
            ...(state ? { state } : {}),
            stateRank,
            rank,
            record: row.record,
            order: pageOrder,
          },
        });
      });
      pageOrder += 1;
    }
    if (picked.length > 0) {
      // Every node's rated games, and each leader's games against each side known only by name.
      const rated = new Int32Array(fit.nodes.length);
      const leading = new Map<number, Map<number, number>>();
      picked.forEach(({ at }) => leading.set(at, new Map()));
      const against = (club: number, side: number) => {
        const opponents = leading.get(club);
        if (!opponents || kinds[side] !== "nameOnly") return;
        opponents.set(side, (opponents.get(side) ?? 0) + 1);
      };
      for (const { game } of fit.rated) {
        const a = index.get(game.teamAId);
        const b = index.get(game.teamBId);
        if (a === undefined || b === undefined) continue;
        rated[a]! += 1;
        rated[b]! += 1;
        against(a, b);
        against(b, a);
      }
      const sideOf = (at: number): FewOutsideSide => ({
        teamId: fit.nodes[at]!.id,
        name: fit.nodes[at]!.name,
        rated: rated[at]!,
      });

      // The leaders' communities, each walked once for what it holds.
      const communityOf = (at: number): number => fit.communities.of.get(fit.nodes[at]!.id)!;
      const wanted = new Set(picked.map(({ at }) => communityOf(at)));
      const members = new Map<number, number[]>([...wanted].map((c) => [c, []]));
      fit.nodes.forEach((team, at) => {
        if (index.get(team.id) !== at) return;
        const c = fit.communities.of.get(team.id);
        if (c !== undefined) members.get(c)?.push(at);
      });
      members.forEach((held, c) => {
        const count = { pulled: 0, byHand: 0, nameOnly: 0, slot: 0 };
        held.forEach((at) => (count[kinds[at]!] += 1));
        groupsByKey.set(`${year}:${c}`, {
          sides: held.length,
          pulled: count.pulled,
          byHand: count.byHand,
          nameOnly: count.nameOnly,
          slots: count.slot,
          outside: fit.communities.outside[c] ?? 0,
          toFind: held
            .filter((at) => kinds[at] === "nameOnly")
            .map(sideOf)
            .sort(bySide),
          byHandSides: held
            .filter((at) => kinds[at] === "byHand")
            .map(sideOf)
            .sort(bySide),
        });
      });

      picked.forEach(({ at, leader }) => {
        const opponents: FewOutsideOpponent[] = [...(leading.get(at) ?? [])]
          .map(([side, games]) => ({ ...sideOf(side), games }))
          .sort((x, y) => y.games - x.games || bySide(x, y));
        found.push({ ...leader, opponents, key: `${year}:${communityOf(at)}` });
      });
    }
    year += 1;
  }

  found.sort(
    (a, b) =>
      placed(a.stateRank) - placed(b.stateRank) ||
      a.rank - b.rank ||
      a.order - b.order ||
      byText(a.teamId, b.teamId)
  );
  const numbered = new Map<string, number>();
  const groups: FewOutsideGroup[] = [];
  const leaders = found.map(({ key, order: _order, ...leader }): FewOutsideLeader => {
    let group = numbered.get(key);
    if (group === undefined) {
      group = groups.length;
      numbered.set(key, group);
      groups.push(groupsByKey.get(key)!);
    }
    return { ...leader, group };
  });
  return { leaders, groups };
};

/** A stored pool, as the boards are built from one (`BuildInput`), without what only boards read. */
export type FewOutsideInput = {
  ageGroups: AgeGroup[];
  /** The stored roster, as `loadScoutTeams` decodes it. */
  teams: ScoutTeam[];
  /** One squad year's stored games, as `loadScoutGamesForYear` decodes them. */
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  readSeason: SeasonReader;
  autoRemoved: AutoRemovals;
  /** The day the boards are for, as an ISO day. */
  today: string;
};

/**
 * The board each page of a stored pool opens on, with the fit it was cut from, built as
 * `buildBoardsAndFacts` builds that half's boards (`board.ts`): the pages' rating pools in their
 * order, each page's year known once for its year (`deriveAllKnown`) and its pool after the
 * worker's codec (`asWorkerSees`), one fit for the pages of a pool that share a half and a fit
 * year, with no past weeks, and each club's state off its year's roster, the last of a repeated id
 * winning, as the boards' facts read it. A pool's fits are handed over before the next pool is
 * fitted.
 *
 * The half is the one a page opens on where its address names none, on the device and the live
 * page alike: the calendar's for the page's year, unless that half holds under a tenth of the
 * other's counted games (`segmentWorthShowing`, over `countedByHalf` of the games its boards are
 * fitted from, the counts the boards publish as `PageFacts.halves`), and the whole year for a page
 * with no year. Pages of one pool share their games and year, so they share a half, and the list
 * fits no more than the boards do.
 */
export function* openedBoardsOf(input: FewOutsideInput): Generator<FitBoards> {
  const { ageGroups, teams, gamesOfYear, readSeason, autoRemoved, today } = input;
  const byId = new Map<string, AgeGroup>();
  ageGroups.forEach((group) => {
    if (!byId.has(group.id)) byId.set(group.id, group);
  });
  const known = new Map<
    number | undefined,
    { all: AllKnown; states: Map<string, string | undefined> }
  >();
  const knownFor = (year: number | undefined) => {
    const held = known.get(year);
    if (held) return held;
    const all = deriveAllKnown({
      ageGroups,
      teams,
      yearGames: gamesOfYear(year),
      readSeason,
      autoRemoved,
    });
    // As the boards' facts are built (`PageFacts.places`): a map of the roster, the last id wins.
    const states = new Map(all.teams.map((team) => [team.id, team.state || undefined]));
    const made = { all, states };
    known.set(year, made);
    return made;
  };

  for (const pageIds of ratingPools(ageGroups)) {
    const shipped = new Map<
      string,
      { teams: ScoutTeam[]; games: ScoutGame[]; segment: SeasonSegment | undefined }
    >();
    const fits = new Map<string, { fit: ScoutYearFit; pages: BoardPage[] }>();
    for (const pageId of pageIds) {
      const page = byId.get(pageId);
      const year = ageGroupYear(page);
      const poolIds = rankingPoolGroupIds(pageId, ageGroups);
      const poolKey = JSON.stringify([year ?? null, poolIds]);
      const { all, states } = knownFor(year);
      let pool = shipped.get(poolKey);
      if (!pool) {
        const games = gamesOnPages(all.games, poolIds);
        pool = {
          ...asWorkerSees(all.teams, games),
          segment: segmentWorthShowing(
            defaultSegmentFor(year, today),
            countedByHalf(games, year, today)
          ),
        };
        shipped.set(poolKey, pool);
      }
      const { segment } = pool;
      const fitKey = JSON.stringify([
        poolKey,
        segment ?? null,
        scoutFitYear(pageId, ageGroups) ?? null,
      ]);
      let held = fits.get(fitKey);
      if (!held) {
        const fit = fitScoutYearFor(pageId, pool.teams, pool.games, ageGroups, segment, today);
        if (!fit) continue;
        held = { fit, pages: [] };
        fits.set(fitKey, held);
      }
      const rows = rowsOfYearFit(held.fit, pageId, page?.myTeamId, ageGroups);
      if (rows.length === 0) continue;
      held.pages.push({
        pageId,
        page: page?.name ?? pageId,
        year: year ?? null,
        segment: segment ?? null,
        rows,
        stateOf: (teamId) => states.get(teamId),
      });
    }
    yield* fits.values();
  }
}

/** The list of a stored pool (`fewOutsideLeaders` over `openedBoardsOf`). */
export const fewOutsideOfPool = (input: FewOutsideInput): FewOutsideList =>
  fewOutsideLeaders(openedBoardsOf(input));
