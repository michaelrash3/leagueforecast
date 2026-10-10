import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryIo } from "../cloud/cloudRunner";
import { AGE_LEVELS, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { localDayKey, markRefreshed, MIN_PULL_GAP_HOURS } from "../gameChangerSchedule";
import { refreshNow, storedRota } from "../storedRota";
import {
  initTeamRankingsStore,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveDroppedClubs,
  saveRefreshCadence,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
} from "../teamRankingsStorage";

/*
 * What "Refresh now" pulls (`refreshNow`): the refresh the nightly would run now, or, once today's
 * levels have been refreshed, those levels again, held to the gap that keeps a team pulled lately
 * from being asked again unless it is playing. The card's count and the cloud's list are this one
 * call. Placeholder names throughout.
 */

/** A Saturday afternoon in October 2026, in the season of 2027, read in this process's zone. */
const NOW = new Date(2026, 9, 10, 15, 0);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const today = localDayKey(NOW);

const GROUPS: AgeGroup[] = [
  { id: "ag_9u_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const link = (teamId: string, ageGroupId: string, importedAt: string) => ({
  teamId,
  name: `Placeholder ${teamId}`,
  ageGroupId,
  importedAt,
});
const TEAMS: ScoutTeam[] = [
  // Pulled two hours ago with nothing to play near today: held back on a second run.
  { id: "A", name: "Club A", gcTeams: [link("gcA", "ag_9u_2027", hoursAgo(2))] },
  // Pulled two hours ago, but playing today: never held.
  { id: "B", name: "Club B", gcTeams: [link("gcB", "ag_9u_2027", hoursAgo(2))] },
  // Pulled three days ago.
  { id: "C", name: "Club C", gcTeams: [link("gcC", "ag_10u_2027", hoursAgo(72))] },
  // Thrown out since it was pulled.
  { id: "D", name: "Club D", gcTeams: [link("gcD", "ag_10u_2027", hoursAgo(72))] },
];
const PLAYING: ScoutGame = {
  id: "gc_gcB_g1",
  ageGroupId: "ag_9u_2027",
  teamAId: "B",
  teamBId: "C",
  date: today,
  source: { kind: "gamechanger", teamId: "gcB", gameId: "g1" },
};

beforeEach(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(GROUPS);
  saveScoutTeams(TEAMS);
  saveScoutGames([PLAYING]);
  saveRefreshCadence("daily");
  saveDroppedClubs(new Set(["gcD"]));
});
afterEach(() => resetTeamRankingsStore());

describe("what Refresh now pulls", () => {
  it("is what the nightly would pull now, while today's levels are still to do", () => {
    const now = refreshNow(NOW);
    // The nightly's own list, Club A held back, but a club thrown out, which the pull would skip,
    // is not counted.
    expect(storedRota(NOW).teamIds.sort()).toEqual(["gcB", "gcC", "gcD"]);
    expect(now).toEqual({
      teamIds: ["gcB", "gcC"],
      ageLevels: AGE_LEVELS,
      heldBack: 1,
      again: false,
    });
  });

  it("is today's levels again once they are done, still holding back a team pulled lately unless it plays", () => {
    saveRefreshLog(markRefreshed({}, AGE_LEVELS, NOW));
    // The nightly would pull nothing more today.
    expect(storedRota(NOW)).toMatchObject({ ageLevels: [], teamIds: [] });
    const again = refreshNow(NOW);
    expect(again.again).toBe(true);
    expect(again.ageLevels).toEqual(AGE_LEVELS);
    // Club A was pulled within the gap and plays nothing near today, so it waits; Club B plays
    // today, so it is pulled again; Club C was pulled days ago.
    expect(again.teamIds.sort()).toEqual(["gcB", "gcC"]);
    expect(again.heldBack).toBe(1);
    expect(MIN_PULL_GAP_HOURS).toBeGreaterThan(2);
  });

  it("is nothing on a day with no levels of its own, done or not", () => {
    saveRefreshCadence("rotation");
    // A Friday: the rota's catch-up day, which brings no level of its own.
    const friday = new Date(2026, 9, 9, 15, 0);
    expect(refreshNow(friday)).toEqual({ teamIds: [], ageLevels: [], heldBack: 0, again: true });
  });

  it("works from the nightly's answer when handed it, rather than working it out twice", () => {
    const tonight = storedRota(NOW);
    expect(refreshNow(NOW, tonight)).toEqual(refreshNow(NOW));
    expect(refreshNow(NOW, { ...tonight, teamIds: ["gcZ"] }).teamIds).toEqual(["gcZ"]);
  });
});
