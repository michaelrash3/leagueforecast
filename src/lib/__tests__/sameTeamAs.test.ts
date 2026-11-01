import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedule,
  pairSettledSquads,
  mergeSameSquadIds,
  refileStandIns,
  resettleOffLevel,
  tidyChangedAnything,
  tidyPool,
  type GcImportOptions,
  type GcImportState,
} from "../gameChangerImport";
import { refusalOf, refusalsFor, takeOffClub, type NotThisTeam } from "../notThisTeam";
import { mergeScoutTeams, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { coerceScoutTeams, decodeScoutTeams, encodeScoutTeams } from "../teamRankingsCompact";
import {
  coerceTeamRankingsBackup,
  parseTeamRankingsJson,
  teamRankingsJson,
  type TeamRankingsBackup,
} from "../teamRankingsBackup";
import { applyCommand, coerceCommand, NO_ANSWERS, type PoolRead } from "../live/commands";
import { clubViews } from "../live/views/clubs";
import { packPool, unpackPool } from "../../workers/tidyProtocol";

/*
 * "Same team as" as a standing answer (the sweep of 30 October 2026, item 28). The owner folding a
 * stand-in into a pulled club says who that coach's schedule played under that name, and the club
 * keeps it: the schedule that wrote the name and the name it typed, wherever the club goes and
 * however the pool is stored, and gone again with the fold. The same coach's next game typed the
 * same way is the same club: the import, the refile and the resettle file it there, under the
 * guards the in-state rule reads a name by, and Not this team still wins. Placeholder names
 * throughout, and every GameChanger id made up.
 */

const ACES = "gcACES000001";
const COMETS = "gcCOMETS0001";
const DUKES = "gcDUKES00001";
const TODAY = "2026-10-31";
const options: GcImportOptions = { today: TODAY };

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

const schedule = (
  id: string,
  name: string,
  games: GcTeamSchedule["games"],
  state = "OH"
): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ageLevel: 10,
    state,
    city: "Townville",
    season: { season: "fall", year: 2026 },
  },
  games,
  fetchedAt: "2026-10-01T12:00:00.000Z",
});

const played = (
  id: string,
  date: string,
  opponentName: string,
  teamScore: number,
  opponentScore: number,
  startTs: string
): GcTeamSchedule["games"][number] => ({
  id,
  date,
  opponentName,
  status: "completed",
  teamScore,
  opponentScore,
  startTs,
});

/*
 * The sweep's reproduction. The Aces type their opponent of 12 September as "Bolts"; the owner
 * knows that to be the Comets Navy, whose own GameChanger schedule keeps only some of its games.
 */
const acesWeek1 = [
  played("a1", "2026-09-12", "Bolts", 7, 3, "2026-09-12T14:00:00.000Z"),
  played("a2", "2026-09-13", "Owls 10U", 5, 5, "2026-09-13T14:00:00.000Z"),
];
const comets = schedule(COMETS, "Comets Navy 10U", [
  played("c1", "2026-09-20", "Pilots 10U", 4, 2, "2026-09-20T15:00:00.000Z"),
]);
/** The next week's games, typed "Bolts" again: one a day off the club's own game, one far from any. */
const acesWeek2 = [
  ...acesWeek1,
  played("a3", "2026-09-19", "Bolts", 2, 6, "2026-09-19T14:00:00.000Z"),
  played("a4", "2026-10-03", "Bolts", 6, 1, "2026-10-03T14:00:00.000Z"),
];

const rowId = (gcTeamId: string, gameId: string) => `gc_${gcTeamId}_${gameId}`;
const gameOf = (state: GcImportState, id: string): ScoutGame | undefined =>
  state.games.find((game) => game.id === id);
const teamOf = (state: GcImportState, id: string | undefined): ScoutTeam | undefined =>
  state.teams.find((team) => team.id === id);
const clubOf = (state: GcImportState, gcTeamId: string): ScoutTeam =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcTeamId))!;
/** The team a row of the Aces' schedule stands against. */
const facing = (state: GcImportState, gameId: string): ScoutTeam | undefined =>
  teamOf(state, gameOf(state, rowId(ACES, gameId))?.teamBId);

/** The pool after the first pulls and a tidy: the Aces' "Bolts" on a stand-in. */
const beforeTheAnswer = (): GcImportState => {
  let state = importGcSchedule(schedule(ACES, "Aces 10U", acesWeek1), empty, options).state;
  state = importGcSchedule(comets, state, options).state;
  return tidyPool(state).state;
};

/** That pool with the owner's answer: the "Bolts" stand-in is the Comets Navy. */
const answered = (): GcImportState => {
  const state = beforeTheAnswer();
  const standIn = state.teams.find((team) => team.nameOnly && team.name === "Bolts")!;
  const merged = mergeScoutTeams(
    standIn.id,
    clubOf(state, COMETS).id,
    state.teams,
    state.games,
    state.ageGroups
  );
  return { ...state, teams: merged.teams, games: merged.games };
};

/**
 * Not this team pressed on a row of the Aces' as either kind of page presses it, through the
 * command (`game.notThisTeam`): the pool after it, and the refusals it stores.
 */
