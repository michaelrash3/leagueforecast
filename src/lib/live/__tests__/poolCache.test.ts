import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_TODAY, fingerprint, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges, type Change, type CloudStore } from "../../cloud/cloudEngine";
import { chunkId, DATA_SCHEMA, type CloudManifest } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";
import { encodeScoutGames } from "../../teamRankingsCompact";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  isBoardInputKey,
  LEGACY_GAMES_KEY,
  loadAgeGroups,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveDroppedClubs,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
  TIDY_STAMP_KEY,
} from "../../teamRankingsStorage";
import type { SeasonReader } from "../allKnown";
import { createPoolCache, type PoolEnsure } from "../poolCache";
import { seasonReaderOf } from "../publishCopy";
import { boardViews, buildBoardsAndFacts } from "../views/board";

/*
 * The pool a server keeps between rebuilds (`poolCache.ts`): brought up to each new version of the
 * copy by fetching only what changed, holding exactly what a fresh start on that version holds, and
 * refusing, before it reads a piece, a copy it cannot vouch for.
 */

const fixture = poolFixture({ seed: 5, clubsPerPage: 40 });
const NOW = "2027-04-15T11:00:00.000Z";
const STAMP = "r1|0|0|0|";

const TEAMS = "league_forecast_scout_teams_v1";
const AGE_GROUPS = "league_forecast_scout_age_groups_v1";
const INDEX = "league_forecast_scout_games_v2_index";
const YEAR_2027 = "league_forecast_scout_games_v2:2027";
const NO_YEAR = "league_forecast_scout_games_v2:none";

/** The seasons as a browser puts them in the copy's `league` part. */
const LEAGUE = {
  seasons: Object.entries(fixture.seasons).map(([id, season], index) => ({
    id,
    name: `Season ${index + 1}`,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...season,
    bracketLogs: {},
  })),
};

type Pool = { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] };
const POOL: Pool = { ageGroups: fixture.ageGroups, teams: fixture.teams, games: fixture.games };

/**
 * Every value a browser holding `pool` would put in its cloud copy, League Standings and some keys
 * no board reads among them, as stored.
 */
const copyValues = async (
  pool: Pool,
  { league = LEAGUE, refreshed = "2027-04-14" }: { league?: unknown; refreshed?: string } = {}
): Promise<Map<string, unknown>> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(pool.ageGroups);
  saveScoutTeams(pool.teams);
  saveScoutGames(pool.games);
  saveTidyStamp(STAMP);
  saveRefreshLog({ "9": refreshed });
  saveDroppedClubs(new Set(["S-nobody"]));
  await flushPoolWrites();
  const values = new Map<string, unknown>();
  for (const key of cloudPoolKeys())
    values.set(key, structuredClone(await readCloudPoolValue(key)));
  values.set(LEAGUE_PART, structuredClone(league));
  resetTeamRankingsStore();
  return values;
};

/** What a save from `from` to `to` sends: each value that differs, and null for each one gone. */
const changesBetween = (
  from: ReadonlyMap<string, unknown>,
  to: ReadonlyMap<string, unknown>
): Change[] => [
  ...[...to]
    .filter(([key, value]) => JSON.stringify(from.get(key)) !== JSON.stringify(value))
    .map(([key, value]) => ({ key, value, at: 2 })),
  ...[...from.keys()].filter((key) => !to.has(key)).map((key) => ({ key, value: null, at: 2 })),
];

