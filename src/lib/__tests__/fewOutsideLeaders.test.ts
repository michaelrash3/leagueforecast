import { describe, expect, it } from "vitest";
import type { ScoutRankingRow, ScoutTeam } from "../teamRankings";
import { filterRankingsByState } from "../teamRankings/names";
import { fewOutsideLeaders, type YearBoards } from "../fewOutsideLeaders";
import { namesText, teamsToFind, type FewOutsideList } from "../fewOutside";

/*
 * The list on an invented year fit, small enough to write out whole: its communities and outside
 * games are set by hand, as `scheduleCommunities` would hand them over, so every rule of the list
 * is reached by name. Every club here is made up.
 *
 * 2027 (pages 10U and 11U), by community:
 * - A, off the largest piece: Owls, Larks and Rooks (pulled), Maple Robins and Cedar Wrens (known
 *   only by name), a TBD. Owls played the two named sides, Larks neither.
 * - B, 2 outside games: Hawks and Kites (pulled), Herons (entered by hand), Birch Finches (by name).
 * - C, 40 outside games: Eagles, Gulls and the fillers, well connected.
 * - D, off the largest piece: Doves, Crows and Swifts (pulled), a TBD; nothing known only by name.
 * - E, F, G, H, each off the largest piece: Jays with Elm Sparrows; Terns; Pipits; Plovers with Fir
 *   Wagtails.
 * - I, off the largest piece: Petrels and a TBD, on a row from before rules 7 that says nothing of
 *   its community's outside games.
 * 2026 (page 10U): Owls again, with Maple Robins, off the largest piece.
 */

const pulled = (id: string, name: string, state?: string): ScoutTeam => ({
  id,
  name,
  ...(state ? { state } : {}),
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag10" }],
});
const byName = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string): ScoutTeam => ({ id, name: "TBD", placeholder: true });
const byHand = (id: string, name: string, state?: string): ScoutTeam => ({
  id,
  name,
  ...(state ? { state } : {}),
});

const fillersTn = Array.from({ length: 19 }, (_, at) =>
  pulled(`TN${at + 1}`, `Placeholder Filler TN ${at + 1}`, "TN")
);
const fillersOh = Array.from({ length: 5 }, (_, at) =>
  pulled(`OH${at + 1}`, `Placeholder Filler OH ${at + 1}`, "OH")
);

const TEAMS: Record<string, ScoutTeam> = Object.fromEntries(
  [
    pulled("OWLS", "Placeholder Owls", "OH"),
    pulled("LARKS", "Placeholder Larks", "OH"),
    pulled("ROOKS", "Placeholder Rooks", "OH"),
    byName("MAPLE", "Maple Robins"),
    byName("CEDAR", "Cedar Wrens"),
    slot("TBD1"),
    pulled("HAWKS", "Placeholder Hawks", "OH"),
    pulled("KITES", "Placeholder Kites", "IN"),
    byHand("HERONS", "Placeholder Herons", "OH"),
    byName("BIRCH", "Birch Finches"),
    pulled("EAGLES", "Placeholder Eagles", "OH"),
    pulled("GULLS", "Placeholder Gulls", "OH"),
    pulled("DOVES", "Placeholder Doves", "KY"),
    pulled("CROWS", "Placeholder Crows", "KY"),
    pulled("SWIFTS", "Placeholder Swifts", "KY"),
    slot("TBD2"),
    pulled("JAYS", "Placeholder Jays"),
    byName("ELM", "Elm Sparrows"),
    pulled("TERNS", "Placeholder Terns", "OH"),
    pulled("PIPITS", "Placeholder Pipits"),
    pulled("PLOVERS", "Placeholder Plovers", "TN"),
    byName("FIR", "Fir Wagtails"),
    pulled("PETRELS", "Placeholder Petrels", "KY"),
    slot("TBD3"),
    ...fillersTn,
    ...fillersOh,
  ].map((team) => [team.id, team])
);
const team = (id: string): ScoutTeam => {
  const found = TEAMS[id];
  if (!found) throw new Error(`no team ${id}`);
  return found;
};

