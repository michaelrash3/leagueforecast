/// <reference lib="webworker" />
import { simulateGoldOdds } from "../lib/sim";
import type { Matchup, Settings, Team } from "../lib/types";

export type CancelRequest = { kind: "cancel"; id: number };
export type OddsRequest = { kind: "odds"; id: number; teams: Team[]; remaining: Matchup[]; iterations: number; seedText: string; cutoff: number; settings: Settings };
export type TrendRequest = { kind: "trend"; id: number; teamIds: string[]; states: { teams: Team[]; remaining: Matchup[]; seedText: string }[]; iterations: number; cutoff: number; settings: Settings };
export type WorkerRequest = OddsRequest | TrendRequest | CancelRequest;
export type OddsResponse = { kind: "odds"; id: number; odds: Record<string, number> };
export type TrendResponse = { kind: "trend"; id: number; trend: Record<string, number[]> };
export type WorkerResponse = OddsResponse | TrendResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const canceled = new Set<number>();

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.kind === "cancel") { canceled.add(req.id); return; }
  if (canceled.has(req.id)) return;

  if (req.kind === "odds") {
    const odds = simulateGoldOdds(req.teams, req.remaining, req.iterations, req.seedText, req.cutoff, req.settings);
    if (!canceled.has(req.id)) ctx.postMessage({ kind: "odds", id: req.id, odds } satisfies OddsResponse);
    canceled.delete(req.id);
    return;
  }

  const trend: Record<string, number[]> = {};
  req.teamIds.forEach((id) => { trend[id] = []; });
  req.states.forEach((state) => {
    if (canceled.has(req.id)) return;
    const odds = simulateGoldOdds(state.teams, state.remaining, req.iterations, state.seedText, req.cutoff, req.settings);
    req.teamIds.forEach((id) => { const series = trend[id]; if (series) series.push(odds[id] ?? 0); });
  });
  if (!canceled.has(req.id)) ctx.postMessage({ kind: "trend", id: req.id, trend } satisfies TrendResponse);
  canceled.delete(req.id);
};
