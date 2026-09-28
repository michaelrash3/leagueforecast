import type { GameLog } from "./types";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const isFinal = (log?: GameLog | null) => Boolean(log?.isFinal);

export const parseNumber = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** The per-side stats a log may or may not carry, each with the one on the other side. */
const OPTIONAL_SIDES = [
  ["awayErrors", "homeErrors"],
  ["awayWalksAllowed", "homeWalksAllowed"],
] as const;

/**
 * The same game with its home and away sides swapped. Every number on a card belongs to a side,
 * and each moves with it; a stat the log never carried is not invented on the other side.
 */
export const swappedLog = (log: GameLog): GameLog => {
  const next: GameLog = {
    ...log,
    awayRuns: log.homeRuns,
    awayHits: log.homeHits,
    awayK: log.homeK,
    homeRuns: log.awayRuns,
    homeHits: log.awayHits,
    homeK: log.awayK,
  };
  OPTIONAL_SIDES.forEach(([away, home]) => {
    delete next[away];
    delete next[home];
    const fromHome = log[home];
    const fromAway = log[away];
    if (fromHome !== undefined) next[away] = fromHome;
    if (fromAway !== undefined) next[home] = fromAway;
  });
  return next;
};

export const blankLog = (innings = "6"): GameLog => ({
  awayRuns: "",
  awayHits: "",
  awayK: "",
  homeRuns: "",
  homeHits: "",
  homeK: "",
  awayErrors: "",
  homeErrors: "",
  awayWalksAllowed: "",
  homeWalksAllowed: "",
  innings,
  isFinal: false,
});