const COMMUNITY: Record<string, number> = {
  OWLS: 0,
  LARKS: 0,
  ROOKS: 0,
  MAPLE: 0,
  CEDAR: 0,
  TBD1: 0,
  HAWKS: 1,
  KITES: 1,
  HERONS: 1,
  BIRCH: 1,
  EAGLES: 2,
  GULLS: 2,
  DOVES: 3,
  CROWS: 3,
  SWIFTS: 3,
  TBD2: 3,
  JAYS: 4,
  ELM: 4,
  TERNS: 5,
  PIPITS: 6,
  PLOVERS: 7,
  FIR: 7,
  PETRELS: 8,
  TBD3: 8,
  ...Object.fromEntries([...fillersTn, ...fillersOh].map((filler) => [filler.id, 2])),
};
const OUTSIDE = [0, 2, 40, 0, 0, 0, 0, 0, 0];

/** Each pair played this many rated games. */
const PLAYED: Array<[string, string, number]> = [
  ["OWLS", "LARKS", 2],
  ["OWLS", "MAPLE", 2],
  ["OWLS", "CEDAR", 1],
  ["ROOKS", "CEDAR", 2],
  ["LARKS", "TBD1", 1],
  ["HAWKS", "KITES", 3],
  ["HAWKS", "HERONS", 1],
  ["HAWKS", "BIRCH", 1],
  ["KITES", "BIRCH", 2],
  ["HAWKS", "EAGLES", 1],
  ["KITES", "EAGLES", 1],
  ["EAGLES", "GULLS", 4],
  ["DOVES", "CROWS", 3],
  ["DOVES", "SWIFTS", 1],
  ["DOVES", "TBD2", 1],
  ["JAYS", "ELM", 1],
  ["PLOVERS", "FIR", 1],
  ["PETRELS", "TBD3", 1],
  ...[...fillersTn, ...fillersOh].map((filler): [string, string, number] => [
    filler.id,
    "EAGLES",
    2,
  ]),
];

const ratedOf = (played: Array<[string, string, number]>) =>
  played.flatMap(([a, b, times]) =>
    Array.from({ length: times }, (_, at) => ({
      game: {
        id: `${a}-${b}-${at}`,
        ageGroupId: "ag10",
        teamAId: a,
        teamBId: b,
        teamAScore: 5,
        teamBScore: 3,
      },
      ageGap: 0,
    }))
  );

/** A board row as the fit cuts one: only what the list reads is not filler. */
const row = (
  teamId: string,
  record: string,
  comparable: boolean,
  outsideGames: number | undefined
): ScoutRankingRow => ({
  teamId,
  teamName: team(teamId).name,
  isMine: false,
  rank: 0,
  rating: 0,
  pointRating: 0,
  ...(outsideGames === undefined ? {} : { outsideGames }),
  record,
  wins: 0,
  losses: 0,
  ties: 0,
  games: 0,
  rawMargin: 0,
  strengthOfSchedule: 0,
  sosRank: 0,
  crossAgeGames: 0,
  componentSize: 0,
  componentId: comparable ? "main" : teamId,
  comparable,
  fromGameChanger: true,
});

/** The 10U 2027 board, best first; each row's place is its national rank. */
const BOARD_10U: ScoutRankingRow[] = [
  row("EAGLES", "9-0", true, 40), // 1, OH #1: well connected
  row("OWLS", "8-0", false, 0), // 2, OH #2
  row("HAWKS", "7-1", true, 2), // 3, OH #3
  row("DOVES", "6-0", false, 0), // 4, KY #1
  row("JAYS", "5-0", false, 0), // 5, no state: listed by the national top 25 alone
  row("LARKS", "5-1", false, 0), // 6, OH #4, none of its own to find
  row("GULLS", "5-2", true, undefined), // 7, OH #5: a row that says nothing of its community
  ...fillersTn.slice(0, 17).map((filler) => row(filler.id, "4-2", true, 40)), // 8-24, TN #1-#17
  row("PLOVERS", "3-0", false, 0), // 25, TN #18: the national top 25's last
  row("PIPITS", "3-1", false, 0), // 26, no state: past the national top 25
  ...fillersTn.slice(17).map((filler) => row(filler.id, "3-3", true, 40)), // 27-28, TN #19-#20
  ...fillersOh.map((filler) => row(filler.id, "2-3", true, 40)), // 29-33, OH #6-#10
  row("TERNS", "2-0", false, 0), // 34, OH #11: past the state top 10
  row("SWIFTS", "1-0", false, 0), // 35, KY #2
  row("PETRELS", "2-1", false, undefined), // 36, KY #3: off the largest piece, its count unsaid
];
const BOARD_11U: ScoutRankingRow[] = [row("KITES", "6-1", true, 2)];

