import type { LiveMeta, LiveStore } from "../live/viewStore";
import type { CloudStore } from "./cloudEngine";
import { coerceManifest, type CloudManifest } from "./cloudManifest";

/**
 * The cloud copy's documents through Firestore's REST API, for a job that runs outside a browser:
 * the nightly refresh on one of GitHub's servers (README, "The nightly refresh on GitHub"), and a
 * pasted list pulled by a Firebase function (README, "A pasted list, pulled in the cloud"). The
 * browser uses Firebase's own SDK (`firebaseCloud.ts`); this writes the same documents the same
 * way, so either reads what the other saved:
 * - `copies/main`: the manifest, its fields as the SDK sets them;
 * - `copies/main/chunks/{upload-n}`: each piece, `{ data: Bytes }`;
 * - `live/meta` and `live/meta/chunks/{upload-n}`: the views published for members to read
 *   (`viewStore.ts`), laid out the same way, which only a server writes.
 *
 * A service account's token is what it signs in with, which Firestore's rules do not apply to: the
 * key is the permission. The manifest is replaced only if it is still the document this read, which
 * is the REST form of the SDK's transaction (`commitManifest`): the commit carries the read
 * document's update time as a precondition, and Firestore refuses it if anything wrote the
 * document since.
 */

/** A value as Firestore's REST API writes it, one type tag to a value. */
export type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

const base64Of = (bytes: Uint8Array): string => {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
};

/** Firestore's typed JSON as plain values, bytes as bytes. */
export const plainOf = (value: FirestoreValue): unknown => {
  if (value.mapValue) return fieldsOf(value.mapValue.fields ?? {});
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(plainOf);
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.bytesValue !== undefined) return bytesOf(value.bytesValue);
  return null;
};

export const fieldsOf = (fields: Record<string, FirestoreValue>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, plainOf(value)]));

/**
 * A plain value as Firestore's typed JSON, the way the SDK types it: a safe integer as an integer,
 * any other number as a double, and a field whose value is undefined left out.
 */
export const firestoreValueOf = (value: unknown): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Uint8Array) return { bytesValue: base64Of(value) };
  if (Array.isArray(value)) {
    return value.length > 0
      ? { arrayValue: { values: value.map(firestoreValueOf) } }
      : { arrayValue: {} };
  }
  return { mapValue: { fields: firestoreFieldsOf(value as Record<string, unknown>) } };
};

export const firestoreFieldsOf = (
  record: Record<string, unknown>
): Record<string, FirestoreValue> =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, firestoreValueOf(value)])
  );

/** The manifest's fields as the app's SDK sets them (`firestoreStore`). */
const manifestFields = (next: CloudManifest): Record<string, FirestoreValue> =>
  firestoreFieldsOf({
    format: next.format,
    schema: next.schema,
    copy: next.copy,
    version: next.version,
    save: next.save,
    updatedAt: next.updatedAt,
    device: next.device,
    parts: next.parts.map((part) => ({ ...part })),
    kept: next.kept.map((part) => ({ ...part })),
  });

const MANIFEST = "copies/main";
const CHUNKS = "copies/main/chunks";
const LIVE_META = "live/meta";
const LIVE_CHUNKS = "live/meta/chunks";

/** Thrown for a Firestore answer that is neither the document nor its absence. */
export class FirestoreError extends Error {
  // A plain field, not a constructor parameter property: Node runs the scripts that use this by
  // stripping types, which cannot turn a parameter property into an assignment.
  readonly status: number;
  constructor(status: number, what: string) {
    super(`Firestore answered HTTP ${status} ${what}.`);
    this.name = "FirestoreError";
    this.status = status;
  }
}

type RestAccess = {
  projectId: string;
  /** Asked for each request, so a job longer than a token's hour can hand a new one. */
  token: () => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Where Firestore answers: its own address, unless a test points this at the emulator. */
  origin?: string;
};

