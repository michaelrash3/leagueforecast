import { onLeagueWrite } from "../storage";
import { onCloudPoolWrite } from "../teamRankingsStorage";
import { isPoolBusy, poolJobElsewhere, watchPull } from "../pullSession";
import { configuredFirebase, type FirebaseWebConfig } from "./cloudConfig";
import { changedOnBothSides, decideOnOpen, type CloudManifest } from "./cloudManifest";
import {
  matchesCloud,
  sendLocal,
  takeCloud,
  withoutSent,
  type LocalSource,
  type SaveMode,
  type TakeMode,
} from "./cloudEngine";
import { appLocalSource, LEAGUE_PART, localHoldsNothing } from "./cloudLocal";
import { loadCloudState, markCloudDirty, saveCloudState } from "./cloudState";
import type { CloudAccount, FirebaseCloud } from "./firebaseCloud";

/**
 * Keeping this browser's data in the cloud: the one place that decides when to save, when to take
 * another device's copy, and when to stop and ask.
 *
 * Nothing here runs for a browser that has never signed in: the Firebase SDK is imported on the
 * first sign-in and on each start after it, and not before. What it guarantees, in order of how
 * much it matters:
 *
 * 1. Nothing is lost without somebody choosing to lose it. A save sends only what changed here,
 *    onto the copy this browser last saw; a copy is taken in only at startup, before anything is
 *    drawn, and only over values that were themselves the cloud's. Changes on both sides to
 *    different values are merged; to the same value, it stops and asks. A browser whose storage
 *    cannot be read syncs nothing, since what it holds is not what it has.
 * 2. Every change made here is saved. Each write to a key the copy holds is recorded as owed, in
 *    storage rather than memory, so a closed tab still owes it the next time the app opens.
 * 3. A pull is not slowed down by it. A pull saves the pool every couple of thousand teams; the
 *    copy is saved once the pull has finished, in this tab or any other, not after each of those.
 *
 * Everything that reads the copy and decides runs under one Web Lock across the browser's tabs, and
 * reads the copy and this device's state afresh inside it, so two tabs never decide from each
 * other's half-finished work.
 */

export type CloudStatus =
  /** This build has no Firebase setting: the feature is not there to offer. */
  | { kind: "off" }
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
      /** Why they are waiting: a pull or a tidy is rewriting the pool. */
      waitingForPull: boolean;
    }
  /**
   * Both copies changed the same thing, or have never met and differ: which one wins is the
   * user's call. `cloudOnly` is what keeping this browser's data would take out of the copy.
   */
  | {
      kind: "choose";
      account: CloudAccount;
      firstTime: boolean;
      cloudSavedAt: string;
      cloudOnly: { labels: string[]; bytes: number };
    }
  /** Another device saved newer data. `owed`: this browser has changes too, kept for after. */
  | { kind: "newer"; account: CloudAccount; cloudSavedAt: string; owed: boolean }
  /** This browser has met a copy, and there is none now. */
  | { kind: "gone"; account: CloudAccount }
  | { kind: "not-owner"; account: CloudAccount }
  | { kind: "error"; account: CloudAccount | null; message: string };

type Session = {
  cloud: FirebaseCloud;
  account: CloudAccount | null;
};

/** How long after the last change a save waits, so a burst of edits is one save. */
export const SAVE_DELAY_MS = 20_000;
/** How long a failed save waits before trying again. */
const RETRY_DELAY_MS = 120_000;
/** How long a save held for a pull in another tab waits before looking again. */
const JOB_RETRY_MS = 60_000;
/** How often an open tab looks for another device's save. */
const LOOK_EVERY_MS = 10 * 60_000;
/**
 * At startup, how long the app waits to hear from the cloud before opening on what this browser
 * has. One limit for the whole exchange (load Firebase, find the account, read the copy's contents),
 * not one per step, so a slow connection costs at most this much before anything is drawn.
 */
export const STARTUP_WAIT_MS = 4_000;
/** How long startup waits in silence before saying what it is waiting for. */
const STARTUP_HINT_MS = 400;

const LOCK = "league_forecast_cloud";
const CHANNEL = "league_forecast_cloud";

