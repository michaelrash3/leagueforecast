import { describe, expect, it } from "vitest";
import {
  buildTeamRankings,
  fitScoutYear,
  opponentWeb,
  rowsOfYearFit,
  WEB_CAP,
  WEB_GAMES,
  WEB_SAMPLE,
  WEB_SHARE,
} from "../teamRankings";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings/types";

/*
 * How far a club's web of games reaches, and the order a board lists clubs in by it
 * (`teamRankings/opponentWeb.ts`): the owner's rule of 26 October 2026, of the Longhorns.
 */

type Pair = [string, string];

/** `size` clubs in a ring, each playing the `width` clubs after it. */
const ring = (prefix: string, size: number, width: number): Pair[] =>
  Array.from({ length: size }, (_, at) =>
    Array.from({ length: width }, (_, step): Pair => [
      `${prefix}${at}`,
      `${prefix}${(at + step + 1) % size}`,
    ])
  ).flat();

describe("a club's web of games", () => {
  it("counts the distinct clubs within five games, itself left out", () => {
    // A chain of eight: the first reaches five clubs, the fourth every other club.
    const chain = Array.from({ length: 7 }, (_, at): Pair => [`A${at}`, `A${at + 1}`]);
    const web = opponentWeb(chain);
    expect(WEB_GAMES).toBe(5);
    expect(web.reach("A0")).toBe(5);
    expect(web.reach("A3")).toBe(7);
    expect(web.reach("nobody")).toBe(0);
  });

  it("counts a club once however many times it was played, and a club against itself not at all", () => {
    const web = opponentWeb([
      ["A", "B"],
      ["B", "A"],
      ["A", "B"],
      ["A", "A"],
      ["B", "C"],
    ]);
    expect(web.reach("A")).toBe(2);
    expect(web.reach("C")).toBe(2);
  });

  it("stops counting at the cap", () => {
    const star = Array.from({ length: WEB_CAP + 50 }, (_, at): Pair => ["hub", `c${at}`]);
    expect(opponentWeb(star).reach("hub")).toBe(WEB_CAP);
  });

  it("draws the line at a tenth of the typical club's web, and lists a club that reaches it", () => {
    // A ring of a hundred, each playing the two after it, reaches twenty clubs within five games;
    // a pair reaches one, a closed league of three two. The median of the 105 is a ring's.
    const web = opponentWeb([
      ...ring("R", 100, 2),
      ["P1", "P2"],
      ["K1", "K2"],
      ["K2", "K3"],
      ["K1", "K3"],
    ]);
    expect(web.reach("R7")).toBe(20);
    expect(web.typical).toBe(20);
    expect(WEB_SHARE).toBe(0.1);
    expect(web.line).toBe(2);
    expect(web.reachesLine("R7")).toBe(true);
    // At the line is reaching it; short of it is not.
    expect(web.reachesLine("K1")).toBe(true);
    expect(web.reachesLine("P1")).toBe(false);
    // A club no game names reaches nobody.
    expect(web.reachesLine("nobody")).toBe(false);
  });

  it("puts no line where no game was played", () => {
    const web = opponentWeb([]);
    expect(web.typical).toBe(0);
    expect(web.reachesLine("anybody")).toBe(true);
  });

  it("reads the typical web off clubs spread evenly through the games", () => {
    // Twice the sample's worth of clubs in pairs, named first, then four times as many in a ring:
    // two thirds of the clubs are the ring's, so the median is a ring club's twenty, which the
    // first clubs named alone would have put at one.
    const pairs = Array.from({ length: WEB_SAMPLE }, (_, at): Pair => [`P${at}a`, `P${at}b`]);
    const web = opponentWeb([...pairs, ...ring("R", 4 * WEB_SAMPLE, 2)]);
    expect(web.typical).toBe(20);
  });
});

describe("the order a board lists clubs in", () => {
  const group: AgeGroup = { id: "g", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] };
  // A ring of forty that plays the wider pool, every game won by a run or two; and the Longhorns,
  // who play one club only, three times, and beat it by fifteen each time.
  const wide = ring("W", 40, 2);
  const teams: ScoutTeam[] = [
    ...Array.from({ length: 40 }, (_, at) => ({ id: `W${at}`, name: `Wide ${at}` })),
    { id: "LH", name: "Longhorns" },
    { id: "MN", name: "Minors" },
  ];
  let serial = 0;
  const played = (a: string, b: string, aScore: number, bScore: number): ScoutGame => ({
    id: `g${(serial += 1)}`,
    teamAId: a,
    teamBId: b,
    ageGroupId: group.id,
    date: "2026-10-01",
    teamAScore: aScore,
    teamBScore: bScore,
  });
  const games: ScoutGame[] = [
    ...wide.map(([a, b], at) => played(a, b, 4 + (at % 3), 3)),
    played("LH", "MN", 16, 1),
    played("LH", "MN", 17, 2),
    played("MN", "LH", 0, 15),
  ];
  const rated = games.map((game) => ({ game, ageGap: 0 }));

  const check = (rows: ReturnType<typeof buildTeamRankings>) => {
    const longhorns = rows.find((row) => row.teamId === "LH")!;
    const minors = rows.find((row) => row.teamId === "MN")!;
    const wideRows = rows.filter((row) => row.teamId.startsWith("W"));
    // Rated above every club of the wide ring, and listed after all of them.
    expect(longhorns.rating).toBeGreaterThan(Math.max(...wideRows.map((row) => row.rating)));
    expect(longhorns.rank).toBe(wideRows.length + 1);
    expect(minors.rank).toBe(wideRows.length + 2);
    // The ring's own clubs keep the rating's order, numbered from one.
    const ratings = wideRows.map((row) => row.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    expect(rows.map((row) => row.rank)).toEqual(rows.map((_, at) => at + 1));
    // The rows say which they are, for a share of the board read off a place (`StandingLine`),
    // and the rest carry no flag at all.
    expect(longhorns.listedLast).toBe(true);
    expect(minors.listedLast).toBe(true);
    expect(wideRows.filter((row) => "listedLast" in row)).toEqual([]);
  };

  it("lists a club whose web falls short after every club whose web reaches the line", () => {
    const fit = fitScoutYear(2027, teams, games, rated, [group]);
    check(rowsOfYearFit(fit, group.id, undefined, [group]));
  });

  it("does so on the one-group path too", () => {
    check(buildTeamRankings(group.id, teams, games));
  });
});
