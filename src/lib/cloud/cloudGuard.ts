import type { Area } from "./cloudPlan";

/**
 * Stops a tab writing data it read before another tab took a newer copy in.
 *
 * Every view keeps what it read at mount and writes whole values back from it: a season's scores,
 * the pool's teams. After another tab lays the cloud's newer copy into storage, that tab's next
 * write would put its old values back over the new ones, and its next save would send them to
 * every device. The broadcast that makes other tabs reload (`cloudTabs.ts`) is not enough on its
 * own: a tab that was asleep, or not signed in, or writing in the same moment, can still write
 * first. So each area carries a token in `localStorage`, changed by every take, and a tab whose
 * token is older than the stored one may not write that area at all, and reloads instead.
 *
 * No imports beyond a type, since the storage layer itself asks it before every write.
 */

const TOKEN: Record<Area, string> = {
  league: "league_forecast_cloud_taken_league",
  pool: "league_forecast_cloud_taken_pool",
};

const read = (area: Area): string | null => {
  try {
    return localStorage.getItem(TOKEN[area]);
  } catch {
    return null;
  }
};

/** The token each area had when this tab read its data. */
const loaded: Record<Area, string | null> = { league: null, pool: null };
let started = false;

const start = () => {
  if (started) return;
  started = true;
  loaded.league = read("league");
  loaded.pool = read("pool");
};

// What this tab read is what the storage held as it opened: the guard starts with the module,
// which the storage layer imports before anything is read.
start();

let onStale: ((area: Area) => void) | null = null;

/** What to do when this tab tries to write an area another tab has since taken a copy into. */
export const onStaleWrite = (handler: ((area: Area) => void) | null): void => {
  start();
  onStale = handler;
};

/**
 * Whether this tab may write `area`: false after another tab took a copy into it, and then the tab
 * is told (`onStaleWrite`), once per write refused.
 */
export const mayWrite = (area: Area): boolean => {
  start();
  if (read(area) === loaded[area]) return true;
  try {
    onStale?.(area);
  } catch {
    /* the refusal is the job; the telling is a courtesy */
  }
  return false;
};

/**
 * Records that this tab has just taken a copy into `area`, so every other tab's writes to it are
 * refused until it reloads. `fresh` says this tab's own view of the area is new too: true before
 * anything has read it (startup, or Team Rankings before it opens), false when this tab will reload
 * as well.
 */
export const markTaken = (area: Area, fresh: boolean): void => {
  start();
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(TOKEN[area], token);
  } catch {
    /* without the token only the reload stands between other tabs and a stale write */
  }
  if (fresh) loaded[area] = token;
};

/** Forgets what this tab read, for tests. */
export const resetCloudGuard = (): void => {
  started = false;
  loaded.league = null;
  loaded.pool = null;
  onStale = null;
};
