import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { chunkId } from "../../cloud/cloudManifest";
import { hashJson, unpackChunks } from "../../cloud/cloudPack";
import { ageGroupYear, type AgeGroup, type ScoutGame } from "../../teamRankings";
import { boardViews, buildBoardsAndFacts } from "../views/board";
import {
  coerceLiveMeta,
  LIVE_FORMAT,
  LIVE_SCHEMA,
  META_MAX_BYTES,
  publishViews,
  RETIRE_GRACE_MS,
  STRAY_AGE_MS,
  sweepViews,
  type LiveMeta,
  type LiveStore,
  type PublishedView,
} from "../viewStore";
import { memoryLive, type MemoryLive } from "./memoryLive";

const T = "2027-04-15T12:00:00.000Z";
const later = (ms: number) => new Date(Date.parse(T) + ms).toISOString();
const COPY = "c0ffee";
const view = (key: string, value: unknown): PublishedView => ({ key, value });

const publish = (
  live: MemoryLive,
  views: PublishedView[],
  version: number,
  more: Partial<Parameters<typeof publishViews>[0]> = {}
) =>
  publishViews({
    store: live.store,
    views,
    owns: ["board:"],
    copy: { id: COPY, version },
    today: "2027-04-15",
    now: T,
    ...more,
  });

/** A view's value, from the pieces the meta names for it, checked against its fingerprint. */
const decode = async (live: MemoryLive, key: string): Promise<unknown> => {
  const entry = live.meta()?.views[key];
  if (!entry) throw new Error(`no view ${key}`);
  const pieces = Array.from({ length: entry.c }, (_, index) => {
    const piece = live.chunks.get(chunkId(entry.id, index));
    if (!piece) throw new Error(`piece ${index} of ${key} is gone`);
    return piece.data;
  });
  return unpackChunks(pieces, entry.h);
};

