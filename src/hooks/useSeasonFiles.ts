import { useCallback, useRef } from "react";
import { coerceBackup, type FullBackup, type LiveSeasonData } from "../lib/backup";
import { displayName } from "../lib/format";
import { isFinal } from "../lib/util";
import { buildSeasonImportPreview, formatSeasonImportPreview } from "../lib/importPreview";
import { summarizeCsvImportIssues } from "../lib/importReport";
import { buildScheduleCsv, scheduleCsvFilename } from "../lib/scheduleCsvExport";
import { parseScheduleCsvImport } from "../lib/scheduleCsvImport";
import {
  parseTeamRankingsCsv,
  parseTeamRankingsJson,
  readTeamRankingsBackup,
  summarizeTeamRankingsBackup,
  teamRankingsBackupIsEmpty,
  teamRankingsCsvSections,
  writeTeamRankingsBackup,
  type TeamRankingsBackup,
} from "../lib/teamRankingsBackup";
import { loadAgeGroups, replaceArchivedSeasons } from "../lib/teamRankingsStorage";
import { copyReader, restoresInCloud, restoreTeamRankingsInCloud } from "../lib/cloud/cloudSession";
import { copyBackup, COPY_UNREAD } from "../lib/live/copyBackup";
import { squadYearForLeagueSeason } from "../lib/teamRankings/seasons";
import { useFullBackup } from "./useFullBackup";
import type { AppMode } from "./useAppMode";
import type { ConfirmState } from "./useConfirmation";
import type { ToastTone } from "./useToast";
import type { UndoSnapshotControls } from "./useUndoSnapshot";
import type { ActiveShareView, GameLog, Matchup, Settings, TeamBase } from "../lib/types";

/**
 * A whole season, as a file hands one over.
 *
 * `settings` is optional because the two files are not the same: a backup carries the season's
 * own settings and a schedule CSV does not, and inventing them for the CSV would quietly replace
 * whatever the manager had set.
 */
export type ImportedSeason = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  settings?: Settings;
};

export type SeasonFilesOptions = {
  /** The live season, fresher than storage, whose score writes are debounced. */
  liveSeason: () => LiveSeasonData;
  /** The season a bare "M/D" in a CSV is dated against. */
  activeSeasonId: string;
  /**
   * That season's squad year as Team Rankings in the cloud says it (the server's bridge, 1.6e),
   * where Team Rankings is the cloud's: a device that holds no pool has no pages of its own to read
   * it off. Absent, this device's own pages are read.
   */
  cloudSquadYear?: number;
  /**
   * Team Rankings is the cloud's for this browser (App's `rankingsLive`): only then do a CSV's
   * sections and a full backup's pool come off the copy (`useFullBackup`). With the board turned
   * off they are this device's own pool's, which it edits and keeps in step.
   */
  rankingsLive: boolean;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
  teamBaseById: Map<string, TeamBase>;
  seasonCount: number;
  /**
   * Puts a season from a file into React, in one call.
   *
   * One callback rather than the six setters it stands for, because every one of these paths sets
   * the same things in the same order and passing them separately would be six chances to forget
   * one.
   */
  applySeason: (next: ImportedSeason) => void;
  captureUndo: UndoSnapshotControls["capture"];
  restoreUndo: () => void;
  requestConfirmation: (options: ConfirmState) => Promise<boolean>;
  showToast: (
    message: string,
    options?: {
      tone?: ToastTone;
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    }
  ) => void;
  closeTeamData: () => void;
  /** Tells the rest of the app the shared pool has moved under it. */
  noteScoutChange: () => void;
  reloadSeasons: () => void;
  setActiveView: (view: ActiveShareView) => void;
  setTheme: (theme: "light" | "dark") => void;
  setAppMode: (mode: AppMode) => void;
  /** Drops the recap of the last score, which a new season has nothing to do with. */
  clearLastImpact: () => void;
};

