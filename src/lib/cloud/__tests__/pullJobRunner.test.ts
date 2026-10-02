import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamListEntry, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveTidyStamp,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { LEAGUE_PART } from "../cloudPlan";
import { loadPoolFrom, memoryIo } from "../cloudRunner";
import { newPullJob, packJobList, type PullJob } from "../pullJobs";
import {
  runPullLeg,
  startPullJob,
  type JobDocs,
  type LegDeps,
  type LegTask,
} from "../pullJobRunner";
import { memoryCloud, type MemoryCloud } from "./memoryCloud";

/*
 * A pull a device left for the cloud, run a leg at a time (`runPullLeg`) as the task queue sends
 * each: every leg files its share of the list into the copy and queues the next, and every step can
 * be sent twice without pulling twice, stopped by the device, or fail without leaving a job that
 * says it is still running.
 */

const backing = new Map<string, string>();
beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});
afterEach(() => {
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

const game = (id: string, opponentName: string, teamScore: number, opponentScore: number) =>
  ({
    id,
    date: "2026-09-20",
    startTs: "2026-09-20T15:00:00.000Z",
    opponentName,
    status: "completed",
    teamScore,
    opponentScore,
  }) satisfies GcGame;
const schedule = (id: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `${name} 9U`,
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state: "OH",
    city: "Cincinnati",
  },
  games,
  fetchedAt: "2026-09-29T07:20:00.000Z",
});
const ACES = "gcACES000001";
const BEARS = "gcBEARS00001";
const CUBS = "gcCUBS000001";
const schedules = new Map<string, GcTeamSchedule>([
  [ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)])],
  [BEARS, schedule(BEARS, "Bears", [game("b1", "Aces", 3, 5)])],
  [CUBS, schedule(CUBS, "Cubs", [game("c1", "Aces", 2, 4)])],
]);
const LIST: GcTeamListEntry[] = [ACES, BEARS, CUBS].map((teamId) => ({ teamId }));

/** Answers from the schedules above, each told as it comes, as `fetchGcTeams` gives them. */
const answer = (teamId: string): GcTeamResponse => {
  const found = schedules.get(teamId);
  return found
    ? { ok: true, schedule: found }
    : { ok: false, reason: "not-found", message: "No such team." };
};
const answering =
  (fetched: string[][] = []): LegDeps["fetchTeams"] =>
  async (ids: string[], options: FetchGcTeamsOptions) => {
    fetched.push([...ids]);
    const answers = new Map<string, GcTeamResponse>();
    ids.forEach((teamId, at) => {
      const result = answer(teamId);
      answers.set(teamId, result);
      options.onProgress?.({ done: at + 1, total: ids.length, teamId, result, attempts: 1 });
    });
    return answers;
  };

/** A cloud copy with an empty pool, as a device that has signed in and saved leaves it. */
const seed = async (cloud: MemoryCloud, write: () => void = () => undefined) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  write();
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes,
    device: "phone",
    now: "2026-09-28T12:00:00.000Z",
  });
  if (!saved.ok) throw new Error("seed");
  resetTeamRankingsStore();
};

/** The copy's clubs, read as a device taking it in would. */
const clubsIn = async (cloud: MemoryCloud): Promise<string[]> => {
  await loadPoolFrom(cloud.store);
  const ids = loadScoutTeams()
    .flatMap((team) => team.gcTeams?.map((link) => link.teamId) ?? [])
    .sort();
  resetTeamRankingsStore();
  return ids;
};

const JOB = "0123456789abcdef0123456789abcdef";