describe("publishing views", () => {
  it("puts each view where the meta says, under the copy, version and day it was built for", async () => {
    const live = memoryLive();
    const result = await publish(live, [view("board:a", { rows: [1] }), view("board:b", "two")], 3);
    expect(result).toMatchObject({ ok: true, wrote: true, uploaded: 2, unchanged: 0, tries: 1 });
    const meta = live.meta();
    expect(meta).toMatchObject({
      format: LIVE_FORMAT,
      schema: LIVE_SCHEMA,
      today: "2027-04-15",
      builtAt: T,
      copy: { id: COPY, version: 3 },
      inline: {},
      retired: [],
    });
    expect(Object.keys(meta?.views ?? {})).toEqual(["board:a", "board:b"]);
    expect(meta?.views["board:a"]).toMatchObject({ c: 1, v: 3, b: '{"rows":[1]}'.length });
    expect(await decode(live, "board:a")).toEqual({ rows: [1] });
    expect(await decode(live, "board:b")).toBe("two");
    expect(live.costs).toEqual({ reads: 2, writes: 3, deletes: 0 });
  });

  it("writes nothing at all when it publishes again what the meta already says", async () => {
    const live = memoryLive();
    const views = [view("board:a", { rows: [1] }), view("board:b", { rows: [2] })];
    await publish(live, views, 1);
    const { writes, deletes } = live.costs;
    const again = await publish(live, views, 1, { now: later(60_000) });
    expect(again).toMatchObject({ ok: true, wrote: false, uploaded: 0, unchanged: 2 });
    expect(live.costs.writes).toBe(writes);
    expect(live.costs.deletes).toBe(deletes);
    // Built later, but nothing it says has changed, so not even the meta is written.
    expect(live.meta()?.builtAt).toBe(T);
  });

  it("uploads JSON once however many views carry it", async () => {
    const live = memoryLive();
    const empty = { rows: [] };
    const result = await publish(
      live,
      [view("board:a", empty), view("board:b", empty), view("board:c", { rows: [1] })],
      1
    );
    expect(result).toMatchObject({ ok: true, uploaded: 2 });
    const meta = live.meta();
    expect(meta?.views["board:a"]?.id).toBe(meta?.views["board:b"]?.id);
    expect(live.chunks.size).toBe(2);
  });

  it("refuses to replace a view with one built from an older copy version", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 5);
    const { writes } = live.costs;
    const older = await publish(live, [view("board:k", "B")], 4);
    expect(older).toMatchObject({ ok: true, wrote: false, refused: 1 });
    expect(live.costs.writes).toBe(writes);
    expect(await decode(live, "board:k")).toBe("A");
    expect(live.meta()?.copy.version).toBe(5);
    // The same version, built again later, is the newer word.
    await publish(live, [view("board:k", "B")], 5);
    expect(await decode(live, "board:k")).toBe("B");
  });

  it("brings back nothing a newer publish took out, and takes out nothing a newer one put in", async () => {
    const live = memoryLive();
    await publish(live, [view("board:1", "one"), view("board:2", "two")], 5);
    await publish(live, [view("board:1", "one")], 6);
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:1"]);
    const older = await publish(live, [view("board:1", "one"), view("board:2", "two")], 4);
    expect(older).toMatchObject({ ok: true, refused: 2 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:1"]);

    await publish(live, [view("board:1", "one"), view("board:3", "three")], 7);
    const stale = await publish(live, [view("board:1", "one")], 6);
    expect(stale).toMatchObject({ ok: true, removed: 0 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:1", "board:3"]);
  });

  it("lets an older publish take nothing out, even a view the meta has from older still", async () => {
    // Another family moves the meta on to version 7; the boards are still at 5.
    const live = memoryLive();
    await publish(live, [view("board:a", "A"), view("board:b", "B")], 5);
    await publish(live, [view("moves:x", "X")], 7, { owns: ["moves:"] });
    const stale = await publish(live, [view("board:a", "A")], 6);
    expect(stale).toMatchObject({ ok: true, removed: 0 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:a", "board:b", "moves:x"]);
  });

  it("keeps the newer publish's copy when an older one changes a view, and moves the day on to the view's", async () => {
    const live = memoryLive();
    await publish(live, [view("moves:x", "X")], 3, { owns: ["moves:"] });
    await publish(live, [view("board:a", "A")], 5);
    // Late by version though built a day on: the header's copy stays the newer version's, but the
    // day is the later one, which a view now carries.
    const older = await publish(live, [view("moves:x", "X2")], 4, {
      owns: ["moves:"],
      today: "2027-04-16",
    });
    expect(older).toMatchObject({ ok: true, wrote: true });
    expect(await decode(live, "moves:x")).toBe("X2");
    expect(live.meta()).toMatchObject({ today: "2027-04-16", copy: { id: COPY, version: 5 } });
    // So a build of the newer version for the day before cannot write over it (found by Codex).
    expect(
      await publish(live, [view("moves:x", "X5")], 5, { owns: ["moves:"], today: "2027-04-15" })
    ).toEqual({ ok: false, reason: "older-day" });
    expect(await decode(live, "moves:x")).toBe("X2");
  });

  it("leaves the day where it was when a late publish for a later one places nothing", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 5);
    const meta = live.meta();
    const late = await publish(live, [view("board:a", "B")], 4, { today: "2027-04-16" });
    expect(late).toMatchObject({ ok: true, wrote: false, refused: 1 });
    expect(live.meta()).toEqual(meta);
  });

  it("stamps a view built again unchanged with its new version, so an older build leaves it", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 5);
    const again = await publish(live, [view("board:k", "A")], 7);
    expect(again).toMatchObject({ ok: true, wrote: true, uploaded: 0, unchanged: 0 });
    expect(live.meta()?.views["board:k"]).toMatchObject({ k: COPY, v: 7 });
    const late = await publish(live, [view("board:k", "B")], 6);
    expect(late).toMatchObject({ ok: true, wrote: false, refused: 1 });
    expect(await decode(live, "board:k")).toBe("A");
  });

  it("lets each family of view move to a copy made afresh, whatever version the old one reached", async () => {
    const live = memoryLive();
    const fresh = { id: "fresh", version: 1 };
    await publish(live, [view("board:k", "old")], 9);
    await publish(live, [view("moves:k", "old"), view("moves:gone", "old")], 9, {
      owns: ["moves:"],
    });
    await publish(live, [view("board:k", "new")], 1, { copy: fresh });
    // The meta is the fresh copy's now, but its moves are still the old copy's, at version 9.
    expect(live.meta()?.views["moves:k"]).toMatchObject({ k: COPY, v: 9 });
    const moves = await publish(live, [view("moves:k", "new")], 1, {
      copy: fresh,
      owns: ["moves:"],
    });
    expect(moves).toMatchObject({ ok: true, wrote: true, refused: 0, removed: 1 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:k", "moves:k"]);
    expect(await decode(live, "moves:k")).toBe("new");
    expect(live.meta()?.views["moves:k"]).toMatchObject({ k: "fresh", v: 1 });
  });

  it("keeps a view from a later version of its own copy, though the meta has moved to another", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "six"), view("board:j", "six")], 6);
    await publish(live, [view("moves:k", "M")], 1, {
      copy: { id: "fresh", version: 1 },
      owns: ["moves:"],
    });
    // A board build from version 5 of the first copy finishes late, on the day after.
    const header = live.meta();
    const late = await publish(live, [view("board:k", "five")], 5, { today: "2027-04-16" });
    expect(late).toMatchObject({ ok: true, wrote: false, refused: 1, removed: 0 });
    expect(await decode(live, "board:k")).toBe("six");
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:j", "board:k", "moves:k"]);
    expect(live.meta()).toMatchObject({
      today: header?.today,
      copy: { id: "fresh", version: 1 },
      marks: { [COPY]: 6, fresh: 1 },
    });
  });

  it("brings back nothing a newer build took out when late builds of two copies land after a reset", async () => {
    const live = memoryLive();
    const fresh = (version: number) => ({ copy: { id: "fresh", version }, owns: ["moves:"] });
    await publish(live, [view("board:1", "one"), view("board:2", "two")], 8);
    await publish(live, [view("board:1", "one")], 9);
    await publish(live, [view("moves:a", "a"), view("moves:b", "b")], 1, fresh(1));
    await publish(live, [view("moves:a", "a")], 2, fresh(2));
    const before = live.meta();
    // A board build of the first copy and a moves build of the fresh one, both begun earlier.
    const boards = await publish(live, [view("board:1", "one"), view("board:2", "two")], 8);
    expect(boards).toMatchObject({ ok: true, wrote: false, refused: 2 });
    const moves = await publish(live, [view("moves:a", "a"), view("moves:b", "b")], 1, fresh(1));
    expect(moves).toMatchObject({ ok: true, wrote: false, refused: 2 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:1", "moves:a"]);
    expect(live.meta()).toEqual(before);
  });

  it("brings back nothing even when the newer build took out its family's last view", async () => {
    const live = memoryLive();
    await publish(live, [view("moves:x", "x")], 4, { owns: ["moves:"] });
    await publish(live, [view("board:k", "k")], 5);
    // Version 7 takes out the last move; the newest view of the copy left is still at 5.
    await publish(live, [], 7, { owns: ["moves:"] });
    await publish(live, [view("teams:t", "t")], 1, {
      copy: { id: "fresh", version: 1 },
      owns: ["teams:"],
    });
    const late = await publish(live, [view("moves:x", "x")], 6, { owns: ["moves:"] });
    expect(late).toMatchObject({ ok: true, wrote: false, refused: 1 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:k", "teams:t"]);
  });

  it("leaves a fresh copy's views to a late build of the copy it replaced, while the meta knows that copy", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "old")], 9);
    await publish(live, [view("moves:m", "old")], 9, { owns: ["moves:"] });
    await publish(live, [view("board:k", "new")], 1, { copy: { id: "fresh", version: 1 } });
    const late = await publish(live, [view("board:k", "older")], 8);
    expect(late).toMatchObject({ ok: true, wrote: false, refused: 1 });
    expect(await decode(live, "board:k")).toBe("new");
  });

  it("keeps a copy's mark while the header or a view names it, and lets it go after", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "old")], 9);
    await publish(live, [view("moves:m", "old")], 9, { owns: ["moves:"] });
    await publish(live, [view("board:k", "new")], 1, { copy: { id: "fresh", version: 1 } });
    expect(live.meta()?.marks).toEqual({ [COPY]: 9, fresh: 1 });
    await publish(live, [view("moves:m", "new")], 2, {
      copy: { id: "fresh", version: 2 },
      owns: ["moves:"],
    });
    expect(live.meta()?.marks).toEqual({ fresh: 2 });
  });

  it("names a new view by an upload the meta already has of the same JSON", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "same")], 1);
    const { writes } = live.costs;
    const result = await publish(live, [view("board:a", "same"), view("board:b", "same")], 1);
    expect(result).toMatchObject({ ok: true, wrote: true, uploaded: 0 });
    expect(live.costs.writes - writes).toBe(1);
    expect(live.meta()?.views["board:b"]?.id).toBe(live.meta()?.views["board:a"]?.id);
  });

  it("takes out what it covers and did not build, and leaves every other key and inline as they are", async () => {
    const live = memoryLive();
    await publish(live, [view("board:1", "one"), view("moves:1", "m")], 1, {
      owns: ["board:", "moves:"],
    });
    const meta = live.meta();
    if (!meta) throw new Error("no meta");
    live.setMeta({ ...meta, inline: { pages: ["p"] } });
    const result = await publish(live, [view("board:2", "two")], 2);
    expect(result).toMatchObject({ ok: true, removed: 1, retired: 1 });
    const after = live.meta();
    expect(Object.keys(after?.views ?? {})).toEqual(["board:2", "moves:1"]);
    expect(after?.views["moves:1"]?.v).toBe(1);
    expect(after?.inline).toEqual({ pages: ["p"] });
  });

  it("writes the inline values it hands over in place of those names, and keeps the rest", async () => {
    const live = memoryLive();
    await publish(live, [view("board:1", "one")], 1);
    const meta = live.meta();
    if (!meta) throw new Error("no meta");
    live.setMeta({ ...meta, inline: { pages: { halves: {} }, other: ["kept"] } });
    const pages = {
      pulledAt: T,
      halves: { ag_b: { fall: 1, spring: 2 }, ag_a: { fall: 0, spring: 3 } },
    };
    expect(await publish(live, [view("board:1", "one")], 2, { inline: { pages } })).toMatchObject({
      ok: true,
      wrote: true,
    });
    expect(live.meta()?.inline).toEqual({ other: ["kept"], pages });
    // The same again writes nothing at all.
    const { writes } = live.costs;
    expect(await publish(live, [view("board:1", "one")], 2, { inline: { pages } })).toMatchObject({
      ok: true,
      wrote: false,
    });
    expect(live.costs.writes).toBe(writes);
  });

  it("reads inline values back in any order of their fields as the same values", async () => {
    // A store may hand a map's fields over in an order of its own, as Firestore does: the meta
    // still says what this publish would write, so it writes nothing.
    const live = memoryLive();
    const pages = {
      pulledAt: T,
      halves: { ag_b: { fall: 1, spring: 2 }, ag_a: { fall: 0, spring: 3 } },
    };
    await publish(live, [view("board:1", "one")], 1, { inline: { pages } });
    const meta = live.meta();
    if (!meta) throw new Error("no meta");
    live.setMeta({
      ...meta,
      inline: {
        pages: {
          halves: { ag_a: { spring: 3, fall: 0 }, ag_b: { spring: 2, fall: 1 } },
          pulledAt: T,
        },
      },
    });
    const { writes } = live.costs;
    expect(await publish(live, [view("board:1", "one")], 1, { inline: { pages } })).toMatchObject({
      ok: true,
      wrote: false,
    });
    expect(live.costs.writes).toBe(writes);
  });

  it("leaves every inline value as it is when it is late", async () => {
    const live = memoryLive();
    const newer = { halves: { ag_a: { fall: 5, spring: 5 } } };
    await publish(live, [view("board:1", "one")], 5, { inline: { pages: newer } });
    const result = await publish(live, [view("board:1", "older")], 4, {
      inline: { pages: { halves: { ag_a: { fall: 1, spring: 1 } } } },
    });
    expect(result).toMatchObject({ ok: true, refused: 1 });
    expect(live.meta()?.inline).toEqual({ pages: newer });
  });

  it("replaces every view of a copy made afresh, whatever version it had reached", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "old"), view("board:gone", "x")], 9);
    await publish(live, [view("board:k", "new")], 1, { copy: { id: "fresh", version: 1 } });
    expect(live.meta()?.copy).toEqual({ id: "fresh", version: 1 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:k"]);
    expect(await decode(live, "board:k")).toBe("new");
  });

  it("counts a view unchanged only when its own copy built it, though another's JSON matches", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "same")], 1);
    const fresh = await publish(live, [view("board:k", "same")], 1, {
      copy: { id: "fresh", version: 1 },
    });
    expect(fresh).toMatchObject({ ok: true, wrote: true, uploaded: 0, unchanged: 0 });
    expect(live.meta()?.views["board:k"]).toMatchObject({ k: "fresh", v: 1 });
  });

  it("merges again over a racing publish, without uploading anything twice", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 1);
    live.beforeCommit(async () => {
      // Another publisher's family, committed between this publish's read and its commit.
      const raced = await publishViews({
        store: live.store,
        views: [view("moves:x", "X")],
        owns: ["moves:"],
        copy: { id: COPY, version: 5 },
        today: "2027-04-15",
        now: T,
      });
      expect(raced.ok).toBe(true);
    });
    const puts = live.costs.writes;
    const result = await publish(live, [view("board:a", "A2"), view("board:b", "B")], 6);
    expect(result).toMatchObject({ ok: true, wrote: true, tries: 2, uploaded: 2 });
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:a", "board:b", "moves:x"]);
    // Three pieces (two here, one by the racer) and three metas: none uploaded twice.
    expect(live.costs.writes - puts).toBe(5);
    expect(await decode(live, "board:a")).toBe("A2");
  });

  it("asks before each commit whether it is still worth publishing, and stops when it is not", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 1);
    const meta = live.meta();
    const chunks = [...live.chunks.keys()];
    let asked = 0;
    // A racing publish refuses the first commit, so the question is asked again before the second.
    live.beforeCommit(() =>
      publish(live, [view("moves:x", "X")], 1, { owns: ["moves:"] }).then(() => undefined)
    );
    const answers = [true, false];
    const result = await publish(live, [view("board:a", "B")], 2, {
      stillCurrent: async () => answers[asked++] ?? false,
    });
    expect(result).toEqual({ ok: false, reason: "not-current" });
    expect(asked).toBe(2);
    expect(live.meta()?.views["board:a"]).toEqual(meta?.views["board:a"]);
    expect([...live.chunks.keys()].filter((id) => !chunks.includes(id))).toHaveLength(1);
  });

  it("asks before saying an identical publish wrote nothing, too", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 1);
    const writes = live.costs.writes;
    const result = await publish(live, [view("board:a", "A")], 1, {
      stillCurrent: async () => false,
    });
    expect(result).toEqual({ ok: false, reason: "not-current" });
    expect(live.costs.writes).toBe(writes);
  });

  it("gives up after its tries, and takes back what it uploaded", async () => {
    const live = memoryLive();
    const refusing: LiveStore = { ...live.store, commitMeta: async () => false };
    const result = await publishViews({
      store: refusing,
      views: [view("board:a", "A")],
      owns: ["board:"],
      copy: { id: COPY, version: 1 },
      today: "2027-04-15",
      now: T,
    });
    expect(result).toEqual({ ok: false, reason: "kept-changing" });
    expect(live.chunks.size).toBe(0);
  });

  it("takes back its upload when a racer leaves a meta it cannot read, or a newer build's", async () => {
    const live = memoryLive();
    live.beforeCommit(() => live.setMeta({ format: 0 }));
    expect(await publish(live, [view("board:a", "A")], 1)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(live.chunks.size).toBe(0);

    const newer = memoryLive();
    await publish(newer, [view("board:a", "A")], 1);
    const kept = [...newer.chunks.keys()];
    newer.beforeCommit(() => newer.setMeta({ ...newer.meta(), schema: LIVE_SCHEMA + 1 }));
    expect(await publish(newer, [view("board:a", "B")], 2)).toEqual({
      ok: false,
      reason: "newer-schema",
    });
    expect([...newer.chunks.keys()]).toEqual(kept);
  });

  it("takes back its upload when a racer published the same view first", async () => {
    const live = memoryLive();
    live.beforeCommit(() => publish(live, [view("board:a", "A")], 1).then(() => undefined));
    const result = await publish(live, [view("board:a", "A")], 1);
    expect(result).toMatchObject({ ok: true, wrote: false, unchanged: 1, tries: 2 });
    expect([...live.chunks.keys()]).toEqual([`${live.meta()?.views["board:a"]?.id}-0`]);
  });

  it("takes back its upload when a racer's view carries the same JSON", async () => {
    const live = memoryLive();
    live.beforeCommit(() =>
      publish(live, [view("moves:a", "A")], 1, { owns: ["moves:"] }).then(() => undefined)
    );
    const result = await publish(live, [view("board:a", "A")], 1);
    expect(result).toMatchObject({ ok: true, wrote: true, uploaded: 0, tries: 2 });
    const shared = live.meta()?.views["moves:a"]?.id;
    expect(live.meta()?.views["board:a"]?.id).toBe(shared);
    expect([...live.chunks.keys()]).toEqual([`${shared}-0`]);
  });

  it("refuses a meta it cannot read, or one written by a newer build, and writes nothing", async () => {
    const live = memoryLive();
    live.setMeta({ format: LIVE_FORMAT + 1 });
    expect(await publish(live, [view("board:a", "A")], 1)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const newer = memoryLive();
    await publish(newer, [view("board:a", "A")], 1);
    const meta = newer.meta();
    newer.setMeta({ ...meta, schema: LIVE_SCHEMA + 1 });
    const writes = newer.costs.writes;
    expect(await publish(newer, [view("board:a", "B")], 2)).toEqual({
      ok: false,
      reason: "newer-schema",
    });
    expect(newer.costs.writes).toBe(writes);
    expect(newer.chunks.size).toBe(1);
    expect(live.costs.writes).toBe(0);
  });

  it("keeps nothing it did not build from a meta an older build wrote, late or not", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A"), view("moves:x", "X")], 9, {
      owns: ["board:", "moves:"],
    });
    const meta = live.meta();
    live.setMeta({ ...meta, schema: LIVE_SCHEMA - 1, inline: { pages: ["p"] } });
    // Version 5 is older than the copy's mark, but nothing of the older build's meta is kept.
    const result = await publish(live, [view("board:a", "A2")], 5);
    expect(result).toMatchObject({ ok: true, wrote: true, removed: 1, refused: 0 });
    expect(live.meta()).toMatchObject({ schema: LIVE_SCHEMA, copy: { version: 5 } });
    expect(live.meta()?.inline).toEqual({});
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(["board:a"]);
    expect(await decode(live, "board:a")).toBe("A2");
    // Its own inline values it writes, and keeps none of the older build's beside them.
    const pages = { halves: { ag_a: { fall: 1, spring: 1 } } };
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA - 1, inline: { pages: ["p"], other: 1 } });
    expect(await publish(live, [view("board:a", "A3")], 6, { inline: { pages } })).toMatchObject({
      ok: true,
      wrote: true,
    });
    expect(live.meta()?.inline).toEqual({ pages });
  });

  it("refuses a meta too large for every member to download, and takes back its uploads", async () => {
    const live = memoryLive();
    const many = Array.from({ length: META_MAX_BYTES / 100 }, (_, at) =>
      view(`board:${"x".repeat(80)}${at}`, "same")
    );
    expect(await publish(live, many, 1)).toEqual({ ok: false, reason: "too-large" });
    expect(live.chunks.size).toBe(0);
    expect(live.meta()).toBeNull();
  });

  it("cuts a view too large for one document into pieces, and reads it back whole", async () => {
    const live = memoryLive();
    // Random bytes as base64: about 1.6 MB of JSON that gzip cannot bring under one piece.
    let binary = "";
    for (let at = 0; at < 1_200_000; at += 32_768) {
      binary += String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32_768)));
    }
    const big = btoa(binary);
    await publish(live, [view("board:big", big)], 1);
    expect(live.meta()?.views["board:big"]?.c).toBeGreaterThan(1);
    expect(await decode(live, "board:big")).toBe(big);
  });

  it("will not publish two views under one key", async () => {
    await expect(
      publish(memoryLive(), [view("board:a", 1), view("board:a", 2)], 1)
    ).rejects.toThrow("board:a");
  });
});

