import { describe, expect, it } from "vitest";
import { pathSummary, recapToMarkdown, summarizeStandings, weeklyRecap, type InsightTeam } from "../insights";

const team = (overrides: Partial<InsightTeam>): InsightTeam => ({
  id: "X",
  name: "Stallions",
  w: 5,
  l: 2,
  t: 1,
  rs: 40,
  ra: 20,
  games: 8,
  pct: 0.6,
  runDiff: 20,
  rsg: 5,
  rag: 2.5,
  hpg: 8,
  kpg: 2,
  tpi: 3.2,
  baseTpi: 2.5,
  sos: 0.4,
  momentum: 0.5,
  awayK6: 4,
  homeK6: 4,
  totalK6: 4,
  machineDifficulty: 0,
  rank: 3,
  projectedRank: 3,
  goldPct: 80,
  goldStatus: "In",
  ...overrides,
});

describe("pathSummary", () => {
  it("special-cases Clinched", () => {
    const text = pathSummary(team({ goldStatus: "Clinched" }), 7, [], {
      totalTeams: 10,
      leaderName: "",
    });
    expect(text).toContain("clinched");
  });
  it("special-cases Eliminated", () => {
    const text = pathSummary(team({ goldStatus: "Eliminated" }), 7, [], {
      totalTeams: 10,
      leaderName: "",
    });
    expect(text.toLowerCase()).toContain("eliminated");
  });
  it("mentions current and projected seed for live teams", () => {
    const text = pathSummary(team({ goldStatus: "In", rank: 4, projectedRank: 3 }), 7, [], {
      totalTeams: 10,
      leaderName: "Griddy",
    });
    expect(text).toContain("#4");
    expect(text).toContain("#3");
  });
});

describe("weeklyRecap", () => {
  it("flags a clinch and a cut-line cross", () => {
    const items = weeklyRecap({
      before: [
        { id: "A", rank: 4, goldPct: 55, goldStatus: "In" },
        { id: "B", rank: 5, goldPct: 40, goldStatus: "Alive" },
      ],
      after: [
        { id: "A", rank: 4, goldPct: 85, goldStatus: "Clinched", name: "Aces" },
        { id: "B", rank: 6, goldPct: 25, goldStatus: "Alive", name: "Bears" },
      ],
      finalsSinceLast: [],
      cutoff: 5,
    });
    const text = items.map((i) => i.text).join(" | ");
    expect(text).toContain("clinched");
    expect(text).toContain("dropped below");
  });
});

describe("recapToMarkdown / summarizeStandings", () => {
  it("emits markdown header + bullets", () => {
    const md = recapToMarkdown("Spring 26", [{ kind: "clinched", text: "Aces clinched." }]);
    expect(md).toContain("# Spring 26 Recap");
    expect(md).toContain("- Aces clinched.");
  });
  it("standings summary marks inside-cutoff teams", () => {
    const text = summarizeStandings(
      "Spring 26",
      [
        { rank: 1, name: "Aces", w: 6, l: 1, t: 0, goldPct: 90 },
        { rank: 5, name: "Diggers", w: 3, l: 4, t: 0, goldPct: 20 },
      ],
      3
    );
    expect(text).toContain("★ #1 Aces");
    expect(text).toContain("  #5 Diggers");
  });
});
