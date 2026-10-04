import { describe, expect, it } from "vitest";
import {
  checkNamedGames,
  coerceNamedCheck,
  coerceNamedGame,
  coerceNamedGames,
  gamesOfNamed,
  NAMED_GAMES_MAX,
  namedOfDraft,
  type NamedGame,
} from "../teamRankings/namedGames";
import { addOfNamed, addOfResolved } from "../live/namedAdd";
import type { ScoutGame, ScoutTeam } from "../teamRankings/types";

/*
 * Games named by their clubs' names (`namedGames.ts`): resolved to clubs as the Games tab resolves
 * a typed name, checked as its import checks a pasted row, read exactly as a device sends one, and
 * made into the one change that adds them (`namedAdd.ts`), which the device and the server share.
 * Placeholder names throughout.
 */

const ROSTER: ScoutTeam[] = [
  { id: "S-RAYS", name: "Rays" },
  { id: "S-BIRDS", name: "Blue Birds", state: "OH" },
];
const PAGE = "ag_10u_2027";
const ONE: NamedGame = { id: "scout_1_0_1", teamA: "Rays", teamB: "Bandits" };

describe("games named by their clubs", () => {
  it("resolve to the clubs here by name, and to clubs of their own otherwise", () => {
    const { teams, games } = gamesOfNamed(
      [
        { ...ONE, teamAScore: 6, teamBScore: 5, date: "2027-04-03", event: "Spring Open" },
        { id: "scout_1_1_2", teamA: "rays", teamB: "Blue Birds", stateA: "KY", stateB: "IN" },
      ],
      ROSTER,
      PAGE
    );
    const bandits = teams.find((team) => team.name === "Bandits");
    expect(bandits).toBeDefined();
    expect(games).toEqual([
      {
        id: "scout_1_0_1",
        teamAId: "S-RAYS",
        teamBId: bandits?.id,
        ageGroupId: PAGE,
        teamAScore: 6,
        teamBScore: 5,
        date: "2027-04-03",
        event: "Spring Open",
      },
      { id: "scout_1_1_2", teamAId: "S-RAYS", teamBId: "S-BIRDS", ageGroupId: PAGE },
    ]);
    // A state from the file fills one in, never over one already set.
    expect(teams.find((team) => team.id === "S-RAYS")?.state).toBe("KY");
    expect(teams.find((team) => team.id === "S-BIRDS")?.state).toBe("OH");
  });

  it("are checked for names worth a look, and for games the page already has", () => {
    const existing: ScoutGame[] = [
      {
        id: "g",
        teamAId: "S-RAYS",
        teamBId: "S-BIRDS",
        ageGroupId: PAGE,
        teamAScore: 6,
        teamBScore: 5,
        date: "2027-04-03",
      },
      // A row of a club against itself, which a game named that way is never taken for.
      { id: "self", teamAId: "S-RAYS", teamBId: "S-RAYS", ageGroupId: PAGE },
    ];
    const checks = checkNamedGames(
      [
        {
          id: "a",
          teamA: "Rays",
          teamB: "Blue Birds",
          teamAScore: 6,
          teamBScore: 5,
          date: "2027-04-03",
        },
        {
          id: "b",
          teamA: "Rays",
          teamB: "Blue Birdz",
          teamAScore: 6,
          teamBScore: 5,
          date: "2027-04-03",
        },
        { id: "c", teamA: "TBD", teamB: "Blue Birds" },
        { id: "d", teamA: "Rays", teamB: "rays" },
      ],
      ROSTER,
      existing,
      PAGE
    );
    expect(checks).toEqual([
      { notes: [null, null], logged: true },
      { notes: [null, { kind: "similar", to: "Blue Birds" }], logged: false },
      { notes: [{ kind: "placeholder" }, null], logged: false },
      { notes: [null, null], logged: false },
    ]);
  });

  it("are read exactly as a device sends them, and refused otherwise", () => {
    const full: NamedGame = {
      ...ONE,
      stateA: "KY",
      stateB: "OH",
      teamAScore: 6,
      teamBScore: 5,
      date: "2027-04-03",
      event: "Spring Open",
    };
    expect(coerceNamedGame(JSON.parse(JSON.stringify(full)))).toEqual(full);
    expect(coerceNamedGame(ONE)).toEqual(ONE);
    for (const raw of [
      { ...ONE, extra: 1 },
      { ...ONE, id: "../x" },
      { ...ONE, teamA: "  " },
      { ...ONE, teamB: "x".repeat(201) },
      { ...ONE, stateA: "Kentucky" },
      { ...ONE, teamAScore: 6 },
      { ...ONE, teamAScore: -1, teamBScore: 2 },
      { ...ONE, teamAScore: "6", teamBScore: 5 },
      { ...ONE, date: "April 3" },
      { ...ONE, event: "" },
      null,
    ]) {
      expect([raw, coerceNamedGame(raw)]).toEqual([raw, null]);
    }
    expect(coerceNamedGames([])).toBeNull();
    expect(coerceNamedGames([ONE, { ...ONE, teamA: "" }])).toBeNull();
    expect(coerceNamedGames(Array.from({ length: NAMED_GAMES_MAX }, () => ONE))).toHaveLength(
      NAMED_GAMES_MAX
    );
    expect(coerceNamedGames(Array.from({ length: NAMED_GAMES_MAX + 1 }, () => ONE))).toBeNull();
  });

  it("have their checks read back exactly", () => {
    const check = { notes: [null, { kind: "similar", to: "Blue Birds" }], logged: true };
    expect(coerceNamedCheck(check)).toEqual(check);
    expect(coerceNamedCheck({ notes: [{ kind: "placeholder" }, null], logged: false })).toEqual({
      notes: [{ kind: "placeholder" }, null],
      logged: false,
    });
    for (const raw of [
      { notes: [null], logged: true },
      { notes: [null, null], logged: "yes" },
      { notes: [null, { kind: "similar" }], logged: true },
      { notes: [null, { kind: "placeholder", to: "x" }], logged: true },
    ]) {
      expect(coerceNamedCheck(raw)).toBeNull();
    }
  });
});

