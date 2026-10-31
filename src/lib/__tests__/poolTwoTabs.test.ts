import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * Team Rankings open in two tabs over this browser's IndexedDB (`teamRankingsStorage.ts`). Each
 * tab holds the pool in memory and is told of each key the other saves (`poolSync.ts`), and reads
 * that key again from the store. What it reads must be the value saved, or its next save writes
 * the old one back over the other tab's work.
 */

/*
 * The store both tabs share, as IndexedDB runs it: one transaction at a time, in the order they
 * were opened, a write taking a moment to commit. A read opened before a write is opened reads
 * what was there before it.
 */
const idb = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  let last: Promise<unknown> = Promise.resolve();
  const transaction = <T>(ms: number, run: () => T): Promise<T> => {
    const done = last.then(() => new Promise<T>((resolve) => setTimeout(() => resolve(run()), ms)));
    last = done;
    return done;
  };
  return { store, transaction };
});

vi.mock("../idb", () => ({
  idbAvailable: () => true,
  openPoolDb: async () => ({}) as unknown as IDBDatabase,
  idbGet: (key: string) => idb.transaction(1, () => structuredClone(idb.store.get(key) ?? null)),
  idbSet: (key: string, value: unknown) =>
    idb.transaction(5, () => {
      idb.store.set(key, structuredClone(value));
      return true;
    }),
  idbDelete: (key: string) =>
    idb.transaction(5, () => {
      idb.store.delete(key);
    }),
  idbKeys: () => idb.transaction(1, () => [...idb.store.keys()]),
  resetPoolDbHandle: () => {},
}));

/** Tabs of one browser: each hears what the others post, a moment later, never its own. */
class TabChannel {
  static open: TabChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(public name: string) {
    TabChannel.open.push(this);
  }

  postMessage(data: unknown) {
    for (const other of TabChannel.open) {
      if (other === this || other.closed || other.name !== this.name) continue;
      setTimeout(() => other.onmessage?.({ data: structuredClone(data) }), 0);
    }
  }

  close() {
    this.closed = true;
  }
}

const backing = new Map<string, string>();
type Tab = typeof import("../teamRankingsStorage");
const tabs: Tab[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  backing.clear();
  idb.store.clear();
  TabChannel.open = [];
  vi.stubGlobal("BroadcastChannel", TabChannel);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});
afterEach(() => {
  tabs.splice(0).forEach((tab) => tab.resetPoolSync());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A moment for every transaction to commit and every tab to hear and read again. */
const aMoment = () => vi.advanceTimersByTimeAsync(500);

/** A tab opened on the store as it stands: a module of its own, as each tab's page has. */
const openTab = async (): Promise<Tab> => {
  vi.resetModules();
  const tab = await import("../teamRankingsStorage");
  const opened = tab.initTeamRankingsStore();
  await aMoment();
  await opened;
  tabs.push(tab);
  return tab;
};

/** Waits for a tab's saves to land, as a pull does before it moves on. */
const landed = async (tab: Tab): Promise<boolean> => {
  const flushed = tab.flushPoolWrites();
  await aMoment();
  return flushed;
};

const team = (id: string): ScoutTeam => ({ id, name: `Club ${id}` });
const game = (id: string, teamAScore: number, teamBScore: number): ScoutGame => ({
  id,
  teamAId: "S-AAAA",
  teamBId: "S-BBBB",
  teamAScore,
  teamBScore,
  ageGroupId: "ag1",
  date: "2026-09-12",
});
const scores = (games: readonly ScoutGame[]) =>
  games.map((one) => `${one.id} ${one.teamAScore}-${one.teamBScore}`);

describe("Team Rankings open in two tabs", () => {
  it("reads what the other tab saved once it has landed, and its next save keeps it", async () => {
    const first = await openTab();
    first.saveScoutTeams([team("S-AAAA"), team("S-BBBB")]);
    first.saveScoutGames([game("g1", 4, 1)]);
    expect(await landed(first)).toBe(true);
    const second = await openTab();
    expect(scores(second.loadScoutGames())).toEqual(["g1 4-1"]);

    // The first tab saves a club and a game together, as a pull does every twenty-five teams.
    first.saveScoutTeams([team("S-AAAA"), team("S-BBBB"), team("S-CCCC")]);
    first.saveScoutGames([game("g1", 4, 1), game("g2", 2, 7)]);
    expect(await landed(first)).toBe(true);
    await aMoment();
    expect(second.loadScoutTeams().map((one) => one.id)).toEqual(["S-AAAA", "S-BBBB", "S-CCCC"]);
    expect(scores(second.loadScoutGames())).toEqual(["g1 4-1", "g2 2-7"]);

    // The second tab corrects a score: the game the first tab added is still there after.
    second.saveScoutGames(
      second.loadScoutGames().map((one) => (one.id === "g1" ? { ...one, teamAScore: 6 } : one))
    );
    expect(await landed(second)).toBe(true);
    const third = await openTab();
    expect(scores(third.loadScoutGames())).toEqual(["g1 6-1", "g2 2-7"]);
  });
});
