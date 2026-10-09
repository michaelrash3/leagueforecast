import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupAnswer, BackupRequest } from "../../../workers/backupProtocol";
import { commitChanges } from "../../cloud/cloudEngine";
import { chunkId, DATA_SCHEMA } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryCloud } from "../../cloud/__tests__/memoryCloud";
import type { CopyReader } from "../copyArchive";
import { BACKUP_WORKER_LIMIT_MS, copyBackup, runBackupWorker } from "../copyBackup";

/*
 * What the page fetches of the cloud's copy for a backup: the pieces of every pool part the copy's
 * manifest names, and nothing of League Standings, handed to the backup worker as they are.
 */

const T = "2027-04-15T12:00:00.000Z";
const TEAMS = "league_forecast_scout_teams_v1";
const GROUPS = "league_forecast_scout_age_groups_v1";

const copyHolding = async (values: Record<string, unknown>) => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: Object.entries(values).map(([key, value]) => ({ key, value, at: 1 })),
    device: "phone",
    now: T,
  });
  if (!saved.ok) throw new Error("not saved");
  return cloud;
};

/** A worker that keeps what it was asked, and answers as an empty one would. */
const recording = () => {
  const asked: BackupRequest[] = [];
  return {
    asked,
    run: async (request: BackupRequest) => {
      asked.push(request);
      return { ok: true as const, file: ["{}"] };
    },
  };
};

