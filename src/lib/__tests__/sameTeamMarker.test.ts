import { describe, expect, it } from "vitest";
import {
  importGcSchedule,
  reclaimMisfiled,
  resettleOffLevel,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import {
  filedRowOf,
  gcRowId,
  rowOfRecord,
  withFiledRepointed,
  type FoldedRow,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * A row the owner said is against a club, by folding the stand-in it was filed against into that
 * club ("Same team as"), is an identity where a name is a guess (`ScoutGame.namedByAvatar`). The
 * tidy's rules that move a row off a pulled club read nothing but the name, so they leave such a
 * row where it is, and a pull, which says nothing of who the owner said played, keeps it: a Florida
 * schedule the owner says played a Texas club played that club, however far apart the region rule
 * reads the pair.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const schedule = (
  profile: Partial<GcTeamSchedule["profile"]>,
  games: GcTeamSchedule["games"] = []
): GcTeamSchedule => ({
  profile: {
    id: "gcTIDES00001",
    name: "Quillmoor Tides 10U",
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
/** The Tides and a Texas club, both pulled, with no games yet. */
const pulled = importGcSchedule(
  schedule({ id: "gcBRACK00001", name: "Brackwell Rangers 10U", state: "TX" }),
  importGcSchedule(schedule({}), empty).state
).state;
const clubOf = (state: GcImportState, gcId: string) =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId))!.id;
const tides = clubOf(pulled, "gcTIDES00001");
const rangers = clubOf(pulled, "gcBRACK00001");
const page = pulled.ageGroups[0]!.id;
const tidesSchedule = (games: GcTeamSchedule["games"] = [row()]) => schedule({}, games);

/** The Tides' own row of the game, filed against Brackwell, marked as the owner's fold leaves it. */
const ownRow = (mark: boolean): ScoutGame => ({
  id: gcRowId("gcTIDES00001", "g1"),
  teamAId: tides,
  teamBId: rangers,
  teamAScore: 3,
  teamBScore: 5,
  ageGroupId: page,
  date: "2026-09-12",
  ageLevelA: 10,
  season: "Fall 2026",
  ...(mark ? { namedByAvatar: rangers } : {}),
  typedAs: "rangers",
  source: { kind: "gamechanger", teamId: "gcTIDES00001", gameId: "g1" },
});
const tidesRow = (state: GcImportState) =>
  state.games.find((game) => game.source?.teamId === "gcTIDES00001")!;

describe("a row the owner said is against a club", () => {
  it("stays on the club through the region rule", () => {
    const marked = { ...pulled, games: [ownRow(true)] };
    expect(resettleOffLevel(marked).resettled).toBe(0);
    // The same row read on its name alone is a Florida row on a Texas club nothing backs.
    expect(resettleOffLevel({ ...pulled, games: [ownRow(false)] }).resettled).toBe(1);
  });

  it("is kept by the next pull of its schedule, which says nothing of who played", () => {
    const again = importGcSchedule(tidesSchedule(), { ...pulled, games: [ownRow(true)] }).state;
    expect(tidesRow(again).namedByAvatar).toBe(rangers);
    expect([tidesRow(again).teamAId, tidesRow(again).teamBId]).toContain(rangers);
  });

  it("is not carried by a row a pull files by its name", () => {
    const { state } = importGcSchedule(tidesSchedule([row({ opponentName: "Bears" })]), pulled);
    expect(state.games.every((game) => game.namedByAvatar === undefined)).toBe(true);
  });
});

describe("a row folded into the other club's copy of its game", () => {
  /** Brackwell's own copy of the game, holding the Tides' row folded in, as `record` has it. */
  const copyHolding = (record: FoldedRow): ScoutGame => ({
    id: gcRowId("gcBRACK00001", "f1"),
    teamAId: rangers,
    teamBId: tides,
    teamAScore: 5,
    teamBScore: 3,
    ageGroupId: page,
    date: "2026-09-12",
    ageLevelA: 10,
    season: "Fall 2026",
    alsoFrom: ["gcTIDES00001"],
    alsoRows: [record],
    source: { kind: "gamechanger", teamId: "gcBRACK00001", gameId: "f1" },
  });
  const copyIn = (state: GcImportState) =>
    state.games.find((game) => game.source?.teamId === "gcBRACK00001")!;
  const recordIn = (state: GcImportState) =>
    copyIn(state).alsoRows?.find((record) => record.teamId === "gcTIDES00001");
  const tidesRecord: FoldedRow = {
    teamId: "gcTIDES00001",
    gameId: "g1",
    ownScore: 3,
    opponentScore: 5,
    onSideB: true,
    namedByAvatar: rangers,
  };

  it("keeps the club on its record through a pull, and stands back up carrying it", () => {
    const state = importGcSchedule(tidesSchedule(), {
      ...pulled,
      games: [copyHolding(tidesRecord)],
    }).state;
    const record = recordIn(state)!;
    expect(record.namedByAvatar).toBe(rangers);
    // Stood back up, as the tidy does when a correction splits the two, it is still that row.
    expect(rowOfRecord(copyIn(state), record).namedByAvatar).toBe(rangers);
  });

  it("keeps it on a claimed row, which stands back up on the team it goes back to", () => {
    // Claimed from Brackwell for this copy (`FoldedRow.filedAgainst`): the claim goes back to Brackwell if
    // the schedules stop bearing it out, carrying what the owner said.
    const claimed = { ...tidesRecord, filedAgainst: rangers, filedLevel: 10 };
    const state = importGcSchedule(tidesSchedule(), {
      ...pulled,
      games: [copyHolding(claimed)],
    }).state;
    const record = recordIn(state)!;
    expect(record.namedByAvatar).toBe(rangers);
    const released = filedRowOf(copyIn(state), record);
    expect(released.teamBId).toBe(rangers);
    expect(released.namedByAvatar).toBe(rangers);
  });

  it("is not put on a record that carried none", () => {
    const { namedByAvatar: _mark, ...bare } = tidesRecord;
    const state = importGcSchedule(tidesSchedule(), {
      ...pulled,
      games: [copyHolding(bare)],
    }).state;
    expect(recordIn(state)!.namedByAvatar).toBeUndefined();
  });
});

describe("the misfile check", () => {
  // A copy on the wrong club of its name goes to the namesake whose own row has the game at its
  // start (`reclaimMisfiled`), unless the owner said the copy is against the club it is on.
  const club = (id: string, level: number): ScoutTeam => ({
    id,
    name: "Larkfield Bulls Red",
    state: "NY",
    gcTeams: [{ teamId: `gc${id}`, name: "Larkfield Bulls Red", ageGroupId: `ag${level}` }],
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
        id: "MARA",
        name: "Mini Marauders",
        state: "NY",
        gcTeams: [{ teamId: "gcMARA", name: "Mini Marauders", ageGroupId: "ag9" }],
      },
      club("LARK10", 10),
      club("LARK9", 9),
      { id: "S-5PTS", name: "Five Points National NY FALL", nameOnly: true },
    ],
    games: [copy, own("LARK9", "s1", "S-5PTS", [17, 2])],
  });

  it("leaves a copy on the club the owner said it is against", () => {
    const copy = own("MARA", "m1", "LARK10", [2, 17]);
    expect(reclaimMisfiled(pool({ ...copy, namedByAvatar: "LARK10" })).reclaimed).toBe(0);
    // The owner's word about another club than the one it is on says nothing of this one.
    expect(reclaimMisfiled(pool({ ...copy, namedByAvatar: "LARK9" })).reclaimed).toBe(1);
  });
});

describe("a club folded into another", () => {
  it("takes the rows the owner said were against it along", () => {
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

  it("takes the rows folded into a game that were said to be against it along too", () => {
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
