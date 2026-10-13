import { afterEach, describe, expect, it, vi } from "vitest";
import type { GcTeamResponse } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { newPullJob } from "../pullJobs";
import type { JobDocs } from "../pullJobRunner";
import {
  restImportArtifacts,
  runStagedImport,
  type ImportCheckpointSummary,
} from "../stagedImport";
import { finishStagedImport, selectImportTeams } from "../cloudRunner";
import { memoryCloud } from "./memoryCloud";

vi.mock("../cloudRunner", () => ({ selectImportTeams: vi.fn(), finishStagedImport: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const ID = "0123456789abcdef0123456789abcdef";
const NOW = "2026-10-13T03:00:00.000Z";
const good = (id: string): GcTeamResponse => ({
  ok: true,
  schedule: {
    profile: { id, name: `${id} 10U`, ageLevel: 10, season: { season: "fall", year: 2026 } },
    games: [],
    fetchedAt: NOW,
  },
});
const setup = (teams = 5001) => {
  let job = newPullJob({
    list: { hash: "", teams, pieces: 0 },
    seasonYears: [],
    timeZone: "America/New_York",
    device: "test",
    now: NOW,
  });
  const jobs: JobDocs = {
    read: async () => structuredClone(job),
    update: async (_, patch) => {
      job = { ...job, ...patch };
    },
    create: vi.fn(),
    putPiece: vi.fn(),
    piece: vi.fn(),
    updateIfUnchanged: vi.fn(),
  };
  const values = new Map<string, unknown>();
  const artifacts = {
    read: async <T>(name: string) => (structuredClone(values.get(name)) ?? null) as T | null,
    write: async (name: string, value: unknown) => {
      values.set(name, structuredClone(value));
    },
  };
  // A pre-existing plan proves a resumed execution does not load the team index again.
  values.set("plan", {
    copy: "copy-a",
    batchTeams: 2000,
    entries: Array.from({ length: teams }, (_, n) => ({
      teamId: `gc${String(n).padStart(10, "0")}`,
    })),
  });
  const fetched: string[][] = [];
  const fetchTeams = vi.fn(async (ids: string[], _options?: FetchGcTeamsOptions) => {
    fetched.push(ids);
    return new Map(ids.map((id) => [id, good(id)]));
  });
  const filed: string[] = [];
  vi.mocked(finishStagedImport).mockImplementation(async (_, source, __, counts, deps) => {
    expect(values.size).toBeGreaterThanOrEqual(1 + Math.ceil(teams / 2000));
    for await (const schedule of source()) filed.push(schedule.profile.id);
    await deps.beforeTidy?.();
    return {
      ...counts,
      end: "finished",
      changed: ["teams"],
      filed: filed.length,
      gamesAdded: 3,
      gamesUpdated: 0,
      replays: 0,
      version: 8,
    };
  });
  return {
    jobs,
    artifacts,
    values,
    fetchTeams,
    fetched,
    filed,
    job: () => job,
    deps: { jobs, artifacts, fetchTeams, store: memoryCloud().store, now: () => new Date(NOW) },
  };
};

describe("a staged CSV import", () => {
  it("downloads bounded batches without a pool reload or tidy, then finalizes the whole import once", async () => {
    const test = setup();
    await runStagedImport(ID, test.deps);
    expect(test.fetched.map((ids) => ids.length)).toEqual([5001]);
    expect(selectImportTeams).not.toHaveBeenCalled();
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
    expect(test.filed).toHaveLength(5001);
    expect(new Set(test.filed).size).toBe(5001);
    expect(test.job()).toMatchObject({
      status: "done",
      legsDone: 1,
      legTeams: 10000,
      tally: { asked: 5001, answered: 5001, failed: 0, filed: 5001 },
      version: 8,
    });
  });
  it("skips failed downloads and continues through every batch before the final tidy", async () => {
    const test = setup(2003);
    test.fetchTeams.mockImplementationOnce(
      async (ids) =>
        new Map(
          ids.map((id, n) => [
            id,
            n === 1 ? { ok: false, reason: "network", message: "Disconnected" } : good(id),
          ])
        )
    );
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids.length)).toEqual([2003]);
    expect(test.fetchTeams).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        retries: 0,
        stopOnRefused: false,
      })
    );
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
    expect(test.job()).toMatchObject({
      status: "done",
      legsDone: 1,
      tally: { asked: 2003, answered: 2002, failed: 1, filed: 2002 },
    });
    expect(test.filed).not.toContain("gc0000000001");
  });
  it("groups existing 2,000-team checkpoints into bounded 10,000-team download runs", async () => {
    const test = setup(12001);
    await runStagedImport(ID, test.deps);
    expect(test.fetched.map((ids) => ids.length)).toEqual([10000, 2001]);
    expect(Array.from(test.values.keys()).filter((name) => name.startsWith("batch-"))).toHaveLength(
      7
    );
    expect(test.job()).toMatchObject({
      status: "done",
      legTeams: 10000,
      legs: 2,
      legsDone: 2,
      tally: { asked: 12001, answered: 12001, failed: 0 },
    });
    expect(test.filed).toHaveLength(12001);
    expect(new Set(test.filed).size).toBe(12001);
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
  });
  it("keeps downloading while a completed checkpoint is still being written", async () => {
    const test = setup(10000);
    let startSaving!: () => void;
    const saving = new Promise<void>((resolve) => {
      startSaving = resolve;
    });
    let releaseSave!: () => void;
    const saveAllowed = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let downloadsFinished!: () => void;
    const downloaded = new Promise<void>((resolve) => {
      downloadsFinished = resolve;
    });
    const write = test.artifacts.write;
    test.artifacts.write = async (name, value) => {
      if (name === "batch-0") {
        startSaving();
        await saveAllowed;
      }
      await write(name, value);
    };
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      const answers = new Map<string, GcTeamResponse>();
      for (let n = 0; n < ids.length; n++) {
        if (n === 2000) await saving;
        const id = ids[n]!;
        const result = good(id);
        answers.set(id, result);
        options?.onProgress?.({ teamId: id, result, done: n + 1, total: ids.length, attempts: 1 });
      }
      downloadsFinished();
      return answers;
    });
    const importing = runStagedImport(ID, test.deps);
    await downloaded;
    expect(test.values.has("batch-0")).toBe(false);
    expect(finishStagedImport).not.toHaveBeenCalled();
    releaseSave();
    await importing;
    expect(test.job()).toMatchObject({ status: "done", tally: { answered: 10000, filed: 10000 } });
  });
  it("stops downloading on a checkpoint write failure and resumes only unsaved teams", async () => {
    const test = setup(5001);
    const write = test.artifacts.write;
    let fail = true;
    test.artifacts.write = async (name, value) => {
      if (name === "batch-1" && fail) throw new Error("Checkpoint write failed");
      await write(name, value);
    };
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      const answers = new Map<string, GcTeamResponse>();
      for (const [n, id] of ids.slice(0, 4000).entries()) {
        const result = good(id);
        answers.set(id, result);
        options?.onProgress?.({ teamId: id, result, done: n + 1, total: ids.length, attempts: 1 });
      }
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted) resolve();
        else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return answers;
    });
    await expect(runStagedImport(ID, test.deps)).rejects.toThrow("Checkpoint write failed");
    expect(test.values.has("batch-0")).toBe(true);
    expect(test.values.has("batch-1")).toBe(false);
    expect(finishStagedImport).not.toHaveBeenCalled();
    fail = false;
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids.length)).toEqual([5001, 3001]);
    expect(test.job()).toMatchObject({ status: "done", tally: { answered: 5001, failed: 0 } });
  });
  it("preserves partial progress callbacks if the downloader itself crashes", async () => {
    const test = setup(2003);
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      const id = ids[0]!;
      options?.onProgress?.({
        teamId: id,
        result: good(id),
        done: 1,
        total: ids.length,
        attempts: 1,
      });
      throw new Error("Downloader crashed");
    });
    await expect(runStagedImport(ID, test.deps)).rejects.toThrow("Downloader crashed");
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids.length)).toEqual([2003, 2002]);
    expect(test.job()).toMatchObject({ status: "done", tally: { answered: 2003, failed: 0 } });
  });
  it("files schedules in the frozen selection order even when downloads finish out of order", async () => {
    const test = setup(4001);
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      for (const [n, id] of [...ids].reverse().entries())
        options?.onProgress?.({
          teamId: id,
          result: good(id),
          done: n + 1,
          total: ids.length,
          attempts: 1,
        });
      return new Map(ids.map((id) => [id, good(id)]));
    });
    await runStagedImport(ID, test.deps);
    expect(test.filed).toEqual(
      Array.from({ length: 4001 }, (_, n) => `gc${String(n).padStart(10, "0")}`)
    );
  });
  it("resumes from summaries without loading completed schedule batches until final processing", async () => {
    const test = setup(12001);
    const summaries = new Map<string, ImportCheckpointSummary>();
    const readStages: { name: string; stage: string }[] = [];
    const artifacts = {
      read: async <T>(name: string) => {
        readStages.push({ name, stage: test.job().stage });
        return test.artifacts.read<T>(name);
      },
      summary: async (name: string) => summaries.get(name) ?? null,
      write: async (name: string, value: unknown, summary?: ImportCheckpointSummary) => {
        await test.artifacts.write(name, value);
        if (summary) summaries.set(name, summary);
      },
    };
    vi.mocked(finishStagedImport).mockRejectedValueOnce(new Error("Execution interrupted"));
    await expect(runStagedImport(ID, { ...test.deps, artifacts })).rejects.toThrow(
      "Execution interrupted"
    );
    expect(summaries.size).toBe(7);
    readStages.length = 0;
    await runStagedImport(ID, { ...test.deps, artifacts });
    expect(test.fetchTeams).toHaveBeenCalledTimes(2);
    expect(
      readStages.filter((read) => read.name.startsWith("batch-") && read.stage !== "filing")
    ).toEqual([]);
    expect(test.job()).toMatchObject({ status: "done", download: { total: 12001, done: 12001 } });
  });
  it("reads only requested checkpoints during an extra age pass", async () => {
    const test = setup(6001);
    const read = vi.spyOn(test.artifacts, "read");
    const realFinish = vi.mocked(finishStagedImport).getMockImplementation()!;
    vi.mocked(finishStagedImport).mockImplementationOnce(
      async (job, source, copy, counts, deps) => {
        const result = await realFinish(job, source, copy, counts, deps);
        read.mockClear();
        const selected: string[] = [];
        for await (const schedule of source(new Set(["gc0000004001"])))
          selected.push(schedule.profile.id);
        expect(read.mock.calls.map(([name]) => name)).toEqual(["batch-2"]);
        expect(selected).toEqual(["gc0000004001"]);
        expect(test.job().detail).toBe("Assigning ages, pass 1");
        expect(test.job().progress).toMatchObject({ done: 1, total: 1 });
        return result;
      }
    );
    await runStagedImport(ID, test.deps);
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
  });
  it("publishes failure reports before accepting their checkpoints and records measured throughput", async () => {
    const test = setup(3);
    let elapsed = 0;
    const reports = { download: vi.fn(async () => {}), filing: vi.fn(async () => {}) };
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      const answers = new Map<string, GcTeamResponse>();
      for (const [n, id] of ids.entries()) {
        elapsed += 1000;
        const result: GcTeamResponse =
          n === 0 ? { ok: false, reason: "timeout", message: "Slow" } : good(id);
        answers.set(id, result);
        options?.onProgress?.({ teamId: id, result, done: n + 1, total: ids.length, attempts: 1 });
      }
      return answers;
    });
    const write = test.artifacts.write;
    test.artifacts.write = async (name, value) => {
      if (name === "batch-0") expect(reports.download).toHaveBeenCalledTimes(1);
      await write(name, value);
    };
    await runStagedImport(ID, {
      ...test.deps,
      reports,
      now: () => new Date(Date.parse(NOW) + elapsed),
    });
    expect(reports.download.mock.calls[0]).toMatchObject([
      0,
      [{ teamId: "gc0000000000", reason: "Timed out" }],
    ]);
    expect(test.job()).toMatchObject({
      status: "done",
      report: { rows: 1, ready: true },
      download: { total: 3, done: 3, perMinute: 60 },
    });
  });
  it("shows a provider wait immediately after a progress update and clears it when downloads finish", async () => {
    const test = setup(2);
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      const first = good(ids[0]!);
      options?.onProgress?.({
        teamId: ids[0]!,
        result: first,
        done: 1,
        total: 2,
        attempts: 1,
      });
      options?.onHold?.(60_000, "retry-after");
      await vi.waitFor(() =>
        expect(test.job().download).toMatchObject({
          holdUntil: new Date(Date.parse(NOW) + 60_000).toISOString(),
          holdReason: "throttled",
        })
      );
      return new Map(ids.map((id) => [id, good(id)]));
    });
    await runStagedImport(ID, test.deps);
    expect(test.job()).toMatchObject({
      status: "done",
      download: { done: 2, total: 2, holdUntil: null, holdReason: null },
    });
  });
  it("resumes an old incomplete checkpoint without downloading its successes or failures again", async () => {
    const test = setup(2003);
    test.values.set("batch-0", {
      complete: true,
      answers: Array.from({ length: 2000 }, (_, n) => {
        const id = `gc${String(n).padStart(10, "0")}`;
        return [id, good(id)];
      }),
    });
    test.values.set("batch-1", {
      complete: false,
      answers: [
        ["gc0000002000", good("gc0000002000")],
        ["gc0000002001", { ok: false, reason: "timeout", message: "Timed out" }],
      ],
    });
    await test.jobs.update(ID, { error: "Some team downloads need another attempt." });
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids)).toEqual([["gc0000002002"]]);
    expect(test.job()).toMatchObject({
      status: "done",
      tally: { asked: 2003, answered: 2002, failed: 1, filed: 2002 },
      error: null,
    });
  });
  it("reports failure reasons and bounded diagnostics, then files every successful team", async () => {
    const test = setup(4);
    test.fetchTeams.mockImplementationOnce(
      async (ids) =>
        new Map([
          [ids[0]!, good(ids[0]!)],
          ...ids.slice(1).map((id): [string, GcTeamResponse] => [
            id,
            {
              ok: false,
              reason: "unrecognized",
              message: "Unreadable profile",
              diagnostics: {
                status: 200,
                bodyPreview: "x".repeat(600),
                topLevelKeys: ["unexpected"],
              },
            },
          ]),
        ])
    );
    const onDownloadReport = vi.fn();
    await runStagedImport(ID, { ...test.deps, onDownloadReport });
    expect(onDownloadReport).toHaveBeenCalledTimes(1);
    expect(onDownloadReport.mock.calls[0]![0]).toMatchObject({
      batch: 1,
      downloaded: 1,
      skipped: 3,
      reasons: { unrecognized: 3 },
    });
    const samples = onDownloadReport.mock.calls[0]![0].samples;
    expect(samples).toHaveLength(1);
    expect(samples[0].error.diagnostics.bodyPreview).toHaveLength(300);
    expect(test.filed).toEqual(["gc0000000000"]);
    expect(test.job().status).toBe("done");
  });
  it("counts a missing download result as skipped instead of restarting the job", async () => {
    const test = setup(2);
    test.fetchTeams.mockImplementationOnce(async (ids) => new Map([[ids[0]!, good(ids[0]!)]]));
    await runStagedImport(ID, test.deps);
    expect(test.job()).toMatchObject({
      status: "done",
      tally: { asked: 2, answered: 1, failed: 1, filed: 1 },
    });
    expect(test.fetchTeams).toHaveBeenCalledTimes(1);
  });
  it("keeps unattempted teams available when a user stops during a batch", async () => {
    const test = setup(3);
    test.fetchTeams.mockImplementationOnce(async (ids) => {
      await test.jobs.update(ID, { stopAsked: true });
      return new Map([[ids[0]!, good(ids[0]!)]]);
    });
    await runStagedImport(ID, test.deps);
    expect(test.job().status).toBe("cancelled");
    expect(finishStagedImport).not.toHaveBeenCalled();
    await test.jobs.update(ID, { stopAsked: false, status: "queued" });
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids)).toEqual([
      ["gc0000000000", "gc0000000001", "gc0000000002"],
      ["gc0000000001", "gc0000000002"],
    ]);
    expect(test.job()).toMatchObject({ status: "done", tally: { answered: 3, failed: 0 } });
  });
  it("preserves unattempted teams when the download service denies access", async () => {
    const test = setup(2);
    test.fetchTeams.mockImplementationOnce(async (ids, options) => {
      options?.onMembersOnly?.("Access denied");
      return new Map([[ids[0]!, good(ids[0]!)]]);
    });
    await expect(runStagedImport(ID, test.deps)).rejects.toThrow(
      "could not access its download service"
    );
    expect(finishStagedImport).not.toHaveBeenCalled();
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids)).toEqual([
      ["gc0000000000", "gc0000000001"],
      ["gc0000000001"],
    ]);
    expect(test.job()).toMatchObject({ status: "done", tally: { answered: 2, failed: 0 } });
  });
  it("keeps all downloaded answers from the old failed batch without any new requests", async () => {
    const test = setup(2);
    test.values.set("batch-0", {
      complete: false,
      answers: [
        ["gc0000000000", good("gc0000000000")],
        ["gc0000000001", { ok: false, reason: "network", message: "Disconnected" }],
      ],
    });
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams).not.toHaveBeenCalled();
    expect(test.job()).toMatchObject({
      status: "done",
      tally: { asked: 2, answered: 1, failed: 1, filed: 1 },
    });
  });
  it("keeps permanent missing teams as reported failures instead of endlessly retrying them", async () => {
    const test = setup(2);
    test.fetchTeams.mockImplementationOnce(
      async (ids) =>
        new Map(ids.map((id) => [id, { ok: false, reason: "not-found", message: "Missing" }]))
    );
    await runStagedImport(ID, test.deps);
    expect(test.job()).toMatchObject({
      status: "done",
      tally: { asked: 2, answered: 0, failed: 2 },
    });
  });
  it("stops between batches without publishing a partial pool and retains downloads for resume", async () => {
    const test = setup(2001);
    test.fetchTeams.mockImplementationOnce(async (ids) => {
      await test.jobs.update(ID, { stopAsked: true });
      return new Map(ids.map((id) => [id, good(id)]));
    });
    await runStagedImport(ID, test.deps);
    expect(test.job().status).toBe("cancelled");
    expect(test.values.has("batch-0")).toBe(true);
    expect(finishStagedImport).not.toHaveBeenCalled();
    await test.jobs.update(ID, { stopAsked: false, status: "queued" });
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids.length)).toEqual([2001]);
  });
  it("leaves data unpublished when the original copy was replaced", async () => {
    const test = setup(1);
    vi.mocked(finishStagedImport).mockResolvedValueOnce({
      end: "copy-replaced",
      asked: 1,
      answered: 1,
      failed: 0,
      filed: 0,
      gamesAdded: 0,
      gamesUpdated: 0,
      changed: [],
      replays: 0,
    });
    await runStagedImport(ID, test.deps);
    expect(test.job()).toMatchObject({ status: "failed", end: "copy-replaced", version: null });
  });
  it("does nothing when replayed after completion", async () => {
    const test = setup(1);
    await runStagedImport(ID, test.deps);
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams).toHaveBeenCalledTimes(1);
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
  });
});

