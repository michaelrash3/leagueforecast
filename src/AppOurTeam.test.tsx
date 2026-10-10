import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { readOurTeam } from "./lib/preferences";
import {
  createSeason,
  listSeasons,
  loadMatchups,
  loadSettingsForSeason,
  loadTeams,
  saveLogs,
  saveMatchups,
  saveTeams,
  setActiveSeason,
  writeSeasonData,
} from "./lib/storage";
import type { GameLog } from "./lib/types";
import { prefetchAllViews } from "./components/league/leagueViews";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * At the field the question is about one team, and the Dashboard answered it for the league. A
 * browser can now follow one team per season, and the Dashboard leads with it.
 */
const final = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("our team on the Dashboard", () => {
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
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
    ]);
    saveMatchups([
      { id: "g1", date: "5/1", away: "A", home: "B" },
      { id: "g2", date: "5/2", away: "B", home: "C" },
      { id: "g3", date: "5/9", away: "C", home: "A" },
    ]);
    saveLogs({ g1: final("7", "2"), g2: final("5", "4") });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leads with the team picked here, and keeps the pick for this season", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));

    const prompt = screen.getByRole("region", { name: "Our team" });
    await user.selectOptions(within(prompt).getByRole("combobox"), "Aces");

    const card = screen.getByRole("region", { name: "Our team" });
    expect(within(card).getByRole("heading", { name: "Aces" })).toBeInTheDocument();
    expect(card).toHaveTextContent(/1st of 3 · 1-0/);
    expect(card).toHaveTextContent(/Next: 5\/9 vs Comets — \d+% to win/);
    expect(readOurTeam("default")).toBe("A");
  });

  it("opens the Schedule on the team's games to enter a score", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    await user.selectOptions(
      within(screen.getByRole("region", { name: "Our team" })).getByRole("combobox"),
      "Aces"
    );

    await user.click(screen.getByRole("button", { name: "Enter a score" }));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute("aria-selected", "true")
    );
    // Only the Aces' games are on the scoreboard: theirs, and not Bears at Comets.
    expect(document.getElementById("game-card-g3")).not.toBeNull();
    expect(document.getElementById("game-card-g2")).toBeNull();
  });

  it("follows nothing in a season made under the id of a deleted one that followed a team", async () => {
    const teams = loadTeams();
    const games = loadMatchups();
    const spring = createSeason("Spring");
    setActiveSeason(spring.id);
    saveTeams(teams);
    saveMatchups(games);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    await user.selectOptions(
      within(screen.getByRole("region", { name: "Our team" })).getByRole("combobox"),
      "Aces"
    );
    expect(readOurTeam(spring.id)).toBe("A");

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
    // Given the deleted season's id, and the same teams under the same ids.
    expect(listSeasons().find((season) => season.name === "Fall")?.id).toBe(spring.id);
    writeSeasonData(spring.id, {
      teams,
      matchups: games,
      logs: {},
      bracketLogs: {},
      settings: loadSettingsForSeason(spring.id),
    });

    await user.selectOptions(screen.getByRole("combobox", { name: /active season/i }), spring.id);
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    const card = screen.getByRole("region", { name: "Our team" });
    expect(within(card).queryByRole("heading", { name: "Aces" })).toBeNull();
    expect(within(card).getByRole("combobox")).toHaveValue("");
    expect(readOurTeam(spring.id)).toBeNull();
  });
});
