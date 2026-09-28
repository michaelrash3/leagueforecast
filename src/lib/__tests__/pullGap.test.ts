import { describe, expect, it } from "vitest";
import { dueRefresh, idsPlayingAround, MIN_PULL_GAP_HOURS } from "../gameChangerSchedule";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A team pulled a few hours ago is not pulled again unless it is playing. Three whole-pool
 * refreshes ran within 42 hours on 25 and 26 September 2026; of the 53,140 ids two of them both
 * pulled, fifteen hours apart, the ones with a game within a day of the earlier pull were a third
 * of the pull and held three quarters of what had changed.
 */
const pages: AgeGroup[] = [{ id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }];
const now = new Date("2026-09-28T20:00:00");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const club = (teamId: string, importedAt?: string): ScoutTeam => ({
  id: `S-${teamId}`,
  name: teamId,
  gcTeams: [{ teamId, name: teamId, ageGroupId: "ag9", ...(importedAt ? { importedAt } : {}) }],
});
const teams = [
  club("QuietJustNow", hoursAgo(2)),
  club("PlayingToday", hoursAgo(2)),
  club("QuietLastDay", hoursAgo(20)),
  club("NeverPulled0"),
];

const game = (id: string, date: string, extra: Partial<ScoutGame> = {}): ScoutGame => ({
  id,
  ageGroupId: "ag9",
  teamAId: "S-A",
  teamBId: "S-B",
  date,
  ...extra,
});

describe("the teams playing within a day of today", () => {
  it("are those whose own schedules hold a game dated yesterday, today or tomorrow", () => {
    const playing = idsPlayingAround(
      [
        game("g1", "2026-09-28", {
          source: { kind: "gamechanger", teamId: "PlayingToday", gameId: "x1" },
        }),
        game("g2", "2026-09-27", {
          source: { kind: "gamechanger", teamId: "Yesterday001", gameId: "x2" },
        }),
        game("g3", "2026-09-29", { alsoFrom: ["Tomorrow0001"] }),
        // A folded row is read at its own day, not the copy's.
        game("g4", "2026-09-20", {
          alsoRows: [{ teamId: "FoldedToday1", gameId: "x4", date: "2026-09-28" }],
        }),
        game("g5", "2026-09-25", {
          source: { kind: "gamechanger", teamId: "LastFriday01", gameId: "x5" },
        }),
        game("g6", "2026-09-30", {
          source: { kind: "gamechanger", teamId: "TwoDaysOn001", gameId: "x6" },
        }),
      ] as ScoutGame[],
      "2026-09-28"
    );
    expect([...playing].sort()).toEqual([
      "FoldedToday1",
      "PlayingToday",
      "Tomorrow0001",
      "Yesterday001",
    ]);
  });
});

describe(`a refresh within ${MIN_PULL_GAP_HOURS} hours of the last`, () => {
  const due = (force: boolean) =>
    dueRefresh(now, {}, pages, teams, {
      cadence: "daily",
      seasonYear: 2027,
      force,
      playing: new Set(["PlayingToday"]),
    });

  it("holds back a team pulled since, unless it is playing", () => {
    expect(due(false)).toMatchObject({
      teamIds: ["PlayingToday", "QuietLastDay", "NeverPulled0"],
      heldBack: 1,
    });
  });

  it("holds it back when the whole day is run again as well", () => {
    expect(due(true)).toMatchObject({
      teamIds: ["PlayingToday", "QuietLastDay", "NeverPulled0"],
      heldBack: 1,
    });
  });

  it("holds nothing back when the caller has not said who is playing", () => {
    const all = dueRefresh(now, {}, pages, teams, { cadence: "daily", seasonYear: 2027 });
    expect(all).toMatchObject({ teamIds: teams.map((team) => team.name), heldBack: 0 });
  });
});
