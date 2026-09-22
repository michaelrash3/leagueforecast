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
    expect(first).toEqual(["t1", "Cincy Legends", "10", "2027", "OH", "yes"]);
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
