import { useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { GameLog, Matchup, Settings, TeamBase } from "../lib/types";

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

export type SeasonStateControls = SeasonState & {
  season: SeasonState;
  /** The id of the season the data is, which changes with the data and never apart from it. */
  seasonId: string;
  store: SeasonStore;
  setSeason: Dispatch<SetStateAction<SeasonState>>;
  openSeason: (id: string, season: SeasonState) => void;
  setTeams: Dispatch<SetStateAction<TeamBase[]>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setBracketLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
};

/**
 * The open season as one store, with a setter for each part that behaves as its own `useState`
 * setter did: a value or an updater, and nothing rendered when the part is unchanged.
 *
 * One store rather than five pieces of state because the season is changed from outside the page
 * as well as from it: another device's edit arrives while a score is being typed here, and has to
 * be laid over the season exactly as it stands, which no updater of one of five pieces sees, and
 * which a React updater sees only when it later runs. The store is read and changed at once, so a
 * merge is laid over what is really there and nothing can land between the read and the write.
 * The data carries its season's id, which changes with it in one step (`open`), so nothing working
 * from the store can take one season's data for another's. Each part keeps its identity until it
 * changes, so what is worked out from one part is not worked out again when another changes.
 */
export function useSeasonState(load: () => OpenSeason): SeasonStateControls {
  const [store] = useState(() => createSeasonStore(load()));
  const open = useSyncExternalStore(store.subscribe, store.get, store.get);
  const setters = useMemo(() => {
    const part =
      <K extends keyof SeasonState>(key: K): Dispatch<SetStateAction<SeasonState[K]>> =>
      (action) =>
        store.setSeason((prev) => {
          const next =
            typeof action === "function"
              ? (action as (previous: SeasonState[K]) => SeasonState[K])(prev[key])
              : action;
          return Object.is(next, prev[key]) ? prev : { ...prev, [key]: next };
        });
    return {
      setTeams: part("teams"),
      setMatchups: part("matchups"),
      setLogs: part("logs"),
      setBracketLogs: part("bracketLogs"),
      setSettings: part("settings"),
    };
  }, [store]);
  return {
    ...open.season,
    season: open.season,
    seasonId: open.id,
    store,
    setSeason: store.setSeason,
    openSeason: store.open,
    ...setters,
  };
}