let session: Session | null = null;
let status: CloudStatus = { kind: "off" };
const listeners = new Set<(status: CloudStatus) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let applying = false;
let heldForJob = false;
let lastLook = 0;
let channel: BroadcastChannel | null = null;

const channelNow = (): BroadcastChannel | null => {
  if (channel) return channel;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  } catch {
    channel = null;
  }
  return channel;
};

/** How this tab tells the browser's other tabs that it took a copy in, and hears the same. */
type Tabs = { announce: () => void; listen: (onTaken: () => void) => () => void };

const browserTabs: Tabs = {
  announce: () => {
    try {
      channelNow()?.postMessage("taken");
    } catch {
      /* a tab that cannot be told keeps its own state until it next opens */
    }
  },
  listen: (onTaken) => {
    const tabsChannel = channelNow();
    if (!tabsChannel) return () => undefined;
    const handler = () => onTaken();
    tabsChannel.addEventListener("message", handler);
    return () => tabsChannel.removeEventListener("message", handler);
  },
};

/** Stand-ins for Firebase, the browser's stores and its other tabs, for tests. */
let openCloud: (config: FirebaseWebConfig) => Promise<FirebaseCloud> = async (config) =>
  (await import("./firebaseCloud")).openFirebaseCloud(config);
let local: LocalSource = appLocalSource;
let holdsNothing: () => boolean = localHoldsNothing;
let config: () => FirebaseWebConfig | null = configuredFirebase;
let reload: () => void = () => window.location.reload();
let tabs: Tabs = browserTabs;

export const setCloudTestHooks = (hooks: {
  openCloud?: typeof openCloud;
  local?: LocalSource;
  holdsNothing?: () => boolean;
  config?: () => FirebaseWebConfig | null;
  reload?: () => void;
  tabs?: Tabs;
}): void => {
  if (hooks.openCloud) openCloud = hooks.openCloud;
  if (hooks.local) local = hooks.local;
  if (hooks.holdsNothing) holdsNothing = hooks.holdsNothing;
  if (hooks.config) config = hooks.config;
  if (hooks.reload) reload = hooks.reload;
  if (hooks.tabs) tabs = hooks.tabs;
};

/** Forgets the session, for tests. */
export const resetCloudSession = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  session = null;
  status = { kind: "off" };
  listeners.clear();
  applying = false;
  heldForJob = false;
  lastLook = 0;
  channel?.close();
  channel = null;
};

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

const nowIso = (): string => new Date().toISOString();

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

const messageOf = (error: unknown): string => {
  const known = SIGN_IN_MESSAGES[codeOf(error)];
  if (known) return known;
  const text = error instanceof Error ? error.message : String(error);
  if (/permission|insufficient/i.test(text)) {
    return "The cloud copy refused this account. Is it the one that first signed in?";
  }
  if (/offline|network|unavailable|failed to fetch/i.test(text)) {
    return "Could not reach the cloud. Your data is safe on this device, and it will try again.";
  }
  return text || "Something went wrong talking to the cloud.";
};

const UNUSABLE =
  "This browser cannot open its Team Rankings storage right now, so it is not syncing: what it holds is not all it has. Reloading the page usually brings the storage back.";

/**
 * Runs one save, load or decision at a time across every open tab, where the browser offers a
 * lock. Says whether it ran: `orSkip` gives up at once when another tab holds the lock, for work
 * that would only be waiting to find the other tab's done.
 */
const exclusively = async (work: () => Promise<void>, orSkip = false): Promise<boolean> => {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) {
    await work();
    return true;
  }
  if (!orSkip) {
    await locks.request(LOCK, work);
    return true;
  }
  let ran = false;
  await locks.request(LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    await work();
  });
  return ran;
};

const owedHere = (): boolean => Object.keys(loadCloudState().dirty).length > 0;

const savedStatus = (account: CloudAccount): CloudStatus => {
  const state = loadCloudState();
  const owed = Object.keys(state.dirty).length > 0;
  return {
    kind: "saved",
    account,
    ...(state.syncedAt ? { syncedAt: state.syncedAt } : {}),
    owed,
    waitingForPull: owed && (heldForJob || isPoolBusy()),
  };
};

