import { describe, expect, it } from "vitest";
import {
  importGcSchedule,
  reclaimMisfiled,
  resettleOffLevel,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import {
  gcRowId,
  rowOfRecord,
  withFiledRepointed,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * A row's opponent named by its GameChanger picture is an identity where a name is a guess
 * (`ScoutGame.namedByAvatar`). The tidy's rules that move a row off a pulled club
 * read nothing but the name, so they leave such a row where it is: a Florida schedule that names a
 * Texas club by its picture played that club, however far apart the region rule reads the pair.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const schedule = (
  profile: Partial<GcTeamSchedule["profile"]>,
  games: GcTeamSchedule["games"] = []
): GcTeamSchedule => ({
  profile: {
    id: "gcTIDES00001",
    name: "Tampa Tides 10U",
    ageLevel: 10,
    season: { season: "fall", year: 2026 },
    state: "FL",
    ...profile,
  },
  games,
  fetchedAt: "2026-09-14T12:00:00.000Z",
});
const row = (over: Partial<GcTeamSchedule["games"][number]> = {}) => ({
  id: "g1",
  date: "2026-09-12",
  opponentName: "Rangers",
  status: "completed" as const,
  teamScore: 3,
  opponentScore: 5,
  ...over,
});
/** A Texas club pulled with its picture, which the Tides' schedule names as "Rangers". */
const texas = importGcSchedule(
  schedule({ id: "gcFRISCO0001", name: "Frisco Rangers 10U", state: "TX", avatarKey: "av-frisco" }),
  empty
).state;
const clubOf = (state: GcImportState, gcId: string) =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId))!.id;
const tides = schedule({}, [row({ opponentAvatarKey: "av-frisco" })]);
/** The same pool with a second Texas club pulled, with a picture of its own. */
const withDallas = importGcSchedule(
  schedule({ id: "gcDALLAS0001", name: "Dallas Rangers 10U", state: "TX", avatarKey: "av-dallas" }),
  texas
).state;
const tidesRow = (state: GcImportState) =>
  state.games.find((game) => game.source?.teamId === "gcTIDES00001")!;
const withoutIdentity = (state: GcImportState): GcImportState => ({
  ...state,
  games: state.games.map(({ namedByAvatar: _named, ...game }) => game),
});

describe("a row that named its opponent by the club's picture", () => {
  it("carries the club, and stays on it through the region rule", () => {
    const { state } = importGcSchedule(tides, texas);
    const frisco = clubOf(state, "gcFRISCO0001");
    const filed = state.games.find((game) => game.source?.teamId === "gcTIDES00001")!;
    expect(filed.namedByAvatar).toBe(frisco);
    expect([filed.teamAId, filed.teamBId]).toContain(frisco);
    expect(resettleOffLevel(state).resettled).toBe(0);
    // The same row read on its name alone is a Florida row on a Texas club nothing backs.
    expect(resettleOffLevel(withoutIdentity(state)).resettled).toBe(1);
  });

  it("is stamped on a row filed before the picture was kept, by the next pull", () => {
    const { state } = importGcSchedule(tides, texas);
    const again = importGcSchedule(tides, withoutIdentity(state)).state;
    const filed = again.games.find((game) => game.source?.teamId === "gcTIDES00001")!;
    expect(filed.namedByAvatar).toBe(clubOf(again, "gcFRISCO0001"));
  });

  it("is not carried by a row that named its opponent by name", () => {
    const { state } = importGcSchedule(schedule({}, [row({ opponentName: "Bears" })]), texas);
    expect(state.games.every((game) => game.namedByAvatar === undefined)).toBe(true);
  });

  it("is kept through a pull with no picture, and taken off by one naming another pulled club", () => {
    const { state } = importGcSchedule(tides, withDallas);
    const frisco = clubOf(state, "gcFRISCO0001");
    expect(tidesRow(state).namedByAvatar).toBe(frisco);

    // GameChanger often sends a row with no picture, which says nothing of whom it named.
    const bare = importGcSchedule(schedule({}, [row()]), state).state;
    expect(tidesRow(bare).namedByAvatar).toBe(frisco);

    // A row whose picture now names the Dallas club no longer names Frisco. It stays where it was
    // filed, as a pull keeps a stored opponent, and the rules reading names read it again.
    const other = importGcSchedule(
      schedule({}, [row({ opponentAvatarKey: "av-dallas" })]),
      state
    ).state;
    expect(tidesRow(other).namedByAvatar).toBeUndefined();
    expect([tidesRow(other).teamAId, tidesRow(other).teamBId]).toContain(frisco);
    expect(resettleOffLevel(other).resettled).toBe(1);
  });
});

