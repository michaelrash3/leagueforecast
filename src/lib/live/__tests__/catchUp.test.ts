import { describe, expect, it, vi } from "vitest";
import type { CloudManifest, ManifestPart } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { newPullJob, newRefreshJob, type PullJob } from "../../cloud/pullJobs";
import { NIGHTLY_HOLD_MS, REFRESH_QUIET_MS } from "../../cloud/refreshGate";
import { BOARD_FAMILY, builtFrom } from "../boardInputs";
import {
  CATCH_UP_SETTLE_MS,
  boardsBehind,
  catchUpDecision,
  heldBy,
  pullWritesCopy,
  stillBehind,
  type WritersLook,
} from "../catchUp";
import type { CloudLeague } from "../cloudLeague";
import { BOARD_RULES, BOARD_SHAPE } from "../views/boardShape";
import { LIVE_FORMAT, LIVE_SCHEMA, type BuiltFrom, type LiveMeta } from "../viewStore";

/*
 * The boards caught up with the copy between nights (`catchUp.ts`, run by `scripts/catchUp.ts`):
 * behind the copy or not, and, where they are, whether anything at work on the copy or the boards
 * would have a publish now run beside it.
 */

const h = (n: number) => n.toString(16).padStart(64, "0");
const part = (key: string, hash: string): ManifestPart => ({
  key,
  hash,
  bytes: 10,
  chunks: 1,
  id: "0123456789abcdef",
  at: 1,
  by: "phone",
});
const PARTS = [
  part(LEAGUE_PART, h(1)),
  part("league_forecast_scout_teams_v1", h(2)),
  part("league_forecast_scout_age_groups_v1", h(3)),
  part("league_forecast_scout_games_v2_index", h(4)),
  part("league_forecast_scout_games_v2:2027", h(5)),
  // The refresh log, which no board reads.
  part("league_forecast_gc_refresh_v1", h(6)),
];
const copyAt = (version: number, parts = PARTS, more: Partial<CloudManifest> = {}) => ({
  format: 2,
  schema: 1,
  copy: "c0ffee",
  version,
  save: "s",
  updatedAt: "2027-04-15T10:00:00.000Z",
  device: "phone",
  parts,
  kept: [],
  ...more,
});
/** The copy at version 4, the version the boards below were built from. */
const COPY = copyAt(4);
const TODAY = "2027-04-15";
const FROM_COPY: CloudLeague = { ok: true, from: "copy" };

/** A meta of this build whose boards were built from `COPY` on `TODAY`, with `more` over that. */
const metaOf = async (
  more: Partial<BuiltFrom> = {},
  meta: Partial<LiveMeta> = {}
): Promise<LiveMeta> => {
  const from = { ...(await builtFrom(COPY, TODAY)), ...more };
  return {
    format: LIVE_FORMAT,
    schema: LIVE_SCHEMA,
    today: from.today,
    builtAt: "2027-04-15T09:00:00.000Z",
    copy: { id: from.k || COPY.copy, version: from.v || COPY.version },
    marks: { [COPY.copy]: COPY.version },
    inline: {},
    views: {},
    retired: [],
    built: { [BOARD_FAMILY]: from },
    ...meta,
  };
};

/** One more save: the games of 2027 changed, which every board of the year reads. */
const GAMES_SAVED = copyAt(5, [
  ...PARTS.slice(0, 4),
  part("league_forecast_scout_games_v2:2027", h(9)),
  PARTS[5]!,
]);
/** One more save that moved nothing a board reads: only the refresh log. */
const LOG_SAVED = copyAt(5, [...PARTS.slice(0, 5), part("league_forecast_gc_refresh_v1", h(9))]);

