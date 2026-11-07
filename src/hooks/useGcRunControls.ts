import { type Dispatch, type RefObject, type SetStateAction, useEffect, useState } from "react";
import { downloadCsv, fileDay } from "../lib/download";
import type { GcPairingComparison, GcSeasonPairing } from "../lib/gameChangerImport";
import type { GcPullProgress } from "../lib/gameChangerPull";
import { apartKey } from "../lib/keptApart";
import { runPoolCommand } from "../lib/live/runPoolCommand";
import { forceReleasePool, lastPullLog, livePullTracker, stopLivePull } from "../lib/pullSession";
import { type PullRunLog, pullSummaryCsv, pullTeamsCsv } from "../lib/pullTracker";
import { loadPullLog } from "../lib/teamRankingsStorage";
import type { useToast } from "./useToast";

/**
 * Around a GameChanger run: its record, downloadable while it runs or once it is done, read again
 * when the button is pressed so a run still writing is not cut short; the pool taken back from a
 * tidy that holds it; the pairings the search matches and how many are drawn; and two clubs said
 * to be two, for good (`keptApart.ts`).
 *
 * GameChangerImportPanel.tsx worked these out among its other values. They moved here whole and are
 * called where they were, so their state and memos keep their place among the panel's.
 */
export type GcRunControlsInputs = {
  progressRef: RefObject<GcPullProgress | null>;
  setApproved: Dispatch<SetStateAction<Set<string>>>;
  setOpenPair: Dispatch<
    SetStateAction<{ key: string; comparison: GcPairingComparison | null } | null>
  >;
  setPairings: Dispatch<SetStateAction<GcSeasonPairing[]>>;
  showToast: ReturnType<typeof useToast>["show"];
};

export function useGcRunControls({
  progressRef,
  setApproved,
  setOpenPair,
  setPairings,
  showToast,
}: GcRunControlsInputs) {
  /**
   * The record storage kept of the last run, read once this panel is open.
   *
   * On demand rather than with the pool: a row per team in a nationwide pull is tens of thousands
   * of rows, and every page was holding them for the sake of the download buttons below. It is
   * asked for here, when the panel that has those buttons mounts, and nowhere else.
   */
  const [storedLog, setStoredLog] = useState<PullRunLog | null>(null);
  useEffect(() => {
    let wanted = true;
    void loadPullLog().then((log) => {
      if (wanted) setStoredLog(log);
    });
    return () => {
      wanted = false;
    };
  }, []);

  /**
   * The run's own record, live or the last one finished, falling back to what storage kept.
   *
   * Three sources because the record has to be downloadable in all three situations: while the run
   * is going, after it has ended in this panel, and after a reload that lost every component but
   * not the file.
   */
  const runLog = (): PullRunLog | null => livePullTracker()?.log() ?? lastPullLog() ?? storedLog;
  /*
   * Read again when the button is pressed rather than used from the render that drew it. A run
   * still going is writing to this the whole time, and a file built from the copy that happened to
   * be in hand when the button was drawn would be missing everything since.
   */
  const tracked = runLog();
  const trackedIds = tracked?.ids.length ?? 0;

  const downloadRunSummary = () => {
    const log = runLog();
    if (!log) return;
    downloadCsv(
      `gamechanger-run-${fileDay()}-summary.csv`,
      pullSummaryCsv(log, progressRef.current?.settled ?? [])
    );
  };

  const downloadRunTeams = () => {
    const log = runLog();
    if (!log) return;
    downloadCsv(
      `gamechanger-run-${fileDay()}-teams.csv`,
      pullTeamsCsv(log, progressRef.current?.settled ?? [])
    );
  };

  /**
   * Takes the pool back from whatever holds it.
   *
   * Only offered for a tidy: a pull is stopped through its own session so it can shut down
   * cleanly, but a tidy has no cursor to keep and re-runs by itself the next time the app opens on
   * a pool it does not recognise — so there is nothing to lose by cutting it short, and a person
   * who wants to start an hour of fetching should not have to wait on housekeeping.
   */
  const releasePool = () => {
    forceReleasePool();
    showToast("Stopped tidying. The pool will be tidied again after the pull.", { tone: "info" });
  };

  const stop = () => {
    // Through the session, and only through it: the panel used to keep a second copy of the same
    // controller, which said nothing the session did not and went stale the moment a run ended.
    stopLivePull();
    showToast("Stopping after the requests already in flight.", { tone: "info" });
  };

  const pairKey = (pairing: GcSeasonPairing) => `${pairing.fromTeamId}>${pairing.toTeamId}`;
  /**
   * The pairings the search matches, and how many of them are drawn.
   *
   * A nationwide pull offers four hundred of these, and the list used to stop at a hundred and say
   * the rest could be done from each team's own panel — three hundred panels, one at a time, for a
   * decision that is the same decision every time. Worse, an unpaired squad is not a cosmetic
   * problem: a club whose fall and spring ids were never joined is two teams with no game between
   * them, and a rating cannot carry across a winter it cannot see.
   *
   * So all of them are reachable. The first hundred are drawn for speed, "Show all" draws the
   * rest, and the search narrows by name, state or season for when the answer is only wanted for
   * some of them.
   */
  /**
   * Says the two are two clubs, for good. Recorded against the GameChanger ids, which is what the
   * next pull brings back unchanged; the same pair is never offered here or on the pool health
   * card again. See `keptApart.ts`.
   */
  const keepApart = (pairing: GcSeasonPairing) => {
    const run = runPoolCommand({
      kind: "answers",
      list: "keptApart",
      add: [apartKey(pairing.fromGcId, pairing.toGcId)],
      remove: [],
    });
    if (!run.ok) return;
    const key = pairKey(pairing);
    setPairings((current) => current.filter((entry) => pairKey(entry) !== key));
    setApproved((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setOpenPair((current) => (current?.key === key ? null : current));
  };

  return {
    downloadRunSummary,
    downloadRunTeams,
    keepApart,
    pairKey,
    releasePool,
    stop,
    tracked,
    trackedIds,
  };
}
