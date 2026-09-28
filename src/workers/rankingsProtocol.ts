import {
  fitScoutYearFor,
  rankingPoolGroupIds,
  rowsOfYearFit,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type ScoutYearFit,
  type SeasonSegment,
} from "../lib/teamRankings";
import { todayIsoDay } from "../lib/date";
import { whatIfCurve, type WhatIfCurve } from "../lib/scoutWhatIf";
import {
  backtestGames,
  backtestScoutRatings,
  type BacktestGames,
  type ScoutBacktestOptions,
  type ScoutBacktestResult,
} from "../lib/scoutBacktest";
import { decodePoolGames, decodePoolTeams } from "../lib/teamRankingsCompact";
import { RANK_HISTORY_WEEKS, ranksAsOf } from "../lib/rankMovement";

/**
 * What crosses between the page and the rankings worker, and what the worker does with it.
 *
 * Pure, so it can be tested without a worker: `rankings.worker.ts` is a dozen lines wiring
 * `createRankingsHandler` to `postMessage`.
 *
 * The pool used to ride on every request — every team and every game, as objects, structured-
 * cloned into the worker each time anything about the fit changed. Switching the page from 10U to
 * 11U copied a hundred thousand teams and two hundred thousand games to fit the same pool from a
 * different seat, and the copy was then garbage in the worker until the next one arrived. Measured
 * at nationwide scale that copy was the largest single allocation in the app.
 *
 * Now the worker keeps one decoded pool, and a request names it by revision. The page ships the
 * pool — in the compact form IndexedDB stores, which is a fraction of the objects' size on the wire
 * — only when the pool itself has changed, and everything else (a page switch, a half of the year,
 * whose team is "mine") is a request with no pool on it at all. A worker that does not hold the
 * revision named says so and is shipped it; that is the whole recovery path, and it makes a fresh
 * or restarted worker just a worker that has not been sent the pool yet.
 */

/**
 * Which pool to fit, and — when the page believes the worker does not have it — the pool itself.
 * `teams` and `games` are the compact form: `encodeScoutTeams` / `encodeScoutGames` on the way
 * in, `decodePoolTeams` / `decodePoolGames` on the way out.
 */
export type PoolShipment = { revision: number; teams?: unknown; games?: unknown };

export type RankingsRequest = {
  kind: "rankings";
  id: number;
  ageGroupId: string;
  myTeamId?: string;
  ageGroups: AgeGroup[];
  /** One half of the baseball year, or the whole of it when absent. */
  segment?: SeasonSegment;
  pool: PoolShipment;
};

/**
 * One fixture's what-if, against the pool the worker already holds.
 *
 * It rides the same protocol as the board for one reason: the worker holds exactly one decoded
 * pool, and the whole point of that arrangement is not to copy a nationwide pool twice. So a
 * what-if names the revision like everything else and gets the same `pool-needed` recovery.
 *
 * `today` is on the request rather than read from the worker's own clock. The day decides which
 * games are behind us and how much the recency weights lean on each, so a board fitted against the
 * page's idea of today and a what-if fitted against the worker's could disagree — and the reader
 * would have no way of telling which of the two numbers in front of them was which.
 */
export type WhatIfRequest = {
  kind: "what-if";
  id: number;
  ageGroupId: string;
  myTeamId?: string;
  ageGroups: AgeGroup[];
  segment?: SeasonSegment;
  /** The club the answer is about. */
  forTeamId: string;
  /** Which fixture off its schedule, by the id the held pool knows it under. */
  gameId: string;
  today: string;
  pool: PoolShipment;
};

/**
 * One run of Setup's model check, against the pool the worker already holds.
 *
 * One run, not the whole check: the worker answers one message at a time, and a board refit asked
 * for while the whole check ran waited for all of it, about 15 s on a nationwide year. Asked a run
 * at a time, the refit waits for one. The page's rated games in order are the same for every run
 * and are kept between them.
 */
export type ModelCheckRequest = {
  kind: "model-check";
  id: number;
  ageGroupId: string;
  ageGroups: AgeGroup[];
  run: ScoutBacktestOptions;
  pool: PoolShipment;
};

/**
 * Every club's place on its page as the board stood on `asOf` (`ranksAsOf`), for "since last
 * week". Asked once the board is up, because it is a second fit of the year and the board is what
 * the reader is waiting for.
 */
