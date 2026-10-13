import type {
  GcFetchErrorReason,
  GcTeamListEntry,
  GcTeamResponse,
  GcTeamSchedule,
} from "../gameChangerApi";
import { PULL_CONCURRENCY, PULL_MAX_CONCURRENCY } from "../gameChangerClient";
import { GC_FETCH_REASON_LABEL } from "../gameChangerReport";
import { resetTeamRankingsStore } from "../teamRankingsStorage";
import { finishStagedImport, selectImportTeams, type CloudPullDeps } from "./cloudRunner";
import { hashJson, packHashed, unpackChunks } from "./cloudPack";
import type { FirestoreRestDocuments } from "./firestoreRest";
import type { JobDocs } from "./pullJobRunner";
import {
  IMPORT_BATCH_TEAMS,
  IMPORT_CHECKPOINT_TEAMS,
  NO_TALLY,
  unpackJobList,
  type PullJob,
} from "./pullJobs";

/** Hash-checked artifacts outside the live copy. Only the server writes or reads these. */
export type ImportArtifacts = {
  read: <T>(name: string) => Promise<T | null>;
  write: (name: string, value: unknown) => Promise<void>;
};

export const restImportArtifacts = (
  docs: Pick<FirestoreRestDocuments, "read" | "set">,
  jobId: string
): ImportArtifacts => {
  const path = (name: string) => `pullJobs/${jobId}/artifacts/${name}`;
  return {
    read: async <T>(name: string): Promise<T | null> => {
      const meta = await docs.read(path(name));
      if (!meta) return null;
      if (
        typeof meta.hash !== "string" ||
        !Number.isSafeInteger(meta.pieces) ||
        Number(meta.pieces) < 1
      ) {
        throw new Error("An import checkpoint is damaged.");
      }
      const pieces: Uint8Array[] = [];
      for (let i = 0; i < Number(meta.pieces); i++) {
        const piece = await docs.read(path(`${name}-${meta.hash}-${i}`));
        if (!(piece?.data instanceof Uint8Array))
          throw new Error("An import checkpoint piece is missing.");
        pieces.push(piece.data);
      }
      return (await unpackChunks(pieces, meta.hash)) as T;
    },
    write: async (name, value) => {
      const hashed = await hashJson(value);
      const pieces = await packHashed(hashed);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
      for (const [i, data] of pieces.entries()) {
        await docs.set(path(`${name}-${hashed.hash}-${i}`), { data, expiresAt });
      }
      // Pointer last; a crash mid-upload cannot destroy the previous checkpoint.
      await docs.set(path(name), { hash: hashed.hash, pieces: pieces.length, expiresAt });
    },
  };
};

type ImportPlan = { copy: string; entries: GcTeamListEntry[]; batchTeams: number };
type Batch = { answers: [string, GcTeamResponse][]; complete: boolean };
export type ImportDownloadReport = {
  batch: number;
  checkpoint?: number;
  downloaded: number;
  skipped: number;
  reasons: Partial<Record<GcFetchErrorReason, number>>;
  samples: { teamId: string; error: Extract<GcTeamResponse, { ok: false }> }[];
};
type StagedDeps = Pick<CloudPullDeps, "store" | "fetchTeams" | "now"> & {
  jobs: JobDocs;
  artifacts: ImportArtifacts;
  signal?: AbortSignal;
  /** Parent process keeps heartbeats alive even during synchronous matching and tidy. */
  onProgress?: (detail?: string) => void;
  onDownloadReport?: (report: ImportDownloadReport) => void;
};

const downloadReport = (
  leg: number,
  answers: ReadonlyMap<string, GcTeamResponse>
): ImportDownloadReport => {
  const report: ImportDownloadReport = {
    batch: leg + 1,
    downloaded: 0,
    skipped: 0,
    reasons: {},
    samples: [],
  };
  for (const [teamId, answer] of answers) {
    if (answer.ok) {
      report.downloaded++;
      continue;
    }
    report.skipped++;
    const firstOfReason = !report.reasons[answer.reason];
    report.reasons[answer.reason] = (report.reasons[answer.reason] ?? 0) + 1;
    // One bounded diagnostic per reason, without successful schedules or request headers.
    if (firstOfReason)
      report.samples.push({
        teamId,
        error: {
          ...answer,
          message: answer.message.slice(0, 500),
          ...(answer.diagnostics
            ? {
                diagnostics: {
                  ...answer.diagnostics,
                  ...(answer.diagnostics.bodyPreview
                    ? { bodyPreview: answer.diagnostics.bodyPreview.slice(0, 300) }
                    : {}),
                },
              }
            : {}),
        },
      });
  }
  return report;
};

