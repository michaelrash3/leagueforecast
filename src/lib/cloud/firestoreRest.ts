import type { LiveMeta, LiveStore } from "../live/viewStore";
import type { CloudStore } from "./cloudEngine";
import { coerceManifest, UnreadableCopyError, type CloudManifest } from "./cloudManifest";
import { UPLOADS, uploadChunksPath, uploadPath, type UploadStore } from "./uploads";

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
 * What Firestore refuses to store, found before it is sent: a list directly inside another list,
 * and a number that is not finite, which JSON cannot carry (`JSON.stringify` writes it as null, and
 * a `doubleValue` of null is refused). Firestore answers either with an HTTP 400 that names
 * neither; this names the field, by the names of the fields and the places in lists that lead to
 * it, never by any value.
 */
export class UnstorableValueError extends Error {
  constructor(at: string, why: string) {
    super(`Firestore cannot store ${at}: ${why}.`);
    this.name = "UnstorableValueError";
  }
}

const valueAt = (value: unknown, at: string, inList: boolean): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UnstorableValueError(at, "it is not a finite number");
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value instanceof Uint8Array) return { bytesValue: base64Of(value) };
  if (Array.isArray(value)) {
    if (inList) throw new UnstorableValueError(at, "it is a list directly inside another list");
    return value.length > 0
      ? {
          arrayValue: {
            values: value.map((item, index) => valueAt(item, `${at}[${index}]`, true)),
          },
        }
      : { arrayValue: {} };
  }
  return { mapValue: { fields: fieldsAt(value as Record<string, unknown>, at) } };
};

const fieldsAt = (record: Record<string, unknown>, at: string): Record<string, FirestoreValue> =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, valueAt(value, at ? `${at}.${name}` : name, false)])
  );

/**
 * A plain value as Firestore's typed JSON, the way the SDK types it: a safe integer as an integer,
 * any other number as a double, and a field whose value is undefined left out. Throws an
 * `UnstorableValueError` on anything Firestore would refuse to store.
 */
export const firestoreValueOf = (value: unknown): FirestoreValue =>
  valueAt(value, "the value", false);

export const firestoreFieldsOf = (
  record: Record<string, unknown>
): Record<string, FirestoreValue> => fieldsAt(record, "");

/** The manifest's fields as the app's SDK sets them (`firestoreStore`). */
const manifestFields = (next: CloudManifest): Record<string, FirestoreValue> =>
  firestoreFieldsOf({
    format: next.format,
    schema: next.schema,
    copy: next.copy,
    epoch: next.epoch,
    version: next.version,
    save: next.save,
    updatedAt: next.updatedAt,
    device: next.device,
    parts: next.parts.map((part) => ({ ...part })),
    kept: next.kept.map((part) => ({ ...part })),
  });

/** The copy's manifest, as a document. */
export const MANIFEST_PATH = "copies/main";
const MANIFEST = MANIFEST_PATH;
const CHUNKS = "copies/main/chunks";
const LIVE_META = "live/meta";
const LIVE_CHUNKS = "live/meta/chunks";

/** Thrown for a Firestore answer that is neither the document nor its absence. */
export class FirestoreError extends Error {
  // A plain field, not a constructor parameter property: Node runs the scripts that use this by
  // stripping types, which cannot turn a parameter property into an assignment.
  readonly status: number;
  /**
   * `said` is Firestore's own account of a refusal (`saidOf`), which names what it refused: the 9
   * and 10 October 2026 failures to save the views' meta said only "HTTP 400" until it was kept.
   */
  constructor(status: number, what: string, said?: string) {
    super(`Firestore answered HTTP ${status} ${what}.${said ? ` It said: ${said}` : ""}`);
    this.name = "FirestoreError";
    this.status = status;
  }
}

/**
 * What Firestore said of a refusal, from its error's status and message, on one line and cut short,
 * or undefined when it said nothing readable. Its messages name a request's fields and limits, not
 * what they hold, so they are fit for the nightly's public log.
 */
const saidOf = (answer: unknown): string | undefined => {
  const error = (answer as { error?: { status?: unknown; message?: unknown } } | null)?.error;
  const parts = [error?.status, error?.message].filter(
    (part): part is string => typeof part === "string" && part.trim() !== ""
  );
  if (parts.length === 0) return undefined;
  const said = parts.join(": ").replace(/\s+/g, " ").trim();
  return said.length > 300 ? `${said.slice(0, 299)}…` : said;
};

