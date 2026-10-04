import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type GameLog } from "../../types";
import type { SeasonSnapshot } from "../../storage";
import type { CloudManifest } from "../cloudManifest";
import type { LocalSource } from "../cloudLocal";
import type { LeagueValue } from "../leagueMerge";
import type { CloudAccount, FirebaseCloud } from "../firebaseCloud";
import { memoryCloud, memoryMembers, type MemoryCloud } from "./memoryCloud";
import { gcAuthorization } from "../../gcAuthorization";
import { memoryLeague } from "../../live/__tests__/memoryLeague";
import { writeLiveLeague } from "../../preferences";

/*
 * The cloud session end to end, with Firebase, the browser's stores and its other tabs stood in
 * for. Two devices share one stand-in copy, each with its own storage; the cases are the ones the
 * second review wrote down, where the first version lost somebody's work: scores entered on two
 * devices, a second device joining with data of its own, an edit made while a copy downloads, a
 * write that never reached the disk, a pull running, and a copy that is gone. Placeholder names.
 */

const pull = vi.hoisted(() => ({ live: false, elsewhere: false }));
vi.mock("../../pullSession", () => ({
  isPoolBusy: () => pull.live,
  poolJobElsewhere: async () => pull.elsewhere,
  watchPull: () => () => undefined,
}));
const tabs = vi.hoisted(() => ({ announced: 0 }));
vi.mock("../cloudTabs", () => ({
  announceTaken: () => {
    tabs.announced += 1;
  },
  reloadWhenFree: () => undefined,
}));

const session = await import("../cloudSession");
const { loadCloudState, loadLeagueBase, owedChanges, forgetCloudCopyHere } =
  await import("../cloudState");
const { resetCloudGuard } = await import("../cloudGuard");
const { areaOf } = await import("../cloudPlan");
const { isEmptyLeague } = await import("../leagueMerge");
const { fetchValues } = await import("../cloudEngine");
const { hashValue } = await import("../cloudPack");

const TEAMS = "league_forecast_scout_teams_v1";
const GROUPS = "league_forecast_scout_age_groups_v1";
const CADENCE = "league_forecast_gc_cadence_v1";

/** localStorage in memory, one per device. */
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

const season = (
  id: string,
  logs: Record<string, GameLog> = {},
  createdAt = "2026-08-01T00:00:00.000Z"
): SeasonSnapshot => ({
  id,
  name: `Season ${id}`,
  createdAt,
  teams: [
    { id: "t1", name: "Team one" },
    { id: "t2", name: "Team two" },
    { id: "t3", name: "Team three" },
    { id: "t4", name: "Team four" },
  ],
  matchups: [
    { id: "g1", date: "2026-10-01", away: "t1", home: "t2" },
    { id: "g2", date: "2026-10-01", away: "t3", home: "t4" },
  ],
  logs,
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS },
});

const league = (...seasons: SeasonSnapshot[]): LeagueValue => ({ seasons });
const fall = league(season("fall"));

type Device = {
  values: Map<string, unknown>;
  local: LocalSource;
  storage: Storage;
  notStored: Set<string>;
};

const device = (entries: Record<string, unknown>): Device => {
  const values = new Map<string, unknown>(Object.entries(entries));
  const notStored = new Set<string>();
  return {
    values,
    storage: memoryStorage(),
    notStored,
    local: {
      keys: (area) => [...values.keys()].filter((key) => areaOf(key) === area),
      read: async (key) => structuredClone(values.get(key) ?? null),
      apply: async (next) => {
        next.forEach((value, key) => {
          if (value === null) values.delete(key);
          else values.set(key, structuredClone(value));
        });
        return true;
      },
      usable: () => true,
      empty: (area) =>
        area === "league"
          ? isEmptyLeague((values.get("league") as LeagueValue | undefined) ?? null)
          : !values.has(TEAMS),
      flush: async () => true,
      notStored: () => notStored,
    },
  };
};

