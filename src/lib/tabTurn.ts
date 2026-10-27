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
 * This is the part every write asks (`storage.ts`): which turn this tab is on, if any, and the words
 * a refused edit gives. No imports, for that reason. The tabs' talk on the channel
 * (`tabTurnChannel.ts`) is fetched after the page has started, since nothing on the first screen
 * needs it: until it is running, this tab writes, which is what it would do anyway until another
 * tab answered its hello.
 */

/** Why an edit is refused in a tab another tab has the turn from, for the season's lock. */
export const TAB_READ_ONLY =
  "League Standings is open in another tab, so this one is read-only. Press Use here to edit in this tab.";

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

let current: TabTurn | null = null;
let stopHearing: (() => void) | null = null;
const heard = new Set<() => void>();
const tell = () => heard.forEach((listener) => listener());

/** Whether this tab is read-only; never, before the turn is started (a test, a script). */
export const tabReadOnly = (): boolean => current?.readOnly() ?? false;

/** This tab's turn, or null before it is started. */
export const tabTurn = (): TabTurn | null => current;

/**
 * Calls `listener` whenever whether this tab is read-only may have changed: the turn starting, or
 * the turn's own answer changing. Returns the way to stop.
 */
export const onTabReadOnly = (listener: () => void): (() => void) => {
  heard.add(listener);
  return () => heard.delete(listener);
};

/** Sets this tab's turn: the one started (`tabTurnChannel.ts`), a test's own, or null to forget it. */
export const adoptTabTurn = (turn: TabTurn | null): void => {
  stopHearing?.();
  current = turn;
  stopHearing = turn ? turn.onChange(tell) : null;
  tell();
};

const yielders = new Set<() => boolean>();

/**
 * Calls `flush` as this tab gives its turn away (`tabTurnChannel.ts`), before it answers: what it
 * still owes storage is written while it may. It says whether it wrote anything, since the tab
 * given way to reads the season again only then. Returns the way to stop.
 */
export const beforeTabYields = (flush: () => boolean): (() => void) => {
  yielders.add(flush);
  return () => {
    yielders.delete(flush);
  };
};

/**
 * Every flush given (`beforeTabYields`), each on its own: one that throws keeps no other back.
 * Whether any of them wrote.
 */
export const flushBeforeYield = (): boolean => {
  let wrote = false;
  yielders.forEach((flush) => {
    try {
      if (flush()) wrote = true;
    } catch {
      /* the turn goes regardless, and the next flush still writes */
    }
  });
  return wrote;
};
