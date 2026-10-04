import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { GameLog, Matchup, Settings, TeamBase } from "../lib/types";

/** The open season's data, as League Standings holds it while the page is up. */
export type SeasonState = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  settings: Settings;
};

export type SeasonStateControls = SeasonState & {
  /** The whole season, and a setter of the whole season that sees every update queued before it. */
  season: SeasonState;
  setSeason: Dispatch<SetStateAction<SeasonState>>;
  setTeams: Dispatch<SetStateAction<TeamBase[]>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setBracketLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
};

/**
 * The open season as one piece of state, with a setter for each part that behaves as its own
 * `useState` setter did: a value or an updater, and nothing rendered when the part is unchanged.
 *
 * One piece rather than five because the season is changed from outside the page as well as from
 * it: another device's edit arrives while a score is being typed here, and has to be laid over the
 * season as it really stands, updates still queued included. With five pieces of state no updater
 * sees all five; with one, a single updater merges the arrival into exactly what is there
 * (`useLiveLeague`). Each part keeps its identity until it changes, so what is worked out from
 * one part is not worked out again when another changes.
 */
export function useSeasonState(load: () => SeasonState): SeasonStateControls {
  const [season, setSeason] = useState<SeasonState>(load);
  const setters = useMemo(() => {
    const part =
      <K extends keyof SeasonState>(key: K): Dispatch<SetStateAction<SeasonState[K]>> =>
      (action) =>
        setSeason((prev) => {
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
  }, []);
  return { ...season, season, setSeason, ...setters };
}