const ME: CloudAccount = { uid: "owner-1", email: "owner@example.test" };
const CONFIG = { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" };

let sky: MemoryCloud;
let skyLeague: ReturnType<typeof memoryLeague>;
let reloads = 0;
let clock = Date.parse("2026-09-29T12:00:00.000Z");

const firebaseFor = (account: CloudAccount | null): FirebaseCloud => {
  let current = account;
  return {
    account: async () => current,
    signIn: async () => (current = account),
    signOut: async () => {
      current = null;
    },
    onAccount: () => () => undefined,
    idToken: async () => (current ? `token-of-${current.uid}` : null),
    owns: async () => current?.uid === ME.uid,
    members: memoryMembers(
      [{ address: ME.email ?? "", role: "owner" }],
      () => current?.email ?? null
    ),
    store: sky.store,
    live: {
      readMeta: async () => ({ readAs: current?.uid ?? null }),
      getChunk: async (id) => new TextEncoder().encode(id),
      watchMeta: (heard) => {
        heard.next({ heardAs: current?.uid ?? null }, true);
        return () => undefined;
      },
    },
    league: skyLeague.store,
  };
};

/** Makes `one` the device the session runs as: its own storage, its own fresh session. */
const runAs = (one: Device, account: CloudAccount | null = ME) => {
  session.resetCloudSession();
  vi.stubGlobal("localStorage", one.storage);
  resetCloudGuard();
  session.setCloudTestHooks({
    openCloud: async () => firebaseFor(account),
    local: one.local,
    config: () => CONFIG,
    reload: () => {
      reloads += 1;
    },
    roomFor: async () => true,
  });
};

/** A minute passes. */
const later = (minutes = 1) => {
  clock += minutes * 60_000;
  vi.setSystemTime(clock);
};

/** A change made on the device the session runs as. */
const edit = (one: Device, key: string, value: unknown) => {
  if (value === null) one.values.delete(key);
  else one.values.set(key, value);
  session.noteChange(key);
};

/** Opens the app on `one`: its session, signed in from before. */
const open = async (one: Device) => {
  runAs(one);
  await session.bootCloud();
};

const logsOf = (one: Device, id = "fall") =>
  (one.values.get("league") as LeagueValue).seasons.find((s) => s.id === id)?.logs;

const cloudValue = async (key: string): Promise<unknown> => {
  const manifest = sky.manifest() as CloudManifest;
  const fetched = await fetchValues({
    store: sky.store,
    parts: manifest.parts.filter((part) => part.key === key),
  });
  return fetched.ok ? (fetched.values.get(key) ?? null) : "fetch failed";
};

const cloudLogs = async () => ((await cloudValue("league")) as LeagueValue).seasons[0]?.logs;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = Date.parse("2026-09-29T12:00:00.000Z");
  vi.setSystemTime(clock);
  sky = memoryCloud();
  skyLeague = memoryLeague();
  pull.live = false;
  pull.elsewhere = false;
  reloads = 0;
  tabs.announced = 0;
});

afterEach(() => {
  session.resetCloudSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The laptop, holding the data, signs in first; its copy becomes the cloud's. */
const laptopFirst = async (
  entries: Record<string, unknown> = { league: fall, [TEAMS]: ["laptop pool"] }
) => {
  const laptop = device(entries);
  runAs(laptop);
  await session.signInToCloud();
  return laptop;
};

describe("the first device to sign in", () => {
  it("sends everything it holds, League Standings and the pool, as the first copy", async () => {
    await laptopFirst();
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", TEAMS]);
    expect(loadCloudState()).toMatchObject({ enabled: true, uid: ME.uid, version: 1 });
    expect(loadCloudState().met).toEqual({
      league: sky.manifest()?.copy,
      pool: sky.manifest()?.copy,
    });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false, newer: [] });
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
  });
});

describe("a second device signing in", () => {
  it("takes League Standings at once, and the pool only when Team Rankings opens", async () => {
    await laptopFirst();
    const phone = device({});
    runAs(phone);
    await session.signInToCloud();
    expect(phone.values.get("league")).toEqual(fall);
    expect(phone.values.has(TEAMS)).toBe(false);
    expect(reloads).toBe(1);
    // Team Rankings opens: the pool arrives before it draws, without a reload.
    await session.preparePool();
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
    expect(reloads).toBe(1);
  });

  it("adds its own seasons to the copy, keeping apart a first season that only shares an id", async () => {
    await laptopFirst({ league: league(season("default", {}, "2026-08-01T00:00:00Z")) });
    const phone = device({
      league: league(season("default", { g1: log(3, 1) }, "2026-05-01T00:00:00Z")),
    });
    runAs(phone);
    await session.signInToCloud();
    const seasons = (phone.values.get("league") as LeagueValue).seasons;
    expect(seasons.map((one) => one.id)).toEqual(["default", "season-2"]);
    expect(seasons[1]?.logs).toEqual({ g1: log(3, 1) });
    expect(((await cloudValue("league")) as LeagueValue).seasons).toHaveLength(2);
  });

  it("keeps its own pool in the copy, where it can be brought back, and takes the copy's", async () => {
    await laptopFirst();
    const phone = device({ league: fall, [TEAMS]: ["phone's old pool"], [CADENCE]: "daily" });
    runAs(phone);
    await session.signInToCloud();
    await session.preparePool();
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
    expect(phone.values.has(CADENCE)).toBe(false);
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
    expect(session.cloudKept()).toMatchObject([
      { why: "lost", fromHere: true, what: ["Team Rankings"] },
    ]);
    expect(
      sky
        .manifest()
        ?.kept.map((part) => part.key)
        .sort()
    ).toEqual([CADENCE, TEAMS].sort());
  });

  it("is refused for an account the copy does not belong to, and changes nothing", async () => {
    await laptopFirst();
    const stranger = device({ league: league(season("theirs")) });
    runAs(stranger, { uid: "someone-else", email: null });
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner" });
    expect(sky.manifest()?.version).toBe(1);
  });
});

