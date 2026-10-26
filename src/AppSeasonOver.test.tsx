import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { writeOurTeam } from "./lib/preferences";
import {
  getActiveSeasonId,
  loadSettings,
  saveBracketLogs,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
} from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * A season with nothing left to play says how it ended on the Dashboard, where the next games
 * would be, rather than "No predictions yet" over tiles of zeros. Placeholder names.
 */

beforeAll(() => prefetchAllViews());

const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("a season with nothing left to play", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveMatchups([
      { id: "g1", date: "5/1", away: "A", home: "B" },
      { id: "g2", date: "5/8", away: "B", home: "A" },
    ]);
  });

  it("says how it ended on the Dashboard", async () => {
    saveLogs({ g1: final("6", "2"), g2: final("1", "5") });
    saveSettings({ ...loadSettings(), postseasonFormat: "none" });
    render(<App />);

    const over = await screen.findByRole("region", { name: "Season over" });
    expect(within(over).getByText("Regular season: Aces finished first.")).toBeInTheDocument();
    expect(screen.queryByText("No predictions yet")).toBeNull();
  });

  it("waits for the bracket's final where there is a postseason", async () => {
    saveLogs({ g1: final("6", "2"), g2: final("1", "5") });
    saveSettings({ ...loadSettings(), postseasonFormat: "all" });
    render(<App />);

    expect(await screen.findByText("No predictions yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Season over" })).toBeNull();
  });

  it("crowns the bracket's winner once its final is played", async () => {
    saveLogs({ g1: final("6", "2"), g2: final("1", "5") });
    saveSettings({ ...loadSettings(), postseasonFormat: "all" });
    // Two entrants, one game: the top seed (Aces) at home, beaten by the Bears.
    saveBracketLogs({ "bracket-r1-g1": { ...final("4", "3") } });
    render(<App />);
    const user = userEvent.setup();

    const over = await screen.findByRole("region", { name: "Season over" });
    expect(within(over).getByText("Champion: Bears.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    await user.click(await screen.findByRole("button", { name: "Brackets" }));
    expect(await screen.findByText("Champion")).toBeInTheDocument();
    expect(screen.queryByText("Projected Champion")).toBeNull();
  });

  it("draws the race game day by game day on the Forecast", async () => {
    saveLogs({ g1: final("6", "2"), g2: final("1", "5") });
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    await user.click(await screen.findByRole("button", { name: "Season" }));
    const race = await screen.findByRole("region", { name: "Season race" });
    expect(await within(race).findByRole("img")).toBeInTheDocument();
  });
});

describe("the seasons at a glance", () => {
  /*
   * Four teams level in pairs, so the seeding is the tiebreakers' and not the names': the Bears
   * beat the Aces and the Dukes beat the Comets, so the table is Bears, Aces, Dukes, Comets. The
   * top two make Gold, where the Aces win at the Bears; the Comets win Silver at the Dukes'.
   */
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
      { id: "D", name: "Dukes" },
    ]);
    saveMatchups([
      { id: "g1", date: "5/1", away: "A", home: "B" },
      { id: "g2", date: "5/1", away: "D", home: "C" },
      { id: "g3", date: "5/8", away: "C", home: "A" },
      { id: "g4", date: "5/8", away: "D", home: "B" },
      { id: "g5", date: "5/15", away: "D", home: "A" },
      { id: "g6", date: "5/15", away: "C", home: "B" },
    ]);
    saveLogs({
      g1: final("1", "6"),
      g2: final("4", "3"),
      g3: final("4", "5"),
      g4: final("1", "8"),
      g5: final("0", "7"),
      g6: final("3", "2"),
    });
    saveSettings({ ...loadSettings(), postseasonFormat: "cut", goldCutoff: 2 });
    saveBracketLogs({
      "bracket-r1-g1": final("5", "3"),
      "silver-bracket-r1-g1": final("6", "2"),
    });
    writeOurTeam(getActiveSeasonId(), "C");
  });

  it("say how the season ended in the Dashboard's own words", async () => {
    render(<App />);
    const user = userEvent.setup();

    const over = await screen.findByRole("region", { name: "Season over" });
    const dashboard = within(over)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(dashboard).toEqual([
      "Regular season: Bears finished first.",
      "Champion: Aces.",
      "Silver champion: Comets.",
      "Comets finished 4 of 4.",
    ]);

    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Seasons at a glance" }));
    const glance = await screen.findByRole("region", { name: "Seasons at a glance" });
    const lines = within(glance)
      .getAllByRole("listitem")
      .flatMap((item) => within(item).queryAllByRole("listitem"))
      .map((item) => item.textContent);
    expect(lines).toEqual([...dashboard, "Comets missed the Gold bracket."]);
  });
});