/** The question of which copy wins, with what answering it for this browser would cost the copy. */
const chooseStatus = (
  account: CloudAccount,
  manifest: CloudManifest,
  firstTime: boolean
): CloudStatus => {
  const held = new Set(local.keys());
  const missing = manifest.parts.filter((part) => !held.has(part.key));
  return {
    kind: "choose",
    account,
    firstTime,
    cloudSavedAt: manifest.updatedAt,
    cloudOnly: {
      labels: [
        ...new Set(
          missing.map((part) =>
            part.key === LEAGUE_PART ? "League Standings seasons" : "Team Rankings data"
          )
        ),
      ],
      bytes: missing.reduce((sum, part) => sum + part.bytes, 0),
    },
  };
};

const signedIn = (): CloudAccount | null => session?.account ?? null;

const loadSession = async (): Promise<Session | null> => {
  if (session) return session;
  const settings = config();
  if (!settings) return null;
  session = { cloud: await openCloud(settings), account: null };
  return session;
};

const poolJobRunning = async (): Promise<boolean> => isPoolBusy() || (await poolJobElsewhere());

/**
 * Records a change made here, and saves it once things are quiet. What the storage layer's write
 * notices call (`onCloudPoolWrite`, `onLeagueWrite`); exported for tests.
 */
export const noteChange = (key: string): void => {
  if (applying) return;
  markCloudDirty(key);
  const account = signedIn();
  if (!account || !loadCloudState().enabled) return;
  if (status.kind === "newer") setStatus({ ...status, owed: true });
  else if (status.kind === "saved" || status.kind === "signed-out") {
    setStatus(savedStatus(account));
  }
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
 * How a save goes, from the caller's side: `auto` is whatever this browser owes (its changes, or
 * its whole data as the first copy there is); `replace` is the answer to which copy wins in this
 * browser's favour; `restart` starts a copy that is gone again from this browser.
 */
type SaveChoice = "auto" | "replace" | "restart";

/** Sends what this browser owes the cloud. The caller holds the lock. */
const saveLocked = async (
  current: Session,
  account: CloudAccount,
  choice: SaveChoice,
  attempt = 0
): Promise<void> => {
  if (!local.usable()) {
    setStatus({ kind: "error", account, message: UNUSABLE });
    return;
  }
  const state = loadCloudState();
  if (!state.enabled) return;
  const mode: SaveMode =
    choice === "replace"
      ? "replace"
      : choice === "restart" || state.version === null
        ? "first"
        : "patch";
  if (mode === "patch" && Object.keys(state.dirty).length === 0) {
    setStatus(savedStatus(account));
    return;
  }
  if (choice === "auto" && (await poolJobRunning())) {
    heldForJob = true;
    setStatus(savedStatus(account));
    scheduleSave(JOB_RETRY_MS);
    return;
  }
  heldForJob = false;
  setStatus({ kind: "working", account, label: "Saving to the cloud…" });
  try {
    const result = await sendLocal({
      store: current.cloud.store,
      local,
      state,
      device: state.device,
      now: nowIso(),
      mode,
      onProgress: (done, total) =>
        setStatus({
          kind: "working",
          account,
          label: "Saving to the cloud…",
          progress: [done, total],
        }),
    });
    if (!result.ok) {
      if (result.reason === "gone") {
        setStatus({ kind: "gone", account });
        return;
      }
      // Somebody else saved first: decide again from what is there now. Twice at most, so two
      // devices saving in step cannot keep each other going.
      if (attempt < 2) {
        await settleLocked(current, account, { atStartup: false, attempt: attempt + 1 });
      } else {
        setStatus({ kind: "error", account, message: "The cloud copy kept changing. Try again." });
      }
      return;
    }
    // Changes made while it was saving stay owed.
    const latest = loadCloudState();
    saveCloudState({
      ...latest,
      version: result.state.version,
      copy: result.state.copy,
      hashes: result.state.hashes,
      dirty: withoutSent(latest.dirty, result.sent),
      ...(result.state.syncedAt ? { syncedAt: result.state.syncedAt } : {}),
    });
    setStatus(savedStatus(account));
    if (owedHere()) scheduleSave();
  } catch (error) {
    setStatus({ kind: "error", account, message: messageOf(error) });
    scheduleSave(RETRY_DELAY_MS);
  }
};

