import { useEffect, useRef, useState } from "react";
import { createWorker } from "./createWorker";
import type { WorkerRequest, WorkerResponse } from "../workers/sim.worker";

/**
 * One debounced, cancellable run of a simulation, on a worker where there is one.
 *
 * The odds, trend and bracket hooks each carried their own copy of this: the worker reference and
 * its lifecycle, the input hash, the debounce timer, the staleness guard, three listeners and
 * their teardown, the inline fallback, the postMessage try/catch, and the cancel on cleanup. Three
 * copies of around a hundred and fifty lines, and they had already drifted — one of them kept a
 * worker that had failed and went on posting to it every run, which neither sibling did. Behaviour
 * that exists in triplicate is behaviour that is correct in at most one place for long.
 *
 * What is genuinely different between the three is small and lives in the spec: what the input
 * hashes to, what request to post, how to recognise the answer, and how to work it out inline.
 */
export type WorkerJobSpec<Res> = {
  /** Nothing to run. No worker is started and no result is set; the caller derives its own empty. */
  idle: boolean;
  /**
   * The identity of the input, as a string.
   *
   * This is what decides that a run is needed, so it must change whenever the answer would. It is
   * also what a caller compares a stored result against to know whether the result still describes
   * what is on screen.
   */
  key: string;
  /** How long to wait before starting, so a run of edits costs one simulation rather than ten. */
  debounceMs: number;
  /** Names this job in the development timing lines. */
  label: string;
  /** The request to post, built with the id that marks this run. */
  request: (id: number) => WorkerRequest;
  /** The answer out of a worker message, or null if the message is not this job's. */
  accept: (data: WorkerResponse, id: number) => Res | null;
  /** The same answer, computed here. Used when there is no worker and when one fails. */
  inline: () => Res;
  /** Called with a finished answer, and the key it was computed for. */
  onResult: (result: Res, key: string) => void;
};

type WorkerHandle = {
  worker: Worker | null;
  nextId: number;
};

/**
 * A worker that has failed once fails every run after it: the post goes nowhere, the inline
 * fallback is paid again, and nothing ever makes a fresh one. Both ways it can fail — the error
 * event, and a postMessage that throws because the request would not clone — mean the same thing,
 * so both come through here and the next run starts a new worker.
 */
const dropWorker = (handle: WorkerHandle) => {
  handle.worker?.terminate();
  handle.worker = null;
};

export function useWorkerJob<Res>(spec: WorkerJobSpec<Res>): string | null {
  const [workerError, setWorkerError] = useState<string | null>(null);
  const handleRef = useRef<WorkerHandle>({ worker: null, nextId: 0 });
  const latestIdRef = useRef(0);

  /*
   * The spec is rebuilt every render, so the run effect cannot depend on it without running every
   * render. It depends on the three things that decide whether a run is needed, and reads the rest
   * through here. That is not a way around the dependency rule: `key` is defined as changing
   * whenever the answer would, so a spec whose closures have moved on without it is a wrong key,
   * not a missing dependency.
   */
  const specRef = useRef(spec);
  useEffect(() => {
    specRef.current = spec;
  });

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle.worker)
      handle.worker = createWorker(
        () => new Worker(new URL("../workers/sim.worker.ts", import.meta.url), { type: "module" }),
        "Sim"
      );
    return () => {
      handle.worker?.terminate();
      handle.worker = null;
    };
  }, []);

  const { idle, key, debounceMs } = spec;

  useEffect(() => {
    if (idle) return;
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;
    let removeWorkerListeners: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;
      const job = specRef.current;
      if (!handle.worker)
        handle.worker = createWorker(
          () =>
            new Worker(new URL("../workers/sim.worker.ts", import.meta.url), { type: "module" }),
          "Sim"
        );

      const runInline = () => {
        const start = performance.now();
        const result = job.inline();
        if (latestIdRef.current === id) job.onResult(result, key);
        if (import.meta.env.DEV) {
          console.debug(`[sim-inline] ${job.label} ${(performance.now() - start).toFixed(1)}ms`);
        }
      };

      if (!handle.worker) {
        runInline();
        return;
      }

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.kind === "runtime-stats" && event.data.id === id) {
          if (import.meta.env.DEV) {
            console.debug(`[sim-worker] ${job.label} ${event.data.elapsedMs.toFixed(1)}ms`);
          }
          return;
        }
        const result = job.accept(event.data, id);
        if (result === null) return;
        removeWorkerListeners?.();
        removeWorkerListeners = null;
        if (latestIdRef.current === id) {
          setWorkerError(null);
          job.onResult(result, key);
        }
      };
      const onError = (event: Event) => {
        removeWorkerListeners?.();
        removeWorkerListeners = null;
        dropWorker(handle);
        setWorkerError(event.type);
        runInline();
      };

      const worker = handle.worker;
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
      removeWorkerListeners = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
      };

      try {
        worker.postMessage(job.request(id));
      } catch (err) {
        removeWorkerListeners?.();
        removeWorkerListeners = null;
        dropWorker(handle);
        setWorkerError(err instanceof Error ? err.message : "postMessage failed");
        runInline();
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      removeWorkerListeners?.();
      removeWorkerListeners = null;
      try {
        handle.worker?.postMessage({ kind: "cancel", id });
      } catch {
        // Worker may already be terminating; stale responses are ignored by id.
      }
    };
  }, [idle, key, debounceMs]);

  return workerError;
}
