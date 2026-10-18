import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDefaultState, writeDefaultState } from "../preferences";
import { defaultStateOf } from "../teamRankings/boardDisplay";

/*
 * The state Team Rankings' State top 10 opens on: what this device keeps of it, and how the card
 * chooses between it and the state it opened on before there was one.
 */

const KEY = "lf_rankings_default_state_v1";

describe("the stored default state", () => {
  const backing = new Map<string, string>();
  beforeEach(() => {
    backing.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    });
  });

  it("reads back what was written, and nothing once cleared", () => {
    expect(readDefaultState()).toBeNull();
    expect(writeDefaultState("OH")).toBe(true);
    expect(backing.get(KEY)).toBe("OH");
    expect(readDefaultState()).toBe("OH");
    expect(writeDefaultState(null)).toBe(true);
    expect(backing.has(KEY)).toBe(false);
    expect(readDefaultState()).toBeNull();
  });

  it("ignores what is not a state as clubs store them", () => {
    for (const junk of ["", "oh", " OH", "OH ", "Ohio", "O", "OHH", '"OH"', "12", "__unknown__"]) {
      backing.set(KEY, junk);
      expect(readDefaultState(), JSON.stringify(junk)).toBeNull();
    }
  });

  it("refuses to keep what is not a state, and leaves the one kept", () => {
    writeDefaultState("KY");
    expect(writeDefaultState("Ohio")).toBe(false);
    expect(writeDefaultState("")).toBe(false);
    expect(readDefaultState()).toBe("KY");
  });

  it("reads nothing, and says it kept nothing, where storage is out of reach", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readDefaultState()).toBeNull();
    expect(writeDefaultState("OH")).toBe(false);
    expect(writeDefaultState(null)).toBe(false);
  });
});

describe("the state the top ten opens on", () => {
  const clubs = [
    { id: "S-1", state: "OH" },
    { id: "S-2", state: "OH" },
    { id: "S-3", state: "KY" },
    { id: "S-4", state: "IN" },
    { id: "S-5" },
  ];

  it("is the kept state where the page has a club there, over yours and the most clubs'", () => {
    expect(defaultStateOf(clubs, "S-4", "KY")).toBe("KY");
    expect(defaultStateOf(clubs, undefined, "KY")).toBe("KY");
  });

  it("is what it was before where the page has nobody from the kept state", () => {
    expect(defaultStateOf(clubs, "S-4", "TX")).toBe("IN");
    expect(defaultStateOf(clubs, undefined, "TX")).toBe("OH");
  });

  it("is what it was before with nothing kept", () => {
    expect(defaultStateOf(clubs, "S-4", null)).toBe("IN");
    expect(defaultStateOf(clubs, "S-4")).toBe("IN");
    expect(defaultStateOf(clubs, undefined)).toBe("OH");
  });
});