const pressNotThisTeam = (
  state: GcImportState,
  gameId: string
): { state: GcImportState; refused: NotThisTeam } => {
  let teams: readonly ScoutTeam[] = state.teams;
  let games: readonly ScoutGame[] = state.games;
  let refused: NotThisTeam = new Set();
  const read: PoolRead = {
    ...NO_ANSWERS,
    answers: (list) => (list === "notThisTeam" ? refused : new Set()),
    teams: () => teams,
    groups: () => state.ageGroups,
    years: () => [2027],
    games: () => games,
  };
  const pressed = gameOf(state, rowId(ACES, gameId))!;
  const result = applyCommand(read, {
    kind: "game.notThisTeam",
    year: 2027,
    gameId: pressed.id,
    teamId: pressed.teamBId,
    standInId: "S-OFF",
  });
  if (!result.ok) throw new Error(result.why);
  result.writes.forEach((write) => {
    if (write.part === "teams") teams = write.teams;
    if (write.part === "games") games = write.games;
    if (write.part === "answers" && write.list === "notThisTeam") refused = write.ids;
  });
  return { state: { ...state, teams: [...teams], games: [...games] }, refused };
};

describe("what Same team as keeps on the club", () => {
  it("keeps the schedule that wrote the name, and the name it typed", () => {
    const before = beforeTheAnswer();
    expect(facing(before, "a1")).toMatchObject({ name: "Bolts", nameOnly: true });
    const state = answered();
    const club = clubOf(state, COMETS);
    expect(facing(state, "a1")?.id).toBe(club.id);
    expect(club.namedAs).toEqual([{ schedule: ACES, name: "bolts" }]);
    // The Aces' own club holds no answer: the name is theirs for somebody else.
    expect(clubOf(state, ACES).namedAs).toBeUndefined();
  });

  it("keeps the name the row typed, though the stand-in was renamed before the fold", () => {
    const state = beforeTheAnswer();
    const standIn = state.teams.find((team) => team.nameOnly && team.name === "Bolts")!;
    const renamed = state.teams.map((team) =>
      team.id === standIn.id ? { ...team, name: "Lightning" } : team
    );
    const fold = (games: ScoutGame[]) =>
      mergeScoutTeams(
        standIn.id,
        clubOf(state, COMETS).id,
        renamed,
        games,
        state.ageGroups
      ).teams.find((team) => team.id === clubOf(state, COMETS).id)?.namedAs;
    expect(fold(state.games)).toEqual([{ schedule: ACES, name: "bolts" }]);
    // A row pulled before rows kept their typed name gives the stand-in's own.
    const untyped = state.games.map(({ typedAs: _typed, ...game }) => game);
    expect(fold(untyped)).toEqual([{ schedule: ACES, name: "lightning" }]);
  });

  it("records nothing for a slot folded into a club, nor a schedule of the club's own", () => {
    const state = beforeTheAnswer();
    const club = clubOf(state, COMETS);
    const slot: ScoutTeam = { id: "S-TBD9", name: "TBD", placeholder: true };
    const onSlot: ScoutGame = {
      ...gameOf(state, rowId(ACES, "a2"))!,
      id: rowId(ACES, "slot"),
      teamBId: slot.id,
      typedAs: "tbd",
      source: { kind: "gamechanger", teamId: ACES, gameId: "slot" },
    };
    const folded = mergeScoutTeams(
      slot.id,
      club.id,
      [...state.teams, slot],
      [...state.games, onSlot],
      state.ageGroups
    );
    expect(folded.teams.find((team) => team.id === club.id)?.namedAs).toBeUndefined();
    // A stand-in the club's own schedule named is a game against itself once folded: no answer.
    const pilots = state.teams.find((team) => team.name === "Pilots")!;
    const own = mergeScoutTeams(pilots.id, club.id, state.teams, state.games, state.ageGroups);
    expect(own.teams.find((team) => team.id === club.id)?.namedAs).toBeUndefined();
  });

  it("goes with the club wherever it is folded, by hand or by the tidy", () => {
    const state = answered();
    const club = clubOf(state, COMETS);
    const twin: ScoutTeam = {
      id: "S-COMET9",
      name: "Comets Navy",
      state: "OH",
      gcTeams: [{ teamId: "gcCOMETS0002", name: "Comets Navy 10U", ageGroupId: "x", ageLevel: 10 }],
      namedAs: [{ schedule: DUKES, name: "navy" }],
    };
    const both = [
      { schedule: ACES, name: "bolts" },
      { schedule: DUKES, name: "navy" },
    ];
    // By hand, either way round, the two lists one list in one order.
    const intoClub = mergeScoutTeams(twin.id, club.id, [...state.teams, twin], state.games, []);
    expect(intoClub.teams.find((team) => team.id === club.id)?.namedAs).toEqual(both);
    const intoTwin = mergeScoutTeams(club.id, twin.id, [...state.teams, twin], state.games, []);
    expect(intoTwin.teams.find((team) => team.id === twin.id)?.namedAs).toEqual(both);
    // By the tidy's fold of one squad listed twice, both of its ids having filed one fixture.
    const pulled = (id: string, gc: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
      id,
      name: "Hawks",
      state: "OH",
      gcTeams: [{ teamId: gc, name: "Hawks 10U", ageGroupId: "ag", ageLevel: 10 }],
      ...extra,
    });
    const third = { ...pulled("S-OWLS", "gcOWLS000001"), name: "Owls" };
    const kept = pulled("S-HAWK", "gcHAWKS00001");
    const twice = pulled("S-HAWK2", "gcHAWKS00002", {
      namedAs: [{ schedule: ACES, name: "hawks" }],
    });
    const fixture = (club: ScoutTeam, gameId: string): ScoutGame => ({
      id: rowId(club.gcTeams![0]!.teamId, gameId),
      teamAId: club.id,
      teamBId: third.id,
      teamAScore: 5,
      teamBScore: 3,
      ageGroupId: "ag",
      date: "2026-09-20",
      source: { kind: "gamechanger", teamId: club.gcTeams![0]!.teamId, gameId },
    });
    const squads: GcImportState = {
      ageGroups: [{ id: "ag", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }],
      teams: [kept, twice, third],
      games: [fixture(kept, "k1"), fixture(kept, "k2"), fixture(twice, "t1")],
    };
    const squad = mergeSameSquadIds(squads);
    expect(squad.merged).toBe(1);
    expect(squad.state.teams.find((team) => team.id === kept.id)?.namedAs).toEqual(twice.namedAs);
    // And by the season pairing, a fall squad paired on into its spring one.
    const season = (id: string, gc: string, gcSeason: string, year: number, extra = {}) =>
      pulled(id, gc, {
        city: "Townville",
        gcTeams: [
          {
            teamId: gc,
            name: "Hawks 10U",
            ageGroupId: "ag",
            ageLevel: 10,
            season: gcSeason,
            seasonYear: year,
          },
        ],
        ...extra,
      });
    const fall = season("S-HAWKF", "gcHAWKSFALL1", "fall", 2026, {
      namedAs: [{ schedule: ACES, name: "hawks" }],
    });
    const spring = season("S-HAWKS", "gcHAWKSSPRG1", "spring", 2027);
    const paired = pairSettledSquads({ ...squads, teams: [fall, spring], games: [] });
    expect(paired.paired).toBe(1);
    expect(paired.state.teams).toHaveLength(1);
    expect(paired.state.teams[0]?.namedAs).toEqual(fall.namedAs);
  });

  it("is taken back with the fold: putting the stand-in back forgets the answer", () => {
    const state = beforeTheAnswer();
    const year = 2027;
    let teams: readonly ScoutTeam[] = state.teams;
    let games: readonly ScoutGame[] = state.games;
    const read: PoolRead = {
      ...NO_ANSWERS,
      teams: () => teams,
      groups: () => state.ageGroups,
      years: () => [year],
      games: () => games,
    };
    const run = (command: Parameters<typeof applyCommand>[1]) => {
      const result = applyCommand(read, command);
      if (!result.ok) throw new Error(result.why);
      result.writes.forEach((write) => {
        if (write.part === "teams") teams = write.teams;
        if (write.part === "games") games = write.games;
      });
      return result;
    };
    const standIn = state.teams.find((team) => team.nameOnly && team.name === "Bolts")!;
    const club = clubOf(state, COMETS);
    const fold = run({ kind: "teams.merge", fromId: standIn.id, intoId: club.id, adopt: [] });
    expect(teams.find((team) => team.id === club.id)?.namedAs).toEqual([
      { schedule: ACES, name: "bolts" },
    ]);
    // The edit function takes the inverse's records back exactly as they were sent.
    const redo = { kind: "team.put" as const, team: teams.find((team) => team.id === club.id)! };
    expect(coerceCommand(JSON.parse(JSON.stringify(redo)))).toEqual(redo);
    run(fold.inverse);
    expect(teams.find((team) => team.id === club.id)).toEqual(club);
    expect(teams.some((team) => team.id === standIn.id)).toBe(true);
    // So the namer's next row of the name is read as it was before the answer.
    const next = importGcSchedule(
      schedule(ACES, "Aces 10U", acesWeek2),
      { ...state, teams: [...teams], games: [...games] },
      options
    ).state;
    expect(facing(next, "a4")?.id).not.toBe(club.id);
  });
});

