import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamListEntry, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { localDayKey, markRefreshed } from "../../gameChangerSchedule";
import { refreshNow } from "../../storedRota";
import { AGE_LEVELS } from "../../teamRankings";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadDroppedClubs,
  loadRefreshLog,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveTidyStamp,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { epochOf, type CloudManifest } from "../cloudManifest";
import { LEAGUE_PART } from "../cloudPlan";
import { loadPoolFrom, memoryIo } from "../cloudRunner";
import {
  MAX_LIST_TEAMS,
  newPullJob,
  newRefreshJob,
  packJobList,
  tooManyTeams,
  type PullJob,
  type PullJobChain,
} from "../pullJobs";
import {
  IMPORT_SILENT_MS,
  IMPORT_WENT_SILENT,
  LEGS_SILENT_MS,
  LEGS_WENT_SILENT,
  STOPPED_WENT_SILENT,
  legsLastHeard,
  reapPullJob,
  reapSilentPulls,
  reapSilentPullsWithin,
  restJobDocs,
  resumePullJob,
  runPullLeg,
  startNextPart,
  startPullJob,
  stopPullsUnderWay,
  NEVER_STARTED,
  NEVER_STARTED_MS,
  tooManyLegs,
  unchangedSince,
  type JobDocs,
  type LegDeps,
  type LegTask,
} from "../pullJobRunner";
import type { FirestoreRestDocuments } from "../firestoreRest";
import { NIGHTLY_HOLD_MS, REFRESH_GATE_PATH, startRefresh } from "../refreshGate";
import { NO_LEAGUE_DOCS } from "../../live/cloudLeague";
import { runEdit } from "../../live/editRun";
import { inTimeZoneAsync } from "../../../test/timeZone";
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
/**
 * A start of Team Rankings saved after every job the stopping tests make: what the edit function
 * hands the stop of the pulls under way (`stopPullsUnderWay`), with Firestore saying nothing of when
 * their documents were made unless a test says so.
 */
const START = { copy: "c0ffee", epoch: "e", at: "2026-10-02T17:00:00.000Z" };

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

/**
 * The owner's Start again, as the edit function makes it (`copy.reset`): Team Rankings out of the
 * copy under the same copy id, and the manifest it leaves.
 */
const startAgain = async (cloud: MemoryCloud): Promise<CloudManifest> => {
  const done = await runEdit({
    store: cloud.store,
    leagueDocs: NO_LEAGUE_DOCS,
    command: { kind: "copy.reset" },
    now: () => "2026-10-02T16:20:00.000Z",
  });
  if (!done.ok) throw new Error(`start again: ${done.why}`);
  return cloud.manifest()!;
};

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
    create: async (jobId, job) => {
      if (jobs.has(jobId)) return false;
      jobs.set(jobId, structuredClone(job));
      return true;
    },
    putPiece: async (jobId, index, data) => {
      pieces.set(`${jobId}/${index}`, data);
    },
    updateIfUnchanged: async (jobId, seen, patch) => {
      const job = jobs.get(jobId);
      if (!job || !unchangedSince(seen, job)) return false;
      updates.push(structuredClone(patch));
      jobs.set(jobId, { ...job, ...structuredClone(patch) });
      return true;
    },
  };
  /** A "Refresh now" job as the server makes one. */
  const putRefresh = (jobId: string, options: { legTeams?: number } = {}) => {
    const job = {
      ...newRefreshJob({
        timeZone: "America/New_York",
        device: "phone",
        now: "2026-10-02T15:59:00.000Z",
      }),
      ...(options.legTeams ? { legTeams: options.legTeams } : {}),
    };
    jobs.set(jobId, job);
    return job;
  };
  const put = async (
    entries: GcTeamListEntry[],
    options: {
      legTeams?: number;
      timeZone?: string;
      jobId?: string;
      refresh?: boolean;
      chain?: PullJobChain;
    } = {}
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
      ...(options.refresh ? { refresh: true } : {}),
      ...(options.chain ? { chain: options.chain } : {}),
    });
    jobs.set(jobId, job);
    return job;
  };
  return {
    docs,
    jobs,
    pieces,
    updates,
    reads,
    put,
    putRefresh,
    job: (jobId = JOB) => jobs.get(jobId)!,
  };
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
  it("hands its tidy the League Standings documents it is given", async () => {
    // So the import pulls again, and the tidy keeps, every club a League Standings team links
    // (`leagueSeasonsOf`).
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    let listed = 0;
    const leagueDocs = async () => {
      listed += 1;
      return [];
    };
    const { deps } = legDeps(cloud, jobs, { leagueDocs });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("done");
    expect(listed).toBeGreaterThan(0);
  });

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

  it("asks a catch-up's every team again, where a paste of them asks only what the copy lacks", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    const unknown = Array.from({ length: 23 }, (_, at) => ({
      teamId: `gcNONE${String(at).padStart(6, "0")}`,
    }));
    await jobs.put(LIST);
    await runPullLeg({ jobId: JOB, leg: 0 }, legDeps(cloud, jobs).deps);
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });
    await jobs.put([...LIST, ...unknown], { jobId: "b".repeat(32) });
    await runPullLeg({ jobId: "b".repeat(32), leg: 0 }, deps);
    await jobs.put([...LIST, ...unknown], { jobId: "c".repeat(32), refresh: true });
    await runPullLeg({ jobId: "c".repeat(32), leg: 0 }, deps);
    expect(fetched.map((ids) => ids.length)).toEqual([23, 26]);
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

  it("files no leg into Team Rankings started again after its first leg, asking nothing for it", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST, { legTeams: 2 });
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, { fetchTeams: answering(fetched) });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("next-queued");
    const first = cloud.manifest()!;
    // The first leg keeps the copy it read, for the legs after it to be held to.
    expect(jobs.job().on).toEqual({ copy: first.copy, epoch: first.epoch });
    const started = await startAgain(cloud);
    expect(await runPullLeg({ jobId: JOB, leg: 1 }, deps)).toBe("failed");
    expect(fetched).toEqual([[ACES, BEARS]]);
    expect(jobs.job()).toMatchObject({
      status: "failed",
      legsDone: 1,
      error: expect.stringMatching(/started again.*Send the list again/),
    });
    expect(cloud.manifest()).toEqual(started);
    expect(await clubsIn(cloud)).toEqual([]);
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

