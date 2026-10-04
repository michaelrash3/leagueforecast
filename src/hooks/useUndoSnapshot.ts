import { useCallback, useRef } from "react";
import {
  coerceTeamRankingsBackup,
  readTeamRankingsBackup,
  writeTeamRankingsBackup,
  type UndoSnapshotWithRankings,
} from "../lib/teamRankingsBackup";
import { readUndoSnapshot, saveUndoSnapshot } from "../lib/storage";
import type { GameLog, Matchup, Settings, TeamBase } from "../lib/types";
import { coerceSettings } from "../lib/validate";

/** The part of a season an undo puts back. */
export type UndoableSeason = {
  /** The stored shape of a team, which is what a snapshot carries and what storage reads back. */
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  /**
   * The league's settings, carried only by a snapshot taken before something that replaces them —
   * Load Demo, a shared link, a one-season backup. Any other undo leaves settings as they are now,
   * so a setting changed after a deleted game is not taken back by undoing the delete.
   */
  settings?: Settings;
  /**
   * When the snapshot was taken, on a season being put back: League kept live puts back only what
   * no other device has changed since (`guardedUndo`).
   */
  takenAt?: number;
};

export type UndoSnapshotOptions = {
  /** Reads the season as it stands, at the moment something is about to change it. */
  readSeason: () => UndoableSeason;
  /** Puts a season back. */
  applySeason: (season: UndoableSeason) => void;
  /** Called when a restored snapshot carried a Team Rankings pool that was written back. */
  onRankingsRestored: () => void;
  showToast: (message: string, options?: { tone?: "success" | "error" }) => void;
};

export type UndoSnapshotControls = {
  /** Takes a snapshot before a change, labelled with what the change was. */
  capture: (
    label: string,
    options?: { withTeamRankings?: boolean; withSettings?: boolean }
  ) => void;
  /** Puts the last snapshot back, from memory if it is there and from storage if it is not. */
  restore: () => void;
  /** Drops the held snapshot without restoring it, for when the season underneath has changed. */
  forget: () => void;
};

/**
 * One step of undo, held in memory and mirrored to storage.
 *
 * In memory first because that is the copy that is certainly intact and certainly current; storage
 * is the copy that survives a reload, and at a nationwide pool size it may simply not fit. Those
 * are different failures and they used to be reported as the same one — a working undo announcing
 * "storage full" as an error, which reads as the undo itself having failed.
 */
export function useUndoSnapshot({
  readSeason,
  applySeason,
  onRankingsRestored,
  showToast,
}: UndoSnapshotOptions): UndoSnapshotControls {
  const held = useRef<UndoSnapshotWithRankings | null>(null);

  const capture = useCallback(
    (label: string, options?: { withTeamRankings?: boolean; withSettings?: boolean }) => {
      const { settings, ...season } = readSeason();
      const snapshot: UndoSnapshotWithRankings = {
        ...season,
        ...(options?.withSettings && settings ? { settings } : {}),
        label,
        timestamp: Date.now(),
        ...(options?.withTeamRankings ? { teamRankings: readTeamRankingsBackup() } : {}),
      };
      held.current = snapshot;
      if (!saveUndoSnapshot(snapshot)) {
        /*
         * The undo itself is fine — it is in memory, which is where Undo reads from first. What
         * failed is the copy that would survive a reload, and only the snapshots carrying the pool
         * are big enough for that to be the ordinary outcome rather than a real storage problem.
         */
        if (options?.withTeamRankings) {
          showToast("Undo is ready, but this pool is too big to keep it past a reload.");
        } else {
          showToast("Could not save undo snapshot (storage full).", { tone: "error" });
        }
      }
    },
    [readSeason, showToast]
  );

  const restore = useCallback(() => {
    const snapshot = held.current ?? (readUndoSnapshot() as UndoSnapshotWithRankings | null);
    if (!snapshot) return;
    applySeason({
      teams: snapshot.teams,
      matchups: snapshot.matchups,
      logs: snapshot.logs,
      bracketLogs: snapshot.bracketLogs ?? {},
      // Off storage as well, so read the way stored settings always are.
      ...(snapshot.settings !== undefined ? { settings: coerceSettings(snapshot.settings) } : {}),
      ...(typeof snapshot.timestamp === "number" ? { takenAt: snapshot.timestamp } : {}),
    });
    // Snapshots come back off localStorage, so the pool is re-validated rather than trusted.
    const rankings = coerceTeamRankingsBackup(snapshot.teamRankings);
    if (rankings && writeTeamRankingsBackup(rankings)) onRankingsRestored();
    held.current = null;
    showToast(`Restored: ${snapshot.label}.`, { tone: "success" });
  }, [applySeason, onRankingsRestored, showToast]);

  const forget = useCallback(() => {
    held.current = null;
  }, []);

  return { capture, restore, forget };
}
