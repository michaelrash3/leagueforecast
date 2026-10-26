import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgeGroupId,
  newPageId,
  pageIdFor,
  seasonAtAge,
  type AgeGroup,
} from "../teamRankings";

/*
 * The id a page is made under (`teamRankings/seasons.ts`): its age and year, `ag_9u_2027`, the
 * owner's choice of 26 October 2026 over ids that say when a page was made, two of which matched
 * once in a thousand when made in one millisecond.
 */

afterEach(() => vi.restoreAllMocks());

const page = (id: string, ageLevel: number, year: number): AgeGroup => ({
  id,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
});

describe("a page's id", () => {
  it("is its age and year", () => {
    expect(pageIdFor(9, 2027)).toBe("ag_9u_2027");
    expect(pageIdFor(14, 2028)).toBe("ag_14u_2028");
  });

  it("is the fallback only where a page of another age or year already has it", () => {
    expect(newPageId(9, 2027, [], "fallback")).toBe("ag_9u_2027");
    expect(newPageId(9, 2027, [page("ag_9u_2027", 9, 2027)], "fallback")).toBe("ag_9u_2027");
    expect(newPageId(9, 2027, [page("ag_9u_2027", 10, 2027)], "fallback")).toBe("fallback");
    expect(newPageId(9, 2027, [page("ag_9u_2027", 9, 2028)], "fallback")).toBe("fallback");
  });

  it("minted without an age is another every time, in one millisecond with one random number", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const ids = Array.from({ length: 3 }, () => createAgeGroupId());
    expect(new Set(ids).size).toBe(3);
  });

  it("is what a league season's new page is made under, whatever id the command carried", () => {
    const made = seasonAtAge("s1", { ageLevel: 9, year: 2027 }, [page("ag_x", 10, 2027)], "ag_x2");
    expect(made.created).toBe(true);
    expect(made.group?.id).toBe("ag_9u_2027");
    // Where a page of another age holds that id, the command's.
    const held = seasonAtAge(
      "s1",
      { ageLevel: 9, year: 2027 },
      [page("ag_9u_2027", 10, 2027)],
      "ag_x2"
    );
    expect(held.group?.id).toBe("ag_x2");
  });
});
