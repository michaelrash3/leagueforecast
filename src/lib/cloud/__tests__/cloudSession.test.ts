import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStore, LocalSource } from "../cloudEngine";
import type { CloudManifest } from "../cloudManifest";
import type { CloudAccount, FirebaseCloud } from "../firebaseCloud";

/*
 * The cloud session end to end, with Firebase and the browser's stores stood in for: signing in
 * for the first time, a second device taking the copy, the question when two copies differ, saves
 * held back while a pull runs, and a change made during a save still being owed after it.
 */

const pull = vi.hoisted(() => ({ live: false, listeners: new Set<() => void>() }));
vi.mock("../../pullSession", () => ({
  isPullLive: () => pull.live,
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

/** One Firestore, shared by every device in a test. */
const firestore = () => {
  let manifest: CloudManifest | null = null;
  let owner: string | null = null;
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
      claim: async () => {
        if (!current) return "someone-else";
        owner ??= current.uid;
        return owner === current.uid ? "mine" : "someone-else";
      },
      store,
    };
  };
  return { as, manifest: () => manifest, store };
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
  };
  return { local, values };
};

const ME: CloudAccount = { uid: "owner-1", email: "owner@example.test" };
const CONFIG = { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" };

let reloads = 0;
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
  });
};

/** A second device is a second browser: its own localStorage, and a fresh session. */
const switchDevice = () => {
  session.resetCloudSession();
  vi.stubGlobal("localStorage", memoryStorage());
};

beforeEach(() => {
  pull.live = false;
  pull.listeners.clear();
  reloads = 0;
  switchDevice();
});

afterEach(() => {
  session.resetCloudSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const league = { activeSeasonId: "s1", seasons: [{ id: "s1", teams: ["Hawks"] }] };
const teams = { r: [["t1", "Hawks"]] };

describe("signing in for the first time", () => {
  it("sends everything from a device with data to an empty cloud", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league", "teams"]);
    expect(loadCloudState()).toMatchObject({ enabled: true, version: 1, dirty: {} });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
  });

  it("brings the copy to a device with nothing, and reloads to show it", async () => {
    const sky = firestore();
    connect(sky.as(ME), device({ league, teams }));
    await session.signInToCloud();

    switchDevice();
    const phone = device({});
    connect(sky.as(ME), phone);
    await session.signInToCloud();
    expect(Object.fromEntries(phone.values)).toEqual({ league, teams });
    expect(reloads).toBe(1);
  });

  it("asks which copy wins when both have different data", async () => {
    const sky = firestore();
    connect(sky.as(ME), device({ league, teams }));
    await session.signInToCloud();

    switchDevice();
    const other = device({ league: { mine: true } });
    connect(sky.as(ME), other);
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "choose", firstTime: true });
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
    await session.chooseCopy("device");
    expect(sky.manifest()?.version).toBe(2);
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual(["league"]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });

  it("the cloud's replaces this device's, and the page reloads", async () => {
    const { other } = await conflicted();
    await session.chooseCopy("cloud");
    expect(Object.fromEntries(other.values)).toEqual({ league, teams });
    expect(reloads).toBe(1);
  });
});

