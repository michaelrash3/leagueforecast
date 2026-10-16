import { describe, expect, it } from "vitest";
import type { GcTeamListEntry } from "../../gameChangerApi";
import { CHUNK_BYTES, DamagedValueError } from "../cloudPack";
import { fieldsOf, firestoreFieldsOf } from "../firestoreRest";
import {
  JOB_FORMAT,
  LEG_TEAMS,
  IMPORT_BATCH_TEAMS,
  MAX_LIST_TEAMS,
  coercePullJob,
  legsFor,
  listParts,
  newPullJob,
  newRefreshJob,
  packJobList,
  unpackJobList,
} from "../pullJobs";

/*
 * What a device leaves for the cloud to pull (`pullJobs.ts`): the list in pieces that come back
 * only as the list they were, and a job the function reads back field for field, or not at all.
 */

/** A list long enough, and varied enough, not to gzip into one piece. */
const longList = (): GcTeamListEntry[] =>
  Array.from({ length: 60_000 }, (_, at) => ({
    teamId: `gc${(at * 2_654_435_761).toString(36).padStart(10, "0")}`,
    name: `Team ${at.toString(16)} ${(at * 7919).toString(36)}`,
    playerCount: at % 17,
  }));

const pieceReader = (pieces: readonly Uint8Array[]) => async (index: number) =>
  pieces[index] ?? null;

describe("a pull's list", () => {
  it("comes back from its pieces as the list it was", async () => {
    const entries = longList();
    const packed = await packJobList(entries);
    expect(packed.list.pieces).toBeGreaterThan(1);
    expect(packed.list.pieces).toBe(packed.pieces.length);
    expect(packed.pieces.every((piece) => piece.length <= CHUNK_BYTES)).toBe(true);
    expect(packed.list.teams).toBe(60_000);
    expect(await unpackJobList(packed.list, pieceReader(packed.pieces))).toEqual(entries);
  });

  it("does not come back from pieces missing, out of order, or of another list", async () => {
    const packed = await packJobList(longList());
    const [first, second, ...rest] = packed.pieces;
    await expect(unpackJobList(packed.list, pieceReader([first!, ...rest]))).rejects.toBeInstanceOf(
      Error
    );
    await expect(
      unpackJobList(packed.list, pieceReader([second!, first!, ...rest]))
    ).rejects.toBeInstanceOf(DamagedValueError);
    await expect(
      unpackJobList({ ...packed.list, pieces: packed.list.pieces + 1 }, pieceReader(packed.pieces))
    ).rejects.toThrow(/missing/);
    const other = await packJobList([{ teamId: "gcOTHER00001" }]);
    await expect(
      unpackJobList({ ...packed.list, pieces: 1 }, pieceReader(other.pieces))
    ).rejects.toBeInstanceOf(DamagedValueError);
  });

  it("is refused when it is not a list of teams, or not as long as the job says", async () => {
    const notTeams = await packJobList([{ name: "no id" } as unknown as GcTeamListEntry]);
    await expect(unpackJobList(notTeams.list, pieceReader(notTeams.pieces))).rejects.toThrow(
      /not a list of teams/
    );
    const short = await packJobList([{ teamId: "gcONE0000001" }]);
    await expect(
      unpackJobList({ ...short.list, teams: 2 }, pieceReader(short.pieces))
    ).rejects.toThrow(/not a list of teams/);
  });
});