describe("the sign-in a GameChanger pull carries", () => {
  it("is the signed-in account's token, and none before signing in or after signing out", async () => {
    runAs(device({}));
    expect(await gcAuthorization()).toBeNull();
    await laptopFirst();
    expect(await gcAuthorization()).toBe(`token-of-${ME.uid}`);
    await session.signOutOfCloud();
    expect(await gcAuthorization()).toBeNull();
  });
});

describe("the list of who may use the copy", () => {
  it("is the owner's to read and change, through the session it signed in with", async () => {
    await laptopFirst();
    const addresses = async () => (await session.cloudMembers())?.map((member) => member.address);
    expect(await addresses()).toEqual([ME.email]);
    await session.addCloudMember("Coach@Example.test");
    expect(await addresses()).toEqual([ME.email, "coach@example.test"]);
    await session.removeCloudMember("coach@example.test");
    expect(await addresses()).toEqual([ME.email]);
  });

  it("is nothing to an account that is not its owner", async () => {
    await laptopFirst();
    runAs(device({}), { uid: "someone-else", email: "someone@example.test" });
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner" });
    expect(await session.cloudMembers()).toBeNull();
  });

  it("is not looked for before anyone signs in, and Firebase is not opened to look", async () => {
    runAs(device({}));
    const opened = vi.fn(async () => firebaseFor(ME));
    session.setCloudTestHooks({ openCloud: opened });
    expect(await session.cloudMembers()).toBeNull();
    await expect(session.addCloudMember("coach@example.test")).rejects.toThrow(/Sign in/);
    await expect(session.removeCloudMember("coach@example.test")).rejects.toThrow(/Sign in/);
    expect(opened).not.toHaveBeenCalled();
    // Firebase open, but the sign-in closed without an account: still nobody to ask as.
    runAs(device({}), null);
    await session.signInToCloud();
    expect(await session.cloudMembers()).toBeNull();
    await expect(session.addCloudMember("coach@example.test")).rejects.toThrow(/Sign in/);
    await expect(session.removeCloudMember("coach@example.test")).rejects.toThrow(/Sign in/);
  });
});

describe("the published boards, as this browser reads them", () => {
  it("are not read by a browser that keeps no copy, and Firebase is not opened to find that out", async () => {
    runAs(device({}));
    const opened = vi.fn(async () => firebaseFor(ME));
    session.setCloudTestHooks({ openCloud: opened });
    expect(await session.liveReader()).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });

  it("are read as the account this browser keeps a copy for, and by nobody else", async () => {
    const laptop = await laptopFirst();
    const reader = await session.liveReader();
    expect(await reader?.readMeta()).toEqual({ readAs: ME.uid });
    expect(await reader?.getChunk("abc-0")).toEqual(new TextEncoder().encode("abc-0"));
    // And listened to as that account, with no time limit: a watch says itself when it is cut off.
    const heard: unknown[] = [];
    reader?.watchMeta?.({ next: (raw) => heard.push(raw), error: () => undefined })();
    expect(heard).toEqual([{ heardAs: ME.uid }]);
    // Another account signed in to Firebase on this browser, whose record is still ME's.
    runAs(laptop, { uid: "someone-else", email: "someone@example.test" });
    expect(await session.liveReader()).toBeNull();
    // Nobody signed in at all.
    runAs(laptop, null);
    expect(await session.liveReader()).toBeNull();
    // Signed out: the record says this browser keeps no copy now.
    runAs(laptop);
    expect(await session.liveReader()).not.toBeNull();
    await session.signOutOfCloud();
    expect(await session.liveReader()).toBeNull();
  });
});

