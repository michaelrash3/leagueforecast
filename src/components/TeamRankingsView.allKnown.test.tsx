import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { poolFixture } from "../../scripts/poolFixture";
import { deriveAllKnown, gamesOnPages } from "../lib/live/allKnown";
import { loadLogsForSeason, loadMatchupsForSeason, loadTeamsForSeason } from "../lib/storage";
import { ageGroupYear, rankingPoolGroupIds } from "../lib/teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../lib/teamRankingsCompact";
import { loadAgeGroups, loadScoutGamesForYear, loadScoutTeams } from "../lib/teamRankingsStorage";
import { renderTeamRankings } from "../test/teamRankingsHarness";
import type { RankingsRequest, WorkerRequest } from "../workers/rankingsProtocol";

/**
 * The page and `deriveAllKnown` know the same things, in the same order.
 *
 * What the page knows is what it ships its rankings worker: the year's roster and the games on the
 * year's pages, in the compact codec. A server builds its boards from `deriveAllKnown` over the
 * same stored pool (`views/board.ts`), so the two have to agree on every team and game, and on the
 * order of each, which the fit's digits depend on. The pool is the seeded fixture, big enough that
 * the page goes to the worker rather than fitting inline, with League Standings seasons that mint
 * teams, link them by name and by pick, and fold a pulled copy of a league game.
 */

/** A worker that keeps what it is sent, and never answers. */
class FakeWorker {
  static posted: WorkerRequest[] = [];
  addEventListener() {}
  removeEventListener() {}
  postMessage(message: WorkerRequest) {
    FakeWorker.posted.push(message);
  }
  terminate() {}
}

beforeEach(() => {
  FakeWorker.posted = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

const fixture = poolFixture({ seed: 11, clubsPerPage: 45 });

/** The first pool the page shipped for a board. */
const shipped = async (): Promise<RankingsRequest> => {
  let first: RankingsRequest | undefined;
  await waitFor(
    () => {
      first = FakeWorker.posted.find(
        (message): message is RankingsRequest =>
          message.kind === "rankings" && message.pool.teams !== undefined
      );
      expect(first).toBeDefined();
    },
    { timeout: 5_000 }
  );
  return first!;
};

describe("what the page knows, against deriveAllKnown", () => {
  it.each([
    [
      "this year's 10U, whose league mints a team and folds a pulled copy",
      "?age=10&year=2027",
      "ag_10u_2027",
    ],
    [
      "last year's 9U, whose league links clubs off last year's games",
      "?age=9&year=2026",
      "ag_9u_2026",
    ],
  ])("is the same pool, in the same order: %s", async (_case, search, pageId) => {
    renderTeamRankings({
      ageGroups: fixture.ageGroups,
      teams: fixture.teams,
      games: fixture.games,
      leagueSeasons: fixture.seasons,
      search,
    });
    const request = await shipped();
    expect(request.ageGroupId).toBe(pageId);

    const ageGroups = loadAgeGroups();
    const page = ageGroups.find((group) => group.id === request.ageGroupId);
    const known = deriveAllKnown({
      ageGroups,
      teams: loadScoutTeams(),
      yearGames: loadScoutGamesForYear(ageGroupYear(page)),
      readSeason: (seasonId) => ({
        teams: loadTeamsForSeason(seasonId),
        matchups: loadMatchupsForSeason(seasonId),
        logs: loadLogsForSeason(seasonId),
      }),
    });
    const pageIds = rankingPoolGroupIds(request.ageGroupId, ageGroups);

    expect(request.pool.teams).toStrictEqual(encodeScoutTeams(known.teams));
    expect(request.pool.games).toStrictEqual(encodeScoutGames(gamesOnPages(known.games, pageIds)));
    // The fixture reaches what this is here for: teams minted for the league, and its games.
    expect(known.teams.length).toBeGreaterThan(loadScoutTeams().length);
    expect(known.derivedGames.length).toBeGreaterThan(0);
  });
});