/** Saves the copy as a phone would: the values that changed from `from`, or all of a first copy. */
const save = async (
  cloud: MemoryCloud,
  from: ReadonlyMap<string, unknown> | null,
  to: ReadonlyMap<string, unknown>
): Promise<CloudManifest> => {
  const saved = await commitChanges({
    store: cloud.store,
    base: cloud.manifest(),
    changes: from
      ? changesBetween(from, to)
      : [...to].map(([key, value]) => ({ key, value, at: 1 })),
    device: "phone",
    now: NOW,
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  return saved.manifest;
};

/** Every write the cache tried on the copy. It must try none. */
const wrote: string[] = [];
afterEach(() => {
  expect(wrote).toEqual([]);
  wrote.length = 0;
});

/**
 * The copy as a rebuild reads it: every write refused (and recorded), the pieces read listed, and
 * `beforeRead` run, once, ahead of the next piece read.
 */
const readOnly = (cloud: MemoryCloud) => {
  const read: string[] = [];
  const refuse = (what: string) => {
    wrote.push(what);
    return Promise.reject(new Error(`the pool cache wrote the copy (${what})`));
  };
  const hooks: { beforeRead: (() => Promise<void>) | null } = { beforeRead: null };
  const store: CloudStore = {
    readManifest: () => cloud.store.readManifest(),
    getChunk: async (id) => {
      const hook = hooks.beforeRead;
      hooks.beforeRead = null;
      if (hook) await hook();
      read.push(id);
      return cloud.store.getChunk(id);
    },
    commitManifest: () => refuse("commitManifest"),
    putChunk: (id) => refuse(`putChunk ${id}`),
    deleteChunk: (id) => refuse(`deleteChunk ${id}`),
  };
  return { store, read, hooks };
};

const ok = (result: PoolEnsure) => {
  if (!result.ok) throw new Error(`the pool was not brought up: ${result.reason}`);
  return result;
};

/** What the store holds, as the loaders read it. */
const held = (readSeason: SeasonReader) => ({
  keys: cloudPoolKeys().sort(),
  ageGroups: fingerprint(loadAgeGroups()),
  teams: fingerprint(loadScoutTeams()),
  games: fingerprint(loadScoutGames()),
  stamp: loadTidyStamp(),
  seasons: fingerprint(Object.keys(fixture.seasons).map((id) => readSeason(id))),
});

/** The boards of what the store holds, as one fingerprint. */
const boardsOf = (readSeason: SeasonReader): string => {
  const ageGroups = loadAgeGroups();
  return fingerprint(
    boardViews(
      ageGroups,
      buildBoardsAndFacts({
        ageGroups,
        teams: loadScoutTeams(),
        gamesOfYear: loadScoutGamesForYear,
        readSeason,
        today: FIXTURE_TODAY,
      })
    )
  );
};

/** The pieces a part is stored in. */
const piecesOf = (manifest: CloudManifest | null, key: string): string[] => {
  const part = manifest?.parts.find((one) => one.key === key);
  if (!part) throw new Error(`no part ${key}`);
  return Array.from({ length: part.chunks }, (_, at) => chunkId(part.id, at));
};

const yearOf = new Map(fixture.ageGroups.map((group) => [group.id, group.year]));
const scoredGame = fixture.games.find(
  (game) => yearOf.get(game.ageGroupId) === 2027 && game.teamAScore !== undefined
);
const SCORED: Pool = {
  ...POOL,
  games: fixture.games.map((game) =>
    game === scoredGame ? { ...game, teamAScore: (game.teamAScore ?? 0) + 7 } : game
  ),
};
const RENAMED: Pool = {
  ...SCORED,
  teams: SCORED.teams.map((team, at) => (at === 3 ? { ...team, name: `${team.name} Gold` } : team)),
};
const REGROUPED: Pool = {
  ...RENAMED,
  ageGroups: RENAMED.ageGroups.map((group, at) =>
    at === 0 ? { ...group, name: `${group.name} (North)` } : group
  ),
};
const SHOWCASE = fixture.ageGroups.find((group) => group.year === undefined)?.id;
const NO_SHOWCASE: Pool = {
  ...REGROUPED,
  games: REGROUPED.games.filter((game) => game.ageGroupId !== SHOWCASE),
};
const LEAGUE_EDITED = { seasons: LEAGUE.seasons.slice(1) };

const MOVED_ON: Pool = {
  ...RENAMED,
  teams: RENAMED.teams.map((team, at) => (at === 4 ? { ...team, name: "Moved On" } : team)),
};
/** The page with no year given one, so its games belong to another year's split. */
const DATED: Pool = {
  ...POOL,
  ageGroups: POOL.ageGroups.map((group) =>
    group.id === SHOWCASE ? { ...group, name: "15U 2027", ageLevel: 15, year: 2027 } : group
  ),
};

/**
 * What a store started afresh on a copy's values holds of what a rebuild reads, as the loaders and
 * the boards read it: the pool's parts laid in as a browser takes a copy, no cache involved.
 */
const coldOf = async (values: ReadonlyMap<string, unknown>) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  const parts = [...values].filter(
    ([key]) => key !== LEAGUE_PART && (isBoardInputKey(key) || key === TIDY_STAMP_KEY)
  );
  if (!(await applyCloudPoolValues(new Map(parts)))) throw new Error("the store refused the copy");
  const readSeason = seasonReaderOf(values.get(LEAGUE_PART));
  if (!readSeason) throw new Error("no seasons");
  const at = { held: held(readSeason), boards: boardsOf(readSeason) };
  resetTeamRankingsStore();
  return at;
};
const COLD = new Map<ReadonlyMap<string, unknown>, Awaited<ReturnType<typeof coldOf>>>();

/*
 * Every copy the tests save, made before any test runs: making one starts the pool store afresh,
 * which would empty the store a cache under test holds.
 */
const V = {
  base: new Map<string, unknown>(),
  scored: new Map<string, unknown>(),
  renamed: new Map<string, unknown>(),
  regrouped: new Map<string, unknown>(),
  noShowcase: new Map<string, unknown>(),
  leagueEdited: new Map<string, unknown>(),
  refreshed: new Map<string, unknown>(),
  movedOn: new Map<string, unknown>(),
  dated: new Map<string, unknown>(),
};
let base = V.base;
beforeAll(async () => {
  V.base = base = await copyValues(POOL);
  V.scored = await copyValues(SCORED);
  V.renamed = await copyValues(RENAMED);
  V.regrouped = await copyValues(REGROUPED);
  V.noShowcase = await copyValues(NO_SHOWCASE);
  V.leagueEdited = await copyValues(NO_SHOWCASE, { league: LEAGUE_EDITED });
  V.refreshed = await copyValues(NO_SHOWCASE, { league: LEAGUE_EDITED, refreshed: "2027-04-15" });
  V.movedOn = await copyValues(MOVED_ON);
  V.dated = await copyValues(DATED);
  for (const values of [
    V.regrouped,
    V.noShowcase,
    V.leagueEdited,
    V.refreshed,
    V.renamed,
    V.base,
  ]) {
    COLD.set(values, await coldOf(values));
  }
});
afterAll(() => {
  resetTeamRankingsStore();
});

describe("a warm pool brought up to a new version", () => {
  it("reads only the parts that changed, and holds what a fresh start on that version holds", async () => {
    expect(scoredGame).toBeDefined();
    expect(base.has(NO_YEAR)).toBe(true);
    const cloud = memoryCloud();
    const { store, read } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const first = ok(await cache.ensure(store));
    expect(first).toMatchObject({ cold: true, gone: [], tries: 1 });
    // The boards' inputs, the tidy stamp and League Standings; not the keys no board reads.
    expect(first.fetched.sort()).toEqual(
      [AGE_GROUPS, TIDY_STAMP_KEY, INDEX, YEAR_2027, NO_YEAR, LEAGUE_PART, TEAMS]
        .concat("league_forecast_scout_games_v2:2026")
        .sort()
    );
    expect(cache.held()).toEqual({ copy: first.manifest.copy, version: 1, keys: 8 });
    const firstBoards = boardsOf(first.readSeason);
    let boards = firstBoards;

    const steps: Array<[string, Map<string, unknown>, string[], string[]]> = [
      ["one game's score", V.scored, [YEAR_2027], []],
      ["a team's name", V.renamed, [TEAMS], []],
      ["a page's name", V.regrouped, [AGE_GROUPS], []],
      ["a year with no games left", V.noShowcase, [INDEX], [NO_YEAR]],
      ["League Standings", V.leagueEdited, [LEAGUE_PART], []],
      ["only what no board reads", V.refreshed, [], []],
    ];
    let from = base;
    for (const [what, values, fetched, gone] of steps) {
      const manifest = await save(cloud, from, values);
      from = values;
      read.length = 0;
      const warm = ok(await cache.ensure(store));
      expect(warm, what).toMatchObject({ cold: false, fetched, gone, tries: 1 });
      expect(warm.manifest.version, what).toBe(manifest.version);
      expect(read.sort(), what).toEqual(fetched.flatMap((key) => piecesOf(manifest, key)).sort());
      expect(warm.pieces, what).toBe(read.length);
      const warmHeld = held(warm.readSeason);
      const warmBoards = boardsOf(warm.readSeason);

      await cache.drop();
      expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
      const cold = ok(await cache.ensure(store));
      expect(cold.cold, what).toBe(true);
      expect(held(cold.readSeason), what).toEqual(warmHeld);
      expect(boardsOf(cold.readSeason), what).toBe(warmBoards);
      boards = warmBoards;
    }
    // And the steps moved the boards, or the comparisons above prove little.
    expect(boards).not.toBe(firstBoards);
  });

  it("reads nothing for a part changed and changed back, though a new upload holds it", async () => {
    const cloud = memoryCloud();
    const { store, read } = readOnly(cloud);
    const cache = createPoolCache();
    const first = await save(cloud, null, base);
    ok(await cache.ensure(store));
    const scored = V.scored;
    await save(cloud, base, scored);
    const back = await save(cloud, scored, base);
    expect(piecesOf(back, YEAR_2027)).not.toEqual(piecesOf(first, YEAR_2027));
    read.length = 0;
    expect(ok(await cache.ensure(store))).toMatchObject({ cold: false, fetched: [], pieces: 0 });
    expect(read).toEqual([]);
  });

  it("starts afresh on a new copy, and keeps nothing the old one had that the new one lacks", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    const old = await save(cloud, null, base);
    ok(await cache.ensure(store));
    // A reset: a copy made afresh, with no tidy stamp and no games outside a year.
    cloud.setManifest(null);
    const fresh = new Map([...V.noShowcase].filter(([key]) => key !== TIDY_STAMP_KEY));
    const made = await save(cloud, null, fresh);
    expect(made.copy).not.toBe(old.copy);
    const ensured = ok(await cache.ensure(store));
    expect(ensured).toMatchObject({ cold: true, gone: [] });
    expect(ensured.manifest.copy).toBe(made.copy);
    expect(loadTidyStamp()).toBeNull();
    expect(cloudPoolKeys()).not.toContain(NO_YEAR);
    expect(cache.held()).toEqual({ copy: made.copy, version: 1, keys: 6 });
  });

  it("starts afresh after a write to the store it did not make, and a build makes none", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const first = ok(await cache.ensure(store));
    boardsOf(first.readSeason);
    expect(ok(await cache.ensure(store))).toMatchObject({ cold: false, fetched: [] });
    saveTidyStamp("r1|written here");
    expect(ok(await cache.ensure(store))).toMatchObject({ cold: true });
    expect(loadTidyStamp()).toBe(STAMP);
    // And having started afresh, it is warm again: the write was forgotten with the store.
    expect(ok(await cache.ensure(store))).toMatchObject({ cold: false, fetched: [] });
  });

  it("holds what a fresh start holds after warm bring-ups one after another, there and back", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, V.regrouped);
    ok(await cache.ensure(store));
    // A year left with no games, then back; a score, then back. No fresh start between.
    const steps: Array<[Map<string, unknown>, string[], string[], number]> = [
      [V.noShowcase, [INDEX], [NO_YEAR], 7],
      // League Standings, then only what no board reads: the seasons stay the ones just taken in.
      [V.leagueEdited, [LEAGUE_PART], [], 7],
      [V.refreshed, [], [], 7],
      [V.regrouped, [INDEX, NO_YEAR, LEAGUE_PART], [], 8],
      [V.renamed, [AGE_GROUPS], [], 8],
      [V.base, [YEAR_2027, TEAMS], [], 8],
    ];
    let from = V.regrouped;
    for (const [values, fetched, gone, keys] of steps) {
      const manifest = await save(cloud, from, values);
      from = values;
      const warm = ok(await cache.ensure(store));
      expect(warm).toMatchObject({ cold: false, gone });
      expect(warm.fetched.sort()).toEqual([...fetched].sort());
      expect(cache.held()).toEqual({ copy: manifest.copy, version: manifest.version, keys });
      // Against the copy's values laid into a store started afresh, taken before any test ran, so
      // this cache stays warm from one step to the next.
      expect({ held: held(warm.readSeason), boards: boardsOf(warm.readSeason) }).toEqual(
        COLD.get(values)
      );
    }
  });

  it("reads no seasons once the copy has no League Standings, holding what a fresh start holds", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    const first = await save(cloud, null, base);
    ok(await cache.ensure(store));
    const noLeague = new Map([...base].filter(([key]) => key !== LEAGUE_PART));
    expect((await save(cloud, base, noLeague)).copy).toBe(first.copy);
    const warm = ok(await cache.ensure(store));
    expect(warm).toMatchObject({ cold: false, fetched: [], gone: [LEAGUE_PART] });
    const [season] = Object.keys(fixture.seasons);
    expect(warm.readSeason(season ?? "")).toEqual({ teams: [], matchups: [], logs: {} });
    const warmHeld = held(warm.readSeason);
    const warmBoards = boardsOf(warm.readSeason);
    await cache.drop();
    const cold = ok(await cache.ensure(store));
    expect(held(cold.readSeason)).toEqual(warmHeld);
    expect(boardsOf(cold.readSeason)).toBe(warmBoards);
  });

  it("empties the store only once a bring-up under way has finished", async () => {
    const cloud = memoryCloud();
    const { store, hooks } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    ok(await cache.ensure(store));
    await save(cloud, base, V.scored);
    let dropped: Promise<void> | undefined;
    hooks.beforeRead = async () => {
      dropped = cache.drop();
    };
    const ensured = cache
      .ensure(store)
      .then((result) => ({ result, keys: cloudPoolKeys().length }));
    const { result, keys } = await ensured;
    expect(result).toMatchObject({ ok: true, cold: false, fetched: [YEAR_2027] });
    expect(keys).toBe(7);
    await dropped;
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
  });

  it("waits for one bring-up to finish before starting the next", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const [first, second] = await Promise.all([cache.ensure(store), cache.ensure(store)]);
    expect(first).toMatchObject({ ok: true, cold: true });
    expect(second).toMatchObject({ ok: true, cold: false, fetched: [] });
  });
});

