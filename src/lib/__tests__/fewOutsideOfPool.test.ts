import { afterAll, describe, expect, it } from "vitest";
import {
  FIXTURE_TODAY,
  madeUpClub,
  poolFixture,
  type FixtureSeason,
} from "../../../scripts/poolFixture";
import { ageGroupYear, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { defaultSegmentFor, segmentWorthShowing } from "../teamRankings/halves";
import type { GameLog, Matchup, TeamBase } from "../types";
import { coerceLogs, coerceMatchups, coerceTeams } from "../validate";
import type { SeasonReader } from "../live/allKnown";
import { buildBoardsAndFacts, type BoardsBuilt } from "../live/views/board";
import { REPEAT_CASES, REPEAT_TEAMS } from "../live/__tests__/repeatedPageIds";
import {
  fewOutsideOfPool,
  openedBoardsOf,
  type BoardPage,
  type FewOutsideInput,
} from "../fewOutsideLeaders";
import {
  FEW_OUTSIDE_GAMES,
  FEW_OUTSIDE_NATIONAL_TOP,
  FEW_OUTSIDE_STATE_TOP,
  teamsToFind,
} from "../fewOutside";
import { autoRemovalsList, NO_REMOVALS } from "../autoRemoved";
import { memoryIo } from "../cloud/cloudRunner";
import { answerQuery } from "../live/queries";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGames,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveAutoRemoved,
  saveScoutGames,
  saveScoutTeams,
} from "../teamRankingsStorage";
import { createTidyHandler, packPool, type WorkerResponse } from "../../workers/tidyProtocol";

/*
 * The list read off the boards' own rows, on the seeded pool the board parity tests draw
 * (`scripts/poolFixture.ts`, every club made up): last year's three pages, this year's seven and one
 * with no year, League Standings seasons that mint and link clubs, and a club taken off as plainly
 * made up. Read on the fixture's own day in April, every page with a year opens on its spring
 * board, and the page with none on its year's. The boards a server publishes for those halves
 * (`buildBoardsAndFacts`) are the rows the list ranks its leaders by, so a board that moved would
 * move the list, and a list that ranked by any other board would be caught here.
 */

const seeded = poolFixture({ seed: 7, clubsPerPage: 300 });

/*
 * Groups that play only each other, laid beside the seeded pool on this year's 10U page in its
 * spring, in states of their own so they lead them: the Quarry clubs with two opponents known only
 * by name and a TBD, the Shale clubs, every one of them pulled, and a League Standings season in
 * which the Granite club plays four rec teams nobody has pulled, which the league mints as clubs
 * entered by hand.
 */
