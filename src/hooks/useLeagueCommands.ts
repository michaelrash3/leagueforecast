import { useCallback, useMemo, useState } from "react";
import type { Command } from "../components/CommandPalette";
import type { ActiveShareView, TeamWithProjection } from "../lib/types";

/** How many recently-run commands ride at the top of the list. */
const RECENT_LIMIT = 6;

export type LeagueCommandActions = {
  openTeam: (teamId: string) => void;
  openView: (view: ActiveShareView) => void;
  shareSeason: () => void;
  exportCSV: () => void;
  exportBackup: () => void;
  loadDemoSeason: () => void;
  toggleTheme: () => void;
  showShortcuts: () => void;
  showTour: () => void;
};

export type LeagueCommandInputs = {
  /** The standings rows, which become the "View <team>" commands. */
  teams: TeamWithProjection[];
  /** Every view, in tab order, with the label its tab carries. */
  views: { view: ActiveShareView; label: string }[];
  /** Which way the theme toggle currently reads. */
  theme: string;
  /** A team's name as it should be shown, and its record as the hint beside it. */
  describeTeam: (team: TeamWithProjection) => { name: string; record: string };
  actions: LeagueCommandActions;
};

/**
 * The league half's command list.
 *
 * This was seventy-odd lines in the middle of App, which is where both of the bugs an audit found
 * were living. It is a list built from state and closures, which is exactly the shape that goes
 * wrong quietly: the memo here must name every action it holds, or the palette hands out a closure
 * built for a screen the reader has already left. Out here the dependency rule can be read in one
 * screen, and the list can be tested without standing the whole app up.
 *
 * Every command is run through `track`, so the six most recent rise to the top next time. That is
 * also why the list is rebuilt when the history changes: the "Recent" group is the same commands
 * relabelled, not a second set.
 */
export function useLeagueCommands({
  teams,
  views,
  theme,
  describeTeam,
  actions,
}: LeagueCommandInputs): Command[] {
  const [history, setHistory] = useState<string[]>([]);

  const track = useCallback(
    (id: string, run: () => void) => () => {
      setHistory((prev) => [id, ...prev.filter((item) => item !== id)].slice(0, RECENT_LIMIT));
      run();
    },
    []
  );

  const {
    openTeam,
    openView,
    shareSeason,
    exportCSV,
    exportBackup,
    loadDemoSeason,
    toggleTheme,
    showShortcuts,
    showTour,
  } = actions;

  return useMemo(() => {
    const teamCmds: Command[] = teams.map((team) => {
      const described = describeTeam(team);
      return {
        id: `team-${team.id}`,
        label: `View ${described.name}`,
        group: "Team",
        hint: `#${team.rank} · ${described.record}`,
        run: track(`team-${team.id}`, () => openTeam(team.id)),
      };
    });
    const viewCmds: Command[] = views.map(({ view, label }) => ({
      id: `view-${view}`,
      label: `Go to ${label}`,
      group: "View",
      run: track(`view-${view}`, () => openView(view)),
    }));
    const actionCmds: Command[] = [
      {
        id: "action-share",
        label: "Share this season (copy URL)",
        group: "Action",
        run: track("action-share", shareSeason),
      },
      {
        id: "action-export",
        label: "Export schedule CSV",
        group: "Action",
        run: track("action-export", exportCSV),
      },
      {
        id: "action-backup",
        label: "Download backup JSON",
        group: "Action",
        run: track("action-backup", exportBackup),
      },
      {
        id: "action-demo",
        label: "Load demo season",
        group: "Action",
        run: track("action-demo", loadDemoSeason),
      },
      {
        id: "action-toggle-theme",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        group: "Action",
        run: track("action-toggle-theme", toggleTheme),
      },
      {
        id: "action-shortcuts",
        label: "Show keyboard shortcuts",
        group: "Help",
        run: track("action-shortcuts", showShortcuts),
      },
      {
        id: "action-tour",
        label: "Show app tour",
        group: "Help",
        run: track("action-tour", showTour),
      },
    ];
    const byId = new Map([...viewCmds, ...teamCmds, ...actionCmds].map((c) => [c.id, c]));
    const recent = history
      .map((id) => byId.get(id))
      .filter((cmd): cmd is Command => !!cmd)
      .map((cmd) => ({ ...cmd, group: "Recent" }));
    return [...recent, ...viewCmds, ...teamCmds, ...actionCmds];
  }, [
    history,
    teams,
    views,
    theme,
    describeTeam,
    track,
    openTeam,
    openView,
    shareSeason,
    exportCSV,
    exportBackup,
    loadDemoSeason,
    toggleTheme,
    showShortcuts,
    showTour,
  ]);
}