/** Requests to `projectId`'s default database, signed with `token`. */
const restClient = ({
  projectId,
  token,
  fetchImpl = fetch,
  origin = "https://firestore.googleapis.com",
}: RestAccess) => {
  const database = `projects/${projectId}/databases/(default)`;
  const documents = `${origin}/v1/${database}/documents`;
  const call = async (url: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(url, {
      ...init,
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  const read = async (path: string): Promise<FirestoreDocument | null> => {
    const response = await call(`${documents}/${path}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new FirestoreError(response.status, `reading ${path}`);
    return (await response.json()) as FirestoreDocument;
  };
  /**
   * Writes `fields` as the whole of the document at `path`, only if `precondition` still holds:
   * the update time it was read at, or that there is none. Says whether it did. The precondition
   * failing is another writer's save; any other refusal is a fault, and thrown.
   */
  const commit = async (
    path: string,
    fields: Record<string, FirestoreValue>,
    precondition: { updateTime: string } | { exists: false },
    what: string
  ): Promise<boolean> => {
    const response = await call(`${documents}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: [
          {
            update: { name: `${database}/documents/${path}`, fields },
            currentDocument: precondition,
          },
        ],
      }),
    });
    if (response.ok) return true;
    const answer = (await response.json().catch(() => null)) as {
      error?: { status?: string };
    } | null;
    const why = answer?.error?.status;
    if (why === "FAILED_PRECONDITION" || why === "ALREADY_EXISTS") return false;
    throw new FirestoreError(response.status, what);
  };
  return { database, documents, call, read, commit };
};

const refuseWrite = () => Promise.reject(new Error("This store was opened to read, not to write."));

