import { describe, expect, it } from "vitest";
import {
  coerceDeletedGames,
  deletedGamesList,
  forgetGames,
  isDatedAhead,
  isDeletedGame,
  restoreGames,
} from "../deletedGames";
import { createGcImporter, importGcSchedules, type GcImportState } from "../gameChangerImport";
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

    const { state } = importGcSchedules([schedule([ahead, behind])], empty, deleted);

    expect(state.games.map((game) => game.date)).toEqual(["2026-08-30"]);
  });

  it("leaves the rest of the schedule alone", () => {
    const deleted = forgetGames(new Set<string>(), ["gc_WpYo8bR3Smwp_c3e665f9-e35"]);
    const { state, outcomes } = importGcSchedules([schedule([ahead, behind])], empty, deleted);

    expect(state.games).toHaveLength(1);
    expect(outcomes[0]?.gamesAdded).toBe(1);
  });

  it("holds the same line when the pull comes through the importer", () => {
    // The batch path a real pull uses, which threads its own state from schedule to schedule.
    const deleted = forgetGames(new Set<string>(), ["gc_WpYo8bR3Smwp_c3e665f9-e35"]);
    const importer = createGcImporter(empty, deleted);
    importer.add(schedule([ahead, behind]));

    expect(importer.state.games.map((game) => game.date)).toEqual(["2026-08-30"]);
  });
});
