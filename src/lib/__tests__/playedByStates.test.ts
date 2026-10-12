import { describe, expect, it } from "vitest";
import { statesThatPlayed } from "../playedByStates";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

const game = (id: string, a: string, b: string) =>
  ({ id, ageGroupId: "ag", teamAId: a, teamBId: b }) as ScoutGame;

describe("where the clubs that played a club with no state are from", () => {
  const teams: ScoutTeam[] = [
    { id: "S-HUR", name: "Hurricanes", city: "Wilmington" },
    { id: "S-STIX", name: "Cincy Stix", state: "OH" },
    { id: "S-OTT", name: "Otters", state: "OH" },
    { id: "S-KY", name: "Hebron Hawks", state: "KY" },
    { id: "S-IN", name: "Lawrenceburg", state: "IN" },
    { id: "S-TN", name: "Nashville", state: "TN" },
  ];

  it("names their states, most games first then alphabetically, and no more than three", () => {
    const games = [
      game("g1", "S-STIX", "S-HUR"),
      game("g2", "S-HUR", "S-OTT"),
      game("g3", "S-KY", "S-HUR"),
      game("g4", "S-HUR", "S-IN"),
      game("g5", "S-TN", "S-HUR"),
      game("g6", "S-KY", "S-HUR"),
    ];
    expect(statesThatPlayed(teams, games).get("S-HUR")).toEqual(["KY", "OH", "IN"]);
  });

  it("says nothing about a club that has a state of its own", () => {
    expect(statesThatPlayed(teams, [game("g1", "S-STIX", "S-OTT")]).has("S-STIX")).toBe(false);
  });
});
