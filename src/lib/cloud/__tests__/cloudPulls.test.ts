import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Called, RefreshStart } from "../../live/editClient";
import {
  ASK_AGAIN_MS,
  askAgain,
  describeEnd,
  describeProgress,
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
import { newRefreshJob, type PullJob } from "../pullJobs";

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
    const first = await send(cloud.sender);
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
