import { describe, expect, it, vi } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import { DATA_SCHEMA, type CloudManifest, type ManifestPart } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { LEGACY_GAMES_KEY, TIDY_STAMP_KEY } from "../../teamRankingsStorage";
import { EDIT_DEVICE } from "../editRun";
import { LEAGUE_DOC_SCHEMA, seasonDocId, seasonToDoc } from "../leagueDocs";
import {
  askLeagueRebuild,
  askRebuild,
  planCopyWrite,
  planLeagueWrite,
  REBUILD_SETTLE_S,
  REBUILD_WINDOW_S,
  LIVE_DEVICES,
  LIVE_SPACING_S,
  rebuildTask,
  SERVER_DEVICES,
  type RebuildAsk,
} from "../rebuildPlan";
import { rescored, seasonsOf } from "./leagueDocsFixture";

/*
 * What a save of the copy asks of the views (`rebuildPlan.ts`): whether it could have moved a
 * board, which kind of rebuild, and the one task every save in a window shares.
 */

const h = (n: number) => n.toString(16).padStart(64, "0");
const part = (key: string, hash: string, more: Partial<ManifestPart> = {}): ManifestPart => ({
  key,
  hash,
  bytes: 10,
  chunks: 1,
  id: "0123456789abcdef",
  at: 1,
  by: "phone",
  ...more,
});
const manifest = (parts: ManifestPart[], more: Partial<CloudManifest> = {}): CloudManifest => ({
  format: 2,
  schema: 1,
  copy: "c0ffee",
  version: 4,
  save: "s",
  updatedAt: "2027-04-15T10:00:00.000Z",
  device: "phone",
  parts,
  kept: [],
  ...more,
});

const SHARD = "league_forecast_scout_games_v2:2027";
const PARTS = [
  part(LEAGUE_PART, h(1)),
  part("league_forecast_scout_teams_v1", h(2)),
  part("league_forecast_scout_age_groups_v1", h(3)),
  part("league_forecast_scout_games_v2_index", h(4)),
  part(SHARD, h(5)),
  part("league_forecast_gc_refresh_v1", h(6)),
  part(TIDY_STAMP_KEY, h(7)),
  part("league_forecast_gc_cadence_v1", h(8)),
  part("league_forecast_gc_dropped_clubs_v1", h(9)),
  part("league_forecast_scout_archive_v1", h(10)),
];
const BEFORE = manifest(PARTS);

/** `BEFORE` saved again as version 5, with the part at `key` holding `hash`. */
const saved = (key: string, hash: string, more: Partial<CloudManifest> = {}): CloudManifest =>
  manifest(
    PARTS.map((one) => (one.key === key ? { ...one, hash, id: "fedcba9876543210" } : one)),
    { version: 5, ...more }
  );

