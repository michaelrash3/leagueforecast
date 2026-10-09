import { afterEach, describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { finalScoresKey, leagueFixturesOf, scoutLinkCandidates } from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForSeason,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { asJson } from "../editHandle";
import { answerQuery, LEAGUE_CANDIDATES_MAX, type AnswerOf } from "../queries";

afterEach(() => resetTeamRankingsStore());

describe("the bridge answer on a page of a real one's size", () => {
  it("sends each team's best clubs and its pick, and keeps the bridge alone", async () => {
    /*
     * The page a ten-team league was linked to held 8,689 clubs (teamRankings.ts), and the seeded
     * fixture is drawn in the real pool's shape: about half its clubs pulled from GameChanger. Every
     * league team there could be any of 5,453 clubs with a game on the season's pages, and sending
     * them all came to 7,076,653 characters for this eight-team season, past what an origin's
     * localStorage holds (about 5,000,000 UTF-16 units in jsdom and Firefox) when it was kept.
     */
    const fixture = poolFixture({ seed: 7, clubsPerPage: 8689 });
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    saveAgeGroups(fixture.ageGroups);
    saveScoutTeams(fixture.teams);
    saveScoutGames(fixture.games);
    const season = fixture.seasons["fx-10u-fall"]!;
    const fixtures = leagueFixturesOf(
      season.teams,
      season.matchups,
      finalScoresKey(season.matchups, season.logs)
    );
    const teams = season.teams.map(({ id, name, scoutTeamId }) => ({
      id,
      name,
      ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
    }));
    const answer = answerQuery({
      kind: "league.bridge",
      season: "fx-10u-fall",
      teams,
      fixtures,
    }) as AnswerOf<"league.bridge">;

    // Each team is sent the clubs the panel's picker draws at once, best evidence first, as the
    // device lists them, and the club it is picked as wherever that falls in the list.
    const groups = loadAgeGroups();
    const clubs = loadScoutTeams();
    const games = loadScoutGamesForSeason("fx-10u-fall");
    for (const team of teams) {
      const all = scoutLinkCandidates(team.name, "fx-10u-fall", groups, clubs, games, fixtures);
      const sent = answer.candidates.find((entry) => entry.name === team.name)?.clubs ?? [];
      expect(sent.slice(0, LEAGUE_CANDIDATES_MAX)).toEqual(all.slice(0, LEAGUE_CANDIDATES_MAX));
      expect(sent.length).toBeLessThanOrEqual(LEAGUE_CANDIDATES_MAX + 1);
      const pickedAt = all.findIndex((club) => club.scoutTeamId === team.scoutTeamId);
      if (pickedAt >= LEAGUE_CANDIDATES_MAX) expect(sent[sent.length - 1]).toEqual(all[pickedAt]);
    }
    // One team here is picked as a club 471st on its list, which the panel must still name.
    expect(
      teams.some((team) =>
        answer.candidates
          .find((entry) => entry.name === team.name)
          ?.clubs.slice(LEAGUE_CANDIDATES_MAX)
          .some((club) => club.scoutTeamId === team.scoutTeamId)
      )
    ).toBe(true);

    /*
     * What the callable sends: 70,746 characters measured, from 7,076,653, and the bound is set
     * where every team's list sent whole again fails it seventyfold. And what the device keeps of
     * it for the season, the bridge alone: 2,363 characters, so the four seasons it keeps take
     * under a five-hundredth of what the origin's storage holds.
     */
    expect(JSON.stringify(asJson(answer)).length).toBeLessThan(100_000);
    expect(JSON.stringify({ "fx-10u-fall": answer.bridge }).length).toBeLessThan(5_000);
  }, 600_000);
});
