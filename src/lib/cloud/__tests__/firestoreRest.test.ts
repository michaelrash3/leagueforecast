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
import { UnreadableCopyError } from "../cloudManifest";
import { loadPoolFrom, memoryIo } from "../cloudRunner";
import {
  BUSY_WAITS_MS,
  FirestoreError,
  firestoreFieldsOf,
  firestoreRestDocuments,
  firestoreRestLive,
  firestoreRestStore,
  firestoreValueOf,
  UnstorableValueError,
  type FirestoreValue,
} from "../firestoreRest";
import { coerceLiveMeta, publishViews, sweepViews } from "../../live/viewStore";
import { unpackChunks } from "../cloudPack";
import { newPullJob, packJobList } from "../pullJobs";
import { restJobDocs } from "../pullJobRunner";
import {
  coerceLedger,
  REBUILD_LEDGER_PATH,
  reserveRun,
  restLedgerStore,
  updateLedger,
} from "../../live/rebuildLedger";
import { describeRebuilds } from "../../live/rebuildReport";

/*
 * The cloud copy through Firestore's REST API (`firestoreRestStore`), as the nightly refresh on
 * GitHub reads and writes it: against a stand-in for Firestore that keeps documents as the REST
 * API types them and refuses a commit whose precondition no longer holds, as Firestore does.
 */

