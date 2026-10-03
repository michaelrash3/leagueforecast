import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges } from "../../cloud/cloudEngine";
import { chunkId, type CloudManifest } from "../../cloud/cloudManifest";
import { unpackChunks } from "../../cloud/cloudPack";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import type { SeasonReader } from "../allKnown";
import { dryLiveStore, publishCopyViews, seasonReaderOf } from "../publishCopy";
import { RETIRE_GRACE_MS, STRAY_AGE_MS, publishViews, sweepViews } from "../viewStore";
import { boardViews, buildAllBoards } from "../views/board";
import { memoryLive, type MemoryLive } from "./memoryLive";

/*
 * What the nightly publishes once it has saved the copy (`publishCopyViews`): the boards of the pool
 * in its store and the copy's own League Standings, the same boards a browser holding that copy
 * draws, under the copy and version it saved.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const T = "2027-04-15T12:00:00.000Z";
const EMPTY = { teams: [], matchups: [], logs: {} };

/** The seasons as a browser's storage loaders hand them over (`boardParity.test.ts`): coerced. */
const storedSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

/** The seasons as a browser puts them in the copy's `league` part: every season, whole. */
const LEAGUE = {
  seasons: Object.entries(fixture.seasons).map(([id, season], index) => ({
    id,
    name: `Season ${index + 1}`,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...season,
    bracketLogs: {},
  })),
};

/** A copy holding `league` (none at all when undefined), as a phone saved it. */
const copyWith = async (
  league: unknown
): Promise<{ cloud: MemoryCloud; manifest: CloudManifest }> => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes:
      league === undefined
        ? [{ key: "league_forecast_gc_apart_v1", value: [], at: 1 }]
        : [{ key: LEAGUE_PART, value: league, at: 1 }],
    device: "phone",
    now: "2027-04-15T11:00:00.000Z",
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  return { cloud, manifest: saved.manifest };
};

const boardsWith = (readSeason: SeasonReader) =>
  boardViews(
    loadAgeGroups(),
    buildAllBoards({
      ageGroups: loadAgeGroups(),
      teams: loadScoutTeams(),
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today: FIXTURE_TODAY,
    })
  );

const decode = async (live: MemoryLive, key: string): Promise<unknown> => {
  const entry = live.meta()?.views[key];
  if (!entry) throw new Error(`no view ${key}`);
  const pieces = Array.from({ length: entry.c }, (_, index) => {
    const piece = live.chunks.get(chunkId(entry.id, index))?.data;
    if (!piece) throw new Error(`piece ${index} of ${key} is gone`);
    return piece;
  });
  return unpackChunks(pieces, entry.h);
};

const publish = (cloud: MemoryCloud, live: MemoryLive, manifest: CloudManifest, locale = "en-US") =>
  publishCopyViews({
    copyStore: cloud.store,
    liveStore: live.store,
    manifest,
    today: FIXTURE_TODAY,
    now: () => T,
    locale,
  });

beforeAll(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
});
afterAll(() => {
  resetTeamRankingsStore();
});