describe("a copy the pool cannot vouch for", () => {
  it("is refused before any piece is read when a newer build saved it or it holds a key this build does not keep", async () => {
    const cloud = memoryCloud();
    const { store, read } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const first = ok(await cache.ensure(store));
    const before = held(first.readSeason);
    const renamed = await save(cloud, base, V.renamed);

    read.length = 0;
    cloud.setManifest({ ...renamed, schema: DATA_SCHEMA + 1 });
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "newer-schema" });
    const teams = renamed.parts.find((part) => part.key === TEAMS);
    if (!teams) throw new Error("no teams");
    cloud.setManifest({
      ...renamed,
      parts: [...renamed.parts, { ...teams, key: "league_forecast_scout_rivals_v1" }],
    });
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "unknown-key" });
    expect(read).toEqual([]);
    // And what the store held is held still.
    expect(held(first.readSeason)).toEqual(before);
    expect(cache.held()).toEqual({ copy: renamed.copy, version: 1, keys: 8 });

    // An archive's rows are a key this build keeps, and no board reads them.
    cloud.setManifest({
      ...renamed,
      parts: [...renamed.parts, { ...teams, key: "league_forecast_scout_archive_rows_v1:a1" }],
    });
    expect(ok(await cache.ensure(store)).fetched.sort()).toEqual([YEAR_2027, TEAMS]);
  });

  it("is refused when newer rules tidied it, holding it until rules it knows tidy it again", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    const newer = new Map(base).set(TIDY_STAMP_KEY, "r999|0|0|0|");
    await save(cloud, null, newer);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "newer-rules" });
    await save(cloud, newer, base);
    expect(ok(await cache.ensure(store))).toMatchObject({
      cold: false,
      fetched: [TIDY_STAMP_KEY],
    });
  });

  it("is refused when its League Standings part holds anything but seasons, the store untouched", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const first = ok(await cache.ensure(store));
    const before = held(first.readSeason);
    const junk = new Map(base).set(LEAGUE_PART, { seasons: [{ name: "no id" }] });
    await save(cloud, base, junk);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "league-unreadable" });
    expect(held(first.readSeason)).toEqual(before);
  });

  it("is none at all once the copy is gone, and the store is emptied", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    ok(await cache.ensure(store));
    cloud.setManifest(null);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "no-copy" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
    expect(cloudPoolKeys()).toEqual([]);
  });
});