type Doc = { fields: Record<string, FirestoreValue>; createTime?: string; updateTime: string };

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
      docs.set(path, {
        fields: write.update.fields,
        createTime:
          current?.createTime ?? new Date(Date.UTC(2027, 0, 1) + clock * 1000).toISOString(),
        updateTime: `t${clock}`,
      });
      return reply(200, {});
    }
    const path = decodeURIComponent(url.pathname.slice(PREFIX.length + 1));
    if (method === "GET" && path.split("/").length % 2 === 1) {
      // A collection: its documents in name order, a page at a time, with only the masked fields.
      const names = [...docs.keys()]
        .filter((name) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes("/"))
        .sort();
      const size = Number(url.searchParams.get("pageSize") ?? names.length);
      const from = Number(url.searchParams.get("pageToken") ?? 0);
      const mask = url.searchParams.getAll("mask.fieldPaths");
      const page = names.slice(from, from + size).map((name) => {
        const found = docs.get(name)!;
        const fields = Object.fromEntries(
          Object.entries(found.fields).filter(
            ([field]) => mask.length === 0 || mask.includes(field)
          )
        );
        return { name: `projects/proj/databases/(default)/documents/${name}`, ...found, fields };
      });
      return reply(200, {
        documents: page,
        ...(from + size < names.length ? { nextPageToken: String(from + size) } : {}),
      });
    }
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
      docs.set(path, {
        fields,
        createTime:
          current?.createTime ?? new Date(Date.UTC(2027, 0, 1) + clock * 1000).toISOString(),
        updateTime: `t${clock}`,
      });
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

  it("takes a manifest it cannot read for one, never for no copy", async () => {
    const firestore = fakeFirestore();
    const store = storeOn(firestore);
    await firstCopy(store);
    const held = firestore.docs.get("copies/main")!;
    firestore.docs.set("copies/main", {
      ...held,
      fields: { ...held.fields, format: { integerValue: "9" } },
    });
    await expect(store.readManifest()).rejects.toBeInstanceOf(UnreadableCopyError);
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

describe("a request Firestore turns away for load", () => {
  /**
   * The copy's store over `firestore`, whose requests matching `refuse` are answered `status`
   * while `times` of them last; the waits it makes before asking again are kept, not waited.
   */
  const busyStore = (
    firestore: ReturnType<typeof fakeFirestore>,
    refuse: (method: string, url: string) => boolean,
    status: number,
    times: number
  ) => {
    const answers = firestore.fetchImpl.getMockImplementation()!;
    let left = times;
    firestore.fetchImpl.mockImplementation(async (input, init) => {
      if (left > 0 && refuse(init?.method ?? "GET", String(input))) {
        left -= 1;
        return new Response(JSON.stringify({ error: { status: "BUSY" } }), { status });
      }
      return answers(input, init);
    });
    const waits: number[] = [];
    const store = firestoreRestStore({
      projectId: "proj",
      token: async () => "a-token",
      writable: true,
      fetchImpl: firestore.fetchImpl as unknown as typeof fetch,
      pause: async (ms) => {
        waits.push(ms);
      },
    });
    return { store, waits };
  };
  const pieceWrites = (firestore: ReturnType<typeof fakeFirestore>) =>
    firestore.fetchImpl.mock.calls.filter(([, init]) => init?.method === "PATCH").length;

  it("asks again a piece turned away for load, waiting longer each time, until it lands", async () => {
    const firestore = fakeFirestore();
    const { store, waits } = busyStore(firestore, (method) => method === "PATCH", 429, 2);
    await store.putChunk("up-0", new Uint8Array([1, 2, 3]));
    expect(waits).toEqual([1_000, 2_000]);
    expect(pieceWrites(firestore)).toBe(3);
    expect(firestore.docs.get("copies/main/chunks/up-0")!.fields.data).toEqual({
      bytesValue: "AQID",
    });
  });

  it("gives up after its last wait, and throws the refusal", async () => {
    const firestore = fakeFirestore();
    const { store, waits } = busyStore(firestore, (method) => method === "PATCH", 429, 99);
    await expect(store.putChunk("up-0", new Uint8Array([1]))).rejects.toThrow(/HTTP 429/);
    expect(waits).toEqual(BUSY_WAITS_MS);
    expect(BUSY_WAITS_MS.reduce((sum, ms) => sum + ms, 0)).toBe(31_000);
    expect(pieceWrites(firestore)).toBe(BUSY_WAITS_MS.length + 1);
  });

  it("asks a commit again only when it was turned away before anything was done", async () => {
    const firestore = fakeFirestore();
    const manifest = await firstCopy(storeOn(firestore));
    const next = { ...manifest, version: manifest.version + 1 };
    const at = { version: manifest.version, copy: manifest.copy };
    const isCommit = (method: string, url: string) => method === "POST" && url.endsWith(":commit");

    // Too many requests is refused before anything is done: asked again, it lands.
    const throttled = busyStore(firestore, isCommit, 429, 1);
    expect(await throttled.store.commitManifest(at, next)).toBe(true);
    expect(throttled.waits).toEqual([1_000]);

    // Unavailable may come after the write was done, when a second try would read the first as
    // another writer's save: said, not asked again.
    const commits = () =>
      firestore.fetchImpl.mock.calls.filter(([input]) => String(input).endsWith(":commit")).length;
    const before = commits();
    const down = busyStore(firestore, isCommit, 503, 1);
    await expect(
      down.store.commitManifest({ version: next.version, copy: next.copy }, next)
    ).rejects.toThrow(/HTTP 503/);
    expect(down.waits).toEqual([]);
    expect(commits() - before).toBe(1);
  });

  it("asks a read or a piece's write again while Firestore is unavailable", async () => {
    const firestore = fakeFirestore();
    const manifest = await firstCopy(storeOn(firestore));
    const reads = busyStore(firestore, (method) => method === "GET", 503, 1);
    expect(await reads.store.readManifest()).toEqual(manifest);
    expect(reads.waits).toEqual([1_000]);

    // A piece written twice is the same piece.
    const writes = busyStore(firestore, (method) => method === "PATCH", 503, 1);
    await writes.store.putChunk("up-0", new Uint8Array([7]));
    expect(writes.waits).toEqual([1_000]);
    expect(firestore.docs.get("copies/main/chunks/up-0")!.fields.data).toEqual({
      bytesValue: "Bw==",
    });
  });

  it("never asks again a refusal that is not for load", async () => {
    const firestore = fakeFirestore();
    const { store, waits } = busyStore(firestore, (method) => method === "PATCH", 403, 1);
    await expect(store.putChunk("up-0", new Uint8Array([1]))).rejects.toThrow(/HTTP 403/);
    expect(waits).toEqual([]);
    expect(pieceWrites(firestore)).toBe(1);
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
      firestore.docs.set(`pullJobs/${JOB}/pieces/${index}`, {
        fields: firestoreFieldsOf({ data: piece }),
        updateTime: "t0",
      })
    );
    firestore.docs.set(`pullJobs/${JOB}`, {
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
    firestore.docs.set(`pullJobs/${JOB}/pieces/9`, {
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

describe("a document written only if nobody has since, through Firestore's REST API", () => {
  const docsOn = (firestore: ReturnType<typeof fakeFirestore>) =>
    firestoreRestDocuments({
      projectId: "proj",
      token: async () => "a-token",
      fetchImpl: firestore.fetchImpl as unknown as typeof fetch,
    });

  it("is read with the token that writes it, and written over only at that token", async () => {
    const firestore = fakeFirestore();
    const docs = docsOn(firestore);
    expect(await docs.readAt("ops/rebuild")).toBeNull();
    // Absent: written only while it still is.
    expect(await docs.replace("ops/rebuild", { on: true, caps: { dayGiBs: 9 } }, null)).toBe(true);
    expect(await docs.replace("ops/rebuild", { on: false }, null)).toBe(false);
    const read = await docs.readAt("ops/rebuild");
    expect(read?.fields).toEqual({ on: true, caps: { dayGiBs: 9 } });
    expect(read?.token).toEqual(expect.any(String));
    // Written whole: a field the write leaves out is gone.
    expect(await docs.replace("ops/rebuild", { on: false }, read!.token)).toBe(true);
    expect(await docs.read("ops/rebuild")).toEqual({ on: false });
    // And not again at the token it was read at, which that write moved on.
    expect(await docs.replace("ops/rebuild", { on: true }, read!.token)).toBe(false);
    expect(await docs.read("ops/rebuild")).toEqual({ on: false });
  });

  it("lists a collection's documents by id, their fields as plain values, a page at a time", async () => {
    const firestore = fakeFirestore();
    const fields = (rev: number) => ({ schema: 1, rev, teams: { A: { id: "A", name: "Aces" } } });
    for (let at = 0; at < 205; at += 1) {
      firestore.docs.set(`league/s${String(at).padStart(3, "0")}`, {
        fields: firestoreFieldsOf(fields(at)),
        updateTime: "t0",
      });
    }
    // A season whose id is not one Firestore takes as it is (`encodeKey`).
    firestore.docs.set("league/~U2Vhc29uIDE", {
      fields: firestoreFieldsOf(fields(9)),
      updateTime: "t0",
    });
    // Another collection's, and a document under one of the seasons, are not the collection's.
    firestore.docs.set("ops/rebuild", {
      fields: firestoreFieldsOf({ on: true }),
      updateTime: "t0",
    });
    firestore.docs.set("league/s000/kept/1", { fields: firestoreFieldsOf({}), updateTime: "t0" });
    const listed = await docsOn(firestore).list("league");
    expect(listed).toHaveLength(206);
    expect(listed[0]).toEqual({ id: "s000", fields: fields(0) });
    expect(listed[204]).toEqual({ id: "s204", fields: fields(204) });
    expect(listed[205]).toEqual({ id: "~U2Vhc29uIDE", fields: fields(9) });
    const pages = firestore.fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith("/documents/league"));
    expect(pages.map((url) => url.searchParams.get("pageToken"))).toEqual([null, "100", "200"]);
    // An empty collection lists as none.
    expect(await docsOn(fakeFirestore()).list("league")).toEqual([]);
  });

  it("throws a refusal that is not another writer's save", async () => {
    const firestore = fakeFirestore();
    firestore.fetchImpl.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 })
    );
    await expect(docsOn(firestore).list("league")).rejects.toThrow(FirestoreError);
    firestore.fetchImpl.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 })
    );
    await expect(docsOn(firestore).replace("ops/rebuild", { on: true }, null)).rejects.toThrow(
      FirestoreError
    );
  });

  it("holds the rebuilds' ledger as the console makes it and a reserve leaves it", async () => {
    const firestore = fakeFirestore();
    // As the owner makes it in the console: the switch alone.
    firestore.docs.set(REBUILD_LEDGER_PATH, {
      fields: firestoreFieldsOf({ on: true, mode: "dry", warm: true }),
      updateTime: "t0",
    });
    const store = restLedgerStore(docsOn(firestore));
    const reserved = await updateLedger(store, (held) => {
      const answer = reserveRun(held, "2027-04-15", "2027-04-15T14:00:00.000Z", {
        task: "T1",
        by: "h1",
      });
      return { next: answer.next, answer };
    });
    expect(reserved).toMatchObject({ wrote: true, answer: { ok: true } });
    const written = (await store.read()).raw;
    expect(coerceLedger(written)).toMatchObject({
      on: true,
      mode: "dry",
      day: "2027-04-15",
      dayGiBs: 2_560,
      dayRuns: 1,
      monthRuns: 1,
      pausedDay: null,
      open: { at: "2027-04-15T14:00:00.000Z", day: "2027-04-15", task: "T1", by: "h1" },
    });
    // Every field is written, the ones left out by the owner included, and read back the same.
    expect(Object.keys(written as object).sort()).toEqual(
      [
        "caps",
        "day",
        "dayFailed",
        "dayGiBs",
        "dayRuns",
        "failures",
        "lastDay",
        "lastEndedAt",
        "mode",
        "month",
        "monthFailed",
        "monthGiBs",
        "monthRuns",
        "monthVcpuS",
        "on",
        "open",
        "pausedDay",
        "warm",
      ].sort()
    );
    // And the nightly reads it back, never writing, for its lines on the rebuilds.
    expect(describeRebuilds(await docsOn(firestore).read(REBUILD_LEDGER_PATH))).toEqual([
      "Rebuilds after saves: on, dry: each builds every board and publishes none.",
      "  2027-04-15: 1 run, 0 failed; 2,560 of 10,000 GiB-seconds.",
      "  2027-04: 1 run, 0 failed; 2,560 of 120,000 GiB-seconds and 640 of 30,000 vCPU-seconds.",
      "  0 failed in a row, of the 3 that pause them; a run reserved at 2027-04-15T14:00:00.000Z has not settled.",
    ]);
    // A ledger with every field set is written and read back as it was.
    const full = coerceLedger(written);
    if (!full) throw new Error("no ledger");
    const set = {
      ...full,
      dayFailed: 1,
      lastDay: { day: "2027-04-14", runs: 6, failed: 1, gibs: 4_321 },
      monthRuns: 9,
      monthFailed: 2,
      failures: 1,
      pausedDay: "2027-04-14",
      lastEndedAt: "2027-04-15T13:58:30.000Z",
    };
    const at = await store.read();
    expect(await store.replace(at.token, set)).toBe(true);
    expect(coerceLedger((await store.read()).raw)).toEqual(set);
  });
});

describe("values as Firestore's typed JSON", () => {
  it("refuses what Firestore will not store, naming the field and never what it holds", () => {
    // The league's [team, club] pairs the meta first carried, refused with an HTTP 400 alone.
    const meta = {
      inline: {
        pages: { league: [{ page: "p", clubs: [["Coach Placeholder", "S-1"]] }] },
      },
    };
    expect(() => firestoreFieldsOf(meta)).toThrow(UnstorableValueError);
    expect(() => firestoreFieldsOf(meta)).toThrow(
      "Firestore cannot store inline.pages.league[0].clubs[0]: it is a list directly inside another list."
    );
    expect(() => firestoreValueOf([1, [2]])).toThrow("Firestore cannot store the value[1]:");
    for (const number of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => firestoreFieldsOf({ views: { b: { rating: number } } })).toThrow(
        "Firestore cannot store views.b.rating: it is not a finite number."
      );
    }
    const refused = (() => {
      try {
        firestoreFieldsOf(meta);
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    })();
    expect(refused).not.toContain("Coach Placeholder");
  });

  it("stores lists of records that hold lists, as the league's clubs now are", () => {
    expect(
      firestoreFieldsOf({
        league: [{ clubs: [{ team: "lt", club: "S-1" }], halves: ["fall"] }],
        none: [],
        zero: -0,
      })
    ).toEqual({
      league: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  clubs: {
                    arrayValue: {
                      values: [
                        {
                          mapValue: {
                            fields: { team: { stringValue: "lt" }, club: { stringValue: "S-1" } },
                          },
                        },
                      ],
                    },
                  },
                  halves: { arrayValue: { values: [{ stringValue: "fall" }] } },
                },
              },
            },
          ],
        },
      },
      none: { arrayValue: {} },
      zero: { doubleValue: -0 },
    });
  });
});

