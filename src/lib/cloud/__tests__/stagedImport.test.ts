import { afterEach, describe, expect, it, vi } from "vitest";
import type { GcTeamResponse } from "../../gameChangerApi";
import { newPullJob } from "../pullJobs";
import type { JobDocs } from "../pullJobRunner";
import { restImportArtifacts, runStagedImport } from "../stagedImport";
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
  const fetchTeams = vi.fn(async (ids: string[]) => {
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
    expect(test.fetched.map((ids) => ids.length)).toEqual([2000, 2000, 1001]);
    expect(selectImportTeams).not.toHaveBeenCalled();
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
    expect(test.filed).toHaveLength(5001);
    expect(new Set(test.filed).size).toBe(5001);
    expect(test.job()).toMatchObject({
      status: "done",
      legsDone: 3,
      tally: { asked: 5001, answered: 5001, failed: 0, filed: 5001 },
      version: 8,
    });
  });
  it("resumes failed downloads without refetching successful teams or completed batches", async () => {
    const test = setup(2003);
    test.fetchTeams.mockImplementationOnce(async (ids) => new Map(ids.map((id) => [id, good(id)])));
    test.fetchTeams.mockImplementationOnce(
      async (ids) =>
        new Map(
          ids.map((id, n) => [
            id,
            n === 1 ? { ok: false, reason: "network", message: "Disconnected" } : good(id),
          ])
        )
    );
    await expect(runStagedImport(ID, test.deps)).rejects.toThrow("another attempt");
    expect(finishStagedImport).not.toHaveBeenCalled();
    expect(test.job().legsDone).toBe(1);
    await runStagedImport(ID, test.deps);
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids.length)).toEqual([2000, 3, 1]);
    expect(finishStagedImport).toHaveBeenCalledTimes(1);
    expect(test.job().tally.answered).toBe(2003);
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
    expect(test.fetchTeams.mock.calls.map(([ids]) => ids.length)).toEqual([2000, 1]);
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
