import { useCallback, useEffect, useRef, useState } from "react";
import { leagueAgreedWithCopy, leagueStore } from "../lib/cloud/cloudSession";
import { leagueMetHere, loadCloudState } from "../lib/cloud/cloudState";
import { storedBases, type BaseKeeper } from "../lib/live/leagueBase";
import { seasonDocId } from "../lib/live/leagueDocs";
import type { SeasonEntry, SeasonParts, UndoTarget } from "../lib/live/leagueLive";
import { meetSeasons, type LocalSeasons } from "../lib/live/leagueSeasons";
import type { LeagueStore } from "../lib/live/leagueStore";
import { startLeagueSync, type LeagueSync, type LiveLeagueState } from "../lib/live/leagueSync";
import { noteLeagueMet } from "../lib/preferences";
import type { SeasonStore } from "../lib/seasonStore";
import type { SeasonSnapshot } from "../lib/storage";

const OFF: LiveLeagueState = { kind: "off" };
const CONNECTING: LiveLeagueState = { kind: "connecting" };

/** The kinds of input a person types into, which an arrival must not change under them. */
const UNTYPED = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether `element` is a field being typed in. */
export const isTyping = (element: Element | null): boolean => {
  if (!element) return false;
  // A select is not typed in: its pick lands at once, and it keeps focus after, as the season
  // switcher does, which would hold every arrival until something else is clicked.
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !UNTYPED.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable === true;
};

/**
 * This device's first meeting with the cloud's League documents (1.6e): whether it is still to
 * come, the seasons as this device and the cloud copy last agreed on them, which the seasons both
 * hold take as their bases (`meetSeasons`), and noting it done, after which the copy leaves League
 * alone here (`cloudSession.ts`).
 */
export type FirstMeeting = {
  due: () => boolean;
  agreed: () => readonly SeasonSnapshot[];
  done: () => void;
};

/** This device's own: met as the account its cloud record is for, and noted against it. */
export const deviceFirstMeeting: FirstMeeting = {
  due: () => !leagueMetHere(),
  agreed: leagueAgreedWithCopy,
  done: () => {
    const uid = loadCloudState().uid;
    if (uid !== null) noteLeagueMet(uid);
  },
};

export type LiveLeagueOptions = {
  /** Kept live at all: a member, signed in, with League's switch on. */
  enabled: boolean;
  seasons: SeasonStore;
  entryOf: (id: string) => SeasonEntry | undefined;
  /** Changes when the season list does, so the open season's entry is read again. */
  entryKey: unknown;
  /** This device's seasons in storage, for the once-a-visit meeting of season lists. */
  local: LocalSeasons;
  /** Called when seasons made elsewhere have joined this device's list. */
  onSeasonsAdded: () => void;
  /** Writes a season's data to this device's storage at once (`writeSeasonData`). */
  persist: (id: string, parts: SeasonParts) => void;
  /**
   * Gives a season in the list the cloud's creation time, once it has taken the cloud's season in
   * whole (`adoptSeasonCreatedAt`), and has the list read again.
   */
  adopt: (id: string, createdAt: string) => void;
  /** Where the seasons are; the signed-in member's, by default. */
  open?: () => Promise<LeagueStore | null>;
  bases?: BaseKeeper;
  firstMeeting?: FirstMeeting;
};

export type LiveLeague = {
  state: LiveLeagueState;
  /** What an undo taken at `takenAt` puts back while live, or null when not live. */
  guardUndo: (target: UndoTarget, takenAt: number) => SeasonParts | null;
  /**
   * Deletes the season's document, if it is this device's season and not another of the same id;
   * false when there is no cloud to delete it from.
   */
  removeSeason: (id: string) => Promise<boolean>;
};

/**
 * The open League Standings season kept live with the cloud while `enabled` (`leagueSync.ts`),
 * and the season lists met once each visit (`leagueSeasons.ts`). Writes go when the page lets go
 * of a field, and when the page is hidden, the last moment a browser promises.
 */
export function useLiveLeague({
  enabled,
  seasons,
  entryOf,
  entryKey,
  local,
  onSeasonsAdded,
  persist,
  adopt,
  open = leagueStore,
  bases = storedBases,
  firstMeeting = deviceFirstMeeting,
}: LiveLeagueOptions): LiveLeague {
  const [state, setState] = useState<LiveLeagueState>(OFF);
  const sync = useRef<LeagueSync | null>(null);
  const store = useRef<LeagueStore | null>(null);
  const latest = useRef({ entryOf, local, onSeasonsAdded, persist, adopt });
  useEffect(() => {
    latest.current = { entryOf, local, onSeasonsAdded, persist, adopt };
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running: LeagueSync | null = null;
    open().then(
      (found) => {
        if (cancelled) return;
        if (!found) {
          setState({ kind: "refused" });
          return;
        }
        store.current = found;
        const start = () => {
          running = startLeagueSync({
            store: found,
            seasons,
            entryOf: (id) => latest.current.entryOf(id),
            bases,
            persist: (id, parts) => latest.current.persist(id, parts),
            adopt: (id, createdAt) => latest.current.adopt(id, createdAt),
            editing: () => isTyping(document.activeElement),
            onState: (next) => {
              if (!cancelled) setState(next);
            },
          });
          sync.current = running;
        };
        /*
         * This device's first meeting with the cloud's seasons comes before the open season goes
         * live, which then starts from the bases it laid; the season waits, read-only, until it
         * has. Met before, the season is live at once and the lists meet beside it.
         */
        const first = firstMeeting.due();
        if (!first) start();
        meetSeasons({
          store: found,
          local: latest.current.local,
          bases,
          openId: () => seasons.get().id,
          ...(first ? { agreed: firstMeeting.agreed() } : {}),
        }).then(
          (met) => {
            if (cancelled) return;
            if (first) {
              firstMeeting.done();
              start();
            }
            if (met.added.length > 0) latest.current.onSeasonsAdded();
          },
          // A list that would not come is tried again on the next visit, a first meeting with it;
          // the open season is live regardless.
          () => {
            if (!cancelled && first) start();
          }
        );
      },
      () => {
        if (!cancelled) setState({ kind: "refused" });
      }
    );
    // Let go of: the next field may take focus in the same moment, so asked once it has.
    const onFocusOut = () => setTimeout(() => sync.current?.settle(), 0);
    const onHidden = () => {
      if (document.visibilityState === "hidden") sync.current?.settle();
    };
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelled = true;
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onHidden);
      running?.stop();
      sync.current = null;
      store.current = null;
      setState(OFF);
    };
  }, [enabled, seasons, open, bases, firstMeeting]);

  useEffect(() => {
    sync.current?.entryChanged();
  }, [entryKey]);

  const guardUndo = useCallback(
    (target: UndoTarget, takenAt: number) => sync.current?.guardUndo(target, takenAt) ?? null,
    []
  );

  const removeSeason = useCallback(
    async (id: string) => {
      const found = store.current;
      if (!found) return false;
      // Another season under this id, kept apart from this one, is left in the cloud: deleting
      // this device's season deletes it here alone.
      await found.remove(seasonDocId(id), latest.current.entryOf(id)?.createdAt ?? "");
      bases.remove(seasonDocId(id));
      return true;
    },
    [bases]
  );

  // Turned on, it waits for the cloud's version before anything may be edited.
  const shown = !enabled ? OFF : state.kind === "off" ? CONNECTING : state;
  return { state: shown, guardUndo, removeSeason };
}
