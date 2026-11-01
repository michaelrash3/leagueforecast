import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges } from "../../cloud/cloudEngine";
import { chunkId, type CloudManifest } from "../../cloud/cloudManifest";
import { hashValue, unpackChunks } from "../../cloud/cloudPack";
import { memoryIo } from "../../cloud/cloudRunner";
import { shiftIsoDay } from "../../date";
import { finalScoresKey, leagueFixturesOf } from "../../teamRankings";
import {
  initTeamRankingsStore,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import type { SeasonSnapshot } from "../../storage";
import { asJson } from "../editHandle";
import { bridgeQuestionOf, fillQuestionOf } from "../leagueAnswers";
import { forgetOwnEdits, noteOwnEdit } from "../ownEdits";
import { publishCopyViews } from "../publishCopy";
import { readPublishedLeague } from "../publishedLeague";
import { answerQuery, type AnswerOf, type QueryOf } from "../queries";
import type { LiveReader } from "../viewStore";
import {
  bridgeFromView,
  coerceLeagueView,
  fillFromView,
  LEAGUE_FAMILY,
  leagueViewKey,
  newYorkDay,
  type PublishedLeague,
} from "../views/leagueShape";
import { docsOf, listing, rescored, seasonsOf } from "./leagueDocsFixture";
import { memoryLive, type MemoryLive } from "./memoryLive";

/*
 * League Standings' answers published beside the boards (`views/league.ts`, sweep item 23): each
 * season's bridge and Fill plan, the very answers its questions get from the edit function, and
 * taken by a device only where they are those answers, to the digit, for the season as it holds it.
 * The questions' own answers on this fixture are pinned in `leagueAnswersPin.test.ts`, from before
 * the views; the same digests are held here to the views.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const SEASONS = seasonsOf(fixture.seasons);
const T = `${FIXTURE_TODAY}T16:00:00.000Z`;
/** Noon in New York on the fixture's day, when the server is asked. */
const NOON = Date.parse(T);

/** The pinned digests of each season's answers (`leagueAnswersPin.test.ts`). */
const PINNED: Record<string, { bridge: string; plan: string }> = {
  "fx-10u-fall": {
    bridge: "7dcfdbf68657268e4ac59ff24c312c7824174f7e854d25e69599866389372658",
    plan: "1625fb8cf8b804ef2be9a4fc5c9dfc72944fc2f73527f06a04dea7e815a9fd6d",
  },
  "fx-9u-2026": {
    bridge: "2b879f8b4c8926972914aacd1bff701840371717c5b9430096dfb6db57a12320",
    plan: "c4fe2c52c55af8c0522e11b0817e968f3cb9cce1879c55cd971d61fef8cdbdf3",
  },
  "fx-shared": {
    bridge: "84913d344d28610c3135a95c7f34cb05fd07ca50823d4d18304b9dd9b9fc39a0",
    plan: "f13ea06f85a57c867b462c2285c188af68354e3e99f158760fc0651a3780a290",
  },
};

const fixturesOf = (season: SeasonSnapshot) =>
  leagueFixturesOf(season.teams, season.matchups, finalScoresKey(season.matchups, season.logs));
const bridgeAsked = (season: SeasonSnapshot) =>
  bridgeQuestionOf(season.id, season.teams, fixturesOf(season));
const fillAsked = (season: SeasonSnapshot, today = FIXTURE_TODAY) =>
  fillQuestionOf(season.id, season.teams, season.matchups, season.logs, today);
/** What the edit function answers, on the server's day, as JSON sends it. */
const answered = <K extends "league.bridge" | "league.fill">(question: QueryOf<K>) =>
  asJson(answerQuery(question)) as unknown as AnswerOf<K>;

const copy = async (): Promise<{
  manifest: CloudManifest;
  store: ReturnType<typeof memoryCloud>["store"];
}> => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [{ key: "league_forecast_gc_apart_v1", value: [], at: 1 }],
    device: "phone",
    now: "2027-04-15T11:00:00.000Z",
  });
  if (!saved.ok) throw new Error("the copy was not saved");
  return { manifest: saved.manifest, store: cloud.store };
};

/** One copy for every publish: the same copy at the same version, as a run publishing it again. */
let held: Awaited<ReturnType<typeof copy>> | null = null;

