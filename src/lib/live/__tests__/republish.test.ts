import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud, type MemoryCloud } from "../../cloud/__tests__/memoryCloud";
import type { CloudStore } from "../../cloud/cloudEngine";
import { commitChanges, type Change } from "../../cloud/cloudEngine";
import { DATA_SCHEMA, type CloudManifest } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import type { SeasonSnapshot } from "../../storage";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { DEFAULT_SETTINGS } from "../../types";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import type { LeagueDocsList } from "../cloudLeague";
import { seasonDocId, seasonToDoc } from "../leagueDocs";
import type { CopyPublish } from "../publishCopy";
import { REPUBLISH_TRIES, republishViews } from "../republish";
import { LIVE_FORMAT, LIVE_SCHEMA, type LiveStore } from "../viewStore";
import { memoryLive, type MemoryLive } from "./memoryLive";

/*
 * The republish after a deploy (`republishViews`, run by `scripts/republish.ts`): it publishes the
 * members' views from the cloud copy only while what is published wants it (none, or an older
 * schema's), answers for the views at its end rather than for its own publish, tries again on the
 * copy as it now stands when a save moved it during the run, and never writes the copy.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 40 });
const T = "2027-04-15T12:00:00.000Z";

/** Each League Standings season as its document, as Firestore's REST interface lists it. */
const DOCS = Object.keys(fixture.seasons).map((id, index) => {
  const stored = fixture.seasons[id];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  const season: SeasonSnapshot = {
    id,
    name: `Season ${index + 1}`,
    createdAt: "2026-08-01T12:00:00.000Z",
    teams,
    matchups,
    logs: coerceLogs(stored?.logs ?? null, matchups),
    bracketLogs: {},
    settings: DEFAULT_SETTINGS,
  };
  return {
    id: seasonDocId(id),
    fields: JSON.parse(JSON.stringify(seasonToDoc(season))) as Record<string, unknown>,
  };
});

/** A cloud copy of the fixture's pool, as a phone saved it, with no League Standings of its own. */
const copied = async (): Promise<{ cloud: MemoryCloud; manifest: CloudManifest }> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  changes.push({ key: LEAGUE_PART, value: { seasons: [] }, at: 1 });
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes,
    device: "phone",
    now: "2027-04-15T11:00:00.000Z",
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  resetTeamRankingsStore();
  return { cloud, manifest: saved.manifest };
};

/** A save to the copy by another device: one more pool value, a version on. */
const saveOn = async (cloud: MemoryCloud, at: number): Promise<CloudManifest> => {
  const base = cloud.manifest();
  if (!base) throw new Error("no copy");
  const saved = await commitChanges({
    store: cloud.store,
    base,
    changes: [{ key: "league_forecast_gc_apart_v1", value: [`gc${at}|gcZ`], at }],
    device: "nightly",
    now: "2027-04-15T11:30:00.000Z",
  });
  if (!saved.ok) throw new Error("the save did not land");
  return saved.manifest;
};

/** The copy's store with every write refused, as the republish opens it (`restServerStores`). */
const readOnly = (store: CloudStore): CloudStore => ({
  ...store,
  putChunk: () => Promise.reject(new Error("the copy was written")),
  deleteChunk: () => Promise.reject(new Error("the copy was written")),
  commitManifest: () => Promise.reject(new Error("the copy was written")),
});

/**
 * A save to the copy once in each try, as its first piece goes up (pieces go up four at a time),
 * told which try it is by `onLoaded`.
 */
const savingOnce = (
  cloud: MemoryCloud,
  everyTry: boolean,
  after: (saved: CloudManifest) => void = () => undefined
) => {
  let attempt = 0;
  const saves = new Map<number, Promise<CloudManifest>>();
  return {
    onLoaded: (_loaded: unknown, _published: unknown, at: number) => {
      attempt = at;
    },
    hook: async () => {
      if (!everyTry && attempt > 1) return;
      if (!saves.has(attempt)) {
        saves.set(
          attempt,
          saveOn(cloud, attempt + 1).then((saved) => {
            after(saved);
            return saved;
          })
        );
      }
      await saves.get(attempt);
    },
    saves,
  };
};

/** `store` running `hook` as each piece goes up, before it does. */
const onUpload = (store: LiveStore, hook: () => Promise<void> | void): LiveStore => ({
  ...store,
  putChunk: async (id, data) => {
    await hook();
    await store.putChunk(id, data);
  },
});

