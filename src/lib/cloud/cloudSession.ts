import { coerceBackup } from "../backup";
import type { LiveReader } from "../live/viewStore";
import { onLeagueWrite } from "../storage";
import { isCloudPoolKey, onCloudPoolWrite } from "../teamRankingsStorage";
import { isPoolBusy, poolJobElsewhere, watchPull } from "../pullSession";
import { FIREBASE_WEB_CONFIG, type FirebaseWebConfig } from "./cloudConfig";
import { DATA_SCHEMA, type CloudManifest, type KeptPart } from "./cloudManifest";
import {
  commitChanges,
  fetchValues,
  sweepUploads,
  timed,
  timedStore,
  type Change,
  type CloudStore,
} from "./cloudEngine";
import { hashValue } from "./cloudPack";
import { appLocalSource, type LocalSource } from "./cloudLocal";
import { areaOf, LEAGUE_PART, planArea, type Area, type KeyAction } from "./cloudPlan";
import { joinLeagues, mergeLeague, type LeagueValue, type Prefer } from "./leagueMerge";
import {
  clearOwed,
  CLOUD_STATE_KEY,
  loadCloudState,
  loadLeagueBase,
  markCloudDirty,
  owedChanges,
  saveCloudState,
  saveLeagueBase,
  settleOwed,
  type DeviceCloudState,
  type UploadBatch,
} from "./cloudState";
import { markTaken, mayWrite } from "./cloudGuard";
import { announceTaken, reloadWhenFree } from "./cloudTabs";
import type { CloudAccount, FirebaseCloud } from "./firebaseCloud";
import type { Member } from "./members";
import { setGcAuthorization } from "../gcAuthorization";

/**
 * Keeping this browser's data in the cloud: the one place that decides when to save, when to take
 * another device's changes, and when to wait.
 *
 * Nothing here runs for a browser that has never signed in: the Firebase SDK is imported on the
 * first sign-in and on each start after it, and not before. What it guarantees, in order of how
 * much it matters:
 *
 * 1. Nothing is lost. Changes on two devices are merged: League Standings record by record, the
 *    pool key by key. Where both changed the same thing, the later change is kept and the other is
 *    kept too, in the cloud copy, for thirty days, where any device can bring it back. A browser
 *    whose storage cannot be read syncs nothing, since what it holds is not what it has.
 * 2. Every change made here is saved. Each write to a key the copy holds is recorded as owed, in
 *    storage rather than memory, so a closed tab still owes it the next time the app opens.
 * 3. Nothing is swapped in under whoever is looking. Another device's changes are taken in before
 *    anything reads them: League Standings at startup, before the app draws; the pool when Team
 *    Rankings opens, before it draws. Found while the app is open, they are taken when the page is
 *    left or comes back, or left alone a while, or when asked, and the page reloads onto them.
 * 4. It stays free. The pool, tens of megabytes, is downloaded only by a device that opens Team
 *    Rankings; a device looks for changes only while it is on screen, and backs off after errors.
 *
 * Everything that reads the copy and decides runs under one Web Lock across the browser's tabs, and
 * reads the copy and this device's record afresh inside it.
 */

export type KeptVersion = {
  group: string;
  keptAt: string;
  /** `replaced`: the cloud's, overwritten by a later change. `lost`: a device's, not taken. */
  why: "replaced" | "lost";
  /** Whether this browser saved it. */
  fromHere: boolean;
  /** What it holds, as the user knows it. */
  what: string[];
  bytes: number;
};

export type CloudStatus =
  /** No Firebase project to keep a copy in: the feature is not there to offer. */
  | { kind: "off" }
  /** This browser keeps no copy and never has: signing in is offered in Settings only. */
  | { kind: "none" }
  /** This browser keeps a copy but is signed out, by choice or because the sign-in lapsed. */
  | { kind: "signed-out" }
  /** Opening: finding who is signed in and what the cloud holds. */
  | { kind: "connecting" }
  | { kind: "working"; account: CloudAccount; label: string; progress?: [number, number] }
  | {
      kind: "saved";
      account: CloudAccount;
      syncedAt?: string;
      /** Changes made here that are not in the cloud yet. */
      owed: boolean;
      /** Why they are waiting, when it is not just the few seconds a save waits for more. */
      waiting?: "pull" | "storage" | "unreadable";
      /** Areas another device has changed, not taken in here yet. */
      newer: Area[];
      /** Something a settlement did that the user may want to know about. */
      notice?: string;
    }
  /** This browser has met a copy, and there is none now. */
  | { kind: "gone"; account: CloudAccount }
  | { kind: "not-owner"; account: CloudAccount }
  /** The copy was saved by a newer version of the app, which this one must not read or write. */
  | { kind: "update"; account: CloudAccount }
  | { kind: "error"; account: CloudAccount | null; message: string };

type Session = {
  cloud: FirebaseCloud;
  store: CloudStore;
  account: CloudAccount | null;
};

/**
 * The copy as this session last found it: the manifest a read returned, or the one this device's
 * own save committed. Its id, version, and each part's key and hash, which is what a published
 * board says it was built from (`boardInputsPrint`), so a device can tell whether the board on its
 * screen is the copy's as it stands. Never this device's own hashes (`DeviceCloudState.hashes`),
 * which a pool not taken in yet leaves behind the copy.
 */
export type CopySeen = {
  copy: string;
  version: number;
  parts: ReadonlyArray<readonly [key: string, hash: string]>;
};

/** How long after the last change a save waits, so a burst of edits is one save. */
export const SAVE_DELAY_MS = 20_000;
/** How often an open tab on screen looks for another device's save. */
const LOOK_EVERY_MS = 10 * 60_000;
/** The least time between two looks. */
const LOOK_GAP_MS = 60_000;
/** How long without a tap or a key before a tab on screen counts as left alone. */
export const IDLE_MS = 2 * 60_000;
/**
 * At startup, how long the app waits to hear from the cloud before opening on what this browser
 * has: signing in and reading the copy's contents.
 */
export const STARTUP_WAIT_MS = 4_000;
/** And how much longer for League Standings to arrive, before it opens anyway. */
export const STARTUP_TAKE_MS = 6_000;
/** How long startup waits in silence before saying what it is waiting for. */
const STARTUP_HINT_MS = 400;
/** How long to wait for another tab's work on the copy before giving up for now. */
const LOCK_WAIT_MS = 45_000;
/** The longest a failing save or look waits before trying again. */
const MAX_BACKOFF_MS = 30 * 60_000;
/**
 * How long a save's uploaded pieces are left alone before a later save may clear them as never
 * committed. A commit given up on here can still land: Firestore lets a transaction run for 270
 * seconds. Cleared sooner, a commit that landed late would name pieces already gone, and every
 * other device would find the copy missing a part.
 */
