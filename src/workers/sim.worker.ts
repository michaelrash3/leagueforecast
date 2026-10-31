/// <reference lib="webworker" />
import {
  simulateBracketOdds,
  simulateGoldOddsRun,
  simulateTrendPoint,
  type BracketOddsResult,
  type GoldSwing,
} from "../lib/sim";
import type { GameLog, Matchup, Settings, Team } from "../lib/types";

export type CancelRequest = { kind: "cancel"; id: number };
export type OddsRequest = {
  kind: "odds";
  id: number;
  teams: Team[];
  remaining: Matchup[];
  iterations: number;
  seedText: string;
  cutoff: number;
  settings: Settings;
  /** The team followed, whose odds are also counted by how each game left goes (`GoldSwing`). */
  follow?: string;
};
export type TrendRequest = {
  kind: "trend";
  id: number;
  teamIds: string[];
  /** The trend's points (`TrendState`), the last two paired. */
  states: { teams: Team[]; remaining: Matchup[]; seedText: string; paired?: true }[];
  iterations: number;
  cutoff: number;
  settings: Settings;
};
export type BracketRequest = {
  kind: "bracket";
  id: number;
  teams: Team[];
  remaining: Matchup[];
  iterations: number;
  seedText: string;
  cutoff: number;
  settings: Settings;
  /** The Gold bracket's scores as kept, for the games already played (`simulateBracketOdds`). */
  bracketLogs?: Record<string, GameLog>;
};
export type WorkerRequest = OddsRequest | TrendRequest | BracketRequest | CancelRequest;
export type OddsResponse = {
  kind: "odds";
  id: number;
  odds: Record<string, number>;
  /** Average finishing place per team, over the same seasons. */
  places: Record<string, number>;
  /** Seasons actually played out, for the ± beside the odds. */
  iterations: number;
  /** For the team followed, where one was asked about (`GoldSwing`). */
  swing?: GoldSwing;
};
export type TrendResponse = { kind: "trend"; id: number; trend: Record<string, number[]> };
export type BracketResponse = { kind: "bracket"; id: number; result: BracketOddsResult };
export type RuntimeStatsResponse = {
  kind: "runtime-stats";
  id: number;
  mode: "odds" | "trend" | "bracket";
  elapsedMs: number;
};
export type WorkerResponse = OddsResponse | TrendResponse | BracketResponse | RuntimeStatsResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const canceled = new Set<number>();

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.kind === "cancel") {
    canceled.add(req.id);
    return;
  }
  if (canceled.has(req.id)) return;

  if (req.kind === "odds") {
    const start = performance.now();
    const { odds, places, iterations, swing } = simulateGoldOddsRun(
      req.teams,
      req.remaining,
      req.iterations,
      req.seedText,
      req.cutoff,
      req.settings,
      req.follow
    );
    if (!canceled.has(req.id))
      ctx.postMessage({
        kind: "odds",
        id: req.id,
        odds,
        places,
        iterations,
        ...(swing ? { swing } : {}),
      } satisfies OddsResponse);
    if (!canceled.has(req.id))
      ctx.postMessage({
        kind: "runtime-stats",
        id: req.id,
        mode: "odds",
        elapsedMs: performance.now() - start,
      } satisfies RuntimeStatsResponse);
    canceled.delete(req.id);
    return;
  }

  if (req.kind === "bracket") {
    const start = performance.now();
    const result = simulateBracketOdds(
      req.teams,
      req.remaining,
      req.iterations,
      req.seedText,
      req.cutoff,
      req.settings,
      req.bracketLogs
    );
    if (!canceled.has(req.id))
      ctx.postMessage({ kind: "bracket", id: req.id, result } satisfies BracketResponse);
    if (!canceled.has(req.id))
      ctx.postMessage({
        kind: "runtime-stats",
        id: req.id,
        mode: "bracket",
        elapsedMs: performance.now() - start,
      } satisfies RuntimeStatsResponse);
    canceled.delete(req.id);
    return;
  }

  const trend: Record<string, number[]> = {};
  const start = performance.now();
  req.teamIds.forEach((id) => {
    trend[id] = [];
  });
  req.states.forEach((state) => {
    if (canceled.has(req.id)) return;
    const odds = simulateTrendPoint(state, req.iterations, req.cutoff, req.settings);
    req.teamIds.forEach((id) => {
      const series = trend[id];
      if (series) series.push(odds[id] ?? 0);
    });
  });
  if (!canceled.has(req.id))
    ctx.postMessage({ kind: "trend", id: req.id, trend } satisfies TrendResponse);
  if (!canceled.has(req.id))
    ctx.postMessage({
      kind: "runtime-stats",
      id: req.id,
      mode: "trend",
      elapsedMs: performance.now() - start,
    } satisfies RuntimeStatsResponse);
  canceled.delete(req.id);
};
