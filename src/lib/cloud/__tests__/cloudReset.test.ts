import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type GameLog } from "../../types";
import type { SeasonSnapshot } from "../../storage";
import type { FirebaseCloud } from "../firebaseCloud";
import type { LeagueValue } from "../leagueMerge";
import { memoryCloud, memoryMembers } from "./memoryCloud";
import { memoryLeague } from "../../live/__tests__/memoryLeague";

/*
 * Delete everything, pressed while a save is on its way: the save must not send what it reads from
 * the emptied store as the user's data, nor write what it downloads back into it. With the app's
 * own stores, since what a wiped store reads back as is the point. Placeholder names.
 */

vi.mock("../../pullSession", () => ({
  isPoolBusy: () => false,
  poolJobElsewhere: async () => false,
  watchPull: () => () => undefined,
}));
vi.mock("../cloudTabs", () => ({
  announceTaken: () => undefined,
  reloadWhenFree: () => undefined,
}));

const session = await import("../cloudSession");
const { resetCloudGuard, markTaken } = await import("../cloudGuard");
const { markCloudDirty } = await import("../cloudState");
const { commitChanges, fetchValues } = await import("../cloudEngine");
const { readLeagueSnapshot, replaceLeagueSnapshot, saveTeams } = await import("../../storage");
const { resetApp } = await import("../../resetApp");
const { resetTeamRankingsStore, saveScoutTeams } = await import("../../teamRankingsStorage");

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (at: number) => [...items.keys()][at] ?? null,
    get length() {
      return items.size;
    },
  };
};

const log = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const fall: SeasonSnapshot = {
  id: "fall",
  name: "Fall",
  createdAt: "2026-08-01T00:00:00.000Z",
  teams: [
    { id: "t1", name: "Team one" },
    { id: "t2", name: "Team two" },
  ],
  matchups: [{ id: "g1", date: "2026-10-01", away: "t1", home: "t2" }],
  logs: { g1: log(5, 3) },
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS },
};

const ME = { uid: "owner-1", email: "owner@example.test" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-09-29T12:00:00.000Z"));
  resetTeamRankingsStore();
});

afterEach(() => {
  session.resetCloudSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * This browser signed in and in step with its copy, owing an edit, when Delete everything is
 * pressed: while its save downloads the other device's change, or while it commits its own.
 */
const saveCaughtByReset = async ({
  tookCopy = false,
  during = "download",
}: {
  tookCopy?: boolean;
  during?: "download" | "commit";
}) => {
  const storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  resetCloudGuard();
  const sky = memoryCloud();
  const cloud: FirebaseCloud = {
    account: async () => ME,
    signIn: async () => ME,
    signOut: async () => undefined,
    onAccount: () => () => undefined,
    idToken: async () => "token-of-owner",
    owns: async () => true,
    members: memoryMembers([], () => ME.email),
    store: sky.store,
    live: { readMeta: async () => null, getChunk: async () => null },
    league: memoryLeague().store,
  };
  session.resetCloudSession();
  session.setCloudTestHooks({
    openCloud: async () => cloud,
    config: () => ({ apiKey: "k", authDomain: "d", projectId: "p", appId: "a" }),
    reload: () => undefined,
    roomFor: async () => true,
  });
  replaceLeagueSnapshot({ activeSeasonId: "fall", seasons: [fall] });
  await session.signInToCloud();
  if (tookCopy) markTaken("league", true);
  if (during === "commit") {
    // Another device rescores a game, and this browser owes a pool edit: the seasons arrive in
    // this save, and the reset lands between its commit and the write.
    await commitChanges({
      store: sky.store,
      base: sky.manifest(),
      changes: [
        {
          key: "league",
          value: { seasons: [{ ...fall, logs: { g1: log(6, 3) } }] },
          at: Date.now(),
        },
      ],
      device: "laptop",
      now: new Date().toISOString(),
    });
    saveScoutTeams([{ id: "a", name: "Hawks" }]);
    markCloudDirty("league_forecast_scout_teams_v1");
    const commit = sky.store.commitManifest;
    sky.store.commitManifest = async (expected, next) => {
      sky.store.commitManifest = commit;
      expect(await resetApp(storage)).toBe("done");
      return commit(expected, next);
    };
    await session.saveNow();
  } else {
    // Another device changes the pool, and this browser owes a League Standings edit.
    await commitChanges({
      store: sky.store,
      base: sky.manifest(),
      changes: [
        {
          key: "league_forecast_scout_teams_v1",
          value: Array.from({ length: 2000 }, (_, i) => `t${i}`),
          at: Date.now(),
        },
      ],
      device: "laptop",
      now: new Date().toISOString(),
    });
    saveTeams([
      ...(readLeagueSnapshot().seasons[0]?.teams ?? []),
      { id: "t3", name: "Team three" },
    ]);
    markCloudDirty("league");
    session.poolOnScreen();
    const real = sky.store.getChunk;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    sky.store.getChunk = async (id) => {
      await held;
      return real(id);
    };
    const saving = session.saveNow();
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ kind: "working" }));
    expect(await resetApp(storage)).toBe("done");
    release();
    sky.store.getChunk = real;
    await saving;
  }
  const manifest = sky.manifest();
  const fetched = await fetchValues({
    store: sky.store,
    parts: manifest?.parts.filter((part) => part.key === "league") ?? [],
  });
  return {
    seasons: fetched.ok ? (fetched.values.get("league") as LeagueValue).seasons : null,
    kept: manifest?.kept ?? [],
    here: readLeagueSnapshot().seasons,
  };
};

describe("Delete everything while a save is on its way", () => {
  it("sends nothing of the emptied browser, and writes nothing into it", async () => {
    const after = await saveCaughtByReset({ tookCopy: false });
    expect(after.seasons?.map((season) => [season.id, season.logs])).toEqual([
      ["fall", { g1: log(5, 3) }],
    ]);
    expect(after.kept).toEqual([]);
    expect(after.here.some((season) => season.id === "fall")).toBe(false);
  });

  it("leaves the copy's seasons whole in a tab that took a copy in, where a write was refused", async () => {
    const after = await saveCaughtByReset({ tookCopy: true });
    expect(after.seasons?.map((season) => season.id)).toEqual(["fall"]);
  });

  it("writes nothing it downloaded into a store emptied while its commit was on its way", async () => {
    const after = await saveCaughtByReset({ during: "commit" });
    expect(after.here.some((season) => season.id === "fall")).toBe(false);
  });
});