describe("the day, the rules and what a publish was built from", () => {
  const FROM = { k: COPY, v: 1, inputs: "i1", today: "2027-04-15", rules: 1 };
  const boards = (from: Partial<typeof FROM> = {}) => ({
    built: { family: "board:", from: { ...FROM, ...from } },
  });

  it("writes nothing for an earlier day than the meta's, whatever its version", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 5);
    const meta = live.meta();
    const chunks = live.chunks.size;
    for (const version of [4, 5, 6]) {
      expect(
        await publish(live, [view("board:a", `day before at ${version}`)], version, {
          today: "2027-04-14",
        })
      ).toEqual({ ok: false, reason: "older-day" });
    }
    expect(live.meta()).toEqual(meta);
    // What it uploaded, taken back.
    expect(live.chunks.size).toBe(chunks);
  });

  it("still holds a late version on the same day, and lets a later day at the same version in", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 5);
    expect(await publish(live, [view("board:a", "B")], 4)).toMatchObject({ ok: true, refused: 1 });
    const later = await publish(live, [view("board:a", "C")], 5, { today: "2027-04-16" });
    expect(later).toMatchObject({ ok: true, wrote: true });
    expect(await decode(live, "board:a")).toBe("C");
    expect(live.meta()?.today).toBe("2027-04-16");
  });

  it("writes nothing under older rules than the family was built by", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 1, boards({ rules: 2 }));
    const meta = live.meta();
    expect(await publish(live, [view("board:a", "B")], 2, boards({ v: 2, rules: 1 }))).toEqual({
      ok: false,
      reason: "older-rules",
    });
    expect(live.meta()).toEqual(meta);
    // The same rules, or newer, write.
    expect(
      await publish(live, [view("board:a", "B")], 2, boards({ v: 2, rules: 2 }))
    ).toMatchObject({ ok: true, wrote: true });
  });

  it("records what a family was built from, keeps it through a late publish, and keeps only a floor for one that cannot vouch", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 5, boards({ v: 5, inputs: "five" }));
    expect(live.meta()?.built).toEqual({ "board:": { ...FROM, v: 5, inputs: "five" } });
    // Late: the record stays the newer build's.
    await publish(live, [view("board:a", "A4")], 4, boards({ v: 4, inputs: "four" }));
    expect(live.meta()?.built["board:"]).toMatchObject({ v: 5, inputs: "five" });
    // Another family's publish leaves it.
    await publish(live, [view("moves:x", "X")], 6, { owns: ["moves:"] });
    expect(live.meta()?.built["board:"]).toMatchObject({ v: 5, inputs: "five" });
    // A publish of the boards that says nothing of what they came from leaves only the floor: it
    // vouches for no copy, and keeps the rules and day the boards were last built under.
    await publish(live, [view("board:a", "A7")], 7);
    expect(live.meta()?.built).toEqual({
      "board:": { k: "", v: 0, inputs: "", today: "2027-04-15", rules: 1 },
    });
    expect(await publish(live, [view("board:a", "A8")], 8, boards({ v: 8, rules: 0 }))).toEqual({
      ok: false,
      reason: "older-rules",
    });
  });

  it("keeps only a floor of a family's record when a late publish writes over its views", async () => {
    // Another family moves the copy's mark on; a board build of a version in between is late, but
    // may still replace boards from before it, and here under newer rules.
    const live = memoryLive();
    await publish(live, [view("board:a", "A")], 5, boards({ v: 5, inputs: "five" }));
    await publish(live, [view("moves:x", "X")], 7, { owns: ["moves:"] });
    const late = await publish(
      live,
      [view("board:a", "A6")],
      6,
      boards({ v: 6, inputs: "six", rules: 2, today: "2027-04-16" })
    );
    expect(late).toMatchObject({ ok: true, wrote: true, refused: 0 });
    expect(await decode(live, "board:a")).toBe("A6");
    // No build vouches for the boards now; the newest rules and latest day they were built under
    // stay, so the build of version 7 under the older rules cannot write over them (found by Codex).
    expect(live.meta()?.built["board:"]).toEqual({
      k: "",
      v: 0,
      inputs: "",
      today: "2027-04-16",
      rules: 2,
    });
    expect(
      await publish(live, [view("board:a", "A7")], 7, {
        ...boards({ v: 7, inputs: "seven", today: "2027-04-16" }),
      })
    ).toEqual({ ok: false, reason: "older-rules" });
    expect(await decode(live, "board:a")).toBe("A6");
    // Rules as new vouch for the boards again.
    await publish(
      live,
      [view("board:a", "A7")],
      7,
      boards({ v: 7, inputs: "seven", rules: 2, today: "2027-04-16" })
    );
    expect(live.meta()?.built["board:"]).toMatchObject({ k: COPY, v: 7, inputs: "seven" });
  });

  it("keeps only a floor of another family's record that a late publish writes over unvouched", async () => {
    const live = memoryLive();
    await publish(live, [view("moves:x", "X")], 5, {
      owns: ["moves:"],
      built: { family: "moves:", from: { ...FROM, v: 5 } },
    });
    await publish(live, [view("board:a", "A")], 7);
    // Late, and saying nothing of what the moves came from.
    const late = await publish(live, [view("moves:x", "X6")], 6, { owns: ["moves:"] });
    expect(late).toMatchObject({ ok: true, wrote: true });
    expect(live.meta()?.built["moves:"]).toEqual({
      k: "",
      v: 0,
      inputs: "",
      today: "2027-04-15",
      rules: 1,
    });
  });

  it("keeps only its own record over an older build's meta", async () => {
    const live = memoryLive();
    await publish(live, [view("board:a", "A"), view("moves:x", "X")], 5, {
      owns: ["board:", "moves:"],
      built: { family: "moves:", from: { ...FROM, v: 5 } },
    });
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA - 1 });
    await publish(live, [view("board:a", "B")], 6, boards({ v: 6 }));
    expect(live.meta()?.built).toEqual({ "board:": { ...FROM, v: 6 } });
  });

  it("reads a meta whose records are missing or wrong, dropping only the wrong ones", () => {
    const meta = {
      format: LIVE_FORMAT,
      schema: LIVE_SCHEMA,
      today: "2027-04-15",
      builtAt: T,
      copy: { id: COPY, version: 1 },
      marks: { [COPY]: 1 },
      inline: {},
      views: {},
      retired: [],
    };
    expect(coerceLiveMeta(meta)?.built).toEqual({});
    const floor = { k: "", v: 0, inputs: "", today: "2027-04-15", rules: 2 };
    const read = coerceLiveMeta({
      ...meta,
      built: {
        "board:": FROM,
        "moves:": { ...FROM, rules: -1 },
        "games:": "nonsense",
        "teams:": floor,
        // Half a vouch: a copy with no inputs, or inputs with no copy.
        "search:": { ...FROM, inputs: "" },
        "health:": { ...FROM, k: "" },
      },
    });
    expect(read?.built).toEqual({ "board:": FROM, "teams:": floor });
    // Seasons read from their documents are vouched for by a fingerprint, which a floor never has.
    const seasons = { ...FROM, league: "l1" };
    const vouched = coerceLiveMeta({
      ...meta,
      built: {
        "board:": seasons,
        "moves:": { ...FROM, league: "" },
        "games:": { ...FROM, league: 7 },
        "teams:": { ...floor, league: "l1" },
      },
    });
    expect(vouched?.built).toEqual({ "board:": seasons });
  });

  it("takes out the retired uploads past their grace with a commit it makes anyway, and deletes their pieces after", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    const retiredId = live.meta()?.views["board:k"]?.id;
    await publish(live, [view("board:k", "B")], 2);
    const due = later(RETIRE_GRACE_MS);
    // Nothing to write: collecting is no reason to.
    const writes = live.costs.writes;
    expect(
      await publish(live, [view("board:k", "B")], 2, { now: due, collectDue: true })
    ).toMatchObject({ ok: true, wrote: false, deleted: 0 });
    expect(live.costs.writes).toBe(writes);
    expect(live.chunks.has(`${retiredId}-0`)).toBe(true);
    // Something to write: the retired upload leaves the meta in that commit, its pieces after.
    let atCommit: boolean | undefined;
    live.beforeCommit(() => {
      atCommit = live.chunks.has(`${retiredId}-0`);
    });
    const result = await publish(live, [view("board:k", "C")], 3, { now: due, collectDue: true });
    expect(result).toMatchObject({ ok: true, wrote: true, deleted: 1 });
    expect(atCommit).toBe(true);
    expect(live.chunks.has(`${retiredId}-0`)).toBe(false);
    expect(live.meta()?.retired.map((upload) => upload.id)).not.toContain(retiredId);
    // B's upload, retired just now, waits out its own grace.
    expect(live.meta()?.retired).toHaveLength(1);
  });

  it("counts a due piece that will not delete after the commit, rather than failing the publish", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    await publish(live, [view("board:k", "B")], 2);
    const stubborn = {
      ...live.store,
      deleteChunk: async () => {
        throw new Error("Firestore answered HTTP 503");
      },
    };
    const result = await publishViews({
      store: stubborn,
      views: [view("board:k", "C")],
      owns: ["board:"],
      copy: { id: COPY, version: 3 },
      today: "2027-04-15",
      now: later(RETIRE_GRACE_MS),
      collectDue: true,
    });
    expect(result).toMatchObject({ ok: true, wrote: true, deleted: 0, undeleted: 1 });
    expect(await decode(live, "board:k")).toBe("C");
  });

  it("collects nothing still in its grace, and nothing unless asked", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    await publish(live, [view("board:k", "B")], 2);
    expect(
      await publish(live, [view("board:k", "C")], 3, {
        now: later(RETIRE_GRACE_MS - 1_000),
        collectDue: true,
      })
    ).toMatchObject({ ok: true, wrote: true, deleted: 0 });
    expect(
      await publish(live, [view("board:k", "D")], 4, { now: later(RETIRE_GRACE_MS * 2) })
    ).toMatchObject({ ok: true, wrote: true, deleted: 0 });
    expect(live.meta()?.retired).toHaveLength(3);
  });
});

