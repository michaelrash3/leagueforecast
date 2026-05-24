import { describe, expect, it } from "vitest";
import {
  applyScenarioOverlay,
  countForcedGames,
  overlayHash,
  scenarioOddsInputs,
} from "../scenario";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "B", home: "C" },
  { id: "g3", date: "5/3", away: "A", home: "C" },
];

const empty: Record<string, GameLog> = {};
const settings = { ...DEFAULT_SETTINGS };

describe("applyScenarioOverlay", () => {
  it("uses model picks when overlay is empty", () => {
    const live = calculateTeams(teams, matchups, empty);
    const ranked = applyScenarioOverlay(live, matchups, {}, settings);
    expect(ranked.map((t) => t.id).sort()).toEqual(["A", "B", "C"]);
    expect(ranked.every((t) => typeof t.rank === "number")).toBe(true);
  });

  it("respects forced winners on standings", () => {
    const live = calculateTeams(teams, matchups, empty);
    const overlayAllA = applyScenarioOverlay(
      live,
      matchups,
      { g1: "away", g3: "away" },
      settings
    );
    const a = overlayAllA.find((team) => team.id === "A");
    expect(a?.w).toBeGreaterThanOrEqual(2);
  });
});

describe("scenarioOddsInputs", () => {
  it("removes forced games from the still-remaining list", () => {
    const live = calculateTeams(teams, matchups, empty);
    const { stillRemaining } = scenarioOddsInputs(live, matchups, { g1: "away" }, settings);
    expect(stillRemaining.map((g) => g.id)).toEqual(["g2", "g3"]);
  });
});

describe("overlayHash / countForcedGames", () => {
  it("counts only away/home forced choices", () => {
    expect(countForcedGames({ g1: "away", g2: "model", g3: "home" })).toBe(2);
  });
  it("is order-stable", () => {
    const a = overlayHash({ g1: "away", g2: "home" });
    const b = overlayHash({ g2: "home", g1: "away" });
    expect(a).toBe(b);
  });
});
