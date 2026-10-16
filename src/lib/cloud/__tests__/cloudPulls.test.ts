import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Called, RefreshStart } from "../../live/editClient";
import {
  ASK_AGAIN_MS,
  askAgain,
  currentPart,
  describeEnd,
  describeListEnd,
  describeListProgress,
  describeProgress,
  describePullUpdate,
  describeImportMetrics,
  describeSplit,
  goneSilent,
  listOver,
  listsOf,
  partsAfter,
  PULL_STALE_MS,
  resumable,
  STARTING_MS,
  dueForAsking,
  loadSentPulls,
  markTold,
  readSentPulls,
  REFRESH_UNANSWERED,
  sendPull,
  sendRefresh,
  SENT_PULLS_KEY,
  waitsOnEarlierPart,
  type PullSender,
  type SentPull,
  type WatchedPull,
} from "../cloudPulls";
import type { GcTeamListEntry } from "../../gameChangerApi";
import {
  MAX_LIST_TEAMS,
  newPullJob,
  newRefreshJob,
  unpackJobList,
  type PullJob,
  type PullJobChain,
} from "../pullJobs";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
  });
});

const NOW = "2026-10-09T12:00:00.000Z";

/** A cloud in memory: the jobs written, and what starting one answers. */
const cloudOf = (answer: Called<{ status: string }>) => {
  const jobs = new Map<string, PullJob>();
  const sender: PullSender = {
    jobs: {
      put: async (jobId, job) => {
        jobs.set(jobId, job);
      },
      read: async (jobId) => jobs.get(jobId) ?? null,
      askStop: async () => undefined,
    },
    start: async () => answer,
  };
  return { jobs, sender };
};

const send = (sender: PullSender, refresh = false) =>
  sendPull(
    {
      entries: [{ teamId: "gcACES000001" }, { teamId: "gcBEARS00001" }],
      seasonYears: refresh ? [2027] : [],
      refresh,
      device: "phone",
      timeZone: "America/New_York",
      now: NOW,
    },
    sender
  );

describe("a pull sent to the cloud", () => {
  it("reconnects repeated submissions to the same active import, including a reordered list", async () => {
    const cloud = cloudOf({ ok: true, value: { status: "queued" } });
    const first = await send(cloud.sender);
    const repeated = await send(cloud.sender);
    expect(repeated).toEqual(first);
    expect(cloud.jobs.size).toBe(1);
    expect(loadSentPulls()).toHaveLength(1);
  });
  it("discovers imports sent from another device and remembers acknowledgements", async () => {
    const cloud = cloudOf({ ok: true, value: { status: "queued" } });
    const sent = await send(cloud.sender);
    const jobId = sent.ok ? sent.jobId : "";
    localStorage.removeItem(SENT_PULLS_KEY);
    cloud.sender.jobs.recent = async () => [{ jobId, job: cloud.jobs.get(jobId)! }];
    expect((await readSentPulls(cloud.sender.jobs)).map((p) => p.sent.jobId)).toEqual([jobId]);
    markTold(jobId);
    expect(await readSentPulls(cloud.sender.jobs)).toEqual([]);
  });
  it("writes the job, a paste's or a catch-up's, and remembers it once started", async () => {
    const cloud = cloudOf({ ok: true, value: { status: "queued" } });
    const sent = await send(cloud.sender);
    expect(sent.ok).toBe(true);
    const [job] = [...cloud.jobs.values()];
    expect(job).toMatchObject({ status: "queued", list: { teams: 2 }, device: "phone" });
    expect(job?.refresh).toBeUndefined();
    expect(loadSentPulls()).toEqual([
      { jobId: sent.ok ? sent.jobId : "", sentAt: NOW, teams: 2, told: false },
    ]);
    await send(cloud.sender, true);
    expect([...cloud.jobs.values()][1]).toMatchObject({ refresh: true, seasonYears: [2027] });
  });

  it("remembers one whose start went unanswered, which may have started, and not one refused", async () => {
    const lost = cloudOf({ ok: false, why: "unanswered", message: "No answer." });
    expect((await send(lost.sender)).ok).toBe(true);
    expect(loadSentPulls()).toHaveLength(1);
    const refused = cloudOf({ ok: false, why: "not-member", message: "Not on the list." });
    const answer = await send(refused.sender);
    expect(answer).toEqual({
      ok: false,
      message: "The cloud would not start the pull: Not on the list.",
    });
    expect(loadSentPulls()).toHaveLength(1);
  });

  it("is read back until told, forgotten once gone, and kept when it cannot be read now", async () => {
    const cloud = cloudOf({ ok: true, value: { status: "queued" } });
    const first = await send(cloud.sender, true);
    const second = await send(cloud.sender);
    if (!first.ok || !second.ok) throw new Error("not sent");
    expect((await readSentPulls(cloud.sender.jobs)).map(({ sent }) => sent.jobId)).toEqual([
      first.jobId,
      second.jobId,
    ]);
    // Offline, nothing is forgotten; deleted in the console, it is.
    const offline = { read: () => Promise.reject(new Error("offline")) };
    expect(await readSentPulls(offline)).toEqual([]);
    expect(loadSentPulls()).toHaveLength(2);
    cloud.jobs.delete(first.jobId);
    await readSentPulls(cloud.sender.jobs);
    expect(loadSentPulls().map(({ jobId }) => jobId)).toEqual([second.jobId]);
    markTold(second.jobId);
    expect(await readSentPulls(cloud.sender.jobs)).toEqual([]);
  });
});