/**
 * Makes this browser's data the cloud copy's, the way `mode` says. `restart` reloads the page
 * afterwards, which is how a running app takes new data: every view reads storage again from the
 * top. The caller holds the lock.
 */
const takeLocked = async (
  current: Session,
  account: CloudAccount,
  manifest: CloudManifest,
  mode: TakeMode,
  restart: boolean
): Promise<boolean> => {
  const start = loadCloudState();
  setStatus({ kind: "working", account, label: "Loading your data from the cloud…" });
  // Writes that are the copy arriving are not changes made here; everything else, including an
  // edit made while it downloads, still is.
  const arriving: LocalSource = {
    ...local,
    apply: async (values) => {
      applying = true;
      try {
        return await local.apply(values);
      } finally {
        applying = false;
      }
    },
  };
  try {
    const result = await takeCloud({
      store: current.cloud.store,
      local: arriving,
      state: start,
      manifest,
      now: nowIso(),
      mode,
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
            ? "The cloud copy changed while it was loading. Try again."
            : "This browser would not store the cloud copy: it may be out of space, or the copy is from a newer version of the app.",
      });
      return false;
    }
    const latest = loadCloudState();
    saveCloudState({
      ...latest,
      version: result.state.version,
      copy: result.state.copy,
      hashes: result.state.hashes,
      // Taken in this browser's place, what it owed is answered; a change made during the download
      // is not. Taken as an update, what it owed is still owed.
      dirty: mode === "replace" ? withoutSent(latest.dirty, start.dirty) : latest.dirty,
      ...(result.state.syncedAt ? { syncedAt: result.state.syncedAt } : {}),
    });
    // The browser's other tabs hold the old data in memory, and would write it back.
    tabs.announce();
    if (restart) reload();
    else setStatus(savedStatus(account));
    return true;
  } catch (error) {
    setStatus({ kind: "error", account, message: messageOf(error) });
    return false;
  }
};

/**
 * What to do about the cloud copy as it stands, for a signed-in owner. Reads the copy and this
 * browser's state afresh; the caller holds the lock.
 */
const settleLocked = async (
  current: Session,
  account: CloudAccount,
  { atStartup, attempt = 0 }: { atStartup: boolean; attempt?: number }
): Promise<void> => {
  if (!local.usable()) {
    setStatus({ kind: "error", account, message: UNUSABLE });
    return;
  }
  const manifest = await current.cloud.store.readManifest();
  const state = loadCloudState();
  const decision = decideOnOpen(manifest, state, holdsNothing());
  if (decision === "in-step") {
    setStatus(savedStatus(account));
    return;
  }
  if (decision === "gone") {
    setStatus({ kind: "gone", account });
    return;
  }
  if (decision === "send-local" || !manifest) {
    // Changes onto the copy, or this browser's data as the first copy there is. At startup it goes
    // once the app is open, not before: a whole pool's upload is no reason to keep it closed.
    setStatus(savedStatus(account));
    if (atStartup) scheduleSave(3_000);
    else await saveLocked(current, account, "auto", attempt);
    return;
  }
  const metBefore = state.version !== null && state.copy === manifest.copy;
  if (decision === "take-cloud") {
    // At startup nothing is on screen yet, so the data is simply in place when the app draws. A
    // browser meeting the copy for the first time holds nothing, so it takes it now and reloads.
    // Otherwise, once the app is open, taking it means a reload, which is the user's to start.
    if (atStartup) await takeLocked(current, account, manifest, "update", false);
    else if (!metBefore) await takeLocked(current, account, manifest, "update", true);
    else setStatus({ kind: "newer", account, cloudSavedAt: manifest.updatedAt, owed: false });
    return;
  }
  if (decision === "merge") {
    if (changedOnBothSides(manifest, state.hashes, state.dirty).length > 0) {
      setStatus(chooseStatus(account, manifest, false));
      return;
    }
    // Different values changed on each side: this browser takes the copy's, then sends its own.
    // Taking means the page reloads once the app is open, so there it waits to be asked.
    if (!atStartup) {
      setStatus({ kind: "newer", account, cloudSavedAt: manifest.updatedAt, owed: true });
      return;
    }
    if (await takeLocked(current, account, manifest, "update", false)) scheduleSave(3_000);
    return;
  }
  // `meet`: two copies that never met may still be the same one, restored from one backup.
  if (await matchesCloud(local, manifest)) {
    saveCloudState({
      ...loadCloudState(),
      version: manifest.version,
      copy: manifest.copy,
      hashes: Object.fromEntries(manifest.parts.map((part) => [part.key, part.hash])),
      dirty: {},
      syncedAt: nowIso(),
    });
    setStatus(savedStatus(account));
    return;
  }
  setStatus(chooseStatus(account, manifest, true));
};

