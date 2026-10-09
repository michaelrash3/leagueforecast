import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  leagueScoutBridge,
  scoutLinkCandidates,
  type LeagueFixture,
  type LeagueScoutBridge,
  type LeagueTeamLink,
} from "../lib/teamRankings";
import { clubPickOption, pickableClubs, type ClubPickOption } from "../lib/leagueLinkOptions";
import { leagueBridgeOf, type LeagueBridgeAnswer } from "../lib/live/leagueAnswers";
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
  /**
   * Whether the member's sign-in has come through (`memberSignedIn`). A question asked at boot,
   * before it had, went unanswered, so the moment it does the season is asked about again.
   */
  signedIn?: boolean;
  /**
   * Whether League Standings is the side on screen (absent, it is). Coming back to it from Team
   * Rankings asks again, since a member there may just have ticked this season on a page or merged
   * a club; being shown anew asks only while it is on screen.
   */
  leagueOnScreen?: boolean;
};

export type ScoutBridge = {
  /** What Team Rankings has for this season, whether or not the setting lets it count. */
  bridge: LeagueScoutBridge;
  /** The results the forecast may use: the bridge's, or none when the setting is off. */
  externalResults: LeagueScoutBridge["results"];
  /**
   * Where the server is asked and nothing it said is here to show for the season, heard or kept:
   * being asked, or not answered and to be asked again. Absent once there is a bridge to show, and
   * on a device that reads its own pool, so the panel never says a season is unclaimed for want of
   * an answer.
   */
  unanswered?: "asking" | "failed";
  /** The clubs that could be a given league team, best evidence first. */
  candidatesFor: (leagueTeamName: string) => ReturnType<typeof scoutLinkCandidates>;
  /** Every club that could be picked by hand, as the wide picker lists each. */
  wideOptions: () => readonly ClubPickOption[];
  /** Where the server is asked for the wide list and it is not here: being asked, or unanswered. */
  wideStatus?: "asking" | "failed";
  /**
   * Said when the wide picker is ticked or unticked: while it is wanted, the open season's clubs
   * are asked of the server, a season switched to included, and wanting it again after a list went
   * unanswered asks again.
   */
  wantWide: (wanted: boolean) => void;
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
 * How long after a question goes unanswered it is asked again, the last wait repeated until one is
 * answered: a device offline, a sign-in not loaded yet, a server waking up. Each wait is a
 * question asked again, and a member's device offline or signed out fails it without reaching the
 * server at all.
 */
const RETRY_AFTER_MS = [5_000, 30_000, 120_000] as const;

/**
 * The least time between a question and one asked because the page was shown anew. Looking away
 * and back is a thing done every few seconds, and an answer takes the server seconds to work out
 * on a big page, so being shown anew asks at most this often, and never while a question is out.
 */
const SHOWN_GAP_MS = 5 * 60_000;

/**
 * The server's last bridge for each season, kept on this device: what the forecast reads the
 * moment the season opens, and offline, until the server answers again. A few seasons' worth,
 * newest last, since a browser's storage is shared with everything else the app keeps. Only the
 * bridge, a few thousand characters: the clubs each team could be are the link panel's, and asked
 * again each visit.
 */
const KEPT_KEY = "lf_league_bridge_v2";
const KEPT_SEASONS = 4;
/**
 * Where an earlier build kept every club each team could be along with the bridge, 7,076,646
 * characters for one season on the seeded fixture's page of the real one's size: let go of, so
 * whatever of it fitted no longer holds the origin's storage from the seasons and the sync bases.
 */
const OLD_KEPT_KEY = "lf_league_bridge_v1";

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

/** The bridge kept for `seasonId`, read back as one from the network is, or none. */
export const keptBridge = (seasonId: string): LeagueScoutBridge | null =>
  leagueBridgeOf(readKept()[seasonId]);

const keepBridge = (seasonId: string, bridge: LeagueScoutBridge) => {
  const others = Object.entries(readKept()).filter(([id]) => id !== seasonId);
  const write = (kept: [string, unknown][]) =>
    localStorage.setItem(KEPT_KEY, JSON.stringify(Object.fromEntries(kept)));
  try {
    write([...others.slice(-(KEPT_SEASONS - 1)), [seasonId, bridge]]);
  } catch {
    try {
      // A full store keeps this season's bridge before any other's.
      write([[seasonId, bridge]]);
    } catch {
      /* not kept: the next visit asks again before the forecast has outside results */
    }
  }
};

/** The wide picker's clubs for a season, or null where the server did not answer. */
type WideList = { season: string; options: readonly ClubPickOption[] | null };

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
 * (`asker`, `league.bridge`): whenever the season's teams or final scores change, on coming back
 * from Team Rankings, when the sign-in comes through or the device comes back online, and when the
 * page is looked at anew, at most once every few minutes. A question unanswered is asked again,
 * and one already out is never thrown away for another about the same teams. The last bridge kept
 * for the season stands until an answer comes.
 */
export function useScoutBridge({
  activeSeasonId,
  teams,
  seasonFixtures,
  useScoutResults,
  onLink,
  asker,
  signedIn,
  leagueOnScreen = true,
}: ScoutBridgeOptions): ScoutBridge {
  const [revision, setRevision] = useState(0);

  /** Whether a bridge question is out: asking again meanwhile would throw its answer away. */
  const out = useRef(false);
  /** A change noted while a question was out, asked about once its answer is in. */
  const again = useRef(false);
  /** When the last question went out, so being shown anew asks at most once every few minutes. */
  const askedAt = useRef(Number.NEGATIVE_INFINITY);

  const noteChange = useCallback(() => {
    if (out.current) again.current = true;
    else setRevision((value) => value + 1);
  }, []);
  /** Asks again unless a question is out, or one went out less than `gap` ago. */
  const askIfIdle = useCallback((gap: number) => {
    if (out.current || Date.now() - askedAt.current < gap) return;
    setRevision((value) => value + 1);
  }, []);

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

  // Nothing reads what an earlier build kept, so it is let go of whichever way this device reads.
  useEffect(() => {
    try {
      localStorage.removeItem(OLD_KEPT_KEY);
    } catch {
      /* storage this browser will not open holds nothing of it either */
    }
  }, []);

  /*
   * The server's answers this visit, by season, with the clubs each team could be, which are held
   * here alone; the bridge is kept for the next visit too, and read back as a kept one is.
   */
  const [heard, setHeard] = useState<Record<string, LeagueBridgeAnswer>>({});
  /** The season whose last question went unanswered, and is waiting to be asked again. */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const kept = useMemo(
    () => (asker && activeSeasonId ? keptBridge(activeSeasonId) : null),
    [asker, activeSeasonId]
  );
  const answer = asker && activeSeasonId ? heard[activeSeasonId] : undefined;

  // Shown anew, or online again: the nightly may have pulled since, so the server is asked again.
  const onScreen = useRef(leagueOnScreen);
  useLayoutEffect(() => {
    onScreen.current = leagueOnScreen;
  }, [leagueOnScreen]);
  useEffect(() => {
    if (!asker) return;
    const onShow = () => {
      if (document.visibilityState === "visible" && onScreen.current) askIfIdle(SHOWN_GAP_MS);
    };
    const onOnline = () => askIfIdle(0);
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("online", onOnline);
    };
  }, [asker, askIfIdle]);

  /*
   * Back from Team Rankings, where the member may have changed what the bridge reads; and signed in
   * at last, when a question asked before was refused. Either on first drawing is the first
   * question's own reason, and runs into its wait rather than asking twice.
   */
  useEffect(() => {
    if (leagueOnScreen && asker) noteChange();
  }, [leagueOnScreen, asker, noteChange]);
  useEffect(() => {
    if (signedIn && asker) askIfIdle(0);
  }, [signedIn, asker, askIfIdle]);

  useEffect(() => {
    if (!asker || !activeSeasonId) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (failures: number) => {
      out.current = true;
      askedAt.current = Date.now();
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
        if (!current) return;
        out.current = false;
        if (reply) {
          keepBridge(activeSeasonId, reply.bridge);
          setHeard((was) => ({
            ...was,
            [activeSeasonId]: { bridge: reply.bridge, candidates: reply.candidates },
          }));
        } else {
          setFailedFor(activeSeasonId);
          const wait = RETRY_AFTER_MS[Math.min(failures, RETRY_AFTER_MS.length - 1)];
          timer = setTimeout(() => ask(failures + 1), wait);
        }
        if (again.current) {
          again.current = false;
          setRevision((value) => value + 1);
        }
      });
    };
    timer = setTimeout(() => ask(0), ASK_AFTER_MS);
    return () => {
      // The question out, if any, is for teams or a moment now gone: the next one is its own.
      current = false;
      out.current = false;
      again.current = false;
      clearTimeout(timer);
    };
  }, [asker, activeSeasonId, teams, seasonFixtures, revision]);

  const bridge = asker ? (answer?.bridge ?? kept ?? NOTHING) : local;
  const unanswered =
    asker && activeSeasonId && !answer && !kept
      ? failedFor === activeSeasonId
        ? "failed"
        : "asking"
      : undefined;

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

  /*
   * The wide picker's clubs, asked of the server for the open season while the picker is wanted,
   * so a season switched to with the box still ticked lists its own clubs rather than none.
   */
  const [wideWanted, setWideWanted] = useState(false);
  const [wide, setWide] = useState<WideList | null>(null);
  const wideHere = wide?.season === activeSeasonId ? wide : null;
  const wideAsked = wideHere !== null;
  const wantWide = useCallback((wanted: boolean) => {
    setWideWanted(wanted);
    // Wanted again after the list went unanswered: it is asked for again.
    if (wanted) setWide((was) => (was?.options === null ? null : was));
  }, []);
  useEffect(() => {
    if (!asker || !activeSeasonId || !wideWanted || wideAsked) return;
    let current = true;
    const season = activeSeasonId;
    void asker({ kind: "league.clubs", season }).then((reply) => {
      if (current) setWide({ season, options: reply ? reply.clubs : null });
    });
    return () => {
      current = false;
    };
  }, [asker, activeSeasonId, wideWanted, wideAsked]);
  const wideStatus =
    asker && activeSeasonId && wideWanted
      ? !wideHere
        ? "asking"
        : wideHere.options === null
          ? "failed"
          : undefined
      : undefined;

  const wideOptions = useCallback((): readonly ClubPickOption[] => {
    void revision;
    if (asker) return wideHere?.options ?? NO_OPTIONS;
    return pickableClubs(activeSeasonId, loadAgeGroups(), loadScoutTeams()).map(clubPickOption);
  }, [asker, wideHere, revision, activeSeasonId]);

  return {
    bridge,
    externalResults,
    ...(unanswered ? { unanswered } : {}),
    candidatesFor,
    wideOptions,
    ...(wideStatus ? { wideStatus } : {}),
    wantWide,
    setLink: onLink,
    noteChange,
  };
}
