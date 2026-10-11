import type { AgeGroup, ScoutTeam } from "./teamRankings/types";

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
 * - `wins` (A): two or more wins by more than 30 runs that no loser's own schedule lists;
 * - `rout` (B): one win by 75 or more that the loser's own schedule does not list;
 * - `ahead` (C): half or more of its results dated well ahead, none listed by an opponent;
 * - `named` (N): its name, or its GameChanger team's, has void, test or demo as a word in it.
 */
export type AutoSign = "wins" | "rout" | "ahead" | "named";

export const AUTO_SIGNS: readonly AutoSign[] = ["wins", "rout", "ahead", "named"];

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
  /** Its wins by more than 30 that no loser's own schedule listed (`wins` and `rout`). */
  wins?: CountedWin[];
  /**
   * Its results dated ahead (`ahead`): the first such day, how many, out of how many scored, and
   * whether the club is next season's squad (its GameChanger season has not begun), which is the
   * shape every such mark measured on 29 September and 11 October 2026 had.
   */
  ahead?: { first: string; results: number; played: number; nextSeason?: true };
  /** The word its name had (`named`), lower case. */
  word?: string;
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
 * The clubs `marks` take off: those with GameChanger ids, every one of them marked, that are no
 * page's own team. A club folded together from a marked id and an unmarked one stands, and the
 * user's own team stands whatever is said of it. A League Standings team linked to a club keeps it
 * too, which only the derivation that reads League Standings can tell (`deriveAllKnown`).
 */
export const removedClubIds = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  marks: AutoRemovals
): Set<string> => {
  const removed = new Set<string>();
  if (marks.size === 0) return removed;
  const mine = new Set(ageGroups.flatMap((group) => (group.myTeamId ? [group.myTeamId] : [])));
  teams.forEach((team) => {
    const links = team.gcTeams ?? [];
    if (links.length === 0 || mine.has(team.id)) return;
    if (links.every((link) => marks.has(link.teamId))) removed.add(team.id);
  });
  return removed;
};

/** Each marked GameChanger id and the day it was marked, as Find a team says where an id went. */
export const removedDays = (marks: AutoRemovals): Map<string, string> =>
  new Map([...marks].map(([id, mark]) => [id, mark.on]));

/** Why a club was taken off, a line a sign, as Pool health says it. */
export const reasonsInWords = (mark: AutoRemoval): string[] =>
  mark.signs.map((sign) => {
    switch (sign) {
      case "wins":
        return `won ${(mark.wins ?? []).length} games by more than 30 runs that the losers' own schedules do not list`;
      case "rout": {
        const widest = Math.max(0, ...(mark.wins ?? []).map((win) => Math.abs(win.margin)));
        return `won a game by ${Math.round(widest)} runs that the loser's own schedule does not list`;
      }
      case "ahead": {
        const ahead = mark.ahead;
        if (!ahead) return "results dated on days that have not happened";
        if (ahead.nextSeason) {
          return ahead.results === 1
            ? `next season's squad, one score dated ${ahead.first}`
            : `next season's squad, ${ahead.results} scores dated from ${ahead.first}`;
        }
        return `${ahead.results} of its ${ahead.played} results dated ahead, the first ${ahead.first}`;
      }
      case "named":
        return `named '${mark.word ?? "test"}'`;
    }
  });

/** A club taken off, as Pool health lists it. */
export type RemovedClub = {
  teamId: string;
  name: string;
  gcTeamIds: string[];
  /** The newest of its marks' days. */
  on: string;
  /** Every reason its marks give, each once. */
  reasons: string[];
};

/**
 * The clubs `marks` take off (`removedClubIds`), newest first, each with its reasons in words.
 * Clubs a League Standings team links to are among them: Pool health reads no League Standings.
 */
export const removedForYou = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  marks: AutoRemovals
): RemovedClub[] => {
  const removed = removedClubIds(teams, ageGroups, marks);
  if (removed.size === 0) return [];
  return teams
    .filter((team) => removed.has(team.id))
    .map((team): RemovedClub => {
      const gcTeamIds = (team.gcTeams ?? []).map((link) => link.teamId);
      const own = gcTeamIds.flatMap((id) => {
        const mark = marks.get(id);
        return mark ? [mark] : [];
      });
      return {
        teamId: team.id,
        name: team.name,
        gcTeamIds,
        on: own.reduce((newest, mark) => (mark.on > newest ? mark.on : newest), ""),
        reasons: [...new Set(own.flatMap(reasonsInWords))],
      };
    })
    .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.name.localeCompare(b.name)));
};

/**
 * What takes `before` to `after` as the marks command says it (`autoRemoved`): the marks made or
 * changed, and the ids no longer marked. Null when the two are the same marks.
 */
export const marksChange = (
  before: AutoRemovals,
  after: AutoRemovals
): { put: AutoRemoval[]; forget: string[] } | null => {
  if (before === after) return null;
  const put = [...after.values()].filter((mark) => before.get(mark.gcTeamId) !== mark);
  const forget = [...before.keys()].filter((id) => !after.has(id));
  return put.length + forget.length === 0 ? null : { put, forget };
};
