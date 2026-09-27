import { describe, expect, it } from "vitest";
import { countedTwice, countedTwiceCsv } from "../countedTwice";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * Kentucky Athletics beat "Dream Chasers Blue" 9-3 on their own schedule, and Hit Dogs Evansville
 * listed the same game as their own 3-9 fifteen minutes later: one game, credited twice, found by
 * hand. This is the list that finds the next one.
 */
const pulled = (id: string, name: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag10" }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const teams = [
  pulled("KA", "Kentucky Athletics"),
  pulled("HD", "Hit Dogs Evansville"),
  pulled("RR", "River Rats"),
  standIn("S-DC", "Dream Chasers Blue"),
];
let serial = 0;
/** A pulled row, off side A's own schedule, as every row of a pull is. */
const game = (
  a: string,
  b: string,
  clock: string,
  score?: [number, number],
  extra: Partial<ScoutGame> = {}
): ScoutGame => {
  serial += 1;
  return {
    id: `g${serial}`,
    teamAId: a,
    teamBId: b,
    ageGroupId: "ag10",
    date: "2026-09-13",
    startTs: `2026-09-13T${clock}:00.000Z`,
    ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
    ...(a.startsWith("S-")
      ? {}
      : { source: { kind: "gamechanger" as const, teamId: `gc${a}`, gameId: `g${serial}` } }),
    ...extra,
  };
};
const TODAY = "2026-09-25";

describe("clubs credited twice with one game", () => {
  it("lists two counted games within the hour with one result, against two entries", () => {
    const games = [
      game("KA", "S-DC", "14:00", [9, 3]),
      game("HD", "KA", "14:15", [3, 9]),
      game("KA", "RR", "17:00", [9, 3]),
    ];
    const found = countedTwice(teams, games, TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      teamName: "Kentucky Athletics",
      date: "2026-09-13",
      own: 9,
      opponent: 3,
      minutesApart: 15,
    });
    expect(found[0]!.games.map((entry) => entry.opponentName)).toEqual([
      "Dream Chasers Blue",
      "Hit Dogs Evansville",
    ]);
  });

  it("leaves two results, two of the club's own games past the hour, and games not counted", () => {
    expect(
      countedTwice(
        teams,
        [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "14:15", [4, 9])],
        TODAY
      )
    ).toEqual([]);
    // Its own schedule lists both: a doubleheader with one score twice, however near.
    expect(
      countedTwice(
        teams,
        [game("KA", "S-DC", "14:00", [9, 3]), game("KA", "RR", "15:01", [9, 3])],
        TODAY
      )
    ).toEqual([]);
    expect(
      countedTwice(
        teams,
        [
          game("KA", "S-DC", "14:00", [9, 3]),
          game("HD", "KA", "14:15", [3, 9], { excluded: true }),
        ],
        TODAY
      )
    ).toEqual([]);
  });

  it("lists pulled clubs only, and three at once as one", () => {
    // The stand-in is credited twice too, but its record is shown nowhere.
    const games = [
      game("KA", "S-DC", "14:00", [9, 3]),
      game("HD", "S-DC", "14:00", [9, 3]),
      game("RR", "KA", "14:30", [3, 9]),
    ];
    const found = countedTwice(teams, games, TODAY);
    expect(found.map((group) => [group.teamName, group.games.length])).toEqual([
      ["Kentucky Athletics", 2],
    ]);
    const triple = countedTwice(
      teams,
      [
        game("KA", "S-DC", "14:00", [9, 3]),
        game("HD", "KA", "14:15", [3, 9]),
        game("RR", "KA", "14:40", [3, 9]),
      ],
      TODAY
    );
    expect(triple.map((group) => group.games.length)).toEqual([3]);
  });

  /*
   * One squad on GameChanger twice lists the one game at two clocks: Oilers' own 17-6 over "Top
   * Guns" at 14:30 was Topguns' own copy at 16:00. Out to three hours where one of the two is not
   * on the club's own schedule, marked for a look, since a doubleheader fits too.
   */
  it("lists another club's copy out to three hours from the club's own, marked for a look", () => {
    const found = countedTwice(
      teams,
      [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "16:30", [3, 9])],
      TODAY
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ minutesApart: 150, wide: true });
    expect(
      countedTwice(
        teams,
        [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "17:01", [3, 9])],
        TODAY
      )
    ).toEqual([]);
  });

  it("lists the other club's own copy past the hour when it is the opponent itself", () => {
    // Two clubs' copies of one game the hour did not join: Kentucky's own 9-3 over the Hit Dogs,
    // the Hit Dogs' own 3-9 an hour and a half on.
    const found = countedTwice(
      teams,
      [game("KA", "HD", "14:00", [9, 3]), game("HD", "KA", "15:30", [3, 9])],
      TODAY
    );
    expect(found.map((group) => [group.teamName, group.minutesApart, group.wide])).toEqual([
      ["Hit Dogs Evansville", 90, true],
      ["Kentucky Athletics", 90, true],
    ]);
  });

  it("keeps every group the hour finds and adds a copy past it to one", () => {
    const found = countedTwice(
      teams,
      [
        game("KA", "S-DC", "14:00", [9, 3]),
        game("HD", "KA", "14:15", [3, 9]),
        game("RR", "KA", "16:00", [3, 9]),
      ],
      TODAY
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.games.map((entry) => entry.opponentName)).toEqual([
      "Dream Chasers Blue",
      "Hit Dogs Evansville",
      "River Rats",
    ]);
    expect(found[0]).toMatchObject({ minutesApart: 120, wide: true });
  });

  it("never puts two of the club's own games past the hour in one group", () => {
    // Kentucky's own 9-3s at two and four, and the Hit Dogs' copy at three: the Hit Dogs' copy is
    // the two o'clock game within the hour, and the four o'clock is another game of the same score.
    const found = countedTwice(
      teams,
      [
        game("KA", "S-DC", "14:00", [9, 3]),
        game("HD", "KA", "15:00", [3, 9]),
        game("KA", "RR", "16:00", [9, 3]),
      ],
      TODAY
    );
    expect(found.map((group) => group.games.map((entry) => entry.opponentName))).toEqual([
      ["Dream Chasers Blue", "Hit Dogs Evansville"],
    ]);
    expect(found[0]!.wide).toBeUndefined();
  });

  it("writes the list as a file, one group a line", () => {
    const found = countedTwice(
      teams,
      [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "14:15", [3, 9])],
      TODAY
    );
    expect(countedTwiceCsv(found).split("\n")).toEqual([
      "Club,Date,Result,Opponents,Starts (UTC),Minutes Apart,Past the Hour",
      "Kentucky Athletics,2026-09-13,9-3,Dream Chasers Blue | Hit Dogs Evansville,2026-09-13T14:00:00.000Z | 2026-09-13T14:15:00.000Z,15,",
    ]);
    const wide = countedTwice(
      teams,
      [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "16:00", [3, 9])],
      TODAY
    );
    expect(countedTwiceCsv(wide).split("\n")[1]!.endsWith(",120,yes")).toBe(true);
  });
});
