import { describe, expect, it } from "vitest";
import listCsv from "./fixtures/gc-team-list-rich.csv?raw";
import { parseGcTeamList } from "../gameChangerApi";
import {
  buildStaffIndex,
  clubAffinity,
  clubRelations,
  describeRelation,
  likelySameSquad,
  ORG_WIDE_TEAM_COUNT,
  sharedStaff,
  staffKey,
} from "../gcStaff";

/** The fixture is real rows from a GameChanger export, so these ids are real teams. */
const HD_18U = "kD6SNioBzfxL";
const HD_16U = "CE9brB7BgC5P";
const BLUE_DEVILS = "LhwmTwO1wzbN";
const DRILLERS_11U = "2h4CKbDtIQzH";

const fixtureIndex = () => buildStaffIndex(parseGcTeamList(listCsv).entries);

describe("reading a name two spreadsheets can agree on", () => {
  it("ignores case, spacing and the punctuation in a name", () => {
    expect(staffKey("  Eric   VARELA ")).toBe("eric varela");
    expect(staffKey("Cyndee O'Varela")).toBe(staffKey("Cyndee OVarela"));
    expect(staffKey("Sam Wilson, Jr.")).toBe("sam wilson jr");
  });
});

describe("two teams that are one club", () => {
  it("finds a club whose names say nothing", () => {
    const index = fixtureIndex();
    // "27/28 HD" and "HD 2029", both Albuquerque, both run by Eric Varela and Sam Wilson. No
    // name-matching rule could ever join those two strings.
    expect(sharedStaff(HD_18U, HD_16U, index).sort()).toEqual(["eric varela", "sam wilson"]);
    expect(clubAffinity(HD_18U, HD_16U, index)).toBe("strong");
  });

  it("calls one shared coach a hint and not a match", () => {
    const index = fixtureIndex();
    // Sam Wilson coaches an Albuquerque team and an Anchorage one. Same name, nothing else.
    expect(sharedStaff(HD_18U, DRILLERS_11U, index)).toEqual(["sam wilson"]);
    expect(clubAffinity(HD_18U, DRILLERS_11U, index)).toBe("weak");
  });

  it("has nothing to say about two teams with no coach in common", () => {
    const index = fixtureIndex();
    expect(clubAffinity(HD_18U, BLUE_DEVILS, index)).toBe("none");
  });

  it("has nothing to say about a team whose staff nobody listed", () => {
    const index = buildStaffIndex([{ teamId: "A" }, { teamId: "B", staff: ["Eric Varela"] }]);
    expect(clubAffinity("A", "B", index)).toBe("none");
  });
});

describe("the officer on every team's staff", () => {
  const withOfficer = (teamCount: number) =>
    buildStaffIndex([
      { teamId: "blue-devils", staff: ["Josh Taksier", "Alejandro Delgado"] },
      { teamId: "tb-sharks", staff: ["Francisco Brito", "Alejandro Delgado"] },
      ...Array.from({ length: teamCount }, (_, index) => ({
        teamId: `other-${index}`,
        staff: ["Alejandro Delgado"],
      })),
    ]);

  it("is ignored once the name is on enough teams to be one", () => {
    // In the real export this name is on 133 teams across different towns and different clubs.
    const index = withOfficer(ORG_WIDE_TEAM_COUNT);
    expect(sharedStaff("blue-devils", "tb-sharks", index)).toEqual([]);
    expect(clubAffinity("blue-devils", "tb-sharks", index)).toBe("none");
  });

  it("still counts while the name is on few enough teams to be a coach", () => {
    const index = withOfficer(ORG_WIDE_TEAM_COUNT - 3);
    expect(clubAffinity("blue-devils", "tb-sharks", index)).toBe("weak");
  });

  it("does not drag down the other names on the same card", () => {
    const index = buildStaffIndex([
      { teamId: "a", staff: ["Eric Varela", "Sam Wilson", "Officer"] },
      { teamId: "b", staff: ["Eric Varela", "Sam Wilson", "Officer"] },
      ...Array.from({ length: ORG_WIDE_TEAM_COUNT }, (_, index) => ({
        teamId: `x${index}`,
        staff: ["Officer"],
      })),
    ]);
    // The officer drops out; the two real coaches still make it a club.
    expect(sharedStaff("a", "b", index).sort()).toEqual(["eric varela", "sam wilson"]);
    expect(clubAffinity("a", "b", index)).toBe("strong");
  });
});

