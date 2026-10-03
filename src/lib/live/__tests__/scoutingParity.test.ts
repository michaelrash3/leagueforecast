import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { compareClubs, type ClubComparison } from "../../clubCompare";
import {
  ageGroupYear,
  buildScoutingReport,
  buildUpcomingSchedule,
  countedInWindow,
  rankingPoolGroupIds,
  type AgeGroup,
  type ScoutRankingRow,
  type SeasonSegment,
} from "../../teamRankings";
import { clubsOfBoard } from "../../teamRankings/boardDisplay";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadNamedAges,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { gamesOnPages, type SeasonReader } from "../allKnown";
import { gamesOfTwo, poolGamesOfCard, teamsOfCard } from "../scoutingFromCards";
import { boardViews, buildBoardsAndFacts } from "../views/board";
import { coerceBoardView, withMine } from "../views/boardShape";
import { clubViews } from "../views/clubs";
import { clubBucketOf, clubKey, coerceClubBucket, type ClubBucket } from "../views/clubShape";

/**
 * Scouting on the cloud's board says what Team Rankings' Scouting says (`TeamRankingsView`): the
 * report, each club's upcoming games and the comparison of two clubs, worked out off the board's
 * rows and the published club cards (`scoutingFromCards.ts`) rather than off the year's pool. The
 * pool is the seeded fixture (`scripts/poolFixture.ts`); the rows are the boards a server
 * publishes, which `boardParity.test.ts` holds to the page's own. A second page with no year is
 * added, a pool of its own beside the fixture's, with a game still to play on it by a club of the
 * first: a card holds a club's games of every page with no year, and the first page's Scouting must
 * not list it. Game ids are left out of what is
 * compared: a card's are its own places, and Scouting keys rows by them and reads them for nothing
 * else on the board.
 */

const fixture = poolFixture({ seed: 17, clubsPerPage: 120 });
const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

let ageGroups: AgeGroup[] = [];
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups([
    ...fixture.ageGroups,
    { id: "ag_showcase_2", name: "Showcase two", seasonIds: [] },
  ]);
  saveScoutTeams(fixture.teams);
  // A club of the showcase, down to play on the other page with no year.
  const showcased = fixture.games.find((game) => game.ageGroupId === "ag_showcase");
  if (!showcased) throw new Error("the fixture's showcase has no games");
  saveScoutGames([
    ...fixture.games,
    {
      id: "elsewhere",
      teamAId: showcased.teamAId,
      teamBId: showcased.teamBId,
      ageGroupId: "ag_showcase_2",
      date: "2027-05-01",
    },
  ]);
  ageGroups = loadAgeGroups();
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

/** A list with its game ids taken out, for a comparison of everything else. */
const withoutIds = <T extends { gameId: string }>(list: readonly T[]) =>
  list.map(({ gameId: _id, ...rest }) => rest);
const comparedWithoutIds = (comparison: ClubComparison) =>
  JSON.parse(
    JSON.stringify(comparison, (key, value: unknown) => (key === "gameId" ? undefined : value))
  ) as unknown;

const HALVES: Array<[string, SeasonSegment | undefined]> = [
  ["year", undefined],
  ["spring", "spring"],
  ["fall", "fall"],
];

