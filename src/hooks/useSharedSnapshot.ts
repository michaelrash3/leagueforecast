import { type Dispatch, type SetStateAction, useEffect, useLayoutEffect, useRef } from "react";
import type { SeasonStore } from "../lib/seasonStore";
import type { SharedSnapshot, ShareUiState } from "../lib/share";
import type { ActiveShareView, GameLog, Matchup, Settings, TeamBase } from "../lib/types";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";
import type { UndoSnapshotControls } from "./useUndoSnapshot";

/** What `useSharedSnapshot` reads of App, each by the name App gives it. */
export type SharedSnapshotInputs = {
  captureUndo: UndoSnapshotControls["capture"];
  clearSharedSnapshot: () => void;
  leagueEditable: boolean;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  restoreUndo: UndoSnapshotControls["restore"];
  seasonStore: SeasonStore;
  setActiveView: Dispatch<SetStateAction<ActiveShareView>>;
  setBracketLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setSelectedTeamId: Dispatch<SetStateAction<string | null>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
  setTeams: Dispatch<SetStateAction<TeamBase[]>>;
  sharedSnapshot: SharedSnapshot | null;
  sharedUiState: ShareUiState;
  showToast: ReturnType<typeof useToast>["show"];
};

/**
 * A season shared by link (`share.ts`): asked about once the season here may be written, loaded in
 * place of this one as a single step to undo, with the view and the team the link was made on, and
 * then cleared from the address whatever the answer. A link opened while the season is read-only
 * is kept, and asked about again once it is not.
 *
 * App.tsx did this under "Share + URL snapshot". It moved here whole and is called where it was, so
 * its two effects keep their place among App's.
 */
export function useSharedSnapshot({
  captureUndo,
  clearSharedSnapshot,
  leagueEditable,
  requestConfirmation,
  restoreUndo,
  seasonStore,
  setActiveView,
  setBracketLogs,
  setLogs,
  setMatchups,
  setSelectedTeamId,
  setSettings,
  setTeams,
  sharedSnapshot,
  sharedUiState,
  showToast,
}: SharedSnapshotInputs) {
  const sharedHandledRef = useRef(false);
  /*
   * The Undo on the toast below is pressed long after this effect has run, so it has to call
   * whatever `restoreUndo` is at that moment rather than the one that existed when the snapshot
   * loaded. The ref is read inside the handler for that reason; the effect itself runs once per
   * snapshot and must not re-run when an unrelated callback is rebuilt. It is brought up to date
   * as each render commits, not during the render, which React does not allow.
   */
  const restoreUndoRef = useRef(restoreUndo);
  useLayoutEffect(() => {
    restoreUndoRef.current = restoreUndo;
  });

  useEffect(() => {
    // Asked once the season may be written: League kept live opens read-only until the cloud's
    // version is in, and a link loaded then would be refused, and lost.
    if (!sharedSnapshot || sharedHandledRef.current || !leagueEditable) return;
    sharedHandledRef.current = true;
    requestConfirmation({
      title: "Load shared season snapshot?",
      message: `${sharedSnapshot.teams.length} teams · ${sharedSnapshot.matchups.length} games found in this URL.\n\nReplace your current local data? Cancel keeps your data; the URL snapshot will still be cleared.`,
      confirmLabel: "Load snapshot",
    }).then((ok) => {
      const why = ok ? seasonStore.locked() : null;
      if (why) {
        // Gone read-only while the question was up: the link is kept, and asked about again
        // once the season may be written.
        sharedHandledRef.current = false;
        showToast(why, { tone: "error" });
        return;
      }
      if (ok) {
        captureUndo("Load shared snapshot", { withSettings: true });
        setTeams(sharedSnapshot.teams);
        setMatchups(sharedSnapshot.matchups);
        setLogs(sharedSnapshot.logs);
        // A link carries no bracket, and the one here was scored between the teams just replaced.
        setBracketLogs({});
        setSettings(sharedSnapshot.settings);
        if (sharedUiState.view) setActiveView(sharedUiState.view);
        if (sharedUiState.teamId) setSelectedTeamId(sharedUiState.teamId);
        showToast("Loaded shared snapshot and view state.", {
          tone: "undo",
          actionLabel: "Undo",
          onAction: () => restoreUndoRef.current(),
        });
      }
      clearSharedSnapshot();
    });
    /*
     * The callbacks are stable, so listing them changes nothing about when this runs — and
     * `sharedHandledRef` makes a second run a no-op regardless. The point of listing them is that
     * the next person to add a closure here gets told, rather than inheriting a comment that was
     * true when it was written. `leagueEditable` is the one that does change it: the question is
     * put once the season may be written.
     */
  }, [
    sharedSnapshot,
    sharedUiState,
    leagueEditable,
    seasonStore,
    captureUndo,
    clearSharedSnapshot,
    requestConfirmation,
    showToast,
    setTeams,
    setMatchups,
    setLogs,
    setBracketLogs,
    setSettings,
    setActiveView,
    setSelectedTeamId,
  ]);
}
