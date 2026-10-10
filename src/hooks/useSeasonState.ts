import { useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { finalLogsOf } from "../lib/finalLogs";
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
  /**
   * The scores of the games marked final alone, the same object while only games still being
   * played change (`finalLogsOf`): what every calculation from the scores is keyed on.
   */
  finalLogs: Record<string, GameLog>;
  store: SeasonStore;
  setSeason: Dispatch<SetStateAction<SeasonState>>;
  openSeason: (id: string, season: SeasonState) => void;
  setTeams: Dispatch<SetStateAction<TeamBase[]>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setBracketLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
};

/** The open season with its final games' scores, kept from `previous` while those are unchanged. */
const withFinals = (open: OpenSeason, previous?: Record<string, GameLog>) => ({
  ...open,
  finalLogs: finalLogsOf(open.season.logs, previous),
});

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
  /*
   * The page renders from its own copy of the store, set from the store's notice. The notice runs
   * inside the setter's call, so the copy is set with the priority the change was made with: a
   * score box's keystroke, made in a transition (`GamesView`), renders as one, interruptibly, as
   * it did before the store, rather than at once as an external store's reads would force.
   * Whatever reads the store itself (`leagueSync.ts`) still sees every change the moment it is
   * made. Nothing changes the store between the first render and this subscription: the live
   * store starts in an effect, after it.
   */
  const [open, setOpen] = useState(() => withFinals(store.get()));
  useLayoutEffect(
    () =>
      store.subscribe(() => {
        const next = store.get();
        setOpen((previous) => withFinals(next, previous.finalLogs));
      }),
    [store]
  );
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
    finalLogs: open.finalLogs,
    store,
    setSeason: store.setSeason,
    openSeason: store.open,
    ...setters,
  };
}