describe("everyone who looks like the same club", () => {
  it("puts the strongest first", () => {
    const index = buildStaffIndex([
      { teamId: "mine", staff: ["A Coach", "B Coach", "C Coach"] },
      { teamId: "one-shared", staff: ["A Coach"] },
      { teamId: "three-shared", staff: ["A Coach", "B Coach", "C Coach"] },
      { teamId: "two-shared", staff: ["B Coach", "C Coach"] },
      { teamId: "none-shared", staff: ["Z Coach"] },
    ]);
    expect(clubRelations("mine", index).map((relation) => relation.teamId)).toEqual([
      "three-shared",
      "two-shared",
      "one-shared",
    ]);
  });

  it("says why, in the terms somebody deciding would want", () => {
    const index = fixtureIndex();
    const [top] = clubRelations(HD_18U, index);
    expect(top?.teamId).toBe(HD_16U);
    expect(describeRelation(top!)).toMatch(/almost always the same club/);

    const weak = clubRelations(HD_18U, index).find((relation) => relation.affinity === "weak");
    expect(describeRelation(weak!)).toMatch(/hint rather than a match/);
  });

  it("never returns the team itself", () => {
    const index = fixtureIndex();
    expect(clubRelations(HD_18U, index).some((relation) => relation.teamId === HD_18U)).toBe(false);
  });

  it("has nothing for a team nobody staffed", () => {
    expect(clubRelations("missing", fixtureIndex())).toEqual([]);
  });

  it("costs the size of one team's staff rather than the size of the pool", () => {
    // Twenty thousand teams, none sharing a coach with the one being asked about.
    const many = Array.from({ length: 20_000 }, (_, index) => ({
      teamId: `t${index}`,
      staff: [`Coach ${index}`],
    }));
    const index = buildStaffIndex([{ teamId: "mine", staff: ["Only Me"] }, ...many]);
    const started = Date.now();
    expect(clubRelations("mine", index)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(50);
  });
});

describe("what the team list carries through", () => {
  it("reads the staff off the export", () => {
    const { entries } = parseGcTeamList(listCsv);
    const hd = entries.find((entry) => entry.teamId === HD_18U);
    expect(hd?.staff).toEqual(["Eric Varela", "Sam Wilson", "Trevor Garcia"]);
  });

  it("reads the roster size off the export", () => {
    const { entries } = parseGcTeamList(listCsv);
    expect(entries.find((entry) => entry.teamId === HD_18U)?.playerCount).toBe(23);
    expect(entries.find((entry) => entry.teamId === "WBvcP481wprj")?.playerCount).toBe(2);
  });

  it("still reads a list that names neither", () => {
    const { entries } = parseGcTeamList('Team Name,Team ID\n"9UA Tortugas",aGLfkW4E22sm\n');
    expect(entries[0]?.staff).toBeUndefined();
    expect(entries[0]?.playerCount).toBeUndefined();
    expect(entries[0]?.name).toBe("9UA Tortugas");
  });
});

describe("one squad, or two teams of one club", () => {
  const index = () =>
    buildStaffIndex([
      { teamId: "a", staff: ["Eric Varela", "Sam Wilson"] },
      { teamId: "b", staff: ["Eric Varela", "Sam Wilson"] },
      { teamId: "one-coach", staff: ["Eric Varela"] },
    ]);

  type Squad = { ageLevel?: number; season?: { season: string; year: number } };
  const squads: Record<string, Squad> = {
    a: { ageLevel: 12, season: { season: "fall", year: 2026 } },
    b: { ageLevel: 12, season: { season: "fall", year: 2026 } },
    "one-coach": { ageLevel: 12, season: { season: "fall", year: 2026 } },
  };
  const squadOf = (teamId: string) => squads[teamId] ?? {};

  it("says yes to the same coaches at the same age in the same season", () => {
    expect(likelySameSquad("a", "b", index(), squadOf)).toBe(true);
  });

  it("says no when the age levels differ", () => {
    // Four in five pairs sharing two coaches are a club running several age groups. Merging those
    // into each other would fold a 12U's season into a 16U's.
    const other: Record<string, Squad> = { ...squads, b: { ...squads.b!, ageLevel: 16 } };
    expect(likelySameSquad("a", "b", index(), (id) => other[id] ?? {})).toBe(false);
  });

  it("says no when the seasons differ", () => {
    const other: Record<string, Squad> = {
      ...squads,
      b: { ...squads.b!, season: { season: "spring", year: 2027 } },
    };
    expect(likelySameSquad("a", "b", index(), (id) => other[id] ?? {})).toBe(false);
  });

  it("says no when the staff is only a hint", () => {
    expect(likelySameSquad("a", "one-coach", index(), squadOf)).toBe(false);
  });

  it("treats an unknown age or season as no, never as yes", () => {
    // This feeds a merge proposal, where a wrong yes costs a club its history.
    const blank: Record<string, Squad> = { ...squads, b: {} };
    expect(likelySameSquad("a", "b", index(), (id) => blank[id] ?? {})).toBe(false);
    const noSeason: Record<string, Squad> = { ...squads, b: { ageLevel: 12 } };
    expect(likelySameSquad("a", "b", index(), (id) => noSeason[id] ?? {})).toBe(false);
  });
});

describe("a third shared coach", () => {
  const withShared = (count: number) => {
    const staff = ["A Coach", "B Coach", "C Coach", "D Coach"];
    return buildStaffIndex([
      { teamId: "a", staff },
      { teamId: "b", staff: staff.slice(0, count) },
    ]);
  };

  it("does not make a club any more of a club than two did", () => {
    // Measured: three shared staff is 98.4% same-state against two's 97.8%. The question was
    // already answered at two, so there is no third tier to move into.
    expect(clubAffinity("a", "b", withShared(2))).toBe("strong");
    expect(clubAffinity("a", "b", withShared(3))).toBe("strong");
    expect(clubAffinity("a", "b", withShared(4))).toBe("strong");
  });

  it("still sorts a closer club above a further one", () => {
    const index = buildStaffIndex([
      { teamId: "mine", staff: ["A Coach", "B Coach", "C Coach"] },
      { teamId: "two", staff: ["A Coach", "B Coach"] },
      { teamId: "three", staff: ["A Coach", "B Coach", "C Coach"] },
    ]);
    // Given several clubs to choose between, the one sharing more coaches is the better guess.
    expect(clubRelations("mine", index).map((relation) => relation.teamId)).toEqual([
      "three",
      "two",
    ]);
  });
});
