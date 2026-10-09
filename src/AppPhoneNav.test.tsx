import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { SectionNav } from "./components/teamRankings/SectionNav";
import { loadSettings, saveLogs, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * On a phone (2.4): League Standings' row holds where a season is read and scored, with the rest
 * under More, and Data Quality comes out into the row with its count while something needs
 * attention; Team Rankings keeps Rankings, Games, Import and Scouting, with Archive and Setup
 * under More. A phone is a narrow screen as `matchMedia` reports it. Placeholder names.
 */

beforeAll(() => prefetchAllViews());

const phone = (narrow: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: narrow && query.includes("max-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  );

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

const seed = (scores: Record<string, GameLog>, goldCutoff: number) => {
  saveTeams(["Aces", "Bears"].map((name) => ({ id: name[0] ?? name, name })));
  saveMatchups([{ id: "g1", date: "", away: "A", home: "B" }]);
  saveLogs(scores);
  saveSettings({ ...loadSettings(), goldCutoff });
};

const rowTabs = (list: string) =>
  within(screen.getByRole("tablist", { name: list }))
    .getAllByRole("tab")
    // The label, without a badge's count after it.
    .map((tab) => tab.textContent?.replace(/\d+$/, ""));

describe("League Standings on a phone", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    phone(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the main views in the row and the rest under More", async () => {
    // A cut line two teams can be either side of: nothing needs attention.
    seed({ g1: final("4", "2") }, 1);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    expect(rowTabs("Main views")).toEqual(["Dashboard", "Schedule", "Standings", "Forecast"]);
    await user.click(screen.getByRole("button", { name: "More" }));
    const more = screen.getByRole("group", { name: "More main views" });
    for (const name of ["Power Ratings", "League Stats", "Data Quality", "Settings"]) {
      expect(within(more).getByRole("button", { name })).toBeInTheDocument();
    }
    await user.click(within(more).getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "More: Settings" })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("panel-settings")).not.toBeNull());
  });

  it("shows Data Quality across the bar while something needs attention", async () => {
    // A Gold cut line of 2 with two teams: every team is in, so the odds say nothing.
    seed({ g1: final("4", "2") }, 2);
    const user = userEvent.setup();
    render(<App />);
    const alert = await screen.findByRole("button", { name: "Data Quality: 1 needs attention" });
    expect(rowTabs("Main views")).toEqual(["Dashboard", "Schedule", "Standings", "Forecast"]);
    expect(screen.getByRole("button", { name: "More" })).toHaveAccessibleDescription(
      "Data Quality: 1 needs attention"
    );
    await user.click(alert);
    expect(
      await screen.findByRole("heading", { name: "Data Quality", level: 2 })
    ).toBeInTheDocument();
  });
});

describe("Team Rankings' sections on a phone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keep Rankings, Games, Import and Scouting in the row, Archive and Setup under More", async () => {
    phone(true);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SectionNav current="rankings" onSelect={onSelect} />);
    expect(rowTabs("Team Rankings section")).toEqual(["Rankings", "Games", "Import", "Scouting"]);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "Setup" }));
    expect(onSelect).toHaveBeenCalledWith("setup");
  });

  it("keep all six in the row on a wider screen", () => {
    phone(false);
    render(<SectionNav current="rankings" onSelect={vi.fn()} />);
    expect(rowTabs("Team Rankings section")).toEqual([
      "Rankings",
      "Games",
      "Import",
      "Scouting",
      "Archive",
      "Setup",
    ]);
  });
});
