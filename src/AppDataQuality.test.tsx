import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { loadSettings, saveLogs, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * The Data Quality tab (2.3), in the app: the Dashboard's count leads to it, a finding's links
 * open the game, team or setting it is about, a repair says what it will do before it does it and
 * is one undo step, deleting asks first, and a finding put aside stays aside on this device and
 * can be brought back. Placeholder names; "today" is 10 June.
 */

beforeAll(() => prefetchAllViews());

const scores = (away: string, home: string, isFinal: boolean): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal,
});

const seed = () => {
  saveTeams(["Aces", "Bears", "Comets", "Ducks"].map((name) => ({ id: name[0] ?? name, name })));
  saveMatchups([
    { id: "g1", date: "6/2", away: "A", home: "B" },
    // The same game twice, its copy unscored.
    { id: "g1b", date: "6/2", away: "B", home: "A" },
    { id: "g2", date: "6/2", away: "C", home: "D" },
    // Played yesterday, scored, never marked final.
    { id: "p1", date: "6/9", away: "A", home: "C" },
    { id: "f1", date: "6/16", away: "B", home: "D" },
    // No date at all.
    { id: "u1", date: "", away: "A", home: "D" },
  ]);
  saveLogs({ g1: scores("5", "3", true), g2: scores("2", "6", true), p1: scores("4", "2", false) });
  saveSettings({ ...loadSettings(), goldCutoff: 2, regularSeasonGamesPerTeam: 0 });
};

const openQuality = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<App />);
  await user.click(await screen.findByRole("tab", { name: "Data Quality" }));
  return screen.findByRole("heading", { name: "Data Quality", level: 2 });
};

const findingCard = (summary: string) => screen.getByRole("listitem", { name: summary });

describe("the Data Quality tab", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 10, 12));
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
    seed();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is counted on the Dashboard, which leads to it", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = (await screen.findByText("Data Quality", { selector: "p" })).closest("aside");
    expect(panel).not.toBeNull();
    const summary = within(panel as HTMLElement);
    expect(summary.getByText("1 needs attention")).toBeInTheDocument();
    // The copy of a game, and the same copy as a past game with no score.
    expect(summary.getByText("2 worth reviewing")).toBeInTheDocument();
    expect(summary.getByText("2 information")).toBeInTheDocument();
    expect(summary.getByText(/less reliable/)).toBeInTheDocument();
    await user.click(summary.getByRole("button", { name: "Review data quality" }));
    expect(await screen.findByRole("region", { name: "Needs attention" })).toBeInTheDocument();
  });

  it("opens the game a finding is about, on the Schedule", async () => {
    const user = userEvent.setup();
    await openQuality(user);
    const card = findingCard("1 past game scored but not marked final");
    await user.click(within(card).getByRole("button", { name: "Open Aces at Comets, 6/9" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute("aria-selected", "true")
    );
    await waitFor(() =>
      expect(document.getElementById("game-card-p1")?.contains(document.activeElement)).toBe(true)
    );
  });

  it("shows what a repair will do, makes it as one undo step, and takes it back", async () => {
    const user = userEvent.setup();
    await openQuality(user);
    const summary = "1 past game scored but not marked final";
    await user.click(
      within(findingCard(summary)).getByRole("button", { name: "Mark them final…" })
    );
    const preview = within(findingCard(summary)).getByRole("region", {
      name: "What this will change",
    });
    expect(preview).toHaveTextContent("Mark Aces at Comets, 6/9 final at 4-2.");
    await user.click(within(preview).getByRole("button", { name: "Make the change" }));
    expect(await screen.findByText("Marked 1 game final.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("listitem", { name: summary })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("listitem", { name: summary })).toBeInTheDocument();
  });

  it("puts games per team back on undoing the schedule's count", async () => {
    // Each team scheduled for three games, with five set: the schedule is even, so its count is
    // offered. The only thing the repair changes is the setting, so it is what undo must restore.
    saveMatchups([
      { id: "r1", date: "6/20", away: "A", home: "B" },
      { id: "r2", date: "6/20", away: "C", home: "D" },
      { id: "r3", date: "6/21", away: "A", home: "C" },
      { id: "r4", date: "6/21", away: "B", home: "D" },
      { id: "r5", date: "6/22", away: "A", home: "D" },
      { id: "r6", date: "6/22", away: "B", home: "C" },
    ]);
    saveLogs({});
    saveSettings({ ...loadSettings(), goldCutoff: 2, regularSeasonGamesPerTeam: 5 });
    const user = userEvent.setup();
    await openQuality(user);
    const summary = "4 teams with fewer games scheduled than the 5 per team set";
    await user.click(
      within(findingCard(summary)).getByRole("button", { name: "Use the schedule's count…" })
    );
    await user.click(within(findingCard(summary)).getByRole("button", { name: "Make the change" }));
    expect(await screen.findByText("Games per team is now 3.")).toBeInTheDocument();
    await waitFor(() => expect(loadSettings().regularSeasonGamesPerTeam).toBe(3));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("listitem", { name: summary })).toBeInTheDocument();
    await waitFor(() => expect(loadSettings().regularSeasonGamesPerTeam).toBe(5));
  });

  it("asks before deleting, and deletes only the unscored copy", async () => {
    const user = userEvent.setup();
    await openQuality(user);
    const summary = "Aces at Bears, 6/2 is on the schedule 2 times";
    await user.click(
      within(findingCard(summary)).getByRole("button", { name: "Delete the extra copies…" })
    );
    expect(within(findingCard(summary)).getByRole("region")).toHaveTextContent(
      "Delete Bears at Aces, 6/2 (no score entered)."
    );
    await user.click(within(findingCard(summary)).getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete game" }));
    expect(await screen.findByText("Deleted 1 game.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("listitem", { name: summary })).toBeNull());
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    await waitFor(() => expect(document.getElementById("game-card-g1")).not.toBeNull());
    expect(document.getElementById("game-card-g1b")).toBeNull();
  });

  it("puts a finding aside on this device, and brings it back", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Data Quality" }));
    const summary = "1 game without a date";
    await user.click(
      within(await screen.findByRole("listitem", { name: summary })).getByRole("button", {
        name: "Put aside",
      })
    );
    await waitFor(() => expect(screen.queryByRole("listitem", { name: summary })).toBeNull());
    // What needs attention cannot be put aside at all.
    expect(
      within(findingCard("1 past game scored but not marked final")).queryByRole("button", {
        name: "Put aside",
      })
    ).toBeNull();

    // Still aside after the page is opened again.
    unmount();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Data Quality" }));
    await user.click(await screen.findByRole("button", { name: "Show 1 put aside" }));
    await user.click(
      within(screen.getByRole("listitem", { name: summary })).getByRole("button", {
        name: "Bring back",
      })
    );
    expect(
      await within(screen.getByRole("region", { name: "Information" })).findByRole("listitem", {
        name: summary,
      })
    ).toBeInTheDocument();
  });
});
