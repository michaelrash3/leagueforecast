import { describe, expect, it } from "vitest";
import { POOL_NAMES_CSV_HEADERS, poolNamesCsv, poolNamesCsvParts } from "../poolNamesCsv";
import { parseCSVLine } from "../csv";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const group = (id: string, ageLevel: number, year: number): AgeGroup => ({
  id,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
});

const team = (id: string, name: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name,
  ...extra,
});

const game = (id: string, ageGroupId: string, teamAId: string, teamBId: string): ScoutGame => ({
  id,
  teamAId,
  teamBId,
  ageGroupId,
  teamAScore: 5,
  teamBScore: 3,
});

/** One named cell of a row, by the header it sits under. */
const at = (row: string[] | undefined, name: (typeof POOL_NAMES_CSV_HEADERS)[number]) =>
  row?.[POOL_NAMES_CSV_HEADERS.indexOf(name)];

const rows = (text: string): string[][] =>
  text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseCSVLine);

describe("the pool's own names, as a file", () => {
  const ageGroups = [group("g10", 10, 2027), group("g12", 12, 2027)];
  const teams = [
    team("t1", "Cincy Legends", { state: "OH" }),
    team("t2", "Elite Prospects", { state: "KY" }),
  ];
  const games = [game("x1", "g10", "t1", "t2"), game("x2", "g10", "t1", "t2")];

  it("writes the id, the name and the age already filed", () => {
    const [header, first] = rows(poolNamesCsv(teams, ageGroups, games));
    expect(header).toEqual([...POOL_NAMES_CSV_HEADERS]);
    // Two games against one opponent, who names no age: one opponent, none naming an age.
    expect(first).toEqual([
      "t1",
      "Cincy Legends",
      "10",
      "2027",
      "OH",
      "yes",
      "2",
      "2",
      "0",
      "0",
      "1",
      "0",
      "",
      "Elite Prospects",
    ]);
  });

  /*
   * The evidence half, counted the way `agelessEvidence` counts it — per distinct opponent, not
   * per game. The tripwire compares what a rule does here against what it does on the backlog,
   * and two different readings of "opponents" would make that comparison meaningless.
   */
  it("counts opponents once however often they are played", () => {
    const many = [...games, game("x3", "g10", "t1", "t2"), game("x4", "g10", "t1", "t2")];
    const [, first] = rows(poolNamesCsv(teams, ageGroups, many));
    expect(at(first, "Games")).toBe("4");
    expect(at(first, "Opponents")).toBe("1");
  });

  it("reads an age out of an opponent's name, and samples the ones with none", () => {
    const named = [...teams, team("t3", "Dayton Dynamo 10U"), team("t4", "Just A Club")];
    const withNamed = [...games, game("x5", "g10", "t1", "t3"), game("x6", "g10", "t1", "t4")];
    const [, first] = rows(poolNamesCsv(named, ageGroups, withNamed));
    expect(at(first, "Opponents")).toBe("3");
    expect(at(first, "Opponents Naming An Age")).toBe("1");
    expect(at(first, "Opponent Ages")).toBe("1×10U");
    expect(at(first, "Played")).toBe("Elite Prospects; Just A Club");
  });

  it("counts a shutout blowout and a game scored ahead of today", () => {
    const odd: ScoutGame[] = [
      { id: "b1", teamAId: "t1", teamBId: "t2", ageGroupId: "g10", teamAScore: 12, teamBScore: 0 },
      {
        id: "b2",
        teamAId: "t1",
        teamBId: "t2",
        ageGroupId: "g10",
        teamAScore: 3,
        teamBScore: 1,
        date: "2099-01-01",
      },
    ];
    const [, first] = rows(poolNamesCsv(teams, ageGroups, odd));
    expect(at(first, "Shutout Blowouts")).toBe("1");
    expect(at(first, "Ahead Of Today")).toBe("1");
  });

  /*
   * A team carries no age of its own — the age belongs to the result, because a club fields
   * squads at several ages. The commonest group across its games is the one a rule should be
   * agreeing with.
   */
  it("takes the age a team mostly plays at, not the one it played once", () => {
    const mixed = [game("x3", "g12", "t1", "t2"), ...games];
    const [, first] = rows(poolNamesCsv(teams, ageGroups, mixed));
    expect(first?.[2]).toBe("10");
  });

  it("leaves the age blank for a team with no games to read it from", () => {
    const [, first] = rows(poolNamesCsv(teams, ageGroups, []));
    expect(first?.[2]).toBe("");
    expect(first?.[3]).toBe("");
  });

  /*
   * A bracket slot and a name-only opponent are written, and marked. A rule firing on ten
   * thousand "TBD" rows is worth knowing and worth being able to exclude — but it is not a club
   * anybody ranks, so it must not be counted as a working team the rule would break.
   */
  it("says which rows are teams the pool actually ranks", () => {
    const withSlots = [
      ...teams,
      team("t3", "TBD- 3:00 PM", { placeholder: true }),
      team("t4", "Somebody's Opponent", { nameOnly: true }),
    ];
    const written = rows(poolNamesCsv(withSlots, ageGroups, games));
    expect(written.map((row) => row[5])).toEqual(["Ranked", "yes", "yes", "no", "no"]);
  });

  it("survives a club name with a comma and a quote", () => {
    const awkward = [team("t9", 'Los "Diablos", Norte')];
    expect(rows(poolNamesCsv(awkward, ageGroups, []))[1]?.[1]).toBe('Los "Diablos", Norte');
  });

  it("builds the file in pieces, one per team plus the header", () => {
    const parts = poolNamesCsvParts(teams, ageGroups, games);
    expect(parts).toHaveLength(3);
    expect(parts.join("")).toBe(poolNamesCsv(teams, ageGroups, games));
  });
});