describe("sweeping what no reader can still be fetching", () => {
  it("deletes a retired upload only once it has been retired for the grace period", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    const retiredId = live.meta()?.views["board:k"]?.id;
    await publish(live, [view("board:k", "B")], 2);
    expect(live.meta()?.retired).toEqual([{ id: retiredId, c: 1, at: T }]);

    const early = await sweepViews({ store: live.store, now: later(RETIRE_GRACE_MS - 1_000) });
    expect(early).toEqual({ ok: true, deleted: 0, strays: 0 });
    expect(live.chunks.has(`${retiredId}-0`)).toBe(true);
    expect(live.costs.deletes).toBe(0);

    const writes = live.costs.writes;
    const due = await sweepViews({ store: live.store, now: later(RETIRE_GRACE_MS) });
    expect(due).toEqual({ ok: true, deleted: 1, strays: 0 });
    expect(live.chunks.has(`${retiredId}-0`)).toBe(false);
    expect(live.meta()?.retired).toEqual([]);
    expect(live.costs.writes).toBe(writes + 1);
    expect(await decode(live, "board:k")).toBe("B");
  });

  it("takes retired uploads out of the meta before it deletes their pieces", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    const retiredId = live.meta()?.views["board:k"]?.id;
    await publish(live, [view("board:k", "B")], 2);
    let whenCommitted: boolean | undefined;
    live.beforeCommit(() => {
      whenCommitted = live.chunks.has(`${retiredId}-0`);
    });
    expect(await sweepViews({ store: live.store, now: later(RETIRE_GRACE_MS) })).toMatchObject({
      deleted: 1,
    });
    expect(whenCommitted).toBe(true);
    expect(live.chunks.has(`${retiredId}-0`)).toBe(false);
  });

  it("retires an upload two views share only when neither names it", async () => {
    const live = memoryLive();
    await publish(live, [view("board:1", "same"), view("board:2", "same")], 1);
    const shared = live.meta()?.views["board:1"]?.id;
    await publish(live, [view("board:1", "new"), view("board:2", "same")], 2);
    expect(live.meta()?.retired).toEqual([]);
    await publish(live, [view("board:1", "new"), view("board:2", "newer")], 3);
    expect(live.meta()?.retired.map((upload) => upload.id)).toEqual([shared]);
  });

  it("deletes a piece nothing has named once it is an hour old, and never one the meta names", async () => {
    const live = memoryLive();
    live.setNow(T);
    await publish(live, [view("board:k", "A")], 1);
    await live.store.putChunk("0123456789abcdef0123456789abcdef-0", new Uint8Array([1]));
    const soon = await sweepViews({ store: live.store, now: later(STRAY_AGE_MS - 1_000) });
    expect(soon).toEqual({ ok: true, deleted: 0, strays: 0 });
    const old = await sweepViews({ store: live.store, now: later(STRAY_AGE_MS * 30) });
    expect(old).toEqual({ ok: true, deleted: 0, strays: 1 });
    expect([...live.chunks.keys()]).toEqual([`${live.meta()?.views["board:k"]?.id}-0`]);
  });

  it("leaves an old piece retired too recently to delete, though it is older than a stray", async () => {
    // Uploaded at T, retired two hours later: an hour-old piece, but a reader may still want it.
    const live = memoryLive();
    live.setNow(T);
    await publish(live, [view("board:k", "A")], 1);
    const retiredId = live.meta()?.views["board:k"]?.id;
    await publish(live, [view("board:k", "B")], 2, { now: later(2 * STRAY_AGE_MS) });
    const swept = await sweepViews({ store: live.store, now: later(2 * STRAY_AGE_MS + 60_000) });
    expect(swept).toEqual({ ok: true, deleted: 0, strays: 0 });
    expect(live.chunks.has(`${retiredId}-0`)).toBe(true);
  });

  it("sweeps strays with no meta at all, and reads a meta again when a publish races it", async () => {
    const bare = memoryLive();
    await bare.store.putChunk("0123456789abcdef0123456789abcdef-0", new Uint8Array([1]));
    expect(await sweepViews({ store: bare.store, now: later(STRAY_AGE_MS) })).toEqual({
      ok: true,
      deleted: 0,
      strays: 1,
    });

    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    await publish(live, [view("board:k", "B")], 2);
    live.beforeCommit(() =>
      publish(live, [view("board:k", "B"), view("board:other", "C")], 3).then(() => undefined)
    );
    const swept = await sweepViews({ store: live.store, now: later(RETIRE_GRACE_MS) });
    expect(swept).toEqual({ ok: true, deleted: 1, strays: 0 });
    expect(live.meta()?.retired).toEqual([]);
    expect(await decode(live, "board:other")).toBe("C");
  });

  it("leaves alone a meta a newer build wrote, deleting nothing it might name", async () => {
    const live = memoryLive();
    await publish(live, [view("board:k", "A")], 1);
    const retiredId = live.meta()?.views["board:k"]?.id;
    await publish(live, [view("board:k", "B")], 2);
    await live.store.putChunk("0123456789abcdef0123456789abcdef-0", new Uint8Array([1]));
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA + 1 });
    const writes = live.costs.writes;
    expect(await sweepViews({ store: live.store, now: later(STRAY_AGE_MS * 2) })).toEqual({
      ok: false,
      reason: "newer-schema",
    });
    expect(live.costs.writes).toBe(writes);
    expect(live.costs.deletes).toBe(0);
    expect(live.chunks.has(`${retiredId}-0`)).toBe(true);
  });

  it("stops on a meta it cannot read, or one that keeps changing", async () => {
    const live = memoryLive();
    live.setMeta({ format: 0 });
    expect(await sweepViews({ store: live.store, now: T })).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const busy = memoryLive();
    await publish(busy, [view("board:k", "A")], 1);
    await publish(busy, [view("board:k", "B")], 2);
    const refusing: LiveStore = { ...busy.store, commitMeta: async () => false };
    expect(await sweepViews({ store: refusing, now: later(RETIRE_GRACE_MS) })).toEqual({
      ok: false,
      reason: "kept-changing",
    });
  });
});

