import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedule,
  pairSettledSquads,
  mergeSameSquadIds,
  tidyPool,
  type GcImportOptions,
  type GcImportState,
} from "../gameChangerImport";
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
 * however the pool is stored, and gone again with the fold. Placeholder names throughout, and every
 * GameChanger id made up.
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

/** A team with its absent fields left out, as the readers write one. */
const withoutNone = (team: ScoutTeam): ScoutTeam =>
  Object.fromEntries(Object.entries(team).filter(([, value]) => value !== undefined)) as ScoutTeam;
