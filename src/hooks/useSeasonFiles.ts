import { useCallback } from "react";
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
import { squadYearForLeagueSeason } from "../lib/teamRankings/seasons";
import { useFullBackup } from "./useFullBackup";
import type { AppMode } from "./useAppMode";
import type { ConfirmState } from "./useConfirmation";
import type { ToastTone } from "./useToast";
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
  captureUndo: (label: string, options?: { withTeamRankings?: boolean }) => void;
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
    if (teamRankingsBackupIsEmpty(incoming)) {
      return "Team Rankings: this file's pool is empty. Importing it clears every age group, ranked team, and logged game from Team Rankings.";
    }
    return `Team Rankings: ${summarizeTeamRankingsBackup(incoming)}. Replaces the shared Team Rankings pool for every age group, not just this season.`;
  };

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
          squadYearForLeagueSeason(activeSeasonId, loadAgeGroups())
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

        captureUndo("CSV import", { withTeamRankings: Boolean(importedRankings) });
        await applyTeamRankingsImport(importedRankings);
        applySeason({
          teams: importedTeams,
          matchups: importedMatchups,
          logs: logsPendingVerification,
          bracketLogs: {},
        });
        closeTeamData();
        setActiveView(importedScoreCount ? "games" : "standings");
        showToast(
          `Imported ${importedMatchups.length} games${importIssues.length ? ` with ${importIssues.length} skipped row(s)` : ""}${importedScoreCount ? `; ${importedScoreCount} scored game${importedScoreCount === 1 ? "" : "s"} pending verification` : ""}.`,
          {
            tone: "undo",
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

  const exportCSV = useCallback(() => {
    const csv = buildScheduleCsv({
      matchups,
      logs,
      teamsById: teamBaseById,
      pitchMode: settings.pitchMode,
      rankingsSections: teamRankingsCsvSections(readTeamRankingsBackup()),
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = scheduleCsvFilename(settings.seasonLabel);
    anchor.click();
    URL.revokeObjectURL(url);
  }, [settings, matchups, logs, teamBaseById]);

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

    captureUndo("Backup import", { withTeamRankings: Boolean(nextRankings) });
    await applyTeamRankingsImport(nextRankings);
    applySeason(season);
    closeTeamData();
    clearLastImpact();
    setActiveView("standings");
    showToast(`Imported backup (${season.matchups.length} games).`, {
      tone: "undo",
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
