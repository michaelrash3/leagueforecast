import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type GameLog } from "../../types";
import type { SeasonSnapshot } from "../../storage";
import { commitChanges } from "../cloudEngine";
import { readUpload, type PackedUpload } from "../uploads";
import { readTeamRankingsFile } from "../../teamRankingsBackup";
import { OWNER_ONLY_MESSAGE } from "../../memberCheck";
import type { MemberRole } from "../members";
import type { CloudManifest } from "../cloudManifest";
import type { LocalSource } from "../cloudLocal";
import type { LeagueValue } from "../leagueMerge";
import type { CloudAccount, FirebaseCloud } from "../firebaseCloud";
import { memoryCloud, memoryMembers, type MemoryCloud } from "./memoryCloud";
import { gcAuthorization } from "../../gcAuthorization";
import { memoryLeague, settled as settledLeague } from "../../live/__tests__/memoryLeague";
import { noteLeagueMet } from "../../preferences";
import { leagueLiveWanted } from "../../live/leagueWanted";
import { docToSeason, seasonDocId, seasonToDoc } from "../../live/leagueDocs";
import type { BaseKeeper, Known } from "../../live/leagueBase";
import { saveLogs } from "../../storage";

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
const {
  loadCloudState,
  saveCloudState,
  loadLeagueBase,
  saveLeagueBase,
  owedChanges,
  forgetCloudCopyHere,
  loadDisplacedLeague,
} = await import("../cloudState");
const { resetCloudGuard } = await import("../cloudGuard");
const { areaOf } = await import("../cloudPlan");
const { isEmptyLeague } = await import("../leagueMerge");
const { fetchValues } = await import("../cloudEngine");

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
  const storage = memoryStorage();
  return {
    values,
    storage,
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
/** The versions the server was asked to bring back, and its refusal when it is to refuse. */
let restored: string[] = [];
let serverSays: string | null = null;
/** The uploads staged, and the backups the server was asked to restore from them. */
const staged = new Map<string, PackedUpload>();
let restoredBackups: string[] = [];
/** The role the list answers with where a case says otherwise than the list itself. */
let roleSays: { role: MemberRole | null } | null = null;
/**
 * Whether the owner's account is on the list still: taken off it, the copy refuses it a look;
 * `unreachable` is a look the network fails, and `silent` one that never comes back at all.
 */
let listed: boolean | "unreachable" | "silent" = true;
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
    owns: async () => {
      if (listed === "unreachable") throw new Error("offline");
      if (listed === "silent") return new Promise<boolean>(() => undefined);
      return listed && current?.uid === ME.uid;
    },
    members: (() => {
      const list = memoryMembers(
        [{ address: ME.email ?? "", role: "owner" }],
        () => current?.email ?? null
      );
      return { ...list, role: async () => (roleSays ? roleSays.role : list.role()) };
    })(),
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
    // The server's `copy.restore` (`copyOps.ts`), made on the same copy.
    restore: async (group, copy) => {
      restored.push(group);
      if (serverSays) return { ok: false, message: serverSays };
      const base = await sky.store.readManifest();
      if (!base || base.copy !== copy) return { ok: false, message: "Another copy." };
      if (!base.kept.some((part) => part.group === group)) {
        return { ok: false, message: "That version is no longer kept." };
      }
      const done = await commitChanges({
        store: sky.store,
        base,
        restore: group,
        device: "live-edit",
        now: new Date(clock).toISOString(),
      });
      return done.ok ? { ok: true } : { ok: false, message: "Kept moving." };
    },
    stageUpload: async (packed) => {
      staged.set(packed.id, packed);
    },
    // The server's `backup.restore`, standing in for writing the file's pool: the roster made
    // what the staged file names its first team, so the device can be seen to take it.
    restoreBackup: async (upload, copy) => {
      restoredBackups.push(upload);
      if (serverSays) return { ok: false, message: serverSays };
      const packed = staged.get(upload);
      const base = await sky.store.readManifest();
      if (!packed || !base || base.copy !== copy) return { ok: false, message: "No such upload." };
      const read = await readUpload(
        {
          record: async () => packed.record,
          getChunk: async (_id, chunk) =>
            packed.pieces.find((piece) => piece.id === chunk)?.data ?? null,
        },
        upload,
        "team-rankings"
      );
      const file = read.ok ? readTeamRankingsFile(read.value) : null;
      if (!file) return { ok: false, message: "Not a backup." };
      const done = await commitChanges({
        store: sky.store,
        base,
        changes: [{ key: TEAMS, value: [file.teams[0]?.name ?? ""], at: clock }],
        keepReplaced: [TEAMS],
        device: "live-edit",
        now: new Date(clock).toISOString(),
      });
      return done.ok ? { ok: true } : { ok: false, message: "Kept moving." };
    },
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
  restored = [];
  serverSays = null;
  staged.clear();
  restoredBackups = [];
  roleSays = null;
  listed = true;
  tabs.announced = 0;
});