describe("Refresh now asked of the cloud", () => {
  const JOB = "0123456789abcdef0123456789abcdef";
  const asking = (answer: Called<RefreshStart>) => {
    const asked: Array<{ device: string }> = [];
    const sender: PullSender = {
      ...cloudOf({ ok: true, value: { status: "queued" } }).sender,
      startRefresh: async (ask) => {
        asked.push(ask);
        return answer;
      },
    };
    return { sender, asked };
  };
  const press = (sender: PullSender) =>
    sendRefresh({ teams: 120, device: "phone", now: NOW }, sender);

  it("sends no list, and watches the job the cloud answers with, new or already under way", async () => {
    const { sender, asked } = asking({
      ok: true,
      value: { status: "queued", jobId: JOB, already: false },
    });
    expect(await press(sender)).toEqual({ ok: true, jobId: JOB, already: false });
    // The device's name alone: the cloud keeps every refresh in New York's day.
    expect(asked).toEqual([{ device: "phone" }]);
    expect(loadSentPulls()).toEqual([{ jobId: JOB, sentAt: NOW, teams: 120, told: false }]);
    // Pressed again while it runs: the cloud hands back the same job, watched once.
    const again = asking({ ok: true, value: { status: "running", jobId: JOB, already: true } });
    expect(await press(again.sender)).toEqual({ ok: true, jobId: JOB, already: true });
    expect(loadSentPulls()).toHaveLength(1);
  });

  it("says a refusal in the cloud's words, and a lost answer as one that may have started", async () => {
    const refused = asking({ ok: false, why: "failed", message: "The nightly is pulling." });
    expect(await press(refused.sender)).toEqual({
      ok: false,
      message: "The cloud would not start the refresh: The nightly is pulling.",
    });
    const lost = asking({ ok: false, why: "unanswered", message: "No answer." });
    expect(await press(lost.sender)).toEqual({ ok: false, message: REFRESH_UNANSWERED });
    expect(loadSentPulls()).toEqual([]);
    // A sender that cannot ask for one asks nothing.
    const none = cloudOf({ ok: true, value: { status: "queued" } });
    expect((await press(none.sender)).ok).toBe(false);
  });

  it("is told about in its own words, with the cloud's count once it has worked its teams out", () => {
    const made = newRefreshJob({ timeZone: "America/New_York", device: "phone", now: NOW });
    const sent = { jobId: JOB, sentAt: NOW, teams: 120, told: false };
    const worked = {
      ...made,
      status: "running" as const,
      list: { hash: "b".repeat(64), teams: 118, pieces: 1 },
      rota: { at: NOW, ageLevels: [9, 10], again: false, heldBack: 2 },
    };
    expect(describeProgress({ sent, job: made })).toBe(
      "Refreshing in the cloud: waiting to start."
    );
    expect(describeProgress({ sent, job: { ...made, status: "running" } })).toBe(
      "Refreshing in the cloud: working out today's teams."
    );
    expect(
      describeProgress({
        sent,
        job: { ...worked, stage: "fetching", progress: { done: 40, total: 118, failed: 1 } },
      })
    ).toBe("Refreshing 118 teams in the cloud: asking GameChanger, 40 of 118.");
    const tally = {
      asked: 118,
      answered: 117,
      failed: 1,
      filed: 117,
      gamesAdded: 12,
      gamesUpdated: 3,
    };
    expect(describeEnd({ sent, job: { ...worked, status: "done", end: "finished", tally } })).toBe(
      "The refresh in the cloud is done: 117 of 118 teams filed, 12 games added and 3 updated; 1 did not answer."
    );
    expect(
      describeEnd({
        sent,
        job: {
          ...worked,
          status: "done",
          end: "nothing-due",
          list: { ...worked.list, teams: 0 },
          rota: { ...worked.rota, heldBack: 7 },
        },
      })
    ).toBe(
      "The refresh in the cloud had no team to pull: the 7 due were all pulled in the last 16 hours and play nothing yesterday, today or tomorrow."
    );
    expect(describeEnd({ sent, job: { ...made, status: "failed", error: "No copy." } })).toBe(
      "The refresh in the cloud failed: No copy."
    );
    // A pasted list keeps its own words.
    const list = { ...made, rota: undefined, status: "queued" as const };
    delete list.rota;
    expect(describeProgress({ sent, job: list }, Date.parse(sent.sentAt) + 12 * 60_000)).toBe(
      "Pulling 120 teams in the cloud: waiting to start, sent 12 minutes ago."
    );
  });
});

/** A list sent at `NOW` and still queued, as the cloud keeps it, read back on this device. */
const waitingPull = (patch: Partial<PullJob> = {}) => {
  const job: PullJob = {
    ...newRefreshJob({ timeZone: "America/New_York", device: "phone", now: NOW }),
    ...patch,
  };
  delete job.rota;
  const sent: SentPull = { jobId: "a".repeat(32), sentAt: NOW, teams: 1710, told: false };
  return { sent, job };
};

