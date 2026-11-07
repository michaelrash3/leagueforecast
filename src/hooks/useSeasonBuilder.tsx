import { type Dispatch, type SetStateAction, Suspense, useCallback } from "react";
import type { TeamListControls } from "../components/league/GamesView";
import { schedulePasteView } from "../components/league/leagueViews";
import { buildDemoSeason } from "../lib/demoSeason";
import type { PastedSeason } from "../lib/leaguePaste";
import type { StartPage } from "../lib/leagueStart";
import { placeLeagueSeason } from "../lib/live/leagueAsk";
import { poolFilled } from "../lib/poolFill";
import {
  builderTeamNames,
  buildRoundRobin,
  type BuiltSeason,
  roundRobinCsv,
  roundRobinFileName,
  roundRobinFor,
} from "../lib/roundRobin";
import type { SeasonStore } from "../lib/seasonStore";
import { nameTaken, teamListLocked, teamsToAdd } from "../lib/teamList";
import type { LeagueScoutBridge } from "../lib/teamRankings/leagueBridge";
import { createAgeGroupId } from "../lib/teamRankings/seasons";
import type {
  ActiveShareView,
  GameLog,
  LastImpact,
  Matchup,
  Settings,
  TeamBase,
} from "../lib/types";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";
import type { UndoSnapshotControls } from "./useUndoSnapshot";

/**
 * Reading a league site's pasted schedule into a season with no games, and its review: fetched
 * only once asked for, since the first download has no room for them (`bundleBudget.mjs`).
 */
const LeagueSchedulePaste = schedulePasteView.View;

/** What `useSeasonBuilder` reads of App, each by the name App gives it. */
export type SeasonBuilderInputs = {
  activeSeasonId: string;
  captureUndo: UndoSnapshotControls["capture"];
  closeTeamData: () => void;
  matchups: Matchup[];
  rankingsLive: boolean;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  restoreUndo: UndoSnapshotControls["restore"];
  scoutBridge: LeagueScoutBridge;
  seasonBuilderText: string;
  seasonStore: SeasonStore;
  setActiveView: Dispatch<SetStateAction<ActiveShareView>>;
  setBracketLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setLastImpact: Dispatch<SetStateAction<LastImpact | null>>;
  setLogs: Dispatch<SetStateAction<Record<string, GameLog>>>;
  setMatchups: Dispatch<SetStateAction<Matchup[]>>;
  setScoreboardTeamFilter: Dispatch<SetStateAction<string>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
  setTeams: Dispatch<SetStateAction<TeamBase[]>>;
  settings: Settings;
  showToast: ReturnType<typeof useToast>["show"];
  teams: TeamBase[];
};

/**
 * The ways a League Standings season is started: the demo season; the team list, saved, renamed,
 * locked and made into a round robin, or downloaded as one; a season started from its clubs on
 * Team Rankings or from a GameChanger organization's schedule, and put on its page there; and a
 * league site's schedule, pasted in and looked over in its panel. Each asks first where it would
 * replace anything, and each is one step to undo.
 *
 * App.tsx did all of this under "Season builder". It moved here whole and is called where it was;
 * none of it keeps state or runs an effect, so only the demo season's loader is remembered from
 * one render to the next, as it was.
 */
