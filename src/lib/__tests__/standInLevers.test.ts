import { describe, expect, it } from "vitest";
import {
  boardShift,
  coreNameWords,
  leaveOutStandIns,
  namesakeFilings,
  oneOffGames,
  standInBreakdown,
  wordFilings,
} from "../standInLevers";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * What the year's share of games on a stand-in is made of, which games a lever leaving one-off names
 * out would take, and how far a board's places move between two readings. Placeholder names.
 */
const PAGE = "ag_10u_2027";
const OLD = "ag_10u_2026";
const GROUPS: AgeGroup[] = [
  { id: PAGE, name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: OLD, name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
];
const pulled = (id: string): ScoutTeam => ({
  id,
  name: `Club ${id}`,
  gcTeams: [{ teamId: `gc-${id}`, name: `Club ${id}`, ageGroupId: PAGE, ageLevel: 10 }],
});
const TEAMS: ScoutTeam[] = [
  pulled("A"),
  pulled("B"),
  { id: "ONCE", name: "Once", nameOnly: true },
  { id: "TWICE", name: "Twice", nameOnly: true },
  { id: "SLOT", name: "Winner of Game 3", placeholder: true },
];
let made = 0;
const game = (a: string, b: string, ageGroupId = PAGE): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId,
  teamAId: a,
  teamBId: b,
  teamAScore: 3,
  teamBScore: 1,
});
const GAMES = [
  game("A", "B"),
  game("A", "ONCE"),
  game("A", "TWICE"),
  game("B", "TWICE"),
  game("B", "SLOT"),
  // Another year's game is not counted.
  game("A", "ONCE", OLD),
];

describe("the year's games on a stand-in, by what holds them there", () => {
  it("counts each game once, by its slot or by how many games its name holds and why", () => {
    const why = { ONCE: "unmatched", TWICE: "oneOtherState" } as const;
    const breakdown = standInBreakdown(TEAMS, GAMES, GROUPS, 2027, (id) =>
      id in why ? why[id as keyof typeof why] : undefined
    );
    expect(breakdown).toEqual({
      games: 5,
      onStandIn: 4,
      slots: 1,
      byCount: { "1": 1, "2": 2, "3-4": 0, "5-9": 0, "10+": 0 },
      byWhy: { unmatched: 1, oneOtherState: 2 },
      oneOffByWhy: { unmatched: 1 },
      byCountWhy: {
        "1": { unmatched: 1 },
        "2": { oneOtherState: 2 },
        "3-4": {},
        "5-9": {},
        "10+": {},
      },
    });
  });

  it("reads a game of two names by the one holding fewer games", () => {
    const twoNames = [...GAMES.slice(0, 5), game("ONCE", "TWICE")];
    const breakdown = standInBreakdown(TEAMS, twoNames, GROUPS, 2027, () => "unmatched");
    // "Once" now holds two games, and "Twice" three: the game of both is read as "Once"'s.
    expect(breakdown.byCount).toEqual({ "1": 0, "2": 2, "3-4": 2, "5-9": 0, "10+": 0 });
  });
});

describe("the games a one-off name holds", () => {
  it("is every game whose every name side holds no other, and never a game with a slot", () => {
    const year = GAMES.slice(0, 5);
    expect([...oneOffGames(TEAMS, year)]).toEqual([year[1]!.id]);
    // "Solo" holds one game, against a slot: never one, the slot being another question.
    const solo: ScoutTeam = { id: "SOLO", name: "Solo", nameOnly: true };
    const teams = [...TEAMS, solo];
    expect([...oneOffGames(teams, [...year, game("SOLO", "SLOT")])]).toEqual([year[1]!.id]);
    // A game of a one-off name and one holding two: not every name side is a one-off.
    const mixed = [...year.filter((one) => one.teamBId !== "ONCE"), game("SOLO", "TWICE")];
    expect([...oneOffGames(teams, mixed)]).toEqual([]);
    // Names holding two games or fewer: both of "Twice"'s as well.
    expect([...oneOffGames(TEAMS, year, 2)]).toEqual([year[1]!.id, year[2]!.id, year[3]!.id]);
  });
});

