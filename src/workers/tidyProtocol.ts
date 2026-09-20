import {
  tidyPool,
  type GcImportState,
  type PoolTidy,
  type TidyStep,
} from "../lib/gameChangerImport";
import { poolHealth, settleableNow, type PoolHealth } from "../lib/poolHealth";
import type { AgeGroup } from "../lib/teamRankings";
import {
  decodePoolGames,
  decodePoolTeams,
  encodeScoutGames,
  encodeScoutTeams,
} from "../lib/teamRankingsCompact";

/**
 * What crosses between the page and the tidy worker, and what the worker does with it. Pure, so
 * it can be tested without a worker; `tidy.worker.ts` only wires it to the message port.
 *
 * Two things about the shape. The pool goes over compact — the form IndexedDB stores — rather than
 * as a structured clone of every object, for the same reason the rankings worker takes it that
 * way: at nationwide scale the objects are several times the size on the wire and were copied in
 * whole on every inspection and every tidy. And the tidy hands back only what it changed. It used
 * to return the whole pool, and a whole pool that has crossed a message port is a copy, so the
 * identity checks that decide what to save — `tidied.teams !== teams` — read every part as changed
 * and saved all three, every time, including after a tidy that found nothing to do. A part the tidy
 * left alone now simply is not in the answer, and `applyTidied` puts the caller's own array back in
 * its place.
 */

/** The pool as it crosses: teams and games compact, age groups as they are (they are few). */
export type PoolWire = { ageGroups: AgeGroup[]; teams: unknown; games: unknown };

export type TidyRequest = { kind: "tidy"; id: number; state: PoolWire };
/** What a tidy would do, without doing it — the numbers behind the pool health card. */
export type InspectRequest = {
  kind: "inspect";
  id: number;
  state: PoolWire;
  stamp: string;
  /** Today as the page sees it, so "dated after today" is judged by one clock and testable. */
  today: string;
};
export type WorkerRequest = TidyRequest | InspectRequest;

export type TidyResponse = {
  kind: "tidy";
  id: number;
  /** Only the parts of the pool the tidy changed. Absent means untouched, not empty. */
  changed: Partial<GcImportState>;
  tidy: Omit<PoolTidy, "state">;
};
/**
 * One step of one pass, sent while the tidy is still running.
 *
 * The tidy is the longest thing this app does — the better part of half a minute on a nationwide
 * pool, and several passes of nine steps each — and it reported nothing until it was over. These
 * are cheap: nine small objects a pass, against a pool of two hundred thousand games crossing the
 * port once at each end.
 *
 * A long step may send more than its start and finish: candidate progress in `step` is a cheap
 * heartbeat. `ms` is stamped here rather than in `tidyPool`, which stays pure.
 */
export type TidyProgressResponse = {
  kind: "tidy-progress";
  id: number;
  step: TidyStep;
  /** Milliseconds since this tidy began, so the slow step is the one that can be seen to be slow. */
  ms: number;
};

export type InspectResponse = {
  kind: "inspect";
  id: number;
  health: PoolHealth;
  settleable: number;
};
export type WorkerResponse = TidyResponse | InspectResponse | TidyProgressResponse;

export const packPool = (state: GcImportState): PoolWire => ({
  ageGroups: state.ageGroups,
  teams: encodeScoutTeams(state.teams),
  games: encodeScoutGames(state.games),
});

export const unpackPool = (wire: PoolWire): GcImportState => ({
  ageGroups: wire.ageGroups,
  teams: decodePoolTeams(wire.teams),
  games: decodePoolGames(wire.games),
});

/**
 * The tidied pool, as the caller should hold it: what the tidy changed laid over what it was
 * handed, so a part it did not touch is the very array the caller already has — and an identity
 * check downstream reads it as unchanged, which it is.
 */
export const applyTidied = (
  before: GcImportState,
  changed: Partial<GcImportState>
): GcImportState => ({
  ageGroups: changed.ageGroups ?? before.ageGroups,
  teams: changed.teams ?? before.teams,
  games: changed.games ?? before.games,
});

/** The worker's side of the conversation, as a function of each message it receives. */
export const createTidyHandler =
  (post: (response: WorkerResponse) => void) =>
  (request: WorkerRequest): void => {
    const state = unpackPool(request.state);
    if (request.kind === "inspect") {
      const health = poolHealth(state, request.stamp, request.today);
      post({
        kind: "inspect",
        id: request.id,
        health,
        // Only worth asking when something could be settled; on a tidy pool it is zero and cheap.
        settleable: health.standInPlayed === 0 ? 0 : settleableNow(state),
      });
      return;
    }
    const from = performance.now();
    const { state: tidied, ...counts } = tidyPool(state, (step) =>
      post({ kind: "tidy-progress", id: request.id, step, ms: performance.now() - from })
    );
    // Identity against the pool as decoded here: a pass that changes nothing hands back the array
    // it was given, and that is the whole test.
    const changed: Partial<GcImportState> = {
      ...(tidied.ageGroups === state.ageGroups ? {} : { ageGroups: tidied.ageGroups }),
      ...(tidied.teams === state.teams ? {} : { teams: tidied.teams }),
      ...(tidied.games === state.games ? {} : { games: tidied.games }),
    };
    post({ kind: "tidy", id: request.id, changed, tidy: counts });
  };
