import { describe, expect, it } from "vitest";
import { calculateTeams, simulateGoldOdds } from "../sim";
import { DEFAULT_SETTINGS, type Matchup, type TeamBase } from "../types";

describe("simulateGoldOdds perf guardrail", () => {
  it("completes a medium scenario within a reasonable budget", () => {
    const teams: TeamBase[] = Array.from({ length: 14 }, (_, i) => ({ id: `T${i + 1}`, name: `Team ${i + 1}` }));
    const matchups: Matchup[] = [];
    let gid = 1;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matchups.push({ id: `g${gid++}`, date: "5/1", away: teams[i]!.id, home: teams[j]!.id });
      }
    }
    const live = calculateTeams(teams, matchups, {});
    const t0 = performance.now();
    const odds = simulateGoldOdds(live, matchups.slice(0, 60), 120, "perf-seed", 7, DEFAULT_SETTINGS);
    const elapsed = performance.now() - t0;
    expect(Object.keys(odds)).toHaveLength(14);
    expect(elapsed).toBeLessThan(2000);
  });
});
