import type { GameLog } from "./types";

/**
 * The scores a tab writes as it gives the turn away, or reads the season again (`tabTurn.ts`):
 * only the games it changed since it last wrote (`was`, by identity), laid over what storage holds
 * now. Two tabs can each hold a score as the turn moves, in the moment before a tab's channel code
 * has arrived, and either tab's whole season written over the other's undid the other's score. A
 * game this tab deleted is deleted; a game changed in both tabs is this tab's, written last.
 */
export const mergeHeldScores = (
  stored: Readonly<Record<string, GameLog>>,
  was: Readonly<Record<string, GameLog>>,
  now: Readonly<Record<string, GameLog>>
): Record<string, GameLog> => {
  const merged = { ...stored };
  for (const [gameId, log] of Object.entries(now)) {
    if (was[gameId] !== log) merged[gameId] = log;
  }
  for (const gameId of Object.keys(was)) {
    if (!(gameId in now)) delete merged[gameId];
  }
  return merged;
};
