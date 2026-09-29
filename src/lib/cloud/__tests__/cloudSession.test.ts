import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStore, LocalSource } from "../cloudEngine";
import type { CloudManifest } from "../cloudManifest";
import type { CloudAccount, FirebaseCloud } from "../firebaseCloud";

/*
 * The cloud session end to end, with Firebase, the browser's stores and its other tabs stood in
 * for: signing in for the first time, a second device taking the copy, merging changes made on two
 * devices, the question when they changed the same thing, saves held back while a pull runs here
 * or in another tab, and a device that cannot read its own storage syncing nothing.
 */

const pull = vi.hoisted(() => ({
  live: false,
  elsewhere: false,
  listeners: new Set<() => void>(),
}));
vi.mock("../../pullSession", () => ({
  isPoolBusy: () => pull.live,
  poolJobElsewhere: async () => pull.elsewhere,
  watchPull: (listener: () => void) => {
    pull.listeners.add(listener);
    return () => pull.listeners.delete(listener);
  },
}));

const session = await import("../cloudSession");
const { loadCloudState } = await import("../cloudState");

/** localStorage in memory; the session keeps this browser's cloud state there. */
const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
};

/** The account the rules name as the copy's owner. */
const OWNER_UID = "owner-1";

/** One Firestore, shared by every device in a test. */
const firestore = () => {
  let manifest: CloudManifest | null = null;
  const chunks = new Map<string, Uint8Array>();
  const store: CloudStore = {
    readManifest: async () => (manifest ? structuredClone(manifest) : null),
    commitManifest: async (expected, next) => {
      if ((manifest?.version ?? null) !== expected) return false;
      manifest = structuredClone(next);
      return true;
    },
    putChunk: async (id, data) => void chunks.set(id, new Uint8Array(data)),
    getChunk: async (id) => chunks.get(id) ?? null,
    deleteChunk: async (id) => void chunks.delete(id),
  };
  /** A device's view of it, signed in as `account` (null: signed out). */
  const as = (account: CloudAccount | null): FirebaseCloud => {
    let current = account;
    return {
      account: async () => current,
      signIn: async () => (current = account),
      signOut: async () => {
        current = null;
      },
      onAccount: () => () => undefined,
      owns: async () => current?.uid === OWNER_UID,
      store,
    };
  };
  return {
    as,
    manifest: () => manifest,
    store,
    /** The copy deleted in the console. */
    wipe: () => {
      manifest = null;
      chunks.clear();
    },
  };
};

const device = (entries: Record<string, unknown>) => {
  const values = new Map<string, unknown>(Object.entries(entries));
  const local: LocalSource = {
    keys: () => [...values.keys()],
    read: async (key) => values.get(key) ?? null,
    apply: async (next) => {
      next.forEach((value, key) => {
        if (value === null) values.delete(key);
        else values.set(key, value);
      });
      return true;
    },
    usable: () => true,
  };
  return { local, values };
};