describe("the meta as a reader takes it", () => {
  const good: LiveMeta = {
    format: LIVE_FORMAT,
    schema: LIVE_SCHEMA,
    today: "2027-04-15",
    builtAt: T,
    copy: { id: COPY, version: 2 },
    marks: { fresh: 1, [COPY]: 2 },
    inline: {},
    views: {
      "board:b": { h: "a".repeat(64), id: "0123456789abcdef", c: 1, b: 10, k: COPY, v: 2 },
      "board:a": { h: "b".repeat(64), id: "fedcba9876543210", c: 2, b: 20, k: COPY, v: 1 },
    },
    retired: [{ id: "00112233445566778899", c: 1, at: T }],
    built: {},
  };

  it("is this build's layout, with its views and marks in key order", () => {
    const meta = coerceLiveMeta(good);
    expect(Object.keys(meta?.views ?? {})).toEqual(["board:a", "board:b"]);
    expect(Object.keys(meta?.marks ?? {})).toEqual([COPY, "fresh"]);
    expect(meta?.retired).toEqual(good.retired);
  });

  it("has its inline values in key order all the way down, lists left in their order", () => {
    const meta = coerceLiveMeta({
      ...good,
      inline: {
        pages: { halves: { b: { spring: 1, fall: 2 }, a: { fall: 3, spring: 4 } } },
        list: [3, 1],
      },
    });
    expect(JSON.stringify(meta?.inline)).toBe(
      JSON.stringify({
        list: [3, 1],
        pages: { halves: { a: { fall: 3, spring: 4 }, b: { fall: 2, spring: 1 } } },
      })
    );
  });

  it.each<[string, unknown]>([
    ["another format", { ...good, format: 2 }],
    ["no copy version", { ...good, copy: { id: COPY } }],
    ["a view with no pieces", { ...good, views: { k: { ...good.views["board:a"], c: 0 } } }],
    [
      "a view with a bad fingerprint",
      { ...good, views: { k: { ...good.views["board:a"], h: "x" } } },
    ],
    [
      "a view with a bad upload id",
      { ...good, views: { k: { ...good.views["board:a"], id: "X" } } },
    ],
    ["a view from no copy", { ...good, views: { k: { ...good.views["board:a"], k: "" } } }],
    ["no marks", { ...good, marks: undefined }],
    ["a mark that is not a version", { ...good, marks: { [COPY]: -1 } }],
    ["a retired upload with no time", { ...good, retired: [{ id: "0123456789abcdef", c: 1 }] }],
    ["a retired upload with a bad id", { ...good, retired: [{ id: "x", c: 1, at: T }] }],
    ["no views", { ...good, views: null }],
    ["no day", { ...good, today: 3 }],
    ["not a record", "meta"],
  ])("is refused with %s", (_case, raw) => {
    expect(coerceLiveMeta(raw)).toBeNull();
  });
});

