import { describe, expect, it } from "vitest";
import { buildSeasonTimeline } from "../seasonTimeline";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "2026-05-01", away: "A", home: "B" },
  { id: "g2", date: "2026-05-02", away: "C", home: "A" },
];

const finalLog = (awayRuns: number, homeRuns: number): GameLog => ({
  awayRuns: String(awayRuns),
  awayHits: "8",
  awayK: "3",
  homeRuns: String(homeRuns),
  homeHits: "7",
  homeK: "4",
  innings: "6",
  isFinal: true,
});

describe("buildSeasonTimeline", () => {
  it("returns recent finals with winner, score, and cut-line copy", () => {
    const entries = buildSeasonTimeline(
      teams,
      matchups,
      { g1: finalLog(5, 2), g2: finalLog(1, 3) },
      { ...DEFAULT_SETTINGS, goldCutoff: 1 },
      2
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).toBe("g2");
    expect(entries[0]?.winnerName).toBe("Aces");
    expect(entries[0]?.score).toBe("1-3");
    expect(entries[0]?.cutLineImpact).toContain("Gold");
  });

  it("ignores non-final games", () => {
    const entries = buildSeasonTimeline(
      teams,
      matchups,
      { g1: finalLog(5, 2), g2: { ...finalLog(1, 3), isFinal: false } },
      DEFAULT_SETTINGS,
      5
    );

    expect(entries.map((entry) => entry.id)).toEqual(["g1"]);
  });
});
