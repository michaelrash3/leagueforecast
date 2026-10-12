import { isPoolBusy, watchPull } from "../pullSession";
import { onStaleWrite } from "./cloudGuard";

/**
 * This browser's other tabs, when one of them takes a copy in from the cloud.
 *
 * A tab holds in memory what it read when it opened, and writes whole values back from it; after
 * another tab lays newer data into storage underneath it, the only safe thing it can do is read
 * again, which for this app means reloading. Every tab listens from before it draws anything, signed
 * in or not: a tab that is not signed in writes to the same storage as one that is. A tab running a
 * pull or a tidy waits for it to finish first, since reloading would throw it away; its writes to
 * the area another tab took are refused meanwhile (`cloudGuard.ts`).
 */

const CHANNEL = "league_forecast_cloud";

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

/** Tells the other tabs a copy was taken in. A channel never hears its own messages. */
export const announceTaken = (): void => {
  try {
    channelNow()?.postMessage("taken");
  } catch {
    /* a tab that cannot be told is still refused its stale writes (`cloudGuard.ts`) */
  }
};

let reload: () => void = () => window.location.reload();
let reloading = false;
let waitingForJob: (() => void) | null = null;

/**
 * Reloads this tab, now or as soon as a pull or tidy running in it has finished. Once: a tab asked
 * twice is already on its way.
 */
export const reloadWhenFree = (): void => {
  if (reloading || waitingForJob) return;
  if (!isPoolBusy()) {
    reloading = true;
    reload();
    return;
  }
  waitingForJob = watchPull(() => {
    if (isPoolBusy()) return;
    waitingForJob?.();
    waitingForJob = null;
    reloading = true;
    reload();
  });
};

/**
 * Starts listening, before the app draws: a take in another tab, or a write this tab tried after
 * one, both end in a reload. Returns the stop, for tests.
 */
export const listenForTakes = (): (() => void) => {
  const tabs = channelNow();
  const onMessage = () => reloadWhenFree();
  tabs?.addEventListener("message", onMessage);
  onStaleWrite(() => reloadWhenFree());
  return () => {
    tabs?.removeEventListener("message", onMessage);
    onStaleWrite(null);
  };
};

/** Stand-ins, for tests. */
export const setTabsTestHooks = (hooks: { reload?: () => void }): void => {
  if (hooks.reload) reload = hooks.reload;
};

/** Forgets everything, for tests. */
export const resetCloudTabs = (): void => {
  channel?.close();
  channel = null;
  reloading = false;
  waitingForJob?.();
  waitingForJob = null;
};
