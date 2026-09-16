/**
 * Finding a club in the pool, and guessing which other team is the same club.
 *
 * Both questions are asked over the whole pool rather than the page on screen: finding a team
 * without already knowing its season and age level is the one thing the age tabs cannot do, and is
 * the point of searching at all.
 */
import { useCallback, useMemo } from "react";
import { teamPages, type AgeGroup, type ScoutGame, type ScoutTeam } from "../lib/teamRankings";
import { buildStaffIndex, clubRelations, describeRelation } from "../lib/gcStaff";
import type { MergeCandidate } from "../components/TeamDetailPanel";

type ClubSearchInput = {
  teams: ScoutTeam[];
  games: ScoutGame[];
  ageGroups: AgeGroup[];
  /** The teams rated on the page on screen — the only ones a merge can name. */
  rankedTeams: MergeCandidate[];
};

export function useClubSearch({ teams, games, ageGroups, rankedTeams }: ClubSearchInput) {
  /**
   * Who coaches each team, gathered from every GameChanger id it is linked to.
   *
   * The staff comes off the user's own team list, not from GameChanger, so a pool built by hand or
   * pulled before the list carried it simply has none and everything below falls back to the plain
   * alphabetical picker it always was.
   */
  const staffIndex = useMemo(
    () =>
      buildStaffIndex(
        teams.map((team) => ({
          teamId: team.id,
          staff: [...new Set((team.gcTeams ?? []).flatMap((link) => link.staff ?? []))],
        }))
      ),
    [teams]
  );

  /**
   * Where each team lives, so the search box can go there.
   *
   * Over the whole pool rather than this page: finding a club without already knowing its season
   * and age level is the one thing the age tabs cannot do, and is the point of searching at all.
   */
  const pagesByTeam = useMemo(() => teamPages(teams, games, ageGroups), [teams, games, ageGroups]);

  const searchOptions = useMemo(() => {
    const byId = new Map(teams.map((team) => [team.id, team]));
    return [...pagesByTeam.entries()].flatMap(([teamId, page]) => {
      const team = byId.get(teamId);
      if (!team) return [];
      const where = [
        page.level === undefined ? "" : `${page.level}U`,
        page.year === undefined ? "" : String(page.year),
      ]
        .filter(Boolean)
        .join(" ");
      /*
       * The town off the team itself rather than through `placeOf`, which only knows this page's
       * rows. Every team worth searching for is on some other page, so reading it that way left
       * the place blank on exactly the results that needed it — and the place is what tells two
       * clubs of the same name apart.
       */
      const place = [team.city, team.state].filter(Boolean).join(", ");
      const detail = [where, place].filter(Boolean).join(" · ");
      return [{ id: teamId, label: team.name, ...(detail ? { detail } : {}) }];
    });
  }, [pagesByTeam, teams]);

  /**
   * What to offer as "same team as": everyone else rated on this page, with the likely clubs first.
   *
   * It used to offer every other team on the page in name order, which at a nationwide pool is
   * thousands of names and no help at all. Two teams sharing two coaches are the same club 98% of
   * the time by state — see `gcStaff.ts` — so those go to the top with a line saying why, and
   * everyone else follows as before. Nothing is hidden: a proposal this strong is still only a
   * proposal, and the person merging is the one who knows.
   */
  const mergeCandidatesFor = useCallback(
    (teamId: string): MergeCandidate[] => {
      const others = rankedTeams.filter((team) => team.id !== teamId);
      const relations = clubRelations(teamId, staffIndex);
      if (relations.length === 0) return others;

      const hintById = new Map(
        relations.map((relation) => [relation.teamId, describeRelation(relation)])
      );
      const related: MergeCandidate[] = [];
      const rest: MergeCandidate[] = [];
      others.forEach((team) => {
        const hint = hintById.get(team.id);
        if (hint) related.push({ ...team, clubHint: hint });
        else rest.push(team);
      });
      // `clubRelations` is already strongest first; this puts the candidates in that same order.
      const order = new Map(relations.map((relation, index) => [relation.teamId, index]));
      related.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      return [...related, ...rest];
    },
    [rankedTeams, staffIndex]
  );

  return {
    searchOptions,
    /** Which page a team is filed on, or `undefined` for one with no games anywhere. */
    pageOf: useCallback((teamId: string) => pagesByTeam.get(teamId), [pagesByTeam]),
    mergeCandidatesFor,
  };
}
