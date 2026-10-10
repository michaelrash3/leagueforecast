import { describe, expect, it } from "vitest";
import { likelySeeds } from "../seedRange";

/* The finishes a team lands in eight simulated seasons in ten (2.10). */

describe("likelySeeds", () => {
  it("is one seed for a team that always finishes there", () => {
    expect(likelySeeds([0, 100, 0, 0])).toEqual({ best: 2, worst: 2 });
  });

  it("leaves out the best and worst tenth of seasons", () => {
    // 5% first, 45% second, 40% third, 10% fourth: eight in ten finish second or third.
    expect(likelySeeds([5, 45, 40, 10])).toEqual({ best: 2, worst: 3 });
    // A tenth exactly at either end is the tail left out.
    expect(likelySeeds([10, 40, 40, 10])).toEqual({ best: 2, worst: 3 });
    // Spread evenly over five seeds, a fifth each: the best tenth is still first, the worst fifth.
    expect(likelySeeds([20, 20, 20, 20, 20])).toEqual({ best: 1, worst: 5 });
  });

  it("reads shares that do not add to a hundred as the shares they are", () => {
    expect(likelySeeds([1, 9, 8, 2])).toEqual({ best: 2, worst: 3 });
  });

  it("says nothing of a team the simulation placed nowhere", () => {
    expect(likelySeeds([])).toBeNull();
    expect(likelySeeds([0, 0, 0])).toBeNull();
  });
});