describe("a pull still waiting to start", () => {
  const at = (minutes: number) => Date.parse(NOW) + minutes * 60_000;
  it("shows whole-import download progress, measured speed, and the stage duration", () => {
    const pull = waitingPull({
      pipeline: "staged-v1",
      status: "running",
      stage: "fetching",
      stageStartedAt: NOW,
      download: { total: 10000, done: 2500, perMinute: 600, holdUntil: null, holdReason: null },
    });
    expect(describeImportMetrics(pull.job, at(2))).toBe(
      "Download progress: 2,500 of 10,000 teams (25%). 600 teams/min measured. Current stage: 2 min 0 sec."
    );
    pull.job.download!.holdUntil = new Date(at(10)).toISOString();
    expect(describeImportMetrics(pull.job, at(2))).toContain("paused for GameChanger");
    expect(describeProgress(pull, at(2))).toContain(
      "waiting on GameChanger; next requests in 480 seconds"
    );
  });
  it("does not call a scheduled GameChanger pause a stalled worker", () => {
    const pull = waitingPull({
      pipeline: "staged-v1",
      status: "running",
      stage: "fetching",
      heartbeatAt: new Date(at(8)).toISOString(),
      progressAt: NOW,
      download: {
        total: 10000,
        done: 2500,
        perMinute: 600,
        holdUntil: new Date(at(10)).toISOString(),
        holdReason: "throttled",
      },
    });
    expect(describePullUpdate(pull.job, at(8))).toMatchObject({ stale: false });
    expect(describePullUpdate(pull.job, at(8)).message).toContain("waiting on GameChanger");
    expect(describePullUpdate(pull.job, at(11)).stale).toBe(true);
  });

  it("separates downloaded teams from skipped downloads in staged import progress and completion", () => {
    const pull = waitingPull({
      pipeline: "staged-v1",
      status: "running",
      stage: "fetching",
      legs: 2,
      progress: { done: 1500, total: 2000, failed: 4 },
    });
    expect(describeProgress(pull, at(1))).toContain(
      "download batch 1 of 2, 1,496 downloaded, 4 skipped, 500 remaining in this batch"
    );
    pull.job.detail = "download batch 1 of 2 complete, 1,996 downloaded, 4 skipped (Timed out: 4)";
    pull.job.legsDone = 1;
    expect(describeProgress(pull, at(1))).toContain(pull.job.detail);
    pull.job.status = "done";
    pull.job.tally.failed = 4;
    expect(describeEnd(pull)).toContain("4 skipped because their downloads failed");
    // Apart, where the importer counted them: a later paste asks again for those for now.
    pull.job.skipped = { transient: 3, permanent: 1 };
    expect(describeEnd(pull)).toContain(
      "; 4 skipped because their downloads failed: 3 for now (GameChanger throttled, timed out or dropped them; a later paste asks again) and 1 GameChanger answered with an error."
    );
    // Only GameChanger's "not a team id" is remembered for good, so no count says "for good".
    expect(describeEnd(pull)).not.toMatch(/for good/);
    // A legacy pull resumed by the staged importer counts its earlier failures in the tally but
    // not in the split, which then says them apart rather than leave the parts short of the whole.
    pull.job.tally.failed = 100;
    expect(describeEnd(pull)).toContain(
      "; 100 skipped because their downloads failed: 3 for now (GameChanger throttled, timed out or dropped them; a later paste asks again), 1 GameChanger answered with an error, and 96 in the earlier run of this list."
    );
  });

  it("shows the worker's error while the current part waits to retry", () => {
    const pull = waitingPull({
      status: "running",
      stage: "waiting",
      legs: 18,
      legsDone: 8,
      error: "Worker time limit",
    });
    expect(describeProgress(pull, at(185))).toBe(
      "Pulling 1,710 teams in the cloud: part 9 of 18, waiting to retry (Worker time limit)."
    );
  });

  // The screen that sat for hours: a pull never started said "waiting to start" and nothing else,
  // and Stop's press changed nothing on it.
  it("says how long it has waited, what its last try said, and a stop before anything", () => {
    // Just queued, it is starting: a leg starts within seconds while fewer than three run.
    expect(describeProgress(waitingPull(), at(0))).toBe(
      "Pulling 1,710 teams in the cloud: starting, sent just now."
    );
    expect(describeProgress(waitingPull(), at(1))).toBe(
      "Pulling 1,710 teams in the cloud: starting, sent 1 minute ago."
    );
    expect(describeProgress(waitingPull(), at(STARTING_MS / 60_000))).toBe(
      "Pulling 1,710 teams in the cloud: waiting to start, sent 2 minutes ago."
    );
    // A try that failed is never "starting".
    expect(describeProgress(waitingPull({ error: "The worker stopped." }), at(0))).toBe(
      "Pulling 1,710 teams in the cloud: waiting to start, sent just now. Its last try said: The worker stopped."
    );
    expect(describeProgress(waitingPull(), at(185))).toBe(
      "Pulling 1,710 teams in the cloud: waiting to start, sent 3 hours ago."
    );
    expect(describeProgress(waitingPull({ error: "The worker stopped." }), at(5))).toBe(
      "Pulling 1,710 teams in the cloud: waiting to start, sent 5 minutes ago. Its last try said: The worker stopped."
    );
    expect(describeProgress(waitingPull({ stopAsked: true }), at(5))).toBe(
      "Pulling 1,710 teams in the cloud: stopping."
    );
  });

  // A stop pressed once teams are in: the leg files and saves them before it ends, which takes a
  // while, and the line says so rather than "stopping" alone.
  it("says a stopped pull is saving the teams it pulled first, once it files them", () => {
    const stopped = (stage: PullJob["stage"], done: number, failed: number) =>
      waitingPull({
        status: "running",
        stopAsked: true,
        stage,
        progress: { done, total: 1710, failed },
      });
    expect(describeProgress(stopped("filing", 1200, 4), at(3))).toBe(
      "Pulling 1,710 teams in the cloud: stopping, saving the 1,196 teams it pulled first."
    );
    expect(describeProgress(stopped("saving", 1200, 4), at(3))).toBe(
      "Pulling 1,710 teams in the cloud: stopping, saving the 1,196 teams it pulled first."
    );
    expect(describeProgress(stopped("fetching", 1200, 4), at(3))).toBe(
      "Pulling 1,710 teams in the cloud: stopping."
    );
    expect(describeProgress(stopped("filing", 3, 3), at(3))).toBe(
      "Pulling 1,710 teams in the cloud: stopping."
    );
  });

  it("is asked about again a minute after it was sent or last asked, while nothing touched it", () => {
    expect(dueForAsking(waitingPull(), at(0))).toBe(false);
    expect(dueForAsking(waitingPull(), at(ASK_AGAIN_MS / 60_000))).toBe(true);
    const asked = waitingPull();
    asked.sent = { ...asked.sent, askedAt: new Date(at(10)).toISOString() };
    expect(dueForAsking(asked, at(10.5))).toBe(false);
    expect(dueForAsking(asked, at(11))).toBe(true);
    // A leg wrote to it, so Cloud Tasks is trying it; one started or over is not waiting.
    expect(dueForAsking(waitingPull({ updatedAt: "2026-10-09T12:03:00.000Z" }), at(30))).toBe(
      false
    );
    expect(dueForAsking(waitingPull({ status: "running" }), at(30))).toBe(false);
    expect(dueForAsking(waitingPull({ status: "failed" }), at(30))).toBe(false);
    // A stopped one is asked, which is what cancels it, even after a leg wrote to it.
    expect(
      dueForAsking(waitingPull({ stopAsked: true, updatedAt: "2026-10-09T12:03:00.000Z" }), at(30))
    ).toBe(true);
    // "Refresh now" is the server's own to start.
    const refresh = waitingPull();
    expect(
      dueForAsking({ ...refresh, job: { ...refresh.job, rota: { at: null } } as PullJob }, at(30))
    ).toBe(false);
  });

  it("asks with how long this device has waited by its own clock, and keeps when it asked", async () => {
    const pull = waitingPull();
    backing.set(SENT_PULLS_KEY, JSON.stringify([pull.sent]));
    const asks: Array<[string, number | undefined]> = [];
    await askAgain(
      pull,
      {
        start: async (jobId, waitedMs) => {
          asks.push([jobId, waitedMs]);
          return { ok: true, value: { status: "failed" } };
        },
      },
      new Date(at(65))
    );
    expect(asks).toEqual([[pull.sent.jobId, 65 * 60_000]]);
    expect(loadSentPulls()).toEqual([{ ...pull.sent, askedAt: new Date(at(65)).toISOString() }]);
  });

  it("asks a second time at once when the first start went unanswered", async () => {
    const answers: Array<Called<{ status: string }>> = [
      { ok: false, why: "unanswered", message: "No answer." },
      { ok: false, why: "failed", message: "The cloud could not queue this pull: no grant." },
    ];
    const cloud = cloudOf({ ok: true, value: { status: "queued" } });
    let asked = 0;
    const sender: PullSender = {
      ...cloud.sender,
      start: async () => answers[asked++] ?? { ok: true, value: { status: "queued" } },
    };
    // Refused on the second ask, but the first, unanswered, may have queued it: kept and watched.
    const sent = await send(sender);
    expect(sent).toEqual({
      ok: false,
      message: "The cloud would not start the pull: The cloud could not queue this pull: no grant.",
      watching: true,
    });
    expect(asked).toBe(2);
    expect(loadSentPulls()).toHaveLength(1);

    // Refused outright, with nothing unanswered before it: nothing to watch.
    backing.clear();
    const refused = cloudOf({ ok: false, why: "failed", message: "No grant." });
    expect(await send(refused.sender)).toEqual({
      ok: false,
      message: "The cloud would not start the pull: No grant.",
    });
    expect(loadSentPulls()).toEqual([]);
  });
});