afterEach(() => {
  session.resetCloudSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The cloud's servers change the copy, as an edit through the edit function or the nightly does:
 * no device writes it (1.6f).
 */
const serverWrites = async (
  entries: Record<string, unknown>,
  { by = "live-edit", keep = false }: { by?: string; keep?: boolean } = {}
) => {
  const done = await commitChanges({
    store: sky.store,
    base: sky.manifest(),
    changes: Object.entries(entries).map(([key, value]) => ({ key, value, at: clock })),
    keepReplaced: keep ? Object.keys(entries) : [],
    device: by,
    now: new Date(clock).toISOString(),
  });
  if (!done.ok) throw new Error("the server's write did not land");
};

/** The copy the servers made, holding `entries`, and the laptop, holding the same, signed in. */
const laptopFirst = async (
  entries: Record<string, unknown> = { league: fall, [TEAMS]: ["laptop pool"] }
) => {
  await serverWrites(entries, { by: "nightly" });
  const laptop = device(entries);
  runAs(laptop);
  await session.signInToCloud();
  return laptop;
};

describe("a device signing in to the copy the servers made", () => {
  it("meets it, holding the same, and writes the copy nothing", async () => {
    await serverWrites({ league: fall, [TEAMS]: ["laptop pool"] }, { by: "nightly" });
    const writes = sky.costs.writes;
    runAs(device({ league: fall, [TEAMS]: ["laptop pool"] }));
    await session.signInToCloud();
    expect(sky.costs.writes).toBe(writes);
    expect(loadCloudState()).toMatchObject({ enabled: true, uid: ME.uid, version: 1 });
    expect(loadCloudState().met).toEqual({
      league: sky.manifest()?.copy,
      pool: sky.manifest()?.copy,
    });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false, newer: [] });
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

  it("keeps its own seasons here beside the copy's, apart from a first season that only shares an id", async () => {
    await laptopFirst({ league: league(season("default", {}, "2026-08-01T00:00:00Z")) });
    const phone = device({
      league: league(season("default", { g1: log(3, 1) }, "2026-05-01T00:00:00Z")),
    });
    runAs(phone);
    await session.signInToCloud();
    const seasons = (phone.values.get("league") as LeagueValue).seasons;
    expect(seasons.map((one) => one.id)).toEqual(["default", "season-2"]);
    expect(seasons[1]?.logs).toEqual({ g1: log(3, 1) });
    expect(((await cloudValue("league")) as LeagueValue).seasons).toHaveLength(1);
  });

  it("takes the copy's pool over its own, and keeps none of its own in the copy", async () => {
    await laptopFirst();
    const phone = device({ league: fall, [TEAMS]: ["phone's old pool"], [CADENCE]: "daily" });
    runAs(phone);
    await session.signInToCloud();
    await session.preparePool();
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
    expect(phone.values.has(CADENCE)).toBe(false);
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
    expect(sky.manifest()?.kept).toEqual([]);
    expect(session.cloudKept()).toEqual([]);
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

  it("is the manifest this device last read", async () => {
    const { laptop, phone } = await inStep();
    expect(session.copySeen()).toEqual(seenOf(sky.manifest()));
    runAs(laptop);
    expect(session.copySeen()).toBeNull();
    await session.bootCloud();
    expect(session.copySeen()).toEqual(seenOf(sky.manifest()));
    await serverWrites({ league: league(season("fall", { g1: log(3, 2) })) });
    const saved = sky.manifest();
    expect(saved?.version).toBe(2);
    // The phone, opened again, reads the servers' write on its way in.
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

describe("a change made on a device (1.6f)", () => {
  it("stays on it: the copy is written nothing", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    const writes = sky.costs.writes;
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    edit(laptop, TEAMS, ["laptop's own edit"]);
    await session.saveNow({ asked: true });
    expect(sky.costs.writes).toBe(writes);
    expect(sky.manifest()?.version).toBe(1);
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
  });

  it("gives way to the servers' write to a pool key, even one made before it", async () => {
    const { laptop } = await inStep();
    await serverWrites({ [TEAMS]: ["the servers' pool"] });
    later();
    // Made after the servers' write, which this device has not read yet.
    runAs(laptop);
    edit(laptop, TEAMS, ["laptop's own edit"]);
    await open(laptop);
    await session.preparePool();
    expect(laptop.values.get(TEAMS)).toEqual(["the servers' pool"]);
    expect(owedChanges()).toEqual({});
    expect(sky.manifest()?.kept).toEqual([]);
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
    expect(await cloudLogs()).toEqual({ g1: log(5, 3) });
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

/** A page on screen: what `startCloudSession` listens to, as the test runs outside a browser. */
const onScreen = () => {
  const quiet = { addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal("document", { ...quiet, visibilityState: "visible" });
  vi.stubGlobal("window", quiet);
};

describe("Team Rankings drawn before its pool has arrived", () => {
  it("leaves what arrives to be asked for, and sends the copy none of the view's old pool", async () => {
    const { phone } = await inStep();
    await serverWrites({ [TEAMS]: ["laptop pool", "laptop's pull"] });
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
    // The view, still holding the old pool, saves an edit of it: the copy is sent none of it.
    later();
    edit(phone, TEAMS, ["laptop pool", "phone's edit"]);
    await session.saveNow();
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool", "laptop's pull"]);
  });

  it("waits again for a pool still arriving when Team Rankings is left and opened again", async () => {
    const { phone } = await inStep();
    await serverWrites({ [TEAMS]: ["laptop pool", "laptop's pull"] });
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
    const { phone } = await inStep();
    await serverWrites({ [TEAMS]: ["laptop pool", "laptop's pull"] });
    await open(phone);
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", newer: [] });
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
  });
});

describe("a copy with a piece missing", () => {
  it("is not downloaded again at every look: looks back off as saves do", async () => {
    const { phone } = await inStep();
    await serverWrites({
      [TEAMS]: Array.from({ length: 5000 }, (_, i) => `team ${i}`),
      "league_forecast_scout_games_v2:2026": ["games 2026"],
    });
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
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
    runAs(phone);
    onScreen();
    const stop = session.startCloudSession();
    await session.bootCloud();
    expect(logsOf(phone)).toEqual({});
    expect(session.cloudStatus()).toMatchObject({ newer: ["league"] });
    stop();
  });

  it("merges League Standings both changed when Save now is pressed, and sends the copy none", async () => {
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
    // The phone, open since before the servers' write, enters another game's score.
    runAs(phone);
    onScreen();
    const stop = session.startCloudSession();
    edit(phone, "league", league(season("fall", { g2: log(1, 7) })));
    await session.bootCloud();
    await session.saveNow({ asked: true });
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(1, 7) });
    expect(await cloudLogs()).toEqual({ g1: log(5, 3) });
    stop();
  });
});

describe("an account the copy refuses mid-visit", () => {
  const refused = () =>
    Promise.reject(
      Object.assign(new Error("Missing or insufficient permissions."), {
        code: "permission-denied",
      })
    );

  it("is no member any more once taken off the list, as at a sign-in", async () => {
    const { phone } = await inStep();
    await open(phone);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    listed = false;
    sky.store.readManifest = refused;
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner", account: ME });
  });

  it("is only an error while still on the list, such as a write the rules keep from devices", async () => {
    const { phone } = await inStep();
    await open(phone);
    sky.store.readManifest = refused;
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      account: ME,
      message: expect.stringContaining("refused this account"),
    });
  });

  it("is taken off the list by a refusal alone, and one the second look confirms", async () => {
    const { phone } = await inStep();
    await open(phone);
    // A look that fails for want of the network says nothing of the list, whatever it holds.
    listed = false;
    sky.store.readManifest = () => Promise.reject(new Error("Failed to fetch"));
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "error", account: ME });
    // Nor does a refusal whose second look the network fails.
    listed = "unreachable";
    sky.store.readManifest = refused;
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "error", account: ME });
  });

  it("ends a refused look as an error when the second look never comes back", async () => {
    const { phone } = await inStep();
    await open(phone);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    // The copy refused, and the network silent from the very next request on.
    listed = "silent";
    let copyRefused = false;
    sky.store.readManifest = () => {
      copyRefused = true;
      return refused();
    };
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let ended = false;
    const saving = session.saveNow({ asked: true }).then(() => {
      ended = true;
    });
    await vi.waitFor(() => expect(copyRefused).toBe(true));
    await vi.advanceTimersByTimeAsync(21_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    // Ended rather than waiting for good, which would keep every later look away: an error, since
    // the look that could have said the account is off the list said nothing.
    expect(ended).toBe(true);
    await saving;
    expect(session.cloudStatus()).toMatchObject({ kind: "error", account: ME });
  });

  it("makes its backups and restores as a browser turned away does, off this device, once taken off the list", async () => {
    const { phone } = await inStep();
    await open(phone);
    expect(session.restoresInCloud()).toBe(true);
    listed = false;
    sky.store.readManifest = refused;
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner", account: ME });
    // Still signed in, with the copy still kept here for this account: only the list has changed.
    expect(loadCloudState()).toMatchObject({ enabled: true, uid: ME.uid });
    // Backup JSON, Export CSV and the restores read and write the copy wherever this answers true,
    // and the copy refuses this account every time: League's seasons could never be backed up.
    expect(session.restoresInCloud()).toBe(false);
    expect(await session.copyReader()).toBeNull();
  });

  it("is turned away from the copy's backups and restores at a sign-in, too, though it was a member", async () => {
    const { phone } = await inStep();
    runAs(phone);
    listed = false;
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner", account: ME });
    expect(loadCloudState()).toMatchObject({ enabled: true, uid: ME.uid });
    expect(session.restoresInCloud()).toBe(false);
    expect(await session.copyReader()).toBeNull();
  });

  it("says it is off the list, not to sign in, when taken off it partway through a restore", async () => {
    const { phone } = await inStep();
    runAs(phone);
    await open(phone);
    listed = false;
    sky.store.readManifest = refused;
    const file = {
      ageGroups: [],
      teams: [{ id: "S-1", name: "Placeholder Restored" }],
      games: [],
    };
    const answer = await session.restoreTeamRankingsInCloud(file, { reload: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "not-owner", account: ME });
    expect(answer).toEqual({
      ok: false,
      message: expect.stringContaining("not on the cloud copy's list"),
    });
    expect(staged.size).toBe(0);
  });

  it("still restores in the cloud for a member whose copy is gone or newer than this build", async () => {
    const { phone } = await inStep();
    runAs(phone);
    await open(phone);
    const manifest = sky.manifest() as CloudManifest;
    sky.setManifest({ ...manifest, schema: manifest.schema + 1, version: manifest.version + 1 });
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "update", account: ME });
    expect(session.restoresInCloud()).toBe(true);
    expect(await session.copyReader()).not.toBeNull();
    sky.setManifest(null);
    await session.lookAgain({ forced: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "gone", account: ME });
    expect(session.restoresInCloud()).toBe(true);
    expect(await session.copyReader()).not.toBeNull();
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
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3) });
    expect(reloads).toBe(0);
  });

  it("opens on this device's data when the seasons are slow, and says newer ones are there", async () => {
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
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
  it("is said to be gone, sent nothing, and made again by no device (1.6f)", async () => {
    const { laptop } = await inStep();
    const writesBefore = sky.costs.writes;
    sky.setManifest(null);
    runAs(laptop);
    await session.bootCloud();
    edit(laptop, "league", league(season("fall", { g1: log(9, 0) })));
    await session.saveNow({ asked: true });
    expect(session.cloudStatus()).toMatchObject({ kind: "gone" });
    expect(sky.manifest()).toBeNull();
    // A device that never met a copy finds none, and makes none either.
    runAs(device({ league: fall, [TEAMS]: ["tablet pool"] }));
    await session.signInToCloud();
    expect(session.cloudStatus()).toMatchObject({ kind: "gone" });
    expect(sky.manifest()).toBeNull();
    expect(sky.costs.writes).toBe(writesBefore);
  });
});

describe("signing out and back in", () => {
  it("records what changes meanwhile, and sends none of it on signing in again", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    await session.signOutOfCloud();
    edit(laptop, "league", league(season("fall", { g1: log(7, 7) })));
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    await session.signInToCloud();
    expect(await cloudLogs()).toEqual({});
    expect(logsOf(laptop)).toEqual({ g1: log(7, 7) });
  });
});

describe("bringing a kept version back", () => {
  it("makes it current in the copy and here", async () => {
    const { phone } = await inStep();
    // The servers replace the pool, keeping the one it replaces.
    await serverWrites({ [TEAMS]: ["laptop's pull"] }, { keep: true });
    await open(phone);
    await session.preparePool();
    expect(phone.values.get(TEAMS)).toEqual(["laptop's pull"]);
    const [version] = session.cloudKept();
    await session.bringBack(version?.group ?? "");
    // Made by the server, which this device then takes from the copy.
    expect(restored).toEqual([version?.group]);
    expect(sky.manifest()?.device).toBe("live-edit");
    expect(phone.values.get(TEAMS)).toEqual(["laptop pool"]);
    expect(await cloudValue(TEAMS)).toEqual(["laptop pool"]);
  });

  it("says why the server would not bring it back, and changes nothing here", async () => {
    const { phone } = await inStep();
    await serverWrites({ [TEAMS]: ["laptop's pull"] }, { keep: true });
    await open(phone);
    await session.preparePool();
    const version = sky.manifest()?.version;
    const [kept] = session.cloudKept();
    serverSays = "Only the cloud copy's owner can bring back an earlier version.";
    await session.bringBack(kept?.group ?? "");
    expect(restored).toEqual([kept?.group]);
    expect(session.cloudStatus()).toMatchObject({ kind: "error", message: serverSays });
    expect(sky.manifest()?.version).toBe(version);
    expect(phone.values.get(TEAMS)).toEqual(["laptop's pull"]);
  });

  /** A Team Rankings backup of one placeholder club, as a file would carry it. */
  const FILE = {
    ageGroups: [],
    teams: [{ id: "S-1", name: "Placeholder Restored" }],
    games: [],
  };

  it("restores Team Rankings in the cloud: staged as the file, made by the server, taken here", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, TEAMS, ["phone's edit"]);
    later();
    await open(laptop);
    await open(phone);
    await session.preparePool();
    const answer = await session.restoreTeamRankingsInCloud(FILE, { reload: true });
    expect(answer).toEqual({ ok: true });
    expect(restoredBackups).toHaveLength(1);
    // Staged as the Team Rankings JSON the device would have written for the file.
    const packed = staged.get(restoredBackups[0] ?? "");
    if (!packed) throw new Error("nothing staged");
    const read = await readUpload(
      {
        record: async () => packed.record,
        getChunk: async (_id, chunk) =>
          packed.pieces.find((piece) => piece.id === chunk)?.data ?? null,
      },
      packed.id,
      "team-rankings"
    );
    expect(read.ok && readTeamRankingsFile(read.value)).toMatchObject({
      teams: [{ id: "S-1", name: "Placeholder Restored" }],
    });
    expect(await cloudValue(TEAMS)).toEqual(["Placeholder Restored"]);
    expect(phone.values.get(TEAMS)).toEqual(["Placeholder Restored"]);
  });

  it("leaves this device's pool to be taken later when told not to reload", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, TEAMS, ["phone's edit"]);
    later();
    await open(laptop);
    await open(phone);
    await session.preparePool();
    const reloadsBefore = reloads;
    expect(await session.restoreTeamRankingsInCloud(FILE, { reload: false })).toEqual({ ok: true });
    expect(await cloudValue(TEAMS)).toEqual(["Placeholder Restored"]);
    expect(phone.values.get(TEAMS)).toEqual(["phone's edit"]);
    expect(reloads).toBe(reloadsBefore);
  });

  it("keeps the copy's pool as the version a restore replaces, sending none of this device's", async () => {
    const { phone } = await inStep();
    await open(phone);
    await session.preparePool();
    edit(phone, TEAMS, ["phone's unsaved edit"]);
    expect(await session.restoreTeamRankingsInCloud(FILE, { reload: false })).toEqual({ ok: true });
    expect(await cloudValue(TEAMS)).toEqual(["Placeholder Restored"]);
    const [replaced] = session.cloudKept();
    const fetched = await fetchValues({
      store: sky.store,
      parts: (sky.manifest()?.kept ?? []).filter(
        (part) => part.group === replaced?.group && part.key === TEAMS
      ),
    });
    expect(fetched.ok && fetched.values.get(TEAMS)).toEqual(["laptop pool"]);
  });

  it("says why the server would not restore it, and changes nothing", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, TEAMS, ["phone's edit"]);
    later();
    await open(laptop);
    await open(phone);
    await session.preparePool();
    const version = sky.manifest()?.version;
    serverSays = "Only the cloud copy's owner can restore a backup.";
    expect(await session.restoreTeamRankingsInCloud(FILE, { reload: true })).toEqual({
      ok: false,
      message: serverSays,
    });
    expect(session.cloudStatus()).toMatchObject({ kind: "error", message: serverSays });
    expect(sky.manifest()?.version).toBe(version);
    expect(phone.values.get(TEAMS)).toEqual(["phone's edit"]);
  });

  it("tells a member only the owner restores one, and stages nothing", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    await open(laptop);
    await open(phone);
    roleSays = { role: "member" };
    expect(await session.restoreTeamRankingsInCloud(FILE, { reload: true })).toEqual({
      ok: false,
      message: OWNER_ONLY_MESSAGE,
    });
    expect(staged.size).toBe(0);
    expect(session.cloudStatus().kind).not.toBe("error");
  });

  it("sends nothing for a file holding no Team Rankings, and says the cloud's is left", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    await open(laptop);
    await open(phone);
    const version = sky.manifest()?.version;
    const answer = await session.restoreTeamRankingsInCloud(
      { ageGroups: [], teams: [], games: [] },
      { reload: true }
    );
    expect(answer).toMatchObject({ ok: false, message: expect.stringContaining("left as it is") });
    expect(staged.size).toBe(0);
    expect(sky.manifest()?.version).toBe(version);
  });

  it("says what went wrong when the cloud cannot be reached, not to sign in", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    await open(laptop);
    await open(phone);
    const reads = sky.store.readManifest;
    sky.store.readManifest = async () => {
      throw new Error("The network is down.");
    };
    try {
      const answer = await session.restoreTeamRankingsInCloud(FILE, { reload: true });
      const status = session.cloudStatus();
      expect(status.kind).toBe("error");
      expect(answer).toEqual({
        ok: false,
        message: status.kind === "error" ? status.message : "",
      });
      expect(answer).not.toMatchObject({ message: expect.stringContaining("Sign in") });
    } finally {
      sky.store.readManifest = reads;
    }
  });

  it("is not where an account turned away from the copy restores, which keeps its own pool", async () => {
    const visitor = device({ league: fall, [TEAMS]: ["visitor's pool"] });
    runAs(visitor, { uid: "stranger", email: "stranger@example.test" });
    await session.signInToCloud();
    expect(session.cloudStatus().kind).toBe("not-owner");
    expect(session.restoresInCloud()).toBe(false);
  });

  it("stages nothing while a pull holds Team Rankings", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    await open(laptop);
    await open(phone);
    pull.live = true;
    const answer = await session.restoreTeamRankingsInCloud(FILE, { reload: true });
    expect(answer.ok).toBe(false);
    expect(staged.size).toBe(0);
    expect(restoredBackups).toEqual([]);
  });

  it("waits for a pull to finish before bringing Team Rankings back", async () => {
    const { phone } = await inStep();
    await serverWrites({ [TEAMS]: ["laptop's pull"] }, { keep: true });
    await open(phone);
    await session.preparePool();
    const version = sky.manifest()?.version;
    const [kept] = session.cloudKept();
    pull.live = true;
    await session.bringBack(kept?.group ?? "");
    expect(restored).toEqual([]);
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("pull"),
    });
    expect(sky.manifest()?.version).toBe(version);
    expect(phone.values.get(TEAMS)).toEqual(["laptop's pull"]);
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