export const SWEEP_AFTER_MS = 10 * 60_000;

const LOCK = "league_forecast_cloud";

let session: Session | null = null;
let status: CloudStatus = { kind: "off" };
const listeners = new Set<(status: CloudStatus) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastLook = 0;
let failures = 0;
let newer = new Set<Area>();
let notice: string | undefined;
let kept: readonly KeptPart[] = [];
/** Whether the app is on screen yet: a startup take that arrives after it waits to be asked. */
let drawn = false;
/** Whether Team Rankings has been opened in this page, so its pool is worth keeping current. */
let poolOpen = false;
/** Whether Team Rankings is on screen, so the pool can no longer arrive under it. */
let poolShown = false;
/** The pool being brought in step before Team Rankings draws, while it is. */
let poolPreparing: Promise<void> | null = null;
let lastInput = 0;
let stopSession: (() => void) | null = null;
let seen: CopySeen | null = null;

/** Stand-ins for Firebase, the browser's stores and the clock, for tests. */
let openCloud: (config: FirebaseWebConfig) => Promise<FirebaseCloud> = async (config) =>
  (await import("./firebaseCloud")).openFirebaseCloud(config);
let local: LocalSource = appLocalSource;
let config: () => FirebaseWebConfig | null = () => FIREBASE_WEB_CONFIG;
let reload: () => void = reloadWhenFree;
let now: () => number = () => Date.now();
let roomFor: (bytes: number) => Promise<boolean> = async (bytes) => {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return true;
    // The JSON, the store's own copy of it and the cache beside it, with room to spare.
    return estimate.quota - (estimate.usage ?? 0) > bytes * 3;
  } catch {
    return true;
  }
};

export const setCloudTestHooks = (hooks: {
  openCloud?: typeof openCloud;
  local?: LocalSource;
  config?: () => FirebaseWebConfig | null;
  reload?: () => void;
  now?: () => number;
  roomFor?: (bytes: number) => Promise<boolean>;
}): void => {
  if (hooks.openCloud) openCloud = hooks.openCloud;
  if (hooks.local) local = hooks.local;
  if (hooks.config) config = hooks.config;
  if (hooks.reload) reload = hooks.reload;
  if (hooks.now) now = hooks.now;
  if (hooks.roomFor) roomFor = hooks.roomFor;
};

/** Forgets the session, for tests. */
export const resetCloudSession = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  session = null;
  status = { kind: "off" };
  listeners.clear();
  lastLook = 0;
  failures = 0;
  newer = new Set();
  notice = undefined;
  kept = [];
  drawn = false;
  poolOpen = false;
  poolShown = false;
  poolPreparing = null;
  lastInput = 0;
  stopSession?.();
  stopSession = null;
  seen = null;
};

/*
 * A GameChanger pull carries the signed-in account's token to the proxy, which is for the accounts
 * on the copy's list (`memberCheck.ts`). Only a session already open is asked: a browser nobody
 * signed in to has none to give, and must not download Firebase to find that out. An open one
 * gives whatever Firebase says of who is signed in, which is none after signing out.
 */
setGcAuthorization(async () => (session ? session.cloud.idToken() : null));

export const cloudStatus = (): CloudStatus => status;

export const subscribeCloud = (listener: (status: CloudStatus) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const setStatus = (next: CloudStatus): void => {
  status = next;
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      /* one view that cannot cope must not stop the others hearing */
    }
  });
};

const nowIso = (): string => new Date(now()).toISOString();

const within = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** Firebase's own name for what went wrong (`auth/popup-blocked`, `permission-denied`), if any. */
const codeOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";

/** A sign-in the user walked away from: no error to show, just back where they were. */
const LEFT_SIGN_IN = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

/** What to tell someone for the ways sign-in fails that they can do something about. */
const SIGN_IN_MESSAGES: Record<string, string> = {
  "auth/popup-blocked":
    "The browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.",
  "auth/unauthorized-domain":
    "This web address is not on the Firebase project's list of sites allowed to sign in (Authentication, Settings, Authorized domains).",
  "auth/operation-not-allowed":
    "Google sign-in is not turned on in the Firebase project (Authentication, Sign-in method).",
  "auth/web-storage-unsupported":
    "This browser is blocking the storage that signing in needs. A private window will not work.",
  "auth/network-request-failed":
    "Could not reach Google to sign in. Check the connection and try again.",
};

const OFFLINE =
  "Could not reach the cloud. Your data is safe on this device, and it will try again.";

const messageOf = (error: unknown): string => {
  const known = SIGN_IN_MESSAGES[codeOf(error)];
  if (known) return known;
  const text = error instanceof Error ? error.message : String(error);
  if (codeOf(error) === "permission-denied" || /permission|insufficient/i.test(text)) {
    return "The cloud copy refused this account. Is it still on the list of accounts that may use it?";
  }
  // Safari says "Load failed" for a request the network dropped; Chrome, "Failed to fetch".
  if (
    ["unavailable", "deadline-exceeded"].includes(codeOf(error)) ||
    /offline|network|unavailable|failed to fetch|load failed|took too long/i.test(text)
  ) {
    return OFFLINE;
  }
  return text || "Something went wrong talking to the cloud.";
};

const UNUSABLE =
  "This browser cannot open its Team Rankings storage right now, so it is not syncing: what it holds is not all it has. Reloading the page usually brings the storage back.";

/**
 * Runs one save, load or decision at a time across every open tab, where the browser offers a lock,
 * and says whether it ran. `skip` gives up at once when another tab holds the lock, for work that
 * would only be waiting to find the other tab's done; otherwise it waits a while, then gives up,
 * rather than waiting for ever on a tab the browser has frozen.
 */
const exclusively = async (
  work: () => Promise<void>,
  { skip = false }: { skip?: boolean } = {}
): Promise<boolean> => {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) {
    await work();
    return true;
  }
  if (skip) {
    let ran = false;
    await locks.request(LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ran = true;
      await work();
    });
    return ran;
  }
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(LOCK_WAIT_MS)
      : undefined;
  try {
    await locks.request(LOCK, signal ? { signal } : {}, work);
    return true;
  } catch (error) {
    if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
      return false;
    }
    throw error;
  }
};

const owedHere = (): boolean => Object.keys(owedChanges()).length > 0;

type Waiting = "pull" | "storage" | "unreadable";

const savedStatus = (account: CloudAccount, waiting?: Waiting): CloudStatus => {
  const state = loadCloudState();
  const owed = owedHere();
  const why = waiting ?? (owed && isPoolBusy() ? "pull" : undefined);
  return {
    kind: "saved",
    account,
    ...(state.syncedAt ? { syncedAt: state.syncedAt } : {}),
    owed,
    ...(why ? { waiting: why } : {}),
    newer: [...newer],
    ...(notice ? { notice } : {}),
  };
};