/** Said while a CSV's sections are read off the cloud's copy, which can take a while. */
export const READING_THE_COPY_FOR_CSV =
  "Reading Team Rankings from the cloud for the CSV. It downloads once that is in.";

/** Said of a press while that read is still running, which starts no second one. */
export const STILL_READING_THE_COPY_FOR_CSV =
  "Still reading Team Rankings from the cloud for the CSV. It downloads once that is in.";

export type SeasonFiles = {
  importCSV: (file: File) => void;
  exportCSV: () => void;
  importBackup: (file: File) => void;
  exportBackup: () => void;
  resetSeason: () => Promise<void>;
};

/**
 * The files a season goes in and out by: a schedule CSV, a one-season backup, a whole-browser
 * backup, and the reset that empties it.
 *
 * Gathered out of `App` because they are one concern wearing four buttons. All four read a file
 * or write one, all four ask before replacing what is there, and three of the four take an undo
 * snapshot first — and the rule that decides between them is not which button was pressed but
 * what the file turns out to be. Kept apart, that rule was spread over three hundred lines in the
 * middle of a component that is mostly about something else.
 */
export function useSeasonFiles({
  liveSeason,
  activeSeasonId,
  cloudSquadYear,
  rankingsLive,
  teams,
  matchups,
  logs,
  settings,
  teamBaseById,
  seasonCount,
  applySeason,
  captureUndo,
  restoreUndo,
  requestConfirmation,
  showToast,
  closeTeamData,
  noteScoutChange,
  reloadSeasons,
  setActiveView,
  setTheme,
  setAppMode,
  clearLastImpact,
}: SeasonFilesOptions): SeasonFiles {
  /**
   * What an import is about to do to the Team Rankings pool, for the confirmation dialog. Worth
   * stating in all three cases: the pool spans every season and every age group, so replacing it
   * reaches well past the one season being imported; a file that predates rankings backups leaves
   * it untouched, which a manager restoring an old backup should not have to guess at; and a file
   * saved back when the pool was empty restores that emptiness, which is the one outcome nobody
   * would infer from a count.
   */
  const teamRankingsImportNote = (incoming: TeamRankingsBackup | null) => {
    if (!incoming) {
      return "Team Rankings: none in this file. The current Team Rankings pool is left as it is.";
    }
    const inCloud = restoresInCloud();
    if (teamRankingsBackupIsEmpty(incoming)) {
      return inCloud
        ? "Team Rankings: this file's pool is empty, so the cloud's is left as it is."
        : "Team Rankings: this file's pool is empty. Importing it clears every age group, ranked team, and logged game from Team Rankings.";
    }
    return `Team Rankings: ${summarizeTeamRankingsBackup(incoming)}. ${
      inCloud
        ? "Replaces the cloud's Team Rankings for every device; what it replaces is kept under Earlier versions in the Cloud panel."
        : "Replaces the shared Team Rankings pool for every age group, not just this season."
    }`;
  };

  /**
   * Team Rankings from an imported file, restored in the cloud (1.6) by the server, the copy's
   * owner's to ask; this browser takes it as any save, at once where `reload` (the Team Rankings
   * file alone), else as a newer copy, so a season imported with it is not reloaded away. Says what
   * came of it, for the toast that follows: none where the file has no Team Rankings at all.
   */
  const restoreImportedRankings = async (
    incoming: TeamRankingsBackup | null,
    { reload }: { reload: boolean }
  ): Promise<{ said: string; failed: boolean } | null> => {
    if (!incoming) return null;
    if (teamRankingsBackupIsEmpty(incoming)) {
      return {
        said: "The file holds no Team Rankings, so the cloud's is as it was.",
        failed: false,
      };
    }
    const done = await restoreTeamRankingsInCloud(incoming, { reload });
    return done.ok
      ? {
          said: `Team Rankings restored in the cloud: ${summarizeTeamRankingsBackup(incoming)}.`,
          failed: false,
        }
      : { said: `Team Rankings was not restored: ${done.message}`, failed: true };
  };

  /** Team Rankings from an imported file, written here: a browser that does not keep the cloud's. */
  const applyTeamRankingsImport = async (incoming: TeamRankingsBackup | null) => {
    if (!incoming) return;
    if (!writeTeamRankingsBackup(incoming)) {
      showToast("Season imported, but Team Rankings data could not be saved (storage full).", {
        tone: "error",
      });
      return;
    }
    /*
     * The archives are swapped only when the file carries the field at all. A file written before
     * archives existed has no opinion about them, and reading that silence as "no archives" would
     * delete every finished season on restoring an older backup — the one thing in the pool that
     * cannot be recomputed from anything.
     */
    if (incoming.archives && !(await replaceArchivedSeasons(incoming.archives))) {
      showToast("Pool restored, but the archived seasons could not be saved (storage full).", {
        tone: "error",
      });
    }
    noteScoutChange();
  };

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("File is not text");

        /*
         * A Team Rankings backup is JSON and carries the pool alone — no schedule, no season. Sent
         * through the schedule reader it would parse to nothing and the pool would be left alone,
         * which is the wrong answer to a file that is entirely pool.
         */
        const {
          teams: importedTeams,
          matchups: importedMatchups,
          logs: importedLogs,
          issues: importIssues,
          /*
           * The season's own year, so a bare "M/D" in the file lands on a real day. Read from the
           * age group that claims this season — "Fall 2026" is part of squad year 2027 — which is
           * the link the user has already set up rather than a second thing to keep in step. With
           * none, the reader declines to call a nil-nil a result.
           */
        } = parseScheduleCsvImport(
          raw,
          new Date(),
          cloudSquadYear ?? squadYearForLeagueSeason(activeSeasonId, loadAgeGroups())
        );
        // A CSV exported as a backup carries the Team Rankings sections after the schedule; a
        // plain schedule CSV carries none, and parses to null so the pool is left alone.
        const importedRankings = parseTeamRankingsCsv(raw);

        const warningLines = summarizeCsvImportIssues(importIssues);
        const importedScoreCount = Object.values(importedLogs).filter(isFinal).length;
        const logsPendingVerification = importedScoreCount
          ? Object.fromEntries(
              Object.entries(importedLogs).map(([gameId, log]) => [
                gameId,
                isFinal(log) ? { ...log, isFinal: false } : log,
              ])
            )
          : importedLogs;
        const importedTeamNameById = new Map(
          importedTeams.map((team) => [team.id, displayName(team.name)])
        );
        const preview = buildSeasonImportPreview(
          importedTeams,
          importedMatchups,
          importedLogs,
          teams,
          matchups,
          (teamId) => importedTeamNameById.get(teamId) ?? displayName(teamId),
          logs
        );
        const verificationMessage = importedScoreCount
          ? `\n\n${importedScoreCount} imported scored game${importedScoreCount === 1 ? "" : "s"} will load into the Scoreboard as pending verification. Review each score and use Verify Final before standings or prediction work counts it.`
          : "";
        const confirmed = await requestConfirmation({
          title: "Import schedule CSV?",
          message: `${formatSeasonImportPreview(preview, warningLines)}${verificationMessage}

${teamRankingsImportNote(importedRankings)}

This will replace the current season data and save an undo snapshot.`,
          confirmLabel: warningLines.length ? "Import with warnings" : "Replace season",
        });
        if (!confirmed) return;

        // In the cloud the server restores the pool, and the copy keeps what it replaced: Undo
        // here would only write this browser's old pool over the cloud's.
        const inCloud = restoresInCloud();
        captureUndo("CSV import", {
          withTeamRankings: Boolean(importedRankings) && !inCloud,
        });
        if (!inCloud) await applyTeamRankingsImport(importedRankings);
        applySeason({
          teams: importedTeams,
          matchups: importedMatchups,
          logs: logsPendingVerification,
          bracketLogs: {},
        });
        closeTeamData();
        // The recap describes one score in the season being replaced, so it goes with it. This
        // line is the one thing the other two paths did and this one did not.
        clearLastImpact();
        setActiveView(importedScoreCount ? "games" : "standings");
        // The season first, then the cloud's Team Rankings, which can take a while: the season on
        // screen is the imported one by then, so nothing typed meanwhile lands in the wrong one.
        const pool = inCloud
          ? await restoreImportedRankings(importedRankings, { reload: false })
          : null;
        showToast(
          `Imported ${importedMatchups.length} games${importIssues.length ? ` with ${importIssues.length} skipped row(s)` : ""}${importedScoreCount ? `; ${importedScoreCount} scored game${importedScoreCount === 1 ? "" : "s"} pending verification` : ""}.${pool ? ` ${pool.said}` : ""}`,
          {
            tone: pool?.failed ? "error" : "undo",
            actionLabel: "Undo",
            onAction: restoreUndo,
          }
        );
      } catch (error) {
        console.error(error);
        showToast(
          "Could not import this CSV. Use the schedule CSV with Game ID, Date, Away Team, and Home Team columns.",
          { tone: "error" }
        );
      }
    };
    reader.readAsText(file);
  };

  /** Whether a CSV's sections are being read off the copy now: a second press starts no other. */
  const readingCopy = useRef(false);

  const exportCSV = useCallback(() => {
    const write = (rankingsSections: string) => {
      const csv = buildScheduleCsv({
        matchups,
        logs,
        teamsById: teamBaseById,
        pitchMode: settings.pitchMode,
        rankingsSections,
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = scheduleCsvFilename(settings.seasonLabel);
      anchor.click();
      URL.revokeObjectURL(url);
    };
    if (!rankingsLive || !restoresInCloud()) {
      write(teamRankingsCsvSections(readTeamRankingsBackup()));
      return;
    }
    // One read at a time: each is the whole copy, unpacked and decoded in a worker of its own.
    if (readingCopy.current) {
      showToast(STILL_READING_THE_COPY_FOR_CSV);
      return;
    }
    /*
     * In the cloud the pool sections are the copy's, read for the file (1.6e), since this device,
     * on the cloud's board, holds no pool, or none kept in step. A copy that cannot be read leaves
     * the schedule to go without them, and says so: the schedule is what the button is mostly for.
     */
    readingCopy.current = true;
    showToast(READING_THE_COPY_FOR_CSV);
    void (async () => {
      try {
        const made = await copyBackup({
          copy: copyReader,
          want: "csv",
          savedAt: new Date().toISOString(),
        });
        write(made.ok ? (made.csv ?? "") : "");
        if (!made.ok)
          showToast(`${COPY_UNREAD[made.why]}, so the schedule was saved without Team Rankings.`, {
            tone: "error",
          });
      } finally {
        readingCopy.current = false;
      }
    })();
  }, [settings, matchups, logs, teamBaseById, rankingsLive, showToast]);

  /**
   * Put React back in step with storage, which is the source of truth once a restore has written
   * to it. Also drops the team-data deep link, which could otherwise point at a team the restored
   * season does not have.
   */
  const afterFullRestore = useCallback(
    (backup: FullBackup) => {
      reloadSeasons();
      closeTeamData();
      noteScoutChange();
      if (backup.preferences.theme) setTheme(backup.preferences.theme);
      if (backup.preferences.appMode) setAppMode(backup.preferences.appMode);
      clearLastImpact();
      setActiveView("standings");
    },
    [
      reloadSeasons,
      closeTeamData,
      noteScoutChange,
      setTheme,
      setAppMode,
      clearLastImpact,
      setActiveView,
    ]
  );

  const { exportBackup, restoreFullBackup } = useFullBackup({
    liveSeason,
    seasonCount,
    rankingsLive,
    requestConfirmation,
    showToast,
    onRestored: afterFullRestore,
  });

  /** The older single-season backup shape: replaces the active season only, and stays undoable. */
  const restoreSeasonBackup = async (
    season: LiveSeasonData,
    nextRankings: TeamRankingsBackup | null
  ) => {
    const backupTeamNameById = new Map(
      season.teams.map((team) => [team.id, displayName(team.name)])
    );
    const preview = buildSeasonImportPreview(
      season.teams,
      season.matchups,
      season.logs,
      teams,
      matchups,
      (teamId) => backupTeamNameById.get(teamId) ?? displayName(teamId),
      logs
    );
    const confirmed = await requestConfirmation({
      title: "Import backup JSON?",
      message: `${formatSeasonImportPreview(preview)}

${teamRankingsImportNote(nextRankings)}

This backup carries one season, so it replaces the current season data and saves an undo snapshot.`,
      confirmLabel: "Import backup",
    });
    if (!confirmed) return;

    const inCloud = restoresInCloud();
    captureUndo("Backup import", {
      withTeamRankings: Boolean(nextRankings) && !inCloud,
      // The backup's settings replace these, so the undo has to be able to put them back.
      withSettings: Boolean(season.settings),
    });
    if (!inCloud) await applyTeamRankingsImport(nextRankings);
    applySeason(season);
    closeTeamData();
    clearLastImpact();
    setActiveView("standings");
    // As the CSV's: the season first, then the cloud's Team Rankings.
    const pool = inCloud ? await restoreImportedRankings(nextRankings, { reload: false }) : null;
    showToast(`Imported backup (${season.matchups.length} games).${pool ? ` ${pool.said}` : ""}`, {
      tone: pool?.failed ? "error" : "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("Backup is not text");

        /*
         * Two JSON backups arrive at this button now, and they are not the same file. The whole-app
         * one carries every season, the pool and the settings; the Team Rankings one carries the
         * pool alone. Told apart by what the file says it is rather than by which button was
         * pressed, so handing over the wrong one is a message rather than a restore of nothing.
         */
        const pool = parseTeamRankingsJson(raw);
        if (pool) {
          // It replaces the whole pool rather than merging into it, which is worth saying out loud
          // before it happens — the same reason the CSV path previews what it will do.
          const confirmed = await requestConfirmation({
            title: "Restore Team Rankings from this file?",
            message: `${teamRankingsImportNote(pool)}

League Standings — your seasons, schedules and scores — is not touched.`,
            confirmLabel: "Restore",
          });
          if (!confirmed) return;
          if (restoresInCloud()) {
            // Restored by the server and reloaded on where Team Rankings is open, or said why not.
            const done = await restoreImportedRankings(pool, { reload: true });
            if (done) showToast(done.said, { tone: done.failed ? "error" : "success" });
            return;
          }
          await applyTeamRankingsImport(pool);
          showToast(`Team Rankings restored: ${summarizeTeamRankingsBackup(pool)}`, {
            tone: "success",
          });
          return;
        }

        const parsed = coerceBackup(JSON.parse(raw) as unknown);
        if (!parsed) throw new Error("Backup is not a League Forecast backup");
        if (parsed.kind === "full") await restoreFullBackup(parsed.backup);
        else await restoreSeasonBackup(parsed.season, parsed.teamRankings);
      } catch (error) {
        console.error(error);
        showToast("Could not import this backup JSON.", { tone: "error" });
      }
    };
    reader.readAsText(file);
  };

  const resetSeason = async () => {
    const confirmed = await requestConfirmation({
      title: "Reset season?",
      message:
        "This clears teams, games, and scores from this browser. An undo snapshot will be saved.",
      confirmLabel: "Reset season",
    });
    if (!confirmed) return;
    captureUndo("Reset season");
    applySeason({ teams: [], matchups: [], logs: {}, bracketLogs: {} });
    clearLastImpact();
    closeTeamData();
    setActiveView("standings");
    showToast("Season reset.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  return { importCSV, exportCSV, importBackup, exportBackup, resetSeason };
}
