import { describe, expect, it } from "vitest";
import {
  buildProjectionSnapshot,
  diffProjectionSnapshots,
  diffProjectionTeam,
  type ProjectionTeamSnapshot,
} from "../projectionDelta";
import type { GameLog, Matchup, Settings, Team } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const team = (overrides: Partial<Team> & Pick<Team, "id">): Team => ({
  id: overrides.id,
  name: overrides.name ?? overrides.id,
  w: overrides.w ?? 0,
  l: overrides.l ?? 0,
  t: overrides.t ?? 0,
  rs: overrides.rs ?? 0,
  ra: overrides.ra ?? 0,
  games: overrides.games ?? 0,
  pct: overrides.pct ?? 0,
  runDiff: overrides.runDiff ?? 0,
  rsg: overrides.rsg ?? 0,
  rag: overrides.rag ?? 0,
  hpg: overrides.hpg ?? 0,
  kpg: overrides.kpg ?? 0,
  tpi: overrides.tpi ?? 0,
  baseTpi: overrides.baseTpi ?? 0,
  sos: overrides.sos ?? 0,
  momentum: overrides.momentum ?? 0,
  awayK6: overrides.awayK6 ?? null,
  homeK6: overrides.homeK6 ?? null,
  totalK6: overrides.totalK6 ?? null,
  machineDifficulty: overrides.machineDifficulty ?? 0,
  rank: overrides.rank,
});

const snapshotTeam = (overrides: Partial<ProjectionTeamSnapshot> = {}): ProjectionTeamSnapshot => ({
  teamId: "A",
  rank: 3,
  goldOdds: 35,
  projectedPoints: 6,
  standingsPoints: 4,
  tiebreakers: { runDifferential: 2, runsFor: 40, runsAgainst: 38 },
  ...overrides,
});

const settings: Settings = { ...DEFAULT_SETTINGS, winPoints: 2, tiePoints: 1 };

describe("diffProjectionTeam", () => {
  it("captures rank movement up and down", () => {
    const improved = diffProjectionTeam(snapshotTeam({ rank: 4 }), snapshotTeam({ rank: 2 }));
    const declined = diffProjectionTeam(snapshotTeam({ rank: 2 }), snapshotTeam({ rank: 5 }));

    expect(improved.status).toBe("changed");
    expect(improved.changes).toContainEqual({
      field: "rank",
      reason: "projection-change",
      before: 4,
      after: 2,
      delta: -2,
    });
    expect(declined.changes).toContainEqual({
      field: "rank",
      reason: "projection-change",
      before: 2,
      after: 5,
      delta: 3,
    });
  });

  it("captures Gold odds movement up and down with the odds reason", () => {
    const improved = diffProjectionTeam(
      snapshotTeam({ goldOdds: 20 }),
      snapshotTeam({ goldOdds: 45 })
    );
    const declined = diffProjectionTeam(
      snapshotTeam({ goldOdds: 45 }),
      snapshotTeam({ goldOdds: 20 })
    );

    expect(improved.changes).toContainEqual({
      field: "goldOdds",
      reason: "odds-change",
      before: 20,
      after: 45,
      delta: 25,
    });
    expect(improved.reasons).toEqual(["odds-change"]);
    expect(declined.changes).toContainEqual({
      field: "goldOdds",
      reason: "odds-change",
      before: 45,
      after: 20,
      delta: -25,
    });
  });

  it("captures projected points movement up and down", () => {
    const improved = diffProjectionTeam(
      snapshotTeam({ projectedPoints: 7 }),
      snapshotTeam({ projectedPoints: 8 })
    );
    const declined = diffProjectionTeam(
      snapshotTeam({ projectedPoints: 8 }),
      snapshotTeam({ projectedPoints: 6.5 })
    );

    expect(improved.changes).toContainEqual({
      field: "projectedPoints",
      reason: "projection-change",
      before: 7,
      after: 8,
      delta: 1,
    });
    expect(declined.changes).toContainEqual({
      field: "projectedPoints",
      reason: "projection-change",
      before: 8,
      after: 6.5,
      delta: -1.5,
    });
  });

  it("captures standings points movement up and down with the result reason", () => {
    const improved = diffProjectionTeam(
      snapshotTeam({ standingsPoints: 4 }),
      snapshotTeam({ standingsPoints: 5 })
    );
    const declined = diffProjectionTeam(
      snapshotTeam({ standingsPoints: 5 }),
      snapshotTeam({ standingsPoints: 3.5 })
    );

    expect(improved.changes).toContainEqual({
      field: "standingsPoints",
      reason: "result-change",
      before: 4,
      after: 5,
      delta: 1,
    });
    expect(declined.changes).toContainEqual({
      field: "standingsPoints",
      reason: "result-change",
      before: 5,
      after: 3.5,
      delta: -1.5,
    });
  });

  it("reports no movement for identical team snapshots", () => {
    const before = snapshotTeam();
    const delta = diffProjectionTeam(before, { ...before, tiebreakers: { ...before.tiebreakers } });

    expect(delta.status).toBe("unchanged");
    expect(delta.changes).toEqual([]);
    expect(delta.reasons).toEqual([]);
  });

  it("preserves deterministic reason ordering for multiple field changes", () => {
    const delta = diffProjectionTeam(
      snapshotTeam({ rank: 5, goldOdds: 20, projectedPoints: 6, standingsPoints: 4 }),
      snapshotTeam({ rank: 3, goldOdds: 35, projectedPoints: 7, standingsPoints: 5 })
    );

    expect(delta.reasons).toEqual(["projection-change", "odds-change", "result-change"]);
    expect(delta.changes.map((change) => change.field)).toEqual([
      "rank",
      "goldOdds",
      "projectedPoints",
      "standingsPoints",
    ]);
  });

  it("tags rank movement as a tiebreak change when tiebreak stats also change", () => {
    const delta = diffProjectionTeam(
      snapshotTeam({ rank: 2, tiebreakers: { runDifferential: 1 } }),
      snapshotTeam({ rank: 1, tiebreakers: { runDifferential: 3 } })
    );

    expect(delta.reasons).toContain("tiebreak-change");
    expect(delta.changes.find((change) => change.field === "rank")?.reason).toBe("tiebreak-change");
  });
});