const signedIn = (): CloudAccount | null => session?.account ?? null;

/** The copy as `manifest` says it is, for `copySeen`. */
const seenOf = (manifest: CloudManifest | null): CopySeen | null =>
  manifest
    ? {
        copy: manifest.copy,
        version: manifest.version,
        parts: manifest.parts.map((part) => [part.key, part.hash] as const),
      }
    : null;

/** `store`, noting each manifest a read returns and each this device's save commits (`copySeen`). */
const seeing = (store: CloudStore): CloudStore => ({
  ...store,
  readManifest: async () => {
    const manifest = await store.readManifest();
    seen = seenOf(manifest);
    return manifest;
  },
  commitManifest: async (expected, next) => {
    const committed = await store.commitManifest(expected, next);
    if (committed) seen = seenOf(next);
    return committed;
  },
});

const loadSession = async (): Promise<Session | null> => {
  if (session) return session;
  const settings = config();
  if (!settings) return null;
  const cloud = await openCloud(settings);
  session = { cloud, store: seeing(timedStore(cloud.store)), account: null };
  return session;
};

/**
 * The copy as this session last read or saved it, or null before any read or save, after a reset
 * or a sign-out, and when there was no copy.
 */
export const copySeen = (): CopySeen | null => seen;

/** How long a read of `live/` may take: the meta is one small document, a piece one of 900 KB. */
const LIVE_LIMITS = { meta: 10_000, chunk: 30_000 } as const;

/**
 * The views a server publishes, as this browser's signed-in member may read them, or null when it
 * may not: a browser that keeps no cloud copy (asked first, so one that never signed in never loads
 * Firebase to find that out), no configuration, nobody signed in, or someone other than the
 * account this browser's record is for. Each read has a limit, as the copy's do (`timedStore`).
 */
export const liveReader = async (): Promise<LiveReader | null> => {
  const state = loadCloudState();
  if (!state.enabled || !state.uid) return null;
  const current = await loadSession();
  if (!current) return null;
  const account = await current.cloud.account();
  if (!account || account.uid !== state.uid) return null;
  const { live } = current.cloud;
  return {
    readMeta: () => timed(live.readMeta(), LIVE_LIMITS.meta, "reading the published boards"),
    getChunk: (id) => timed(live.getChunk(id), LIVE_LIMITS.chunk, "fetching a published board"),
    // A watch has no limit: it says itself when the connection drops.
    ...(live.watchMeta ? { watchMeta: live.watchMeta } : {}),
  };
};

/** Every League Standings season in `raw`, read as a backup is, or null for anything else. */
const leagueOf = (raw: unknown): LeagueValue | null => {
  const parsed = coerceBackup(raw);
  return parsed?.kind === "full" ? { seasons: parsed.backup.seasons } : null;
};

/**
 * Whether this browser still keeps the record a settlement began with: not signed out, and not
 * wiped by Delete everything, in this tab or another, while it ran. Asked after this device's
 * values are read and before anything is sent, and again before anything is written here: values
 * read from a wiped store would go to every device as the user's data, and a copy written into a
 * wiped store would bring back what the user just deleted.
 */
const stillOurs = (state: DeviceCloudState, account: CloudAccount): boolean => {
  const now = loadCloudState();
  return now.enabled && now.uid === account.uid && now.device === state.device;
};

/**
 * The record of one save's uploads, kept in the device's standing as a batch: noted as the pieces
 * go up, stamped again when the save ends however it ends, and dropped once its commit is known.
 */
const uploadRecord = () => {
  let first: string | undefined;
  const isMine = (batch: UploadBatch) => first !== undefined && batch.ids[0] === first;
  return {
    note: (ids: string[]) => {
      first = ids[0];
      const state = loadCloudState();
      saveCloudState({
        ...state,
        uploads: [...state.uploads.filter((batch) => !isMine(batch)), { ids, at: now() }],
      });
    },
    /** The save is over: a commit it gave up on could land for a while yet, counted from now. */
    stamp: () => {
      if (first === undefined) return;
      const state = loadCloudState();
      saveCloudState({
        ...state,
        uploads: state.uploads.map((batch) => (isMine(batch) ? { ...batch, at: now() } : batch)),
      });
    },
    /** The batches still to clear, less this save's, whose commit landed. */
    without: (batches: readonly UploadBatch[]): UploadBatch[] =>
      batches.filter((batch) => !isMine(batch)),
  };
};

/** Whether `value` reads back as League Standings with a season in it, as every device must. */
const holdsSeasons = (value: unknown): boolean => (leagueOf(value)?.seasons.length ?? 0) > 0;

/** How long to wait before trying again after `failures` failures in a row. */
const backoff = (): number => Math.min(60_000 * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);

/**
 * When this device may write data that arrived from the cloud:
 * - `boot`: League Standings, before the app draws;
 * - `gate`: the pool, before Team Rankings draws;
 * - `page`: anything this page has open, and the page reloads onto it;
 * - `none`: nothing now; what needs writing waits, and the page says newer data is there.
 */
type ApplyMode = "boot" | "gate" | "page" | "none";

const mayApply = (area: Area, mode: ApplyMode): boolean => {
  switch (mode) {
    case "boot":
      return area === "league" && !drawn;
    case "gate":
      return area === "pool" && !poolShown;
    case "page":
      return (area === "league" || poolOpen) && !isPoolBusy();
    case "none":
      return false;
  }
};

const needsWriteHere = (action: KeyAction): boolean =>
  action === "take" || action === "merge" || action === "cloud-wins";

type Merged = {
  value: LeagueValue;
  conflicts: number;
  renamed: Record<string, string>;
  prefer: Prefer;
  /** This device's seasons before the merge, kept in the copy if they lost anything. */
  mine: LeagueValue;
};

/**
 * Brings this device and the cloud copy into step in `areas`, as far as `mode` allows writing here.
 * Reads the copy and this device's record afresh; the caller holds the lock.
 *
 * In one pass: everything to take is downloaded and checked first; then one commit sends this
 * device's changes and keeps whatever a settlement is about to replace; then what arrived is
 * written here, less any key changed here while it downloaded, which is settled next time. So a
 * value is never overwritten here before the version it replaces is safe in the copy.
 *
 * Says whether it went as it should: false for a failure worth backing off from, such as a copy
 * with a piece missing, which every look would otherwise download again up to the missing piece.
 */