describe("the seasons this device last agreed with the copy", () => {
  it("are the copy's League as this device last took it in", async () => {
    const { laptop, phone } = await inStep();
    const agreed = () => session.leagueAgreedWithCopy().map(({ id, logs }) => ({ id, logs }));
    // Met at its sign-in, holding what the servers' copy holds.
    await open(laptop);
    expect(agreed()).toEqual([{ id: "fall", logs: {} }]);
    // Taken in from the copy, it is the copy's.
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
    await open(phone);
    expect(agreed()).toEqual([{ id: "fall", logs: { g1: log(5, 3) } }]);
    // Merged here with a change of its own, it is still the copy's, which holds none of it: a
    // first meeting's base holding this device's change would read the documents' lack of it as
    // a deletion, and drop it (1.6e review).
    edit(phone, "league", league(season("fall", { g1: log(5, 3), g2: log(1, 1) })));
    later();
    await serverWrites({ league: league(season("fall", { g1: log(6, 3) })) });
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(6, 3), g2: log(1, 1) });
    expect(agreed()).toEqual([{ id: "fall", logs: { g1: log(6, 3) } }]);
    // A base kept from some other agreement than the one this device last made is no base.
    const base = loadLeagueBase();
    if (!base) throw new Error("no base");
    saveLeagueBase({ ...base, hash: "not-the-copy's" });
    expect(session.leagueAgreedWithCopy()).toEqual([]);
  });
});

