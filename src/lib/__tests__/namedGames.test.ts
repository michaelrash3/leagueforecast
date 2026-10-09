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
import { MAX_COMMAND_STEPS } from "../live/commands";
import { addOfNamed, addOfResolved, importOfNamed } from "../live/namedAdd";
import { cleanTeamName, offClubIdFor, resolveOrCreateTeam } from "../teamRankings/names";
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
    expect(coerceNamedGame({ ...ONE, again: true })).toEqual({ ...ONE, again: true });
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
      { ...ONE, again: false },
      { ...ONE, again: "yes" },
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

/**
 * How games named by their clubs were resolved before the roster was indexed for it: a walk down
 * the roster for each name, and a pass over it for each state. Kept to hold the indexed way to.
 */
const gamesOfNamedBefore = (
  named: readonly NamedGame[],
  teams: ScoutTeam[],
  ageGroupId: string
): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  const applyState = (pool: ScoutTeam[], teamId: string, state: string | undefined) =>
    state
      ? pool.map((team) => (team.id === teamId && !team.state ? { ...team, state } : team))
      : pool;
  let pool = teams;
  const games = named.map((game): ScoutGame => {
    const a = resolveOrCreateTeam(game.teamA, pool);
    pool = a.teams;
    const b = resolveOrCreateTeam(game.teamB, pool);
    pool = b.teams;
    pool = applyState(pool, a.teamId, game.stateA);
    pool = applyState(pool, b.teamId, game.stateB);
    return {
      id: game.id,
      teamAId: a.teamId,
      teamBId: b.teamId,
      ageGroupId,
      ...(game.teamAScore !== undefined && game.teamBScore !== undefined
        ? { teamAScore: game.teamAScore, teamBScore: game.teamBScore }
        : {}),
      ...(game.date ? { date: game.date } : {}),
      ...(game.event ? { event: game.event } : {}),
    };
  });
  return { teams: pool, games };
};

describe("games named by their clubs, resolved against an index of the roster", () => {
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x80000000;
    };
  };
  const WORDS = ["Rays", "Owls", "Foxes", "Storm", "Dayton", "Akron", "Elite", "Navy", "Blue"];
  const SLOTS = ["TBD", "Winner of Game 3", "Bye", "Pool A #2"];

  it("finds, tidies and makes the clubs the walk down the roster did, with the same ids", () => {
    const random = seeded(17);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    for (let round = 0; round < 40; round += 1) {
      const roster: ScoutTeam[] = Array.from({ length: 30 }, (_, index) => {
        const name = `${pick(WORDS)} ${pick(WORDS)}`;
        const kind = random();
        // Stored before labels were taken off; a slot; a club only a league team names; a state.
        if (kind < 0.15) return { id: `S-a${index}`, name: `${name} 9U` };
        if (kind < 0.25) return { id: `S-p${index}`, name: pick(SLOTS), placeholder: true };
        if (kind < 0.32) return { id: offClubIdFor(name), name };
        if (kind < 0.5) return { id: `S-s${index}`, name, state: "OH" };
        return { id: `S-${index}`, name };
      });
      // Two clubs sharing an id, which a roster should never hold, filled in as the walk did.
      if (round % 5 === 0 && roster[3] && roster[4]) roster[4] = { ...roster[4], id: roster[3].id };
      const nameOf = (): string => {
        const kind = random();
        if (kind < 0.55) {
          const held = cleanTeamName(pick(roster).name);
          return random() < 0.3 ? `${held.toUpperCase()} 10U` : held;
        }
        if (kind < 0.7) return pick(SLOTS);
        return `${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)}`;
      };
      const named: NamedGame[] = Array.from({ length: 25 }, (_, index) => ({
        id: `g${index}`,
        teamA: nameOf(),
        teamB: nameOf(),
        ...(random() < 0.4 ? { stateA: pick(["KY", "IN"]) } : {}),
        ...(random() < 0.4 ? { stateB: pick(["KY", "IN"]) } : {}),
        ...(random() < 0.5 ? { teamAScore: 3, teamBScore: 1 } : {}),
      }));
      const before = gamesOfNamedBefore(named, roster, PAGE);
      expect(gamesOfNamed(named, roster, PAGE)).toEqual(before);
    }
  });

  it("leaves the roster as it was handed over when nothing on it changes", () => {
    const { teams } = gamesOfNamed([{ id: "g", teamA: "Rays", teamB: "Blue Birds" }], ROSTER, PAGE);
    expect(teams).toBe(ROSTER);
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
      // One club by the key a name is found by, so one club against itself.
      { ...DRAFT, teamBName: "RAYS 10U" },
      { ...DRAFT, teamAScore: "6" },
      { ...DRAFT, teamAScore: "6", teamBScore: "-1" },
      { ...DRAFT, teamAScore: "six", teamBScore: "1" },
      // A day the server reads, and an event no longer than a name.
      { ...DRAFT, date: "20270-04-03" },
      { ...DRAFT, event: "x".repeat(201) },
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

describe("what the server makes of games added by name", () => {
  const LOGGED: ScoutGame = {
    id: "g",
    teamAId: "S-RAYS",
    teamBId: "S-BIRDS",
    ageGroupId: PAGE,
    teamAScore: 6,
    teamBScore: 5,
    date: "2027-04-03",
  };
  const AGAIN: NamedGame = {
    id: "a",
    teamA: "Blue Birds",
    teamB: "Rays",
    teamAScore: 5,
    teamBScore: 6,
    date: "2027-04-03",
  };
  const importOf = (named: NamedGame[], games: ScoutGame[] = [LOGGED], roster = ROSTER) =>
    importOfNamed({ year: 2027, page: PAGE, named, known: { teams: roster, games }, roster });

  it("adds none of a schedule with a game the page has by now, unless it was added again on purpose", () => {
    expect(importOf([{ ...ONE }, AGAIN])).toEqual({ ok: false, why: "logged" });
    // Another page's game, or one on another day, is not this one.
    expect(importOf([AGAIN], [{ ...LOGGED, ageGroupId: "ag_11u_2027" }]).ok).toBe(true);
    expect(importOf([{ ...AGAIN, date: "2027-04-04" }]).ok).toBe(true);
    expect(importOf([{ ...ONE }, { ...AGAIN, again: true }])).toMatchObject({
      ok: true,
      command: { kind: "game.add", year: 2027, adopt: [{ name: "Bandits" }] },
    });
  });

  it("adds no game of a club against itself", () => {
    expect(importOf([{ ...ONE, teamB: "RAYS 10U" }])).toEqual({ ok: false, why: "refused" });
  });

  it("adds none of a schedule that would tidy more clubs than one edit may change", () => {
    // Each row names a held club with no state, and a state for it: a step that writes the roster.
    const roster: ScoutTeam[] = [
      ...ROSTER,
      ...Array.from({ length: MAX_COMMAND_STEPS }, (_, at) => ({
        id: `S-C${at}`,
        name: `Club ${at}`,
      })),
    ];
    const rows = (count: number): NamedGame[] =>
      Array.from({ length: count }, (_, at) => ({
        id: `r${at}`,
        teamA: `Club ${at}`,
        teamB: "Blue Birds",
        stateA: "KY",
      }));
    // The game and a step for each club: as many as one edit may take, and one more.
    expect(importOf(rows(MAX_COMMAND_STEPS - 1), [], roster).ok).toBe(true);
    expect(importOf(rows(MAX_COMMAND_STEPS), [], roster)).toEqual({ ok: false, why: "too-many" });
  });
});