describe("whether a save asks for a rebuild", () => {
  it("does not when the copy was deleted, or saved as nothing this build can read", async () => {
    expect(await askRebuild(BEFORE, null)).toEqual({ skip: "deleted" });
    expect(await askRebuild(BEFORE, undefined)).toEqual({ skip: "deleted" });
    expect(await askRebuild(BEFORE, {})).toEqual({ skip: "unreadable" });
    expect(await askRebuild(BEFORE, { ...saved(SHARD, h(50)), format: 1 })).toEqual({
      skip: "unreadable",
    });
    // Unreadable whatever came before it, even nothing.
    expect(await askRebuild(null, "junk")).toEqual({ skip: "unreadable" });
  });

  it("does not when a newer build saved the copy, its first save and a new copy's included", async () => {
    const newer = saved(SHARD, h(50), { schema: DATA_SCHEMA + 1 });
    expect(await askRebuild(BEFORE, newer)).toEqual({ skip: "newer-schema" });
    expect(await askRebuild(null, newer)).toEqual({ skip: "newer-schema" });
    expect(await askRebuild(BEFORE, { ...newer, copy: "beef" })).toEqual({ skip: "newer-schema" });
    // This build's own schema asks as ever.
    expect(await askRebuild(BEFORE, saved(SHARD, h(50), { schema: DATA_SCHEMA }))).toMatchObject({
      ask: { kind: "edit", version: 5 },
    });
    // A part under a key this build does not keep, at this build's schema: a newer build's key.
    const keyed = saved(SHARD, h(50));
    const unknown = { ...keyed, parts: [...keyed.parts, part("a-newer-builds-key", h(60))] };
    expect(await askRebuild(BEFORE, unknown)).toEqual({ skip: "unknown-key" });
    expect(await askRebuild(null, unknown)).toEqual({ skip: "unknown-key" });
    // Every key the copy keeps, League Standings and an archive's rows among them, asks as ever.
    const known = {
      ...keyed,
      parts: [...keyed.parts, part("league_forecast_scout_archive_rows_v1:2026", h(61))],
    };
    expect(await askRebuild(BEFORE, known)).toMatchObject({ ask: { kind: "edit" } });
  });

  it("asks for an edit's rebuild with every input a board reads", async () => {
    const inputs = [
      LEAGUE_PART,
      "league_forecast_scout_teams_v1",
      "league_forecast_scout_age_groups_v1",
      "league_forecast_scout_games_v2_index",
      SHARD,
    ];
    for (const key of inputs) {
      expect(await askRebuild(BEFORE, saved(key, h(50))), key).toEqual({
        ask: { kind: "edit", copy: "c0ffee", version: 5, reset: false },
      });
    }
    // A year's shard added, or taken out, moves the boards as surely as one changed.
    const added = manifest([...PARTS, part("league_forecast_scout_games_v2:2028", h(51))], {
      version: 5,
    });
    expect(await askRebuild(BEFORE, added)).toEqual({
      ask: { kind: "edit", copy: "c0ffee", version: 5, reset: false },
    });
    expect(await askRebuild(added, BEFORE)).toEqual({
      ask: { kind: "edit", copy: "c0ffee", version: 4, reset: false },
    });
    // And an older pool's games under their one key, which the store splits into years.
    const legacy = manifest([...PARTS, part(LEGACY_GAMES_KEY, h(52))]);
    expect(
      await askRebuild(legacy, { ...legacy, parts: [...PARTS, part(LEGACY_GAMES_KEY, h(53))] })
    ).toEqual({ ask: { kind: "edit", copy: "c0ffee", version: 4, reset: false } });
  });

  it("does not when nothing a board reads moved", async () => {
    const others = [
      "league_forecast_gc_refresh_v1",
      TIDY_STAMP_KEY,
      "league_forecast_gc_cadence_v1",
      "league_forecast_gc_real_clubs_v1",
      "league_forecast_scout_archive_v1",
    ];
    for (const key of others) {
      expect(await askRebuild(BEFORE, saved(key, h(50))), key).toEqual({ skip: "no-board-input" });
    }
    // Only the earlier versions kept, or only who saved it and under which upload: the same.
    const keptOnly = manifest(PARTS, {
      version: 5,
      kept: [
        { ...part(SHARD, h(60)), group: "g", keptAt: "2027-04-15T09:00:00.000Z", why: "replaced" },
      ],
    });
    expect(await askRebuild(BEFORE, keptOnly)).toEqual({ skip: "no-board-input" });
    const restamped = manifest(
      PARTS.map((one) => ({ ...one, at: 9, by: "laptop", id: "fedcba9876543210" })).reverse(),
      { version: 6, device: "laptop", save: "t", updatedAt: "2027-04-15T11:00:00.000Z" }
    );
    expect(await askRebuild(BEFORE, restamped)).toEqual({ skip: "no-board-input" });
  });

  it("asks a fresh copy's first boards whatever saved it and whatever it holds", async () => {
    const reset = { ask: { kind: "edit", copy: "c0ffee", version: 4, reset: true } };
    expect(await askRebuild(null, BEFORE)).toEqual(reset);
    expect(await askRebuild(undefined, BEFORE)).toEqual(reset);
    // A previous manifest this build cannot read is no basis for "nothing moved".
    expect(await askRebuild({ format: 1 }, BEFORE)).toEqual(reset);
    // A new copy with the very same inputs, saved by the nightly: still the first boards, and soon.
    const fresh = manifest(PARTS, { copy: "beef", version: 1, device: "nightly" });
    expect(await askRebuild(BEFORE, fresh)).toEqual({
      ask: { kind: "edit", copy: "beef", version: 1, reset: true },
    });
    expect(await askRebuild(null, { ...fresh, device: "nightly" })).toEqual({
      ask: { kind: "edit", copy: "beef", version: 1, reset: true },
    });
  });

  it("asks a server's later check when a server saved it, and only delays it for a name that says so", async () => {
    expect([...SERVER_DEVICES].sort()).toEqual(["nightly"]);
    for (const device of SERVER_DEVICES) {
      expect(await askRebuild(BEFORE, saved(SHARD, h(50), { device })), device).toEqual({
        ask: { kind: "server", copy: "c0ffee", version: 5, reset: false },
      });
    }
    // An edit the edit function made publishes nothing of its own: it is rebuilt soon after.
    expect([...LIVE_DEVICES]).toEqual(["live-edit"]);
    expect(await askRebuild(BEFORE, saved(SHARD, h(50), { device: "live-edit" }))).toEqual({
      ask: { kind: "live", copy: "c0ffee", version: 5, reset: false },
    });
    // The very name the edit function saves under, so a rename there cannot move its saves to a
    // device's two minutes.
    expect(await askRebuild(BEFORE, saved(SHARD, h(50), { device: EDIT_DEVICE }))).toEqual({
      ask: { kind: "live", copy: "c0ffee", version: 5, reset: false },
    });
    // A device is whatever the saving client says; only these exact names are servers. A pull run
    // in the cloud publishes nothing of its own, so its saves are rebuilt as a device's are.
    for (const device of ["Nightly", "nightly ", "phone", "", "cloud-pull", "Live-Edit"]) {
      expect(await askRebuild(BEFORE, saved(SHARD, h(50), { device })), device).toEqual({
        ask: { kind: "edit", copy: "c0ffee", version: 5, reset: false },
      });
    }
    // A save with no device at all reads as a device's.
    const { device: _, ...unnamed } = saved(SHARD, h(50));
    expect(await askRebuild(BEFORE, unnamed)).toEqual({
      ask: { kind: "edit", copy: "c0ffee", version: 5, reset: false },
    });
  });
});

