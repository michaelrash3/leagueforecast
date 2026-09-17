import { useCallback, useEffect, useRef, useState } from "react";
import type { GcImportState, PoolTidy } from "../lib/gameChangerImport";
import { tidyPool } from "../lib/gameChangerImport";
import { poolHealth, settleableNow, type PoolHealth } from "../lib/poolHealth";
import { beginTidy, endTidy } from "../lib/pullSession";
import type { WorkerRequest, WorkerResponse } from "../workers/tidy.worker";

/**
 * Inspecting and tidying the pool without locking the page up.
 *
 * Both jobs walk every game, and on a nationwide pool that is half a second for the inspection and
 * something like half a minute for the tidy. Off the main thread for that reason; inline where a
 * worker cannot be had, so nothing depends on having one.
 */

export type PoolInspection = { health: PoolHealth; settleable: number };
export type TidyOutcome = { state: GcImportState; tidy: Omit<PoolTidy, "state"> };

const createWorker = (): Worker | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/tidy.worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    console.warn("Tidy worker unavailable, falling back to inline.", error);
    return null;
  }
};

export function usePoolTidy() {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const [busy, setBusy] = useState<null | "inspect" | "tidy">(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    []
  );

  /** One round trip, or the same work inline when there is no worker to send it to. */
  const ask = useCallback(
    <T>(
      job: "inspect" | "tidy",
      request: (id: number) => WorkerRequest,
      matches: (response: WorkerResponse, id: number) => T | null,
      inline: () => T
    ): Promise<T> => {
      if (!workerRef.current) workerRef.current = createWorker();
      const worker = workerRef.current;
      setBusy(job);
      if (!worker) {
        const answer = inline();
        setBusy(null);
        return Promise.resolve(answer);
      }
      const id = nextId.current + 1;
      nextId.current = id;
      return new Promise<T>((resolve) => {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          const answer = matches(event.data, id);
          if (answer === null) return;
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          setBusy(null);
          resolve(answer);
        };
        const onError = (error: ErrorEvent) => {
          console.warn("Tidy worker failed, falling back to inline.", error.message);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          worker.terminate();
          workerRef.current = null;
          const answer = inline();
          setBusy(null);
          resolve(answer);
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage(request(id));
      });
    },
    []
  );

  const inspect = useCallback(
    (state: GcImportState, stamp: string): Promise<PoolInspection> =>
      ask<PoolInspection>(
        "inspect",
        (id) => ({ kind: "inspect", id, state, stamp }),
        (response, id) =>
          response.kind === "inspect" && response.id === id
            ? { health: response.health, settleable: response.settleable }
            : null,
        () => {
          const health = poolHealth(state, stamp);
          return { health, settleable: health.standInPlayed === 0 ? 0 : settleableNow(state) };
        }
      ),
    [ask]
  );

  /**
   * Tidies the pool, or returns null because something else is already writing it.
   *
   * The claim is the whole reason this is not just a call. A tidy reads the pool, works for the
   * better part of half a minute, and then saves all of it — so a pull that starts in the middle
   * has its first few hundred teams overwritten by a tidy that never saw them, and the pull's
   * cursor has already counted them settled. While it ran on the main thread nothing else could
   * start; off the main thread, everything can.
   */
  const tidy = useCallback(
    async (state: GcImportState): Promise<TidyOutcome | null> => {
      const session = beginTidy(new Date().toISOString());
      if (!session) return null;
      try {
        return await ask<TidyOutcome>(
          "tidy",
          (id) => ({ kind: "tidy", id, state }),
          (response, id) =>
            response.kind === "tidy" && response.id === id
              ? { state: response.state, tidy: response.tidy }
              : null,
          () => {
            const { state: tidied, ...counts } = tidyPool(state);
            return { state: tidied, tidy: counts };
          }
        );
      } finally {
        // Released even when the worker throws on the way out, or the slot is held for good.
        endTidy(session);
      }
    },
    [ask]
  );

  return { inspect, tidy, busy };
}
