import { describe, expect, it } from "vitest";
import { findHalves, shiftDay, tallyHalves } from "../standInHalves";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * Where the other half of a game against a stand-in is: another pulled club's own row a day either
 * side with the result mirrored, by what that row is filed against, and the same search a week
 * either side for the rate it finds one by chance. Placeholder names throughout.
 */
const PAGE = "ag_10u_2027";
const club = (id: string, name: string, state: string): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc-${id}`, name, ageGroupId: PAGE, ageLevel: 10 }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });

const TEAMS: ScoutTeam[] = [
  club("N", "Northside Owls", "KY"),
  club("C", "Cincy Flames 10U", "OH"),
  club("D", "Desert Hawks", "AZ"),
  club("E", "Eastside Bats", "KY"),
  standIn("X", "Flames"),
  standIn("Y", "Owls Blue"),
  { id: "SLOT", name: "Pool A #1", placeholder: true },
];

let made = 0;
/** A row of `schedule`'s own: A against B on a day, at a start, A's runs first. */
const row = (
  schedule: string,
  a: string,
  b: string,
  date: string,
  runs: [number, number] | null,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId: PAGE,
  teamAId: a,
  teamBId: b,
  date,
  startTs: `${date}T14:00:00Z`,
  ...(runs ? { teamAScore: runs[0], teamBScore: runs[1] } : {}),
  source: { kind: "gamechanger", teamId: `gc-${schedule}`, gameId: `x${made}` },
  ...more,
});

const noStart = ({ startTs: _dropped, ...game }: ScoutGame): ScoutGame => game;

describe("the other half of a game against a stand-in", () => {
  it("is another pulled club's own row a day either side with the result mirrored, by its kind", () => {
    const against = row("N", "N", "X", "2026-09-12", [5, 3]);
    const games = [
      against,
      // The Flames' own row against the Owls themselves: the claim step's case.
      row("C", "C", "N", "2026-09-12", [3, 5], { startTs: "2026-09-12T14:40:00Z" }),
      // A row a day later, the result mirrored, against a stand-in: the crossed halves' case.
      row("E", "Y", "E", "2026-09-13", [5, 3]),
      // Against a third club whose own schedule does not list it.
      row("D", "D", "C", "2026-09-11", [3, 5]),
      // Not mirrored, two days off, the namer's own, or a game both clubs list: none of them.
      row("C", "C", "N", "2026-09-12", [5, 3]),
      row("C", "C", "N", "2026-09-14", [3, 5]),
      row("N", "N", "E", "2026-09-12", [5, 3]),
      {
        ...row("D", "D", "E", "2026-09-12", [3, 5]),
        alsoFrom: ["gc-E"],
      },
    ];
    const search = findHalves(TEAMS, games);
    // The Bats' row against "Owls Blue" is a row against a stand-in as well.
    expect(search.rows.map((one) => `${one.namerId}>${one.standInId}`)).toEqual(["N>X", "E>Y"]);
    const found = search.rows[0];
    expect(
      found!.candidates.map(({ clubId, opponentId, kind, daysApart, minutesApart }) => ({
        clubId,
        opponentId,
        kind,
        daysApart,
        minutesApart,
      }))
    ).toEqual([
      { clubId: "D", opponentId: "C", kind: "other", daysApart: 1, minutesApart: 1440 },
      { clubId: "C", opponentId: "N", kind: "namer", daysApart: 0, minutesApart: 40 },
      { clubId: "E", opponentId: "Y", kind: "standIn", daysApart: 1, minutesApart: 1440 },
    ]);
  });

  it("reads a bracket slot as a stand-in on the other row's side, and a row with no result not at all", () => {
    const search = findHalves(TEAMS, [
      row("N", "N", "X", "2026-09-12", [2, 7]),
      row("C", "C", "SLOT", "2026-09-12", [7, 2]),
      row("E", "E", "X", "2026-09-12", null),
      { ...row("E", "E", "X", "2026-09-19", [4, 4]), excluded: true },
    ]);
    expect(search.unplayed).toBe(2);
    expect(search.rows.map((one) => one.candidates.map((candidate) => candidate.kind))).toEqual([
      ["standIn"],
    ]);
  });

  it("is never the row itself nor another of the namer's own, a tie included", () => {
    const search = findHalves(TEAMS, [
      row("N", "N", "X", "2026-09-12", [4, 4]),
      row("N", "N", "E", "2026-09-12", [4, 4]),
    ]);
    expect(search.rows[0]!.candidates).toEqual([]);
  });

  it("counts what the weeks either side find, where the game is not", () => {
    const search = findHalves(TEAMS, [
      row("N", "N", "X", "2026-09-12", [5, 3]),
      row("C", "C", "N", "2026-09-19", [3, 5]),
      row("E", "Y", "E", "2026-09-04", [5, 3]),
    ]);
    expect(search.rows[0]!.candidates).toEqual([]);
    expect(search.rows[0]!.decoys).toEqual({ namer: 1, standIn: 1, other: 0 });
  });
});

describe("the tally", () => {
  it("says of each kind how the rows it alone answers sit, and the chance rate a week", () => {
    const games = [
      // One answered by the Flames' own row, the same start, the names fitting.
      row("N", "N", "X", "2026-09-12", [5, 3]),
      row("C", "C", "N", "2026-09-12", [3, 5]),
      // Another of the same stand-in's, answered by the Flames again a day off.
      row("N", "N", "X", "2026-09-19", [1, 0]),
      noStart(row("C", "C", "N", "2026-09-20", [0, 1])),
      // One with nothing anywhere, and one with two candidates.
      row("N", "N", "X", "2026-10-03", [9, 9]),
      row("N", "N", "X", "2026-10-10", [6, 2]),
      row("C", "C", "N", "2026-10-10", [2, 6]),
      row("D", "D", "N", "2026-10-10", [2, 6]),
      // A decoy a week on for the third row.
      row("E", "E", "N", "2026-10-10", [9, 9]),
    ];
    const search = findHalves(TEAMS, games);
    const tally = tallyHalves(search, TEAMS);
    expect(tally).toMatchObject({ rows: 4, none: 1, several: 1, agreeing: 1, split: 0 });
    expect(tally.kinds.namer).toEqual({
      rows: 3,
      // The 3 October row's a week on, the one decoy of two weeks searched.
      decoyRows: 0.5,
      only: 2,
      sameDay: 1,
      sameStart: 1,
      withinHour: 1,
      noStart: 1,
      inRegion: 2,
      samePage: 2,
      namesFit: 2,
      shareWord: 2,
      bothListed: 0,
    });
    // Kept to some rows only, as the stand-ins of one bucket are read.
    expect(tallyHalves(search, TEAMS, (one) => one.game.date === "2026-10-03").none).toBe(1);
  });

  it("says when one stand-in's rows point at two clubs, and the region and names apart", () => {
    const games = [
      row("N", "N", "X", "2026-09-12", [5, 3]),
      row("D", "D", "N", "2026-09-12", [3, 5]),
      row("N", "N", "X", "2026-09-19", [4, 1]),
      row("C", "C", "N", "2026-09-19", [1, 4]),
    ];
    const tally = tallyHalves(findHalves(TEAMS, games), TEAMS);
    expect(tally).toMatchObject({ agreeing: 0, split: 1 });
    expect(tally.kinds.namer).toMatchObject({ only: 2, inRegion: 1, namesFit: 1, shareWord: 1 });
  });
});

describe("a day moved", () => {
  it("crosses a month and a year, and is nothing for what is not a day", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2027-01-03", -7)).toBe("2026-12-27");
    expect(shiftDay("someday", 1)).toBeUndefined();
  });
});
