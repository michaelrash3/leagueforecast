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
 * The open season, held outside React so that what is on screen can be read and changed in one
 * step from outside the page as well as from it (`useLiveLeague`).
 */
export type SeasonStore = {
  get: () => OpenSeason;
  /** Changes the open season's data, keeping its id: a value or an updater, as a state setter. */
  setSeason: Dispatch<SetStateAction<SeasonState>>;
  /** Opens another season, or the same one afresh: its id and data change together. */
  open: (id: string, season: SeasonState) => void;
  subscribe: (listener: () => void) => () => void;
};

export const createSeasonStore = (initial: OpenSeason): SeasonStore => {
  let current = initial;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  return {
    get: () => current,
    setSeason: (action) => {
      const next = typeof action === "function" ? action(current.season) : action;
      if (Object.is(next, current.season)) return;
      current = { id: current.id, season: next };
      changed();
    },
    open: (id, season) => {
      current = { id, season };
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