const ME: CloudAccount = { uid: OWNER_UID, email: "owner@example.test" };
const CONFIG = { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" };

let reloads = 0;
let announced = 0;
const connect = (
  cloud: FirebaseCloud,
  local: ReturnType<typeof device>,
  holdsNothing = () => local.values.size === 0
) => {
  session.setCloudTestHooks({
    openCloud: async () => cloud,
    local: local.local,
    holdsNothing,
    config: () => CONFIG,
    reload: () => {
      reloads += 1;
    },
    tabs: {
      announce: () => {
        announced += 1;
      },
      listen: () => () => undefined,
    },
  });
};

/** A second device is a second browser: its own localStorage, and a fresh session. */
const switchDevice = () => {
  session.resetCloudSession();
  vi.stubGlobal("localStorage", memoryStorage());
};

beforeEach(() => {
  pull.live = false;
  pull.elsewhere = false;
  pull.listeners.clear();
  reloads = 0;
  announced = 0;
  switchDevice();
});

afterEach(() => {
  session.resetCloudSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const league = { seasons: [{ id: "s1", teams: ["Hawks"] }] };
const teams = { r: [["t1", "Hawks"]] };

/** The laptop signs in with data, then the phone signs in holding nothing and takes it. */
const twoDevices = async () => {
  const sky = firestore();
  const laptop = device({ league, teams });
  connect(sky.as(ME), laptop);
  await session.signInToCloud();
  const laptopStorage = localStorage;
  switchDevice();
  const phone = device({});
  connect(sky.as(ME), phone);
  await session.signInToCloud();
  const phoneStorage = localStorage;
  reloads = 0;
  /** Makes `which` the device the session runs as, with its own storage. */
  const on = (which: "laptop" | "phone") => {
    session.resetCloudSession();
    vi.stubGlobal("localStorage", which === "laptop" ? laptopStorage : phoneStorage);
    connect(sky.as(ME), which === "laptop" ? laptop : phone);
    announced = 0;
  };
  /** A change made on `which` and saved, with the app open there. */
  const saveOn = async (which: "laptop" | "phone", key: string, value: unknown) => {
    on(which);
    await session.bootCloud();
    (which === "laptop" ? laptop : phone).values.set(key, value);
    session.noteChange(key);
    await session.saveNow();
  };
  return { sky, laptop, phone, on, saveOn };
};

describe("signing in for the first time", () => {
  it("sends everything from a device with data to an empty cloud", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(loadCloudState()).toMatchObject({ enabled: true, version: 1, dirty: {} });
    expect(loadCloudState().copy).toBe(sky.manifest()?.copy);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
  });

  it("brings the copy to a device with nothing, and reloads to show it", async () => {
    const { phone } = await twoDevices();
    expect(Object.fromEntries(phone.values)).toEqual({ league, teams });
    expect(loadCloudState().version).toBe(1);
  });

  it("asks which copy wins when both have different data, saying what the cloud would lose", async () => {
    const sky = firestore();
    connect(sky.as(ME), device({ league, teams }));
    await session.signInToCloud();

    switchDevice();
    const other = device({ league: { mine: true } });
    connect(sky.as(ME), other);
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({
      kind: "choose",
      firstTime: true,
      cloudOnly: { labels: ["Team Rankings data"] },
    });
    // Nothing moved in either direction while the question is open.
    expect(other.values.get("league")).toEqual({ mine: true });
    expect(sky.manifest()?.version).toBe(1);
  });

  it("does not ask when both copies are the same", async () => {
    const sky = firestore();
    connect(sky.as(ME), device({ league, teams }));
    await session.signInToCloud();

    switchDevice();
    connect(sky.as(ME), device({ league, teams }));
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    expect(loadCloudState().version).toBe(1);
  });

  it("is refused for an account that is not the copy's owner", async () => {
    const sky = firestore();
    connect(sky.as(ME), device({ league }));
    await session.signInToCloud();

    switchDevice();
    const stranger = device({ league: { theirs: true } });
    connect(sky.as({ uid: "stranger", email: null }), stranger);
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner" });
    expect(sky.manifest()?.version).toBe(1);
  });
});

describe("a sign-in that does not finish", () => {
  const refusing = (code: string): FirebaseCloud => ({
    ...firestore().as(ME),
    signIn: async () => {
      throw Object.assign(new Error(`Firebase: Error (${code}).`), { code });
    },
  });

  it("leaves things as they were when the window is closed", async () => {
    connect(refusing("auth/popup-closed-by-user"), device({ league }));
    await session.signInToCloud();
    expect(session.cloudStatus()).toEqual({ kind: "signed-out" });
    expect(loadCloudState().enabled).toBe(false);
  });

  it("says how to let the window open when the browser blocks it", async () => {
    connect(refusing("auth/popup-blocked"), device({ league }));
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      account: null,
      message: expect.stringContaining("Allow pop-ups"),
    });
  });

  it("names the Firebase setting when the site is not allowed to sign in", async () => {
    connect(refusing("auth/unauthorized-domain"), device({ league }));
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("Authorized domains"),
    });
  });
});

