import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { useSeasonDigest } from "./hooks/useSeasonDigest";
import { DEFAULT_NOTIFY, type NotifyPrefs } from "./lib/seasonDigest";
import type { SeasonStore } from "./lib/seasonStore";
import { loadSettings, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * What another device changed, on the page (2.6): League kept live hears another device's final,
 * and the Dashboard says so above everything else, with a count on its tab, until "Got it".
 * Placeholder teams.
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

// The digest as App drives it, watched for what it is asked to count.
vi.mock("./hooks/useSeasonDigest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks/useSeasonDigest")>();
  return { ...actual, useSeasonDigest: vi.fn(actual.useSeasonDigest) };
});

/** League kept live says where it stands, as `useLiveLeague` would. */
const tell = (kind: string) =>
  act(() => {
    live.state = { kind };
    live.listeners.forEach((listener) => listener());
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
    live.state = { kind: "live" };
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

  it("starts looking when League first hears the cloud, though it brought nothing new", async () => {
    live.state = { kind: "connecting" };
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    // The cloud held what this device did: no arrival, but word from the cloud all the same.
    tell("live");
    arrive({ g1: final("4", "2") });
    expect(
      await screen.findByRole("heading", { name: "Since you last looked" })
    ).toBeInTheDocument();
  });

  it("follows notification choices changed in another tab", async () => {
    const user = userEvent.setup();
    const on = { ...DEFAULT_NOTIFY, on: true };
    window.localStorage.setItem("lf_league_notify_v1", JSON.stringify(on));
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const toggle = await screen.findByRole("checkbox", { name: "Notify this device" });
    expect(toggle).toBeChecked();
    // Turned off in the installed app beside this tab: the browser tells this one.
    act(() => {
      window.localStorage.setItem("lf_league_notify_v1", JSON.stringify({ ...on, on: false }));
      window.dispatchEvent(new StorageEvent("storage", { key: "lf_league_notify_v1" }));
    });
    expect(toggle).not.toBeChecked();
  });

  it("counts the odds by 10 points while notifications are off, and by the points chosen while on", async () => {
    const asked = () => vi.mocked(useSeasonDigest).mock.lastCall?.[0].oddsMove;
    /** Notification choices changed in the installed app beside this tab, which follows them. */
    const choose = (prefs: NotifyPrefs) =>
      act(() => {
        window.localStorage.setItem("lf_league_notify_v1", JSON.stringify(prefs));
        window.dispatchEvent(new StorageEvent("storage", { key: "lf_league_notify_v1" }));
      });
    render(<App />);
    await screen.findByRole("tab", { name: "Dashboard" });
    // Off, the choice of points shows its default of 15, which is not what the digest counts by.
    expect(asked()).toBe(10);
    choose({ ...DEFAULT_NOTIFY, on: true, oddsMove: 20 });
    expect(asked()).toBe(20);
    choose({ ...DEFAULT_NOTIFY, on: true, oddsMove: null });
    expect(asked()).toBe(10);
  });

  it("takes the race the cloud's first word settles, not the forecast still on screen", async () => {
    const user = userEvent.setup();
    saveSettings({ ...loadSettings(), goldCutoff: 1 });
    saveMatchups([
      { id: "g1", date: "2026-05-02", away: "A", home: "B" },
      { id: "g2", date: "2026-05-09", away: "B", home: "C" },
      { id: "g3", date: "2026-05-16", away: "C", home: "A" },
    ]);
    live.state = { kind: "connecting" };
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    // The forecast of the copy held here, every team still alive for the one place.
    await waitFor(() => expect(screen.getAllByText(/^[1-9]\d?%$/).length).toBeGreaterThan(0));
    // The cloud's first word: another device renamed a team and scored every game, which decides
    // the race. The forecast drawn the moment it lands is still the one from before the scores.
    act(() => {
      const store = live.store;
      if (!store) throw new Error("No season store");
      store.apply({
        ...store.get().season,
        teams: [
          { id: "A", name: "Aces" },
          { id: "B", name: "Bruins" },
          { id: "C", name: "Comets" },
        ],
        logs: { g1: final("4", "2"), g2: final("3", "1"), g3: final("0", "5") },
      });
    });
    await screen.findAllByText("100%");
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