describe("the form's game", () => {
  const DRAFT = {
    teamAName: " Rays ",
    teamBName: "Bandits",
    teamAScore: "",
    teamBScore: "",
    date: "",
    event: "",
  };

  it("is two clubs, and both scores or neither", () => {
    expect(namedOfDraft(DRAFT, "x")).toEqual({ id: "x", teamA: "Rays", teamB: "Bandits" });
    expect(
      namedOfDraft(
        { ...DRAFT, teamAScore: "6", teamBScore: "0", date: "2027-04-03", event: " Open " },
        "x"
      )
    ).toEqual({
      id: "x",
      teamA: "Rays",
      teamB: "Bandits",
      teamAScore: 6,
      teamBScore: 0,
      date: "2027-04-03",
      event: "Open",
    });
    for (const draft of [
      { ...DRAFT, teamBName: " " },
      { ...DRAFT, teamBName: "rays" },
      { ...DRAFT, teamAScore: "6" },
      { ...DRAFT, teamAScore: "6", teamBScore: "-1" },
      { ...DRAFT, teamAScore: "six", teamBScore: "1" },
    ]) {
      expect([draft, namedOfDraft(draft, "x")]).toEqual([draft, null]);
    }
  });
});

describe("the change that adds named games", () => {
  it("adopts the clubs the roster does not hold, and puts back a held club the names tidied", () => {
    // League Standings clubs the year knows that the roster does not hold: one named, one not.
    const known = [...ROSTER, { id: "L-FOX", name: "Foxes" }, { id: "L-OWL", name: "Owls" }];
    const add = addOfNamed({
      year: 2027,
      page: PAGE,
      named: [
        { id: "a", teamA: "Rays", teamB: "Foxes", stateA: "KY" },
        { id: "b", teamA: "Rays", teamB: "Bandits" },
      ],
      known,
      roster: ROSTER,
    });
    expect(add).toMatchObject({
      kind: "batch",
      commands: [
        { kind: "team.put", team: { id: "S-RAYS", name: "Rays", state: "KY" } },
        {
          kind: "game.add",
          year: 2027,
          adopt: [{ id: "L-FOX", name: "Foxes" }, { name: "Bandits" }],
        },
      ],
    });
  });

  it("is the game alone where nothing held changes", () => {
    const games: ScoutGame[] = [
      { id: "g", teamAId: "S-RAYS", teamBId: "S-BIRDS", ageGroupId: PAGE },
    ];
    expect(addOfResolved({ year: 2027, games, teams: ROSTER, roster: ROSTER })).toEqual({
      kind: "game.add",
      year: 2027,
      games,
      adopt: [],
    });
  });
});
