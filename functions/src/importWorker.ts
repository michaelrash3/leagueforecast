import { parentPort, workerData } from "node:worker_threads";
import { handlerFetch } from "../../scripts/handlerFetch";
import { firestoreRestDocuments, firestoreRestStore } from "../../src/lib/cloud/firestoreRest";
import { restJobDocs } from "../../src/lib/cloud/pullJobRunner";
import { restImportArtifacts, runStagedImport } from "../../src/lib/cloud/stagedImport";
import { restImportReports } from "../../src/lib/cloud/importReports";
import { fetchGcTeams } from "../../src/lib/gameChangerClient";
import { restLeagueDocs } from "../../src/lib/live/cloudLeague";
import { resetTeamRankingsStore } from "../../src/lib/teamRankingsStorage";
import { restAccess } from "./pullAccess";

const { jobId } = workerData as { jobId: string };
const access = restAccess();
const docs = firestoreRestDocuments(access);
try {
  await runStagedImport(jobId, {
    jobs: restJobDocs(docs),
    artifacts: restImportArtifacts(docs, jobId),
    reports: restImportReports(docs, jobId),
    store: firestoreRestStore({ ...access, writable: true }),
    fetchTeams: (ids, options) => fetchGcTeams(ids, { ...options, fetchImpl: handlerFetch() }),
    now: () => new Date(),
    // The import pulls again, and the final tidy keeps, every club a League Standings team links,
    // read as the boards read it.
    leagueDocs: restLeagueDocs(docs),
    onProgress: (detail) =>
      parentPort?.postMessage({ progress: true, ...(detail ? { detail } : {}) }),
    // Counts and reasons alone (`ImportDownloadReport`): the public pull-status workflow reads
    // this log back, and the teams themselves are in the members-only skipped-team report.
    onDownloadReport: (report) =>
      console.warn(
        JSON.stringify({ severity: "WARNING", event: "import-download-failures", jobId, ...report })
      ),
  });
  parentPort?.postMessage({ done: true });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
} finally {
  resetTeamRankingsStore();
}
