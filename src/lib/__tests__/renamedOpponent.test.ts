import { describe, expect, it } from "vitest";
import { createGcImporter, tidyPool, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { parseTeamRankingsCsv, teamRankingsCsvSections } from "../teamRankingsBackup";
import { decodeScoutGames, encodeScoutGames } from "../teamRankingsCompact";
import type { ScoutGame } from "../teamRankings";

/*
 * A coach who renames an opponent on GameChanger after the row was pulled: the next pull reads the
 * name again (`ScoutGame.typedAs`), the owner's case of 28 October 2026. A 9U club's own row was
 * typed with a one-word name and filed by it onto the one pulled club of it near the namer, whose
 * own schedule had no game that day; the coach later named the opponent in full, a club of a longer
 * name, and every pull after kept the row where the first name had put it. Invented clubs, in that
 * shape.
 */

type Played = GcTeamSchedule["games"][number];
const played = (
  id: string,
  opponentName: string,
  start: string,
  score: [number, number],
  extra: Partial<Played> = {}
): Played => ({
  id,
  date: start.slice(0, 10),
  opponentName,
  status: "completed",
  teamScore: score[0],
  opponentScore: score[1],
  startTs: `${start}:00.000Z`,
  ...extra,
});
const schedule = (
  id: string,
  name: string,
  state: string,
  games: Played[],
  avatarKey?: string
): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state,
    ...(avatarKey ? { avatarKey } : {}),
  },
  games,
  fetchedAt: "2026-10-26T12:00:00.000Z",
});

/** The namer's row of 24 October, typed as `typed`, beside a game of another day. */
const namer = (typed: string, extra: Partial<Played> = {}) =>
  schedule("GCNAMER00001", "Comets 9U Ortiz", "OH", [
    played("n0", "Bears 9U", "2026-10-16T21:30", [22, 8]),
    played("n1", typed, "2026-10-24T14:15", [17, 10], extra),
  ]);
/** The pulled club of the short name, in the next state, with no game on the 24th. */
const rams = schedule(
  "GCRAMS000001",
  "Rams",
  "KY",
  [played("r1", "Reds", "2026-10-17T15:00", [20, 3])],
  "picture-of-rams"
);
/** The club the coach meant, whose own schedule has the game. */
const wise = schedule("GCWISE000001", "Rams-Wise 9U", "KY", [
  played("w1", "Comets 9U Ortiz", "2026-10-24T14:15", [10, 17]),
]);

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
/** `schedules` pulled into `state` in order, then the pool tidied as a pull leaves it. */
const pull = (state: GcImportState, ...schedules: GcTeamSchedule[]) => {
  const importer = createGcImporter(state, { today: "2026-10-26" });
  const outcomes = schedules.map((each) => importer.add(each));
  return { state: tidyPool(importer.state).state, outcomes };
};
/** The game of the 24th as one line: the namer's side, the score, the side it is filed against. */
const the24th = (state: GcImportState): string[] => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const label = (id: string) => {
    const team = byId.get(id);
    return `${team?.name ?? id}${team?.gcTeams?.length ? "" : " (stand-in)"}`;
  };
  return state.games
    .filter((game) => game.date === "2026-10-24")
    .map(
      (game) =>
        `${label(game.teamAId)} ${game.teamAScore}-${game.teamBScore} ${label(game.teamBId)}`
    )
    .sort();
};