describe("a Refresh now job, a leg at a time", () => {
  const REFRESH = "e".repeat(32);
  /** A Friday, three days after the clubs were filed: none of them pulled within the gap. */
  const FRIDAY = new Date("2026-10-02T16:00:00.000Z");
  const CADENCE_KEY = "league_forecast_gc_cadence_v1";
  const REFRESH_LOG_KEY = "league_forecast_gc_refresh_v1";

  /** A copy holding the three clubs, filed by a pasted list on 29 September. */
  const filed = async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    await runPullLeg({ jobId: JOB, leg: 0 }, legDeps(cloud, jobs).deps);
    return { cloud, jobs };
  };
  /** A device saving one value to the copy, as a phone or the nightly would. */
  const saves = async (cloud: MemoryCloud, key: string, value: unknown) => {
    const saved = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key, value, at: 5 }],
      device: "phone",
      now: "2026-10-02T16:10:00.000Z",
    });
    if (!saved.ok) throw new Error("save");
  };
  const logOf = async (cloud: MemoryCloud) => {
    await loadPoolFrom(cloud.store);
    const log = loadRefreshLog();
    resetTeamRankingsStore();
    return log;
  };

  it("works its teams out once, at its start, walks them leg by leg, and logs its levels at the end", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH, { legTeams: 2 });
    const fetched: string[][] = [];
    const charged: number[] = [];
    const { deps, queued } = legDeps(cloud, jobs, {
      fetchTeams: answering(fetched),
      now: () => FRIDAY,
      chargeLegs: async (jobId, legs) => {
        expect(jobId).toBe(REFRESH);
        charged.push(legs);
        return true;
      },
    });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("next-queued");
    const worked = jobs.job(REFRESH);
    // Every age group is due on the daily cadence, and all three clubs with it.
    expect(worked).toMatchObject({
      status: "running",
      legs: 2,
      legsDone: 1,
      list: { teams: 3 },
      rota: { at: FRIDAY.toISOString(), ageLevels: AGE_LEVELS, again: false, heldBack: 0 },
    });
    // The leg past the first is charged to the day's budget once its count is known.
    expect(charged).toEqual([1]);
    expect(fetched.map((ids) => ids.length)).toEqual([2]);
    expect(queued).toEqual([{ jobId: REFRESH, leg: 1 }]);
    expect(await logOf(cloud)).toEqual({});

    // Meanwhile a phone chooses the rota, under which a Friday is for no level at all: worked out
    // again, the next leg would pull nothing and log nothing. It walks the list it was given.
    await saves(cloud, CADENCE_KEY, "rotation");
    const next = legDeps(cloud, jobs, {
      fetchTeams: answering(fetched),
      now: () => new Date("2026-10-02T16:30:00.000Z"),
    });
    expect(await runPullLeg({ jobId: REFRESH, leg: 1 }, next.deps)).toBe("done");
    expect(fetched.flat().sort()).toEqual([ACES, BEARS, CUBS].sort());
    expect(jobs.job(REFRESH).list).toEqual(worked.list);
    expect(jobs.job(REFRESH)).toMatchObject({
      status: "done",
      legsDone: 2,
      end: "finished",
      tally: { asked: 3, answered: 3, filed: 3 },
    });
    // Every level it was for, on the day it was worked out for.
    const log = await logOf(cloud);
    for (const level of AGE_LEVELS) expect(log[String(level)]).toBe(localDayKey(FRIDAY));
  });

  it("keeps the day it worked its teams out on, though the clock passes midnight meanwhile", async () => {
    // Worked out at 23:59 New York time on Friday, kept a minute later, on Saturday: the levels
    // are Friday's, and logged as Saturday's they would leave Saturday's nightly nothing due.
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH, { legTeams: 2 });
    const friday = new Date("2026-10-03T03:59:00.000Z");
    const saturday = new Date("2026-10-03T04:01:00.000Z");
    // The clock reads Friday until the copy is first read to work the teams out from.
    let touched = false;
    const store = new Proxy(cloud.store, {
      get: (target, key, receiver) => {
        touched = true;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const { deps } = legDeps(cloud, jobs, {
      store,
      fetchTeams: answering([]),
      now: () => (touched ? saturday : friday),
      chargeLegs: async () => true,
    });
    await runPullLeg({ jobId: REFRESH, leg: 0 }, deps);
    expect(jobs.job(REFRESH).rota?.at).toBe(friday.toISOString());
  });

  it("fails before asking anybody anything when the day has too few legs left for it", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH, { legTeams: 2 });
    const fetched: string[][] = [];
    const charged: number[] = [];
    const { deps, queued } = legDeps(cloud, jobs, {
      fetchTeams: answering(fetched),
      now: () => FRIDAY,
      chargeLegs: async (jobId, legs) => {
        expect(jobId).toBe(REFRESH);
        charged.push(legs);
        return false;
      },
    });
    const version = cloud.manifest()!.version;
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("failed");
    expect(charged).toEqual([1]);
    expect(jobs.job(REFRESH)).toMatchObject({ status: "failed", error: tooManyLegs(2) });
    expect(tooManyLegs(2)).toMatch(/takes 2 parts .* nothing was pulled/);
    expect(fetched).toEqual([]);
    expect(queued).toEqual([]);
    expect(cloud.manifest()!.version).toBe(version);
  });

  it("is done at once, logging nothing, with no team to pull", async () => {
    const { cloud, jobs } = await filed();
    await saves(cloud, CADENCE_KEY, "rotation");
    jobs.putRefresh(REFRESH);
    const fetched: string[][] = [];
    const { deps, queued } = legDeps(cloud, jobs, {
      fetchTeams: answering(fetched),
      now: () => FRIDAY,
    });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("done");
    expect(jobs.job(REFRESH)).toMatchObject({
      status: "done",
      end: "nothing-due",
      legs: 1,
      legsDone: 1,
      list: { teams: 0 },
      rota: { ageLevels: [], again: true },
    });
    expect(fetched).toEqual([]);
    expect(queued).toEqual([]);
    expect(await logOf(cloud)).toEqual({});
  });

  it("runs today's levels again once they are logged, holding back a team pulled within the gap", async () => {
    const { cloud, jobs } = await filed();
    // The day the clubs were filed, logged as refreshed: a second run that day is the levels
    // again, and every club, pulled hours before and playing nothing near, waits.
    const sameDay = new Date("2026-09-29T17:00:00.000Z");
    await saves(cloud, REFRESH_LOG_KEY, markRefreshed({}, AGE_LEVELS, sameDay));
    jobs.putRefresh(REFRESH);
    const { deps } = legDeps(cloud, jobs, { now: () => sameDay });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("done");
    expect(jobs.job(REFRESH)).toMatchObject({
      end: "nothing-due",
      rota: { ageLevels: AGE_LEVELS, again: true, heldBack: 3 },
    });
  });

  it("walks, when its first leg is tried again, the list the try before worked out", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH);
    const broken: LegDeps["fetchTeams"] = async () => {
      throw new Error("The line to GameChanger went down.");
    };
    const first = legDeps(cloud, jobs, { fetchTeams: broken, now: () => FRIDAY });
    await expect(runPullLeg({ jobId: REFRESH, leg: 0 }, first.deps)).rejects.toThrow(/down/);
    expect(jobs.job(REFRESH)).toMatchObject({ legsDone: 0, list: { teams: 3 } });
    // A rota now for nothing at all, which a try that worked the teams out again would follow.
    await saves(cloud, CADENCE_KEY, "rotation");
    const fetched: string[][] = [];
    const again = legDeps(cloud, jobs, { fetchTeams: answering(fetched), now: () => FRIDAY });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, again.deps)).toBe("done");
    expect(fetched.flat().sort()).toEqual([ACES, BEARS, CUBS].sort());
  });

  it("asks nobody again when tried after its save landed but before its job was told", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH);
    const fetched: string[][] = [];
    // GameChanger's answers stamped when they are fetched, as the proxy stamps them.
    const fetching = (at: Date): LegDeps["fetchTeams"] => {
      const answers = answering(fetched);
      return async (ids, options) => {
        const answered = await answers(ids, options);
        for (const [teamId, one] of answered) {
          if (one.ok) {
            answered.set(teamId, {
              ...one,
              schedule: { ...one.schedule, fetchedAt: at.toISOString() },
            });
          }
        }
        return answered;
      };
    };
    // The save lands, and then the job's own update, the one that says the leg is done, fails.
    let failing = true;
    const flaky: JobDocs = {
      ...jobs.docs,
      update: async (jobId, patch) => {
        if (failing && patch.legsDone !== undefined) {
          failing = false;
          throw new Error("Firestore did not answer.");
        }
        await jobs.docs.update(jobId, patch);
      },
    };
    const first = legDeps(cloud, jobs, {
      jobs: flaky,
      fetchTeams: fetching(new Date("2026-10-02T16:01:00.000Z")),
      now: () => FRIDAY,
    });
    await expect(runPullLeg({ jobId: REFRESH, leg: 0 }, first.deps)).rejects.toThrow(/answer/);
    const saved = cloud.manifest()!.version;
    expect(jobs.job(REFRESH)).toMatchObject({ status: "running", legsDone: 0 });
    expect(fetched.flat().sort()).toEqual([ACES, BEARS, CUBS].sort());

    // Cloud Tasks sends it again two minutes on: every team was pulled after the refresh was
    // worked out, so none is asked again, nothing is saved again, and the job is done.
    const again = legDeps(cloud, jobs, {
      fetchTeams: fetching(new Date("2026-10-02T16:03:00.000Z")),
      now: () => new Date("2026-10-02T16:02:00.000Z"),
    });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, again.deps)).toBe("done");
    expect(fetched).toHaveLength(1);
    expect(cloud.manifest()!.version).toBe(saved);
    expect(jobs.job(REFRESH)).toMatchObject({ status: "done", legsDone: 1, end: "finished" });
    // The save that landed logged the levels, as the leg's own would have.
    expect((await logOf(cloud))["9"]).toBe(localDayKey(FRIDAY));
  });

  it("keeps what it replaces as an earlier version, as the nightly does, where a list keeps none", async () => {
    const { cloud, jobs } = await filed();
    expect(cloud.manifest()!.kept).toEqual([]);
    jobs.putRefresh(REFRESH);
    // The Aces have played again since the list was pulled, so the refresh moves the pool.
    const played: LegDeps["fetchTeams"] = async (ids, options) => {
      const answers = await answering()(ids, options);
      const aces = answers.get(ACES);
      if (aces?.ok) {
        const games = [...aces.schedule.games, game("a2", "Cubs", 1, 2)];
        answers.set(ACES, { ...aces, schedule: { ...aces.schedule, games } });
      }
      return answers;
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: played, now: () => FRIDAY });
    // A catch-up list asking the same teams again moves the pool as much, and keeps nothing.
    const list = "c".repeat(32);
    await jobs.put(LIST, { jobId: list, refresh: true });
    const listed = cloud.manifest()!.version;
    expect(await runPullLeg({ jobId: list, leg: 0 }, deps)).toBe("done");
    expect(cloud.manifest()!.version).toBe(listed + 1);
    expect(cloud.manifest()!.kept).toEqual([]);
    // Played again before the refresh, which then has something of its own to replace.
    const more: LegDeps["fetchTeams"] = async (ids, options) => {
      const answers = await played(ids, options);
      const aces = answers.get(ACES);
      if (aces?.ok) {
        const games = [...aces.schedule.games, game("a3", "Bears", 7, 0)];
        answers.set(ACES, { ...aces, schedule: { ...aces.schedule, games } });
      }
      return answers;
    };
    const refresh = legDeps(cloud, jobs, { fetchTeams: more, now: () => FRIDAY });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, refresh.deps)).toBe("done");
    const kept = cloud.manifest()!.kept;
    expect(kept.length).toBeGreaterThan(0);
    expect(new Set(kept.map((part) => part.group)).size).toBe(1);
  });

  it("walks none of its teams into Team Rankings started again after they were worked out", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH, { legTeams: 2 });
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, {
      fetchTeams: answering(fetched),
      now: () => FRIDAY,
      chargeLegs: async () => true,
    });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("next-queued");
    const worked = cloud.manifest()!;
    expect(jobs.job(REFRESH).on).toEqual({ copy: worked.copy, epoch: worked.epoch });
    const started = await startAgain(cloud);
    expect(await runPullLeg({ jobId: REFRESH, leg: 1 }, deps)).toBe("failed");
    // Asked about only the first leg's share, before the start; never the rest, for a pool gone.
    expect(fetched.map((ids) => ids.length)).toEqual([2]);
    expect(jobs.job(REFRESH).error).toMatch(/started again.*Press Refresh now again/);
    expect(cloud.manifest()).toEqual(started);
  });

  it("asks nothing for teams worked out just before Team Rankings was started again", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH, { legTeams: 2 });
    const fetched: string[][] = [];
    let started: CloudManifest | null = null;
    const { deps } = legDeps(cloud, jobs, {
      fetchTeams: answering(fetched),
      now: () => FRIDAY,
      // Between the teams worked out and the first leg's pull of them, the owner starts again.
      chargeLegs: async () => {
        started = await startAgain(cloud);
        return true;
      },
    });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("failed");
    expect(fetched).toEqual([]);
    expect(jobs.job(REFRESH).error).toMatch(/started again.*Press Refresh now again/);
    expect(cloud.manifest()).toEqual(started);
  });

  it("fails, saying to press again rather than to send a list, when its copy is started again", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH);
    const replacing: LegDeps["fetchTeams"] = async (ids, options) => {
      cloud.setManifest(null);
      const saved = await commitChanges({
        store: cloud.store,
        base: null,
        changes: [{ key: LEAGUE_PART, value: { seasons: [] }, at: 3 }],
        device: "laptop",
        now: "2026-10-02T16:00:30.000Z",
      });
      if (!saved.ok) throw new Error("start again");
      return answering()(ids, options);
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: replacing, now: () => FRIDAY });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("failed");
    const { error } = jobs.job(REFRESH);
    expect(error).toMatch(/started again.* while this refresh ran.*Press Refresh now again/);
    expect(error).not.toMatch(/list/);
  });

  it("files its answers again onto a save another made while it pulled, keeping that save", async () => {
    const { cloud, jobs } = await filed();
    jobs.putRefresh(REFRESH);
    // While GameChanger answers, the nightly, or a phone, saves the copy: the Cubs thrown out.
    const meanwhile: LegDeps["fetchTeams"] = async (ids, options) => {
      await saves(cloud, "league_forecast_gc_dropped_clubs_v1", [CUBS]);
      return answering()(ids, options);
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: meanwhile, now: () => FRIDAY });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("done");
    await loadPoolFrom(cloud.store);
    // The other save stands, filed onto rather than written over, and honoured: the Cubs' answer,
    // fetched before they were thrown out, is not filed.
    expect([...loadDroppedClubs()]).toEqual([CUBS]);
    expect(loadRefreshLog()["9"]).toBe(localDayKey(FRIDAY));
    resetTeamRankingsStore();
    expect(jobs.job(REFRESH)).toMatchObject({
      tally: { asked: 3, answered: 3, filed: 2 },
      version: cloud.manifest()!.version,
    });
  });

  it("counts, pulls and logs New York's day, the one its card offered, whoever pressed", async () => {
    const { cloud, jobs } = await filed();
    await saves(cloud, CADENCE_KEY, "rotation");
    // Nine on a Sunday evening in New York is already Monday in UTC, the zone a browser guarding
    // against fingerprinting reports: Sunday is for 8U and 9U, the three clubs' level, and Monday
    // for 16U and 17U, which none of them is.
    const SUNDAY = new Date("2026-10-05T01:00:00.000Z");
    // What the card offers, as the edit function works it out, in New York's day.
    const offered = await inTimeZoneAsync("America/New_York", async () => {
      await loadPoolFrom(cloud.store);
      const offer = refreshNow(SUNDAY);
      resetTeamRankingsStore();
      return offer;
    });
    expect(offered).toMatchObject({ ageLevels: [8, 9], again: false });
    expect(offered.teamIds).toHaveLength(3);

    // The press, made as `startPull` makes it, from a device's name and nothing of its day.
    const started = await startRefresh(
      { device: "phone" },
      {
        gate: { readAt: async () => null, replace: async () => true },
        jobs: jobs.docs,
        enqueue: async () => undefined,
        now: () => SUNDAY,
        newId: () => REFRESH,
      }
    );
    expect(started).toMatchObject({ ok: true, jobId: REFRESH, already: false });
    // Its leg runs in the job's zone, which `runPull` sets before the leg's worker starts.
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, { fetchTeams: answering(fetched), now: () => SUNDAY });
    const zone = jobs.job(REFRESH).timeZone;
    expect(await inTimeZoneAsync(zone, () => runPullLeg({ jobId: REFRESH, leg: 0 }, deps))).toBe(
      "done"
    );
    expect(fetched.flat().sort()).toEqual([...offered.teamIds].sort());
    expect(jobs.job(REFRESH).rota).toMatchObject({ ageLevels: [8, 9], again: false });
    // Logged on New York's Sunday, which that night's nightly reads; not on UTC's Monday.
    const log = await logOf(cloud);
    expect([log["8"], log["9"], log["16"]]).toEqual(["2026-10-04", "2026-10-04", undefined]);
  });

  it("fails at its start with no copy to work its teams out from", async () => {
    const cloud = memoryCloud();
    const jobs = memoryJobs();
    jobs.putRefresh(REFRESH);
    const { deps } = legDeps(cloud, jobs, { now: () => FRIDAY });
    expect(await runPullLeg({ jobId: REFRESH, leg: 0 }, deps)).toBe("failed");
    expect(jobs.job(REFRESH)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/no cloud copy/),
    });
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
      now: () => new Date("2026-09-29T12:01:00.000Z"),
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

  it("never starts a job dressed as Refresh now, which only the server's own start may", async () => {
    const jobs = memoryJobs();
    jobs.putRefresh(JOB);
    const queued: LegTask[] = [];
    const started = await startPullJob(JOB, {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        queued.push(task);
      },
      now: () => new Date("2026-10-02T16:00:00.000Z"),
    });
    expect(started).toEqual({ ok: false, refusal: "invalid-argument" });
    expect(queued).toEqual([]);
  });

  // The case that left two pulls "waiting to start" for hours: the queueing threw, the device took
  // the answer for one that may have started, and nothing ever ran or ended the job.
  it("ends a job it cannot queue with the cloud's own words, and refuses with them", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const lacks =
      '7 PERMISSION_DENIED: The principal lacks IAM permission "cloudtasks.tasks.create" for the resource.';
    const started = await startPullJob(JOB, {
      jobs: jobs.docs,
      enqueue: async () => {
        throw new Error(lacks);
      },
      now: () => new Date("2026-09-29T12:01:00.000Z"),
    });
    const message = `The cloud could not queue this pull: ${lacks}`;
    expect(started).toEqual({ ok: false, refusal: "unavailable", message });
    expect(jobs.job()).toMatchObject({
      status: "failed",
      stage: "waiting",
      error: message,
      updatedAt: "2026-09-29T12:01:00.000Z",
    });
  });

  // Codex on #372: a queueing that failed, and a job that could not be marked failed either, is a
  // start whose outcome is unknown; refused outright, the device would forget a job that may run.
  it("answers a failed queueing it could not mark as unknown, not as a refusal", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const started = await startPullJob(JOB, {
      jobs: {
        ...jobs.docs,
        updateIfUnchanged: async () => {
          throw new Error("Firestore did not answer.");
        },
      },
      enqueue: async () => {
        throw new Error("Cloud Tasks did not answer.");
      },
      now: () => new Date("2026-09-29T12:01:00.000Z"),
    });
    expect(started).toEqual({
      ok: false,
      refusal: "unknown",
      message: "The cloud could not queue this pull: Cloud Tasks did not answer.",
    });
    expect(jobs.job()).toMatchObject({ status: "queued", error: null });
  });

  it("refuses with the cloud's words when the job cannot be read, and touches nothing", async () => {
    const queued: LegTask[] = [];
    const started = await startPullJob(JOB, {
      jobs: {
        read: async () => {
          throw new Error("Firestore answered HTTP 403 reading pullJobs/x.");
        },
        updateIfUnchanged: async () => {
          throw new Error("no write expected");
        },
      },
      enqueue: async (task: LegTask) => {
        queued.push(task);
      },
      now: () => new Date("2026-09-29T12:01:00.000Z"),
    });
    expect(started).toEqual({
      ok: false,
      refusal: "unavailable",
      message:
        "The cloud could not read this pull: Firestore answered HTTP 403 reading pullJobs/x.",
    });
    expect(queued).toEqual([]);
  });

  it("cancels a job stopped before any leg ran, rather than queueing it", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    jobs.jobs.set(JOB, { ...jobs.job(), stopAsked: true });
    const queued: LegTask[] = [];
    const deps = {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        queued.push(task);
      },
      now: () => new Date("2026-09-29T12:05:00.000Z"),
    };
    expect(await startPullJob(JOB, deps, 5 * 60_000)).toEqual({ ok: true, status: "cancelled" });
    expect(queued).toEqual([]);
    expect(jobs.job()).toMatchObject({ status: "cancelled", stage: "waiting" });
  });

  it("ends a job whose task was made but no leg touched in the hour of the device's waiting", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const queued: LegTask[] = [];
    const deps = {
      jobs: jobs.docs,
      // The task is already made: Cloud Tasks refuses its name again (`enqueueLeg`).
      enqueue: async (task: LegTask): Promise<"already"> => {
        queued.push(task);
        return "already";
      },
      // Hours past the job's own stamp by this server's clock: the device's wait is what counts.
      now: () => new Date("2026-09-29T18:00:00.000Z"),
    };
    // The first ask, and one by a device that has not waited the hour, leave it queued.
    expect(await startPullJob(JOB, deps)).toEqual({ ok: true, status: "queued" });
    expect(await startPullJob(JOB, deps, NEVER_STARTED_MS)).toEqual({
      ok: true,
      status: "queued",
    });
    expect(jobs.job().status).toBe("queued");
    expect(await startPullJob(JOB, deps, NEVER_STARTED_MS + 1)).toEqual({
      ok: true,
      status: "failed",
    });
    expect(jobs.job()).toMatchObject({ status: "failed", stage: "waiting", error: NEVER_STARTED });
  });

  it("queues afresh, and leaves running, a job whose start never queued anything", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const queued: LegTask[] = [];
    const started = await startPullJob(
      JOB,
      {
        jobs: jobs.docs,
        // Made now: the first start's queueing never happened, so the name is free.
        enqueue: async (task: LegTask) => {
          queued.push(task);
        },
        now: () => new Date("2026-09-29T18:00:00.000Z"),
      },
      NEVER_STARTED_MS * 5
    );
    expect(started).toEqual({ ok: true, status: "queued" });
    expect(queued).toEqual([{ jobId: JOB, leg: 0 }]);
    expect(jobs.job().status).toBe("queued");
  });

  // Codex on #372: a leg its task started can write to the job while an ask is deciding to end
  // it, and the end must not overwrite that, nor tell the person to send again a pull under way.
  it("does not end a job a leg started while the ask was deciding", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const startedByLeg = (jobId: string) =>
      jobs.jobs.set(jobId, {
        ...jobs.job(jobId),
        status: "running",
        stage: "loading",
        updatedAt: "2026-09-29T17:59:59.000Z",
      });
    const now = () => new Date("2026-09-29T18:00:00.000Z");
    // The hour is up and its task was already made, but the leg writes first.
    const stale = await startPullJob(
      JOB,
      {
        jobs: jobs.docs,
        enqueue: async (task: LegTask): Promise<"already"> => {
          startedByLeg(task.jobId);
          return "already";
        },
        now,
      },
      NEVER_STARTED_MS * 2
    );
    expect(stale).toEqual({ ok: true, status: "queued" });
    expect(jobs.job()).toMatchObject({ status: "running" });

    // A queueing that fails, while a task an earlier ask queued starts the job: nothing refused.
    jobs.jobs.set(JOB, { ...jobs.job(), status: "queued", updatedAt: jobs.job().createdAt });
    const failing = await startPullJob(JOB, {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        startedByLeg(task.jobId);
        throw new Error("Cloud Tasks did not answer.");
      },
      now,
    });
    expect(failing).toEqual({ ok: true, status: "queued" });
    expect(jobs.job()).toMatchObject({ status: "running", error: null });
  });

  // Codex on #372, again: a Stop pressed while an ask is deciding writes `stopAsked` alone, so a
  // stamp-only check let the ask mark "failed" a pull the person had asked to stop.
  it("never ends as failed a job stopped while the ask was deciding", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const pressStop = (jobId: string) =>
      jobs.jobs.set(jobId, { ...jobs.job(jobId), stopAsked: true });
    const now = () => new Date("2026-09-29T18:00:00.000Z");
    const expired = await startPullJob(
      JOB,
      {
        jobs: jobs.docs,
        enqueue: async (task: LegTask): Promise<"already"> => {
          pressStop(task.jobId);
          return "already";
        },
        now,
      },
      NEVER_STARTED_MS * 2
    );
    expect(expired).toEqual({ ok: true, status: "queued" });
    expect(jobs.job()).toMatchObject({ status: "queued", stopAsked: true, error: null });
    // The ask the device sends after its Stop then cancels it.
    const deps = { jobs: jobs.docs, enqueue: async () => undefined, now };
    expect(await startPullJob(JOB, deps, NEVER_STARTED_MS * 2)).toEqual({
      ok: true,
      status: "cancelled",
    });

    // And a queueing that fails while Stop is pressed refuses nothing and fails nothing.
    jobs.jobs.set(JOB, { ...jobs.job(), status: "queued", stopAsked: false });
    const failing = await startPullJob(JOB, {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        pressStop(task.jobId);
        throw new Error("Cloud Tasks did not answer.");
      },
      now,
    });
    expect(failing).toEqual({ ok: true, status: "queued" });
    expect(jobs.job()).toMatchObject({ status: "queued", stopAsked: true, error: null });
  });

  it("has a leg whose job was stopped between its read and its mark cancel it, asking nothing", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const racing: JobDocs = {
      ...jobs.docs,
      piece: async (jobId, index) => {
        jobs.jobs.set(jobId, { ...jobs.job(jobId), stopAsked: true });
        return jobs.docs.piece(jobId, index);
      },
    };
    const fetched: string[][] = [];
    const { deps } = legDeps(cloud, jobs, { jobs: racing, fetchTeams: answering(fetched) });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("cancelled");
    expect(fetched).toEqual([]);
    expect(jobs.job()).toMatchObject({ status: "cancelled", stopAsked: true });
  });

  it("has a leg that read a job a start then ended stand aside, not run on", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const job = jobs.job();
    // Between the leg's read and its mark, a start ends the job: an hour with no leg.
    const racing: JobDocs = {
      ...jobs.docs,
      piece: async (jobId, index) => {
        jobs.jobs.set(jobId, {
          ...job,
          status: "failed",
          error: NEVER_STARTED,
          updatedAt: "2026-09-29T13:30:00.000Z",
        });
        return jobs.docs.piece(jobId, index);
      },
    };
    const { deps } = legDeps(cloud, jobs, { jobs: racing });
    expect(await runPullLeg({ jobId: JOB, leg: 0 }, deps)).toBe("over");
    expect(jobs.job()).toMatchObject({ status: "failed", error: NEVER_STARTED });
  });

  it("ends a job through Firestore only at the update time it read it at", async () => {
    const path = `pullJobs/${JOB}`;
    let stored: { fields: Record<string, unknown>; token: string } | null = null;
    let wrote = 0;
    /** A store whose document a leg can change between the read and the write. */
    const docs = {
      readAt: async (at: string) => (at === path && stored ? structuredClone(stored) : null),
      replace: async (at: string, fields: Record<string, unknown>, token: string | null) => {
        if (at !== path || !stored || token !== stored.token) return false;
        wrote += 1;
        stored = { fields, token: `t${wrote + 1}` };
        return true;
      },
    } as unknown as FirestoreRestDocuments;
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const seen = jobs.job();
    stored = { fields: { ...seen }, token: "t1" };
    const rest = restJobDocs(docs);
    const ended = { status: "failed" as const, error: NEVER_STARTED };

    // Changed since it was read, in status or stamp: left as it is.
    stored = { fields: { ...seen, status: "running" }, token: "t1" };
    expect(await rest.updateIfUnchanged(JOB, seen, ended)).toBe(false);
    stored = { fields: { ...seen, updatedAt: "2026-09-29T12:30:00.000Z" }, token: "t1" };
    expect(await rest.updateIfUnchanged(JOB, seen, ended)).toBe(false);
    // A device's Stop writes `stopAsked` alone, leaving the stamp: still a change.
    stored = { fields: { ...seen, stopAsked: true }, token: "t1" };
    expect(await rest.updateIfUnchanged(JOB, seen, ended)).toBe(false);
    expect(wrote).toBe(0);

    // As read: written whole at the token it was read at, every other field kept.
    stored = { fields: { ...seen }, token: "t1" };
    expect(await rest.updateIfUnchanged(JOB, seen, ended)).toBe(true);
    expect(stored).toMatchObject({ fields: { ...seen, ...ended } });
  });

  it("leaves a job a leg has written to, however long it has waited", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    // A leg that failed before it could mark the job running still wrote its error and stamp.
    jobs.jobs.set(JOB, {
      ...jobs.job(),
      error: "The pull's worker stopped (exit 1) without an answer.",
      updatedAt: "2026-09-29T12:30:00.000Z",
    });
    const queued: LegTask[] = [];
    const started = await startPullJob(
      JOB,
      {
        jobs: jobs.docs,
        enqueue: async (task: LegTask): Promise<"already"> => {
          queued.push(task);
          return "already";
        },
        now: () => new Date("2026-09-29T18:00:00.000Z"),
      },
      NEVER_STARTED_MS * 3
    );
    expect(started).toEqual({ ok: true, status: "queued" });
    expect(queued).toEqual([{ jobId: JOB, leg: 0 }]);
    expect(jobs.job().status).toBe("queued");
  });
});

