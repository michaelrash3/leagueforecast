/**
 * Telling the other tabs that the pool has changed.
 *
 * The pool is cached in memory, once, when a tab starts (see `teamRankingsStorage.ts`). That is
 * what makes a synchronous read of an asynchronous store possible, and it is also what makes two
 * tabs dangerous: each holds its own copy, and neither hears about the other's writes. Open Team
 * Rankings twice, start a forty-minute GameChanger pull in one, correct a score in the other, and
 * the second tab writes the pool it read at startup straight over everything the pull has done.
 * Nothing errors. The work is simply gone.
 *
 * The fix is a notification, not a value: a tab that writes says only *which key* changed, and the
 * tabs that hear it re-read that key from the store. Sending the value instead would mean copying
 * a pool that can run to tens of megabytes across every open tab on every save — a pull saves
 * every twenty-five teams — where a key name costs nothing and is never out of date by the time it
 * arrives.
 *
 * Where the pool is still in localStorage there is nothing to keep in sync, because there is no
 * cache: reads go straight to a localStorage the browser already shares between tabs. Only the
 * notification is missing, and the browser sends that one itself as a `storage` event.
 */

/** Named with a version so a later format change cannot be heard by an older tab. */
export const POOL_CHANNEL = "league_forecast_pool_v1";

/** What one tab tells the others: a key, and who changed it. */
export type PoolMessage = { tab: string; key: string };

/**
 * This tab, for the length of its life. A tab hears its own broadcasts on some browsers and must
 * not act on them — it already has the value, and re-reading would only race its own queued write.
 */
export const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type PoolBroadcast = {
  /** Says a key changed. Never throws: a channel that has closed under us is not worth failing over. */
  post: (key: string) => void;
  close: () => void;
};

/** Does nothing, for a browser with no way to talk between tabs. The pool still works; it is alone. */
export const SILENT_BROADCAST: PoolBroadcast = {
  post: () => undefined,
  close: () => undefined,
};

/**
 * Opens the channel, or returns nothing where `BroadcastChannel` is not to be had — older
 * browsers, and jsdom. `onChange` is called with the key another tab changed, never with this
 * tab's own.
 */
export const openPoolBroadcast = (onChange: (key: string) => void): PoolBroadcast | null => {
  if (typeof BroadcastChannel === "undefined") return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(POOL_CHANNEL);
  } catch {
    return null;
  }

  channel.onmessage = (event: MessageEvent<PoolMessage>) => {
    const message = event.data;
    if (!message || typeof message.key !== "string") return;
    if (message.tab === TAB_ID) return;
    onChange(message.key);
  };

  return {
    post: (key) => {
      try {
        channel.postMessage({ tab: TAB_ID, key } satisfies PoolMessage);
      } catch {
        /* a tab that cannot be told is a tab that reloads to catch up */
      }
    },
    close: () => {
      try {
        channel.close();
      } catch {
        /* closing twice is not a failure */
      }
    },
  };
};

/**
 * Listens for another tab's localStorage writes. The browser raises `storage` in every *other*
 * tab, never in the one that wrote, so there is no echo to filter out here — and because the value
 * itself is already shared, hearing about it is the whole job.
 *
 * Returns a function that stops listening, or one that does nothing where there is no window.
 */
export const listenForLocalPoolWrites = (
  onChange: (key: string) => void,
  isPoolKey: (key: string) => boolean
): (() => void) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function")
    return () => undefined;

  const handler = (event: StorageEvent) => {
    // A null key means the whole of storage was cleared, which is every key at once.
    if (event.key === null) {
      onChange("");
      return;
    }
    if (isPoolKey(event.key)) onChange(event.key);
  };

  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
};
