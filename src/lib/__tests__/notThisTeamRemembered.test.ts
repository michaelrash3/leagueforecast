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
import { countedTwice } from "../countedTwice";

/*
 * "Not this team" remembered: the owner's word that a name written on one club's schedule is not a
 * pulled club, kept by the schedule's GameChanger id, the name and the club's ids, and honoured by
 * every road a name takes onto a club: a pull of either club, the refile, the step that takes a
 * name's rows off a club, and the slot settle where the row it would settle into is the name again.
 * Never against the club's own schedule: where that lists the game, the fixture, the holder test,
 * the slot settle, the crossed halves, the reclaim and the claim step file it onto the club as they
 * would with no refusal. Placeholder names throughout.
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

const lookup = (state: GcImportState) => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  return (teamId: string) => byId.get(teamId);
};

/**
 * The pool once the owner has said the Hawks' 8 August "Eagles" is not the Eagles, which takes the
 * 15 August draw they filed there by the name with it. `only` keeps the change to the one game, as
 * a refusal stored before the pool held the other row leaves it.
 */
const refusedPool = (
  only = false
): { state: GcImportState; refused: NotThisTeam; standIn: string } => {
  const state = pulledPool();
  const eagles = teamNamed(state, "Eagles");
  const game = gameOf(state, "h1");
  const taken = takeOffClub(state, game, eagles, "S-EAGL-x1")!;
  const moved = new Map(
    taken.moved
      .filter((move) => !only || move.was.id === game.id)
      .map((move) => [move.was.id, move.now])
  );
  return {
    state: {
      ...state,
      teams: [...state.teams, ...taken.standIns],
      games: state.games.map((each) => moved.get(each.id) ?? each),
    },
    refused: new Set(refusalsFor(game, eagles, lookup(state))),
    standIn: moved.get(game.id)!.teamBId,
  };
};

