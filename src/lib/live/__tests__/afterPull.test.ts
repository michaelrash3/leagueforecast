import { afterAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges, type Change } from "../../cloud/cloudEngine";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import { newPullJob, type PullJob } from "../../cloud/pullJobs";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import {
  AFTER_PULL_ASK_MS,
  afterPullDecision,
  askInTime,
  launchAfterPull,
  publishAfterPull,
  rebuildWillPublish,
  type AfterPullStores,
} from "../afterPull";
import { NO_LEAGUE_DOCS } from "../cloudLeague";
import { BOARD_FAMILY } from "../views/boardShape";
import { RUN_CEILING } from "../rebuildLedger";
import { memoryLive, type MemoryLive } from "./memoryLive";

/*
 * The boards published when a pull ends (`afterPull.ts`): at once, where no rebuild after the
 * pull's save is coming to publish them, without the catch-up's wait for the copy to be still; and
 * left to the rebuild where one is.
 */

describe("whether a rebuild after a save is coming to publish the boards", () => {
  const DAY = "2026-10-16";
  const NOW = new Date("2026-10-16T18:00:00.000Z");
  // The job's engine, as the deployed ledger carries it; without it, a reserve takes the ledger
  // to be the old function's, and clears a pause (`reserveRun`).
  const ledgerOf = (more: Record<string, unknown> = {}) => ({
    on: true,
    mode: "live",
    engine: "job-v1",
    day: DAY,
    month: "2026-10",
    ...more,
  });
  /** October 2026's ledger on the 16th: its month's vCPU cap spent, so the rebuilds deferred. */
  const SPENT = ledgerOf({ monthGiBs: 113_924, monthVcpuS: 49_530 });
  const held = (until: number) => ({ owner: "run-1", until });

  it("is coming where the rebuilds are on, publishing, and have the budget for a run", () => {
    expect(rebuildWillPublish(ledgerOf(), null, DAY, NOW)).toBe(true);
  });

  it("is not where they are off, a dry run, or set up nowhere", () => {
    expect(rebuildWillPublish(null, null, DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ on: false }), null, DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ mode: "dry" }), null, DAY, NOW)).toBe(false);
  });

  it("is not where a month's or a day's cap is spent, or failures paused them for the day", () => {
    expect(rebuildWillPublish(SPENT, null, DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ dayGiBs: 10_000 }), null, DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ pausedDay: DAY, failures: 3 }), null, DAY, NOW)).toBe(
      false
    );
    // A cap spent last month counts nothing in this one.
    expect(rebuildWillPublish({ ...SPENT, month: "2026-09" }, null, DAY, NOW)).toBe(true);
  });

  it("is where one is under way, holding the rebuild job or a run open, whatever the budget", () => {
    expect(rebuildWillPublish(SPENT, held(NOW.getTime() + 60_000), DAY, NOW)).toBe(true);
    // A hold run out is no run at all.
    expect(rebuildWillPublish(SPENT, held(NOW.getTime() - 1), DAY, NOW)).toBe(false);
    const open = {
      at: new Date(NOW.getTime() - 60_000).toISOString(),
      day: DAY,
      cost: RUN_CEILING,
      task: "t",
      by: "b",
    };
    expect(rebuildWillPublish({ ...SPENT, open }, null, DAY, NOW)).toBe(true);
  });
});

const fixture = poolFixture({ seed: 11, clubsPerPage: 30 });
/** The pull's last save, half a minute before it ends: well inside the catch-up's ten minutes. */
const SAVED = "2027-04-15T11:59:30.000Z";
const NOW = new Date("2027-04-15T12:00:00.000Z");

afterAll(() => {
  resetTeamRankingsStore();
});

/** A cloud copy of the fixture's pool, as a pull saved it, with no League Standings of its own. */
const copied = async (): Promise<MemoryCloud> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  changes.push({ key: LEAGUE_PART, value: { seasons: [] }, at: 1 });
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes,
    device: "cloud-pull",
    now: SAVED,
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  resetTeamRankingsStore();
  return cloud;
};

/** A list's import, still filing into the copy, last heard from a minute ago. */
const filing = (): PullJob => ({
  ...newPullJob({
    list: { hash: "0".repeat(64), teams: 30_000, pieces: 1 },
    seasonYears: [],
    timeZone: "America/New_York",
    device: "phone",
    now: new Date(NOW.getTime() - 60_000).toISOString(),
  }),
  status: "running",
  stage: "filing",
});

/** The month's budget of the fixture's day, spent, as October 2026's was. */
const SPENT = {
  on: true,
  mode: "live",
  day: FIXTURE_TODAY,
  month: FIXTURE_TODAY.slice(0, 7),
  monthVcpuS: 49_530,
};

