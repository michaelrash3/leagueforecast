import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterPoolFill,
  isPoolFilled,
  poolFilled,
  poolFilledInTime,
  resetPoolFill,
  startPoolFill,
} from "../poolFill";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  resetTeamRankingsStore,
  saveAgeGroups,
  type PoolStoreIo,
} from "../teamRankingsStorage";

/*
 * A member's device reads its own store after the page is drawn (`poolFill.ts`): the read waits
 * for the board's first draw unless something needs the pool first, and until it is in nothing is
 * written into a store whose read would lay its contents over the write. Placeholder names.
 */

const backing = new Map<string, string>();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetPoolFill();
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  });
});

afterEach(() => {
  resetPoolFill();
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

const GROUP = { id: "ag_12u_2027", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] };

/** A store in memory holding one page, whose reads answer only when let go. */
const heldStore = () => {
  const store = new Map<string, unknown>([["league_forecast_scout_age_groups_v1", [GROUP]]]);
  let letGo = () => undefined as void;
  const gate = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  const io: PoolStoreIo = {
    keys: async () => [...store.keys()],
    get: async (key) => {
      await gate;
      return store.get(key) ?? null;
    },
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    readLocal: () => null,
    clearLocal: () => undefined,
  };
  return { io, letGo };
};

describe("the device's store read after the page", () => {
  it("waits for the first draw, unless something needs the pool first", async () => {
    const reads: string[] = [];
    startPoolFill(
      async () => {
        reads.push("read");
      },
      new Promise(() => undefined)
    );
    await settle();
    expect(reads).toEqual([]);
    expect(isPoolFilled()).toBe(false);
    // Waited on in its own time, as a settlement does, it is not hurried.
    void poolFilledInTime();
    await settle();
    expect(reads).toEqual([]);
    // Wanted, as a backup is, it is read at once.
    await poolFilled();
    expect(reads).toEqual(["read"]);
    expect(isPoolFilled()).toBe(true);
  });

  it("starts once the first draw is done", async () => {
    const reads: string[] = [];
    let drawn = () => undefined as void;
    startPoolFill(
      async () => {
        reads.push("read");
      },
      new Promise<void>((resolve) => {
        drawn = resolve;
      })
    );
    await settle();
    expect(reads).toEqual([]);
    drawn();
    await poolFilledInTime();
    expect(reads).toEqual(["read"]);
  });

  it("runs work at once where the store is in, and after the read where it is not", async () => {
    const done: string[] = [];
    afterPoolFill(() => done.push("no read at all"));
    expect(done).toEqual(["no read at all"]);
    const { io, letGo } = heldStore();
    startPoolFill(() => initTeamRankingsStore(io));
    afterPoolFill(() => done.push(`after the read: ${loadAgeGroups().length} page`));
    await settle();
    expect(done).toEqual(["no read at all"]);
    letGo();
    await poolFilled();
    expect(done).toEqual(["no read at all", "after the read: 1 page"]);
  });

  it("refuses a write while the store is still being read, and takes it after", async () => {
    const { io, letGo } = heldStore();
    startPoolFill(() => initTeamRankingsStore(io));
    await settle();
    // Written now, it would land in localStorage, where nothing reads it once the store is open.
    expect(saveAgeGroups([{ ...GROUP, name: "Placeholder written early" }])).toBe(false);
    expect(backing.size).toBe(0);
    letGo();
    await poolFilled();
    expect(loadAgeGroups()).toEqual([GROUP]);
    expect(saveAgeGroups([{ ...GROUP, name: "Placeholder written after" }])).toBe(true);
    expect(loadAgeGroups()[0]?.name).toBe("Placeholder written after");
  });
});
