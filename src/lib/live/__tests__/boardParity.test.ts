import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, fingerprint, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import {
  ageGroupYear,
  rankingPoolGroupIds,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
} from "../../teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../../teamRankingsCompact";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import {
  createRankingsHandler,
  type PoolShipment,
  type WorkerResponse,
} from "../../../workers/rankingsProtocol";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "../allKnown";
import { BOARD_HALVES, buildAllBoards, ratingPools, type PageBoard } from "../views/board";

/**
 * The boards a server builds are the boards a browser draws, to the last digit.
 *
 * The browser's are the rankings worker's answers (`createRankingsHandler`), asked for each page
 * and half exactly as the page asks: the year's pool shipped in the compact codec, the page's own
 * star, and the worker's own clock. The server's are `buildAllBoards` over the same stored pool.
 * The pool is the seeded fixture (`scripts/poolFixture.ts`): about 3,000 teams over ten pages in
 * two squad years and one with none, with League Standings seasons that mint, link and fold, so
 * every branch a board turns on is reached, and this year's fit runs the sparse solver real pools
 * run. Stored and read back through the real storage layer first, so both sides start from what a
 * browser holds.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });

/** The League Standings seasons as the cloud copy's `league` part holds them: coerced. */
const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

let ageGroups: AgeGroup[] = [];
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // The worker reads its day off the clock, in the zone it runs in: noon on the fixture's day.
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  ageGroups = loadAgeGroups();
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

type PoolSource = {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  readSeason: SeasonReader;
};

/**
 * What the worker answers for every page and half, asked as the page asks it.
 *
 * Fresh, each page is asked with a pool of its own, for a worker that has fitted nothing for it.
 * Navigating, the pages are asked as a reader moving through the tabs asks them, every page on one
 * half before the next half: the pool is shipped once and named by its revision after that, for as
 * long as the page holds the same year and pool, so the worker's own cache of its one fit
 * (`yearFitKey`) decides what the next tab is cut from.
 */
const workerBoards = (source: PoolSource, navigating: boolean): Map<string, ScoutRankingRow[]> => {
  const { ageGroups, teams, gamesOfYear } = source;
  const answers: WorkerResponse[] = [];
  const handle = createRankingsHandler(
    (response) => answers.push(response),
    () => 0
  );
  // Each page once, read as the page finds it: the first age group of its id.
  const pages = [...new Set(ageGroups.map((group) => group.id))].map((pageId) =>
    ageGroups.find((group) => group.id === pageId)!
  );
  const asks = navigating
    ? BOARD_HALVES.flatMap((span) => pages.map((group) => ({ group, ...span })))
    : pages.flatMap((group) => BOARD_HALVES.map((span) => ({ group, ...span })));
  const boards = new Map<string, ScoutRankingRow[]>();
  let id = 0;
  let held: { key: string; revision: number } | undefined;
  asks.forEach(({ group, half, segment }) => {
    const pageIds = rankingPoolGroupIds(group.id, ageGroups);
    const year = ageGroupYear(group);
    // The page hands its worker the same arrays while the year and the pool's pages stay put.
    const key = JSON.stringify(navigating ? [year ?? null, pageIds] : [group.id]);
    let pool: PoolShipment;
    if (held?.key === key) pool = { revision: held.revision };
    else {
      const known = deriveAllKnown({
        ageGroups,
        teams,
        yearGames: gamesOfYear(year),
        readSeason: source.readSeason,
      });
      held = { key, revision: (id += 1) };
      pool = {
        revision: held.revision,
        teams: encodeScoutTeams(known.teams),
        games: encodeScoutGames(gamesOnPages(known.games, pageIds)),
      };
    }
    handle({
      kind: "rankings",
      id: (id += 1),
      ageGroupId: group.id,
      ...(group.myTeamId ? { myTeamId: group.myTeamId } : {}),
      ageGroups,
      ...(segment ? { segment } : {}),
      pool,
    });
    const answer = answers[answers.length - 1];
    if (answer?.kind !== "rankings") throw new Error(`no board for ${group.id} ${half}`);
    boards.set(`${group.id}:${half}`, answer.rows);
  });
  return boards;
};