describe("the age of a pull's server update", () => {
  const job = () => waitingPull({ status: "running", stage: "loading" }).job;
  const now = Date.parse(NOW);

  it("distinguishes a recent update from five minutes with no progress", () => {
    expect(describePullUpdate(job(), now)).toEqual({
      stale: false,
      message: "Last server update just now.",
    });
    expect(describePullUpdate(job(), now + PULL_STALE_MS - 1).stale).toBe(false);
    expect(describePullUpdate(job(), now + PULL_STALE_MS)).toEqual({
      stale: true,
      message: "Last server update 5 minutes ago. No recent progress; this pull may be stalled.",
    });
  });

  it("keeps an old stopping job visibly uncertain", () => {
    expect(describePullUpdate({ ...job(), stopAsked: true }, now + 3 * 60 * 60_000)).toEqual({
      stale: true,
      message: "Last server update 3 hours ago. No recent progress; this pull may be stalled.",
    });
  });
  it("distinguishes a live heartbeat from actual progress that has stopped advancing", () => {
    const importJob = {
      ...job(),
      pipeline: "staged-v1" as const,
      heartbeatAt: new Date(now).toISOString(),
      progressAt: new Date(now - 10 * 60_000).toISOString(),
    };
    const update = describePullUpdate(importJob, now);
    expect(update.stale).toBe(true);
    expect(update.message).toContain("worker is connected, but progress has not advanced");
  });

  it("does not call a completed job stalled", () => {
    for (const status of ["done", "failed", "cancelled"] as const) {
      expect(describePullUpdate({ ...job(), status }, now + PULL_STALE_MS).stale).toBe(false);
    }
  });

  it("reports unavailable timestamps and clamps a future timestamp to just now", () => {
    expect(describePullUpdate({ ...job(), updatedAt: "unknown" }, now).message).toContain(
      "unavailable"
    );
    expect(describePullUpdate(job(), now - 60_000)).toEqual({
      stale: false,
      message: "Last server update just now.",
    });
  });
});

it("reports failed status reads separately from jobs that no longer exist", async () => {
  const cloud = cloudOf({ ok: true, value: { status: "queued" } });
  const sent = await send(cloud.sender);
  if (!sent.ok) throw new Error("not sent");
  const unread = vi.fn();
  await expect(
    readSentPulls(
      {
        read: async () => {
          throw new Error("offline");
        },
      },
      unread
    )
  ).resolves.toEqual([]);
  expect(unread).toHaveBeenCalledWith(expect.objectContaining({ jobId: sent.jobId }));
  expect(loadSentPulls()).toHaveLength(1);
  unread.mockClear();
  await expect(readSentPulls({ read: async () => null }, unread)).resolves.toEqual([]);
  expect(unread).not.toHaveBeenCalled();
  expect(loadSentPulls()).toHaveLength(0);
});

/*
 * A pull whose worker died without a word stays "running" in the cloud until something asks about
 * it (`reapPullJob`). The page offers what can be done with one: Dismiss it, which asks, and for a
 * staged import Resume, which carries on from its saved downloads.
 */