describe("the answer as it is stored", () => {
  const club: ScoutTeam = {
    id: "S-COME",
    name: "Comets Navy",
    state: "OH",
    gcTeams: [{ teamId: COMETS, name: "Comets Navy 10U", ageGroupId: "ag", ageLevel: 10 }],
    namedAs: [
      { schedule: ACES, name: "bolts" },
      { schedule: DUKES, name: "navy" },
    ],
  };
  const plain: ScoutTeam = { id: "S-ACES", name: "Aces", state: "OH" };

  it("survives the codec, and a roster with no answer is written as it was", () => {
    const stored = JSON.parse(JSON.stringify(encodeScoutTeams([club, plain])));
    expect(decodeScoutTeams(stored, coerceScoutTeams)).toEqual([club, plain]);
    expect(encodeScoutTeams([plain]).r).toEqual([["S-ACES", "Aces", 0, "OH"]]);
    // A picture an old row kept where the answers go now reads as none.
    expect(
      decodeScoutTeams(
        { v: 1, g: [], s: [], r: [["S-ACES", "Aces", 0, "OH", null, null, "pic"]] },
        coerceScoutTeams
      )
    ).toEqual([plain]);
    // Read as plain objects too, as an older store and the whole-browser file hold a roster.
    expect(coerceScoutTeams(JSON.parse(JSON.stringify([club, plain])))).toEqual([club, plain]);
    // A malformed answer is dropped on its own, and the club kept.
    const broken = { ...club, namedAs: [{ schedule: ACES }, { schedule: "", name: "x" }, 7] };
    expect(coerceScoutTeams([broken])).toEqual([{ ...club, namedAs: undefined }].map(withoutNone));
  });

  it("survives the worker's wire and both backups", () => {
    const state: GcImportState = { ageGroups: [], teams: [club, plain], games: [] };
    expect(unpackPool(JSON.parse(JSON.stringify(packPool(state)))).teams).toEqual([club, plain]);
    const backup: TeamRankingsBackup = { ageGroups: [], teams: [club, plain], games: [] };
    expect(
      parseTeamRankingsJson(teamRankingsJson(backup, "2026-10-31T12:00:00.000Z"))?.teams
    ).toEqual([club, plain]);
    // The whole-browser file and Undo hold the pool as plain objects.
    expect(coerceTeamRankingsBackup(JSON.parse(JSON.stringify(backup)))?.teams).toEqual([
      club,
      plain,
    ]);
  });

  it("is not published on the club's card, which no member's device reads it from", () => {
    const known = {
      teams: [club, plain],
      games: [
        {
          id: "g1",
          teamAId: plain.id,
          teamBId: club.id,
          ageGroupId: "ag",
          teamAScore: 1,
          teamBScore: 2,
        },
      ],
      derivedGames: [],
      pickedOnly: new Set<string>(),
      leagueClubs: new Map(),
      leagueHalves: new Map(),
      removed: new Set<string>(),
      leagueKept: new Set<string>(),
    };
    const cards = clubViews({
      ageGroups: [],
      built: { known: new Map([[2027, known]]) },
      namedAges: new Map(),
    }).flatMap(({ value }) => Object.values(value.clubs));
    const card = cards.find((one) => one.team.id === club.id);
    expect(card?.team).toEqual({
      id: club.id,
      name: club.name,
      state: "OH",
      gcTeams: club.gcTeams,
    });
  });
});