describe("where the published boards stand against the copy", () => {
  it("are behind where nothing is published, and where a board input was saved since", async () => {
    expect(await boardsBehind(null, COPY, "", TODAY)).toEqual({ behind: "nothing" });
    expect(await boardsBehind(await metaOf(), GAMES_SAVED, "", TODAY)).toEqual({
      behind: "inputs",
    });
  });

  it("are current where nothing a board reads moved since, whatever the copy's version or the day", async () => {
    expect(await boardsBehind(await metaOf(), COPY, "", TODAY)).toEqual({ left: "current" });
    // A save of the refresh log alone asks no rebuild, and asks no catch-up.
    expect(await boardsBehind(await metaOf(), LOG_SAVED, "", TODAY)).toEqual({ left: "current" });
    // Yesterday's boards of what the copy still holds are the night's to build for today.
    expect(await boardsBehind(await metaOf(), COPY, "", "2027-04-16")).toEqual({
      left: "current",
    });
  });

  it("are behind boards of another copy, a floor, other seasons and an older build's", async () => {
    expect(await boardsBehind(await metaOf({ k: "beef" }), COPY, "", TODAY)).toEqual({
      behind: "other-copy",
    });
    // A floor, which a late publish leaves when no one build vouches for every board.
    expect(await boardsBehind(await metaOf({ k: "", v: 0, inputs: "" }), COPY, "", TODAY)).toEqual({
      behind: "no-record",
    });
    // Seasons from their own documents, changed since; or none any more, the copy's part again.
    expect(await boardsBehind(await metaOf(), COPY, "l1", TODAY)).toEqual({ behind: "league" });
    expect(await boardsBehind(await metaOf({ league: "l1" }), COPY, "l2", TODAY)).toEqual({
      behind: "league",
    });
    expect(await boardsBehind(await metaOf({ league: "l1" }), COPY, "", TODAY)).toEqual({
      behind: "league",
    });
    expect(await boardsBehind(await metaOf({ league: "l1" }), COPY, "l1", TODAY)).toEqual({
      left: "current",
    });
    for (const older of [
      await metaOf({}, { schema: LIVE_SCHEMA - 1 }),
      await metaOf({ shape: BOARD_SHAPE - 1 }),
      await metaOf({ rules: BOARD_RULES - 1 }),
      await metaOf({}, { built: {} }),
    ]) {
      expect(await boardsBehind(older, COPY, "", TODAY)).toEqual({ behind: "older-build" });
    }
  });

  it("are left as they are where a publish of this build would be refused", async () => {
    expect(await boardsBehind({ format: LIVE_FORMAT + 1 }, COPY, "", TODAY)).toEqual({
      left: "unreadable-views",
    });
    for (const newer of [
      await metaOf({}, { schema: LIVE_SCHEMA + 1 }),
      await metaOf({ rules: BOARD_RULES + 1 }),
      await metaOf({ shape: BOARD_SHAPE + 1 }),
    ]) {
      expect(await boardsBehind(newer, GAMES_SAVED, "", TODAY)).toEqual({ left: "newer-views" });
    }
    expect(await boardsBehind(await metaOf(), GAMES_SAVED, "", "2027-04-14")).toEqual({
      left: "later-day",
    });
  });
});

