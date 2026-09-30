import { describe, expect, it } from "vitest";
import {
  acquireRefreshLease,
  canAttemptRefresh,
  classifyGcChanges,
  coerceGcRefreshState,
  emptyGcRefreshState,
  MAX_REFRESH_RETRIES,
  nextRetryAt,
  recordRefreshFailure,
  recordRefreshSuccess,
  refreshIdempotencyKey,
  type GcGameSnapshot,
} from "../gameChangerRefresh";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const game = (overrides: Partial<GcGameSnapshot> = {}): GcGameSnapshot => ({
  id: "g1",
  date: "2026-10-01",
  awayId: "away",
  homeId: "home",
  final: false,
  ...overrides,
});

describe("GameChanger refresh change classification", () => {
  it.each([
    [[], [game()], "newly-scheduled"],
    [[], [game({ final: true, awayScore: 4, homeScore: 2 })], "new-final"],
    [[game()], [game({ final: true, awayScore: 4, homeScore: 2 })], "new-final"],
    [
      [game({ final: true, awayScore: 4, homeScore: 2 })],
      [game({ final: true, awayScore: 5, homeScore: 2 })],
      "corrected-final",
    ],
    [[game()], [game({ date: "2026-10-02" })], "rescheduled"],
    [[game()], [game({ awayId: "other" })], "opponent-change"],
    [[game()], [game({ canceled: true })], "removed-or-canceled"],
    [[game({ metadataRevision: "1" })], [game({ metadataRevision: "2" })], "metadata-only"],
    [[game()], [], "removed-or-canceled"],
  ] as const)("classifies a schedule delta", (before, after, kind) => {
    expect(classifyGcChanges(before, after)).toEqual([{ gameId: "g1", kind }]);
  });

  it("requires review when an import disagrees with a protected manual final", () => {
    const before = game({ protectedManualFinal: true, final: true, awayScore: 3, homeScore: 2 });
    expect(
      classifyGcChanges([before], [game({ final: true, awayScore: 4, homeScore: 2 })])
    ).toEqual([{ gameId: "g1", kind: "import-conflict" }]);
  });

  it("reports no change for an identical retried import", () => {
    expect(classifyGcChanges([game()], [game()])).toEqual([]);
  });
});

describe("refresh leases and idempotency", () => {
  it("allows only one overlapping owner until the lease expires", () => {
    const first = acquireRefreshLease(emptyGcRefreshState(), "team-1", "worker-a", NOW, 1_000)!;
    expect(acquireRefreshLease(first, "team-1", "worker-b", NOW, 1_000)).toBeNull();
    expect(
      acquireRefreshLease(first, "team-1", "worker-b", new Date(NOW.getTime() + 1_001), 1_000)
    ).not.toBeNull();
  });

  it("ignores a stale owner's result", () => {
    const leased = acquireRefreshLease(emptyGcRefreshState(), "team-1", "current", NOW)!;
    expect(recordRefreshSuccess(leased, "team-1", "stale", NOW, "r1", [])).toBe(leased);
  });

  it("uses a stable, unambiguous key across retries", () => {
    expect(refreshIdempotencyKey("team/a", "revision 1")).toBe("team%2Fa@revision%201");
  });
});

describe("bounded refresh backoff", () => {
  it("backs off exponentially and stops after the retry budget", () => {
    expect(nextRetryAt(NOW, 1)).toBe("2026-09-30T12:01:00.000Z");
    expect(nextRetryAt(NOW, 5)).toBe("2026-09-30T12:16:00.000Z");
    expect(nextRetryAt(NOW, MAX_REFRESH_RETRIES + 1)).toBeUndefined();
  });

  it("does not retry a known-invalid source", () => {
    const leased = acquireRefreshLease(emptyGcRefreshState(), "bad", "worker", NOW)!;
    const failed = recordRefreshFailure(leased, "bad", "worker", NOW, "invalid-source", "bad id");
    expect(canAttemptRefresh(failed.sources.bad!, new Date(NOW.getTime() + 86_400_000))).toBe(
      false
    );
    expect(failed.sources.bad?.nextEligibleAt).toBeUndefined();
  });

  it("clears failure and backoff after success", () => {
    const leased = acquireRefreshLease(emptyGcRefreshState(), "team-1", "worker", NOW)!;
    const failed = recordRefreshFailure(leased, "team-1", "worker", NOW, "network", "offline");
    const retry = acquireRefreshLease(
      failed,
      "team-1",
      "worker-2",
      new Date("2026-09-30T12:01:01.000Z")
    )!;
    const success = recordRefreshSuccess(retry, "team-1", "worker-2", NOW, "revision-2", []);
    expect(success.sources["team-1"]).toMatchObject({
      sourceRevision: "revision-2",
      consecutiveFailures: 0,
    });
    expect(success.sources["team-1"]?.failure).toBeUndefined();
  });
});

describe("stored refresh state", () => {
  it("round-trips the current version and rejects unknown versions", () => {
    const leased = acquireRefreshLease(emptyGcRefreshState(), "team-1", "worker", NOW)!;
    const success = recordRefreshSuccess(leased, "team-1", "worker", NOW, "r1", [
      { gameId: "g1", kind: "new-final" },
    ]);
    expect(coerceGcRefreshState(JSON.parse(JSON.stringify(success)))).toMatchObject(success);
    expect(coerceGcRefreshState({ ...success, version: 99 })).toEqual(emptyGcRefreshState());
  });
});
