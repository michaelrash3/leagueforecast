import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import type { SeasonStore } from "./lib/seasonStore";
import { saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * What another device changed, on the page (2.6): League kept live hears another device's final,
 * and the Dashboard says so above everything else, with a count on its tab, until "Got it".
 * Placeholder teams.
 */

beforeAll(() => prefetchAllViews());

const live = vi.hoisted(() => ({ store: null as SeasonStore | null }));

vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: ({ seasons }: { seasons: SeasonStore }) => {
    live.store = seasons;
    return { state: { kind: "live" }, guardUndo: () => null, removeSeason: async () => true };
  },
}));

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

/** The season as another device has it, laid over this one's as League kept live does. */
const arrive = (logs: Record<string, GameLog>) =>
  act(() => {
    const store = live.store;
    if (!store) throw new Error("No season store");
    store.apply({ ...store.get().season, logs });
  });

describe("what another device changed", () => {
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
      { id: "g1", date: "2026-05-02", away: "A", home: "B" },
      { id: "g2", date: "2026-05-09", away: "B", home: "C" },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    live.store = null;
  });

  it("leads the Dashboard, counted on its tab, until it is seen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    // The cloud's first word on a season this device never looked at is where it starts.
    arrive({});
    expect(screen.queryByRole("heading", { name: "Since you last looked" })).toBeNull();

    arrive({ g1: final("4", "2") });
    const panel = (await screen.findByRole("heading", { name: "Since you last looked" })).closest(
      "section"
    );
    if (!panel) throw new Error("No panel");
    expect(within(panel).getByText("1 new final.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Aces at Bears: final, 4–2." })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAccessibleDescription(
      "1 change since you last looked"
    );

    await user.click(within(panel).getByRole("button", { name: "Got it" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Since you last looked" })).toBeNull()
    );
    expect(screen.getByRole("tab", { name: "Dashboard" })).not.toHaveAccessibleDescription();
  });

  it("opens the game a change is about", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    arrive({});
    arrive({ g2: final("1", "3") });
    await user.click(await screen.findByRole("button", { name: "Bears at Comets: final, 1–3." }));
    expect(
      await screen.findByRole("tab", { name: "Schedule", selected: true })
    ).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("game-card-g2")).not.toBeNull());
  });
});
