import type {
  GcFetchErrorReason,
  GcTeamListEntry,
  GcTeamResponse,
  GcTeamSchedule,
} from "../gameChangerApi";
import { PULL_CONCURRENCY, PULL_MAX_CONCURRENCY } from "../gameChangerClient";
import { resetTeamRankingsStore } from "../teamRankingsStorage";
import {
  finishStagedImport,
  selectImportTeams,
  type CloudPullDeps,
  type ImportScheduleSource,
} from "./cloudRunner";
import { inBatches } from "./cloudEngine";
import { downloadProblems, filingProblems, type ImportReportWriter } from "./importReports";
import { hashJson, packHashed, unpackChunks } from "./cloudPack";
import type { FirestoreRestDocuments } from "./firestoreRest";
import type { JobDocs } from "./pullJobRunner";
import {
  IMPORT_BATCH_TEAMS,
  IMPORT_CHECKPOINT_TEAMS,
  NO_TALLY,
  unpackJobList,
  type PullJob,
  type ImportDownloadStatus,
} from "./pullJobs";

/** Hash-checked artifacts outside the live copy. Only the server writes or reads these. */
export type ImportArtifacts = {
  read: <T>(name: string) => Promise<T | null>;
  write: (name: string, value: unknown, summary?: ImportCheckpointSummary) => Promise<void>;
  summary?: (name: string) => Promise<ImportCheckpointSummary | null>;
  rememberSummary?: (name: string, summary: ImportCheckpointSummary) => Promise<void>;
};

export type ImportCheckpointSummary = {
  complete: boolean;
  asked: number;
  answered: number;
  failed: number;
  reportReady: boolean;
};
const summaryOf = (raw: unknown): ImportCheckpointSummary | null => {
  const s = raw as Partial<ImportCheckpointSummary> | null;
  if (
    !s ||
    typeof s.complete !== "boolean" ||
    typeof s.reportReady !== "boolean" ||
    ![s.asked, s.answered, s.failed].every((n) => Number.isSafeInteger(n) && Number(n) >= 0) ||
    Number(s.answered) + Number(s.failed) !== s.asked
  )
    return null;
  return s as ImportCheckpointSummary;
};
const summarize = (batch: Batch, reportReady: boolean): ImportCheckpointSummary => {
  const answered = batch.answers.filter(([, a]) => a.ok).length;
  return {
    complete: batch.complete,
    asked: batch.answers.length,
    answered,
    failed: batch.answers.length - answered,
    reportReady,
  };
};

