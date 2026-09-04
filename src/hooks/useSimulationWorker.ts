import { useEffect, useMemo, useRef, useState } from "react";
import { simulateBracketOdds, simulateGoldOdds, type BracketOddsResult } from "../lib/sim";
import type { Matchup, Settings, Team } from "../lib/types";
import type { WorkerRequest, WorkerResponse } from "../workers/sim.worker";

type OddsInput = {
  teams: Team[];
  remaining: Matchup[];
  iterations: number;
  seedText: string;
  cutoff: number;
  settings: Settings;
};

type TrendInput = {
  teamIds: string[];
  states: { teams: Team[]; remaining: Matchup[]; seedText: string }[];
  iterations: number;
  cutoff: number;
  settings: Settings;
};

type BracketInput = {
  teams: Team[];
  remaining: Matchup[];
  iterations: number;
  seedText: string;
  cutoff: number;
  settings: Settings;
  /** When false, the sim is skipped entirely (e.g. the bracket view isn't visible). */
  enabled: boolean;
};

/**
 * The three hooks below all have an input that is simply not simulatable — no teams yet, no cut
 * line, the panel switched off. That used to be handled by writing an empty result into state from
 * inside the effect, which meant a render showing the previous result before the empty one landed.
 * The empty answer is a fact about the input, not something to store, so it is derived on the way
 * out instead. These constants keep that derived value referentially stable, so a consumer that
 * memoises on it does not re-run every render.
 */
const EMPTY_ODDS: Record<string, number> = {};

const EMPTY_BRACKET: BracketOddsResult = {
  seedDistribution: {},
  championOdds: {},
  finalsOdds: {},
  iterations: 0,
};

type WorkerHandle = {
  worker: Worker | null;
  nextId: number;
};

const createWorker = (): Worker | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/sim.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (err) {
    console.warn("Sim worker unavailable, falling back to inline.", err);
    return null;
  }
};

export function useSimulationOdds(input: OddsInput, debounceMs = 200) {
  const [odds, setOdds] = useState<Record<string, number>>({});
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const handleRef = useRef<WorkerHandle>({ worker: null, nextId: 0 });
  const latestIdRef = useRef(0);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle.worker) handle.worker = createWorker();
    return () => {
      handle.worker?.terminate();
      handle.worker = null;
    };
  }, []);

  // Stable hash of inputs so we don't re-run on identity changes.
  const key = useMemo(
    () =>
      JSON.stringify([
        input.teams.length,
        input.remaining.length,
        input.iterations,
        input.seedText,
        input.cutoff,
        input.settings,
      ]),
    [
      input.teams.length,
      input.remaining.length,
      input.iterations,
      input.seedText,
      input.cutoff,
      input.settings,
    ]
  );

  // Nothing to simulate; see EMPTY_ODDS above.
  const idle = input.teams.length === 0;

  useEffect(() => {
    if (idle) return;
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;
    let removeWorkerListeners: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      const runInline = () => {
        const start = performance.now();
        const result = simulateGoldOdds(
          input.teams,
          input.remaining,
          input.iterations,
          input.seedText,
          input.cutoff,
          input.settings
        );
        if (latestIdRef.current === id) {
          setOdds(result);
          setResultKey(key);
          console.debug(`[sim-inline] odds ${(performance.now() - start).toFixed(1)}ms`);
        }
      };

      if (handle.worker) {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.kind === "runtime-stats" && event.data.id === id) {
            console.debug(`[sim-worker] odds ${event.data.elapsedMs.toFixed(1)}ms`);
            return;
          }
          if (event.data.kind !== "odds" || event.data.id !== id) return;
          removeWorkerListeners?.();
          removeWorkerListeners = null;
          if (latestIdRef.current === id) {
            setWorkerError(null);
            setOdds(event.data.odds);
            setResultKey(key);
          }
        };
        const onError = (event: Event) => {
          removeWorkerListeners?.();
          removeWorkerListeners = null;
          setWorkerError(event.type);
          runInline();
        };
        handle.worker.addEventListener("message", onMessage);
        handle.worker.addEventListener("error", onError);
        handle.worker.addEventListener("messageerror", onError);
        removeWorkerListeners = () => {
          handle.worker?.removeEventListener("message", onMessage);
          handle.worker?.removeEventListener("error", onError);
          handle.worker?.removeEventListener("messageerror", onError);
        };
        const req: WorkerRequest = {
          kind: "odds",
          id,
          teams: input.teams,
          remaining: input.remaining,
          iterations: input.iterations,
          seedText: input.seedText,
          cutoff: input.cutoff,
          settings: input.settings,
        };
        try {
          handle.worker.postMessage(req);
        } catch (err) {
          setWorkerError(err instanceof Error ? err.message : "postMessage failed");
          runInline();
        }
      } else {
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
  }, [
    idle,
    key,
    debounceMs,
    input.teams,
    input.remaining,
    input.iterations,
    input.seedText,
    input.cutoff,
    input.settings,
  ]);

  // `resultKey` matching `inputKey` is how callers know the odds describe the current input, so an
  // idle pool reports the current key: an empty answer for no teams is up to date, not stale.
  // `pending` is not a separate fact to track: work is outstanding exactly when the stored result
  // does not describe the current input. Deriving it removes a whole state whose only job was to
  // be flipped on either side of the same await, and it is true from the first render rather than
  // one render late.
  return {
    odds: idle ? EMPTY_ODDS : odds,
    pending: !idle && resultKey !== key,
    inputKey: key,
    resultKey: idle ? key : resultKey,
    workerError,
  };
}

