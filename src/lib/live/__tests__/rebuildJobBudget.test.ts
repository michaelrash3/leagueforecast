import { describe, expect, it } from "vitest";
import { coerceLedger, reserveRun, runCost, settleRun } from "../rebuildLedger";
import { rebuildRetryAt, reserveRebuildJob } from "../rebuildJobBudget";
import { REBUILD_SIZE } from "../rebuildWorkerProtocol";

const DAY = "2026-10-13";
const AT = "2026-10-13T17:00:00Z";
const ledger = (more = {}) =>
  coerceLedger({ on: true, mode: "live", day: DAY, month: "2026-10", ...more })!;

describe("the durable rebuild's compute reservation", () => {
  it("runs beyond 270 seconds within the existing budget and blocks overlapping workers", () => {
    const reserved = reserveRebuildJob(ledger(), DAY, AT, "job-one");
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) throw new Error("not reserved");
    expect(reserved.spanS).toBe(1250);
    expect(reserved.next.dayGiBs).toBe(10000);
    const later = new Date(Date.parse(AT) + 600000).toISOString();
    expect(reserveRun(reserved.next, DAY, later)).toMatchObject({ ok: false, why: "busy" });
    expect(coerceLedger(reserved.next)).toEqual(reserved.next);
    const done = settleRun(reserved.next, {
      at: AT,
      by: "job-one",
      used: runCost(600, REBUILD_SIZE),
      failed: false,
      today: DAY,
      endedAt: later,
    })!;
    expect(done).toMatchObject({
      dayGiBs: 4800,
      monthGiBs: 4800,
      monthVcpuS: 1200,
      failures: 0,
      open: null,
    });
    expect(done.caps).toEqual(ledger().caps);
  });
  it("clears the old timeout pause once without resetting compute spent or clearing new failures", () => {
    const old = ledger({ dayGiBs: 6500, monthGiBs: 20000, failures: 3, pausedDay: DAY });
    const migrated = reserveRebuildJob(old, DAY, AT, "job");
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) throw new Error("not reserved");
    expect(migrated.next).toMatchObject({
      engine: "job-v1",
      failures: 0,
      pausedDay: null,
      dayGiBs: 9996,
    });
    expect(migrated.next.caps).toEqual(old.caps);
    const paused = ledger({ engine: "job-v1", failures: 3, pausedDay: DAY });
    expect(reserveRebuildJob(paused, DAY, AT, "job")).toMatchObject({ ok: false, why: "failing" });
  });
  it("respects daily and monthly headroom, and clears no switch", () => {
    expect(reserveRebuildJob(ledger({ dayGiBs: 9900 }), DAY, AT, "job")).toMatchObject({
      ok: false,
      why: "day-cap",
    });
    expect(reserveRebuildJob(ledger({ monthVcpuS: 29900 }), DAY, AT, "job")).toMatchObject({
      ok: false,
      why: "month-cap",
    });
    expect(reserveRebuildJob(ledger({ on: false }), DAY, AT, "job")).toMatchObject({
      ok: false,
      why: "off",
    });
    const limited = reserveRebuildJob(ledger({ monthVcpuS: 29400 }), DAY, AT, "job");
    expect(limited.spanS).toBe(300);
    expect(limited.limiting).toBe("month-cap");
  });
  it("accounts for an interruption without treating saved, deferred work as a failed run", () => {
    const first = reserveRebuildJob(ledger({ engine: "job-v1", failures: 2 }), DAY, AT, "job");
    if (!first.ok) throw new Error("not reserved");
    const deferred = settleRun(first.next, {
      at: AT,
      by: "job",
      used: runCost(400, REBUILD_SIZE),
      failed: null,
      today: DAY,
      endedAt: AT,
    });
    expect(deferred).toMatchObject({ failures: 2, pausedDay: null, dayGiBs: 3200, open: null });
    const actualFailure = settleRun(first.next, {
      at: AT,
      by: "job",
      used: runCost(400, REBUILD_SIZE),
      failed: true,
      today: DAY,
      endedAt: AT,
    });
    expect(actualFailure).toMatchObject({ failures: 3, pausedDay: DAY });
  });
  it("queues itself at New York's next day or month, including both daylight-saving transitions", () => {
    expect(rebuildRetryAt("day-cap", DAY, Date.parse(AT)).toISOString()).toBe(
      "2026-10-14T04:01:00.000Z"
    );
    expect(rebuildRetryAt("month-cap", DAY, Date.parse(AT)).toISOString()).toBe(
      "2026-11-01T04:01:00.000Z"
    );
    expect(
      rebuildRetryAt("day-cap", "2026-11-01", Date.parse("2026-11-01T12:00:00Z")).toISOString()
    ).toBe("2026-11-02T05:01:00.000Z");
    expect(
      rebuildRetryAt("day-cap", "2026-03-07", Date.parse("2026-03-07T12:00:00Z")).toISOString()
    ).toBe("2026-03-08T05:01:00.000Z");
  });
});
