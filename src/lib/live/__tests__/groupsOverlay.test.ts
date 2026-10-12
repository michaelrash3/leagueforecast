import { describe, expect, it } from "vitest";
import type { AgeGroup } from "../../teamRankings";
import type { PoolCommand } from "../commands";
import { groupsAfter, overlayGroups, seasonAssignedSaid } from "../groupsOverlay";

/*
 * A league season put on a page, or taken off, as the live page draws it before a publish carries
 * it (`groupsOverlay.ts`): the pages worked out by the command the server runs, and what the person
 * is told of it.
 */

const PAGES: AgeGroup[] = [
  { id: "ag_12u_2027", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: ["s-old"] },
  { id: "ag_11u_2027", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];

type Assign = Extract<PoolCommand, { kind: "season.assign" }>;
const assign = (seasonId: string, season: Assign["season"], pageId = "ag_new"): Assign => ({
  kind: "season.assign",
  seasonId,
  season,
  pageId,
});

const holding = (groups: readonly AgeGroup[]) =>
  groups.map((group) => [group.id, group.name, group.seasonIds]);

describe("the pages after a league season is put on one", () => {
  it("adds it to the page of its age and year, off whichever held it before", () => {
    expect(
      holding(groupsAfter(PAGES, assign("s-old", { ageLevel: 11, year: 2027 })) ?? [])
    ).toEqual([
      ["ag_12u_2027", "12U 2027", []],
      ["ag_11u_2027", "11U 2027", ["s-old"]],
    ]);
  });

  it("makes the page under the id the command carries when none is of that age and year", () => {
    expect(holding(groupsAfter(PAGES, assign("s-new", { ageLevel: 9, year: 2028 })) ?? [])).toEqual(
      [
        ["ag_12u_2027", "12U 2027", ["s-old"]],
        ["ag_11u_2027", "11U 2027", []],
        ["ag_new", "9U 2028", ["s-new"]],
      ]
    );
  });

  it("takes it off every page when it is put on none", () => {
    expect(holding(groupsAfter(PAGES, assign("s-old", null)) ?? [])).toEqual([
      ["ag_12u_2027", "12U 2027", []],
      ["ag_11u_2027", "11U 2027", []],
    ]);
  });

  it("is null where the server refuses it: a page to make under an id a page has already", () => {
    expect(groupsAfter(PAGES, assign("s-new", { ageLevel: 9, year: 2028 }, "ag_11u_2027"))).toBe(
      null
    );
  });

  it("leaves the pages it was given as they were", () => {
    const before = structuredClone(PAGES);
    groupsAfter(PAGES, assign("s-new", { ageLevel: 9, year: 2028 }));
    expect(PAGES).toEqual(before);
  });
});

describe("the pages with the edits not yet published drawn over them", () => {
  it("is the very pages published when no edit since puts a season anywhere", () => {
    const edits: PoolCommand[] = [{ kind: "club.drop", teamId: "S-1" }];
    expect(overlayGroups(PAGES, [])).toBe(PAGES);
    expect(overlayGroups(PAGES, edits)).toBe(PAGES);
  });

  it("runs each one in the order made, a batch's steps among them, and skips one refused", () => {
    const shown = overlayGroups(PAGES, [
      assign("s-new", { ageLevel: 9, year: 2028 }),
      {
        kind: "batch",
        commands: [
          { kind: "club.drop", teamId: "S-1" },
          assign("s-new", { ageLevel: 11, year: 2027 }, "ag_other"),
        ],
      },
      // Refused: a new page under an id already taken.
      assign("s-old", { ageLevel: 8, year: 2026 }, "ag_12u_2027"),
      assign("s-old", null),
    ]);
    expect(holding(shown)).toEqual([
      ["ag_12u_2027", "12U 2027", []],
      ["ag_11u_2027", "11U 2027", ["s-new"]],
      ["ag_new", "9U 2028", []],
    ]);
  });
});

describe("what the person is told", () => {
  it("names the page a season joins, the page made for it, or says it was taken off", () => {
    expect(seasonAssignedSaid(PAGES, assign("s-new", { ageLevel: 11, year: 2027 }))).toBe(
      "League season added to 11U 2027."
    );
    expect(seasonAssignedSaid(PAGES, assign("s-new", { ageLevel: 9, year: 2028 }))).toBe(
      "9U 2028 created, with your league season on it."
    );
    expect(seasonAssignedSaid(PAGES, assign("s-old", null))).toBe(
      "League season taken off Team Rankings."
    );
  });
});
