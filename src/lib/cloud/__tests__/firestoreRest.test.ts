import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPoolWrites,
  initTeamRankingsStore,
  loadScoutTeams,
  cloudPoolKeys,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { loadPoolFrom, memoryIo } from "../cloudRunner";
import {
  FirestoreError,
  firestoreFieldsOf,
  firestoreRestDocuments,
  firestoreRestStore,
  type FirestoreValue,
} from "../firestoreRest";
import { newPullJob, packJobList } from "../pullJobs";
import { restJobDocs } from "../pullJobRunner";

/*
 * The cloud copy through Firestore's REST API (`firestoreRestStore`), as the nightly refresh on
 * GitHub reads and writes it: against a stand-in for Firestore that keeps documents as the REST
 * API types them and refuses a commit whose precondition no longer holds, as Firestore does.
 */

type Doc = { fields: Record<string, FirestoreValue>; updateTime: string };

const PREFIX = "/v1/projects/proj/databases/(default)/documents";

const fakeFirestore = () => {
  const docs = new Map<string, Doc>();
  let clock = 0;
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const tokens: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    tokens.push(String((init?.headers as Record<string, string>).authorization));
    const method = init?.method ?? "GET";
    if (url.pathname === `${PREFIX}:commit`) {
      const write = (
        JSON.parse(String(init?.body)) as {
          writes: {
            update: { name: string; fields: Record<string, FirestoreValue> };
            currentDocument: { exists?: boolean; updateTime?: string };
          }[];
        }
      ).writes[0]!;
      const path = write.update.name.split("/documents/")[1]!;
      const current = docs.get(path);
      if (write.currentDocument.exists === false && current) {
        return reply(409, { error: { status: "ALREADY_EXISTS" } });
      }
      if (
        write.currentDocument.updateTime !== undefined &&
        current?.updateTime !== write.currentDocument.updateTime
      ) {
        return reply(400, { error: { status: "FAILED_PRECONDITION" } });
      }
      clock += 1;
      docs.set(path, { fields: write.update.fields, updateTime: `t${clock}` });
      return reply(200, {});
    }
    const path = decodeURIComponent(url.pathname.slice(PREFIX.length + 1));
    if (method === "GET") {
      const found = docs.get(path);
      return found ? reply(200, found) : reply(404, { error: { status: "NOT_FOUND" } });
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { fields: Record<string, FirestoreValue> };
      const current = docs.get(path);
      if (url.searchParams.get("currentDocument.exists") === "true" && !current) {
        return reply(404, { error: { status: "NOT_FOUND" } });
      }
      // With a mask, the fields it names are set from the body, or removed where the body has
      // none, and every other field is kept.
      const mask = url.searchParams.getAll("updateMask.fieldPaths");
      const fields =
        mask.length === 0
          ? body.fields
          : Object.fromEntries(
              [
                ...Object.entries(current?.fields ?? {}).filter(([name]) => !mask.includes(name)),
                ...Object.entries(body.fields).filter(([name]) => mask.includes(name)),
              ].sort(([a], [b]) => a.localeCompare(b))
            );
      clock += 1;
      docs.set(path, { fields, updateTime: `t${clock}` });
      return reply(200, {});
    }
    if (method === "DELETE") {
      docs.delete(path);
      return reply(200, {});
    }
    return reply(405, {});
  });
  return { docs, fetchImpl, tokens };
};

const storeOn = (firestore: ReturnType<typeof fakeFirestore>, writable = true) =>
  firestoreRestStore({
    projectId: "proj",
    token: async () => "a-token",
    writable,
    fetchImpl: firestore.fetchImpl as unknown as typeof fetch,
  });

const backing = new Map<string, string>();
beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});
afterEach(() => {
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

/** A pool of two teams, saved as the first copy through `store`. */
const firstCopy = async (store: ReturnType<typeof storeOn>) => {
  await initTeamRankingsStore(memoryIo());
  saveScoutTeams([
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
  ]);
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({
      key,
      value: await readCloudPoolValue(key),
      at: 1_790_000_000_000,
    }))
  );
  const saved = await commitChanges({
    store,
    base: null,
    changes,
    device: "nightly",
    now: "2026-09-30T07:17:00.000Z",
  });
  resetTeamRankingsStore();
  if (!saved.ok) throw new Error("first copy");
  return saved.manifest;
};