describe("the copy as this device last found it", () => {
  const seenOf = (manifest: CloudManifest | null) =>
    manifest && {
      copy: manifest.copy,
      version: manifest.version,
      parts: manifest.parts.map((part) => [part.key, part.hash]),
    };

  it("is the manifest this device's own save committed, and the next one it read", async () => {
    const { laptop, phone } = await inStep();
    expect(session.copySeen()).toEqual(seenOf(sky.manifest()));
    runAs(laptop);
    expect(session.copySeen()).toBeNull();
    await session.bootCloud();
    expect(session.copySeen()).toEqual(seenOf(sky.manifest()));
    edit(laptop, "league", league(season("fall", { g1: log(3, 2) })));
    await session.saveNow();
    const saved = sky.manifest();
    expect(saved?.version).toBe(2);
    expect(session.copySeen()).toEqual(seenOf(saved));
    // The phone, opened again, reads the laptop's save on its way in.
    await open(phone);
    expect(session.copySeen()).toEqual(seenOf(saved));
  });

  it("is forgotten on signing out and when the session starts again", async () => {
    await laptopFirst();
    expect(session.copySeen()).not.toBeNull();
    await session.signOutOfCloud();
    expect(session.copySeen()).toBeNull();
    await session.signInToCloud();
    expect(session.copySeen()).toEqual(seenOf(sky.manifest()));
    session.resetCloudSession();
    expect(session.copySeen()).toBeNull();
  });
});

/** Both devices in step with one copy, the phone having opened Team Rankings. */
const inStep = async () => {
  const laptop = await laptopFirst();
  const phone = device({});
  runAs(phone);
  await session.signInToCloud();
  await session.preparePool();
  reloads = 0;
  return { laptop, phone };
};

describe("changes on two devices", () => {
  it("keeps a score entered on each device for different games, and asks nothing", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    later();
    // The phone, still on the old seasons, enters another game's score, and next opens the app.
    runAs(phone);
    edit(phone, "league", league(season("fall", { g2: log(1, 7) })));
    await session.bootCloud();
    await session.saveNow();
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
    expect(await cloudLogs()).toEqual({ g1: log(5, 3), g2: log(1, 7) });
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(1, 7) });
    await open(laptop);
    expect(logsOf(laptop)).toEqual({ g1: log(5, 3), g2: log(1, 7) });
    expect(sky.manifest()?.kept).toEqual([]);
  });

  it("keeps the later of two different scores for one game, and the other in the copy", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, "league", league(season("fall", { g1: log(5, 3) })));
    later();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(6, 3) })));
    await session.saveNow();
    await open(phone);
    await session.saveNow();
    // The laptop's score was entered later.
    expect(logsOf(phone)).toEqual({ g1: log(6, 3) });
    expect(session.cloudStatus()).toMatchObject({
      notice: expect.stringContaining("later change"),
    });
    expect(session.cloudKept()).toMatchObject([
      { why: "lost", fromHere: true, what: ["League Standings"] },
    ]);
  });

  it("gives a pool key both changed to the later change, keeping the other", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, TEAMS, ["phone's edit"]);
    later();
    await open(laptop);
    edit(laptop, TEAMS, ["laptop's pull"]);
    await session.saveNow();
    await open(phone);
    await session.preparePool();
    expect(phone.values.get(TEAMS)).toEqual(["laptop's pull"]);
    expect(await cloudValue(TEAMS)).toEqual(["laptop's pull"]);
    expect(session.cloudKept()).toMatchObject([{ why: "lost", fromHere: true }]);
  });

  it("sees no conflict where both made the same change", async () => {
    const { laptop, phone } = await inStep();
    const same = league(season("fall", { g1: log(2, 2) }));
    runAs(phone);
    edit(phone, "league", same);
    await open(laptop);
    edit(laptop, "league", same);
    await session.saveNow();
    await open(phone);
    await session.saveNow();
    expect(sky.manifest()?.kept).toEqual([]);
    expect(owedChanges()).toEqual({});
  });
});