const builtBoards = (source: PoolSource): PageBoard[] =>
  buildAllBoards({ ...source, today: FIXTURE_TODAY });

/**
 * Every board `buildAllBoards` makes is the worker's, strictly, and it makes every one: a fresh
 * worker's, and one a reader has walked through the tabs. The worker reads the fixture's day off
 * the clock; the boards are built with the clock moved on, so they can only match by taking the
 * day they are handed, as a server whose own clock is elsewhere must.
 */
const expectParity = (source: PoolSource): PageBoard[] => {
  const expected = workerBoards(source, false);
  expect(workerBoards(source, true), "a worker walked through the tabs").toStrictEqual(expected);
  vi.setSystemTime(new Date("2027-06-30T12:00:00"));
  let built: PageBoard[];
  try {
    built = builtBoards(source);
  } finally {
    vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
  }
  expect(built.map(({ pageId, half }) => `${pageId}:${half}`).sort()).toEqual(
    [...expected.keys()].sort()
  );
  built.forEach(({ pageId, half, rows }) => {
    expect(rows, `${pageId} ${half}`).toStrictEqual(expected.get(`${pageId}:${half}`));
  });
  return built;
};

/** A number to the millionth, which no engine's last bit reaches. */
const toMillionth = (value: number) => Math.round(value * 1e6) / 1e6 || 0;

/**
 * The boards less what one JavaScript engine's last bit can move, so a pin holds on every Node a
 * contributor or CI runs. The recency weights' `0.5 ** x` rounds differently in V8 12.4 (Node 22)
 * and 13.6 (Node 24): measured on this fixture, 8,154 of the boards' numbers differ, none by more
 * than 3.6e-15, and on an earlier draw two clubs tied to that bit swapped schedule ranks. So each
 * number is cut to the millionth, the ranks are left out, and each board's rows go in id order,
 * which gives one fingerprint on Node 22, Node 24 and JavaScriptCore (Bun) alike. The order the
 * worker puts the rows in is the parity tests' to hold, on one engine, against its own worker.
 */
const steady = (boards: PageBoard[]) =>
  boards.map(({ pageId, half, rows }) => ({
    pageId,
    half,
    rows: rows
      .map(({ rank: _rank, sosRank: _sosRank, overallRank: _overallRank, ...row }) => ({
        ...row,
        rating: toMillionth(row.rating),
        pointRating: toMillionth(row.pointRating),
        rawMargin: toMillionth(row.rawMargin),
        strengthOfSchedule: toMillionth(row.strengthOfSchedule),
      }))
      .sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0)),
  }));

/**
 * The fixture's boards to the last digit, by the V8 version that drew them: Node 22's and Node 24's,
 * which Bun's JavaScriptCore matches. Taken under English collation, the order a server runs in
 * (en-US, which a C locale also resolves to): ranks tied to the last bit go in name order, and Thai
 * collation, which passes over spaces, puts two of them the other way. An engine not listed, or
 * another collation, skips this pin and keeps the steady one; a new engine's value is added here
 * once its boards are seen to match its own worker's.
 */
const DIGIT_PINS: Record<string, string> = { "12.4": "f7e87e1b", "13.6": "7c1c3cde" };
const engine = (globalThis as { process?: { versions?: { v8?: string } } }).process?.versions?.v8;
const english = new Intl.Collator().resolvedOptions().locale.startsWith("en");
const digitPin = english ? DIGIT_PINS[(engine ?? "").split(".").slice(0, 2).join(".")] : undefined;

/** The pool as the browser holds it: stored, then read back by the storage layer. */
const stored = (): PoolSource => ({
  ageGroups,
  teams: loadScoutTeams(),
  gamesOfYear: loadScoutGamesForYear,
  readSeason,
});

/** One squad year's games out of a list, in its order, as a shard holds them. */
const byYear =
  (groups: AgeGroup[], games: ScoutGame[]) =>
  (year: number | undefined): ScoutGame[] =>
    games.filter(
      (game) => ageGroupYear(groups.find((group) => group.id === game.ageGroupId)) === year
    );

