import { describe, expect, it } from "vitest";
import type { GcGame, GcTeamSchedule } from "../gameChangerApi";
import {
  claimFiledRows,
  importGcSchedule,
  joinCrossedHalves,
  reclaimMisfiled,
  refileStandIns,
  resettleOffLevel,
  resolveSlotGames,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import {
  coerceNotThisTeam,
  notThisTeamList,
  refusalOf,
  refusalsFor,
  refusesName,
  takeOffClub,
  type NotThisTeam,
} from "../notThisTeam";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * "Not this team" remembered: the owner's word that a name written on one club's schedule is not a
 * pulled club, kept by the schedule's GameChanger id, the name and the club's ids, and honoured by
 * every road a name takes onto a club: a pull of either club, the refile, the step that takes a
 * name's rows off a club, the slot settle, the crossed halves, the reclaim and the claim step.
 * Placeholder names throughout.
 */

const HAWKS = "gcHAWKS00001";
const EAGLES = "gcEAGLES0001";

const schedule = (id: string, name: string, state: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `${name} 9U`,
    ageLevel: 9,
    state,
    season: { season: "fall", year: 2026 },
  },
  games,
  fetchedAt: "2026-09-28T12:00:00.000Z",
});

const row = (
  id: string,
  date: string,
  opponentName: string,
  scores: [number, number],
  hour = 14
): GcGame => ({
  id,
  date,
  startTs: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  opponentName,
  status: "completed",
  teamScore: scores[0],
  opponentScore: scores[1],
});

/** The Eagles' own games: one each Saturday against a club nobody pulled, at ten. */
const eaglesOwn = (extra: GcGame[] = []) =>
  schedule(EAGLES, "Eagles", "IL", [
    row("e1", "2026-08-08", "Comets", [6, 2], 10),
    row("e2", "2026-08-15", "Comets", [7, 1], 10),
    row("e3", "2026-08-22", "Comets", [2, 0], 10),
    ...extra,
  ]);
/** The Hawks', two of them against an "Eagles" of their own that nobody pulled. */
const hawksOwn = (extra: GcGame[] = []) =>
  schedule(HAWKS, "Prairie Hawks", "IL", [
    row("h1", "2026-08-08", "Eagles", [3, 5]),
    row("h2", "2026-08-15", "Eagles", [4, 4]),
    ...extra,
  ]);

const pulledPool = (): GcImportState => {
  const first = importGcSchedule(eaglesOwn(), { ageGroups: [], teams: [], games: [] }).state;
  return importGcSchedule(hawksOwn(), first).state;
};

const teamNamed = (state: GcImportState, name: string) =>
  state.teams.find((team) => team.name === name && team.gcTeams?.length)!;
const gameOf = (state: GcImportState, gameId: string) =>
  state.games.find((game) => game.source?.gameId === gameId && game.source.teamId === HAWKS)!;

/** The pool once the owner has said the Hawks' 8 August "Eagles" is not the Eagles. */
const refusedPool = (): { state: GcImportState; refused: NotThisTeam; standIn: string } => {
  const state = pulledPool();
  const eagles = teamNamed(state, "Eagles");
  const game = gameOf(state, "h1");
  const taken = takeOffClub(state, game, eagles, "S-EAGL-x1")!;
  return {
    state: {
      ...state,
      teams: taken.standIn ? [...state.teams, taken.standIn] : state.teams,
      games: state.games.map((each) => (each.id === game.id ? taken.game : each)),
    },
    refused: new Set(refusalsFor(game, eagles)),
    standIn: taken.game.teamBId,
  };
};

describe("a refusal, as it is kept", () => {
  it("is the schedule, the name as the import reads it, and each of the club's ids", () => {
    const state = pulledPool();
    const eagles = teamNamed(state, "Eagles");
    expect(refusalsFor(gameOf(state, "h1"), eagles)).toEqual([refusalOf(HAWKS, "Eagles", EAGLES)]);
    const refused = new Set([refusalOf(HAWKS, "Eagles", EAGLES)]);
    expect(refusesName(refused, HAWKS, "EAGLES 9u", eagles)).toBe(true);
    // Another schedule naming the club, or this one under another name, is not refused.
    expect(refusesName(refused, "gcOTHER00001", "Eagles", eagles)).toBe(false);
    expect(refusesName(refused, HAWKS, "Eagles Gold", eagles)).toBe(false);
  });

  it("is read back as stored, sorted, and anything that is not three parts is dropped", () => {
    const one = refusalOf(HAWKS, "Eagles", EAGLES);
    const two = refusalOf("gcAAAAAAAAAA", "Comets", "gcBBBBBBBBBB");
    expect(
      notThisTeamList(coerceNotThisTeam([one, two, 5, "a\u0000b", "", `${one}\u0000x`]))
    ).toEqual([two, one].sort());
    expect(coerceNotThisTeam({ not: "a list" }).size).toBe(0);
  });
});

