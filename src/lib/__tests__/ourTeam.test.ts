import { beforeEach, describe, expect, it, vi } from "vitest";
import { ourTeamSummary } from "../ourTeam";
import { readOurTeam, writeOurTeam } from "../preferences";
import type { SwingGame, TeamWithProjection } from "../types";

const team = (extra: Partial<TeamWithProjection> = {}) =>
  ({
    id: "T1",
    name: "Trash Pandas",
    rank: 2,
    w: 7,
    l: 2,
    t: 1,
    goldPct: 81.4,
    goldTrend: [60, 70.2, 81.4],
    ...extra,
  }) as TeamWithProjection;

const swing: SwingGame = {
  game: { id: "g9", date: "5/2", away: "T1", home: "T4" },
  opponentName: "Bears",
  teamIsAway: true,
  winSeed: 1,
  lossSeed: 3,
  modelPick: "Trash Pandas",
  winPct: 0.58,
};

describe("the Dashboard's line about the team this browser follows", () => {
  it("gives its place, record, Gold % and the last result's move, its next game and the magic", () => {
    expect(
      ourTeamSummary(team(), 8, { hasCutLine: true, swings: [swing], magic: "Magic number 2." })
    ).toEqual({
      teamId: "T1",
      name: "Trash Pandas",
      place: 2,
      of: 8,
      record: "7-2-1",
      goldPct: 81.4,
      goldChange: expect.closeTo(11.2, 9),
      next: {
        opponentName: "Bears",
        date: "5/2",
        teamIsAway: true,
        winPct: 0.58,
        winSeed: 1,
        lossSeed: 3,
      },
      magic: "Magic number 2.",
    });
  });

  it("says nothing about Gold in a league with no cut line", () => {
    const summary = ourTeamSummary(team(), 8, { hasCutLine: false, swings: [], magic: "x" });
    expect(summary).not.toHaveProperty("goldPct");
    expect(summary).not.toHaveProperty("goldChange");
    expect(summary).not.toHaveProperty("magic");
    expect(summary).not.toHaveProperty("next");
  });

  it("has no move to report before the trend has two points", () => {
    expect(
      ourTeamSummary(team({ goldTrend: [81.4] }), 8, { hasCutLine: true, swings: [] })
    ).not.toHaveProperty("goldChange");
  });

  it("is nothing without a team", () => {
    expect(ourTeamSummary(undefined, 8, { hasCutLine: true, swings: [] })).toBeNull();
  });
});

describe("the team this browser follows, stored", () => {
  const backing = new Map<string, string>();
  beforeEach(() => {
    backing.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    });
  });

  it("is kept per season, and cleared for one without touching another", () => {
    writeOurTeam("spring", "T1");
    writeOurTeam("fall", "T7");
    expect(readOurTeam("spring")).toBe("T1");
    expect(readOurTeam("fall")).toBe("T7");
    writeOurTeam("spring", null);
    expect(readOurTeam("spring")).toBeNull();
    expect(readOurTeam("fall")).toBe("T7");
  });

  it("reads nothing from a value it cannot read", () => {
    backing.set("lf_our_team_v1", "{oops");
    expect(readOurTeam("spring")).toBeNull();
    backing.set("lf_our_team_v1", JSON.stringify({ spring: 4 }));
    expect(readOurTeam("spring")).toBeNull();
  });
});
