import { describe, expect, it, vi } from "vitest";
import {
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
const LATER = "2027-04-15T14:05:00.000Z";

/** A ledger switched on, with nothing spent this day or month, as `coerceLedger` reads one. */
const ledger = (more: Partial<Ledger> = {}): Ledger => ({
  on: true,
  mode: "live",
  warm: true,
  caps: { ...DEFAULT_CAPS },
  day: TODAY,
  dayGiBs: 0,
  month: "2027-04",
  monthGiBs: 0,
  monthVcpuS: 0,
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
      month: "",
      monthGiBs: 0,
      monthVcpuS: 0,
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
      monthGiBs: 40_000,
      monthVcpuS: 9_000,
      failures: 2,
      pausedDay: "2027-04-14",
      open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING } },
    });
    expect(coerceLedger(JSON.parse(JSON.stringify(full)))).toEqual(full);
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
      { pausedDay: 5 },
      { open: "yes" },
      { open: { at: NOW, day: TODAY } },
      { open: { at: NOW, day: TODAY, cost: { gibs: -1, vcpuS: 0 } } },
      { open: { at: 5, day: TODAY, cost: RUN_CEILING } },
      { open: { at: NOW, day: null, cost: RUN_CEILING } },
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
        monthGiBs: 1_000 + 2_560,
        monthVcpuS: 10 + 640,
        open: { at: NOW, day: TODAY, cost: { gibs: 2_560, vcpuS: 640 } },
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
      monthGiBs: 2_560,
      monthVcpuS: 640,
      open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING } },
    });
    expect(reserveRun(left, TODAY, LATER)).toEqual({
      ok: true,
      next: ledger({
        dayGiBs: 2 * 2_560,
        monthGiBs: 2 * 2_560,
        monthVcpuS: 2 * 640,
        failures: 1,
        open: { at: LATER, day: TODAY, cost: { ...RUN_CEILING } },
      }),
    });
    // The third in a row pauses the rebuilds for the day, and the refusal is written with it.
    expect(reserveRun({ ...left, failures: 2 }, TODAY, LATER)).toEqual({
      ok: false,
      why: "failing",
      next: { ...left, failures: 3, pausedDay: TODAY, open: null },
    });
    // A refusal at the cap still counts the run left open.
    expect(reserveRun({ ...left, dayGiBs: DEFAULT_CAPS.dayGiBs }, TODAY, LATER)).toEqual({
      ok: false,
      why: "day-cap",
      next: { ...left, dayGiBs: DEFAULT_CAPS.dayGiBs, failures: 1, open: null },
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
    open: { at: NOW, day: TODAY, cost: { ...RUN_CEILING } },
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
    ).toMatchObject({ failures: 1, pausedDay: null, open: null, dayGiBs: 5_490 });
    expect(settleRun(open, { at: NOW, used, failed: true, today: TODAY })).toMatchObject({
      failures: 3,
      pausedDay: TODAY,
      open: null,
    });
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
    const nextMonth = { ...open, month: "2027-05", monthGiBs: 0, monthVcpuS: 0 };
    expect(settleRun(nextMonth, { at: NOW, used, failed: false, today: TODAY })).toMatchObject({
      dayGiBs: 5_490,
      monthGiBs: 0,
      monthVcpuS: 0,
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

  it("lets two runs reserving at once have the headroom for one only one of them", async () => {
    const doc = memoryLedger(ledger({ dayGiBs: DEFAULT_CAPS.dayGiBs - RUN_CEILING.gibs }));
    const answers = await Promise.all([
      updateLedger(doc.store, reserving),
      updateLedger(doc.store, (held) => {
        const reserved = reserveRun(held, TODAY, LATER);
        return { next: reserved.next, answer: reserved };
      }),
    ]);
    const oks = answers.map((answer) => "answer" in answer && answer.answer.ok);
    expect(oks.filter(Boolean)).toHaveLength(1);
    expect(answers).toContainEqual(
      expect.objectContaining({ answer: expect.objectContaining({ why: "day-cap" }) })
    );
    expect(doc.held()?.dayGiBs).toBe(DEFAULT_CAPS.dayGiBs);
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
