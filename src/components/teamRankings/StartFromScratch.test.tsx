import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import {
  initTeamRankingsStore,
  loadDroppedClubs,
  loadScoutTeams,
  saveDroppedClubs,
  type PoolStoreIo,
} from "../../lib/teamRankingsStorage";

/** What was left in `localStorage` at the moment the page was told to start again. */
let leftAtReload: string[] | null = null;
const reloaded = vi.hoisted(() => vi.fn());
vi.mock("../../lib/resetApp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/resetApp")>()),
  reloadApp: reloaded,
}));

beforeEach(() => {
  leftAtReload = null;
  reloaded.mockReset();
  reloaded.mockImplementation(() => {
    leftAtReload = Object.keys(window.localStorage);
  });
});

const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
  games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
});

/** Everything else the app keeps: a League Standings season, a setting, a decision. */
const keepMore = () => {
  window.localStorage.setItem("league_seasons_v2", JSON.stringify([{ id: "fall2026" }]));
  window.localStorage.setItem("nkb_theme_v1", JSON.stringify("dark"));
  saveDroppedClubs(new Set(["gcTHROWNOUT1"]));
};

const pressReset = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
  await user.click(screen.getByRole("button", { name: "Delete everything in the app" }));
};

/** A store over a map, as IndexedDB would be, that refuses to let go of `stuck`. */
const stubbornIo = (store: Map<string, unknown>, stuck: string): PoolStoreIo => ({
  keys: async () => [...store.keys()],
  get: async (key) => store.get(key) ?? null,
  set: async (key, value) => {
    store.set(key, value);
    return true;
  },
  remove: async (key) => {
    if (key !== stuck) store.delete(key);
  },
  readLocal: () => null,
  clearLocal: () => {},
});

describe("starting from scratch", () => {
  it("deletes everything the app keeps, League Standings too, and starts the app again", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    keepMore();

    await pressReset(user);

    await waitFor(() => expect(reloaded).toHaveBeenCalledTimes(1));
    expect(harness.requestConfirmation).toHaveBeenCalledTimes(1);
    expect(leftAtReload).toEqual([]);
    expect(loadScoutTeams()).toEqual([]);
    expect(loadDroppedClubs().size).toBe(0);
  });

  it("deletes nothing when the pool's store cannot be reached, and says so", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    keepMore();
    // The note says the pool moved to IndexedDB, and jsdom has none to open.
    window.localStorage.setItem("league_forecast_pool_in_idb_v1", "1");
    await initTeamRankingsStore();

    await pressReset(user);

    await waitFor(() => expect(harness.toasts().join()).toMatch(/nothing was deleted/));
    expect(reloaded).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("league_seasons_v2")).not.toBeNull();
  });

  it("says the reset did not finish when the store keeps part of the pool", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    const store = new Map<string, unknown>();
    const stuck = "league_forecast_something_retired_v0";
    await initTeamRankingsStore(stubbornIo(store, stuck));
    store.set(stuck, { old: true });
    keepMore();

    await pressReset(user);

    await waitFor(() => expect(harness.toasts().join()).toMatch(/did not finish/));
    expect(reloaded).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("league_seasons_v2")).not.toBeNull();
  });
});
