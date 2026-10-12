import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * "Why 64%?" on the Dashboard (2.8): each upcoming prediction says why its odds are what they are,
 * the explanation fetched the first time one is opened. Placeholder teams.
 */

beforeAll(() => prefetchAllViews());

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

describe("the Dashboard's predictions", () => {
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
      { id: "g1", date: "5/2", away: "A", home: "B" },
      { id: "g2", date: "5/9", away: "B", home: "C" },
      { id: "g3", date: "5/16", away: "C", home: "A" },
      { id: "g4", date: "5/23", away: "A", home: "B" },
    ]);
    saveLogs({ g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("say why their odds are what they are, on request", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Dashboard" }));
    const card = (await screen.findByRole("heading", { name: "Aces vs Bears" })).closest("article");
    if (!card) throw new Error("No prediction card");
    const why = within(card).getByRole("button", { name: /^Why Aces at \d+%\?$/ });
    expect(why).toHaveAttribute("aria-expanded", "false");
    await user.click(why);
    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(await within(card).findByText("For Aces:")).toBeInTheDocument();
    expect(within(card).getByText(/^Projected margin: Aces by/)).toBeInTheDocument();
    expect(within(card).getByText("Confidence:")).toBeInTheDocument();

    // The per-game model behind the Schedule's odds is read beside the rating's.
    await user.click(within(card).getByRole("button", { name: "Every factor" }));
    expect(
      within(card).getByText(/gives Aces \d+% and Bears \d+%\.$/, { selector: "li" })
    ).toBeInTheDocument();

    await user.click(why);
    expect(within(card).queryByText("For Aces:")).toBeNull();
  });

  it("offer no explanation before the model has a final to go on", async () => {
    saveLogs({});
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Dashboard" }));
    const card = (await screen.findByRole("heading", { name: "Aces vs Bears" })).closest("article");
    if (!card) throw new Error("No prediction card");
    expect(within(card).queryByRole("button", { name: /^Why/ })).toBeNull();
  });
});
