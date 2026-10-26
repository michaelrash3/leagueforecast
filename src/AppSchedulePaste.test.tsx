import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type LeagueSchedulePaste from "./components/league/LeagueSchedulePaste";
import { prefetchAllViews } from "./components/league/leagueViews";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { loadMatchups, loadTeams, saveMatchups, saveTeams } from "./lib/storage";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * The league site's schedule pasted into a season with no games, through the page: read, looked
 * over, added as one step, and taken back by Undo; and refused, by App, while the season may not
 * be written or once it has changed from the one the panel matched the names against.
 */

const live = vi.hoisted(() => ({ state: { kind: "off" } as LiveLeagueState }));
vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: () => ({
    state: live.state,
    guardUndo: () => null,
    removeSeason: async () => true,
  }),
}));

/** The panel as App last drew it, so a test can hand App what the panel would. */
const panel = vi.hoisted(() => ({
  props: null as ComponentProps<typeof LeagueSchedulePaste> | null,
}));
vi.mock("./components/league/LeagueSchedulePaste", async (actual) => {
  const real = await actual<typeof import("./components/league/LeagueSchedulePaste")>();
  const Real = real.default;
  return {
    default: (props: ComponentProps<typeof Real>) => {
      panel.props = props;
      return <Real {...props} />;
    },
  };
});

const shown = () => {
  if (!panel.props) throw new Error("The paste panel is not open.");
  return panel.props;
};

describe("pasting a league's schedule into the page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    live.state = { kind: "off" };
    panel.props = null;
  });

  const openOnSchedule = async (user: ReturnType<typeof userEvent.setup>) => {
    saveTeams([
      { id: "ACES", name: "Aces" },
      { id: "BEAR", name: "Bears" },
    ]);
    saveMatchups([]);
    const page = render(<App />);
    await user.click(await screen.findByRole("tab", { name: /schedule/i }));
    await user.click(await screen.findByRole("button", { name: "Paste the league's schedule" }));
    return page;
  };

  it("adds the games looked over as one step, and Undo takes them back", async () => {
    const user = userEvent.setup();
    await openOnSchedule(user);
    await user.type(
      await screen.findByLabelText("League schedule to read"),
      "9/12 Aces @ Bears 3-4{enter}9/19 Bears @ Aces"
    );
    await user.click(screen.getByRole("button", { name: "Read the schedule" }));
    await user.click(screen.getByRole("button", { name: "Add 2 games" }));

    expect(
      await screen.findByText("Added 2 games from the pasted schedule; 1 has a final score.")
    ).toBeTruthy();
    expect(screen.queryByText("No games yet.")).toBeNull();
    await waitFor(() =>
      expect(loadMatchups().map(({ date, away, home }) => ({ date, away, home }))).toEqual([
        { date: "9/12", away: "ACES", home: "BEAR" },
        { date: "9/19", away: "BEAR", home: "ACES" },
      ])
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("No games yet.")).toBeTruthy();
    await waitFor(() => expect(loadMatchups()).toEqual([]));
  });

  it("makes an empty season's teams and games from the team-list box", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Team list"), "4/10 Falcons @ Wolves");
    await user.click(screen.getByRole("button", { name: "Read as a schedule" }));
    await user.click(await screen.findByRole("button", { name: "Add 1 game" }));

    expect(
      await screen.findByText("Added 1 game from the pasted schedule, with 2 new teams.")
    ).toBeTruthy();
    await waitFor(() =>
      expect(loadTeams().map((team) => team.name)).toEqual(["Falcons", "Wolves"])
    );
    expect(loadMatchups()).toHaveLength(1);
  });

  it("refuses a season changed since the panel drew it, and one that now has games", async () => {
    const user = userEvent.setup();
    await openOnSchedule(user);
    const { teams } = shown();
    const made = (base = teams) => ({
      base,
      teams,
      matchups: [{ id: "g_paste", date: "9/12", away: "ACES", home: "BEAR" }],
      logs: {},
      said: "Added it.",
    });

    // Matched against a list of teams that is no longer the season's.
    let taken = true;
    act(() => {
      taken = shown().onApply(made([...teams]));
    });
    expect(taken).toBe(false);
    expect(loadMatchups()).toEqual([]);

    act(() => {
      taken = shown().onApply(made());
    });
    expect(taken).toBe(true);
    await waitFor(() => expect(loadMatchups()).toHaveLength(1));

    // The season has a game now, which is no season to paste a schedule into.
    act(() => {
      taken = shown().onApply({ ...made(), matchups: [] });
    });
    expect(taken).toBe(false);
  });

  it("refuses while the season may not be written", async () => {
    const user = userEvent.setup();
    const page = await openOnSchedule(user);
    const { onApply, teams } = shown();
    live.state = { kind: "offline" };
    page.rerender(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Game" })).toBeDisabled());

    let taken = true;
    act(() => {
      taken = onApply({
        base: teams,
        teams,
        matchups: [{ id: "g_paste", date: "9/12", away: "ACES", home: "BEAR" }],
        logs: {},
        said: "Added it.",
      });
    });
    expect(taken).toBe(false);
    expect(loadMatchups()).toEqual([]);
  });
});