const republish = (
  cloud: MemoryCloud,
  liveStore: LiveStore,
  extra: Partial<Parameters<typeof republishViews>[0]> = {}
) => {
  const views: CopyPublish[] = [];
  return {
    views,
    run: republishViews({
      copyStore: readOnly(cloud.store),
      liveStore,
      today: () => FIXTURE_TODAY,
      now: () => T,
      locale: "en-US",
      onViews: (one) => views.push(one),
      ...extra,
    }),
  };
};

/** What an older build published: these views, said to be of the schema before this build's. */
const olderOf = (live: MemoryLive, changes: Record<string, unknown> = {}) => {
  const meta = live.meta();
  if (!meta) throw new Error("nothing published");
  return { ...structuredClone(meta), schema: LIVE_SCHEMA - 1, ...changes };
};

afterAll(() => {
  resetTeamRankingsStore();
});

describe("the republish after a deploy", { timeout: 30_000 }, () => {
  it("publishes the copy's views where none are published, writing nothing of the copy", async () => {
    const { cloud, manifest } = await copied();
    const live = memoryLive();
    const { run, views } = republish(cloud, live.store);
    expect(await run).toMatchObject({ end: "published", ok: true, tries: 1, found: null });
    expect(views).toHaveLength(1);
    expect(live.meta()).toMatchObject({
      schema: LIVE_SCHEMA,
      copy: { id: manifest.copy, version: manifest.version },
    });
    expect(cloud.manifest()).toEqual(manifest);
  });

  it("publishes them again over an older schema's, and stops at views of this build's", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    await republish(cloud, live.store).run;
    live.setMeta(olderOf(live));
    expect(await republish(cloud, live.store).run).toMatchObject({ end: "published", ok: true });
    expect(live.meta()?.schema).toBe(LIVE_SCHEMA);
    // Now they are this build's: nothing is read of the copy, and nothing written.
    const reads = cloud.costs.reads;
    const writes = live.costs.writes;
    const again = republish(cloud, live.store);
    expect(await again.run).toMatchObject({ end: "not-needed", ok: true, tries: 0 });
    expect(again.views).toHaveLength(0);
    expect(cloud.costs.reads).toBe(reads);
    expect(live.costs.writes).toBe(writes);
  });

  it("leaves a newer build's views alone, and another layout's, reading nothing of the copy", async () => {
    const { cloud } = await copied();
    for (const meta of [
      { format: LIVE_FORMAT, schema: LIVE_SCHEMA + 1 },
      { format: LIVE_FORMAT + 1, schema: 1 },
    ]) {
      const live = memoryLive();
      live.setMeta(meta);
      const reads = cloud.costs.reads;
      expect(await republish(cloud, live.store).run).toMatchObject({
        end: "not-needed",
        ok: true,
      });
      expect(cloud.costs.reads).toBe(reads);
      expect(live.costs.writes).toBe(0);
    }
  });

  it("publishes the version saved during the run, not the one it loaded first", async () => {
    const { cloud, manifest } = await copied();
    const live = memoryLive();
    await republish(cloud, live.store).run;
    // An older build's views of this very copy, none of them of this build's shape.
    const older = olderOf(live, { views: {} });
    live.setMeta(older);
    // The nightly on the build before the deploy saves the copy during the run and publishes it,
    // at the older schema, under the version it saved.
    const saving = savingOnce(cloud, false, (saved) =>
      live.setMeta({
        ...older,
        copy: { id: saved.copy, version: saved.version },
        marks: { [saved.copy]: saved.version },
      })
    );
    const { run, views } = republish(cloud, onUpload(live.store, saving.hook), {
      onLoaded: saving.onLoaded,
    });
    expect(await run).toMatchObject({ end: "published", ok: true, tries: 2 });
    expect(views[0]).toEqual({ ok: false, reason: "copy-moved" });
    expect(saving.saves.size).toBe(1);
    expect(live.meta()?.copy).toEqual({ id: manifest.copy, version: manifest.version + 1 });
    expect(live.meta()?.marks).toEqual({ [manifest.copy]: manifest.version + 1 });
  });

  it("tries again when a season is saved during the run, since the rebuild it asks for may never come", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    const [first, ...rest] = DOCS;
    if (!first) throw new Error("no documents");
    const later = [{ ...first, fields: { ...first.fields, rev: 2, logs: {} } }, ...rest];
    let uploads = 0;
    const leagueDocs: LeagueDocsList = async () => (uploads > 0 ? later : DOCS);
    const { run, views } = republish(
      cloud,
      onUpload(live.store, () => {
        uploads += 1;
      }),
      { leagueDocs }
    );
    expect(await run).toMatchObject({ end: "published", ok: true, tries: 2 });
    expect(views.map((one) => one.ok || one.reason)).toEqual(["league-moved", true]);
    expect(live.meta()?.schema).toBe(LIVE_SCHEMA);
  });

  it("tries again on the copy started afresh during the run, and publishes that one", async () => {
    const { cloud, manifest } = await copied();
    const live = memoryLive();
    let fresh = false;
    const { run, views } = republish(
      cloud,
      onUpload(live.store, () => {
        if (fresh) return;
        fresh = true;
        // Deleted and started again under another id, holding the same pool.
        cloud.setManifest({ ...manifest, copy: "f2e5", version: 1 });
      })
    );
    expect(await run).toMatchObject({ end: "published", ok: true, tries: 2 });
    expect(views[0]).toEqual({ ok: false, reason: "copy-replaced" });
    expect(live.meta()?.copy).toEqual({ id: "f2e5", version: 1 });
  });

  it("tries again when the meta changed under every commit of a try", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    await republish(cloud, live.store).run;
    const older = olderOf(live, { views: {} });
    live.setMeta(older);
    let commits = 0;
    const racing: LiveStore = {
      ...live.store,
      commitMeta: async (token, next) => {
        commits += 1;
        // Another publisher of the older build commits first, three times over.
        if (commits <= 3) live.setMeta({ ...older, builtAt: `2027-04-15T11:0${commits}:00.000Z` });
        return live.store.commitMeta(token, next);
      },
    };
    const { run, views } = republish(cloud, racing);
    expect(await run).toMatchObject({ end: "published", ok: true, tries: 2 });
    expect(views[0]).toEqual({ ok: false, reason: "kept-changing" });
    expect(live.meta()?.schema).toBe(LIVE_SCHEMA);
  });

  it("fails once the copy has moved under every try, with the views still wanting it", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    const saving = savingOnce(cloud, true);
    const { run, views } = republish(cloud, onUpload(live.store, saving.hook), {
      onLoaded: saving.onLoaded,
    });
    expect(await run).toMatchObject({ end: "refused", ok: false, tries: REPUBLISH_TRIES });
    expect(views).toEqual(Array(REPUBLISH_TRIES).fill({ ok: false, reason: "copy-moved" }));
    expect(live.meta()).toBeNull();
  });

  it("is done without publishing when another publisher put out views it cannot replace first", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    const newer = { format: LIVE_FORMAT, schema: LIVE_SCHEMA + 1 };
    const { run } = republish(
      cloud,
      onUpload(live.store, () => {
        if (live.meta() === null) live.setMeta(newer);
      })
    );
    expect(await run).toMatchObject({ end: "published-since", ok: true, tries: 1, now: newer });
  });

  it("fails when its publish is turned away with the members still on an older schema's views", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    await republish(cloud, live.store).run;
    // An older build's views for a later day than the run's: it may not put an earlier day's over
    // them, and no device of this build draws them.
    const older = olderOf(live, { today: "2027-04-16" });
    live.setMeta(older);
    const { run, views } = republish(cloud, live.store);
    expect(await run).toMatchObject({ end: "refused", ok: false, tries: 1 });
    expect(views).toEqual([{ ok: false, reason: "older-day" }]);
    expect(live.meta()?.schema).toBe(LIVE_SCHEMA - 1);
  });

  it("is done once its views are out, though the sweep after them stopped", async () => {
    const { cloud } = await copied();
    const live = memoryLive();
    const sweepless: LiveStore = {
      ...live.store,
      listChunks: () => Promise.reject(new Error("Firestore answered HTTP 503 listing")),
    };
    const { run, views } = republish(cloud, sweepless);
    expect(await run).toMatchObject({ end: "published", ok: true });
    expect(views[0]).toMatchObject({ ok: true, sweep: { ok: false } });
    expect(live.meta()?.schema).toBe(LIVE_SCHEMA);
  });

  it("publishes nothing with no copy, or a copy a newer build saved", async () => {
    const live = memoryLive();
    expect(await republish(memoryCloud(), live.store).run).toMatchObject({
      end: "no-copy",
      ok: true,
      tries: 0,
    });
    const { cloud, manifest } = await copied();
    cloud.setManifest({ ...manifest, schema: DATA_SCHEMA + 1 });
    expect(await republish(cloud, live.store).run).toMatchObject({ end: "newer-copy", ok: true });
    expect(live.costs.writes).toBe(0);
  });
});
