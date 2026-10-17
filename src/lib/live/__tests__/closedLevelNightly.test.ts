import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges } from "../../cloud/cloudEngine";
import type { CloudManifest } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadAutoRemoved,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import type { SeasonReader } from "../allKnown";
import { readCloudLeague, type LeagueDocsList } from "../cloudLeague";
import type { ClosedLevelRecord } from "../closedLevelRecord";
import {
  closedLevelRecordOf,
  closedLevelWord,
  remeasureAfterPublish,
  weeklyClosedLevel,
  type NightlyRemeasure,
} from "../closedLevelWeekly";
import { seasonDocId, seasonToDoc } from "../leagueDocs";
import { publishCopyViews } from "../publishCopy";
import { memoryLive } from "./memoryLive";

/*
 * The nightly's Monday re-measure after the night's publish (`remeasureAfterPublish`): on the pool
 * the boards were built from, League Standings as the publish read it. Members write League scores
 * straight into the seasons' documents, so a score saved after the publish's last look would reach
 * a re-measure that listed them again and not the boards; and a publish refused because League
 * moved leaves no board built from any pool the re-measure could read. On the seeded fixture,
 * stored through the real storage layer, with every season as its own document.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const MONDAY = "2027-04-12";
const T = "2027-04-12T08:40:00.000Z";

const storedSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

/** Each season as its document, as Firestore's REST interface lists it. */
const DOCS = Object.keys(fixture.seasons).map((id, index) => {
  const season: SeasonSnapshot = {
    id,
    name: `Season ${index + 1}`,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...storedSeason(id),
    bracketLogs: {},
    settings: DEFAULT_SETTINGS,
  };
  return {
    id: seasonDocId(id),
    fields: JSON.parse(JSON.stringify(seasonToDoc(season))) as Record<string, unknown>,
  };
});
/** The first season with its scores cleared, as a member's save would leave its document. */
const LATER = DOCS.map((doc, at) =>
  at === 0 ? { ...doc, fields: { ...doc.fields, rev: 2, logs: {} } } : doc
);

/** The documents, counted each time they are listed, and `later` once `moved` says so. */
const counted = (moved: () => boolean) => {
  const seen = { lists: 0 };
  const list: LeagueDocsList = async () => {
    seen.lists += 1;
    return moved() ? LATER : DOCS;
  };
  return { seen, list };
};

let manifest: CloudManifest;
let cloud: ReturnType<typeof memoryCloud>;
beforeAll(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [{ key: LEAGUE_PART, value: { seasons: [] }, at: 1 }],
    device: "phone",
    now: "2027-04-12T07:00:00.000Z",
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  manifest = saved.manifest;
});
afterAll(() => resetTeamRankingsStore());

const pool = () => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  gamesOfYear: loadScoutGamesForYear,
  autoRemoved: loadAutoRemoved(),
});

/**
 * The re-measure as the nightly runs it, live, on members' day `day` with `held` the record kept,
 * and what it keeps, hands over and says.
 */
const remeasure = async (views: NightlyRemeasure["views"], day = MONDAY, held: unknown = null) => {
  const kept: ClosedLevelRecord[] = [];
  const words: string[] = [];
  const lines: string[] = [];
  const weekly = await remeasureAfterPublish({
    views,
    day,
    live: true,
    readKept: async () => held,
    pool,
    keep: async (record) => {
      kept.push(record);
    },
    handWord: (word) => words.push(word),
    log: (line) => lines.push(line),
    now: () => T,
  });
  return { weekly, kept, words, lines };
};

/** The re-measure on the League the documents `docs` hold, read once. */
const weeklyOn = async (docs: typeof DOCS) => {
  const league = await readCloudLeague(async () => docs);
  if (!league.ok || league.from !== "docs") throw new Error("not read from the documents");
  return weeklyClosedLevel({ ...pool(), readSeason: league.readSeason, today: MONDAY });
};

describe("the Monday re-measure after the night's publish", () => {
  it("fits League as the boards read it, and lists the seasons no more", async () => {
    let published = false;
    const { seen, list } = counted(() => published);
    const views = await publishCopyViews({
      copyStore: cloud.store,
      liveStore: memoryLive().store,
      manifest,
      today: MONDAY,
      now: () => T,
      locale: "en-US",
      leagueDocs: list,
    });
    expect(views.ok).toBe(true);
    // A member saves a score once the boards are out.
    published = true;
    const listed = seen.lists;

    const { weekly, kept, words } = await remeasure(views);

    expect(seen.lists).toBe(listed);
    const asBuilt = await weeklyOn(DOCS);
    expect(weekly).toEqual(asBuilt);
    // The score saved since would have moved it: the boards never saw it, nor does it.
    expect((await weeklyOn(LATER))?.check).not.toEqual(asBuilt?.check);
    expect(kept).toEqual([closedLevelRecordOf(asBuilt!, MONDAY, T)]);
    expect(words).toEqual([closedLevelWord(asBuilt!.check)]);
  });

  it("does not re-measure where the publish was refused because League moved during it", async () => {
    let started = false;
    const { seen, list } = counted(() => started);
    const live = memoryLive();
    const views = await publishCopyViews({
      copyStore: cloud.store,
      liveStore: {
        ...live.store,
        putChunk: async (id, data) => {
          started = true;
          await live.store.putChunk(id, data);
        },
      },
      manifest,
      today: MONDAY,
      now: () => T,
      locale: "en-US",
      leagueDocs: list,
    });
    expect(views).toEqual({ ok: false, reason: "league-moved" });
    const listed = seen.lists;

    const { weekly, kept, words, lines } = await remeasure(views);

    expect(weekly).toBeNull();
    expect(kept).toEqual([]);
    expect(words).toEqual([]);
    expect(seen.lists).toBe(listed);
    expect(lines).toEqual([
      "The views were not published, so the starting level was not re-measured on a pool no board was built from.",
    ]);
    // Nor where the publish threw and handed over nothing.
    expect((await remeasure(null)).weekly).toBeNull();
  });
});

describe("the week's re-measure, whichever night of the week runs it", () => {
  /** One night's publish, and the re-measure as of Monday 12 April on its League. */
  let views: NightlyRemeasure["views"] = null;
  let asOf: Awaited<ReturnType<typeof weeklyOn>> = null;
  beforeAll(async () => {
    views = await publishCopyViews({
      copyStore: cloud.store,
      liveStore: memoryLive().store,
      manifest,
      today: "2027-04-14",
      now: () => T,
      locale: "en-US",
      leagueDocs: async () => DOCS,
    });
    asOf = await weeklyOn(DOCS);
  });
  /** The record a run kept as of Monday `measuredOn`. */
  const keptOn = (measuredOn: string) => closedLevelRecordOf(asOf!, measuredOn, T);

  it("catches up on a later night a Monday no run re-measured, as of that Monday", async () => {
    // Wednesday 14 April, last kept the Monday before: the week of 12 April was missed.
    const { weekly, kept } = await remeasure(views, "2027-04-14", keptOn("2027-04-05"));
    expect(weekly).toEqual(asOf);
    expect(kept.map((record) => record.measuredOn)).toEqual([MONDAY]);
    expect(weekly?.check.weeks[3]?.to).toBe("2027-04-11");
  });

  it("re-measures a week once: a later night of the same week finds it made", async () => {
    const { weekly, kept, words, lines } = await remeasure(views, "2027-04-13", keptOn(MONDAY));
    expect(weekly).toBeNull();
    expect([kept, words, lines]).toEqual([[], [], []]);
  });
});