/** A refusal Firestore answered `response` with, saying what it said (`saidOf`). */
const refusalOf = async (response: Response, what: string): Promise<FirestoreError> =>
  new FirestoreError(response.status, what, saidOf(await response.json().catch(() => null)));

/**
 * The code a failure of the network carries, on the error or on what it was caused by: Node's fetch
 * throws "fetch failed", which says nothing of why, and keeps the why on its `cause` (`ECONNRESET`,
 * `ENOTFOUND`, `UND_ERR_SOCKET`). Undefined where there is none.
 */
export const networkCodeOf = (error: unknown): string | undefined => {
  let at: unknown = error;
  for (let depth = 0; depth < 4 && typeof at === "object" && at !== null; depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) return code;
    at = (at as { cause?: unknown }).cause;
  }
  return undefined;
};

/**
 * An error as a public log may say it: its message, with the network's code after it where the
 * message does not already say it. "Publishing the views stopped: fetch failed" was all the nightly
 * of 14 October 2026 said of why, about nine minutes into its publish.
 */
export const failureWords = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = networkCodeOf(error);
  return code !== undefined && !message.includes(code) ? `${message} (${code})` : message;
};

/**
 * What a request does, which decides whether it may be asked again once it failed, and is what a
 * log names it by: never by its document's path or a piece's id.
 * - `read`, `list`, `query`: reads, which asked again read again.
 * - `write`: a document written whole, or the fields it names set (a `PATCH`), and `delete`: done
 *   twice, either leaves Firestore as done once, and as a first try whose answer came late would.
 *   A piece is written under an upload id nothing else writes under (`viewStore.ts`), and a second
 *   delete finds nothing, which counts as deleted.
 * - `commit`: a write made only where its precondition holds (the update time it was read at, or
 *   that there is none). Asked again after the first was done, it is refused by the first's own
 *   write, which its caller reads as another writer's save, so it is asked again only where the
 *   first is known to have been done nothing with.
 */
export type RequestKind = "read" | "list" | "query" | "write" | "delete" | "commit";

/**
 * Thrown where the network failed a request, on its last try or on one that may not be asked again
 * (`RequestKind`): what the request was doing, in words with no path or id in them, and the
 * network's code, so the log says which and why. The error the network threw is its `cause`.
 */
export class FirestoreUnreachableError extends Error {
  // Plain fields, as `FirestoreError`'s: Node runs the scripts that use this by stripping types.
  readonly code: string | undefined;
  readonly tries: number;
  readonly cause: unknown;
  constructor(what: string, cause: unknown, tries: number) {
    const code = networkCodeOf(cause);
    super(
      `The network failed ${what} (${code ?? "it gave no code"})${tries > 1 ? `, the last of ${tries} tries` : ""}.`
    );
    this.name = "FirestoreUnreachableError";
    this.code = code;
    this.tries = tries;
    this.cause = cause;
  }
}

/**
 * Whether an error is the network's rather than the code's: what `fetch` throws when it gets no
 * answer, or an answer cut off, is a `TypeError` ("fetch failed", "terminated"), and Node's carries
 * a code beside it.
 */
const isNetworkFailure = (error: unknown): boolean =>
  error instanceof TypeError || networkCodeOf(error) !== undefined;

/**
 * Codes that say a request never left this machine: no address for Firestore's host, or no
 * connection to it. A reset, a socket closed under it or no answer in time can each come after
 * Firestore did the request, so none of them is here.
 */
const NEVER_SENT: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Statuses that answer no body (`new Response` refuses one for them). */
const NO_BODY: ReadonlySet<number> = new Set([204, 205, 304]);

export type RestAccess = {
  projectId: string;
  /** Asked for each request, so a job longer than a token's hour can hand a new one. */
  token: () => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Where Firestore answers: its own address, unless a test points this at the emulator. */
  origin?: string;
  /** Waits before a request is asked again (`RETRY_WAITS_MS`); a test's need not wait. */
  pause?: (ms: number) => Promise<void>;
};