const ASK: RebuildAsk = { kind: "edit", copy: "c0ffee", version: 5, reset: false };
const SERVER: RebuildAsk = { ...ASK, kind: "server" };

describe("the task a save queues", () => {
  it("is one per window: every save in it shares the id, whatever its version", async () => {
    // 10:00 UTC starts a window of either kind: two minutes and a quarter of an hour both divide it.
    const first = await rebuildTask(ASK, "2027-04-15T10:00:00.000Z");
    expect(first.id).toMatch(/^[0-9a-f]{40}$/);
    for (const at of ["2027-04-15T10:01:00.000Z", "2027-04-15T10:01:59.999Z"]) {
      expect((await rebuildTask(ASK, at)).id, at).toBe(first.id);
    }
    expect((await rebuildTask({ ...ASK, version: 9 }, "2027-04-15T10:01:00.000Z")).id).toBe(
      first.id
    );
    // A reset shares it too: what runs reads the copy as it then stands.
    expect((await rebuildTask({ ...ASK, reset: true }, "2027-04-15T10:01:00.000Z")).id).toBe(
      first.id
    );
  });

  it("is another for the next window and the other kind, and the same for another copy", async () => {
    const at = "2027-04-15T10:01:00.000Z";
    const ids = new Set([
      (await rebuildTask(ASK, at)).id,
      (await rebuildTask(ASK, "2027-04-15T10:02:00.000Z")).id,
      (await rebuildTask(ASK, "2027-04-15T09:59:59.999Z")).id,
      (await rebuildTask(SERVER, at)).id,
      (await rebuildTask({ ...ASK, kind: "live" }, at)).id,
    ]);
    expect(ids.size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{40}$/);
    // A run builds whatever copy stands when it runs: saves under new copy ids in one window,
    // a client starting the copy afresh at every save, are still one task.
    expect((await rebuildTask({ ...ASK, copy: "beef", reset: true }, at)).id).toBe(
      (await rebuildTask(ASK, at)).id
    );
    expect((await rebuildTask({ ...SERVER, copy: "beef" }, at)).id).toBe(
      (await rebuildTask(SERVER, at)).id
    );
    // An edit's window and a server's share a number only at times 7.5 times apart: the kind
    // keeps them apart all the same.
    const edit = await rebuildTask(ASK, "1970-01-02T09:20:00.000Z");
    const server = await rebuildTask(SERVER, "1970-01-11T10:00:00.000Z");
    expect(edit.task.window).toBe(server.task.window);
    expect(edit.id).not.toBe(server.id);
  });

  it("runs after its window has closed and settled: five seconds for an edit or a season's, ten minutes for a server, three for an edit made on the server", async () => {
    expect(REBUILD_WINDOW_S).toEqual({ edit: 120, server: 900, live: 15, league: 120 });
    expect(REBUILD_SETTLE_S).toEqual({ edit: 5, server: 600, live: 3, league: 5 });
    expect(LIVE_SPACING_S).toBe(60);
    const live: RebuildAsk = { ...ASK, kind: "live" };
    expect((await rebuildTask(live, "2027-04-15T10:00:14.999Z")).scheduleTime.toISOString()).toBe(
      "2027-04-15T10:00:18.000Z"
    );
    expect((await rebuildTask(live, "2027-04-15T10:00:15.000Z")).scheduleTime.toISOString()).toBe(
      "2027-04-15T10:00:33.000Z"
    );
    const runs = async (ask: RebuildAsk, at: string) =>
      (await rebuildTask(ask, at)).scheduleTime.toISOString();
    for (const at of [
      "2027-04-15T10:00:00.000Z",
      "2027-04-15T10:01:00.000Z",
      "2027-04-15T10:01:59.999Z",
    ]) {
      expect(await runs(ASK, at), at).toBe("2027-04-15T10:02:05.000Z");
    }
    expect(await runs(ASK, "2027-04-15T10:02:00.000Z")).toBe("2027-04-15T10:04:05.000Z");
    for (const at of ["2027-04-15T10:00:00.000Z", "2027-04-15T10:14:59.999Z"]) {
      expect(await runs(SERVER, at), at).toBe("2027-04-15T10:25:00.000Z");
    }
    // An offset is read as the instant it names.
    expect(await runs(ASK, "2027-04-15T06:01:00.000-04:00")).toBe("2027-04-15T10:02:05.000Z");
  });

  it("carries what to log, and refuses a time no one can read", async () => {
    const at = "2027-04-15T10:01:00.000Z";
    const { task } = await rebuildTask(ASK, at);
    expect(task).toEqual({
      copy: "c0ffee",
      kind: "edit",
      window: Date.parse("2027-04-15T10:00:00.000Z") / 120_000,
      savedAt: at,
    });
    // As Firestore gave it, to the microsecond, and with any offset it came with.
    for (const exact of ["2027-04-15T10:01:00.123456Z", "2027-04-15T06:01:00.000-04:00"]) {
      expect((await rebuildTask(ASK, exact)).task, exact).toEqual({ ...task, savedAt: exact });
    }
    await expect(rebuildTask(ASK, "")).rejects.toThrow(/no time/);
    await expect(rebuildTask(ASK, "yesterday")).rejects.toThrow(/no time/);
  });
});