describe("Scouting on the cloud's board", { timeout: 60_000 }, () => {
  it("says what the page's own Scouting says, off the board and the club cards", () => {
    const built = buildBoardsAndFacts({
      ageGroups,
      teams: loadScoutTeams(),
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today: FIXTURE_TODAY,
      past: false,
    });
    const boards = new Map(
      boardViews(ageGroups, built).map(({ key, value }) => [
        key,
        coerceBoardView(JSON.parse(JSON.stringify(value))),
      ])
    );
    const buckets = new Map<string, ClubBucket>();
    for (const { key, value } of clubViews({ ageGroups, built, namedAges: loadNamedAges() })) {
      const read = coerceClubBucket(JSON.parse(JSON.stringify(value)));
      if (!read) throw new Error(`bucket ${key} does not read back`);
      buckets.set(key, read);
    }
    const seen = { reports: 0, upcoming: 0, comparisons: 0, meetings: 0, common: 0, apart: 0 };
    for (const group of ageGroups) {
      const year = ageGroupYear(group);
      const known = built.known.get(year);
      if (!known) continue;
      const poolIdList = rankingPoolGroupIds(group.id, ageGroups);
      const poolIds = new Set(poolIdList);
      // The page: the year's games on the page's rating pool, named by its roster.
      const poolGames = gamesOnPages(known.games, poolIdList);
      const names = new Map(known.teams.map((team) => [team.id, team.name]));
      const cardOf = (teamId: string) => {
        const card = buckets.get(clubKey(year, clubBucketOf(teamId)))?.clubs[teamId];
        if (!card) throw new Error(`no card for ${teamId}`);
        return card;
      };
      for (const [half, segment] of HALVES) {
        const board = boards.get(`board:${year ?? "none"}:${group.id}:${half}`);
        if (!board) continue;
        const rows: ScoutRankingRow[] = withMine(board.rows, undefined);
        if (rows.length === 0) continue;
        const byId = new Map(known.teams.map((team) => [team.id, team]));
        const rankedTeams = rows.flatMap((row) => byId.get(row.teamId) ?? []);
        const clubs = clubsOfBoard(rows);
        const counts = (game: (typeof poolGames)[number]) =>
          countedInWindow(game, ageGroups, segment);
        const scouted = rows.slice(0, 25).map((row) => row.teamId);
        for (const teamId of scouted) {
          const at = `${teamId} on ${group.id} ${half}`;
          const picked = rows.slice(-3).map((row) => row.teamId);
          expect(buildScoutingReport(teamId, rows, clubs, { pickedIds: picked }), at).toEqual(
            buildScoutingReport(teamId, rows, rankedTeams, { pickedIds: picked })
          );
          seen.reports += 1;
          const card = cardOf(teamId);
          const ours = buildUpcomingSchedule(
            teamId,
            rows,
            poolGamesOfCard(card, poolIds),
            teamsOfCard(card),
            FIXTURE_TODAY
          );
          const theirs = buildUpcomingSchedule(teamId, rows, poolGames, known.teams, FIXTURE_TODAY);
          expect(withoutIds(ours), at).toEqual(withoutIds(theirs));
          seen.upcoming += theirs.length;
          // A game of the club's on a page outside this one's pool, which its card holds.
          if (card.games.some((game) => !poolIds.has(game.ageGroupId))) seen.apart += 1;
        }
        // Each scouted club beside the next few on the board, and beside every club it met.
        for (const [index, aId] of scouted.slice(0, 8).entries()) {
          const met = new Set(
            poolGames.flatMap((game) =>
              game.teamAId === aId ? [game.teamBId] : game.teamBId === aId ? [game.teamAId] : []
            )
          );
          const besides = [
            ...scouted.slice(index + 1, index + 4),
            ...[...met].filter((id) => rows.some((row) => row.teamId === id)).slice(0, 3),
          ].filter((bId) => bId !== aId);
          for (const bId of besides) {
            const a = cardOf(aId);
            const b = cardOf(bId);
            const together = new Map(
              [...teamsOfCard(a), ...teamsOfCard(b)].map((team) => [team.id, team.name])
            );
            const ours = compareClubs(
              aId,
              bId,
              gamesOfTwo(poolGamesOfCard(a, poolIds), aId, poolGamesOfCard(b, poolIds), bId),
              rows,
              (teamId) => together.get(teamId) ?? "Unknown team",
              counts
            );
            const theirs = compareClubs(
              aId,
              bId,
              poolGames,
              rows,
              (teamId) => names.get(teamId) ?? "Unknown team",
              counts
            );
            expect(comparedWithoutIds(ours), `${aId} beside ${bId} on ${group.id} ${half}`).toEqual(
              comparedWithoutIds(theirs)
            );
            seen.comparisons += 1;
            if (met.has(bId)) seen.meetings += 1;
            seen.common += theirs.common.length;
          }
        }
      }
    }
    // Every case is reached: upcoming games, clubs that met, and opponents in common.
    expect(
      Object.values(seen).every((count) => count > 0),
      JSON.stringify(seen)
    ).toBe(true);
  });
});
