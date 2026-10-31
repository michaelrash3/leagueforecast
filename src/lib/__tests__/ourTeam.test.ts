import { beforeEach, describe, expect, it, vi } from "vitest";
import { needsLines, ourTeamSummary, rootForLines } from "../ourTeam";
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

  /*
   * A move under two points is as likely the simulation's own as the result's: on synthetic
   * leagues, with the last two points paired, the card's step still came 0.57 to 0.75 points from
   * a long run's, and every move it showed the wrong way was under two.
   */
  it("leaves out a move of less than two points", () => {
    const moved = (last: number) =>
      ourTeamSummary(team({ goldTrend: [60, 70.2, last] }), 8, { hasCutLine: true, swings: [] });
    expect(moved(72.1)).not.toHaveProperty("goldChange");
    expect(moved(68.3)).not.toHaveProperty("goldChange");
    expect(moved(72.2)?.goldChange).toBeCloseTo(2, 9);
    expect(moved(68.2)?.goldChange).toBeCloseTo(-2, 9);
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

describe("needsLines", () => {
  const names: Record<string, string> = { A: "Aces", B: "Bears", C: "Comets" };
  const nameOf = (id: string) => names[id] ?? id;

  it("says the team's own games as what it must do, and others' as what it needs", () => {
    expect(
      needsLines(
        "A",
        [
          { gameId: "g1", date: "5/3", side: "A", against: "B", orTie: true },
          { gameId: "g2", date: "5/4", side: "A", against: "C", orTie: false },
          { gameId: "g3", date: "", side: "C", against: "B", orTie: false },
          { gameId: "g4", date: "5/6", side: "B", against: "C", orTie: true },
        ],
        nameOf
      )
    ).toEqual([
      "Don't lose to Bears (5/3)",
      "Beat Comets (5/4)",
      "Comets to beat Bears",
      "Bears not to lose to Comets (5/6)",
    ]);
  });
});

describe("rootForLines", () => {
  it("says who over whom, when, and what each result does to the Gold chance", () => {
    expect(
      rootForLines(
        [{ gameId: "g2", date: "5/2", winnerId: "C", loserId: "B", ifWin: 0.8, ifLoss: 0.204 }],
        (id) => ({ B: "Bears", C: "Comets" })[id] ?? id
      )
    ).toEqual(["Comets over Bears (5/2): Gold 80% against 20%"]);
  });
});
