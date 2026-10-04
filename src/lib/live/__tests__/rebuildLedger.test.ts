import { describe, expect, it, vi } from "vitest";
import {
  chargeEdit,
  coerceLedger,
  DEFAULT_CAPS,
  HARD_CAPS,
  reserveRun,
  RUN_CEILING,
  runCost,
  settleRun,
  updateLedger,
  type Ledger,
  type LedgerStore,
} from "../rebuildLedger";

/*
 * What the rebuilds may spend (`rebuildLedger.ts`): the switch, the caps and the totals in
 * `ops/rebuild`, a run reserved at its ceiling and settled at its cost, and a run that never
 * settles counted as a failure.
 */

const TODAY = "2027-04-15";
const NOW = "2027-04-15T14:00:00.000Z";
/** Longer after `NOW` than a run can last: a run reserved at `NOW` is over by then. */
const LATER = "2027-04-15T14:06:00.000Z";
/** Seconds after `NOW`. */
const after = (seconds: number) => new Date(Date.parse(NOW) + seconds * 1000).toISOString();

/** A ledger switched on, with nothing spent this day or month, as `coerceLedger` reads one. */
const ledger = (more: Partial<Ledger> = {}): Ledger => ({
  on: true,
  mode: "live",
  warm: true,
  caps: { ...DEFAULT_CAPS },
  day: TODAY,
  dayGiBs: 0,
  dayRuns: 0,
  dayFailed: 0,
  lastDay: null,
  month: "2027-04",
  monthGiBs: 0,
  monthVcpuS: 0,
  monthRuns: 0,
  monthFailed: 0,
  failures: 0,
  pausedDay: null,
  open: null,
  ...more,
});