/*
 * A job whose worker died without a word: a staged import's supervisor killed with its container,
 * or a leg of the older runner that never wrote again. One said "running, loading; part 9 of 18;
 * stop asked" for days from 12 October 2026, with nothing left that would ever end it, Stop doing
 * nothing and Refresh now held off behind it. `startPull` ends such a job when it is asked about
 * it (`reapPullJob`), as failed, or cancelled where a stop was asked; and the cloud ends every one
 * it finds running on its own rounds (`reapSilentPulls`), since that list's device no longer showed
 * it, and nothing else would ever ask.
 */
describe("a pull nothing has been heard from", () => {
  const T = Date.parse("2026-10-14T12:00:00.000Z");
  const before = (ms: number) => new Date(T - ms).toISOString();
  const minutes = (count: number) => count * 60_000;

  /** A staged import, running, whose supervisor last beat `silentMs` ago. */
  const staged = async (silentMs: number, patch: Partial<PullJob> = {}) => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    jobs.jobs.set(JOB, {
      ...jobs.job(),
      status: "running",
      stage: "fetching",
      updatedAt: before(silentMs + minutes(1)),
      progressAt: before(silentMs + minutes(1)),
      heartbeatAt: before(silentMs),
      ...patch,
    });
    return jobs;
  };
  /** A leg of the older runner's list, running, last written `silentMs` ago. */
  const legacy = async (silentMs: number, patch: Partial<PullJob> = {}) => {
    const jobs = memoryJobs();
    await jobs.put(LIST, { legTeams: 1 });
    const job = { ...jobs.job(), status: "running" as const, stage: "loading" as const };
    delete job.pipeline;
    jobs.jobs.set(JOB, { ...job, legsDone: 1, updatedAt: before(silentMs), ...patch });
    return jobs;
  };
  const reaping = (jobs: ReturnType<typeof memoryJobs>, leaseUntil = 0) => {
    const lease = vi.fn(async () => leaseUntil);
    return { lease, deps: { jobs: jobs.docs, leaseUntil: lease, now: () => new Date(T) } };
  };

  it("ends a staged import silent past five minutes whose lease ran out, keeping its downloads", async () => {
    const jobs = await staged(IMPORT_SILENT_MS);
    const { deps, lease } = reaping(jobs, T - 1);
    expect(await reapPullJob(JOB, deps)).toBe("failed");
    expect(lease).toHaveBeenCalledWith(JOB);
    expect(jobs.job()).toMatchObject({
      status: "failed",
      stage: "waiting",
      error: IMPORT_WENT_SILENT,
      updatedAt: new Date(T).toISOString(),
    });
    // The stuck screen's own case: a stop asked of a worker that was already gone.
    const stopped = await staged(minutes(20), { stopAsked: true });
    expect(await reapPullJob(JOB, reaping(stopped).deps)).toBe("cancelled");
    expect(stopped.job()).toMatchObject({ status: "cancelled", error: STOPPED_WENT_SILENT });
  });

  it("leaves an import still holding its lease, one heard from lately, and one not yet started", async () => {
    // Its supervisor still renews the lease: a slow heartbeat write, not a dead worker.
    const leased = await staged(minutes(20));
    expect(await reapPullJob(JOB, reaping(leased, T + 30_000).deps)).toBeNull();
    expect(leased.job().status).toBe("running");

    const recent = await staged(IMPORT_SILENT_MS - 1);
    const quiet = reaping(recent);
    expect(await reapPullJob(JOB, quiet.deps)).toBeNull();
    expect(quiet.lease).not.toHaveBeenCalled();

    // Resumed and waiting for Cloud Run to start it: an old heartbeat says nothing yet.
    const waiting = await staged(minutes(30), { status: "queued", stage: "waiting" });
    expect(await reapPullJob(JOB, reaping(waiting).deps)).toBeNull();
    expect(waiting.job().status).toBe("queued");
    expect(waiting.updates).toEqual([]);
  });

  it("ends a leg of the older runner that nothing has written in two hours, stop asked or not", async () => {
    const quiet = await legacy(LEGS_SILENT_MS);
    const { deps, lease } = reaping(quiet);
    expect(await reapPullJob(JOB, deps)).toBe("failed");
    expect(lease).not.toHaveBeenCalled();
    expect(quiet.job()).toMatchObject({
      status: "failed",
      stage: "waiting",
      error: LEGS_WENT_SILENT,
    });

    const stopped = await legacy(minutes(3 * 24 * 60), { stopAsked: true });
    expect(await reapPullJob(JOB, reaping(stopped).deps)).toBe("cancelled");
    expect(stopped.job()).toMatchObject({ status: "cancelled", legsDone: 1 });

    // A leg is at most three half-hour tries: inside two hours one may still be running.
    const alive = await legacy(LEGS_SILENT_MS - 1);
    expect(await reapPullJob(JOB, reaping(alive).deps)).toBeNull();
    expect(alive.job().status).toBe("running");
  });

  it("ends a Refresh now gone as quiet, and never touches a job that is over or not there", async () => {
    const jobs = memoryJobs();
    jobs.putRefresh(JOB);
    jobs.jobs.set(JOB, { ...jobs.job(), status: "running", updatedAt: before(minutes(180)) });
    expect(await reapPullJob(JOB, reaping(jobs).deps)).toBe("failed");

    for (const status of ["done", "failed", "cancelled"] as const) {
      const over = await legacy(minutes(24 * 60), { status });
      expect(await reapPullJob(JOB, reaping(over).deps)).toBeNull();
      expect(over.updates).toEqual([]);
    }
    expect(await reapPullJob("f".repeat(32), reaping(memoryJobs()).deps)).toBeNull();
    expect(await reapPullJob("not-a-job", reaping(memoryJobs()).deps)).toBeNull();
  });

  it("leaves a job written meanwhile to whatever wrote it", async () => {
    const jobs = await legacy(minutes(180));
    const { deps } = reaping(jobs);
    const raced = await reapPullJob(JOB, {
      ...deps,
      jobs: { ...jobs.docs, updateIfUnchanged: async () => false },
    });
    expect(raced).toBeNull();
    expect(jobs.job().status).toBe("running");
  });

  it("ends every dead pull the cloud finds running, not only one a device asks about", async () => {
    // The 12 October list's own case: stopped days ago, with no device left to ask about it.
    const jobs = await legacy(minutes(4 * 24 * 60), { stopAsked: true });
    const ALIVE = "1".repeat(32);
    const DEAD = "2".repeat(32);
    const ENDED = "3".repeat(32);
    // A staged import at work: a job of the older runner heard from lately would hold the others
    // (below).
    jobs.jobs.set(ALIVE, {
      ...jobs.job(),
      pipeline: "staged-v1",
      stopAsked: false,
      heartbeatAt: before(minutes(1)),
      updatedAt: before(minutes(10)),
    });
    jobs.jobs.set(DEAD, { ...jobs.job(), stopAsked: false, updatedAt: before(LEGS_SILENT_MS) });
    // Ended between the query and its read: found running, and left as it now is.
    jobs.jobs.set(ENDED, { ...jobs.job(), status: "done" });
    const swept = await reapSilentPulls({
      ...reaping(jobs).deps,
      running: async () => [
        { id: JOB },
        { id: ALIVE },
        { id: DEAD },
        { id: ENDED },
        { id: "f".repeat(32) },
        { id: "not-a-job" },
      ],
    });
    expect(swept).toEqual({ running: 6, ended: 2 });
    expect(jobs.job()).toMatchObject({ status: "cancelled", error: LEGS_WENT_SILENT });
    expect(jobs.jobs.get(DEAD)).toMatchObject({ status: "failed", error: LEGS_WENT_SILENT });
    expect(jobs.jobs.get(ALIVE)?.status).toBe("running");
    expect(jobs.jobs.get(ENDED)?.status).toBe("done");
  });

  it("leaves the job its caller acts on itself, and ends no more once told to stop", async () => {
    const jobs = await legacy(minutes(180));
    const OTHER = "4".repeat(32);
    const THIRD = "5".repeat(32);
    jobs.jobs.set(OTHER, jobs.job());
    jobs.jobs.set(THIRD, jobs.job());
    const { deps } = reaping(jobs);
    // A Resume is launching JOB again: the round must not end it from under that.
    const skipped = await reapSilentPulls({
      ...deps,
      skip: JOB,
      running: async () => [{ id: JOB }, { id: OTHER }],
    });
    expect(skipped).toEqual({ running: 2, ended: 1 });
    expect(jobs.job().status).toBe("running");
    expect(jobs.jobs.get(OTHER)?.status).toBe("failed");
    // Its caller's time ran out after the first: the rest are left to the next round.
    let reads = 0;
    const stopping = await reapSilentPulls({
      ...deps,
      jobs: {
        ...jobs.docs,
        read: async (jobId) => {
          reads += 1;
          return jobs.docs.read(jobId);
        },
      },
      stopped: () => reads > 0,
      running: async () => [{ id: JOB }, { id: THIRD }],
    });
    expect(stopping).toEqual({ running: 2, ended: 1 });
    expect(jobs.job().status).toBe("failed");
    expect(jobs.jobs.get(THIRD)?.status).toBe("running");
  });

  it("goes on past a pull it could not read, leaving that one to its next round", async () => {
    const jobs = await legacy(minutes(180));
    const OTHER = "4".repeat(32);
    const IMPORT = "6".repeat(32);
    jobs.jobs.set(OTHER, jobs.job());
    jobs.jobs.set(IMPORT, {
      ...jobs.job(),
      pipeline: "staged-v1",
      heartbeatAt: before(minutes(20)),
      updatedAt: before(minutes(20)),
    });
    const { deps } = reaping(jobs);
    const swept = await reapSilentPulls({
      ...deps,
      jobs: {
        ...jobs.docs,
        read: async (jobId) => {
          if (jobId === JOB) throw new Error("HTTP 503");
          return jobs.docs.read(jobId);
        },
      },
      running: async () => [{ id: JOB }, { id: OTHER }, { id: IMPORT }],
    });
    expect(swept).toEqual({ running: 3, ended: 1 });
    expect(jobs.job().status).toBe("running");
    // The one unread may be the leg at work that the other waits behind: no job of the older
    // runner is ended on a round that cannot tell. A dead import still is.
    expect(jobs.jobs.get(OTHER)?.status).toBe("running");
    expect(jobs.jobs.get(IMPORT)).toMatchObject({ status: "failed", error: IMPORT_WENT_SILENT });
  });

  it("leaves a job of the older runner waiting its turn behind other pulls' legs", async () => {
    // Between legs for three hours, queued behind the legs of another list, written ten minutes ago.
    const jobs = await legacy(minutes(180));
    const BUSY = "7".repeat(32);
    jobs.jobs.set(BUSY, { ...jobs.job(), updatedAt: before(minutes(10)) });
    const { deps } = reaping(jobs);
    const running = async () => [{ id: JOB }, { id: BUSY }];
    expect(await reapSilentPulls({ ...deps, running })).toEqual({ running: 2, ended: 0 });
    expect(jobs.job().status).toBe("running");
    // Asked about on its own, as startPull asks, it is left the same.
    const legsHeard = () => legsLastHeard([{ id: JOB }, { id: BUSY }], jobs.docs, deps.now);
    expect(await reapPullJob(JOB, { ...deps, legsHeard })).toBeNull();
    expect(await legsHeard()).toBe(T - minutes(10));
    // Once the whole queue has been as quiet, both are taken for dead.
    jobs.jobs.set(BUSY, { ...jobs.job(), updatedAt: before(LEGS_SILENT_MS) });
    expect(await reapSilentPulls({ ...deps, running })).toEqual({ running: 2, ended: 2 });
    expect(jobs.job().status).toBe("failed");
    expect(jobs.jobs.get(BUSY)?.status).toBe("failed");
  });

  it("ends nothing once its time is up, waiting for a write already sent", async () => {
    const jobs = await legacy(minutes(180));
    const { deps } = reaping(jobs);
    // In time: as a round with no limit.
    expect(
      await reapSilentPullsWithin({ ...deps, running: async () => [{ id: JOB }] }, 1_000)
    ).toEqual({ ended: 1, late: false });

    // The listing comes back after the time is up: nothing is ended behind the caller.
    const slow = await legacy(minutes(180));
    const slowDeps = reaping(slow).deps;
    let listed = () => undefined as void;
    const listing = new Promise<void>((resolve) => {
      listed = resolve;
    });
    const late = await reapSilentPullsWithin(
      {
        ...slowDeps,
        running: async () => {
          await listing;
          return [{ id: JOB }];
        },
      },
      10
    );
    expect(late).toEqual({ ended: 0, late: true });
    listed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slow.job().status).toBe("running");
    expect(slow.updates).toEqual([]);

    // Its read of the job comes back after the time is up: the write it would make is not sent.
    const reading = await legacy(minutes(180));
    const readingDeps = reaping(reading).deps;
    const unsent = await reapSilentPullsWithin(
      {
        ...readingDeps,
        jobs: {
          ...reading.docs,
          read: async (jobId) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return reading.docs.read(jobId);
          },
        },
        running: async () => [{ id: JOB }],
      },
      10
    );
    expect(unsent).toEqual({ ended: 0, late: true });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reading.job().status).toBe("running");
    expect(reading.updates).toEqual([]);

    // A write sent before the time was up is waited for, and counted.
    const sent = await legacy(minutes(180));
    const sentDeps = reaping(sent).deps;
    const writing = await reapSilentPullsWithin(
      {
        ...sentDeps,
        jobs: {
          ...sent.docs,
          updateIfUnchanged: async (jobId, seen, patch) => {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return sent.docs.updateIfUnchanged(jobId, seen, patch);
          },
        },
        running: async () => [{ id: JOB }],
      },
      10
    );
    expect(writing).toEqual({ ended: 1, late: true });
    expect(sent.job().status).toBe("failed");

    // A listing that fails after the time is up is nobody's to hear: the race has handled it.
    const failing = await reapSilentPullsWithin(
      {
        ...deps,
        running: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error("HTTP 503");
        },
      },
      5
    );
    expect(failing).toEqual({ ended: 0, late: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
});