describe("what one write of the copy does", () => {
  const at = "2027-04-15T10:01:00.000Z";
  const asking = saved(SHARD, h(50));

  it("queues the window's task when rebuilds are on", async () => {
    const readSwitch = vi.fn(async () => true);
    expect(
      await planCopyWrite({ before: BEFORE, after: asking, eventTime: at, readSwitch })
    ).toEqual({ enqueue: await rebuildTask(ASK, at), ask: ASK });
    expect(readSwitch).toHaveBeenCalledTimes(1);
  });

  it("queues nothing when they are off", async () => {
    const readSwitch = vi.fn(async () => false);
    expect(
      await planCopyWrite({ before: BEFORE, after: asking, eventTime: at, readSwitch })
    ).toEqual({ skip: "off" });
    expect(readSwitch).toHaveBeenCalledTimes(1);
  });

  it("queues it when the switch cannot be read, since the rebuild reads it again before spending", async () => {
    const rejects = vi.fn(async (): Promise<boolean> => {
      throw new Error("unavailable");
    });
    const throws = vi.fn((): Promise<boolean> => {
      throw new Error("no client");
    });
    for (const readSwitch of [rejects, throws]) {
      expect(
        await planCopyWrite({ before: BEFORE, after: asking, eventTime: at, readSwitch })
      ).toEqual({ enqueue: await rebuildTask(ASK, at), ask: ASK });
      expect(readSwitch).toHaveBeenCalledTimes(1);
    }
  });

  it("reads no switch for a save that asks nothing", async () => {
    const readSwitch = vi.fn(async () => true);
    const cases: [unknown, unknown, string][] = [
      [BEFORE, null, "deleted"],
      [BEFORE, { format: 9 }, "unreadable"],
      [BEFORE, saved("league_forecast_gc_refresh_v1", h(50)), "no-board-input"],
    ];
    for (const [before, after, skip] of cases) {
      expect(await planCopyWrite({ before, after, eventTime: at, readSwitch }), skip).toEqual({
        skip,
      });
    }
    expect(readSwitch).not.toHaveBeenCalled();
  });
});

