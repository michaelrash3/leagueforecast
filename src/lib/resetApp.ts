/**
 * Everything this app keeps in this browser, forgotten: the state of a browser that has never
 * opened it.
 *
 * Two places hold it. The Team Rankings pool lives in IndexedDB where the browser has it, and
 * `emptyPoolStore` takes out every key there. Everything else — every League Standings season,
 * the season pointer, the pool itself where there is no IndexedDB, preferences, the backup
 * reminders, the note saying the pool has moved — is in `localStorage` under keys that all begin
 * with one of `APP_KEY_PREFIXES`, and every such key goes. By prefix rather than by a list of
 * names, so a key added later is reset too without anybody remembering to add it here, and a key
 * belonging to anything else on the same origin is left alone.
 *
 * The caller reloads the page afterwards. Every view holds copies of what it read at mount, and a
 * reload is the only way to be sure none of them survives the reset on screen.
 */

import { emptyPoolStore, type EmptiedPool } from "./teamRankingsStorage";

/** What every key this app writes to `localStorage` begins with. */
export const APP_KEY_PREFIXES = ["league_", "lf_", "nkb_"] as const;

/** Removes every key of this app's from `storage`, and says how many went. */
export const forgetAppKeys = (storage: Storage): number => {
  const ours: string[] = [];
  for (let at = 0; at < storage.length; at += 1) {
    const key = storage.key(at);
    if (key !== null && APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) ours.push(key);
  }
  ours.forEach((key) => storage.removeItem(key));
  return ours.length;
};

/**
 * The whole reset. The pool goes first, and `localStorage` only once it has gone entirely: the note
 * there saying the pool lives in IndexedDB is what lets a second try find whatever the first left,
 * and a reset that emptied League Standings but not the pool would be neither the old app nor a new
 * one.
 */
export const resetApp = async (storage: Storage = localStorage): Promise<EmptiedPool> => {
  const pool = await emptyPoolStore();
  if (pool === "done") forgetAppKeys(storage);
  return pool;
};

/**
 * Starts the app again with nothing in memory, as the reset's last step. Its own export so a test
 * can see it was asked for: jsdom will not let one watch `location.reload` itself.
 */
export const reloadApp = (): void => window.location.reload();