describe("publishing the copy's boards", () => {
  it("publishes the boards a browser holding the copy draws, under the copy and version saved", async () => {
    const { cloud, manifest } = await copyWith(LEAGUE);
    const live = memoryLive();
    const result = await publish(cloud, live, manifest);
    expect(result).toMatchObject({
      ok: true,
      boards: 33,
      publish: { wrote: true, uploaded: 29 },
      sweep: { deleted: 0, strays: 0 },
    });
    expect(live.meta()?.copy).toEqual({ id: manifest.copy, version: manifest.version });
    expect(live.meta()?.today).toBe(FIXTURE_TODAY);

    const browser = boardsWith(storedSeason);
    expect(Object.keys(live.meta()?.views ?? {})).toEqual(browser.map(({ key }) => key).sort());
    for (const { key, value } of browser) {
      expect(await decode(live, key)).toEqual(JSON.parse(JSON.stringify(value)));
    }
    // And the seasons are what made them so: without them, some board would read otherwise.
    const without = boardsWith(() => EMPTY);
    const differs = await Promise.all(
      without.map(async ({ key, value }) => {
        const published = await decode(live, key);
        return JSON.stringify(published) !== JSON.stringify(value);
      })
    );
    expect(differs.some(Boolean)).toBe(true);

    // The same copy published again writes nothing.
    const writes = live.costs.writes;
    const again = await publish(cloud, live, manifest);
    expect(again).toMatchObject({ ok: true, publish: { wrote: false, unchanged: 33 } });
    expect(live.costs.writes).toBe(writes);
  });

  it("builds from no seasons when the copy has no League Standings, as a browser with none does", async () => {
    const { cloud, manifest } = await copyWith(undefined);
    const live = memoryLive();
    expect(await publish(cloud, live, manifest)).toMatchObject({ ok: true, boards: 33 });
    for (const { key, value } of boardsWith(() => EMPTY)) {
      expect(await decode(live, key)).toEqual(JSON.parse(JSON.stringify(value)));
    }
  });

  it("refuses under any collation but English, before it reads or writes anything", async () => {
    const { cloud, manifest } = await copyWith(LEAGUE);
    for (const locale of ["de-DE", "und", "sv", "et", "es-MX", "enq"]) {
      const live = memoryLive();
      const reads = cloud.costs.reads;
      expect(await publish(cloud, live, manifest, locale)).toEqual({ ok: false, reason: "locale" });
      expect(cloud.costs.reads).toBe(reads);
      expect(live.costs).toEqual({ reads: 0, writes: 0, deletes: 0 });
    }
    expect(await publish(cloud, memoryLive(), manifest, "en")).toMatchObject({ ok: true });
    expect(await publish(cloud, memoryLive(), manifest, "en-GB")).toMatchObject({ ok: true });
  });

  it("publishes nothing when the League Standings part is missing, damaged or not seasons", async () => {
    const missing = await copyWith(LEAGUE);
    const part = missing.manifest.parts.find((one) => one.key === LEAGUE_PART);
    if (!part) throw new Error("no league part");
    missing.cloud.chunks.delete(chunkId(part.id, 0));
    const damaged = await copyWith(LEAGUE);
    const piece = chunkId(
      damaged.manifest.parts.find((one) => one.key === LEAGUE_PART)?.id ?? "",
      0
    );
    damaged.cloud.chunks.set(piece, new Uint8Array([1, 2, 3]));
    const junk = await copyWith({ seasons: [{ name: "no id" }] });
    // A dry run's would-be copy: a version the store never had, naming the same damaged part.
    const wouldBe = {
      ...damaged,
      manifest: { ...damaged.manifest, version: damaged.manifest.version + 1 },
    };
    for (const { cloud, manifest } of [missing, damaged, junk, wouldBe]) {
      const live = memoryLive();
      expect(await publish(cloud, live, manifest)).toEqual({
        ok: false,
        reason: "league-unreadable",
      });
      expect(live.costs.writes).toBe(0);
    }
  });

  it("says the copy moved on, not that it is damaged, when a device saved League Standings meanwhile", async () => {
    const { cloud, manifest } = await copyWith(LEAGUE);
    const before = chunkId(manifest.parts.find((one) => one.key === LEAGUE_PART)?.id ?? "", 0);
    // A phone saves a season during the run, which deletes the pieces it replaced at once.
    const saved = await commitChanges({
      store: cloud.store,
      base: manifest,
      changes: [{ key: LEAGUE_PART, value: { seasons: LEAGUE.seasons.slice(1) }, at: 2 }],
      device: "phone",
      now: "2027-04-15T11:30:00.000Z",
    });
    expect(saved.ok).toBe(true);
    expect(cloud.chunks.has(before)).toBe(false);
    const live = memoryLive();
    expect(await publish(cloud, live, manifest)).toEqual({ ok: false, reason: "copy-moved" });
    expect(live.costs.writes).toBe(0);
  });

  it("publishes nothing when the copy was started again while the boards were built", async () => {
    const { cloud, manifest } = await copyWith(LEAGUE);
    let reads = 0;
    // The copy as read just before publishing: deleted and started again under another id.
    const replaced = {
      ...cloud.store,
      readManifest: async () => {
        reads += 1;
        return { ...manifest, copy: "fresh", version: 1 };
      },
    };
    const live = memoryLive();
    const result = await publishCopyViews({
      copyStore: replaced,
      liveStore: live.store,
      manifest,
      today: FIXTURE_TODAY,
      now: () => T,
      locale: "en-US",
    });
    expect(result).toEqual({ ok: false, reason: "copy-replaced" });
    expect(reads).toBe(1);
    expect(live.costs).toEqual({ reads: 0, writes: 0, deletes: 0 });
  });

  it("publishes the views though the sweep after it fails, and says how the sweep ended", async () => {
    const { cloud, manifest } = await copyWith(LEAGUE);
    const live = memoryLive();
    const failing = {
      ...live.store,
      listChunks: async () => {
        throw new Error("Firestore answered HTTP 503 listing the views' pieces");
      },
    };
    const result = await publishCopyViews({
      copyStore: cloud.store,
      liveStore: failing,
      manifest,
      today: FIXTURE_TODAY,
      now: () => T,
      locale: "en-US",
    });
    expect(result).toMatchObject({
      ok: true,
      publish: { wrote: true, uploaded: 29 },
      sweep: { ok: false, why: "Firestore answered HTTP 503 listing the views' pieces" },
    });
    expect(live.meta()?.copy).toEqual({ id: manifest.copy, version: manifest.version });
  });

  it("passes on a publish the meta refuses, and sweeps nothing after it", async () => {
    const { cloud, manifest } = await copyWith(LEAGUE);
    const live = memoryLive();
    live.setMeta({ format: 0 });
    expect(await publish(cloud, live, manifest)).toEqual({ ok: false, reason: "unreadable" });
    expect(live.costs.deletes).toBe(0);
  });
});

