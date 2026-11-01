import type { LeagueDocsList } from "../live/cloudLeague";
import { docToSeason } from "../live/leagueDocs";
import { NO_SCOUT_TEAM } from "../teamRankings/leagueBridge";
import type { ScoutTeam } from "../teamRankings/types";
import type { TeamBase } from "../types";

/*
 * How the clubs are known, counted by the nightly from what it already holds (README, "The nightly
 * refresh on GitHub"): the clubs on the pool by how many GameChanger ids each carries, and the
 * League Standings picks by whether the GameChanger id of the club picked is kept beside them
 * (`TeamBase.scoutGcTeamId`). A club's id here is the pool's own and Start again mints every one
 * afresh; GameChanger's is never another team's, so these say how much of what is remembered
 * could be followed by it. Counts only, a line at a time: the repository's Actions logs are
 * public, so no club's name or id is said.
 *
 * It reads nothing of its own. The pool is the one the store holds for the views, and the seasons
 * are the documents the run's own reads already brought (`tapLeagueDocs`). What devices keep of
 * clubs (a watch list, saved fields, a look at My Team) stays on each device, and is not counted.
 */

export type ClubCensus = {
  clubs: number;
  oneGcId: number;
  /** Squads and seasons folded together, which union their GameChanger teams. */
  severalGcIds: number;
  noGcId: number;
  /** Of those with none, the bracket slots; the rest are known by a name alone. */
  slots: number;
  /** Null where no season's document was read this run. */
  league: {
    seasons: number;
    withGc: number;
    withoutGc: number;
    /**
     * Of those without, the picks whose club carries exactly one: what a stamp worked out over this
     * pool could give them, since no device stamps the cloud's seasons (`stampPicks` runs only in a
     * browser no member has signed in to, on its own).
     */
    couldTake: number;
  } | null;
};

/** What the census reads of a season's team: the club picked, and the GameChanger id beside it. */
export type LeaguePick = Pick<TeamBase, "scoutTeamId" | "scoutGcTeamId">;

export const clubCensus = (
  teams: readonly ScoutTeam[],
  seasons: readonly (readonly LeaguePick[])[] | null
): ClubCensus => {
  let oneGcId = 0;
  let severalGcIds = 0;
  let slots = 0;
  const idsOf = new Map<string, number>();
  for (const team of teams) {
    const ids = new Set((team.gcTeams ?? []).map((link) => link.teamId)).size;
    idsOf.set(team.id, ids);
    if (ids === 1) oneGcId += 1;
    else if (ids > 1) severalGcIds += 1;
    else if (team.placeholder) slots += 1;
  }
  let league: ClubCensus["league"] = null;
  if (seasons) {
    league = { seasons: seasons.length, withGc: 0, withoutGc: 0, couldTake: 0 };
    for (const season of seasons) {
      for (const one of season) {
        if (!one.scoutTeamId || one.scoutTeamId === NO_SCOUT_TEAM) continue;
        if (one.scoutGcTeamId) league.withGc += 1;
        else {
          league.withoutGc += 1;
          if (idsOf.get(one.scoutTeamId) === 1) league.couldTake += 1;
        }
      }
    }
  }
  return {
    clubs: teams.length,
    oneGcId,
    severalGcIds,
    noGcId: teams.length - oneGcId - severalGcIds,
    slots,
    league,
  };
};

const count = (value: number): string => value.toLocaleString("en-US");

export const censusLines = (census: ClubCensus): string[] => {
  const { league } = census;
  return [
    `  Clubs by how GameChanger knows them: ${count(census.clubs)} on the pool; ${count(census.oneGcId)} with one GameChanger id, ${count(census.severalGcIds)} with several (squads and seasons folded together), ${count(census.noGcId)} with none (${count(census.noGcId - census.slots)} known only by name, ${count(census.slots)} bracket slots).`,
    league
      ? `  League picks of a club, in ${count(league.seasons)} seasons: ${count(league.withGc)} kept with a GameChanger id beside them, ${count(league.withoutGc)} without; of those ${count(league.withoutGc)}, ${count(league.couldTake)} could be given one, the club picked having exactly one, though no device stamps the cloud's seasons (a person picking the team again keeps one).`
      : "  League picks were not counted: no season's document was read this run.",
  ];
};

/**
 * Each season's teams off its document, read as a device reads one (`docToSeason`). A document
 * that cannot be read is left out: the publish that read it stops on it first.
 */
export const leagueTeamsOf = (docs: Awaited<ReturnType<LeagueDocsList>>): TeamBase[][] =>
  docs.flatMap(({ id, fields }) => {
    const read = docToSeason(fields, id);
    return read.ok ? [read.season.teams] : [];
  });

/**
 * `list` as it is, and the picks of the seasons its last read handed back (`leagueTeamsOf`): what
 * the census counts, so it costs no read of its own. The picks alone are kept, taken as each read
 * comes back: the documents themselves, scores and all, would be held from the pull's read through
 * filing, saving and publishing, the steps whose memory the run reports, and then to its end.
 */
export const tapLeagueDocs = (
  list: LeagueDocsList
): { list: LeagueDocsList; last: () => LeaguePick[][] | null } => {
  let last: LeaguePick[][] | null = null;
  return {
    list: async () => {
      const docs = await list();
      last = leagueTeamsOf(docs).map((teams) =>
        teams.map(({ scoutTeamId, scoutGcTeamId }) => ({
          ...(scoutTeamId ? { scoutTeamId } : {}),
          ...(scoutGcTeamId ? { scoutGcTeamId } : {}),
        }))
      );
      return docs;
    },
    last: () => last,
  };
};
