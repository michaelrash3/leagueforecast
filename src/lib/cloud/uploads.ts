import { fetchValues } from "./cloudEngine";
import { chunkId, randomId } from "./cloudManifest";
import { hashJson, packHashed } from "./cloudPack";
import { isUploadId } from "./uploadId";

export { isUploadId };

/**
 * A file the copy's owner hands the server, staged where only the owner may write (1.6): a backup
 * of Team Rankings to restore, too big for a call's body. It is stored as the copy stores a part,
 * the value's JSON gzipped into pieces of at most `CHUNK_BYTES` and named `${id}-${n}`, beside a
 * record of its fingerprint, size and piece count, at `uploads/{id}` and `uploads/{id}/chunks`.
 * The server reads it back piece by piece and checks it against the fingerprint before it uses a
 * byte of it (`fetchValues`), then deletes it; the nightly deletes any a day old that nothing
 * used (`UPLOAD_MAX_AGE_MS`).
 */

export const UPLOADS = "uploads";

/** The record of upload `id`. */
export const uploadPath = (id: string): string => `${UPLOADS}/${id}`;

/** Where upload `id`'s pieces are, each named `${id}-${n}`. */
export const uploadChunksPath = (id: string): string => `${UPLOADS}/${id}/chunks`;

/** How long an upload nothing used is kept before the nightly deletes it. */
export const UPLOAD_MAX_AGE_MS = 24 * 60 * 60_000;

/** What an upload holds: so far, a Team Rankings backup alone. */
export type UploadKind = "team-rankings";

export type UploadRecord = {
  kind: UploadKind;
  /** SHA-256 of the value's JSON, which every piece read back is checked against. */
  hash: string;
  /** The JSON's size before compression. */
  bytes: number;
  chunks: number;
  createdAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** An upload's record as stored, or null for anything else. */
export const coerceUploadRecord = (raw: unknown): UploadRecord | null => {
  if (!isRecord(raw)) return null;
  const { kind, hash, bytes, chunks, createdAt } = raw;
  if (kind !== "team-rankings") return null;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
  if (!isCount(bytes) || !isCount(chunks) || chunks < 1) return null;
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
  return { kind, hash, bytes, chunks, createdAt };
};

/** A value packed to upload: its id, its record, and its pieces by name. */
export type PackedUpload = {
  id: string;
  record: UploadRecord;
  pieces: Array<{ id: string; data: Uint8Array<ArrayBuffer> }>;
};

export const packUpload = async (
  kind: UploadKind,
  value: unknown,
  createdAt: string
): Promise<PackedUpload> => {
  const hashed = await hashJson(value);
  const chunks = await packHashed(hashed);
  const id = randomId();
  return {
    id,
    record: { kind, hash: hashed.hash, bytes: hashed.bytes, chunks: chunks.length, createdAt },
    pieces: chunks.map((data, index) => ({ id: chunkId(id, index), data })),
  };
};

/** What the server reads an upload through. */
export type UploadReader = {
  /** Upload `id`'s record as stored, or null when there is none. */
  record: (id: string) => Promise<unknown>;
  /** One of upload `id`'s pieces by its name, or null when it is not there. */
  getChunk: (id: string, chunk: string) => Promise<Uint8Array | null>;
};

/** And what it takes them away through: once used, or once a day old and never used. */
export type UploadStore = UploadReader & {
  /** Deletes upload `id`: its pieces, then its record, so a record never names pieces gone. */
  remove: (id: string) => Promise<void>;
  /** Every upload, by id, with its record as stored. */
  list: () => Promise<Array<{ id: string; record: unknown }>>;
};

/** No uploads at all: what a server that reads none, or a test, hands over. */
export const NO_UPLOADS: UploadStore = {
  record: async () => null,
  getChunk: async () => null,
  remove: async () => undefined,
  list: async () => [],
};

/**
 * The uploads to delete at `now`: each a day old, or with a record this build cannot read, which
 * nothing will ever use. Ids only, so a sweep says how many it took and nothing of what they held.
 */
export const staleUploads = (
  uploads: ReadonlyArray<{ id: string; record: unknown }>,
  now: string
): string[] =>
  uploads.flatMap(({ id, record }) => {
    const read = coerceUploadRecord(record);
    if (!read) return [id];
    return Date.parse(now) - Date.parse(read.createdAt) >= UPLOAD_MAX_AGE_MS ? [id] : [];
  });

/**
 * What came of reading upload `id`: its value, checked against its fingerprint; or `missing` (no
 * such upload, a record this build cannot read, a piece not there, or another kind than asked
 * for) or `damaged` (pieces that do not make the value fingerprinted).
 */
export type UploadRead = { ok: true; value: unknown } | { ok: false; why: "missing" | "damaged" };

export const readUpload = async (
  reader: UploadReader,
  id: string,
  kind: UploadKind
): Promise<UploadRead> => {
  if (!isUploadId(id)) return { ok: false, why: "missing" };
  const record = coerceUploadRecord(await reader.record(id));
  if (!record || record.kind !== kind) return { ok: false, why: "missing" };
  const fetched = await fetchValues({
    store: { getChunk: (chunk) => reader.getChunk(id, chunk) },
    parts: [
      {
        key: "upload",
        hash: record.hash,
        bytes: record.bytes,
        chunks: record.chunks,
        id,
        at: 0,
        by: "",
      },
    ],
  });
  if (!fetched.ok) return { ok: false, why: fetched.reason === "damaged" ? "damaged" : "missing" };
  return { ok: true, value: fetched.values.get("upload") };
};

/**
 * Deletes the uploads stale at `now` (`staleUploads`), or only counts them where `write` is false
 * (a dry run). One that will not delete is left for the next night's sweep. Counts only, which is
 * all a public log may show.
 */
export const sweepStaleUploads = async (
  store: UploadStore,
  now: string,
  write: boolean
): Promise<{ stale: number; deleted: number }> => {
  const stale = staleUploads(await store.list(), now);
  if (!write) return { stale: stale.length, deleted: 0 };
  let deleted = 0;
  for (const id of stale) {
    try {
      await store.remove(id);
      deleted += 1;
    } catch {
      // Left for the next night's sweep.
    }
  }
  return { stale: stale.length, deleted };
};
