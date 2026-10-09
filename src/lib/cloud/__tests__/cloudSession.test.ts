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
import { noteLeagueMet, writeLiveLeague } from "../../preferences";
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
} = await import("../cloudState");
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
  // League's switch off, as on a device kept apart from the live ones: the copy's own League sync
  // is what most of these tests are about, and with the switch on the copy only brings League in
  // (1.6e review). The tests of League kept live turn it on.
  const storage = memoryStorage();
  storage.setItem("lf_live_league_v1", "off");
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

  it("ends a refused save as an error when the second look never comes back", async () => {
    const { phone } = await inStep();
    await open(phone);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    // A piece of the save refused, and the network silent from the very next request on.
    listed = "silent";
    let pieceRefused = false;
    sky.store.putChunk = () => {
      pieceRefused = true;
      return refused();
    };
    edit(phone, TEAMS, ["phone pool, changed"]);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let ended = false;
    const saving = session.saveNow({ asked: true }).then(() => {
      ended = true;
    });
    // Once the save has packed its pieces and sent one, as long as the copy's own reads are given,
    // and a little over.
    await vi.waitFor(() => expect(pieceRefused).toBe(true));
    await vi.advanceTimersByTimeAsync(21_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    // Ended rather than saving for good, which would keep every later look away: an error, since
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
    // Made by the server, which this device then takes from the copy.
    expect(restored).toEqual([version?.group]);
    expect(sky.manifest()?.device).toBe("live-edit");
    expect(phone.values.get(TEAMS)).toEqual(["phone's edit"]);
    expect(await cloudValue(TEAMS)).toEqual(["phone's edit"]);
    expect(session.cloudKept()).toMatchObject([{ why: "replaced" }]);
    await open(laptop);
    await session.preparePool();
    expect(laptop.values.get(TEAMS)).toEqual(["phone's edit"]);
  });

  it("says why the server would not bring it back, and changes nothing here", async () => {
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

  it("sends this device's unsaved edits first, so the version the restore replaces holds them", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    await open(laptop);
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
    expect(fetched.ok && fetched.values.get(TEAMS)).toEqual(["phone's unsaved edit"]);
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
    expect(restored).toEqual([]);
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

describe("the seasons this device last agreed with the copy", () => {
  it("are the copy's League as this device last took it in, and none it sent itself", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    // The laptop's own first copy, still the copy's League: its own, sent from here.
    expect(session.leagueAgreedWithCopy()).toEqual([]);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    // Sent from here, the copy's League holds this device's own change, which the cloud's
    // documents may never have had: a first meeting's base holding it would read their lack of
    // it as a deletion, and drop it (1.6e review).
    expect(session.leagueAgreedWithCopy()).toEqual([]);
    await session.saveNow();
    expect(session.leagueAgreedWithCopy()).toEqual([]);
    // Taken in from the copy, it is the copy's.
    await open(phone);
    expect(session.leagueAgreedWithCopy().map(({ id, logs }) => ({ id, logs }))).toEqual([
      { id: "fall", logs: { g1: log(5, 3) } },
    ]);
    // Merged here with another device's change and sent, it is this device's own again.
    await open(laptop);
    await commitChanges({
      store: sky.store,
      base: sky.manifest(),
      changes: [
        {
          key: "league",
          value: league(season("fall", { g1: log(5, 3), g2: log(2, 2) })),
          at: Date.now(),
        },
      ],
      device: "phone",
      now: new Date().toISOString(),
    });
    edit(laptop, "league", league(season("fall", { g1: log(6, 3) })));
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(6, 3), g2: log(2, 2) });
    expect(session.leagueAgreedWithCopy()).toEqual([]);
    // Found again the same on both sides, with the record forgetting which version it last met,
    // what this device sent is still its own (on the page as reloaded once the merge was in).
    await open(laptop);
    saveCloudState({ ...loadCloudState(), hashes: { ...loadCloudState().hashes, league: "lost" } });
    session.noteChange("league");
    await session.saveNow();
    expect(loadCloudState().hashes.league).not.toBe("lost");
    expect(session.leagueAgreedWithCopy()).toEqual([]);
    await open(phone);
    // A base kept from some other agreement than the one this device last made is no base.
    const base = loadLeagueBase();
    if (!base) throw new Error("no base");
    saveLeagueBase({ ...base, hash: "not-the-copy's" });
    expect(session.leagueAgreedWithCopy()).toEqual([]);
  });
});

describe("League Standings kept live on a device", () => {
  /** League's switch on, and the cloud's seasons met here as this account (`useLiveLeague`). */
  const keepLive = () => {
    writeLiveLeague(true);
    noteLeagueMet(ME.uid);
  };

  it("is taken in from the copy, switch on, until this device has met the cloud's seasons, and sends it none", async () => {
    const { laptop, phone } = await inStep();
    // The phone's switch on, as by default, and nothing met there yet.
    runAs(phone);
    writeLiveLeague(true);
    await open(phone);
    edit(phone, "league", league(season("fall", { g1: log(5, 3) })));
    // Owed to the cloud's documents, at the first meeting, and to no copy.
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
    await session.saveNow();
    expect(await cloudLogs()).toEqual({});
    // The laptop, kept apart with its switch off, scores another game into the copy.
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g2: log(2, 2) })));
    await session.saveNow();
    // The phone takes it in beside its own score, and still sends the copy nothing.
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(2, 2) });
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false, newer: [] });
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g2: log(2, 2) });
    // A score changed both here and in the copy since keeps this device's, which nothing keeps in
    // the copy, held back for the cloud's documents.
    edit(phone, "league", league(season("fall", { g1: log(5, 3), g2: log(7, 7) })));
    later();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g2: log(8, 8) })));
    await session.saveNow();
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(7, 7) });
    edit(phone, "league", league(season("fall", { g1: log(5, 3), g2: log(2, 2) })));
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g2: log(2, 2) })));
    await session.saveNow();
    await open(phone);
    // What it agrees with the copy on is the copy's, which holds none of its own score.
    expect(session.leagueAgreedWithCopy().map(({ logs }) => logs)).toEqual([{ g2: log(2, 2) }]);
    // Met, it is League kept live, and the copy leaves it alone.
    noteLeagueMet(ME.uid);
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g2: log(3, 3) })));
    await session.saveNow();
    await open(phone);
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(2, 2) });
    // Turned off, it is a device kept apart, and what it held back goes to the copy, merged with
    // the copy's from the base it took in.
    writeLiveLeague(false);
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(5, 3), g2: log(3, 3) });
  });

  it("is neither sent to the copy nor taken from it, and owes it nothing", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    keepLive();
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

  it("takes the copy's at its first meeting with the copy, keeping this device's there as an earlier version", async () => {
    await laptopFirst({
      league: league(season("fall", { g1: log(5, 3) })),
      [TEAMS]: ["laptop pool"],
    });
    const before = await cloudLogs();
    expect(before).toEqual({ g1: log(5, 3) });
    // One whose season differs from the copy's in nothing both hold takes the copy's beside its
    // own, and keeps no version of its own there: it lost nothing.
    const phone = device({ league: league(season("fall", { g2: log(2, 2) })) });
    runAs(phone);
    writeLiveLeague(true);
    await session.signInToCloud();
    expect(logsOf(phone)).toEqual({ g1: log(5, 3), g2: log(2, 2) });
    expect(await cloudLogs()).toEqual(before);
    expect(sky.manifest()?.kept.filter((part) => part.key === "league")).toEqual([]);
    // A device with its own version of the copy's season meets the copy, its switch on.
    const tablet = device({ league: league(season("fall", { g1: log(1, 1) })) });
    runAs(tablet);
    writeLiveLeague(true);
    await session.signInToCloud();
    expect(logsOf(tablet)).toEqual(before);
    expect(await cloudLogs()).toEqual(before);
    const kept = (await keptValues("league")) as LeagueValue[];
    expect(kept.map((value) => value.seasons[0]?.logs)).toContainEqual({ g1: log(1, 1) });
  });

  it("leaves League out of a first copy, which carries the pool alone", async () => {
    const laptop = device({ league: fall, [TEAMS]: ["laptop pool"] });
    runAs(laptop);
    // Its switch on, met or not.
    writeLiveLeague(true);
    await session.signInToCloud();
    expect(sky.manifest()?.parts.map((part) => part.key)).toEqual([TEAMS]);
    // It met no League in the copy, so going back to the copy merges rather than takes over.
    expect(loadCloudState().met).toEqual({ pool: sky.manifest()?.copy });
  });

  it("marks a score the page writes while live, sends none of it, and sends it once turned off", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    onScreen();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval"] });
    const stop = session.startCloudSession();
    keepLive();
    // The page writes a score to storage, which tells the session, as on the site.
    laptop.values.set("league", league(season("fall", { g1: log(4, 0) })));
    saveLogs({ g1: log(4, 0) });
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await cloudLogs()).toEqual({});
    writeLiveLeague(false);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", owed: true });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    await vi.advanceTimersByTimeAsync(1_001);
    // The save has started; the copy's packing runs on the real clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    await vi.waitFor(() => expect(session.cloudStatus()).toMatchObject({ owed: false }));
    expect(await cloudLogs()).toEqual({ g1: log(4, 0) });
    stop();
  });

  it("neither offers nor brings back an earlier League version while live", async () => {
    const { laptop, phone } = await inStep();
    runAs(phone);
    edit(phone, "league", league(season("fall", { g1: log(5, 3) })));
    later();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(6, 3) })));
    await session.saveNow();
    await open(phone);
    await session.saveNow();
    const [kept] = session.cloudKept();
    expect(kept?.what).toEqual(["League Standings"]);
    // Its switch on, met or not.
    writeLiveLeague(true);
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
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    runAs(phone);
    onScreen();
    const stop = session.startCloudSession();
    await session.bootCloud();
    expect(session.cloudStatus()).toMatchObject({ newer: ["league"] });
    keepLive();
    expect(session.cloudStatus()).toMatchObject({ kind: "saved", newer: [] });
    stop();
  });

  it("goes back to the copy when turned off, sending what changed meanwhile", async () => {
    const { laptop } = await inStep();
    await open(laptop);
    keepLive();
    edit(laptop, "league", league(season("fall", { g1: log(4, 0) })));
    await session.saveNow();
    // Marked owed to the copy all along, and only not sent.
    expect(Object.keys(owedChanges())).toEqual(["league"]);
    writeLiveLeague(false);
    await session.saveNow();
    expect(await cloudLogs()).toEqual({ g1: log(4, 0) });
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
      on: true,
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
    writeLiveLeague(true);
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
    writeLiveLeague(true);
    noteLeagueMet("member-a");
    // Member B, on the same list and the same cloud, signs in on it.
    await session.signInToCloud();
    await session.preparePool();
    expect(session.cloudStatus()).toMatchObject({ kind: "saved" });
    // The live seasons are left as the live documents have them, not the copy's older League.
    expect(logsOf(tablet)).toEqual({ g1: log(6, 3) });
  });

  it("is not in step with the copy at a boot that never read it", async () => {
    const { laptop, phone } = await inStep();
    await open(laptop);
    edit(laptop, "league", league(season("fall", { g1: log(5, 3) })));
    await session.saveNow();
    runAs(phone);
    writeLiveLeague(true);
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
    writeLiveLeague(true);
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
    writeLiveLeague(true);
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