const settleLocked = async (
  current: Session,
  account: CloudAccount,
  areas: readonly Area[],
  mode: ApplyMode,
  attempt = 0
): Promise<boolean> => {
  if (!local.usable()) {
    setStatus({ kind: "error", account, message: UNUSABLE });
    return false;
  }
  let state = loadCloudState();
  if (!state.enabled || state.uid !== account.uid) return true;
  const manifest = await current.store.readManifest();
  // Pieces of saves that never committed, once no commit of theirs can still land.
  const due = state.uploads.filter((batch) => now() - batch.at > SWEEP_AFTER_MS);
  if (due.length > 0) {
    await sweepUploads(
      current.store,
      manifest,
      due.flatMap((batch) => batch.ids)
    );
    const swept = new Set(due.map((batch) => batch.ids[0]));
    const after = loadCloudState();
    state = { ...after, uploads: after.uploads.filter((batch) => !swept.has(batch.ids[0])) };
    saveCloudState(state);
  }
  if (!manifest) {
    if (state.met.league || state.met.pool) {
      setStatus({ kind: "gone", account });
      return true;
    }
    return firstCopy(current, account, state);
  }
  kept = manifest.kept;
  // Refused before anything is downloaded: a copy from a newer build, or one naming keys this build
  // does not keep, would be read wrong and saved back wrong.
  if (
    manifest.schema > DATA_SCHEMA ||
    manifest.parts.some((part) => part.key !== LEAGUE_PART && !isCloudPoolKey(part.key))
  ) {
    setStatus({ kind: "update", account });
    return false;
  }

  const owed = owedChanges();
  // Each value as this settlement first read it, and its fingerprint: what the plan was made from.
  const reads = new Map<string, Promise<unknown>>();
  const readOnce = (key: string): Promise<unknown> => {
    const known = reads.get(key);
    if (known) return known;
    const value = local.read(key);
    reads.set(key, value);
    return value;
  };
  const hashes = new Map<string, Promise<string | null>>();
  const localHash = (key: string): Promise<string | null> => {
    const known = hashes.get(key);
    if (known) return known;
    const hash = readOnce(key).then((value) =>
      value === null || value === undefined ? null : hashValue(value)
    );
    hashes.set(key, hash);
    return hash;
  };

  // A pull or a tidy rewrites the pool for minutes at a time, and saves it every couple of thousand
  // teams: nothing of the pool moves either way until it has finished, in this tab or any other.
  const poolBusy = areas.includes("pool") && (isPoolBusy() || (await poolJobElsewhere()));
  const deferred = new Set<Area>();
  const execute: [string, KeyAction][] = [];
  const meetings = new Set<Area>();
  for (const area of areas) {
    if (area === "pool" && poolBusy) continue;
    // A tab that read this area before another tab took a copy in holds values older than what
    // is stored: sent, they would undo what that tab took (a deletion brought back, say). It
    // sends nothing of the area, and is told to reload (`cloudGuard.ts`).
    if (!mayWrite(area)) continue;
    const plan = await planArea({
      manifest,
      state: { met: state.met, hashes: state.hashes, dirty: owed },
      area,
      held: local.keys(area),
      localEmpty: local.empty(area),
      localHash,
    });
    const writable = mayApply(area, mode);
    const writes = [...plan.actions.values()].some(needsWriteHere);
    if (plan.meeting) {
      // A first meeting is all or nothing: half a pool taken over half a pool kept is neither.
      if (writes && !writable) {
        deferred.add(area);
        continue;
      }
      meetings.add(area);
    }
    for (const [key, action] of plan.actions) {
      if (needsWriteHere(action) && !writable) deferred.add(area);
      else execute.push([key, action]);
    }
  }

  // Everything to write here, downloaded and checked before anything is sent or written.
  const wanted = new Set(
    execute.filter(([, action]) => needsWriteHere(action)).map(([key]) => key)
  );
  const toFetch = manifest.parts.filter((part) => wanted.has(part.key));
  let fetched = new Map<string, unknown>();
  if (toFetch.length > 0) {
    const poolBytes = toFetch
      .filter((part) => areaOf(part.key) === "pool")
      .reduce((sum, part) => sum + part.bytes, 0);
    if (poolBytes > 0 && !(await roomFor(poolBytes))) {
      setStatus({
        kind: "error",
        account,
        message:
          "This device is too short of storage to hold Team Rankings from the cloud. Nothing here was changed.",
      });
      return false;
    }
    setStatus({ kind: "working", account, label: "Loading your data from the cloud…" });
    const result = await fetchValues({
      store: current.store,
      parts: toFetch,
      onProgress: (done, total) =>
        setStatus({
          kind: "working",
          account,
          label: "Loading your data from the cloud…",
          progress: [done, total],
        }),
    });
    if (!result.ok) {
      setStatus({
        kind: "error",
        account,
        message:
          result.reason === "missing"
            ? "Part of the cloud copy is missing. Nothing here was changed; it will try again."
            : "Part of the cloud copy is damaged. Nothing here was changed; open the app on the device that saved last, so it can save again.",
      });
      return false;
    }
    fetched = result.values;
  }

  // League Standings changed on both sides: merged, record by record.
  let merged: Merged | null = null;
  if (execute.some(([key, action]) => key === LEAGUE_PART && action === "merge")) {
    const theirs = leagueOf(fetched.get(LEAGUE_PART));
    const mine = leagueOf(await local.read(LEAGUE_PART));
    const part = manifest.parts.find((one) => one.key === LEAGUE_PART);
    if (!theirs || !mine || !part) {
      setStatus({
        kind: "error",
        account,
        message: "League Standings in the cloud copy could not be read. Nothing here was changed.",
      });
      return false;
    }
    const meeting = meetings.has("league");
    const prefer: Prefer = !meeting && (owed[LEAGUE_PART] ?? 0) > part.at ? "local" : "cloud";
    const base = loadLeagueBase();
    const was =
      !meeting && base && base.hash === state.hashes[LEAGUE_PART] ? leagueOf(base.value) : null;
    const result = was ? mergeLeague(was, mine, theirs, prefer) : joinLeagues(mine, theirs, prefer);
    // Read back the way every other copy of the seasons is, so its fingerprint is the one a device
    // holding it computes.
    merged = { ...result, value: leagueOf(result.value) ?? result.value, prefer, mine };
  }

  // One commit: this device's changes, and whatever a settlement is about to replace.
  const changes: Change[] = [];
  const keepReplaced: string[] = [];
  const keepLost: Change[] = [];
  const notStored = local.notStored();
  let waiting: Waiting | undefined;
  const sentValues = new Map<string, unknown>();
  for (const [key, action] of execute) {
    const at = owed[key] ?? now();
    if (action === "send" || action === "local-wins") {
      if (notStored.has(key)) {
        waiting = "storage";
        continue;
      }
      const value = await local.read(key);
      if ((value === null || value === undefined) && local.keys(areaOf(key)).includes(key)) {
        // Listed and yet not readable: a read that failed, not a value removed. That key waits;
        // the rest of the save goes on.
        waiting = "unreadable";
        continue;
      }
      // Seasons that would not read back would stop every device taking League Standings at all.
      if (key === LEAGUE_PART && !holdsSeasons(value)) {
        waiting = "unreadable";
        continue;
      }
      changes.push({ key, value: value ?? null, at });
      sentValues.set(key, value ?? null);
      if (action === "local-wins" && manifest.parts.some((part) => part.key === key)) {
        keepReplaced.push(key);
      }
    } else if (action === "cloud-wins") {
      const value = await local.read(key);
      if (value !== null && value !== undefined) keepLost.push({ key, value, at });
    } else if (action === "merge" && merged) {
      if (!holdsSeasons(merged.value)) {
        waiting = "unreadable";
        continue;
      }
      changes.push({ key, value: merged.value, at: now() });
      sentValues.set(key, merged.value);
      if (merged.conflicts > 0) {
        if (merged.prefer === "local") keepReplaced.push(key);
        else keepLost.push({ key, value: merged.mine, at });
      }
    }
  }

  // Everything to send is read. Read from a store wiped since, it is not the user's data at all.
  if (!stillOurs(state, account)) return true;

  let settled = manifest;
  let sent: Record<string, string | null> = {};
  const batch = uploadRecord();
  if (changes.length > 0 || keepReplaced.length > 0 || keepLost.length > 0) {
    setStatus({ kind: "working", account, label: "Saving to the cloud…" });
    const result = await commitChanges({
      store: current.store,
      base: manifest,
      changes,
      keepReplaced,
      keepLost,
      device: state.device,
      now: nowIso(),
      onUploads: batch.note,
      onProgress: (done, total) =>
        setStatus({
          kind: "working",
          account,
          label: "Saving to the cloud…",
          progress: [done, total],
        }),
    }).finally(batch.stamp);
    if (!result.ok) {
      // Another device saved first: decide again from what is there now. Twice at most, so two
      // devices saving in step cannot keep each other going.
      if (attempt < 2) return settleLocked(current, account, areas, mode, attempt + 1);
      setStatus({ kind: "error", account, message: "The cloud copy kept changing. Try again." });
      return false;
    }
    settled = result.manifest;
    sent = result.sent;
    kept = settled.kept;
  }

  // What arrived, written here, less anything changed here while it downloaded.
  const owedNow = owedChanges();
  const changedSince = (key: string) => owedNow[key] !== owed[key];
  const arriving = new Map<string, unknown>();
  for (const [key, action] of execute) {
    if (!needsWriteHere(action) || changedSince(key)) continue;
    if (action === "merge") {
      if (merged) arriving.set(key, merged.value);
    } else {
      arriving.set(key, fetched.has(key) ? fetched.get(key) : null);
    }
  }
  // Asked again now the download is done: the app may have drawn around a startup take, Team
  // Rankings drawn around a gate's (its skip button, or a return to it), or a pull begun meanwhile.
  // Such an area waits to be asked, rather than land under whoever is looking at it.
  for (const area of new Set([...arriving.keys()].map(areaOf))) {
    const busy = area === "pool" && (isPoolBusy() || (await poolJobElsewhere()));
    if (mayApply(area, mode) && !busy) continue;
    for (const key of [...arriving.keys()]) if (areaOf(key) === area) arriving.delete(key);
    deferred.add(area);
  }
  // Wiped or signed out meanwhile: what arrived is not written into a store the user emptied.
  if (!stillOurs(state, account)) return true;
  const applied =
    arriving.size === 0 ||
    (await local.apply(arriving, merged ? { renamed: merged.renamed } : undefined));

  // This device's record, as it now stands.
  const next = loadCloudState();
  const known = { ...next.hashes };
  const record = (key: string, hash: string | null | undefined) => {
    if (hash) known[key] = hash;
    else delete known[key];
  };
  const cloudHash = (key: string) => settled.parts.find((part) => part.key === key)?.hash;
  let leagueShared: { hash: string; value: unknown } | null = null;
  for (const [key, action] of execute) {
    const at = owed[key];
    const clear = () => {
      if (at !== undefined) settleOwed(key, at);
    };
    if (action === "send" || action === "local-wins") {
      if (!(key in sent)) continue;
      const hash = sent[key];
      record(key, hash);
      clear();
      if (key === LEAGUE_PART && hash) leagueShared = { hash, value: sentValues.get(key) };
    } else if (action === "synced") {
      const hash = cloudHash(key);
      record(key, hash);
      clear();
      // The seasons as the plan read them, whose fingerprint is the copy's: read again now, they
      // could hold an edit made meanwhile, and a base holding it would drop it at the next merge.
      if (key === LEAGUE_PART && hash) leagueShared = { hash, value: await readOnce(key) };
    } else if (arriving.has(key) && applied) {
      // A merge sent but not written here stays owed, against its old base: merged again next time.
      const hash = action === "merge" ? sent[key] : cloudHash(key);
      record(key, hash);
      clear();
      if (key === LEAGUE_PART && hash) leagueShared = { hash, value: arriving.get(key) };
    }
  }
  const met = { ...next.met };
  const stillOwed = owedChanges();
  for (const area of meetings) {
    if (deferred.has(area) || !applied) continue;
    met[area] = settled.copy;
    // Every key of a met area is now the copy's, or on its way there.
    for (const key of Object.keys(known)) {
      if (areaOf(key) === area && !settled.parts.some((part) => part.key === key))
        delete known[key];
    }
    for (const part of settled.parts) {
      if (areaOf(part.key) === area && !(part.key in stillOwed)) known[part.key] = part.hash;
    }
  }
  const written = saveCloudState({
    ...next,
    met,
    hashes: known,
    copy: settled.copy,
    version: settled.version,
    syncedAt: nowIso(),
    uploads: batch.without(next.uploads),
  });
  if (leagueShared) saveLeagueBase(leagueShared);

  if (!applied) {
    setStatus({
      kind: "error",
      account,
      message:
        "This browser would not store the cloud copy: it may be out of space. Your changes here are kept, and it will try again.",
    });
    return false;
  }
  for (const area of areas) {
    if (!deferred.has(area) && !(area === "pool" && poolBusy)) newer.delete(area);
  }
  // A pool this page has not opened is not offered: Team Rankings takes it in when it opens.
  deferred.forEach((area) => {
    if (area === "league" || poolOpen) newer.add(area);
  });
  if (merged && merged.conflicts > 0) {
    notice =
      "One part of League Standings was changed differently on two devices. The later change was kept; the other is kept below, and can be brought back.";
  } else if (execute.some(([, action]) => action === "local-wins" || action === "cloud-wins")) {
    notice =
      "Team Rankings changed on two devices. The later change was kept; the other is kept below, and can be brought back.";
  }
  if (arriving.size > 0 && written) {
    new Set([...arriving.keys()].map(areaOf)).forEach((area) =>
      markTaken(area, mode === "boot" || mode === "gate")
    );
    announceTaken();
    if (mode === "page") {
      reload();
      return true;
    }
  }
  setStatus(savedStatus(account, waiting));
  // Still owed for a reason that waiting 20 seconds will not change (a pull, a refused write, a
  // failed read) is sent by what ends the wait, not by reading the copy again every 20 seconds.
  if (owedHere() && !poolBusy && !waiting) scheduleSave();
  return true;
};

