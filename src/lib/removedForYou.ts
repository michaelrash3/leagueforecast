import type { AgeGroup, ScoutTeam } from "./teamRankings/types";
import { LOPSIDED_MARGIN, ROUT_MARGIN, type AutoRemoval, type AutoRemovals } from "./autoRemoved";
import { removedClubIds } from "./removedClubs";

/**
 * The clubs taken off as plainly made up as Pool health lists them, and what the end of a sweep
 * sends to store its marks: the words and the list, kept apart from the marks themselves
 * (`autoRemoved.ts`) because storage reads those on every visit, League Standings' alone included,
 * and these only on Pool health and at the end of a pull.
 */

/** Why a club was taken off, a line a sign, as Pool health says it. */
export const reasonsInWords = (mark: AutoRemoval): string[] =>
  mark.signs.map((sign) => {
    switch (sign) {
      case "wins":
        return `won ${(mark.wins ?? []).length} games by ${ROUT_MARGIN} or more runs that the losers' own schedules do not list`;
      case "rout": {
        const widest = Math.max(0, ...(mark.wins ?? []).map((win) => Math.abs(win.margin)));
        return `won a game by ${Math.round(widest)} runs that the loser's own schedule does not list`;
      }
      case "ahead": {
        const ahead = mark.ahead;
        if (!ahead) return "results dated on days that have not happened";
        // Never one score: C asks three scored games, half of them ahead (`AHEAD_FEWEST_PLAYED`).
        if (ahead.nextSeason) {
          return `next season's squad, ${ahead.results} scores dated from ${ahead.first}`;
        }
        return `${ahead.results} of its ${ahead.played} results dated well ahead, the first ${ahead.first}`;
      }
      case "named":
        // The list shows the club's name; where the word was only in its GameChanger team's, say so.
        return mark.teamName === undefined
          ? `named '${mark.word ?? "test"}'`
          : `its GameChanger team is named '${mark.teamName}'`;
      case "hundred": {
        const widest = Math.max(0, ...(mark.reported ?? []).map((game) => Math.abs(game.margin)));
        return widest >= LOPSIDED_MARGIN
          ? `its schedule reports a game it won or lost by ${Math.round(widest)} runs`
          : `its schedule reports a game it won or lost by ${LOPSIDED_MARGIN} or more runs`;
      }
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
  /**
   * Still on its boards, because a League Standings team links it (`deriveAllKnown`'s guard): the
   * marks are there, but nothing is taken off while the link stands.
   */
  keptByLeague?: true;
};

/**
 * The clubs `marks` take off (`removedClubIds`), newest first, each with its reasons in words.
 * Those in `leagueKept`, which a League Standings team links (`leagueKeptClubs`), are listed too,
 * said to be kept: they stay on their boards, and the marks would take them off were the link gone.
 */
export const removedForYou = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  marks: AutoRemovals,
  leagueKept: ReadonlySet<string> = new Set()
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
        ...(leagueKept.has(team.id) ? { keptByLeague: true as const } : {}),
      };
    })
    .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.name.localeCompare(b.name)));
};

/**
 * What takes `before` to `after` as the marks command says it (`autoRemoved`): the marks made or
 * changed, and the ids no longer marked. Null when the two are the same marks.
 */
export type MarksChange = { put: AutoRemoval[]; forget: string[] };

export const marksChange = (before: AutoRemovals, after: AutoRemovals): MarksChange | null => {
  if (before === after) return null;
  const put = [...after.values()].filter((mark) => before.get(mark.gcTeamId) !== mark);
  const forget = [...before.keys()].filter((id) => !after.has(id));
  return put.length + forget.length === 0 ? null : { put, forget };
};
