/**
 * The owner's "Not this team" answers as they are stored, apart from what reads them
 * (`notThisTeam.ts`, which re-exports this): the pool's store and its backup read the list at
 * start, and only Team Rankings takes a game off a club with it.
 */
import type { NotThisTeam } from "./notThisTeam";

/** Whatever was stored, as a set: anything that is not a schedule, a name and a club is dropped. */
export const coerceNotThisTeam = (raw: unknown): Set<string> => {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  raw.forEach((entry) => {
    if (typeof entry !== "string") return;
    const parts = entry.split("\u0000");
    if (parts.length === 3 && parts.every((part) => part.length > 0)) out.add(entry);
  });
  return out;
};

/** The set as it is stored: a plain array, sorted so a save that changes nothing looks like it. */
export const notThisTeamList = (refused: NotThisTeam): string[] => [...refused].sort();