/**
 * Sends what this browser owes the cloud. Waits for a pull or tidy to finish, in this tab or
 * another, and decides again if another device saved first. `replace` is the answer to which copy
 * wins, in this browser's favour.
 */
export const saveNow = async (replace = false): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account || !loadCloudState().enabled) return;
  await exclusively(() => saveLocked(current, account, replace ? "replace" : "auto"));
};

/** Whose the copy is, as this account finds it; false leaves the status saying why. */
const owns = async (current: Session, account: CloudAccount): Promise<boolean> => {
  if ((await current.cloud.claim()) === "mine") return true;
  setStatus({ kind: "not-owner", account });
  return false;
};

/**
 * Brings this browser in step with its cloud copy before the app draws anything, when it keeps
 * one. Never throws, and holds the app for at most `STARTUP_WAIT_MS` of waiting on the network:
 * past that the app opens on the data it has, and the cloud's answer is dealt with when it comes,
 * as one found while the app is open would be. A copy that has started downloading is waited for,
 * since opening on the old data and then replacing it would be worse. Another tab already at work
 * on the copy is left to it: this one opens at once, and hears if that tab takes a copy in.
 *
 * No claim is made here. This browser claimed the copy when it signed in, and the rules refuse the
 * read below to any account that is not the owner, which ends in `error`.
 *
 * `onProgress` is for a line of text while nothing else is on screen.
 */
export const bootCloud = async (onProgress?: (text: string) => void): Promise<void> => {
  if (!config()) return;
  if (!loadCloudState().enabled) {
    setStatus({ kind: "signed-out" });
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
    ? setTimeout(() => onProgress("Checking your cloud copy…"), STARTUP_HINT_MS)
    : undefined;
  // Who is signed in, and a first read of the copy: the part of startup that is only waiting on
  // the network, and the only part the limit cuts short.
  const answer = (async () => {
    const current = await loadSession();
    if (!current) return null;
    current.account = await current.cloud.account();
    if (!current.account) {
      setStatus({ kind: "signed-out" });
      return null;
    }
    await current.cloud.store.readManifest();
    return { current, account: current.account };
  })();
  const failed = (error: unknown) =>
    setStatus({ kind: "error", account: signedIn(), message: messageOf(error) });
  const settleWhenFree = async (
    found: { current: Session; account: CloudAccount },
    atStartup: boolean
  ): Promise<void> => {
    const ran = await exclusively(
      () => settleLocked(found.current, found.account, { atStartup }),
      true
    );
    if (!ran) setStatus(savedStatus(found.account));
  };
  try {
    const early = await within(
      answer.then((found) => ({ found })),
      STARTUP_WAIT_MS,
      null
    );
    if (early) {
      if (early.found) await settleWhenFree(early.found, true);
      return;
    }
    void answer.then((found) => (found ? settleWhenFree(found, false) : undefined)).catch(failed);
  } catch (error) {
    failed(error);
  } finally {
    if (hint) clearTimeout(hint);
    unsubscribe();
  }
};

let started = false;

/**
 * Starts listening for changes made here, for another device's saves, and for another tab taking a
 * copy in, once the app is on screen. Returns the stop, for tests.
 */
export const startCloudSession = (): (() => void) => {
  if (!config() || started) return () => undefined;
  started = true;
  onCloudPoolWrite(noteChange);
  onLeagueWrite(() => noteChange(LEAGUE_PART));
  const stopWatching = watchPull(() => {
    const account = signedIn();
    if (!account || isPoolBusy()) return;
    // The pull or tidy that held saves back has finished: save what it changed.
    if (owedHere()) scheduleSave(5_000);
  });
  // Another tab has written a copy into storage under this one: its data in memory is stale now,
  // and would be written back over the copy.
  const stopListening = tabs.listen(() => {
    if (signedIn()) reload();
  });
  const look = () => void lookAgain();
  const onVisibility = () => {
    if (document.visibilityState === "visible") look();
    // Leaving the page is the last chance to send what it owes; a browser may not wait for it.
    else if (signedIn() && owedHere()) void saveNow();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const interval = setInterval(look, LOOK_EVERY_MS);
  if (signedIn() && owedHere()) scheduleSave();
  return () => {
    started = false;
    onCloudPoolWrite(null);
    onLeagueWrite(null);
    stopWatching();
    stopListening();
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(interval);
  };
};

/** Looks for another device's save, at most once a minute. */
export const lookAgain = async (): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account || Date.now() - lastLook < 60_000) return;
  if (["working", "choose", "not-owner", "gone"].includes(status.kind)) return;
  lastLook = Date.now();
  try {
    await exclusively(() => settleLocked(current, account, { atStartup: false }), true);
  } catch (error) {
    setStatus({ kind: "error", account, message: messageOf(error) });
  }
};

