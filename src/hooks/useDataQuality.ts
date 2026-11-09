import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { TabNavItem } from "../components/TabNav";
import { withFinal } from "../lib/impactRecap";
import {
  auditLeague,
  copiesToDelete,
  type Finding,
  type FindingRepair,
  type FindingSeverity,
  type FindingTarget,
  isDismissed,
  repairIsDestructive,
  repairPreview,
} from "../lib/leagueFindings";
import { readPutAside, writePutAside } from "../lib/preferences";
import type { SeasonStore } from "../lib/seasonStore";
import type { LeagueScoutBridge } from "../lib/teamRankings/leagueBridge";
import type { ActiveShareView, GameLog, Matchup, Settings, TeamBase } from "../lib/types";
import { isFinal } from "../lib/util";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";
import type { UndoSnapshotControls } from "./useUndoSnapshot";

/** What `useDataQuality` reads of App, each by the name App gives it. */
export type DataQualityInputs = {
  activeSeasonId: string;
  activeSeasonKey: string;
  activeView: ActiveShareView;
  captureUndo: UndoSnapshotControls["capture"];
  deferredLogs: Record<string, GameLog>;
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  openTeamData: (teamId: string) => void;
  /** Shows the recap of the games given, made final just now, as a final marked on the Schedule. */
  recapFinals: (gameIds: readonly string[]) => void;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  restoreUndo: UndoSnapshotControls["restore"];
  scoutBridge: LeagueScoutBridge;
  seasonSettings: Settings;
  seasonStore: SeasonStore;
  setActiveView: Dispatch<SetStateAction<ActiveShareView>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setScoreboardTeamFilter: Dispatch<SetStateAction<string>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
  settings: Settings;
  showToast: ReturnType<typeof useToast>["show"];
  teams: TeamBase[];
  today: Date;
};

/**
 * Data Quality (2.3): every finding on the season, the ones put aside on this device and the ones
 * still open, the tab row's mark for what needs attention, the link from a finding to the game,
 * team or setting it is about, and a finding's repair, previewed and then made as one undo step.
 *
 * App.tsx worked all of this out under "Data quality". It moved here whole, with the state it
 * keeps (what is put aside, and what a link is still looking for to focus), and is called where it
 * was, so its memos and its one effect keep their place among App's.
 */