describe("a piece that is not there", () => {
  it("is read again from the newer copy when a save replaced it mid-fetch", async () => {
    const cloud = memoryCloud();
    const { store, hooks } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    ok(await cache.ensure(store));
    const renamed = V.renamed;
    await save(cloud, base, renamed);
    // The next save lands while the teams are being fetched, and deletes the pieces they were in.
    const again = V.movedOn;
    hooks.beforeRead = async () => {
      await save(cloud, renamed, again);
    };
    const ensured = ok(await cache.ensure(store));
    expect(ensured).toMatchObject({ cold: false, tries: 2 });
    expect(ensured.fetched.sort()).toEqual([YEAR_2027, TEAMS]);
    expect(ensured.manifest.version).toBe(3);
    expect(loadScoutTeams()[4]?.name).toBe("Moved On");
    const warm = held(ensured.readSeason);
    await cache.drop();
    expect(held(ok(await cache.ensure(store)).readSeason)).toEqual(warm);
  });

  it("is damage when the copy still names it, as is a piece that is not what it says", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const first = ok(await cache.ensure(store));
    const before = held(first.readSeason);
    const renamed = await save(cloud, base, V.renamed);
    const [piece] = piecesOf(renamed, TEAMS);
    if (!piece) throw new Error("no piece");
    const kept = cloud.chunks.get(piece);
    cloud.chunks.delete(piece);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "damaged" });
    cloud.chunks.set(piece, new Uint8Array([1, 2, 3]));
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "damaged" });
    expect(held(first.readSeason)).toEqual(before);
    if (kept) cloud.chunks.set(piece, kept);
    expect(ok(await cache.ensure(store)).fetched.sort()).toEqual([YEAR_2027, TEAMS]);
  });

  it("gives up when saves keep replacing what is being read", async () => {
    const cloud = memoryCloud();
    const { store, hooks } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const first = ok(await cache.ensure(store));
    const before = held(first.readSeason);
    let from = base;
    let round = 0;
    const another = async () => {
      round += 1;
      const next = new Map(from).set(TEAMS, { ...(from.get(TEAMS) as object), round });
      await save(cloud, from, next);
      from = next;
      hooks.beforeRead = another;
    };
    await another();
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "kept-moving" });
    expect(round).toBe(4);
    expect(held(first.readSeason)).toEqual(before);
  });
});