describe("an edit made while a copy downloads", () => {
  it("is not written over: it is merged with what arrived instead", async () => {
    const { phone } = await inStep();
    await open(phone);
    // Another device saves a score, straight into the copy, while the phone is open.
    const { commitChanges } = await import("../cloudEngine");
    await commitChanges({
      store: sky.store,
      base: sky.manifest(),
      changes: [
        { key: "league", value: league(season("fall", { g1: log(5, 3) })), at: Date.now() },
      ],
      device: "laptop",
      now: new Date().toISOString(),
    });
    const real = sky.store.getChunk;
    // The user enters a score on the phone while the laptop's arrives.
    sky.store.getChunk = async (id) => {
      sky.store.getChunk = real;
      edit(phone, "league", league(season("fall", { g2: log(0, 4) })));
      return real(id);
    };
    await session.loadNewer();
    expect(logsOf(phone)).toEqual({ g2: log(0, 4) });
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    await session.loadNewer();
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(0, 4) });
    expect(await cloudLogs()).toEqual({ g1: log(5, 3), g2: log(0, 4) });
  });
});

/** Holds every download of a piece until `release` is called: a copy arriving slowly. */
const holdDownloads = (): (() => void) => {
  const real = sky.store.getChunk;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  sky.store.getChunk = async (id) => {
    await held;
    return real(id);
  };
  return () => {
    sky.store.getChunk = real;
    release();
  };
};

/** The kept versions of `key` the copy holds, as values. */
const keptValues = async (key: string): Promise<unknown[]> => {
  const parts = (sky.manifest() as CloudManifest).kept.filter((part) => part.key === key);
  const fetched = await fetchValues({ store: sky.store, parts });
  return fetched.ok ? [...fetched.values.values()] : ["fetch failed"];
};

/** A page on screen: what `startCloudSession` listens to, as the test runs outside a browser. */
const onScreen = () => {
  const quiet = { addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal("document", { ...quiet, visibilityState: "visible" });
  vi.stubGlobal("window", quiet);
};

describe("Team Rankings drawn before its pool has arrived", () => {
  it("leaves what arrives to be asked for, so the view's next save keeps the other device's pool", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, TEAMS, ["laptop pool", "laptop's pull"]);
    await session.saveNow();
    await open(phone);
    const release = holdDownloads();
    const preparing = session.preparePool();
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ kind: "working" }));
    // "Show this device's copy now": the view draws on the pool this phone has.
    session.poolOnScreen();
    release();
    await preparing;
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
    expect(session.cloudStatus()).toMatchObject({ newer: ["pool"] });
    // The view, still holding the old pool, saves an edit of it: the later change wins, and the
    // laptop's pull is kept rather than lost.
    later();
    edit(phone, TEAMS, ["laptop pool", "phone's edit"]);
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool", "phone's edit"]);
    expect(await keptValues(TEAMS)).toEqual([["laptop pool", "laptop's pull"]]);
  });

  it("waits again for a pool still arriving when Team Rankings is left and opened again", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, TEAMS, ["laptop pool", "laptop's pull"]);
    await session.saveNow();
    await open(phone);
    const release = holdDownloads();
    const preparing = session.preparePool();
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ kind: "working" }));
    expect(session.poolWantsCloud()).toBe(true);
    expect(session.preparePool()).toBe(preparing);
    release();
    await preparing;
    expect(session.poolWantsCloud()).toBe(false);
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool", "laptop's pull"]);
  });

  it("is not told of a newer pool when Team Rankings has not been opened here", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, TEAMS, ["laptop pool", "laptop's pull"]);
    await session.saveNow();
    await open(phone);
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", newer: [] });
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
  });
});

describe("a save cut off waiting for its commit", () => {
  it("leaves its pieces for as long as the commit could still land, so a late landing is whole", async () => {
    const { laptop, phone } = await inStep();
    await open(phone);
    edit(phone, "league", league(season("fall", { g1: log(4, 4) })));
    // The commit stalls on the network past its limit, and lands later.
    const store = sky.store;
    const real = store.commitManifest;
    let land: () => void = () => undefined;
    let landed: Promise<boolean> | null = null;
    store.commitManifest = (expected, next) => {
      store.commitManifest = real;
      landed = new Promise<boolean>((resolve) => {
        land = () => resolve(real(expected, next));
      });
      return landed;
    };
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const cutOff = session.saveNow();
    await vi.waitFor(() => expect(landed).not.toBeNull());
    await vi.advanceTimersByTimeAsync(21_000);
    await cutOff;
    vi.useFakeTimers({ toFake: ["Date"] });
    expect(session.cloudStatus()).toMatchObject({ kind: "error" });
    // Saving again, the stalled commit lands while the new save uploads.
    const realPut = store.putChunk;
    store.putChunk = async (id, data) => {
      store.putChunk = realPut;
      land();
      await landed;
      return realPut(id, data);
    };
    await session.saveNow();
    later();
    await open(laptop);
    expect(await cloudLogs()).toEqual({ g1: log(4, 4) });
    expect(logsOf(laptop)).toEqual({ g1: log(4, 4) });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });
});

