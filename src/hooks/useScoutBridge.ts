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
import type { CopyAt, LeagueAsker } from "../lib/live/leagueAsk";
import type { QueryOf } from "../lib/live/queries";
import { BRIDGE_KEY } from "../lib/preferences";
import { loadAgeGroups, loadScoutGamesForSeason, loadScoutTeams } from "../lib/teamRankingsStorage";
import { poolFilled } from "../lib/poolFill";
import { usePoolFilled } from "./useOpeningHold";

/** A fixture as the bridge reads it: league names, the league's own date string, and final runs. */
export type SeasonFixture = LeagueFixture;

export type ScoutBridgeOptions = {
  /** The season being looked at, or empty when there is none. */
  activeSeasonId: string;
  /**
   * The season being looked at as storage tells one season from another, its id and the moment it
   * was made (absent, the id alone). Ids are given out again, so what was heard for a season is
   * held by this: a season made under a deleted one's id, or restored over the open one, hears
   * nothing that one did.
   */
  seasonKey?: string;
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
   * a club. While it is not, the server is asked only where the bridge on hand does not answer the
   * season as it stands (`askedOf`): the forecast, the digest and its notifications read the bridge
   * on either side, but each question can be a cold load of the whole pool on the 8 GiB server, and
   * the boards ask the server nothing, so a visit spent on them asked it for this alone.
   */
  leagueOnScreen?: boolean;
  /**
   * The cloud copy's id and version as they are now (`copyAtNow`), or null where that cannot be
   * read. Given, a question this visit has an answer to is asked again only where the copy has
   * moved since that answer (`STAMP_TRUST_MS`): a read of one document rather than the 8 GiB
   * server. Absent, every question goes to the server, as before.
   */
  copyNow?: () => Promise<CopyAt | null>;
  /**
   * Whether the question waits: while Team Rankings opens on the cloud's board, nothing is asked
   * until the board is drawn (`openingHold.ts`), and then only as Team Rankings on screen asks
   * (`leagueOnScreen`).
   */
  held?: boolean;
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
 * How long an answer's copy and version are held to stand for it (`copyNow`). The answer is the
 * server's working of the pool at that save, so it holds while the copy has not moved; but the
 * server's own rules for working it out change with a deploy, which no save marks, and the nightly
 * saves the copy every day. A day bounds a tab left open across such a deploy to one day's old
 * answer at most.
 */
const STAMP_TRUST_MS = 24 * 60 * 60_000;

/** The copy and version an answer was worked out from, and when it was heard (`STAMP_TRUST_MS`). */
type Stamp = CopyAt & { heard: number };

/** Whether `stamp` may still stand for its answer at `now`: heard, by this clock, within a day. */
const trusted = (stamp: Stamp, now: number): boolean =>
  now >= stamp.heard && now - stamp.heard < STAMP_TRUST_MS;

/**
 * How long after a question goes unanswered it is asked again, the last wait repeated until one is
 * answered: a device offline, a sign-in not loaded yet, a server waking up. Each wait is a
 * question asked again, and a member's device offline or signed out fails it without reaching the
 * server at all. The waits lengthen to half an hour: a question the server cannot answer in its
 * time costs a cold load of the whole pool at 8 GiB each try, and every two minutes for as long as
 * the page stayed open was what an unanswerable pool cost in October 2026. Coming back online,
 * signing in, and the page shown anew still ask at once, on League Standings.
 */
const RETRY_AFTER_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000] as const;

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
 * bridge, a few thousand characters, and the question it answered: the clubs each team could be
 * are the link panel's, and asked again each visit. Kept by season id (`BRIDGE_KEY`), and let go
 * of with its season as the rest of what a device keeps of one is (`forgetSeasons`).
 */
const KEPT_KEY = BRIDGE_KEY;
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

/**
 * A kept bridge and the question it answered (`askedOf`), or null where the question is not known:
 * one an earlier build kept, the bridge alone, which off League Standings is then asked about once.
 */
type Kept = { bridge: LeagueScoutBridge; asked: string | null };