describe("a pull's job", () => {
  const job = () =>
    newPullJob({
      list: { hash: "a".repeat(64), teams: 60_001, pieces: 3 },
      seasonYears: [2027],
      timeZone: "America/Chicago",
      device: "phone",
      now: "2026-09-29T12:00:00.000Z",
    });

  it("is new, queued, and cut into legs of the size it was made with", () => {
    expect(job()).toMatchObject({
      format: JOB_FORMAT,
      status: "queued",
      pipeline: "staged-v1",
      legTeams: IMPORT_BATCH_TEAMS,
      legs: 7,
      legsDone: 0,
      stopAsked: false,
      stage: "waiting",
      end: null,
      error: null,
      version: null,
      tally: { asked: 0, answered: 0, failed: 0, filed: 0, gamesAdded: 0, gamesUpdated: 0 },
    });
    expect(legsFor(0)).toBe(1);
    expect(legsFor(LEG_TEAMS)).toBe(1);
    expect(legsFor(LEG_TEAMS + 1)).toBe(2);
    expect(legsFor(5, 2)).toBe(3);
  });

  it("reads back from Firestore's typed fields as it was written", () => {
    const written = { ...job(), end: "finished" as const, version: 42, error: "tried again" };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(written)))).toEqual(written);
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(job())))).toEqual(job());
    // A catch-up keeps saying so; anything but true there is no job this build reads.
    const catchUp = { ...job(), refresh: true as const };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(catchUp)))).toEqual(catchUp);
    expect(coercePullJob({ ...job(), refresh: "yes" })).toBeNull();
  });
  it("reads the optional import progress and report fields while rejecting invalid counts", () => {
    const status = {
      ...job(),
      stageStartedAt: job().createdAt,
      download: { total: 20, done: 4, perMinute: 120, holdUntil: null, holdReason: null },
      report: { rows: 2, ready: true },
    };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(status)))).toEqual(status);
    for (const download of [
      { ...status.download, done: 21 },
      { ...status.download, perMinute: Infinity },
      { ...status.download, perMinute: -1 },
      { ...status.download, holdReason: "unknown" },
    ])
      expect(coercePullJob({ ...status, download })).toBeNull();
    expect(coercePullJob({ ...status, report: { rows: -1, ready: true } })).toBeNull();
    expect(coercePullJob({ ...status, report: { rows: 1, ready: "true" } })).toBeNull();
  });
  it("reads a staged import's skips apart, those for now and those for good", () => {
    const counted = { ...job(), skipped: { transient: 3, permanent: 1 } };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(counted)))).toEqual(counted);
    expect(coercePullJob({ ...job(), skipped: { transient: -1, permanent: 1 } })).toBeNull();
    expect(coercePullJob({ ...job(), skipped: { transient: 1 } })).toBeNull();
  });

  it("reads the copy its first leg read, and is no job with that spoiled", () => {
    const begun = { ...job(), on: { copy: "copy-a", epoch: "" } };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(begun)))).toEqual(begun);
    const started = { ...job(), on: { copy: "copy-a", epoch: "e1" } };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(started)))).toEqual(started);
    for (const on of ["copy-a", null, { copy: "", epoch: "" }, { copy: "copy-a" }, { epoch: "" }])
      expect(coercePullJob({ ...job(), on }), JSON.stringify(on)).toBeNull();
  });

  it("is not read at all when it is of a newer format, or anything is missing or wrong", () => {
    const good = job() as unknown as Record<string, unknown>;
    expect(coercePullJob({ ...good, format: JOB_FORMAT + 1 })).toBeNull();
    expect(coercePullJob(null)).toBeNull();
    expect(coercePullJob("job")).toBeNull();
    for (const key of Object.keys(good).filter((k) => k !== "pipeline")) {
      const { [key]: _gone, ...without } = good;
      expect(coercePullJob(without), key).toBeNull();
    }
    expect(coercePullJob({ ...good, status: "paused" })).toBeNull();
    expect(coercePullJob({ ...good, stage: "dreaming" })).toBeNull();
    expect(coercePullJob({ ...good, legTeams: 0 })).toBeNull();
    expect(coercePullJob({ ...good, legsDone: -1 })).toBeNull();
    expect(coercePullJob({ ...good, seasonYears: ["2027"] })).toBeNull();
    expect(coercePullJob({ ...good, tally: { ...job().tally, filed: 1.5 } })).toBeNull();
    expect(coercePullJob({ ...good, progress: { done: 0, total: 0 } })).toBeNull();
    expect(coercePullJob({ ...good, list: { hash: 1, teams: 1, pieces: 1 } })).toBeNull();
  });
});

/*
 * A list longer than one job takes, sent as parts run one after another (`listParts`,
 * `PullJob.chain`): cut in its own order, and each part's place in it read back exactly or not at
 * all, so a part never claims to be the last while another follows, nor names a next when it is.
 */