describe("the answer to which copy wins", () => {
  const conflicted = async () => {
    const sky = firestore();
    connect(sky.as(ME), device({ league, teams }));
    await session.signInToCloud();
    switchDevice();
    const other = device({ league: { mine: true } });
    connect(sky.as(ME), other);
    await session.signInToCloud();
    return { sky, other };
  };

  it("this device's replaces the cloud copy", async () => {
    const { sky } = await conflicted();
    const copy = sky.manifest()?.copy;
    await session.chooseCopy("device");
    expect(sky.manifest()).toMatchObject({ version: 2, copy });
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league"]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });

  it("the cloud's replaces this device's, the page reloads, and other tabs are told", async () => {
    const { other } = await conflicted();
    await session.chooseCopy("cloud");
    expect(Object.fromEntries(other.values)).toEqual({ league, teams });
    expect(reloads).toBe(1);
    expect(announced).toBe(1);
  });

  it("keeps a change made while the cloud's copy downloads owed", async () => {
    const { sky } = await conflicted();
    const getChunk = sky.store.getChunk;
    sky.store.getChunk = async (id) => {
      // An edit lands in the middle of the download.
      session.noteChange("teams");
      return getChunk(id);
    };
    await session.chooseCopy("cloud");
    expect(Object.keys(loadCloudState().dirty)).toEqual(["teams"]);
  });
});

describe("opening the app on a device that keeps a copy", () => {
  it("takes another device's save before anything is drawn, without a reload", async () => {
    const { phone, on, saveOn } = await twoDevices();
    await saveOn("laptop", "league", { seasons: [{ id: "s2" }] });

    on("phone");
    const lines: string[] = [];
    await session.bootCloud((line) => lines.push(line));
    expect(phone.values.get("league")).toEqual({ seasons: [{ id: "s2" }] });
    expect(reloads).toBe(0);
    expect(announced).toBe(1);
    expect(lines.some((line) => line.startsWith("Loading your data from the cloud"))).toBe(true);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });

  it("merges when the two devices changed different things", async () => {
    const { sky, laptop, on, saveOn } = await twoDevices();
    await saveOn("phone", "teams", { r: [] });

    // The laptop changed the seasons and never sent them.
    on("laptop");
    laptop.values.set("league", { seasons: ["unsent"] });
    session.noteChange("league");
    session.resetCloudSession();
    connect(sky.as(ME), laptop);
    await session.bootCloud();
    expect(laptop.values.get("teams")).toEqual({ r: [] });
    expect(laptop.values.get("league")).toEqual({ seasons: ["unsent"] });
    expect(Object.keys(loadCloudState().dirty)).toEqual(["league"]);

    // Version 1 was the laptop's first save, 2 the phone's teams, 3 the laptop's seasons.
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(3);
    expect(loadCloudState()).toMatchObject({ version: 3, dirty: {} });
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
  });

  it("asks when both changed the same thing, and changes nothing until answered", async () => {
    const { sky, laptop, on, saveOn } = await twoDevices();
    await saveOn("phone", "league", { seasons: ["phone"] });

    on("laptop");
    laptop.values.set("league", { seasons: ["laptop"] });
    session.noteChange("league");
    session.resetCloudSession();
    connect(sky.as(ME), laptop);
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({
      kind: "choose",
      firstTime: false,
      cloudOnly: { labels: [], bytes: 0 },
    });
    expect(laptop.values.get("league")).toEqual({ seasons: ["laptop"] });
    expect(sky.manifest()?.version).toBe(2);
  });

  it("stops at a copy that is gone, and starts it again only when asked", async () => {
    const { sky, laptop, on } = await twoDevices();
    const oldCopy = sky.manifest()?.copy;
    sky.wipe();

    on("laptop");
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "gone" });
    expect(sky.manifest()).toBeNull();
    laptop.values.set("league", { seasons: ["edited"] });
    session.noteChange("league");
    await session.saveNow();
    expect(sky.manifest()).toBeNull();

    await session.restartCloud();
    expect(sky.manifest()).toMatchObject({ version: 1 });
    expect(sky.manifest()?.copy).not.toBe(oldCopy);

    // The phone knew the old copy: it is asked, not handed the new one.
    on("phone");
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "choose", firstTime: true });
  });

  it("syncs nothing from a browser that cannot read its own storage", async () => {
    const { sky, laptop, on } = await twoDevices();
    on("laptop");
    laptop.local.usable = () => false;
    laptop.values.delete("teams");
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("not syncing"),
    });
    session.noteChange("league");
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(1);
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
  });

  it("says signed out, and touches nothing, when the account is gone", async () => {
    const sky = firestore();
    const laptop = device({ league });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    session.resetCloudSession();
    connect(sky.as(null), laptop);
    await session.bootCloud();
    expect(session.cloudStatus()).toEqual({ kind: "signed-out" });
  });

  it("does nothing at all in a build with no Firebase setting", async () => {
    const opened = vi.fn();
    session.setCloudTestHooks({ config: () => null, openCloud: opened });
    await session.bootCloud();
    expect(opened).not.toHaveBeenCalled();
    expect(session.cloudStatus()).toEqual({ kind: "off" });
  });
});

