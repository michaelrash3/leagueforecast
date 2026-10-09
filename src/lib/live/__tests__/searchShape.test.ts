import { describe, expect, it } from "vitest";
import { coerceSearch, encodeSearch, searchKey, type SearchView } from "../views/searchShape";

/*
 * A Find a team list as published and read back (`searchShape.ts`): its key, the list through the
 * wire and back, and the check that refuses one that is not a list. Placeholder names throughout.
 */

const VIEW: SearchView = {
  options: [
    {
      id: "S-1",
      label: "Placeholder Hawks",
      detail: "10U 2027 · Town 1, OH",
      coaches: ["Placeholder Coach A", "Placeholder Coach B"],
      gcIds: ["gcAAAAAAAAAA", "gcBBBBBBBBBB"],
    },
    // A club with nothing under its name, and one on another page.
    { id: "S-2", label: "Placeholder Bees" },
    { id: "S-3", label: "Placeholder Cows", detail: "9U 2027 · played by IN clubs" },
  ],
  pageOf: new Map([
    ["S-1", "ag_10u_2027"],
    ["S-2", "ag_10u_2027"],
    ["S-3", "ag_9u_2027"],
  ]),
  held: {
    dropped: new Set(["gcDROPPED001"]),
    ageless: [{ teamId: "gcWAITING001", name: "Placeholder Waiting" }, { teamId: "gcWAITING002" }],
    tooYoung: new Set(["gcTOOYOUNG01"]),
  },
};

const wire = () =>
  JSON.parse(JSON.stringify(encodeSearch(VIEW))) as {
    pages: unknown[];
    clubs: unknown[][];
    dropped: unknown[];
    waiting: unknown[][];
    tooYoung: unknown[];
  };

describe("a Find a team list", () => {
  it("is named by year, with none for the pages without one", () => {
    expect(searchKey(2027)).toBe("search:2027");
    expect(searchKey(undefined)).toBe("search:none");
  });

  it("reads back as it was published", () => {
    expect(coerceSearch(wire())).toEqual(VIEW);
  });

  it("names each page once, and each club's page by its place", () => {
    const sent = encodeSearch(VIEW);
    expect(sent.pages).toEqual(["ag_10u_2027", "ag_9u_2027"]);
    expect(sent.clubs.map((club) => club[2])).toEqual([0, 0, 1]);
  });

  it("is refused a club offered with no page", () => {
    expect(() => encodeSearch({ ...VIEW, pageOf: new Map([["S-1", "ag_10u_2027"]]) })).toThrow(
      /S-2 is offered with no page/
    );
  });
});

describe("a published list read back", () => {
  const refused = (spoil: (list: ReturnType<typeof wire>) => void) => {
    const list = wire();
    spoil(list);
    return coerceSearch(list);
  };

  it("is nothing at all when any part of it is not a list's", () => {
    expect(coerceSearch(null)).toBeNull();
    expect(coerceSearch([])).toBeNull();
    expect(refused((list) => (list.pages = ["ag_10u_2027", "ag_10u_2027"]))).toBeNull();
    expect(refused((list) => (list.pages = [""]))).toBeNull();
    expect(refused((list) => (list.clubs = {} as never))).toBeNull();
    expect(refused((list) => list.clubs[0]!.push("more"))).toBeNull();
    expect(refused((list) => (list.clubs[0]![0] = ""))).toBeNull();
    expect(refused((list) => (list.clubs[1]![0] = "S-1"))).toBeNull();
    expect(refused((list) => (list.clubs[0]![1] = 4))).toBeNull();
    expect(refused((list) => (list.clubs[0]![2] = 2))).toBeNull();
    expect(refused((list) => (list.clubs[0]![2] = 0.5))).toBeNull();
    expect(refused((list) => (list.clubs[0]![3] = null))).toBeNull();
    expect(refused((list) => (list.clubs[0]![4] = [7]))).toBeNull();
    expect(refused((list) => (list.clubs[0]![5] = [""]))).toBeNull();
    expect(refused((list) => (list.dropped = [""]))).toBeNull();
    expect(refused((list) => (list.tooYoung = "gcTOOYOUNG01" as never))).toBeNull();
    expect(refused((list) => (list.waiting = {} as never))).toBeNull();
    expect(refused((list) => (list.waiting[0] = []))).toBeNull();
    expect(refused((list) => (list.waiting[0] = ["gcWAITING001", 3]))).toBeNull();
    expect(refused((list) => (list.waiting[0] = ["", "Placeholder Waiting"]))).toBeNull();
    // Untouched, it reads.
    expect(coerceSearch(wire())).not.toBeNull();
  });
});
