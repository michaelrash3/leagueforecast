import { describe, expect, it } from "vitest";
import type { PoolCommand } from "../commands";
import type { EditRun, QueryRun } from "../editRun";
import {
  chargeQueue,
  handleEdit,
  handleQuery,
  handleWarm,
  NOT_ANSWERED,
  NOT_MADE,
  type EditWorker,
  type QueryAsk,
} from "../editHandle";
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
import { callableEncode } from "./callableEncode";

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
  lastEndedAt: null,
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

const QUERIED: QueryRun = {
  ok: true,
  copy: "c1",
  version: 8,
  answer: { kind: "merge.preview", found: true, games: 12, dropped: 2 },
  cold: false,
  fetched: 1,
  loadMs: 30,
  answerMs: 900,
};

/** A worker whose every edit is `edit`'s turn, and whose warm-up took four seconds. */
const workerOf = (edit: EditWorker["edit"] = async () => ran(EDITED)): EditWorker => ({
  edit,
  query: async () => ran(QUERIED, 1_000),
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

  it("is sent as JSON writes it, a field left undefined in what takes it back left out", async () => {
    const ledger = memoryLedger(ledgerOf());
    // A club put back with a field the record holds undefined, which the device reads exactly.
    const inverse = { kind: "team.put", team: { id: "A", name: "Club A", state: undefined } };
    const handled = await handleEdit({
      ask: { command: { kind: "team.state", teamId: "A", state: "KY" }, copy: "c1" },
      worker: { edit: async () => ran({ ...EDITED, inverse } as unknown as EditRun) },
      ledger: ledger.store,
      today: () => TODAY,
      size: SIZE,
      startupS: () => 0,
      charges: chargeQueue(),
    });
    if (!("reply" in handled)) throw new Error("not made");
    expect(callableEncode(handled.reply)).toEqual(handled.reply);
    expect(handled.reply).toMatchObject({
      inverse: { kind: "team.put", team: { id: "A", name: "Club A" } },
    });
    expect(Object.keys((handled.reply as { inverse: { team: object } }).inverse.team)).toEqual([
      "id",
      "name",
    ]);
  });

  it("sends nothing to take back an edit too big to take back as one, so it is offered no Undo", async () => {
    const ledger = memoryLedger(ledgerOf());
    const step: PoolCommand = { kind: "team.state", teamId: "A", state: null };
    const inverse: PoolCommand = {
      kind: "batch",
      commands: Array.from({ length: 501 }, () => step),
    };
    const handled = await handleEdit({
      ask: { command: step, copy: "c1" },
      worker: { edit: async () => ran({ ...EDITED, inverse }) },
      ledger: ledger.store,
      today: () => TODAY,
      size: SIZE,
      startupS: () => 0,
      charges: chargeQueue(),
    });
    expect(handled).toMatchObject({ reply: { ok: true, inverse: { kind: "none" } } });
    const fits: PoolCommand = { kind: "batch", commands: inverse.commands.slice(1) };
    const kept = await handleEdit({
      ask: { command: step, copy: "c1" },
      worker: { edit: async () => ran({ ...EDITED, inverse: fits }) },
      ledger: ledger.store,
      today: () => TODAY,
      size: SIZE,
      startupS: () => 0,
      charges: chargeQueue(),
    });
    expect(kept).toMatchObject({ reply: { ok: true, inverse: fits } });
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

describe("a question", () => {
  const QUESTION: QueryAsk = {
    query: { kind: "merge.preview", fromId: "A", intoId: "B", adopt: [] },
    copy: "c1",
  };
  const ask = (
    ledger: LedgerStore,
    worker: Pick<EditWorker, "query">,
    signal?: AbortSignal,
    {
      question = QUESTION,
      wait,
    }: { question?: QueryAsk; wait?: (ms: number) => Promise<void> } = {}
  ) =>
    handleQuery({
      ask: question,
      ledger,
      worker,
      today: () => TODAY,
      size: SIZE,
      startupS: () => 0,
      charges: chargeQueue(),
      ...(signal ? { signal } : {}),
      ...(wait ? { wait } : {}),
    });
  const CHECK: QueryAsk = { query: { kind: "model.check", page: "ag_12" }, copy: "c1" };

  it("is answered from the worker's pool, of the copy and version it was worked out on, and charged as an edit", async () => {
    const ledger = memoryLedger(ledgerOf());
    const asked: unknown[] = [];
    const handled = await ask(ledger.store, {
      query: async (question) => {
        asked.push(question);
        return ran(QUERIED, 1_000);
      },
    });
    expect(asked).toEqual([QUESTION]);
    expect(handled).toEqual({
      reply: {
        ok: true,
        copy: "c1",
        version: 8,
        answer: { kind: "merge.preview", found: true, games: 12, dropped: 2 },
      },
      line: {
        kind: "merge.preview",
        gibs: 8,
        heapUsedMb: 500,
        rssMb: 1_201,
        heapLimitMb: 2_600,
        end: "answered",
        copy: "c1",
        version: 8,
        cold: false,
        fetched: 1,
        loadMs: 30,
        answerMs: 900,
      },
    });
    // One second in the worker at 8 GiB and 2 vCPUs; no run reserved or counted.
    expect(ledger.held()).toMatchObject({ dayGiBs: 8, monthVcpuS: 2, dayRuns: 0, open: null });
  });

  it("is sent as JSON writes it, so the callable sends it as it is", async () => {
    const ledger = memoryLedger(ledgerOf());
    // An answer with a number that has no end and a field left undefined, as a model check's is.
    const answer = { kind: "model.check", answer: { cap: Infinity, last: undefined, runs: [1] } };
    const handled = await ask(ledger.store, {
      query: async () => ran({ ...QUERIED, answer } as unknown as QueryRun, 1_000),
    });
    if (!("reply" in handled)) throw new Error("not answered");
    const sent = callableEncode(handled.reply);
    expect(sent).toEqual(handled.reply);
    expect(sent).toEqual({
      ok: true,
      copy: "c1",
      version: 8,
      answer: { kind: "model.check", answer: { cap: null, runs: [1] } },
    });
  });

  it("says why it went unanswered on the copy, its turn charged", async () => {
    const ledger = memoryLedger(ledgerOf());
    expect(
      await ask(ledger.store, { query: async () => ran({ ok: false, why: "copy-replaced" }) })
    ).toMatchObject({ reply: { ok: false, why: "copy-replaced" }, line: { end: "copy-replaced" } });
    expect(ledger.held()).toMatchObject({ dayGiBs: 16 });
  });

  it("is only to be asked again when the worker failed with it or never had it, whatever it was doing", async () => {
    const ledger = memoryLedger(ledgerOf());
    for (const lost of [true, false]) {
      expect(
        await ask(ledger.store, {
          query: async () => {
            throw new TurnFailed("the worker died", 500, lost);
          },
        })
      ).toEqual({
        notAnswered: NOT_ANSWERED,
        line: { kind: "merge.preview", gibs: 4, end: "threw", error: "the worker died" },
      });
    }
    for (const why of ["gone", "late"] as const) {
      expect(await ask(ledger.store, { query: async () => ({ ran: false, why }) })).toEqual({
        notAnswered: NOT_ANSWERED,
        line: { kind: "merge.preview", gibs: 0, end: why },
      });
    }
    // A question changes nothing, so nothing in what the device is told says it may have.
    expect(NOT_ANSWERED).toMatch(/nothing was changed/);
  });

  it("that refits a year is refused once the day's or the month's compute is spent, never reaching the pool", async () => {
    const spent: Array<[Partial<Ledger>, string]> = [
      [{ dayGiBs: DEFAULT_CAPS.dayGiBs }, "day-spent"],
      [{ monthGiBs: DEFAULT_CAPS.monthGiBs }, "month-spent"],
      [{ monthVcpuS: DEFAULT_CAPS.monthVcpuS }, "month-spent"],
      // Both spent: the month's lasts the longer, so it is the one said.
      [{ dayGiBs: DEFAULT_CAPS.dayGiBs, monthGiBs: DEFAULT_CAPS.monthGiBs }, "month-spent"],
      // Spent with the switch off too, as an edit is charged either way.
      [{ on: false, dayGiBs: DEFAULT_CAPS.dayGiBs }, "day-spent"],
    ];
    for (const [more, why] of spent) {
      const ledger = memoryLedger(ledgerOf(more));
      const asked: unknown[] = [];
      for (const question of [
        CHECK,
        {
          query: {
            kind: "scouting.whatIf",
            page: "ag_12",
            segment: null,
            forTeamId: "A",
            game: { id: "0", date: "2027-05-01", teamAId: "A", teamBId: "B", ageGroupId: "ag_12" },
            today: TODAY,
          },
          copy: "c1",
        } satisfies QueryAsk,
      ]) {
        expect(
          await ask(
            ledger.store,
            {
              query: async (one) => {
                asked.push(one);
                return ran(QUERIED);
              },
            },
            undefined,
            { question }
          )
        ).toEqual({
          reply: { ok: false, why },
          line: { kind: question.query.kind, end: why },
        });
      }
      expect(asked).toEqual([]);
      // Nothing was spent, so nothing is charged.
      expect(ledger.held()).toEqual(coerceLedger(ledgerOf(more)));
    }
  });

  it("that refits a year is answered on a new day, whatever the last day spent, and below the caps", async () => {
    for (const more of [
      { day: "2027-04-14", dayGiBs: DEFAULT_CAPS.dayGiBs },
      { month: "2027-03", monthGiBs: DEFAULT_CAPS.monthGiBs },
      { dayGiBs: DEFAULT_CAPS.dayGiBs - 1, monthGiBs: DEFAULT_CAPS.monthGiBs - 1 },
    ]) {
      const ledger = memoryLedger(ledgerOf(more));
      expect(await ask(ledger.store, workerOf(), undefined, { question: CHECK })).toMatchObject({
        reply: { ok: true },
        line: { end: "answered" },
      });
    }
    // No ledger meters nothing.
    expect(
      await ask(memoryLedger(null).store, workerOf(), undefined, { question: CHECK })
    ).toMatchObject({ reply: { ok: true } });
  });

  it("that only reads the pool is answered at the caps, as an edit is made at them", async () => {
    const ledger = memoryLedger(ledgerOf({ dayGiBs: DEFAULT_CAPS.dayGiBs }));
    expect(await ask(ledger.store, workerOf())).toMatchObject({
      reply: { ok: true },
      line: { end: "answered" },
    });
  });

  it("that refits is answered, and the line says so, when the ledger cannot be read or is slow", async () => {
    const failing: LedgerStore = {
      read: async () => {
        throw new Error("Firestore is busy");
      },
      replace: async () => false,
    };
    expect(await ask(failing, workerOf(), undefined, { question: CHECK })).toMatchObject({
      reply: { ok: true },
      line: { ledgerError: "Firestore is busy", end: "answered" },
    });
    const silent: LedgerStore = {
      read: () => new Promise(() => undefined),
      replace: async () => true,
    };
    const waited: number[] = [];
    const handled = await ask(silent, workerOf(), undefined, {
      question: CHECK,
      wait: async (ms) => {
        waited.push(ms);
      },
    });
    expect(handled).toMatchObject({
      reply: { ok: true },
      line: { ledgerError: "The ledger was slow; the question was answered.", end: "answered" },
    });
    // Once before the question and once for its charge.
    expect(waited).toEqual([5_000, 5_000]);
    // A ledger that answered in time is not called slow once the wait runs out behind it.
    const answered = await ask(
      memoryLedger(ledgerOf()).store,
      { query: () => new Promise((resolve) => setTimeout(() => resolve(ran(QUERIED)), 20)) },
      undefined,
      { question: CHECK, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 1_000)) }
    );
    expect(answered.line).not.toHaveProperty("ledgerError");
  });

  it("hands the request's own end to the worker, so a question whose caller has gone is never sent", async () => {
    const ledger = memoryLedger(ledgerOf());
    const ended = new AbortController();
    ended.abort();
    const seen: unknown[] = [];
    await ask(
      ledger.store,
      {
        query: async (_question, turn) => {
          seen.push(turn);
          return { ran: false, why: "gone" };
        },
      },
      ended.signal
    );
    expect(seen).toEqual([{ signal: ended.signal }]);
  });
});