describe("the published views through Firestore's REST API", () => {
  const liveOn = (firestore: ReturnType<typeof fakeFirestore>, writable = true) =>
    firestoreRestLive({
      projectId: "proj",
      token: async () => "a-token",
      writable,
      fetchImpl: firestore.fetchImpl as unknown as typeof fetch,
    });
  const T = "2027-04-15T12:00:00.000Z";
  const publish = (store: ReturnType<typeof liveOn>, value: unknown, version: number) =>
    publishViews({
      store,
      views: [
        { key: "board:2027:ag_10u_2027:year", value },
        { key: "board:none:ag_showcase:spring", value: { rows: [] } },
      ],
      owns: ["board:"],
      copy: { id: "copy-1", version },
      today: "2027-04-15",
      now: T,
    });

  it("writes the meta and the views' pieces, and reads them back as they were published", async () => {
    const firestore = fakeFirestore();
    const store = liveOn(firestore);
    const rows = { rows: [{ teamId: "S-A", rating: 1.5, rank: 1 }] };
    expect(await publish(store, rows, 3)).toMatchObject({ ok: true, wrote: true, uploaded: 2 });
    const read = await store.readMeta();
    expect(read?.token).toMatch(/^t\d+$/);
    const meta = coerceLiveMeta(read?.meta);
    expect(meta).toMatchObject({ copy: { id: "copy-1", version: 3 }, inline: {}, retired: [] });
    const entry = meta?.views["board:2027:ag_10u_2027:year"];
    if (!entry) throw new Error("no entry");
    const piece = await store.getChunk(`${entry.id}-0`);
    if (!piece) throw new Error("no piece");
    expect(await unpackChunks([piece], entry.h)).toEqual(rows);
    // Every field typed as the SDK types it: the counts as integers, not doubles.
    const fields = firestore.docs.get("live/meta")?.fields;
    expect(fields?.copy?.mapValue?.fields?.version).toEqual({ integerValue: "3" });
    // Published again unchanged: nothing written.
    const writes = firestore.fetchImpl.mock.calls.filter(([, init]) => init?.method).length;
    expect(await publish(store, rows, 3)).toMatchObject({ ok: true, wrote: false });
    expect(firestore.fetchImpl.mock.calls.filter(([, init]) => init?.method).length).toBe(writes);
  });

  it("will not replace a meta written since it was read, nor make one where one is", async () => {
    const firestore = fakeFirestore();
    const store = liveOn(firestore);
    await publish(store, "A", 1);
    const read = await store.readMeta();
    const meta = coerceLiveMeta(read?.meta);
    if (!read || !meta) throw new Error("no meta");
    expect(await store.commitMeta(null, meta)).toBe(false);
    await publish(store, "B", 2);
    expect(await store.commitMeta(read.token, meta)).toBe(false);
    expect(await store.commitMeta((await store.readMeta())?.token ?? null, meta)).toBe(true);
  });

  it("throws on a refusal that is not another writer's", async () => {
    const firestore = fakeFirestore();
    const store = liveOn(firestore);
    const reads = firestore.fetchImpl.getMockImplementation()!;
    firestore.fetchImpl.mockImplementation(async (input, init) =>
      String(input).endsWith(":commit")
        ? new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 })
        : reads(input, init)
    );
    await expect(publish(store, "A", 1)).rejects.toThrow(FirestoreError);
  });

  it("says what Firestore said of a refusal, which a night's log would otherwise not", async () => {
    // Firestore's answer to the meta of 9 and 10 October 2026, as the emulator gives it.
    const firestore = fakeFirestore();
    const store = liveOn(firestore);
    const reads = firestore.fetchImpl.getMockImplementation()!;
    firestore.fetchImpl.mockImplementation(async (input, init) =>
      String(input).endsWith(":commit")
        ? new Response(
            JSON.stringify({
              error: {
                code: 400,
                status: "INVALID_ARGUMENT",
                message: "Cannot convert an array value\n in an array value.",
              },
            }),
            { status: 400 }
          )
        : reads(input, init)
    );
    await expect(publish(store, "A", 1)).rejects.toThrow(
      "Firestore answered HTTP 400 saving the views' meta. It said: INVALID_ARGUMENT: Cannot convert an array value in an array value."
    );
    // An answer with nothing to say adds nothing, and a long one is cut short.
    firestore.fetchImpl.mockImplementation(async (input, init) =>
      String(input).endsWith(":commit")
        ? new Response("not json", { status: 500 })
        : reads(input, init)
    );
    await expect(publish(store, "A", 1)).rejects.toThrow(
      /^Firestore answered HTTP 500 saving the views' meta\.$/
    );
    firestore.fetchImpl.mockImplementation(async (input, init) =>
      String(input).endsWith(":commit")
        ? new Response(JSON.stringify({ error: { message: "x".repeat(1000) } }), { status: 400 })
        : reads(input, init)
    );
    const long = await publish(store, "A", 1).catch((error: unknown) => error);
    expect(long).toBeInstanceOf(FirestoreError);
    expect((long as Error).message).toBe(
      `Firestore answered HTTP 400 saving the views' meta. It said: ${"x".repeat(299)}…`
    );
  });

  it("lists every piece by name and age, a page at a time, without their data", async () => {
    const firestore = fakeFirestore();
    const store = liveOn(firestore);
    for (let at = 0; at < 301; at += 1) {
      await store.putChunk(
        `${"0".repeat(28)}${String(at).padStart(4, "0")}-0`,
        new Uint8Array([1])
      );
    }
    const pieces = await store.listChunks();
    expect(pieces).toHaveLength(301);
    expect(pieces[0]).toEqual({ id: `${"0".repeat(32)}-0`, createdAt: "2027-01-01T00:00:01.000Z" });
    const lists = firestore.fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith("/live/meta/chunks"));
    expect(lists).toHaveLength(2);
    expect(lists.every((url) => url.searchParams.get("mask.fieldPaths") === "none")).toBe(true);
    // And the sweep reads them so: with no meta naming any of them, every one an hour old goes.
    const swept = await sweepViews({ store, now: "2027-01-01T02:00:00.000Z" });
    expect(swept).toEqual({ ok: true, deleted: 0, strays: 301 });
    expect(await store.listChunks()).toEqual([]);
  });

  it("reads views it was opened only to read, and writes nothing", async () => {
    const firestore = fakeFirestore();
    await publish(liveOn(firestore), "A", 1);
    const reader = liveOn(firestore, false);
    expect(coerceLiveMeta((await reader.readMeta())?.meta)?.copy.version).toBe(1);
    await expect(
      reader.commitMeta(null, coerceLiveMeta((await reader.readMeta())?.meta)!)
    ).rejects.toThrow(/to read/);
    await expect(reader.putChunk("x-0", new Uint8Array([1]))).rejects.toThrow(/to read/);
    await expect(reader.deleteChunk("x-0")).rejects.toThrow(/to read/);
  });

  it("asks the origin it is given, as a test asks the emulator", async () => {
    const asked: string[] = [];
    const store = firestoreRestLive({
      projectId: "proj",
      token: async () => "t",
      writable: false,
      origin: "http://127.0.0.1:8080",
      fetchImpl: (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });
    expect(await store.readMeta()).toBeNull();
    expect(asked).toEqual([
      "http://127.0.0.1:8080/v1/projects/proj/databases/(default)/documents/live/meta",
    ]);
  });
});
