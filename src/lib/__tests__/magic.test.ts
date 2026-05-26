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
  it("returns impossible when no guarantees can be made", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 1),
    });
    const result = magicForGold("A", live, matchups, 2, settings);
    expect(result.type).toBe("impossible");
  });

  it("clinched when nobody can pass", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 0),
      g3: finalLog(5, 0),
    });
    const result = magicForGold("A", live, matchups, 1, settings);
    expect(result.type).toBe("clinched");
  });

  it("uses deterministic team-id ordering in tie-heavy schedules", () => {
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const noGamesLeft: Matchup[] = [];

    const live = calculateTeams(tinyTeams, noGamesLeft, {});
    const aResult = magicForGold("A", live, noGamesLeft, 1, settings);
    const cResult = magicForGold("C", live, noGamesLeft, 1, settings);

    expect(aResult.type).toBe("clinched");
    expect(cResult.type).toBe("impossible");
  });

  it("supports edge cutoff values of 1 and n-1 in symmetric schedules", () => {
    const symmetricTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
      { id: "D", name: "D" },
    ];
    const symmetricMatchups: Matchup[] = [
      { id: "s1", date: "5/1", away: "A", home: "B" },
      { id: "s2", date: "5/2", away: "A", home: "C" },
      { id: "s3", date: "5/3", away: "A", home: "D" },
      { id: "s4", date: "5/4", away: "B", home: "C" },
      { id: "s5", date: "5/5", away: "B", home: "D" },
      { id: "s6", date: "5/6", away: "C", home: "D" },
    ];

    const live = calculateTeams(symmetricTeams, symmetricMatchups, {});
    expect(magicForGold("A", live, symmetricMatchups, 1, settings).type).toBe("impossible");
    expect(magicForGold("A", live, symmetricMatchups, symmetricTeams.length - 1, settings).type).toBe("impossible");
  });

  it("returns impossible for mathematically impossible clinch cases", () => {
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const noGamesLeft: Matchup[] = [];
    const live = calculateTeams(tinyTeams, noGamesLeft, {});

    expect(magicForGold("A", live, noGamesLeft, 1, settings).type).toBe("clinched");
    expect(magicForGold("C", live, noGamesLeft, 1, settings).type).toBe("impossible");
  });
});

describe("eliminationNumberForGold", () => {
  it("returns elimination info when blocked", () => {
    const live = calculateTeams(teams, matchups, {});
    const result = eliminationNumberForGold("A", live, matchups, 1, settings);
    expect(result.type === "elimination" || result.type === "magic").toBe(true);
  });

  it("considers ties as legal outcomes when tiePoints > 0", () => {
    const live = calculateTeams(teams, matchups, {});
    const tieSettings = { ...settings, tiePoints: 0.5 };
    const result = eliminationNumberForGold("A", live, matchups, 2, tieSettings);
    expect(["magic", "elimination"]).toContain(result.type);
  });
});
