import { useCallback, useMemo, useState } from "react";
import {
  hasGcLinks,
  leagueScoutBridge,
  scoutLinkCandidates,
  type LeagueScoutBridge,
  type LeagueTeamLink,
  type ScoutTeam,
} from "../lib/teamRankings";
import { loadAgeGroups, loadScoutGamesForSeason, loadScoutTeams } from "../lib/teamRankingsStorage";

/** A fixture as the bridge reads it: league names and the league's own date string. */
export type SeasonFixture = { away: string; home: string; date: string };

export type ScoutBridgeOptions = {
  /** The season being looked at, or empty when there is none. */
  activeSeasonId: string;
  /**
   * The roster rows, not the computed teams. The bridge reads a team's id, name and stored pick,
   * all of which live on the roster row — and the computed teams cannot be read here, because the
   * rating this produces is what gets attached to them.
   */
  teams: LeagueTeamLink[];
  seasonFixtures: SeasonFixture[];
  /** Whether the setting lets stored results count towards the forecast. */
  useScoutResults: boolean;
  /** Stores which Team Rankings club a league team is, or clears the answer. */
  onLink: (leagueTeamId: string, scoutTeamId: string | undefined) => void;
};

export type ScoutBridge = {
  /** What Team Rankings has for this season, whether or not the setting lets it count. */
  bridge: LeagueScoutBridge;
  /** The results the forecast may use: the bridge's, or none when the setting is off. */
  externalResults: LeagueScoutBridge["results"];
  /** The clubs that could be a given league team, best evidence first. */
  candidatesFor: (leagueTeamName: string) => ReturnType<typeof scoutLinkCandidates>;
  /** Every club that could be picked by hand. */
  allClubs: () => ScoutTeam[];
  setLink: (leagueTeamId: string, scoutTeamId: string | undefined) => void;
  /** Called when Team Rankings saves, so everything here is read again. */
  noteChange: () => void;
};

/** Nothing to bridge to, and stable, so a season with no id does not re-render on every pass. */
const NOTHING: LeagueScoutBridge = {
  results: [],
  seasonLinked: false,
  rows: [],
  linkedCount: 0,
  countedResults: 0,
};

/**
 * What Team Rankings knows about this League Standings season.
 *
 * Tournament results logged on the other side of the app, for the age groups that include this
 * season. Read from storage rather than held in state: Team Rankings owns them and this only
 * borrows — which is also why there is a revision counter. Storage is not reactive, so nothing
 * here would otherwise notice a pull, a tidy or a restore, and the league's forecasts read it.
 *
 * Every read below references that counter rather than merely listing it, so it reads as the
 * dependency it is rather than as a lint suppression somebody will remove.
 */
export function useScoutBridge({
  activeSeasonId,
  teams,
  seasonFixtures,
  useScoutResults,
  onLink,
}: ScoutBridgeOptions): ScoutBridge {
  const [revision, setRevision] = useState(0);
  const noteChange = useCallback(() => setRevision((value) => value + 1), []);

  const bridge = useMemo(() => {
    void revision;
    if (!activeSeasonId) return NOTHING;
    return leagueScoutBridge(
      activeSeasonId,
      loadAgeGroups(),
      loadScoutTeams(),
      loadScoutGamesForSeason(activeSeasonId),
      teams,
      seasonFixtures
    );
  }, [activeSeasonId, teams, seasonFixtures, revision]);

  /**
   * The bridge is read whether or not the setting lets it count, so the panel can say how much is
   * ready and waiting; only the results are withheld.
   */
  const externalResults = useMemo(
    () => (useScoutResults ? bridge.results : []),
    [useScoutResults, bridge]
  );

  const candidatesFor = useCallback(
    (leagueTeamName: string) => {
      void revision;
      if (!activeSeasonId) return [];
      return scoutLinkCandidates(
        leagueTeamName,
        activeSeasonId,
        loadAgeGroups(),
        loadScoutTeams(),
        loadScoutGamesForSeason(activeSeasonId),
        seasonFixtures
      );
    },
    [activeSeasonId, seasonFixtures, revision]
  );

  const allClubs = useCallback(() => {
    void revision;
    // Linked clubs only. Searching forty thousand names to land on one that has no GameChanger
    // team behind it is a search that could not have succeeded.
    return loadScoutTeams().filter((team) => !team.placeholder && hasGcLinks(team));
  }, [revision]);

  return { bridge, externalResults, candidatesFor, allClubs, setLink: onLink, noteChange };
}