describe("the copy's pool, fetched for a backup", () => {
  it("hands every pool part's pieces to the worker, and nothing of League Standings", async () => {
    const cloud = await copyHolding({
      [TEAMS]: [{ id: "S-1", name: "Placeholder S-1" }],
      [GROUPS]: [{ id: "ag", name: "9U", seasonIds: [] }],
      [LEAGUE_PART]: { seasons: [] },
    });
    const worker = recording();
    const progress: [number, number][] = [];
    const made = await copyBackup({
      copy: async () => cloud.store,
      want: "file",
      savedAt: T,
      run: worker.run,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(made).toEqual({ ok: true, file: ["{}"] });
    const [request] = worker.asked;
    expect(request?.want).toBe("file");
    expect(request?.savedAt).toBe(T);
    const manifest = await cloud.store.readManifest();
    const pool = manifest?.parts.filter(({ key }) => key !== LEAGUE_PART) ?? [];
    expect(request?.parts.map(({ key, hash }) => ({ key, hash }))).toEqual(
      pool.map(({ key, hash }) => ({ key, hash }))
    );
    for (const part of pool)
      expect(request?.parts.find(({ key }) => key === part.key)?.chunks).toEqual(
        await Promise.all(
          Array.from({ length: part.chunks }, (_, at) => cloud.store.getChunk(chunkId(part.id, at)))
        )
      );
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("reads the copy again once when it moves on under the read, and says so the second time", async () => {
    const cloud = await copyHolding({ [TEAMS]: [{ id: "S-1", name: "Placeholder S-1" }] });
    const store = cloud.store;
    let gone = 1;
    const moving = {
      readManifest: () => store.readManifest(),
      getChunk: async (id: string) => (gone-- > 0 ? null : store.getChunk(id)),
    };
    const worker = recording();
    expect(
      await copyBackup({ copy: async () => moving, want: "csv", savedAt: T, run: worker.run })
    ).toEqual({
      ok: true,
      file: ["{}"],
    });
    expect(worker.asked.map(({ want }) => want)).toEqual(["csv"]);
    gone = 2;
    expect(
      await copyBackup({ copy: async () => moving, want: "csv", savedAt: T, run: worker.run })
    ).toEqual({
      ok: false,
      why: "moved",
    });
    expect(worker.asked).toHaveLength(1);
  });

  it("is no backup of a copy a newer build saved, whose values hold fields this build drops", async () => {
    const cloud = await copyHolding({ [TEAMS]: [{ id: "S-1", name: "Placeholder S-1" }] });
    const store = cloud.store;
    let fetched = 0;
    const newer = {
      readManifest: async () => {
        const manifest = await store.readManifest();
        return manifest && { ...manifest, schema: DATA_SCHEMA + 1 };
      },
      getChunk: (id: string) => {
        fetched += 1;
        return store.getChunk(id);
      },
    };
    const worker = recording();
    expect(
      await copyBackup({ copy: async () => newer, want: "backup", savedAt: T, run: worker.run })
    ).toEqual({ ok: false, why: "newer" });
    // Refused off the manifest, as a take refuses it: not a piece of it is downloaded.
    expect(fetched).toBe(0);
    expect(worker.asked).toEqual([]);
  });

  it("is no backup with no copy, no reader, or a read that fails, and never throws", async () => {
    const worker = recording();
    const empty = memoryCloud();
    const made = (copy: (() => Promise<CopyReader | null>) | undefined) =>
      copyBackup({ copy, want: "file", savedAt: T, run: worker.run });
    expect(await made(async () => empty.store)).toEqual({ ok: false, why: "none" });
    // Signed out, no reader given, or a sign-in that would not load.
    for (const copy of [async () => null, undefined, () => Promise.reject(new Error("no sign-in"))])
      expect(await made(copy)).toEqual({ ok: false, why: "unreachable" });
    // Read once: offline, a second read would only wait out the reader's limit again.
    let reads = 0;
    const failing = {
      readManifest: () => {
        reads += 1;
        return Promise.reject(new Error("offline"));
      },
      getChunk: () => Promise.reject(new Error("offline")),
    };
    expect(await made(async () => failing)).toEqual({ ok: false, why: "unreachable" });
    expect(reads).toBe(1);
    expect(worker.asked).toEqual([]);
    // A worker that fails rather than answering is said as one that could not make it.
    const cloud = await copyHolding({ [TEAMS]: [{ id: "S-1", name: "Placeholder S-1" }] });
    expect(
      await copyBackup({
        copy: async () => cloud.store,
        want: "file",
        savedAt: T,
        run: () => Promise.reject(new Error("could not clone")),
      })
    ).toEqual({ ok: false, why: "failed" });
  });
});

/** A stand-in for the backup worker: does with each request what `act` says, and notes its end. */
class StandIn {
  static act: (worker: StandIn, request: BackupRequest) => void = () => undefined;
  static made: StandIn[] = [];
  onmessage: ((event: { data: BackupAnswer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  ended = false;
  constructor() {
    StandIn.made.push(this);
  }
  postMessage(request: BackupRequest) {
    StandIn.act(this, request);
  }
  terminate() {
    this.ended = true;
  }
}

describe("a request run on a backup worker of its own", () => {
  const REQUEST: BackupRequest = { parts: [], want: "csv", savedAt: T };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    StandIn.made = [];
  });

  it("is the worker's answer, and the worker is ended with it", async () => {
    vi.stubGlobal("Worker", StandIn);
    StandIn.act = (worker, request) =>
      queueMicrotask(() => worker.onmessage?.({ data: { ok: true, csv: request.want } }));
    expect(await runBackupWorker(REQUEST)).toEqual({ ok: true, csv: "csv" });
    expect(StandIn.made.map(({ ended }) => ended)).toEqual([true]);
  });

  it("fails, and ends the worker, when it errs or its answer cannot be read", async () => {
    vi.stubGlobal("Worker", StandIn);
    StandIn.act = (worker) => queueMicrotask(() => worker.onerror?.());
    expect(await runBackupWorker(REQUEST)).toEqual({ ok: false, why: "failed" });
    StandIn.act = (worker) => queueMicrotask(() => worker.onmessageerror?.());
    expect(await runBackupWorker(REQUEST)).toEqual({ ok: false, why: "failed" });
    expect(StandIn.made.map(({ ended }) => ended)).toEqual([true, true]);
  });

  it("fails, and ends the worker, when it never answers within the limit", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("Worker", StandIn);
      // Killed without a word, or holding an answer it cannot post: nothing ever comes.
      StandIn.act = () => undefined;
      let answer: BackupAnswer | null = null;
      void runBackupWorker(REQUEST).then((made) => {
        answer = made;
      });
      await vi.advanceTimersByTimeAsync(BACKUP_WORKER_LIMIT_MS - 1);
      expect(answer).toBeNull();
      expect(StandIn.made.map(({ ended }) => ended)).toEqual([false]);
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toEqual({ ok: false, why: "failed" });
      expect(StandIn.made.map(({ ended }) => ended)).toEqual([true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no limit running once the worker has answered", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("Worker", StandIn);
      StandIn.act = (worker, request) =>
        queueMicrotask(() => worker.onmessage?.({ data: { ok: true, csv: request.want } }));
      expect(await runBackupWorker(REQUEST)).toEqual({ ok: true, csv: "csv" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails, never done on the page instead, where no worker will start", async () => {
    // None at all, as in Node, and one the browser will not start.
    expect(await runBackupWorker(REQUEST)).toEqual({ ok: false, why: "failed" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked");
        }
      }
    );
    expect(await runBackupWorker(REQUEST)).toEqual({ ok: false, why: "failed" });
  });
});