describe("opening the app on a device that keeps a copy", () => {
  it("takes another device's save before anything is drawn, without a reload", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();

    switchDevice();
    const phone = device({});
    connect(sky.as(ME), phone);
    await session.signInToCloud();
    const phoneStorage = localStorage;
    reloads = 0;

    // The laptop changes the league and saves.
    session.resetCloudSession();
    vi.stubGlobal("localStorage", memoryStorage());
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    laptop.values.set("league", { ...league, activeSeasonId: "s2" });
    session.noteChange("league");
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(2);

    // The phone opens the app.
    session.resetCloudSession();
    vi.stubGlobal("localStorage", phoneStorage);
    connect(sky.as(ME), phone);
    const lines: string[] = [];
    await session.bootCloud((line) => lines.push(line));
    expect(phone.values.get("league")).toEqual({ ...league, activeSeasonId: "s2" });
    expect(reloads).toBe(0);
    expect(lines.some((line) => line.startsWith("Loading your data from the cloud"))).toBe(true);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });

  it("asks rather than replacing changes made here that were never saved", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    const laptopStorage = localStorage;

    // Another device takes the copy and saves a change.
    switchDevice();
    const phone = device({});
    connect(sky.as(ME), phone);
    await session.signInToCloud();
    phone.values.set("teams", { r: [] });
    session.noteChange("teams");
    await session.saveNow();

    // The laptop had a change of its own it never sent.
    session.resetCloudSession();
    vi.stubGlobal("localStorage", laptopStorage);
    connect(sky.as(ME), laptop);
    laptop.values.set("league", { ...league, activeSeasonId: "unsent" });
    session.noteChange("league");
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "choose", firstTime: false });
    expect(laptop.values.get("league")).toEqual({ ...league, activeSeasonId: "unsent" });
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
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    switchDevice();
    const phone = device({});
    connect(sky.as(ME), phone);
    await session.signInToCloud();
    const phoneStorage = localStorage;
    session.resetCloudSession();
    vi.stubGlobal("localStorage", memoryStorage());
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    laptop.values.set("league", { ...league, activeSeasonId: "s2" });
    session.noteChange("league");
    await session.saveNow();
    session.resetCloudSession();
    vi.stubGlobal("localStorage", phoneStorage);
    reloads = 0;
    return { sky, phone };
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
    expect(session.cloudStatus()).toMatchObject({ kind: "newer" });
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
    expect(phone.values.get("league")).toEqual({ ...league, activeSeasonId: "s2" });
    expect(reloads).toBe(0);

    session.resetCloudSession();
    connect(sky.as(ME), phone);
    const quiet: string[] = [];
    await session.bootCloud((line) => quiet.push(line));
    expect(quiet).toEqual([]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
  });

  it("sends everything again when the cloud copy is gone, once the app is open rather than before", async () => {
    const sky = firestore();
    const laptop = device({ league, teams });
    connect(sky.as(ME), laptop);
    await session.signInToCloud();
    // The copy is gone (deleted in the console), and this browser still keeps one.
    session.resetCloudSession();
    const cloud = sky.as(ME);
    let releasePut = () => {};
    const putGate = new Promise<void>((resolve) => (releasePut = resolve));
    const slowCloud = {
      ...cloud,
      store: {
        ...cloud.store,
        readManifest: async () => null,
        putChunk: async (id: string, data: Uint8Array<ArrayBuffer>) => {
          await putGate;
          return cloud.store.putChunk(id, data);
        },
        commitManifest: async () => true,
      },
    };
    connect(slowCloud, laptop);
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "working" });
    releasePut();
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ kind: "saved" }));
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
    laptop.values.set("league", { ...league, activeSeasonId: "later" });
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

  it("keeps a change made while a save was running owed", async () => {
    const { sky, laptop } = await signedIn();
    laptop.values.set("league", { ...league, activeSeasonId: "first" });
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

  it("stops at the question when another device saved first", async () => {
    const { sky, laptop } = await signedIn();
    await sky.store.commitManifest(1, { ...sky.manifest()!, version: 2 });
    laptop.values.set("league", { ...league, activeSeasonId: "late" });
    session.noteChange("league");
    await session.saveNow();
    expect(session.cloudStatus()).toMatchObject({ kind: "choose" });
    expect(sky.manifest()?.version).toBe(2);
  });

  it("owes nothing and sends nothing once signed out, and keeps this device's data", async () => {
    const { sky, laptop } = await signedIn();
    await session.signOutOfCloud();
    laptop.values.set("league", { ...league, activeSeasonId: "offline" });
    session.noteChange("league");
    await session.saveNow();
    expect(sky.manifest()?.version).toBe(1);
    expect(loadCloudState()).toMatchObject({ enabled: false, dirty: {} });
    expect(laptop.values.get("league")).toEqual({ ...league, activeSeasonId: "offline" });
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
    expect(session.cloudStatus()).toMatchObject({ kind: "newer", cloudSavedAt: "later" });
    expect(laptop.values.get("league")).toEqual(league);
    session.loadNewer();
    expect(reloads).toBe(1);
  });
});
