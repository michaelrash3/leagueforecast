import { describe, expect, it } from "vitest";
import { coerceAutoRemovals, type AutoRemoval, type AutoSign } from "../autoRemoved";
import { lopsidedDrops } from "../lopsidedDrops";
import type { ScoutTeam } from "../teamRankings";

/*
 * The clubs a sweep's marks say to delete outright (`lopsidedDrops`): every club whose own schedule
 * reports a game won or lost by `LOPSIDED_MARGIN` or more, the owner's rule of 27 October 2026,
 * never one the owner vouched for or a League Standings team links.
 */

const club = (id: string, ...gcIds: string[]): ScoutTeam => ({
  id,
  name: id,
  gcTeams: gcIds.map((teamId) => ({ teamId, name: id, ageGroupId: "ag_10u_2027" })),
});
const mark = (gcTeamId: string, ...signs: AutoSign[]): AutoRemoval => ({
  gcTeamId,
  name: gcTeamId,
  on: "2026-10-27",
  signs,
});

const teams = [
  club("S-FAKE", "gcFAKE"),
  club("S-TWICE", "gcTWICE1", "gcTWICE2"),
  club("S-NAMED", "gcNAMED"),
  club("S-REAL", "gcREAL"),
  club("S-LEAGUE", "gcLEAGUE"),
];

describe("the clubs a lopsided score deletes", () => {
  it("deletes every club marked for a lopsided score its own schedule reported, once", () => {
    const marks = coerceAutoRemovals([
      mark("gcFAKE", "hundred"),
      mark("gcTWICE1", "hundred"),
      mark("gcTWICE2", "rout", "hundred"),
      // Taken off for a void or test name only: stays a mark, for the owner to put back.
      mark("gcNAMED", "named"),
      // A GameChanger id no club holds any more: nothing to delete.
      mark("gcGONE", "hundred"),
    ]);
    expect(lopsidedDrops(marks, teams, new Set()).sort()).toEqual(["S-FAKE", "S-TWICE"]);
  });

  it("never deletes a club the owner vouched for or a League Standings team links", () => {
    const marks = coerceAutoRemovals([
      mark("gcFAKE", "hundred"),
      mark("gcREAL", "hundred"),
      mark("gcLEAGUE", "hundred"),
    ]);
    // Spared by a GameChanger id said to be real, and by the club id a season links.
    expect(lopsidedDrops(marks, teams, new Set(["gcREAL", "S-LEAGUE"]))).toEqual(["S-FAKE"]);
  });
});
