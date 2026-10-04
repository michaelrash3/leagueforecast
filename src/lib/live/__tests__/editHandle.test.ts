import { describe, expect, it } from "vitest";
import type { EditRun } from "../editRun";
import { handleEdit, handleWarm, type EditWorker } from "../editHandle";
import type { RebuildResult } from "../rebuild";
import {
  coerceLedger,
  DEFAULT_CAPS,
  RUN_CEILING,
  type Ledger,
  type LedgerStore,
} from "../rebuildLedger";

/*
 * One request to the edit function on its main thread (`editHandle.ts`): the edit made whatever the
 * ledger says and its compute charged, then the boards published from the same pool under a run
 * reserved as a rebuild's is, or left to the save's own rebuild where the ledger says no.
 */

const TODAY = "2027-04-15";
const NOW = "2027-04-15T14:00:00.000Z";
const SIZE = { gib: 8, cpu: 2 };

const ledgerOf = (more: Partial<Ledger> = {}): Ledger => ({
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

const memoryLedger = (raw: unknown) => {
  let doc: { raw: unknown; token: string } | null = raw === null ? null : { raw, token: "t0" };
  let version = 0;
  const store: LedgerStore = {
    read: async () =>
      doc ? { raw: structuredClone(doc.raw), token: doc.token } : { raw: null, token: null },
    replace: async (token, next) => {
      if ((doc?.token ?? null) !== token) return false;
      version += 1;
      doc = { raw: structuredClone(next), token: `t${version}` };
      return true;
    },
  };
  return { store, held: () => coerceLedger(doc?.raw ?? null) };
};

const EDITED: EditRun = {
  ok: true,
  copy: "c1",
  version: 8,
  inverse: { kind: "team.state", teamId: "B", state: null },
  changed: ["league_forecast_scout_teams_v1"],
  tries: 1,
  cold: false,
  fetched: 0,
  loadMs: 40,
  applyMs: 5,
  commitMs: 300,
};

const PUBLISHED: RebuildResult = { end: "published", retryable: false, tries: 1, wrote: true };

/** A worker whose edit takes `editS` seconds and publish `publishS`, on the clock it moves. */
const setUp = ({
  edit = async () => EDITED,
  publish = async () => PUBLISHED,
  editS = 2,
  publishS = 10,
}: {
  edit?: EditWorker["edit"];
  publish?: EditWorker["publish"];
  editS?: number;
  publishS?: number;
} = {}) => {
  let t = 1_000_000;
  const asked: Array<{ dry: boolean }> = [];
  const worker: EditWorker = {
    edit: async (ask) => {
      t += editS * 1000;
      return edit(ask);
    },
    publish: async (request) => {
      asked.push(request);
      t += publishS * 1000;
      return publish(request);
    },
    warm: async () => {
      t += 4_000;
      return { ok: true, cold: true, fetched: 12, loadMs: 4_000 };
    },
  };
  return { worker, asked, clock: () => t };
};

const run = (
  ledger: LedgerStore,
  { worker, clock }: { worker: EditWorker; clock: () => number },
  startupS = 0
) =>
  handleEdit({
    ask: { command: { kind: "team.state", teamId: "B", state: "KY" }, copy: "c1" },
    ledger,
    worker,
    today: () => TODAY,
    now: () => NOW,
    clock,
    size: SIZE,
    startupS: () => startupS,
    runId: "req-1",
  });

describe("an edit request", () => {
  it("makes the edit, then publishes the boards live from the same pool", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp();
    const { reply, line } = await run(ledger.store, setup, 3);
    expect(reply).toEqual({
      ok: true,
      copy: "c1",
      version: 8,
      inverse: EDITED.ok ? EDITED.inverse : null,
      changed: EDITED.ok ? EDITED.changed : [],
      publish: "published",
      published: true,
      ms: { load: 40, apply: 5, commit: 300, publish: 10_000 },
    });
    expect(setup.asked).toEqual([{ dry: false }]);
    // The edit's 2 s and the start-up's 3, then the publish's 10, at 8 GiB and 2 vCPUs.
    expect(ledger.held()).toMatchObject({
      dayGiBs: 40 + 80,
      dayRuns: 1,
      monthGiBs: 120,
      monthVcpuS: 10 + 20,
      open: null,
      failures: 0,
    });
    expect(line).toMatchObject({ kind: "team.state", end: "edited", publish: "published" });
  });

  it("publishes dry where the switch says dry, writing no member's boards", async () => {
    const ledger = memoryLedger(ledgerOf({ mode: "dry" }));
    const setup = setUp();
    const { reply } = await run(ledger.store, setup);
    expect(setup.asked).toEqual([{ dry: true }]);
    expect(reply).toMatchObject({ ok: true, publish: "published", published: false });
  });

  it("makes and charges the edit with the switch off, and publishes nothing", async () => {
    const ledger = memoryLedger(ledgerOf({ on: false }));
    const setup = setUp();
    const { reply } = await run(ledger.store, setup);
    expect(reply).toMatchObject({ ok: true, version: 8, publish: "off", published: false });
    expect(setup.asked).toEqual([]);
    expect(ledger.held()).toMatchObject({ dayGiBs: 16, dayRuns: 0 });
  });

  it("leaves the boards to the run already going, or to the caps, without waiting", async () => {
    const open = { at: NOW, day: TODAY, cost: RUN_CEILING, task: "rebuild", by: "other" };
    for (const [held, why] of [
      [ledgerOf({ open }), "busy"],
      [ledgerOf({ dayGiBs: DEFAULT_CAPS.dayGiBs }), "day-cap"],
      [ledgerOf({ pausedDay: TODAY, failures: 3 }), "failing"],
    ] as const) {
      const setup = setUp();
      expect((await run(memoryLedger(held).store, setup)).reply).toMatchObject({
        ok: true,
        publish: why,
      });
      expect(setup.asked).toEqual([]);
    }
  });

  it("publishes nothing for an edit that moved nothing, reserving no run", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp({ edit: async () => ({ ...EDITED, changed: [] }) as EditRun });
    expect((await run(ledger.store, setup)).reply).toMatchObject({ ok: true, publish: "none" });
    expect(setup.asked).toEqual([]);
    expect(ledger.held()).toMatchObject({ dayRuns: 0, open: null, dayGiBs: 16 });
  });

  it("says why an edit was refused, its compute charged and nothing published", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp({ edit: async () => ({ ok: false, why: "missing", tries: 1 }) });
    const { reply, line } = await run(ledger.store, setup);
    expect(reply).toEqual({ ok: false, why: "missing" });
    expect(line).toMatchObject({ end: "missing", tries: 1 });
    expect(setup.asked).toEqual([]);
    expect(ledger.held()).toMatchObject({ dayGiBs: 16, dayRuns: 0 });
  });

  it("charges an edit whose worker threw, and throws", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp({
      edit: async () => {
        throw new Error("the worker died");
      },
    });
    await expect(run(ledger.store, setup)).rejects.toThrow("the worker died");
    expect(ledger.held()).toMatchObject({ dayGiBs: 16 });
  });

  it("settles a publish that threw as a failed run, the edit still made", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp({
      publish: async () => {
        throw new Error("out of memory");
      },
    });
    const { reply, line } = await run(ledger.store, setup);
    expect(reply).toMatchObject({ ok: true, publish: "threw", published: false });
    expect(line).toMatchObject({ publishError: "out of memory" });
    expect(ledger.held()).toMatchObject({ failures: 1, dayFailed: 1, open: null });
  });

  it("answers the edit made when the ledger cannot be reached, publishing nothing", async () => {
    const failing: LedgerStore = {
      read: async () => {
        throw new Error("Firestore is busy");
      },
      replace: async () => false,
    };
    const setup = setUp();
    const { reply, line } = await run(failing, setup);
    expect(reply).toMatchObject({ ok: true, version: 8, publish: "unreachable", published: false });
    expect(line).toMatchObject({
      chargeError: "Firestore is busy",
      reserveError: "Firestore is busy",
    });
    expect(setup.asked).toEqual([]);
  });
});