export function useDataQuality({
  activeSeasonId,
  activeSeasonKey,
  activeView,
  captureUndo,
  deferredLogs,
  logs,
  matchups,
  openTeamData,
  recapFinals,
  requestConfirmation,
  restoreUndo,
  scoutBridge,
  seasonSettings,
  seasonStore,
  setActiveView,
  setLogs,
  setMatchups,
  setScoreboardTeamFilter,
  setSettings,
  settings,
  showToast,
  teams,
  today,
}: DataQualityInputs) {
  /*
   * Every finding on the season. Read from the scores as they stand, since a game scored and not
   * marked final is one of the things it looks for, and deferred like them; cheap (one pass over
   * the games), so it is kept whatever tab is open, for the Dashboard's count.
   */
  const findings = useMemo(
    () =>
      auditLeague({
        teams,
        matchups,
        logs: deferredLogs,
        // The regular season's: a setting the schedule never met holds nothing back once the
        // bracket has begun, so its finding goes then (`regularSeasonSettings`).
        settings: seasonSettings,
        links: scoutBridge.rows,
        today,
      }),
    [teams, matchups, deferredLogs, seasonSettings, scoutBridge.rows, today]
  );
  /* The findings put aside on this device, held by season as the team followed is. */
  const [putAsideHeld, setPutAsideHeld] = useState(() => ({
    season: activeSeasonKey,
    entries: readPutAside(activeSeasonId),
  }));
  if (putAsideHeld.season !== activeSeasonKey) {
    // Read afresh for each season opened, never kept from a visit before, as the team followed is
    // below: the id may have been given to another season since, by a deletion or a restore.
    setPutAsideHeld({ season: activeSeasonKey, entries: readPutAside(activeSeasonId) });
  }
  const putAsideEntries =
    putAsideHeld.season === activeSeasonKey ? putAsideHeld.entries : readPutAside(activeSeasonId);
  const openFindings = useMemo(
    () => findings.filter((finding) => !isDismissed(finding, putAsideEntries)),
    [findings, putAsideEntries]
  );
  /*
   * What the tab row marks (2.4): Data Quality with what needs attention, which also brings it out
   * of More on a phone. A setting at fault (the cut line, games per team, a link) is one of those
   * findings, so it is counted there rather than marked twice.
   */
  const viewBadges = useMemo((): Partial<
    Record<ActiveShareView, TabNavItem<ActiveShareView>["badge"]>
  > => {
    const attention = openFindings.filter((finding) => finding.severity === "attention").length;
    return {
      ...(attention
        ? {
            quality: {
              count: attention,
              describe: `${attention} ${attention === 1 ? "needs" : "need"} attention`,
              urgent: true,
            },
          }
        : {}),
    };
  }, [openFindings]);
  const asideFindings = useMemo(
    () => findings.filter((finding) => isDismissed(finding, putAsideEntries)),
    [findings, putAsideEntries]
  );
  const setPutAside = useCallback(
    (entries: Record<string, FindingSeverity>) => {
      writePutAside(activeSeasonId, entries);
      setPutAsideHeld({ season: activeSeasonKey, entries });
    },
    [activeSeasonId, activeSeasonKey]
  );
  const putFindingAside = useCallback(
    (finding: Finding) =>
      setPutAside({ ...putAsideEntries, [finding.fingerprint]: finding.severity }),
    [putAsideEntries, setPutAside]
  );
  const bringFindingBack = useCallback(
    (finding: Finding) =>
      setPutAside(
        Object.fromEntries(
          Object.entries(putAsideEntries).filter(([print]) => print !== finding.fingerprint)
        )
      ),
    [putAsideEntries, setPutAside]
  );

  /*
   * The element a finding's link goes to, once its tab has drawn it: a game's card, or a setting
   * marked `data-setting`. Looked for a frame at a time, since the tab may still be loading.
   */
  const [focusAfterOpen, setFocusAfterOpen] = useState<
    { gameId: string } | { setting: string } | null
  >(null);
  useEffect(() => {
    if (!focusAfterOpen) return;
    let frames = 0;
    let frame = 0;
    const look = () => {
      const found =
        "gameId" in focusAfterOpen
          ? document.getElementById(`game-card-${focusAfterOpen.gameId}`)
          : document.querySelector<HTMLElement>(`[data-setting="${focusAfterOpen.setting}"]`);
      if (found) {
        found.scrollIntoView?.({ block: "center" });
        const control = found.matches("input, select, button")
          ? found
          : found.querySelector<HTMLElement>("input, select, button");
        (control ?? found).focus({ preventScroll: true });
        setFocusAfterOpen(null);
        return;
      }
      frames += 1;
      if (frames < 180) frame = requestAnimationFrame(look);
      else setFocusAfterOpen(null);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [focusAfterOpen, activeView]);

  const openFindingTarget = useCallback(
    (target: FindingTarget) => {
      if (target.kind === "team") {
        openTeamData(target.id);
      } else if (target.kind === "game") {
        setScoreboardTeamFilter("ALL");
        setActiveView("games");
        setFocusAfterOpen({ gameId: target.id });
      } else {
        setActiveView("settings");
        setFocusAfterOpen({ setting: target.id });
      }
    },
    // App's own state setters, which never change: named here only because, handed in, the hooks
    // lint can no longer see that they are.
    [openTeamData, setActiveView, setScoreboardTeamFilter]
  );

  /*
   * A finding's repair, made: asked first when it deletes, taken as one undo step, and reported by
   * what it actually changed, which is worked out again from the season as it is now rather than
   * as the finding saw it, so a game given anything since is never deleted, nor the last copy of
   * one (`copiesToDelete`), and one marked final since is not counted.
   */
  const repairFinding = async (finding: Finding) => {
    const repair = finding.repair;
    if (!repair) return;
    const lockedBecause = seasonStore.locked();
    if (lockedBecause) {
      showToast(lockedBecause, { tone: "error" });
      return;
    }
    const lines = repairPreview(repair, { teams, matchups, logs });
    if (repairIsDestructive(repair)) {
      const confirmed = await requestConfirmation({
        title: lines.length === 1 ? "Delete this game?" : `Delete these ${lines.length} games?`,
        message: `${lines.join(" ")} An undo snapshot will be saved.`,
        confirmLabel: lines.length === 1 ? "Delete game" : "Delete games",
      });
      if (!confirmed) return;
    }
    const now = seasonStore.get().season;
    const scoredOpen = (id: string) => {
      const log = now.logs[id];
      return !isFinal(log) && Boolean(log?.awayRuns.trim()) && Boolean(log?.homeRuns.trim());
    };
    const undo = { tone: "undo" as const, actionLabel: "Undo", onAction: restoreUndo };
    if (repair.kind === "removeGames") {
      const ids = new Set(copiesToDelete(repair.gameIds, now));
      if (!ids.size) {
        showToast("Nothing to delete: those games have changed since.", { tone: "error" });
        return;
      }
      captureUndo(`Deleted ${ids.size === 1 ? "a duplicate game" : `${ids.size} duplicate games`}`);
      setMatchups((prev) => prev.filter((game) => !ids.has(game.id)));
      setLogs((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
      showToast(ids.size === 1 ? "Deleted 1 game." : `Deleted ${ids.size} games.`, undo);
    } else if (repair.kind === "markFinal") {
      const ids = repair.gameIds.filter(scoredOpen);
      if (!ids.length) {
        showToast("Nothing to mark: those games have changed since.", { tone: "error" });
        return;
      }
      captureUndo(`Marked ${ids.length === 1 ? "a game" : `${ids.length} games`} final`);
      setLogs((prev) =>
        ids.reduce((next, id) => withFinal(next, id, true, settings.defaultGameInnings), prev)
      );
      // Each was open until now, so each is a final made, and recapped as one marked on the
      // Schedule is.
      recapFinals(ids);
      showToast(
        ids.length === 1 ? "Marked 1 game final." : `Marked ${ids.length} games final.`,
        undo
      );
    } else {
      // A setting is all this repair changes, so the step must carry the settings to put it back.
      captureUndo(`Games per team ${repair.from} to ${repair.to}`, { withSettings: true });
      setSettings((prev) => ({ ...prev, regularSeasonGamesPerTeam: repair.to }));
      showToast(`Games per team is now ${repair.to}.`, undo);
    }
  };
  const previewRepair = useCallback(
    (repair: FindingRepair) => repairPreview(repair, { teams, matchups, logs }),
    [teams, matchups, logs]
  );

  return {
    asideFindings,
    bringFindingBack,
    openFindingTarget,
    openFindings,
    previewRepair,
    putFindingAside,
    repairFinding,
    viewBadges,
  };
}
