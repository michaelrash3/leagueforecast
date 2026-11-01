import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { hashValue } from "../../cloud/cloudPack";
import { memoryIo } from "../../cloud/cloudRunner";
import { finalScoresKey, leagueFixturesOf } from "../../teamRankings";
import {
  initTeamRankingsStore,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { answerQuery, type AnswerOf, type QueryOf } from "../queries";
import { seasonsOf } from "./leagueDocsFixture";

/*
 * League Standings' two questions as the server answers them on the seeded fixture, pinned before
 * their answers were published beside the boards (sweep item 23): whatever the view family does to
 * the code that works them out, these answers stay to the digit. Each season is asked as a device
 * holding it asks (`useScoutBridge`'s bridge question, `App`'s Fill question), on the fixture's day.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const seasons = seasonsOf(fixture.seasons);

const bridgeQuestion = (id: string): QueryOf<"league.bridge"> => {
  const season = seasons.find((one) => one.id === id)!;
  return {
    kind: "league.bridge",
    season: id,
    teams: season.teams.map(({ id: teamId, name, scoutTeamId, scoutGcTeamId }) => ({
      id: teamId,
      name,
      ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
      ...(scoutGcTeamId === undefined ? {} : { scoutGcTeamId }),
    })),
    fixtures: leagueFixturesOf(
      season.teams,
      season.matchups,
      finalScoresKey(season.matchups, season.logs)
    ),
  };
};

const fillQuestion = (id: string): QueryOf<"league.fill"> => {
  const season = seasons.find((one) => one.id === id)!;
  return {
    kind: "league.fill",
    season: id,
    teams: season.teams.map(({ id: teamId, name, scoutTeamId, scoutGcTeamId }) => ({
      id: teamId,
      name,
      ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
      ...(scoutGcTeamId === undefined ? {} : { scoutGcTeamId }),
    })),
    matchups: season.matchups.map(({ id: gameId, date, away, home }) => ({
      id: gameId,
      date,
      away,
      home,
    })),
    runs: Object.entries(season.logs).map(([gameId, log]) => ({
      id: gameId,
      awayRuns: log.awayRuns,
      homeRuns: log.homeRuns,
      ...(log.isFinal ? { isFinal: true as const } : {}),
    })),
    today: FIXTURE_TODAY,
  };
};

beforeAll(async () => {
  // The server works the bridge out on its own day, New York's; the fixture's is mid-April 2027.
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

describe("League Standings' questions on the seeded fixture, as the server answers them", () => {
  it("answers each season's bridge as it did before its answers were published", async () => {
    const said: Record<string, unknown> = {};
    for (const { id } of seasons) {
      const answer = answerQuery(bridgeQuestion(id)) as AnswerOf<"league.bridge">;
      said[id] = {
        results: answer.bridge.results.length,
        linked: answer.bridge.linkedCount,
        margins: answer.bridge.results.reduce((sum, result) => sum + result.homeMargin, 0),
        bridge: await hashValue(answer.bridge),
        candidates: await hashValue(answer.candidates),
      };
    }
    expect(said).toEqual({
      "fx-10u-fall": {
        results: 80,
        linked: 6,
        margins: 38.5,
        bridge: "7dcfdbf68657268e4ac59ff24c312c7824174f7e854d25e69599866389372658",
        candidates: "b04c1fc4fb0941e63350c35ef62982ee50a0488b96351fcf7c7d4cbc07276440",
      },
      "fx-9u-2026": {
        results: 158,
        linked: 4,
        margins: 80.5,
        bridge: "2b879f8b4c8926972914aacd1bff701840371717c5b9430096dfb6db57a12320",
        candidates: "a452e5350539f54ce5fb1a81f68dcd58a02a3e374ec45dccc6136625d94a3f09",
      },
      "fx-shared": {
        results: 52,
        linked: 4,
        margins: 93,
        bridge: "84913d344d28610c3135a95c7f34cb05fd07ca50823d4d18304b9dd9b9fc39a0",
        candidates: "e50ee0fc7ab36758f32007debb7a6340d681e59782837171ca8d68e784ba4fa0",
      },
    });
  });

  it("answers each season's Fill plan as it did before its answers were published", async () => {
    const said: Record<string, unknown> = {};
    for (const { id } of seasons) {
      const answer = answerQuery(fillQuestion(id)) as AnswerOf<"league.fill">;
      said[id] = {
        rows: answer.plan.rows.length,
        missing: answer.plan.missing?.length ?? 0,
        unmatched: answer.plan.unmatched,
        plan: await hashValue(answer.plan),
      };
    }
    expect(said).toEqual({
      "fx-10u-fall": {
        rows: 1,
        missing: 0,
        unmatched: 27,
        plan: "1625fb8cf8b804ef2be9a4fc5c9dfc72944fc2f73527f06a04dea7e815a9fd6d",
      },
      "fx-9u-2026": {
        rows: 1,
        missing: 0,
        unmatched: 14,
        plan: "c4fe2c52c55af8c0522e11b0817e968f3cb9cce1879c55cd971d61fef8cdbdf3",
      },
      "fx-shared": {
        rows: 2,
        missing: 0,
        unmatched: 4,
        plan: "f13ea06f85a57c867b462c2285c188af68354e3e99f158760fc0651a3780a290",
      },
    });
  });
});