describe("a row folded into the other club's copy of its game", () => {
  // The Tides pulled with their picture, then Frisco, whose copy names them by it; the Tides' own
  // row, naming Frisco by its picture, then folds into that copy (`withSchedulesOf`).
  const friscoFirst = importGcSchedule(
    schedule(
      { id: "gcFRISCO0001", name: "Frisco Rangers 10U", state: "TX", avatarKey: "av-frisco" },
      [
        row({
          id: "f1",
          opponentName: "Tampa Tides 10U",
          opponentAvatarKey: "av-tides",
          teamScore: 5,
          opponentScore: 3,
        }),
      ]
    ),
    importGcSchedule(schedule({ avatarKey: "av-tides" }), withDallas).state
  ).state;
  const pulled = (games: GcTeamSchedule["games"], state: GcImportState) =>
    importGcSchedule(schedule({ avatarKey: "av-tides" }, games), state).state;
  const friscoCopy = (state: GcImportState) =>
    state.games.find((game) => game.source?.teamId === "gcFRISCO0001")!;
  const recordIn = (state: GcImportState) =>
    friscoCopy(state).alsoRows?.find((record) => record.teamId === "gcTIDES00001");

  it("keeps the club its picture named on its record, and stands back up carrying it", () => {
    const state = pulled([row({ opponentAvatarKey: "av-frisco" })], friscoFirst);
    const frisco = clubOf(state, "gcFRISCO0001");
    const record = recordIn(state)!;
    expect(record.namedByAvatar).toBe(frisco);
    // Stood back up, as the tidy does when a correction splits the two, it is still that row.
    expect(rowOfRecord(friscoCopy(state), record).namedByAvatar).toBe(frisco);
  });

  it("keeps it through a pull with no picture, and not past one naming another pulled club", () => {
    const state = pulled([row({ opponentAvatarKey: "av-frisco" })], friscoFirst);
    const frisco = clubOf(state, "gcFRISCO0001");
    expect(recordIn(pulled([row()], state))!.namedByAvatar).toBe(frisco);
    const other = recordIn(pulled([row({ opponentAvatarKey: "av-dallas" })], state))!;
    expect(other.namedByAvatar).toBeUndefined();
  });
});

describe("the misfile check", () => {
  // A copy on the wrong club of its name goes to the namesake whose own row has the game at its
  // start (`reclaimMisfiled`), unless the copy named the club it is on by its picture.
  const club = (id: string, level: number): ScoutTeam => ({
    id,
    name: "Smithtown Bulls Red",
    state: "NY",
    gcTeams: [{ teamId: `gc${id}`, name: "Smithtown Bulls Red", ageGroupId: `ag${level}` }],
  });
  const own = (clubId: string, gameId: string, against: string, score: [number, number]) => ({
    id: gcRowId(`gc${clubId}`, gameId),
    teamAId: clubId,
    teamBId: against,
    teamAScore: score[0],
    teamBScore: score[1],
    ageGroupId: "ag9",
    date: "2026-09-22",
    startTs: "2026-09-22T23:00:00.000Z",
    source: { kind: "gamechanger" as const, teamId: `gc${clubId}`, gameId },
  });
  const pool = (copy: ScoutGame): GcImportState => ({
    ageGroups: [
      { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
      { id: "ag10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
    ],
    teams: [
      {
        id: "MAFIA",
        name: "Mini MafiaBoys",
        state: "NY",
        gcTeams: [{ teamId: "gcMAFIA", name: "Mini MafiaBoys", ageGroupId: "ag9" }],
      },
      club("SMITH10", 10),
      club("SMITH9", 9),
      { id: "S-5STAR", name: "5 Star National NY FALL", nameOnly: true },
    ],
    games: [copy, own("SMITH9", "s1", "S-5STAR", [17, 2])],
  });

  it("leaves a copy on the club its picture named", () => {
    const copy = own("MAFIA", "m1", "SMITH10", [2, 17]);
    expect(reclaimMisfiled(pool({ ...copy, namedByAvatar: "SMITH10" })).reclaimed).toBe(0);
    // A picture of another club than the one it is on says nothing of this one.
    expect(reclaimMisfiled(pool({ ...copy, namedByAvatar: "SMITH9" })).reclaimed).toBe(1);
  });
});

describe("a club folded into another", () => {
  it("takes the rows its picture named along", () => {
    const game: ScoutGame = {
      id: "gc_gcA_1",
      teamAId: "A",
      teamBId: "OLD",
      ageGroupId: "ag",
      namedByAvatar: "OLD",
    };
    const moved = withFiledRepointed(game, (id) => (id === "OLD" ? "NEW" : id));
    expect(moved.namedByAvatar).toBe("NEW");
    // And a game with nothing to move is the same game.
    expect(withFiledRepointed(game, (id) => id)).toBe(game);
  });

  it("takes the rows folded into a game that its picture named along too", () => {
    const holder: ScoutGame = {
      id: "gc_gcOLD_1",
      teamAId: "OLD",
      teamBId: "A",
      ageGroupId: "ag",
      alsoRows: [{ teamId: "gcA", gameId: "1", onSideB: true, namedByAvatar: "OLD" }],
    };
    const moved = withFiledRepointed(holder, (id) => (id === "OLD" ? "NEW" : id));
    expect(moved.alsoRows?.[0]?.namedByAvatar).toBe("NEW");
    expect(withFiledRepointed(holder, (id) => id)).toBe(holder);
  });
});
