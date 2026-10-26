/**
 * Which tab of this browser may write League Standings.
 *
 * Every tab writes whole seasons back from what it read when it opened (`App.tsx`'s saves), and
 * the season it saves into is the one storage names active. So with the app open in two tabs, or a
 * tab and the installed app, each undid the other's scores with its next save, and a season
 * switched in one moved where the other saved. The owner's choice of 26 October 2026: the tab
 * opened later is read-only, and says so, with "Use here" to take the turn.
 *
 * The tabs ask each other on a `BroadcastChannel`. A tab opening says hello; a tab that may write
 * and opened before it answers, and the one answered is read-only. Two opening in the same moment
 * are told apart by when each opened and then by a random id, so one of them answers the other.
 * "Use here" reloads the tab, so it reads what the other saved meanwhile, and on its way back in
 * it takes the turn: every other tab is read-only from then on. A tab whose writer was closed is
 * not told; the next tab to open writes, or "Use here" takes it. Where there is no channel (an old
 * browser, a test), every tab writes, as before.
 *
 * No imports, since the storage layer asks it before every write (`storage.ts`).
 */

/** Why an edit is refused in a tab another tab has the turn from, for the season's lock. */
export const TAB_READ_ONLY =
  "League Standings is open in another tab, so this one is read-only. Press Use here to edit in this tab.";

export type TabChannel = {
  post: (message: unknown) => void;
  listen: (heard: (message: unknown) => void) => void;
  close: () => void;
};

type Said = { kind: "hello" | "here" | "take"; id: string; openedAt: number };

const saidOf = (raw: unknown): Said | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, id, openedAt } = raw as Record<string, unknown>;
  if (kind !== "hello" && kind !== "here" && kind !== "take") return null;
  if (typeof id !== "string" || typeof openedAt !== "number") return null;
  return { kind, id, openedAt };
};

export type TabTurn = {
  /** Whether this tab is read-only: another tab has the turn. */
  readOnly: () => boolean;
  /** Calls `heard` whenever that changes; returns the way to stop. */
  onChange: (heard: (readOnly: boolean) => void) => () => void;
  /** Takes the turn: reloads, and on the way back in makes every other tab read-only. */
  useHere: () => void;
  /** Stops answering, as a closed tab does. */
  stop: () => void;
};

export const createTabTurn = ({
  channel,
  openedAt,
  id,
  claimed,
  claim = () => undefined,
  reload = () => undefined,
}: {
  channel: TabChannel | null;
  openedAt: number;
  id: string;
  /** Whether this tab opened by "Use here", which is then forgotten. */
  claimed: () => boolean;
  /** Notes, for the reload, that this tab is taking the turn. */
  claim?: () => void;
  reload?: () => void;
}): TabTurn => {
  let readOnly = false;
  const listeners = new Set<(readOnly: boolean) => void>();
  const become = (next: boolean) => {
    if (next === readOnly) return;
    readOnly = next;
    listeners.forEach((heard) => heard(next));
  };
  const me = { id, openedAt };
  // Took the turn on opening, so answers every tab that opens after, whenever that opened.
  let took = claimed();
  const before = (other: Said) =>
    me.openedAt < other.openedAt || (me.openedAt === other.openedAt && me.id < other.id);

  channel?.listen((raw) => {
    const said = saidOf(raw);
    if (!said || said.id === id) return;
    if (said.kind === "take") {
      took = false;
      become(true);
    } else if (said.kind === "hello") {
      if (readOnly) return;
      // Answered by the tab before it; a tab opened in the same moment that is before this one is
      // not answered, and this one gives way, since its own hello went out before the other heard.
      if (took || before(said)) channel.post({ kind: "here", ...me });
      else become(true);
    } else if (!took) {
      become(true);
    }
  });
  channel?.post({ kind: took ? "take" : "hello", ...me });

  return {
    readOnly: () => readOnly,
    onChange: (heard) => {
      listeners.add(heard);
      return () => listeners.delete(heard);
    },
    useHere: () => {
      claim();
      reload();
    },
    stop: () => channel?.close(),
  };
};

const CHANNEL = "league_forecast_tabs_v1";
/** Kept in `sessionStorage` across the reload "Use here" makes, which is this tab's alone. */
const CLAIM_KEY = "league_forecast_tab_claim";

const browserChannel = (): TabChannel | null => {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    const channel = new BroadcastChannel(CHANNEL);
    return {
      post: (message) => channel.postMessage(message),
      listen: (heard) => {
        channel.onmessage = (event: MessageEvent) => heard(event.data);
      },
      close: () => channel.close(),
    };
  } catch {
    return null;
  }
};

let current: TabTurn | null = null;

/** This tab's turn, asked for once as the app starts (`main.tsx`). */
export const startTabTurn = (): TabTurn => {
  if (current) return current;
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  current = createTabTurn({
    channel: browserChannel(),
    openedAt: Date.now(),
    id: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    claimed: () => {
      try {
        const held = sessionStorage.getItem(CLAIM_KEY) === "1";
        sessionStorage.removeItem(CLAIM_KEY);
        return held;
      } catch {
        return false;
      }
    },
    claim: () => {
      try {
        sessionStorage.setItem(CLAIM_KEY, "1");
      } catch {
        /* without the note the reloaded tab asks as a new one, and is read-only again */
      }
    },
    reload: () => window.location.reload(),
  });
  return current;
};

/** Whether this tab is read-only; never, before the turn is started (a test, a script). */
export const tabReadOnly = (): boolean => current?.readOnly() ?? false;

/** This tab's turn, or null before it is started. */
export const tabTurn = (): TabTurn | null => current;

/** Sets this tab's turn: a test's own, or null to forget it. */
export const adoptTabTurn = (turn: TabTurn | null): void => {
  current = turn;
};
