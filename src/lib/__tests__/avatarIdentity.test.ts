import { describe, expect, it } from "vitest";
import {
  importGcSchedule,
  reclaimMisfiled,
  resettleOffLevel,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { gcRowId, withFiledRepointed, type ScoutGame, type ScoutTeam } from "../teamRankings";

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
});