const NOW = new Date("2027-04-15T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
/** Saved long enough ago to be still. */
const STILL = ago(CATCH_UP_SETTLE_MS + 60_000);
const QUIET: WritersLook = { nightlyRuns: 0, gate: null, jobs: [], rebuildJob: null };

/** A pasted list's job, as the staged importer runs it, at `stage`, last heard from `heard` ago. */
const imported = (
  stage: PullJob["stage"],
  heard: number,
  status: PullJob["status"] = "running"
) => ({
  ...newPullJob({
    list: { hash: h(1), teams: 30_000, pieces: 1 },
    seasonYears: [],
    timeZone: "America/New_York",
    device: "phone",
    now: ago(heard),
  }),
  status,
  stage,
});
/** "Refresh now", whose legs save the copy one after another, at `stage`. */
const refreshing = (stage: PullJob["stage"], heard: number): PullJob => ({
  ...newRefreshJob({ timeZone: "America/New_York", device: "phone", now: ago(heard) }),
  status: "running",
  stage,
});

const decide = (
  meta: unknown,
  look: Partial<WritersLook> = {},
  {
    copy = GAMES_SAVED as unknown,
    savedAt = STILL,
    league = FROM_COPY,
  }: { copy?: unknown; savedAt?: string; league?: CloudLeague } = {}
) => {
  const writers = vi.fn(async () => ({ ...QUIET, ...look }));
  return {
    writers,
    decided: catchUpDecision({
      copy: copy === null ? null : { manifest: copy, savedAt },
      meta,
      league,
      today: TODAY,
      now: NOW,
      writers,
    }),
  };
};

describe("whether the catch-up publishes", () => {
  it("publishes boards behind the copy when nothing is at work on either", async () => {
    const { decided, writers } = decide(await metaOf());
    expect(await decided).toEqual({ publish: true, behind: "inputs" });
    expect(writers).toHaveBeenCalledTimes(1);
    // And where nothing is published at all.
    expect(await decide(null).decided).toEqual({ publish: true, behind: "nothing" });
  });

  it("reads nothing of what is at work where the boards are current, and publishes nothing", async () => {
    const { decided, writers } = decide(await metaOf(), {}, { copy: LOG_SAVED });
    expect(await decided).toEqual({ publish: false, because: "current" });
    expect(writers).not.toHaveBeenCalled();
  });

  it("waits for a pull or an import that may write the copy", async () => {
    const meta = await metaOf();
    // "Refresh now", saving at the end of each leg, whatever its stage.
    for (const stage of ["waiting", "fetching", "saving"] as const) {
      expect(await decide(meta, { jobs: [refreshing(stage, 60_000)] }).decided).toEqual({
        publish: false,
        because: "pulling",
        behind: "inputs",
      });
    }
    // A pasted list in the staged importer's last phase, which files, tidies and saves the copy.
    for (const stage of ["filing", "tidying", "saving", "loading"] as const) {
      expect(await decide(meta, { jobs: [imported(stage, 60_000)] }).decided).toMatchObject({
        publish: false,
        because: "pulling",
      });
    }
    // A pasted list of the importer before it, which saves the copy at the end of every leg.
    const { pipeline: _staged, ...legacy } = imported("fetching", 60_000);
    expect(await decide(meta, { jobs: [legacy] }).decided).toMatchObject({ because: "pulling" });
  });

  it("does not wait for an import that is only downloading, nor a pull that is over or went quiet", async () => {
    const meta = await metaOf();
    for (const job of [
      // Hours of downloads, into the job's own checkpoints and not the copy.
      imported("waiting", 60_000, "queued"),
      imported("checking", 60_000),
      imported("fetching", 60_000),
      // Over, at a stage that would otherwise count: the end of its last phase, or of a leg.
      imported("filing", 60_000, "done"),
      imported("saving", 60_000, "failed"),
      imported("tidying", 60_000, "cancelled"),
      { ...refreshing("saving", 60_000), status: "done" as const },
      // Not heard from in the time a pull may go quiet and be alive: it died without saying so.
      imported("filing", REFRESH_QUIET_MS + 60_000),
      refreshing("saving", REFRESH_QUIET_MS + 60_000),
    ]) {
      expect(await decide(meta, { jobs: [job] }).decided).toEqual({
        publish: true,
        behind: "inputs",
      });
    }
  });

  it("takes a staged import's heartbeat as word that it is alive", () => {
    const quiet = imported("filing", REFRESH_QUIET_MS + 60_000);
    expect(pullWritesCopy(quiet, NOW)).toBe(false);
    expect(pullWritesCopy({ ...quiet, heartbeatAt: ago(10_000) }, NOW)).toBe(true);
    expect(pullWritesCopy({ ...quiet, progressAt: ago(10_000) }, NOW)).toBe(true);
  });

  it("waits for the nightly, running on GitHub or pulling at the refresh gate", async () => {
    const meta = await metaOf();
    expect(await decide(meta, { nightlyRuns: 1 }).decided).toMatchObject({
      publish: false,
      because: "nightly-running",
    });
    const pulling = { nightlyAt: ago(20 * 60_000), jobId: null, day: TODAY, legs: 0 };
    expect(await decide(meta, { gate: pulling }).decided).toMatchObject({
      because: "nightly-pulling",
    });
    // A GitHub that did not say is not waited on, nor a nightly's word past its 90 minutes.
    expect(await decide(meta, { nightlyRuns: null }).decided).toMatchObject({ publish: true });
    const lapsed = { ...pulling, nightlyAt: ago(NIGHTLY_HOLD_MS + 60_000) };
    expect(await decide(meta, { gate: lapsed }).decided).toMatchObject({ publish: true });
  });

  it("waits for a rebuild that holds its control document, and not for one its budget deferred", async () => {
    const meta = await metaOf();
    const control = { format: 1, generation: 3, task: null, state: "running" };
    for (const owner of ["launching", "6f1c2a"]) {
      const running = { ...control, owner, until: NOW.getTime() + 60_000 };
      expect(await decide(meta, { rebuildJob: running }).decided).toMatchObject({
        publish: false,
        because: "rebuilding",
      });
    }
    // Deferred to the first of next month by its budget, as from 14 October 2026: nobody holds it.
    const deferred = {
      ...control,
      owner: null,
      until: 0,
      state: "deferred",
      deferredUntil: "2027-05-01T04:01:00.000Z",
    };
    expect(await decide(meta, { rebuildJob: deferred }).decided).toEqual({
      publish: true,
      behind: "inputs",
    });
    // A worker that died: its lease ran out.
    const lapsed = { ...control, owner: "6f1c2a", until: NOW.getTime() - 1 };
    expect(await decide(meta, { rebuildJob: lapsed }).decided).toMatchObject({ publish: true });
  });

  it("waits for the copy to have been still a while, as a rebuild after it may yet come", async () => {
    const meta = await metaOf();
    expect(
      await decide(meta, {}, { savedAt: ago(CATCH_UP_SETTLE_MS - 60_000) }).decided
    ).toMatchObject({ publish: false, because: "settling" });
    expect(
      await decide(meta, {}, { savedAt: ago(CATCH_UP_SETTLE_MS + 1_000) }).decided
    ).toMatchObject({ publish: true });
    expect(heldBy(QUIET, ago(CATCH_UP_SETTLE_MS), NOW)).toBeNull();
  });

  it("publishes nothing from a copy or seasons this build cannot build from", async () => {
    const meta = await metaOf();
    expect(await decide(meta, {}, { copy: null }).decided).toEqual({
      publish: false,
      because: "no-copy",
    });
    expect(await decide(meta, {}, { copy: { format: 99 } }).decided).toEqual({
      publish: false,
      because: "unreadable-copy",
    });
    for (const copy of [
      { ...GAMES_SAVED, schema: 2 },
      copyAt(5, [...GAMES_SAVED.parts, part("league_forecast_from_the_future_v1", h(8))]),
    ]) {
      expect(await decide(meta, {}, { copy }).decided).toEqual({
        publish: false,
        because: "newer-copy",
      });
    }
    for (const reason of ["newer-league", "league-unreadable"] as const) {
      expect(await decide(meta, {}, { league: { ok: false, reason } }).decided).toEqual({
        publish: false,
        because: reason,
      });
    }
  });
});

describe("whether the boards are still behind, as the publish asks again", () => {
  it("says so only of boards behind a copy and seasons this build can build from", async () => {
    const meta = await metaOf();
    const ask = (manifest: CloudManifest | null, league: CloudLeague = FROM_COPY) =>
      stillBehind({ meta, manifest, league, today: TODAY });
    expect(await ask(GAMES_SAVED)).toBe(true);
    // Published meanwhile, by a rebuild or the nightly.
    const since = await metaOf(await builtFrom(GAMES_SAVED, TODAY));
    expect(
      await stillBehind({ meta: since, manifest: GAMES_SAVED, league: FROM_COPY, today: TODAY })
    ).toBe(false);
    expect(await ask(COPY)).toBe(false);
    expect(await ask(null)).toBe(false);
    expect(await ask({ ...GAMES_SAVED, schema: 2 })).toBe(false);
    expect(await ask(GAMES_SAVED, { ok: false, reason: "newer-league" })).toBe(false);
  });
});