describe("resuming an import", () => {
  const T = new Date("2026-10-14T12:00:00.000Z");
  const resuming = (jobs: ReturnType<typeof memoryJobs>) => {
    const launched: string[] = [];
    const deps = {
      jobs: jobs.docs,
      launch: async (jobId: string) => {
        launched.push(jobId);
      },
      now: () => T,
    };
    return { launched, deps };
  };

  it("queues and launches a failed or stopped import again, and leaves a live one running", async () => {
    for (const status of ["failed", "cancelled"] as const) {
      const jobs = memoryJobs();
      await jobs.put(LIST);
      jobs.jobs.set(JOB, { ...jobs.job(), status, stopAsked: status === "cancelled" });
      const { launched, deps } = resuming(jobs);
      expect(await resumePullJob(JOB, deps)).toEqual({ ok: true, status: "queued" });
      expect(launched).toEqual([JOB]);
      expect(jobs.job()).toMatchObject({ status: "queued", stopAsked: false, error: null });
    }
    const live = memoryJobs();
    await live.put(LIST);
    live.jobs.set(JOB, {
      ...live.job(),
      status: "running",
      heartbeatAt: new Date(T.getTime() - 30_000).toISOString(),
    });
    const { launched, deps } = resuming(live);
    expect(await resumePullJob(JOB, deps)).toEqual({ ok: true, status: "running" });
    expect(launched).toEqual([]);
  });

  it("relaunches a staged import gone silent while still marked running", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    jobs.jobs.set(JOB, {
      ...jobs.job(),
      status: "running",
      heartbeatAt: new Date(T.getTime() - 10 * 60_000).toISOString(),
    });
    const { launched, deps } = resuming(jobs);
    expect(await resumePullJob(JOB, deps)).toEqual({ ok: true, status: "queued" });
    expect(launched).toEqual([JOB]);
  });

  it("moves a stopped older pull onto the staged importer, keeping what it filed", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const old = { ...jobs.job(), status: "cancelled" as const };
    delete old.pipeline;
    old.tally = { ...old.tally, asked: 3, answered: 2, failed: 1, filed: 2 };
    jobs.jobs.set(JOB, old);
    const { launched, deps } = resuming(jobs);
    expect(await resumePullJob(JOB, deps)).toEqual({ ok: true, status: "queued" });
    expect(jobs.job()).toMatchObject({ pipeline: "staged-v1", priorTally: old.tally });
    expect(launched).toEqual([JOB]);
  });

  it("refuses an older pull still running, Refresh now, and anything that is not a job", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const old = { ...jobs.job(), status: "running" as const };
    delete old.pipeline;
    jobs.jobs.set(JOB, old);
    const { launched, deps } = resuming(jobs);
    expect(await resumePullJob(JOB, deps)).toMatchObject({
      ok: false,
      refusal: "invalid-argument",
    });
    jobs.putRefresh(JOB);
    expect(await resumePullJob(JOB, deps)).toMatchObject({
      ok: false,
      refusal: "invalid-argument",
    });
    expect(await resumePullJob("not-a-job", deps)).toMatchObject({
      ok: false,
      refusal: "invalid-argument",
    });
    expect(launched).toEqual([]);
  });

  it("refuses a list longer than one pull takes, launching nothing", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const teams = 448_645;
    jobs.jobs.set(JOB, { ...jobs.job(), status: "failed", list: { ...jobs.job().list, teams } });
    const { launched, deps } = resuming(jobs);
    expect(await resumePullJob(JOB, deps)).toEqual({
      ok: false,
      refusal: "invalid-argument",
      message: tooManyTeams(teams),
    });
    expect(launched).toEqual([]);
    expect(jobs.job().status).toBe("failed");
  });
});