describe("a list sent in parts", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, n) => n);

  it("is cut in list order into parts of at most fifty thousand, the rest last", () => {
    expect(MAX_LIST_TEAMS).toBe(50_000);
    expect(listParts(ids(MAX_LIST_TEAMS)).map((part) => part.length)).toEqual([50_000]);
    const cut = listParts(ids(100_001));
    expect(cut.map((part) => part.length)).toEqual([50_000, 50_000, 1]);
    expect(cut.flat()).toEqual(ids(100_001));
    expect(cut[1]?.[0]).toBe(50_000);
    expect(cut[2]).toEqual([100_000]);
    expect(listParts(ids(448_645)).map((part) => part.length)).toEqual([
      ...Array.from({ length: 8 }, () => 50_000),
      48_645,
    ]);
    // A list that fits is one part, as it was always sent: an empty one too.
    expect(listParts(ids(3))).toEqual([[0, 1, 2]]);
    expect(listParts([])).toEqual([[]]);
  });

  const FIRST = "0123456789abcdef0123456789abcdef";
  const SECOND = "fedcba9876543210fedcba9876543210";
  const part = (chain: object) => ({
    ...newPullJob({
      list: { hash: "a".repeat(64), teams: 50_000, pieces: 3 },
      seasonYears: [],
      timeZone: "America/Chicago",
      device: "phone",
      now: "2026-10-16T12:00:00.000Z",
    }),
    chain,
  });

  it("keeps each part's place, read back from Firestore's typed fields as it was written", () => {
    const first = newPullJob({
      list: { hash: "a".repeat(64), teams: 50_000, pieces: 3 },
      seasonYears: [],
      timeZone: "America/Chicago",
      device: "phone",
      now: "2026-10-16T12:00:00.000Z",
      chain: { id: FIRST, part: 1, parts: 2, teams: 50_001, next: SECOND },
    });
    expect(first.chain).toEqual({ id: FIRST, part: 1, parts: 2, teams: 50_001, next: SECOND });
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(first)))).toEqual(first);
    const last = part({ id: FIRST, part: 2, parts: 2, teams: 50_001 });
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(last)))).toEqual(last);
    // A list sent whole names no chain at all.
    expect(job().chain).toBeUndefined();
  });

  it("is no job at all with its place spoiled", () => {
    const good = { id: FIRST, part: 1, parts: 2, teams: 50_001, next: SECOND };
    for (const spoiled of [
      "part 1",
      null,
      { ...good, id: "not-a-job" },
      { ...good, next: "not-a-job" },
      { ...good, part: 0 },
      { ...good, part: 3 },
      { ...good, parts: 1.5 },
      { ...good, teams: -1 },
      // A next on the last part, and none on a part before it.
      { ...good, part: 2 },
      { id: FIRST, part: 1, parts: 2, teams: 50_001 },
    ]) {
      expect(coercePullJob(part(spoiled as object)), JSON.stringify(spoiled)).toBeNull();
    }
  });
});

const job = () =>
  newPullJob({
    list: { hash: "a".repeat(64), teams: 3, pieces: 1 },
    seasonYears: [],
    timeZone: "America/Chicago",
    device: "phone",
    now: "2026-09-29T12:00:00.000Z",
  });

describe("a Refresh now job", () => {
  const made = () =>
    newRefreshJob({
      timeZone: "America/Chicago",
      device: "phone",
      now: "2026-10-10T19:00:00.000Z",
    });

  it("is made with no list, its teams for the cloud to work out, in one leg till then", () => {
    expect(made()).toMatchObject({
      format: JOB_FORMAT,
      status: "queued",
      list: { hash: "", teams: 0, pieces: 0 },
      seasonYears: [],
      legTeams: LEG_TEAMS,
      legs: 1,
      legsDone: 0,
      rota: { at: null, ageLevels: [], again: false, heldBack: 0 },
      timeZone: "America/Chicago",
      device: "phone",
    });
    expect(made().refresh).toBeUndefined();
  });

  it("reads back from Firestore's typed fields as it was written, worked out or not", () => {
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(made())))).toEqual(made());
    const worked = {
      ...made(),
      list: { hash: "b".repeat(64), teams: 2, pieces: 1 },
      rota: { at: "2026-10-10T19:00:05.000Z", ageLevels: [9, 10], again: true, heldBack: 7 },
    };
    expect(coercePullJob(fieldsOf(firestoreFieldsOf(worked)))).toEqual(worked);
  });

  it("is no job at all with its refresh spoiled", () => {
    const good = made() as unknown as Record<string, unknown>;
    const rota = made().rota!;
    for (const spoiled of [
      "yes",
      null,
      { ...rota, at: 5 },
      { ...rota, ageLevels: ["9"] },
      { ...rota, again: "no" },
      { ...rota, heldBack: -1 },
      { at: null, ageLevels: [], again: false },
    ]) {
      expect(coercePullJob({ ...good, rota: spoiled }), JSON.stringify(spoiled)).toBeNull();
    }
  });
});
