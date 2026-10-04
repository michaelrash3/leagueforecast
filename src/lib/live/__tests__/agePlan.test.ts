import { describe, expect, it } from "vitest";
import type { AgeGroup, ScoutTeam } from "../../teamRankings/types";
import { applyCommand, type PoolRead } from "../commands";
import { planClubAges } from "../agePlan";

/*
 * Pool health's "Approve all changes" (`agePlan.ts`): the clubs that can move go as one change,
 * and one that cannot is left out rather than refusing the rest. Placeholder names throughout.
 */
const groups: AgeGroup[] = [
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const linked = (id: string): ScoutTeam => ({
  id,
  name: `Club ${id}`,
  gcTeams: [{ teamId: `gc${id}`, name: `Club ${id} 10U`, ageGroupId: "ag_10u_2027" }],
});
const teams: ScoutTeam[] = [linked("A"), { id: "C", name: "Club C" }, linked("B")];

describe("approving several ages at once", () => {
  it("leaves out a club that cannot move, and the rest make one new page between them", () => {
    const plan = planClubAges(
      { teams, games: [], ageGroups: groups },
      [
        { teamId: "A", level: 11, year: 2027 },
        // No GameChanger link in the year: nothing to file at an age.
        { teamId: "C", level: 11, year: 2027 },
        { teamId: "B", level: 11, year: 2027 },
      ],
      "2026-09-30T12:00:00.000Z",
      "ag_x"
    );
    expect(plan.failed).toBe(1);
    expect(plan.changedTeamIds).toEqual(["A", "B"]);
    const read: PoolRead = {
      teams: () => teams,
      groups: () => groups,
      years: () => [2027],
      games: () => [],
      answers: () => new Set(),
      namedAges: () => new Map(),
    };
    const result = applyCommand(read, { kind: "batch", commands: plan.commands });
    if (!result.ok) throw new Error(result.why);
    const written = result.writes.find((write) => write.part === "groups");
    expect(written?.part === "groups" && written.groups.map((group) => group.id)).toEqual([
      "ag_10u_2027",
      "ag_x-0",
    ]);
  });
});
