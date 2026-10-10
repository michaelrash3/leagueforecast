import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { readFullBackup } from "./lib/backup";
import { readPutAside } from "./lib/preferences";
import type { SeasonStore } from "./lib/seasonStore";
import {
  createSeason,
  listSeasons,
  loadSettings,
  readSeasonSnapshot,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  setActiveSeason,
  writeSeasonData,
} from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * The Data Quality tab (2.3), in the app: the Dashboard's count leads to it, a finding's links
 * open the game, team or setting it is about, a repair says what it will do before it does it and
 * is one undo step, deleting asks first, and a finding put aside stays aside on this device and
 * can be brought back. Placeholder names; "today" is 10 June.
 */

beforeAll(() => prefetchAllViews());

/*
 * League kept live, off as it is without a cloud, but holding the season store, so a test can lay
 * another device's edit over the season while a question is open, as League kept live does.
 */
const live = vi.hoisted(() => ({ store: null as SeasonStore | null }));
vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: ({ seasons }: { seasons: SeasonStore }) => {
    live.store = seasons;
    return { state: { kind: "off" }, guardUndo: () => null, removeSeason: async () => false };
  },
}));
const arrive = (change: (season: ReturnType<SeasonStore["get"]>["season"]) => object) =>
  act(() => {
    const store = live.store;
    if (!store) throw new Error("No season store");
    const season = store.get().season;
    store.apply({ ...season, ...change(season) });
  });

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
      "Delete Bears at Aces, 6/2 (nothing entered)."
    );
    await user.click(within(findingCard(summary)).getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete game" }));
    expect(await screen.findByText("Deleted 1 game.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("listitem", { name: summary })).toBeNull());
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    await waitFor(() => expect(document.getElementById("game-card-g1")).not.toBeNull());
    expect(document.getElementById("game-card-g1b")).toBeNull();
  });

  describe("while it asks before deleting", () => {
    const summary = "Aces at Bears, 6/2 is on the schedule 2 times";
    const askToDelete = async (user: ReturnType<typeof userEvent.setup>) => {
      await openQuality(user);
      await user.click(
        within(findingCard(summary)).getByRole("button", { name: "Delete the extra copies…" })
      );
      await user.click(within(findingCard(summary)).getByRole("button", { name: "Delete" }));
      return screen.findByRole("button", { name: "Delete game" });
    };
    const ids = () => live.store?.get().season.matchups.map((game) => game.id);

    it("leaves a copy another device gives a box score, runs or not", async () => {
      const user = userEvent.setup();
      const confirm = await askToDelete(user);
      arrive((season) => ({
        logs: { ...season.logs, g1b: { ...scores("", "", false), awayHits: "4" } },
      }));
      await user.click(confirm);
      expect(
        await screen.findByText("Nothing to delete: those games have changed since.")
      ).toBeInTheDocument();
      expect(ids()).toContain("g1b");
    });

    it("never deletes the last copy, when another device deletes the one it kept", async () => {
      const user = userEvent.setup();
      const confirm = await askToDelete(user);
      arrive((season) => ({ matchups: season.matchups.filter((game) => game.id !== "g1") }));
      await user.click(confirm);
      expect(
        await screen.findByText("Nothing to delete: those games have changed since.")
      ).toBeInTheDocument();
      // The game is still on the schedule, in the one copy left.
      expect(ids()).toContain("g1b");
    });
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

  it("puts nothing aside in a season made under the id of a deleted one", async () => {
    const spring = createSeason("Spring");
    setActiveSeason(spring.id);
    seed();
    const data = readSeasonSnapshot(spring.id)!;
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Data Quality" }));
    const summary = "1 game without a date";
    await user.click(
      within(await screen.findByRole("listitem", { name: summary })).getByRole("button", {
        name: "Put aside",
      })
    );
    await waitFor(() => expect(screen.queryByRole("listitem", { name: summary })).toBeNull());

    // Away to another season, Spring deleted from there, and a season made in its place.
    await user.selectOptions(screen.getByRole("combobox", { name: /active season/i }), "default");
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    const seasons = await screen.findByRole("region", { name: "Seasons" });
    const row = within(seasons).getByText("Spring").closest("li");
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete season" })
    );
    await waitFor(() => expect(within(seasons).queryByText("Spring")).toBeNull());
    await user.type(within(seasons).getByRole("textbox", { name: "New season name" }), "Fall");
    await user.click(within(seasons).getByRole("button", { name: "New Season" }));
    await waitFor(() => expect(within(seasons).getByText("Fall")).toBeInTheDocument());
    // Given the deleted season's id, and the same games under the same ids.
    expect(listSeasons().find((season) => season.name === "Fall")?.id).toBe(spring.id);
    writeSeasonData(spring.id, { ...data, settings: { ...data.settings, seasonLabel: "Fall" } });

    await user.selectOptions(screen.getByRole("combobox", { name: /active season/i }), spring.id);
    await user.click(screen.getByRole("tab", { name: "Data Quality" }));
    expect(
      await within(screen.getByRole("region", { name: "Information" })).findByRole("listitem", {
        name: summary,
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /put aside$/ })).toBeNull();
  });

  it("puts nothing aside after a restore puts another season under the open one's id", async () => {
    seed();
    // A backup of another season given the same id, made at another moment, with the same games.
    const backup = readFullBackup();
    const other = {
      ...backup,
      seasons: backup.seasons.map((season) => ({
        ...season,
        createdAt: "2020-01-01T00:00:00.000Z",
      })),
    };
    const user = userEvent.setup();
    await openQuality(user);
    const summary = "1 game without a date";
    await user.click(
      within(await screen.findByRole("listitem", { name: summary })).getByRole("button", {
        name: "Put aside",
      })
    );
    await waitFor(() => expect(screen.queryByRole("listitem", { name: summary })).toBeNull());

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.upload(
      screen.getByLabelText("Import backup JSON"),
      new File([JSON.stringify(other)], "backup.json", { type: "application/json" })
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore everything" })
    );
    await waitFor(() => expect(listSeasons()[0]?.createdAt).toBe("2020-01-01T00:00:00.000Z"));
    expect(readPutAside("default")).toEqual({});

    await user.click(screen.getByRole("tab", { name: "Data Quality" }));
    expect(
      await within(screen.getByRole("region", { name: "Information" })).findByRole("listitem", {
        name: summary,
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /put aside$/ })).toBeNull();
  });
});
