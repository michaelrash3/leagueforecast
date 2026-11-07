import { type Dispatch, type SetStateAction, useCallback } from "react";
import { normalizeDateInput } from "../lib/date";
import { displayName } from "../lib/format";
import { finalToggled, type NameOf, type RecapPool, withFinal } from "../lib/impactRecap";
import type { GameLog, LastImpact, Matchup, Settings, TeamBase } from "../lib/types";
import { blankLog, swappedLog } from "../lib/util";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";
import type { UndoSnapshotControls } from "./useUndoSnapshot";

/**
 * The edits the Schedule makes to a season's games: a game marked final or not, with the recap of
 * what that moved; a score typed; a bracket game's score typed or marked final, or the bracket's
 * scores cleared; a game added once two different teams are chosen; a game deleted, asked first and
 * one step to undo; and a game's home and away swapped.
 *
 * App.tsx did these under "Snapshots / undo", among the steps to undo them. They moved here whole
 * and are called where they were, so their callbacks keep their place among App's.
 */
export type GameEditsInputs = {
  captureUndo: UndoSnapshotControls["capture"];
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  nameOf: NameOf;
  newAway: string;
  newDate: string;
  newHome: string;
  recapPool: RecapPool;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  restoreUndo: UndoSnapshotControls["restore"];
  setBracketLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setLastImpact: Dispatch<SetStateAction<LastImpact | null>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setNewDate: Dispatch<SetStateAction<string>>;
  settings: Settings;
  showToast: ReturnType<typeof useToast>["show"];
  teamBaseById: Map<string, TeamBase>;
};

export function useGameEdits({
  captureUndo,
  logs,
  matchups,
  nameOf,
  newAway,
  newDate,
  newHome,
  recapPool,
  requestConfirmation,
  restoreUndo,
  setBracketLogs,
  setLastImpact,
  setLogs,
  setMatchups,
  setNewDate,
  settings,
  showToast,
  teamBaseById,
}: GameEditsInputs) {
  const toggleFinal = (gameId: string) => {
    const { nextLogs, impact } = finalToggled(
      gameId,
      logs,
      settings.defaultGameInnings,
      recapPool,
      nameOf
    );
    // The final alone, onto the scores as they are by then, which may hold keystrokes this press
    // came before (`withFinal`).
    const isFinal = nextLogs[gameId]?.isFinal === true;
    setLogs((prev) => withFinal(prev, gameId, isFinal, settings.defaultGameInnings));
    setLastImpact(impact);
  };

  const updateLog = useCallback(
    (gameId: string, field: keyof GameLog, value: string | boolean) => {
      setLogs((prev) => {
        const current = prev[gameId] || blankLog(String(settings.defaultGameInnings));
        if (current[field] === value) return prev;
        return {
          ...prev,
          [gameId]: { ...current, [field]: value },
        };
      });
    },
    [settings.defaultGameInnings, setLogs]
  );

  const updateBracketLog = useCallback(
    (gameId: string, field: keyof GameLog, value: string | boolean) => {
      setBracketLogs((prev) => {
        const current = prev[gameId] || blankLog();
        return {
          ...prev,
          [gameId]: {
            ...current,
            awayK: current.awayK || "0",
            homeK: current.homeK || "0",
            [field]: value,
          },
        };
      });
    },
    [setBracketLogs]
  );

  const toggleBracketFinal = useCallback(
    (gameId: string) => {
      setBracketLogs((prev) => {
        const current = prev[gameId] || blankLog();
        return {
          ...prev,
          [gameId]: {
            ...current,
            awayK: current.awayK || "0",
            homeK: current.homeK || "0",
            isFinal: !current.isFinal,
          },
        };
      });
    },
    [setBracketLogs]
  );

  const clearBracketScores = useCallback(
    (gameIds: string[], label: string) => {
      const ids = new Set(gameIds);
      setBracketLogs((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([gameId]) => !ids.has(gameId)))
      );
      showToast(`${label} scores cleared.`, { tone: "success" });
    },
    [showToast, setBracketLogs]
  );

  const addGameValid = !!newAway && !!newHome && newAway !== newHome;

  const addGame = () => {
    if (!addGameValid) {
      showToast("Pick two different teams to add a game.", { tone: "error" });
      return;
    }
    const id = `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setMatchups((prev) => [
      ...prev,
      { id, date: normalizeDateInput(newDate), away: newAway, home: newHome },
    ]);
    setLogs((prev) => ({ ...prev, [id]: blankLog(String(settings.defaultGameInnings)) }));
    setNewDate("");
  };

  const removeGame = async (gameId: string) => {
    const confirmed = await requestConfirmation({
      title: "Delete this game?",
      message: "This removes the game and its current score data. An undo snapshot will be saved.",
      confirmLabel: "Delete game",
    });
    if (!confirmed) return;
    const game = matchups.find((m) => m.id === gameId);
    captureUndo(
      game
        ? `Deleted ${displayName(teamBaseById.get(game.away)?.name || game.away)} vs ${displayName(teamBaseById.get(game.home)?.name || game.home)}`
        : "Deleted game"
    );
    setMatchups((prev) => prev.filter((g) => g.id !== gameId));
    setLogs((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
    showToast("Game deleted.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const swapGame = (gameId: string) => {
    setMatchups((prev) =>
      prev.map((game) =>
        game.id === gameId ? { ...game, away: game.home, home: game.away } : game
      )
    );
    setLogs((prev) => {
      const log = prev[gameId];
      if (!log) return prev;
      return { ...prev, [gameId]: swappedLog(log) };
    });
  };

  return {
    addGame,
    addGameValid,
    clearBracketScores,
    removeGame,
    swapGame,
    toggleBracketFinal,
    toggleFinal,
    updateBracketLog,
    updateLog,
  };
}
