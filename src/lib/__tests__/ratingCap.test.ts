import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildTeamRankings,
  RATING_CAP,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * A win counts up to `RATING_CAP` runs and no further, on the one-page fit and on the year's
 * pooled one alike. Nearly every other fixture's margins stay inside eight, so this is the test
 * that tells a board clamped at the cap from one clamped anywhere else — the shared fit falls back
 * to a cap of its own when it is handed none.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

const AG = "ag_9u_2027";
const GROUPS: AgeGroup[] = [{ id: AG, name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }];
const teams: ScoutTeam[] = ["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` }));

/** Four clubs in a ring, the first winning its one game against the second by `margin`. */
const pool = (margin: number): ScoutGame[] =>
  [
    { id: "g1", ageGroupId: AG, teamAId: "A", teamBId: "B", teamAScore: margin, teamBScore: 0 },
    { id: "g2", ageGroupId: AG, teamAId: "B", teamBId: "C", teamAScore: 5, teamBScore: 3 },
    { id: "g3", ageGroupId: AG, teamAId: "C", teamBId: "D", teamAScore: 4, teamBScore: 2 },
    { id: "g4", ageGroupId: AG, teamAId: "D", teamBId: "A", teamAScore: 3, teamBScore: 3 },
  ].map((game, at) => ({ ...game, date: `2026-09-1${2 + at}` }));

const ratingOf = (margin: number, ageGroups?: AgeGroup[]) =>
  buildTeamRankings(AG, teams, pool(margin), undefined, ageGroups).find(
    (row) => row.teamId === "A"
  )!.rating;

describe("the rating cap", () => {
  it.each([
    ["the one-page fit", undefined],
    ["the year's pooled fit", GROUPS],
  ])("counts a win in full up to the cap and no further, on %s", (_, ageGroups) => {
    const atCap = ratingOf(RATING_CAP, ageGroups);
    expect(ratingOf(RATING_CAP + 5, ageGroups)).toBeCloseTo(atCap, 10);
    expect(ratingOf(RATING_CAP - 1, ageGroups)).toBeLessThan(atCap - 0.01);
  });
});
