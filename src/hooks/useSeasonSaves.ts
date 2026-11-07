import { useCallback, useEffect, useRef } from "react";
import { mergeHeldScores } from "../lib/heldScores";
import type { SeasonStore } from "../lib/seasonStore";
import {
  loadLogs,
  saveBracketLogs,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
} from "../lib/storage";
import { beforeTabYields } from "../lib/tabTurn";
import type { GameLog, Matchup, Settings, TeamBase } from "../lib/types";

/**
 * The open season written to this device's storage as it changes: its teams, schedule, bracket
 * scores and settings at once, and its scores half a second after the last keystroke. A score
 * still held in that half second is written at once when this tab gives the turn to another, when
 * another season opens, and as the page is hidden or closed: `writeHeldScores` does that, and App
 * hands it to the season list to call before a switch. A write that fails is reported through
 * `recordSaveResult`.
 *
 * App.tsx did this under "Persisted state". It moved here whole and is called where it was, so
 * every write runs, and its effects are set up, in the order they were.
 */
export type SeasonSavesInputs = {
  bracketLogs: Record<string, GameLog>;
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  recordSaveResult: (ok: boolean, label: string, errorMessage: string) => void;
  seasonStore: SeasonStore;
  settings: Settings;
  teams: TeamBase[];
};

export function useSeasonSaves({
  bracketLogs,
  logs,
  matchups,
  recordSaveResult,
  seasonStore,
  settings,
  teams,
}: SeasonSavesInputs) {
  useEffect(() => {
    recordSaveResult(saveTeams(teams), "teams", "Could not save teams (storage full).");
  }, [teams, recordSaveResult]);

  useEffect(() => {
    recordSaveResult(saveMatchups(matchups), "schedule", "Could not save schedule (storage full).");
  }, [matchups, recordSaveResult]);

  // The scores as last written, by identity: what a flush of the scores held has still to write.
  const savedLogs = useRef(logs);
  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      recordSaveResult(saveLogs(logs), "scores", "Could not save scores (storage full).");
      savedLogs.current = logs;
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [logs, recordSaveResult]);

  /*
   * A score still held, written at once: when this tab gives the turn away (`tabTurn.ts`), to a
   * tab asking with Use here, or, in the moment before this tab's channel code arrived, to a tab
   * already writing or one opened before it; before another season opens (`beforeSwitch`); and as
   * the page is hidden or closed, the last moments a browser promises a page. The half second
   * above would end with the score refused as this tab went read-only, the other tab reading the
   * season again without it, or with the score not written at all. Read from the store, which
   * holds a keystroke the page has still to draw (`useSeasonState`).
   */
  const writeHeldScores = useCallback((): boolean => {
    const held = seasonStore.get().season.logs;
    // Only a score still held: written again, the scores as this tab read them could undo
    // one the other tab saved since, and would have it read the season again for nothing.
    if (held === savedLogs.current) return false;
    // And only the games this tab changed, over what storage holds now (`mergeHeldScores`).
    const saved = saveLogs(mergeHeldScores(loadLogs(), savedLogs.current, held));
    recordSaveResult(saved, "scores", "Could not save scores (storage full).");
    if (saved) savedLogs.current = held;
    return saved;
  }, [seasonStore, recordSaveResult]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") writeHeldScores();
    };
    const stopYield = beforeTabYields(writeHeldScores);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", writeHeldScores);
    return () => {
      stopYield();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", writeHeldScores);
    };
  }, [writeHeldScores]);

  useEffect(() => {
    recordSaveResult(
      saveBracketLogs(bracketLogs),
      "bracket scores",
      "Could not save bracket scores (storage full)."
    );
  }, [bracketLogs, recordSaveResult]);

  useEffect(() => {
    recordSaveResult(saveSettings(settings), "settings", "Could not save settings (storage full).");
  }, [settings, recordSaveResult]);

  return { writeHeldScores };
}