describe("an older pool's games, kept under one key", () => {
  /** `values` with the games under the one key an older pool kept them in, as it saved them. */
  const legacy = (values: ReadonlyMap<string, unknown>, pool: Pool) =>
    new Map([
      ...[...values].filter(([key]) => !key.startsWith("league_forecast_scout_games_v2")),
      [LEGACY_GAMES_KEY, encodeScoutGames(pool.games)],
    ]);

  it("give the boards a pool split into years gives, and are split again whenever the copy moves", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const modern = boardsOf(ok(await cache.ensure(store)).readSeason);

    const older = memoryCloud();
    const reader = readOnly(older);
    const old = legacy(base, POOL);
    await save(older, null, old);
    const first = ok(await cache.ensure(reader.store));
    expect(first.cold).toBe(true);
    expect(boardsOf(first.readSeason)).toBe(modern);

    const moved = legacy(V.dated, DATED);
    await save(older, old, moved);
    expect(changesBetween(old, moved).map(({ key }) => key)).toEqual([AGE_GROUPS]);
    const next = ok(await cache.ensure(reader.store));
    expect(next.cold).toBe(true);
    const boards = boardsOf(next.readSeason);
    await cache.drop();
    expect(boardsOf(ok(await cache.ensure(reader.store)).readSeason)).toBe(boards);
    expect(boards).not.toBe(modern);
  });

  it("are left behind whole when the copy is next saved by year, years the store split included", async () => {
    // A device takes the older copy in, splits it, and saves it by year with a page's games gone.
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    const old = legacy(base, POOL);
    await save(cloud, null, old);
    ok(await cache.ensure(store));
    expect(cloudPoolKeys()).toContain(NO_YEAR);
    await save(cloud, old, V.noShowcase);
    const next = ok(await cache.ensure(store));
    expect(next.cold).toBe(true);
    expect(cloudPoolKeys()).not.toContain(NO_YEAR);
    expect(loadScoutGamesForYear(undefined)).toEqual([]);
    const boards = boardsOf(next.readSeason);
    await cache.drop();
    expect(boardsOf(ok(await cache.ensure(store)).readSeason)).toBe(boards);
  });

  it("are taken in afresh when a copy held by year is saved again with them", async () => {
    // An older build saves the copy with its games under the one key once more.
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    await save(cloud, null, base);
    const modern = boardsOf(ok(await cache.ensure(store)).readSeason);
    await save(cloud, base, legacy(base, POOL));
    const next = ok(await cache.ensure(store));
    expect(next.cold).toBe(true);
    expect(boardsOf(next.readSeason)).toBe(modern);
  });

  it("end the bring-up when the store will not take the one key, or the years split from it", async () => {
    // Found by Codex on the pull request: either way the store opened holding no games, and a
    // build would have read none.
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    await save(cloud, null, legacy(base, POOL));
    for (const refused of [
      (key: string) => key === LEGACY_GAMES_KEY,
      (key: string) => key.startsWith("league_forecast_scout_games_v2"),
    ]) {
      const cache = createPoolCache({
        io: () => {
          const io = memoryIo();
          return {
            ...io,
            set: (key, value) => (refused(key) ? Promise.resolve(false) : io.set(key, value)),
          };
        },
      });
      expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
      expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
    }
  });

  it("end the bring-up when the store cannot open on a copy of nothing but them", async () => {
    // Found by Codex on the pull request: an opening that failed read the one key as empty, which
    // passed for the split having emptied it.
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    await save(cloud, null, new Map([[LEGACY_GAMES_KEY, encodeScoutGames(POOL.games)]]));
    const cache = createPoolCache({
      io: () => ({
        ...memoryIo(),
        keys: () => Promise.reject(new Error("the store will not list")),
      }),
    });
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
  });

  it("are split over any year the copy also holds, and the copy is still taken in", async () => {
    // A copy holding both: its years, the showcase page's among them, and the older one key, which
    // has every game but the showcase page's. Opening splits the one key over the years and empties
    // the showcase year, as a browser's store does.
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache();
    const mixed = new Map(base).set(
      LEGACY_GAMES_KEY,
      encodeScoutGames(POOL.games.filter((game) => game.ageGroupId !== SHOWCASE))
    );
    await save(cloud, null, mixed);
    const first = ok(await cache.ensure(store));
    expect(loadScoutGamesForYear(undefined)).toEqual([]);
    expect(boardsOf(first.readSeason)).toBe(boardsOf(ok(await cache.ensure(store)).readSeason));
  });
});

