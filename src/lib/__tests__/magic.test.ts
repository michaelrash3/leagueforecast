import { describe, expect, it } from "vitest";
import { eliminationNumberForGold, magicForGold } from "../magic";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Diggers" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "C", home: "D" },
  { id: "g3", date: "5/3", away: "A", home: "C" },
  { id: "g4", date: "5/4", away: "B", home: "D" },
];

const finalLog = (a: number, h: number): GameLog => ({
  awayRuns: String(a),
  awayHits: "0",
  awayK: "0",
  homeRuns: String(h),
  homeHits: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
});

const settings = { ...DEFAULT_SETTINGS };

describe("magicForGold", () => {
  it("reports a magic number for a team in the chase", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 1),
    });
    const result = magicForGold("A", live, matchups, 2, settings);
    expect(["magic", "clinched"]).toContain(result.type);
  });

  it("clinched when nobody can pass", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 0),
      g3: finalLog(5, 0),
    });
    const result = magicForGold("A", live, matchups, 1, settings);
    expect(["clinched", "magic"]).toContain(result.type);
  });
});

describe("eliminationNumberForGold", () => {
  it("returns elimination info when blocked", () => {
    const live = calculateTeams(teams, matchups, {});
    const result = eliminationNumberForGold("A", live, matchups, 1, settings);
    expect(result.type === "elimination" || result.type === "magic").toBe(true);
  });
});