export function useSimulationTrend(input: TrendInput, debounceMs = 250) {
  const [trend, setTrend] = useState<Record<string, number[]>>({});
  const [workerError, setWorkerError] = useState<string | null>(null);
  const handleRef = useRef<WorkerHandle>({ worker: null, nextId: 0 });
  const latestIdRef = useRef(0);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle.worker) handle.worker = createWorker();
    return () => {
      handle.worker?.terminate();
      handle.worker = null;
    };
  }, []);

  const key = useMemo(
    () =>
      JSON.stringify([
        input.teamIds,
        input.states.map((s) => s.seedText),
        input.iterations,
        input.cutoff,
        input.settings,
      ]),
    [input.teamIds, input.states, input.iterations, input.cutoff, input.settings]
  );

  const idle = input.teamIds.length === 0 || input.states.length === 0;

  // One empty series per team, so a chart still has its rows to draw.
  const idleTrend = useMemo(() => {
    const empty: Record<string, number[]> = {};
    input.teamIds.forEach((id) => {
      empty[id] = [];
    });
    return empty;
  }, [input.teamIds]);

  useEffect(() => {
    if (idle) return;
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;
    let removeWorkerListeners: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      const runInline = () => {
        const start = performance.now();
        const result: Record<string, number[]> = {};
        input.teamIds.forEach((tid) => {
          result[tid] = [];
        });
        input.states.forEach((state) => {
          const odds = simulateGoldOdds(
            state.teams,
            state.remaining,
            input.iterations,
            state.seedText,
            input.cutoff,
            input.settings
          );
          input.teamIds.forEach((tid) => {
            const series = result[tid];
            if (series) series.push(odds[tid] ?? 0);
          });
        });
        if (latestIdRef.current === id) setTrend(result);
        console.debug(`[sim-inline] trend ${(performance.now() - start).toFixed(1)}ms`);
      };

      if (handle.worker) {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.kind === "runtime-stats" && event.data.id === id) {
            console.debug(`[sim-worker] trend ${event.data.elapsedMs.toFixed(1)}ms`);
            return;
          }
          if (event.data.kind !== "trend" || event.data.id !== id) return;
          removeWorkerListeners?.();
          removeWorkerListeners = null;
          if (latestIdRef.current === id) {
            setWorkerError(null);
            setTrend(event.data.trend);
          }
        };
        const onError = (event: Event) => {
          removeWorkerListeners?.();
          removeWorkerListeners = null;
          setWorkerError(event.type);
          runInline();
        };
        handle.worker.addEventListener("message", onMessage);
        handle.worker.addEventListener("error", onError);
        handle.worker.addEventListener("messageerror", onError);
        removeWorkerListeners = () => {
          handle.worker?.removeEventListener("message", onMessage);
          handle.worker?.removeEventListener("error", onError);
          handle.worker?.removeEventListener("messageerror", onError);
        };
        const req: WorkerRequest = {
          kind: "trend",
          id,
          teamIds: input.teamIds,
          states: input.states,
          iterations: input.iterations,
          cutoff: input.cutoff,
          settings: input.settings,
        };
        try {
          handle.worker.postMessage(req);
        } catch (err) {
          setWorkerError(err instanceof Error ? err.message : "postMessage failed");
          runInline();
        }
      } else {
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
  }, [
    idle,
    key,
    debounceMs,
    input.teamIds,
    input.states,
    input.iterations,
    input.cutoff,
    input.settings,
  ]);

  void workerError;
  return idle ? idleTrend : trend;
}

