import { describe, expect, it } from "vitest";
import { poolFixture } from "../../../scripts/poolFixture";
import {
  finalScoresKey,
  leagueFixturesOf,
  leagueScoutBridge,
  type AgeGroup,
  type LeagueFixture,
  type LeagueTeamLink,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { finalsTheBridgeReads } from "../teamRankings/leagueBridge";
import { normalizeDateInput } from "../date";

/*
 * The fixtures whose final the bridge's results can turn on (`finalsTheBridgeReads`): what lets a
 * device take a published bridge for a season with finals entered since, where none of them is one
 * of these, and ask where one is. The guard is that nothing is left out, so each case below varies
 * every other fixture's final every way that could pair a pool row with it, and finds the bridge
 * the same to the last field.
 */

const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["fall"] },
];
const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9" }],
});
const teams: ScoutTeam[] = [
  pulled("S-ACES", "Aces Baseball", "gcACES"),
  pulled("S-BEARS", "Bears Baseball", "gcBEARS"),
  pulled("S-COMETS", "Comets Baseball", "gcCOMETS"),
  { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
];
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
const league: LeagueTeamLink[] = [
  { id: "L-ACES", name: "Aces Baseball" },
  { id: "L-BEARS", name: "Bears Baseball" },
];
/** The Aces at the Bears on 25 September, 0-13; at home to them on 2 October, 4-2; and on 9 October. */
const FIXTURES: LeagueFixture[] = [
  { away: "Aces Baseball", home: "Bears Baseball", date: "9/25", awayRuns: 0, homeRuns: 13 },
  { away: "Bears Baseball", home: "Aces Baseball", date: "10/2", awayRuns: 4, homeRuns: 2 },
  { away: "Aces Baseball", home: "Bears Baseball", date: "10/9" },
];
const GAMES: ScoutGame[] = [
  // The Aces' own row of the 25 September game, filed against a slot: what the final pairs.
  row("gc_aces_1", "S-ACES", "S-TBD", "2026-09-25", 0, 13, "gcACES"),
  // The Bears' own row of the 2 October game, against the Aces themselves: the pass by fixture's.
  row("gc_bears_2", "S-BEARS", "S-ACES", "2026-10-02", 4, 2, "gcBEARS"),
  // The Aces' second game that day, against a club of its own, which stands in for nobody.
  row("gc_aces_2", "S-ACES", "S-COMETS", "2026-10-02", 2, 4, "gcACES"),
  // A game typed in by hand against a slot on 9 October: no club's own row, so never a copy.
  row("m_typed_9", "S-ACES", "S-TBD", "2026-10-09", 3, 1),
  // Something each played elsewhere, so both are on the season's page.
  row("gc_bears_9", "S-BEARS", "S-TBD", "2026-09-06", 5, 1, "gcBEARS"),
];

const bridgeWith = (
  fixtures: LeagueFixture[],
  pool: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] },
  seasonId: string,
  leagueTeams: LeagueTeamLink[]
) =>
  JSON.stringify(
    leagueScoutBridge(seasonId, pool.ageGroups, pool.teams, pool.games, leagueTeams, fixtures)
  );

/**
 * Every way fixture `at`'s final could be other than it is that could pair a pool row with it: none
 * at all, and each score a row of that day on the season's pages gave one of its sides.
 */
const otherFinals = (
  fixtures: LeagueFixture[],
  at: number,
  games: ScoutGame[],
  pages: ReadonlySet<string>
) => {
  const fixture = fixtures[at]!;
  const { awayRuns: _away, homeRuns: _home, ...unscored } = fixture;
  const day = normalizeDateInput(fixture.date);
  const scores = new Set<string>();
  for (const game of games) {
    if (!pages.has(game.ageGroupId) || normalizeDateInput(game.date ?? "") !== day) continue;
    if (game.teamAScore === undefined || game.teamBScore === undefined) continue;
    scores.add(`${game.teamAScore}-${game.teamBScore}`);
    scores.add(`${game.teamBScore}-${game.teamAScore}`);
  }
  return [
    unscored,
    ...[...scores].map((score) => {
      const [away, home] = score.split("-").map(Number);
      return { ...unscored, awayRuns: away!, homeRuns: home! };
    }),
  ].map((final) => fixtures.map((one, place) => (place === at ? final : one)));
};

/** The fixtures of `seasonId` none of whose finals moves its bridge, by trying each. */
const quietFixtures = (
  fixtures: LeagueFixture[],
  pool: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] },
  seasonId: string,
  leagueTeams: LeagueTeamLink[]
): { quiet: number[]; moved: number[] } => {
  const before = bridgeWith(fixtures, pool, seasonId, leagueTeams);
  const pages = new Set(
    pool.ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  const quiet: number[] = [];
  const moved: number[] = [];
  fixtures.forEach((_fixture, at) => {
    const still = otherFinals(fixtures, at, pool.games, pages).every(
      (varied) => bridgeWith(varied, pool, seasonId, leagueTeams) === before
    );
    (still ? quiet : moved).push(at);
  });
  return { quiet, moved };
};

describe("the finals a league season's bridge can turn on", () => {
  const pool = { ageGroups, teams, games: GAMES };

  it("are the fixtures a club's own row filed against nobody could be a copy of", () => {
    expect(finalsTheBridgeReads("fall", ageGroups, teams, GAMES, league, FIXTURES)).toEqual([0]);
    // Whatever their finals: unscored, the same game is still the one a final would pair.
    const unscored = FIXTURES.map(({ away, home, date }) => ({ away, home, date }));
    expect(finalsTheBridgeReads("fall", ageGroups, teams, GAMES, league, unscored)).toEqual([0]);
  });

  it("leave out no fixture whose final moves the bridge, and no other final moves it", () => {
    const read = finalsTheBridgeReads("fall", ageGroups, teams, GAMES, league, FIXTURES);
    const { quiet, moved } = quietFixtures(FIXTURES, pool, "fall", league);
    // The copy against a slot is the bridge's to drop once the league holds its score.
    expect(moved).toEqual([0]);
    expect(moved.every((at) => read.includes(at))).toBe(true);
    expect(quiet).toEqual([1, 2]);
  });

  it("are none for a season no page claims, which reaches no result at all", () => {
    const unclaimed = [{ ...ageGroups[0]!, seasonIds: [] }];
    expect(finalsTheBridgeReads("fall", unclaimed, teams, GAMES, league, FIXTURES)).toEqual([]);
  });

  it("leave out none on the seeded fixture's seasons, every other final tried every way", () => {
    const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
    for (const [seasonId, season] of Object.entries(fixture.seasons)) {
      const fixtures = leagueFixturesOf(
        season.teams,
        season.matchups,
        finalScoresKey(season.matchups, season.logs)
      );
      const linkTeams = season.teams.map(({ id, name, scoutTeamId }) => ({
        id,
        name,
        ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
      }));
      const read = finalsTheBridgeReads(
        seasonId,
        fixture.ageGroups,
        fixture.teams,
        fixture.games,
        linkTeams,
        fixtures
      );
      const { moved } = quietFixtures(fixtures, fixture, seasonId, linkTeams);
      expect(
        moved.filter((at) => !read.includes(at)),
        seasonId
      ).toEqual([]);
    }
  }, 120_000);
});
