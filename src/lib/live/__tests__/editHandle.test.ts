import { describe, expect, it } from "vitest";
import type { EditRun } from "../editRun";
import { handleEdit, handleWarm, type EditWorker } from "../editHandle";
import { coerceLedger, DEFAULT_CAPS, type Ledger, type LedgerStore } from "../rebuildLedger";

/*
 * One request to the edit function on its main thread (`editHandle.ts`): the edit made whatever the
 * ledger says, its compute charged, and the device answered as soon as the save has landed; the
 * boards are the save's own rebuild's to publish.
 */

const TODAY = "2027-04-15";
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

/** A worker whose edit takes `editS` seconds and warm-up four, on the clock it moves. */
const setUp = ({
  edit = async () => EDITED,
  editS = 2,
}: {
  edit?: EditWorker["edit"];
  editS?: number;
} = {}) => {
  let t = 1_000_000;
  const worker: EditWorker = {
    edit: async (ask) => {
      t += editS * 1000;
      return edit(ask);
    },
    warm: async () => {
      t += 4_000;
      return { ok: true, cold: true, fetched: 12, loadMs: 4_000 };
    },
  };
  return { worker, clock: () => t };
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
    clock,
    size: SIZE,
    startupS: () => startupS,
  });

describe("an edit request", () => {
  it("makes the edit and answers as soon as it is saved, its compute charged", async () => {
    const ledger = memoryLedger(ledgerOf());
    const { reply, line } = await run(ledger.store, setUp(), 3);
    expect(reply).toEqual({
      ok: true,
      copy: "c1",
      version: 8,
      inverse: EDITED.ok ? EDITED.inverse : null,
      changed: EDITED.ok ? EDITED.changed : [],
      ms: { load: 40, apply: 5, commit: 300 },
    });
    // The edit's 2 s and the start-up's 3, at 8 GiB and 2 vCPUs; no run reserved or counted.
    expect(ledger.held()).toMatchObject({
      dayGiBs: 40,
      dayRuns: 0,
      monthGiBs: 40,
      monthVcpuS: 10,
      open: null,
    });
    expect(line).toMatchObject({
      kind: "team.state",
      end: "edited",
      copy: "c1",
      version: 8,
      changed: 1,
      gibs: 40,
    });
  });

  it("makes and charges the edit with the switch off, at the caps, and while paused", async () => {
    for (const held of [
      ledgerOf({ on: false }),
      ledgerOf({ dayGiBs: DEFAULT_CAPS.dayGiBs }),
      ledgerOf({ pausedDay: TODAY, failures: 3 }),
    ]) {
      const ledger = memoryLedger(held);
      expect((await run(ledger.store, setUp())).reply).toMatchObject({ ok: true, version: 8 });
      expect(ledger.held()?.dayGiBs).toBe(held.dayGiBs + 16);
    }
  });

  it("says why an edit was refused, its compute charged", async () => {
    const ledger = memoryLedger(ledgerOf());
    const setup = setUp({ edit: async () => ({ ok: false, why: "missing", tries: 1 }) });
    const { reply, line } = await run(ledger.store, setup);
    expect(reply).toEqual({ ok: false, why: "missing" });
    expect(line).toMatchObject({ end: "missing", tries: 1 });
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

  it("answers the edit made when the ledger cannot be charged", async () => {
    const failing: LedgerStore = {
      read: async () => {
        throw new Error("Firestore is busy");
      },
      replace: async () => false,
    };
    const { reply, line } = await run(failing, setUp());
    expect(reply).toMatchObject({ ok: true, version: 8 });
    expect(line).toMatchObject({ chargeError: "Firestore is busy" });
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