export function useSimulationBracket(input: BracketInput, debounceMs = 300) {
  const [result, setResult] = useState<BracketOddsResult>(EMPTY_BRACKET);
  /** Which input the stored bracket describes, so `pending` can be derived rather than tracked. */
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const handleRef = useRef<WorkerHandle>({ worker: null, nextId: 0 });
  const latestIdRef = useRef(0);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle.worker) handle.worker = createWorker();
    return () => {
      handle.worker?.terminate();
      handle.worker = null;
    };
  }, []);

  const key = useMemo(
    () =>
      JSON.stringify([
        input.enabled,
        input.teams.length,
        input.remaining.length,
        input.iterations,
        input.seedText,
        input.cutoff,
        input.settings,
      ]),
    [
      input.enabled,
      input.teams.length,
      input.remaining.length,
      input.iterations,
      input.seedText,
      input.cutoff,
      input.settings,
    ]
  );

  // A bracket needs at least two teams inside the cut to mean anything.
  const idle = !input.enabled || input.teams.length === 0 || input.cutoff < 2;

  useEffect(() => {
    if (idle) return;
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;
    let removeWorkerListeners: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      const runInline = () => {
        const inline = simulateBracketOdds(
          input.teams,
          input.remaining,
          input.iterations,
          input.seedText,
          input.cutoff,
          input.settings
        );
        if (latestIdRef.current === id) {
          setResult(inline);
          setResultKey(key);
        }
      };

      if (handle.worker) {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.kind === "runtime-stats" && event.data.id === id) {
            console.debug(`[sim-worker] bracket ${event.data.elapsedMs.toFixed(1)}ms`);
            return;
          }
          if (event.data.kind !== "bracket" || event.data.id !== id) return;
          removeWorkerListeners?.();
          removeWorkerListeners = null;
          if (latestIdRef.current === id) {
            setWorkerError(null);
            setResult(event.data.result);
            setResultKey(key);
          }
        };
        const onError = (event: Event) => {
          removeWorkerListeners?.();
          removeWorkerListeners = null;
          setWorkerError(event.type);
          runInline();
        };
        handle.worker.addEventListener("message", onMessage);
        handle.worker.addEventListener("error", onError);
        handle.worker.addEventListener("messageerror", onError);
        removeWorkerListeners = () => {
          handle.worker?.removeEventListener("message", onMessage);
          handle.worker?.removeEventListener("error", onError);
          handle.worker?.removeEventListener("messageerror", onError);
        };
        const req: WorkerRequest = {
          kind: "bracket",
          id,
          teams: input.teams,
          remaining: input.remaining,
          iterations: input.iterations,
          seedText: input.seedText,
          cutoff: input.cutoff,
          settings: input.settings,
        };
        try {
          handle.worker.postMessage(req);
        } catch (err) {
          setWorkerError(err instanceof Error ? err.message : "postMessage failed");
          runInline();
        }
      } else {
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
  }, [
    idle,
    key,
    debounceMs,
    input.enabled,
    input.teams,
    input.remaining,
    input.iterations,
    input.seedText,
    input.cutoff,
    input.settings,
  ]);

  void workerError;
  return {
    bracketOdds: idle ? EMPTY_BRACKET : result,
    pending: !idle && resultKey !== key,
  };
}
