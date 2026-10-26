import type { TabTurn } from "./tabTurn";

/*
 * How the tabs of this browser agree which of them writes League Standings (`tabTurn.ts`, which
 * says why). Fetched once the page has started (`main.tsx`), which hands the turn started here to
 * `tabTurn.ts`. Only its type is read from there: imported, the registry would be in this chunk's
 * reach too, and the build split it out of the first download into a file of its own.
 */

export type TabChannel = {
  post: (message: unknown) => void;
  listen: (heard: (message: unknown) => void) => void;
  close: () => void;
};

/**
 * What a tab says on the channel: hello as it opens, take as it takes the turn, want when Use here
 * asks the writer for it, and three answers to one tab alone (`to`): here, to a hello; given, to a
 * want; and wrote, to the hello of a tab opened before this one that came after this one had begun
 * writing. The channel reaches every tab, and an answer heard by a tab it was not for could make
 * that tab give way to one it is before: with three talking in another order than they opened,
 * all three ended read-only.
 */
type Said = {
  kind: "hello" | "here" | "take" | "want" | "given" | "wrote";
  id: string;
  openedAt: number;
  to?: string;
};

const KINDS = new Set(["hello", "here", "take", "want", "given", "wrote"]);
const ANSWERS = new Set(["here", "given", "wrote"]);

const saidOf = (raw: unknown): Said | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, id, openedAt, to } = raw as Record<string, unknown>;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  if (typeof id !== "string" || typeof openedAt !== "number") return null;
  const said = { kind: kind as Said["kind"], id, openedAt };
  if (ANSWERS.has(kind)) return typeof to === "string" ? { ...said, to } : null;
  return said;
};

/**
 * How long Use here waits for the writer to answer before taking the turn anyway: a writer closed
 * since, or one too busy to answer, is not waited on for ever.
 */
const WANT_WAIT_MS = 1000;

export const createTabTurn = ({
  channel,
  openedAt,
  id,
  claimed,
  claim = () => undefined,
  reload = () => undefined,
  beforeYield = () => undefined,
  wait = (ms, then) => {
    setTimeout(then, ms);
  },
}: {
  channel: TabChannel | null;
  openedAt: number;
  id: string;
  /** Whether this tab opened by "Use here", which is then forgotten. */
  claimed: () => boolean;
  /** Notes, for the reload, that this tab is taking the turn. */
  claim?: () => void;
  reload?: () => void;
  /**
   * Writes what this tab still owes storage, while it may: called as the writer gives the turn
   * away, to a tab that asked for it or to one before it whose hello came late, before it answers
   * (`beforeTabYields`). App holds a typed score half a second before saving it, and a writer
   * read-only at once had that save refused.
   */
  beforeYield?: () => void;
  wait?: (ms: number, then: () => void) => void;
}): TabTurn => {
  let readOnly = false;
  const listeners = new Set<(readOnly: boolean) => void>();
  const become = (next: boolean) => {
    if (next === readOnly) return;
    readOnly = next;
    listeners.forEach((heard) => heard(next));
  };
  const me = { id, openedAt };
  // A tab reloads once, whatever asks it to twice: with the turn noted, by Use here, which takes
  // it on the way back in; or without, to read what a writer that gave it way wrote.
  let gone = false;
  const leave = (taking: boolean) => {
    if (gone) return;
    gone = true;
    if (taking) claim();
    reload();
  };
  const go = () => leave(true);
  // Took the turn on opening, so answers every tab that opens after, whenever that opened.
  let took = claimed();
  const before = (other: Said) =>
    me.openedAt < other.openedAt || (me.openedAt === other.openedAt && me.id < other.id);
  // The writer giving the turn away: what it owes is written first, whatever that throws, then it
  // is read-only, then it answers the one tab it gave way to.
  const giveTo = (to: string, kind: "given" | "wrote") => {
    try {
      beforeYield();
    } finally {
      took = false;
      become(true);
      channel?.post({ kind, ...me, to });
    }
  };

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
      if (took || before(said)) channel.post({ kind: "here", ...me, to: said.id });
      // A tab opened before this one whose hello is only now heard: its channel's code came after
      // this one's, and this tab may have taken a score meanwhile. Written, then answered, so that
      // tab reads it again (`wrote`), since the season it holds is older than what this one wrote.
      else giveTo(said.id, "wrote");
    } else if (said.kind === "want") {
      // Asked for by Use here: the writer writes what it owes, then gives the turn, and says so to
      // the one tab that asked, which reloads only then, so it reads what was just written.
      if (readOnly) return;
      giveTo(said.id, "given");
    } else if (said.kind === "given") {
      if (said.to === id) go();
    } else if (said.kind === "wrote") {
      // Read again, without taking the turn: on the way back in it asks as a new tab, so a turn
      // given way to more than once while several tabs opened together still ends with one writer.
      // A tab read-only by now writes nothing, so what it holds being older harms nothing.
      if (said.to === id && !readOnly) leave(false);
    } else if (said.to === id && !took) {
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
      if (!channel) {
        go();
        return;
      }
      channel.post({ kind: "want", ...me });
      wait(WANT_WAIT_MS, go);
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

/**
 * This tab's turn, made once as the app starts (`main.tsx`), which hands it what the tab writes
 * before it gives the turn away (`flushBeforeYield`).
 */
export const startTabTurn = (beforeYield?: () => void): TabTurn => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const started = createTabTurn({
    channel: browserChannel(),
    // When the page began loading, not when this code arrived, which is a moment later.
    openedAt: performance.timeOrigin,
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
    ...(beforeYield ? { beforeYield } : {}),
  });
  return started;
};
