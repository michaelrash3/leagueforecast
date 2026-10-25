import { describe, expect, it } from "vitest";
import { seasonFinalOf } from "../seasonFinal";

const standings = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Cubs" },
];
const crowned = (id: string | null, source: string) => ({
  team: id ? (standings.find((team) => team.id === id) ?? null) : null,
  source,
});
const over = { standings, remaining: 0, scheduled: 9, hasPostseason: true };

describe("seasonFinalOf", () => {
  it("is null while a regular-season game or the bracket final is still to play", () => {
    expect(seasonFinalOf({ ...over, remaining: 1, champion: crowned("B", "actual") })).toBeNull();
    expect(seasonFinalOf({ ...over, champion: crowned("A", "projected") })).toBeNull();
    expect(seasonFinalOf({ ...over, scheduled: 0, champion: crowned("A", "actual") })).toBeNull();
  });

  it("names the regular season's winner, the champion and the followed team's finish", () => {
    expect(seasonFinalOf({ ...over, champion: crowned("B", "actual"), ourTeamId: "B" })).toEqual({
      leader: "Aces",
      champion: "Bears",
      ourTeam: "Bears finished 2 of 3, and won it all.",
    });
  });

  it("ends with the regular season where there is no postseason", () => {
    expect(
      seasonFinalOf({
        ...over,
        hasPostseason: false,
        champion: crowned(null, "none"),
        ourTeamId: "C",
      })
    ).toEqual({ leader: "Aces", ourTeam: "Cubs finished 3 of 3." });
  });

  it("names a Silver champion only once its final is played", () => {
    const final = seasonFinalOf({
      ...over,
      champion: crowned("A", "actual"),
      silverChampion: crowned("C", "projected"),
    });
    expect(final?.silverChampion).toBeUndefined();
  });
});