describe("a refusal, as it is kept", () => {
  it("is the schedule, the name as the import reads it, and each of the club's ids", () => {
    const state = pulledPool();
    const eagles = teamNamed(state, "Eagles");
    expect(refusalsFor(gameOf(state, "h1"), eagles, lookup(state))).toEqual([
      refusalOf(HAWKS, "Eagles", EAGLES),
    ]);
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
    const refused = new Set(refusalsFor(gameOf(state, "h1"), eagles, lookup(state)));
    const again = hawksOwn([row("h3", "2026-08-22", "Eagles", [1, 9])]);
    const honoured = importGcSchedule(again, state, { notThisTeam: refused }).state;
    expect(gameOf(honoured, "h3").teamBId).not.toBe(eagles.id);
    // Without the refusal, the same pull files the new row onto the club.
    expect(gameOf(importGcSchedule(again, state).state, "h3").teamBId).toBe(eagles.id);
  });

  it("files no row of the name off the namer's other listing onto the club either", () => {
    // The Hawks are on GameChanger twice. The refusal given on their first listing's game covers
    // the second's next row of the name, which a refusal keyed by the row's schedule alone did not.
    const second = "gcHAWKS00002";
    const pulled = pulledPool();
    const hawksAt = teamNamed(pulled, "Prairie Hawks");
    const first = hawksAt.gcTeams![0]!;
    const state: GcImportState = {
      ...pulled,
      teams: pulled.teams.map((team) =>
        team.id === hawksAt.id ? { ...team, gcTeams: [first, { ...first, teamId: second }] } : team
      ),
    };
    const eagles = teamNamed(state, "Eagles");
    const refused = new Set(refusalsFor(gameOf(state, "h1"), eagles, lookup(state)));
    const listing = schedule(second, "Prairie Hawks", "IL", [
      row("x3", "2026-08-22", "Eagles", [1, 9]),
    ]);
    const sideOf = (result: GcImportState) => {
      const game = result.games.find((each) => each.source?.teamId === second)!;
      return game.teamAId === hawksAt.id ? game.teamBId : game.teamAId;
    };
    expect(sideOf(importGcSchedule(listing, state).state)).toBe(eagles.id);
    expect(sideOf(importGcSchedule(listing, state, { notThisTeam: refused }).state)).not.toBe(
      eagles.id
    );
  });

  it("keeps the refused row on its stand-in when the namer is pulled again", () => {
    const { state, refused, standIn } = refusedPool();
    const honoured = importGcSchedule(hawksOwn(), state, { notThisTeam: refused }).state;
    expect(gameOf(honoured, "h1").teamBId).toBe(standIn);
  });

  /**
   * The Eagles' own schedule holds the Hawks' new row at its very start, the result mirrored, under
   * `called`: a name nobody pulled, which the holder test reads among the clubs of the name, or the
   * Hawks' own, which the fixture match reads off the Hawks' day. `listed` is the Eagles' row as
   * their schedule gives it, where a test needs it without a start or a result.
   */
  const heldByTheClub = (
    called: string,
    listed: GcGame = row("e4", "2026-08-29", called, [9, 1])
  ) => {
    const { state, refused } = refusedPool();
    // A game of the Hawks' own the next day, so a name can file the Eagles' row onto them.
    const busy = row("h4", "2026-08-30", "Comets", [2, 2], 10);
    const busier = importGcSchedule(hawksOwn([busy]), state, { notThisTeam: refused }).state;
    const held = importGcSchedule(eaglesOwn([listed]), busier);
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

  it("files nothing onto the club by the club holding a game that day against some other name", () => {
    // "Hawks" is a name too, filed against a stand-in: the Eagles' schedule does not say it played
    // this club, and the holder test asks a refused club for no less (the crossed halves may yet
    // join the two, on the game: below).
    const { eagles, honoured, unrefused } = heldByTheClub("Hawks");
    expect(sideB(unrefused)).toBe(eagles);
    expect(sideB(honoured)).not.toBe(eagles);
  });

  it("files the row onto the club whose own schedule lists the game against the namer", () => {
    // The fixture: the Eagles' own row against the Hawks, at the very start, the result mirrored.
    const { eagles, honoured, unrefused } = heldByTheClub("Prairie Hawks");
    expect(sideB(unrefused)).toBe(eagles);
    expect(sideB(honoured)).toBe(eagles);
  });

  it("and where the two coaches scored it a run apart at that start, by the fixture alone", () => {
    // The Eagles' own 9-1 against the Hawks; the Hawks' coach wrote 1-8. The same start is one
    // game, scored apart, which the fixture reads and the holder test, wanting the result mirrored,
    // does not.
    const { state, refused } = refusedPool();
    const busy = row("h4", "2026-08-30", "Comets", [2, 2], 10);
    const busier = importGcSchedule(hawksOwn([busy]), state, { notThisTeam: refused }).state;
    const held = importGcSchedule(
      eaglesOwn([row("e4", "2026-08-29", "Prairie Hawks", [9, 1])]),
      busier
    ).state;
    const again = hawksOwn([busy, row("h3", "2026-08-29", "Eagles", [1, 8])]);
    const eagles = teamNamed(held, "Eagles").id;
    expect(sideB(importGcSchedule(again, held).state)).toBe(eagles);
    expect(sideB(importGcSchedule(again, held, { notThisTeam: refused }).state)).toBe(eagles);
  });

  it("and where neither a start nor a result settles it, by the club's own row against the namer", () => {
    // The holder test: the Eagles' own row names the Hawks that day, with nothing to compare, which
    // the fixture cannot read and the holder test can.
    const { eagles, honoured, unrefused } = heldByTheClub("Prairie Hawks", {
      id: "e4",
      date: "2026-08-29",
      opponentName: "Prairie Hawks",
      status: "scheduled",
    });
    expect(sideB(unrefused)).toBe(eagles);
    expect(sideB(honoured)).toBe(eagles);
  });

  it("files nothing onto the club by a row of the namer's other listing that the name filed there", () => {
    // The Hawks are on GameChanger twice; their second listing's 2-4 against "Eagles" was filed on
    // the Eagles by the name, and the first listing's copy of it is what is being pulled. The day's
    // other row is the Hawks' own word again, not the Eagles'.
    const second = "gcHAWKS00002";
    const hawksTwice: ScoutTeam = {
      ...hawks,
      gcTeams: [
        ...hawks.gcTeams!,
        { teamId: second, name: "Prairie Hawks 9U", ageGroupId: page.id, ageLevel: 9 },
      ],
    };
    const theirOwn = rowOf(eagles, "e1", eaglesStandIn.id, [6, 2], "2026-08-29");
    const misfiled: ScoutGame = {
      ...rowOf(hawks, "x1", eagles.id, [2, 4], "2026-08-29"),
      id: `gc_${second}_x1`,
      source: { kind: "gamechanger", teamId: second, gameId: "x1" },
    };
    const state = pool([hawksTwice, eagles, eaglesStandIn], [theirOwn, misfiled]);
    const pulled = hawksOwn([row("h3", "2026-08-29", "Eagles", [2, 4])]);
    // Wherever the row went: a game of its own, or folded into the day's other row.
    const side = (result: GcImportState) => {
      const game = result.games.find((each) =>
        [each.source, ...(each.alsoRows ?? [])].some(
          (one) => one?.teamId === HAWKS && one.gameId === "h3"
        )
      )!;
      return game.teamAId === hawks.id ? game.teamBId : game.teamAId;
    };
    expect(side(importGcSchedule(pulled, state).state)).toBe(eagles.id);
    expect(side(importGcSchedule(pulled, state, { notThisTeam: REFUSED }).state)).not.toBe(
      eagles.id
    );
  });

  it("leaves the row off the club when the club itself is pulled again", () => {
    const { state, refused, standIn } = refusedPool();
    const pulled = importGcSchedule(eaglesOwn(), state, { notThisTeam: refused }).state;
    expect(gameOf(tidyPool(pulled, undefined, undefined, refused).state, "h1").teamBId).toBe(
      standIn
    );
  });
});

/*
 * A refusal is the owner's word about a name, and the name is all it stands against: where the
 * club's own schedule lists the game, the club played it, refusal or not. A later meeting of the two
 * clubs, listed by both schedules at one start with the result mirrored, is one game, as it is with
 * no refusal; kept apart by the refusal it stood twice on the namer's record.
 */
describe("a refusal, and a later game the two clubs' own schedules both list", () => {
  /** The Hawks' games of a day: who each is against, and every schedule that gave it a row. */
  const hawksDay = (state: GcImportState, date: string) => {
    const hawks = teamNamed(state, "Prairie Hawks").id;
    return state.games
      .filter((game) => game.date === date && (game.teamAId === hawks || game.teamBId === hawks))
      .map((game) => ({
        against: game.teamAId === hawks ? game.teamBId : game.teamAId,
        schedules: [
          game.source?.teamId,
          ...(game.alsoRows ?? []).map((record) => record.teamId),
          ...(game.alsoFrom ?? []),
        ]
          .filter((id): id is string => id !== undefined)
          .filter((id, at, all) => all.indexOf(id) === at)
          .sort(),
      }));
  };
  const theirs = eaglesOwn([row("e9", "2026-09-05", "Prairie Hawks", [9, 1])]);
  const ours = hawksOwn([row("h9", "2026-09-05", "Eagles", [1, 9])]);

  for (const clubFirst of [true, false]) {
    it(`is one game, as it is with no refusal, with the ${clubFirst ? "club" : "namer"} pulled first`, () => {
      const { state, refused } = refusedPool();
      const pull = (options: { notThisTeam?: NotThisTeam }) => {
        const [first, second] = clubFirst ? [theirs, ours] : [ours, theirs];
        return importGcSchedule(second, importGcSchedule(first, state, options).state, options)
          .state;
      };
      const kept = tidyPool(pull({ notThisTeam: refused }), undefined, undefined, refused).state;
      const plain = tidyPool(pull({})).state;
      const eagles = teamNamed(kept, "Eagles").id;
      const both = [EAGLES, HAWKS].sort();
      expect(hawksDay(plain, "2026-09-05")).toEqual([{ against: eagles, schedules: both }]);
      expect(hawksDay(kept, "2026-09-05")).toEqual([{ against: eagles, schedules: both }]);
      expect(
        countedTwice(kept.teams, kept.games, "2026-10-10").filter(
          (group) => group.date === "2026-09-05"
        )
      ).toEqual([]);
    });
  }
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
    const { state, refused } = refusedPool(true);
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
 * game the Hawks named "Eagles", which joins the two rows whatever the owner has said of the name,
 * since the club's own schedule is not a name. A refusal still stands where the row the road would
 * join is the name again.
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
  it("the slot settle folds a row of the refused name into the club's own copy", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn],
      [hawksRow, rowOf(eagles, "e1", hawks.id, [5, 3])]
    );
    expect(resolveSlotGames(state).resolved).toBe(1);
    expect(resolveSlotGames(state, REFUSED).resolved).toBe(1);
  });

  it("but into no row of the day the name filed onto the club, off the namer's other listing", () => {
    // The Hawks' second listing's copy of the game, filed on the Eagles by the very name refused.
    const second = "gcHAWKS00002";
    const hawksTwice: ScoutTeam = {
      ...hawks,
      gcTeams: [
        ...hawks.gcTeams!,
        { teamId: second, name: "Prairie Hawks 9U", ageGroupId: page.id, ageLevel: 9 },
      ],
    };
    const misfiled: ScoutGame = {
      ...rowOf(hawks, "x1", eagles.id, [3, 5]),
      id: `gc_${second}_x1`,
      source: { kind: "gamechanger", teamId: second, gameId: "x1" },
    };
    const state = pool([hawksTwice, eagles, eaglesStandIn], [hawksRow, misfiled]);
    expect(resolveSlotGames(state).resolved).toBe(1);
    expect(resolveSlotGames(state, REFUSED).resolved).toBe(0);
  });

  it("the crossed halves join a row of the refused name to the club's own", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn, hawksStandIn],
      [hawksRow, rowOf(eagles, "e1", hawksStandIn.id, [5, 3])]
    );
    expect(joinCrossedHalves(state).joined).toBe(1);
    const tidied = tidyPool(state, undefined, undefined, REFUSED).state;
    expect(sideOfHawksRow(tidied)).toEqual([eagles.id]);
    expect(tidied.games).toHaveLength(1);
  });

  it("the reclaim moves a row of the refused name onto the club whose own schedule holds it", () => {
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
    // A whole tidy with the refusal ends where one without it does: one game, against the Eagles of
    // Illinois, whose schedule holds it, and settled, nothing left for a second tidy to do.
    const plain = tidyPool(state);
    const tidy = tidyPool(state, undefined, undefined, REFUSED);
    expect(sideOfHawksRow(plain.state)).toEqual([eagles.id]);
    expect(sideOfHawksRow(tidy.state)).toEqual([eagles.id]);
    // The one game holds both clubs' rows, whichever it stands on.
    const between = tidy.state.games.filter(
      (game) => [game.teamAId, game.teamBId].sort().join() === [eagles.id, hawks.id].sort().join()
    );
    expect(between).toHaveLength(1);
    expect(
      [between[0]!.source?.teamId, ...(between[0]!.alsoRows ?? []).map((one) => one.teamId)].sort()
    ).toEqual([EAGLES, HAWKS].sort());
    expect(tidy.passes).toBe(plain.passes);
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

  it("the claim step claims a row of the refused name into the club's own copy", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn],
      [hawksRow, rowOf(eagles, "e1", hawks.id, [5, 3])]
    );
    expect(claimFiledRows(state).claimed).toBe(1);
  });

  it("a whole tidy makes one game of the row and the club's own copy, refusal or not", () => {
    const state = pool(
      [hawks, eagles, eaglesStandIn],
      [hawksRow, rowOf(eagles, "e1", hawks.id, [5, 3])]
    );
    const joined = tidyPool(state).state;
    expect(sideOfHawksRow(joined)).toEqual([eagles.id]);
    expect(joined.games).toHaveLength(1);
    // Kept apart by the refusal, the one game stood twice on the Hawks' record.
    const kept = tidyPool(state, undefined, undefined, REFUSED).state;
    expect(kept.games).toEqual(joined.games);
  });

  it("the refusal takes no game off the club that holds a row of the club's own schedule", () => {
    // The Hawks' row on the Eagles, holding the Eagles' own row of the game claimed into it (filed
    // by the Eagles' coach against a stand-in for the Hawks): the Eagles' schedule lists the game.
    const holding: ScoutGame = {
      ...rowOf(hawks, "h1", eagles.id, [3, 5]),
      alsoRows: [
        {
          teamId: EAGLES,
          gameId: "e1",
          ownScore: 5,
          opponentScore: 3,
          onSideB: true,
          filedAgainst: hawksStandIn.id,
        },
      ],
      alsoFrom: [EAGLES],
    };
    const state = pool([hawks, eagles, hawksStandIn], [holding]);
    expect(resettleOffLevel(state, REFUSED).resettled).toBe(0);
    // A row of the name alone on the club is what it takes off.
    const { alsoRows: _rows, alsoFrom: _from, ...alone } = holding;
    expect(resettleOffLevel(pool([hawks, eagles], [alone]), REFUSED).resettled).toBe(1);
  });
});