describe("whether a League Standings season's write asks for a rebuild", () => {
  const [SEASON] = seasonsOf(poolFixture({ seed: 7, clubsPerPage: 10 }).seasons);
  if (!SEASON) throw new Error("no season");
  const ID = seasonDocId(SEASON.id);
  /** The season's document as stored, at write `rev`. */
  const docOf = (season = SEASON, rev = 1) =>
    JSON.parse(JSON.stringify(seasonToDoc(season, rev))) as Record<string, unknown>;
  const BEFORE_DOC = docOf();
  const ask = { ask: { kind: "league", season: ID } };

  it("asks when a team, a game or a score moved", async () => {
    expect(await askLeagueRebuild(BEFORE_DOC, docOf(rescored(SEASON), 2), ID)).toEqual(ask);
    const [game] = SEASON.matchups;
    if (!game) throw new Error("no game");
    const moved = {
      ...SEASON,
      matchups: SEASON.matchups.map((one) =>
        one.id === game.id ? { ...one, date: "2027-06-30" } : one
      ),
    };
    expect(await askLeagueRebuild(BEFORE_DOC, docOf(moved, 2), ID)).toEqual(ask);
    const renamedTeam = {
      ...SEASON,
      teams: SEASON.teams.map((team, index) =>
        index === 0 ? { ...team, name: `${team.name} 2` } : team
      ),
    };
    expect(await askLeagueRebuild(BEFORE_DOC, docOf(renamedTeam, 2), ID)).toEqual(ask);
  });

  it("does not when only what no board reads moved: its name, a setting, a bracket's score", async () => {
    const skip = { skip: "no-board-input" };
    const renamed = { ...SEASON, name: "Another name", updatedAt: "2027-04-16T00:00:00.000Z" };
    expect(await askLeagueRebuild(BEFORE_DOC, docOf(renamed, 2), ID)).toEqual(skip);
    const set = {
      ...SEASON,
      settings: { ...SEASON.settings, goldCutoff: SEASON.settings.goldCutoff + 1 },
    };
    expect(await askLeagueRebuild(BEFORE_DOC, docOf(set, 2), ID)).toEqual(skip);
    const [scored] = Object.values(SEASON.logs);
    if (!scored) throw new Error("no score");
    const bracket = { ...SEASON, bracketLogs: { "final-1": scored } };
    expect(await askLeagueRebuild(BEFORE_DOC, docOf(bracket, 2), ID)).toEqual(skip);
  });

  it("asks when a season is made or deleted, whatever it holds, and when it now reads", async () => {
    expect(await askLeagueRebuild(undefined, BEFORE_DOC, ID)).toEqual(ask);
    expect(await askLeagueRebuild(BEFORE_DOC, null, ID)).toEqual(ask);
    expect(await askLeagueRebuild({ schema: 1 }, BEFORE_DOC, ID)).toEqual(ask);
    expect(await askLeagueRebuild(undefined, null, ID)).toEqual({ skip: "no-document" });
  });

  it("does not for a season this build cannot read, or one a newer build wrote", async () => {
    expect(await askLeagueRebuild(BEFORE_DOC, { schema: 1 }, ID)).toEqual({ skip: "unreadable" });
    expect(
      await askLeagueRebuild(BEFORE_DOC, { ...BEFORE_DOC, schema: LEAGUE_DOC_SCHEMA + 1 }, ID)
    ).toEqual({ skip: "newer-league" });
  });

  it("queues the window's task while rebuilds are on, and reads no switch for a write that asks nothing", async () => {
    const at = "2027-04-15T10:01:00.000Z";
    const after = docOf(rescored(SEASON), 2);
    const on = vi.fn(async () => true);
    const planned = await planLeagueWrite({
      before: BEFORE_DOC,
      after,
      docId: ID,
      eventTime: at,
      readSwitch: on,
    });
    expect(planned).toEqual({
      enqueue: await rebuildTask({ kind: "league", season: ID }, at),
      ask: { kind: "league", season: ID },
    });
    if (!("enqueue" in planned)) throw new Error("not queued");
    // Two minutes' writes share one task, run five seconds after they close.
    expect(planned.enqueue.scheduleTime.toISOString()).toBe("2027-04-15T10:02:05.000Z");
    expect(REBUILD_WINDOW_S.league).toBe(120);
    const off = vi.fn(async () => false);
    expect(
      await planLeagueWrite({
        before: BEFORE_DOC,
        after,
        docId: ID,
        eventTime: at,
        readSwitch: off,
      })
    ).toEqual({ skip: "off" });
    const failing = vi.fn(async (): Promise<boolean> => {
      throw new Error("unavailable");
    });
    expect(
      await planLeagueWrite({
        before: BEFORE_DOC,
        after,
        docId: ID,
        eventTime: at,
        readSwitch: failing,
      })
    ).toMatchObject({ ask: { kind: "league" } });
    const unread = vi.fn(async () => true);
    expect(
      await planLeagueWrite({
        before: BEFORE_DOC,
        after: docOf(SEASON, 2),
        docId: ID,
        eventTime: at,
        readSwitch: unread,
      })
    ).toEqual({ skip: "no-board-input" });
    expect(unread).not.toHaveBeenCalled();
  });
});
