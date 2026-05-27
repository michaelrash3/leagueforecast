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

export type SimulationRuntime = "worker" | "inline";

type WorkerHandle = {
  worker: Worker | null;
  nextId: number;
};

export function attachWorkerRequestListener(
  worker: Worker,
  id: number,
  kind: WorkerResponse["kind"],
  latestIdRef: { current: number },
  onResolve: (payload: WorkerResponse) => void
) {
  const onMessage = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.kind !== kind || event.data.id !== id) return;
    if (latestIdRef.current === id) onResolve(event.data);
  };
  worker.addEventListener("message", onMessage);
  return () => worker.removeEventListener("message", onMessage);
}

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

export function useSimulationOdds(input: OddsInput, debounceMs = 200, onFallback?: (runtime: SimulationRuntime) => void) {
  const [odds, setOdds] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const handleRef = useRef<WorkerHandle>({ worker: null, nextId: 0 });
  const fallbackNotifiedRef = useRef(false);
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
      setPending(false);
      return;
    }
    const handle = handleRef.current;
    const id = handle.nextId + 1;
    handle.nextId = id;
    latestIdRef.current = id;
    setPending(true);
    let removeListener = () => {};

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      if (handle.worker) {
        removeListener = attachWorkerRequestListener(handle.worker, id, "odds", latestIdRef, (response) => {
          if (response.kind !== "odds") return;
          setOdds(response.odds);
          setPending(false);
        });
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
        if (!fallbackNotifiedRef.current) {
          onFallback?.("inline");
          fallbackNotifiedRef.current = true;
        }
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
          setPending(false);
        }
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      removeListener();
      if (latestIdRef.current === id) {
        setPending(false);
      }
    };
  }, [key, debounceMs, input.teams, input.remaining, input.iterations, input.seedText, input.cutoff, input.settings, onFallback]);

  const runtime: SimulationRuntime = handleRef.current.worker ? "worker" : "inline";
  return { odds, pending, runtime };
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
    let removeListener = () => {};

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      if (handle.worker) {
        removeListener = attachWorkerRequestListener(handle.worker, id, "trend", latestIdRef, (response) => {
          if (response.kind !== "trend") return;
          setTrend(response.trend);
        });
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
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      removeListener();
    };
  }, [key, debounceMs, input.teamIds, input.states, input.iterations, input.cutoff, input.settings]);

  return trend;
}
