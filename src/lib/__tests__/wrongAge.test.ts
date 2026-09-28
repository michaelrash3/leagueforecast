import { describe, expect, it } from "vitest";
import type { GcImportState } from "../gameChangerImport";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";
import { filedAtWrongAge } from "../wrongAge";

/*
 * Pulled clubs that look filed at the wrong age: a club whose GameChanger age field says one level
 * and whose name and opponents say another, the Cincinnati Hornets *Fall Ball* on the 26 September
 * 2026 pool (filed 8U, every opponent 9U). Placeholder names throughout.
 */
const pages: AgeGroup[] = [
  { id: "ag8", name: "8U 2027", ageLevel: 8, year: 2027, seasonIds: [] },
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "ag12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
  { id: "ag8old", name: "8U 2026", ageLevel: 8, year: 2026, seasonIds: [] },
];

const club = (
  id: string,
  squadName: string,
  page: string,
  extra: Partial<GcTeamLink> = {}
): ScoutTeam => ({
  id,
  name: squadName.replace(/\s*\d+U$/, ""),
  state: "OH",
  gcTeams: [{ teamId: `gc${id}`, name: squadName, ageGroupId: page, season: "fall", ...extra }],
});

let serial = 0;
const game = (a: string, b: string, date: string, extra: Partial<ScoutGame> = {}): ScoutGame => {
  serial += 1;
  return { id: `g${serial}`, ageGroupId: "ag8", teamAId: a, teamBId: b, date, ...extra };
};

/** Four 9U opponents, two 8U and one 10U, each pulled. */
const opponents = [
  club("N1", "Nine One 9U", "ag9"),
  club("N2", "Nine Two 9U", "ag9"),
  club("N3", "Nine Three 9U", "ag9"),
  club("N4", "Nine Four 9U", "ag9"),
  club("E1", "Eight One 8U", "ag8"),
  club("E2", "Eight Two 8U", "ag8"),
  club("T1", "Ten One 10U", "ag10"),
];

/** Saturdays two weeks apart, and the Sunday closing the first weekend. */
const WEEK1 = "2026-09-12";
const WEEK1_SUNDAY = "2026-09-13";
const WEEK3 = "2026-09-26";

const read = (teams: ScoutTeam[], games: ScoutGame[]) =>
  filedAtWrongAge(
    { ageGroups: pages, teams: [...opponents, ...teams], games } satisfies GcImportState,
    2027
  );

describe("a club whose name disagrees with its filing", () => {
  it("is listed when most of its opponents are at the age its name states", () => {
    const listed = read(
      [club("HORN", "Hornets 9U", "ag8")],
      [
        game("HORN", "N1", WEEK1),
        game("HORN", "N2", WEEK1_SUNDAY),
        game("HORN", "E1", WEEK3),
        // Met twice, counted once: evidence is who, not how often.
        game("N1", "HORN", WEEK3),
      ]
    );
    expect(listed).toEqual([
      {
        teamId: "HORN",
        name: "Hornets",
        state: "OH",
        year: 2027,
        gcTeamIds: ["gcHORN"],
        filed: 8,
        suggested: 9,
        reason: "name",
        opponentsAtSuggested: 2,
        opponentsKnown: 3,
        weeks: 2,
      },
    ]);
  });

  it("reads the age off its squad's GameChanger name when the club's own drops it", () => {
    const squad = { ...club("HORN", "Hornets 9U", "ag8"), name: "Hornets Baseball" };
    const listed = read([squad], [game("HORN", "N1", WEEK1), game("HORN", "N2", WEEK3)]);
    expect(listed.map((entry) => [entry.teamId, entry.reason, entry.suggested])).toEqual([
      ["HORN", "name", 9],
    ]);
  });

  it("is not listed on one opponent, or without a strict majority", () => {
    expect(read([club("HORN", "Hornets 9U", "ag8")], [game("HORN", "N1", WEEK1)])).toEqual([]);
    expect(
      read(
        [club("HORN", "Hornets 9U", "ag8")],
        [
          game("HORN", "N1", WEEK1),
          game("HORN", "N2", WEEK1),
          game("HORN", "E1", WEEK3),
          game("HORN", "E2", WEEK3),
        ]
      )
    ).toEqual([]);
  });

  it("is not listed when its name agrees with its filing, whoever it plays", () => {
    expect(
      read(
        [club("HORN", "Hornets 8U", "ag8")],
        [
          game("HORN", "N1", WEEK1),
          game("HORN", "N2", WEEK1),
          game("HORN", "N3", WEEK3),
          game("HORN", "N4", WEEK3),
        ]
      )
    ).toEqual([]);
  });
});

