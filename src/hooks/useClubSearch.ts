/**
 * Finding a club in the pool, and guessing which other team is the same club.
 *
 * Both questions are asked over the whole pool rather than the page on screen: finding a team
 * without already knowing its season and age level is the one thing the age tabs cannot do, and is
 * the point of searching at all.
 */
import { useCallback, useMemo, useState } from "react";
import {
  teamPages,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type TeamPage,
} from "../lib/teamRankings";
import { buildStaffIndex, clubRelations, coachesOf, describeRelation } from "../lib/gcStaff";
import { statesThatPlayed } from "../lib/playedByStates";
import type { MergeCandidate } from "../components/TeamDetailPanel";

type ClubSearchInput = {
  teams: ScoutTeam[];
  /**
   * Every game in the pool, every year, read when the index is built rather than held. The view
   * keeps one year's games in memory; finding a club on another year's page needs the others, and
   * this reads them for as long as it takes to say where each team is, then lets them go.
   */
  games: () => ScoutGame[];
  ageGroups: AgeGroup[];
  /** The teams rated on the page on screen — the only ones a merge can name. */
  rankedTeams: MergeCandidate[];
  /**
   * Whether the search box is on a tab that shows it. Off, the index is not built at all — a pull
   * in Setup saves the pool every few hundred teams, and rebuilding a whole-pool index on each save
   * would be a decode of every year, every time, for a box nobody can see.
   */
  enabled: boolean;
  /**
   * Whether a pull is running. The index is not rebuilt while one is: each save hands back new
   * teams, and a rebuild reads every stored year. It keeps what it was built from when the run
   * began instead, so the box stays and finds the pool as it stood then, and it is built once more
   * when the run lets go.
   */
  hold?: boolean;
  /** Storage is not reactive; this is bumped when the pool changes, and the index follows it. */
  revision: number;
};

/** What the index is built from, kept whole while a pull runs. */
type IndexInputs = {
  teams: ScoutTeam[];
  games: () => ScoutGame[];
  ageGroups: AgeGroup[];
  revision: number;
};

/** Referentially stable, so a consumer memoising on "no pages" does not re-run every render. */
const NO_PAGES = new Map<string, TeamPage>();
const NO_PLAYED_BY = new Map<string, string[]>();

export function useClubSearch({
  teams,
  games,
  ageGroups,
  rankedTeams,
  enabled,
  hold = false,
  revision,
}: ClubSearchInput) {
  /*
   * Taken when a pull begins and let go when it ends, during render rather than in an effect, the
   * way the view follows a pull's revision: a frame built from inputs about to be replaced is a
   * rebuild of the whole index for nothing.
   */
  const [held, setHeld] = useState<IndexInputs | null>(null);
  if (hold && held === null) setHeld({ teams, games, ageGroups, revision });
  if (!hold && held !== null) setHeld(null);
  const {
    teams: indexTeams,
    games: indexGames,
    ageGroups: indexGroups,
    revision: indexRevision,
  } = hold && held ? held : { teams, games, ageGroups, revision };

  /**
   * Who coaches each team, gathered from every GameChanger id it is linked to.
   *
   * The staff comes off the user's own team list, not from GameChanger, so a pool built by hand or
   * pulled before the list carried it simply has none and everything below falls back to the plain
   * alphabetical picker it always was.
   */
  const staffIndex = useMemo(
    () => buildStaffIndex(teams.map((team) => ({ teamId: team.id, staff: coachesOf(team) }))),
    [teams]
  );

  /**
   * Where each team lives, so the search box can go there.
   *
   * Over the whole pool rather than this page: finding a club without already knowing its season
   * and age level is the one thing the age tabs cannot do, and is the point of searching at all.
   */
  const { pagesByTeam, playedBy } = useMemo(() => {
    void indexRevision;
    if (!enabled) return { pagesByTeam: NO_PAGES, playedBy: NO_PLAYED_BY };
    const everyGame = indexGames();
    return {
      pagesByTeam: teamPages(indexTeams, everyGame, indexGroups),
      // Where a stand-in's opponents are from, read off the same games (`statesThatPlayed`).
      playedBy: statesThatPlayed(indexTeams, everyGame),
    };
  }, [enabled, indexTeams, indexGames, indexGroups, indexRevision]);

  const searchOptions = useMemo(() => {
    const byId = new Map(indexTeams.map((team) => [team.id, team]));
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
      // A club GameChanger gives no state is placed by the clubs that played it instead; only
      // those clubs are in `playedBy`.
      const playedByStates = playedBy.get(teamId) ?? [];
      const place = [
        team.city,
        team.state,
        playedByStates.length > 0 ? `played by ${playedByStates.join(", ")} clubs` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const detail = [where, place].filter(Boolean).join(" · ");
      // And who coaches it, which is often how a person knows a club whose name forty others share.
      const coaches = coachesOf(team);
      return [
        {
          id: teamId,
          label: team.name,
          ...(detail ? { detail } : {}),
          ...(coaches.length > 0 ? { coaches } : {}),
          // Its GameChanger ids, so a pasted id or link finds it (`gcIdsInSearch`).
          ...(team.gcTeams?.length ? { gcIds: team.gcTeams.map((link) => link.teamId) } : {}),
        },
      ];
    });
  }, [pagesByTeam, playedBy, indexTeams]);

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
