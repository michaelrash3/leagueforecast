import { gcTeamPageUrl, type GcTeamResponse } from "../gameChangerApi";
import type { GcImportOutcome } from "../gameChangerImport";
import {
  GC_FETCH_REASON_LABEL,
  gcImportProblemsCsv,
  type GcImportProblem,
} from "../gameChangerReport";
import { hashJson, packHashed, unpackChunks } from "./cloudPack";
import type { FirestoreRestDocuments } from "./firestoreRest";

type Group = "download" | "filing";
type Part = { id: string; hash: string; pieces: number; rows: number };
type Manifest = { format: 1; parts: Part[] };
export const importReportPath = (jobId: string, group: Group) =>
  `pullJobs/${jobId}/reports/${group}`;
export const importReportChunkPath = (jobId: string, id: string) =>
  `pullJobs/${jobId}/reportChunks/${id}`;

const manifestOf = (raw: Record<string, unknown> | null): Manifest => {
  if (!raw) return { format: 1, parts: [] };
  if (
    raw.format !== 1 ||
    !Array.isArray(raw.parts) ||
    !raw.parts.every((p: unknown) => {
      const part = p as Partial<Part> | null;
      return (
        part &&
        typeof part.id === "string" &&
        /^(download|filing)-\d+$/.test(part.id) &&
        typeof part.hash === "string" &&
        /^[0-9a-f]{64}$/.test(part.hash) &&
        Number.isSafeInteger(part.pieces) &&
        Number(part.pieces) > 0 &&
        Number.isSafeInteger(part.rows) &&
        Number(part.rows) > 0
      );
    })
  )
    throw new Error("The skipped-team report is damaged.");
  return { format: 1, parts: raw.parts as Part[] };
};

/** The report contains only skipped-team details, never raw schedules or request headers. */
export const downloadProblems = (
  answers: readonly [string, GcTeamResponse][],
  names: ReadonlyMap<string, string>
): GcImportProblem[] =>
  answers.flatMap(([teamId, answer]) =>
    answer.ok
      ? []
      : [
          {
            teamId,
            teamName: names.get(teamId),
            kind: "not-reached" as const,
            reason: GC_FETCH_REASON_LABEL[answer.reason],
            detail: answer.message.slice(0, 500),
            url: gcTeamPageUrl(teamId),
          },
        ]
  );

export const filingProblems = (
  outcomes: readonly Pick<GcImportOutcome, "gcTeamId" | "teamName" | "skip" | "issue">[]
): GcImportProblem[] =>
  outcomes.flatMap((outcome) =>
    outcome.skip
      ? [
          {
            teamId: outcome.gcTeamId,
            teamName: outcome.teamName,
            kind: "not-filed" as const,
            reason: outcome.skip.replace(/-/g, " "),
            detail: (outcome.issue ?? outcome.skip).slice(0, 500),
            url: gcTeamPageUrl(outcome.gcTeamId),
          },
        ]
      : []
  );

export type ImportReportWriter = {
  download: (checkpoint: number, rows: readonly GcImportProblem[]) => Promise<void>;
  filing: (rows: readonly GcImportProblem[]) => Promise<void>;
};

/** Immutable chunks first, group manifest last. Reports survive staging cleanup. */
export const restImportReports = (
  docs: Pick<FirestoreRestDocuments, "read" | "set">,
  jobId: string
): ImportReportWriter => {
  const manifests = new Map<Group, Manifest>();
  const load = async (group: Group) => {
    let current = manifests.get(group);
    if (!current) {
      current = manifestOf(await docs.read(importReportPath(jobId, group)));
      manifests.set(group, current);
    }
    return current;
  };
  const part = async (
    id: string,
    rows: readonly GcImportProblem[],
    current: Manifest
  ): Promise<Part | null> => {
    if (rows.length === 0) return null;
    const hashed = await hashJson(rows);
    const previous = current.parts.find((p) => p.id === id);
    if (previous?.hash === hashed.hash) return previous;
    const chunks = await packHashed(hashed);
    for (const [i, data] of chunks.entries())
      await docs.set(importReportChunkPath(jobId, `${id}-${hashed.hash}-${i}`), { data });
    return { id, hash: hashed.hash, pieces: chunks.length, rows: rows.length };
  };
  const publish = async (group: Group, parts: Part[], current: Manifest) => {
    const next: Manifest = { format: 1, parts };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await docs.set(importReportPath(jobId, group), next);
    manifests.set(group, next);
  };
  return {
    download: async (checkpoint, rows) => {
      const current = await load("download");
      const id = `download-${checkpoint}`;
      const next = await part(id, rows, current);
      await publish(
        "download",
        [...current.parts.filter((p) => p.id !== id), ...(next ? [next] : [])],
        current
      );
    },
    filing: async (rows) => {
      const current = await load("filing");
      const parts: Part[] = [];
      for (let at = 0; at < rows.length; at += 2000) {
        const next = await part(`filing-${at / 2000}`, rows.slice(at, at + 2000), current);
        if (next) parts.push(next);
      }
      await publish("filing", parts, current);
    },
  };
};

const problemsOf = (raw: unknown, count: number): GcImportProblem[] => {
  if (!Array.isArray(raw) || raw.length !== count)
    throw new Error("The skipped-team report is incomplete.");
  return raw.map((value: unknown) => {
    const row = value as Partial<GcImportProblem> | null;
    if (
      !row ||
      typeof row.teamId !== "string" ||
      typeof row.reason !== "string" ||
      typeof row.detail !== "string" ||
      !["not-reached", "not-filed", "check-id"].includes(row.kind ?? "") ||
      !(row.teamName === undefined || typeof row.teamName === "string")
    )
      throw new Error("The skipped-team report contains an unreadable row.");
    return {
      teamId: row.teamId,
      teamName: row.teamName,
      reason: row.reason,
      detail: row.detail,
      kind: row.kind as GcImportProblem["kind"],
      url: gcTeamPageUrl(row.teamId),
    };
  });
};

/** Return CSV pieces so a phone need not build one giant string or keep all report rows. */
export const readImportReportCsv = async (
  read: FirestoreRestDocuments["read"],
  jobId: string,
  expectedRows = 0
): Promise<string[]> => {
  const csv = [gcImportProblemsCsv([])];
  let count = 0;
  for (const group of ["download", "filing"] as const) {
    const manifest = manifestOf(await read(importReportPath(jobId, group)));
    for (const part of manifest.parts.sort(
      (a, b) => Number(a.id.split("-")[1]) - Number(b.id.split("-")[1])
    )) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < part.pieces; i++) {
        const chunk = await read(importReportChunkPath(jobId, `${part.id}-${part.hash}-${i}`));
        if (!(chunk?.data instanceof Uint8Array))
          throw new Error("A skipped-team report piece is missing.");
        chunks.push(chunk.data);
      }
      const rows = problemsOf(await unpackChunks(chunks, part.hash), part.rows);
      count += rows.length;
      csv.push(gcImportProblemsCsv(rows).slice(csv[0]!.length));
    }
  }
  if (count < expectedRows) throw new Error("The skipped-team report is incomplete.");
  return csv;
};
