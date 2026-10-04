import { useCallback, useEffect, useMemo, useState } from "react";
import {
  leagueScoutBridge,
  scoutLinkCandidates,
  type LeagueFixture,
  type LeagueScoutBridge,
  type LeagueTeamLink,
} from "../lib/teamRankings";
import { clubPickOption, pickableClubs, type ClubPickOption } from "../lib/leagueLinkOptions";
import { leagueBridgeAnswerOf, type LeagueBridgeAnswer } from "../lib/live/leagueAnswers";
import type { LeagueAsker } from "../lib/live/leagueAsk";
import { loadAgeGroups, loadScoutGamesForSeason, loadScoutTeams } from "../lib/teamRankingsStorage";

/** A fixture as the bridge reads it: league names, the league's own date string, and final runs. */
export type SeasonFixture = LeagueFixture;

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
  /**
   * How a member whose device holds no pool asks the server instead (1.6e): the same bridge,
   * worked out from the cloud's pool with the same functions. Absent, this device's pool is read.
   */
  asker?: LeagueAsker;
};

export type ScoutBridge = {
  /** What Team Rankings has for this season, whether or not the setting lets it count. */
  bridge: LeagueScoutBridge;
  /** The results the forecast may use: the bridge's, or none when the setting is off. */
  externalResults: LeagueScoutBridge["results"];
  /** The clubs that could be a given league team, best evidence first. */
  candidatesFor: (leagueTeamName: string) => ReturnType<typeof scoutLinkCandidates>;
  /** Every club that could be picked by hand, as the wide picker lists each. */
  wideOptions: () => readonly ClubPickOption[];
  /** Said when the wide picker is opened: the server is asked for its clubs, once a season. */
  wantWide: () => void;
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

const NO_OPTIONS: readonly ClubPickOption[] = [];

/** How long a season's teams and fixtures stand still before the server is asked about them. */
const ASK_AFTER_MS = 800;

/**
 * The server's last answer for each season, kept on this device: what the forecast reads the moment
 * the season opens, and offline, until the server answers again. A few seasons' worth, newest last,
 * since a browser's storage is shared with everything else the app keeps.
 */
const KEPT_KEY = "lf_league_bridge_v1";
const KEPT_SEASONS = 4;

const readKept = (): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEPT_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/** The answer kept for `seasonId`, read back as one from the network is, or none. */
export const keptBridge = (seasonId: string): LeagueBridgeAnswer | null =>
  leagueBridgeAnswerOf(readKept()[seasonId]);

const keepBridge = (seasonId: string, answer: LeagueBridgeAnswer) => {
  const others = Object.entries(readKept()).filter(([id]) => id !== seasonId);
  const write = (kept: [string, unknown][]) =>
    localStorage.setItem(KEPT_KEY, JSON.stringify(Object.fromEntries(kept)));
  try {
    write([...others.slice(-(KEPT_SEASONS - 1)), [seasonId, answer]]);
  } catch {
    try {
      // A full store keeps this season's answer before any other's.
      write([[seasonId, answer]]);
    } catch {
      /* not kept: the next visit asks again before the forecast has outside results */
    }
  }
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
 *
 * A member's device holds no pool (1.6e), so for one the same answer is asked of the server
 * (`asker`, `league.bridge`), whenever the season's teams or final scores change and again when the
 * page is looked at anew, and the last one kept for the season stands until it comes.
 */
export function useScoutBridge({
  activeSeasonId,
  teams,
  seasonFixtures,
  useScoutResults,
  onLink,
  asker,
}: ScoutBridgeOptions): ScoutBridge {
  const [revision, setRevision] = useState(0);
  const noteChange = useCallback(() => setRevision((value) => value + 1), []);

  const local = useMemo(() => {
    void revision;
    if (asker || !activeSeasonId) return NOTHING;
    return leagueScoutBridge(
      activeSeasonId,
      loadAgeGroups(),
      loadScoutTeams(),
      loadScoutGamesForSeason(activeSeasonId),
      teams,
      seasonFixtures
    );
  }, [asker, activeSeasonId, teams, seasonFixtures, revision]);

  /*
   * The server's answers this visit, by season. Read back as kept ones are, so the forecast reads
   * the same whichever it came from, and kept for the next visit.
   */
  const [heard, setHeard] = useState<Record<string, LeagueBridgeAnswer>>({});
  const kept = useMemo(
    () => (asker && activeSeasonId ? keptBridge(activeSeasonId) : null),
    [asker, activeSeasonId]
  );
  const answer = asker && activeSeasonId ? (heard[activeSeasonId] ?? kept) : null;

  // Looked at anew: the nightly may have pulled since, so the server is asked again.
  useEffect(() => {
    if (!asker) return;
    const onShow = () => {
      if (document.visibilityState === "visible") noteChange();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [asker, noteChange]);

  useEffect(() => {
    if (!asker || !activeSeasonId) return;
    let current = true;
    const timer = setTimeout(() => {
      void asker({
        kind: "league.bridge",
        season: activeSeasonId,
        teams: teams.map(({ id, name, scoutTeamId }) => ({
          id,
          name,
          ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
        })),
        fixtures: seasonFixtures,
      }).then((reply) => {
        // An answer for teams or scores since changed is not this season's as it stands.
        if (!current || !reply) return;
        const read: LeagueBridgeAnswer = { bridge: reply.bridge, candidates: reply.candidates };
        keepBridge(activeSeasonId, read);
        setHeard((was) => ({ ...was, [activeSeasonId]: read }));
      });
    }, ASK_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [asker, activeSeasonId, teams, seasonFixtures, revision]);

  const bridge = asker ? (answer?.bridge ?? NOTHING) : local;

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
      if (asker) {
        return answer?.candidates.find((entry) => entry.name === leagueTeamName)?.clubs ?? [];
      }
      return scoutLinkCandidates(
        leagueTeamName,
        activeSeasonId,
        loadAgeGroups(),
        loadScoutTeams(),
        loadScoutGamesForSeason(activeSeasonId),
        seasonFixtures
      );
    },
    [asker, answer, activeSeasonId, seasonFixtures, revision]
  );

  // The wide picker's clubs, asked of the server once a season, when the picker is first widened.
  const [wide, setWide] = useState<{ season: string; options: readonly ClubPickOption[] } | null>(
    null
  );
  const wantWide = useCallback(() => {
    if (!asker || !activeSeasonId || wide?.season === activeSeasonId) return;
    const season = activeSeasonId;
    void asker({ kind: "league.clubs", season }).then((reply) => {
      if (reply) setWide({ season, options: reply.clubs });
    });
  }, [asker, activeSeasonId, wide]);

  const wideOptions = useCallback((): readonly ClubPickOption[] => {
    void revision;
    if (asker) return wide?.season === activeSeasonId ? wide.options : NO_OPTIONS;
    return pickableClubs(activeSeasonId, loadAgeGroups(), loadScoutTeams()).map(clubPickOption);
  }, [asker, wide, revision, activeSeasonId]);

  return {
    bridge,
    externalResults,
    candidatesFor,
    wideOptions,
    wantWide,
    setLink: onLink,
    noteChange,
  };
}
