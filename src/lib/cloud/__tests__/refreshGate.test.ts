import { describe, expect, it } from "vitest";
import { newPullJob, newRefreshJob, type PullJob } from "../pullJobs";
import type { JobDocs, LegTask } from "../pullJobRunner";
import {
  budgetDay,
  chargeRefreshLegs,
  coerceRefreshAsk,
  coerceRefreshGate,
  NIGHTLY_HOLD_MS,
  NOT_QUEUED,
  nightlyEndsTurn,
  nightlyTakesTurn,
  REFRESH_GATE_PATH,
  REFRESH_LEGS_A_DAY,
  REFRESH_QUIET_MS,
  REFRESH_ZONE,
  startRefresh,
  type GateDocs,
  type RefreshGate,
} from "../refreshGate";

/*
 * Who is refreshing the cloud copy, and what "Refresh now" may still spend today (`refreshGate.ts`):
 * one press starts one refresh, a second is shown the first, the nightly and a press never pull
 * beside each other, and the day's legs run out. Every change is made only onto the gate as it was
 * read, so two writers at once cannot both take it.
 */

/** 3 p.m. in New York on 10 October 2026. */
const NOW = new Date("2026-10-10T19:00:00.000Z");
const ASK = { device: "device-abc-123" };
const OTHER = "a".repeat(32);

/** The gate document in memory, written only at the token it was read at, as Firestore's is. */
const memoryGate = (start: Record<string, unknown> | null = null) => {
  let held: { fields: Record<string, unknown>; token: string } | null = start
    ? { fields: start, token: "t0" }
    : null;
  let clock = 0;
  const paths: string[] = [];
  /** Run once before the next write lands, as another writer getting there first. */
  let before: (() => Promise<void>) | null = null;
  const docs: GateDocs = {
    readAt: async (path) => {
      paths.push(path);
      return held ? structuredClone(held) : null;
    },
    replace: async (path, fields, token) => {
      paths.push(path);
      const first = before;
      before = null;
      if (first) await first();
      if ((held?.token ?? null) !== token) return false;
      clock += 1;
      held = { fields: structuredClone(fields), token: `t${clock}` };
      return true;
    },
  };
  return {
    docs,
    paths,
    gate: () => (held ? coerceRefreshGate(held.fields) : null),
    raw: () => held?.fields ?? null,
    set: (fields: Record<string, unknown>) => {
      clock += 1;
      held = { fields, token: `t${clock}` };
    },
    racedBy: (write: () => Promise<void>) => {
      before = write;
    },
  };
};

/** Jobs in memory, made only where there is none. */
const memoryJobs = () => {
  const jobs = new Map<string, PullJob>();
  const docs: Pick<JobDocs, "read" | "create" | "update"> = {
    read: async (jobId) => (jobs.has(jobId) ? structuredClone(jobs.get(jobId)!) : null),
    create: async (jobId, job) => {
      if (jobs.has(jobId)) return false;
      jobs.set(jobId, structuredClone(job));
      return true;
    },
    update: async (jobId, patch) => {
      const job = jobs.get(jobId);
      if (!job) throw new Error("no such job");
      jobs.set(jobId, { ...job, ...structuredClone(patch) });
    },
  };
  return { docs, jobs };
};

const refreshAt = (status: PullJob["status"], updatedAt = NOW.toISOString()): PullJob => ({
  ...newRefreshJob({ timeZone: REFRESH_ZONE, ...ASK, now: "2026-10-10T18:00:00.000Z" }),
  status,
  updatedAt,
});

const setUp = (gate: Record<string, unknown> | null = null) => {
  const store = memoryGate(gate);
  const jobs = memoryJobs();
  const queued: LegTask[] = [];
  let ids = 0;
  const deps = {
    gate: store.docs,
    jobs: jobs.docs,
    enqueue: async (task: LegTask) => {
      queued.push(task);
    },
    now: () => NOW,
    newId: () => {
      ids += 1;
      return String(ids).padStart(32, "0");
    },
  };
  return { store, jobs, queued, deps };
};

const FIRST = "0".repeat(31) + "1";