/** What is kept for a season read back whole, its bridge through the same checks as the network's. */
const keptOf = (value: unknown): Kept | null => {
  if (value && typeof value === "object" && "asked" in value) {
    const { bridge, asked } = value as { bridge?: unknown; asked?: unknown };
    const read = leagueBridgeOf(bridge);
    return read && typeof asked === "string" ? { bridge: read, asked } : null;
  }
  const alone = leagueBridgeOf(value);
  return alone && { bridge: alone, asked: null };
};

/** The bridge kept for `seasonId`, read back as one from the network is, or none. */
export const keptBridge = (seasonId: string): LeagueScoutBridge | null =>
  keptOf(readKept()[seasonId])?.bridge ?? null;

const keepBridge = (seasonId: string, kept: { bridge: LeagueScoutBridge; asked: string }) => {
  const others = Object.entries(readKept()).filter(([id]) => id !== seasonId);
  const write = (entries: [string, unknown][]) =>
    localStorage.setItem(KEPT_KEY, JSON.stringify(Object.fromEntries(entries)));
  try {
    write([...others.slice(-(KEPT_SEASONS - 1)), [seasonId, kept]]);
  } catch {
    try {
      // A full store keeps this season's bridge before any other's.
      write([[seasonId, kept]]);
    } catch {
      /* not kept: the next visit asks again before the forecast has outside results */
    }
  }
};

/**
 * A bridge question as it is compared with the one a bridge on hand answered: the JSON of the very
 * question, since the kept one has to be told apart from it after a reload, where no array of this
 * visit's can be held to it by identity.
 */
const askedOf = (question: QueryOf<"league.bridge">): string => JSON.stringify(question);

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
 * page is looked at anew, at most once every few minutes; while Team Rankings is on screen, only
 * where the bridge on hand does not answer the season as it stands; and the same question this
 * visit has an answer to, only where the copy has moved since (`copyNow`). A question unanswered is
 * asked again, and one already out is never thrown away for another about the same teams. The
 * last bridge kept for the season stands until an answer comes.
 */