const publish = async (
  live: MemoryLive,
  seasons: readonly SeasonSnapshot[],
  today = FIXTURE_TODAY
) => {
  const { manifest, store } = (held ??= await copy());
  const result = await publishCopyViews({
    copyStore: store,
    liveStore: live.store,
    manifest,
    today,
    now: () => T,
    leagueDocs: listing(docsOf(seasons)),
  });
  if (!result.ok) throw new Error(`not published: ${result.reason}`);
  return result;
};

/** `live/` as a device reads it. */
const readerOf = (live: MemoryLive): LiveReader => ({
  readMeta: async () => (await live.store.readMeta())?.meta ?? null,
  getChunk: (id) => live.store.getChunk(id),
});

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

const publishedOf = async (live: MemoryLive, seasonId: string): Promise<PublishedLeague> => {
  const found = await readPublishedLeague(readerOf(live), seasonId);
  if (!found) throw new Error(`nothing published for ${seasonId}`);
  return found;
};

beforeAll(async () => {
  // The server works the bridge out on its own day, New York's: the fixture's, mid-April 2027.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

describe("League Standings' answers published beside the boards", { timeout: 60_000 }, () => {
  let live: MemoryLive;
  beforeAll(async () => {
    live = memoryLive();
    await publish(live, SEASONS);
  });

  it("are each season's, the very answers its questions get, to the digit", async () => {
    const keys = Object.keys(live.meta()?.views ?? {}).filter((key) =>
      key.startsWith(LEAGUE_FAMILY)
    );
    expect(keys.sort()).toEqual(SEASONS.map((season) => leagueViewKey(season.id)).sort());
    for (const season of SEASONS) {
      const view = coerceLeagueView(await decode(live, leagueViewKey(season.id)));
      expect(view, season.id).not.toBeNull();
      const bridge = answered(bridgeAsked(season)).bridge;
      const plan = answered(fillAsked(season)).plan;
      expect(view?.bridge.answer, season.id).toEqual(bridge);
      expect(view?.fill.plan, season.id).toEqual(plan);
      // The digests pinned from the questions before any of this was published.
      expect(await hashValue(view?.bridge.answer), season.id).toBe(PINNED[season.id]?.bridge);
      expect(await hashValue(view?.fill.plan), season.id).toBe(PINNED[season.id]?.plan);
    }
  });

  it("are taken by a device holding the season as published, and by no other", async () => {
    for (const season of SEASONS) {
      const found = await publishedOf(live, season.id);
      const bridge = answered(bridgeAsked(season)).bridge;
      expect(await bridgeFromView(found, bridgeAsked(season), NOON)).toEqual(bridge);
      expect(await fillFromView(found, fillAsked(season))).toEqual(
        answered(fillAsked(season)).plan
      );
      // A team renamed since, or picked as another club: asked, as before.
      const renamed = {
        ...season,
        teams: season.teams.map((team, at) =>
          at === 0 ? { ...team, name: `${team.name} X` } : team
        ),
      };
      expect(await bridgeFromView(found, bridgeAsked(renamed), NOON)).toBeNull();
      expect(await fillFromView(found, fillAsked(renamed))).toBeNull();
      // Another season's answers are not this one's.
      const other = SEASONS.find((one) => one.id !== season.id)!;
      expect(await bridgeFromView(found, bridgeAsked(other), NOON)).toBeNull();
      // A score typed since into a game still being played moves no bridge, and Fill's plan reads
      // it: asked.
      const typed = {
        awayRuns: "2",
        awayHits: "",
        awayK: "",
        homeRuns: "1",
        homeHits: "",
        homeK: "",
        innings: "6",
      };
      const playing = season.matchups.find((one) => !season.logs[one.id]?.isFinal);
      if (playing) {
        const typing = { ...season, logs: { ...season.logs, [playing.id]: typed } };
        expect(await bridgeFromView(found, bridgeAsked(typing), NOON)).toEqual(bridge);
        expect(await fillFromView(found, fillAsked(typing))).toBeNull();
      }
      // A final corrected since, a run either way: asked, whatever its bridge.
      const corrected = rescored(season);
      expect(await fillFromView(found, fillAsked(corrected))).toBeNull();
      // A score this device keeps for a game no longer on the schedule, which no plan reads: taken.
      const stray = { ...season, logs: { ...season.logs, "gone-game": typed } };
      expect(await fillFromView(found, fillAsked(stray))).toEqual(answered(fillAsked(stray)).plan);
    }
  });

  it("are worked out for the members' day they are published for, whatever the clock says", async () => {
    // The first day after the fixture's that a scored game a season's bridge reads is dated.
    const found = await Promise.all(SEASONS.map((season) => publishedOf(live, season.id)));
    const days = found.flatMap((one) => (one.view.bridge.until ? [one.view.bridge.until] : []));
    expect(days.length).toBeGreaterThan(0);
    const later = days.sort()[0]!;
    const moving = SEASONS.filter((_season, at) => found[at]?.view.bridge.until === later);
    // Published for that day while the clock is still on the fixture's, as a run that started
    // before midnight and built after it would be.
    const fresh = memoryLive();
    await publish(fresh, SEASONS, later);
    vi.setSystemTime(new Date(`${later}T12:00:00`));
    try {
      for (const season of moving) {
        const view = coerceLeagueView(await decode(fresh, leagueViewKey(season.id)));
        const onThatDay = answered(bridgeAsked(season)).bridge;
        expect(view?.bridge.answer, season.id).toEqual(onThatDay);
        // And it is another answer than the fixture's day's, or this would prove nothing.
        expect(onThatDay, season.id).not.toEqual(
          found[SEASONS.indexOf(season)]?.view.bridge.answer
        );
      }
    } finally {
      vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
    }
  });

  it("take a final entered since wherever the bridge turns on none, as the server would answer it", async () => {
    let tried = 0;
    for (const season of SEASONS) {
      const found = await publishedOf(live, season.id);
      const read = new Set(found.view.bridge.finals.map((final) => final.at));
      // Each game with no final yet, given one, and each final taken back.
      for (const [at, game] of season.matchups.entries()) {
        if (read.has(at)) continue;
        const log = season.logs[game.id];
        const moved: SeasonSnapshot = {
          ...season,
          logs: {
            ...season.logs,
            [game.id]: log?.isFinal
              ? { ...log, isFinal: false }
              : {
                  awayRuns: "7",
                  awayHits: "",
                  awayK: "",
                  homeRuns: "3",
                  homeHits: "",
                  homeK: "",
                  innings: "6",
                  isFinal: true,
                },
          },
        };
        const asked = bridgeAsked(moved);
        expect(await bridgeFromView(found, asked, NOON), `${season.id} ${game.id}`).toEqual(
          answered(asked).bridge
        );
        tried += 1;
      }
    }
    expect(tried).toBeGreaterThan(40);
  });

  it("hold the bridge to the New York days it holds on, and Fill to the device's", async () => {
    for (const season of SEASONS) {
      const found = await publishedOf(live, season.id);
      const asked = bridgeAsked(season);
      const until = found.view.bridge.until;
      // Before the day the meta says, or from the first day a scored game it reads is dated: asked.
      const dayBefore = Date.parse(`${shiftIsoDay(FIXTURE_TODAY, -1)}T16:00:00.000Z`);
      expect(await bridgeFromView(found, asked, dayBefore)).toBeNull();
      if (until) {
        expect(await bridgeFromView(found, asked, Date.parse(`${until}T16:00:00.000Z`))).toBeNull();
        const lastDay = shiftIsoDay(until, -1);
        if (lastDay > FIXTURE_TODAY) {
          vi.setSystemTime(new Date(`${lastDay}T12:00:00`));
          const later = Date.parse(`${lastDay}T16:00:00.000Z`);
          expect(await bridgeFromView(found, asked, later)).toEqual(answered(asked).bridge);
          vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
        }
      }
      const fillUntil = found.view.fill.until;
      expect(
        await fillFromView(found, fillAsked(season, shiftIsoDay(FIXTURE_TODAY, -1)))
      ).toBeNull();
      if (fillUntil) expect(await fillFromView(found, fillAsked(season, fillUntil))).toBeNull();
      const fillLast = fillUntil ? shiftIsoDay(fillUntil, -1) : shiftIsoDay(FIXTURE_TODAY, 30);
      if (fillLast > FIXTURE_TODAY) {
        expect(await fillFromView(found, fillAsked(season, fillLast))).toEqual(
          answered(fillAsked(season, fillLast)).plan
        );
      }
    }
    // A scored game dated ahead of the fixture's day is read by at least one answer here.
    const ahead = await Promise.all(SEASONS.map((season) => publishedOf(live, season.id)));
    expect(ahead.some((found) => found.view.bridge.until ?? found.view.fill.until)).toBe(true);
    // The day is New York's: a phone in California at 10 pm is past New York's midnight.
    expect(newYorkDay(Date.parse("2027-04-16T05:00:00.000Z"))).toBe("2027-04-16");
  });

  it("are not taken from before a save this device's own edit made of what they read", async () => {
    const season = SEASONS[0]!;
    const before = await publishedOf(live, season.id);
    try {
      // A Pool health answer, which changes nothing the answers read: still taken.
      noteOwnEdit({
        copy: before.at.copy,
        version: before.at.version + 1,
        changed: ["league_forecast_gc_real_v1"],
      });
      expect(await readPublishedLeague(readerOf(live), season.id)).not.toBeNull();
      // A club folded or a season put on a page: the question is asked until a publish has it.
      noteOwnEdit({
        copy: before.at.copy,
        version: before.at.version + 2,
        changed: ["league_forecast_scout_teams_v1"],
      });
      expect(await readPublishedLeague(readerOf(live), season.id)).toBeNull();
      // One of another copy, which a fresh copy's publish never had.
      forgetOwnEdits();
      noteOwnEdit({ copy: "another", version: 99, changed: ["league_forecast_scout_teams_v1"] });
      expect(await readPublishedLeague(readerOf(live), season.id)).not.toBeNull();
    } finally {
      forgetOwnEdits();
    }
  });
});

describe("what publishing League Standings' answers costs", { timeout: 120_000 }, () => {
  it("writes a season's answers again only when they change: one piece for the season that did", async () => {
    const live = memoryLive();
    const first = await publish(live, SEASONS);
    expect(first.leagues).toBe(SEASONS.length);
    expect(first.publish.families[LEAGUE_FAMILY]).toEqual({
      sent: SEASONS.length,
      reused: 0,
      unchanged: 0,
      refused: 0,
    });
    // The same again: nothing written at all, the meta included.
    const writes = live.costs.writes;
    const again = await publish(live, SEASONS);
    expect(again.publish.wrote).toBe(false);
    expect(live.costs.writes).toBe(writes);
    // One season's score changed, as a device's save of its document does: its answers go up
    // again, one piece, beside the boards the score moved; the other seasons' cost nothing.
    const changed = rescored(SEASONS[0]!);
    const before = live.costs.writes;
    const after = await publish(live, [changed, ...SEASONS.slice(1)]);
    expect(after.publish.families[LEAGUE_FAMILY]).toEqual({
      sent: 1,
      reused: 0,
      unchanged: SEASONS.length - 1,
      refused: 0,
    });
    const boardsAndMeta = after.publish.uploaded - 1;
    expect(live.costs.writes - before).toBe(after.publish.pieces + 1);
    expect(boardsAndMeta).toBeGreaterThan(0);
    // A season renamed, or a setting changed, which nothing reads: no answer moves.
    const renamed = { ...SEASONS[1]!, name: "Renamed" };
    const quiet = await publish(live, [changed, renamed, ...SEASONS.slice(2)]);
    expect(quiet.publish.families[LEAGUE_FAMILY]?.sent).toBe(0);
  });

  it("is a few kilobytes a season, one piece each", async () => {
    const live = memoryLive();
    await publish(live, SEASONS);
    const meta = live.meta()!;
    for (const season of SEASONS) {
      const entry = meta.views[leagueViewKey(season.id)]!;
      const zipped = Array.from(
        { length: entry.c },
        (_, index) => live.chunks.get(chunkId(entry.id, index))?.data.length ?? 0
      ).reduce((sum, bytes) => sum + bytes, 0);
      expect(entry.c, season.id).toBe(1);
      expect(entry.b, season.id).toBeLessThan(40_000);
      expect(zipped, season.id).toBeLessThan(8_000);
    }
  });

  it("publishes none where League Standings is the copy's part, which no device reads as documents", async () => {
    const live = memoryLive();
    const { manifest, store } = await copy();
    const result = await publishCopyViews({
      copyStore: store,
      liveStore: live.store,
      manifest,
      today: FIXTURE_TODAY,
      now: () => T,
    });
    expect(result.ok && result.leagues).toBe(0);
    expect(Object.keys(live.meta()?.views ?? {}).some((key) => key.startsWith(LEAGUE_FAMILY))).toBe(
      false
    );
  });
});