/** Signs in, claims the copy if nobody has, and brings this browser in step with it. */
export const signInToCloud = async (): Promise<void> => {
  try {
    const current = await loadSession();
    if (!current) return;
    const account = await current.cloud.signIn();
    current.account = account;
    if (!account) {
      setStatus({ kind: "signed-out" });
      return;
    }
    if (!(await owns(current, account))) return;
    const state = loadCloudState();
    // Recorded as owing nothing and knowing no copy: whatever this browser holds is decided by
    // meeting the copy, not by writes it made before it kept one.
    saveCloudState({
      ...state,
      enabled: true,
      version: null,
      copy: null,
      hashes: {},
      dirty: {},
    });
    await exclusively(() => settleLocked(current, account, { atStartup: false }));
  } catch (error) {
    if (LEFT_SIGN_IN.has(codeOf(error)) && !signedIn()) {
      setStatus({ kind: "signed-out" });
      return;
    }
    setStatus({ kind: "error", account: signedIn(), message: messageOf(error) });
  }
};

/**
 * Signs out and stops keeping a cloud copy here. This browser's data stays exactly as it is; the
 * next sign-in meets the copy afresh, and asks which wins if they differ.
 */
export const signOutOfCloud = async (): Promise<void> => {
  const state = loadCloudState();
  saveCloudState({ ...state, enabled: false, version: null, copy: null, hashes: {}, dirty: {} });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await session?.cloud.signOut();
  } finally {
    if (session) session.account = null;
    setStatus({ kind: "signed-out" });
  }
};

/**
 * The user's answer to `choose`: `cloud` replaces this browser's data with the cloud copy and
 * reloads; `device` replaces the cloud copy with this browser's.
 */
export const chooseCopy = async (winner: "cloud" | "device"): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account) return;
  try {
    await exclusively(async () => {
      if (winner === "device") {
        await saveLocked(current, account, "replace");
        return;
      }
      const manifest = await current.cloud.store.readManifest();
      if (!manifest) {
        setStatus({ kind: "gone", account });
        return;
      }
      await takeLocked(current, account, manifest, "replace", true);
    });
  } catch (error) {
    setStatus({ kind: "error", account, message: messageOf(error) });
  }
};

/** The answer to `gone`: this browser's data becomes a new copy, which every device then meets. */
export const restartCloud = async (): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account) return;
  await exclusively(() => saveLocked(current, account, "restart"));
};

/** Takes another device's newer save now, by reloading: startup brings it in before drawing. */
export const loadNewer = (): void => reload();

/** Tries the last thing again after an error. */
export const retryCloud = async (): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account) return;
  lastLook = 0;
  if (owedHere()) await saveNow();
  else await lookAgain();
};
