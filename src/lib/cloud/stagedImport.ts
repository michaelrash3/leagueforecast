import type { GcTeamListEntry, GcTeamResponse, GcTeamSchedule } from "../gameChangerApi";
import { PULL_CONCURRENCY, PULL_MAX_CONCURRENCY } from "../gameChangerClient";
import { resetTeamRankingsStore } from "../teamRankingsStorage";
import { finishStagedImport, selectImportTeams, type CloudPullDeps } from "./cloudRunner";
import { hashJson, packHashed, unpackChunks } from "./cloudPack";
import type { FirestoreRestDocuments } from "./firestoreRest";
import type { JobDocs } from "./pullJobRunner";
import { IMPORT_BATCH_TEAMS, NO_TALLY, unpackJobList, type PullJob } from "./pullJobs";

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
type StagedDeps = Pick<CloudPullDeps, "store" | "fetchTeams" | "now"> & {
  jobs: JobDocs;
  artifacts: ImportArtifacts;
  signal?: AbortSignal;
  /** Parent process keeps heartbeats alive even during synchronous matching and tidy. */
  onProgress?: (detail?: string) => void;
};

const RETRYABLE = new Set([
  "network",
  "timeout",
  "throttled",
  "upstream-error",
  "unrecognized",
  "blocked",
]);
const retryable = (answer: GcTeamResponse): boolean => !answer.ok && RETRYABLE.has(answer.reason);

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
  await say({ status: "running", stage: "checking", error: null });
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
    plan = { ...selected, batchTeams: IMPORT_BATCH_TEAMS };
    await artifacts.write("plan", plan);
  }
  const legs = Math.ceil(plan.entries.length / plan.batchTeams);
  await say({ legs: Math.max(1, legs), legTeams: plan.batchTeams });
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
    const entries = plan.entries.slice(leg * plan.batchTeams, (leg + 1) * plan.batchTeams);
    const name = `batch-${leg}`;
    let batch = await artifacts.read<Batch>(name);
    const answers = new Map(batch?.answers ?? []);
    if (!batch?.complete) {
      const pending = entries
        .map((e) => e.teamId)
        .filter((id) => !answers.has(id) || retryable(answers.get(id)!));
      let done = entries.length - pending.length;
      let batchFailed = 0;
      let progressWrite = Promise.resolve();
      await say({
        stage: "fetching",
        legsDone: leg,
        progress: { done, total: entries.length, failed: 0 },
      });
      let lastReport = 0;
      const fetched = await deps.fetchTeams(pending, {
        concurrency,
        maxConcurrency,
        onConcurrency: (workers) => {
          concurrency = workers;
        },
        onHold: () => {
          concurrency = PULL_CONCURRENCY;
          maxConcurrency = PULL_CONCURRENCY;
        },
        ...(deps.signal ? { signal: deps.signal } : {}),
        onProgress: ({ result }) => {
          done++;
          if (!result.ok) batchFailed++;
          if (now().getTime() - lastReport >= 10_000) {
            lastReport = now().getTime();
            const progress = { done, total: entries.length, failed: batchFailed };
            progressWrite = progressWrite.then(() => say({ progress })).catch(() => undefined);
          }
        },
      });
      await progressWrite;
      for (const [id, answer] of fetched) answers.set(id, answer);
      batch = {
        answers: [...answers],
        complete: entries.every((e) => answers.has(e.teamId) && !retryable(answers.get(e.teamId)!)),
      };
      await artifacts.write(name, batch);
      if (!batch.complete) {
        await say({
          stage: "waiting",
          progress: {
            done,
            total: entries.length,
            failed: [...answers.values()].filter((a) => !a.ok).length,
          },
          error:
            "GameChanger is not answering some teams. Retrying the unfinished downloads; completed downloads are kept.",
        });
        throw new Error("Some team downloads need another attempt.");
      }
    }
    asked += entries.length;
    answered += batch.answers.filter(([, a]) => a.ok).length;
    failed = asked - answered;
    await say({
      stage: "fetching",
      legsDone: leg + 1,
      progress: {
        done: entries.length,
        total: entries.length,
        failed: batch.answers.filter(([, a]) => !a.ok).length,
      },
      tally: { ...prior, asked, answered, failed },
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
        for (let leg = 0; leg < legs; leg++) {
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
