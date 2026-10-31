import { describe, expect, it } from "vitest";
import type { GcGame, GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedules,
  resettleOffLevel,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { gcRowId, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { countsTowardRating } from "../teamRankings/games";

/*
 * One game two far-apart clubs both list, which the tidy's rules handed back and forth (the sweep of
 * 30 October 2026). The Comets of Ohio beat "Bears Black" 9-2 at 16:30, and the Bears Black of Texas
 * have the same game at the same minute as a 2-9 loss to the Comets. A second Bears Black, in
 * Kentucky next door to Ohio, played the Vipers the next day. The reclaim moved the Comets' row onto
 * the Texas club on the game; the step that takes rows off clubs far from their namer took it off
 * again, since the two clubs had met in no game both their schedules held yet, the Texas club's own
 * row of it still standing apart; the refile put it on the Kentucky namesake; and the collapse that
 * would have made the two rows one game came after all three in each pass. Every tidy ran its six
 * passes, and the game counted twice, once on a club that never played it. Invented clubs.
 */
const groups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  { id: "ag12", name: "12U 2027", seasonIds: [], ageLevel: 12, year: 2027 },
];
const club = (id: string, name: string, state: string, level = 10): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [
    { teamId: `gc${id}`, name: `${name} ${level}U`, ageGroupId: `ag${level}`, ageLevel: level },
  ],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string, name: string): ScoutTeam => ({ id, name, placeholder: true });

