import { describe, expect, it } from "vitest";
import { buildSeasonTimeline } from "../seasonTimeline";
import { calculateTeams, rankOptionsFromSettings, rankTeams } from "../sim";
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

  it("counts the games a season owes but has not scheduled, as the table does", () => {
    const logs = { g1: finalLog(5, 2), g2: finalLog(1, 3) };
    const line = (gamesPerTeam: number) =>
      buildSeasonTimeline(
        teams,
        matchups,
        logs,
        { ...DEFAULT_SETTINGS, goldCutoff: 1, regularSeasonGamesPerTeam: gamesPerTeam },
        2
      )[0]?.cutLineImpact;

    // Both scheduled games played, Aces 2-0: with nothing owed, the top spot is theirs.
    expect(line(0)).toContain("Aces clinched Gold");
    // Four games each, two still owed: the Bears and the Comets can each still reach three wins.
    expect(line(4)).not.toContain("clinched");
  });
});

describe("the timeline's places", () => {
  it("rank under the league's own run-differential cap, as the table does", () => {
    // Two clubs that never met, each one win over the third: by 20 runs and by 6. Capped at 5 they
    // are level on run differential and the Bears, who allowed none, go first; at 35 runs, the
    // cap the timeline used with no settings, the Aces did.
    const games: Matchup[] = [
      { id: "g1", date: "2026-05-01", away: "A", home: "C" },
      { id: "g2", date: "2026-05-02", away: "B", home: "C" },
    ];
    const logs = { g1: finalLog(22, 2), g2: finalLog(6, 0) };
    const settings = { ...DEFAULT_SETTINGS, maxRunDifferential: 5, autoRunDiffCap: false };
    const table = rankTeams(
      calculateTeams(teams, games, logs, settings),
      rankOptionsFromSettings(settings)
    );
    expect(table.map((team) => team.id)).toEqual(["B", "A", "C"]);
    const entries = buildSeasonTimeline(teams, games, logs, settings, 5);
    expect(entries.find((entry) => entry.id === "g2")?.movement).toEqual(["Bears climbed #2 → #1"]);
  });
});
