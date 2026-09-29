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
import { firestoreRestStore, type FirestoreValue } from "../firestoreRest";

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
      clock += 1;
      const body = JSON.parse(String(init?.body)) as { fields: Record<string, FirestoreValue> };
      docs.set(path, { fields: body.fields, updateTime: `t${clock}` });
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
