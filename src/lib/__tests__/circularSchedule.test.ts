import { describe, expect, it } from "vitest";
import { circularScheduleDeductions, MAX_CIRCULAR_SCHEDULE_DEDUCTION } from "../circularSchedule";
import { buildTeamRankings, fitScoutYear, rowsOfYearFit } from "../teamRankings";
import { gameBreakdown } from "../gameBreakdown";
import { boardFitOf } from "../live/views/board";
import { coerceBoardView } from "../live/views/boardShape";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings/types";

const teams: ScoutTeam[] = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
const circle = (rounds = 3) =>
  teams.flatMap((a, i) =>
    teams
      .slice(i + 1)
      .flatMap((b) => Array.from({ length: rounds }, () => ({ a: a.id, b: b.id, weight: 1 })))
  );

describe("circular schedule deduction", () => {
  it("caps a well-observed round-robin circle and does not clear it with more internal games", () => {
    const short = circularScheduleDeductions(teams, circle());
    const long = circularScheduleDeductions(teams, circle(12));
    for (const team of teams) {
      expect(short.get(team.id)).toBe(MAX_CIRCULAR_SCHEDULE_DEDUCTION);
      expect(long.get(team.id)).toBe(MAX_CIRCULAR_SCHEDULE_DEDUCTION);
    }
  });

  it("reduces the deduction only slightly after one outside game", () => {
    const all: ScoutTeam[] = [...teams, { id: "X", name: "Outside opponent", nameOnly: true }];
    const afterOne = circularScheduleDeductions(all, [...circle(), { a: "A", b: "X", weight: 1 }]);
    expect(afterOne.get("A")).toBeCloseTo(0.9);
    expect(afterOne.get("B")).toBeGreaterThan(0.9);
    expect(afterOne.get("B")).toBeLessThan(1);
  });

  it("reads opponents' outside games, even when the original club has not played outside", () => {
    const all = [...teams, { id: "X", name: "X" }, { id: "Y", name: "Y" }];
    const deductions = circularScheduleDeductions(all, [
      ...circle(),
      ...["B", "C", "D"].flatMap((a) => [
        { a, b: "X", weight: 1 },
        { a, b: "Y", weight: 1 },
      ]),
    ]);
    expect(deductions.get("A")).toBeCloseTo(0.75);
  });

  it("gives broader opponent schedules no circular deduction", () => {
    const all = [...teams];
    const pairs = ["B", "C", "D"].flatMap((b) => {
      const outside = [`${b}-X`, `${b}-Y`];
      all.push(...outside.map((id) => ({ id, name: id })));
      return [
        { a: "A", b, weight: 1 },
        { a: "A", b, weight: 1 },
        ...outside.flatMap((id) => [
          { a: b, b: id, weight: 1 },
          { a: b, b: id, weight: 1 },
        ]),
      ];
    });
    expect(circularScheduleDeductions(all, pairs).get("A")).toBeUndefined();
  });

  it("does not mistake unpulled opponents or a thin record for an established circle", () => {
    const unpulled: ScoutTeam[] = teams.map((team) => ({
      ...team,
      ...(team.id !== "A" ? { nameOnly: true as const } : {}),
    }));
    expect(circularScheduleDeductions(unpulled, circle()).size).toBe(0);
    expect(circularScheduleDeductions(teams, circle(1)).size).toBe(0);
    expect(circularScheduleDeductions(teams.slice(0, 3), circle(6)).size).toBe(0);
  });

  it("uses recency weights for how much outside evidence opens a circle", () => {
    const all = [...teams, { id: "X", name: "X" }];
    const recent = circularScheduleDeductions(all, [...circle(), { a: "B", b: "X", weight: 1 }]);
    const old = circularScheduleDeductions(all, [...circle(), { a: "B", b: "X", weight: 0.1 }]);
    expect(old.get("A")!).toBeGreaterThan(recent.get("A")!);
  });

  it("ignores placeholders, self matches and invalid weights without generating NaN", () => {
    const invalid = [
      { a: "A", b: "A", weight: 1 },
      { a: "A", b: "unknown", weight: 1 },
      { a: "A", b: "B", weight: Number.NaN },
      { a: "A", b: "B", weight: Number.POSITIVE_INFINITY },
      { a: "A", b: "B", weight: -1 },
      { a: "A", b: "B", weight: 0 },
      { a: "A", b: "slot", weight: 1 },
    ];
    const all: ScoutTeam[] = [...teams, { id: "slot", name: "TBD", placeholder: true }];
    expect(circularScheduleDeductions(all, [...circle(), ...invalid])).toEqual(
      circularScheduleDeductions(teams, circle())
    );
  });

  it("produces the same deductions when imports arrive in another order", () => {
    expect(circularScheduleDeductions([...teams].reverse(), circle().reverse())).toEqual(
      circularScheduleDeductions(teams, circle())
    );
  });
});

describe("deduction in the ranking paths", () => {
  const group: AgeGroup = { id: "g", name: "12U 2026", ageLevel: 12, year: 2026, seasonIds: [] };
  const clubs = teams;
  const games: ScoutGame[] = circle().map((pair, i) => ({
    id: `g${i}`,
    teamAId: pair.a,
    teamBId: pair.b,
    ageGroupId: group.id,
    date: "2026-05-01",
    teamAScore: 4,
    teamBScore: 4,
  }));

  it("deducts from the ranked rating while preserving the fitted estimate and record", () => {
    const fit = fitScoutYear(
      2026,
      clubs,
      games,
      games.map((game) => ({ game, ageGap: 0 })),
      [group]
    );
    const rows = rowsOfYearFit(fit, group.id, undefined, [group]);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.scheduleDeduction).toBe(1);
      expect(row.rating).toBeCloseTo(row.pointRating - 1);
      expect(row.pointRating).toBe(0);
      expect(row.record).toBe("0-0-9");
    }
  });

  it("agrees in the direct and cached-year ranking paths", () => {
    const pooled = buildTeamRankings(group.id, clubs, games, undefined, [group]);
    const direct = buildTeamRankings(group.id, clubs, games);
    for (const row of pooled) {
      const same = direct.find((other) => other.teamId === row.teamId)!;
      expect(row.scheduleDeduction).toBe(same.scheduleDeduction);
      expect(row.rating).toBeCloseTo(same.rating);
    }
  });

  it("keeps game explanations available after the deducted row is published and read back", () => {
    const fit = fitScoutYear(
      2026,
      clubs,
      games,
      games.map((game) => ({ game, ageGap: 0 })),
      [group]
    );
    const rows = rowsOfYearFit(fit, group.id, undefined, [group]);
    const board = coerceBoardView(
      JSON.parse(
        JSON.stringify({
          rows: rows.map(({ isMine: _mine, ...row }) => row),
          fit: boardFitOf(fit, rows, "2026-05-31"),
        })
      )
    );
    expect(board).not.toBeNull();
    const breakdown = gameBreakdown({
      teamId: "A",
      games: games.filter((game) => game.teamAId === "A" || game.teamBId === "A"),
      pageId: group.id,
      ageGroups: [group],
      segment: undefined,
      board: board!,
    });
    expect(breakdown?.rating).toBe(-1);
    expect(breakdown?.scheduleDeduction).toBe(1);
    expect(breakdown?.lines.size).toBe(9);
  });
});
