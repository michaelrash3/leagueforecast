import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Called } from "../../live/editClient";
import { loadSentPulls, markTold, readSentPulls, sendPull, type PullSender } from "../cloudPulls";
import type { PullJob } from "../pullJobs";

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