/** A job's documents in memory, with every update kept in order. */
const memoryJobs = () => {
  const jobs = new Map<string, PullJob>();
  const pieces = new Map<string, Uint8Array>();
  const updates: Partial<PullJob>[] = [];
  const reads: string[] = [];
  const docs: JobDocs = {
    read: async (jobId) => {
      reads.push(jobId);
      const job = jobs.get(jobId);
      return job ? structuredClone(job) : null;
    },
    update: async (jobId, patch) => {
      const job = jobs.get(jobId);
      if (!job) throw new Error("no such job");
      updates.push(structuredClone(patch));
      jobs.set(jobId, { ...job, ...structuredClone(patch) });
    },
    piece: async (jobId, index) => pieces.get(`${jobId}/${index}`) ?? null,
  };
  const put = async (
    entries: GcTeamListEntry[],
    options: { legTeams?: number; timeZone?: string; jobId?: string } = {}
  ) => {
    const jobId = options.jobId ?? JOB;
    const packed = await packJobList(entries);
    packed.pieces.forEach((piece, index) => pieces.set(`${jobId}/${index}`, piece));
    const job = newPullJob({
      list: packed.list,
      seasonYears: [2027],
      timeZone: options.timeZone ?? "America/New_York",
      device: "phone",
      now: "2026-09-29T12:00:00.000Z",
      ...(options.legTeams ? { legTeams: options.legTeams } : {}),
    });
    jobs.set(jobId, job);
    return job;
  };
  return { docs, jobs, pieces, updates, reads, put, job: (jobId = JOB) => jobs.get(jobId)! };
};

const legDeps = (
  cloud: MemoryCloud,
  jobs: ReturnType<typeof memoryJobs>,
  overrides: Partial<LegDeps> = {}
) => {
  const queued: LegTask[] = [];
  const zones: string[] = [];
  const deps: LegDeps = {
    jobs: jobs.docs,
    store: cloud.store,
    fetchTeams: answering(),
    now: () => new Date("2026-09-29T16:00:00.000Z"),
    enqueue: async (task) => {
      queued.push(task);
    },
    inTimeZone: (zone) => {
      zones.push(zone);
    },
    lastTry: false,
    lookEveryMs: 1,
    ...overrides,
  };
  return { deps, queued, zones };
};