describe("the boards a server builds", () => {
  it("are the worker's, every page and half, to the last digit", () => {
    const built = expectParity(stored());
    // The fixture reaches what it is there to reach: real boards on every ranked page, none on
    // the page too young to rank, and a year big enough for the sparse solver.
    const rowsOf = (pageId: string, half: string) =>
      built.find((board) => board.pageId === pageId && board.half === half)?.rows ?? [];
    expect(rowsOf("ag_8u_2027", "year")).toEqual([]);
    expect(rowsOf("ag_showcase", "year").length).toBeGreaterThan(0);
    expect(rowsOf("ag_9u_2027", "year").filter((row) => row.isMine)).toHaveLength(1);
    expect(rowsOf("ag_10u_2027", "year").filter((row) => row.isMine)).toHaveLength(1);
    const year2027 = built.filter(
      (board) => board.pageId.endsWith("_2027") && board.half === "year"
    );
    expect(year2027.reduce((rows, board) => rows + board.rows.length, 0)).toBeGreaterThan(150);
  });

  it("are the worker's from arrays that never went through storage, as a server holds after an edit", () => {
    /*
     * The worker fits what the page ships it, after the compact codec, which marks a slot read off
     * its name and drops empty fields. Arrays held in memory have had neither: the fixture's own
     * unmarked "TBD- …" slots would be ranked without the trip (`asWorkerSees`).
     */
    expectParity({
      ageGroups: fixture.ageGroups,
      teams: fixture.teams,
      gamesOfYear: byYear(fixture.ageGroups, fixture.games),
      readSeason,
    });
  });

  it("are the worker's for pages with no year, each a pool of its own fitted on its own games", () => {
    /*
     * A page from before the picker has no year, and every such page shares the one shard of
     * undated pages. Fitted on that whole shard, a club filed twice on the 10U page and once on the
     * 12U one reads as a 10U club, and leaves the 12U board the worker lists it on.
     */
    const groups: AgeGroup[] = [
      { id: "rec10", name: "Rec 10U", seasonIds: [] },
      { id: "rec12", name: "Rec 12U", seasonIds: [] },
    ];
    const teams: ScoutTeam[] = ["X", "Y", "Z", "W"].map((id) => ({ id, name: `Club ${id}` }));
    const played = (id: string, ageGroupId: string, teamBId: string): ScoutGame => ({
      id,
      ageGroupId,
      teamAId: "X",
      teamBId,
      teamAScore: 5,
      teamBScore: 3,
    });
    const games = [played("a", "rec12", "Y"), played("b", "rec10", "Z"), played("c", "rec10", "W")];
    const built = expectParity({
      ageGroups: groups,
      teams,
      gamesOfYear: byYear(groups, games),
      readSeason,
    });
    const rec12 = built.find((board) => board.pageId === "rec12" && board.half === "year");
    expect(rec12?.rows.map((row) => row.teamId)).toContain("X");
  });

  it("derive what a page knows once for each year, not once for each pool", () => {
    // Pages with no year are each a pool of their own, and all of them read the one undated shard.
    const source = stored();
    const asked: Array<number | undefined> = [];
    buildAllBoards({
      ...source,
      ageGroups: [...source.ageGroups, { id: "rec12", name: "Rec 12U", seasonIds: [] }],
      gamesOfYear: (year) => {
        asked.push(year);
        return source.gamesOfYear(year);
      },
      today: FIXTURE_TODAY,
    });
    expect(asked).toEqual([2026, 2027, undefined]);
  });

  it("carry nothing JSON loses, so the copy a member reads is the board", () => {
    const built = builtBoards(stored());
    // No -0, NaN, Infinity or key set to undefined: each would come back different from storage.
    expect(JSON.parse(JSON.stringify(built))).toStrictEqual(built);
  });

  it("hold still: the whole fixture's boards, pinned on every engine", () => {
    /*
     * Which clubs are on which board and every field of every row, numbers to the millionth,
     * folded into one fingerprint. A change that moves a number by more than that, or moves a club
     * on or off a board, moves it; a change meant to move the boards updates it and says so. It
     * cannot see a rank, the order of the rows or a last-bit change, such as the fit summing its
     * games in another order; the pin below holds those, where the engine is one it knows.
     */
    expect(fingerprint(steady(builtBoards(stored())))).toMatchInlineSnapshot(`"a2c59173"`);
  });

  it.skipIf(digitPin === undefined)(
    "hold still: the whole fixture's boards, to the last digit on the engine running",
    () => {
      // Every number, rank and row order exactly, so a change to the order the fit walks or sums
      // anything in is caught, as the parity tests cannot: both sides share that code.
      expect(fingerprint(builtBoards(stored()))).toBe(digitPin);
    }
  );

  it("put clubs that tie on rating and margin in name order, as the worker does", () => {
    // The fixture's two islands of one identical game each: the name alone decides between them.
    const rows =
      builtBoards(stored()).find((board) => board.pageId === "ag_12u_2027" && board.half === "year")
        ?.rows ?? [];
    const at = (name: string) => rows.findIndex((row) => row.teamName === name);
    const north = rows[at("Tied North Aces")];
    const south = rows[at("Tied South Aces")];
    expect(north).toBeDefined();
    expect(at("Tied South Aces")).toBe(at("Tied North Aces") + 1);
    expect(south?.rating).toBe(north?.rating);
    expect(south?.rawMargin).toBe(north?.rawMargin);
  });

  describe("when a restore repeats a page's id", () => {
    /*
     * Ids are minted unique, but a hand-edited restore can repeat one, and its readers then read
     * different copies: the page and its request the first (`ageGroups.find`), the fit a page's
     * level and year the last (`indexGroups`). Each page's board must still be the worker's
     * answer to the page's request, and come out once.
     */
    const teams: ScoutTeam[] = ["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` }));
    const played = (id: string, ageGroupId: string, pair: string, date: string): ScoutGame => ({
      id,
      ageGroupId,
      teamAId: pair[0] ?? "",
      teamBId: pair[1] ?? "",
      teamAScore: 7,
      teamBScore: 4,
      date,
    });
    const page = (id: string, ageLevel: number, year: number, more: Partial<AgeGroup> = {}) => ({
      id,
      name: `${ageLevel}U ${year}`,
      ageLevel,
      year,
      seasonIds: [],
      ...more,
    });
    const thisYear = [
      played("a", "d9", "AB", "2027-03-07"),
      played("b", "d9", "BC", "2027-03-07"),
      played("c", "d10", "CA", "2027-03-07"),
      played("d", "d10", "DA", "2027-03-14"),
    ];
    it.each<[string, AgeGroup[], ScoutGame[], string[]]>([
      [
        "with a club of its own, which the page's first copy does not name",
        [page("d9", 9, 2027), page("d10", 10, 2027), page("d9", 9, 2027, { myTeamId: "B" })],
        thisYear,
        ["d9", "d10"],
      ],
      [
        "too young to rank, after the copy that is not",
        [page("d9", 9, 2027), page("d10", 10, 2027), page("d9", 8, 2027)],
        thisYear,
        ["d10"],
      ],
      [
        "old enough to rank, after the copy that is not",
        [page("d9", 8, 2027), page("d9", 9, 2027), page("d10", 10, 2027)],
        thisYear,
        ["d9", "d10"],
      ],
      [
        // The fit reads the repeat's year, so the first copy's games fall outside it: no rows,
        // from the worker as from the builder.
        "in another squad year",
        [page("d10", 10, 2027), page("e10", 10, 2026), page("d10", 10, 2026)],
        [
          played("a", "d10", "AB", "2027-03-07"),
          played("b", "d10", "BC", "2027-03-07"),
          played("c", "e10", "CD", "2026-03-07"),
          played("d", "e10", "DA", "2026-03-14"),
        ],
        ["e10"],
      ],
      [
        // Listed in last year's rating pool, which names the repeat, but asked with its own.
        "in another squad year, whose pool names it first",
        [page("e10", 10, 2026), page("d10", 10, 2027), page("d10", 10, 2026)],
        [
          played("a", "d10", "AB", "2027-03-07"),
          played("b", "d10", "BC", "2027-03-07"),
          played("c", "e10", "CD", "2026-03-07"),
          played("d", "e10", "DA", "2026-03-14"),
        ],
        ["e10"],
      ],
      [
        // One pool, two fits: the repeat's year for its own page, this year for the other.
        "in another squad year, beside a page of its first copy's year",
        [page("d9", 9, 2027), page("d10", 10, 2027), page("d9", 9, 2026)],
        thisYear,
        ["d9", "d10"],
      ],
      [
        // One pool's pages under the same ids, read from two different years' games.
        "with another page, each repeated in the other's year",
        [page("d9", 9, 2026), page("d10", 10, 2027), page("d9", 9, 2027), page("d10", 10, 2026)],
        [
          played("a", "d9", "AB", "2027-03-07"),
          played("b", "d9", "BC", "2027-03-07"),
          played("c", "d10", "CD", "2026-03-07"),
          played("d", "d10", "DA", "2026-03-14"),
        ],
        ["d9", "d10"],
      ],
      [
        // Two pages with no year, listed in this year's pool by their repeats, each its own pool.
        "with no year, beside another, both repeated in this year",
        [
          page("d10", 10, 2027),
          { id: "u9", name: "Rec 9U", seasonIds: [] },
          { id: "u11", name: "Rec 11U", seasonIds: [] },
          page("u9", 9, 2027),
          page("u11", 11, 2027),
        ],
        [
          played("a", "u9", "AB", "2027-03-07"),
          played("b", "u11", "CD", "2027-03-07"),
          played("c", "d10", "DA", "2027-03-14"),
        ],
        ["d10", "u9", "u11"],
      ],
    ])("%s", (_case, groups, games, ranked) => {
      const built = expectParity({
        ageGroups: groups,
        teams,
        gamesOfYear: byYear(groups, games),
        readSeason,
      });
      const pageIds = [...new Set(groups.map((group) => group.id))];
      pageIds.forEach((pageId) => {
        const boards = built.filter((board) => board.pageId === pageId);
        expect(boards, pageId).toHaveLength(BOARD_HALVES.length);
        const yearRows = boards.find((board) => board.half === "year")?.rows ?? [];
        expect(yearRows.length > 0, pageId).toBe(ranked.includes(pageId));
      });
      expect(built.flatMap((board) => board.rows).some((row) => row.isMine)).toBe(false);
    });
  });

  it("give a pool with no page old enough to rank no rows, as the worker does", () => {
    const young: AgeGroup[] = [
      { id: "ag_8u_2030", name: "8U 2030", ageLevel: 8, year: 2030, seasonIds: [] },
    ];
    expect(ratingPools(young)).toEqual([["ag_8u_2030"]]);
    const boards = buildAllBoards({
      ageGroups: young,
      teams: fixture.teams,
      gamesOfYear: () => fixture.games.map((game) => ({ ...game, ageGroupId: "ag_8u_2030" })),
      readSeason,
      today: FIXTURE_TODAY,
    });
    expect(boards.map(({ half, rows }) => [half, rows.length])).toEqual([
      ["year", 0],
      ["fall", 0],
      ["spring", 0],
    ]);
  });
});

describe("the rating pools of a set of pages", () => {
  it("are each squad year's pages together, youngest first, and each page with no year alone", () => {
    const pools = ratingPools(fixture.ageGroups);
    expect(pools).toEqual([
      ["ag_9u_2026", "ag_10u_2026", "ag_11u_2026"],
      [
        "ag_8u_2027",
        "ag_9u_2027",
        "ag_10u_2027",
        "ag_11u_2027",
        "ag_12u_2027",
        "ag_13u_2027",
        "ag_14u_2027",
      ],
      ["ag_showcase"],
    ]);
  });
});
