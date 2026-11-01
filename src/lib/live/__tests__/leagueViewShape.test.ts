import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memoryIo } from "../../cloud/cloudRunner";
import {
  finalScoresKey,
  leagueFixturesOf,
  type ScoutGame,
  type ScoutTeam,
} from "../../teamRankings";
import {
  initTeamRankingsStore,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import type { GameLog, Matchup, TeamBase } from "../../types";
import { seasonsReader } from "../allKnown";
import { asJson } from "../editHandle";
import { BRIDGE_RULES_NOW, bridgeQuestionOf, fillQuestionOf } from "../leagueAnswers";
import { answerQuery, type AnswerOf, type QueryOf } from "../queries";
import { leagueViews } from "../views/league";
import {
  bridgeFromView,
  coerceLeagueView,
  fillFromView,
  LEAGUE_VIEW_VERSION,
  leagueViewKey,
  type LeagueView,
  type PublishedLeague,
} from "../views/leagueShape";

/*
 * A season's published bridge where a final can turn it (`finalsTheBridgeReads`): the Aces' own row
 * of the 25 September game is filed against a slot, so once the league holds that game's final the
 * bridge leaves the row out, and before it counts it as an outside result. A device that took a
 * bridge from before the final with the final in hand would count the game twice; it asks instead.
 * And how a published view is read back, whole or not at all.
 */

const TODAY = "2026-10-20";
const SEASON = "fall";
const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9" }],
});
const row = (
  id: string,
  a: string,
  b: string,
  date: string,
  sa: number,
  sb: number,
  schedule?: string
): ScoutGame => ({
  id,
  ageGroupId: "ag9",
  teamAId: a,
  teamBId: b,
  date,
  teamAScore: sa,
  teamBScore: sb,
  ...(schedule ? { source: { kind: "gamechanger" as const, teamId: schedule, gameId: id } } : {}),
});
const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const TEAMS: TeamBase[] = [
  { id: "L-ACES", name: "Aces Baseball" },
  { id: "L-BEARS", name: "Bears Baseball" },
];
const MATCHUPS: Matchup[] = [
  { id: "m1", date: "9/25", away: "L-ACES", home: "L-BEARS" },
  { id: "m2", date: "10/2", away: "L-BEARS", home: "L-ACES" },
  { id: "m3", date: "10/9", away: "L-ACES", home: "L-BEARS" },
];
const LOGS: Record<string, GameLog> = { m1: final(0, 13), m2: final(4, 2) };

const season = (logs: Record<string, GameLog>) => ({ teams: TEAMS, matchups: MATCHUPS, logs });
const bridgeAsked = (logs: Record<string, GameLog>) =>
  bridgeQuestionOf(
    SEASON,
    TEAMS,
    leagueFixturesOf(TEAMS, MATCHUPS, finalScoresKey(MATCHUPS, logs))
  );
const answered = <K extends "league.bridge" | "league.fill">(question: QueryOf<K>) =>
  asJson(answerQuery(question)) as unknown as AnswerOf<K>;

const publishedOf = async (logs: Record<string, GameLog>): Promise<PublishedLeague> => {
  const [view] = await leagueViews({
    seasonIds: [SEASON],
    readSeason: seasonsReader(new Map([[SEASON, season(logs)]])),
    today: TODAY,
  });
  const read = coerceLeagueView(view?.value);
  if (!view || !read) throw new Error("no view");
  expect(view.key).toBe(leagueViewKey(SEASON));
  return {
    view: read,
    today: TODAY,
    at: { copy: "c1", version: 4 },
    builtAt: `${TODAY}T07:00:00Z`,
  };
};

