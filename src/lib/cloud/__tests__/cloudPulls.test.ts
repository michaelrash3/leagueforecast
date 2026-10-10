import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Called, RefreshStart } from "../../live/editClient";
import {
  describeEnd,
  describeProgress,
  loadSentPulls,
  markTold,
  readSentPulls,
  REFRESH_UNANSWERED,
  sendPull,
  sendRefresh,
  type PullSender,
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
    expect(describeProgress({ sent, job: list })).toBe(
      "Pulling 120 teams in the cloud: waiting to start."
    );
  });
});
