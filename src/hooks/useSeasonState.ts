import { useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import {
  createSeasonStore,
  type OpenSeason,
  type SeasonState,
  type SeasonStore,
} from "../lib/seasonStore";
import type { GameLog, Matchup, Settings, TeamBase } from "../lib/types";

export type { OpenSeason, SeasonState, SeasonStore };

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