describe("buildProjectionSnapshot", () => {
  it("builds comparable snapshots from live and projected teams", () => {
    const teams = [
      { ...team({ id: "A", w: 2, t: 1, rs: 20, ra: 12, runDiff: 8, rank: 3 }), goldPct: 55 },
    ];
    const projectedTeams = [team({ id: "A", w: 4, t: 1, rs: 38, ra: 25, runDiff: 13, rank: 1 })];
    const matchups: Matchup[] = [{ id: "g1", date: "2026-05-01", away: "A", home: "B" }];
    const logs: Record<string, GameLog> = {
      g1: {
        awayRuns: "6",
        awayHits: "8",
        awayK: "3",
        homeRuns: "4",
        homeHits: "7",
        homeK: "2",
        innings: "6",
        isFinal: true,
      },
    };

    const snapshot = buildProjectionSnapshot({
      teams,
      projectedTeams,
      settings,
      matchups,
      logs,
      createdAt: "2026-05-28T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      createdAt: "2026-05-28T00:00:00.000Z",
      matchupCount: 1,
      logCount: 1,
      finalizedGameCount: 1,
      teams: [
        {
          teamId: "A",
          rank: 1,
          goldOdds: 55,
          projectedPoints: 9,
          standingsPoints: 5,
          tiebreakers: { runDifferential: 13, runsFor: 38, runsAgainst: 25 },
        },
      ],
    });
  });
});

describe("diffProjectionSnapshots", () => {
  it("supports teams added and removed between snapshots", () => {
    const before = {
      createdAt: "2026-05-27T00:00:00.000Z",
      teams: [snapshotTeam({ teamId: "A" }), snapshotTeam({ teamId: "B" })],
    };
    const after = {
      createdAt: "2026-05-28T00:00:00.000Z",
      teams: [snapshotTeam({ teamId: "A" }), snapshotTeam({ teamId: "C" })],
    };

    const delta = diffProjectionSnapshots(before, after);

    const removed = delta.teams.find((teamDelta) => teamDelta.teamId === "B");
    const added = delta.teams.find((teamDelta) => teamDelta.teamId === "C");

    expect(delta.teams.map((teamDelta) => teamDelta.teamId)).toEqual(["A", "B", "C"]);
    expect(removed?.status).toBe("removed");
    expect(removed?.changes).toEqual([
      { field: "team", reason: "projection-change", before: "B", after: null },
    ]);
    expect(added?.status).toBe("added");
    expect(added?.changes).toEqual([
      { field: "team", reason: "projection-change", before: null, after: "C" },
    ]);
  });

  it("tags settings, cutoff, schedule, and finalized game context deterministically", () => {
    const delta = diffProjectionSnapshots(
      {
        createdAt: "2026-05-27T00:00:00.000Z",
        settings: { winPoints: 1, goldCutoff: 4 },
        matchupCount: 8,
        logCount: 3,
        finalizedGameCount: 3,
        teams: [snapshotTeam()],
      },
      {
        createdAt: "2026-05-28T00:00:00.000Z",
        settings: { winPoints: 2, goldCutoff: 6 },
        matchupCount: 9,
        logCount: 4,
        finalizedGameCount: 4,
        teams: [snapshotTeam()],
      }
    );

    expect(delta.reasons).toEqual(["settings-change", "schedule-strength", "result-change"]);
  });
});
