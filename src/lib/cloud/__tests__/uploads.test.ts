import { describe, expect, it } from "vitest";
import { CHUNK_BYTES } from "../cloudPack";
import {
  coerceUploadRecord,
  packUpload,
  readUpload,
  staleUploads,
  sweepStaleUploads,
  UPLOAD_MAX_AGE_MS,
  type PackedUpload,
  type UploadReader,
} from "../uploads";

/*
 * A file the copy's owner stages for the server (`uploads.ts`): packed as the copy packs a part,
 * read back piece by piece and checked against its fingerprint, and swept once a day old. The
 * value is placeholder text.
 */

const AT = "2026-10-04T12:00:00.000Z";

/** A reader of the one upload `packed`, as Firestore would hold it after `stageUpload`. */
const readerOf = (packed: PackedUpload, pieces = packed.pieces): UploadReader => ({
  record: async (id) => (id === packed.id ? structuredClone(packed.record) : null),
  getChunk: async (id, chunk) =>
    id === packed.id ? (pieces.find((piece) => piece.id === chunk)?.data ?? null) : null,
});

/** Text gzip cannot shrink much, so the value takes more than one piece. */
const bulky = (pieces: number): string => {
  const bytes = new Uint8Array(CHUNK_BYTES * pieces);
  for (let at = 0; at < bytes.length; at += 65_536) {
    crypto.getRandomValues(bytes.subarray(at, at + 65_536));
  }
  return Array.from(bytes.subarray(0, CHUNK_BYTES * pieces * 0.6), (byte) =>
    byte.toString(36)
  ).join("");
};

describe("a file staged for the server", () => {
  it("is read back as it went, from as many pieces as it took", async () => {
    const value = bulky(2);
    const packed = await packUpload("team-rankings", value, AT);
    expect(packed.record).toMatchObject({ kind: "team-rankings", createdAt: AT });
    expect(packed.record.chunks).toBeGreaterThan(1);
    expect(packed.pieces.map((piece) => piece.id)).toEqual(
      Array.from({ length: packed.record.chunks }, (_, index) => `${packed.id}-${index}`)
    );
    expect(await readUpload(readerOf(packed), packed.id, "team-rankings")).toEqual({
      ok: true,
      value,
    });
  });

  it("is missing without a piece, a record, or as another kind than asked for", async () => {
    const packed = await packUpload("team-rankings", "placeholder backup", AT);
    expect(await readUpload(readerOf(packed, []), packed.id, "team-rankings")).toEqual({
      ok: false,
      why: "missing",
    });
    expect(await readUpload(readerOf(packed), "f".repeat(32), "team-rankings")).toEqual({
      ok: false,
      why: "missing",
    });
    // Not an upload's id, even from a store that would read whatever path it was handed, as
    // Firestore's REST API does.
    const anyPath: UploadReader = {
      record: async () => structuredClone(packed.record),
      getChunk: async (_id, chunk) => packed.pieces[Number(chunk.split("-").pop())]?.data ?? null,
    };
    expect(await readUpload(anyPath, packed.id, "team-rankings")).toMatchObject({ ok: true });
    expect(await readUpload(anyPath, "../copies/main", "team-rankings")).toEqual({
      ok: false,
      why: "missing",
    });
    const otherKind: UploadReader = {
      ...readerOf(packed),
      record: async () => ({ ...packed.record, kind: "league" }),
    };
    expect(await readUpload(otherKind, packed.id, "team-rankings")).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("is damaged when its pieces do not make the value fingerprinted", async () => {
    const packed = await packUpload("team-rankings", "placeholder backup", AT);
    const other = await packUpload("team-rankings", "another placeholder", AT);
    const swapped = packed.pieces.map((piece, index) => ({
      ...piece,
      data: other.pieces[index]?.data ?? piece.data,
    }));
    expect(await readUpload(readerOf(packed, swapped), packed.id, "team-rankings")).toEqual({
      ok: false,
      why: "damaged",
    });
  });

  it("has a record only as the rules let one be written", () => {
    const record = {
      kind: "team-rankings",
      hash: "a".repeat(64),
      bytes: 9,
      chunks: 1,
      createdAt: AT,
    };
    expect(coerceUploadRecord(record)).toEqual(record);
    for (const bad of [
      { ...record, kind: "league" },
      { ...record, hash: "short" },
      { ...record, chunks: 0 },
      { ...record, bytes: -1 },
      { ...record, createdAt: "yesterday" },
      null,
    ]) {
      expect([bad, coerceUploadRecord(bad)]).toEqual([bad, null]);
    }
  });
});

describe("the uploads the nightly sweeps", () => {
  it("are each a day old or more, or with a record nothing could use", () => {
    const record = (createdAt: string) => ({
      kind: "team-rankings",
      hash: "a".repeat(64),
      bytes: 9,
      chunks: 1,
      createdAt,
    });
    const now = Date.parse(AT);
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(
      staleUploads(
        [
          { id: "fresh", record: record(at(UPLOAD_MAX_AGE_MS - 1)) },
          { id: "old", record: record(at(UPLOAD_MAX_AGE_MS)) },
          { id: "junk", record: { kind: "who knows" } },
        ],
        AT
      )
    ).toEqual(["old", "junk"]);
  });
});

describe("the nightly's sweep of staged backups", () => {
  const record = (createdAt: string) => ({
    kind: "team-rankings",
    hash: "a".repeat(64),
    bytes: 9,
    chunks: 1,
    createdAt,
  });
  const storeOf = (records: Record<string, unknown>, refuse: string[] = []) => {
    const held = new Map(Object.entries(records));
    return {
      held,
      store: {
        record: async (id: string) => held.get(id) ?? null,
        getChunk: async () => null,
        remove: async (id: string) => {
          if (refuse.includes(id)) throw new Error("refused");
          held.delete(id);
        },
        list: async () => [...held].map(([id, value]) => ({ id, record: value })),
      },
    };
  };
  const DAY_OLD = new Date(Date.parse(AT) - UPLOAD_MAX_AGE_MS).toISOString();

  it("deletes those a day old, leaves the rest, and leaves one that will not go for tomorrow", async () => {
    const { held, store } = storeOf(
      { fresh: record(AT), old: record(DAY_OLD), stuck: record(DAY_OLD) },
      ["stuck"]
    );
    expect(await sweepStaleUploads(store, AT, true)).toEqual({ stale: 2, deleted: 1 });
    expect([...held.keys()]).toEqual(["fresh", "stuck"]);
  });

  it("only counts them on a dry run", async () => {
    const { held, store } = storeOf({ old: record(DAY_OLD) });
    expect(await sweepStaleUploads(store, AT, false)).toEqual({ stale: 1, deleted: 0 });
    expect([...held.keys()]).toEqual(["old"]);
  });
});