const NOON = Date.parse(`${TODAY}T16:00:00.000Z`);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups([{ id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [SEASON] }]);
  saveScoutTeams([
    pulled("S-ACES", "Aces Baseball", "gcACES"),
    pulled("S-BEARS", "Bears Baseball", "gcBEARS"),
    { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
  ]);
  saveScoutGames([
    row("gc_aces_1", "S-ACES", "S-TBD", "2026-09-25", 0, 13, "gcACES"),
    row("gc_bears_2", "S-BEARS", "S-ACES", "2026-10-02", 4, 2, "gcBEARS"),
    row("gc_bears_9", "S-BEARS", "S-TBD", "2026-09-06", 5, 1, "gcBEARS"),
  ]);
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

describe("a published bridge a final can turn", () => {
  it("names the fixture whose final it was worked out with, and is the season's answer", async () => {
    const found = await publishedOf(LOGS);
    expect(found.view.bridge.finals).toEqual([{ at: 0, away: 0, home: 13 }]);
    expect(await bridgeFromView(found, bridgeAsked(LOGS), NOON)).toEqual(
      answered(bridgeAsked(LOGS)).bridge
    );
  });

  it("is asked about, never counted twice, by a device whose final there differs", async () => {
    // Published before the 25 September final was in: the Aces' row against the slot is an
    // outside result, which the final, once held, is the same game as.
    const before = await publishedOf({ m2: LOGS.m2! });
    const heldNow = bridgeAsked(LOGS);
    expect(await bridgeFromView(before, heldNow, NOON)).toBeNull();
    // What the device would have shown, against what the server answers: one result more, the
    // league's own game read as a tournament one.
    expect(before.view.bridge.answer.countedResults).toBe(
      answered(heldNow).bridge.countedResults + 1
    );
    // A final taken back there is asked about the same way.
    const now = await publishedOf(LOGS);
    expect(await bridgeFromView(now, bridgeAsked({ m2: LOGS.m2! }), NOON)).toBeNull();
  });

  it("is taken with a final entered elsewhere since, as the server answers it", async () => {
    const found = await publishedOf(LOGS);
    const elsewhere: Record<string, GameLog>[] = [{ ...LOGS, m3: final(6, 1) }, { m1: LOGS.m1! }];
    for (const logs of elsewhere) {
      const asked = bridgeAsked(logs);
      expect(await bridgeFromView(found, asked, NOON)).toEqual(answered(asked).bridge);
    }
  });

  it("is asked about under other rules than this build's", async () => {
    const found = await publishedOf(LOGS);
    const other = {
      ...found,
      view: { ...found.view, bridge: { ...found.view.bridge, rules: "0.0" } },
    };
    expect(BRIDGE_RULES_NOW).not.toBe("0.0");
    expect(await bridgeFromView(other, bridgeAsked(LOGS), NOON)).toBeNull();
  });

  it("carries Fill's plan for the same season, the plan its question gets", async () => {
    const found = await publishedOf(LOGS);
    const asked = fillQuestionOf(SEASON, TEAMS, MATCHUPS, LOGS, TODAY);
    expect(await fillFromView(found, asked)).toEqual(answered(asked).plan);
  });
});

describe("a published view read back", () => {
  it("is read whole, and not at all where any of it is not what it should be", async () => {
    const found = await publishedOf(LOGS);
    const good = JSON.parse(JSON.stringify(found.view)) as LeagueView;
    expect(coerceLeagueView(good)).toEqual(good);
    const damaged: unknown[] = [
      null,
      "view",
      { ...good, version: LEAGUE_VIEW_VERSION + 1 },
      { ...good, season: "" },
      { ...good, bridge: { ...good.bridge, shape: "abc" } },
      { ...good, fill: { ...good.fill, print: 5 } },
      { ...good, bridge: { ...good.bridge, until: "soon" } },
      { ...good, fill: { ...good.fill, until: "2026-1-1" } },
      { ...good, bridge: { ...good.bridge, finals: [{ at: -1 }] } },
      { ...good, bridge: { ...good.bridge, finals: [{ at: 0, away: "0" }] } },
      // A result that is not neutral is never one the forecast is given.
      {
        ...good,
        bridge: {
          ...good.bridge,
          answer: {
            ...good.bridge.answer,
            results: [{ home: "a", away: "b", homeMargin: 1, neutral: false }],
          },
        },
      },
      { ...good, fill: { ...good.fill, plan: { ...good.fill.plan, rows: "none" } } },
      { ...good, bridge: { ...good.bridge, answer: undefined } },
    ];
    for (const raw of damaged) {
      expect(coerceLeagueView(raw), JSON.stringify(raw)?.slice(0, 80)).toBeNull();
    }
  });
});
