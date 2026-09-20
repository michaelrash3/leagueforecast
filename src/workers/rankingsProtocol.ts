import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type SeasonSegment,
} from "../lib/teamRankings";
import { whatIfCurve, type WhatIfCurve } from "../lib/scoutWhatIf";
import { decodePoolGames, decodePoolTeams } from "../lib/teamRankingsCompact";

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

export type CancelRequest = { kind: "cancel"; id: number };

export type WorkerRequest = RankingsRequest | WhatIfRequest | CancelRequest;

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

/** The worker does not hold the revision the request named; ship it and ask again. */
export type PoolNeededResponse = { kind: "pool-needed"; id: number; revision: number };

export type WorkerResponse = RankingsResponse | WhatIfResponse | PoolNeededResponse;

type HeldPool = { revision: number; teams: ScoutTeam[]; games: ScoutGame[] };

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

    const rows = buildTeamRankings(
      request.ageGroupId,
      held.teams,
      held.games,
      request.myTeamId,
      request.ageGroups,
      request.segment
    );
    // A fit that finished after the page stopped wanting it is thrown away rather than posted: the
    // answer is for a pool that has already changed.
    if (!canceled.has(request.id)) {
      post({ kind: "rankings", id: request.id, rows, elapsedMs: now() - start });
    }
    canceled.delete(request.id);
  };
};
