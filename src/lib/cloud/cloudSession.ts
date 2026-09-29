import { onLeagueWrite } from "../storage";
import { onCloudPoolWrite } from "../teamRankingsStorage";
import { isPullLive, watchPull } from "../pullSession";
import { configuredFirebase, type FirebaseWebConfig } from "./cloudConfig";
import { decideOnOpen, type CloudManifest } from "./cloudManifest";
import { matchesCloud, sendLocal, takeCloud, withoutSent, type LocalSource } from "./cloudEngine";
import { appLocalSource, localHoldsNothing } from "./cloudLocal";
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
 * 1. Nothing is overwritten without somebody choosing to. A save goes only onto the copy this
 *    browser last saw, and a copy taken at startup replaces only data that was itself the cloud's,
 *    unchanged since. Anything else stops at `choose`.
 * 2. Every change made here is saved. Each write to a key the copy holds is recorded as owed, in
 *    storage rather than memory, so a closed tab still owes it the next time the app opens.
 * 3. A pull is not slowed down by it. A pull saves the pool every couple of thousand teams; the
 *    copy is saved once the pull has finished, not after each of those.
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
      /** Why they are waiting: a pull is running. */
      waitingForPull: boolean;
    }
  /** Both copies have data the other has not: which one wins is the user's call. */
  | { kind: "choose"; account: CloudAccount; firstTime: boolean; cloudSavedAt: string }
  /** Another device saved newer data than this one has. */
  | { kind: "newer"; account: CloudAccount; cloudSavedAt: string }
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

let session: Session | null = null;
let status: CloudStatus = { kind: "off" };
const listeners = new Set<(status: CloudStatus) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let applying = false;
let lastLook = 0;

/** Stand-ins for Firebase and the browser's stores, for tests. */
let openCloud: (config: FirebaseWebConfig) => Promise<FirebaseCloud> = async (config) =>
  (await import("./firebaseCloud")).openFirebaseCloud(config);
let local: LocalSource = appLocalSource;
let holdsNothing: () => boolean = localHoldsNothing;
let config: () => FirebaseWebConfig | null = configuredFirebase;
let reload: () => void = () => window.location.reload();

export const setCloudTestHooks = (hooks: {
  openCloud?: typeof openCloud;
  local?: LocalSource;
  holdsNothing?: () => boolean;
  config?: () => FirebaseWebConfig | null;
  reload?: () => void;
}): void => {
  if (hooks.openCloud) openCloud = hooks.openCloud;
  if (hooks.local) local = hooks.local;
  if (hooks.holdsNothing) holdsNothing = hooks.holdsNothing;
  if (hooks.config) config = hooks.config;
  if (hooks.reload) reload = hooks.reload;
};

/** Forgets the session, for tests. */
export const resetCloudSession = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  session = null;
  status = { kind: "off" };
  listeners.clear();
  applying = false;
  lastLook = 0;
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

/**
 * Runs one save or load at a time across every open tab, where the browser offers a lock; a tab
 * that has to wait finds the work done by the time it gets its turn, and does nothing.
 */
const exclusively = async <T>(work: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return work();
  return locks.request("league_forecast_cloud", work) as Promise<T>;
};