describe("the cloud copy through Firestore's REST API", () => {
  it("writes the manifest and its pieces as the app's SDK does, and reads the pool back", async () => {
    const firestore = fakeFirestore();
    const store = storeOn(firestore);
    const manifest = await firstCopy(store);

    // The manifest's fields typed as the SDK types them: whole numbers as integers.
    const fields = firestore.docs.get("copies/main")!.fields;
    expect(fields.version).toEqual({ integerValue: "1" });
    expect(fields.device).toEqual({ stringValue: "nightly" });
    const part = fields.parts!.arrayValue!.values![0]!.mapValue!.fields!;
    expect(part.at).toEqual({ integerValue: "1790000000000" });
    // Each piece a document of its own, holding bytes.
    const pieces = [...firestore.docs.keys()].filter((path) =>
      path.startsWith("copies/main/chunks/")
    );
    expect(pieces.length).toBeGreaterThan(0);
    expect(firestore.docs.get(pieces[0]!)!.fields.data!.bytesValue).toMatch(/^[A-Za-z0-9+/]+=*$/);

    expect(await store.readManifest()).toEqual(manifest);
    await loadPoolFrom(store);
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["A", "B"]);
    expect(firestore.tokens.every((token) => token === "Bearer a-token")).toBe(true);
  });

  it("will not replace a manifest another save changed after it was read", async () => {
    const firestore = fakeFirestore();
    const store = storeOn(firestore);
    const manifest = await firstCopy(store);
    // A first copy where one already is.
    expect(await store.commitManifest(null, manifest)).toBe(false);
    // A save onto a version that is no longer the copy's.
    expect(await store.commitManifest({ version: 0, copy: manifest.copy }, manifest)).toBe(false);
    // And one onto the right version whose document another write changed in the meantime:
    // the read and the commit are two requests, and the precondition is what joins them.
    const reads = firestore.fetchImpl.getMockImplementation()!;
    firestore.fetchImpl.mockImplementation(async (input, init) => {
      const answer = await reads(input, init);
      const doc = firestore.docs.get("copies/main");
      if ((init?.method ?? "GET") === "GET" && doc) doc.updateTime = "changed-meanwhile";
      return answer;
    });
    expect(
      await store.commitManifest(
        { version: manifest.version, copy: manifest.copy },
        {
          ...manifest,
          version: manifest.version + 1,
        }
      )
    ).toBe(false);
  });

  it("throws on a refusal that is not another save's, rather than reading it as one", async () => {
    const firestore = fakeFirestore();
    const store = storeOn(firestore);
    const manifest = await firstCopy(store);
    const reads = firestore.fetchImpl.getMockImplementation()!;
    firestore.fetchImpl.mockImplementation(async (input, init) =>
      String(input).endsWith(":commit")
        ? new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 })
        : reads(input, init)
    );
    await expect(
      store.commitManifest({ version: manifest.version, copy: manifest.copy }, manifest)
    ).rejects.toThrow(/HTTP 403/);
  });

  it("reads a copy it was opened only to read, and writes nothing to it", async () => {
    const firestore = fakeFirestore();
    await firstCopy(storeOn(firestore));
    const reader = storeOn(firestore, false);
    expect((await reader.readManifest())?.version).toBe(1);
    await expect(reader.putChunk("x-0", new Uint8Array([1]))).rejects.toThrow(/to read/);
    await expect(reader.deleteChunk("x-0")).rejects.toThrow(/to read/);
  });
});

describe("a pull's job through Firestore's REST API", () => {
  const JOB = "0123456789abcdef0123456789abcdef";

  it("reads the job and its list, and changes only the fields a leg sets", async () => {
    const firestore = fakeFirestore();
    const packed = await packJobList([{ teamId: "gcACES000001" }, { teamId: "gcBEARS00001" }]);
    const job = newPullJob({
      list: packed.list,
      seasonYears: [2027],
      timeZone: "America/New_York",
      device: "phone",
      now: "2026-09-29T12:00:00.000Z",
    });
    // As the device leaves it: the list's pieces, then the job.
    packed.pieces.forEach((piece, index) =>
      firestore.docs.set(`copies/main/jobs/${JOB}/pieces/${index}`, {
        fields: firestoreFieldsOf({ data: piece }),
        updateTime: "t0",
      })
    );
    firestore.docs.set(`copies/main/jobs/${JOB}`, {
      fields: firestoreFieldsOf(job),
      updateTime: "t0",
    });
    const jobs = restJobDocs(
      firestoreRestDocuments({
        projectId: "proj",
        token: async () => "a-token",
        fetchImpl: firestore.fetchImpl as unknown as typeof fetch,
      })
    );

    expect(await jobs.read(JOB)).toEqual(job);
    expect(await jobs.piece(JOB, 0)).toEqual(packed.pieces[0]);
    expect(await jobs.piece(JOB, packed.pieces.length)).toBeNull();
    // A piece that holds anything but bytes is no piece.
    firestore.docs.set(`copies/main/jobs/${JOB}/pieces/9`, {
      fields: firestoreFieldsOf({ data: "not bytes" }),
      updateTime: "t0",
    });
    expect(await jobs.piece(JOB, 9)).toBeNull();
    expect(await jobs.read("f".repeat(32))).toBeNull();

    await jobs.update(JOB, {
      status: "running",
      progress: { done: 1, total: 2, failed: 0 },
      error: "tried again",
    });
    expect(await jobs.read(JOB)).toEqual({
      ...job,
      status: "running",
      progress: { done: 1, total: 2, failed: 0 },
      error: "tried again",
    });
    // A field set to null is cleared, as the job's type has it, not left as it was.
    await jobs.update(JOB, { error: null });
    expect((await jobs.read(JOB))?.error).toBeNull();
  });

  it("never makes again a job deleted while a leg ran", async () => {
    const firestore = fakeFirestore();
    const jobs = restJobDocs(
      firestoreRestDocuments({
        projectId: "proj",
        token: async () => "a-token",
        fetchImpl: firestore.fetchImpl as unknown as typeof fetch,
      })
    );
    await expect(jobs.update(JOB, { status: "done" })).rejects.toBeInstanceOf(FirestoreError);
    expect(firestore.docs.size).toBe(0);
  });
});
