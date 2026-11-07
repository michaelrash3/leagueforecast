import { type Dispatch, type SetStateAction, useMemo } from "react";
import { deleteSquadYear } from "../lib/deleteSquadYear";
import { lastBackupTakenAt, noteBackupTaken } from "../lib/lastBackup";
import { type AllKnown, archivedFrom } from "../lib/live/allKnown";
import { changeBetween, type PoolCommand, poolParts } from "../lib/live/commands";
import type { CommandRun } from "../lib/live/runPoolCommand";
import { reloadApp, resetApp } from "../lib/resetApp";
import type { AgeGroup, ScoutTeam } from "../lib/teamRankings";
import { type ArchiveEntry, archiveSquadYear } from "../lib/teamRankingsArchive";
import {
  estimateBackupBytes,
  formatBytes,
  LARGE_BACKUP_BYTES,
  readTeamRankingsBackup,
  summarizeTeamRankingsBackup,
  teamRankingsJsonParts,
} from "../lib/teamRankingsBackup";
import {
  forgetArchivedSeason,
  loadAllArchivedSeasons,
  loadArchiveIndex,
  loadScoutGames,
  loadTidyStamp,
  saveArchivedSeasons,
  saveTidyStamp,
} from "../lib/teamRankingsStorage";
import { poolSignature } from "../lib/tidyStamp";
import {
  archiveConfirmation,
  archivedSaid,
  archivePreviewOf,
  archivesAnything,
  archiveTableOf,
  deleteConfirmation,
  deletePreviewOf,
  deletesAnything,
  nothingUnder,
  summariseYears,
} from "../lib/yearSummary";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";

/**
 * Starting over, in its four sizes: the whole pool downloaded as one JSON file, which is how the
 * data comes back; a baseball year's tables frozen and the games behind them deleted; a whole
 * squad year deleted with nothing kept; and Team Rankings emptied. Each asks first, with the
 * counts of what it would take, and the larger ones reload the page so no view holds a copy.
 *
 * TeamRankingsView.tsx did this under "Starting over". It moved here whole and is called where it
 * was.
 */
export type StartingOverInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  archives: ArchiveEntry[];
  closeClub: () => void;
  onDataChange: (() => void) | undefined;
  pickPage: Dispatch<SetStateAction<string>>;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  runCommand: (
    command: PoolCommand,
    options?: { quiet?: boolean; explains?: boolean }
  ) => CommandRun;
  scoutTeams: ScoutTeam[];
  setArchives: Dispatch<SetStateAction<ArchiveEntry[]>>;
  setArchiving: Dispatch<SetStateAction<boolean>>;
  setPoolBackupAt: Dispatch<SetStateAction<string | null>>;
  setReportTeamId: Dispatch<SetStateAction<string>>;
  showToast: ReturnType<typeof useToast>["show"];
  storedYears: { year: number | undefined; games: number; teams: number | null }[];
};

