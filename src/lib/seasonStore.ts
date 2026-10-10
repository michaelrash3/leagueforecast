import type { Dispatch, SetStateAction } from "react";
import type { GameLog, Matchup, Settings, TeamBase } from "./types";

/** The open season's data, as League Standings holds it while the page is up. */
export type SeasonState = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  settings: Settings;
};

/** The open season: its id and its data, the same object until either changes. */
export type OpenSeason = { id: string; season: SeasonState };

/**
 * Where a change to the open season came from: this page's own edit, another device's laid over
 * it, or a season opened (another, or the same one afresh). What changed since this device last
 * looked (`useSeasonDigest`) takes its own edits as seen and the others' as news.
 */
export type SeasonChange = "edit" | "arrival" | "open";

/**
 * The open season, held outside React so that what is on screen can be read and changed in one
 * step from outside the page as well as from it (`useLiveLeague`).
 */
export type SeasonStore = {
  get: () => OpenSeason;
  /**
   * Changes the open season's data, keeping its id: a value or an updater, as a state setter. The
   * page's own edits come this way, and are refused while the store is locked.
   */
  setSeason: Dispatch<SetStateAction<SeasonState>>;
  /** Changes the open season's data whatever the lock: another device's edits, laid over it. */
  apply: (season: SeasonState) => void;
  /** Opens another season, or the same one afresh: its id and data change together. */
  open: (id: string, season: SeasonState) => void;
  /**
   * Locks the page's edits out, saying `why` to whoever listens (`onRefused`), or unlocks them for
   * null: League kept live while the season may not be written (`leagueSync.ts`). Locked here,
   * every way an edit comes in is shut, not only the controls on the page.
   */
  lock: (why: string | null) => void;
  /**
   * Why the page's edits are locked out, or null. For a change that does more than edit the season
   * (takes an undo step, writes the pool, says it is done) to ask before any of it, rather than
   * do the rest and have only its season edit refused.
   */
  locked: () => string | null;
  /** Hears each edit refused while locked, with the reason. */
  onRefused: (listener: ((why: string) => void) | null) => void;
  /** Hears every change, with where it came from and the open season as it was just before. */
  subscribe: (listener: (change: SeasonChange, previous: OpenSeason) => void) => () => void;
};

export const createSeasonStore = (initial: OpenSeason): SeasonStore => {
  let current = initial;
  let locked: string | null = null;
  let refused: ((why: string) => void) | null = null;
  const listeners = new Set<(change: SeasonChange, previous: OpenSeason) => void>();
  const changed = (change: SeasonChange, previous: OpenSeason) =>
    listeners.forEach((listener) => listener(change, previous));
  const set = (next: SeasonState, change: SeasonChange) => {
    if (Object.is(next, current.season)) return;
    const previous = current;
    current = { id: current.id, season: next };
    changed(change, previous);
  };
  return {
    get: () => current,
    setSeason: (action) => {
      if (locked !== null) {
        refused?.(locked);
        return;
      }
      set(typeof action === "function" ? action(current.season) : action, "edit");
    },
    apply: (season) => set(season, "arrival"),
    lock: (why) => {
      locked = why;
    },
    locked: () => locked,
    onRefused: (listener) => {
      refused = listener;
    },
    open: (id, season) => {
      const previous = current;
      current = { id, season };
      changed("open", previous);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