describe("the import, with the owner's refusals", () => {
  it("files a name onto the club it matches when nothing is refused", () => {
    const state = pulledPool();
    expect(gameOf(state, "h1").teamBId).toBe(teamNamed(state, "Eagles").id);
  });

  it("files no new row of the refused name from that schedule onto the club on a re-pull", () => {
    // Refused on another device, say, so this pool holds no stand-in of the name to reuse.
    const state = pulledPool();
    const eagles = teamNamed(state, "Eagles");
    const refused = new Set(refusalsFor(gameOf(state, "h1"), eagles));
    const again = hawksOwn([row("h3", "2026-08-22", "Eagles", [1, 9])]);
    const honoured = importGcSchedule(again, state, { notThisTeam: refused }).state;
    expect(gameOf(honoured, "h3").teamBId).not.toBe(eagles.id);
    // Without the refusal, the same pull files the new row onto the club.
    expect(gameOf(importGcSchedule(again, state).state, "h3").teamBId).toBe(eagles.id);
  });

  it("keeps the refused row on its stand-in when the namer is pulled again", () => {
    const { state, refused, standIn } = refusedPool();
    const honoured = importGcSchedule(hawksOwn(), state, { notThisTeam: refused }).state;
    expect(gameOf(honoured, "h1").teamBId).toBe(standIn);
  });

  /**
   * The Eagles' own schedule holds the Hawks' new row at its very start, the result mirrored, under
   * `called`: a name nobody pulled, which the holder test reads among the clubs of the name, or the
   * Hawks' own, which the fixture match reads off the Hawks' day.
   */
  const heldByTheClub = (called: string) => {
    const { state, refused } = refusedPool();
    // A game of the Hawks' own the next day, so a name can file the Eagles' row onto them.
    const busy = row("h4", "2026-08-30", "Comets", [2, 2], 10);
    const busier = importGcSchedule(hawksOwn([busy]), state, { notThisTeam: refused }).state;
    const held = importGcSchedule(eaglesOwn([row("e4", "2026-08-29", called, [9, 1])]), busier);
    const again = hawksOwn([busy, row("h3", "2026-08-29", "Eagles", [1, 9])]);
    return {
      eagles: teamNamed(held.state, "Eagles").id,
      honoured: importGcSchedule(again, held.state, { notThisTeam: refused }).state,
      unrefused: importGcSchedule(again, held.state).state,
    };
  };
  const sideB = (state: GcImportState) => {
    const game = state.games.find((each) =>
      [each.source, ...(each.alsoRows ?? [])].some(
        (one) => one?.teamId === HAWKS && one.gameId === "h3"
      )
    )!;
    return game.teamAId === teamNamed(state, "Prairie Hawks").id ? game.teamBId : game.teamAId;
  };

  it("files nothing onto the club by the club holding the game under another name", () => {
    const { eagles, honoured, unrefused } = heldByTheClub("Hawks");
    expect(sideB(unrefused)).toBe(eagles);
    expect(sideB(honoured)).not.toBe(eagles);
  });

  it("files nothing onto the club by the game on the namer's own day either", () => {
    const { eagles, honoured, unrefused } = heldByTheClub("Prairie Hawks");
    expect(sideB(unrefused)).toBe(eagles);
    expect(sideB(honoured)).not.toBe(eagles);
  });

  it("leaves the row off the club when the club itself is pulled again", () => {
    const { state, refused, standIn } = refusedPool();
    const pulled = importGcSchedule(eaglesOwn(), state, { notThisTeam: refused }).state;
    expect(gameOf(tidyPool(pulled, undefined, undefined, refused).state, "h1").teamBId).toBe(
      standIn
    );
  });
});