export function useScoutBridge({
  activeSeasonId,
  seasonKey = activeSeasonId,
  teams,
  seasonFixtures,
  useScoutResults,
  onLink,
  asker,
  signedIn,
  leagueOnScreen = true,
  copyNow,
  held = false,
}: ScoutBridgeOptions): ScoutBridge {
  const [revision, setRevision] = useState(0);
  // The device's own pool, read in after the page on a member's device (`poolFill.ts`): what is
  // worked out from it is worked out again once it is in, and where it is read at all, as on a
  // member's device signed out, it is wanted now rather than once a board is drawn.
  const filled = usePoolFilled();
  useEffect(() => {
    if (!asker) void poolFilled();
  }, [asker]);

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
    if (asker || !activeSeasonId || !filled) return NOTHING;
    return leagueScoutBridge(
      activeSeasonId,
      loadAgeGroups(),
      loadScoutTeams(),
      loadScoutGamesForSeason(activeSeasonId),
      teams,
      seasonFixtures
    );
  }, [asker, activeSeasonId, teams, seasonFixtures, revision, filled]);

  // Nothing reads what an earlier build kept, so it is let go of whichever way this device reads.
  useEffect(() => {
    try {
      localStorage.removeItem(OLD_KEPT_KEY);
    } catch {
      /* storage this browser will not open holds nothing of it either */
    }
  }, []);

  /*
   * The server's answers this visit, by season (`seasonKey`), with the clubs each team could be,
   * which are held here alone; the bridge is kept for the next visit too, and read back as a kept
   * one is.
   */
  const [heard, setHeard] = useState<Record<string, LeagueBridgeAnswer>>({});
  /**
   * The question each of this visit's answers answered (`askedOf`), and the copy it was worked out
   * from where the reply named one, by season, as `heard` is.
   */
  const heardOn = useRef<Record<string, { asked: string; at: Stamp | null }>>({});
  /** The season whose last question went unanswered, and is waiting to be asked again. */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  /*
   * The kept bridge and its question, read once as the season opens: what is shown until an answer
   * comes, and what the question is held to off League Standings, from this one read, so another
   * tab's write meanwhile neither shows here nor passes for the bridge shown (Codex, on #445).
   */
  const kept = useMemo(() => {
    // Read again for another season under the same id, of which storage keeps nothing yet.
    void seasonKey;
    return asker && activeSeasonId ? keptOf(readKept()[activeSeasonId]) : null;
  }, [asker, activeSeasonId, seasonKey]);
  const answer = asker && activeSeasonId ? heard[seasonKey] : undefined;

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
    if (!asker || !activeSeasonId || held) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const question: QueryOf<"league.bridge"> = {
      kind: "league.bridge",
      season: activeSeasonId,
      teams: teams.map(({ id, name, scoutTeamId }) => ({
        id,
        name,
        ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
      })),
      fixtures: seasonFixtures,
    };
    const asked = askedOf(question);
    /**
     * The question the bridge shown answered, and the copy it came from: this visit's answer, else
     * the kept one, whose copy is not known.
     */
    const onHand = () =>
      heardOn.current[seasonKey] ?? (kept ? { asked: kept.asked, at: null } : null);
    /** After an answer, or a question found to need none: a change noted meanwhile is asked about. */
    const carryOn = () => {
      if (again.current) {
        again.current = false;
        setRevision((value) => value + 1);
      }
    };
    const ask = (failures: number) => {
      const hand = onHand();
      /*
       * Off League Standings, a bridge on hand that answers this very question is left to stand
       * until coming back, which asks again in any case. One for teams or final scores since
       * changed, which another device's can be, or none at all, is asked for even here, retries
       * included: the forecast, the digest and its notifications read it while Team Rankings is on
       * screen, notifications while the page is hidden. Read from the ref as each question falls
       * due, not as a dependency, so going to Team Rankings leaves one already out to be answered.
       */
      if (!onScreen.current && hand?.asked === asked) return;
      /*
       * The same question this visit already has an answer to, from a copy known: asked again only
       * where the copy has moved since, which one read of its manifest tells. Coming back from Team
       * Rankings, the page shown anew, the sign-in, coming online and a retry all ask this way; a
       * copy that cannot be read is no proof it stood still, so the server is asked.
       */
      const at = hand?.asked === asked ? hand.at : null;
      if (!copyNow || !at || !trusted(at, Date.now())) {
        send(failures);
        return;
      }
      out.current = true;
      askedAt.current = Date.now();
      // A read that fails says nothing of the copy, as one that answers nothing does.
      void copyNow()
        .catch(() => null)
        .then((now) => {
          if (!current) return;
          if (now?.copy === at.copy && now.version === at.version) {
            out.current = false;
            carryOn();
          } else send(failures);
        });
    };
    const send = (failures: number) => {
      out.current = true;
      askedAt.current = Date.now();
      void asker(question).then((reply) => {
        // An answer for teams or scores since changed is not this season's as it stands.
        if (!current) return;
        out.current = false;
        if (reply) {
          keepBridge(activeSeasonId, { bridge: reply.bridge, asked });
          heardOn.current[seasonKey] = {
            asked,
            at: reply.at ? { ...reply.at, heard: Date.now() } : null,
          };
          setHeard((was) => ({
            ...was,
            [seasonKey]: { bridge: reply.bridge, candidates: reply.candidates },
          }));
        } else {
          setFailedFor(seasonKey);
          const wait = RETRY_AFTER_MS[Math.min(failures, RETRY_AFTER_MS.length - 1)];
          timer = setTimeout(() => ask(failures + 1), wait);
        }
        carryOn();
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
  }, [asker, activeSeasonId, seasonKey, kept, teams, seasonFixtures, revision, held, copyNow]);

  const bridge = asker ? (answer?.bridge ?? kept?.bridge ?? NOTHING) : local;
  const unanswered =
    asker && activeSeasonId && !answer && !kept
      ? failedFor === seasonKey
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
      if (!activeSeasonId || (!asker && !filled)) return [];
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
    [asker, answer, activeSeasonId, seasonFixtures, revision, filled]
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
    if (!filled) return NO_OPTIONS;
    return pickableClubs(activeSeasonId, loadAgeGroups(), loadScoutTeams()).map(clubPickOption);
  }, [asker, wideHere, revision, activeSeasonId, filled]);

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
