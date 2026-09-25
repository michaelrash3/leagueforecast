import { describe, expect, it } from "vitest";
import {
  coerceDeletedGames,
  deletedGamesList,
  forgetGames,
  isDatedAhead,
  isDeletedGame,
  restoreGames,
  rowsOfGames,
  scoringRowsOf,
} from "../deletedGames";
import {
  createGcImporter,
  importGcSchedule,
  importGcSchedules,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

/** A club whose schedule carries a score on a day that has not happened. */
const schedule = (games: GcTeamSchedule["games"]): GcTeamSchedule => ({
  profile: {
    id: "WpYo8bR3Smwp",
    name: "CF Nitros Black 11U",
    ageLevel: 11,
    season: { season: "winter", year: 2026 },
    state: "FL",
    city: "Orlando",
  },
  games,
  fetchedAt: "2026-09-20T03:35:17.077Z",
});

const ahead = {
  id: "c3e665f9-e35",
  date: "2027-07-31",
  startTs: "2027-07-31T18:30:00.000Z",
  opponentName: "Texas Twelve Gold Katy",
  status: "completed" as const,
  teamScore: 11,
  opponentScore: 0,
};

const behind = {
  id: "0c0ed81a-a80",
  date: "2026-08-30",
  opponentName: "Fury Baseball - Wright",
  status: "completed" as const,
  teamScore: 9,
  opponentScore: 0,
};

describe("a game scored on a day that has not happened", () => {
  it("is recognised by its date and its score together", () => {
    // You cannot score a game early. A schedule opened ahead of time comes back without a score.
    expect(isDatedAhead({ date: "2027-07-31", teamAScore: 11, teamBScore: 0 }, "2026-09-20")).toBe(
      true
    );
    // Scheduled, no score: ordinary, and not this.
    expect(isDatedAhead({ date: "2027-07-31" }, "2026-09-20")).toBe(false);
    // Played, in the past: ordinary.
    expect(isDatedAhead({ date: "2026-08-30", teamAScore: 9, teamBScore: 0 }, "2026-09-20")).toBe(
      false
    );
    // Today is not ahead of today.
    expect(isDatedAhead({ date: "2026-09-20", teamAScore: 9, teamBScore: 0 }, "2026-09-20")).toBe(
      false
    );
    // No date at all cannot be ahead of anything.
    expect(isDatedAhead({ teamAScore: 9, teamBScore: 0 }, "2026-09-20")).toBe(false);
  });
});

describe("the list of rows thrown out", () => {
  it("takes what was stored and drops what was not an id", () => {
    const deleted = coerceDeletedGames(["gc_a_1", 42, "", null, "gc_b_2", "gc_a_1"]);

    expect(deletedGamesList(deleted)).toEqual(["gc_a_1", "gc_b_2"]);
  });

  it("answers empty for anything that is not a list", () => {
    expect(coerceDeletedGames(null).size).toBe(0);
    expect(coerceDeletedGames({ a: 1 }).size).toBe(0);
  });

  it("remembers a row and then lets it back", () => {
    const one = forgetGames(new Set<string>(), ["gc_a_1"]);

    expect(isDeletedGame(one, "gc_a_1")).toBe(true);
    expect(isDeletedGame(restoreGames(one, ["gc_a_1"]), "gc_a_1")).toBe(false);
  });
});

describe("a pull of a schedule holding a row that was thrown out", () => {
  it("files the row the first time", () => {
    const { state } = importGcSchedules([schedule([ahead, behind])], empty);

    expect(state.games.map((game) => game.date).sort()).toEqual(["2026-08-30", "2027-07-31"]);
  });

  it("does not file it again once it has been deleted", () => {
    /*
     * A deletion that is not remembered is a deletion until the next pull. The rows worth
     * deleting are exactly the ones a schedule keeps offering, so the tombstone is the feature.
     */
    const deleted = forgetGames(new Set<string>(), ["gc_WpYo8bR3Smwp_c3e665f9-e35"]);

    const { state } = importGcSchedules([schedule([ahead, behind])], empty, { deleted });

    expect(state.games.map((game) => game.date)).toEqual(["2026-08-30"]);
  });

  it("leaves the rest of the schedule alone", () => {
    const deleted = forgetGames(new Set<string>(), ["gc_WpYo8bR3Smwp_c3e665f9-e35"]);
    const { state, outcomes } = importGcSchedules([schedule([ahead, behind])], empty, { deleted });

    expect(state.games).toHaveLength(1);
    expect(outcomes[0]?.gamesAdded).toBe(1);
  });

  it("holds the same line when the pull comes through the importer", () => {
    // The batch path a real pull uses, which threads its own state from schedule to schedule.
    const deleted = forgetGames(new Set<string>(), ["gc_WpYo8bR3Smwp_c3e665f9-e35"]);
    const importer = createGcImporter(empty, { deleted });
    importer.add(schedule([ahead, behind]));

    expect(importer.state.games.map((game) => game.date)).toEqual(["2026-08-30"]);
  });
});

describe("a game that took over a row entered again", () => {
  /*
   * The club deleted the row its game stood on and entered the game again; the game now stands on
   * the new row under the old row's id. Thrown out, it is remembered by both, or the next pull finds
   * the new row by its own id and files it again.
   */
  it("is remembered by the row it stands on as well as its id", () => {
    const nitros = (games: GcTeamSchedule["games"]) => schedule(games);
    const game = (id: string, startTs?: string, score?: [number, number]) => ({
      id,
      date: "2026-08-30",
      ...(startTs ? { startTs } : {}),
      opponentName: "Texas Twelve Gold Katy",
      status: score ? ("completed" as const) : ("scheduled" as const),
      ...(score ? { teamScore: score[0], opponentScore: score[1] } : {}),
    });
    const pull = (state: GcImportState, games: GcTeamSchedule["games"]) =>
      tidyPool(importGcSchedule(nitros(games), state).state).state;
    let state = pull(empty, [game("r1", "2026-08-30T18:30:00.000Z")]);
    state = pull(state, [game("r2", "2026-08-30T18:30:00.000Z")]);
    state = pull(state, [game("r2", undefined, [11, 0])]);
    const [held] = state.games;
    expect(held!.id).toBe("gc_WpYo8bR3Smwp_r1");
    expect(held!.source?.gameId).toBe("r2");

    const rows = rowsOfGames(state.games, [held!.id]);
    expect(rows.sort()).toEqual(["gc_WpYo8bR3Smwp_r1", "gc_WpYo8bR3Smwp_r2"]);
    const deleted = forgetGames(new Set<string>(), rows);
    const again = importGcSchedule(nitros([game("r2", undefined, [11, 0])]), empty, {
      deleted,
    }).state;
    expect(again.games).toEqual([]);
  });
});

describe("a game whose score dated ahead came from the other club's copy", () => {
  /*
   * The Nitros list a July fixture with no score; Katy's schedule lists the same game already won
   * 11-0, the only copy with a score. Thrown out, it is Katy's row that is remembered: the Nitros'
   * fixture comes back on their next pull as the game still to play it is, and Katy's score does
   * not come back on theirs.
   */
  const katy = (games: GcTeamSchedule["games"]): GcTeamSchedule => ({
    profile: {
      id: "KatyGold0001",
      name: "Texas Twelve Gold Katy",
      ageLevel: 11,
      season: { season: "winter", year: 2026 },
      state: "TX",
      city: "Katy",
    },
    games,
    fetchedAt: "2026-09-20T03:35:17.077Z",
  });
  const fixture = {
    ...ahead,
    id: "n1",
    status: "scheduled" as const,
  } as GcTeamSchedule["games"][number];
  delete fixture.teamScore;
  delete fixture.opponentScore;
  const scored = {
    ...ahead,
    id: "k1",
    opponentName: "CF Nitros Black 11U",
    teamScore: 0,
    opponentScore: 11,
  };
  // A game already played beside it, or the whole schedule reads as invented and is refused.
  const played = { ...behind, id: "k0", opponentName: "Somebody Else 11U" };
  const pull = (state: GcImportState, next: GcTeamSchedule, deleted?: Set<string>) =>
    tidyPool(importGcSchedule(next, state, deleted ? { deleted } : {}).state).state;

  it("remembers the row that carried the score, not the fixture beside it", () => {
    let state = pull(empty, schedule([fixture]));
    state = pull(state, katy([scored, played]));
    const game = state.games.find((entry) => entry.date === ahead.date)!;
    expect(isDatedAhead(game, "2026-09-20")).toBe(true);
    expect(game.scoreFromB).toBe(true);
    const rows = scoringRowsOf(state.games, [game.id]);
    expect(rows).toEqual(["gc_KatyGold0001_k1"]);

    const deleted = forgetGames(new Set<string>(), rows);
    state = { ...state, games: state.games.filter((entry) => entry.id !== game.id) };
    state = pull(state, katy([scored, played]), deleted);
    state = pull(state, schedule([fixture]), deleted);
    const back = state.games.filter((entry) => entry.date === ahead.date);
    expect(back).toHaveLength(1);
    expect(back[0]!.id).toBe("gc_WpYo8bR3Smwp_n1");
    expect(back[0]!.teamAScore).toBeUndefined();
  });

  // Joined before rows were kept: the other club's copy is on record by its schedule alone.
  it("remembers the row the game stands on where the scoring row is not on record", () => {
    const game = {
      id: "gc_WpYo8bR3Smwp_n1",
      teamAScore: 11,
      teamBScore: 0,
      scoreFromB: true as const,
      source: { kind: "gamechanger" as const, teamId: "WpYo8bR3Smwp", gameId: "n1" },
    };
    expect(scoringRowsOf([game], [game.id])).toEqual(["gc_WpYo8bR3Smwp_n1"]);
  });

  it("remembers the row the game stands on when the score is that row's own", () => {
    let state = pull(empty, schedule([ahead, behind]));
    const game = state.games.find((entry) => entry.date === ahead.date)!;
    expect(scoringRowsOf(state.games, [game.id])).toEqual(["gc_WpYo8bR3Smwp_c3e665f9-e35"]);
    state = pull(
      state,
      katy([{ ...fixture, id: "k1", opponentName: "CF Nitros Black 11U" }, played])
    );
    const held = state.games.find((entry) => entry.date === ahead.date)!;
    // The other club's plain fixture is not remembered: it is a game still to play.
    expect(scoringRowsOf(state.games, [held.id])).toEqual(["gc_WpYo8bR3Smwp_c3e665f9-e35"]);
  });
});

/**
 * A date with no year in it cannot answer "has this day been and gone" in either direction, and
 * the comparison here is a plain string one — exact for two ISO days and nonsense for anything
 * else. A pulled row carries an ISO day; a row mirrored in from League Standings carries the
 * league's own "M/D", and `"4/12" > "2026-09-20"` is true for no better reason than that "4"
 * sorts after "2".
 */
describe("a date this cannot read", () => {
  const scored = (date: string) => ({ date, teamAScore: 7, teamBScore: 3 });
  const TODAY = "2026-09-20";

  it("reads two ISO days exactly", () => {
    expect(isDatedAhead(scored("2027-06-01"), TODAY)).toBe(true);
    expect(isDatedAhead(scored("2026-09-12"), TODAY)).toBe(false);
    // A game dated exactly today is not ahead of anything.
    expect(isDatedAhead(scored(TODAY), TODAY)).toBe(false);
  });

  it("says no to a league fixture's M/D rather than sorting it as text", () => {
    /*
     * Every one of these was answered by where its first digit sorted against "2": April through
     * September were offered up in Pool Health as games played on a day still to come, and the
     * Delete button next to them would have taken real league fixtures out of the pool, while
     * December and January slipped past. None of them can be placed without a year.
     */
    ["4/12", "5/1", "9/30", "12/20", "1/3"].forEach((date) => {
      expect(isDatedAhead(scored(date), TODAY)).toBe(false);
    });
  });

  it("says no when today is not an ISO day either", () => {
    expect(isDatedAhead(scored("2027-06-01"), "9/20")).toBe(false);
  });
});
