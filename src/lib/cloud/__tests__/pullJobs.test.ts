import { describe, expect, it } from "vitest";
import type { GcTeamListEntry } from "../../gameChangerApi";
import { CHUNK_BYTES, DamagedValueError } from "../cloudPack";
import { fieldsOf, firestoreFieldsOf } from "../firestoreRest";
import {
  JOB_FORMAT,
  LEG_TEAMS,
  coercePullJob,
  legsFor,
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
      legTeams: LEG_TEAMS,
      legs: 3,
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

  it("is not read at all when it is of a newer format, or anything is missing or wrong", () => {
    const good = job() as unknown as Record<string, unknown>;
    expect(coercePullJob({ ...good, format: JOB_FORMAT + 1 })).toBeNull();
    expect(coercePullJob(null)).toBeNull();
    expect(coercePullJob("job")).toBeNull();
    for (const key of Object.keys(good)) {
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
