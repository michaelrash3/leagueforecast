import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  loadLogs,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  loadSettings,
} from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * "If we beat the Bears and the Comets lose, where are we?" — the Forecast tab only ever answered
 * that for the model's own picks. The playoff machine takes the reader's.
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

describe("the playoff machine", () => {
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
      { id: "D", name: "Ducks" },
    ]);
    saveMatchups([
      { id: "g1", date: "5/1", away: "A", home: "B" },
      { id: "g2", date: "5/1", away: "C", home: "D" },
      { id: "g3", date: "5/8", away: "D", home: "A" },
      { id: "g4", date: "5/8", away: "B", home: "C" },
    ]);
    saveLogs({ g1: final("6", "2"), g2: final("5", "3") });
    saveSettings({ ...loadSettings(), goldCutoff: 2 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays out the picks and ranks the league on them, without saving anything", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    const machine = await screen.findByRole("region", { name: "Playoff machine" });

    await user.click(
      within(within(machine).getByRole("group", { name: "Ducks at Aces" })).getByRole("button", {
        name: "Ducks",
      })
    );
    await user.click(
      within(within(machine).getByRole("group", { name: "Bears at Comets" })).getByRole("button", {
        name: "Bears",
      })
    );

    const table = within(machine).getByRole("table", { name: "Standings with your picks" });
    const recordOf = (name: string) =>
      within(within(table).getByText(name).closest("tr")!).getAllByRole("cell")[2]!.textContent;
    expect(recordOf("Ducks")).toBe("1-1");
    expect(recordOf("Aces")).toBe("1-1");
    expect(recordOf("Bears")).toBe("1-1");
    await waitFor(() => expect(within(table).queryByText("…")).toBeNull());
    // Every game is settled, so the odds are certainties: two teams in, two out.
    const gold = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[3]!.textContent?.match(/^\d+%/)?.[0]);
    expect(gold.sort()).toEqual(["0%", "0%", "100%", "100%"]);

    // A pick is not a result: the season's own scores are as they were.
    expect(Object.keys(loadLogs()).sort()).toEqual(["g1", "g2"]);
  });

  it("takes a typed score, and clears", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    const machine = await screen.findByRole("region", { name: "Playoff machine" });
    const game = within(machine).getByRole("group", { name: "Ducks at Aces" });

    await user.click(within(game).getByRole("button", { name: "Aces" }));
    await user.type(within(machine).getByLabelText("Ducks runs"), "0");
    await user.type(within(machine).getByLabelText("Aces runs"), "12");
    expect(within(machine).getByRole("table")).toBeInTheDocument();

    await user.click(within(machine).getByRole("button", { name: "Clear picks" }));
    expect(within(machine).queryByRole("table")).toBeNull();
    expect(within(game).getByRole("button", { name: "Sim" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
