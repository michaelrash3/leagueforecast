import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import { importGcSchedule, tidyPool, type GcImportState } from "../gameChangerImport";

/*
 * The Aces' own schedule has a 7-3 win over "Sharks" at six; the Bears' has a game against the
 * Aces at six too. Nobody plays two games at once, so where the two results agree within what two
 * scorekeepers disagree by, it is one game, and where they are far apart it is two: a Bears game
 * against some other "Aces", or a row somebody typed wrong. Whichever schedule was pulled first,
 * the pool has to read it the same way.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const SIX = "2026-09-19T18:00:00.000Z";
const schedule = (
  id: string,
  name: string,
  opponentName: string,
  teamScore: number,
  opponentScore: number
): GcTeamSchedule => ({
  profile: { id, name, ageLevel: 9, season: { season: "fall", year: 2026 }, state: "KY" },
  games: [
    {
      id: `${id}-1`,
      date: "2026-09-19",
      startTs: SIX,
      opponentName,
      status: "completed",
      teamScore,
      opponentScore,
    },
  ],
  fetchedAt: "2026-09-20T12:00:00.000Z",
});
const aces = schedule("gcACES000000", "Aces 9U", "Sharks", 7, 3);
const bears = (own: number, theirs: number) =>
  schedule("gcBEARS00000", "Bears 9U", "Aces", own, theirs);

/** The games of the day, tidied, after pulling the schedules in the order given. */
const gamesAfter = (schedules: GcTeamSchedule[]) =>
  tidyPool(schedules.reduce((state, next) => importGcSchedule(next, state).state, empty)).state
    .games.length;

describe("a club's row and another club's copy at the very same start", () => {
  it("are two games either way round when the results are far apart", () => {
    // The Bears lost 1-12 to "Aces"; the Aces' own row is 7-3. Seven runs apart.
    expect(gamesAfter([aces, bears(1, 12)])).toBe(2);
    expect(gamesAfter([bears(1, 12), aces])).toBe(2);
  });

  it("are one game either way round when two scorekeepers are a run apart", () => {
    expect(gamesAfter([aces, bears(3, 6)])).toBe(1);
    expect(gamesAfter([bears(3, 6), aces])).toBe(1);
  });
});