describe("the boards as views", () => {
  const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
  const NOTHING = { teams: [], matchups: [], logs: {} };
  const boardsOf = (games: ScoutGame[]) => {
    const byYear = (year: number | undefined) =>
      games.filter(
        (game) =>
          ageGroupYear(
            fixture.ageGroups.find((group: AgeGroup) => group.id === game.ageGroupId)
          ) === year
      );
    return boardViews(
      fixture.ageGroups,
      buildBoardsAndFacts({
        ageGroups: fixture.ageGroups,
        teams: fixture.teams,
        gamesOfYear: byYear,
        readSeason: (id) => fixture.seasons[id] ?? NOTHING,
        today: FIXTURE_TODAY,
      })
    );
  };
  const first = boardsOf(fixture.games);

  it("are every board under its year, page and half, without the owner's star", async () => {
    expect(first).toHaveLength(33);
    expect(first.map(({ key }) => key)).toContain("board:2027:ag_10u_2027:spring");
    expect(first.map(({ key }) => key)).toContain("board:none:ag_showcase:year");
    expect(first.some(({ value }) => value.rows.some((row) => "isMine" in row))).toBe(false);
    const live = memoryLive();
    await publish(live, first, 1);
    for (const { key, value } of first) {
      expect(await decode(live, key)).toEqual(JSON.parse(JSON.stringify(value)));
    }
  });

  it("publish a one-game edit in at most twenty documents", async () => {
    const live = memoryLive();
    const once = await publish(live, first, 1);
    expect(once).toMatchObject({ ok: true });
    // One spring score this year on the 10U page, a run more for the losing side.
    const edited = fixture.games.find(
      (game) =>
        game.ageGroupId === "ag_10u_2027" &&
        game.teamAScore !== undefined &&
        game.teamBScore !== undefined &&
        (game.date ?? "") > "2027-03-01" &&
        (game.date ?? "") < FIXTURE_TODAY
    );
    if (!edited) throw new Error("the fixture has no such game");
    const games = fixture.games.map((game) =>
      game === edited ? { ...game, teamAScore: (game.teamAScore ?? 0) + 1 } : game
    );
    const changed = boardsOf(games);
    const hashesOf = async (boards: typeof first) =>
      new Set(await Promise.all(boards.map(async ({ value }) => (await hashJson(value)).hash)));
    const before = await hashesOf(first);
    const fresh = [...(await hashesOf(changed))].filter((hash) => !before.has(hash));
    expect(fresh.length).toBeGreaterThan(0);
    const { writes, deletes } = live.costs;
    const result = await publish(live, changed, 2);
    expect(result).toMatchObject({ ok: true, wrote: true });
    // The changed boards' uploads and the meta; nothing deleted until a sweep.
    expect(live.costs.writes - writes).toBe(fresh.length + 1);
    expect(live.costs.writes - writes).toBeLessThanOrEqual(20);
    expect(live.costs.deletes).toBe(deletes);
  });
});
