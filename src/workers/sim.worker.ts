/// <reference lib="webworker" />
import { simulateBracketOdds, simulateGoldOdds, type BracketOddsResult } from "../lib/sim";
import type { Matchup, Settings, Team } from "../lib/types";

export type CancelRequest = { kind: "cancel"; id: number };
export type OddsRequest = { kind: "odds"; id: number; teams: Team[]; remaining: Matchup[]; iterations: number; seedText: string; cutoff: number; settings: Settings };
export type TrendRequest = { kind: "trend"; id: number; teamIds: string[]; states: { teams: Team[]; remaining: Matchup[]; seedText: string }[]; iterations: number; cutoff: number; settings: Settings };
export type BracketRequest = { kind: "bracket"; id: number; teams: Team[]; remaining: Matchup[]; iterations: number; seedText: string; cutoff: number; settings: Settings };
export type WorkerRequest = OddsRequest | TrendRequest | BracketRequest | CancelRequest;
export type OddsResponse = { kind: "odds"; id: number; odds: Record<string, number> };
export type TrendResponse = { kind: "trend"; id: number; trend: Record<string, number[]> };
export type BracketResponse = { kind: "bracket"; id: number; result: BracketOddsResult };
export type RuntimeStatsResponse = { kind: "runtime-stats"; id: number; mode: "odds" | "trend" | "bracket"; elapsedMs: number };
export type WorkerResponse = OddsResponse | TrendResponse | BracketResponse | RuntimeStatsResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const canceled = new Set<number>();

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.kind === "cancel") { canceled.add(req.id); return; }
  if (canceled.has(req.id)) return;

  if (req.kind === "odds") {
    const start = performance.now();
    const odds = simulateGoldOdds(req.teams, req.remaining, req.iterations, req.seedText, req.cutoff, req.settings);
    if (!canceled.has(req.id)) ctx.postMessage({ kind: "odds", id: req.id, odds } satisfies OddsResponse);
    if (!canceled.has(req.id)) ctx.postMessage({ kind: "runtime-stats", id: req.id, mode: "odds", elapsedMs: performance.now() - start } satisfies RuntimeStatsResponse);
    canceled.delete(req.id);
    return;
  }

  if (req.kind === "bracket") {
    const start = performance.now();
    const result = simulateBracketOdds(req.teams, req.remaining, req.iterations, req.seedText, req.cutoff, req.settings);
    if (!canceled.has(req.id)) ctx.postMessage({ kind: "bracket", id: req.id, result } satisfies BracketResponse);
    if (!canceled.has(req.id)) ctx.postMessage({ kind: "runtime-stats", id: req.id, mode: "bracket", elapsedMs: performance.now() - start } satisfies RuntimeStatsResponse);
    canceled.delete(req.id);
    return;
  }

  const trend: Record<string, number[]> = {};
  const start = performance.now();
  req.teamIds.forEach((id) => { trend[id] = []; });
  req.states.forEach((state) => {
    if (canceled.has(req.id)) return;
    const odds = simulateGoldOdds(state.teams, state.remaining, req.iterations, state.seedText, req.cutoff, req.settings);
    req.teamIds.forEach((id) => { const series = trend[id]; if (series) series.push(odds[id] ?? 0); });
  });
  if (!canceled.has(req.id)) ctx.postMessage({ kind: "trend", id: req.id, trend } satisfies TrendResponse);
  if (!canceled.has(req.id)) ctx.postMessage({ kind: "runtime-stats", id: req.id, mode: "trend", elapsedMs: performance.now() - start } satisfies RuntimeStatsResponse);
  canceled.delete(req.id);
};