/**
 * How long to wait before asking a request again, once per wait, 63 s in all. The nightly of 5 Oct
 * 2026 stopped on Firestore's HTTP 429 writing the fourth piece of its first part (pieces go four
 * at a time, `inBatches`), and lost the night's refresh: a refusal for load, which the three nights
 * after did not meet saving the same number of values. The nightly of 14 Oct 2026 stopped on a
 * failure of the network about nine minutes into publishing the views, and lost the night's boards;
 * the last wait, 32 s, is for a failure that lasts a little longer than a moment, which 31 s of
 * waits in all would have given up on.
 */
export const RETRY_WAITS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];

/**
 * Answers that say Firestore, or Google's front end before it, could not do a request just now:
 * an internal error, a bad gateway, unavailable, and a gateway that timed out.
 */
const NOT_NOW: ReadonlySet<number> = new Set([500, 502, 503, 504]);

/**
 * Whether an answer may be asked again: too many requests (429) is refused before anything is done,
 * so any request; the answers of `NOT_NOW` may come after a write was done, so only a request that
 * does the same thing however often it is made, never a commit (`RequestKind`).
 */
const askAgain = (status: number, kind: RequestKind): boolean =>
  status === 429 || (kind !== "commit" && NOT_NOW.has(status));

/**
 * Whether a request whose fetch threw may be asked again: a failure of the network, for any request
 * but a commit, and for a commit only where it never left this machine (`NEVER_SENT`).
 */
const sendAgain = (error: unknown, kind: RequestKind): boolean =>
  isNetworkFailure(error) && (kind !== "commit" || NEVER_SENT.has(networkCodeOf(error) ?? ""));

