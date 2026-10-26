import { beforeEach, describe, expect, it } from "vitest";
import { beforeTabYields, flushBeforeYield } from "../tabTurn";
import { createTabTurn, type TabChannel } from "../tabTurnChannel";

/*
 * Which tab of this browser may write League Standings (`tabTurn.ts`). Two tabs each wrote whole
 * seasons from what they held, so one undid the other's scores, and a season switched in one moved
 * where the other saved. The owner's choice of 26 October 2026: the tab opened later is read-only,
 * and says so, with "Use here" to take the turn.
 */

/** Channels that hear each other's messages, never their own, as a BroadcastChannel does. */
const hub = () => {
  const open = new Set<{ heard: ((message: unknown) => void) | null }>();
  const pending: Array<() => void> = [];
  const channel = (): TabChannel => {
    const me = { heard: null as ((message: unknown) => void) | null };
    open.add(me);
    return {
      post: (message) => {
        for (const other of open) {
          if (other !== me) pending.push(() => other.heard?.(structuredClone(message)));
        }
      },
      listen: (heard) => {
        me.heard = heard;
      },
      close: () => {
        open.delete(me);
      },
    };
  };
  /** Delivers every message posted, and every one those post in turn. */
  const settle = () => {
    while (pending.length) pending.shift()?.();
  };
  return { channel, settle };
};

/** What the tabs did, in order: a writer writing what it owed, a tab reloading. */
const done: string[] = [];
/** Waits set by a tab asking for the turn, run when a test says the time has passed. */
const waits: Array<() => void> = [];

const tab = (net: ReturnType<typeof hub>, openedAt: number, id: string, claim = false) => {
  const reloads: string[] = [];
  const turn = createTabTurn({
    channel: net.channel(),
    openedAt,
    id,
    claimed: () => claim,
    reload: () => {
      reloads.push(id);
      done.push(`reload ${id}`);
    },
    beforeYield: () => done.push(`flush ${id}`),
    wait: (_ms, then) => waits.push(then),
  });
  return { turn, reloads };
};

beforeEach(() => {
  done.length = 0;
  waits.length = 0;
});

describe("which tab may write League Standings", () => {
  it("is the one open first: a tab opened later is read-only", () => {
    const net = hub();
    const first = tab(net, 1000, "a");
    net.settle();
    expect(first.turn.readOnly()).toBe(false);

    const later = tab(net, 2000, "b");
    net.settle();
    expect(first.turn.readOnly()).toBe(false);
    expect(later.turn.readOnly()).toBe(true);
  });

  it("is still one of two opened in the same moment, the earlier, or by id on a tie", () => {
    const net = hub();
    const one = tab(net, 1000, "b");
    const two = tab(net, 1000, "a");
    net.settle();
    expect([one.turn.readOnly(), two.turn.readOnly()]).toEqual([true, false]);

    // And the other way about: the first to open hears the second's hello, and answers it.
    const again = hub();
    const first = tab(again, 1000, "a");
    const second = tab(again, 1000, "b");
    again.settle();
    expect([first.turn.readOnly(), second.turn.readOnly()]).toEqual([false, true]);
  });

  it("stays the earliest's when three start talking in another order than they opened", () => {
    // The channel's code is fetched after each page starts, so a tab that opened first can be the
    // last to say hello. B answers C, then gives way to A; B's answer to C must not reach A.
    const net = hub();
    const b = tab(net, 2000, "b");
    const c = tab(net, 3000, "c");
    const a = tab(net, 1000, "a");
    net.settle();
    expect(a.turn.readOnly()).toBe(false);
    expect(b.turn.readOnly()).toBe(true);
    expect(c.turn.readOnly()).toBe(true);
  });

  it("is still the taken turn's when a tab opened before it says hello late", () => {
    const net = hub();
    const taker = tab(net, 5000, "t", true);
    net.settle();
    const slow = tab(net, 1000, "s");
    net.settle();
    expect(taker.turn.readOnly()).toBe(false);
    expect(slow.turn.readOnly()).toBe(true);
  });

  it("passes to a read-only tab that says Use here, which reads the season again", () => {
    const net = hub();
    const first = tab(net, 1000, "a");
    const later = tab(net, 2000, "b");
    net.settle();

    later.turn.useHere();
    net.settle();
    // It reloads, to read what the other tab saved since it opened, and takes the turn on its way
    // back in.
    expect(later.reloads).toEqual(["b"]);
    const back = tab(net, 3000, "b2", true);
    net.settle();
    expect(back.turn.readOnly()).toBe(false);
    expect(first.turn.readOnly()).toBe(true);

    // A tab opened after that is read-only, and the first stays so.
    const third = tab(net, 4000, "c");
    net.settle();
    expect(third.turn.readOnly()).toBe(true);
    expect(first.turn.readOnly()).toBe(true);
    expect(back.turn.readOnly()).toBe(false);
  });

  it("has the writer write what it still owes before the tab asking reloads", () => {
    // App holds a score typed in the writer for half a second before saving it; read-only at once,
    // the writer's save was refused, and the tab taking over reloaded without the score.
    const net = hub();
    const writer = tab(net, 1000, "a");
    const asking = tab(net, 2000, "b");
    net.settle();

    asking.turn.useHere();
    expect(asking.reloads).toEqual([]);
    net.settle();
    expect(done).toEqual(["flush a", "reload b"]);
    expect(writer.turn.readOnly()).toBe(true);
  });

  it("goes ahead after a wait when no writer answers", () => {
    const net = hub();
    const first = tab(net, 1000, "a");
    const later = tab(net, 2000, "b");
    net.settle();
    first.turn.stop();

    later.turn.useHere();
    net.settle();
    expect(later.reloads).toEqual([]);
    waits.forEach((then) => then());
    expect(later.reloads).toEqual(["b"]);
    // Once only, whatever answers late.
    waits.forEach((then) => then());
    expect(later.reloads).toEqual(["b"]);
  });

  it("is a tab's own when the one that had it is closed", () => {
    const net = hub();
    const first = tab(net, 1000, "a");
    net.settle();
    first.turn.stop();
    const later = tab(net, 2000, "b");
    net.settle();
    expect(later.turn.readOnly()).toBe(false);
  });

  it("tells whoever listens when a tab's turn changes", () => {
    const net = hub();
    const first = tab(net, 1000, "a");
    const heard: boolean[] = [];
    first.turn.onChange((readOnly) => heard.push(readOnly));
    net.settle();
    const back = tab(net, 2000, "b", true);
    net.settle();
    expect(back.turn.readOnly()).toBe(false);
    expect(heard).toEqual([true]);
  });

  it("is every tab's where there is no channel to ask on", () => {
    const turn = createTabTurn({ channel: null, openedAt: 1, id: "a", claimed: () => false });
    expect(turn.readOnly()).toBe(false);
  });
});

describe("what a tab writes before it gives the turn", () => {
  it("runs every flush given, each on its own, until it is stopped", () => {
    const wrote: string[] = [];
    const stopScores = beforeTabYields(() => wrote.push("scores"));
    const stopBroken = beforeTabYields(() => {
      throw new Error("storage full");
    });
    const stopTeams = beforeTabYields(() => wrote.push("teams"));
    flushBeforeYield();
    expect(wrote).toEqual(["scores", "teams"]);

    stopScores();
    stopBroken();
    stopTeams();
    flushBeforeYield();
    expect(wrote).toEqual(["scores", "teams"]);
  });
});