export type MovementRequest = {
  kind: "movement";
  id: number;
  ageGroupId: string;
  ageGroups: AgeGroup[];
  segment?: SeasonSegment;
  asOf: string;
  /**
   * The clubs whose places are wanted, when not every club's: a week of the "My team" rank line
   * asks for one club, and a whole board's places are a number for every club in the year.
   */
  teamIds?: string[];
  pool: PoolShipment;
};

export type CancelRequest = { kind: "cancel"; id: number };

export type WorkerRequest =
  RankingsRequest | WhatIfRequest | ModelCheckRequest | MovementRequest | CancelRequest;

export type RankingsResponse = {
  kind: "rankings";
  id: number;
  rows: ScoutRankingRow[];
  elapsedMs: number;
};

/**
 * The answer, or null when there is not one.
 *
 * Null covers both a fixture the held pool no longer carries — a pull or a tidy can take one away
 * between the press and the answer — and a fixture the selection will not take. The page says so
 * rather than showing places nobody should act on.
 */
export type WhatIfResponse = {
  kind: "what-if";
  id: number;
  curve: WhatIfCurve | null;
  elapsedMs: number;
};

export type ModelCheckResponse = {
  kind: "model-check";
  id: number;
  result: ScoutBacktestResult;
  elapsedMs: number;
};

export type MovementResponse = {
  kind: "movement";
  id: number;
  asOf: string;
  ranks: Record<string, number>;
  /** No club had a place on that day's board: the half had not started. */
  empty?: boolean;
  elapsedMs: number;
};

/** The worker does not hold the revision the request named; ship it and ask again. */
export type PoolNeededResponse = { kind: "pool-needed"; id: number; revision: number };

export type WorkerResponse =
  RankingsResponse | WhatIfResponse | ModelCheckResponse | MovementResponse | PoolNeededResponse;

type HeldPool = { revision: number; teams: ScoutTeam[]; games: ScoutGame[] };

/**
 * What a year's fit reads, as one string: the pool, the pages it spans, the half, the day and the
 * age groups, whose levels and years decide every age gap and home level in it. Not whose team is
 * "mine", which only marks a row once the page is cut, so starring a club does not refit a year.
 * Compared whole rather than digested, so no two different inputs can share a key.
 */
const yearFitKey = (request: RankingsRequest, revision: number, today: string): string =>
  JSON.stringify([
    revision,
    rankingPoolGroupIds(request.ageGroupId, request.ageGroups),
    request.segment ?? "",
    today,
    request.ageGroups.map(({ myTeamId: _mine, ...group }) => group),
  ]);

/**
 * The worker's side of the conversation, as a function of each message it receives.
 *
 * `post` is how it answers; `now` is the clock for the timing it reports, replaceable so a test
 * does not depend on one.
 */
