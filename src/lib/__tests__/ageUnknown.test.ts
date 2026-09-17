import { describe, expect, it } from "vitest";
import {
  ageUnknownDue,
  coerceAgeUnknown,
  describeAgeUnknown,
  updateAgeUnknown,
  type AgeUnknownList,
} from "../ageUnknown";
import type { GcImportOutcome } from "../gameChangerImport";

const NOW = "2026-09-18T12:00:00.000Z";
const LAST_WEEK = "2026-09-11T12:00:00.000Z";

const outcome = (gcTeamId: string, extra: Partial<GcImportOutcome> = {}): GcImportOutcome => ({
  gcTeamId,
  teamName: `Team ${gcTeamId}`,
  teamId: "pool-1",
  ageGroupId: "ag",
  ageGroupName: "10U 2027",
  createdAgeGroup: false,
  createdTeam: false,
  gamesAdded: 0,
  gamesUpdated: 0,
  gamesUnchanged: 0,
  gamesIgnored: 0,
  gamesOutOfSeason: 0,
  opponentsCreated: 0,
  opponentsMatchedByAvatar: 0,
  opponentsMatchedByName: 0,
  ...extra,
});

describe("keeping the teams nobody could age", () => {
  it("takes on a team with no age, and nothing else", () => {
    const list = updateAgeUnknown(
      [],
      [
        outcome("A", { skip: "no-age", issue: "no age" }),
        // A 6U team is below the youngest level ranked here and always will be; asking about it
        // every week for ever is a request that can never come good.
        outcome("B", { skip: "below-min-age", issue: "too young" }),
        outcome("C", { skip: "no-season", issue: "no season" }),
        outcome("D"),
      ],
      NOW
    );
    expect(list.map((entry) => entry.teamId)).toEqual(["A"]);
    expect(list[0]?.tries).toBe(1);
    expect(list[0]?.firstSeen).toBe(NOW);
  });

  it("counts the tries and keeps the day it was first found", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 3 },
    ];
    const list = updateAgeUnknown(first, [outcome("A", { skip: "no-age", issue: "no age" })], NOW);
    expect(list[0]?.tries).toBe(4);
    expect(list[0]?.firstSeen).toBe(LAST_WEEK);
    expect(list[0]?.lastTried).toBe(NOW);
  });

  it("drops a team the moment somebody can say its age", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 2 },
    ];
    // Filed at last — by its own field, its name, or the three opponents that settled it.
    expect(updateAgeUnknown(first, [outcome("A", { ageFromOpponents: 9 })], NOW)).toEqual([]);
  });

  /*
   * A team that could not be fetched this week has not been answered — nobody asked it anything.
   * Dropping it on the absence of a skip would lose it for good, which is the bug this list exists
   * to fix in the first place.
   */
  it("keeps a team the run never reached", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 2 },
    ];
    expect(updateAgeUnknown(first, [], NOW).map((entry) => entry.teamId)).toEqual(["A"]);
  });

  it("hands over the stalest first, so a long list still comes round", () => {
    const list: AgeUnknownList = [
      { teamId: "new", firstSeen: NOW, lastTried: NOW, tries: 1 },
      { teamId: "old", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 4 },
    ];
    expect(ageUnknownDue(list, 1)).toEqual(["old"]);
    expect(ageUnknownDue(list, 10)).toEqual(["old", "new"]);
    expect(ageUnknownDue(list, 0)).toEqual([]);
  });

  it("says how many are waiting, and how many are stubborn about it", () => {
    const list: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: NOW, tries: 5 },
      { teamId: "B", firstSeen: LAST_WEEK, lastTried: NOW, tries: 1 },
    ];
    expect(describeAgeUnknown(list)).toBe(
      "2 teams still have no age, 1 of them asked four times or more."
    );
    expect(describeAgeUnknown([])).toBe("");
  });

  it("reads back what it stored, and shrugs off what it did not", () => {
    expect(coerceAgeUnknown(null)).toEqual([]);
    expect(coerceAgeUnknown([{ teamId: "" }, { nope: 1 }, "x"])).toEqual([]);
    expect(coerceAgeUnknown([{ teamId: "A", tries: "many" }])).toEqual([
      { teamId: "A", firstSeen: "", lastTried: "", tries: 0 },
    ]);
  });
});
