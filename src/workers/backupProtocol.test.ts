import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { poolFixture } from "../../scripts/poolFixture";
import { hashJson, packHashed } from "../lib/cloud/cloudPack";
import { memoryIo } from "../lib/poolMemoryIo";
import { POOL_CHANNEL } from "../lib/poolSync";
import {
  readTeamRankingsBackup,
  teamRankingsCsvSections,
  teamRankingsJsonParts,
  type TeamRankingsBackup,
} from "../lib/teamRankingsBackup";
import { ARCHIVE_VERSION, type ArchivedSeason } from "../lib/teamRankingsArchive";
import {
  flushPoolWrites,
  initTeamRankingsStore,
  isCloudPoolKey,
  loadAllArchivedSeasons,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveArchivedSeasons,
  saveDroppedClubs,
  saveScoutGames,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";
import { backupOfCopy, type PoolPartPieces } from "./backupProtocol";

/*
 * A backup made off the cloud's copy is the one the device holding that pool would make: the same
 * file, to the byte, the same CSV sections and the same pool. Made from the seeded fixture stored
 * through the real storage layer, with an answer and a finished season beside it, and the copy's
 * parts packed from what that store holds, as a save packs them.
 */

const fixture = poolFixture({ seed: 11, clubsPerPage: 30 });
const SAVED_AT = "2027-04-15T07:20:00.000Z";
const ARCHIVED: ArchivedSeason = {
  version: ARCHIVE_VERSION,
  id: "arc_2026_9u",
  name: "9U 2026",
  ageLevel: 9,
  year: 2026,
  archivedAt: "2026-09-17T00:00:00.000Z",
  fromGames: 4,
  fromTeams: 1,
  rows: [
    {
      rank: 1,
      teamName: "Placeholder Club",
      rating: 5,
      record: "4-0",
      wins: 4,
      losses: 0,
      ties: 0,
      games: 4,
      strengthOfSchedule: 0.5,
      sosRank: 1,
      state: "KY",
      crossAgeGames: 0,
    },
  ],
};

let device: { file: string[]; csv: string; backup: TeamRankingsBackup };
let parts: PoolPartPieces[];

beforeAll(async () => {
  resetTeamRankingsStore();
  const io = memoryIo();
  await initTeamRankingsStore(io);
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  saveDroppedClubs(new Set(["gcDROPPED001"]));
  await saveArchivedSeasons([ARCHIVED]);
  expect(await flushPoolWrites()).toBe(true);
  const pool = readTeamRankingsBackup();
  device = {
    file: teamRankingsJsonParts({ ...pool, archives: await loadAllArchivedSeasons() }, SAVED_AT),
    csv: teamRankingsCsvSections(pool),
    backup: pool,
  };
  // Every key this device would keep in the copy, packed as a save packs it.
  parts = [];
  for (const key of (await io.keys()).filter(isCloudPoolKey).sort()) {
    const hashed = await hashJson(await io.get(key));
    parts.push({ key, hash: hashed.hash, chunks: await packHashed(hashed) });
  }
  resetTeamRankingsStore();
});
afterAll(() => resetTeamRankingsStore());

describe("a backup made off the cloud's copy", () => {
  it("is the file, the CSV sections and the pool the device holding it would make", async () => {
    // The fixture is a pool worth backing up, with its finished season among the parts.
    expect(device.backup.teams.length).toBeGreaterThan(100);
    expect(parts.some(({ key }) => key.includes("_archive_rows_"))).toBe(true);
    expect(await backupOfCopy({ parts, want: "file", savedAt: SAVED_AT })).toEqual({
      ok: true,
      file: device.file,
    });
    expect(await backupOfCopy({ parts, want: "csv", savedAt: SAVED_AT })).toEqual({
      ok: true,
      csv: device.csv,
    });
    expect(await backupOfCopy({ parts, want: "backup", savedAt: SAVED_AT })).toEqual({
      ok: true,
      backup: device.backup,
    });
    expect(device.file.join("")).toContain("Placeholder Club");
  });

  it("writes no file of a copy with nothing in it, as the device writes none", async () => {
    const empty = await backupOfCopy({ parts: [], want: "file", savedAt: SAVED_AT });
    expect(empty).toEqual({ ok: true, file: [] });
  });

  it("starts each backup afresh, keeping nothing of the one before", async () => {
    await backupOfCopy({ parts, want: "backup", savedAt: SAVED_AT });
    const teams = parts.filter(({ key }) => key === "league_forecast_scout_teams_v1");
    expect(teams).toHaveLength(1);
    const answer = await backupOfCopy({ parts: teams, want: "backup", savedAt: SAVED_AT });
    // The games of the backup before are not this one's.
    expect(answer.ok && answer.backup?.games).toEqual([]);
    expect(answer.ok && answer.backup?.teams).toEqual(device.backup.teams);
  });

  it("is no backup at all for pieces that do not make their value, or a key this build does not keep", async () => {
    const [first, ...rest] = parts;
    if (!first) throw new Error("no parts");
    const garbled = { ...first, chunks: [new Uint8Array([1, 2, 3])] };
    expect(
      await backupOfCopy({ parts: [garbled, ...rest], want: "file", savedAt: SAVED_AT })
    ).toEqual({ ok: false, why: "damaged" });
    const otherHash = { ...first, hash: "0".repeat(64) };
    expect(
      await backupOfCopy({ parts: [otherHash, ...rest], want: "file", savedAt: SAVED_AT })
    ).toEqual({ ok: false, why: "damaged" });
    const hashed = await hashJson(["anything"]);
    const unknown = {
      key: "league_forecast_something_new_v9",
      hash: hashed.hash,
      chunks: await packHashed(hashed),
    };
    expect(
      await backupOfCopy({ parts: [...parts, unknown], want: "file", savedAt: SAVED_AT })
    ).toEqual({ ok: false, why: "newer" });
  });

  it("calls nothing damaged that this browser cannot check, and leaves the worker to say it failed", async () => {
    // No digest here to check the pieces with: the copy is not at fault.
    vi.stubGlobal("crypto", { subtle: { digest: () => Promise.reject(new Error("no digest")) } });
    try {
      await expect(backupOfCopy({ parts, want: "file", savedAt: SAVED_AT })).rejects.toThrow(
        "no digest"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a backup made off the cloud's copy, heard by the other tabs", () => {
  it("tells no tab of the keys it lays into a store of its own", async () => {
    const heard: string[] = [];
    const tab = new BroadcastChannel(POOL_CHANNEL);
    tab.onmessage = (event: MessageEvent<{ key: string }>) => heard.push(event.data.key);
    try {
      expect(await backupOfCopy({ parts, want: "csv", savedAt: SAVED_AT })).toMatchObject({
        ok: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      tab.close();
    }
    // Each would have every open tab re-read that key from its own store and reload its pool.
    expect(heard).toEqual([]);
  });
});
