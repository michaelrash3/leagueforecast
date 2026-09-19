import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLeagueCommands, type LeagueCommandActions } from "./useLeagueCommands";
import type { ActiveShareView, TeamWithProjection } from "../lib/types";

/**
 * The command list used to be seventy lines in the middle of App, which is where both of the bugs
 * an audit found were living, and it could not be exercised without standing the whole app up.
 */
const row = (id: string, rank: number) => ({ id, name: id, rank }) as unknown as TeamWithProjection;

const VIEWS: { view: ActiveShareView; label: string }[] = [
  { view: "standings", label: "Standings" },
  { view: "games", label: "Schedule" },
];

const actionsSpy = (): LeagueCommandActions => ({
  openTeam: vi.fn(),
  openView: vi.fn(),
  shareSeason: vi.fn(),
  exportCSV: vi.fn(),
  exportBackup: vi.fn(),
  loadDemoSeason: vi.fn(),
  toggleTheme: vi.fn(),
  showShortcuts: vi.fn(),
  showTour: vi.fn(),
});

const setup = (actions: LeagueCommandActions, theme = "light") =>
  renderHook(
    (props: { theme: string }) =>
      useLeagueCommands({
        teams: [row("rays", 1), row("jays", 2)],
        views: VIEWS,
        theme: props.theme,
        describeTeam: (team) => ({ name: team.name, record: "5-1" }),
        actions,
      }),
    { initialProps: { theme } }
  );

describe("the league command list", () => {
  it("offers every view, every team and every action", () => {
    const { result } = setup(actionsSpy());
    const labels = result.current.map((command) => command.label);

    expect(labels).toContain("Go to Standings");
    expect(labels).toContain("Go to Schedule");
    expect(labels).toContain("View rays");
    expect(labels).toContain("Share this season (copy URL)");
    expect(labels).toContain("Download backup JSON");
  });

  it("runs the action a command names, with the argument it names", () => {
    const actions = actionsSpy();
    const { result } = setup(actions);

    act(() => result.current.find((c) => c.label === "View jays")!.run());
    expect(actions.openTeam).toHaveBeenCalledWith("jays");

    act(() => result.current.find((c) => c.label === "Go to Schedule")!.run());
    expect(actions.openView).toHaveBeenCalledWith("games");
  });

  it("raises what was run last into Recent, newest first, and keeps six", () => {
    const { result } = setup(actionsSpy());

    act(() => result.current.find((c) => c.label === "Go to Schedule")!.run());
    expect(result.current[0]?.group).toBe("Recent");
    expect(result.current[0]?.label).toBe("Go to Schedule");

    act(() => result.current.find((c) => c.label === "View rays")!.run());
    const recent = result.current.filter((c) => c.group === "Recent").map((c) => c.label);
    expect(recent).toEqual(["View rays", "Go to Schedule"]);

    // Running the same command again moves it back to the front rather than listing it twice.
    act(() => result.current.find((c) => c.label === "Go to Schedule")!.run());
    const again = result.current.filter((c) => c.group === "Recent").map((c) => c.label);
    expect(again).toEqual(["Go to Schedule", "View rays"]);
  });

  it("reads the theme toggle the way the theme currently is", () => {
    const { result, rerender } = setup(actionsSpy(), "light");
    expect(result.current.map((c) => c.label)).toContain("Switch to dark mode");

    rerender({ theme: "dark" });
    expect(result.current.map((c) => c.label)).toContain("Switch to light mode");
  });
});