describe("a member's asking for Refresh now", () => {
  it("is read exactly: a device's name, and nothing else, its time zone included", () => {
    expect(coerceRefreshAsk(ASK)).toEqual(ASK);
    expect(coerceRefreshAsk(JSON.parse(JSON.stringify(ASK)))).toEqual(ASK);
    for (const raw of [
      null,
      "refresh",
      [],
      {},
      { timeZone: "America/Chicago" },
      // The day is New York's for every refresh, so a device's zone is not the device's to send.
      { ...ASK, timeZone: "America/Chicago" },
      { ...ASK, timeZone: "America/New_York" },
      { ...ASK, device: 5 },
      { ...ASK, device: "" },
      { ...ASK, device: "x".repeat(65) },
      { ...ASK, device: "a device/../with slashes" },
      { ...ASK, list: ["gcACES000001"] },
    ]) {
      expect(coerceRefreshAsk(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("starting Refresh now", () => {
  it("makes the job, names it in the gate, charges the day's first leg, and queues it", async () => {
    const { store, jobs, queued, deps } = setUp();
    expect(await startRefresh(ASK, deps)).toEqual({
      ok: true,
      jobId: FIRST,
      status: "queued",
      already: false,
    });
    expect(jobs.jobs.get(FIRST)).toEqual(
      newRefreshJob({ timeZone: "America/New_York", ...ASK, now: NOW.toISOString() })
    );
    expect(store.gate()).toEqual({ jobId: FIRST, nightlyAt: null, day: "2026-10-10", legs: 1 });
    expect(queued).toEqual([{ jobId: FIRST, leg: 0 }]);
    expect(new Set(store.paths)).toEqual(new Set([REFRESH_GATE_PATH]));
  });

  it("shows a refresh under way rather than starting another, queueing again one still queued", async () => {
    const { store, jobs, queued, deps } = setUp({
      jobId: OTHER,
      nightlyAt: null,
      day: "2026-10-10",
      legs: 1,
    });
    jobs.jobs.set(OTHER, refreshAt("queued"));
    expect(await startRefresh(ASK, deps)).toEqual({
      ok: true,
      jobId: OTHER,
      status: "queued",
      already: true,
    });
    // Its first leg queued again, which a leg already queued under that name makes nothing of.
    expect(queued).toEqual([{ jobId: OTHER, leg: 0 }]);
    jobs.jobs.set(OTHER, refreshAt("running"));
    expect(await startRefresh(ASK, deps)).toMatchObject({ jobId: OTHER, already: true });
    expect(queued).toHaveLength(1);
    expect(jobs.jobs.size).toBe(1);
    expect(store.gate()?.legs).toBe(1);
  });

  it("starts afresh once the last is over, or has not been heard from in a long while", async () => {
    for (const last of [
      refreshAt("done"),
      refreshAt("failed"),
      refreshAt("cancelled"),
      refreshAt("running", new Date(NOW.getTime() - REFRESH_QUIET_MS).toISOString()),
    ]) {
      const { jobs, deps } = setUp({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
      jobs.jobs.set(OTHER, last);
      expect(await startRefresh(ASK, deps), last.status).toMatchObject({
        ok: true,
        jobId: FIRST,
        already: false,
      });
    }
    // A job the gate names that is gone, or is a pasted list, is none under way either.
    const gone = setUp({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    expect(await startRefresh(ASK, gone.deps)).toMatchObject({ jobId: FIRST, already: false });
    const list = setUp({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    list.jobs.jobs.set(OTHER, {
      ...newPullJob({
        list: { hash: "b".repeat(64), teams: 1, pieces: 1 },
        seasonYears: [],
        timeZone: "America/New_York",
        device: "phone",
        now: NOW.toISOString(),
      }),
      status: "running",
    });
    expect(await startRefresh(ASK, list.deps)).toMatchObject({ jobId: FIRST, already: false });
  });

  it("is refused while the nightly is pulling, and not once its hold has run out", async () => {
    const pulling = { jobId: null, nightlyAt: "2026-10-10T18:30:00.000Z", day: "", legs: 0 };
    const { jobs, queued, deps } = setUp(pulling);
    expect(await startRefresh(ASK, deps)).toEqual({
      ok: false,
      refusal: "failed-precondition",
      message: expect.stringMatching(/nightly refresh is pulling/),
    });
    expect(jobs.jobs.size).toBe(0);
    expect(queued).toEqual([]);
    const stale = setUp({
      ...pulling,
      nightlyAt: new Date(NOW.getTime() - NIGHTLY_HOLD_MS).toISOString(),
    });
    expect(await startRefresh(ASK, stale.deps)).toMatchObject({ ok: true, already: false });
  });

  it("is refused once the day's legs are spent, and counts afresh on a new New York day", async () => {
    const spent = setUp({ jobId: null, nightlyAt: null, day: "2026-10-10", legs: 3 });
    expect(REFRESH_LEGS_A_DAY).toBe(3);
    expect(await startRefresh(ASK, spent.deps)).toEqual({
      ok: false,
      refusal: "resource-exhausted",
      message: expect.stringMatching(/as often today as the cloud allows in a day/),
    });
    expect(spent.jobs.jobs.size).toBe(0);
    const left = setUp({ jobId: null, nightlyAt: null, day: "2026-10-10", legs: 2 });
    expect(await startRefresh(ASK, left.deps)).toMatchObject({ ok: true });
    expect(left.store.gate()?.legs).toBe(3);
    const yesterday = setUp({ jobId: null, nightlyAt: null, day: "2026-10-09", legs: 3 });
    expect(await startRefresh(ASK, yesterday.deps)).toMatchObject({ ok: true });
    expect(yesterday.store.gate()).toMatchObject({ day: "2026-10-10", legs: 1 });
  });

  it("starts one refresh of two presses at once, the other shown it, its own job never run", async () => {
    const { store, jobs, queued, deps } = setUp();
    // Another press takes the gate between this one's read and its write.
    store.racedBy(async () => {
      jobs.jobs.set(OTHER, refreshAt("queued"));
      store.set({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    });
    expect(await startRefresh(ASK, deps)).toEqual({
      ok: true,
      jobId: OTHER,
      status: "queued",
      already: true,
    });
    expect(store.gate()).toMatchObject({ jobId: OTHER, legs: 1 });
    // The job it made before the gate turned it away is ended, and never queued.
    expect(jobs.jobs.get(FIRST)).toMatchObject({ status: "failed" });
    expect(queued).toEqual([{ jobId: OTHER, leg: 0 }]);
  });

  it("is refused, starting nothing, when the nightly takes the gate first", async () => {
    const { store, jobs, queued, deps } = setUp();
    store.racedBy(async () => {
      store.set({ jobId: null, nightlyAt: NOW.toISOString(), day: "", legs: 0 });
    });
    expect(await startRefresh(ASK, deps)).toMatchObject({
      ok: false,
      refusal: "failed-precondition",
    });
    expect(jobs.jobs.get(FIRST)).toMatchObject({ status: "failed" });
    expect(queued).toEqual([]);
  });

  it("ends the job, and gives the day its leg back, when its first leg cannot be queued", async () => {
    const { store, jobs, deps } = setUp({
      jobId: null,
      nightlyAt: null,
      day: "2026-10-10",
      legs: 1,
    });
    const refused = {
      ...deps,
      enqueue: async () => {
        throw new Error("Cloud Tasks is unavailable.");
      },
    };
    expect(await startRefresh(ASK, refused)).toEqual({
      ok: false,
      refusal: "unavailable",
      message: NOT_QUEUED,
    });
    expect(jobs.jobs.get(FIRST)).toMatchObject({ status: "failed", error: NOT_QUEUED });
    expect(store.gate()).toMatchObject({ jobId: FIRST, legs: 1 });
    // So a nightly finds nothing under way to wait for, and the next press starts afresh.
    const turn = await nightlyTakesTurn({
      gate: store.docs,
      readJob: jobs.docs.read,
      now: () => NOW,
      sleep: async () => undefined,
    });
    expect(turn).toMatchObject({ waitedMs: 0, stillRunning: false });
    await nightlyEndsTurn(store.docs, turn.at!);
    expect(await startRefresh(ASK, deps)).toMatchObject({ ok: true, already: false });
    expect(store.gate()).toMatchObject({ legs: 2 });

    // A gate another press has moved on meanwhile keeps what it was moved to.
    const moved = setUp({ jobId: null, nightlyAt: null, day: "2026-10-10", legs: 1 });
    const overtaken = {
      ...moved.deps,
      enqueue: async () => {
        moved.store.set({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 3 });
        throw new Error("Cloud Tasks is unavailable.");
      },
    };
    expect(await startRefresh(ASK, overtaken)).toMatchObject({ refusal: "unavailable" });
    expect(moved.store.gate()).toMatchObject({ jobId: OTHER, legs: 3 });
  });

  it("counts the day as New York's, whatever the server's own zone", () => {
    // 11:30 p.m. in New York is the next day in UTC.
    expect(budgetDay(new Date("2026-10-11T03:30:00.000Z"))).toBe("2026-10-10");
    expect(budgetDay(new Date("2026-10-11T04:30:00.000Z"))).toBe("2026-10-11");
  });
});

describe("the gate as read", () => {
  it("is whatever of it reads, and empty where nothing does, so a hand edit cannot lock it", () => {
    const good: RefreshGate = { jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 2 };
    expect(coerceRefreshGate(good)).toEqual(good);
    expect(coerceRefreshGate(null)).toEqual({ jobId: null, nightlyAt: null, day: "", legs: 0 });
    expect(coerceRefreshGate({ ...good, jobId: "../copies/main", legs: -1 })).toEqual({
      jobId: null,
      nightlyAt: null,
      day: "2026-10-10",
      legs: 0,
    });
  });
});

describe("the legs a refresh runs past its first", () => {
  it("are charged to the day it runs, onto the gate as it is", async () => {
    const store = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 0 });
    expect(await chargeRefreshLegs(store.docs, 1, NOW)).toBe(true);
    expect(store.gate()).toEqual({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    // Another writer between the read and the write: read again, and charged once.
    store.racedBy(async () => {
      store.set({ jobId: OTHER, nightlyAt: NOW.toISOString(), day: "2026-10-10", legs: 1 });
    });
    expect(await chargeRefreshLegs(store.docs, 1, NOW)).toBe(true);
    expect(store.gate()).toEqual({
      jobId: OTHER,
      nightlyAt: NOW.toISOString(),
      day: "2026-10-10",
      legs: 2,
    });
    // On a day after the gate's, they are that day's first.
    expect(await chargeRefreshLegs(store.docs, 2, new Date("2026-10-11T19:00:00.000Z"))).toBe(true);
    expect(store.gate()).toMatchObject({ day: "2026-10-11", legs: 2 });
  });

  it("are not charged, nor run, past the day's cap, which a press let through on one leg left", async () => {
    // The day's third press, let through on the last leg: its refresh takes two.
    const store = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 3 });
    expect(await chargeRefreshLegs(store.docs, 1, NOW)).toBe(false);
    expect(store.gate()?.legs).toBe(REFRESH_LEGS_A_DAY);
    // Up to the cap and no further, the gate read again where another moved it meanwhile.
    const left = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    expect(await chargeRefreshLegs(left.docs, 2, NOW)).toBe(true);
    expect(left.gate()?.legs).toBe(3);
    const raced = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    raced.racedBy(async () => {
      raced.set({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 2 });
    });
    expect(await chargeRefreshLegs(raced.docs, 2, NOW)).toBe(false);
    expect(raced.gate()?.legs).toBe(2);
  });
});

describe("the nightly's turn at the copy", () => {
  const clock = (start: Date) => {
    let at = start.getTime();
    return {
      now: () => new Date(at),
      sleep: async (ms: number) => {
        at += ms;
      },
    };
  };

  it("takes the gate at once with no refresh under way, and gives it back when done", async () => {
    const store = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 2 });
    const jobs = memoryJobs();
    jobs.jobs.set(OTHER, refreshAt("done"));
    const time = clock(NOW);
    const turn = await nightlyTakesTurn({ gate: store.docs, readJob: jobs.docs.read, ...time });
    expect(turn).toEqual({ at: NOW.toISOString(), waitedMs: 0, stillRunning: false });
    expect(store.gate()).toEqual({
      jobId: OTHER,
      nightlyAt: NOW.toISOString(),
      day: "2026-10-10",
      legs: 2,
    });
    await nightlyEndsTurn(store.docs, turn.at!);
    expect(store.gate()?.nightlyAt).toBeNull();
    expect(store.gate()?.legs).toBe(2);
  });

  it("waits for a refresh under way to end, then takes the gate", async () => {
    const store = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    const jobs = memoryJobs();
    jobs.jobs.set(OTHER, refreshAt("running"));
    const time = clock(NOW);
    let looks = 0;
    const turn = await nightlyTakesTurn({
      gate: store.docs,
      readJob: async (jobId) => {
        looks += 1;
        // Done by the third look, heard from all along.
        const job = await jobs.docs.read(jobId);
        return job && looks >= 3
          ? { ...job, status: "done" }
          : job && { ...job, updatedAt: time.now().toISOString() };
      },
      ...time,
      lookMs: 30_000,
    });
    expect(turn).toMatchObject({ waitedMs: 60_000, stillRunning: false });
    expect(store.gate()?.nightlyAt).toBe(turn.at);
  });

  it("goes ahead after waiting its longest, saying the refresh is still running", async () => {
    const store = memoryGate({ jobId: OTHER, nightlyAt: null, day: "2026-10-10", legs: 1 });
    const time = clock(NOW);
    const turn = await nightlyTakesTurn({
      gate: store.docs,
      readJob: async () => ({ ...refreshAt("running"), updatedAt: time.now().toISOString() }),
      ...time,
      lookMs: 60_000,
      waitMs: 180_000,
    });
    expect(turn).toMatchObject({ waitedMs: 180_000, stillRunning: true });
    expect(store.gate()?.nightlyAt).toBe(turn.at);
  });

  it("gives back only its own turn, never a later nightly's", async () => {
    const store = memoryGate({
      jobId: null,
      nightlyAt: "2026-10-10T20:00:00.000Z",
      day: "",
      legs: 0,
    });
    await nightlyEndsTurn(store.docs, NOW.toISOString());
    expect(store.gate()?.nightlyAt).toBe("2026-10-10T20:00:00.000Z");
  });
});