it("checkpoint pointers survive a partial replacement and reject corrupted bytes", async () => {
  const documents = new Map<string, Record<string, unknown>>();
  let fail = false;
  const artifacts = restImportArtifacts(
    {
      read: async (path) => documents.get(path) ?? null,
      set: async (path, value) => {
        if (fail && !value.data) throw new Error("Connection dropped");
        documents.set(path, value);
      },
    },
    ID
  );
  await artifacts.write("batch-0", { kept: ["a"] });
  fail = true;
  await expect(artifacts.write("batch-0", { kept: ["a", "b"] })).rejects.toThrow();
  expect(await artifacts.read("batch-0")).toEqual({ kept: ["a"] });
  for (const [path, value] of documents)
    if (value.data) documents.set(path, { data: new Uint8Array([0, 1]) });
  await expect(artifacts.read("batch-0")).rejects.toThrow();
});

it("reads checkpoint summaries without fetching schedule pieces, and upgrades old metadata with a precondition", async () => {
  const values = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, string>();
  let version = 0;
  const read = vi.fn(async (path: string) => values.get(path) ?? null);
  const set = async (path: string, value: Record<string, unknown>) => {
    values.set(path, value);
    tokens.set(path, String(++version));
  };
  const replace = vi.fn(
    async (path: string, value: Record<string, unknown>, token: string | null) => {
      if (tokens.get(path) !== token) return false;
      await set(path, value);
      return true;
    }
  );
  const artifacts = restImportArtifacts(
    {
      read,
      set,
      replace,
      readAt: async (path) =>
        values.has(path) ? { fields: values.get(path)!, token: tokens.get(path)! } : null,
    },
    ID
  );
  const batch = { complete: true, answers: [["gc0000000000", good("gc0000000000")]] };
  const summary: ImportCheckpointSummary = {
    complete: true,
    asked: 1,
    answered: 1,
    failed: 0,
    reportReady: true,
  };
  await artifacts.write("batch-0", batch, summary);
  read.mockClear();
  expect(await artifacts.summary!("batch-0")).toEqual(summary);
  expect(read.mock.calls.map(([path]) => path)).toEqual([`pullJobs/${ID}/artifacts/batch-0`]);
  await artifacts.write("batch-1", batch);
  expect(await artifacts.summary!("batch-1")).toBeNull();
  await artifacts.read("batch-1");
  await artifacts.rememberSummary!("batch-1", summary);
  expect(await artifacts.summary!("batch-1")).toEqual(summary);
  await artifacts.write("batch-2", batch);
  await artifacts.read("batch-2");
  const path = `pullJobs/${ID}/artifacts/batch-2`;
  await set(path, { ...values.get(path), newer: true });
  await artifacts.rememberSummary!("batch-2", summary);
  expect(values.get(path)!.summary).toBeUndefined();
  expect(values.get(path)!.newer).toBe(true);
});
