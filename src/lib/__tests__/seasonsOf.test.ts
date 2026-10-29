import { describe, expect, it } from "vitest";
import { clubPickOption } from "../leagueLinkOptions";
import { seasonsOf } from "../teamRankings";

/*
 * One club name can be a fall team and a spring team at the same age; a picker's rows read the same
 * for both unless they say which season each is set up in. Placeholder names.
 */
const link = (teamId: string, season?: string, seasonYear?: number) => ({
  teamId,
  name: "Comets 9U",
  ageGroupId: "ag_9u_2027",
  ...(season ? { season } : {}),
  ...(seasonYear === undefined ? {} : { seasonYear }),
});

describe("the seasons a club is set up in", () => {
  it("names each GameChanger season once, oldest first", () => {
    expect(
      seasonsOf({
        gcTeams: [link("b", "spring", 2027), link("a", "fall", 2026), link("c", "Fall", 2026)],
      })
    ).toBe("Fall 2026, Spring 2027");
  });

  it("says nothing it does not know", () => {
    expect(seasonsOf({})).toBe("");
    expect(seasonsOf({ gcTeams: [link("a", "fall"), link("b", undefined, 2026)] })).toBe("");
  });

  it("is on the picker's row, after the place and age", () => {
    const option = clubPickOption({
      id: "c1",
      name: "Comets",
      city: "Town",
      state: "KY",
      ageLevel: 9,
      gcTeams: [link("a", "spring", 2027)],
    });
    expect(option.detail).toBe("Town, KY · 9U · Spring 2027");
  });
});