/** One execution may outlive HTTP. Restarts use the saved selection and completed downloads. */
export const runStagedImport = async (jobId: string, deps: StagedDeps): Promise<void> => {
  const { jobs, artifacts, now } = deps;
  const job = await jobs.read(jobId);
  if (
    !job ||
    job.pipeline !== "staged-v1" ||
    job.rota ||
    ["done", "failed", "cancelled"].includes(job.status)
  )
    return;
  const stamp = () => now().toISOString();
  const say = async (patch: Partial<PullJob>) => {
    await jobs.update(jobId, { ...patch, updatedAt: stamp(), progressAt: stamp() });
    deps.onProgress?.();
  };
  const stopped = async () =>
    deps.signal?.aborted === true || (await jobs.read(jobId))?.stopAsked === true;
  if (await stopped()) {
    await say({ status: "cancelled", stage: "waiting" });
    return;
  }
  await say({ status: "running", stage: "checking", error: null, detail: "" });
  let plan = await artifacts.read<ImportPlan>("plan");
  if (!plan) {
    const entries = await unpackJobList(job.list, (i) => jobs.piece(jobId, i));
    const selected = await selectImportTeams(
      deps.store,
      {
        kind: "list",
        entries,
        seasonYears: job.seasonYears,
        ...(job.refresh ? { refresh: true } : {}),
      },
      job.priorTally ? new Date(job.createdAt) : undefined
    );
    plan = { ...selected, batchTeams: IMPORT_CHECKPOINT_TEAMS };
    await artifacts.write("plan", plan);
  }
  // Existing artifact boundaries stay frozen. Group them into larger continuous download runs.
  const checkpoints = Math.ceil(plan.entries.length / plan.batchTeams);
  const perRun = Math.max(1, Math.floor(IMPORT_BATCH_TEAMS / plan.batchTeams));
  const legTeams = perRun * plan.batchTeams;
  const legs = Math.ceil(checkpoints / perRun);
  await say({ legs: Math.max(1, legs), legTeams });
  const prior = job.priorTally ?? NO_TALLY;
  let asked = prior.asked;
  let answered = prior.answered;
  let failed = prior.failed;
  let concurrency = PULL_CONCURRENCY;
  let maxConcurrency = PULL_MAX_CONCURRENCY;
  for (let leg = 0; leg < legs; leg++) {
    if (await stopped()) {
      await say({
        status: "cancelled",
        stage: "waiting",
        error: "Downloaded batches are kept; nothing from this import was published.",
      });
      return;
    }
    const chunks: {
      index: number;
      entries: GcTeamListEntry[];
      answers: Map<string, GcTeamResponse>;
      queued: boolean;
    }[] = [];
    const countSaved = (answers: ReadonlyMap<string, GcTeamResponse>) => {
      asked += answers.size;
      answered += [...answers.values()].filter((a) => a.ok).length;
      failed = asked - answered;
    };
    for (let index = leg * perRun; index < Math.min((leg + 1) * perRun, checkpoints); index++) {
      const batch = await artifacts.read<Batch>(`batch-${index}`);
      const chunk = {
        index,
        entries: plan.entries.slice(index * plan.batchTeams, (index + 1) * plan.batchTeams),
        answers: new Map(batch?.answers ?? []),
        queued: batch?.complete === true,
      };
      if (chunk.queued) countSaved(chunk.answers);
      chunks.push(chunk);
    }
    const owners = new Map(
      chunks.flatMap((chunk) => chunk.entries.map((e) => [e.teamId, chunk] as const))
    );
    const pending = [...owners].filter(([id, chunk]) => !chunk.answers.has(id)).map(([id]) => id);
    const total = owners.size;
    let done = total - pending.length;
    let batchFailed = chunks.reduce(
      (n, chunk) => n + [...chunk.answers.values()].filter((a) => !a.ok).length,
      0
    );
    const downloader = new AbortController();
    const abort = () => downloader.abort();
    if (deps.signal?.aborted) abort();
    deps.signal?.addEventListener("abort", abort, { once: true });
    let checkpointWrite = Promise.resolve();
    let storageError: unknown;
    let progressWrite = Promise.resolve();
    const checkpoint = (chunk: (typeof chunks)[number], complete: boolean) => {
      if (chunk.queued) return;
      chunk.queued = true;
      const snapshot: Batch = {
        answers: chunk.entries.flatMap(({ teamId }) => {
          const answer = chunk.answers.get(teamId);
          return answer ? [[teamId, answer] as [string, GcTeamResponse]] : [];
        }),
        complete,
      };
      checkpointWrite = checkpointWrite.then(async () => {
        await artifacts.write(`batch-${chunk.index}`, snapshot);
        countSaved(new Map(snapshot.answers));
        const report = downloadReport(leg, new Map(snapshot.answers));
        if (report.skipped > 0) deps.onDownloadReport?.({ ...report, checkpoint: chunk.index + 1 });
        await say({ tally: { ...prior, asked, answered, failed } });
      });
      // A persistence failure stops new requests; never turn the untouched ids into skipped teams.
      void checkpointWrite.catch((error: unknown) => {
        storageError = error;
        downloader.abort();
      });
    };
    const received = (id: string, result: GcTeamResponse) => {
      const chunk = owners.get(id);
      if (!chunk || chunk.answers.has(id)) return;
      chunk.answers.set(id, result);
      done++;
      if (!result.ok) batchFailed++;
      if (chunk.answers.size === chunk.entries.length) checkpoint(chunk, true);
    };
    await say({
      stage: "fetching",
      legsDone: leg,
      progress: { done, total, failed: batchFailed },
      tally: { ...prior, asked, answered, failed },
      detail: "",
    });
    for (const chunk of chunks)
      if (chunk.answers.size === chunk.entries.length) checkpoint(chunk, true);
    let lastReport = 0;
    let accessError: string | undefined;
    let fetchError: unknown;
    try {
      if (pending.length > 0) {
        const fetched = await deps.fetchTeams(pending, {
          concurrency,
          maxConcurrency,
          retries: 0,
          stopOnRefused: false,
          onMembersOnly: (message) => {
            accessError = message;
          },
          onConcurrency: (workers) => {
            concurrency = workers;
          },
          onHold: () => {
            concurrency = PULL_CONCURRENCY;
            maxConcurrency = PULL_CONCURRENCY;
          },
          signal: downloader.signal,
          onProgress: ({ teamId, result }) => {
            if (downloader.signal.aborted) return;
            received(teamId, result);
            if (now().getTime() - lastReport >= 10_000) {
              lastReport = now().getTime();
              const progress = { done, total, failed: batchFailed };
              progressWrite = progressWrite.then(() => say({ progress })).catch(() => undefined);
            }
          },
        });
        if (!downloader.signal.aborted) for (const [id, result] of fetched) received(id, result);
      }
    } catch (error) {
      fetchError = error;
    } finally {
      deps.signal?.removeEventListener("abort", abort);
    }
    await progressWrite;
    if (storageError !== undefined) {
      await checkpointWrite;
      throw storageError;
    }
    const cancelled = await stopped();
    if (fetchError !== undefined || accessError || cancelled) {
      for (const chunk of chunks) checkpoint(chunk, false);
      await checkpointWrite;
      if (fetchError !== undefined) throw fetchError;
      if (accessError)
        throw new Error(`The importer could not access its download service: ${accessError}`);
      await say({
        status: "cancelled",
        stage: "waiting",
        progress: { done, total, failed: batchFailed },
        error: "Downloaded batches are kept; nothing from this import was published.",
      });
      return;
    }
    for (const id of pending)
      if (!owners.get(id)!.answers.has(id))
        received(id, {
          ok: false,
          reason: "network",
          message: "No download result was returned for this team. Skipped during the import.",
        });
    for (const chunk of chunks) checkpoint(chunk, true);
    await checkpointWrite;
    const report = downloadReport(leg, new Map(chunks.flatMap((chunk) => [...chunk.answers])));
    await say({
      stage: "fetching",
      legsDone: leg + 1,
      progress: { done: total, total, failed: batchFailed },
      tally: { ...prior, asked, answered, failed },
      detail: `download batch ${leg + 1} of ${legs} complete, ${report.downloaded.toLocaleString()} downloaded, ${report.skipped.toLocaleString()} skipped${
        report.skipped > 0
          ? ` (${Object.entries(report.reasons)
              .map(
                ([reason, count]) =>
                  `${GC_FETCH_REASON_LABEL[reason as GcFetchErrorReason]}: ${count?.toLocaleString()}`
              )
              .join("; ")})`
          : ""
      }`,
      error: null,
    });
  }
  if (await stopped()) {
    await say({
      status: "cancelled",
      stage: "waiting",
      error: "Downloaded batches are kept; nothing from this import was published.",
    });
    return;
  }
  if (legs === 0 || answered === prior.answered) {
    await say({
      status: "done",
      stage: "waiting",
      end: legs === 0 ? "nothing-due" : "finished",
      legsDone: Math.max(1, legs),
      tally: { ...prior, asked, answered, failed },
      error: null,
    });
    return;
  }
  let stageWrite: Promise<void> = Promise.resolve();
  const result = await finishStagedImport(
    { kind: "list", entries: plan.entries, seasonYears: job.seasonYears },
    () =>
      (async function* (): AsyncGenerator<GcTeamSchedule> {
        let filed = 0;
        for (let leg = 0; leg < checkpoints; leg++) {
          if (deps.signal?.aborted) throw new Error("The import worker lost its lease.");
          const batch = await artifacts.read<Batch>(`batch-${leg}`);
          if (!batch?.complete) throw new Error("A finished import batch is missing.");
          for (const [, answer] of batch.answers) if (answer.ok) yield answer.schedule;
          filed += batch.answers.filter(([, a]) => a.ok).length;
          await say({
            stage: "filing",
            progress: {
              done: filed,
              total: answered - prior.answered,
              failed: failed - prior.failed,
            },
          });
        }
      })(),
    plan.copy,
    { asked, answered, failed },
    {
      store: deps.store,
      now,
      device: `import-${jobId}`,
      ...(deps.signal ? { signal: deps.signal } : {}),
      beforeTidy: async () => {
        await stageWrite;
        await say({ stage: "tidying", detail: "Final tidy" });
      },
      watchTidy: (step) =>
        deps.onProgress?.(
          `Final tidy, pass ${step.pass}: ${step.step}${step.processed === undefined ? (step.done ? " completed" : "") : `, ${step.processed.toLocaleString()} of ${step.total?.toLocaleString()}`}`
        ),
      onStage: (stage) => {
        stageWrite = stageWrite.then(() => say({ stage: stage.stage }));
      },
    }
  );
  await stageWrite;
  resetTeamRankingsStore();
  if (result.end === "copy-kept-changing")
    throw new Error(
      "The cloud copy changed during the final save. Retrying with the downloaded data."
    );
  if (["no-copy", "copy-replaced", "newer-copy"].includes(result.end)) {
    await say({
      status: "failed",
      stage: "waiting",
      end: result.end,
      error:
        "The cloud copy was replaced or needs a newer importer. Downloaded data was not published.",
    });
    return;
  }
  await say({
    status: "done",
    stage: "waiting",
    legsDone: Math.max(1, legs),
    end: result.end,
    version: result.version ?? null,
    tally: {
      asked,
      answered,
      failed,
      filed: prior.filed + result.filed,
      gamesAdded: prior.gamesAdded + result.gamesAdded,
      gamesUpdated: prior.gamesUpdated + result.gamesUpdated,
    },
    error: null,
  });
};