const NODES_2027 = Object.keys(COMMUNITY).map(team);
const YEAR_2027: YearBoards = {
  fit: {
    nodes: NODES_2027,
    communities: {
      of: new Map(NODES_2027.map((node) => [node.id, COMMUNITY[node.id]!])),
      outside: OUTSIDE,
    },
    rated: ratedOf(PLAYED),
  },
  pages: [
    {
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      rows: BOARD_10U,
      stateOf: (teamId) => team(teamId).state,
    },
    {
      pageId: "ag11",
      page: "11U 2027",
      year: 2027,
      rows: BOARD_11U,
      stateOf: (teamId) => team(teamId).state,
    },
  ],
};
const YEAR_2026: YearBoards = {
  fit: {
    nodes: [team("OWLS"), team("MAPLE")],
    communities: {
      of: new Map([
        ["OWLS", 0],
        ["MAPLE", 0],
      ]),
      outside: [0],
    },
    rated: ratedOf([["OWLS", "MAPLE", 1]]),
  },
  pages: [
    {
      pageId: "ag10_26",
      page: "10U 2026",
      year: 2026,
      rows: [row("OWLS", "1-0", false, 0)],
      stateOf: (teamId) => team(teamId).state,
    },
  ],
};

const FEW: FewOutsideList = {
  leaders: [
    {
      teamId: "KITES",
      name: "Placeholder Kites",
      pageId: "ag11",
      page: "11U 2027",
      year: 2027,
      state: "IN",
      stateRank: 1,
      rank: 1,
      record: "6-1",
      group: 0,
      opponents: [{ teamId: "BIRCH", name: "Birch Finches", games: 2, rated: 3 }],
    },
    // Tied with the Kites on both ranks, and after them by its page, a year later in the walk.
    {
      teamId: "OWLS",
      name: "Placeholder Owls",
      pageId: "ag10_26",
      page: "10U 2026",
      year: 2026,
      state: "OH",
      stateRank: 1,
      rank: 1,
      record: "1-0",
      group: 1,
      opponents: [{ teamId: "MAPLE", name: "Maple Robins", games: 1, rated: 1 }],
    },
    {
      teamId: "DOVES",
      name: "Placeholder Doves",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "KY",
      stateRank: 1,
      rank: 4,
      record: "6-0",
      group: 2,
      opponents: [],
    },
    {
      teamId: "OWLS",
      name: "Placeholder Owls",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "OH",
      stateRank: 2,
      rank: 2,
      record: "8-0",
      group: 3,
      // The most games against it first, then the most in all.
      opponents: [
        { teamId: "MAPLE", name: "Maple Robins", games: 2, rated: 2 },
        { teamId: "CEDAR", name: "Cedar Wrens", games: 1, rated: 3 },
      ],
    },
    {
      teamId: "SWIFTS",
      name: "Placeholder Swifts",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "KY",
      stateRank: 2,
      rank: 35,
      record: "1-0",
      group: 2,
      opponents: [],
    },
    {
      teamId: "HAWKS",
      name: "Placeholder Hawks",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "OH",
      stateRank: 3,
      rank: 3,
      record: "7-1",
      group: 0,
      opponents: [{ teamId: "BIRCH", name: "Birch Finches", games: 1, rated: 3 }],
    },
    // Listed for being off the largest piece alone, its row saying nothing of its outside games.
    {
      teamId: "PETRELS",
      name: "Placeholder Petrels",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "KY",
      stateRank: 3,
      rank: 36,
      record: "2-1",
      group: 4,
      opponents: [],
    },
    {
      teamId: "LARKS",
      name: "Placeholder Larks",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "OH",
      stateRank: 4,
      rank: 6,
      record: "5-1",
      group: 3,
      opponents: [],
    },
    {
      teamId: "PLOVERS",
      name: "Placeholder Plovers",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      state: "TN",
      stateRank: 18,
      rank: 25,
      record: "3-0",
      group: 5,
      opponents: [{ teamId: "FIR", name: "Fir Wagtails", games: 1, rated: 1 }],
    },
    // No state: after every club with one.
    {
      teamId: "JAYS",
      name: "Placeholder Jays",
      pageId: "ag10",
      page: "10U 2027",
      year: 2027,
      stateRank: null,
      rank: 5,
      record: "5-0",
      group: 6,
      opponents: [{ teamId: "ELM", name: "Elm Sparrows", games: 1, rated: 1 }],
    },
  ],
  groups: [
    {
      sides: 4,
      pulled: 2,
      byHand: 1,
      nameOnly: 1,
      slots: 0,
      outside: 2,
      toFind: [{ teamId: "BIRCH", name: "Birch Finches", rated: 3 }],
    },
    {
      sides: 2,
      pulled: 1,
      byHand: 0,
      nameOnly: 1,
      slots: 0,
      outside: 0,
      toFind: [{ teamId: "MAPLE", name: "Maple Robins", rated: 1 }],
    },
    { sides: 4, pulled: 3, byHand: 0, nameOnly: 0, slots: 1, outside: 0, toFind: [] },
    {
      sides: 6,
      pulled: 3,
      byHand: 0,
      nameOnly: 2,
      slots: 1,
      outside: 0,
      // The most rated games first.
      toFind: [
        { teamId: "CEDAR", name: "Cedar Wrens", rated: 3 },
        { teamId: "MAPLE", name: "Maple Robins", rated: 2 },
      ],
    },
    { sides: 2, pulled: 1, byHand: 0, nameOnly: 0, slots: 1, outside: 0, toFind: [] },
    {
      sides: 2,
      pulled: 1,
      byHand: 0,
      nameOnly: 1,
      slots: 0,
      outside: 0,
      toFind: [{ teamId: "FIR", name: "Fir Wagtails", rated: 1 }],
    },
    {
      sides: 2,
      pulled: 1,
      byHand: 0,
      nameOnly: 1,
      slots: 0,
      outside: 0,
      toFind: [{ teamId: "ELM", name: "Elm Sparrows", rated: 1 }],
    },
  ],
};