describe("a club with no age in its name", () => {
  const nameless = () => club("HORN", "Cincinnati Hornets", "ag8");

  it("is listed when its opponents are at one other age, week after week", () => {
    const listed = read(
      [nameless()],
      [game("HORN", "N1", WEEK1), game("HORN", "N2", WEEK1), game("HORN", "N3", WEEK3)]
    );
    expect(listed).toMatchObject([
      { teamId: "HORN", filed: 8, suggested: 9, reason: "opponents", opponentsAtSuggested: 3 },
    ]);
  });

  it("is not listed for playing up at one tournament", () => {
    expect(
      read(
        [nameless()],
        [game("HORN", "N1", WEEK1), game("HORN", "N2", WEEK1), game("HORN", "N3", WEEK1_SUNDAY)]
      )
    ).toEqual([]);
  });

  it("is not listed when a fifth of its opponents or more are elsewhere", () => {
    expect(
      read(
        [nameless()],
        [
          game("HORN", "N1", WEEK1),
          game("HORN", "N2", WEEK1),
          game("HORN", "N3", WEEK3),
          game("HORN", "E1", WEEK3),
        ]
      )
    ).toEqual([]);
  });

  it("is not listed on two opponents, however far apart", () => {
    expect(read([nameless()], [game("HORN", "N1", WEEK1), game("HORN", "N2", WEEK3)])).toEqual([]);
  });
});

describe("what says nothing", () => {
  const nameless = (extra: Partial<GcTeamLink> = {}) =>
    club("HORN", "Cincinnati Hornets", "ag8", extra);
  /** Two 9U opponents in one week: one more game at 9U in another week would list it. */
  const almost = [game("HORN", "N1", WEEK1), game("HORN", "N2", WEEK1)];
  const listed = (games: ScoutGame[], extra: Partial<GcTeamLink> = {}) =>
    read([nameless(extra)], games).map((entry) => entry.teamId);

  it("is a club whose age somebody set by hand", () => {
    expect(listed([...almost, game("HORN", "N3", WEEK3)])).toEqual(["HORN"]);
    expect(listed([...almost, game("HORN", "N3", WEEK3)], { ageFrom: "you" })).toEqual([]);
  });

  it("is a row its own schedule withdrew", () => {
    expect(listed([...almost, game("HORN", "N3", WEEK3, { withdrawn: true })])).toEqual([]);
  });

  it("is another year's row", () => {
    expect(listed([...almost, game("HORN", "N3", WEEK3, { ageGroupId: "ag8old" })])).toEqual([]);
  });

  it("is a club against itself, which would count as an opponent at its own level", () => {
    expect(listed([...almost, game("HORN", "N3", WEEK3), game("HORN", "HORN", WEEK3)])).toEqual([
      "HORN",
    ]);
  });

  it("is an opponent never pulled, whose level is not known", () => {
    expect(listed([...almost, game("HORN", "S-ONLY-A-NAME", WEEK3)])).toEqual([]);
    expect(
      listed([...almost, game("HORN", "N3", WEEK3), game("HORN", "S-ONLY-A-NAME", WEEK3)])
    ).toEqual(["HORN"]);
  });

  it("is a club filed in another year", () => {
    const lastYear = club("HORN", "Cincinnati Hornets", "ag8old");
    expect(read([lastYear], [...almost, game("HORN", "N3", WEEK3)])).toEqual([]);
  });
});

describe("the order of the list", () => {
  it("puts the furthest off first, then the most evidence", () => {
    const listed = read(
      [
        // Named so that the alphabet alone would put them the other way round.
        club("LESS", "Alpha 9U", "ag8"),
        club("MORE", "Zulu 9U", "ag8"),
        club("FAR", "Far 12U", "ag10"),
        club("T12A", "Twelve A 12U", "ag12"),
        club("T12B", "Twelve B 12U", "ag12"),
      ],
      [
        game("LESS", "N1", WEEK1),
        game("LESS", "N2", WEEK3),
        game("MORE", "N1", WEEK1),
        game("MORE", "N2", WEEK1),
        game("MORE", "N3", WEEK3),
        game("FAR", "T12A", WEEK1),
        game("FAR", "T12B", WEEK3),
      ]
    );
    expect(listed.map((entry) => entry.teamId)).toEqual(["FAR", "MORE", "LESS"]);
  });
});