describe("opening the app on a slow connection", () => {
  /** The phone keeps a copy at version 1, and the laptop has since saved version 2. */
  const behind = async () => {
    const devices = await twoDevices();
    await devices.saveOn("laptop", "league", { seasons: [{ id: "s2" }] });
    devices.on("phone");
    reloads = 0;
    return devices;
  };

  /** The cloud as the phone reaches it, with the copy's contents held back until `release`. */
  const heldBack = (sky: ReturnType<typeof firestore>) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const cloud = sky.as(ME);
    const store = {
      ...cloud.store,
      readManifest: async () => {
        await gate;
        return cloud.store.readManifest();
      },
    };
    return { cloud: { ...cloud, store }, release: () => release() };
  };

  it("opens on this browser's data once the wait is up, and offers the newer copy when it comes", async () => {
    const { sky, phone } = await behind();
    const { cloud, release } = heldBack(sky);
    connect(cloud, phone);
    vi.useFakeTimers();
    const lines: string[] = [];
    let opened = false;
    const booting = session.bootCloud((line) => lines.push(line)).then(() => (opened = true));

    await vi.advanceTimersByTimeAsync(session.STARTUP_WAIT_MS - 1);
    expect(opened).toBe(false);
    expect(lines).toEqual(["Checking your cloud copy…"]);
    await vi.advanceTimersByTimeAsync(1);
    await booting;
    expect(opened).toBe(true);
    expect(session.cloudStatus()).toEqual({ kind: "connecting" });
    expect(phone.values.get("league")).toEqual(league);

    release();
    await vi.advanceTimersByTimeAsync(0);
    // The app is open by now, so the newer copy is offered, not swapped in under it.
    expect(session.cloudStatus()).toMatchObject({ kind: "newer", owed: false });
    expect(phone.values.get("league")).toEqual(league);
    expect(reloads).toBe(0);
  });

  it("waits for an answer that comes in time, and says nothing if it comes at once", async () => {
    const { sky, phone } = await behind();
    const { cloud, release } = heldBack(sky);
    connect(cloud, phone);
    vi.useFakeTimers();
    const lines: string[] = [];
    const booting = session.bootCloud((line) => lines.push(line));
    await vi.advanceTimersByTimeAsync(session.STARTUP_WAIT_MS - 100);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await booting;
    expect(phone.values.get("league")).toEqual({ seasons: [{ id: "s2" }] });
    expect(reloads).toBe(0);

    session.resetCloudSession();
    connect(sky.as(ME), phone);
    const quiet: string[] = [];
    await session.bootCloud((line) => quiet.push(line));
    expect(quiet).toEqual([]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });

  it("sends a first copy once the app is open, not before", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    // Signed in, but the first save never happened (the tab closed under it).
    await session.signInToCloud();
    sky.wipe();
    localStorage.setItem(
      "league_forecast_cloud_v1",
      JSON.stringify({ ...loadCloudState(), version: null, copy: null, hashes: {} })
    );
    session.resetCloudSession();
    connect(sky.as(ME), laptop);
    vi.useFakeTimers();
    await session.bootCloud();
    expect(sky.manifest()).toBeNull();
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(sky.manifest()).toMatchObject({ version: 1 }));
  });
});