describe("League Standings kept live on a device", () => {
  it("is taken in from the copy until this device has met the cloud's seasons, and never after", async () => {
    const { phone } = await inStep();
    await open(phone);
    edit(phone, "league", league(season("fall", { g1: log(5, 3) })));
    // Owed to the cloud's documents, at the first meeting, and to no copy.
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
    await session.saveNow();
    expect(await cloudLogs()).toEqual({});
    // The servers score another game into the copy: the phone takes it in beside its own.
    await serverWrites({ league: league(season("fall", { g2: log(2, 2) })) });
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(2, 2) });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false, newer: [] });
    // Met, it is League kept live, and the copy leaves it alone.
    noteLeagueMet(ME.uid);
    await serverWrites({ league: league(season("fall", { g2: log(3, 3) })) });
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(2, 2) });
    expect(reloads).toBe(0);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", newer: [] });
  });

  it("takes the copy's at its first meeting with the copy, keeping this device's here to save", async () => {
    await laptopFirst({
      league: league(season("fall", { g1: log(5, 3) })),
      [TEAMS]: ["laptop pool"],
    });
    const before = await cloudLogs();
    // One whose season differs from the copy's in nothing both hold takes the copy's beside its
    // own, and has lost nothing to keep.
    const phone = device({ league: league(season("fall", { g2: log(2, 2) })) });
    runAs(phone);
    await session.signInToCloud();
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(2, 2) });
    expect(loadDisplacedLeague()).toBeNull();
    // A device with its own version of the copy's season meets the copy: the copy's is taken, and
    // this device's kept here, for the panel to offer as a download, since no device writes the
    // copy an earlier version (1.6f).
    const tablet = device({ league: league(season("fall", { g1: log(1, 1) })) });
    runAs(tablet);
    await session.signInToCloud();
    expect(logsOf(tablet)).toEqual(before);
    expect(await cloudLogs()).toEqual(before);
    expect(sky.manifest()?.kept).toEqual([]);
    expect((loadDisplacedLeague() as LeagueValue).seasons[0]?.logs).toEqual({ g1: log(1, 1) });
  });

  it("marks a score the page writes, and sends the copy none of it", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    onScreen();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval"] });
    const stop = session.startCloudSession();
    noteLeagueMet(ME.uid);
    // The page writes a score to storage, which tells the session, as on the site.
    laptop.values.set("league", league(season("fall", { g1: log(4, 0) })));
    saveLogs({ g1: log(4, 0) });
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    expect(await cloudLogs()).toEqual({});
    stop();
  });

  it("neither offers nor brings back an earlier League version", async () => {
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(6, 3) })) }, { keep: true });
    await open(phone);
    const [kept] = sky.manifest()?.kept ?? [];
    expect(kept?.key).toBe("league");
    expect(session.cloudKept()).toEqual([]);
    const version = sky.manifest()?.version;
    await session.bringBack(kept?.group ?? "");
    expect(session.cloudStatus()).toMatchObject({
      kind: "error",
      message: expect.stringContaining("kept live"),
    });
    expect(sky.manifest()?.version).toBe(version);
    expect(logsOf(phone)).toEqual({ g1: log(6, 3) });
  });

  it("says no newer League is in the copy once League is kept live", async () => {
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
    runAs(phone);
    onScreen();
    const stop = session.startCloudSession();
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({ newer: ["league"] });
    noteLeagueMet(ME.uid);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", newer: [] });
    stop();
  });
});

