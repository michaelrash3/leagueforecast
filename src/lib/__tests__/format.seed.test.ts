import { describe, expect, it } from "vitest";
import { pickAndChanceText, seedRangeText } from "../format";

/*
 * Two lines League Standings prints in several places, each written one way. A team with one place
 * left to finish in read "#4–#4", and a game on a team's own card read "Model: Southtown Sluggers
 * · 46% team win chance", where the 46% is the card's team's and not the team just named.
 * Placeholder teams.
 */
describe("the seeds a team can still finish in", () => {
  it("are a range from the best to the worst", () => {
    expect(seedRangeText({ best: 2, worst: 5 })).toBe("#2–#5");
  });

  it("are the one seed where the best and the worst are the same", () => {
    expect(seedRangeText({ best: 4, worst: 4 })).toBe("#4");
  });
});

describe("a game from one team's side", () => {
  it("names the model's pick and whose chance the figure is", () => {
    expect(pickAndChanceText("Sluggers", "Mashers", 0.456)).toBe(
      "Model pick: Sluggers · Mashers 46% to win"
    );
    // The team the model picks is named once.
    expect(pickAndChanceText("Rockets", "Rockets", 0.62)).toBe("Model pick: Rockets · 62% to win");
  });
});