describe("the leaders with few outside games", () => {
  it("are every state top-ten or national top-25 club whose group has played fewer than 3 games outside itself", () => {
    expect(fewOutsideLeaders([YEAR_2027, YEAR_2026])).toEqual(FEW);
  });

  it("place each club in its state as the state board numbers it", () => {
    const listed = fewOutsideLeaders([YEAR_2027]).leaders.filter(({ pageId }) => pageId === "ag10");
    for (const leader of listed) {
      if (!leader.state) continue;
      const board = filterRankingsByState(
        BOARD_10U,
        NODES_2027.map(({ id, state }) => ({ id, ...(state ? { state } : {}) })),
        leader.state
      );
      expect(board.findIndex((one) => one.teamId === leader.teamId) + 1, leader.name).toBe(
        leader.stateRank
      );
    }
  });

  it("hand over the names to find, each once, one a line", () => {
    const list = fewOutsideLeaders([YEAR_2027]);
    const named = (teamId: string) => {
      const leader = list.leaders.find((one) => one.teamId === teamId);
      if (!leader) throw new Error(`${teamId} is not listed`);
      return namesText(teamsToFind(list, leader));
    };
    expect(named("OWLS")).toBe("Maple Robins\nCedar Wrens");
    // None of its own: its group's, the most rated games first.
    expect(named("LARKS")).toBe("Cedar Wrens\nMaple Robins");
    // Nothing anywhere in its group to find.
    expect(named("DOVES")).toBe("");
    expect(namesText([{ name: "Twice" }, { name: "Once" }, { name: "Twice" }])).toBe("Twice\nOnce");
  });

  it("are none where no leader's group is short of outside games", () => {
    const connected: YearBoards = {
      ...YEAR_2027,
      fit: {
        ...YEAR_2027.fit,
        communities: { ...YEAR_2027.fit.communities, outside: OUTSIDE.map(() => 3) },
      },
      pages: YEAR_2027.pages.map((page) => ({
        ...page,
        rows: page.rows.map((one) => ({ ...one, comparable: true, outsideGames: 3 })),
      })),
    };
    expect(fewOutsideLeaders([connected])).toEqual({ leaders: [], groups: [] });
    expect(fewOutsideLeaders([])).toEqual({ leaders: [], groups: [] });
  });
});