describe("a lever as the model sweep tries it", () => {
  it("leaves out the few-game names' games of those trained, and the slots' games where asked", () => {
    const trained = GAMES.slice(0, 5).map((game) => ({ game, ageGap: 0 }));
    const ids = (set: ReadonlySet<string>) => [...set].sort();
    expect(ids(leaveOutStandIns(1, false)(TEAMS, trained))).toEqual([GAMES[1]!.id]);
    expect(ids(leaveOutStandIns(2, false)(TEAMS, trained))).toEqual(
      [GAMES[1]!.id, GAMES[2]!.id, GAMES[3]!.id].sort()
    );
    expect(ids(leaveOutStandIns(1, true)(TEAMS, trained))).toEqual(
      [GAMES[1]!.id, GAMES[4]!.id].sort()
    );
    expect(ids(leaveOutStandIns(0, true)(TEAMS, trained))).toEqual([GAMES[4]!.id]);
  });
});

describe("how far a board's places move", () => {
  const board = (ids: string[]) => ids.map((teamId, at) => ({ teamId, rank: at + 1 }));

  it("says the top kept, the middle move and the clubs moving more than a tenth of the board", () => {
    const before = board(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    const after = board(["b", "a", "c", "d", "e", "f", "g", "j", "i", "h"]);
    expect(boardShift(before, after, 3)).toEqual({
      compared: 10,
      topKept: 3,
      top: 3,
      medianMove: 0,
      movedTenth: 2,
    });
    expect(boardShift(before, board(["x", "y", "z"]), 3)).toMatchObject({
      compared: 0,
      topKept: 0,
      medianMove: 0,
    });
  });
});

describe("each name filed onto its namesake, as far as a reach goes", () => {
  const year = (level: number): AgeGroup => ({
    id: `ag_${level}u_2027`,
    name: `${level}U 2027`,
    ageLevel: level,
    year: 2027,
    seasonIds: [],
  });
  const groups = [year(10), year(11), year(12), year(14)];
  const club = (id: string, name: string): ScoutTeam => ({
    id,
    name,
    state: "KY",
    gcTeams: [{ teamId: `gc-${id}`, name, ageGroupId: "ag_10u_2027", ageLevel: 10 }],
  });
  const name = (id: string, called: string): ScoutTeam => ({ id, name: called, nameOnly: true });
  const teams: ScoutTeam[] = [
    club("A", "Namer"),
    club("HAWKS", "Hawks"),
    club("STARS", "St. Louis Stars"),
    club("OWLS", "Owls"),
    club("BATS", "Bats"),
    club("TWO-11", "Pair"),
    club("TWO-12", "Pair"),
    club("X", "Other"),
    name("n-hawks", "Hawks"),
    name("n-stars", "Saint Louis Stars Baseball"),
    name("n-owls", "Owls"),
    name("n-bats", "Bats"),
    name("n-pair", "Pair"),
    name("n-nobody", "Nobody"),
  ];
  const games = [
    // The namesakes, each at home on its own page.
    game("HAWKS", "A", "ag_10u_2027"),
    game("STARS", "A", "ag_10u_2027"),
    game("OWLS", "X", "ag_12u_2027"),
    game("BATS", "X", "ag_14u_2027"),
    game("TWO-11", "X", "ag_11u_2027"),
    game("TWO-12", "X", "ag_12u_2027"),
    // The names, every one on the 10U page.
    game("A", "n-hawks", "ag_10u_2027"),
    game("A", "n-stars", "ag_10u_2027"),
    game("A", "n-owls", "ag_10u_2027"),
    game("A", "n-bats", "ag_10u_2027"),
    game("A", "n-pair", "ag_10u_2027"),
    game("A", "n-nobody", "ag_10u_2027"),
  ];
  const filed = (reach: "one" | "near" | "elsewhere") =>
    Object.fromEntries(namesakeFilings(teams, games, groups, 2027, reach));

  it("files the one of the name on its page, then the one spelled near it", () => {
    expect(filed("one")).toEqual({ "n-hawks": "HAWKS" });
    expect(filed("near")).toEqual({ "n-hawks": "HAWKS", "n-stars": "STARS" });
  });

  it("then the one of the name within two levels, never one further off or one of several", () => {
    expect(filed("elsewhere")).toEqual({
      "n-hawks": "HAWKS",
      "n-stars": "STARS",
      "n-owls": "OWLS",
    });
  });
});

describe("a name filed onto the one pulled club whose name's words it holds, or that hold it", () => {
  const page = (level: number): AgeGroup => ({
    id: `ag_${level}u_2027`,
    name: `${level}U 2027`,
    ageLevel: level,
    year: 2027,
    seasonIds: [],
  });
  const groups = [page(10), page(12), page(14)];
  const club = (id: string, name: string, state: string, level = 10): ScoutTeam => ({
    id,
    name,
    state,
    gcTeams: [{ teamId: `gc-${id}`, name, ageGroupId: `ag_${level}u_2027`, ageLevel: level }],
  });
  const name = (id: string, called: string): ScoutTeam => ({ id, name: called, nameOnly: true });
  // Two thousand clubs called Hawks something, so "hawks" says nothing of which club: each with a
  // word of letters of its own, since a number alone reads as an age.
  const letters = (at: number) => at.toString(10).replace(/\d/g, (digit) => "abcdefghij"[+digit]!);
  const many = Array.from({ length: 2000 }, (_, at) =>
    club(`H${at}`, `Hawks q${letters(at)}`, "TX")
  );
  const teams: ScoutTeam[] = [
    ...many,
    club("AR", "Arkansas Namer", "AR"),
    club("PA", "Pennsylvania Namer", "PA"),
    club("TX", "Texas Namer", "TX"),
    club("MI", "Michigan Namer", "MI"),
    club("NJ", "New Jersey Namer", "NJ"),
    club("SY", "Sheridan Yellowjacket", "AR"),
    club("GV", "Ghost Valley Dawgs Black", "PA"),
    club("PT", "Prodigy Baseball Texas", "TX"),
    club("KG", "Kiski Guardians", "PA", 14),
    club("BG", "LV Bruins Gold", "TX"),
    club("BB", "LV Bruins Blue", "TX"),
    club("MD", "Mason Devine", "CA"),
    club("ML", "Mount Laurel", "NJ"),
    club("HK", "Hawks", "TX"),
    name("n-sy", "Sheridan Yellowjacket Fall 2026"),
    name("n-gv", "Ghost Valley Dawgs"),
    name("n-pt", "Texas Prodigy"),
    name("n-kg", "Kiski"),
    name("n-lv", "LV Bruins"),
    name("n-md", "Mason Coach Pitch Devine"),
    name("n-ml", "Mt Laurel Babe Ruth"),
    name("n-hk", "Hawks Elite"),
  ];
  const on = (a: string, b: string) => game(a, b, "ag_10u_2027");
  const games = [
    on("AR", "n-sy"),
    on("PA", "n-gv"),
    on("TX", "n-pt"),
    on("PA", "n-kg"),
    on("TX", "n-lv"),
    on("MI", "n-md"),
    on("NJ", "n-ml"),
    on("TX", "n-hk"),
  ];
  const filed = (region: boolean, already = new Map<string, string>()) =>
    Object.fromEntries(wordFilings(teams, games, groups, 2027, already, region));

  it("reads a name's words with the season off and its shortenings spelled out, in any order", () => {
    expect([...coreNameWords("Sheridan Yellowjacket Fall 2026")]).toEqual([
      "sheridan",
      "yellowjacket",
    ]);
    expect([...coreNameWords("Mt Laurel - Babe Ruth F26")]).toEqual([
      "mount",
      "laurel",
      "babe",
      "ruth",
    ]);
    expect(filed(true)).toEqual({ "n-sy": "SY", "n-gv": "GV", "n-pt": "PT", "n-ml": "ML" });
  });

  it("never files where the words shared say little, two clubs fit, or the club is levels off", () => {
    const at = filed(true);
    // "Hawks" is in two thousand names; two LV Bruins fit; Kiski Guardians are four levels up.
    expect(at).not.toHaveProperty("n-hk");
    expect(at).not.toHaveProperty("n-lv");
    expect(at).not.toHaveProperty("n-kg");
  });

  it("asks for a state of a club that named it or one bordering it, where asked to", () => {
    expect(filed(true)).not.toHaveProperty("n-md");
    expect(filed(false)).toHaveProperty("n-md", "MD");
  });

  it("leaves a name another lever filed", () => {
    expect(filed(true, new Map([["n-sy", "X"]]))).not.toHaveProperty("n-sy");
  });
});