describe("a pull gone silent", () => {
  const now = Date.parse(NOW);
  const running = (patch: Partial<PullJob> = {}) =>
    waitingPull({
      pipeline: "staged-v1",
      status: "running",
      stage: "fetching",
      heartbeatAt: NOW,
      ...patch,
    }).job;

  it("is one said to be running that nothing has been heard from in five minutes", () => {
    expect(goneSilent(running(), now + PULL_STALE_MS - 1)).toBe(false);
    expect(goneSilent(running(), now + PULL_STALE_MS)).toBe(true);
    // Its heartbeat is what is heard, not its last progress or the job's own stamp.
    const beating = running({ heartbeatAt: new Date(now + PULL_STALE_MS).toISOString() });
    expect(goneSilent(beating, now + PULL_STALE_MS)).toBe(false);
    // The stuck screen's case: the older runner's legs, stopped, last written hours ago.
    const legacy = { ...running(), stopAsked: true, stage: "loading" as const };
    delete legacy.pipeline;
    delete legacy.heartbeatAt;
    expect(goneSilent(legacy, now + 3 * 60 * 60_000)).toBe(true);
  });

  it("is never one waiting to start, nor one that is over", () => {
    for (const status of ["queued", "done", "failed", "cancelled"] as const) {
      expect(goneSilent(running({ status }), now + 60 * 60_000)).toBe(false);
    }
  });

  it("offers Resume for a staged import gone silent, as for one failed or stopped", () => {
    expect(resumable(running(), now)).toBe(false);
    expect(resumable(running(), now + PULL_STALE_MS)).toBe(true);
    expect(resumable(running({ status: "failed" }), now)).toBe(true);
    expect(resumable(running({ status: "cancelled" }), now)).toBe(true);
    expect(resumable(running({ status: "done" }), now)).toBe(false);
    // The older runner's legs resume onto the staged importer only once they have ended.
    const legacy = running();
    delete legacy.pipeline;
    expect(resumable(legacy, now + PULL_STALE_MS)).toBe(false);
    expect(resumable({ ...legacy, status: "failed" }, now)).toBe(true);
  });

  it("offers none for Refresh now, nor for a list longer than one pull takes", () => {
    const refresh = {
      ...newRefreshJob({ timeZone: "America/New_York", device: "phone", now: NOW }),
      status: "failed" as const,
    };
    expect(resumable(refresh, now)).toBe(false);
    const huge = running({ status: "failed", list: { hash: "h", teams: 448_645, pieces: 9 } });
    expect(resumable(huge, now)).toBe(false);
  });

  it("says the importer has probably stopped once its heartbeat has been missing five minutes", () => {
    const update = describePullUpdate(running(), now + PULL_STALE_MS);
    expect(update.stale).toBe(true);
    expect(update.message).toBe(
      "Worker heartbeat 5 minutes ago. Last progress 5 minutes ago. No heartbeat for five minutes: the importer has probably stopped. Resume carries on from its saved downloads."
    );
    expect(describePullUpdate(running(), now + 3 * 60_000).message).toContain(
      "No recent heartbeat; checking whether the worker is restarting."
    );
  });
});

/** A list of `count` made-up GameChanger ids, in order. */
const madeUp = (count: number): GcTeamListEntry[] =>
  Array.from({ length: count }, (_, n) => ({ teamId: `gc${String(n).padStart(10, "0")}` }));

/**
 * A cloud in memory that keeps what a list in parts is checked by: the order the jobs were
 * written in, each one's pieces, every `next` that named a job not there yet when it was written,
 * and every start, resume and stop asked.
 */
const partsCloud = () => {
  const jobs = new Map<string, PullJob>();
  const pieces = new Map<string, readonly Uint8Array[]>();
  const written: string[] = [];
  const dangling: string[] = [];
  const started: string[] = [];
  const resumed: string[] = [];
  const stopped: string[] = [];
  const sender: PullSender = {
    jobs: {
      put: async (jobId, job, list) => {
        if (job.chain?.next && !jobs.has(job.chain.next)) dangling.push(jobId);
        written.push(jobId);
        jobs.set(jobId, job);
        pieces.set(jobId, list);
      },
      read: async (jobId) => jobs.get(jobId) ?? null,
      askStop: async (jobId) => {
        stopped.push(jobId);
        const job = jobs.get(jobId);
        if (job) jobs.set(jobId, { ...job, stopAsked: true });
      },
    },
    start: async (jobId) => {
      started.push(jobId);
      return { ok: true, value: { status: "queued" } };
    },
    resume: async (jobId) => {
      resumed.push(jobId);
      return { ok: true, value: { status: "queued" } };
    },
  };
  /** The parts written, first to last, as their chains order them. */
  const parts = () =>
    [...jobs.entries()]
      .filter(([, job]) => job.chain)
      .sort(([, a], [, b]) => (a.chain?.part ?? 0) - (b.chain?.part ?? 0));
  const set = (jobId: string, patch: Partial<PullJob>) =>
    jobs.set(jobId, { ...jobs.get(jobId)!, ...patch });
  return { jobs, pieces, written, dangling, started, resumed, stopped, sender, parts, set };
};

const sendList = (sender: PullSender, entries: readonly GcTeamListEntry[]) =>
  sendPull(
    { entries, seasonYears: [], device: "phone", timeZone: "America/New_York", now: NOW },
    sender
  );

/*
 * A list longer than one job takes (`MAX_LIST_TEAMS`): split by the page, in list order, into parts
 * the cloud runs one after another, each a job naming the next (`PullJob.chain`).
 */
