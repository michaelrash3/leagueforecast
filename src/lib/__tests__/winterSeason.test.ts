import { describe, expect, it } from "vitest";
import {
  normalizeGcTeamProfile,
  squadYearOfGcTeam,
  squadYearsForGcSeason,
  type GcSeason,
  type GcTeamSchedule,
} from "../gameChangerApi";
import { importGcSchedule, pairSettledSquads, type GcImportState } from "../gameChangerImport";
import type { ScoutTeam } from "../teamRankings";

/*
 * A winter runs over New Year, and GameChanger's label for one is either year it straddles:
 * "Winter 2026" and "Winter 2027" both name the winter that starts in November 2026. Read off the
 * label alone, "Winter 2027" was squad year 2028, so a squad playing this coming winter was skipped
 * by a pull of this season, and filed anyway, every game it played was dropped as dated before its
 * season began. Found by running the app at dates past 28 September 2026.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const winter = (year: number): GcSeason => ({ season: "winter", year });

const winterSquad = (year: number, dates = ["2026-12-12", "2027-01-16"]): GcTeamSchedule => ({
  profile: {
    id: "gcWINTER0001",
    name: "Tampa Heat 11U",
    ageLevel: 11,
    city: "Tampa",
    state: "FL",
    season: winter(year),
  },
  games: dates.map((date, at) => ({
    id: `w${at}`,
    date,
    opponentName: `Orlando Storm ${at} 11U`,
    status: "completed",
    teamScore: 6,
    opponentScore: 2,
  })),
  fetchedAt: "2027-01-20T12:00:00.000Z",
});

describe("the squad year of a winter team", () => {
  it("could be either year its label straddles; any other season is one", () => {
    expect(squadYearsForGcSeason(winter(2027))).toEqual([2027, 2028]);
    expect(squadYearsForGcSeason({ season: "fall", year: 2026 })).toEqual([2027]);
    expect(squadYearsForGcSeason({ season: "spring", year: 2027 })).toEqual([2027]);
  });

  it("is the year its games are dated in, whichever year the label names", () => {
    const games = [{ date: "2026-12-12" }, { date: "2027-01-16" }];
    expect(squadYearOfGcTeam(winter(2026), games, "2026-09-28")).toBe(2027);
    expect(squadYearOfGcTeam(winter(2027), games, "2026-09-28")).toBe(2027);
    // The winter a year on, labelled by the year it starts.
    const next = [{ date: "2027-11-20" }, { date: "2028-01-08" }];
    expect(squadYearOfGcTeam(winter(2027), next, "2026-09-28")).toBe(2028);
  });

  it("with no games, is the year being played if the label can mean it, else the year after", () => {
    expect(squadYearOfGcTeam(winter(2027), [], "2027-01-20")).toBe(2027);
    expect(squadYearOfGcTeam(winter(2027), [], "2027-10-01")).toBe(2028);
    expect(squadYearOfGcTeam(winter(2025), [], "2027-01-20")).toBe(2026);
  });

  it("leaves every other season to its label, whatever its games say", () => {
    expect(squadYearOfGcTeam({ season: "fall", year: 2026 }, [{ date: "2027-03-01" }], "x")).toBe(
      2027
    );
  });
});

describe("a winter team labelled with the year its winter ends", () => {
  it("is pulled by a pull of the season being played, onto its page, with every game", () => {
    for (const year of [2026, 2027]) {
      const { state, outcome } = importGcSchedule(winterSquad(year), empty, {
        seasonYears: new Set([2027]),
        today: "2027-01-20",
      });
      expect({
        skip: outcome.skip,
        page: outcome.ageGroupName,
        filed: state.games.length,
        outOfSeason: outcome.gamesOutOfSeason,
      }).toEqual({ skip: undefined, page: "11U 2027", filed: 2, outOfSeason: 0 });
    }
  });

  it("is next season's where its games are next winter's", () => {
    const { outcome } = importGcSchedule(winterSquad(2027, ["2027-11-20", "2028-01-08"]), empty, {
      seasonYears: new Set([2027]),
      today: "2027-01-20",
    });
    expect(outcome.skip).toBe("other-season");
  });
});

describe("a winter team aged by its class year", () => {
  // Class of 2034: 11U in the 2027 squad year, 12U in 2028. Read through GameChanger's own profile.
  const classOf2034 = (year: number, dates: string[]): GcTeamSchedule => ({
    ...winterSquad(year, dates),
    profile: normalizeGcTeamProfile({
      id: "gcWINTER0002",
      name: "Tampa Heat",
      age_group: "2034",
      team_season: { season: "winter", year },
    })!,
  });
  const filed = (schedule: GcTeamSchedule, seasonYear: number, today: string) => {
    const { state, outcome } = importGcSchedule(schedule, empty, {
      seasonYears: new Set([seasonYear]),
      today,
    });
    const link = state.teams[0]?.gcTeams?.[0];
    return { page: outcome.ageGroupName, level: link?.ageLevel, from: link?.ageFrom };
  };

  it("is read in the year it plays in, not the year after its label", () => {
    expect(filed(classOf2034(2027, ["2026-12-12", "2027-01-16"]), 2027, "2027-01-20")).toEqual({
      page: "11U 2027",
      level: 11,
      from: "gamechanger",
    });
  });

  it("is read a year on where its games are next winter's, and as always where the label says", () => {
    expect(filed(classOf2034(2027, ["2027-11-20", "2028-01-08"]), 2028, "2027-12-01")).toEqual({
      page: "12U 2028",
      level: 12,
      from: "gamechanger",
    });
    expect(filed(classOf2034(2026, ["2026-12-12", "2027-01-16"]), 2027, "2027-01-20")).toEqual({
      page: "11U 2027",
      level: 11,
      from: "gamechanger",
    });
  });
});

describe("pairing one squad's Fall 2026, Winter 2027 and Spring 2027", () => {
  const squad = (
    id: string,
    season: "fall" | "winter" | "spring",
    seasonYear: number
  ): ScoutTeam => ({
    id,
    name: "Rillo Dillos",
    city: "Rillo",
    state: "TX",
    gcTeams: [
      {
        teamId: `gc-${id}`,
        name: "Rillo Dillos 9U",
        ageGroupId: "ag1",
        ageLevel: 9,
        season,
        seasonYear,
      },
    ],
  });
  const pool = (teams: ScoutTeam[]): GcImportState => ({
    ageGroups: [{ id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }],
    teams,
    games: [],
  });

  it("makes one club of the three, reading the winter on the page it was filed on", () => {
    for (const winterYear of [2026, 2027]) {
      const out = pairSettledSquads(
        pool([
          squad("f", "fall", 2026),
          squad("w", "winter", winterYear),
          squad("s", "spring", 2027),
        ])
      );
      expect(out.state.teams).toHaveLength(1);
      expect(out.state.teams[0]!.gcTeams?.map((link) => link.teamId).sort()).toEqual([
        "gc-f",
        "gc-s",
        "gc-w",
      ]);
    }
  });
});
