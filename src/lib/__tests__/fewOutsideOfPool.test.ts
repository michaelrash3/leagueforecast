import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, madeUpClub, poolFixture } from "../../../scripts/poolFixture";
import { ageGroupYear, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { coerceLogs, coerceMatchups, coerceTeams } from "../validate";
import type { SeasonReader } from "../live/allKnown";
import { buildBoardsAndFacts } from "../live/views/board";
import {
  fewOutsideOfPool,
  yearBoardsOf,
  type FewOutsideInput,
  type YearBoardPage,
} from "../fewOutsideLeaders";
import { FEW_OUTSIDE_GAMES } from "../fewOutside";

/*
 * The list read off the boards' own year rows, on the seeded pool the board parity tests draw
 * (`scripts/poolFixture.ts`, every club made up): last year's three pages, this year's seven and one
 * with no year, League Standings seasons that mint and link clubs, and a club taken off as plainly
 * made up. The year boards a server publishes (`buildBoardsAndFacts`) are the rows the list ranks
 * its leaders by, so a board that moved would move the list, and a list that ranked by anything
 * else would be caught here.
 */

const seeded = poolFixture({ seed: 7, clubsPerPage: 300 });

/*
 * Two groups that play only each other, laid beside the seeded pool on this year's 10U page, in a
 * state of their own so they lead it: the Quarry clubs with two opponents known only by name and a
 * TBD, and the Shale clubs, every one of them pulled. The seeded pool alone is well connected: of
 * its leaders only one, on the page with no year, has a group short of outside games.
 */
const quarryClub = (id: string, name: string): ScoutTeam => ({
  id,
  name,
  state: "WV",
  gcTeams: [
    {
      teamId: `gc${id}`,
      name,
      ageGroupId: "ag_10u_2027",
      season: "spring",
      seasonYear: 2027,
      ageLevel: 10,
    },
  ],
});
const LOOPED: ScoutTeam[] = [
  quarryClub("Q1", "Quarry Club 1 10U"),
  quarryClub("Q2", "Quarry Club 2 10U"),
  quarryClub("Q3", "Quarry Club 3 10U"),
  { id: "QR1", name: "Quarry Rival A 10U", nameOnly: true },
  { id: "QR2", name: "Quarry Rival B 10U", nameOnly: true },
  { id: "QTBD", name: "Winner of Game 99", placeholder: true },
  quarryClub("S1", "Shale Club 1 10U"),
  quarryClub("S2", "Shale Club 2 10U"),
];
const loopGame = (at: number, a: string, b: string, runs: [number, number]): ScoutGame => ({
  id: `loop${at}`,
  ageGroupId: "ag_10u_2027",
  teamAId: a,
  teamBId: b,
  teamAScore: runs[0],
  teamBScore: runs[1],
  date: `2027-03-${String(1 + at).padStart(2, "0")}`,
});
const LOOP_GAMES: ScoutGame[] = [
  loopGame(0, "Q1", "Q2", [11, 1]),
  loopGame(1, "Q1", "Q3", [12, 2]),
  loopGame(2, "Q2", "Q3", [6, 4]),
  loopGame(3, "Q1", "QR1", [10, 0]),
  loopGame(4, "Q1", "QR1", [9, 1]),
  loopGame(5, "Q3", "QR2", [7, 3]),
  loopGame(6, "Q2", "QTBD", [5, 4]),
  loopGame(7, "Q1", "Q2", [10, 2]),
  loopGame(8, "S1", "S2", [8, 2]),
  loopGame(9, "S1", "S2", [9, 3]),
];
const fixture = {
  ...seeded,
  teams: [...seeded.teams, ...LOOPED],
  games: [...seeded.games, ...LOOP_GAMES],
};

const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

const byYear =
  (groups: AgeGroup[], games: ScoutGame[]) =>
  (year: number | undefined): ScoutGame[] =>
    games.filter(
      (game) => ageGroupYear(groups.find((group) => group.id === game.ageGroupId)) === year
    );

const INPUT: FewOutsideInput = {
  ageGroups: fixture.ageGroups,
  teams: fixture.teams,
  gamesOfYear: byYear(fixture.ageGroups, fixture.games),
  readSeason,
  autoRemoved: madeUpClub(seeded).marks,
  today: FIXTURE_TODAY,
};

const BUILDS_EVERY_BOARD = { timeout: 30_000 };

describe("the leaders with few outside games of a stored pool", BUILDS_EVERY_BOARD, () => {
  it("are read off the year boards the server publishes, row for row and state for state", () => {
    const built = buildBoardsAndFacts({ ...INPUT, past: false });
    const published = new Map(
      built.boards
        .filter((board) => board.half === "year" && board.rows.length > 0)
        .map((board) => [board.pageId, board.rows])
    );
    const read = new Map<string, YearBoardPage>();
    for (const { fit, pages } of yearBoardsOf(INPUT)) {
      for (const page of pages) {
        read.set(page.pageId, page);
        // Every row's club is one of the fit's nodes, in a community.
        page.rows.forEach((row) => expect(fit.communities.of.has(row.teamId)).toBe(true));
      }
    }
    expect([...read.keys()].sort()).toEqual([...published.keys()].sort());
    for (const [pageId, rows] of published) {
      const page = read.get(pageId)!;
      expect(page.rows, pageId).toStrictEqual(rows);
      const places = built.facts.get(pageId)?.places;
      rows.forEach((row) =>
        expect(page.stateOf(row.teamId), `${pageId} ${row.teamId}`).toBe(
          places?.get(row.teamId)?.state
        )
      );
    }
  });

  it("are pinned on the seeded pool", () => {
    const list = fewOutsideOfPool(INPUT);
    // The Quarry club leads the nation's 10U board on five wins over its own group; the Larch club
    // is in the largest piece of the page with no year, its community 2 games short of 3.
    expect(
      list.leaders.map((leader) => [
        leader.name,
        leader.page,
        leader.state ?? null,
        leader.stateRank,
        leader.rank,
        leader.record,
        leader.group,
        leader.opponents.map(({ name, games, rated }) => `${name} ${games}/${rated}`),
      ])
    ).toEqual([
      ["Quarry Club 1 10U", "10U 2027", "WV", 1, 1, "5-0", 0, ["Quarry Rival A 10U 2/2"]],
      ["Larch Club 20", "Showcase", "KY", 1, 10, "0-2-1", 1, ["Larch Rival 24 1/1"]],
      ["Shale Club 1 10U", "10U 2027", "WV", 2, 59, "2-0", 2, []],
      ["Quarry Club 2 10U", "10U 2027", "WV", 3, 138, "2-2", 0, []],
      ["Quarry Club 3 10U", "10U 2027", "WV", 4, 147, "1-2", 0, ["Quarry Rival B 10U 1/1"]],
      ["Shale Club 2 10U", "10U 2027", "WV", 5, 167, "0-2", 2, []],
    ]);
    expect(
      list.groups.map(({ toFind, ...group }) => [
        group,
        toFind.map(({ name, rated }) => `${name} ${rated}`),
      ])
    ).toEqual([
      [
        { sides: 6, pulled: 3, byHand: 0, nameOnly: 2, slots: 1, outside: 0 },
        ["Quarry Rival A 10U 2", "Quarry Rival B 10U 1"],
      ],
      [{ sides: 2, pulled: 1, byHand: 0, nameOnly: 1, slots: 0, outside: 2 }, ["Larch Rival 24 1"]],
      [{ sides: 2, pulled: 2, byHand: 0, nameOnly: 0, slots: 0, outside: 0 }, []],
    ]);
    // Each leader stands on its board as the list says, with its group's outside games.
    const built = buildBoardsAndFacts({ ...INPUT, past: false });
    for (const leader of list.leaders) {
      const rows =
        built.boards.find((board) => board.pageId === leader.pageId && board.half === "year")
          ?.rows ?? [];
      const row = rows[leader.rank - 1];
      expect(row?.teamId, leader.name).toBe(leader.teamId);
      const group = list.groups[leader.group];
      expect(group?.outside).toBe(row?.outsideGames);
      expect(!row?.comparable || (row.outsideGames ?? 0) < FEW_OUTSIDE_GAMES).toBe(true);
    }
  });
});