describe("a list longer than one pull takes", () => {
  it("is ended, and refused in words, rather than started, however old the tab that sent it", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    const teams = MAX_LIST_TEAMS + 1;
    jobs.jobs.set(JOB, { ...jobs.job(), list: { ...jobs.job().list, teams } });
    const queued: LegTask[] = [];
    const started = await startPullJob(JOB, {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        queued.push(task);
      },
      now: () => new Date("2026-10-14T12:00:00.000Z"),
    });
    expect(started).toEqual({
      ok: false,
      refusal: "invalid-argument",
      message: tooManyTeams(teams),
    });
    expect(queued).toEqual([]);
    expect(jobs.job()).toMatchObject({ status: "failed", error: tooManyTeams(teams) });
  });

  it("starts a list of exactly that many", async () => {
    const jobs = memoryJobs();
    await jobs.put(LIST);
    jobs.jobs.set(JOB, { ...jobs.job(), list: { ...jobs.job().list, teams: MAX_LIST_TEAMS } });
    const queued: LegTask[] = [];
    const started = await startPullJob(JOB, {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        queued.push(task);
      },
      now: () => new Date("2026-10-14T12:00:00.000Z"),
    });
    expect(started).toEqual({ ok: true, status: "queued" });
    expect(queued).toEqual([{ jobId: JOB, leg: 0 }]);
  });
});