/**
 * This browser's data as the first copy there is: everything it holds, League Standings and pool,
 * sent whole. Refused if a copy appeared first, which is then met like any other.
 */
const firstCopy = async (
  current: Session,
  account: CloudAccount,
  state: DeviceCloudState
): Promise<boolean> => {
  if (isPoolBusy() || (await poolJobElsewhere())) {
    setStatus(savedStatus(account, "pull"));
    scheduleSave(60_000);
    return true;
  }
  const owed = owedChanges();
  const notStored = local.notStored();
  const changes: Change[] = [];
  const values = new Map<string, unknown>();
  for (const key of [...local.keys("league"), ...local.keys("pool")]) {
    if (notStored.has(key)) continue;
    const value = await local.read(key);
    if (value === null || value === undefined) continue;
    if (key === LEAGUE_PART && !holdsSeasons(value)) continue;
    changes.push({ key, value, at: owed[key] ?? now() });
    values.set(key, value);
  }
  if (!stillOurs(state, account)) return true;
  setStatus({ kind: "working", account, label: "Saving to the cloud…" });
  const batch = uploadRecord();
  const result = await commitChanges({
    store: current.store,
    base: null,
    changes,
    device: state.device,
    now: nowIso(),
    onUploads: batch.note,
    onProgress: (done, total) =>
      setStatus({
        kind: "working",
        account,
        label: "Saving to the cloud…",
        progress: [done, total],
      }),
  }).finally(batch.stamp);
  if (!result.ok) {
    // Another browser made the first copy first: meet it.
    return settleLocked(current, account, ["league", "pool"], "none");
  }
  for (const change of changes) {
    const at = owed[change.key];
    if (at !== undefined) settleOwed(change.key, at);
  }
  const hashes = Object.fromEntries(
    Object.entries(result.sent).filter((entry): entry is [string, string] => entry[1] !== null)
  );
  saveCloudState({
    ...loadCloudState(),
    met: { league: result.manifest.copy, pool: result.manifest.copy },
    hashes,
    copy: result.manifest.copy,
    version: result.manifest.version,
    syncedAt: nowIso(),
    uploads: batch.without(loadCloudState().uploads),
  });
  const league = hashes[LEAGUE_PART];
  if (league) saveLeagueBase({ hash: league, value: values.get(LEAGUE_PART) });
  kept = result.manifest.kept;
  setStatus(savedStatus(account));
  return true;
};

