import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Called, RefreshStart } from "../../live/editClient";
import {
  ASK_AGAIN_MS,
  askAgain,
  describeEnd,
  describeProgress,
  describePullUpdate,
  describeImportMetrics,
  goneSilent,
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
  type PullSender,
  type SentPull,
} from "../cloudPulls";
import { MAX_LIST_TEAMS, newRefreshJob, tooManyTeams, type PullJob } from "../pullJobs";

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

describe("a list longer than one pull takes", () => {
  it("is refused before anything is uploaded or started, in plain words", async () => {
    const cloud = cloudOf({ ok: true, value: { status: "queued" } });
    const start = vi.spyOn(cloud.sender, "start");
    const teams = MAX_LIST_TEAMS + 1;
    const answer = await sendPull(
      {
        entries: Array.from({ length: teams }, (_, n) => ({
          teamId: `gc${String(n).padStart(10, "0")}`,
        })),
        seasonYears: [],
        device: "phone",
        timeZone: "America/New_York",
        now: NOW,
      },
      cloud.sender
    );
    expect(answer).toEqual({ ok: false, message: tooManyTeams(teams) });
    expect(tooManyTeams(teams)).toBe(
      "This list has 50,001 teams, and one pull takes at most 50,000. Split it into smaller lists and send them one at a time."
    );
    expect(cloud.jobs.size).toBe(0);
    expect(start).not.toHaveBeenCalled();
    expect(loadSentPulls()).toEqual([]);
  });
});