describe("a warm-up", () => {
  const warmUp = (ledger: LedgerStore, worker: Pick<EditWorker, "warm">, clock: () => number) =>
    handleWarm({ ledger, worker, today: () => TODAY, clock, size: SIZE, startupS: () => 1 });

  it("brings the pool up and charges the time it took as an edit's", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp();
    const { warmed, line } = await warmUp(ledger.store, setup.worker, setup.clock);
    expect(warmed).toEqual({ ok: true, cold: true, fetched: 12, loadMs: 4_000 });
    expect(line).toMatchObject({ kind: "warm", end: "warmed", cold: true, fetched: 12 });
    // Four seconds of loading and one of start-up, at 8 GiB and 2 vCPUs, and no run counted.
    expect(ledger.held()).toMatchObject({ dayGiBs: 40, monthVcpuS: 10, dayRuns: 0, open: null });
  });

  it("says why the pool could not come up, and throws for a worker that did", async () => {
    const ledger = memoryLedger(ledgerOf());
    const refused = { warm: async () => ({ ok: false as const, reason: "no-copy" as const }) };
    expect(await warmUp(ledger.store, refused, () => 0)).toMatchObject({
      warmed: { ok: false, reason: "no-copy" },
      line: { end: "no-copy" },
    });
    const dead = {
      warm: async () => {
        throw new Error("the worker died");
      },
    };
    await expect(warmUp(ledger.store, dead, () => 0)).rejects.toThrow("the worker died");
  });
});