describe("pulls under way when Team Rankings is started again", () => {
  /** The gate as the nightly leaves it while it pulls, said `minutesAgo`; none at all for null. */
  const gateOf = (minutesAgo: number | null, now: Date) => ({
    readAt: async (path: string) =>
      path === REFRESH_GATE_PATH && minutesAgo !== null
        ? {
            fields: {
              jobId: null,
              nightlyAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
              day: "2026-10-02",
              legs: 0,
            },
            token: "t1",
          }
        : null,
  });

  it("are each asked to stop as a device's Stop asks, the nightly said, and nothing else touched", async () => {
    const jobs = memoryJobs();
    const now = new Date("2026-10-02T16:30:00.000Z");
    const ids = {
      queued: "1".repeat(32),
      running: "2".repeat(32),
      refresh: "3".repeat(32),
      done: "4".repeat(32),
      failed: "5".repeat(32),
      cancelled: "6".repeat(32),
      stopping: "7".repeat(32),
    };
    await jobs.put(LIST, { jobId: ids.queued });
    await jobs.put(LIST, { jobId: ids.running });
    jobs.jobs.set(ids.running, { ...jobs.job(ids.running), status: "running", stage: "fetching" });
    jobs.putRefresh(ids.refresh);
    jobs.jobs.set(ids.refresh, { ...jobs.job(ids.refresh), status: "running" });
    for (const status of ["done", "failed", "cancelled"] as const) {
      await jobs.put(LIST, { jobId: ids[status] });
      jobs.jobs.set(ids[status], { ...jobs.job(ids[status]), status });
    }
    await jobs.put(LIST, { jobId: ids.stopping });
    jobs.jobs.set(ids.stopping, { ...jobs.job(ids.stopping), status: "running", stopAsked: true });
    const before = new Map([...jobs.jobs].map(([id, job]) => [id, structuredClone(job)]));
    const listed = async () => [
      ...[...jobs.jobs].map(([id, job]) => ({ id, fields: structuredClone(job) as never })),
      // A document no job is made of is not asked anything.
      { id: "not-a-job", fields: { status: "running" } },
    ];
    const stopped = await stopPullsUnderWay({
      start: START,
      landed: async () => null,
      list: listed,
      jobs: jobs.docs,
      gate: gateOf(null, now),
      now: () => now,
    });
    expect(stopped).toEqual({ pulls: 3, nightly: false });
    // Each asked once, with the one field a device's Stop writes, and its stamp left as it was.
    expect(jobs.updates).toEqual([{ stopAsked: true }, { stopAsked: true }, { stopAsked: true }]);
    for (const [id, job] of jobs.jobs) {
      const was = before.get(id)!;
      const asked = id === ids.queued || id === ids.running || id === ids.refresh;
      expect(job, id).toEqual(asked ? { ...was, stopAsked: true } : was);
    }
    // The nightly is said while it says it is pulling, and not once its word has run out.
    const pulling = await stopPullsUnderWay({
      start: START,
      landed: async () => null,
      list: listed,
      jobs: jobs.docs,
      gate: gateOf(30, now),
      now: () => now,
    });
    expect(pulling).toEqual({ pulls: 0, nightly: true });
    const late = await stopPullsUnderWay({
      start: START,
      landed: async () => null,
      list: listed,
      jobs: jobs.docs,
      gate: gateOf(NIGHTLY_HOLD_MS / 60_000 + 1, now),
      now: () => now,
    });
    expect(late).toEqual({ pulls: 0, nightly: false });
  });

  it("stops only the pulls Firestore made before the start landed, by Firestore's own clock", async () => {
    const jobs = memoryJobs();
    const now = new Date("2026-10-02T16:30:00.000Z");
    // The server stamped the save a moment before Firestore committed it.
    const start = { copy: "c0ffee", epoch: "new", at: "2026-10-02T16:28:59.500Z" };
    const landedAt = "2026-10-02T16:29:00.000000Z";
    const ids = {
      before: "1".repeat(32),
      after: "2".repeat(32),
      same: "3".repeat(32),
      inCommit: "4".repeat(32),
      onNew: "5".repeat(32),
      unstamped: "6".repeat(32),
    };
    for (const id of Object.values(ids)) await jobs.put(LIST, { jobId: id });
    // A list sent before the start whose worker went on to read the new one is still from before.
    jobs.jobs.set(ids.onNew, {
      ...jobs.job(ids.onNew),
      status: "running",
      on: { copy: "c0ffee", epoch: "new" },
    });
    // When Firestore made each job's document, by its own clock, in the finer time it keeps.
    const made: Record<string, string | undefined> = {
      [ids.before]: "2026-10-02T16:28:59.000000Z",
      [ids.after]: "2026-10-02T16:29:00.000001Z",
      [ids.same]: "2026-10-02T16:29:00.000000Z",
      // After the server's stamp, before the commit landed: it may have read the old copy.
      [ids.inCommit]: "2026-10-02T16:28:59.800000Z",
      [ids.onNew]: "2026-10-02T16:20:00.000000Z",
      [ids.unstamped]: undefined,
    };
    const list = async () =>
      [...jobs.jobs].map(([id, job]) => {
        const createdAt = made[id];
        return { id, fields: structuredClone(job) as never, ...(createdAt ? { createdAt } : {}) };
      });
    const asked = () =>
      [...jobs.jobs]
        .filter(([, job]) => job.stopAsked)
        .map(([id]) => id)
        .sort();
    const stopped = await stopPullsUnderWay({
      start,
      landed: async () => ({ fields: { copy: "c0ffee", epoch: "new" }, token: landedAt }),
      list,
      jobs: jobs.docs,
      gate: gateOf(null, now),
      now: () => now,
    });
    expect(asked()).toEqual([ids.before, ids.inCommit, ids.onNew, ids.unstamped].sort());
    expect(stopped).toEqual({ pulls: 4, nightly: false });
    // A manifest moved on to another start, or unreadable, leaves the server's stamp to stand.
    for (const landed of [
      async () => ({ fields: { copy: "c0ffee", epoch: "newer" }, token: landedAt }),
      async () => ({ fields: { copy: "other", epoch: "new" }, token: landedAt }),
      async () => {
        throw new Error("unreachable");
      },
    ]) {
      for (const id of Object.values(ids)) jobs.jobs.set(id, { ...jobs.job(id), stopAsked: false });
      await stopPullsUnderWay({
        start,
        landed,
        list,
        jobs: jobs.docs,
        gate: gateOf(null, now),
        now: () => now,
      });
      expect(asked()).toEqual([ids.before, ids.onNew, ids.unstamped].sort());
    }
  });

  it("stops a leg under way at its next look, which then files nothing into the emptied copy", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    // The clubs filed by an earlier pull, and the same handful pasted again.
    await jobs.put(LIST, { jobId: "a".repeat(32) });
    await runPullLeg({ jobId: "a".repeat(32), leg: 0 }, legDeps(cloud, jobs).deps);
    await jobs.put(LIST);
    let started: CloudManifest | null = null;
    // While GameChanger answers the leg, the owner starts again, and the edit function asks the
    // pulls under way to stop; the leg then sees its stop.
    const meanwhile: LegDeps["fetchTeams"] = async (ids, options) => {
      started = await startAgain(cloud);
      await stopPullsUnderWay({
        start: { ...epochOf(started), at: started.updatedAt },
        landed: async () => null,
        list: async () =>
          [[JOB, jobs.job()] as const].map(([id, job]) => ({ id, fields: job as never })),
        jobs: jobs.docs,
        gate: { readAt: async () => null },
        now: () => new Date("2026-10-02T16:20:00.000Z"),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return answering()(ids, { ...options });
    };
    const { deps } = legDeps(cloud, jobs, { fetchTeams: meanwhile });
    const ended = await runPullLeg({ jobId: JOB, leg: 0 }, deps);
    expect(["failed", "cancelled"]).toContain(ended);
    expect(jobs.job().stopAsked).toBe(true);
    expect(cloud.manifest()).toEqual(started);
    expect(await clubsIn(cloud)).toEqual([]);
  });
});

/*
 * A list longer than one job takes, sent as parts that run one after another (`PullJob.chain`):
 * the page starts the first, and the cloud starts each next part when the one before it is done
 * (`startNextPart`), never two at once, and never one stopped with the list.
 */
describe("a list sent in parts", () => {
  const PARTS = ["1".repeat(32), "2".repeat(32), "3".repeat(32)] as const;
  const [FIRST, SECOND, THIRD] = PARTS;

  /** The list's three parts, as the page writes them, each naming the next. */
  const putParts = async (jobs: ReturnType<typeof memoryJobs>) => {
    for (const [index, jobId] of PARTS.entries()) {
      const next = PARTS[index + 1];
      await jobs.put(LIST, {
        jobId,
        chain: { id: FIRST, part: index + 1, parts: 3, teams: 9, ...(next ? { next } : {}) },
      });
    }
  };
  const nexting = (
    jobs: ReturnType<typeof memoryJobs>,
    enqueue: (task: LegTask) => Promise<void | "already"> = async () => undefined
  ) => {
    const queued: LegTask[] = [];
    const deps = {
      jobs: jobs.docs,
      enqueue: async (task: LegTask) => {
        queued.push(task);
        return enqueue(task);
      },
      now: () => new Date("2026-10-16T18:00:00.000Z"),
    };
    return { queued, deps };
  };

  it("starts the next part once a part is done, as a list is started, and on nothing else", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    const { queued, deps } = nexting(jobs);
    // A part under way, failed or stopped starts nothing: Resume on it carries the list on.
    for (const status of ["queued", "running", "failed", "cancelled"] as const) {
      jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status });
      expect(await startNextPart(FIRST, deps), status).toEqual({ kind: "none" });
    }
    expect(queued).toEqual([]);
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    expect(await startNextPart(FIRST, deps)).toEqual({
      kind: "started",
      part: 2,
      answer: { ok: true, status: "queued" },
    });
    expect(queued).toEqual([{ jobId: SECOND, leg: 0 }]);
    // The last part, and a list sent whole, have no next to start.
    jobs.jobs.set(THIRD, { ...jobs.job(THIRD), status: "done" });
    expect(await startNextPart(THIRD, deps)).toEqual({ kind: "none" });
    await jobs.put(LIST);
    jobs.jobs.set(JOB, { ...jobs.job(), status: "done" });
    expect(await startNextPart(JOB, deps)).toEqual({ kind: "none" });
    expect(await startNextPart("f".repeat(32), deps)).toEqual({ kind: "none" });
    expect(queued).toHaveLength(1);
  });

  it("leaves a next part asked to stop, under way, over, gone, or not this list's next", async () => {
    const spoil: Array<[string, (job: PullJob) => PullJob | null]> = [
      ["stop asked", (job) => ({ ...job, stopAsked: true })],
      ["running", (job) => ({ ...job, status: "running" })],
      ["cancelled", (job) => ({ ...job, status: "cancelled" })],
      ["failed", (job) => ({ ...job, status: "failed" })],
      ["done", (job) => ({ ...job, status: "done" })],
      ["gone", () => null],
      ["another list's", (job) => ({ ...job, chain: { ...job.chain!, id: "4".repeat(32) } })],
      ["another place", (job) => ({ ...job, chain: { ...job.chain!, part: 3 } })],
    ];
    for (const [why, change] of spoil) {
      const jobs = memoryJobs();
      await putParts(jobs);
      jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
      const spoiled = change(jobs.job(SECOND));
      if (spoiled) jobs.jobs.set(SECOND, spoiled);
      else jobs.jobs.delete(SECOND);
      const { queued, deps } = nexting(jobs);
      expect(await startNextPart(FIRST, deps), why).toEqual({ kind: "left", part: 2 });
      expect(queued, why).toEqual([]);
      expect(jobs.jobs.get(SECOND)?.status, why).toBe(spoiled?.status);
    }
  });

  it("never ends a later part as one the cloud left waiting, however long it waited its turn", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    // Its turn hours after it was written, its task already queued and nothing having touched it:
    // as a start that says how long it waited would end it (`NEVER_STARTED`).
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    const { deps } = nexting(jobs, async () => "already");
    expect(await startNextPart(FIRST, deps)).toMatchObject({
      kind: "started",
      answer: { ok: true, status: "queued" },
    });
    expect(jobs.job(SECOND)).toMatchObject({ status: "queued", error: null });
  });

  // A tab still running a page from before lists were split takes each part for a list of its own
  // waiting to start, and asks for it every minute, saying it has waited since the sending.
  it("starts a later part asked for by any device only once the part before it is done", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    const { queued, deps } = nexting(jobs, async () => "already");
    const hours = 3 * NEVER_STARTED_MS;
    for (const status of ["queued", "running", "failed", "cancelled"] as const) {
      jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status });
      expect(await startPullJob(SECOND, deps, hours), status).toEqual({
        ok: true,
        status: "queued",
      });
      expect(await startPullJob(THIRD, deps, hours), status).toEqual({
        ok: true,
        status: "queued",
      });
    }
    expect(queued).toEqual([]);
    expect(jobs.job(SECOND)).toMatchObject({ status: "queued", error: null });
    // Stopped, it is still cancelled by the ask, its turn come or not.
    jobs.jobs.set(THIRD, { ...jobs.job(THIRD), stopAsked: true });
    expect(await startPullJob(THIRD, deps)).toEqual({ ok: true, status: "cancelled" });
    // Its turn come, it is started as any list.
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    expect(await startPullJob(SECOND, deps)).toEqual({ ok: true, status: "queued" });
    expect(queued).toEqual([{ jobId: SECOND, leg: 0 }]);
  });

  it("says so, ending nothing, when the parts before a part cannot be read", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    const read = jobs.docs.read;
    jobs.docs.read = async (jobId) => {
      if (jobId === FIRST) throw new Error("Firestore is unavailable.");
      return read(jobId);
    };
    const { queued, deps } = nexting(jobs);
    expect(await startPullJob(SECOND, deps)).toEqual({
      ok: false,
      refusal: "unavailable",
      message: "The cloud could not read this pull's list: Firestore is unavailable.",
    });
    expect(queued).toEqual([]);
    expect(jobs.job(SECOND).status).toBe("queued");
  });

  it("touches the part it starts, so no device's ask then ends it as never started", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    const { deps } = nexting(jobs, async () => "already");
    await startNextPart(FIRST, deps);
    expect(jobs.job(SECOND).updatedAt).toBe("2026-10-16T18:00:00.000Z");
    expect(jobs.job(SECOND).updatedAt).not.toBe(jobs.job(SECOND).createdAt);
    // An older page's ask, timing its wait from the sending, while the importer starts up.
    expect(await startPullJob(SECOND, deps, 3 * NEVER_STARTED_MS)).toEqual({
      ok: true,
      status: "queued",
    });
    expect(jobs.job(SECOND)).toMatchObject({ status: "queued", error: null });
  });

  it("is carried on by the older runner's last leg as by the importer", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const jobs = memoryJobs();
    await putParts(jobs);
    const { deps, queued } = legDeps(cloud, jobs);
    expect(await runPullLeg({ jobId: FIRST, leg: 0 }, deps)).toBe("done");
    expect(queued).toEqual([{ jobId: SECOND, leg: 0 }]);
    // A next part that cannot even be read fails no leg of a part already done and saved.
    const failing = memoryJobs();
    await putParts(failing);
    const read = failing.docs.read;
    failing.docs.read = async (jobId) => {
      if (jobId === SECOND) throw new Error("Firestore is unavailable.");
      return read(jobId);
    };
    const broken = legDeps(cloud, failing, { lastTry: true });
    expect(await runPullLeg({ jobId: FIRST, leg: 0 }, broken.deps)).toBe("done");
    expect(failing.job(FIRST)).toMatchObject({ status: "done", error: null });
    expect(broken.queued).toEqual([]);
  });

  it("puts the parts stopped with a part back in the queue when it is resumed, and carries on", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    // Stop pressed on part 2: it ended cancelled, and part 3, which never ran, was cancelled too.
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    jobs.jobs.set(SECOND, { ...jobs.job(SECOND), status: "cancelled", stopAsked: true });
    jobs.jobs.set(THIRD, { ...jobs.job(THIRD), status: "cancelled", stopAsked: true });
    const launched: string[] = [];
    const resumed = await resumePullJob(SECOND, {
      jobs: jobs.docs,
      launch: async (jobId) => {
        launched.push(jobId);
      },
      now: () => new Date("2026-10-16T18:00:00.000Z"),
    });
    expect(resumed).toEqual({ ok: true, status: "queued" });
    expect(launched).toEqual([SECOND]);
    expect(jobs.job(THIRD)).toMatchObject({ status: "queued", stopAsked: false, error: null });
    // The part before it, done, is left as it was.
    expect(jobs.job(FIRST).status).toBe("done");
    // Once the resumed part is done, the list carries on from it.
    jobs.jobs.set(SECOND, { ...jobs.job(SECOND), status: "done" });
    const { queued, deps } = nexting(jobs);
    expect(await startNextPart(SECOND, deps)).toMatchObject({ kind: "started", part: 3 });
    expect(queued).toEqual([{ jobId: THIRD, leg: 0 }]);
  });

  it("leaves, on Resume, the parts after it that a stop never reached, or that ran", async () => {
    for (const [why, later, expected] of [
      [
        "queued, stop asked",
        { status: "queued", stopAsked: true },
        { status: "queued", stopAsked: false },
      ],
      ["queued", { status: "queued", stopAsked: false }, { status: "queued", stopAsked: false }],
      ["failed", { status: "failed", stopAsked: false }, { status: "failed" }],
      ["running", { status: "running", stopAsked: false }, { status: "running" }],
    ] as const) {
      const jobs = memoryJobs();
      await putParts(jobs);
      jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "failed" });
      jobs.jobs.set(SECOND, { ...jobs.job(SECOND), ...later });
      const before = jobs.job(SECOND).updatedAt;
      await resumePullJob(FIRST, {
        jobs: jobs.docs,
        launch: async () => undefined,
        now: () => new Date("2026-10-16T18:00:00.000Z"),
      });
      expect(jobs.job(SECOND), why).toMatchObject(expected);
      if (why !== "queued, stop asked") expect(jobs.job(SECOND).updatedAt, why).toBe(before);
    }
  });

  // A start of Team Rankings asks every queued or running pull to stop: the list's later parts too.
  it("starts no later part once Team Rankings is started again", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "running", stage: "fetching" });
    const now = new Date("2026-10-16T18:00:00.000Z");
    const stopped = await stopPullsUnderWay({
      // Parts sent before the start: Firestore says nothing here of when each was made.
      start: START,
      landed: async () => null,
      list: async () =>
        [...jobs.jobs].map(([id, job]) => ({
          id,
          fields: structuredClone(job) as unknown as Record<string, unknown>,
        })),
      jobs: jobs.docs,
      gate: { readAt: async () => null },
      now: () => now,
    });
    expect(stopped).toEqual({ pulls: 3, nightly: false });
    // The part under way ends done all the same (its final save already begun): nothing follows.
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    const { queued, deps } = nexting(jobs);
    expect(await startNextPart(FIRST, deps)).toEqual({ kind: "left", part: 2 });
    // A device's ask about a part asked to stop cancels it, its turn come or not.
    expect(await startPullJob(SECOND, deps)).toEqual({ ok: true, status: "cancelled" });
    expect(await startPullJob(THIRD, deps)).toEqual({ ok: true, status: "cancelled" });
    expect(queued).toEqual([]);
  });

  it("holds each part to the cap, refusing a single job longer than one pull takes", async () => {
    const jobs = memoryJobs();
    await putParts(jobs);
    const teams = MAX_LIST_TEAMS + 1;
    jobs.jobs.set(FIRST, { ...jobs.job(FIRST), status: "done" });
    jobs.jobs.set(SECOND, { ...jobs.job(SECOND), list: { ...jobs.job(SECOND).list, teams } });
    const { queued, deps } = nexting(jobs);
    expect(await startNextPart(FIRST, deps)).toEqual({
      kind: "started",
      part: 2,
      answer: { ok: false, refusal: "invalid-argument", message: tooManyTeams(teams) },
    });
    expect(queued).toEqual([]);
  });
});