describe("the tidy, with the owner's refusals", () => {
  it("never refiles the stand-in onto the club, which it would without them", () => {
    const { state, refused, standIn } = refusedPool();
    const eagles = teamNamed(state, "Eagles");
    expect(gameOf(refileStandIns(state, refused).state, "h1").teamBId).toBe(standIn);
    expect(gameOf(refileStandIns(state).state, "h1").teamBId).toBe(eagles.id);
    const tidied = tidyPool(state, undefined, undefined, refused).state;
    expect(gameOf(tidied, "h1").teamBId).not.toBe(eagles.id);
  });

  it("takes the namer's other rows of the refused name off the club", () => {
    const { state, refused } = refusedPool();
    const eagles = teamNamed(state, "Eagles");
    // The 15 August draw, still on the Eagles by the same name.
    expect(gameOf(state, "h2").teamBId).toBe(eagles.id);
    const moved = resettleOffLevel(state, refused);
    expect(moved.resettled).toBe(1);
    const standIn = moved.state.teams.find((team) => team.id === gameOf(moved.state, "h2").teamBId);
    expect(standIn).toMatchObject({ name: "Eagles", nameOnly: true });
    expect(resettleOffLevel(state).resettled).toBe(0);
    // And so does a whole tidy.
    const tidied = tidyPool(state, undefined, undefined, refused).state;
    expect(gameOf(tidied, "h2").teamBId).not.toBe(eagles.id);
  });
});

/*
 * The game-evidence roads, each on a pool built for it: the Eagles' own schedule lists the very
 * game the Hawks named "Eagles", which joins the two rows unless the owner has said the name is not
 * the Eagles.
 */
const page: AgeGroup = { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] };
const club = (id: string, name: string, gcId: string, state = "IL"): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: gcId, name: `${name} 9U`, ageGroupId: page.id, ageLevel: 9 }],
});
const hawks = club("S-HAWK", "Prairie Hawks", HAWKS);
const eagles = club("S-EAGL", "Eagles", EAGLES);
const eaglesStandIn: ScoutTeam = { id: "S-EAGLx", name: "Eagles", nameOnly: true };
const hawksStandIn: ScoutTeam = { id: "S-HAWKx", name: "Prairie Hawks", nameOnly: true };
const at = (date: string) => `${date}T14:00:00.000Z`;
const rowOf = (
  owner: ScoutTeam,
  gameId: string,
  against: string,
  scores: [number, number],
  date = "2026-08-08"
): ScoutGame => {
  const gcId = owner.gcTeams![0]!.teamId;
  return {
    id: `gc_${gcId}_${gameId}`,
    teamAId: owner.id,
    teamBId: against,
    ageGroupId: page.id,
    date,
    startTs: at(date),
    teamAScore: scores[0],
    teamBScore: scores[1],
    source: { kind: "gamechanger", teamId: gcId, gameId },
  };
};
const REFUSED: NotThisTeam = new Set([refusalOf(HAWKS, "Eagles", EAGLES)]);
const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
  ageGroups: [page],
  teams,
  games,
});
const hawksRow = rowOf(hawks, "h1", eaglesStandIn.id, [3, 5]);
/** Where a Hawks row of the day is now: the club, or the stand-in, it is filed against. */
const sideOfHawksRow = (state: GcImportState): string[] =>
  state.games
    .filter(
      (game) =>
        game.source?.teamId === HAWKS ||
        (game.alsoRows ?? []).some((record) => record.teamId === HAWKS)
    )
    .map((game) => (game.teamAId === hawks.id ? game.teamBId : game.teamAId));

