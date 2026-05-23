/// <reference lib="webworker" />
import { simulateGoldOdds } from "../lib/sim";
import type { Matchup, Settings, Team } from "../lib/types";

export type OddsRequest = {
  kind: "odds";
  id: number;
  teams: Team[];
  remaining: Matchup[];
  iterations: number;
  seedText: string;
  cutoff: number;
  settings: Settings;
};

export type TrendRequest = {
  kind: "trend";
  id: number;
  teamIds: string[];
  states: {
    teams: Team[];
    remaining: Matchup[];
    seedText: string;
  }[];
  iterations: number;
  cutoff: number;
  settings: Settings;
};

export type WorkerRequest = OddsRequest | TrendRequest;

export type OddsResponse = {
  kind: "odds";
  id: number;
  odds: Record<string, number>;
};

export type TrendResponse = {
  kind: "trend";
  id: number;
  trend: Record<string, number[]>;
};

export type WorkerResponse = OddsResponse | TrendResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.kind === "odds") {
    const odds = simulateGoldOdds(
      req.teams,
      req.remaining,
      req.iterations,
      req.seedText,
      req.cutoff,
      req.settings
    );
    const response: OddsResponse = { kind: "odds", id: req.id, odds };
    ctx.postMessage(response);
    return;
  }

  if (req.kind === "trend") {
    const trend: Record<string, number[]> = {};
    req.teamIds.forEach((id) => {
      trend[id] = [];
    });
    req.states.forEach((state) => {
      const odds = simulateGoldOdds(
        state.teams,
        state.remaining,
        req.iterations,
        state.seedText,
        req.cutoff,
        req.settings
      );
      req.teamIds.forEach((id) => {
        trend[id].push(odds[id] ?? 0);
      });
    });
    const response: TrendResponse = { kind: "trend", id: req.id, trend };
    ctx.postMessage(response);
  }
};
