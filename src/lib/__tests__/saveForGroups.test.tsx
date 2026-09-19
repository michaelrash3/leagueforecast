import { beforeEach, describe, expect, it } from "vitest";
import type { AgeGroup, ScoutGame } from "../teamRankings";
import {
  loadScoutGames,
  loadScoutGamesForYear,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutGamesForGroups,
} from "../teamRankingsStorage";

/**
 * Saving part of the pool on purpose.
 *
 * A pull of a nationwide pool cannot hold all of it. Measured at forty thousand teams and two
 * hundred thousand games, the fold's index is 253 MB on top of 79 MB of pool — which is what runs
 * a tab out of memory — and scoped to one age group of six it is 83 MB on top of 16 MB. So a run
 * holds one section's pages, and this is the save that lets it: the section's own pages replaced
 * outright, every other page of the same year untouched.
 *
 * The year is the unit of storage, so a page-scoped save has to reach inside one and put back what
 * it did not own. That is the whole risk here, and it is what these are about.
 */
const group = (id: string, year: number): AgeGroup => ({
  id,
  name: id,
  ageLevel: 10,
  year,
  seasonIds: [],
});

const GROUPS = [
  group("10u_2027", 2027),
  group("11u_2027", 2027),
  group("12u_2027", 2027),
  group("10u_2028", 2028),
];

const game = (id: string, ageGroupId: string): ScoutGame => ({
  id,
  teamAId: "A",
  teamBId: "B",
  ageGroupId,
  teamAScore: 6,
  teamBScore: 2,
  date: ageGroupId.endsWith("2028") ? "2027-09-10" : "2026-09-10",
});

const seed = () => {
  saveAgeGroups(GROUPS);
  saveScoutGames([
    game("a", "10u_2027"),
    game("b", "10u_2027"),
    game("c", "11u_2027"),
    game("d", "12u_2027"),
    game("e", "10u_2028"),
  ]);
};

const ids = (games: ScoutGame[]) => games.map((entry) => entry.id).sort();

describe("saving one section of the pool", () => {
  beforeEach(() => {
    resetTeamRankingsStore();
    window.localStorage.clear();
    seed();
  });

  it("replaces the pages it owns and leaves the rest of the year standing", () => {
    // The 10U section pulled again: one game gone, one kept, one new.
    expect(
      saveScoutGamesForGroups(["10u_2027"], [game("b", "10u_2027"), game("f", "10u_2027")])
    ).toBe(true);

    expect(ids(loadScoutGamesForYear(2027))).toEqual(["b", "c", "d", "f"]);
    // And the other year was never in the conversation.
    expect(ids(loadScoutGamesForYear(2028))).toEqual(["e"]);
  });

  it("empties a page it owns when the section came back with nothing for it", () => {
    expect(saveScoutGamesForGroups(["11u_2027"], [])).toBe(true);

    expect(ids(loadScoutGames())).toEqual(["a", "b", "d", "e"]);
  });

  it("owns several pages at once, across more than one year", () => {
    saveScoutGamesForGroups(
      ["10u_2027", "10u_2028"],
      [game("f", "10u_2027"), game("g", "10u_2028")]
    );

    expect(ids(loadScoutGames())).toEqual(["c", "d", "f", "g"]);
  });

  it("files a game the fold moved to a page it does not own, rather than dropping it", () => {
    /*
     * A fold can refile a game — a 10U schedule turning out to hold an 11U tournament result —
     * and a refiled game has to arrive somewhere. It is laid over the year it now belongs to,
     * never written as part of a page this caller was not authoritative for.
     */
    saveScoutGamesForGroups(["10u_2027"], [game("a", "10u_2027"), game("moved", "12u_2027")]);

    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a", "c", "d", "moved"]);
  });

  it("leaves a game on a page it does not own exactly where it was", () => {
    // Handed a stale copy of somebody else's page, it must not be written back over the real one.
    saveScoutGamesForGroups(["10u_2027"], [game("a", "10u_2027")]);

    expect(ids(loadScoutGamesForYear(2027))).toEqual(["a", "c", "d"]);
  });

  it("does nothing at all when it owns nothing", () => {
    expect(saveScoutGamesForGroups([], [game("f", "10u_2027")])).toBe(true);

    expect(ids(loadScoutGames())).toEqual(["a", "b", "c", "d", "e"]);
  });
});