describe("a list longer than one pull takes", () => {
  it("is sent as parts in list order, written last to first, with only the first started", async () => {
    const cloud = partsCloud();
    const entries = madeUp(100_001);
    const answer = await sendList(cloud.sender, entries);
    if (!answer.ok) throw new Error(answer.message);
    const parts = cloud.parts();
    expect(parts.map(([, job]) => job.list.teams)).toEqual([50_000, 50_000, 1]);
    const ids = parts.map(([jobId]) => jobId);
    // The first part names the whole list, on every part.
    expect(ids[0]).toBe(answer.jobId);
    expect(parts.map(([, job]) => job.chain)).toEqual([
      { id: answer.jobId, part: 1, parts: 3, teams: 100_001, next: ids[1] },
      { id: answer.jobId, part: 2, parts: 3, teams: 100_001, next: ids[2] },
      { id: answer.jobId, part: 3, parts: 3, teams: 100_001 },
    ]);
    // Every next named a job already there when it was written: last first, the first last.
    expect(cloud.written).toEqual([...ids].reverse());
    expect(cloud.dangling).toEqual([]);
    expect(cloud.started).toEqual([answer.jobId]);
    // Each part holds its share of the list, in the list's order.
    const unpacked: GcTeamListEntry[] = [];
    for (const [jobId, job] of parts) {
      unpacked.push(
        ...(await unpackJobList(
          job.list,
          async (index) => cloud.pieces.get(jobId)?.[index] ?? null
        ))
      );
    }
    expect(unpacked).toEqual(entries);
    expect(loadSentPulls().map(({ jobId, teams }) => [jobId, teams])).toEqual(
      ids.map((jobId, index) => [jobId, [50_000, 50_000, 1][index]])
    );
  });

  it("is one job, as it always was, at exactly fifty thousand", async () => {
    const cloud = partsCloud();
    const answer = await sendList(cloud.sender, madeUp(MAX_LIST_TEAMS));
    expect(answer.ok).toBe(true);
    expect(cloud.jobs.size).toBe(1);
    expect([...cloud.jobs.values()][0]?.chain).toBeUndefined();
    expect([...cloud.jobs.values()][0]?.list.teams).toBe(MAX_LIST_TEAMS);
  });

  it("sent again, finds its parts and acts on the first not done, sending none twice", async () => {
    const cloud = partsCloud();
    const entries = madeUp(100_001);
    const first = await sendList(cloud.sender, entries);
    if (!first.ok) throw new Error(first.message);
    const [one, two, three] = cloud.parts().map(([jobId]) => jobId) as [string, string, string];
    // Part 1 done, part 2 failed: Resume on part 2, which carries the list on.
    cloud.set(one, { status: "done" });
    cloud.set(two, { status: "failed" });
    markTold(one);
    expect(await sendList(cloud.sender, [...entries].reverse())).toEqual({
      ok: true,
      jobId: first.jobId,
    });
    expect(cloud.resumed).toEqual([two]);
    // Part 2 queued, its turn come: started, as a list sent whole and queued is.
    cloud.set(two, { status: "queued" });
    await sendList(cloud.sender, entries);
    expect(cloud.started).toEqual([one, two]);
    // Under way: left to run.
    cloud.set(two, { status: "running" });
    await sendList(cloud.sender, entries);
    // Every part done: said again, and nothing started.
    for (const jobId of [two, three]) cloud.set(jobId, { status: "done" });
    await sendList(cloud.sender, entries);
    expect(cloud.started).toEqual([one, two]);
    expect(cloud.resumed).toEqual([two]);
    expect(cloud.jobs.size).toBe(3);
    // Every part is watched again, the one told about included.
    expect(loadSentPulls().map(({ jobId, told }) => [jobId, told])).toEqual([
      [one, false],
      [two, false],
      [three, false],
    ]);
  });

  it("sent again with a part gone from the cloud, is sent afresh as new parts", async () => {
    const cloud = partsCloud();
    const entries = madeUp(100_001);
    await sendList(cloud.sender, entries);
    const [, two] = cloud.parts().map(([jobId]) => jobId);
    cloud.jobs.delete(two!);
    const again = await sendList(cloud.sender, entries);
    expect(again.ok).toBe(true);
    expect(cloud.jobs.size).toBe(5);
    expect(cloud.started).toHaveLength(2);
  });

  // A part ended because Team Rankings was started again says to send the list again; resumed, it
  // would only end so again, its plan chosen from the copy that is gone.
  it("sent again after Team Rankings was started again, is sent afresh, whole or in parts", async () => {
    for (const teams of [3, 100_001]) {
      backing.clear();
      const cloud = partsCloud();
      const entries = madeUp(teams);
      const first = await sendList(cloud.sender, entries);
      if (!first.ok) throw new Error(first.message);
      cloud.set(first.jobId, { status: "failed", end: "copy-replaced" });
      const again = await sendList(cloud.sender, entries);
      if (!again.ok) throw new Error(again.message);
      expect(again.jobId, String(teams)).not.toBe(first.jobId);
      expect(cloud.resumed, String(teams)).toEqual([]);
      expect(cloud.started, String(teams)).toEqual([first.jobId, again.jobId]);
    }
  });

  it("sent again where an older page sent it whole, is sent as parts rather than resumed", async () => {
    const cloud = partsCloud();
    const entries = madeUp(100_001);
    const first = await sendList(cloud.sender, entries);
    if (!first.ok) throw new Error(first.message);
    // As a page from before the split left it: one job, the whole list, refused by the cloud.
    const whole = { ...cloud.jobs.get(first.jobId)!, status: "failed" as const };
    delete whole.chain;
    cloud.jobs.set(first.jobId, { ...whole, list: { ...whole.list, teams: 100_001 } });
    const again = await sendList(cloud.sender, entries);
    if (!again.ok) throw new Error(again.message);
    expect(again.jobId).not.toBe(first.jobId);
    expect(cloud.resumed).toEqual([]);
    expect(cloud.started).toEqual([first.jobId, again.jobId]);
  });

  it("cancels the parts already written when one cannot be, and says so", async () => {
    const cloud = partsCloud();
    const put = cloud.sender.jobs.put;
    let writes = 0;
    cloud.sender.jobs.put = async (jobId, job, list) => {
      writes += 1;
      if (writes === 2) throw new Error("offline");
      await put(jobId, job, list);
    };
    const answer = await sendList(cloud.sender, madeUp(100_001));
    expect(answer).toEqual({
      ok: false,
      message: "The pull could not be sent to the cloud. Try again.",
    });
    // The last part, written first, asked to stop and asked about, which cancels it.
    expect(cloud.written).toHaveLength(1);
    expect(cloud.stopped).toEqual(cloud.written);
    expect(cloud.started).toEqual(cloud.written);
    expect(loadSentPulls()).toEqual([]);
  });

  it("cancels the parts after the first when the cloud will not start it", async () => {
    const cloud = partsCloud();
    cloud.sender.start = async (jobId) => {
      cloud.started.push(jobId);
      return { ok: false, why: "failed", message: "No grant." };
    };
    const answer = await sendList(cloud.sender, madeUp(100_001));
    expect(answer).toEqual({ ok: false, message: "The cloud would not start the pull: No grant." });
    const [one, two, three] = cloud.parts().map(([jobId]) => jobId);
    expect(cloud.stopped).toEqual([two, three]);
    expect(cloud.started).toEqual([one, two, three]);
    expect(loadSentPulls()).toEqual([]);
  });
});

