import { describe, expect, it } from "vitest";
import { commitChanges, type CloudStore } from "../../cloud/cloudEngine";
import type { CloudManifest } from "../../cloud/cloudManifest";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import type { ArchivedSeason, ArchiveEntry } from "../../teamRankingsArchive";
import { archiveRowsKey, GC_ARCHIVE_KEY } from "../../teamRankingsStorage";
import {
  readArchivedSeason,
  readArchiveIndex,
  type CopyReader,
  type DecodedParts,
} from "../copyArchive";

/*
 * Finished seasons read straight from the cloud's copy (`copyArchive.ts`): the index part, and a
 * season's own part of rows when it is opened. Placeholder names throughout.
 */

const NOW = "2027-09-01T12:00:00.000Z";
const season = (id: string, name: string, teamName: string): ArchivedSeason => ({
  version: 2,
  id,
  name,
  ageLevel: 12,
  year: 2026,
  segment: "spring",
  archivedAt: "2026-08-01T00:00:00.000Z",
  fromGames: 40,
  fromTeams: 12,
  rows: [
    {
      rank: 1,
      teamName,
      rating: 4.5,
      record: "9-1-0",
      wins: 9,
      losses: 1,
      ties: 0,
      games: 10,
      strengthOfSchedule: 0.4,
      sosRank: 2,
      state: "OH",
      ageLevel: 12,
      crossAgeGames: 0,
    },
  ],
});
const SPRING = season("arch-12u-2026-spring", "12U 2026 Spring", "Placeholder S-1");
const entryOf = (one: ArchivedSeason): ArchiveEntry => ({
  id: one.id,
  name: one.name,
  ageLevel: 12,
  year: 2026,
  segment: "spring",
  archivedAt: one.archivedAt,
  fromGames: one.fromGames,
  fromTeams: one.fromTeams,
  teams: one.rows.length,
});

/** The copy, with `values` saved onto whatever it holds. */
const save = async (cloud: MemoryCloud, values: Record<string, unknown>) => {
  const saved = await commitChanges({
    store: cloud.store,
    base: cloud.manifest(),
    changes: Object.entries(values).map(([key, value]) => ({ key, value, at: 1 })),
    device: "phone",
    now: NOW,
  });
  if (!saved.ok) throw new Error("not saved");
};
const archived = async () => {
  const cloud = memoryCloud();
  await save(cloud, {
    league_forecast_scout_age_groups_v1: [],
    [GC_ARCHIVE_KEY]: [entryOf(SPRING)],
    [archiveRowsKey(SPRING.id)]: SPRING,
  });
  return cloud;
};
/** A reader of the copy that counts the pieces it fetched. */
const counted = (store: CloudStore) => {
  const fetched: string[] = [];
  const reader: CopyReader = {
    readManifest: () => store.readManifest(),
    getChunk: (id) => {
      fetched.push(id);
      return store.getChunk(id);
    },
  };
  return { reader, fetched };
};

describe("the finished seasons the cloud's copy lists", () => {
  it("are the copy's index, and each season its own part of rows", async () => {
    const cloud = await archived();
    const decoded: DecodedParts = new Map();
    const read = await readArchiveIndex(cloud.store, decoded);
    expect(read).toEqual({ ok: true, manifest: cloud.manifest(), entries: [entryOf(SPRING)] });
    if (!read.ok) throw new Error("not read");
    expect(await readArchivedSeason(cloud.store, read.manifest, SPRING.id, decoded)).toEqual(
      SPRING
    );
  });

  it("are none for a copy that never archived anything, or no copy at all", async () => {
    const cloud = memoryCloud();
    expect(await readArchiveIndex(cloud.store, new Map())).toEqual({
      ok: true,
      manifest: null,
      entries: [],
    });
    await save(cloud, { league_forecast_scout_age_groups_v1: [] });
    expect(await readArchiveIndex(cloud.store, new Map())).toMatchObject({ ok: true, entries: [] });
  });

  it("read each part once a page load", async () => {
    const cloud = await archived();
    const { reader, fetched } = counted(cloud.store);
    const decoded: DecodedParts = new Map();
    const first = await readArchiveIndex(reader, decoded);
    if (!first.ok) throw new Error("not read");
    await readArchivedSeason(reader, first.manifest, SPRING.id, decoded);
    const once = fetched.length;
    expect(once).toBe(2);
    const again = await readArchiveIndex(reader, decoded);
    if (!again.ok) throw new Error("not read");
    expect(await readArchivedSeason(reader, again.manifest, SPRING.id, decoded)).toEqual(SPRING);
    expect(fetched).toHaveLength(once);
  });

  it("is not read when the copy will not read, and hands nothing over as read", async () => {
    const cloud = await archived();
    const refused: CopyReader = {
      readManifest: () => Promise.reject(new Error("permission-denied")),
      getChunk: () => Promise.reject(new Error("permission-denied")),
    };
    expect(await readArchiveIndex(refused, new Map())).toEqual({ ok: false });
    // The manifest read, and its pieces gone.
    const gone: CopyReader = {
      readManifest: () => cloud.store.readManifest(),
      getChunk: async () => null,
    };
    const decoded: DecodedParts = new Map();
    expect(await readArchiveIndex(gone, decoded)).toEqual({ ok: false });
    expect(decoded.size).toBe(0);
  });
});

describe("a finished season's table", () => {
  it("is none for a season the copy holds no rows of, or rows that will not read", async () => {
    const cloud = await archived();
    const manifest = cloud.manifest();
    expect(await readArchivedSeason(cloud.store, manifest, "arch-elsewhere", new Map())).toBeNull();
    const refused: CopyReader = {
      readManifest: () => Promise.reject(new Error("offline")),
      getChunk: () => Promise.reject(new Error("offline")),
    };
    expect(await readArchivedSeason(refused, manifest, SPRING.id, new Map())).toBeNull();
  });

  it("is read off the copy as it now is when the part listed was replaced and swept since", async () => {
    const cloud = await archived();
    const listed = cloud.manifest() as CloudManifest;
    const was = listed.parts.find(({ key }) => key === archiveRowsKey(SPRING.id));
    const renamed = { ...SPRING, rows: [{ ...SPRING.rows[0]!, teamName: "Placeholder S-2" }] };
    await save(cloud, { [archiveRowsKey(SPRING.id)]: renamed });
    // The old part's pieces swept, as the copy sweeps those of versions it no longer keeps.
    const swept: CopyReader = {
      readManifest: () => cloud.store.readManifest(),
      getChunk: (id) =>
        was && id.startsWith(was.id) ? Promise.resolve(null) : cloud.store.getChunk(id),
    };
    expect(await readArchivedSeason(swept, listed, SPRING.id, new Map())).toEqual(renamed);
  });

  it("is the part the copy now names, though the one it replaced was read this page load", async () => {
    const cloud = await archived();
    const decoded: DecodedParts = new Map();
    expect(await readArchivedSeason(cloud.store, cloud.manifest(), SPRING.id, decoded)).toEqual(
      SPRING
    );
    const renamed = { ...SPRING, rows: [{ ...SPRING.rows[0]!, teamName: "Placeholder S-2" }] };
    await save(cloud, { [archiveRowsKey(SPRING.id)]: renamed });
    expect(await readArchivedSeason(cloud.store, cloud.manifest(), SPRING.id, decoded)).toEqual(
      renamed
    );
  });
});
