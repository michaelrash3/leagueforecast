import type { ScoutTeam } from "./teamRankings/types";

/**
 * The clubs taken off every board for the user as plainly made up, without the user having to
 * (`obviousFakes.ts` finds them), each remembered by a mark on its GameChanger ids.
 *
 * A mark is not a deletion. The club, its games and its links stay filed exactly as they were, and
 * every pull keeps refreshing them; only the derivation of what the boards know (`deriveAllKnown`)
 * leaves out a club whose every GameChanger id is marked, and every game naming it. So taking one
 * back ("Put back" in Pool health) is forgetting a mark, and nothing has to be pulled again.
 *
 * Keyed by GameChanger id, as the clubs thrown out and the clubs said to be real are, for the same
 * reason: a fold deletes one of this app's team ids and a reset mints new ones for everybody, while
 * GameChanger mints an id once. A club folded into another brings its marks with it, and stands
 * as long as one of its ids is unmarked, so a fold can never drag a real club off a board.
 */

/**
 * Why a club was taken off, each the sign of `obviousFakes.ts` it showed:
 * - `wins` (A): two or more wins by `ROUT_MARGIN` or more that no loser's own schedule lists;
 * - `rout` (B): one win by `ABSURD_MARGIN` or more that the loser's own schedule does not list;
 * - `ahead` (C): three scored results or more, half of them dated well ahead, none listed by an
 *   opponent;
 * - `named` (N): its name, or its GameChanger team's, has void, test or demo as a word in it.
 */
export type AutoSign = "wins" | "rout" | "ahead" | "named";

export const AUTO_SIGNS: readonly AutoSign[] = ["wins", "rout", "ahead", "named"];

/**
 * A win by this many runs or more, unvouched and filed by the winner's own schedule alone, is one
 * of the routs sign A counts, two of them at any age: the user's line of 11 October 2026,
 * "repeated wins by 40 or more instead of 30". Here, beside the marks, rather than with the sweep,
 * because Pool health says it in words and storage reads this module on every visit anyway.
 */
export const ROUT_MARGIN = 40;

/** A win by this many runs or more, alone, is no game anybody played: sign B. Here for the same. */
export const ABSURD_MARGIN = 75;

/** A win counted against a club: the game, by how many runs as the rating reads it, and its day. */
export type CountedWin = { gameId: string; margin: number; date?: string };

export type AutoRemoval = {
  gcTeamId: string;
  /** The club's name when it was marked, so the list can say which club a mark was. */
  name: string;
  /** The day it was marked, an ISO day: the list goes newest first, and a sign of `ahead` lifts on
   * a game corroborated after it. */
  on: string;
  /** The signs it showed, in `AUTO_SIGNS` order; never empty. */
  signs: AutoSign[];
  /** Its wins by `ROUT_MARGIN` or more that no loser's own schedule listed (`wins` and `rout`). */
  wins?: CountedWin[];
  /**
   * Its results dated well ahead (`ahead`, `FAR_AHEAD_DAYS` or more): the first such day, how
   * many, out of how many scored, and whether the club is next season's squad (its GameChanger
   * season has not begun). Every club C marked on 29 September and 11 October 2026 was one, until C
   * asked for three scored games, which none of them had. A result only a day or two ahead is not
   * among them, so the day named is a score the sign counted.
   */
  ahead?: { first: string; results: number; played: number; nextSeason?: true };
  /** The word its name had (`named`), lower case. */
  word?: string;
  /**
   * The GameChanger team's name that had the word (`named`), where the club's own name has none:
   * the list shows the club's name, which would not say why.
   */
  teamName?: string;
};

/** The marks, by GameChanger id. */
export type AutoRemovals = ReadonlyMap<string, AutoRemoval>;

export const NO_REMOVALS: AutoRemovals = new Map();

const isText = (raw: unknown): raw is string => typeof raw === "string" && raw !== "";
const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);
const isCount = (raw: unknown): raw is number =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0;

const winOf = (raw: unknown): CountedWin | null => {
  if (!isRecord(raw) || !isText(raw.gameId)) return null;
  if (typeof raw.margin !== "number" || !Number.isFinite(raw.margin)) return null;
  return {
    gameId: raw.gameId,
    margin: raw.margin,
    ...(isText(raw.date) ? { date: raw.date } : {}),
  };
};

const markOf = (raw: unknown): AutoRemoval | null => {
  if (!isRecord(raw) || !isText(raw.gcTeamId) || typeof raw.name !== "string") return null;
  if (!isText(raw.on) || !Array.isArray(raw.signs)) return null;
  const said = new Set(raw.signs);
  const signs = AUTO_SIGNS.filter((sign) => said.has(sign));
  if (signs.length === 0) return null;
  const wins = Array.isArray(raw.wins) ? raw.wins.map(winOf) : [];
  if (wins.some((win) => win === null)) return null;
  const ahead = raw.ahead;
  const aheadOk =
    isRecord(ahead) && isText(ahead.first) && isCount(ahead.results) && isCount(ahead.played);
  return {
    gcTeamId: raw.gcTeamId,
    name: raw.name,
    on: raw.on,
    signs,
    ...(wins.length > 0 ? { wins: wins as CountedWin[] } : {}),
    ...(aheadOk
      ? {
          ahead: {
            first: ahead.first as string,
            results: ahead.results as number,
            played: ahead.played as number,
            ...(ahead.nextSeason === true ? { nextSeason: true as const } : {}),
          },
        }
      : {}),
    ...(isText(raw.word) ? { word: raw.word } : {}),
    ...(isText(raw.teamName) ? { teamName: raw.teamName } : {}),
  };
};

/** Whatever was stored, as marks: anything that is not one is dropped. */
export const coerceAutoRemovals = (raw: unknown): Map<string, AutoRemoval> => {
  const out = new Map<string, AutoRemoval>();
  if (!Array.isArray(raw)) return out;
  raw.forEach((entry) => {
    const mark = markOf(entry);
    if (mark) out.set(mark.gcTeamId, mark);
  });
  return out;
};

/** As it is stored: a plain array, in id order, so a save that changes nothing looks like it. */
export const autoRemovalsList = (marks: AutoRemovals): AutoRemoval[] =>
  [...marks.values()].sort((a, b) =>
    a.gcTeamId < b.gcTeamId ? -1 : a.gcTeamId > b.gcTeamId ? 1 : 0
  );

/**
 * The marks a club said to be real carries (`realClubs`, by its club id or any of its GameChanger
 * ids, and an id said to be real itself): the marks such a club cannot keep. The sweep never makes
 * one and lifts any it finds, but it runs a night later; whatever says a club is real (This club
 * is real, a restored backup) forgets them at once, so the club is back on the boards as it is said.
 */
export const marksOfRealClubs = (
  teams: readonly ScoutTeam[],
  real: ReadonlySet<string>,
  marks: AutoRemovals
): string[] => {
  if (marks.size === 0 || real.size === 0) return [];
  const going = new Set<string>();
  real.forEach((id) => {
    if (marks.has(id)) going.add(id);
  });
  teams.forEach((team) => {
    const ids = (team.gcTeams ?? []).map((link) => link.teamId);
    if (!real.has(team.id) && !ids.some((id) => real.has(id))) return;
    ids.forEach((id) => {
      if (marks.has(id)) going.add(id);
    });
  });
  return [...going];
};