describe("a pull the cloud runs a leg at a time", () => {
  it("files each leg's share of the list into the copy and queues the next", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST, { legTeams: 2 });
    expect(jobs.job().legs).toBe(2);
    const fetched: string[][] = [];
    const { deps, queued, zones } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });

    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("next-queued");
    expect(fetched).toEqual([[ACES, BEARS]]);
    expect(queued).toEqual([{ jobId: JOB, leg: 1 }]);
    expect(jobs.job()).toMatchObject({ status: "running", legsDone: 1, stage: "waiting" });
    expect(await clubsIn(cloud)).toEqual([ACES, BEARS].sort());

    expect(await runPullLeg({ jobId: JOB, leg: 1 }, deps)).toBe("done");
    expect(fetched).toEqual([[ACES, BEARS], [CUBS]]);
    expect(queued).toHaveLength(1);
    expect(await clubsIn(cloud)).toEqual([ACES, BEARS, CUBS].sort());
    expect(jobs.job()).toMatchObject({
      status: "done",
      legsDone: 2,
      end: "finished",
      error: null,
      version: cloud.manifest()!.version,
      tally: { asked: 3, answered: 3, failed: 0, filed: 3 },
    });
    expect(jobs.job().tally.gamesAdded).toBeGreaterThan(0);
    // Each leg's day is the device's.
    expect(zones).toEqual(["America/New_York", "America/New_York"]);
  });

  it("says how far the leg has got while it runs", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const slow: LegDeps["fetchTeams"] = async (ids, options) => {
      const answers = new Map<string, GcTeamResponse>();
      for (const [at, teamId] of ids.entries()) {
        const result = answer(teamId);
        answers.set(teamId, result);
        options.onProgress?.({ done: at + 1, total: ids.length, teamId, result, attempts: 1 });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return answers;
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: slow });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("done");
    expect(jobs.updates).toContainEqual(
      expect.objectContaining({
        stage: "fetching",
        progress: expect.objectContaining({ total: 3, failed: 0 }),
      })
    );
    expect(jobs.updates[0]).toMatchObject({
      status: "running",
      stage: "loading",
      progress: { done: 0, total: 3, failed: 0 },
    });
  });

  it("runs a leg sent twice once, and queues the next where the first one's reply was lost", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST, { legTeams: 2 });
    const fetched: string[][] = [];
    const { deps, queued } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });
    await runPullLeg({ jobId: JOB, leg: 0 }, deps);
    const version = cloud.manifest()!.version;

    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("already-ran");
    expect(fetched).toHaveLength(1);
    expect(cloud.manifest()!.version).toBe(version);
    expect(queued).toEqual([
      { jobId: JOB, leg: 1 },
      { jobId: JOB, leg: 1 },
    ]);
    expect(jobs.job().tally.asked).toBe(2);
  });

  it("leaves alone a job that is over, gone, or not at this leg", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST, { legTeams: 2 });
    const fetched: string[][] = [];
    const { deps, queued } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });

    expect(await runPullLeg({ jobId: JOB, leg: 1 }, deps)).toBe("out-of-turn");
    expect(await runPullLeg({ jobId: JOB, leg: 5 }, deps)).toBe("out-of-turn");
    expect(await runPullLeg({ jobId: "f".repeat(32), leg: 0 }, deps)).toBe("gone");
    // Not a job's id: never read at all, since it would name some other document.
    jobs.reads.length = 0;
    expect(await runPullLeg({ jobId: "../chunks/x", leg: 0 }, deps)).toBe("gone");
    expect(await runPullLeg({ jobId: JOB, leg: -1 }, deps)).toBe("gone");
    expect(await runPullLeg({ jobId: JOB, leg: 0.5 }, deps)).toBe("gone");
    expect(jobs.reads).toEqual([]);
    // A leg past the last, where the job has run them all but not yet said it is done.
    jobs.jobs.set(JOB, { ...jobs.job(), legsDone: 2 });
    expect(await runPullLeg({ jobId: JOB, leg: 2 }, deps)).toBe("out-of-turn");
    jobs.jobs.set(JOB, { ...jobs.job(), legsDone: 0 });
    for (const status of ["done", "failed", "cancelled"] as const) {
      jobs.jobs.set(JOB, { ...jobs.job(), status });
      expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("over");
    }
    expect(fetched).toEqual([]);
    expect(queued).toEqual([]);
    expect(jobs.updates).toEqual([]);
  });

  it("stops before it starts when the device has asked, pulling nothing", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    jobs.jobs.set(JOB, { ...jobs.job(), stopAsked: true });
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("cancelled");
    expect(fetched).toEqual([]);
    expect(jobs.job().status).toBe("cancelled");
    expect(await clubsIn(cloud)).toEqual([]);
  });

  it("stops part way when the device asks, saving what it fetched and queueing nothing", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put([...LIST, { teamId: "gcDUCKS00001" }], { legTeams: 3 });
    const stopping: LegDeps["fetchTeams"] = async (ids, options) => {
      const answers = new Map<string, GcTeamResponse>([[ids[0]!, answer(ids[0]!)]]);
      // The device asks to stop once the first team is in, and the leg notices.
      jobs.jobs.set(JOB, { ...jobs.job(), stopAsked: true });
      while (!options.signal?.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
      return answers;
    };
    const { deps, queued } = legDeps(cloud, jobs, { fetchTeams: stopping });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("cancelled");
    expect(queued).toEqual([]);
    expect(await clubsIn(cloud)).toEqual([ACES]);
    expect(jobs.job()).toMatchObject({
      status: "cancelled",
      end: "stopped",
      legsDone: 1,
      tally: { asked: 3, answered: 1, filed: 1 },
    });
  });

  it("ends the job when GameChanger stops answering, saving what came and queueing nothing", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST, { legTeams: 2 });
    const refusing: LegDeps["fetchTeams"] = async (ids, options) => {
      options.onRefused?.(5);
      return new Map([[ids[0]!, answer(ids[0]!)]]);
    };
    const { deps, queued } = legDeps(cloud, jobs, { fetchTeams: refusing });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("done");
    expect(queued).toEqual([]);
    expect(jobs.job()).toMatchObject({ status: "done", end: "gave-up", legsDone: 1 });
    expect(await clubsIn(cloud)).toEqual([ACES]);
  });

  it("fails a job whose list does not unpack, rather than trying it again", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    jobs.pieces.clear();
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("failed");
    expect(jobs.job()).toMatchObject({ status: "failed", error: expect.stringMatching(/missing/) });
    expect(fetched).toEqual([]);
  });

  it("fails a job on a copy tidied by newer rules, which it leaves as it was", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveTidyStamp("r999|0|0|0|"));
    const version = cloud.manifest()!.version;
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const { deps } = legDeps(cloud, jobs);
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("failed");
    expect(jobs.job()).toMatchObject({ status: "failed", error: expect.stringMatching(/newer/) });
    expect(cloud.manifest()!.version).toBe(version);
  });

  it("fails a job with no copy to pull into", async () => {
    const cloud = memoryCloud();
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const { deps } = legDeps(cloud, jobs);
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("failed");
    expect(jobs.job()).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/no cloud/),
    });
  });

  it("fails a job whose copy was deleted and started again while it pulled", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const replacing: LegDeps["fetchTeams"] = async (ids, options) => {
      cloud.setManifest(null);
      const saved = await commitChanges({
        store: cloud.store,
        base: null,
        changes: [{ key: LEAGUE_PART, value: { seasons: [] }, at: 3 }],
        device: "laptop",
        now: "2026-09-29T13:00:30.000Z",
      });
      if (!saved.ok) throw new Error("start again");
      return answering()(ids, options);
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: replacing });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("failed");
    expect(jobs.job()).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/started again/),
    });
    expect(cloud.manifest()).toMatchObject({ version: 1, parts: [{ key: LEAGUE_PART }] });
  });

  it("throws trouble for another try, and fails the job on the last", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const broken: LegDeps["fetchTeams"] = async () => {
      throw new Error("The line to GameChanger went down.");
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: broken });
    await expect(runPullLeg({ jobId: JOB, leg: 0 }, deps)).rejects.toThrow(/went down/);
    expect(jobs.job()).toMatchObject({ status: "running", error: expect.stringMatching(/down/) });

    const last = legDeps(cloud, jobs, { fetchTeams: broken, lastTry: true });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, last.deps)).toBe("failed");
    expect(jobs.job()).toMatchObject({ status: "failed", error: expect.stringMatching(/down/) });
  });

  it("tries again a leg the copy kept moving under", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const { deps } = legDeps(cloud, jobs, {
      store: { ...cloud.store, commitManifest: async () => false },
    });
    await expect(runPullLeg({ jobId: JOB, leg: 0 }, deps)).rejects.toThrow(/kept saving/);
    expect(jobs.job()).toMatchObject({ status: "running", legsDone: 0 });
  });
});

describe("starting a pull", () => {
  it("queues a queued job's first leg, and nothing for a job under way or not there", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const queued: LegTask[] = [];
    const deps = {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        queued.push(task);
      },
    };
    expect(await startPullJob(JOB, deps)).toEqual({ ok: true, status: "queued" });
    expect(queued).toEqual([{ jobId: JOB, leg: 0 }]);

    jobs.jobs.set(JOB, { ...jobs.job(), status: "running" });
    expect(await startPullJob(JOB, deps)).toEqual({ ok: true, status: "running" });
    expect(queued).toHaveLength(1);

    expect(await startPullJob("f".repeat(32), deps)).toEqual({ ok: false, refusal: "not-found" });
    expect(await startPullJob("not-a-job", deps)).toEqual({
      ok: false,
      refusal: "invalid-argument",
    });
    expect(await startPullJob(undefined, deps)).toEqual({ ok: false, refusal: "invalid-argument" });
    expect(queued).toHaveLength(1);
  });
});
