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

  it("leaves two results, two games more than an hour apart, and games not counted", () => {
    expect(
      countedTwice(
        teams,
        [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "14:15", [4, 9])],
        TODAY
      )
    ).toEqual([]);
    expect(
      countedTwice(
        teams,
        [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "15:01", [3, 9])],
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

  it("writes the list as a file, one group a line", () => {
    const found = countedTwice(
      teams,
      [game("KA", "S-DC", "14:00", [9, 3]), game("HD", "KA", "14:15", [3, 9])],
      TODAY
    );
    expect(countedTwiceCsv(found).split("\n")).toEqual([
      "Club,Date,Result,Opponents,Starts (UTC),Minutes Apart",
      "Kentucky Athletics,2026-09-13,9-3,Dream Chasers Blue | Hit Dogs Evansville,2026-09-13T14:00:00.000Z | 2026-09-13T14:15:00.000Z,15",
    ]);
  });
});
