import type { GameLog } from "./types";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const isFinal = (log?: GameLog | null) => Boolean(log?.isFinal);

export const parseNumber = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const blankLog = (): GameLog => ({
  awayRuns: "",
  awayHits: "",
  awayK: "",
  homeRuns: "",
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: false,
});
