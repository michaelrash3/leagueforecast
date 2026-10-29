import { useCallback, useMemo, useState } from "react";
import {
  simulateBracketOdds,
  simulateGoldOdds,
  simulateGoldOddsRun,
  type BracketOddsResult,
  type GoldSwing,
} from "../lib/sim";
import type { GameLog, Matchup, Settings, Team } from "../lib/types";
import type { WorkerResponse } from "../workers/sim.worker";
import { useWorkerJob } from "./useWorkerJob";

type OddsInput = {
  teams: Team[];
  remaining: Matchup[];
  iterations: number;
  seedText: string;
  cutoff: number;
  settings: Settings;
  /** The team followed, whose odds are also counted by how each game left goes (`GoldSwing`). */
  follow?: string;
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
  /** The Gold bracket's scores as kept, so a game already played is not drawn again. */
  bracketLogs?: Record<string, GameLog>;
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

/**
 * The opponent-adjusted rating each team carries into the simulation, as values.
 *
 * The keys below were made of counts, the seed and the settings, and the seed is built from the
 * league's final scores. A rating moves without any of those moving: a league team linked to its
 * club in Settings, a pull or a tidy in Team Rankings. The odds on screen then stayed the ones
 * simulated from the old ratings while the game picks beside them used the new ones — measured on
 * a rebuilt league, 9.8 points of Gold % after a preseason first pull. Values rather than the
 * teams' identity, because the teams are rebuilt on every keystroke in a game still in progress,
 * and a four-thousand-season run on each of those is the cost the seed was chosen to avoid.
 */
const ratingsKey = (teams: readonly Team[]) =>
  teams.map((team) => [team.id, team.adjustedRating ?? null, team.ratedGames ?? 0]);

/** The odds, and the number of seasons they were counted over. */
type OddsResult = {
  odds: Record<string, number>;
  places: Record<string, number>;
  iterations: number;
  swing?: GoldSwing;
};

export function useSimulationOdds(input: OddsInput, debounceMs = 200) {
  const [result, setResult] = useState<OddsResult>({
    odds: EMPTY_ODDS,
    places: EMPTY_ODDS,
    iterations: 0,
  });
  const [resultKey, setResultKey] = useState<string | null>(null);

  // Stable hash of inputs so we don't re-run on identity changes. The seed text carries every
  // final score (see `simulationSeed`), so correcting a score already marked final changes it.
  const key = useMemo(
    () =>
      JSON.stringify([
        input.teams.length,
        input.remaining.length,
        input.iterations,
        input.seedText,
        input.cutoff,
        input.settings,
        ratingsKey(input.teams),
        input.follow ?? null,
      ]),
    [
      input.teams,
      input.remaining.length,
      input.iterations,
      input.seedText,
      input.cutoff,
      input.settings,
      input.follow,
    ]
  );

  // Nothing to simulate; see EMPTY_ODDS above.
  const idle = input.teams.length === 0;

  const onResult = useCallback((next: OddsResult, forKey: string) => {
    setResult(next);
    setResultKey(forKey);
  }, []);

  const workerError = useWorkerJob<OddsResult>({
    idle,
    key,
    debounceMs,
    label: "odds",
    request: (id) => ({
      kind: "odds",
      id,
      teams: input.teams,
      remaining: input.remaining,
      iterations: input.iterations,
      seedText: input.seedText,
      cutoff: input.cutoff,
      settings: input.settings,
      ...(input.follow ? { follow: input.follow } : {}),
    }),
    accept: (data: WorkerResponse, id) =>
      data.kind === "odds" && data.id === id
        ? {
            odds: data.odds,
            places: data.places,
            iterations: data.iterations,
            ...(data.swing ? { swing: data.swing } : {}),
          }
        : null,
    inline: () => {
      const run = simulateGoldOddsRun(
        input.teams,
        input.remaining,
        input.iterations,
        input.seedText,
        input.cutoff,
        input.settings,
        input.follow
      );
      return {
        odds: run.odds,
        places: run.places,
        iterations: run.iterations,
        ...(run.swing ? { swing: run.swing } : {}),
      };
    },
    onResult,
  });

  // `resultKey` matching `inputKey` is how callers know the odds describe the current input, so an
  // idle pool reports the current key: an empty answer for no teams is up to date, not stale.
  // `pending` is not a separate fact to track: work is outstanding exactly when the stored result
  // does not describe the current input. Deriving it removes a whole state whose only job was to
  // be flipped on either side of the same await, and it is true from the first render rather than
  // one render late.
  return {
    odds: idle ? EMPTY_ODDS : result.odds,
    places: idle ? EMPTY_ODDS : result.places,
    iterations: idle ? 0 : result.iterations,
    // The swing of the team the odds were asked about, and only while it is still the one followed.
    swing: !idle && result.swing?.teamId === input.follow ? result.swing : undefined,
    pending: !idle && resultKey !== key,
    inputKey: key,
    resultKey: idle ? key : resultKey,
    workerError,
  };
}

export function useSimulationTrend(input: TrendInput, debounceMs = 250) {
  const [trend, setTrend] = useState<Record<string, number[]>>({});

  const key = useMemo(
    () =>
      JSON.stringify([
        input.teamIds,
        // Each point's ratings too, for the reason `ratingsKey` gives: a pull moves them and no seed.
        input.states.map((s) => [s.seedText, ratingsKey(s.teams)]),
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

  const onResult = useCallback((next: Record<string, number[]>) => setTrend(next), []);

  useWorkerJob<Record<string, number[]>>({
    idle,
    key,
    debounceMs,
    label: "trend",
    request: (id) => ({
      kind: "trend",
      id,
      teamIds: input.teamIds,
      states: input.states,
      iterations: input.iterations,
      cutoff: input.cutoff,
      settings: input.settings,
    }),
    accept: (data: WorkerResponse, id) =>
      data.kind === "trend" && data.id === id ? data.trend : null,
    inline: () => {
      const series: Record<string, number[]> = {};
      input.teamIds.forEach((tid) => {
        series[tid] = [];
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
          const row = series[tid];
          if (row) row.push(odds[tid] ?? 0);
        });
      });
      return series;
    },
    onResult,
  });

  return idle ? idleTrend : trend;
}

export function useSimulationBracket(input: BracketInput, debounceMs = 300) {
  const [result, setResult] = useState<BracketOddsResult>(EMPTY_BRACKET);
  /** Which input the stored bracket describes, so `pending` can be derived rather than tracked. */
  const [resultKey, setResultKey] = useState<string | null>(null);

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
        ratingsKey(input.teams),
        input.bracketLogs,
      ]),
    [
      input.enabled,
      input.teams,
      input.remaining.length,
      input.iterations,
      input.seedText,
      input.cutoff,
      input.settings,
      input.bracketLogs,
    ]
  );

  const idle = !input.enabled || input.teams.length === 0;

  const onResult = useCallback((next: BracketOddsResult, forKey: string) => {
    setResult(next);
    setResultKey(forKey);
  }, []);

  useWorkerJob<BracketOddsResult>({
    idle,
    key,
    debounceMs,
    label: "bracket",
    request: (id) => ({
      kind: "bracket",
      id,
      teams: input.teams,
      remaining: input.remaining,
      iterations: input.iterations,
      seedText: input.seedText,
      cutoff: input.cutoff,
      settings: input.settings,
      ...(input.bracketLogs ? { bracketLogs: input.bracketLogs } : {}),
    }),
    accept: (data: WorkerResponse, id) =>
      data.kind === "bracket" && data.id === id ? data.result : null,
    inline: () =>
      simulateBracketOdds(
        input.teams,
        input.remaining,
        input.iterations,
        input.seedText,
        input.cutoff,
        input.settings,
        input.bracketLogs
      ),
    onResult,
  });

  return {
    bracketOdds: idle ? EMPTY_BRACKET : result,
    pending: !idle && resultKey !== key,
  };
}