describe("League Standings found in step while a save runs", () => {
  it("keep as their base the version the copy holds, not an edit made meanwhile", async () => {
    const { laptop, phone } = await inStep();
    const scored = league(season("fall", { g1: log(5, 3) }));
    await open(laptop);
    edit(laptop, "league", scored);
    await session.saveNow();
    later();
    // The phone made the same change, and a pool change whose upload the user types through.
    runAs(phone);
    edit(phone, "league", scored);
    edit(phone, TEAMS, ["phone's pool edit"]);
    const real = sky.store.putChunk;
    sky.store.putChunk = async (id, data) => {
      sky.store.putChunk = real;
      edit(phone, "league", league(season("fall", { g1: log(5, 3), g2: log(1, 7) })));
      return real(id, data);
    };
    await session.signInToCloud();
    const base = loadLeagueBase();
    expect(base?.hash).toBe(await hashValue(scored));
    expect((base?.value as LeagueValue).seasons[0]?.logs).toEqual({ g1: log(5, 3) });
    // The laptop renames the season; the phone's unsent score survives the merge that follows.
    later();
    await open(laptop);
    edit(laptop, "league", league({ ...season("fall", { g1: log(5, 3) }), name: "Fall ball" }));
    await session.saveNow();
    later();
    await open(phone);
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(5, 3), g2: log(1, 7) });
  });
});

describe("League Standings with no season in them", () => {
  it("are never sent, since no device could take them", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    edit(laptop, "league", { seasons: [] });
    await session.saveNow();
    expect(await cloudLogs()).toEqual({});
    expect(((await cloudValue("league")) as LeagueValue).seasons).toHaveLength(1);
    expect(session.cloudStatus()).toMatchObject({ waiting: "unreadable" });
  });

  it("are left out of a first copy", async () => {
    await laptopFirst({ league: { seasons: [] }, [TEAMS]: ["laptop pool"] });
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual([TEAMS]);
  });
});

describe("a copy with a piece missing", () => {
  it("is not downloaded again at every look: looks back off as saves do", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(
      laptop,
      TEAMS,
      Array.from({ length: 5000 }, (_, i) => `team ${i}`)
    );
    edit(laptop, "league_forecast_scout_games_v2:2026", ["games 2026"]);
    await session.saveNow();
    const manifest = sky.manifest() as CloudManifest;
    const games = manifest.parts.find((part) => part.key === "league_forecast_scout_games_v2:2026");
    sky.chunks.delete(`${games?.id}-0`);
    await open(phone);
    await session.preparePool();
    expect(session.cloudStatus()).toMatchObject({ kind: "error" });
    const downloads: number[] = [];
    for (let look = 0; look < 5; look += 1) {
      later();
      const before = sky.costs.bytesDown;
      await session.lookAgain({ arriving: true });
      downloads.push(sky.costs.bytesDown - before);
    }
    expect(downloads.filter((bytes) => bytes > 0).length).toBeLessThanOrEqual(2);
  });
});

describe("an app already on screen", () => {
  it("does not take League Standings in under itself when its start is run again", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    runAs(phone);
    onScreen();
    const stop = session.startCloudSession();
    await session.bootCloud();
    expect(logsOf(phone)).toEqual({});
    expect(session.cloudStatus()).toMatchObject({ newer: ["league"] });
    stop();
  });

  it("merges and sends League Standings both devices changed when Save now is pressed", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    // The phone, open since before the laptop saved, enters another game's score.
    runAs(phone);
    onScreen();
    const stop = session.startCloudSession();
    edit(phone, "league", league(season("fall", { g2: log(1, 7) })));
    await session.bootCloud();
    await session.saveNow({ asked: true });
    expect(await cloudLogs()).toEqual({ g1: log(5, 3), g2: log(1, 7) });
    stop();
  });
});

describe("an edit made while a save uploads", () => {
  it("is still owed once the save lands, and goes with the next one", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(1, 0) })));
    const real = sky.store.putChunk;
    sky.store.putChunk = async (id, data) => {
      sky.store.putChunk = real;
      edit(laptop, "league", league(season("fall", { g1: log(1, 0), g2: log(2, 2) })));
      return real(id, data);
    };
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(1, 0) });
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(1, 0), g2: log(2, 2) });
    expect(owedChanges()).toEqual({});
  });
});