/** `clubId`'s own row `gameId` against `against` at `start`, its own score first. */
const row = (
  clubId: string,
  gameId: string,
  against: string,
  start: string,
  score?: [number, number],
  level = 10
): ScoutGame => ({
  id: gcRowId(`gc${clubId}`, gameId),
  teamAId: clubId,
  teamBId: against,
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ageGroupId: `ag${level}`,
  date: start.slice(0, 10),
  startTs: `${start}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});

const COMETS = club("COMETS", "Comets", "OH");
const BEARS_TX = club("BEARSTX", "Bears Black", "TX");
const BEARS_KY = club("BEARSKY", "Bears Black", "KY");
const VIPERS = club("VIPERS", "Vipers", "KY");
const START = "2026-09-13T16:30";
const cometsRow = row("COMETS", "c1", "BEARSTX", START, [9, 2]);
const bearsRow = row("BEARSTX", "t1", "COMETS", START, [2, 9]);
const kentucky = [
  row("BEARSKY", "k1", "VIPERS", "2026-09-14T15:00", [4, 1]),
  row("VIPERS", "v1", "BEARSKY", "2026-09-14T15:00", [1, 4]),
];
const pool = (games: ScoutGame[], teams: ScoutTeam[] = []): GcImportState => ({
  ageGroups: groups,
  teams: [COMETS, BEARS_TX, BEARS_KY, VIPERS, ...teams],
  games: [...games, ...kentucky],
});

/** Every game holding a schedule's row `rowId`, standing on it or with it folded in. */
const holdersOf = (state: GcImportState, rowId: string): ScoutGame[] =>
  state.games.filter(
    (game) =>
      (game.source !== undefined && gcRowId(game.source.teamId, game.source.gameId) === rowId) ||
      (game.alsoRows ?? []).some((record) => gcRowId(record.teamId, record.gameId) === rowId)
  );
const clubIdOf = (state: GcImportState, schedule: string) =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === schedule))?.id;

/**
 * The one game holding both rows, the two named schedules' clubs on its sides and counted, with
 * neither row anywhere else: the game counts once, for the two clubs that played it.
 */
const expectOneGame = (state: GcImportState, a: string, b: string, aRow: string, bRow: string) => {
  const aHeld = holdersOf(state, aRow);
  const bHeld = holdersOf(state, bRow);
  expect(aHeld).toHaveLength(1);
  expect(bHeld).toHaveLength(1);
  const game = aHeld[0]!;
  expect(bHeld[0]).toBe(game);
  expect([game.teamAId, game.teamBId].sort()).toEqual(
    [clubIdOf(state, a), clubIdOf(state, b)].sort()
  );
  expect(countsTowardRating(game)).toBe(true);
};
/** The games the Kentucky namesake is on a side of, as `side score-score side` lines. */
const recordOf = (state: GcImportState, clubId: string) =>
  state.games
    .filter((game) => game.teamAId === clubId || game.teamBId === clubId)
    .map((game) => `${game.teamAId} ${game.teamAScore}-${game.teamBScore} ${game.teamBId}`);

describe("a game two far-apart clubs both list, at one start with the result mirrored", () => {
  it("settles in two passes into one game between the two, counted once", () => {
    const first = tidyPool(pool([cometsRow, bearsRow]));
    expect(first.passes).toBeLessThanOrEqual(2);
    expectOneGame(first.state, "gcCOMETS", "gcBEARSTX", cometsRow.id, bearsRow.id);
    const again = tidyPool(first.state);
    expect(again.passes).toBe(1);
    expect(tidyChangedAnything(again)).toBe(false);
  });

  it("leaves the Kentucky namesake with its own game and nothing else", () => {
    const { state } = tidyPool(pool([cometsRow, bearsRow]));
    expect(recordOf(state, "BEARSKY")).toEqual(["BEARSKY 4-1 VIPERS"]);
  });

  it("settles the same from where an import leaves it: on the namesake, and against a stand-in", () => {
    // The Comets' row filed by name onto the Kentucky club, which borders Ohio, and the Texas club's
    // own row against a stand-in of the Comets' very name, as a pull of each leaves them.
    const named = standIn("S-COMETS", "Comets");
    const first = tidyPool(
      pool(
        [
          { ...cometsRow, teamBId: "BEARSKY" },
          { ...bearsRow, teamBId: named.id },
        ],
        [named]
      )
    );
    expect(first.passes).toBeLessThanOrEqual(2);
    expectOneGame(first.state, "gcCOMETS", "gcBEARSTX", cometsRow.id, bearsRow.id);
    expect(recordOf(first.state, "BEARSKY")).toEqual(["BEARSKY 4-1 VIPERS"]);
    expect(tidyChangedAnything(tidyPool(first.state))).toBe(false);
  });

  it("and where the Texas club's own row is against a slot at that minute", () => {
    const tbd = slot("T-1", "TBD- 09/13/26, 4:30 PM");
    const first = tidyPool(
      pool(
        [
          { ...cometsRow, teamBId: "BEARSKY" },
          { ...bearsRow, teamBId: tbd.id },
        ],
        [tbd]
      )
    );
    expect(first.passes).toBeLessThanOrEqual(2);
    expectOneGame(first.state, "gcCOMETS", "gcBEARSTX", cometsRow.id, bearsRow.id);
    expect(recordOf(first.state, "BEARSKY")).toEqual(["BEARSKY 4-1 VIPERS"]);
    expect(tidyChangedAnything(tidyPool(first.state))).toBe(false);
  });

  it("and against a stand-in of another name at that very minute, as the reclaim reads it", () => {
    // The reclaim moves the row onto the club whose own row is at the very start with the result
    // mirrored, whatever the stand-in is called; read any narrower here, the two took turns again.
    const other = standIn("S-DRAGONS", "Dragons");
    const first = tidyPool(
      pool(
        [
          { ...cometsRow, teamBId: "BEARSKY" },
          { ...bearsRow, teamBId: other.id },
        ],
        [other]
      )
    );
    expect(first.passes).toBeLessThanOrEqual(2);
    expectOneGame(first.state, "gcCOMETS", "gcBEARSTX", cometsRow.id, bearsRow.id);
    expect(recordOf(first.state, "BEARSKY")).toEqual(["BEARSKY 4-1 VIPERS"]);
    expect(tidyChangedAnything(tidyPool(first.state))).toBe(false);
  });

  it("and where the two clubs dated it a day apart at the same clock", () => {
    const later = { ...bearsRow, date: "2026-09-14", startTs: "2026-09-14T16:45:00.000Z" };
    const first = tidyPool(pool([cometsRow, later]));
    expect(first.passes).toBeLessThanOrEqual(2);
    expectOneGame(first.state, "gcCOMETS", "gcBEARSTX", cometsRow.id, later.id);
    expect(tidyChangedAnything(tidyPool(first.state))).toBe(false);
  });
});

describe("the four clubs pulled in every order", () => {
  const game = (id: string, start: string, opponentName: string, own: number, theirs: number) =>
    ({
      id,
      date: start.slice(0, 10),
      startTs: `${start}:00.000Z`,
      opponentName,
      status: "completed",
      teamScore: own,
      opponentScore: theirs,
    }) satisfies GcGame;
  const schedule = (
    id: string,
    name: string,
    state: string,
    city: string,
    games: GcGame[]
  ): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 10, season: { season: "fall", year: 2026 }, state, city },
    games,
    fetchedAt: "2026-09-20T12:00:00.000Z",
  });
  const comets = schedule("gcF", "Comets 10U", "OH", "Alphaville", [
    game("f1", START, "Bears Black", 9, 2),
  ]);
  const bearsTx = schedule("gcLTX", "Bears Black 10U", "TX", "Betaville", [
    game("t1", START, "Comets", 2, 9),
  ]);
  const bearsKy = schedule("gcLKY", "Bears Black 10U", "KY", "Gammaville", [
    game("k1", "2026-09-14T15:00", "Vipers", 4, 1),
  ]);
  const vipers = schedule("gcOTH", "Vipers 10U", "KY", "Gammaville", [
    game("v1", "2026-09-14T15:00", "Bears Black", 1, 4),
  ]);
  const orders: [string, GcTeamSchedule[][]][] = [
    ["the Texas club first, all at once", [[bearsTx, bearsKy, vipers, comets]]],
    ["the Ohio club first, all at once", [[comets, bearsKy, vipers, bearsTx]]],
    ["the two that met first, all at once", [[comets, bearsTx, bearsKy, vipers]]],
    // The order that cycled: the near club and the namesake pulled and tidied, the far club later.
    ["the near three, a tidy, then the Texas club", [[bearsKy, vipers, comets], [bearsTx]]],
    ["the Texas club, a tidy, then the rest", [[bearsTx], [bearsKy, vipers, comets]]],
    ["one at a time, a tidy after each", [[comets], [bearsTx], [bearsKy, vipers]]],
  ];

  orders.forEach(([label, pulls]) => {
    it(`settles ${label}`, () => {
      let state: GcImportState = { ageGroups: [], teams: [], games: [] };
      pulls.forEach((batch) => {
        state = importGcSchedules(batch, state).state;
        const tidy = tidyPool(state);
        expect(tidy.passes).toBeLessThanOrEqual(2);
        state = tidy.state;
      });
      expectOneGame(state, "gcF", "gcLTX", gcRowId("gcF", "f1"), gcRowId("gcLTX", "t1"));
      const namesake = clubIdOf(state, "gcLKY")!;
      expect(
        state.games.filter((g) => g.teamAId === namesake || g.teamBId === namesake)
      ).toHaveLength(1);
      expect(tidyChangedAnything(tidyPool(state))).toBe(false);
    });
  });
});

describe("the named club's own row backs a row filed onto it from far off only as the same game", () => {
  /** A game of the Texas club's own that morning, so the day's check leaves the row either way. */
  const morning = row("BEARSTX", "t0", "S-ELSE", "2026-09-13T10:00", [3, 3]);
  const elsewhere = standIn("S-ELSE", "Elsewhere");
  /** Where the Comets' row is after the step that takes rows off clubs far from their namer. */
  const facing = (theirs: ScoutGame | undefined, teams: ScoutTeam[] = []) => {
    const state = pool([cometsRow, morning, ...(theirs ? [theirs] : [])], [elsewhere, ...teams]);
    const after = resettleOffLevel(state).state;
    const moved = after.games.find((game) => game.id === cometsRow.id)!;
    return after.teams.find((team) => team.id === moved.teamBId)!;
  };
  const stays = (theirs: ScoutGame | undefined, teams: ScoutTeam[] = []) =>
    expect(facing(theirs, teams).id).toBe("BEARSTX");
  const goes = (theirs: ScoutGame | undefined, teams: ScoutTeam[] = []) => {
    const landed = facing(theirs, teams);
    expect([landed.name, landed.nameOnly]).toEqual(["Bears Black", true]);
  };

  it("against the club that filed it, at its start or within the hour", () => {
    stays(bearsRow);
    stays({ ...bearsRow, startTs: "2026-09-13T17:30:00.000Z" });
  });

  it("against a stand-in of that club's name within the hour, or any stand-in at its very start", () => {
    const named = standIn("S-COMETS", "Comets 10U Gold");
    stays({ ...bearsRow, teamBId: named.id, startTs: "2026-09-13T17:10:00.000Z" }, [named]);
    const other = standIn("S-DRAGONS", "Dragons");
    stays({ ...bearsRow, teamBId: other.id }, [other]);
    // Another name, off the very start, is another game as far as anything says.
    goes({ ...bearsRow, teamBId: other.id, startTs: "2026-09-13T17:00:00.000Z" }, [other]);
  });

  it("against a slot within the hour", () => {
    const tbd = slot("T-1", "TBD");
    stays({ ...bearsRow, teamBId: tbd.id, startTs: "2026-09-13T16:00:00.000Z" }, [tbd]);
  });

  it("dated a day off, at the same clock", () => {
    stays({ ...bearsRow, date: "2026-09-14", startTs: "2026-09-14T16:45:00.000Z" });
    goes({ ...bearsRow, date: "2026-09-15", startTs: "2026-09-15T16:30:00.000Z" });
  });

  it("never on a name alone, a result that does not mirror, or a start further off", () => {
    goes(undefined);
    goes({ ...bearsRow, teamAScore: 2, teamBScore: 8 });
    goes({ ...bearsRow, teamAScore: undefined, teamBScore: undefined });
    goes({ ...bearsRow, startTs: "2026-09-13T17:45:00.000Z" });
    goes({ ...bearsRow, startTs: undefined });
    // Against another pulled club, it is the Texas club's game with that club.
    goes({ ...bearsRow, teamBId: "VIPERS" });
  });

  it("never on a score either row only borrowed, nor on a row the user threw out", () => {
    goes({ ...bearsRow, scoreFromB: true });
    goes({ ...bearsRow, excluded: true });
    const state = pool([{ ...cometsRow, scoreFromB: true }, morning, bearsRow], [elsewhere]);
    const after = resettleOffLevel(state).state;
    expect(after.games.find((game) => game.id === cometsRow.id)?.teamBId).not.toBe("BEARSTX");
  });
});

describe("two clubs three levels apart that both list the game", () => {
  const ACES = club("ACES", "Aces", "KY", 9);
  const BEES = club("BEES", "Bees", "KY", 12);
  const acesRow = row("ACES", "a1", "BEES", START, [6, 4], 9);
  const beesRow = row("BEES", "b1", "ACES", START, [4, 6], 12);
  const levels = (games: ScoutGame[], teams: ScoutTeam[] = []): GcImportState => ({
    ageGroups: groups,
    teams: [ACES, BEES, ...teams],
    games,
  });

  it("are one game when each club's own row names the other", () => {
    const first = tidyPool(levels([acesRow, beesRow]));
    expectOneGame(first.state, "gcACES", "gcBEES", acesRow.id, beesRow.id);
    expect(tidyChangedAnything(tidyPool(first.state))).toBe(false);
  });

  it("are not joined on a slot or a stand-in at that distance, as the namesake join reads them", () => {
    // Three levels apart a pair the namesake join would read was false 11.9% of the time (88
    // pairs), so a row filed that far from its club's level stays off it unless the club's own row
    // names the club that filed it.
    const tbd = slot("T-1", "TBD");
    const named = standIn("S-ACES", "Aces");
    [tbd, named].forEach((against) => {
      const state = levels([acesRow, { ...beesRow, teamBId: against.id }], [against]);
      const after = resettleOffLevel(state).state;
      expect(after.games.find((game) => game.id === acesRow.id)?.teamBId).not.toBe("BEES");
    });
  });
});

/*
 * Small random pools of pulled clubs in Kentucky, Ohio, Indiana and Texas, which borders none of
 * them: stand-ins, TBD slots, and each club's own rows, often listed by the other club too at the
 * same start with the result mirrored, naming the first club, a stand-in of its very name or a
 * slot. Under rules 35, 38 of these 300 pools ran to the tidy's limit and 50 of their 971 games
 * both clubs list counted twice; with Texas left out of the states, none did. No club plays two
 * games at one start here, as none does.
 */
const mulberry = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const NAMES = ["Aces", "Bears", "Bears Black", "Comets", "Comets Gold", "Dragons", "Eagles"];
const FAR = ["KY", "OH", "IN", "TX"];
const DAYS = ["2026-09-12", "2026-09-13", "2026-09-14"];
const HOURS = ["13:00", "15:00", "17:00"];

type Fuzzed = { state: GcImportState; rows: string[]; pairs: [string, string][] };
const fuzzed = (seed: number, states: readonly string[]): Fuzzed => {
  const rand = mulberry(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const clubs: ScoutTeam[] = [];
  const count = 4 + Math.floor(rand() * 4);
  for (let n = 0; n < count; n += 1) clubs.push(club(`P${n}`, pick(NAMES), pick(states)));
  const others: ScoutTeam[] = [];
  const standInNamed = (name: string) => {
    const found = others.find((team) => team.nameOnly && team.name === name);
    if (found) return found.id;
    const made = standIn(`S${others.length}`, name);
    others.push(made);
    return made.id;
  };
  for (let n = 0; n < 2; n += 1) standInNamed(pick(NAMES));
  const standIns = others.slice();
  const slotAt = (day: string, hour: string) => {
    const made = slot(`T${others.length}`, rand() < 0.5 ? "TBD" : `TBD- ${day.slice(5)}, ${hour}`);
    others.push(made);
    return made.id;
  };
  const busy = new Set<string>();
  const games: ScoutGame[] = [];
  const pairs: [string, string][] = [];
  let made = 0;
  const own = (
    who: ScoutTeam,
    against: string,
    day: string,
    hour: string,
    score?: [number, number]
  ) => {
    made += 1;
    const game = row(who.id, `x${made}`, against, `${day}T${hour}`, score);
    games.push(game);
    busy.add(`${who.id}|${day}|${hour}`);
    return game.id;
  };
  clubs.forEach((team) => {
    const listed = 2 + Math.floor(rand() * 3);
    for (let n = 0; n < listed; n += 1) {
      const day = pick(DAYS);
      const hour = pick(HOURS);
      const score: [number, number] | undefined =
        rand() < 0.8 ? [Math.floor(rand() * 10), Math.floor(rand() * 10)] : undefined;
      const kind = rand();
      if (busy.has(`${team.id}|${day}|${hour}`)) continue;
      if (kind < 0.5) {
        const other = pick(clubs.filter((one) => one.id !== team.id));
        if (busy.has(`${other.id}|${day}|${hour}`)) continue;
        const mine = own(team, other.id, day, hour, score);
        if (rand() < 0.7) {
          const how = rand();
          const against =
            how < 0.4 ? team.id : how < 0.75 ? standInNamed(team.name) : slotAt(day, hour);
          const theirs = own(other, against, day, hour, score && [score[1], score[0]]);
          if (score) pairs.push([mine, theirs]);
        }
      } else if (kind < 0.8) own(team, pick(standIns).id, day, hour, score);
      else own(team, slotAt(day, hour), day, hour, score);
    }
  });
  return {
    state: { ageGroups: groups, teams: [...clubs, ...others], games },
    rows: games.map((game) => game.id),
    pairs,
  };
};

/** What the tidy does wrong across 300 such pools of `states`, and how many games both clubs list. */
const fuzzOver = (states: readonly string[]) => {
  const unsettled: number[] = [];
  const misplaced: string[] = [];
  const twice: string[] = [];
  let pairs = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const { state, rows, pairs: listed } = fuzzed(seed, states);
    const first = tidyPool(state);
    // Six passes is the tidy's limit, where a pool whose rules take turns with a row stops.
    if (first.passes >= 6 || tidyChangedAnything(tidyPool(first.state))) unsettled.push(seed);
    rows.forEach((rowId) => {
      if (holdersOf(first.state, rowId).length !== 1) misplaced.push(`${seed}:${rowId}`);
    });
    listed.forEach(([mine, theirs]) => {
      pairs += 1;
      const [a] = holdersOf(first.state, mine);
      const [b] = holdersOf(first.state, theirs);
      if (a && b && a !== b && countsTowardRating(a) && countsTowardRating(b)) {
        twice.push(`${seed}:${mine}`);
      }
    });
  }
  return { pairs, wrong: { unsettled, misplaced, twice } };
};
const NONE_WRONG = { unsettled: [], misplaced: [], twice: [] };

describe("small pools of clubs", () => {
  it("far apart reach a fixed point, keep every row once, and count each game both list once", () => {
    const { pairs, wrong } = fuzzOver(FAR);
    // The fuzz reaches the shape it is for: hundreds of games both clubs list.
    expect(pairs).toBeGreaterThan(300);
    expect(wrong).toEqual(NONE_WRONG);
  });

  it("of neighbouring states do so too, two squads of one name that tied each other included", () => {
    // Under rules 36 one of these pools lost three rows: two Ohio squads of one name tied 3-3, the
    // tie proved them one squad (`mergeSameSquadIds`), and their games together went as a club
    // playing itself (`sameSquadIds.test.ts`).
    expect(fuzzOver(["KY", "OH", "IN"]).wrong).toEqual(NONE_WRONG);
  });
});