describe("the seasons a copy's League Standings part holds", () => {
  it("are read as a backup file's, and an id it lacks reads empty", () => {
    const read = seasonReaderOf(JSON.parse(JSON.stringify(LEAGUE)));
    const [first] = Object.keys(fixture.seasons);
    if (!read || !first) throw new Error("no seasons");
    expect(read(first)).toEqual(storedSeason(first));
    expect(read("not-a-season")).toEqual(EMPTY);
  });

  it("are none, for every id, when there is no part or it holds no seasons", () => {
    expect(seasonReaderOf(undefined)?.("any")).toEqual(EMPTY);
    expect(seasonReaderOf({ seasons: [] })?.("any")).toEqual(EMPTY);
  });

  it("are refused when the part holds anything else", () => {
    expect(seasonReaderOf("league")).toBeNull();
    expect(seasonReaderOf({ seasons: [{ name: "no id" }] })).toBeNull();
    expect(seasonReaderOf({ teams: [], matchups: [], logs: {} })).toBeNull();
  });
});

describe("a dry run's published views", () => {
  it("write and delete nothing, and count a piece the sweep would delete once, not as a stray too", async () => {
    const live = memoryLive();
    const at = (ms: number) => new Date(Date.parse(T) + ms).toISOString();
    const put = (value: string, now: string) =>
      publishViews({
        store: live.store,
        views: [{ key: "board:k", value }],
        owns: ["board:"],
        copy: { id: "c0ffee", version: value === "A" ? 1 : 2 },
        today: FIXTURE_TODAY,
        now,
      });
    await put("A", T);
    const retired = live.meta()?.views["board:k"]?.id;
    await put("B", T);
    const meta = live.meta();
    const costs = { ...live.costs };
    // A day on: the retired piece is past its grace and older than any stray.
    const dry = await sweepViews({ store: dryLiveStore(live.store), now: at(STRAY_AGE_MS * 24) });
    expect(dry).toEqual({ ok: true, deleted: 1, strays: 0 });
    expect(live.costs.writes).toBe(costs.writes);
    expect(live.costs.deletes).toBe(0);
    expect(live.meta()).toEqual(meta);
    expect(live.chunks.has(`${retired}-0`)).toBe(true);
    // The same sweep, live, finds the same.
    expect(await sweepViews({ store: live.store, now: at(STRAY_AGE_MS * 24) })).toEqual(dry);
    expect(RETIRE_GRACE_MS).toBeLessThan(STRAY_AGE_MS * 24);
  });
});
