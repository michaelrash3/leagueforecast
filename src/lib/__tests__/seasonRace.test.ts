import { describe, expect, it } from "vitest";
import { seasonRace } from "../seasonRace";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];
const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("seasonRace", () => {
  it("places every team after each game day, in the season's own order", () => {
    // A fall season into January: December's day comes before January's.
    const games: Matchup[] = [
      { id: "g2", date: "1/10", away: "C", home: "A" },
      { id: "g1", date: "12/5", away: "B", home: "C" },
      { id: "g3", date: "1/20", away: "A", home: "B" },
    ];
    const race = seasonRace(
      teams,
      games,
      { g1: final("6", "1"), g2: final("4", "3") },
      DEFAULT_SETTINGS
    );

    expect(race.dates).toEqual(["12/5", "1/10"]);
    // 12/5: the Bears beat the Comets. 1/10: the Comets beat the Aces.
    expect(race.places.B?.[0]).toBe(1);
    expect(race.places.C?.[0]).toBe(3);
    expect(race.places.A?.[1]).toBe(3);
  });

  it("takes a day's games together, and leaves out a final with no date", () => {
    const games: Matchup[] = [
      { id: "g1", date: "5/1", away: "A", home: "B" },
      { id: "g2", date: "5/1", away: "A", home: "C" },
      { id: "g3", date: "", away: "B", home: "C" },
    ];
    const race = seasonRace(
      teams,
      games,
      { g1: final("5", "2"), g2: final("5", "2"), g3: final("5", "2") },
      DEFAULT_SETTINGS
    );

    expect(race.dates).toEqual(["5/1"]);
    expect(race.places.A).toEqual([1]);
  });
});