describe("the ledger as the document holds it", () => {
  it("is none where there is no document, or no switch in it", () => {
    for (const raw of [null, undefined, "on", 1, [], {}, { on: "true" }, { on: 1 }]) {
      expect(coerceLedger(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("is the switch alone as the owner makes it, the rest its defaults and nothing spent", () => {
    expect(coerceLedger({ on: true })).toEqual({
      on: true,
      mode: "dry",
      warm: true,
      caps: DEFAULT_CAPS,
      day: "",
      dayGiBs: 0,
      dayRuns: 0,
      dayFailed: 0,
      lastDay: null,
      month: "",
      monthGiBs: 0,
      monthVcpuS: 0,
      monthRuns: 0,
      monthFailed: 0,
      failures: 0,
      pausedDay: null,
      open: null,
    });
    expect(coerceLedger({ on: false, mode: "live", warm: false })).toMatchObject({
      on: false,
      mode: "live",
      warm: false,
    });
    // Everything as written comes back as it was.
    const full = ledger({
      dayGiBs: 2_560,
      dayRuns: 4,
      dayFailed: 1,
      lastDay: { day: "2027-04-13", runs: 7, failed: 2, gibs: 6_000 },
      monthGiBs: 40_000,
      monthVcpuS: 9_000,
      monthRuns: 31,
      monthFailed: 3,
      failures: 2,
      pausedDay: "2027-04-14",
      open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "T1", by: "h1" },
    });
    expect(coerceLedger(JSON.parse(JSON.stringify(full)))).toEqual(full);
    // A reservation that does not say its task or its handling reads as saying neither.
    expect(
      coerceLedger({ on: true, open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING } } })?.open
    ).toEqual({ at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "", by: "" });
  });

  it("holds every cap to its hard limit, and the failures that pause to one at least", () => {
    expect(
      coerceLedger({
        on: true,
        caps: { dayGiBs: 1e9, monthGiBs: 300_000, monthVcpuS: 12, failures: 0 },
      })?.caps
    ).toEqual({
      dayGiBs: HARD_CAPS.dayGiBs,
      monthGiBs: HARD_CAPS.monthGiBs,
      monthVcpuS: 12,
      failures: 1,
    });
    // A cap left out is its default; a cap of nothing is nothing.
    expect(coerceLedger({ on: true, caps: { dayGiBs: 0 } })?.caps).toEqual({
      ...DEFAULT_CAPS,
      dayGiBs: 0,
    });
    expect(coerceLedger({ on: true, caps: { failures: 4.7 } })?.caps.failures).toBe(4);
  });

  it("is none where a field holds what it cannot, rather than one with the guard lifted", () => {
    const bad: Record<string, unknown>[] = [
      { mode: "Live" },
      { warm: "yes" },
      { caps: 5 },
      { caps: { dayGiBs: -1 } },
      { caps: { monthGiBs: "lots" } },
      { caps: { monthVcpuS: Infinity } },
      { day: 20270415 },
      { day: null },
      { month: null },
      { dayGiBs: "0" },
      { dayGiBs: null },
      { failures: null },
      { monthGiBs: -5 },
      { monthVcpuS: Number.NaN },
      { failures: 1.5 },
      { failures: -1 },
      { dayRuns: 1.5 },
      { dayRuns: "3" },
      { dayFailed: null },
      { monthRuns: -1 },
      { monthFailed: Infinity },
      { lastDay: "2027-04-14" },
      { lastDay: { day: 5, runs: 1, failed: 0, gibs: 0 } },
      { lastDay: { day: TODAY, runs: 1.5, failed: 0, gibs: 0 } },
      { lastDay: { day: TODAY, runs: 1, failed: -1, gibs: 0 } },
      { lastDay: { day: TODAY, runs: 1, failed: 0, gibs: "0" } },
      { lastDay: { day: TODAY, runs: 1, failed: 0 } },
      { pausedDay: 5 },
      { open: "yes" },
      { open: { at: NOW, day: TODAY } },
      { open: { at: NOW, day: TODAY, cost: { gibs: -1, vcpuS: 0 } } },
      { open: { at: 5, day: TODAY, cost: RUN_CEILING } },
      { open: { at: NOW, day: null, cost: RUN_CEILING } },
      { open: { at: NOW, day: TODAY, cost: RUN_CEILING, task: 5 } },
      { open: { at: NOW, day: TODAY, cost: RUN_CEILING, by: null } },
    ];
    for (const fields of bad) {
      expect(coerceLedger({ on: true, ...fields }), JSON.stringify(fields)).toBeNull();
    }
  });
});

describe("reserving a run", () => {
  it("is refused while off, writing nothing", () => {
    expect(reserveRun(null, TODAY, NOW)).toEqual({ ok: false, why: "off", next: null });
    expect(reserveRun(ledger({ on: false }), TODAY, NOW)).toEqual({
      ok: false,
      why: "off",
      next: null,
    });
  });

  it("charges the run's ceiling to the day and the month, and holds it open", () => {
    const reserved = reserveRun(
      ledger({ dayGiBs: 100, monthGiBs: 1_000, monthVcpuS: 10 }),
      TODAY,
      NOW
    );
    expect(reserved).toEqual({
      ok: true,
      next: ledger({
        dayGiBs: 100 + 2_560,
        dayRuns: 1,
        monthGiBs: 1_000 + 2_560,
        monthVcpuS: 10 + 640,
        monthRuns: 1,
        open: { at: NOW, day: TODAY, cost: { gibs: 2_560, vcpuS: 640 }, task: "", by: "" },
      }),
    });
    expect(RUN_CEILING).toEqual({ gibs: (300 + 20) * 8, vcpuS: (300 + 20) * 2 });
  });

  it("is refused at the day's cap, the month's, and the month's vCPU, with this run's ceiling", () => {
    const fits = DEFAULT_CAPS.dayGiBs - RUN_CEILING.gibs;
    expect(reserveRun(ledger({ dayGiBs: fits }), TODAY, NOW).ok).toBe(true);
    expect(reserveRun(ledger({ dayGiBs: fits + 1 }), TODAY, NOW)).toMatchObject({
      ok: false,
      why: "day-cap",
    });
    const monthFits = DEFAULT_CAPS.monthGiBs - RUN_CEILING.gibs;
    expect(reserveRun(ledger({ monthGiBs: monthFits }), TODAY, NOW).ok).toBe(true);
    expect(reserveRun(ledger({ monthGiBs: monthFits + 1 }), TODAY, NOW)).toMatchObject({
      ok: false,
      why: "month-cap",
    });
    const cpuFits = DEFAULT_CAPS.monthVcpuS - RUN_CEILING.vcpuS;
    expect(reserveRun(ledger({ monthVcpuS: cpuFits }), TODAY, NOW).ok).toBe(true);
    expect(reserveRun(ledger({ monthVcpuS: cpuFits + 1 }), TODAY, NOW)).toMatchObject({
      ok: false,
      why: "month-cap",
    });
    // A cap the owner set high is held to the hard one.
    const high = coerceLedger({ on: true, day: TODAY, month: "2027-04", caps: { dayGiBs: 1e9 } });
    expect(reserveRun({ ...high!, dayGiBs: HARD_CAPS.dayGiBs }, TODAY, NOW)).toMatchObject({
      ok: false,
      why: "day-cap",
    });
  });

  it("starts the day's total afresh on a new New York day, and the month's on a new month", () => {
    const full = ledger({ dayGiBs: DEFAULT_CAPS.dayGiBs, monthGiBs: 50_000, monthVcpuS: 5_000 });
    const tomorrow = reserveRun(full, "2027-04-16", "2027-04-16T04:30:00.000Z");
    expect(tomorrow).toMatchObject({
      ok: true,
      next: { day: "2027-04-16", dayGiBs: 2_560, month: "2027-04", monthGiBs: 52_560 },
    });
    const spent = ledger({
      day: "2027-04-30",
      monthGiBs: DEFAULT_CAPS.monthGiBs,
      monthVcpuS: DEFAULT_CAPS.monthVcpuS,
    });
    expect(reserveRun(spent, "2027-04-30", NOW)).toMatchObject({ ok: false, why: "month-cap" });
    expect(reserveRun(spent, "2027-05-01", NOW)).toMatchObject({
      ok: true,
      next: { day: "2027-05-01", month: "2027-05", monthGiBs: 2_560, monthVcpuS: 640 },
    });
    // A ledger that has counted nothing yet starts on today.
    expect(reserveRun(coerceLedger({ on: true }), TODAY, NOW)).toMatchObject({
      ok: true,
      next: { day: TODAY, month: "2027-04", dayGiBs: 2_560 },
    });
  });

  it("counts a run left open as a failure, its ceiling still charged, and hands that back to write", () => {
    const left = ledger({
      dayGiBs: 2_560,
      dayRuns: 1,
      monthGiBs: 2_560,
      monthVcpuS: 640,
      monthRuns: 1,
      open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "", by: "" },
    });
    expect(reserveRun(left, TODAY, LATER)).toEqual({
      ok: true,
      next: ledger({
        dayGiBs: 2 * 2_560,
        dayRuns: 2,
        dayFailed: 1,
        monthGiBs: 2 * 2_560,
        monthVcpuS: 2 * 640,
        monthRuns: 2,
        monthFailed: 1,
        failures: 1,
        open: { at: LATER, day: TODAY, cost: { ...RUN_CEILING }, task: "", by: "" },
      }),
    });
    // The third in a row pauses the rebuilds for the day, and the refusal is written with it.
    expect(reserveRun({ ...left, failures: 2 }, TODAY, LATER)).toEqual({
      ok: false,
      why: "failing",
      next: { ...left, failures: 3, pausedDay: TODAY, dayFailed: 1, monthFailed: 1, open: null },
    });
    // A refusal at the cap still counts the run left open.
    expect(reserveRun({ ...left, dayGiBs: DEFAULT_CAPS.dayGiBs }, TODAY, LATER)).toEqual({
      ok: false,
      why: "day-cap",
      next: {
        ...left,
        dayGiBs: DEFAULT_CAPS.dayGiBs,
        failures: 1,
        dayFailed: 1,
        monthFailed: 1,
        open: null,
      },
    });
  });

  it("is busy while a run reserved within a run's span may still be going", () => {
    const going = ledger({
      dayGiBs: 2_560,
      monthGiBs: 2_560,
      monthVcpuS: 640,
      failures: 2,
      open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "A", by: "h1" },
    });
    // Neither counted nor cleared, and nothing written: that run is still to settle.
    for (const at of [after(1), after(319), after(-30)]) {
      expect(reserveRun(going, TODAY, at, { task: "B" }), at).toEqual({
        ok: false,
        why: "busy",
        next: null,
      });
    }
    // A run's span on, it never settled: counted, and this one runs.
    expect(reserveRun(going, TODAY, after(320), { task: "B" })).toMatchObject({
      ok: false,
      why: "failing",
      next: { failures: 3, pausedDay: TODAY, open: null },
    });
    expect(
      reserveRun({ ...going, failures: 0 }, TODAY, after(320), { task: "B", by: "h2" })
    ).toMatchObject({
      ok: true,
      next: { failures: 1, open: { at: after(320), task: "B", by: "h2" } },
    });
    // A clock far ahead of this one, or a time no one can read, is no run going.
    for (const at of ["2027-04-15T14:02:00.000Z", "whenever"]) {
      expect(
        reserveRun({ ...going, failures: 0, open: { ...going.open!, at } }, TODAY, NOW, {
          task: "B",
        }),
        at
      ).toMatchObject({ ok: true, next: { failures: 1 } });
    }
    // Runs that do not say which task they run, too.
    expect(
      reserveRun({ ...going, open: { ...going.open!, task: "" } }, TODAY, after(60))
    ).toMatchObject({ why: "busy" });
  });

  it("is busy while the same task's earlier try may still be going, and counts it after", () => {
    // The queue delivers a task at least once: twice at once, or again past its dispatch deadline
    // while the first try still runs. That try is to settle, not to be counted as dead.
    const trying = ledger({
      dayGiBs: 2_560,
      dayRuns: 1,
      monthGiBs: 2_560,
      monthVcpuS: 640,
      monthRuns: 1,
      open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "A", by: "h1" },
    });
    for (const at of [after(1), after(60), after(319)]) {
      expect(reserveRun(trying, TODAY, at, { task: "A", by: "h2" }), at).toEqual({
        ok: false,
        why: "busy",
        next: null,
      });
    }
    // A run's span on, the try that reserved it never settled.
    expect(reserveRun(trying, TODAY, after(320), { task: "A", by: "h2" })).toEqual({
      ok: true,
      next: ledger({
        dayGiBs: 2 * 2_560,
        dayRuns: 2,
        dayFailed: 1,
        monthGiBs: 2 * 2_560,
        monthVcpuS: 2 * 640,
        monthRuns: 2,
        monthFailed: 1,
        failures: 1,
        open: { at: after(320), day: TODAY, cost: { ...RUN_CEILING }, task: "A", by: "h2" },
      }),
    });
  });

  it("counts the runs of the day and the month afresh as their totals are", () => {
    const counted = ledger({ dayRuns: 5, dayFailed: 2, monthRuns: 30, monthFailed: 4 });
    expect(reserveRun(counted, TODAY, NOW)).toMatchObject({
      ok: true,
      next: { dayRuns: 6, dayFailed: 2, monthRuns: 31, monthFailed: 4 },
    });
    expect(reserveRun(counted, "2027-04-16", "2027-04-16T04:30:00.000Z")).toMatchObject({
      ok: true,
      next: { dayRuns: 1, dayFailed: 0, monthRuns: 31, monthFailed: 4 },
    });
    expect(reserveRun(counted, "2027-05-01", "2027-05-01T04:30:00.000Z")).toMatchObject({
      ok: true,
      next: { dayRuns: 1, dayFailed: 0, monthRuns: 1, monthFailed: 0 },
    });
    // A refusal counts no run.
    expect(reserveRun({ ...counted, dayGiBs: DEFAULT_CAPS.dayGiBs }, TODAY, NOW)).toMatchObject({
      ok: false,
      why: "day-cap",
      next: { dayRuns: 5, monthRuns: 30 },
    });
  });

  it("counts a run left open from an earlier day as failed only where its runs are still counted", () => {
    const yesterday = ledger({
      day: "2027-04-14",
      dayRuns: 3,
      monthRuns: 3,
      open: {
        at: "2027-04-14T23:58:00.000Z",
        day: "2027-04-14",
        cost: { ...RUN_CEILING },
        task: "",
        by: "",
      },
    });
    // Yesterday's runs are no longer counted, so today's failed runs stay among today's runs.
    expect(reserveRun(yesterday, TODAY, NOW)).toMatchObject({
      ok: true,
      next: { failures: 1, dayRuns: 1, dayFailed: 0, monthRuns: 4, monthFailed: 1 },
    });
    const lastMonth = {
      ...yesterday,
      day: "2027-03-31",
      month: "2027-03",
      open: { ...yesterday.open!, at: "2027-03-31T23:58:00.000Z", day: "2027-03-31" },
    };
    expect(reserveRun(lastMonth, TODAY, NOW)).toMatchObject({
      ok: true,
      next: { failures: 1, dayRuns: 1, dayFailed: 0, monthRuns: 1, monthFailed: 0 },
    });
  });

  it("keeps the last day that had a run when a new day's first reserve moves on from it", () => {
    const ran = ledger({ dayRuns: 6, dayFailed: 1, dayGiBs: 4_321, monthRuns: 6, monthFailed: 1 });
    const tomorrow = reserveRun(ran, "2027-04-16", "2027-04-16T00:10:00.000Z");
    expect(tomorrow).toMatchObject({
      ok: true,
      next: {
        day: "2027-04-16",
        dayRuns: 1,
        lastDay: { day: TODAY, runs: 6, failed: 1, gibs: 4_321 },
      },
    });
    // A day of refusals at the month's cap moves the day on, and keeps the last day that ran.
    const capped = { ...ran, monthGiBs: DEFAULT_CAPS.monthGiBs };
    const refused = reserveRun(capped, "2027-04-16", "2027-04-16T09:00:00.000Z");
    expect(refused).toMatchObject({
      ok: false,
      why: "month-cap",
      next: { day: "2027-04-16", dayRuns: 0, lastDay: { day: TODAY, runs: 6 } },
    });
    expect(reserveRun(refused.next, "2027-04-17", "2027-04-17T09:00:00.000Z")).toMatchObject({
      ok: false,
      why: "month-cap",
      next: { day: "2027-04-17", dayRuns: 0, lastDay: { day: TODAY, runs: 6, failed: 1 } },
    });
  });

  it("counts a run left open on the last day that ran as one of its failures", () => {
    const left = ledger({
      dayRuns: 3,
      monthRuns: 3,
      dayGiBs: 2_560,
      monthGiBs: 2_560,
      monthVcpuS: 640,
      open: {
        at: "2027-04-15T23:58:00.000Z",
        day: TODAY,
        cost: { ...RUN_CEILING },
        task: "",
        by: "",
      },
    });
    expect(reserveRun(left, "2027-04-16", "2027-04-16T09:00:00.000Z")).toMatchObject({
      ok: true,
      next: {
        dayRuns: 1,
        dayFailed: 0,
        lastDay: { day: TODAY, runs: 3, failed: 1, gibs: 2_560 },
        monthRuns: 4,
        monthFailed: 1,
      },
    });
  });

  it("is refused for the rest of a day the failures paused, and not the next day", () => {
    const paused = ledger({ failures: 3, pausedDay: TODAY });
    expect(reserveRun(paused, TODAY, NOW)).toEqual({ ok: false, why: "failing", next: paused });
    expect(reserveRun(paused, "2027-04-16", "2027-04-16T04:30:00.000Z")).toMatchObject({
      ok: true,
      next: { failures: 0, pausedDay: null, day: "2027-04-16" },
    });
    // A pause from an earlier day is lifted however the day's total reads.
    expect(reserveRun(ledger({ failures: 3, pausedDay: "2027-04-14" }), TODAY, NOW)).toMatchObject({
      ok: true,
      next: { failures: 0, pausedDay: null },
    });
    // Failures short of a pause carry over to the next day.
    expect(
      reserveRun(ledger({ failures: 2 }), "2027-04-16", "2027-04-16T04:30:00.000Z")
    ).toMatchObject({ ok: true, next: { failures: 2 } });
  });
});