/** The pieces kept under `collection`, each a document `{ data: Bytes }` named by its id. */
const pieceCalls = (
  client: ReturnType<typeof restClient>,
  collection: string,
  writable: boolean
) => {
  const { documents, call, read } = client;
  const piecePath = (id: string) => `${collection}/${encodeURIComponent(id)}`;
  return {
    putChunk: !writable
      ? refuseWrite
      : async (id: string, data: Uint8Array<ArrayBuffer>) => {
          const response = await call(`${documents}/${piecePath(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ fields: { data: { bytesValue: base64Of(data) } } }),
          });
          if (!response.ok) throw new FirestoreError(response.status, `writing piece ${id}`);
        },
    getChunk: async (id: string) => {
      const found = await read(piecePath(id));
      const data = found?.fields?.data;
      return data?.bytesValue !== undefined ? bytesOf(data.bytesValue) : null;
    },
    deleteChunk: !writable
      ? refuseWrite
      : async (id: string) => {
          const response = await call(`${documents}/${piecePath(id)}`, { method: "DELETE" });
          if (!response.ok && response.status !== 404) {
            throw new FirestoreError(response.status, `deleting piece ${id}`);
          }
        },
  };
};

/**
 * Any document by its path, for what is not the copy itself: a pull a device left for the cloud to
 * run (`pullJobs.ts`). Its fields as plain values, bytes as bytes.
 */
export type FirestoreRestDocuments = {
  read: (path: string) => Promise<Record<string, unknown> | null>;
  /**
   * Sets the fields `patch` names and leaves the rest, on a document that must already be there:
   * a pull deleted from the console is not made again by the job still running it.
   */
  update: (path: string, patch: Record<string, unknown>) => Promise<void>;
  /**
   * The document's fields, with the token `replace` takes to write it only if nothing has since:
   * its update time. Null where there is no document.
   */
  readAt: (path: string) => Promise<{ fields: Record<string, unknown>; token: string } | null>;
  /**
   * Writes `fields` as the whole document, only if it is still as `readAt` found it: at `token`,
   * or still absent where `token` is null. Says whether it did; false is another writer's save.
   */
  replace: (
    path: string,
    fields: Record<string, unknown>,
    token: string | null
  ) => Promise<boolean>;
};

export const firestoreRestDocuments = (access: RestAccess): FirestoreRestDocuments => {
  const { documents, call, read, commit } = restClient(access);
  return {
    read: async (path) => {
      const found = await read(path);
      return found ? fieldsOf(found.fields ?? {}) : null;
    },
    readAt: async (path) => {
      const found = await read(path);
      if (!found) return null;
      if (!found.updateTime) throw new FirestoreError(200, `reading ${path} with no update time`);
      return { fields: fieldsOf(found.fields ?? {}), token: found.updateTime };
    },
    replace: (path, fields, token) =>
      commit(
        path,
        firestoreFieldsOf(fields),
        token === null ? { exists: false } : { updateTime: token },
        `replacing ${path}`
      ),
    update: async (path, patch) => {
      const mask = Object.keys(patch)
        .filter((name) => patch[name] !== undefined)
        .map((name) => `updateMask.fieldPaths=${encodeURIComponent(name)}`);
      const response = await call(
        `${documents}/${path}?${[...mask, "currentDocument.exists=true"].join("&")}`,
        { method: "PATCH", body: JSON.stringify({ fields: firestoreFieldsOf(patch) }) }
      );
      if (!response.ok) throw new FirestoreError(response.status, `updating ${path}`);
    },
  };
};

/**
 * The copy's store through the REST API of `projectId`'s default database. Read only unless
 * `writable`: then the write calls reject, which a pull that saves nothing never makes.
 */
export const firestoreRestStore = ({
  writable,
  ...access
}: RestAccess & { writable: boolean }): CloudStore => {
  const client = restClient(access);
  const { read, commit } = client;
  return {
    readManifest: async () => {
      const found = await read(MANIFEST);
      if (!found) return null;
      const manifest = coerceManifest(fieldsOf(found.fields ?? {}));
      if (!manifest) throw new Error("The cloud copy's manifest is not one this build can read.");
      return manifest;
    },
    commitManifest: !writable
      ? refuseWrite
      : async (expected, next) => {
          const found = await read(MANIFEST);
          if (expected === null) {
            if (found) return false;
          } else {
            const current = found ? coerceManifest(fieldsOf(found.fields ?? {})) : null;
            if (current?.version !== expected.version || current.copy !== expected.copy) {
              return false;
            }
          }
          return commit(
            MANIFEST,
            manifestFields(next),
            found?.updateTime !== undefined ? { updateTime: found.updateTime } : { exists: false },
            "saving the manifest"
          );
        },
    ...pieceCalls(client, CHUNKS, writable),
  };
};

/**
 * `live/` through the REST API of `projectId`'s default database, for the server that publishes
 * the views (`publishViews`). The meta's token is its update time, the commit's precondition, as
 * the copy's manifest is replaced. Read only unless `writable`.
 */
export const firestoreRestLive = ({
  writable,
  ...access
}: RestAccess & { writable: boolean }): LiveStore => {
  const client = restClient(access);
  const { documents, call, read, commit } = client;
  return {
    readMeta: async () => {
      const found = await read(LIVE_META);
      return found ? { meta: fieldsOf(found.fields ?? {}), token: found.updateTime ?? "" } : null;
    },
    commitMeta: !writable
      ? refuseWrite
      : (token: string | null, next: LiveMeta) =>
          commit(
            LIVE_META,
            firestoreFieldsOf(next),
            token !== null ? { updateTime: token } : { exists: false },
            "saving the views' meta"
          ),
    ...pieceCalls(client, LIVE_CHUNKS, writable),
    listChunks: async () => {
      // Names and times only: a mask naming no field Firestore holds leaves every piece's data out.
      const pieces: Array<{ id: string; createdAt: string }> = [];
      let page: string | undefined;
      do {
        const query = ["pageSize=300", "mask.fieldPaths=none"];
        if (page) query.push(`pageToken=${encodeURIComponent(page)}`);
        const response = await call(`${documents}/${LIVE_CHUNKS}?${query.join("&")}`);
        if (!response.ok) throw new FirestoreError(response.status, "listing the views' pieces");
        const answer = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        for (const found of answer.documents ?? []) {
          const id = found.name?.split("/").pop();
          if (id && found.createTime)
            pieces.push({ id: decodeURIComponent(id), createdAt: found.createTime });
        }
        page = answer.nextPageToken;
      } while (page);
      return pieces;
    },
  };
};