/** Runs `work` for the signed-in owner under the lock, saying what went wrong if it fails. */
const withSession = async (
  work: (current: Session, account: CloudAccount) => Promise<unknown>,
  { skip = false }: { skip?: boolean } = {}
): Promise<boolean> => {
  const current = session;
  const account = signedIn();
  if (!current || !account || !loadCloudState().enabled) return false;
  try {
    let outcome: unknown;
    const ran = await exclusively(
      async () => {
        outcome = await work(current, account);
      },
      { skip }
    );
    // A settlement that went wrong without throwing (a piece missing, a write refused here) backs
    // off like one that threw, rather than downloading the copy again at every look.
    if (ran && outcome === false) failures += 1;
    else if (ran) failures = 0;
    return ran;
  } catch (error) {
    failures += 1;
    if (error instanceof Error && error.name === "UnreadableCopyError") {
      setStatus({ kind: "update", account });
    } else {
      setStatus({ kind: "error", account, message: messageOf(error) });
    }
    return false;
  }
};

/** Whether this page may take changes in now: left, or left alone a while. */
const quietNow = (): boolean =>
  typeof document === "undefined" ||
  document.visibilityState === "hidden" ||
  now() - lastInput > IDLE_MS;

/**
 * Records a change made here, and saves it once things are quiet. What the storage layer's write
 * notices call (`onCloudPoolWrite`, `onLeagueWrite`); exported for tests.
 */
export const noteChange = (key: string): void => {
  markCloudDirty(key);
  const account = signedIn();
  if (!account || !loadCloudState().enabled) return;
  if (status.kind === "saved") setStatus(savedStatus(account));
  scheduleSave();
};

export const scheduleSave = (delay = SAVE_DELAY_MS): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, delay);
};

/**
 * Sends what this browser owes the cloud, taking in what it may as it goes. `asked` is the panel's
 * Save now: somebody asking may have the page reload onto what arrives, since League Standings
 * both devices changed cannot be sent before the two are merged here.
 */
export const saveNow = async ({ asked = false } = {}): Promise<void> => {
  const ran = await withSession((current, account) =>
    settleLocked(current, account, ["league", "pool"], asked || quietNow() ? "page" : "none")
  );
  if ((!ran || failures > 0) && signedIn() && owedHere()) {
    scheduleSave(failures > 0 ? backoff() : SAVE_DELAY_MS);
  }
};

/**
 * Looks for another device's save, at most once a minute, and only while the page is on screen or
 * `forced`: a hidden tab looking every ten minutes for a day is 144 reads for nothing. `arriving`
 * says the user has just come back to the page, the moment to take changes in before they start.
 */