/** The parts of one list as this device watches them: `statuses` in part order. */
const watchedParts = (
  statuses: readonly PullJob["status"][],
  patch: (part: number) => Partial<PullJob> = () => ({})
): WatchedPull[] => {
  const ids = statuses.map((_, index) => String(index + 1).repeat(32));
  return statuses.map((status, index) => {
    const next = ids[index + 1];
    const chain: PullJobChain = {
      id: ids[0]!,
      part: index + 1,
      parts: statuses.length,
      teams: 100_001,
      ...(next ? { next } : {}),
    };
    const teams = index + 1 < statuses.length ? 50_000 : 1;
    const job: PullJob = {
      ...newPullJob({
        list: { hash: "a".repeat(64), teams, pieces: 1 },
        seasonYears: [],
        timeZone: "America/New_York",
        device: "phone",
        now: NOW,
        chain,
      }),
      status,
      ...patch(index + 1),
    };
    return { sent: { jobId: ids[index]!, sentAt: NOW, teams, told: false }, job };
  });
};

describe("a list sent in parts, watched", () => {
  const at = (minutes: number) => Date.parse(NOW) + minutes * 60_000;

  it("is one list, in part order, among lists sent whole", () => {
    const parts = watchedParts(["done", "running", "queued"]);
    const whole = waitingPull();
    const lists = listsOf([parts[2]!, whole, parts[0]!, parts[1]!]);
    expect(lists.map((list) => list.map(({ sent }) => sent.jobId))).toEqual([
      parts.map(({ sent }) => sent.jobId),
      [whole.sent.jobId],
    ]);
    expect(currentPart(parts)?.sent.jobId).toBe(parts[1]?.sent.jobId);
    expect(listOver(parts)).toBe(false);
    expect(listOver(watchedParts(["done", "done", "done"]))).toBe(true);
    // Halted at a part that failed or was stopped, whose end is said, with Resume.
    expect(listOver(watchedParts(["done", "failed", "queued"]))).toBe(true);
    expect(listOver(watchedParts(["cancelled", "cancelled", "cancelled"]))).toBe(true);
    // A part done whose next this device has not read yet leaves the list under way.
    expect(listOver(watchedParts(["done", "done", "queued"]).slice(0, 2))).toBe(false);
  });

  it("says the whole list, the part under way, and the parts done and waiting", () => {
    const running = (part: number) =>
      part === 2
        ? {
            pipeline: "staged-v1" as const,
            stage: "fetching" as const,
            legs: 5,
            progress: { done: 4_000, total: 10_000, failed: 4 },
          }
        : {};
    expect(describeListProgress(watchedParts(["done", "running", "queued"], running), at(1))).toBe(
      "Pulling 100,001 teams in the cloud as 3 parts, one after another. Part 2 of 3 (50,000 teams): download batch 1 of 5, 3,996 downloaded, 4 skipped, 6,000 remaining in this batch. Part 1 is done; part 3 waits its turn."
    );
    expect(describeListProgress(watchedParts(["queued", "queued", "queued"]), at(0))).toBe(
      "Pulling 100,001 teams in the cloud as 3 parts, one after another. Part 1 of 3 (50,000 teams): starting, sent just now. Parts 2 and 3 wait their turn."
    );
    expect(
      describeListProgress(watchedParts(["done", "done", "done", "done", "queued"]), at(0))
    ).toBe(
      "Pulling 100,001 teams in the cloud as 5 parts, one after another. Part 5 of 5 (1 team): starting. Parts 1 to 4 are done."
    );
    // A later part's wait is from when its turn came, not from the sending hours before.
    const turn = watchedParts(["done", "queued", "queued"]);
    turn[1]!.sent.dueAt = new Date(at(180)).toISOString();
    expect(describeListProgress(turn, at(185))).toContain(
      "Part 2 of 3 (50,000 teams): waiting to start, its turn came 5 minutes ago."
    );
    // Or from when the cloud queued it, which touches it, where this device never asked.
    const queued = watchedParts(["done", "queued", "queued"], (part) =>
      part === 2 ? { updatedAt: new Date(at(181)).toISOString() } : {}
    );
    expect(describeListProgress(queued, at(185))).toContain(
      "Part 2 of 3 (50,000 teams): waiting to start, its turn came 4 minutes ago."
    );
    // Stopping: the parts after it will not run.
    expect(
      describeListProgress(
        watchedParts(["done", "running", "queued", "queued"], (part) =>
          part > 1 ? { stopAsked: true } : {}
        ),
        at(1)
      )
    ).toBe(
      "Pulling 100,001 teams in the cloud as 4 parts, one after another. Part 2 of 4 (50,000 teams): stopping. Part 1 is done; parts 3 and 4 will not run."
    );
    // Past a part done whose next is not read yet.
    expect(describeListProgress(watchedParts(["done", "queued", "queued"]).slice(0, 1))).toBe(
      "Pulling 100,001 teams in the cloud as 3 parts, one after another. Part 1 is done; parts 2 and 3 wait their turn."
    );
  });

  it("says how the whole list ended, and where Resume carries it on from", () => {
    const tally = (filed: number, failed: number) => ({
      asked: filed + failed,
      answered: filed,
      failed,
      filed,
      gamesAdded: filed * 2,
      gamesUpdated: 1,
    });
    const done = watchedParts(["done", "done", "done"], (part) => ({
      tally: part === 3 ? tally(1, 0) : tally(49_990, 10),
      skipped:
        part === 1
          ? { transient: 10, permanent: 0 }
          : part === 2
            ? { transient: 6, permanent: 4 }
            : { transient: 0, permanent: 0 },
    }));
    expect(describeListEnd(done)).toBe(
      "The pull of 100,001 teams in the cloud is done, in 3 parts: 99,981 of 100,001 teams filed, 199,962 games added and 3 updated; 20 skipped because their downloads failed: 16 for now (GameChanger throttled, timed out or dropped them; a later paste asks again) and 4 GameChanger answered with an error."
    );
    expect(
      describeListEnd(
        watchedParts(["done", "failed", "queued"], (part) =>
          part === 2 ? { error: "The importer stopped without saying why" } : {}
        )
      )
    ).toBe(
      "The pull of 100,001 teams in the cloud stopped at part 2 of 3, which failed: The importer stopped without saying why. Resume carries the list on from part 2."
    );
    expect(
      describeListEnd(
        watchedParts(["done", "cancelled", "cancelled"], (part) => ({
          tally: part === 1 ? tally(50_000, 0) : part === 2 ? tally(2_000, 0) : tally(0, 0),
        }))
      )
    ).toBe(
      "The pull of 100,001 teams in the cloud was stopped at part 2 of 3: 52,000 of 100,001 teams filed, 104,000 games added and 3 updated. Resume carries the list on from part 2."
    );
    // A list sent whole keeps its own words.
    const whole = { ...waitingPull({ status: "failed", error: "No copy." }) };
    expect(describeListEnd([whole])).toBe(describeEnd(whole));
    expect(describeListProgress([waitingPull()], at(0))).toBe(
      describeProgress(waitingPull(), at(0))
    );
  });

  it("says before the sending that a long list runs as parts, and how many", () => {
    expect(describeSplit(MAX_LIST_TEAMS)).toBe("");
    expect(describeSplit(100_001)).toBe(
      "This list will run in the cloud as 3 parts of up to 50,000 teams, one after another."
    );
    expect(describeSplit(448_645)).toBe(
      "This list will run in the cloud as 9 parts of up to 50,000 teams, one after another."
    );
  });

  it("asks about a later part only once the part before it is done, at once, then each minute", () => {
    const parts = watchedParts(["running", "queued", "queued"]);
    const [, second, third] = parts as [WatchedPull, WatchedPull, WatchedPull];
    // Its turn has not come: asking would run two parts of one list at once.
    expect(dueForAsking(second, at(600), parts)).toBe(false);
    expect(dueForAsking(third, at(600), parts)).toBe(false);
    // Nor where the part before it is not read on this device.
    expect(dueForAsking(second, at(600), [second])).toBe(false);
    const turn = watchedParts(["done", "queued", "queued"]);
    const [, ready, after] = turn as [WatchedPull, WatchedPull, WatchedPull];
    expect(dueForAsking(ready, at(0), turn)).toBe(true);
    expect(dueForAsking(after, at(600), turn)).toBe(false);
    ready.sent.askedAt = new Date(at(600)).toISOString();
    expect(dueForAsking(ready, at(600.5), turn)).toBe(false);
    expect(dueForAsking(ready, at(601), turn)).toBe(true);
    // Touched by the cloud, it is being tried; asked to stop, the ask is what cancels it.
    expect(dueForAsking({ ...ready, job: { ...ready.job, updatedAt: "x" } }, at(700), turn)).toBe(
      false
    );
    expect(dueForAsking({ ...third, job: { ...third.job, stopAsked: true } }, at(1), parts)).toBe(
      true
    );
  });

  it("asks for a later part with its wait counted from when its turn came", async () => {
    const turn = watchedParts(["done", "queued"]);
    const ready = turn[1]!;
    backing.set(SENT_PULLS_KEY, JSON.stringify(turn.map(({ sent }) => sent)));
    const asks: Array<number | undefined> = [];
    const sender = {
      start: async (_jobId: string, waitedMs?: number) => {
        asks.push(waitedMs);
        return { ok: true as const, value: { status: "queued" } };
      },
    };
    // Sent three hours before its turn: the first ask says no wait, and keeps when its turn came.
    await askAgain(ready, sender, new Date(at(180)));
    const kept = loadSentPulls().find(({ jobId }) => jobId === ready.sent.jobId);
    expect(kept?.dueAt).toBe(new Date(at(180)).toISOString());
    await askAgain(ready, sender, new Date(at(185)));
    expect(asks).toEqual([undefined, 5 * 60_000]);
  });

  it("holds nothing off behind a part that failed, and stops the parts after the one under way", () => {
    const halted = watchedParts(["failed", "queued", "queued"]);
    expect(halted.map((part) => waitsOnEarlierPart(part, halted))).toEqual([false, true, true]);
    const moving = watchedParts(["done", "running", "queued"]);
    expect(moving.map((part) => waitsOnEarlierPart(part, moving))).toEqual([false, false, true]);
    expect(partsAfter(moving[1]!, moving).map(({ sent }) => sent.jobId)).toEqual([
      moving[2]!.sent.jobId,
    ]);
    expect(partsAfter(moving[2]!, moving)).toEqual([]);
    expect(partsAfter(waitingPull(), moving)).toEqual([]);
  });
});
