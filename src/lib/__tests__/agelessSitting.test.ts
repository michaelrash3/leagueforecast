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
    const sitting = agelessSitting(
      [...LIST, ...ON_THE_QUEUE],
      new Map(),
      new Set(),
      new Date("2026-09-27"),
      []
    );
    expect([sitting.listed, sitting.waiting, sitting.batch.length]).toEqual([9, 2, 2]);
    // Every row still asked about is a rule's to clear, the rows set aside among them.
    expect(sitting.groups).toEqual(clearGroups(clearable));
  });
});

/** Two teams a person can answer: games, and an opponent writing an age, too few to file by. */
const ON_THE_QUEUE: AgeUnknownTeam[] = ["gcA1", "gcA2"].map((teamId, at) => ({
  ...waiting(teamId, `Alder Comets ${at + 1}`),
  evidence: {
    games: 4,
    scored: 4,
    aheadOfToday: 0,
    shutoutBlowouts: 0,
    opponents: 4,
    namedAnAge: 1,
    tally: [[10, 1]],
  },
}));

describe("the rows set aside at a sitting", () => {
  const evidence = (extra: Partial<NonNullable<AgeUnknownTeam["evidence"]>>) => ({
    games: 4,
    scored: 4,
    aheadOfToday: 0,
    shutoutBlowouts: 0,
    opponents: 4,
    namedAnAge: 0,
    tally: [],
    ...extra,
  });
  const at = (
    teamId: string,
    name: string,
    extra: Partial<AgeUnknownTeam> = {}
  ): AgeUnknownTeam => ({
    ...waiting(teamId, name),
    ...extra,
  });
  const LISTED: AgeUnknownTeam[] = [
    ...ON_THE_QUEUE,
    at("gcN1", "Alder Comets 3", { evidence: evidence({}) }),
    at("gcN2", "Alder Comets 4", { evidence: evidence({}) }),
    at("gcE1", "Alder Comets 5", { evidence: evidence({ games: 0, scored: 0, opponents: 0 }) }),
    at("gcE2", "Alder Comets 6"),
    at("gcS1", "Alder Comets 7", { evidence: evidence({ namedAnAge: 1, playerCount: 4 }) }),
    at("gcT1", "Team 6", { evidence: evidence({ namedAnAge: 1 }) }),
    at("gcM1", "Alder Comets 8", { evidence: evidence({ namedAnAge: 1, aheadOfToday: 4 }) }),
    at("gcH1", "Alder Comets 9", {
      evidence: evidence({ namedAnAge: 1, ageLabel: "high_varsity" }),
    }),
    at("gcH2", "Alder Comets HS Varsity", { evidence: evidence({ namedAnAge: 1 }) }),
    // Thrown out: answered, so on no count.
    at("gcD1", "Alder Comets 10", { evidence: evidence({}) }),
  ];

  it("are counted under the rule that set each aside, the answered left out", () => {
    const sitting = agelessSitting(
      LISTED,
      new Map(),
      new Set(["gcD1"]),
      new Date("2026-09-27"),
      []
    );
    expect([sitting.listed, sitting.waiting]).toEqual([12, 2]);
    expect(sitting.setAside).toEqual([
      { aside: "no-age-named", count: 2 },
      { aside: "no-games", count: 2 },
      { aside: "short-roster", count: 1 },
      { aside: "no-team-name", count: 1 },
      { aside: "made-up", count: 1 },
      { aside: "high-school", count: 2 },
    ]);
  });

  it("are none on a list every row of which a person can answer", () => {
    expect(
      agelessSitting(ON_THE_QUEUE, new Map(), new Set(), new Date("2026-09-27"), []).setAside
    ).toEqual([]);
  });
});
