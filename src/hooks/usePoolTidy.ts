import { useCallback, useEffect, useRef, useState } from "react";
import type { GcImportState, PoolTidy } from "../lib/gameChangerImport";
import { tidyPool } from "../lib/gameChangerImport";
import { todayIsoDay } from "../lib/date";
import { poolHealth, settleableNow, type PoolHealth } from "../lib/poolHealth";
import { beginTidy, endTidy } from "../lib/pullSession";
import {
  applyTidied,
  packPool,
  type WorkerRequest,
  type WorkerResponse,
} from "../workers/tidyProtocol";
import { createWorker } from "./createWorker";

/**
 * Inspecting and tidying the pool without locking the page up.
 *
 * Both jobs walk every game, and on a nationwide pool that is half a second for the inspection and
 * something like half a minute for the tidy. Off the main thread for that reason; inline where a
 * worker cannot be had, so nothing depends on having one.
 */

/**
 * Work nobody asked for does not get to run on the main thread.
 *
 * Both jobs here walk the whole pool, which on a nationwide one is twenty or thirty seconds. When
 * a person presses a button for that, a wait is the answer they asked for and inline is a fine
 * place to do it. When it starts by itself on page load it is not: the tab freezes, the browser
 * reloads it, the reload cancels the run before it can record that it happened, and the next load
 * starts it again. That is a loop with no way out of it from inside the page, and it is what
 * happened when a refactor silently stopped the workers being built at all.
 *
 * So the automatic caller passes this, and gets null rather than a frozen tab when there is no
 * worker to do it properly. The pool then stays untidied until someone presses the button in
 * Setup, which is the right outcome: untidied is a cosmetic problem, an unusable app is not.
 */
export type TidyReach = { workerOnly?: boolean };

export type PoolInspection = { health: PoolHealth; settleable: number };
export type TidyOutcome = { state: GcImportState; tidy: Omit<PoolTidy, "state"> };

export function usePoolTidy() {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const [busy, setBusy] = useState<null | "inspect" | "tidy">(null);
  /**
   * Everything still waiting on the worker.
   *
   * Kept because terminating a worker fires neither `message` nor `error`: a promise waiting on
   * one is simply never settled again. That is a leak on its own, and a far worse one through the
   * tidy, which holds the pool's session slot until its promise settles — so an unmount in the
   * middle of a tidy left every later pull refused with "a pull is already running" for the rest of
   * the page's life, and nothing was running at all.
   */
  const waiting = useRef(new Set<() => void>());

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      // Settled rather than abandoned, so every `finally` waiting on one of these gets to run.
      waiting.current.forEach((giveUp) => giveUp());
      waiting.current.clear();
    },
    []
  );

  /** One round trip, or the same work inline when there is no worker and inline is allowed. */
  const ask = useCallback(
    <T>(
      job: "inspect" | "tidy",
      request: (id: number) => WorkerRequest,
      matches: (response: WorkerResponse, id: number) => T | null,
      inline: () => T,
      { workerOnly = false }: TidyReach = {}
    ): Promise<T | null> => {
      if (!workerRef.current)
        workerRef.current = createWorker(
          () =>
            new Worker(new URL("../workers/tidy.worker.ts", import.meta.url), { type: "module" }),
          "Tidy"
        );
      const worker = workerRef.current;
      if (!worker && workerOnly) return Promise.resolve(null);
      setBusy(job);
      if (!worker) {
        const answer = inline();
        setBusy(null);
        return Promise.resolve(answer);
      }
      const id = nextId.current + 1;
      nextId.current = id;
      return new Promise<T | null>((resolve) => {
        const done = (answer: T | null) => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          waiting.current.delete(giveUp);
          setBusy(null);
          resolve(answer);
        };
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          const answer = matches(event.data, id);
          if (answer === null) return;
          done(answer);
        };
        const onError = (error: ErrorEvent) => {
          console.warn("Tidy worker failed.", error.message);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          worker.terminate();
          workerRef.current = null;
          // A worker that died mid-job leaves the same choice as never having had one.
          done(workerOnly ? null : inline());
        };
        /** The panel went away mid-job. No answer is coming, and saying so is what frees the slot. */
        const giveUp = () => done(null);
        waiting.current.add(giveUp);
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage(request(id));
      });
    },
    []
  );

  const inspect = useCallback(
    (state: GcImportState, stamp: string): Promise<PoolInspection | null> =>
      ask<PoolInspection>(
        "inspect",
        (id) => ({ kind: "inspect", id, state: packPool(state), stamp, today: todayIsoDay() }),
        (response, id) =>
          response.kind === "inspect" && response.id === id
            ? { health: response.health, settleable: response.settleable }
            : null,
        () => {
          const health = poolHealth(state, stamp, todayIsoDay());
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
    async (state: GcImportState, reach: TidyReach = {}): Promise<TidyOutcome | null> => {
      const session = beginTidy(new Date().toISOString());
      if (!session) return null;
      try {
        return await ask<TidyOutcome>(
          "tidy",
          (id) => ({ kind: "tidy", id, state: packPool(state) }),
          // What came back is only what changed; the rest is the caller's own arrays, so the
          // identity checks that decide what to save see exactly what the tidy did.
          (response, id) =>
            response.kind === "tidy" && response.id === id
              ? { state: applyTidied(state, response.changed), tidy: response.tidy }
              : null,
          () => {
            const { state: tidied, ...counts } = tidyPool(state);
            return { state: tidied, tidy: counts };
          },
          reach
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
