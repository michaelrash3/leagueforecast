import { describe, expect, it } from "vitest";
import { agelessClearPlan, agelessSitting, clearGroups } from "../agelessSitting";
import { agelessClearable } from "../agelessTriage";
import type { AgeUnknownTeam } from "../ageUnknown";

/*
 * What the card of teams waiting on an age shows at a sitting (`agelessSitting.ts`), from a
 * device's list or the server's: the rows each rule has settled, grouped and counted in the rules'
 * own order, and what a pass over the rules ticked would clear. Placeholder names throughout.
 */

const waiting = (teamId: string, name: string): AgeUnknownTeam => ({
  teamId,
  name,
  firstSeen: "2026-09-01T00:00:00.000Z",
  lastTried: "2026-09-10T00:00:00.000Z",
  tries: 1,
});

// The tee-ball rows first, so the order drawn has to come from the rules, not the list.
const LIST = [
  waiting("gcT1", "Placeholder Tee Ball 1"),
  waiting("gcT2", "Placeholder Tee Ball 2"),
  ...[1, 2, 3, 4].map((at) => waiting(`gcV${at}`, `Placeholder VOID ${at}`)),
  waiting("gcQ", "Placeholder Q"),
];

describe("the rows the rules have settled", () => {
  const clearable = agelessClearable(LIST);

  it("are grouped in the rules' own order, counted, with the first three named", () => {
    expect(
      clearGroups(clearable).map(({ rule, count, examples }) => [rule.id, count, examples])
    ).toEqual([
      ["void-name", 4, ["Placeholder VOID 1", "Placeholder VOID 2", "Placeholder VOID 3"]],
      ["tee-ball", 2, ["Placeholder Tee Ball 1", "Placeholder Tee Ball 2"]],
    ]);
  });

  it("are cleared only under the rules ticked, each rule's count said by its label", () => {
    const plan = agelessClearPlan(clearable, new Set(["tee-ball"]));
    expect(plan.teamIds).toEqual(["gcT1", "gcT2"]);
    expect(plan.byRule).toEqual([{ label: "Tee ball and younger", count: 2 }]);
    expect(agelessClearPlan(clearable, new Set())).toEqual({ teamIds: [], byRule: [] });
  });

  it("make up the card at a sitting with the list's size and the ten in front of the person", () => {
    const sitting = agelessSitting(LIST, new Map(), new Set(), new Date("2026-09-27"), []);
    expect([sitting.listed, sitting.waiting, sitting.batch.length]).toEqual([7, 7, 7]);
    expect(sitting.groups).toEqual(clearGroups(clearable));
  });
});