export const createRankingsHandler = (
  post: (response: WorkerResponse) => void,
  now: () => number = () => performance.now()
): ((request: WorkerRequest) => void) => {
  const canceled = new Set<number>();
  let held: HeldPool | null = null;
  /**
   * The last year fitted, and what it was fitted from.
   *
   * Every page of a squad year is fitted over the same games — the year's — so a switch from 9U to
   * 10U used to refit the whole year to cut a different page from it: on the 18:40 pool about 3 s
   * a switch, for rows the fit already held. One fit is kept and each page is cut from it, in
   * about 30 ms. It costs the memory of one fit (about 44 MB on that pool, 76,792 unknowns), which
   * the next fit replaces rather than adds to.
   */
  let yearFit: { key: string; fit: ScoutYearFit } | null = null;
  /** The page's rated games in order, for the model check's runs; see `ModelCheckRequest`. */
  let checked: { key: string; games: BacktestGames } | null = null;
  /**
   * Past boards' places, for every page of the year: one refit per pool, day and half rather than
   * one per page switch, and only the numbers kept, not the fit (`ranksAsOf`). The latest used
   * last, and enough of them for a whole rank line and one more: last week's and the seven before
   * it, so walking the line does not push last week's board out, and going back to a page after
   * another fits none of them again. Each is about 3 MB on a year of 76,792 clubs (measured in
   * Node, the ids shared with the pool), so the nine are about 28 MB beside the fit's 44.
   */
  const pastBoards = new Map<string, Record<string, number>>();
  const PAST_BOARDS_KEPT = RANK_HISTORY_WEEKS + 1;
  const pageRows = (request: RankingsRequest, pool: HeldPool): ScoutRankingRow[] => {
    const today = todayIsoDay();
    const key = yearFitKey(request, pool.revision, today);
    if (yearFit?.key !== key) {
      // Let the old fit go before the new one is built, so the two are never held at once.
      yearFit = null;
      const fit = fitScoutYearFor(
        request.ageGroupId,
        pool.teams,
        pool.games,
        request.ageGroups,
        request.segment,
        today
      );
      if (!fit) return [];
      yearFit = { key, fit };
    }
    return rowsOfYearFit(yearFit.fit, request.ageGroupId, request.myTeamId, request.ageGroups);
  };

  return (request: WorkerRequest): void => {
    if (request.kind === "cancel") {
      canceled.add(request.id);
      return;
    }

    // The pool first, whatever becomes of the request it rode in on. A cancelled request still
    // carried the copy every later request is going to rely on, and dropping it would only make
    // the next one ask for it again.
    const { pool } = request;
    if (pool.teams !== undefined && pool.games !== undefined) {
      held = {
        revision: pool.revision,
        teams: decodePoolTeams(pool.teams),
        games: decodePoolGames(pool.games),
      };
    }

    if (canceled.has(request.id)) {
      canceled.delete(request.id);
      return;
    }
    if (!held || held.revision !== pool.revision) {
      post({ kind: "pool-needed", id: request.id, revision: pool.revision });
      return;
    }

    const start = now();

    if (request.kind === "model-check") {
      const key = JSON.stringify([
        held.revision,
        rankingPoolGroupIds(request.ageGroupId, request.ageGroups),
        request.ageGroups,
      ]);
      if (checked?.key !== key) {
        checked = null;
        checked = {
          key,
          games: backtestGames(request.ageGroupId, held.teams, held.games, request.ageGroups),
        };
      }
      const result = backtestScoutRatings(
        request.ageGroupId,
        held.teams,
        held.games,
        request.ageGroups,
        request.run,
        checked.games
      );
      if (!canceled.has(request.id)) {
        post({ kind: "model-check", id: request.id, result, elapsedMs: now() - start });
      }
      canceled.delete(request.id);
      return;
    }

    if (request.kind === "movement") {
      const key = JSON.stringify([
        held.revision,
        rankingPoolGroupIds(request.ageGroupId, request.ageGroups),
        request.segment ?? "",
        request.asOf,
        request.ageGroups.map(({ myTeamId: _mine, ...group }) => group),
      ]);
      let ranks = pastBoards.get(key);
      if (ranks) pastBoards.delete(key);
      else
        ranks = ranksAsOf(
          request.ageGroupId,
          held.teams,
          held.games,
          request.ageGroups,
          request.segment,
          request.asOf
        );
      pastBoards.set(key, ranks);
      while (pastBoards.size > PAST_BOARDS_KEPT) {
        const oldest = pastBoards.keys().next().value;
        if (oldest === undefined) break;
        pastBoards.delete(oldest);
      }
      const wanted = request.teamIds;
      const answer = wanted
        ? Object.fromEntries(
            wanted.flatMap((teamId) =>
              ranks[teamId] === undefined ? [] : [[teamId, ranks[teamId]!]]
            )
          )
        : ranks;
      if (!canceled.has(request.id)) {
        post({
          kind: "movement",
          id: request.id,
          asOf: request.asOf,
          ranks: answer,
          // Whether the board that day had anyone on it, which a club's own answer cannot say.
          empty: Object.keys(ranks).length === 0,
          elapsedMs: now() - start,
        });
      }
      canceled.delete(request.id);
      return;
    }

    if (request.kind === "what-if") {
      /*
       * The held pool is read and never written. `whatIfCurve` builds its own array with the
       * hypothetical on the end, so nothing this answers can leave a game nobody played in the
       * pool every later fit at this revision reads.
       */
      const fixture = held.games.find((game) => game.id === request.gameId);
      const curve = fixture
        ? whatIfCurve(
            fixture,
            request.forTeamId,
            request.ageGroupId,
            held.teams,
            held.games,
            request.myTeamId,
            request.ageGroups,
            request.segment,
            request.today
          )
        : null;
      if (!canceled.has(request.id)) {
        post({ kind: "what-if", id: request.id, curve, elapsedMs: now() - start });
      }
      canceled.delete(request.id);
      return;
    }

    const rows = pageRows(request, held);
    // A fit that finished after the page stopped wanting it is thrown away rather than posted: the
    // answer is for a pool that has already changed.
    if (!canceled.has(request.id)) {
      post({ kind: "rankings", id: request.id, rows, elapsedMs: now() - start });
    }
    canceled.delete(request.id);
  };
};