export const lookAgain = async ({ forced = false, arriving = false } = {}): Promise<void> => {
  if (!signedIn()) return;
  if (!forced && typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const gap = failures > 0 ? backoff() : LOOK_GAP_MS;
  if (!forced && now() - lastLook < gap) return;
  if (["working", "gone", "not-owner"].includes(status.kind)) return;
  lastLook = now();
  await withSession(
    (current, account) =>
      settleLocked(current, account, ["league", "pool"], arriving || quietNow() ? "page" : "none"),
    { skip: true }
  );
};

/**
 * Brings this browser in step with its cloud copy before the app draws anything, when it keeps
 * one: League Standings, which every view reads. Never throws, and holds the app for at most
 * `STARTUP_WAIT_MS` to hear from the cloud and `STARTUP_TAKE_MS` more for the seasons to arrive;
 * past either the app opens on the data it has, and the newer seasons wait to be asked for. Another
 * tab already at work on the copy is left to it: this one opens at once.
 *
 * `onProgress` is for a line of text while nothing else is on screen.
 */
export const bootCloud = async (onProgress?: (text: string) => void): Promise<void> => {
  // Run again after the app drew (Try again, after a sign-in lapsed), a take still may not land
  // under it: only a first start, before the app draws, takes League Standings in silently.
  if (!stopSession) drawn = false;
  if (!config()) return;
  const state = loadCloudState();
  if (!state.enabled) {
    setStatus(state.uid ? { kind: "signed-out" } : { kind: "none" });
    return;
  }
  setStatus({ kind: "connecting" });
  const unsubscribe = onProgress
    ? subscribeCloud((next) => {
        if (next.kind !== "working") return;
        const [done, total] = next.progress ?? [0, 0];
        onProgress(total > 0 ? `${next.label} ${done} of ${total}` : next.label);
      })
    : () => undefined;
  const hint = onProgress
    ? setTimeout(() => {
        if (status.kind === "connecting") onProgress("Checking your cloud copy…");
      }, STARTUP_HINT_MS)
    : undefined;
  const answer = (async () => {
    const current = await loadSession();
    if (!current) return null;
    const account = await current.cloud.account();
    current.account = account;
    if (!account || account.uid !== state.uid) {
      // Signed out of Google here, or signed in as somebody else: the record waits for its owner.
      current.account = null;
      setStatus({ kind: "signed-out" });
      return null;
    }
    return { current, account };
  })();
  const failed = (error: unknown) =>
    setStatus({ kind: "error", account: signedIn(), message: messageOf(error) });
  try {
    const found = await within(
      answer.then((one) => ({ one })),
      STARTUP_WAIT_MS,
      null
    );
    if (found) {
      if (found.one) {
        const settling = withSession(
          (current, account) => settleLocked(current, account, ["league"], "boot"),
          { skip: true }
        );
        await within(settling, STARTUP_TAKE_MS, false);
      }
      return;
    }
    void answer.then((one) => (one ? lookAgain({ forced: true }) : undefined)).catch(failed);
  } catch (error) {
    failed(error);
  } finally {
    drawn = true;
    if (hint) clearTimeout(hint);
    unsubscribe();
    const account = signedIn();
    if (status.kind === "connecting" && account) setStatus(savedStatus(account));
  }
};

/**
 * Starts listening for changes made here, for another device's saves, and for being signed out in
 * another tab, once the app is on screen. Returns the stop, for tests.
 */
export const startCloudSession = (): (() => void) => {
  if (!config() || stopSession) return () => undefined;
  drawn = true;
  lastInput = now();
  onCloudPoolWrite(noteChange);
  onLeagueWrite(() => noteChange(LEAGUE_PART));
  const stopWatching = watchPull(() => {
    if (!signedIn() || isPoolBusy()) return;
    // The pull or tidy that held saves back has finished: save what it changed.
    if (owedHere()) scheduleSave(5_000);
  });
  const onVisibility = () => {
    if (document.visibilityState === "visible") void lookAgain({ arriving: true });
    // Leaving the page is the last chance to send what it owes; a browser may not wait for it.
    else if (signedIn() && owedHere()) void saveNow();
  };
  const onInput = () => {
    lastInput = now();
  };
  // Signed out in another tab: this one stops too, rather than saving under an account it lost.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CLOUD_STATE_KEY || !session?.account) return;
    if (loadCloudState().enabled) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    session.account = null;
    setStatus({ kind: "signed-out" });
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointerdown", onInput, { passive: true });
  window.addEventListener("keydown", onInput, { passive: true });
  window.addEventListener("storage", onStorage);
  const interval = setInterval(() => void lookAgain(), LOOK_EVERY_MS);
  if (signedIn() && owedHere()) scheduleSave();
  stopSession = () => {
    onCloudPoolWrite(null);
    onLeagueWrite(null);
    stopWatching();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pointerdown", onInput);
    window.removeEventListener("keydown", onInput);
    window.removeEventListener("storage", onStorage);
    clearInterval(interval);
  };
  return () => {
    stopSession?.();
    stopSession = null;
  };
};

/**
 * Brings the pool in step before Team Rankings draws: what other devices changed is taken in now,
 * with nothing on screen to swap it under. Resolves when done, or at once where there is nothing
 * to do; the caller draws either way. Once a page: after that the page's own looks keep it current.
 */
export const preparePool = (): Promise<void> => {
  if (poolPreparing) return poolPreparing;
  if (poolOpen) return Promise.resolve();
  poolOpen = true;
  poolPreparing = (async () => {
    if (!signedIn()) return;
    if (isPoolBusy() || (await poolJobElsewhere())) return;
    await withSession((current, account) => settleLocked(current, account, ["pool"], "gate"));
  })().finally(() => {
    poolPreparing = null;
  });
  return poolPreparing;
};

/** Team Rankings is on screen: anything still arriving for the pool waits to be asked for. */
export const poolOnScreen = (): void => {
  poolOpen = true;
  poolShown = true;
};

/**
 * Whether Team Rankings should wait for the pool to be brought in step before it draws: only in a
 * browser signed in to its copy, only until it has first drawn in a page, and again on coming back
 * to it while the first wait is still downloading, rather than drawing on the old pool meanwhile.
 */
export const poolWantsCloud = (): boolean =>
  !poolShown &&
  (!poolOpen || poolPreparing !== null) &&
  signedIn() !== null &&
  loadCloudState().enabled;

/** Signs in, checks the copy is this account's, and brings this browser in step with it. */
export const signInToCloud = async (): Promise<void> => {
  try {
    const current = await loadSession();
    if (!current) return;
    const account = await current.cloud.signIn();
    current.account = account;
    const state = loadCloudState();
    if (!account) {
      setStatus(state.uid ? { kind: "signed-out" } : { kind: "none" });
      return;
    }
    if (!(await current.cloud.owns())) {
      setStatus({ kind: "not-owner", account });
      return;
    }
    // The same account again picks up where it left off, changes made in between included; a
    // record of anybody else's is started afresh.
    if (state.uid === account.uid) {
      saveCloudState({ ...state, enabled: true });
    } else {
      clearOwed();
      saveLeagueBase(null);
      seen = null;
      saveCloudState({
        enabled: true,
        device: state.device,
        uid: account.uid,
        met: {},
        copy: null,
        version: null,
        hashes: {},
        uploads: [],
      });
    }
    await withSession((one, owner) => settleLocked(one, owner, ["league", "pool"], "page"));
  } catch (error) {
    if (LEFT_SIGN_IN.has(codeOf(error)) && !signedIn()) {
      const state = loadCloudState();
      setStatus(state.uid ? { kind: "signed-out" } : { kind: "none" });
      return;
    }
    setStatus({ kind: "error", account: signedIn(), message: messageOf(error) });
  }
};

/**
 * Signs out and stops keeping the cloud copy current here. This browser's data stays exactly as it
 * is, and so does its record: the same account signing in again sends what changed meanwhile.
 */
export const signOutOfCloud = async (): Promise<void> => {
  const state = loadCloudState();
  saveCloudState({ ...state, enabled: false });
  seen = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await session?.cloud.signOut();
  } finally {
    if (session) session.account = null;
    setStatus({ kind: "signed-out" });
  }
};