/** What a request was doing, in the words its failure is said in. */
const DOING: Record<RequestKind, string> = {
  read: "reading a document",
  list: "listing a collection",
  query: "querying a collection",
  write: "writing a document",
  delete: "deleting a document",
  commit: "committing a write",
};

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Requests to `projectId`'s default database, signed with `token`. */
const restClient = ({
  projectId,
  token,
  fetchImpl = fetch,
  origin = "https://firestore.googleapis.com",
  pause = wait,
}: RestAccess) => {
  const database = `projects/${projectId}/databases/(default)`;
  const documents = `${origin}/v1/${database}/documents`;
  /**
   * `url` asked, as `kind`, and its answer read to its end: asked again after each of
   * `RETRY_WAITS_MS` where `askAgain` or `sendAgain` lets it, and where its answer is cut off
   * before its end for any request but a commit. A sign-in the network failed is asked again
   * whatever the request, since nothing was sent. The answer is handed back whole, so its caller
   * reads it with nothing left to fail on the way.
   */
  const call = async (
    url: string,
    kind: RequestKind,
    init: RequestInit = {},
    doing: string = DOING[kind]
  ): Promise<Response> => {
    for (let tries = 1; ; tries += 1) {
      const before = RETRY_WAITS_MS[tries - 1];
      let bearer: string;
      try {
        bearer = await token();
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        if (before === undefined) {
          throw new FirestoreUnreachableError("signing in to Google", error, tries);
        }
        await pause(before);
        continue;
      }
      let response: Response;
      try {
        response = await fetchImpl(url, {
          ...init,
          headers: {
            authorization: `Bearer ${bearer}`,
            ...(init.body ? { "content-type": "application/json" } : {}),
          },
        });
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        if (before === undefined || !sendAgain(error, kind)) {
          throw new FirestoreUnreachableError(doing, error, tries);
        }
        await pause(before);
        continue;
      }
      if (before !== undefined && askAgain(response.status, kind)) {
        // Read to its end, so the connection is free for the next try.
        await response.arrayBuffer().catch(() => undefined);
        await pause(before);
        continue;
      }
      let body: ArrayBuffer;
      try {
        body = await response.arrayBuffer();
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        // A commit's status says whether it was done, which is all its caller reads of one that
        // was; asked again, it would be refused by its own write.
        if (kind === "commit" && response.ok) {
          return new Response(null, { status: response.status, headers: response.headers });
        }
        if (before === undefined || kind === "commit") {
          throw new FirestoreUnreachableError(doing, error, tries);
        }
        await pause(before);
        continue;
      }
      return new Response(NO_BODY.has(response.status) ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
  };
  const read = async (path: string, doing = DOING.read): Promise<FirestoreDocument | null> => {
    const response = await call(`${documents}/${path}`, "read", {}, doing);
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
    const response = await call(`${documents}:commit`, "commit", {
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
    const answer: unknown = await response.json().catch(() => null);
    const why = (answer as { error?: { status?: unknown } } | null)?.error?.status;
    if (why === "FAILED_PRECONDITION" || why === "ALREADY_EXISTS") return false;
    throw new FirestoreError(response.status, what, saidOf(answer));
  };
  return { database, documents, call, read, commit };
};

const refuseWrite = () => Promise.reject(new Error("This store was opened to read, not to write."));

/**
 * Every document of `collection` by name and by when Firestore made it, page by page, and nothing
 * else: a mask naming no field Firestore holds leaves every piece's data out, which listed whole
 * would download the lot to learn its names.
 */
const namesAndTimes = async (
  client: ReturnType<typeof restClient>,
  collection: string,
  what: string
): Promise<Array<{ id: string; createdAt: string }>> => {
  const { documents, call } = client;
  const found: Array<{ id: string; createdAt: string }> = [];
  let page: string | undefined;
  do {
    const query = ["pageSize=300", "mask.fieldPaths=none"];
    if (page) query.push(`pageToken=${encodeURIComponent(page)}`);
    const response = await call(
      `${documents}/${collection}?${query.join("&")}`,
      "list",
      {},
      `listing ${what}`
    );
    if (!response.ok) throw new FirestoreError(response.status, `listing ${what}`);
    const answer = (await response.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    for (const one of answer.documents ?? []) {
      const id = one.name?.split("/").pop();
      if (id && one.createTime)
        found.push({ id: decodeURIComponent(id), createdAt: one.createTime });
    }
    page = answer.nextPageToken;
  } while (page);
  return found;
};

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
          const response = await call(
            `${documents}/${piecePath(id)}`,
            "write",
            {
              method: "PATCH",
              body: JSON.stringify({ fields: { data: { bytesValue: base64Of(data) } } }),
            },
            "writing a piece"
          );
          if (!response.ok) throw await refusalOf(response, `writing piece ${id}`);
        },
    getChunk: async (id: string) => {
      const found = await read(piecePath(id), "reading a piece");
      const data = found?.fields?.data;
      return data?.bytesValue !== undefined ? bytesOf(data.bytesValue) : null;
    },
    deleteChunk: !writable
      ? refuseWrite
      : async (id: string) => {
          const response = await call(
            `${documents}/${piecePath(id)}`,
            "delete",
            { method: "DELETE" },
            "deleting a piece"
          );
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
  /**
   * Every document of `collection`, with its id and its fields as plain values, page by page: the
   * League Standings seasons (`league/{season}`), a handful of documents of 10 to 70 KB each, which
   * a server reads whole to build the boards with.
   */
  list: (collection: string) => Promise<Array<{ id: string; fields: Record<string, unknown> }>>;
  /**
   * The documents of `collection` whose field `field` holds one of `values` (at most 30), with
   * their ids and fields as plain values, in one query: the pulls still queued or running
   * (`pullJobs`), which the catch-up between nights finds by their status rather than by listing
   * every pull there has been (`catchUp.ts`). Firestore counts a read for each document found, and
   * one where none is.
   */
  where: (
    collection: string,
    field: string,
    values: readonly string[]
  ) => Promise<Array<{ id: string; fields: Record<string, unknown> }>>;
  /**
   * Writes `fields` as the whole document at `path`, made or replaced, whatever was there: a piece
   * of the list a "Refresh now" job works out (`pullJobRunner.ts`), which a first leg tried again
   * writes over whatever the try before it left.
   */
  set: (path: string, fields: Record<string, unknown>) => Promise<void>;
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
    list: async (collection) => {
      const found: Array<{ id: string; fields: Record<string, unknown> }> = [];
      let page: string | undefined;
      do {
        const query = ["pageSize=100"];
        if (page) query.push(`pageToken=${encodeURIComponent(page)}`);
        const response = await call(`${documents}/${collection}?${query.join("&")}`, "list");
        if (!response.ok) throw new FirestoreError(response.status, `listing ${collection}`);
        const answer = (await response.json()) as {
          documents?: FirestoreDocument[];
          nextPageToken?: string;
        };
        for (const one of answer.documents ?? []) {
          const id = one.name?.split("/").pop();
          if (id) found.push({ id: decodeURIComponent(id), fields: fieldsOf(one.fields ?? {}) });
        }
        page = answer.nextPageToken;
      } while (page);
      return found;
    },
    where: async (collection, field, values) => {
      // A query is asked of the collection's parent: the database's documents, or a document.
      const cut = collection.lastIndexOf("/");
      const parent = cut < 0 ? documents : `${documents}/${collection.slice(0, cut)}`;
      const response = await call(`${parent}:runQuery`, "query", {
        method: "POST",
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collection.slice(cut + 1) }],
            where: {
              fieldFilter: {
                field: { fieldPath: field },
                op: "IN",
                value: firestoreValueOf([...values]),
              },
            },
          },
        }),
      });
      if (!response.ok) throw await refusalOf(response, `querying ${collection}`);
      // One answer for each document found, and one with no document where none was.
      const answers = (await response.json()) as Array<{ document?: FirestoreDocument }>;
      return answers.flatMap(({ document }) => {
        const id = document?.name?.split("/").pop();
        return id ? [{ id: decodeURIComponent(id), fields: fieldsOf(document?.fields ?? {}) }] : [];
      });
    },
    update: async (path, patch) => {
      const mask = Object.keys(patch)
        .filter((name) => patch[name] !== undefined)
        .map((name) => `updateMask.fieldPaths=${encodeURIComponent(name)}`);
      const response = await call(
        `${documents}/${path}?${[...mask, "currentDocument.exists=true"].join("&")}`,
        "write",
        { method: "PATCH", body: JSON.stringify({ fields: firestoreFieldsOf(patch) }) }
      );
      if (!response.ok) throw await refusalOf(response, `updating ${path}`);
    },
    set: async (path, fields) => {
      // No mask and no precondition: the whole document, made or replaced, as a piece is written.
      const response = await call(`${documents}/${path}`, "write", {
        method: "PATCH",
        body: JSON.stringify({ fields: firestoreFieldsOf(fields) }),
      });
      if (!response.ok) throw await refusalOf(response, `writing ${path}`);
    },
  };
};