export function useSeasonBuilder({
  activeSeasonId,
  captureUndo,
  closeTeamData,
  matchups,
  rankingsLive,
  requestConfirmation,
  restoreUndo,
  scoutBridge,
  seasonBuilderText,
  seasonStore,
  setActiveView,
  setBracketLogs,
  setLastImpact,
  setLogs,
  setMatchups,
  setScoreboardTeamFilter,
  setSettings,
  setTeams,
  settings,
  showToast,
  teams,
}: SeasonBuilderInputs) {
  const loadDemoSeason = useCallback(async () => {
    // Reached from the command palette as well as the page: refused before it asks, or takes an
    // undo step over the one there, while the season may not be written.
    const lockedBecause = seasonStore.locked();
    if (lockedBecause) {
      showToast(lockedBecause, { tone: "error" });
      return;
    }
    // Nothing to overwrite on an empty season, and the first thing a new user
    // is invited to do should not open with a warning about losing data.
    if (teams.length > 0 || matchups.length > 0) {
      const confirmed = await requestConfirmation({
        title: "Load demo season?",
        message:
          "This replaces the current teams, games, and scores with a sample season and saves an undo snapshot.",
        confirmLabel: "Load demo",
      });
      if (!confirmed) return;
    }
    const demo = buildDemoSeason();
    captureUndo("Load demo season", { withSettings: true });
    setTeams(demo.teams);
    setMatchups(demo.matchups);
    setLogs(demo.logs);
    setBracketLogs({});
    setSettings(demo.settings);
    setActiveView("standings");
    closeTeamData();
    showToast("Loaded demo season.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  }, [
    teams,
    matchups,
    requestConfirmation,
    captureUndo,
    closeTeamData,
    showToast,
    restoreUndo,
    seasonStore,
    setTeams,
    setMatchups,
    setLogs,
    setBracketLogs,
    setSettings,
    // App's own state setter, which never changes: named only because, handed in, the hooks lint
    // can no longer see that it is.
    setActiveView,
  ]);

  /*
   * The schedule itself, the score sheet and the file name are all in `roundRobin.ts`: none of
   * them needs a browser, and a round robin's own correctness — every pair exactly once, in a
   * stable order — is the sort of thing to check by reading it rather than by clicking through it.
   * What is left here is what only a component can do: ask, adopt, and hand the browser a file.
   */
  const builtFromList = () => {
    const built = buildRoundRobin(builderTeamNames(seasonBuilderText), settings.defaultGameInnings);
    // The message belongs here rather than in the builder, which has no way to say anything.
    if (!built) showToast("Enter at least two teams to build a schedule.", { tone: "error" });
    return built;
  };

  /*
   * The team list before the schedule: saved as typed, added to on a later visit, renamed or taken
   * off while open, then locked; the schedule is made only from a locked list, and the list opens
   * again only while no game exists (`teamListLocked`). Each is an ordinary season edit, as Add
   * Game is, so a kept-live season sends it as it sends any other.
   */
  const listLocked = teamListLocked(settings, matchups, teams);
  const refusedEdit = () => {
    const lockedBecause = seasonStore.locked();
    if (lockedBecause) showToast(lockedBecause, { tone: "error" });
    return lockedBecause !== null;
  };
  const saveTeamList = (names: string[]): boolean => {
    if (refusedEdit()) return false;
    if (listLocked) {
      showToast("The team list is locked. Unlock it to add teams.", { tone: "error" });
      return false;
    }
    const added = teamsToAdd(teams, names);
    if (added.length === 0) {
      showToast(
        names.length ? "Those teams are already on the list." : "Type a team name to save.",
        { tone: "error" }
      );
      return false;
    }
    captureUndo("Add teams");
    setTeams((prev) => [...prev, ...added]);
    // A list started here stays open until it is locked.
    if (settings.teamsLocked !== false) setSettings((prev) => ({ ...prev, teamsLocked: false }));
    showToast(`Saved ${added.length} team${added.length === 1 ? "" : "s"}.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
    return true;
  };
  const teamListControls: TeamListControls = {
    locked: listLocked,
    onAdd: saveTeamList,
    onRename: (teamId, name) => {
      if (refusedEdit() || listLocked) return false;
      if (nameTaken(teams, name, teamId)) {
        showToast(`${name} is already on the list.`, { tone: "error" });
        return false;
      }
      captureUndo("Rename team");
      setTeams((prev) => prev.map((team) => (team.id === teamId ? { ...team, name } : team)));
      return true;
    },
    onRemove: (teamId) => {
      if (refusedEdit() || listLocked) return;
      captureUndo("Remove team");
      setTeams((prev) => prev.filter((team) => team.id !== teamId));
      showToast("Team removed.", { tone: "undo", actionLabel: "Undo", onAction: restoreUndo });
    },
    onLock: () => {
      if (refusedEdit()) return;
      setSettings((prev) => ({ ...prev, teamsLocked: true }));
      showToast("Team list locked. Make the schedule next.");
    },
    onUnlock: () => {
      void (async () => {
        if (refusedEdit() || matchups.length > 0) return;
        const confirmed = await requestConfirmation({
          title: "Unlock the team list?",
          message: "Teams can be added, renamed or removed again until the first game is made.",
          confirmLabel: "Unlock",
        });
        if (!confirmed) return;
        setSettings((prev) => ({ ...prev, teamsLocked: false }));
      })();
    },
    onRoundRobin: () => {
      if (refusedEdit()) return;
      const built = roundRobinFor(teams, settings.defaultGameInnings);
      if (!built) {
        showToast("A round robin needs two teams at least.", { tone: "error" });
        return;
      }
      captureUndo("Build a round robin");
      setMatchups(built.matchups);
      setLogs(built.logs);
      // As the one-step builder did: every game made is shown, whatever team the Schedule was
      // filtered to (a filter can outlive the season it was set on), and no older recap stands.
      setBracketLogs({});
      setLastImpact(null);
      closeTeamData();
      setScoreboardTeamFilter("ALL");
      showToast(`Made a ${built.matchups.length}-game schedule.`, {
        tone: "undo",
        actionLabel: "Undo",
        onAction: restoreUndo,
      });
    },
  };

  /*
   * A season started from its clubs on Team Rankings (3.7): the teams, each linked to its club, and
   * the games kept in the review, as one step to undo like the other ways to start one. Then the
   * season is put on the page it was started from, as Setup's League seasons card puts one
   * (`season.assign`): in the cloud for a member, on this device's pool otherwise. Undo takes back
   * the teams and games; the season stays on its page, where an empty season changes nothing.
   *
   * A season started from a GameChanger organization's own schedule (`StartFromGcOrg`) is made the
   * same way, and placed on the page its teams' age and season name, where both could be read; where
   * not, it is made without being placed, and Setup's card places it.
   */
  const startSeasonFromClubs = async (
    made: BuiltSeason,
    page: StartPage | undefined,
    from: "Team Rankings" | "GameChanger" = "Team Rankings"
  ) => {
    const lockedBecause = seasonStore.locked();
    if (lockedBecause) {
      showToast(lockedBecause, { tone: "error" });
      return;
    }
    if (teams.length > 0 || matchups.length > 0) {
      const confirmed = await requestConfirmation({
        title: `Start this season from ${from}?`,
        message: `${made.teams.length} teams · ${made.matchups.length} games.\n\nThis replaces current season data and saves an undo snapshot.`,
        confirmLabel: "Start season",
      });
      if (!confirmed) return;
    }
    const seasonId = activeSeasonId;
    captureUndo(
      from === "Team Rankings"
        ? "Start season from Team Rankings clubs"
        : "Start season from a GameChanger organization"
    );
    setTeams(made.teams);
    setMatchups(made.matchups);
    setLogs(made.logs);
    setBracketLogs({});
    setLastImpact(null);
    closeTeamData();
    setScoreboardTeamFilter("ALL");
    setActiveView("standings");
    const games = `${made.matchups.length} game${made.matchups.length === 1 ? "" : "s"}`;
    if (!page) {
      showToast(
        `Started the season: ${made.teams.length} teams and ${games}. Its age or season could not be read, so put it on its Team Rankings page in Setup.`,
        { tone: "undo", actionLabel: "Undo", onAction: restoreUndo }
      );
      return;
    }
    const command = {
      kind: "season.assign" as const,
      seasonId,
      season: { ageLevel: page.ageLevel, year: page.year },
      pageId: createAgeGroupId(),
    };
    const placed = rankingsLive
      ? await placeLeagueSeason(command)
      : await Promise.all([import("../lib/live/runPoolCommand"), poolFilled()])
          .then(([module]) => module.runPoolCommand(command).ok)
          .catch(() => false);
    showToast(
      placed
        ? `Started the season: ${made.teams.length} teams and ${games}, on ${page.name} in Team Rankings.`
        : `Started the season: ${made.teams.length} teams and ${games}. It could not be put on ${page.name} in Team Rankings just now; do that in Team Rankings' Setup.`,
      { tone: "undo", actionLabel: "Undo", onAction: restoreUndo }
    );
  };

  /*
   * A league site's schedule, pasted into a season with no games yet and looked over in its panel.
   * Refused while the season may not be written, and when it has changed since the panel last drew
   * it (a game or a team arrived, or another season opened, whose teams are another list), since
   * what was looked over was the season as it was; the panel says so. Nothing is replaced, so
   * nothing is asked: the teams, games and scores go in as one change to the season, which is one
   * save and one step to undo.
   */
  const pasteSchedule = (made: PastedSeason): boolean => {
    const now = seasonStore.get().season;
    if (seasonStore.locked() || now.teams !== made.base || now.matchups.length) return false;
    captureUndo("Paste the league's schedule");
    seasonStore.setSeason({
      ...now,
      teams: made.teams,
      matchups: made.matchups,
      logs: { ...now.logs, ...made.logs },
    });
    // As the other ways to start a season do: a team filter kept from another season would hide
    // games just added, under a toast saying they were.
    setLastImpact(null);
    closeTeamData();
    setScoreboardTeamFilter("ALL");
    setActiveView("games");
    showToast(made.said, { tone: "undo", actionLabel: "Undo", onAction: restoreUndo });
    return true;
  };
  const schedulePaste = (text: string, close: () => void) => (
    <Suspense fallback={null}>
      <LeagueSchedulePaste
        text={text}
        teams={teams}
        settings={settings}
        squadYear={scoutBridge.squadYear}
        onApply={pasteSchedule}
        onClose={close}
      />
    </Suspense>
  );

  const downloadRoundRobinCSV = () => {
    const built = builtFromList();
    if (!built) return;
    const blob = new Blob([roundRobinCsv(built, settings)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = roundRobinFileName(settings.seasonLabel);
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
    downloadRoundRobinCSV,
    loadDemoSeason,
    saveTeamList,
    schedulePaste,
    startSeasonFromClubs,
    teamListControls,
  };
}