export function useStartingOver({
  ageGroups,
  allKnown,
  archives,
  closeClub,
  onDataChange,
  pickPage,
  requestConfirmation,
  runCommand,
  scoutTeams,
  setArchives,
  setArchiving,
  setPoolBackupAt,
  setReportTeamId,
  showToast,
  storedYears,
}: StartingOverInputs) {
  /**
   * The whole pool as one JSON file, which is how the data comes back — and the only reason the
   * reset below can be offered at all.
   *
   * JSON rather than the CSV it used to be because the pool is nested: a team carries a list of
   * GameChanger links, each with its own staff list and season record, and a table has nowhere to
   * put that. Restoring still reads either, because files written before this exist.
   */
  const downloadPoolBackup = async () => {
    /*
     * The archives are loaded here and nowhere else in the app. They are read on demand precisely
     * so that they are not in memory, and a backup is the one job that needs all of them at once —
     * and needs them, because an archived table is the only copy of that season and this file is
     * what the reset card offers as the way back.
     */
    const backup = { ...readTeamRankingsBackup(), archives: await loadAllArchivedSeasons() };
    const estimate = estimateBackupBytes(backup);

    // A nationwide pool makes a file that takes a moment to put together and will not open in
    // every spreadsheet. Somebody who pressed this meaning to glance at their own league's rows
    // should hear that before waiting for it.
    if (estimate >= LARGE_BACKUP_BYTES) {
      const go = await requestConfirmation({
        title: "That is a large backup",
        message: `${summarizeTeamRankingsBackup(backup)}

The file will be around ${formatBytes(estimate)} and will take a moment to put together.`,
        confirmLabel: "Download anyway",
      });
      if (!go) return;
    }

    /*
     * Written in pieces rather than as one string. At twenty thousand teams the joined copy is
     * tens of megabytes and exists alongside the rows it was built from at the moment of the join,
     * which is exactly the peak a phone cannot afford. A Blob is assembled from parts perfectly
     * well, so the join never happens.
     */
    const savedAt = new Date().toISOString();
    const parts = teamRankingsJsonParts(backup, savedAt);
    if (parts.length === 0) {
      showToast("Nothing to back up yet.", { tone: "error" });
      return;
    }
    const blob = new Blob(parts, { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Team_Rankings_Backup_${savedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`Backup downloaded (${formatBytes(blob.size)}).`, { tone: "success" });
    noteBackupTaken("pool");
    setPoolBackupAt(lastBackupTakenAt("pool"));
  };

  /**
   * Empties Team Rankings: every age group, team and game, plus the cursor of any interrupted
   * GameChanger pull and the weekly refresh log. The counts go into the confirmation because the
   * number of games about to disappear is the whole of what makes this decision easy or hard.
   *
   * Afterwards the view is put back to its first-visit state by hand rather than by reloading the
   * page — a reload would throw away a League Standings edit the user has not saved yet, and
   * everything here that came out of storage is named right below.
   */
  /*
   * What each baseball year holds, for the card that offers to freeze one.
   *
   * One pass over the stored games rather than a filter per year: on a nationwide pool there are
   * three hundred thousand of them and half a dozen years, and the card re-renders on every pick.
   * The stored games, because those are the ones a delete can take — the league's fixtures are
   * derived and go from the archive's point of view by the page going, not by being deleted.
   */
  const archivableSummaries = useMemo(
    () => summariseYears(ageGroups, storedYears, archives),
    [ageGroups, storedYears, archives]
  );

  /**
   * Freezes a baseball year's tables and deletes the games behind them.
   *
   * The tables are built from the merged pool, so what is frozen is what was on screen — the
   * league's own fixtures included, which is why the confirmation says they go too. What is
   * deleted is the stored pool only, because derived fixtures were never stored.
   *
   * Order matters and is the reason this is not two calls: the archive is written and confirmed
   * first, and the games are deleted only if it landed. A half-written archive with the games
   * already gone is the one outcome there is no coming back from.
   */
  const archiveYear = async (year: number) => {
    // Every year: the one being archived need not be the one on screen.
    const everyGame = loadScoutGames();
    const stored = { ageGroups, teams: scoutTeams, games: everyGame };
    // As the boards show it: League Standings' games in, the clubs taken off as made up out.
    const shown = archivedFrom(allKnown, stored);
    /*
     * Whether the pool was tidy before this, checked before anything changes.
     *
     * What survives an archive is a subset of what was there — whole pages removed, with their
     * games and the clubs the year was all there was of — and taking things away leaves a tidy
     * nothing new to do. So a tidy pool stays tidy, and stamping the smaller one saves a full
     * worker pass over three hundred thousand games for nothing. An untidy pool leaves the stamp alone, so the tidy still comes.
     */
    const wasTidy = loadTidyStamp() === poolSignature(stored);
    const done = archiveSquadYear(year, shown, stored, new Date().toISOString());

    const preview = archivePreviewOf(done);
    if (!archivesAnything(preview)) {
      showToast(nothingUnder(year), { tone: "error" });
      return;
    }

    const confirmed = await requestConfirmation(archiveConfirmation(year, preview));
    if (!confirmed) return;

    setArchiving(true);
    try {
      const kept = await saveArchivedSeasons(done.seasons);
      if (!kept) {
        showToast("Could not write the archive, so nothing was deleted. The pool is unchanged.", {
          tone: "error",
        });
        return;
      }
      // Only now: the tables are on disk, so the games they replace can go. The year empties
      // before its pages go, as storage needs (`writePool`).
      const deleted = runCommand(changeBetween(poolParts(stored), poolParts(done.state)), {
        explains: true,
      });
      if (!deleted.ok) {
        showToast("The tables are kept under Archive, but the year's games could not be deleted.", {
          tone: "error",
        });
        setArchives(loadArchiveIndex());
        return;
      }
      if (wasTidy) saveTidyStamp(poolSignature(done.state));
      setArchives(loadArchiveIndex());
      pickPage("");
      closeClub();
      setReportTeamId("");
      showToast(archivedSaid(year, { ...preview, tables: kept.map(archiveTableOf) }));
      onDataChange?.();
    } finally {
      setArchiving(false);
    }
  };

  /**
   * Deletes a whole squad year with nothing kept: its pages, their stored games, the clubs no
   * other year holds, the GameChanger ids filed under it, and its archived tables.
   *
   * The same writes as `archiveYear` in the same order — games while the pages that name them
   * are still stored, then the pages — without the archive in front of them. The archived tables
   * go last, one at a time: the pool is the part that matters, and a table that fails to go is
   * still listed under Archive, where it can be seen.
   */
  const deleteYear = async (year: number) => {
    const everyGame = loadScoutGames();
    const stored = { ageGroups, teams: scoutTeams, games: everyGame };
    // Whether the pool was tidy before this, for the reason `archiveYear` gives.
    const wasTidy = loadTidyStamp() === poolSignature(stored);
    const done = deleteSquadYear(year, stored, archives);

    const preview = deletePreviewOf(done);
    if (!deletesAnything(preview)) {
      showToast(nothingUnder(year), { tone: "error" });
      return;
    }

    const confirmed = await requestConfirmation(deleteConfirmation(year, preview));
    if (!confirmed) return;

    setArchiving(true);
    try {
      // The year empties before its pages go, as storage needs (`writePool`).
      if (!runCommand(changeBetween(poolParts(stored), poolParts(done.state))).ok) return;
      if (wasTidy) saveTidyStamp(poolSignature(done.state));
      let tablesLeft = 0;
      for (const id of done.archiveIds) {
        if (!(await forgetArchivedSeason(id))) tablesLeft += 1;
      }
      setArchives(loadArchiveIndex());
      pickPage("");
      closeClub();
      setReportTeamId("");
      showToast(
        `${year} deleted.` +
          (tablesLeft > 0
            ? ` ${tablesLeft} archived table${tablesLeft === 1 ? "" : "s"} could not be removed and ${tablesLeft === 1 ? "is" : "are"} still under Archive.`
            : ""),
        tablesLeft > 0 ? { tone: "error" } : { tone: "success" }
      );
      onDataChange?.();
    } finally {
      setArchiving(false);
    }
  };

  const resetEverything = async () => {
    const going = readTeamRankingsBackup();
    const confirmed = await requestConfirmation({
      title: "Delete everything in the app?",
      message: `${summarizeTeamRankingsBackup(going)}

All of it goes, and so does everything else the app keeps in this browser: every League Standings season with its schedules and scores, the clubs and games you threw out, the ages you named by hand, the teams waiting on an age, the Organizations file and your settings. The app then starts again as if it had never been opened.

This cannot be undone. Cancel and download the backups first if there is any chance you will want any of it again.`,
      confirmLabel: "Delete everything",
    });
    if (!confirmed) return;

    const outcome = await resetApp();
    if (outcome !== "done") {
      showToast(
        outcome === "unreachable"
          ? "Could not reset the app — this browser cannot reach where the pool is kept, so nothing was deleted."
          : "The reset did not finish — this browser would not delete all of the pool. League Standings and your settings were left alone; try again.",
        { tone: "error" }
      );
      return;
    }
    // Every view holds copies of what it read; only a fresh start is sure to hold none.
    reloadApp();
  };

  return { archivableSummaries, archiveYear, deleteYear, downloadPoolBackup, resetEverything };
}