export const restImportArtifacts = (
  docs: Pick<FirestoreRestDocuments, "read" | "set"> &
    Partial<Pick<FirestoreRestDocuments, "readAt" | "replace">>,
  jobId: string
): ImportArtifacts => {
  const path = (name: string) => `pullJobs/${jobId}/artifacts/${name}`;
  const readTokens = new Map<string, { fields: Record<string, unknown>; token: string }>();
  return {
    read: async <T>(name: string): Promise<T | null> => {
      const at = docs.readAt ? await docs.readAt(path(name)) : null;
      const meta = docs.readAt ? at?.fields : await docs.read(path(name));
      if (at) readTokens.set(name, at);
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
    summary: async (name) => {
      const meta = await docs.read(path(name));
      return typeof meta?.hash === "string" &&
        /^[0-9a-f]{64}$/.test(meta.hash) &&
        Number.isSafeInteger(meta.pieces) &&
        Number(meta.pieces) > 0
        ? summaryOf(meta.summary)
        : null;
    },
    rememberSummary: async (name, summary) => {
      const at = readTokens.get(name);
      if (at && docs.replace)
        await docs.replace(path(name), { ...at.fields, summary }, at.token).catch(() => false);
    },
    write: async (name, value, summary) => {
      const hashed = await hashJson(value);
      const pieces = await packHashed(hashed);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
      for (const [i, data] of pieces.entries()) {
        await docs.set(path(`${name}-${hashed.hash}-${i}`), { data, expiresAt });
      }
      // Pointer last; a crash mid-upload cannot destroy the previous checkpoint.
      await docs.set(path(name), {
        hash: hashed.hash,
        pieces: pieces.length,
        expiresAt,
        ...(summary ? { summary } : {}),
      });
      readTokens.delete(name);
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
  reports?: ImportReportWriter;
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
  let currentStage = job.stage;
  let stageStartedAt = job.stageStartedAt ?? job.updatedAt;
  const say = async (patch: Partial<PullJob>) => {
    if (patch.stage && patch.stage !== currentStage) {
      currentStage = patch.stage;
      stageStartedAt = stamp();
    }
    await jobs.update(jobId, {
      ...patch,
      ...(patch.stage ? { stageStartedAt } : {}),
      updatedAt: stamp(),
      progressAt: stamp(),
    });
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
  const prior = job.priorTally ?? NO_TALLY;
  const summaries = new Map<number, ImportCheckpointSummary>();
  await inBatches(
    Array.from({ length: checkpoints }, (_, i) => i),
    async (i) => {
      const summary = await artifacts.summary?.(`batch-${i}`);
      const size = Math.min(plan.entries.length - i * plan.batchTeams, plan.batchTeams);
      if (summary && summary.asked <= size && (!summary.complete || summary.asked === size))
        summaries.set(i, summary);
    }
  );
  const knownCounts = new Map([...summaries].map(([i, s]) => [i, s.asked]));
  let overallDone = [...knownCounts.values()].reduce((n, count) => n + count, 0);
  let measuredDone = 0;
  const measuredAt = now().getTime();
  let download: ImportDownloadStatus = {
    total: plan.entries.length,
    done: overallDone,
    perMinute: 0,
    holdUntil: null,
    holdReason: null,
  };
  let filingRows = 0;
  const names = new Map(
    plan.entries.flatMap((entry) => (entry.name ? [[entry.teamId, entry.name] as const] : []))
  );
  await deps.reports?.filing([]);
  let asked = prior.asked;
  let answered = prior.answered;
  let failed = prior.failed;
  const observed = (index: number, count: number) => {
    overallDone += count - (knownCounts.get(index) ?? 0);
    knownCounts.set(index, count);
    download = { ...download, done: overallDone };
  };
  const savedStatus = () => {
    asked = prior.asked;
    answered = prior.answered;
    for (const summary of summaries.values()) {
      asked += summary.asked;
      answered += summary.answered;
    }
    failed = asked - answered;
    return {
      tally: { ...prior, asked, answered, failed },
      download: { ...download },
      ...(deps.reports
        ? {
            report: {
              rows: failed - prior.failed + filingRows,
              ready: [...summaries.values()].every((s) => s.failed === 0 || s.reportReady),
            },
          }
        : {}),
    };
  };
  await say({ legs: Math.max(1, legs), legTeams, ...savedStatus() });
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
      summary?: ImportCheckpointSummary;
    }[] = [];
    for (let index = leg * perRun; index < Math.min((leg + 1) * perRun, checkpoints); index++) {
      let summary = summaries.get(index);
      const cached =
        summary?.complete && (!deps.reports || summary.reportReady || summary.failed === 0);
      const batch = cached ? null : await artifacts.read<Batch>(`batch-${index}`);
      if (batch) {
        summary = summarize(batch, false);
        observed(index, summary.asked);
        if (batch.complete) {
          await deps.reports?.download(index, downloadProblems(batch.answers, names));
          summary = summarize(batch, !!deps.reports);
          await artifacts.rememberSummary?.(`batch-${index}`, summary);
        }
        summaries.set(index, summary);
      }
      const chunk = {
        index,
        entries: plan.entries.slice(index * plan.batchTeams, (index + 1) * plan.batchTeams),
        answers: new Map(batch?.answers ?? []),
        queued: cached === true || batch?.complete === true,
        summary,
      };
      chunks.push(chunk);
    }
    const owners = new Map(
      chunks.flatMap((chunk) => chunk.entries.map((e) => [e.teamId, chunk] as const))
    );
    const pending = [...owners]
      .filter(([id, chunk]) => !chunk.queued && !chunk.answers.has(id))
      .map(([id]) => id);
    const total = owners.size;
    let done = total - pending.length;
    let batchFailed = chunks.reduce(
      (n, chunk) =>
        n + (chunk.summary?.failed ?? [...chunk.answers.values()].filter((a) => !a.ok).length),
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
        await deps.reports?.download(chunk.index, downloadProblems(snapshot.answers, names));
        const summary = summarize(snapshot, !!deps.reports);
        await artifacts.write(`batch-${chunk.index}`, snapshot, summary);
        summaries.set(chunk.index, summary);
        const report = downloadReport(leg, new Map(snapshot.answers));
        if (report.skipped > 0) deps.onDownloadReport?.({ ...report, checkpoint: chunk.index + 1 });
        await say(savedStatus());
      });
      // A persistence failure stops new requests; never turn the untouched ids into skipped teams.
      void checkpointWrite.catch((error: unknown) => {
        storageError = error;
        downloader.abort();
      });
    };
    const received = (id: string, result: GcTeamResponse) => {
      const chunk = owners.get(id);
      if (!chunk || chunk.queued || chunk.answers.has(id)) return;
      chunk.answers.set(id, result);
      done++;
      if (!result.ok) batchFailed++;
      observed(chunk.index, chunk.answers.size);
      measuredDone++;
      const elapsed = now().getTime() - measuredAt;
      download = { ...download, perMinute: elapsed > 0 ? (measuredDone * 60_000) / elapsed : 0 };
      if (chunk.answers.size === chunk.entries.length) checkpoint(chunk, true);
    };
    await say({
      stage: "fetching",
      legsDone: leg,
      progress: { done, total, failed: batchFailed },
      ...savedStatus(),
      detail: "",
    });
    for (const chunk of chunks)
      if (chunk.answers.size === chunk.entries.length) checkpoint(chunk, true);
    let lastReport = 0;
    const reportProgress = (force = false) => {
      if (!force && now().getTime() - lastReport < 10_000) return;
      lastReport = now().getTime();
      const progress = { done, total, failed: batchFailed };
      const status = { ...download };
      progressWrite = progressWrite
        .then(() => say({ progress, download: status, detail: "" }))
        .catch(() => undefined);
    };
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
          onHold: (ms, source) => {
            concurrency = PULL_CONCURRENCY;
            maxConcurrency = PULL_CONCURRENCY;
            const previous = Date.parse(download.holdUntil ?? "") || 0;
            const until = Math.max(previous, now().getTime() + ms);
            download = {
              ...download,
              holdUntil: new Date(until).toISOString(),
              holdReason: source === "refused" ? "refused" : "throttled",
            };
            // Publish a newly started wait immediately; repeated provider replies stay throttled.
            reportProgress(previous <= now().getTime() || until - previous >= 10_000);
          },
          signal: downloader.signal,
          onProgress: ({ teamId, result }) => {
            if (downloader.signal.aborted) return;
            received(teamId, result);
            reportProgress();
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
      if (!owners.get(id)!.queued && !owners.get(id)!.answers.has(id))
        received(id, {
          ok: false,
          reason: "network",
          message: "No download result was returned for this team. Skipped during the import.",
        });
    for (const chunk of chunks) checkpoint(chunk, true);
    download = { ...download, holdUntil: null, holdReason: null };
    await say({ detail: "Saving this batch's downloaded teams", download: { ...download } });
    await checkpointWrite;
    const counts = chunks.reduce(
      (sum, chunk) => {
        const s = summaries.get(chunk.index)!;
        return { downloaded: sum.downloaded + s.answered, skipped: sum.skipped + s.failed };
      },
      { downloaded: 0, skipped: 0 }
    );
    await say({
      stage: "fetching",
      legsDone: leg + 1,
      progress: { done: total, total, failed: batchFailed },
      ...savedStatus(),
      detail: `download batch ${leg + 1} of ${legs} complete, ${counts.downloaded.toLocaleString()} downloaded, ${counts.skipped.toLocaleString()} skipped`,
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
    // Nothing downloaded, nothing filed: and no id GameChanger refused is remembered, either, so a
    // route that answered every id alike with HTTP 400 is never taken for a list of non-ids.
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
  // The ids GameChanger said are not team ids, off every checkpoint holding a failure, for the
  // final phase to remember with the clubs refused for good, so a paste does not ask again.
  const invalidIds: string[] = [];
  for (let index = 0; index < checkpoints; index++) {
    if (!summaries.get(index)?.failed) continue;
    const batch = await artifacts.read<Batch>(`batch-${index}`);
    if (!batch?.complete) throw new Error("A finished import batch is missing.");
    for (const [teamId, answer] of batch.answers)
      if (!answer.ok && answer.reason === "invalid-id") invalidIds.push(teamId);
  }
  let stageWrite: Promise<void> = Promise.resolve();
  const checkpointByTeam = new Map(
    plan.entries.map((e, i) => [e.teamId, Math.floor(i / plan.batchTeams)])
  );
  let agePass = 0;
  let activeAge: { pass: number; done: number; total: number } | null = null;
  const source: ImportScheduleSource = (ids) =>
    (async function* (): AsyncGenerator<GcTeamSchedule> {
      await stageWrite;
      if (!ids) {
        agePass = 0;
        activeAge = null;
      }
      const selected = ids
        ? [
            ...new Set(
              [...ids].flatMap((id) => {
                const at = checkpointByTeam.get(id);
                return at === undefined ? [] : [at];
              })
            ),
          ].sort((a, b) => a - b)
        : Array.from({ length: checkpoints }, (_, i) => i);
      const age = ids ? activeAge : null;
      const total = age?.total ?? ids?.size ?? answered - prior.answered;
      const alreadyProcessed = age?.done ?? 0;
      let processed = 0;
      const detail = ids
        ? `Assigning ages, pass ${age?.pass ?? ++agePass}`
        : "Matching opponents and assigning ages";
      await say({
        stage: "filing",
        detail,
        progress: { done: alreadyProcessed, total, failed: 0 },
      });
      for (const index of selected) {
        if (deps.signal?.aborted) throw new Error("The import worker lost its lease.");
        if (!ids && summaries.get(index)?.answered === 0) continue;
        const batch = await artifacts.read<Batch>(`batch-${index}`);
        if (!batch?.complete) throw new Error("A finished import batch is missing.");
        for (const [, answer] of batch.answers) {
          if (!answer.ok) continue;
          checkpointByTeam.set(answer.schedule.profile.id, index);
          if (ids && !ids.has(answer.schedule.profile.id)) continue;
          yield answer.schedule;
          processed++;
        }
        await say({
          stage: "filing",
          detail,
          progress: { done: alreadyProcessed + processed, total, failed: 0 },
        });
      }
    })();
  const result = await finishStagedImport(
    { kind: "list", entries: plan.entries, seasonYears: job.seasonYears },
    source,
    plan.copy,
    { asked, answered, failed },
    {
      store: deps.store,
      now,
      device: `import-${jobId}`,
      ...(deps.signal ? { signal: deps.signal } : {}),
      invalidIds,
      onOutcomes: async (outcomes) => {
        if (!deps.reports) return;
        await say({ detail: "Saving the skipped-team report" });
        const rows = filingProblems(outcomes);
        await deps.reports.filing(rows);
        filingRows = rows.length;
        await say(savedStatus());
      },
      onAgeProgress: async (pass, done, total) => {
        activeAge = { pass, done, total };
        agePass = pass;
        await say({
          stage: "filing",
          detail: `Assigning ages, pass ${pass}`,
          progress: { done, total, failed: 0 },
        });
      },
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
