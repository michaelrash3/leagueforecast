import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { buildShareUrl } from "./lib/share";
import {
  listSeasons,
  loadBracketLogs,
  loadSettings,
  loadTeams,
  saveBracketLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
} from "./lib/storage";
import { DEFAULT_SETTINGS, type GameLog } from "./lib/types";

/*
 * Load Demo and a shared link replace a league's settings along with its teams and games, and their
 * Undo put back only the teams and games. The league came back under the other one's name, cutoff,
 * points and pitch format, and the season switcher renamed the season to match. A shared link also
 * left the old league's bracket results sitting on the new league's bracket.
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

const ours = {
  ...DEFAULT_SETTINGS,
  seasonLabel: "Home League",
  goldCutoff: 2,
  winPoints: 2,
  pitchMode: "machine" as const,
};

describe("undoing a change that brought its own settings", () => {
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
    saveMatchups([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
    saveSettings(ours);
    saveBracketLogs({ "bracket-r1-g1": final("9", "1") });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("puts the league's own settings back after Load Demo", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Load Demo" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Load demo" })
    );
    await waitFor(() => expect(loadSettings().seasonLabel).not.toBe("Home League"));

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(loadSettings()).toEqual(ours));
    expect(loadTeams().map((team) => team.name)).toEqual(["Aces", "Bears", "Comets"]);
    expect(loadBracketLogs()).toEqual({ "bracket-r1-g1": final("9", "1") });
    expect(listSeasons().map((season) => season.name)).toEqual(["Home League"]);
  });

  it("clears the old bracket for a shared league, and puts both back on Undo", async () => {
    const shared = {
      v: 1 as const,
      teams: [
        { id: "X", name: "Xylos" },
        { id: "Y", name: "Yetis" },
      ],
      matchups: [{ id: "s1", date: "6/1", away: "X", home: "Y" }],
      logs: { s1: final("4", "2") },
      settings: { ...DEFAULT_SETTINGS, seasonLabel: "Their League", goldCutoff: 1 },
    };
    window.history.replaceState(null, "", buildShareUrl(window.location.href, shared));
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Load snapshot" })
    );

    await waitFor(() => expect(loadSettings().seasonLabel).toBe("Their League"));
    expect(loadBracketLogs()).toEqual({});

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(loadSettings()).toEqual(ours));
    expect(loadBracketLogs()).toEqual({ "bracket-r1-g1": final("9", "1") });
    expect(loadTeams().map((team) => team.name)).toEqual(["Aces", "Bears", "Comets"]);
  });
});