describe("Same team as, standing for that coach's later games typed the same way", () => {
  it("files the namer's next row of the name onto the club, where it went to a new stand-in", () => {
    const state = answered();
    const club = clubOf(state, COMETS);
    const next = tidyPool(
      importGcSchedule(schedule(ACES, "Aces 10U", acesWeek2), state, options).state
    ).state;
    expect(facing(next, "a3")?.id).toBe(club.id);
    expect(facing(next, "a4")?.id).toBe(club.id);
    // The answered rows are the owner's word; the next ones are the answer's, which Not this team
    // can still take back (`filedByNameOn`).
    expect(gameOf(next, rowId(ACES, "a1"))?.namedByAvatar).toBe(club.id);
    expect(gameOf(next, rowId(ACES, "a4"))?.namedByAvatar).toBeUndefined();
    expect(next.teams.some((team) => team.name === "Bolts")).toBe(false);
    expect(tidyChangedAnything(tidyPool(next))).toBe(false);
  });

  it("files it as the import reads the row, so no stand-in is made for it", () => {
    const { state, outcome } = importGcSchedule(
      schedule(ACES, "Aces 10U", acesWeek2),
      answered(),
      options
    );
    expect(outcome.opponentsCreated).toBe(0);
    expect(facing(state, "a3")?.id).toBe(clubOf(state, COMETS).id);
    expect(facing(state, "a4")?.id).toBe(clubOf(state, COMETS).id);
    expect(state.teams.some((team) => team.name === "Bolts")).toBe(false);
  });

  it("stands where the namer is far from the club, since the owner has seen the games", () => {
    // The Aces of a state no border joins to the club's, and no game both clubs list.
    let state = importGcSchedule(schedule(ACES, "Aces 10U", acesWeek1, "TX"), empty, options).state;
    state = tidyPool(importGcSchedule(comets, state, options).state).state;
    const standIn = state.teams.find((team) => team.nameOnly && team.name === "Bolts")!;
    const club = clubOf(state, COMETS);
    const merged = mergeScoutTeams(standIn.id, club.id, state.teams, state.games, state.ageGroups);
    const next = tidyPool(
      importGcSchedule(
        schedule(ACES, "Aces 10U", acesWeek2, "TX"),
        { ...state, teams: merged.teams, games: merged.games },
        options
      ).state
    ).state;
    expect(facing(next, "a3")?.id).toBe(club.id);
    expect(facing(next, "a4")?.id).toBe(club.id);
    // And left there: taken off as far from its namer, the refile would file it back every pass.
    expect(tidyChangedAnything(tidyPool(next))).toBe(false);
  });

  it("leaves another namer's row of the same name on a stand-in", () => {
    let state = importGcSchedule(schedule(ACES, "Aces 10U", acesWeek2), answered(), options).state;
    state = importGcSchedule(
      schedule(DUKES, "Dukes 10U", [
        played("d1", "2026-10-03", "Bolts", 0, 1, "2026-10-03T18:00:00.000Z"),
      ]),
      state,
      options
    ).state;
    state = tidyPool(state).state;
    expect(facing(state, "a4")?.id).toBe(clubOf(state, COMETS).id);
    expect(teamOf(state, gameOf(state, rowId(DUKES, "d1"))?.teamBId)).toMatchObject({
      name: "Bolts",
      nameOnly: true,
    });
  });

  it("is held to the in-state rule's guards: the row's level, the club's season, its own games", () => {
    const comet = (state: GcImportState, gameId: string) =>
      facing(state, gameId)?.id === clubOf(state, COMETS).id;
    const later = (games: GcTeamSchedule["games"]) =>
      tidyPool(
        importGcSchedule(schedule(ACES, "Aces 10U", [...acesWeek1, ...games]), answered(), options)
          .state
      ).state;
    // A level typed into the name that the club is not listed at is another squad of the name.
    expect(
      comet(
        later([played("up", "2026-10-03", "Bolts 11U", 6, 1, "2026-10-03T14:00:00.000Z")]),
        "up"
      )
    ).toBe(false);
    // More than a week before the club's first game of its own in the year (20 September).
    const early = later([
      played("early", "2026-09-12", "Bolts", 1, 1, "2026-09-12T19:00:00.000Z"),
      played("week", "2026-09-13", "Bolts", 2, 2, "2026-09-13T19:00:00.000Z"),
    ]);
    expect(comet(early, "early")).toBe(false);
    expect(comet(early, "week")).toBe(true);
    // Within the hour of a game of the club's own against another club: a club plays one at a time.
    const clash = later([
      played("clash", "2026-09-20", "Bolts", 9, 8, "2026-09-20T15:30:00.000Z"),
      played("after", "2026-09-20", "Bolts", 3, 0, "2026-09-20T17:00:00.000Z"),
    ]);
    expect(comet(clash, "clash")).toBe(false);
    expect(comet(clash, "after")).toBe(true);
    // Two clubs the owner said the name is, at one level: two answers that disagree are neither.
    const folded = answered();
    const page = gameOf(folded, rowId(ACES, "a1"))!.ageGroupId;
    const twin: ScoutTeam = {
      id: "S-COMET2",
      name: "Comets Navy",
      state: "OH",
      gcTeams: [
        { teamId: "gcCOMETS0002", name: "Comets Navy 10U", ageGroupId: page, ageLevel: 10 },
      ],
      namedAs: [{ schedule: ACES, name: "bolts" }],
    };
    const twice = importGcSchedule(
      schedule(ACES, "Aces 10U", acesWeek2),
      { ...folded, teams: [...folded.teams, twin] },
      options
    ).state;
    expect(facing(twice, "a4")).toMatchObject({ name: "Bolts", nameOnly: true });
    // A club whose name can only be a slot is no club to file the name onto (`namesNobody`).
    const slotted = {
      ...folded,
      teams: folded.teams.map((team) =>
        team.id === clubOf(folded, COMETS).id ? { ...team, name: "Tbd" } : team
      ),
    };
    const ontoSlot = importGcSchedule(
      schedule(ACES, "Aces 10U", acesWeek2),
      slotted,
      options
    ).state;
    expect(facing(ontoSlot, "a4")?.id).not.toBe(clubOf(folded, COMETS).id);
  });

  it("is overruled by Not this team, at once and on every row of the name after", () => {
    const state = tidyPool(
      importGcSchedule(schedule(ACES, "Aces 10U", acesWeek2), answered(), options).state
    ).state;
    const club = clubOf(state, COMETS);
    const pressed = gameOf(state, rowId(ACES, "a4"))!;
    expect(pressed.teamBId).toBe(club.id);
    const lookup = (id: string) => teamOf(state, id);
    const refused: NotThisTeam = new Set(refusalsFor(pressed, club, lookup));
    const taken = takeOffClub(state, pressed, club, "S-OFF")!;
    // The answered rows stay, as the owner's word; the answer's own go with the press.
    expect(taken.moved.map(({ was }) => was.id).sort()).toEqual([
      rowId(ACES, "a3"),
      rowId(ACES, "a4"),
    ]);
    const moved = new Map(taken.moved.map(({ now }) => [now.id, now]));
    const off: GcImportState = {
      ...state,
      teams: [...state.teams, ...taken.standIns],
      games: state.games.map((game) => moved.get(game.id) ?? game),
    };
    const tidied = tidyPool(off, undefined, undefined, refused).state;
    expect(facing(tidied, "a3")?.id).not.toBe(club.id);
    expect(facing(tidied, "a4")?.id).not.toBe(club.id);
    expect(facing(tidied, "a1")?.id).toBe(club.id);
    // And the namer's next row of the name is not filed onto the club, at the import or after.
    const later = importGcSchedule(
      schedule(ACES, "Aces 10U", [
        ...acesWeek2,
        played("a5", "2026-10-10", "Bolts", 4, 4, "2026-10-10T14:00:00.000Z"),
      ]),
      tidied,
      { ...options, notThisTeam: refused }
    ).state;
    expect(facing(later, "a5")?.id).not.toBe(club.id);
    expect(facing(tidyPool(later, undefined, undefined, refused).state, "a5")?.id).not.toBe(
      club.id
    );
    // A refusal of the very name the row typed, for the club, overrules it as well: the club was
    // refused under the name it carried then.
    const typedRefused: NotThisTeam = new Set([refusalOf(ACES, "Bolts", COMETS)]);
    const typed = importGcSchedule(schedule(ACES, "Aces 10U", acesWeek2), answered(), {
      ...options,
      notThisTeam: typedRefused,
    }).state;
    expect(facing(typed, "a4")?.id).not.toBe(club.id);
    expect(facing(tidyPool(typed, undefined, undefined, typedRefused).state, "a4")?.id).not.toBe(
      club.id
    );
  });

  it("files a stand-in's row of the answered name in the refile, and the resettle leaves it", () => {
    const folded = answered();
    const page = gameOf(folded, rowId(ACES, "a1"))!.ageGroupId;
    // A second Comets Navy pulled in the state, so that the club's own name, which the resettle
    // reads a row on it by, is no one club's: only the answer keeps a row on either.
    const twin: ScoutTeam = {
      id: "S-COMET2",
      name: "Comets Navy",
      state: "OH",
      gcTeams: [
        { teamId: "gcCOMETS0002", name: "Comets Navy 10U", ageGroupId: page, ageLevel: 10 },
      ],
    };
    const state = { ...folded, teams: [...folded.teams, twin] };
    const club = clubOf(state, COMETS);
    const aces = clubOf(state, ACES);
    // A row a pull of an older build filed against a stand-in of the name after the answer.
    const standIn: ScoutTeam = { id: "S-BOLT9", name: "Bolts", nameOnly: true };
    const row: ScoutGame = {
      id: rowId(ACES, "a4"),
      teamAId: aces.id,
      teamBId: standIn.id,
      teamAScore: 6,
      teamBScore: 1,
      ageGroupId: page,
      ageLevelA: 10,
      date: "2026-10-03",
      startTs: "2026-10-03T14:00:00.000Z",
      typedAs: "bolts",
      source: { kind: "gamechanger", teamId: ACES, gameId: "a4" },
    };
    const onStandIn = { ...state, teams: [...state.teams, standIn], games: [...state.games, row] };
    const refiled = refileStandIns(onStandIn);
    expect(refiled.refiled).toBe(1);
    expect(gameOf(refiled.state, row.id)?.teamBId).toBe(club.id);
    // On the club, though its own schedule has no game within a day of it.
    const onClub = { ...state, games: [...state.games, { ...row, teamBId: club.id }] };
    expect(resettleOffLevel(onClub).resettled).toBe(0);
    // Another schedule's row of the name, put on the club, the resettle takes off.
    const theirs = {
      ...row,
      id: rowId(DUKES, "d1"),
      teamAId: "S-DUKES",
      teamBId: club.id,
      source: { kind: "gamechanger" as const, teamId: DUKES, gameId: "d1" },
    };
    const dukes: ScoutTeam = {
      id: "S-DUKES",
      name: "Dukes",
      state: "OH",
      gcTeams: [{ teamId: DUKES, name: "Dukes 10U", ageGroupId: row.ageGroupId, ageLevel: 10 }],
    };
    expect(
      resettleOffLevel({
        ...state,
        teams: [...state.teams, dukes],
        games: [...state.games, theirs],
      }).resettled
    ).toBe(1);
  });

  it("leaves a row that kept no typed name to its schedule's next pull, and the tidy settles", () => {
    const folded = answered();
    const page = gameOf(folded, rowId(ACES, "a1"))!.ageGroupId;
    const club = clubOf(folded, COMETS);
    const aces = clubOf(folded, ACES);
    // The answer under the club's own name as well, as folding back the stand-in a press of Not
    // this team or the resettle made under that name keeps it (`takeOffClub`).
    const both = [
      { schedule: ACES, name: "bolts" },
      { schedule: ACES, name: "comets navy" },
    ];
    // A second Comets Navy in the state, so that the club's own name is no one club's.
    const twin: ScoutTeam = {
      id: "S-COMET2",
      name: "Comets Navy",
      state: "OH",
      gcTeams: [
        { teamId: "gcCOMETS0002", name: "Comets Navy 10U", ageGroupId: page, ageLevel: 10 },
      ],
    };
    // Rows pulled before rows kept their typed name, each on a stand-in of a name answered.
    const bolts: ScoutTeam = { id: "S-BOLT9", name: "Bolts", nameOnly: true };
    const navy: ScoutTeam = { id: "S-COME9", name: "Comets Navy", nameOnly: true };
    const untyped = (gameId: string, standIn: ScoutTeam, date: string): ScoutGame => ({
      id: rowId(ACES, gameId),
      teamAId: aces.id,
      teamBId: standIn.id,
      teamAScore: 6,
      teamBScore: 1,
      ageGroupId: page,
      ageLevelA: 10,
      date,
      startTs: `${date}T14:00:00.000Z`,
      source: { kind: "gamechanger", teamId: ACES, gameId },
    });
    const state: GcImportState = {
      ...folded,
      teams: [
        ...folded.teams.map((team) => (team.id === club.id ? { ...team, namedAs: both } : team)),
        twin,
        bolts,
        navy,
      ],
      games: [
        ...folded.games,
        untyped("a4", bolts, "2026-10-03"),
        untyped("a6", navy, "2026-10-10"),
      ],
    };
    // Read by its stand-in's name, the refile filed each onto the club, and the resettle, which
    // reads the name the row typed, took it off again: the "Bolts" row onto a stand-in of the
    // club's name in three passes, the "Comets Navy" row back and forth through all six.
    const tidied = tidyPool(state);
    expect(tidied.passes).toBeLessThanOrEqual(2);
    expect(tidyChangedAnything(tidyPool(tidied.state))).toBe(false);
    expect(facing(tidied.state, "a4")?.id).toBe(bolts.id);
    expect(facing(tidied.state, "a6")?.id).toBe(navy.id);
    // The schedule's next pull learns what each row typed, and both are the club's.
    const pulled = tidyPool(
      importGcSchedule(
        schedule(ACES, "Aces 10U", [
          ...acesWeek1,
          played("a4", "2026-10-03", "Bolts", 6, 1, "2026-10-03T14:00:00.000Z"),
          played("a6", "2026-10-10", "Comets Navy", 6, 1, "2026-10-10T14:00:00.000Z"),
        ]),
        tidied.state,
        options
      ).state
    ).state;
    expect(facing(pulled, "a4")?.id).toBe(club.id);
    expect(facing(pulled, "a6")?.id).toBe(club.id);
    expect(tidyChangedAnything(tidyPool(pulled))).toBe(false);
  });

  it("files a row within the hour of the club's own row against the namer: that very game", () => {
    const folded = answered();
    const page = gameOf(folded, rowId(ACES, "a1"))!.ageGroupId;
    const club = clubOf(folded, COMETS);
    const aces = clubOf(folded, ACES);
    // The club's own row of 3 October, against the Aces themselves, not yet one game with theirs.
    const ownRow: ScoutGame = {
      id: rowId(COMETS, "c3"),
      teamAId: club.id,
      teamBId: aces.id,
      teamAScore: 1,
      teamBScore: 6,
      ageGroupId: page,
      ageLevelA: 10,
      date: "2026-10-03",
      startTs: "2026-10-03T14:00:00.000Z",
      typedAs: "aces",
      source: { kind: "gamechanger", teamId: COMETS, gameId: "c3" },
    };
    const standIn: ScoutTeam = { id: "S-BOLT9", name: "Bolts", nameOnly: true };
    const row: ScoutGame = {
      id: rowId(ACES, "a4"),
      teamAId: aces.id,
      teamBId: standIn.id,
      teamAScore: 6,
      teamBScore: 1,
      ageGroupId: page,
      ageLevelA: 10,
      date: "2026-10-03",
      startTs: "2026-10-03T14:00:00.000Z",
      typedAs: "bolts",
      source: { kind: "gamechanger", teamId: ACES, gameId: "a4" },
    };
    const refiled = refileStandIns({
      ...folded,
      teams: [...folded.teams, standIn],
      games: [...folded.games, ownRow, row],
    });
    expect(refiled.refiled).toBe(1);
    expect(gameOf(refiled.state, row.id)?.teamBId).toBe(club.id);
  });

  it("is read for every listing of the namer's, and refused under any of them", () => {
    const folded = answered();
    const page = gameOf(folded, rowId(ACES, "a1"))!.ageGroupId;
    const aces = clubOf(folded, ACES);
    const fall = "gcACES000002";
    // The Aces on GameChanger twice: one club writing the name, as its refusals are kept.
    const twice: ScoutTeam = {
      ...aces,
      gcTeams: [
        ...aces.gcTeams!,
        { teamId: fall, name: "Aces 10U Fall", ageGroupId: page, ageLevel: 10 },
      ],
    };
    const state = {
      ...folded,
      teams: folded.teams.map((team) => (team.id === aces.id ? twice : team)),
    };
    const second = schedule(fall, "Aces 10U Fall", [
      played("b1", "2026-10-03", "Bolts", 6, 1, "2026-10-03T14:00:00.000Z"),
    ]);
    const onClub = (pool: GcImportState) =>
      gameOf(pool, rowId(fall, "b1"))?.teamBId === clubOf(pool, COMETS).id;
    const pulled = importGcSchedule(second, state, options);
    expect(pulled.outcome.opponentsCreated).toBe(0);
    expect(onClub(pulled.state)).toBe(true);
    expect(onClub(tidyPool(pulled.state).state)).toBe(true);
    // The name refused on the other listing is refused on this one too.
    const refused: NotThisTeam = new Set([refusalOf(ACES, "Bolts", COMETS)]);
    const refusedThere = importGcSchedule(second, state, { ...options, notThisTeam: refused });
    expect(onClub(refusedThere.state)).toBe(false);
    expect(onClub(tidyPool(refusedThere.state, undefined, undefined, refused).state)).toBe(false);
  });
});

