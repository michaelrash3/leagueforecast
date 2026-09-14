import { describe, expect, it } from "vitest";
import {
  coercePullProgress,
  describePull,
  isPullComplete,
  pullView,
  remainingIds,
  retryFailures,
  retryableIds,
  settleTeam,
  startPull,
  type GcPullProgress,
} from "../gameChangerPull";

const NOW = "2026-09-14T12:00:00.000Z";
const LATER = "2026-09-14T12:30:00.000Z";

const ids = ["gcAAAAAAAAAA", "gcBBBBBBBBBB", "gcCCCCCCCCCC"];

describe("startPull", () => {
  it("takes the ids it was given, once each", () => {
    const progress = startPull([...ids, "gcAAAAAAAAAA", " ", ""], NOW);
    expect(progress.ids).toEqual(ids);
    expect(progress.settled).toEqual([]);
  });

  // Reopening the panel and pressing the button again should continue, not start over.
  it("keeps its place when the list is the same", () => {
    const first = settleTeam(startPull(ids, NOW), ids[0]!, NOW);
    const again = startPull(ids, LATER, first);
    expect(again.settled).toEqual([ids[0]]);
    expect(again.updatedAt).toBe(LATER);
  });

  it("starts over when the list has changed", () => {
    const first = settleTeam(startPull(ids, NOW), ids[0]!, NOW);
    const different = startPull([...ids, "gcDDDDDDDDDD"], LATER, first);
    expect(different.settled).toEqual([]);
  });
});

describe("what is left to do", () => {
  it("is everything, in order, before anything is settled", () => {
    expect(remainingIds(startPull(ids, NOW))).toEqual(ids);
  });

  it("skips what has been settled and keeps the order", () => {
    const progress = settleTeam(startPull(ids, NOW), ids[1]!, NOW);
    expect(remainingIds(progress)).toEqual([ids[0], ids[2]]);
  });

  it("is empty once the run is done", () => {
    let progress = startPull(ids, NOW);
    ids.forEach((id) => {
      progress = settleTeam(progress, id, NOW);
    });
    expect(remainingIds(progress)).toEqual([]);
    expect(isPullComplete(progress)).toBe(true);
  });

  it("is not complete before it has started", () => {
    expect(isPullComplete(startPull([], NOW))).toBe(false);
  });
});

describe("settleTeam", () => {
  it("records a team once, however often it is settled", () => {
    let progress = startPull(ids, NOW);
    progress = settleTeam(progress, ids[0]!, NOW);
    progress = settleTeam(progress, ids[0]!, LATER);
    expect(progress.settled).toEqual([ids[0]]);
  });

  it("keeps why a team failed", () => {
    const progress = settleTeam(startPull(ids, NOW), ids[0]!, NOW, {
      reason: "not-found",
      message: "GameChanger has no team with that id.",
    });
    expect(progress.failures).toEqual([
      { teamId: ids[0], reason: "not-found", message: "GameChanger has no team with that id." },
    ]);
  });
});

describe("failures worth another go", () => {
  const withFailures = () => {
    let progress = startPull(ids, NOW);
    progress = settleTeam(progress, ids[0]!, NOW, { reason: "throttled", message: "429" });
    progress = settleTeam(progress, ids[1]!, NOW, { reason: "not-found", message: "gone" });
    progress = settleTeam(progress, ids[2]!, NOW);
    return progress;
  };

  // A team that does not exist will not exist next time either.
  it("offers the throttled one and not the missing one", () => {
    expect(retryableIds(withFailures())).toEqual([ids[0]]);
  });

  it("puts a retryable id back in the queue and leaves the rest settled", () => {
    const retried = retryFailures(withFailures(), LATER);
    expect(remainingIds(retried)).toEqual([ids[0]]);
    expect(retried.failures.map((entry) => entry.teamId)).toEqual([ids[1]]);
  });

  it("changes nothing when there is nothing worth retrying", () => {
    const progress = settleTeam(startPull(ids, NOW), ids[0]!, NOW, {
      reason: "not-found",
      message: "gone",
    });
    expect(retryFailures(progress, LATER)).toBe(progress);
  });
});

describe("what the panel says", () => {
  it("counts up as the run goes", () => {
    expect(describePull(startPull(ids, NOW))).toBe("0 of 3 pulled.");
    const part = settleTeam(startPull(ids, NOW), ids[0]!, NOW);
    expect(describePull(part)).toBe("1 of 3 pulled.");
  });

  it("says so at the end, failures and all", () => {
    let progress = startPull(ids, NOW);
    progress = settleTeam(progress, ids[0]!, NOW);
    progress = settleTeam(progress, ids[1]!, NOW);
    progress = settleTeam(progress, ids[2]!, NOW, { reason: "blocked", message: "WAF" });
    expect(describePull(progress)).toBe("3 teams pulled, 1 that could not be reached.");
  });

  it("has a fraction for the bar", () => {
    const progress = settleTeam(startPull(ids, NOW), ids[0]!, NOW);
    expect(pullView(progress)).toEqual({ done: 1, total: 3, failed: 0, fraction: 1 / 3 });
    expect(pullView(startPull([], NOW)).fraction).toBe(0);
  });
});

describe("a stored run, read back", () => {
  const stored: GcPullProgress = {
    ids,
    settled: [ids[0]!],
    failures: [{ teamId: ids[0]!, reason: "throttled", message: "429" }],
    startedAt: NOW,
    updatedAt: LATER,
  };

  it("round-trips", () => {
    expect(coercePullProgress(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("is nothing when it cannot be read", () => {
    expect(coercePullProgress(null)).toBeNull();
    expect(coercePullProgress("corrupt")).toBeNull();
    expect(coercePullProgress({})).toBeNull();
    expect(coercePullProgress({ ids: [] })).toBeNull();
    expect(coercePullProgress({ ids: "not a list" })).toBeNull();
  });

  // A cursor pointing at ids the list no longer has would hold back teams that are now wanted.
  it("drops a settled id that is no longer in the list", () => {
    const drifted = coercePullProgress({ ...stored, settled: [ids[0], "gcZZZZZZZZZZ"] });
    expect(drifted?.settled).toEqual([ids[0]]);
  });

  it("drops a failure for an id that is no longer in the list", () => {
    const drifted = coercePullProgress({
      ...stored,
      failures: [{ teamId: "gcZZZZZZZZZZ", reason: "throttled", message: "429" }],
    });
    expect(drifted?.failures).toEqual([]);
  });

  it("drops a failure whose reason is not one", () => {
    const drifted = coercePullProgress({
      ...stored,
      failures: [{ teamId: ids[0], reason: "banana", message: "?" }],
    });
    expect(drifted?.failures).toEqual([]);
  });
});