describe("a row whose opponent its coach renamed after the pull", () => {
  const first = pull(empty, rams, namer("Rams")).state;

  it("was filed by the first name onto the pulled club of it", () => {
    expect(the24th(first)).toEqual(["Comets Ortiz 17-10 Rams"]);
  });

  it("goes where the new name files it on the next pull, and stays there", () => {
    const renamed = pull(first, namer("Rams-Wise 9U"));
    expect(the24th(renamed.state)).toEqual(["Comets Ortiz 17-10 Rams-Wise (stand-in)"]);
    expect(renamed.outcomes[0]).toMatchObject({ gamesUpdated: 1 });
    // The game carries the name it is filed by now, so the next pull does not file it again.
    expect(renamed.state.games.find((game) => game.date === "2026-10-24")?.typedAs).toBe(
      "rams wise"
    );
    // Pulled again under the same name, nothing moves.
    const again = pull(renamed.state, namer("Rams-Wise 9U"));
    expect(the24th(again.state)).toEqual(["Comets Ortiz 17-10 Rams-Wise (stand-in)"]);
    expect(again.outcomes[0]).toMatchObject({ gamesUpdated: 0 });
    // And the club it meant, pulled, takes it.
    expect(the24th(pull(renamed.state, wise).state)).toEqual(["Comets Ortiz 17-10 Rams-Wise"]);
  });
});

describe("a renamed row and a new row of the new name in one pull", () => {
  it("go against one team of the name", () => {
    const first = pull(empty, rams, namer("Rams")).state;
    const both = schedule("GCNAMER00001", "Comets 9U Ortiz", "OH", [
      played("n0", "Bears 9U", "2026-10-16T21:30", [22, 8]),
      played("n1", "Rams-Wise 9U", "2026-10-24T14:15", [17, 10]),
      played("n2", "Rams-Wise 9U", "2026-10-25T14:15", [9, 2]),
    ]);
    const importer = createGcImporter(first, { today: "2026-10-26" });
    importer.add(both);
    const against = importer.state.games
      .filter((game) => game.id === "gc_GCNAMER00001_n1" || game.id === "gc_GCNAMER00001_n2")
      .map((game) => game.teamBId);
    expect(against).toHaveLength(2);
    expect(new Set(against).size).toBe(1);
  });
});

describe("a renamed opponent read again only where the name is all the row rests on", () => {
  const first = pull(empty, rams, namer("Rams")).state;

  it("reads the same name written otherwise as no rename", () => {
    const again = pull(first, namer("RAMS 9u"));
    expect(the24th(again.state)).toEqual(["Comets Ortiz 17-10 Rams"]);
    expect(again.outcomes[0]).toMatchObject({ gamesUpdated: 0 });
  });

  it("leaves a game the club's own schedule lists against the namer, and reads it once it does not", () => {
    const withRow = (...games: Played[]) =>
      schedule(
        "GCRAMS000001",
        "Rams",
        "KY",
        [played("r1", "Reds", "2026-10-17T15:00", [20, 3]), ...games],
        "picture-of-rams"
      );
    const theirs = played("r2", "Comets 9U Ortiz", "2026-10-24T14:15", [10, 17]);
    // The namer pulled first, so the game stands on its row with the Rams' own row held in it.
    const both = pull(empty, namer("Rams"), withRow(theirs)).state;
    expect(the24th(both)).toEqual(["Comets Ortiz 17-10 Rams"]);
    const renamed = pull(both, namer("Rams-Wise 9U")).state;
    expect(the24th(renamed)).toEqual(["Comets Ortiz 17-10 Rams"]);
    // The Rams drop the game, so the name is all the row rests on, and the rename is read.
    const dropped = pull(renamed, withRow()).state;
    expect(the24th(dropped)).toEqual(["Comets Ortiz 17-10 Rams"]);
    expect(the24th(pull(dropped, namer("Rams-Wise 9U")).state)).toEqual([
      "Comets Ortiz 17-10 Rams-Wise (stand-in)",
    ]);
  });

  it("leaves a game whose opponent's picture named the club", () => {
    const pictured = pull(
      empty,
      rams,
      namer("Rams", { opponentAvatarKey: "picture-of-rams" })
    ).state;
    expect(the24th(pictured)).toEqual(["Comets Ortiz 17-10 Rams"]);
    expect(the24th(pull(pictured, namer("Rams-Wise 9U")).state)).toEqual([
      "Comets Ortiz 17-10 Rams",
    ]);
  });

  it("only learns the name of a row filed before names were kept, and reads a rename after", () => {
    const untyped = {
      ...first,
      games: first.games.map(({ typedAs: _typed, ...game }) => game),
    };
    const learned = pull(untyped, namer("Rams-Wise 9U"));
    expect(the24th(learned.state)).toEqual(["Comets Ortiz 17-10 Rams"]);
    expect(learned.outcomes[0]).toMatchObject({ gamesUpdated: 0 });
    expect(the24th(pull(learned.state, namer("Rams Gold")).state)).toEqual([
      "Comets Ortiz 17-10 Rams Gold (stand-in)",
    ]);
  });
});

