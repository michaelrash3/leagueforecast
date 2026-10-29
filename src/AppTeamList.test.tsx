import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { loadMatchups, loadSettings, loadTeams, saveMatchups, saveTeams } from "./lib/storage";

/*
 * A new League season's teams are saved before its schedule: typed and saved, more added on a later
 * visit, the list locked, and only then the schedule made from it. Placeholder names.
 */
beforeAll(() => prefetchAllViews());

const live = vi.hoisted(() => ({ state: { kind: "off" } as LiveLeagueState }));
vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: () => ({
    state: live.state,
    guardUndo: () => null,
    removeSeason: async () => true,
  }),
}));

describe("a season's team list, then its schedule", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    saveTeams([]);
    saveMatchups([]);
  });
  afterEach(() => {
    live.state = { kind: "off" };
  });

  it("saves teams, takes more on a later visit, and makes the schedule only once locked", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.type(await screen.findByLabelText("Team list"), "Aces\nBears");
    const saves = screen.getAllByRole("button", { name: "Save teams" });
    await user.click(saves[saves.length - 1] as HTMLElement);

    // Saved with no schedule, and the list left open.
    await waitFor(() => expect(loadTeams().map((team) => team.name)).toEqual(["Aces", "Bears"]));
    expect(loadMatchups()).toEqual([]);
    expect(loadSettings().teamsLocked).toBe(false);
    first.unmount();

    // Back later: the list is there to add to, and no game can be made from it yet.
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: /schedule/i }));
    const list = await screen.findByRole("region", { name: "Team list" });
    expect(within(list).getByLabelText("Name of Aces")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Game" })).toBeNull();
    await user.type(within(list).getByLabelText("Add teams, one per line"), "Comets");
    await user.click(within(list).getByRole("button", { name: "Save teams" }));
    await waitFor(() => expect(loadTeams()).toHaveLength(3));

    // Locked, the schedule step opens; a round robin is made from the three teams kept.
    await user.click(within(list).getByRole("button", { name: "Lock team list" }));
    await waitFor(() => expect(loadSettings().teamsLocked).toBe(true));
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Build a round robin" }));
    await waitFor(() => expect(loadMatchups()).toHaveLength(3));
    const ids = new Set(loadTeams().map((team) => team.id));
    expect(loadMatchups().every((game) => ids.has(game.away) && ids.has(game.home))).toBe(true);
    // With games, the list is set for good: no panel, no Unlock.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Team list" })).toBeNull());
  }, 30_000);
});