const storesOf = (
  cloud: MemoryCloud,
  live: MemoryLive,
  { ledger = SPENT as unknown, jobs = [] as PullJob[], rebuildJob = null as unknown } = {}
) => {
  const reads = { ledger: 0 };
  const stores: AfterPullStores = {
    copy: cloud.store,
    live: live.store,
    leagueDocs: NO_LEAGUE_DOCS,
    gate: {
      readAt: () => Promise.resolve(null),
      replace: () => Promise.reject(new Error("the gate was written")),
    },
    readCopyAt: () => {
      const manifest = cloud.manifest();
      return Promise.resolve(manifest ? { manifest, savedAt: SAVED } : null);
    },
    pullsUnderWay: () => Promise.resolve(jobs),
    readRebuildJob: () => Promise.resolve(rebuildJob),
    readLedger: () => {
      reads.ledger += 1;
      return Promise.resolve(ledger);
    },
  };
  return { stores, reads };
};

describe("the boards when a pull ends", () => {
  it("are published at once where no rebuild is coming, without waiting for the copy to be still", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const { stores } = storesOf(cloud, live);
    const run = await publishAfterPull(stores, {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      locale: "en-US",
    });
    expect(run.decided).toEqual({ publish: true, behind: "nothing" });
    expect(run.result).toMatchObject({ end: "published", ok: true, tries: 1 });
    // The boards are the copy's as the pull left it.
    const built = live.meta()?.built[BOARD_FAMILY];
    expect(built?.k).toBe(cloud.manifest()?.copy);
    expect(built?.v).toBe(cloud.manifest()?.version);

    // And asked again, are current: nothing more is built or launched.
    const launch = vi.fn(() => Promise.resolve());
    expect(await launchAfterPull(stores, launch, FIXTURE_TODAY, NOW)).toEqual({
      publish: false,
      because: "current",
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("are launched once from the end of the pull where they want publishing", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const launch = vi.fn(() => Promise.resolve());
    expect(await launchAfterPull(storesOf(cloud, live).stores, launch, FIXTURE_TODAY, NOW)).toEqual(
      { publish: true, behind: "nothing" }
    );
    expect(launch).toHaveBeenCalledTimes(1);
    // The launch only asks: the job it starts publishes.
    expect(live.meta()).toBeNull();
  });

  it("are left to a rebuild after the save where one is coming, and nothing is published", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const roomy = { ...SPENT, monthVcpuS: 0 };
    const { stores } = storesOf(cloud, live, { ledger: roomy });
    const launch = vi.fn(() => Promise.resolve());
    expect(await launchAfterPull(stores, launch, FIXTURE_TODAY, NOW)).toEqual({
      publish: false,
      because: "rebuild-coming",
      behind: "nothing",
    });
    expect(launch).not.toHaveBeenCalled();
    expect(await publishAfterPull(stores, { today: () => FIXTURE_TODAY, now: () => NOW })).toEqual({
      decided: { publish: false, because: "rebuild-coming", behind: "nothing" },
    });
    expect(live.meta()).toBeNull();
  });

  it("wait for another import still filing into the copy, whose own end publishes them", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const { stores } = storesOf(cloud, live, { jobs: [filing()] });
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW)).toEqual({
      publish: false,
      because: "pulling",
      behind: "nothing",
    });
  });

  it("read nothing of the rebuilds where the boards are current", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const { stores, reads } = storesOf(cloud, live);
    await publishAfterPull(stores, { today: () => FIXTURE_TODAY, now: () => NOW, locale: "en-US" });
    reads.ledger = 0;
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW)).toEqual({
      publish: false,
      because: "current",
    });
    expect(reads.ledger).toBe(0);
  });
});

describe("the ask at a pull's end, against its caller's deadline", () => {
  const T0 = 1_000_000;

  it("runs where there is no deadline, as in the import job", async () => {
    expect(await askInTime(() => Promise.resolve("asked"), Number.POSITIVE_INFINITY, T0)).toBe(
      "asked"
    );
  });

  it("is not asked at all where less time is left than it needs", async () => {
    const ask = vi.fn(() => Promise.resolve("asked"));
    expect(await askInTime(ask, T0 + AFTER_PULL_ASK_MS - 1, T0)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(await askInTime(ask, T0 + AFTER_PULL_ASK_MS, T0)).toBe("asked");
  });

  it("gives up at the deadline on an ask that has not answered, and holds nothing after", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const answered = askInTime(() => new Promise<string>(() => undefined), now + 40_000, now);
      await vi.advanceTimersByTimeAsync(39_999);
      let settled = false;
      void answered.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await answered).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers as soon as an ask in time does, with no timer left behind", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      expect(await askInTime(() => Promise.resolve(7), now + 60_000, now)).toBe(7);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
