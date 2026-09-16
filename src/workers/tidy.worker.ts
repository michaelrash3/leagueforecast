/// <reference lib="webworker" />
import { tidyPool, type GcImportState, type PoolTidy } from "../lib/gameChangerImport";
import { poolHealth, settleableNow, type PoolHealth } from "../lib/poolHealth";

/**
 * Tidying a nationwide pool, off the main thread.
 *
 * The tidy is five passes over every game — settling stand-ins the other side's schedule can name,
 * folding a club's several GameChanger ids together, collapsing rows that mean one game. On a pool
 * of two hundred thousand games it takes the better part of half a minute, and it was running
 * inside a `setTimeout` on the main thread: a frozen tab for that whole time, and any reload or
 * state change in the middle cancelled it. The result was a pool with eleven and a half thousand
 * results still filed against "TBD" while the code to settle them worked perfectly and never got
 * to finish.
 *
 * Here it can take as long as it needs. The page stays usable and the answer arrives when it does.
 */

export type TidyRequest = { kind: "tidy"; id: number; state: GcImportState };
/** What a tidy would do, without doing it — the numbers behind the pool health card. */
export type InspectRequest = { kind: "inspect"; id: number; state: GcImportState; stamp: string };
export type WorkerRequest = TidyRequest | InspectRequest;

export type TidyResponse = {
  kind: "tidy";
  id: number;
  state: GcImportState;
  tidy: Omit<PoolTidy, "state">;
};
export type InspectResponse = {
  kind: "inspect";
  id: number;
  health: PoolHealth;
  settleable: number;
};
export type WorkerResponse = TidyResponse | InspectResponse;

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === "inspect") {
    const health = poolHealth(request.state, request.stamp);
    scope.postMessage({
      kind: "inspect",
      id: request.id,
      health,
      // Only worth asking when something could be settled; on a tidy pool it is zero and cheap.
      settleable: health.standInPlayed === 0 ? 0 : settleableNow(request.state),
    } satisfies InspectResponse);
    return;
  }
  if (request.kind === "tidy") {
    const result = tidyPool(request.state);
    const { state, ...counts } = result;
    scope.postMessage({ kind: "tidy", id: request.id, state, tidy: counts } satisfies TidyResponse);
  }
};
