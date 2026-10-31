import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import type { SeasonStore } from "./lib/seasonStore";
import { saveLook } from "./lib/sinceLastLook";
import { getActiveSeasonId, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * The list of what another device changed stays where it is while the "Since you last looked"
 * card's own file is fetched: drawn in the card's place until the file landed, it was drawn afresh
 * once it did, and a Got it pressed on the list as first drawn did nothing. Placeholder teams.
 */

beforeAll(() => prefetchAllViews());

const live = vi.hoisted(() => ({
  store: null as SeasonStore | null,
  state: { kind: "live" },
  listeners: new Set<() => void>(),
}));

vi.mock("./hooks/useLiveLeague", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    live.listeners.add(listener);
    return () => {
      live.listeners.delete(listener);
    };
  };
  return {
    useLiveLeague: ({ seasons }: { seasons: SeasonStore }) => {
      live.store = seasons;
      const state = useSyncExternalStore(subscribe, () => live.state);
      return { state, guardUndo: () => null, removeSeason: async () => true };
    },
  };
});

// The card's file, held back until the test lets it land.
const cardFile = vi.hoisted(() => {
  let land = () => {};
  const landed = new Promise<void>((resolve) => {
    land = resolve;
  });
  return { landed, land: () => land() };
});
vi.mock("./components/league/SinceLastLook", async (importOriginal) => {
  await cardFile.landed;
  return importOriginal();
});

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

describe("the list while the card's file is fetched", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
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
    live.store = null;
    live.state = { kind: "live" };
  });

  it("is the same list once the file lands, and its Got it puts it away", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    arrive({});
    arrive({ g1: final("4", "2") });
    const panel = (await screen.findByRole("heading", { name: "Since you last looked" })).closest(
      "section"
    );
    if (!panel) throw new Error("No panel");

    cardFile.land();
    await act(async () => {
      await import("./components/league/SinceLastLook");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(panel).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Got it" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Since you last looked" })).toBeNull()
    );
  });

  /*
   * The card's Got it takes as seen what the list said as the card came up, which the card stood
   * for. Taking the season as it stood at the press, it put away unshown another device's final
   * that came while the card was up, and no card or list ever told of it.
   */
  it("is hidden while the card is up, and lists what came meanwhile once the card is put away", async () => {
    // A last visit two days ago, with every team in another place than now.
    saveLook(getActiveSeasonId(), {
      v: 1,
      at: Date.now() - 2 * 24 * 3_600_000,
      places: { A: 9, B: 9, C: 9 },
      finals: [],
      chances: {},
    });
    cardFile.land();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    arrive({});
    const card = await screen.findByRole("region", { name: "Since you last looked" });
    arrive({ g1: final("4", "2") });
    expect(screen.getAllByRole("heading", { name: "Since you last looked" })).toHaveLength(1);

    await user.click(within(card).getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(card).not.toBeInTheDocument());
    const panel = (await screen.findByRole("heading", { name: "Since you last looked" })).closest(
      "section"
    );
    if (!panel) throw new Error("No panel");
    expect(panel).toHaveTextContent("Aces at Bears: final, 4–2.");

    await user.click(within(panel).getByRole("button", { name: "Got it" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Since you last looked" })).toBeNull()
    );
  });
});