const savedStatus = (account: CloudAccount): CloudStatus => {
  const state = loadCloudState();
  const owed = Object.keys(state.dirty).length > 0;
  return {
    kind: "saved",
    account,
    ...(state.syncedAt ? { syncedAt: state.syncedAt } : {}),
    owed,
    waitingForPull: owed && isPullLive(),
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

/**
 * Records a change made here, and saves it once things are quiet. What the storage layer's write
 * notices call (`onCloudPoolWrite`, `onLeagueWrite`); exported for tests.
 */
export const noteChange = (key: string): void => {
  if (applying) return;
  markCloudDirty(key);
  const account = signedIn();
  if (!account || !loadCloudState().enabled) return;
  if (status.kind === "saved" || status.kind === "signed-out") setStatus(savedStatus(account));
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
 * Sends what this browser owes the cloud. Waits for a running pull to finish, and stops at
 * `choose` if another device saved first.
 */
export const saveNow = async (replace = false): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account || !loadCloudState().enabled) return;
  if (!replace && isPullLive()) {
    setStatus(savedStatus(account));
    return;
  }
  await exclusively(async () => {
    const state = loadCloudState();
    if (!replace && Object.keys(state.dirty).length === 0) {
      setStatus(savedStatus(account));
      return;
    }
    setStatus({ kind: "working", account, label: "Saving to the cloud…" });
    try {
      const result = await sendLocal({
        store: current.cloud.store,
        local,
        state,
        device: state.device,
        now: nowIso(),
        replace,
        onProgress: (done, total) =>
          setStatus({
            kind: "working",
            account,
            label: "Saving to the cloud…",
            progress: [done, total],
          }),
      });
      if (!result.ok) {
        const manifest = await current.cloud.store.readManifest();
        setStatus({
          kind: "choose",
          account,
          firstTime: false,
          cloudSavedAt: manifest?.updatedAt ?? "",
        });
        return;
      }
      // Changes made while it was saving stay owed.
      const latest = loadCloudState();
      saveCloudState({
        ...latest,
        version: result.state.version,
        hashes: result.state.hashes,
        dirty: withoutSent(latest.dirty, result.sent),
        ...(result.state.syncedAt ? { syncedAt: result.state.syncedAt } : {}),
      });
      setStatus(savedStatus(account));
      if (Object.keys(loadCloudState().dirty).length > 0) scheduleSave();
    } catch (error) {
      setStatus({ kind: "error", account, message: messageOf(error) });
      scheduleSave(RETRY_DELAY_MS);
    }
  });
};

/**
 * Makes this browser's data the cloud copy's. `restart` reloads the page afterwards, which is how
 * a running app takes new data: every view reads storage again from the top.
 */
const take = async (
  current: Session,
  account: CloudAccount,
  manifest: CloudManifest,
  restart: boolean
): Promise<boolean> =>
  exclusively(async () => {
    const state = loadCloudState();
    setStatus({ kind: "working", account, label: "Loading your data from the cloud…" });
    applying = true;
    try {
      const result = await takeCloud({
        store: current.cloud.store,
        local,
        state,
        manifest,
        now: nowIso(),
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
              : "This browser would not store the cloud copy. It may be out of space.",
        });
        return false;
      }
      saveCloudState({
        ...loadCloudState(),
        version: result.state.version,
        hashes: result.state.hashes,
        dirty: {},
        ...(result.state.syncedAt ? { syncedAt: result.state.syncedAt } : {}),
      });
      if (restart) reload();
      else setStatus(savedStatus(account));
      return true;
    } catch (error) {
      setStatus({ kind: "error", account, message: messageOf(error) });
      return false;
    } finally {
      applying = false;
    }
  });

/**
 * What to do about the cloud copy as it stands, for a signed-in owner. `manifest` is the copy as
 * just read, or undefined to read it here.
 */
const settle = async (
  current: Session,
  account: CloudAccount,
  { atStartup, manifest: given }: { atStartup: boolean; manifest?: CloudManifest | null }
): Promise<void> => {
  const manifest = given === undefined ? await current.cloud.store.readManifest() : given;
  const state = loadCloudState();
  const empty = holdsNothing();
  const decision = decideOnOpen(manifest, state, empty);
  if (decision === "in-step") {
    setStatus(savedStatus(account));
    return;
  }
  if (decision === "send-local") {
    setStatus(savedStatus(account));
    // A browser that has never saved, or a cloud copy that is not there, needs everything sent:
    // nothing is recorded as changed, because none of it was ever in the cloud to change. At
    // startup it goes once the app is open; a whole pool's upload is no reason to keep it closed.
    if (state.version === null || !manifest) {
      const sending = saveNow(true);
      if (!atStartup) await sending;
    } else scheduleSave(atStartup ? 3_000 : 0);
    return;
  }
  if (!manifest) return;
  if (decision === "take-cloud") {
    // At startup nothing is on screen yet, so the data is simply in place when the app draws. Once
    // the app is open, taking it means a reload, which is the user's to start.
    if (atStartup || state.version === null) await take(current, account, manifest, !atStartup);
    else setStatus({ kind: "newer", account, cloudSavedAt: manifest.updatedAt });
    return;
  }
  // Two copies that never met may still be the same one, restored from one backup.
  if (state.version === null && (await matchesCloud(local, manifest))) {
    saveCloudState({
      ...loadCloudState(),
      version: manifest.version,
      hashes: Object.fromEntries(manifest.parts.map((part) => [part.key, part.hash])),
      dirty: {},
      syncedAt: nowIso(),
    });
    setStatus(savedStatus(account));
    return;
  }
  setStatus({
    kind: "choose",
    account,
    firstTime: state.version === null,
    cloudSavedAt: manifest.updatedAt,
  });
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
 * since opening on the old data and then replacing it would be worse.
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
  const answer = (async () => {
    const current = await loadSession();
    if (!current) return null;
    current.account = await current.cloud.account();
    if (!current.account) {
      setStatus({ kind: "signed-out" });
      return null;
    }
    const manifest = await current.cloud.store.readManifest();
    return { current, account: current.account, manifest };
  })();
  const failed = (error: unknown) =>
    setStatus({ kind: "error", account: signedIn(), message: messageOf(error) });
  try {
    const early = await within(
      answer.then((found) => ({ found })),
      STARTUP_WAIT_MS,
      null
    );
    if (early) {
      const { found } = early;
      if (found)
        await settle(found.current, found.account, { atStartup: true, manifest: found.manifest });
      return;
    }
    void answer
      .then((found) =>
        found
          ? settle(found.current, found.account, { atStartup: false, manifest: found.manifest })
          : undefined
      )
      .catch(failed);
  } catch (error) {
    failed(error);
  } finally {
    if (hint) clearTimeout(hint);
    unsubscribe();
  }
};