describe("a row held in another club's copy, renamed", () => {
  /*
   * The Comets' row against "Sharks", a name nobody pulled, claimed by the Bears' copy of a game
   * against the Comets at the same hour. Its coach renames the opponent while the row is held; the
   * claim keeps the name the row was filed by, so the row stood back up, once the Bears' schedule
   * drops its copy, is read for the rename at its next pull.
   */
  const comets = (typed: string) =>
    schedule("GCNAMER00001", "Comets 9U Ortiz", "OH", [
      played("n1", typed, "2026-10-24T18:00", [7, 3]),
    ]);
  const bears = (...games: Played[]) =>
    schedule("GCBEARS00001", "Bears 9U", "OH", [
      ...games,
      played("b9", "Cubs 9U", "2026-10-17T12:00", [5, 5]),
    ]);
  /** The Bears' copy, still to be scored, which the claim step reads by the clock alone. */
  const copy: Played = {
    id: "b1",
    date: "2026-10-24",
    opponentName: "Comets 9U Ortiz",
    status: "scheduled",
    startTs: "2026-10-24T18:45:00.000Z",
  };
  const claimed = pull(empty, comets("Sharks"), bears(copy)).state;

  it("is read for the rename once it stands on its own again", () => {
    expect(the24th(claimed)).toEqual(["Bears 3-7 Comets Ortiz"]);
    const renamedWhileHeld = pull(claimed, comets("Sharks Elite")).state;
    expect(the24th(renamedWhileHeld)).toEqual(["Bears 3-7 Comets Ortiz"]);
    const released = pull(renamedWhileHeld, bears()).state;
    expect(the24th(released)).toEqual(["Comets Ortiz 7-3 Sharks (stand-in)"]);
    expect(the24th(pull(released, comets("Sharks Elite")).state)).toEqual([
      "Comets Ortiz 7-3 Sharks Elite (stand-in)",
    ]);
  });
});

describe("the name a row typed, kept", () => {
  const game: ScoutGame = {
    id: "gc_gcA_a1",
    teamAId: "A",
    teamBId: "B",
    ageGroupId: "ag9",
    date: "2026-10-24",
    typedAs: "riverside hawks",
    alsoRows: [
      { teamId: "gcB", gameId: "b1", onSideB: true, typedAs: "it's (a) *team* ~ok! 100%" },
      { teamId: "gcC", gameId: "c1", typedAs: "x", filedAgainst: "S-X", filedLevel: 9 },
    ],
    source: { kind: "gamechanger", teamId: "gcA", gameId: "a1" },
  };

  it("in the stored pool, and stored with none where no game kept one", () => {
    expect(decodeScoutGames(encodeScoutGames([game]), () => [])).toEqual([game]);
    const { typedAs: _typed, alsoRows: _rows, ...plain } = game;
    expect(encodeScoutGames([plain]).n).toBeUndefined();
  });

  it("in the backup file", () => {
    const backup = {
      ageGroups: [{ id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }],
      teams: [
        { id: "A", name: "Aces" },
        { id: "B", name: "Bears" },
        { id: "S-X", name: "X", nameOnly: true as const },
      ],
      games: [game],
    };
    expect(parseTeamRankingsCsv(teamRankingsCsvSections(backup))).toEqual(backup);
  });
});
