import { describe, expect, it } from "vitest";
import type { EditRun } from "../editRun";
import { chargeQueue, handleEdit, handleWarm, NOT_MADE, type EditWorker } from "../editHandle";
import {
  editRunner,
  TurnFailed,
  type EditPort,
  type EditRequest,
  type EditWorkerAnswer,
  type Turned,
} from "../editWorkerProtocol";
import { coerceLedger, DEFAULT_CAPS, type Ledger, type LedgerStore } from "../rebuildLedger";
import type { WorkerMemory } from "../rebuildWorkerProtocol";

/*
 * One request to the edit function on its main thread (`editHandle.ts`): the edit made whatever the
 * ledger says, its turn in the worker charged, and the device answered as soon as the save has
 * landed, or told the edit may or may not be in the copy, or that it was not made.
 */

const TODAY = "2027-04-15";
const SIZE = { gib: 8, cpu: 2 };
const MEMORY: WorkerMemory = { heapUsedMb: 500.4, rssMb: 1_200.6, heapLimitMb: 2_600.2 };
const ASK = { command: { kind: "team.state", teamId: "B", state: "KY" }, copy: "c1" } as const;

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

/** The ledger's document in memory, each read and write a turn of the event loop apart. */
const memoryLedger = (raw: unknown) => {
  let doc: { raw: unknown; token: string } | null = raw === null ? null : { raw, token: "t0" };
  let version = 0;
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const store: LedgerStore = {
    read: async () => {
      await tick();
      return doc ? { raw: structuredClone(doc.raw), token: doc.token } : { raw: null, token: null };
    },
    replace: async (token, next) => {
      await tick();
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

const ran = <T>(result: T, busyMs = 2_000): Turned<T> => ({
  ran: true,
  result,
  busyMs,
  memory: MEMORY,
});

/** A worker whose every edit is `edit`'s turn, and whose warm-up took four seconds. */
const workerOf = (edit: EditWorker["edit"] = async () => ran(EDITED)): EditWorker => ({
  edit,
  warm: async () => ran({ ok: true, cold: true, fetched: 12, loadMs: 4_000 }, 4_000),
});

const run = (
  ledger: LedgerStore,
  worker: EditWorker,
  { startupS = 0, wait }: { startupS?: number; wait?: (ms: number) => Promise<void> } = {}
) =>
  handleEdit({
    ask: ASK,
    ledger,
    worker,
    today: () => TODAY,
    size: SIZE,
    startupS: () => startupS,
    charges: chargeQueue(),
    ...(wait ? { wait } : {}),
  });

describe("an edit request", () => {
  it("makes the edit and answers as soon as it is saved, its turn in the worker charged", async () => {
    const ledger = memoryLedger(ledgerOf());
    const handled = await run(ledger.store, workerOf(), { startupS: 3 });
    expect(handled).toMatchObject({
      reply: {
        ok: true,
        copy: "c1",
        version: 8,
        inverse: EDITED.ok ? EDITED.inverse : null,
        changed: EDITED.ok ? EDITED.changed : [],
        ms: { load: 40, apply: 5, commit: 300 },
      },
    });
    // The turn's 2 s and the start-up's 3, at 8 GiB and 2 vCPUs; no run reserved or counted.
    expect(ledger.held()).toMatchObject({
      dayGiBs: 40,
      dayRuns: 0,
      monthGiBs: 40,
      monthVcpuS: 10,
      open: null,
    });
    expect(handled.line).toEqual({
      kind: "team.state",
      gibs: 40,
      heapUsedMb: 500,
      rssMb: 1_201,
      heapLimitMb: 2_600,
      end: "edited",
      copy: "c1",
      version: 8,
      changed: 1,
      tries: 1,
      cold: false,
      fetched: 0,
      loadMs: 40,
      applyMs: 5,
      commitMs: 300,
    });
  });

  it("makes and charges the edit with the switch off, at the caps, and while paused", async () => {
    for (const held of [
      ledgerOf({ on: false }),
      ledgerOf({ dayGiBs: DEFAULT_CAPS.dayGiBs }),
      ledgerOf({ pausedDay: TODAY, failures: 3 }),
    ]) {
      const ledger = memoryLedger(held);
      expect(await run(ledger.store, workerOf())).toMatchObject({
        reply: { ok: true, version: 8 },
      });
      expect(ledger.held()?.dayGiBs).toBe(held.dayGiBs + 16);
    }
  });

  it("says why an edit was refused, its turn charged", async () => {
    const ledger = memoryLedger(ledgerOf());
    const handled = await run(
      ledger.store,
      workerOf(async () => ran({ ok: false, why: "missing", tries: 1 }))
    );
    expect(handled).toMatchObject({
      reply: { ok: false, why: "missing" },
      line: { end: "missing", tries: 1 },
    });
    expect(ledger.held()).toMatchObject({ dayGiBs: 16, dayRuns: 0 });
  });

  it("says the edit may or may not be in the copy when the worker was lost with it", async () => {
    const ledger = memoryLedger(ledgerOf());
    const handled = await run(
      ledger.store,
      workerOf(async () => {
        throw new TurnFailed("The edit ran out of memory in its worker.", 3_000, true);
      })
    );
    expect(handled).toEqual({
      reply: { ok: false, why: "unsure" },
      line: {
        kind: "team.state",
        gibs: 24,
        error: "The edit ran out of memory in its worker.",
        end: "unsure",
      },
    });
    expect(ledger.held()).toMatchObject({ dayGiBs: 24 });
  });

  it("says the edit was not made when the worker said it threw, or failed before having it", async () => {
    const ledger = memoryLedger(ledgerOf());
    const threw = await run(
      ledger.store,
      workerOf(async () => {
        throw new TurnFailed("a piece would not upload", 1_000, false);
      })
    );
    expect(threw).toMatchObject({
      notMade: NOT_MADE.threw,
      line: { end: "threw", error: "a piece would not upload", gibs: 8 },
    });
    const unstarted = await run(
      ledger.store,
      workerOf(async () => {
        throw new Error("The worker would not start.");
      })
    );
    expect(unstarted).toMatchObject({ notMade: NOT_MADE.threw, line: { end: "threw", gibs: 0 } });
    expect(ledger.held()).toMatchObject({ dayGiBs: 8 });
  });

  it("says the edit was not made, never sent, when its caller went or its time ran out", async () => {
    for (const why of ["gone", "late"] as const) {
      const ledger = memoryLedger(ledgerOf());
      const handled = await run(
        ledger.store,
        workerOf(async () => ({ ran: false, why }))
      );
      expect(handled).toEqual({
        notMade: NOT_MADE[why],
        line: { kind: "team.state", gibs: 0, end: why },
      });
    }
  });

  it("hands the request's own end to the worker, so a call whose caller has gone is never sent", async () => {
    const heard: Array<AbortSignal | undefined> = [];
    const gone = new AbortController();
    gone.abort();
    await handleEdit({
      ask: ASK,
      ledger: memoryLedger(ledgerOf()).store,
      worker: workerOf(async (_ask, turn) => {
        heard.push(turn?.signal);
        return { ran: false, why: "gone" };
      }),
      today: () => TODAY,
      size: SIZE,
      startupS: () => 0,
      charges: chargeQueue(),
      signal: gone.signal,
    });
    expect(heard).toEqual([gone.signal]);
  });

  it("charges each call its own turn in the worker, not its wait in line", async () => {
    // Eight calls at once on the real runner, each edit holding the worker ten seconds.
    let t = 0;
    const spawn = (): EditPort => {
      let listeners: Parameters<EditPort["listen"]>[0] | null = null;
      return {
        post: (request: EditRequest) => {
          t += 10_000;
          const answer: EditWorkerAnswer =
            request.kind === "edit"
              ? { kind: "edited", id: request.id, result: EDITED, memory: MEMORY }
              : { kind: "pong", id: request.id };
          queueMicrotask(() => listeners?.answer(answer));
        },
        listen: (given) => {
          listeners = given;
        },
        terminate: async () => undefined,
      };
    };
    const runner = editRunner({ spawn, clock: () => t });
    const ledger = memoryLedger(ledgerOf());
    const charges = chargeQueue();
    const calls = Array.from({ length: 8 }, () =>
      handleEdit({
        ask: ASK,
        ledger: ledger.store,
        worker: runner,
        today: () => TODAY,
        size: SIZE,
        startupS: () => 0,
        charges,
      })
    );
    const handled = await Promise.all(calls);
    expect(handled.every((one) => "reply" in one && one.reply.ok)).toBe(true);
    // Eighty seconds the worker was busy, at 8 GiB: what the instance is billed.
    expect({ busyS: t / 1000, charged: ledger.held()?.dayGiBs }).toEqual({
      busyS: 80,
      charged: 640,
    });
  });

  it("charges one call at a time, so no charge is lost under another", async () => {
    const ledger = memoryLedger(ledgerOf());
    const charges = chargeQueue();
    const handled = await Promise.all(
      Array.from({ length: 8 }, () =>
        handleEdit({
          ask: ASK,
          ledger: ledger.store,
          worker: workerOf(),
          today: () => TODAY,
          size: SIZE,
          startupS: () => 0,
          charges,
        })
      )
    );
    expect(handled.map((one) => one.line.chargeError)).toEqual(Array(8).fill(undefined));
    expect(ledger.held()?.dayGiBs).toBe(8 * 16);
  });

  it("answers the edit made, and says so in the line, when the ledger cannot be charged", async () => {
    const failing: LedgerStore = {
      read: async () => {
        throw new Error("Firestore is busy");
      },
      replace: async () => false,
    };
    expect(await run(failing, workerOf())).toMatchObject({
      reply: { ok: true, version: 8 },
      line: { chargeError: "Firestore is busy" },
    });
    const crowded: LedgerStore = {
      read: async () => ({ raw: ledgerOf(), token: "t0" }),
      replace: async () => false,
    };
    expect(await run(crowded, workerOf())).toMatchObject({
      reply: { ok: true, version: 8 },
      line: { chargeError: "Other writers had the ledger on every try." },
    });
  });

  it("does not hold the answer on a ledger that does not answer", async () => {
    const silent: LedgerStore = {
      read: () => new Promise(() => undefined),
      replace: async () => true,
    };
    const waited: number[] = [];
    const handled = await run(silent, workerOf(), {
      wait: async (ms) => {
        waited.push(ms);
      },
    });
    expect(handled).toMatchObject({
      reply: { ok: true, version: 8 },
      line: { chargeError: "The ledger was slow; the charge was left to finish." },
    });
    expect(waited).toEqual([5_000]);
  });
});

describe("a warm-up", () => {
  const warmUp = (ledger: LedgerStore, worker: Pick<EditWorker, "warm">) =>
    handleWarm({
      ledger,
      worker,
      today: () => TODAY,
      size: SIZE,
      startupS: () => 1,
      charges: chargeQueue(),
    });

  it("brings the pool up and charges its turn as an edit's", async () => {
    const ledger = memoryLedger(ledgerOf());
    const { warmed, line } = await warmUp(ledger.store, workerOf());
    expect(warmed).toEqual({ ok: true, cold: true, fetched: 12, loadMs: 4_000 });
    expect(line).toMatchObject({ kind: "warm", end: "warmed", cold: true, fetched: 12 });
    // Four seconds of loading and one of start-up, at 8 GiB and 2 vCPUs, and no run counted.
    expect(ledger.held()).toMatchObject({ dayGiBs: 40, monthVcpuS: 10, dayRuns: 0, open: null });
  });

  it("says why the pool could not come up, and brings none up for a worker that failed or a caller gone", async () => {
    const ledger = memoryLedger(ledgerOf());
    expect(
      await warmUp(ledger.store, { warm: async () => ran({ ok: false, reason: "no-copy" }) })
    ).toMatchObject({ warmed: { ok: false, reason: "no-copy" }, line: { end: "no-copy" } });
    expect(
      await warmUp(ledger.store, {
        warm: async () => {
          throw new TurnFailed("the worker died", 500, true);
        },
      })
    ).toMatchObject({ warmed: null, line: { end: "threw", error: "the worker died" } });
    expect(await warmUp(ledger.store, { warm: async () => ({ ran: false, why: "gone" }) })).toEqual(
      {
        warmed: null,
        line: { kind: "warm", gibs: 8, end: "gone" },
      }
    );
  });
});