describe("Not this team over the answer, under the name the answer is about", () => {
  /** The pool with the Aces' next week filed onto the club by the answer. */
  const filed = (): GcImportState =>
    tidyPool(importGcSchedule(schedule(ACES, "Aces 10U", acesWeek2), answered(), options).state)
      .state;
  const nextWeek = [
    ...acesWeek2,
    played("a5", "2026-10-10", "Bolts", 4, 4, "2026-10-10T14:00:00.000Z"),
  ];

  it("takes the answer back for good, though the club is renamed or folded after", () => {
    const state = filed();
    const club = clubOf(state, COMETS);
    expect(facing(state, "a4")?.id).toBe(club.id);
    const { state: off, refused } = pressNotThisTeam(state, "a4");
    // The name the coach typed, which no rename or fold of the club changes, beside the club's.
    expect([...refused].sort()).toEqual(
      [refusalOf(ACES, "Comets Navy", COMETS), refusalOf(ACES, "Bolts", COMETS)].sort()
    );
    /** Nothing of the name back on `clubId`: not at the tidy, nor the coach's next row of it. */
    const stayOff = (pool: GcImportState, clubId: string) => {
      const tidied = tidyPool(pool, undefined, undefined, refused).state;
      const next = tidyPool(
        importGcSchedule(schedule(ACES, "Aces 10U", nextWeek), tidied, {
          ...options,
          notThisTeam: refused,
        }).state,
        undefined,
        undefined,
        refused
      ).state;
      for (const each of [tidied, next]) {
        expect(facing(each, "a3")?.id).not.toBe(clubId);
        expect(facing(each, "a4")?.id).not.toBe(clubId);
        // The rows the fold itself put there stay, as the owner's word.
        expect(facing(each, "a1")?.id).toBe(clubId);
      }
      expect(facing(next, "a5")?.id).not.toBe(clubId);
    };
    stayOff(off, club.id);
    // Renamed on its panel.
    stayOff(
      {
        ...off,
        teams: off.teams.map((team) =>
          team.id === club.id ? { ...team, name: "Comets Navy Elite" } : team
        ),
      },
      club.id
    );
    // Folded into a pulled club of another name, which takes its ids and its answers with it.
    const page = gameOf(off, rowId(ACES, "a1"))!.ageGroupId;
    const gold: ScoutTeam = {
      id: "S-GOLD",
      name: "Comets Navy Gold",
      state: "OH",
      gcTeams: [
        { teamId: "gcGOLD000001", name: "Comets Navy Gold 10U", ageGroupId: page, ageLevel: 10 },
      ],
    };
    const merged = mergeScoutTeams(
      club.id,
      gold.id,
      [...off.teams, gold],
      off.games,
      off.ageGroups
    );
    expect(merged.teams.find((team) => team.id === gold.id)?.namedAs).toEqual(club.namedAs);
    stayOff({ ...off, teams: merged.teams, games: merged.games }, gold.id);
  });

  it("refuses each name the rows it takes were filed under, the answer's among them", () => {
    // The Aces' "Comets Navy" of 20 September, filed onto the club by its name; a press on it takes
    // the answer's rows too, as every row the namer filed there by a name (`takenWith`).
    const state = tidyPool(
      importGcSchedule(
        schedule(ACES, "Aces 10U", [
          ...acesWeek2,
          played("a6", "2026-09-20", "Comets Navy", 7, 0, "2026-09-20T18:00:00.000Z"),
        ]),
        answered(),
        options
      ).state
    ).state;
    const club = clubOf(state, COMETS);
    expect(facing(state, "a6")?.id).toBe(club.id);
    const { state: off, refused } = pressNotThisTeam(state, "a6");
    expect(refused.has(refusalOf(ACES, "Bolts", COMETS))).toBe(true);
    // Refused by the club's name alone, the answer filed its rows back, outside the press's Undo.
    const tidied = tidyPool(off, undefined, undefined, refused).state;
    for (const each of ["a3", "a4", "a6"]) expect(facing(tidied, each)?.id).not.toBe(club.id);
    expect(facing(tidied, "a1")?.id).toBe(club.id);
  });

  it("is not taken back by a refusal of another name the coach wrote, given before it", () => {
    const comets5th = schedule(COMETS, "Comets Navy 10U", [
      played("c0", "2026-09-05", "Pilots 10U", 1, 0, "2026-09-05T15:00:00.000Z"),
      played("c1", "2026-09-20", "Pilots 10U", 4, 2, "2026-09-20T15:00:00.000Z"),
    ]);
    const week0 = [played("a0", "2026-09-05", "Comets Navy", 3, 2, "2026-09-05T18:00:00.000Z")];
    let state = importGcSchedule(comets5th, empty, options).state;
    state = tidyPool(
      importGcSchedule(schedule(ACES, "Aces 10U", week0), state, options).state
    ).state;
    expect(facing(state, "a0")?.id).toBe(clubOf(state, COMETS).id);
    // The owner: the Aces' "Comets Navy" of 5 September is not this club.
    const pressed = pressNotThisTeam(state, "a0");
    const refused = pressed.refused;
    const pull = (games: GcTeamSchedule["games"], pool: GcImportState) =>
      tidyPool(
        importGcSchedule(schedule(ACES, "Aces 10U", games), pool, {
          ...options,
          notThisTeam: refused,
        }).state,
        undefined,
        undefined,
        refused
      ).state;
    // Later the coach types "Bolts" for the club, and the owner says so with Same team as.
    const week1 = [...week0, played("a1", "2026-09-12", "Bolts", 7, 3, "2026-09-12T14:00:00.000Z")];
    state = pull(week1, tidyPool(pressed.state, undefined, undefined, refused).state);
    const standIn = state.teams.find((team) => team.nameOnly && team.name === "Bolts")!;
    const merged = mergeScoutTeams(
      standIn.id,
      clubOf(state, COMETS).id,
      state.teams,
      state.games,
      state.ageGroups
    );
    state = { ...state, teams: merged.teams, games: merged.games };
    const next = pull(
      [...week1, played("a3", "2026-09-19", "Bolts", 2, 6, "2026-09-19T14:00:00.000Z")],
      state
    );
    const club = clubOf(next, COMETS);
    expect(facing(next, "a3")?.id).toBe(club.id);
    expect(facing(next, "a0")?.id).not.toBe(club.id);
  });
});

/** A team with its absent fields left out, as the readers write one. */
const withoutNone = (team: ScoutTeam): ScoutTeam =>
  Object.fromEntries(Object.entries(team).filter(([, value]) => value !== undefined)) as ScoutTeam;