const quarryClub = (id: string, name: string, state = "WV"): ScoutTeam => ({
  id,
  name,
  state,
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
  // A slot stored as known only by name and not yet as a slot, as a club taken off and named like
  // one is: the pool's codec reads it as the slot it is (`markPlaceholders`), and it names nobody.
  { id: "QTBD", name: "Winner of Game 99", nameOnly: true },
  quarryClub("S1", "Shale Club 1 10U"),
  quarryClub("S2", "Shale Club 2 10U"),
  quarryClub("G1", "Granite Rec 10U", "NH"),
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

/** The Granite club's league: it, picked by a person, and four rec teams it alone played. */
const GRANITE_SEASON = "fx-granite-rec";
const GRANITE_TEAMS: TeamBase[] = [
  { id: "g-pick", name: "Granite Rec", scoutTeamId: "G1" },
  ...["Otters", "Badgers", "Voles", "Minks"].map((name) => ({
    id: `g-${name.toLowerCase()}`,
    name: `Granite Rec ${name}`,
  })),
];
const GRANITE_MATCHUPS: Matchup[] = GRANITE_TEAMS.slice(1).map((team, at) => ({
  id: `${GRANITE_SEASON}-m${at + 1}`,
  date: `3/${7 + 7 * at}`,
  away: team.id,
  home: "g-pick",
}));
const graniteWin = (runs: number): GameLog => ({
  awayRuns: "1",
  awayHits: "",
  awayK: "",
  homeRuns: String(runs),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const SEASONS: Record<string, FixtureSeason> = {
  ...seeded.seasons,
  [GRANITE_SEASON]: {
    teams: GRANITE_TEAMS,
    matchups: GRANITE_MATCHUPS,
    logs: Object.fromEntries(GRANITE_MATCHUPS.map(({ id }, at) => [id, graniteWin(6 + at)])),
  },
};
const fixture = {
  ...seeded,
  ageGroups: seeded.ageGroups.map((group) =>
    group.id === "ag_10u_2027"
      ? { ...group, seasonIds: [...group.seasonIds, GRANITE_SEASON] }
      : group
  ),
  teams: [...seeded.teams, ...LOOPED],
  games: [...seeded.games, ...LOOP_GAMES],
  seasons: SEASONS,
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

/** The half each page with rows opens on, on the fixture's day. */
const PINNED_HALVES = [
  ["ag_9u_2026", "spring"],
  ["ag_10u_2026", "spring"],
  ["ag_11u_2026", "spring"],
  ["ag_9u_2027", "spring"],
  ["ag_10u_2027", "spring"],
  ["ag_11u_2027", "spring"],
  ["ag_12u_2027", "spring"],
  ["ag_13u_2027", "spring"],
  ["ag_14u_2027", "spring"],
  ["ag_showcase", null],
];

/**
 * The list on the seeded pool, as it is read on the fixture's day: each leader's name, page, half,
 * state, places, record, group and opponents known only by name (games against it / in all).
 * The Quarry club leads the nation's 10U spring board on five wins over its own group, and the
 * Granite club its state's on four over rec teams its league minted; the Larch club is in the
 * largest piece of the page with no year, its community 2 games short of 3.
 */
const PINNED_LEADERS = [
  ["Quarry Club 1 10U", "10U 2027", "spring", "WV", 1, 1, "5-0", 0, ["Quarry Rival A 10U 2/2"]],
  ["Granite Rec 10U", "10U 2027", "spring", "NH", 1, 6, "4-0", 1, []],
  ["Larch Club 20", "Showcase", null, "KY", 1, 10, "0-2-1", 2, ["Larch Rival 24 1/1"]],
  ["Gum Club 98 11U", "11U 2027", "spring", "KY", 2, 7, "2-0", 3, []],
  [
    "Fir Club 154 10U",
    "10U 2027",
    "spring",
    "IN",
    2,
    13,
    "4-0-1",
    4,
    ["Fir Rival 188 10U 1/3", "Fir Rival 40 10U 1/1"],
  ],
  ["Shale Club 1 10U", "10U 2027", "spring", "WV", 2, 35, "2-0", 5, []],
  ["Gum Club 129 11U", "11U 2027", "spring", "TN", 3, 14, "4-0", 6, []],
  ["Quarry Club 2 10U", "10U 2027", "spring", "WV", 3, 113, "2-2", 0, []],
  [
    "Ivy Club 173 13U",
    "13U 2027",
    "spring",
    "OH",
    4,
    12,
    "2-1",
    7,
    ["Ivy Rival 214 13U 1/1", "Ivy Rival 238 13U 1/1"],
  ],
  [
    "Ivy Club 50 13U",
    "13U 2027",
    "spring",
    "IN",
    4,
    24,
    "3-1",
    8,
    [
      "Ivy Rival 108 13U 1/1",
      "Ivy Rival 213 13U 1/1",
      "Ivy Rival 269 13U 1/1",
      "Ivy Rival 74 13U 1/1",
    ],
  ],
  ["Quarry Club 3 10U", "10U 2027", "spring", "WV", 4, 125, "1-2", 0, ["Quarry Rival B 10U 1/1"]],
  ["Shale Club 2 10U", "10U 2027", "spring", "WV", 5, 144, "0-2", 5, []],
  [
    "Gum Club 109 11U",
    "11U 2027",
    "spring",
    "IN",
    7,
    15,
    "4-0",
    3,
    ["Gum Rival 298 11U 1/1", "Gum Rival 97 11U 1/1"],
  ],
  [
    "Ivy Club 42 13U",
    "13U 2027",
    "spring",
    "TN",
    8,
    30,
    "2-1-1",
    9,
    ["Ivy Rival 294 13U 1/2", "Ivy Rival 67 13U 1/1"],
  ],
  ["Gum Club 235 11U", "11U 2027", "spring", "OH", 8, 33, "3-2", 10, []],
  ["Elm Club 13 9U", "9U 2027", "spring", "OH", 8, 36, "2-0", 11, ["Elm Rival 3 9U 1/1"]],
  ["Hazel Squad 235 12U", "12U 2027", "spring", "OH", 9, 61, "1-1", 9, ["Hazel Rival 106 12U 1/1"]],
  ["Elm Club 216 9U", "9U 2027", "spring", "TN", 10, 38, "1-0", 12, []],
  ["Ivy Club 47 13U", "13U 2027", "spring", "IN", 10, 43, "1-0", 13, ["Ivy Rival 29 13U 1/1"]],
];

/** Each group: what it holds, then its sides known only by name and its clubs entered by hand. */
const PINNED_GROUPS = [
  [
    { sides: 6, pulled: 3, byHand: 0, nameOnly: 2, slots: 1, outside: 0 },
    ["Quarry Rival A 10U 2", "Quarry Rival B 10U 1"],
    [],
  ],
  [
    { sides: 5, pulled: 1, byHand: 4, nameOnly: 0, slots: 0, outside: 0 },
    [],
    ["Granite Rec Badgers 1", "Granite Rec Minks 1", "Granite Rec Otters 1", "Granite Rec Voles 1"],
  ],
  [{ sides: 2, pulled: 1, byHand: 0, nameOnly: 1, slots: 0, outside: 2 }, ["Larch Rival 24 1"], []],
  [
    { sides: 6, pulled: 4, byHand: 0, nameOnly: 2, slots: 0, outside: 1 },
    ["Gum Rival 298 11U 1", "Gum Rival 97 11U 1"],
    [],
  ],
  [
    { sides: 6, pulled: 3, byHand: 0, nameOnly: 3, slots: 0, outside: 2 },
    ["Fir Rival 131 10U 1", "Fir Rival 190 10U 1", "Fir Rival 40 10U 1"],
    [],
  ],
  [{ sides: 2, pulled: 2, byHand: 0, nameOnly: 0, slots: 0, outside: 0 }, [], []],
  [{ sides: 5, pulled: 4, byHand: 0, nameOnly: 0, slots: 1, outside: 0 }, [], []],
  [
    { sides: 4, pulled: 2, byHand: 0, nameOnly: 2, slots: 0, outside: 0 },
    ["Ivy Rival 214 13U 1", "Ivy Rival 238 13U 1"],
    [],
  ],
  [
    { sides: 5, pulled: 1, byHand: 0, nameOnly: 4, slots: 0, outside: 0 },
    ["Ivy Rival 108 13U 1", "Ivy Rival 213 13U 1", "Ivy Rival 269 13U 1", "Ivy Rival 74 13U 1"],
    [],
  ],
  [
    { sides: 12, pulled: 6, byHand: 1, nameOnly: 5, slots: 0, outside: 2 },
    [
      "Ivy Rival 294 13U 2",
      "Hazel Rival 106 12U 1",
      "Ivy Rival 193 13U 1",
      "Ivy Rival 226 13U 1",
      "Ivy Rival 67 13U 1",
    ],
    ["Hazel Squad 235 12U 2"],
  ],
  [
    { sides: 8, pulled: 7, byHand: 0, nameOnly: 1, slots: 0, outside: 2 },
    ["Hazel Rival 2 12U 1"],
    [],
  ],
  [{ sides: 3, pulled: 2, byHand: 0, nameOnly: 1, slots: 0, outside: 0 }, ["Elm Rival 3 9U 1"], []],
  [
    { sides: 7, pulled: 5, byHand: 0, nameOnly: 2, slots: 0, outside: 2 },
    ["Elm Rival 27 9U 1", "Elm Rival 50 9U 1"],
    [],
  ],
  [
    { sides: 2, pulled: 1, byHand: 0, nameOnly: 1, slots: 0, outside: 0 },
    ["Ivy Rival 29 13U 1"],
    [],
  ],
];

/** The leaders on their spring boards that the year boards would not list. */
const PINNED_SPRING_ONLY = [
  "Gum Club 98 11U 11U 2027",
  "Fir Club 154 10U 10U 2027",
  "Gum Club 129 11U 11U 2027",
  "Ivy Club 173 13U 13U 2027",
  "Ivy Club 50 13U 13U 2027",
  "Gum Club 109 11U 11U 2027",
  "Ivy Club 42 13U 13U 2027",
  "Gum Club 235 11U 11U 2027",
  "Elm Club 13 9U 9U 2027",
  "Hazel Squad 235 12U 12U 2027",
  "Elm Club 216 9U 9U 2027",
  "Ivy Club 47 13U 13U 2027",
];

const BUILDS_EVERY_BOARD = { timeout: 30_000 };

/** The half a page opens on, as the live page reads it off what the boards publish beside them. */
const openedHalf = (built: BoardsBuilt, groups: AgeGroup[], pageId: string, today: string) =>
  segmentWorthShowing(
    defaultSegmentFor(ageGroupYear(groups.find((group) => group.id === pageId)), today),
    built.facts.get(pageId)?.halves ?? { fall: 0, spring: 0 }
  ) ?? "year";

/**
 * The boards the list reads, held to the ones a server publishes: each page that opens on a board
 * with rows, once, on the half it opens on, its rows exactly those, and every club's state the one
 * the board's facts give it.
 */
const expectOpenedBoards = (input: FewOutsideInput): Map<string, BoardPage> => {
  const built = buildBoardsAndFacts({ ...input, past: false });
  const published = new Map(
    [...new Set(input.ageGroups.map((group) => group.id))].flatMap((pageId) => {
      const half = openedHalf(built, input.ageGroups, pageId, input.today);
      const rows =
        built.boards.find((board) => board.pageId === pageId && board.half === half)?.rows ?? [];
      return rows.length > 0 ? [[pageId, { half, rows }] as const] : [];
    })
  );
  const read = new Map<string, BoardPage>();
  for (const { fit, pages } of openedBoardsOf(input)) {
    for (const page of pages) {
      expect(read.has(page.pageId), page.pageId).toBe(false);
      read.set(page.pageId, page);
      // Every row's club is one of the fit's nodes, in a community.
      page.rows.forEach((row) => expect(fit.communities.of.has(row.teamId)).toBe(true));
    }
  }
  expect([...read.keys()].sort()).toEqual([...published.keys()].sort());
  for (const [pageId, { half, rows }] of published) {
    const page = read.get(pageId)!;
    expect(page.segment ?? "year", pageId).toBe(half);
    expect(page.rows, pageId).toStrictEqual(rows);
    const places = built.facts.get(pageId)?.places;
    rows.forEach((row) =>
      expect(page.stateOf(row.teamId), `${pageId} ${row.teamId}`).toBe(
        places?.get(row.teamId)?.state
      )
    );
  }
  return read;
};

describe("the leaders with few outside games of a stored pool", BUILDS_EVERY_BOARD, () => {
  it("are read off the board each page opens on, as the server publishes it, row for row and state for state", () => {
    const read = expectOpenedBoards(INPUT);
    // On the fixture's April day: every page with a year on its spring, the Showcase on its year.
    expect([...read.values()].map(({ pageId, segment }) => [pageId, segment])).toEqual(
      PINNED_HALVES
    );
  });

  /*
   * In January the calendar has moved to the spring, which holds a sliver of the year's play: a
   * page opens on its fall until the spring holds a tenth of the fall's counted games
   * (`segmentWorthShowing`), and the list reads the board the page opens on, not the calendar's.
   */
  it("are read off the fall where the spring holds too little to open on, as in January", () => {
    const read = expectOpenedBoards({ ...INPUT, today: "2027-01-02" });
    expect(
      [...read.values()].filter(({ year }) => year === 2027).map(({ segment }) => segment)
    ).toEqual(Array.from({ length: 6 }, () => "fall"));
  });

  it("are pinned on the seeded pool", () => {
    const list = fewOutsideOfPool(INPUT);
    expect(
      list.leaders.map((leader) => [
        leader.name,
        leader.page,
        leader.segment,
        leader.state ?? null,
        leader.stateRank,
        leader.rank,
        leader.record,
        leader.group,
        leader.opponents.map(({ name, games, rated }) => `${name} ${games}/${rated}`),
      ])
    ).toEqual(PINNED_LEADERS);
    expect(
      list.groups.map(({ toFind, byHandSides, ...group }) => [
        group,
        toFind.map(({ name, rated }) => `${name} ${rated}`),
        byHandSides.map(({ name, rated }) => `${name} ${rated}`),
      ])
    ).toEqual(PINNED_GROUPS);
    // Each leader stands on the board its page opens on as the list says, with its group's
    // outside games.
    const built = buildBoardsAndFacts({ ...INPUT, past: false });
    for (const leader of list.leaders) {
      const rows =
        built.boards.find(
          (board) => board.pageId === leader.pageId && board.half === (leader.segment ?? "year")
        )?.rows ?? [];
      const row = rows[leader.rank - 1];
      expect(row?.teamId, leader.name).toBe(leader.teamId);
      const group = list.groups[leader.group];
      expect(group?.outside).toBe(row?.outsideGames);
      expect(!row?.comparable || (row.outsideGames ?? 0) < FEW_OUTSIDE_GAMES).toBe(true);
    }
  });

  /*
   * From the spring on, the board a page opens on is not its year's: a group that plays only each
   * other in the spring can lead the spring board and be nowhere on the year's, or there with
   * enough outside games from the autumn. The list is the board the owner opens.
   */
  it("list a club that leads the spring board its page opens on, where the year's board would not", () => {
    const built = buildBoardsAndFacts({ ...INPUT, past: false });
    const yearOnly = (leader: { pageId: string; teamId: string; state?: string }) => {
      const rows =
        built.boards.find((board) => board.pageId === leader.pageId && board.half === "year")
          ?.rows ?? [];
      const at = rows.findIndex((row) => row.teamId === leader.teamId);
      const row = rows[at];
      if (!row) return false;
      const places = built.facts.get(leader.pageId)?.places;
      const stateRank = leader.state
        ? rows.slice(0, at + 1).filter((one) => places?.get(one.teamId)?.state === leader.state)
            .length
        : null;
      const leads =
        (stateRank !== null && stateRank <= FEW_OUTSIDE_STATE_TOP) ||
        at + 1 <= FEW_OUTSIDE_NATIONAL_TOP;
      return (
        leads &&
        (!row.comparable ||
          (row.outsideGames !== undefined && row.outsideGames < FEW_OUTSIDE_GAMES))
      );
    };
    const springOnly = fewOutsideOfPool(INPUT).leaders.filter(
      (leader) => leader.segment === "spring" && !yearOnly(leader)
    );
    expect(springOnly.map(({ name, page }) => `${name} ${page}`)).toEqual(PINNED_SPRING_ONLY);
  });

  it("offer the clubs a League Standings season minted in a group, by hand, as teams to find", () => {
    const list = fewOutsideOfPool(INPUT);
    const granite = list.leaders.find((leader) => leader.teamId === "G1");
    if (!granite) throw new Error("the Granite club is not listed");
    const group = list.groups[granite.group]!;
    // Nothing in its group is known only by name, so its four rec teams are the ones to find.
    expect([granite.opponents, group.toFind]).toEqual([[], []]);
    expect(group).toMatchObject({ pulled: 1, byHand: 4, nameOnly: 0, outside: 0 });
    expect(teamsToFind(list, granite).map(({ name, rated }) => `${name} ${rated}`)).toEqual([
      "Granite Rec Badgers 1",
      "Granite Rec Minks 1",
      "Granite Rec Otters 1",
      "Granite Rec Voles 1",
    ]);
  });

  /*
   * The two cards' lists: the server's answer to the look, off each year's stored games read a year
   * at a time, and the device's tidy worker, sent the whole stored pool, the seasons and the marks.
   * Both read the pool back from the storage layer, as each holds it.
   */
  it("are the same from the device's worker as from the server's answer, over the stored pool", async () => {
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    saveAgeGroups(fixture.ageGroups);
    saveScoutTeams(fixture.teams);
    saveScoutGames(fixture.games);
    saveAutoRemoved(INPUT.autoRemoved);
    const server = answerQuery({ kind: "health.inspect", today: FIXTURE_TODAY }, readSeason);
    if (server.kind !== "health.inspect") throw new Error("no look");
    const ageGroups = loadAgeGroups();
    const posted: WorkerResponse[] = [];
    createTidyHandler((response) => posted.push(response))({
      kind: "inspect",
      id: 1,
      state: packPool({ ageGroups, teams: loadScoutTeams(), games: loadScoutGames() }),
      stamp: "",
      today: FIXTURE_TODAY,
      boards: {
        seasons: [...new Set(ageGroups.flatMap((group) => group.seasonIds))].map(
          (seasonId): [string, ReturnType<SeasonReader>] => [seasonId, readSeason(seasonId)]
        ),
        marks: autoRemovalsList(INPUT.autoRemoved),
      },
    });
    const worker = posted.find((response) => response.kind === "inspect");
    if (worker?.kind !== "inspect") throw new Error("no inspection");
    expect(worker.fewOutside).toEqual(server.fewOutside);
    expect(server.fewOutside).toEqual(fewOutsideOfPool(INPUT));
  });

  /*
   * The board builder's own cases of a restore that repeats a page's id (`repeatedPageIds.ts`),
   * whose readers read different copies: the list's boards must still be the published ones.
   */
  describe("when a restore repeats a page's id", () => {
    it.each(REPEAT_CASES)("%s", (_case, groups, games) => {
      expectOpenedBoards({
        ageGroups: groups,
        teams: REPEAT_TEAMS,
        gamesOfYear: byYear(groups, games),
        readSeason: () => ({ teams: [], matchups: [], logs: {} }),
        autoRemoved: NO_REMOVALS,
        today: FIXTURE_TODAY,
      });
    });
  });
});

afterAll(() => resetTeamRankingsStore());
