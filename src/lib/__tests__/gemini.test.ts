import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  describeError,
  hashBundle,
  type CompareBundle,
  type GameForecastBundle,
  type ImpactBundle,
  type TeamBundle,
} from "../gemini";

const teamBundle: TeamBundle = {
  surface: "team-summary",
  team: {
    name: "Stallions",
    rank: 3,
    projectedRank: 2,
    goldPct: 78,
    record: "6-2",
    runDiff: 12,
    rsg: 7.2,
    rag: 4.1,
    tpi: 3.1,
    goldStatus: "In",
    magicGold: "1 more win clinches a top-7 spot.",
    eliminationGold: "Cannot be eliminated from top-7 this season.",
  },
  cutoff: 7,
  totalTeams: 14,
  leaderName: "Trash Pandas",
  nextTwo: [
    { opp: "Griddy", home: true, winSeed: 2, lossSeed: 4, teamWinPct: 0.6 },
  ],
};

const impactBundle: ImpactBundle = {
  surface: "impact-recap",
  seasonLabel: "Spring 26",
  cutoff: 7,
  scores: ["Stallions 8, Griddy 4"],
  changes: ["Stallions moved up to #3", "Griddy dropped below the Gold cut line"],
};

const gameBundle: GameForecastBundle = {
  surface: "game-forecast",
  awayName: "Stallions",
  homeName: "Griddy",
  date: "5/9",
  pickName: "Stallions",
  pickPct: 0.66,
  spread: "Stallions -2.5",
  confidence: "Medium",
  upsetRisk: "Medium",
  edges: { scoring: 1.5, prevention: 0.4, tpi: 1.8, contact: 0.2 },
  impact: {
    awaySeedSwing: 2,
    homeSeedSwing: 1,
    awayGoldSwing: 12,
    homeGoldSwing: -8,
    impactLabel: "Medium",
  },
};

const compareBundle: CompareBundle = {
  surface: "compare",
  cutoff: 7,
  left: {
    name: "Stallions",
    rank: 3,
    projectedRank: 2,
    goldPct: 78,
    record: "6-2",
    rsg: 7.2,
    rag: 4.1,
    tpi: 3.1,
  },
  right: {
    name: "Griddy",
    rank: 6,
    projectedRank: 7,
    goldPct: 41,
    record: "5-3",
    rsg: 6.4,
    rag: 5.2,
    tpi: 1.1,
  },
  headToHead: { leftWins: 1, rightWins: 0, ties: 0 },
  commonOpponents: ["Trash Pandas", "Chaos"],
};

describe("buildPrompt", () => {
  it("includes the surface-specific task and embeds the bundle as JSON", () => {
    const prompt = buildPrompt(teamBundle);
    expect(prompt).toContain("Stallions");
    expect(prompt).toContain("2-3 sentences");
    expect(prompt).toContain('"surface": "team-summary"');
  });

  it("uses different task copy for each surface", () => {
    const taskLine = (prompt: string) => {
      const match = prompt.match(/Task: (.*?)\n\nFacts:/s);
      return match ? match[1] : "";
    };
    const team = taskLine(buildPrompt(teamBundle));
    const impact = taskLine(buildPrompt(impactBundle));
    const game = taskLine(buildPrompt(gameBundle));
    const compare = taskLine(buildPrompt(compareBundle));
    expect(new Set([team, impact, game, compare]).size).toBe(4);
  });
});

describe("hashBundle", () => {
  it("is stable across calls", () => {
    expect(hashBundle(teamBundle, "gemini-2.5-flash-lite")).toBe(
      hashBundle(teamBundle, "gemini-2.5-flash-lite")
    );
  });

  it("changes when the model changes", () => {
    expect(hashBundle(teamBundle, "gemini-2.5-flash-lite")).not.toBe(
      hashBundle(teamBundle, "gemini-2.5-flash")
    );
  });

  it("changes when the bundle changes", () => {
    const altered: TeamBundle = {
      ...teamBundle,
      team: { ...teamBundle.team, goldPct: 50 },
    };
    expect(hashBundle(teamBundle, "gemini-2.5-flash-lite")).not.toBe(
      hashBundle(altered, "gemini-2.5-flash-lite")
    );
  });
});

describe("describeError", () => {
  it("maps each error variant to a non-empty message", () => {
    expect(describeError({ kind: "missing-key" })).toMatch(/Settings/);
    expect(describeError({ kind: "auth" })).toMatch(/key/i);
    expect(describeError({ kind: "rate-limit" })).toMatch(/rate/i);
    expect(describeError({ kind: "network", message: "Failed to fetch" })).toContain(
      "Failed to fetch"
    );
    expect(describeError({ kind: "parse", message: "bad json" })).toContain("bad json");
  });
});