describe("League Standings before this device's first meeting (1.6e review)", () => {
  /** This device's first meeting, as `useLiveLeague` runs it, and its open season kept live. */
  const meetAndOpen = async (one: Device) => {
    const { meetSeasons } = await import("../../live/leagueSeasons");
    const { startLeagueSync } = await import("../../live/leagueSync");
    const { createSeasonStore } = await import("../../seasonStore");
    const held = new Map<string, Known>();
    const bases: BaseKeeper = {
      read: (id) => held.get(id) ?? null,
      write: (id, known) => void held.set(id, known),
      remove: (id) => void held.delete(id),
    };
    const mine = (one.values.get("league") as LeagueValue).seasons;
    await meetSeasons({
      store: skyLeague.store,
      local: {
        list: () => mine.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
        read: (id) => mine.find((each) => each.id === id) ?? null,
        add: () => true,
      },
      bases,
      openId: () => "fall",
      agreed: session.leagueAgreedWithCopy(),
    });
    const fallHere = mine.find((each) => each.id === "fall");
    if (!fallHere) throw new Error("no fall");
    const { teams, matchups, logs, bracketLogs, settings } = fallHere;
    const seasons = createSeasonStore({
      id: "fall",
      season: { teams, matchups, logs, bracketLogs, settings },
    });
    const sync = startLeagueSync({
      store: skyLeague.store,
      seasons,
      entryOf: () => ({ id: "fall", name: fallHere.name, createdAt: fallHere.createdAt }),
      bases,
      persist: () => undefined,
      editing: () => false,
      onState: () => undefined,
    });
    await settledLeague();
    return { seasons, sync };
  };
  const wanted = (met = false) =>
    leagueLiveWanted({
      status: session.cloudStatus(),
      met,
      inStep: session.leagueInStep(),
    });

  it("keeps a score entered before it, which no copy or document had", async () => {
    const { phone } = await inStep();
    // Another device went live first: the cloud's fall is the copy's, with no score.
    skyLeague.put(seasonDocId("fall"), seasonToDoc(season("fall"), 3));
    // The phone, its switch on, opens offline at the field: not met, and not in step.
    runAs(phone);
    const read = sky.store.readManifest;
    sky.store.readManifest = () => Promise.reject(new Error("Failed to fetch"));
    await open(phone);
    expect(wanted()).toBe(false);
    edit(phone, "league", league(season("fall", { g1: log(5, 3) })));
    // Back online, the copy brings it in step, and sends it nothing.
    sky.store.readManifest = read;
    await session.saveNow();
    expect(await cloudLogs()).toEqual({});
    expect(wanted()).toBe(true);
    const { seasons, sync } = await meetAndOpen(phone);
    // The score entered here is kept, and sent to the cloud's document.
    expect(seasons.get().season.logs).toEqual({ g1: log(5, 3) });
    sync.settle();
    await settledLeague();
    const doc = docToSeason(skyLeague.read(seasonDocId("fall")), seasonDocId("fall"));
    if (!doc.ok) throw new Error(doc.reason);
    expect(doc.season.logs).toEqual({ g1: log(5, 3) });
    sync.stop();
  });

  it("is not met again by another account signed in on a device that met them", async () => {
    // The copy's League as the last device to carry it left it: g1 5-3, g2 1-1.
    await laptopFirst({
      league: league(season("fall", { g1: log(5, 3), g2: log(1, 1) })),
      [TEAMS]: ["laptop pool"],
    });
    // A shared tablet kept live, met as member A: g1 corrected to 6-3 and g2's score taken off.
    const tablet = device({ league: league(season("fall", { g1: log(6, 3) })) });
    runAs(tablet);
    saveCloudState({
      enabled: false,
      device: "tablet",
      uid: "member-a",
      met: {},
      copy: null,
      version: null,
      hashes: {},
      uploads: [],
    });
    noteLeagueMet("member-a");
    // Member B, on the same list and the same cloud, signs in on it.
    await session.signInToCloud();
    await session.preparePool();
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    // The live seasons are left as the live documents have them, not the copy's older League.
    expect(logsOf(tablet)).toEqual({ g1: log(6, 3) });
  });

  it("is not in step with the copy at a boot that never read it", async () => {
    const { phone } = await inStep();
    await serverWrites({ league: league(season("fall", { g1: log(5, 3) })) });
    runAs(phone);
    // The copy is slow: past the boot's wait, inside the store's limit.
    const real = sky.store.readManifest;
    let release: () => void = () => undefined;
    sky.store.readManifest = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      sky.store.readManifest = real;
      return real();
    };
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const booting = session.bootCloud();
    await vi.advanceTimersByTimeAsync(session.STARTUP_WAIT_MS + session.STARTUP_TAKE_MS + 1);
    await booting;
    vi.useFakeTimers({ toFake: ["Date"] });
    // Saved, and holding none of the laptop's score: not in step, so not met yet.
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    expect(logsOf(phone)).toEqual({});
    expect(wanted()).toBe(false);
    // Once the copy is read and its League taken in, it is.
    release();
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ newer: ["league"] }));
    expect(wanted()).toBe(false);
    // Set aside to be asked for, the copy's League is not in step here, whatever the status says.
    expect(session.leagueInStep()).toBe(false);
    await session.loadNewer();
    expect(logsOf(phone)).toEqual({ g1: log(5, 3) });
    // Taken in, the page reloads, and opens in step.
    await open(phone);
    expect(wanted()).toBe(true);
  });

  it("is not in step with the copy while a League that arrived is set aside for an edit", async () => {
    const { phone } = await inStep();
    runAs(phone);
    await open(phone);
    expect(wanted()).toBe(true);
    // Another device saves a score straight into the copy, while the phone is open.
    await commitChanges({
      store: sky.store,
      base: sky.manifest(),
      changes: [
        { key: "league", value: league(season("fall", { g1: log(5, 3) })), at: Date.now() },
      ],
      device: "laptop",
      now: new Date().toISOString(),
    });
    // A score entered on the phone while that arrives sets it aside, to be met at the next save.
    const real = sky.store.getChunk;
    sky.store.getChunk = async (id) => {
      sky.store.getChunk = real;
      edit(phone, "league", league(season("fall", { g2: log(0, 4) })));
      return real(id);
    };
    await session.loadNewer();
    expect(logsOf(phone)).toEqual({ g2: log(0, 4) });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    expect(wanted()).toBe(false);
    // Met at the next save, which reloads the page, it is in step, its own score held back for
    // the documents.
    await session.saveNow();
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(0, 4) });
    await open(phone);
    expect(wanted()).toBe(true);
    expect(await cloudLogs()).toEqual({ g1: log(5, 3) });
  });

  it("is in step only as the account and copy the copy was settled with", async () => {
    const { phone } = await inStep();
    runAs(phone);
    await open(phone);
    expect(session.leagueInStep()).toBe(true);
    // A copy this record no longer names is not the one League was settled with.
    const copy = loadCloudState().copy;
    saveCloudState({ ...loadCloudState(), copy: "another-copy" });
    expect(session.leagueInStep()).toBe(false);
    saveCloudState({ ...loadCloudState(), copy });
    expect(session.leagueInStep()).toBe(true);
    // A settlement that fails on its way leaves it not in step.
    sky.store.readManifest = () => Promise.reject(new Error("Failed to fetch"));
    await session.saveNow();
    expect(session.leagueInStep()).toBe(false);
  });
});
