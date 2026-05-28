import { describe, expect, it } from "vitest";
import { diffProjectionTeam, type ProjectionTeamSnapshot } from "../projectionDelta";
import { buildProjectionExplanations, explainProjectionDelta } from "../projectionExplanation";

const snapshotTeam = (overrides: Partial<ProjectionTeamSnapshot> = {}): ProjectionTeamSnapshot => ({
  teamId: "A",
  rank: 4,
  goldOdds: 50,
  projectedPoints: 8,
  standingsPoints: 4,
  ...overrides,
});

const explanationsFor = (
  before: Partial<ProjectionTeamSnapshot>,
  after: Partial<ProjectionTeamSnapshot>,
  options?: Parameters<typeof buildProjectionExplanations>[1]
) =>
  buildProjectionExplanations(
    diffProjectionTeam(snapshotTeam(before), snapshotTeam(after)),
    options
  );

const forbiddenHeadings = [/why did this change\?/i, /what changed\?/i];

const expectNoForbiddenHeadings = (explanations: string[]) => {
  explanations.forEach((explanation) => {
    forbiddenHeadings.forEach((heading) => expect(explanation).not.toMatch(heading));
  });
};

describe("buildProjectionExplanations", () => {
  it("explains rank improvement", () => {
    expect(explanationsFor({ rank: 5 }, { rank: 3 })).toEqual([
      "Recent results lifted the projected finish by 2 spots.",
    ]);
  });

  it("explains rank decline", () => {
    expect(explanationsFor({ rank: 2 }, { rank: 4 })).toEqual([
      "Recent results pushed the projected finish down by 2 spots.",
    ]);
  });

  it("explains Gold odds improvement above the noise threshold", () => {
    expect(explanationsFor({ goldOdds: 40 }, { goldOdds: 47 })).toEqual([
      "Gold odds improved by 7 points after the projection strengthened.",
    ]);
  });

  it("explains Gold odds decline above the noise threshold", () => {
    expect(explanationsFor({ goldOdds: 55 }, { goldOdds: 45 })).toEqual([
      "Gold odds dipped by 10 points after the projection softened.",
    ]);
  });

  it("explains projected points movement", () => {
    expect(explanationsFor({ projectedPoints: 7 }, { projectedPoints: 8 })).toEqual([
      "Projected points improved by 1, strengthening the Gold position.",
    ]);
  });

  it("explains standings points movement", () => {
    expect(explanationsFor({ standingsPoints: 4 }, { standingsPoints: 5 })).toEqual([
      "Standings points improved by 1 after recent results.",
    ]);
  });

  it("suppresses no meaningful movement", () => {
    expect(explanationsFor({}, {})).toEqual([]);
  });

  it("suppresses tiny odds movement", () => {
    expect(explanationsFor({ goldOdds: 50 }, { goldOdds: 52.9 })).toEqual([]);
  });

  it("suppresses tiny projected points movement", () => {
    expect(explanationsFor({ projectedPoints: 8 }, { projectedPoints: 8.49 })).toEqual([]);
  });

  it("still shows rank movement at the rank threshold", () => {
    expect(explanationsFor({ rank: 5 }, { rank: 4 })).toEqual([
      "Recent results lifted the projected finish by 1 spot.",
    ]);
  });

  it("suppresses mixed small movements below all thresholds", () => {
    expect(
      explanationsFor(
        { goldOdds: 50, projectedPoints: 8, standingsPoints: 4 },
        { goldOdds: 52.5, projectedPoints: 8.4, standingsPoints: 4.4 }
      )
    ).toEqual([]);
  });

  it("respects the max explanation count while ranking by normalized impact", () => {
    const explanations = explanationsFor(
      { rank: 6, goldOdds: 30, projectedPoints: 7, standingsPoints: 4 },
      { rank: 3, goldOdds: 42, projectedPoints: 8, standingsPoints: 5 },
      { maxItems: 2 }
    );

    expect(explanations).toEqual([
      "Gold odds improved by 12 points after the projection strengthened.",
      "Recent results lifted the projected finish by 3 spots.",
    ]);
  });

  it("shows the largest meaningful movement first", () => {
    const explanations = explanationsFor(
      { rank: 5, goldOdds: 35, projectedPoints: 7.5 },
      { rank: 4, goldOdds: 50, projectedPoints: 8.25 }
    );

    expect(explanations[0]).toBe(
      "Gold odds improved by 15 points after the projection strengthened."
    );
  });

  it("does not emit forbidden question-style headings", () => {
    const explanations = explanationsFor(
      { rank: 6, goldOdds: 30, projectedPoints: 7 },
      { rank: 3, goldOdds: 42, projectedPoints: 8 }
    );

    expectNoForbiddenHeadings(explanations);
  });

  it("keeps generated explanations free of forbidden question-style headings", () => {
    const scenarios = [
      explanationsFor({ rank: 5 }, { rank: 3 }),
      explanationsFor({ goldOdds: 40 }, { goldOdds: 47 }),
      explanationsFor({ projectedPoints: 7 }, { projectedPoints: 8 }),
      explanationsFor({ standingsPoints: 4 }, { standingsPoints: 5 }),
      explanationsFor(
        { rank: 6, goldOdds: 30, projectedPoints: 7, standingsPoints: 4 },
        { rank: 3, goldOdds: 42, projectedPoints: 8, standingsPoints: 5 }
      ),
    ];

    scenarios.forEach(expectNoForbiddenHeadings);
  });

  it("accepts a snapshot delta plus team id", () => {
    const before = {
      createdAt: "2026-05-27T00:00:00.000Z",
      teams: [snapshotTeam({ rank: 4 })],
    };
    const after = {
      createdAt: "2026-05-28T00:00:00.000Z",
      teams: [snapshotTeam({ rank: 2 })],
    };
    const delta = {
      before,
      after,
      teams: [diffProjectionTeam(before.teams[0], after.teams[0])],
      reasons: ["projection-change" as const],
    };

    expect(explainProjectionDelta({ delta, teamId: "A" })).toEqual([
      "Recent results lifted the projected finish by 2 spots.",
    ]);
  });
});