describe("saving what changed", () => {
  const signedIn = async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    return { sky, laptop };
  };

  it("waits for a quiet moment, then saves", async () => {
    const { sky, laptop } = await signedIn();
    vi.useFakeTimers();
    laptop.values.set("league", { seasons: ["later"] });
    session.noteChange("league");
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: true });
    await vi.advanceTimersByTimeAsync(session.SAVE_DELAY_MS - 1);
    expect(sky.manifest()?.version).toBe(1);
    vi.useRealTimers();
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(2);
    expect(loadCloudState().dirty).toEqual({});
  });

  it("holds back while a pull runs, and saves once it has finished", async () => {
    const { sky, laptop } = await signedIn();
    pull.live = true;
    laptop.values.set("teams", {
      r: [
        ["t1", "Hawks"],
        ["t2", "Owls"],
      ],
    });
    session.noteChange("teams");
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(1);
    expect(session.cloudStatus()).toMatchObject({
      kind: "saved",
      owed: true,
      waitingForPull: true,
    });

    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const stop = session.startCloudSession();
    vi.useFakeTimers();
    pull.live = false;
    pull.listeners.forEach((listener) => listener());
    vi.useRealTimers();
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(2);
    stop();
  });

  it("holds back while a pull runs in another tab", async () => {
    const { sky, laptop } = await signedIn();
    pull.elsewhere = true;
    laptop.values.set("teams", { r: [] });
    session.noteChange("teams");
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(1);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", waitingForPull: true });
    pull.elsewhere = false;
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(2);
  });

  it("keeps a change made while a save was running owed", async () => {
    const { sky, laptop } = await signedIn();
    laptop.values.set("league", { seasons: ["first"] });
    session.noteChange("league");
    const read = laptop.local.read;
    laptop.local.read = async (key) => {
      const value = await read(key);
      // A second edit lands while the first is being sent.
      if (key === "league") session.noteChange("league");
      return value;
    };
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(2);
    expect(Object.keys(loadCloudState().dirty)).toEqual(["league"]);
  });

  it("offers another device's save when it finds one while saving, and keeps its own owed", async () => {
    const { sky, laptop } = await signedIn();
    await sky.store.commitManifest(1, { ...sky.manifest()!, version: 2 });
    laptop.values.set("league", { seasons: ["late"] });
    session.noteChange("league");
    await session.saveNow();
    expect(session.cloudStatus()).toMatchObject({ kind: "newer", owed: true });
    expect(sky.manifest()?.version).toBe(2);
    expect(Object.keys(loadCloudState().dirty)).toEqual(["league"]);
  });

  it("owes nothing and sends nothing once signed out, and keeps this device's data", async () => {
    const { sky, laptop } = await signedIn();
    await session.signOutOfCloud();
    laptop.values.set("league", { seasons: ["offline"] });
    session.noteChange("league");
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(1);
    expect(loadCloudState()).toMatchObject({ enabled: false, dirty: {}, copy: null });
    expect(laptop.values.get("league")).toEqual({ seasons: ["offline"] });
    expect(session.cloudStatus()).toEqual({ kind: "signed-out" });
  });
});

describe("another device's save, found while the app is open", () => {
  it("is offered, not forced, and taken by a reload", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    await sky.store.commitManifest(1, { ...sky.manifest()!, version: 2, updatedAt: "later" });
    await session.lookAgain();
    expect(session.cloudStatus()).toMatchObject({
      kind: "newer",
      cloudSavedAt: "later",
      owed: false,
    });
    expect(laptop.values.get("league")).toEqual(league);
    session.noteChange("league");
    expect(session.cloudStatus()).toMatchObject({ kind: "newer", owed: true });
    session.loadNewer();
    expect(reloads).toBe(1);
  });
});