describe("a store that will not take a value", () => {
  it("ends the bring-up and empties the store, on a fresh start and on a warm one", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    let refusing = true;
    const cache = createPoolCache({
      io: () => {
        const io = memoryIo();
        return {
          ...io,
          set: (key, value) => (refusing ? Promise.resolve(false) : io.set(key, value)),
        };
      },
    });
    await save(cloud, null, base);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
    refusing = false;
    ok(await cache.ensure(store));
    refusing = true;
    await save(cloud, base, V.renamed);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
  });

  it("ends the bring-up when the store refuses only one value on a fresh start", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache({
      io: () => {
        const io = memoryIo();
        return {
          ...io,
          set: (key, value) => (key === YEAR_2027 ? Promise.resolve(false) : io.set(key, value)),
        };
      },
    });
    await save(cloud, null, base);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
  });

  it("ends the bring-up when the store cannot open on what was laid in", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    const cache = createPoolCache({
      io: () => ({
        ...memoryIo(),
        keys: () => Promise.reject(new Error("the store will not list")),
      }),
    });
    await save(cloud, null, base);
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
  });

  it("ends the bring-up emptied when laying a value in throws, and starts afresh next time", async () => {
    const cloud = memoryCloud();
    const { store } = readOnly(cloud);
    let throwing = false;
    const cache = createPoolCache({
      io: () => {
        const io = memoryIo();
        return {
          ...io,
          set: (key, value) =>
            throwing ? Promise.reject(new Error("the store broke")) : io.set(key, value),
        };
      },
    });
    await save(cloud, null, base);
    ok(await cache.ensure(store));
    // A new copy, so the next bring-up starts the store afresh and lays every value in.
    cloud.setManifest(null);
    await save(cloud, null, V.renamed);
    throwing = true;
    expect(await cache.ensure(store)).toEqual({ ok: false, reason: "store-refused" });
    expect(cache.held()).toEqual({ copy: null, version: null, keys: 0 });
    expect(cloudPoolKeys()).toEqual([]);
    throwing = false;
    expect(ok(await cache.ensure(store)).cold).toBe(true);
  });
});