describe("settling a run", () => {
  const open = ledger({
    dayGiBs: 5_000 + 2_560,
    monthGiBs: 20_000 + 2_560,
    monthVcpuS: 3_000 + 640,
    failures: 2,
    open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "", by: "" },
  });
  const used = runCost(61.2, { gib: 8, cpu: 2 });

  it("puts what the run cost in place of its ceiling, and clears the failures", () => {
    expect(used).toEqual({ gibs: 490, vcpuS: 123 });
    expect(settleRun(open, { at: NOW, used, failed: false, today: TODAY })).toEqual(
      ledger({ dayGiBs: 5_490, monthGiBs: 20_490, monthVcpuS: 3_123 })
    );
  });

  it("counts a failure, and pauses the rest of the day at the cap", () => {
    expect(
      settleRun({ ...open, failures: 0 }, { at: NOW, used, failed: true, today: TODAY })
    ).toMatchObject({
      failures: 1,
      pausedDay: null,
      open: null,
      dayGiBs: 5_490,
      dayFailed: 1,
      monthFailed: 1,
    });
    expect(settleRun(open, { at: NOW, used, failed: true, today: TODAY })).toMatchObject({
      failures: 3,
      pausedDay: TODAY,
      open: null,
    });
    // A failure of today's run is not one of the last day that ran before it.
    const lastDay = { day: "2027-04-14", runs: 5, failed: 0, gibs: 3_000 };
    expect(
      settleRun({ ...open, lastDay }, { at: NOW, used, failed: true, today: TODAY })
    ).toMatchObject({ dayFailed: 1, lastDay });
  });

  it("charges what a run cost past its ceiling, and nothing below none", () => {
    expect(runCost(-3, { gib: 8, cpu: 2 })).toEqual({ gibs: 0, vcpuS: 0 });
    const long = runCost(400, { gib: 8, cpu: 2 });
    expect(settleRun(open, { at: NOW, used: long, failed: false, today: TODAY })).toMatchObject({
      dayGiBs: 5_000 + 3_200,
    });
  });

  it("settles nothing for a run that is no longer the open one", () => {
    // A later reserve counted it as never settled and keeps its ceiling charged.
    expect(settleRun(open, { at: LATER, used, failed: false, today: TODAY })).toBeNull();
    // Nor for another handling's reservation made at the very same moment.
    const held = { ...open, open: { ...open.open!, by: "h1" } };
    expect(settleRun(held, { at: NOW, by: "h2", used, failed: false, today: TODAY })).toBeNull();
    expect(settleRun(held, { at: NOW, used, failed: false, today: TODAY })).toBeNull();
    expect(settleRun(held, { at: NOW, by: "h1", used, failed: false, today: TODAY })).toMatchObject(
      { open: null, dayGiBs: 5_490 }
    );
    expect(
      settleRun({ ...open, open: null }, { at: NOW, used, failed: false, today: TODAY })
    ).toBeNull();
    expect(settleRun(null, { at: NOW, used, failed: false, today: TODAY })).toBeNull();
  });

  it("swaps only the totals of the day and month the run was charged to", () => {
    // The owner started the day's total afresh by hand while it ran: the month's still holds it.
    const moved = { ...open, day: "2027-04-16", dayGiBs: 0 };
    expect(settleRun(moved, { at: NOW, used, failed: false, today: TODAY })).toMatchObject({
      dayGiBs: 0,
      monthGiBs: 20_490,
      monthVcpuS: 3_123,
    });
    // And a failure only to the day and month whose runs it is among.
    expect(settleRun(moved, { at: NOW, used, failed: true, today: TODAY })).toMatchObject({
      dayFailed: 0,
      monthFailed: 1,
    });
    // A run that failed past midnight is a failed run of the day it was reserved on.
    expect(settleRun(open, { at: NOW, used, failed: true, today: "2027-04-16" })).toMatchObject({
      dayFailed: 1,
      monthFailed: 1,
    });
    const nextMonth = { ...open, month: "2027-05", monthGiBs: 0, monthVcpuS: 0 };
    expect(settleRun(nextMonth, { at: NOW, used, failed: false, today: TODAY })).toMatchObject({
      dayGiBs: 5_490,
      monthGiBs: 0,
      monthVcpuS: 0,
    });
  });

  it("puts the cost in place of the ceiling in the day kept for the nightly, the day turned under it", () => {
    // An edit charged just after New York's midnight moves the ledger on while the run is open.
    const turned = chargeEdit({ ...open, dayRuns: 1 }, "2027-04-16", { gibs: 8, vcpuS: 2 });
    expect(turned?.lastDay).toEqual({ day: TODAY, runs: 1, failed: 0, gibs: 7_560 });
    expect(settleRun(turned, { at: NOW, used, failed: false, today: "2027-04-16" })).toMatchObject({
      day: "2027-04-16",
      dayGiBs: 8,
      lastDay: { day: TODAY, runs: 1, failed: 0, gibs: 5_490 },
      monthGiBs: 20_498,
    });
  });
});

