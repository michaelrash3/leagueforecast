import { afterAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges, type Change } from "../../cloud/cloudEngine";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
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
  PUBLISH_ROUNDS,
  publishAfterPull,
  rebuildWillPublish,
  type AfterPullStores,
} from "../afterPull";
import { BOARDS_SETTLE_MS } from "../boardsCheck";
import { NO_LEAGUE_DOCS, type LeagueDocsList } from "../cloudLeague";
import { seasonDocId, seasonToDoc } from "../leagueDocs";
import { LAUNCH_HOLD_MS, publishLease } from "../publishLease";
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

  it("is coming where the rebuilds are on, publishing, and have the budget for a run", () => {
    expect(rebuildWillPublish(ledgerOf(), DAY, NOW)).toBe(true);
  });

  it("is not where they are off, a dry run, or set up nowhere", () => {
    expect(rebuildWillPublish(null, DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ on: false }), DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ mode: "dry" }), DAY, NOW)).toBe(false);
  });

  it("is not where a month's or a day's cap is spent, or failures paused them for the day", () => {
    expect(rebuildWillPublish(SPENT, DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ dayGiBs: 10_000 }), DAY, NOW)).toBe(false);
    expect(rebuildWillPublish(ledgerOf({ pausedDay: DAY, failures: 3 }), DAY, NOW)).toBe(false);
    // A cap spent last month counts nothing in this one.
    expect(rebuildWillPublish({ ...SPENT, month: "2026-09" }, DAY, NOW)).toBe(true);
  });

  it("is where a run is open on the ledger, its budget reserved, whatever is left after it", () => {
    const open = {
      at: new Date(NOW.getTime() - 60_000).toISOString(),
      day: DAY,
      cost: RUN_CEILING,
      task: "t",
      by: "b",
      until: new Date(NOW.getTime() + 60_000).toISOString(),
    };
    expect(rebuildWillPublish({ ...SPENT, open }, DAY, NOW)).toBe(true);
    // One whose span has run out is no run at all.
    const over = { ...open, until: new Date(NOW.getTime() - 1).toISOString() };
    expect(rebuildWillPublish({ ...SPENT, open: over }, DAY, NOW)).toBe(false);
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

/** The boards' publish lease (`publishLease.ts`) over a document of its own in memory. */
const leaseDocs = () => {
  let value: { fields: Record<string, unknown>; token: string } | null = null;
  let revision = 0;
  return {
    readAt: async () => (value ? structuredClone(value) : null),
    replace: async (_: string, fields: Record<string, unknown>, token: string | null) => {
      if (token !== (value?.token ?? null)) return false;
      value = { fields, token: String(++revision) };
      return true;
    },
  };
};
const freeLease = () => publishLease(leaseDocs());
/** What a pull's end asks of the job it starts: no settle, and a rebuild coming counted on. */
const AT_ONCE = { settleMs: 0, rebuilds: true };

/** The fixture's first League Standings season as its document, last written at `updatedAt`. */
const seasonWrittenAt = (updatedAt: string): LeagueDocsList => {
  const [id, stored] = Object.entries(fixture.seasons)[0]!;
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  const season: SeasonSnapshot = {
    id,
    name: "Season 1",
    createdAt: "2026-08-01T12:00:00.000Z",
    teams,
    matchups,
    logs: coerceLogs(stored?.logs ?? null, matchups),
    bracketLogs: {},
    settings: DEFAULT_SETTINGS,
  };
  const fields = JSON.parse(JSON.stringify(seasonToDoc(season))) as Record<string, unknown>;
  return () => Promise.resolve([{ id: seasonDocId(id), fields, updatedAt }]);
};
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

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
  {
    ledger = SPENT as unknown,
    jobs = [] as PullJob[],
    savedAt = SAVED,
    leagueDocs = NO_LEAGUE_DOCS as LeagueDocsList,
    deletedAt = undefined as string | undefined,
  } = {}
) => {
  const reads = { ledger: 0 };
  const stores: AfterPullStores = {
    copy: cloud.store,
    live: live.store,
    leagueDocs,
    gate: {
      readAt: () => Promise.resolve(null),
      replace: () => Promise.reject(new Error("the gate was written")),
    },
    readCopyAt: () => {
      const manifest = cloud.manifest();
      return Promise.resolve(manifest ? { manifest, savedAt } : null);
    },
    pullsUnderWay: () => Promise.resolve(jobs),
    leagueDeletedAt: () => Promise.resolve(deletedAt),
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
      rebuilds: true,
      lease: freeLease(),
      owner: "job",
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
    expect(await launchAfterPull(stores, launch, FIXTURE_TODAY, NOW, true, freeLease())).toEqual({
      publish: false,
      because: "current",
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("are launched once from the end of the pull where they want publishing", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const launch = vi.fn(() => Promise.resolve());
    expect(
      await launchAfterPull(
        storesOf(cloud, live).stores,
        launch,
        FIXTURE_TODAY,
        NOW,
        true,
        freeLease()
      )
    ).toEqual({ publish: true, behind: "nothing" });
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
    expect(await launchAfterPull(stores, launch, FIXTURE_TODAY, NOW, true, freeLease())).toEqual({
      publish: false,
      because: "rebuild-coming",
      behind: "nothing",
    });
    expect(launch).not.toHaveBeenCalled();
    expect(
      await publishAfterPull(stores, {
        today: () => FIXTURE_TODAY,
        now: () => NOW,
        rebuilds: true,
        lease: freeLease(),
        owner: "job",
      })
    ).toEqual({
      decided: { publish: false, because: "rebuild-coming", behind: "nothing" },
      rounds: 1,
    });
    expect(live.meta()).toBeNull();
  });

  it("are published where a rebuild job holds its control with no budget left, which only defers", async () => {
    // A job claims the control before it reserves, and one whose budget is spent defers the moment
    // it asks, publishing nothing: the control is not asked after at all.
    const cloud = await copied();
    const live = memoryLive();
    const readRebuildJob = vi.fn(() =>
      Promise.resolve({ owner: "run-1", until: NOW.getTime() + 60_000, state: "running" })
    );
    const stores = { ...storesOf(cloud, live).stores, readRebuildJob };
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW, true)).toEqual({
      publish: true,
      behind: "nothing",
    });
    expect(readRebuildJob).not.toHaveBeenCalled();
  });

  it("are published where the build deployed no rebuilds, whatever a ledger left on says", async () => {
    // A build without LIVE_REBUILD takes the rebuilds' trigger down, and nothing asks for one.
    const cloud = await copied();
    const live = memoryLive();
    const roomy = { ...SPENT, monthVcpuS: 0 };
    const { stores } = storesOf(cloud, live, { ledger: roomy });
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW, false)).toEqual({
      publish: true,
      behind: "nothing",
    });
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW, true)).toEqual({
      publish: false,
      because: "rebuild-coming",
      behind: "nothing",
    });
  });

  it("wait for another import still filing into the copy, whose own end publishes them", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const { stores } = storesOf(cloud, live, { jobs: [filing()] });
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW, true)).toEqual({
      publish: false,
      because: "pulling",
      behind: "nothing",
    });
  });

  it("read nothing of the rebuilds where the boards are current", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const { stores, reads } = storesOf(cloud, live);
    await publishAfterPull(stores, {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      lease: freeLease(),
      owner: "job",
      locale: "en-US",
    });
    reads.ledger = 0;
    expect(await afterPullDecision(stores, FIXTURE_TODAY, NOW, true)).toEqual({
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
      const answered = askInTime(() => new Promise<string>(() => undefined), now + 70_000, now);
      await vi.advanceTimersByTimeAsync(69_999);
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

describe("a save's check of the boards, and the one publish at a time", () => {
  it("waits until the copy has been still the settle, then publishes", async () => {
    const cloud = await copied();
    const live = memoryLive();
    // The copy saved half a minute ago: a run of edits may still be going on.
    const settling = storesOf(cloud, live).stores;
    expect(await afterPullDecision(settling, FIXTURE_TODAY, NOW, true, BOARDS_SETTLE_MS)).toEqual({
      publish: false,
      because: "settling",
      behind: "nothing",
    });
    const still = storesOf(cloud, live, { savedAt: ago(BOARDS_SETTLE_MS) }).stores;
    expect(await afterPullDecision(still, FIXTURE_TODAY, NOW, true, BOARDS_SETTLE_MS)).toEqual({
      publish: true,
      behind: "nothing",
    });
  });

  it("counts a League Standings season's last write as a save it waits out", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const old = ago(60 * 60_000);
    const scored = storesOf(cloud, live, {
      savedAt: old,
      leagueDocs: seasonWrittenAt(ago(60_000)),
    }).stores;
    expect(await afterPullDecision(scored, FIXTURE_TODAY, NOW, true, BOARDS_SETTLE_MS)).toEqual({
      publish: false,
      because: "settling",
      behind: "nothing",
    });
    const stillLeague = storesOf(cloud, live, {
      savedAt: old,
      leagueDocs: seasonWrittenAt(ago(BOARDS_SETTLE_MS)),
    }).stores;
    expect(
      await afterPullDecision(stillLeague, FIXTURE_TODAY, NOW, true, BOARDS_SETTLE_MS)
    ).toEqual({ publish: true, behind: "nothing" });
  });

  it("counts a season deleted as a save it waits out, though its document is gone", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const old = ago(60 * 60_000);
    const deleted = storesOf(cloud, live, { savedAt: old, deletedAt: ago(30_000) }).stores;
    expect(await afterPullDecision(deleted, FIXTURE_TODAY, NOW, true, BOARDS_SETTLE_MS)).toEqual({
      publish: false,
      because: "settling",
      behind: "nothing",
    });
    const longAgo = storesOf(cloud, live, { savedAt: old, deletedAt: old }).stores;
    expect(await afterPullDecision(longAgo, FIXTURE_TODAY, NOW, true, BOARDS_SETTLE_MS)).toEqual({
      publish: true,
      behind: "nothing",
    });
  });

  it("starts no second publish while one holds the lease, and says until when", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    await lease.take(NOW.getTime(), "job-1");
    const launch = vi.fn(() => Promise.resolve());
    const decided = await launchAfterPull(
      storesOf(cloud, live).stores,
      launch,
      FIXTURE_TODAY,
      NOW,
      true,
      lease
    );
    expect(decided).toMatchObject({ publish: false, because: "publishing", behind: "nothing" });
    expect(launch).not.toHaveBeenCalled();
    // Two launchers at once start one job.
    const free = freeLease();
    const once = vi.fn(() => Promise.resolve());
    const both = await Promise.all([
      launchAfterPull(storesOf(cloud, live).stores, once, FIXTURE_TODAY, NOW, true, free),
      launchAfterPull(storesOf(cloud, live).stores, once, FIXTURE_TODAY, NOW, true, free),
    ]);
    expect(once).toHaveBeenCalledTimes(1);
    expect(both.map((one) => one.publish).sort()).toEqual([false, true]);
  });

  it("tries a refused launch once more, for the launchers counting on its claim", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    const pullEnd = { settleMs: 0, rebuilds: false };
    // The first try is refused; meanwhile another pull's end finds the claim held and asks on it.
    const flaky = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => {
        await lease.launch(NOW.getTime(), pullEnd);
        throw new Error("HTTP 503");
      })
      .mockResolvedValueOnce(undefined);
    expect(
      await launchAfterPull(storesOf(cloud, live).stores, flaky, FIXTURE_TODAY, NOW, true, lease)
    ).toEqual({ publish: true, behind: "nothing" });
    expect(flaky).toHaveBeenCalledTimes(2);
    // The job the second try started publishes for both.
    expect(await lease.take(NOW.getTime(), "job-1")).toEqual({ taken: true, asked: pullEnd });
  });

  it("lets a failed launch's claim go, so the next check is not held off", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    const refused = () => Promise.reject(new Error("HTTP 403"));
    await expect(
      launchAfterPull(storesOf(cloud, live).stores, refused, FIXTURE_TODAY, NOW, true, lease)
    ).rejects.toThrow("HTTP 403");
    expect(await lease.launch(NOW.getTime(), AT_ONCE)).toEqual({ ok: true });
  });

  it("has the job publish nothing beside another job, and let its own lease go when done", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    await lease.take(NOW.getTime(), "job-1");
    const deps = {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      locale: "en-US",
      lease,
      owner: "job-2",
    };
    expect(await publishAfterPull(storesOf(cloud, live).stores, deps)).toEqual({
      decided: { publish: false, because: "publishing" },
    });
    expect(live.meta()).toBeNull();
    await lease.release("job-1");
    const run = await publishAfterPull(storesOf(cloud, live).stores, deps);
    expect(run.result).toMatchObject({ end: "published" });
    expect(await lease.launch(NOW.getTime() + LAUNCH_HOLD_MS, AT_ONCE)).toEqual({ ok: true });
  });

  it("has the job wait out the settle its check asked, so an edit made since is left to its own check", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    // The check finds everything still for the settle, and starts the job.
    const still = storesOf(cloud, live, { savedAt: ago(BOARDS_SETTLE_MS) }).stores;
    const launch = vi.fn(() => Promise.resolve());
    expect(
      await launchAfterPull(still, launch, FIXTURE_TODAY, NOW, true, lease, BOARDS_SETTLE_MS)
    ).toEqual({ publish: true, behind: "nothing" });
    expect(launch).toHaveBeenCalledTimes(1);
    // An edit lands before the job starts: the job, asking as the check asked, leaves it.
    const edited = storesOf(cloud, live, { savedAt: ago(10_000) }).stores;
    const job = {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      locale: "en-US",
      lease,
      owner: "job-1",
    };
    expect(await publishAfterPull(edited, job)).toEqual({
      decided: { publish: false, because: "settling", behind: "nothing" },
      rounds: 1,
    });
    expect(live.meta()).toBeNull();
    // A pull's end asks no settle: its job publishes the same copy at once.
    expect(await launchAfterPull(edited, launch, FIXTURE_TODAY, NOW, true, lease)).toMatchObject({
      publish: true,
    });
    const run = await publishAfterPull(edited, { ...job, owner: "job-2" });
    expect(run.result).toMatchObject({ end: "published" });
  });

  it("has the job publish again where a pull ended while it was under way", async () => {
    // A job reads the copy, and a pull saves after it: the pull's end finds the lease held, and
    // asks the job to go again, rather than leave its save to the catch-up or the nightly.
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    const { stores } = storesOf(cloud, live);
    // The second pull's save and its end, made while the first round publishes, and done before
    // the job hands the lease back.
    let pull: Promise<void> | null = null;
    const watched = {
      ...lease,
      handBack: async (owner: string, now: number) => {
        await pull;
        return lease.handBack(owner, now);
      },
    };
    const run = await publishAfterPull(stores, {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      locale: "en-US",
      lease: watched,
      owner: "job-1",
      onViews: () => {
        if (pull) return;
        pull = (async () => {
          const moved = await commitChanges({
            store: cloud.store,
            base: cloud.manifest(),
            changes: [{ key: LEAGUE_PART, value: { seasons: [], again: true }, at: 2 }],
            device: "cloud-pull",
            now: NOW.toISOString(),
          });
          if (!moved.ok) throw new Error("the second pull's save was not made");
          expect(await lease.launch(NOW.getTime(), AT_ONCE)).toMatchObject({ ok: false });
        })();
      },
    });
    expect(run.rounds).toBe(2);
    expect(run.result).toMatchObject({ end: "published" });
    expect(live.meta()?.built[BOARD_FAMILY]?.v).toBe(cloud.manifest()?.version);
    // And let go at its end, for the next launch.
    expect(await lease.launch(NOW.getTime(), AT_ONCE)).toEqual({ ok: true });
  });

  it("has the job leave an edit saved between its decision and its load to the edit's own check", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    // The check that started the job asked for the settle.
    await lease.launch(NOW.getTime(), { settleMs: BOARDS_SETTLE_MS, rebuilds: true });
    const { stores } = storesOf(cloud, live, { savedAt: ago(BOARDS_SETTLE_MS) });
    // The job's own decision reads the copy still; an edit lands just after it.
    let reads = 0;
    const editedMeanwhile = {
      ...stores,
      readCopyAt: async () => {
        const at = await stores.readCopyAt();
        reads += 1;
        return at && reads > 1 ? { ...at, savedAt: ago(5_000) } : at;
      },
    };
    const run = await publishAfterPull(editedMeanwhile, {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      locale: "en-US",
      lease,
      owner: "job-1",
    });
    expect(run.decided).toEqual({ publish: true, behind: "nothing" });
    expect(run.result).toMatchObject({ end: "not-needed", tries: 0 });
    expect(live.meta()).toBeNull();
  });

  it("hands asks made in the job's last round on to a job of their own", async () => {
    // A pull saves and ends during every round, so the job runs all its rounds and is asked again
    // in the last one: that ask starts another job rather than being dropped.
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    const { stores } = storesOf(cloud, live);
    let pull: Promise<void> | null = null;
    let pulls = 0;
    const watched = {
      ...lease,
      handBack: async (owner: string, now: number) => {
        await pull;
        pull = null;
        return lease.handBack(owner, now);
      },
      handOn: async (owner: string, now: number) => {
        await pull;
        return lease.handOn(owner, now);
      },
    };
    const relaunch = vi.fn(() => Promise.resolve());
    const run = await publishAfterPull(stores, {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      locale: "en-US",
      lease: watched,
      owner: "job-1",
      relaunch,
      onViews: () => {
        if (pull) return;
        pulls += 1;
        const round = pulls;
        pull = (async () => {
          const moved = await commitChanges({
            store: cloud.store,
            base: cloud.manifest(),
            changes: [{ key: LEAGUE_PART, value: { seasons: [], round }, at: 1 + round }],
            device: "cloud-pull",
            now: NOW.toISOString(),
          });
          if (!moved.ok) throw new Error("a pull's save was not made");
          await lease.launch(NOW.getTime(), AT_ONCE);
        })();
      },
    });
    expect(run).toMatchObject({ rounds: PUBLISH_ROUNDS, handedOn: true });
    expect(relaunch).toHaveBeenCalledTimes(1);
    // The next job takes the claim over, asked as the last pull asked.
    expect(await lease.take(NOW.getTime(), "job-2")).toEqual({ taken: true, asked: AT_ONCE });

    // Where the next job cannot be started, its claim is let go for the next launcher.
    const unlaunch = vi.fn(() => Promise.resolve());
    const askedEveryRound = {
      take: () => Promise.resolve({ taken: true as const, asked: null }),
      handBack: () => Promise.resolve(AT_ONCE),
      handOn: () => Promise.resolve(AT_ONCE),
      release: () => Promise.resolve(),
      unlaunch,
    };
    expect(
      await publishAfterPull(storesOf(cloud, memoryLive()).stores, {
        today: () => FIXTURE_TODAY,
        now: () => NOW,
        rebuilds: true,
        locale: "en-US",
        lease: askedEveryRound,
        owner: "job-3",
        relaunch: () => Promise.reject(new Error("HTTP 403")),
      })
    ).toMatchObject({ rounds: PUBLISH_ROUNDS, handedOn: false });
    expect(unlaunch).toHaveBeenCalledTimes(1);
  });

  it("hands an ask made during a round that fails on to a job of its own", async () => {
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    const pullEnd = { settleMs: 0, rebuilds: false };
    const relaunch = vi.fn(() => Promise.resolve());
    let asked: Promise<unknown> = Promise.resolve();
    await expect(
      publishAfterPull(storesOf(cloud, live).stores, {
        today: () => FIXTURE_TODAY,
        now: () => NOW,
        rebuilds: true,
        locale: "en-US",
        lease: {
          ...lease,
          handOn: async (owner: string, now: number) => {
            await asked;
            return lease.handOn(owner, now);
          },
        },
        owner: "job-1",
        relaunch,
        // A pull ends while the round publishes, and then the round fails.
        onViews: () => {
          asked = lease.launch(NOW.getTime(), pullEnd);
          throw new Error("the round failed");
        },
      })
    ).rejects.toThrow("the round failed");
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(await lease.take(NOW.getTime(), "job-2")).toEqual({ taken: true, asked: pullEnd });
  });

  it("has the job count on no rebuild where its check's save could not queue one", async () => {
    // A ledger that would let a rebuild start: but the save's own rebuild was never queued.
    const cloud = await copied();
    const live = memoryLive();
    const lease = freeLease();
    const { stores } = storesOf(cloud, live, { ledger: { ...SPENT, monthVcpuS: 0 } });
    const launch = vi.fn(() => Promise.resolve());
    expect(await launchAfterPull(stores, launch, FIXTURE_TODAY, NOW, false, lease)).toEqual({
      publish: true,
      behind: "nothing",
    });
    // The job's build deployed the rebuilds, and the ledger has room; it publishes all the same.
    const job = {
      today: () => FIXTURE_TODAY,
      now: () => NOW,
      rebuilds: true,
      locale: "en-US",
      lease,
      owner: "job-1",
    };
    expect((await publishAfterPull(stores, job)).result).toMatchObject({ end: "published" });
    // One started by a check that counted on the rebuild leaves the boards to it.
    const counting = freeLease();
    await counting.launch(NOW.getTime(), AT_ONCE);
    const again = storesOf(cloud, memoryLive(), { ledger: { ...SPENT, monthVcpuS: 0 } }).stores;
    expect(await publishAfterPull(again, { ...job, lease: counting })).toEqual({
      decided: { publish: false, because: "rebuild-coming", behind: "nothing" },
      rounds: 1,
    });
  });
});