let started = false;

/**
 * Starts listening for changes made here, and for another device's saves, once the app is on
 * screen. Returns the stop, for tests.
 */
export const startCloudSession = (): (() => void) => {
  if (!config() || started) return () => undefined;
  started = true;
  onCloudPoolWrite(noteChange);
  onLeagueWrite(() => noteChange("league"));
  const stopWatching = watchPull(() => {
    const account = signedIn();
    if (!account || isPullLive()) return;
    // The pull that held saves back has finished: save what it changed.
    if (Object.keys(loadCloudState().dirty).length > 0) scheduleSave(5_000);
  });
  const look = () => void lookAgain();
  const onVisibility = () => {
    if (document.visibilityState === "visible") look();
    // Leaving the page is the last chance to send what it owes; a browser may not wait for it.
    else if (signedIn() && Object.keys(loadCloudState().dirty).length > 0 && !isPullLive()) {
      void saveNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const interval = setInterval(look, LOOK_EVERY_MS);
  if (signedIn() && Object.keys(loadCloudState().dirty).length > 0) scheduleSave();
  return () => {
    started = false;
    onCloudPoolWrite(null);
    onLeagueWrite(null);
    stopWatching();
    document.removeEventListener("visibilitychange", onVisibility);
    clearInterval(interval);
  };
};

/** Looks for another device's save, at most once a minute. */
export const lookAgain = async (): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account || Date.now() - lastLook < 60_000) return;
  if (status.kind === "working" || status.kind === "choose" || status.kind === "not-owner") return;
  lastLook = Date.now();
  try {
    await settle(current, account, { atStartup: false });
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
    // Recorded as owing nothing: whatever this browser holds is decided by `settle`, not by writes.
    saveCloudState({ ...state, enabled: true, version: null, hashes: {}, dirty: {} });
    await settle(current, account, { atStartup: false });
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
 * next sign-in asks which copy wins if both have changed.
 */
export const signOutOfCloud = async (): Promise<void> => {
  const state = loadCloudState();
  saveCloudState({ ...state, enabled: false, version: null, hashes: {}, dirty: {} });
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
    if (winner === "device") {
      await saveNow(true);
      return;
    }
    const manifest = await current.cloud.store.readManifest();
    if (!manifest) {
      setStatus({ kind: "error", account, message: "There is no cloud copy to take yet." });
      return;
    }
    await take(current, account, manifest, true);
  } catch (error) {
    setStatus({ kind: "error", account, message: messageOf(error) });
  }
};

/** Takes another device's newer save now, by reloading: startup brings it in before drawing. */
export const loadNewer = (): void => reload();

/** Tries the last thing again after an error. */
export const retryCloud = async (): Promise<void> => {
  const current = session;
  const account = signedIn();
  if (!current || !account) return;
  lastLook = 0;
  if (Object.keys(loadCloudState().dirty).length > 0) await saveNow();
  else await lookAgain();
};