/** The ledger's document in memory, refusing a write over a version it was not read at. */
const memoryLedger = (raw: unknown) => {
  let doc: { raw: unknown; token: string } | null = raw === null ? null : { raw, token: "t0" };
  let version = 0;
  const replace = vi.fn(async (token: string | null, next: Ledger) => {
    if ((doc?.token ?? null) !== token) return false;
    version += 1;
    doc = { raw: JSON.parse(JSON.stringify(next)), token: `t${version}` };
    return true;
  });
  const store: LedgerStore = {
    read: async () =>
      doc
        ? { raw: JSON.parse(JSON.stringify(doc.raw)), token: doc.token }
        : { raw: null, token: null },
    replace,
  };
  return {
    store,
    replace,
    held: () => coerceLedger(doc?.raw ?? null),
    /** Another writer's save, as the owner turning the switch in the console. */
    edit: (fields: Record<string, unknown>) => {
      version += 1;
      doc = { raw: { ...(doc?.raw as object), ...fields }, token: `t${version}` };
    },
  };
};

const reserving = (ledger: Ledger | null) => {
  const reserved = reserveRun(ledger, TODAY, NOW);
  return { next: reserved.next, answer: reserved };
};

describe("charging an edit", () => {
  it("adds what it cost to the day and the month, counting no run and opening none", () => {
    const open = { at: NOW, day: TODAY, cost: RUN_CEILING, task: "t", by: "r" };
    const held = ledger({ dayGiBs: 100, dayRuns: 2, monthGiBs: 900, monthVcpuS: 30, open });
    expect(chargeEdit(held, TODAY, { gibs: 40, vcpuS: 10 })).toEqual({
      ...held,
      dayGiBs: 140,
      monthGiBs: 940,
      monthVcpuS: 40,
    });
  });

  it("is charged with the switch off, at the caps, and while paused, since it was spent", () => {
    const held = ledger({
      on: false,
      dayGiBs: DEFAULT_CAPS.dayGiBs,
      failures: DEFAULT_CAPS.failures,
      pausedDay: TODAY,
    });
    expect(chargeEdit(held, TODAY, { gibs: 8, vcpuS: 2 })).toMatchObject({
      on: false,
      dayGiBs: DEFAULT_CAPS.dayGiBs + 8,
      pausedDay: TODAY,
    });
  });

  it("starts a new day's total and a new month's, as a reserve would", () => {
    const held = ledger({ dayGiBs: 500, dayRuns: 3, monthGiBs: 900, monthVcpuS: 60 });
    expect(chargeEdit(held, "2027-05-01", { gibs: 8, vcpuS: 2 })).toMatchObject({
      day: "2027-05-01",
      dayGiBs: 8,
      dayRuns: 0,
      lastDay: { day: TODAY, runs: 3, failed: 0, gibs: 500 },
      month: "2027-05",
      monthGiBs: 8,
      monthVcpuS: 2,
    });
  });

  it("charges nothing where there is no ledger", () => {
    expect(chargeEdit(null, TODAY, { gibs: 8, vcpuS: 2 })).toBeNull();
  });
});