/**
 * What the copy's owner staged for the server (`uploads.ts`), through the REST API: read by the
 * edit function, and deleted by it once used, or by the nightly once a day old. The server's
 * account, which the rules do not apply to, is the only reader there is besides the owner. Read
 * only unless `writable`, as the nightly's dry run opens it.
 */
export const firestoreRestUploads = ({
  writable,
  ...access
}: RestAccess & { writable: boolean }): UploadStore => {
  const client = restClient(access);
  const { documents, call, read } = client;
  const record = async (id: string) => {
    const found = await read(uploadPath(id));
    return found ? fieldsOf(found.fields ?? {}) : null;
  };
  return {
    record,
    getChunk: (id, chunk) => pieceCalls(client, uploadChunksPath(id), false).getChunk(chunk),
    remove: !writable
      ? refuseWrite
      : async (id) => {
          // Every piece there is, listed by name rather than counted off the record: Firestore
          // keeps a document's collections when the document goes, and an upload whose record
          // would not read, or that stopped short of its record, would otherwise leave its pieces
          // for ever.
          const pieces = pieceCalls(client, uploadChunksPath(id), true);
          for (const piece of await namesAndTimes(client, uploadChunksPath(id), "an upload")) {
            await pieces.deleteChunk(piece.id);
          }
          const response = await call(`${documents}/${uploadPath(id)}`, "delete", {
            method: "DELETE",
          });
          if (!response.ok && response.status !== 404) {
            throw new FirestoreError(response.status, `deleting upload ${id}`);
          }
        },
    list: async () => {
      // When Firestore made each, by its own clock: a device's clock wrong by a day would make an
      // upload stale the moment it was staged, or never.
      const made = new Map(
        (await namesAndTimes(client, UPLOADS, "the uploads")).map(({ id, createdAt }) => [
          id,
          createdAt,
        ])
      );
      return (await firestoreRestDocuments(access).list(UPLOADS)).map(({ id, fields }) => ({
        id,
        record: fields,
        ...(made.has(id) ? { stagedAt: made.get(id) } : {}),
      }));
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
      if (!manifest) {
        throw new UnreadableCopyError("The cloud copy's manifest is not one this build can read.");
      }
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
  const { read, commit } = client;
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
    listChunks: () => namesAndTimes(client, LIVE_CHUNKS, "the views' pieces"),
  };
};