describe("the roads a game takes onto a club, with the owner's refusals", () => {
  it("the slot settle folds no row of the refused name into the club's own copy", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn],
      [hawksRow, rowOf(eagles, "e1", hawks.id, [5, 3])]
    );
    expect(resolveSlotGames(state).resolved).toBe(1);
    expect(resolveSlotGames(state, REFUSED).resolved).toBe(0);
  });

  it("the crossed halves join no row of the refused name to the club's", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn, hawksStandIn],
      [hawksRow, rowOf(eagles, "e1", hawksStandIn.id, [5, 3])]
    );
    expect(joinCrossedHalves(state).joined).toBe(1);
    expect(joinCrossedHalves(state, REFUSED).joined).toBe(0);
    const tidied = tidyPool(state, undefined, undefined, REFUSED).state;
    expect(sideOfHawksRow(tidied)).not.toContain(eagles.id);
  });

  it("the reclaim moves no row of the refused name onto the club from a namesake", () => {
    // The Hawks' "Eagles" sat on the Eagles of Indiana, who had a game of their own that morning;
    // the Eagles of Illinois' own schedule holds the game, at its very start, the result mirrored,
    // against a stand-in for the Hawks.
    const hoosiers = club("S-EAGLIN", "Eagles", "gcEAGLESIN01", "IN");
    const comets: ScoutTeam = { id: "S-COME", name: "Comets", nameOnly: true };
    const morning = {
      ...rowOf(hoosiers, "i1", comets.id, [1, 1]),
      startTs: "2026-08-08T09:00:00.000Z",
    };
    const state = pool(
      [hawks, eagles, hoosiers, hawksStandIn, comets],
      [
        rowOf(hawks, "h1", hoosiers.id, [3, 5]),
        rowOf(eagles, "e1", hawksStandIn.id, [5, 3]),
        morning,
      ]
    );
    expect(reclaimMisfiled(state).reclaimed).toBe(1);
    expect(reclaimMisfiled(state, REFUSED).reclaimed).toBe(0);
    // A whole tidy leaves it where it was, on the Indiana club no refusal names, and settles: moved
    // onto the Eagles by the reclaim and off them by the refusal, it went round to the pass limit.
    const tidy = tidyPool(state, undefined, undefined, REFUSED);
    expect(sideOfHawksRow(tidy.state)).toEqual([hoosiers.id]);
    expect(tidy.passes).toBeLessThan(3);
    expect(tidyChangedAnything(tidyPool(tidy.state, undefined, undefined, REFUSED))).toBe(false);
  });

  it("a row taken off a club far from its age goes to no namesake the name is refused", () => {
    // Filed on the 14U Eagles by name, a 9U game is not theirs: it would go to the 9U Eagles, the
    // one namesake that plays near it, unless the owner has said the Hawks' "Eagles" is not them.
    const page14: AgeGroup = { ...page, id: "ag14", name: "14U 2027", ageLevel: 14 };
    const older: ScoutTeam = {
      id: "S-EAGL14",
      name: "Eagles",
      state: "IL",
      gcTeams: [{ teamId: "gcEAGLES1401", name: "Eagles 14U", ageGroupId: "ag14", ageLevel: 14 }],
    };
    const state: GcImportState = {
      ageGroups: [page, page14],
      teams: [hawks, eagles, older],
      games: [rowOf(hawks, "h1", older.id, [3, 5]), rowOf(eagles, "e1", hawks.id, [1, 0])],
    };
    expect(sideOfHawksRow(resettleOffLevel(state).state)).toEqual([eagles.id]);
    const moved = resettleOffLevel(state, REFUSED).state;
    const [side] = sideOfHawksRow(moved);
    expect(moved.teams.find((team) => team.id === side)).toMatchObject({
      name: "Eagles",
      nameOnly: true,
    });
  });

  it("the claim step claims no row of the refused name into the club's copy", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn],
      [hawksRow, rowOf(eagles, "e1", hawks.id, [5, 3])]
    );
    expect(claimFiledRows(state).claimed).toBe(1);
    expect(claimFiledRows(state, REFUSED).claimed).toBe(0);
  });

  it("a whole tidy leaves the row on its stand-in, beside the club's own copy", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn],
      [hawksRow, rowOf(eagles, "e1", hawks.id, [5, 3])]
    );
    // Without them the Hawks' row goes into the Eagles' copy, one game between the two.
    const joined = tidyPool(state).state;
    expect(sideOfHawksRow(joined)).toEqual([eagles.id]);
    expect(joined.games).toHaveLength(1);
    // With them it stays against the name, and the Eagles' own copy stands beside it.
    const kept = tidyPool(state, undefined, undefined, REFUSED).state;
    expect(sideOfHawksRow(kept)).toEqual([eaglesStandIn.id]);
    expect(kept.games).toHaveLength(2);
  });
});