describe("writing the ledger", () => {
  it("writes what a step makes of it, and nothing where the step changes nothing", async () => {
    const doc = memoryLedger({ on: true });
    const first = await updateLedger(doc.store, reserving);
    expect(first).toMatchObject({ wrote: true, answer: { ok: true } });
    expect(doc.held()).toMatchObject({ dayGiBs: 2_560, open: { at: NOW } });

    const paused = memoryLedger(ledger({ failures: 3, pausedDay: TODAY }));
    expect(await updateLedger(paused.store, reserving)).toMatchObject({
      wrote: false,
      answer: { ok: false, why: "failing" },
    });
    expect(paused.replace).not.toHaveBeenCalled();

    const off = memoryLedger({ on: false });
    expect(await updateLedger(off.store, reserving)).toMatchObject({ wrote: false });
    expect(off.replace).not.toHaveBeenCalled();
    // A document that is not a ledger is read as off and left for the owner to put right.
    const junk = memoryLedger({ on: true, dayGiBs: "lots" });
    expect(await updateLedger(junk.store, reserving)).toMatchObject({
      wrote: false,
      answer: { why: "off" },
    });
    expect(junk.replace).not.toHaveBeenCalled();
  });

  it("reads again and goes again when another writer saved since it read", async () => {
    const doc = memoryLedger({ on: true });
    let turned = false;
    const step = (held: Ledger | null) => {
      // The owner turns the rebuilds off between this read and its write, once.
      if (!turned) {
        turned = true;
        doc.edit({ on: false });
      }
      return reserving(held);
    };
    expect(await updateLedger(doc.store, step)).toMatchObject({
      wrote: false,
      answer: { ok: false, why: "off" },
    });
    expect(doc.replace).toHaveBeenCalledTimes(1);
    expect(doc.held()).toMatchObject({ on: false, dayGiBs: 0, open: null });
  });

  it("gives up after its tries rather than writing over a ledger that keeps moving", async () => {
    const doc = memoryLedger({ on: true });
    const step = (held: Ledger | null) => {
      doc.edit({ warm: true });
      return reserving(held);
    };
    expect(await updateLedger(doc.store, step)).toEqual({ contended: true });
    expect(doc.replace).toHaveBeenCalledTimes(3);
    expect(doc.held()).toMatchObject({ dayGiBs: 0, open: null });
  });

  it("lets one of two runs reserving at once run, and leaves the other's run to settle", async () => {
    const doc = memoryLedger(ledger({ failures: 2 }));
    const reserve = (at: string, task: string) => (held: Ledger | null) => {
      const reserved = reserveRun(held, TODAY, at, { task });
      return { next: reserved.next, answer: reserved };
    };
    const answers = await Promise.all([
      updateLedger(doc.store, reserve(NOW, "A")),
      updateLedger(doc.store, reserve(after(5), "B")),
    ]);
    expect(answers.map((answer) => "answer" in answer && answer.answer.ok)).toEqual([true, false]);
    expect(answers[1]).toMatchObject({ answer: { why: "busy" }, wrote: false });
    // The winner's reservation stands, charged once and counted as nothing gone wrong.
    expect(doc.held()).toMatchObject({ dayGiBs: 2_560, failures: 2, open: { at: NOW, task: "A" } });
    const settled = await updateLedger(doc.store, (held) => ({
      next: settleRun(held, {
        at: NOW,
        used: { gibs: 80, vcpuS: 20 },
        failed: false,
        today: TODAY,
      }),
      answer: null,
    }));
    expect(settled).toEqual({ answer: null, wrote: true });
    expect(doc.held()).toMatchObject({ dayGiBs: 80, failures: 0, open: null });
  });

  it("tries a read or a write that throws again, and throws only when the last try does", async () => {
    const doc = memoryLedger({ on: true });
    const read = doc.store.read;
    let reads = 0;
    const flaky: LedgerStore = {
      read: async () => {
        reads += 1;
        if (reads === 1) throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        return read();
      },
      replace: doc.store.replace,
    };
    expect(await updateLedger(flaky, reserving)).toMatchObject({
      wrote: true,
      answer: { ok: true },
    });
    expect(doc.held()?.open?.at).toBe(NOW);

    // A settle whose write landed though its answer was lost is found on the next read, counted as
    // written, and not made twice.
    let lost = true;
    const losing: LedgerStore = {
      read: doc.store.read,
      replace: async (token, next) => {
        const landed = await doc.store.replace(token, next);
        if (lost) {
          lost = false;
          throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        }
        return landed;
      },
    };
    const settle = (held: Ledger | null) => ({
      next: settleRun(held, {
        at: NOW,
        used: { gibs: 80, vcpuS: 20 },
        failed: false,
        today: TODAY,
      }),
      answer: null,
    });
    expect(await updateLedger(losing, settle)).toEqual({ answer: null, wrote: true });
    expect(doc.held()).toMatchObject({ dayGiBs: 80, monthVcpuS: 20, open: null });

    // The last try's write, its answer lost: read back once, and counted as written if it landed.
    const backed = memoryLedger({ on: true });
    let writes = 0;
    const landing: LedgerStore = {
      read: backed.store.read,
      replace: vi.fn(async (token: string | null, next: Ledger) => {
        writes += 1;
        if (writes === 3) await backed.store.replace(token, next);
        throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
      }),
    };
    expect(await updateLedger(landing, reserving)).toMatchObject({
      wrote: true,
      answer: { ok: true },
    });
    expect(landing.replace).toHaveBeenCalledTimes(3);
    expect(backed.held()).toMatchObject({ dayGiBs: 2_560, open: { at: NOW } });
    // Read back and not there: thrown, and never a fourth write.
    const never = memoryLedger({ on: true });
    const failing: LedgerStore = {
      read: never.store.read,
      replace: vi.fn(async (): Promise<boolean> => {
        throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
      }),
    };
    await expect(updateLedger(failing, reserving)).rejects.toThrow(/503/);
    expect(failing.replace).toHaveBeenCalledTimes(3);
    expect(never.held()).toMatchObject({ open: null });
    // Not there, but the step would now write nothing: its answer stands.
    const taken = memoryLedger({ on: true });
    let tries = 0;
    const overtaken: LedgerStore = {
      read: taken.store.read,
      replace: async () => {
        tries += 1;
        if (tries === 3) {
          taken.edit({
            open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING }, task: "B", by: "h9" },
          });
        }
        throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
      },
    };
    expect(await updateLedger(overtaken, reserving)).toMatchObject({
      wrote: false,
      answer: { ok: false, why: "busy" },
    });
    // And the read back failing too: the write's error is thrown.
    let looks = 0;
    const dark: LedgerStore = {
      read: async () => {
        looks += 1;
        if (looks > 3) throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        return never.store.read();
      },
      replace: failing.replace,
    };
    await expect(updateLedger(dark, reserving)).rejects.toThrow(/replacing/);

    const down: LedgerStore = {
      read: vi.fn(async (): Promise<{ raw: unknown; token: string | null }> => {
        throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
      }),
      replace: doc.store.replace,
    };
    await expect(updateLedger(down, reserving)).rejects.toThrow(/503/);
    expect(down.read).toHaveBeenCalledTimes(3);

    // A throw and then writers that keep getting in first: contended, not the throw.
    let tried = 0;
    const busyThenMoving: LedgerStore = {
      read: async () => {
        tried += 1;
        if (tried === 1) throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        return { raw: { on: true }, token: `t${tried}` };
      },
      replace: async () => false,
    };
    expect(await updateLedger(busyThenMoving, reserving)).toEqual({ contended: true });
  });

  it("holds a write whose answer was lost until a read tells, through the reads that fail", async () => {
    // The first write fails outright, the second lands with its answer lost, and the third try's
    // read fails: the second write is read back after the last try, found, and not made again.
    const doc = memoryLedger({ on: true });
    let writes = 0;
    let reads = 0;
    const store: LedgerStore = {
      read: async () => {
        reads += 1;
        if (reads === 3) throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        return doc.store.read();
      },
      replace: vi.fn(async (token: string | null, next: Ledger) => {
        writes += 1;
        if (writes === 2) await doc.store.replace(token, next);
        throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
      }),
    };
    expect(await updateLedger(store, reserving)).toMatchObject({
      wrote: true,
      answer: { ok: true },
    });
    expect(store.replace).toHaveBeenCalledTimes(2);
    expect(doc.held()).toMatchObject({ dayGiBs: 2_560, open: { at: NOW } });

    // The first write lands with its answer lost, and both reads after it fail: held through both.
    const held = memoryLedger({ on: true });
    let looks = 0;
    let made = 0;
    const blind: LedgerStore = {
      read: async () => {
        looks += 1;
        if (looks === 2 || looks === 3) {
          throw new Error("Firestore answered HTTP 503 reading ops/rebuild.");
        }
        return held.store.read();
      },
      replace: async (token, next) => {
        made += 1;
        await held.store.replace(token, next);
        throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
      },
    };
    expect(await updateLedger(blind, reserving)).toMatchObject({
      wrote: true,
      answer: { ok: true },
    });
    expect(made).toBe(1);

    // A lost write that another writer has since written over is not taken for written: the step
    // is asked again of what is there.
    const over = memoryLedger({ on: true });
    let first = true;
    const overwritten: LedgerStore = {
      read: over.store.read,
      replace: async (token, next) => {
        const landed = await over.store.replace(token, next);
        if (first) {
          first = false;
          over.edit({ warm: false });
          throw new Error("Firestore answered HTTP 503 replacing ops/rebuild.");
        }
        return landed;
      },
    };
    expect(await updateLedger(overwritten, reserving)).toMatchObject({
      wrote: false,
      answer: { ok: false, why: "busy" },
    });
  });

  it("writes the ledger it settles over the one it reserved", async () => {
    const doc = memoryLedger({ on: true });
    await updateLedger(doc.store, reserving);
    const settled = await updateLedger(doc.store, (held) => ({
      next: settleRun(held, {
        at: NOW,
        used: { gibs: 490, vcpuS: 123 },
        failed: false,
        today: TODAY,
      }),
      answer: null,
    }));
    expect(settled).toEqual({ answer: null, wrote: true });
    expect(doc.held()).toMatchObject({ dayGiBs: 490, monthGiBs: 490, monthVcpuS: 123, open: null });
  });
});