/** The answer to `gone`: this browser's data becomes a new copy, which every device then meets. */
export const restartCloud = async (): Promise<void> => {
  await withSession(async (current, account) => {
    const state = loadCloudState();
    const fresh: DeviceCloudState = { ...state, met: {}, hashes: {}, copy: null, version: null };
    saveCloudState(fresh);
    await firstCopy(current, account, fresh);
  });
};

/** Takes in another device's newer changes now, and reloads onto them. */
export const loadNewer = async (): Promise<void> => {
  await withSession((current, account) =>
    settleLocked(current, account, ["league", "pool"], "page")
  );
};

/**
 * Brings a kept version back: it becomes the copy's current value, from which every device takes
 * it, and what it replaces is kept in its turn. What this browser owes is sent first, so nothing
 * unsaved is replaced.
 */
export const bringBack = async (group: string): Promise<void> => {
  await withSession(async (current, account) => {
    await settleLocked(current, account, ["league", "pool"], "none");
    const manifest = await current.store.readManifest();
    if (!manifest) {
      setStatus({ kind: "gone", account });
      return;
    }
    const bringing = manifest.kept.filter((part) => part.group === group);
    if (bringing.length === 0) {
      notice = "That version is no longer kept.";
      setStatus(savedStatus(account));
      return;
    }
    // A pull or a tidy holds the pool in memory and writes it back as it goes: brought back
    // under it, the version would be overwritten, or would overwrite the job's work.
    if (
      bringing.some((part) => areaOf(part.key) === "pool") &&
      (isPoolBusy() || (await poolJobElsewhere()))
    ) {
      setStatus({
        kind: "error",
        account,
        message:
          "Team Rankings is being pulled or tidied. Bring this version back once that has finished.",
      });
      return;
    }
    const owed = owedChanges();
    if (bringing.some((part) => part.key in owed)) {
      setStatus({
        kind: "error",
        account,
        message: "Some changes here are not saved yet. Try again in a moment.",
      });
      return;
    }
    const state = loadCloudState();
    setStatus({ kind: "working", account, label: "Bringing it back…" });
    const result = await commitChanges({
      store: current.store,
      base: manifest,
      restore: group,
      device: state.device,
      now: nowIso(),
    });
    if (!result.ok) {
      setStatus({ kind: "error", account, message: "The cloud copy kept changing. Try again." });
      return;
    }
    kept = result.manifest.kept;
    const keys = new Set(bringing.map((part) => part.key));
    const parts = result.manifest.parts.filter((part) => keys.has(part.key));
    const fetched = await fetchValues({ store: current.store, parts });
    if (!stillOurs(state, account)) return;
    if (!fetched.ok || !(await local.apply(fetched.values))) {
      // The copy has it; this device takes it when the app next opens.
      notice = "Brought back in the cloud copy. It arrives here when the app next opens.";
      setStatus(savedStatus(account));
      return;
    }
    const known = { ...loadCloudState().hashes };
    for (const part of parts) known[part.key] = part.hash;
    saveCloudState({
      ...loadCloudState(),
      hashes: known,
      copy: result.manifest.copy,
      version: result.manifest.version,
      syncedAt: nowIso(),
    });
    const league = parts.find((part) => part.key === LEAGUE_PART);
    if (league) saveLeagueBase({ hash: league.hash, value: fetched.values.get(LEAGUE_PART) });
    new Set(parts.map((part) => areaOf(part.key))).forEach((area) => markTaken(area, false));
    announceTaken();
    reload();
  });
};

/** Tries the last thing again after an error, from scratch. */
export const retryCloud = async (): Promise<void> => {
  failures = 0;
  lastLook = 0;
  if (!signedIn()) {
    await bootCloud();
    return;
  }
  if (owedHere()) await saveNow();
  else await lookAgain({ forced: true, arriving: true });
};

/** The versions the copy keeps, newest first, one entry per settlement. */
export const cloudKept = (): KeptVersion[] => {
  const device = loadCloudState().device;
  const groups = new Map<string, KeptPart[]>();
  for (const part of kept) groups.set(part.group, [...(groups.get(part.group) ?? []), part]);
  return [...groups.entries()]
    .map(([group, parts]) => ({
      group,
      keptAt: parts[0]?.keptAt ?? "",
      why: parts[0]?.why ?? ("replaced" as const),
      fromHere: parts.every((part) => part.by === device),
      what: [
        ...new Set(
          parts.map((part) => (part.key === LEAGUE_PART ? "League Standings" : "Team Rankings"))
        ),
      ],
      bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    }))
    .sort((a, b) => (a.keptAt < b.keptAt ? 1 : a.keptAt > b.keptAt ? -1 : 0));
};

/** The notice the last settlement left, once it has been read. */
export const dismissCloudNotice = (): void => {
  notice = undefined;
  const account = signedIn();
  if (account && status.kind === "saved") setStatus(savedStatus(account));
};

/**
 * Who may use the copy, for its owner: null for anyone else, and when nobody is signed in. The
 * owner is the account whose own entry on the list says so, made by hand in the Firebase console
 * (README, "Your data on every device"); the rules let nobody else read the list.
 */
export const cloudMembers = async (): Promise<Member[] | null> => {
  // Asked of the session already open, never by opening one: a browser nobody signed in to has no
  // list to show, and must not download Firebase to find that out.
  const current = session;
  if (!current?.account) return null;
  if ((await current.cloud.members.role()) !== "owner") return null;
  return current.cloud.members.list();
};

const NOT_SIGNED_IN = "Sign in to change who may use the cloud copy.";

/** Puts an account on the list as a member. The owner's to do: the rules refuse anyone else. */
export const addCloudMember = async (address: string): Promise<void> => {
  if (!session?.account) throw new Error(NOT_SIGNED_IN);
  await session.cloud.members.add(address, nowIso());
};

/** Takes an account off the list. The owner's to do, and never to the owner's own entry. */
export const removeCloudMember = async (address: string): Promise<void> => {
  if (!session?.account) throw new Error(NOT_SIGNED_IN);
  await session.cloud.members.remove(address);
};

/** What to tell someone about a failed call to the cloud, in words they can act on. */
export const cloudErrorMessage = (error: unknown): string => messageOf(error);
