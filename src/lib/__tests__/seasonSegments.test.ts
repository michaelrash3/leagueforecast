import { describe, expect, it } from "vitest";
import {
  buildTeamRankings,
  inSegment,
  previousSeason,
  scoutRatingGames,
  segmentLabel,
  segmentOfDate,
  segmentOn,
  segmentWindow,
  squadYearWindow,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

describe("the two halves of a baseball year", () => {
  it("covers exactly the year between them, with no overlap and no gap", () => {
    const year = squadYearWindow(2027);
    const fall = segmentWindow(2027, "fall");
    const spring = segmentWindow(2027, "spring");

    expect(fall.start).toBe(year.start);
    expect(spring.end).toBe(year.end);
    // Contiguous: the day after the autumn's last is the spring's first.
    expect(fall.end).toBe("2026-12-31");
    expect(spring.start).toBe("2027-01-01");
  });

  it("is named by the calendar year it is played in, not by the baseball year", () => {
    // The whole point of the labels. "2027" alone is not something anybody would recognise.
    expect(segmentLabel(2027, "fall")).toBe("Fall 2026");
    expect(segmentLabel(2027, "spring")).toBe("Spring 2027");
    expect(segmentLabel(2026, "fall")).toBe("Fall 2025");
  });

  it("places a date in its half", () => {
    expect(segmentOfDate("2026-08-01", 2027)).toBe("fall");
    expect(segmentOfDate("2026-09-17", 2027)).toBe("fall");
    expect(segmentOfDate("2026-12-31", 2027)).toBe("fall");
    expect(segmentOfDate("2027-01-01", 2027)).toBe("spring");
    expect(segmentOfDate("2027-07-31", 2027)).toBe("spring");
  });

  it("places nothing outside the year, and nothing with no date", () => {
    expect(segmentOfDate("2026-07-31", 2027)).toBeUndefined();
    expect(segmentOfDate("2027-08-01", 2027)).toBeUndefined();
    expect(segmentOfDate(undefined, 2027)).toBeUndefined();
    expect(segmentOfDate("2026-09-17", undefined)).toBeUndefined();
  });

  it("keeps a dated game out of the other half, and a dateless one out of both", () => {
    expect(inSegment("2026-09-17", 2027, "fall")).toBe(true);
    expect(inSegment("2026-09-17", 2027, "spring")).toBe(false);
    // In the year, in neither half: it can inform a whole-year table and no board.
    expect(inSegment(undefined, 2027, "fall")).toBe(false);
    expect(inSegment(undefined, 2027, "spring")).toBe(false);
    expect(inSegment(undefined, 2027, undefined)).toBe(true);
  });

  it("reads a day as the half of the year it is actually in", () => {
    // August starts a new baseball year, so today is the autumn of 2027.
    expect(segmentOn("2026-09-17")).toEqual({ year: 2027, segment: "fall" });
    expect(segmentOn("2026-08-01")).toEqual({ year: 2027, segment: "fall" });
    expect(segmentOn("2026-07-31")).toEqual({ year: 2026, segment: "spring" });
    expect(segmentOn("2027-03-04")).toEqual({ year: 2027, segment: "spring" });
  });

  /*
   * Fall and Spring are one season, referred to by its spring. So the season before *either* half
   * of 2027 is Spring 2026 — not Fall 2026, which is the same season.
   */
  it("says the previous season is the spring before, for either half", () => {
    expect(previousSeason(2027)).toEqual({ year: 2026, segment: "spring" });
    expect(segmentLabel(previousSeason(2027).year, previousSeason(2027).segment)).toBe(
      "Spring 2026"
    );
    // Not the half before this one, which would be Fall 2026 and is the same season.
    expect(segmentLabel(2027, "fall")).not.toBe("Spring 2026");
  });
});

/*
 * Fitted, not filtered. A Fall table built by fitting the whole year and then hiding the spring
 * rows would have read the spring before saying who was best in the autumn — every autumn rating
 * would carry information from games that had not been played.
 */
describe("ranking one half of a year", () => {
  const pool: AgeGroup[] = [{ id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }];
  const teams: ScoutTeam[] = [
    { id: "T-A", name: "Aces", state: "KY" },
    { id: "T-B", name: "Badgers", state: "KY" },
    { id: "T-C", name: "Cougars", state: "OH" },
    // Plays in the spring only, which is the common case: most clubs play one half, not both.
    { id: "T-SPRING", name: "Springers", state: "TN" },
  ];
  const at = (
    id: string,
    a: string,
    b: string,
    sa: number,
    sb: number,
    date: string
  ): ScoutGame => ({
    id,
    ageGroupId: "u9",
    teamAId: a,
    teamBId: b,
    teamAScore: sa,
    teamBScore: sb,
    date,
  });
  const games: ScoutGame[] = [
    // Autumn: A beats B and C comfortably.
    at("f1", "T-A", "T-B", 9, 1, "2026-09-12"),
    at("f2", "T-A", "T-C", 8, 2, "2026-10-03"),
    at("f3", "T-B", "T-C", 5, 4, "2026-11-07"),
    // Spring: A is beaten twice, and a club that was not there in the autumn wins everything.
    at("s1", "T-SPRING", "T-A", 7, 2, "2027-03-06"),
    at("s2", "T-SPRING", "T-B", 8, 1, "2027-04-10"),
    at("s3", "T-C", "T-A", 6, 3, "2027-05-15"),
  ];

  it("reads only that half's games", () => {
    expect(scoutRatingGames("u9", teams, games, pool, "fall").map(({ game }) => game.id)).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
    expect(scoutRatingGames("u9", teams, games, pool, "spring").map(({ game }) => game.id)).toEqual(
      ["s1", "s2", "s3"]
    );
    // No half named: the whole year, exactly as before.
    expect(scoutRatingGames("u9", teams, games, pool)).toHaveLength(6);
  });

  it("gives each half its own records, not the year's", () => {
    const fall = buildTeamRankings("u9", teams, games, undefined, pool, "fall");
    const spring = buildTeamRankings("u9", teams, games, undefined, pool, "spring");

    expect(fall.find((row) => row.teamId === "T-A")!.record).toBe("2-0");
    expect(spring.find((row) => row.teamId === "T-A")!.record).toBe("0-2");
    // The whole year would say 2-2, which is neither half's answer.
    const year = buildTeamRankings("u9", teams, games, undefined, pool);
    expect(year.find((row) => row.teamId === "T-A")!.record).toBe("2-2");
  });

  it("leaves a club out of a half it did not play in", () => {
    const fall = buildTeamRankings("u9", teams, games, undefined, pool, "fall");
    const spring = buildTeamRankings("u9", teams, games, undefined, pool, "spring");

    expect(fall.map((row) => row.teamId)).not.toContain("T-SPRING");
    expect(spring.map((row) => row.teamId)).toContain("T-SPRING");
  });

  it("does not let the spring decide the autumn", () => {
    const fall = buildTeamRankings("u9", teams, games, undefined, pool, "fall");
    // A won both its autumn games by seven and six; nothing that happened in March can move that.
    expect(fall[0]!.teamId).toBe("T-A");

    // And the autumn rating is the same whether or not the spring has been played yet, which is
    // the property "fitted, not filtered" exists for.
    const autumnOnly = buildTeamRankings(
      "u9",
      teams,
      games.filter((game) => game.id.startsWith("f")),
      undefined,
      pool,
      "fall"
    );
    expect(fall.map((row) => row.teamId)).toEqual(autumnOnly.map((row) => row.teamId));
    fall.forEach((row, index) => {
      expect(row.rating).toBeCloseTo(autumnOnly[index]!.rating, 9);
      expect(row.pointRating).toBeCloseTo(autumnOnly[index]!.pointRating, 9);
    });
  });

  it("keeps a club on the same page in both halves", () => {
    // A club's age level is a fact about the club for the season, so it is not re-derived per half:
    // a 9U club must not move to the 10U board in the spring because of which games fell where.
    const fall = buildTeamRankings("u9", teams, games, undefined, pool, "fall");
    const spring = buildTeamRankings("u9", teams, games, undefined, pool, "spring");
    expect(fall.find((row) => row.teamId === "T-A")!.ageLevel).toBe(9);
    expect(spring.find((row) => row.teamId === "T-A")!.ageLevel).toBe(9);
  });

  it("is empty for a half with nothing in it", () => {
    const autumnOnly = games.filter((game) => game.id.startsWith("f"));
    expect(buildTeamRankings("u9", teams, autumnOnly, undefined, pool, "spring")).toEqual([]);
  });
});
