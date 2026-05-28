import { useEffect, useMemo, useRef, useState } from "react";
import { simulateGoldOdds } from "../lib/sim";
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
  const [pending, setPending] = useState(false);
  const [resultKey, setResultKey] = useState<string | null>(null);
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

  useEffect(() => {
    if (!input.teams.length) {
      setOdds({});
      setResultKey(key);
      setPending(false);
      return;
    }
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;
    setPending(true);

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      if (handle.worker) {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.kind === "runtime-stats" && event.data.id === id) {
            console.debug(`[sim-worker] odds ${event.data.elapsedMs.toFixed(1)}ms`);
            return;
          }
          if (event.data.kind !== "odds" || event.data.id !== id) return;
          handle.worker?.removeEventListener("message", onMessage);
          if (latestIdRef.current === id) {
            setOdds(event.data.odds);
            setResultKey(key);
            setPending(false);
          }
        };
        handle.worker.addEventListener("message", onMessage);
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
        handle.worker.postMessage(req);
      } else {
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
          setPending(false);
          console.debug(`[sim-inline] odds ${(performance.now() - start).toFixed(1)}ms`);
        }
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      handle.worker?.postMessage({ kind: "cancel", id });
    };
  }, [key, debounceMs, input.teams, input.remaining, input.iterations, input.seedText, input.cutoff, input.settings]);

  return { odds, pending, inputKey: key, resultKey };
}

export function useSimulationTrend(input: TrendInput, debounceMs = 250) {
  const [trend, setTrend] = useState<Record<string, number[]>>({});
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

  useEffect(() => {
    if (!input.teamIds.length || !input.states.length) {
      const empty: Record<string, number[]> = {};
      input.teamIds.forEach((id) => {
        empty[id] = [];
      });
      setTrend(empty);
      return;
    }
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      if (handle.worker) {
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.kind === "runtime-stats" && event.data.id === id) {
            console.debug(`[sim-worker] trend ${event.data.elapsedMs.toFixed(1)}ms`);
            return;
          }
          if (event.data.kind !== "trend" || event.data.id !== id) return;
          handle.worker?.removeEventListener("message", onMessage);
          if (latestIdRef.current === id) {
            setTrend(event.data.trend);
          }
        };
        handle.worker.addEventListener("message", onMessage);
        const req: WorkerRequest = {
          kind: "trend",
          id,
          teamIds: input.teamIds,
          states: input.states,
          iterations: input.iterations,
          cutoff: input.cutoff,
          settings: input.settings,
        };
        handle.worker.postMessage(req);
      } else {
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
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      handle.worker?.postMessage({ kind: "cancel", id });
    };
  }, [key, debounceMs, input.teamIds, input.states, input.iterations, input.cutoff, input.settings]);

  return trend;
}