describe("a device short of storage", () => {
  it("takes none of the pool, and says why, before downloading any of it", async () => {
    await laptopFirst();
    const phone = device({});
    runAs(phone);
    await session.signInToCloud();
    session.setCloudTestHooks({ roomFor: async () => false });
    const before = sky.costs.bytesDown;
    await session.preparePool();
    expect(phone.values.has(TEAMS)).toBe(false);
    expect(sky.costs.bytesDown).toBe(before);
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("too short of storage"),
    });
  });
});

describe("startup", () => {
  it("takes another device's seasons before the app draws, with no reload", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3) });
    expect(reloads).toBe(0);
  });

  it("opens on this device's data when the seasons are slow, and says newer ones are there", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    runAs(phone);
    const real = sky.store.getChunk;
    let release: () => void = () => undefined;
    sky.store.getChunk = async (id) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      sky.store.getChunk = real;
      return real(id);
    };
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const booting = session.bootCloud();
    await vi.advanceTimersByTimeAsync(session.STARTUP_WAIT_MS + session.STARTUP_TAKE_MS + 1);
    await booting;
    vi.useFakeTimers({ toFake: ["Date"] });
    release();
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ newer: ["league"] }));
    expect(logsOf(phone)).toEqual({});
    await session.loadNewer();
    expect(logsOf(phone)).toEqual({ g1: log(5, 3) });
  });
});

describe("what cannot be sent", () => {
  it("waits for a pool value this device could not store, and sends the rest", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    edit(laptop, TEAMS, ["refused by the disk"]);
    edit(laptop, "league", league(season("fall", { g1: log(1, 0) })));
    laptop.notStored.add(TEAMS);
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
    expect(await cloudLogs()).toEqual({ g1: log(1, 0) });
    expect(Object.keys(owedChanges())).toEqual([TEAMS]);
    expect(session.cloudStatus()).toMatchObject({ waiting: "storage" });
    laptop.notStored.clear();
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["refused by the disk"]);
  });

  it("holds the pool back while a pull runs, and still saves the seasons", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    edit(laptop, TEAMS, ["half a pull"]);
    edit(laptop, "league", league(season("fall", { g2: log(3, 3) })));
    pull.live = true;
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
    expect(await cloudLogs()).toEqual({ g2: log(3, 3) });
    pull.live = false;
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["half a pull"]);
  });
});

describe("a copy this build must not touch", () => {
  it("is refused before anything downloads, when a newer build saved it", async () => {
    const { phone } = await inStep();
    const manifest = sky.manifest() as CloudManifest;
    sky.setManifest({ ...manifest, schema: manifest.schema + 1, version: manifest.version + 1 });
    runAs(phone);
    const before = sky.costs.bytesDown;
    await session.bootCloud();
    await session.loadNewer();
    expect(session.cloudStatus()).toMatchObject({ kind: "update" });
    expect(sky.costs.bytesDown).toBe(before);
  });

  it("is refused before anything downloads, when it names a key this build does not keep", async () => {
    const { phone } = await inStep();
    const manifest = sky.manifest() as CloudManifest;
    const [part] = manifest.parts;
    if (!part) throw new Error("no part");
    sky.setManifest({
      ...manifest,
      version: manifest.version + 1,
      parts: [...manifest.parts, { ...part, key: "league_forecast_new_v9" }],
    });
    runAs(phone);
    const before = sky.costs.bytesDown;
    await session.bootCloud();
    await session.loadNewer();
    expect(session.cloudStatus()).toMatchObject({ kind: "update" });
    expect(sky.costs.bytesDown).toBe(before);
  });
});

describe("a copy that is gone", () => {
  it("is said to be gone, and started again only when asked, as a new copy others meet", async () => {
    const { laptop, phone } = await inStep();
    const first = sky.manifest()?.copy;
    sky.setManifest(null);
    runAs(laptop);
    await session.bootCloud();
    edit(laptop, "league", league(season("fall", { g1: log(9, 0) })));
    await session.saveNow();
    expect(session.cloudStatus()).toMatchObject({ kind: "gone" });
    expect(sky.manifest()).toBeNull();
    await session.restartCloud();
    expect(sky.manifest()?.copy).not.toBe(first);
    // The phone meets it: its seasons join, and nothing of it is thrown away.
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(9, 0) });
  });
});

describe("signing out and back in", () => {
  it("records what changes meanwhile, and sends it on signing in again", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    await session.signOutOfCloud();
    edit(laptop, "league", league(season("fall", { g1: log(7, 7) })));
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    await session.signInToCloud();
    expect(await cloudLogs()).toEqual({ g1: log(7, 7) });
  });
});

describe("bringing a kept version back", () => {
  it("makes it current in the copy and here, keeping what it replaces", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, TEAMS, ["phone's edit"]);
    later();
    await open(laptop);
    edit(laptop, TEAMS, ["laptop's pull"]);
    await session.saveNow();
    await open(phone);
    await session.preparePool();
    const [version] = session.cloudKept();
    await session.bringBack(version?.group ?? "");
    expect(phone.values.get(TEAMS)).toEqual(["phone's edit"]);
    expect(await cloudValue(TEAMS)).toEqual(["phone's edit"]);
    expect(session.cloudKept()).toMatchObject([{ why: "replaced" }]);
    await open(laptop);
    await session.preparePool();
    expect(laptop.values.get(TEAMS)).toEqual(["phone's edit"]);
  });

  it("waits for a pull to finish before bringing Team Rankings back", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, TEAMS, ["phone's edit"]);
    later();
    await open(laptop);
    edit(laptop, TEAMS, ["laptop's pull"]);
    await session.saveNow();
    await open(phone);
    await session.preparePool();
    const version = sky.manifest()?.version;
    const [kept] = session.cloudKept();
    pull.live = true;
    await session.bringBack(kept?.group ?? "");
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("pull"),
    });
    expect(sky.manifest()?.version).toBe(version);
    expect(phone.values.get(TEAMS)).toEqual(["laptop's pull"]);
  });
});

describe("a tab that read its pool before another tab took a copy in", () => {
  // Without a word from the other tab (no BroadcastChannel), the stale tab still holds a key the
  // copy since deleted, and its own record no longer names it: it must not send it back up.
  it("sends none of its old pool, so a deletion it missed is not undone", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, CADENCE, "daily");
    await session.saveNow();
    await open(phone);
    await session.preparePool();
    expect(phone.values.get(CADENCE)).toBe("daily");
    // The laptop takes the cadence out of the copy.
    await open(laptop);
    edit(laptop, CADENCE, null);
    await session.saveNow();
    // Another tab on the phone takes that in: the phone's record and token move on, while this
    // tab's own view of the pool still holds the cadence.
    await open(phone);
    const record = loadCloudState();
    const { [CADENCE]: _gone, ...hashes } = record.hashes;
    phone.storage.setItem(
      "league_forecast_cloud_v2",
      JSON.stringify({ ...record, hashes, version: sky.manifest()?.version })
    );
    phone.storage.setItem("league_forecast_cloud_taken_pool", "another-tab");
    await session.lookAgain({ forced: true });
    expect(await cloudValue(CADENCE)).toBeNull();
  });
});

describe("a browser wiped by Delete everything", () => {
  it("stops keeping a cloud copy first, so the wiping is sent to nobody", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    forgetCloudCopyHere();
    edit(laptop, TEAMS, null);
    edit(laptop, GROUPS, null);
    expect(owedChanges()).toEqual({});
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
  });
});

describe("League Standings kept live on a device", () => {
  it("is neither sent to the copy nor taken from it, and owes it nothing", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    writeLiveLeague(true);
    const before = await cloudLogs();
    edit(laptop, "league", league(season("fall", { g1: log(9, 1) })));
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
    await session.saveNow();
    expect(await cloudLogs()).toEqual(before);
    // A device still on the copy changes League; the live one takes none of it in.
    runAs(phone);
    edit(phone, "league", league(season("fall", { g2: log(2, 2) })));
    await session.saveNow();
    await open(laptop);
    expect(logsOf(laptop)).toEqual({ g1: log(9, 1) });
    expect(reloads).toBe(0);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", newer: [] });
  });

  it("leaves League out of a first copy, which carries the pool alone", async () => {
    const laptop = device({ league: fall, [TEAMS]: ["laptop pool"] });
    runAs(laptop);
    writeLiveLeague(true);
    await session.signInToCloud();
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual([TEAMS]);
  });

  it("goes back to the copy when turned off, sending what changed meanwhile", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    writeLiveLeague(true);
    edit(laptop, "league", league(season("fall", { g1: log(4, 0) })));
    await session.saveNow();
    // Marked owed to the copy all along, and only not sent.
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    writeLiveLeague(false);
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(4, 0) });
  });
});
