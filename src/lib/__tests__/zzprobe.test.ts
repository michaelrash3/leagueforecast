import { describe, it, expect } from "vitest";
import {
  deriveLeagueScoutGames,
  buildTeamRankings,
  teamsInAgeGroup,
  type AgeGroup,
  type LeagueSeasonSnapshot,
} from "../teamRankings";

const log = (a: string, h: string) => ({
  awayRuns: a,
  awayHits: "0",
  awayK: "0",
  homeRuns: h,
  homeHits: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
});

const season = (dates: [string, string, string]): LeagueSeasonSnapshot => ({
  seasonId: "s1",
  teams: [
    { id: "L1", name: "Lions" },
    { id: "L2", name: "Tigers" },
    { id: "L3", name: "Bears" },
  ],
  matchups: [
    { id: "m1", date: dates[0], away: "L1", home: "L2" },
    { id: "m2", date: dates[1], away: "L1", home: "L3" },
    { id: "m3", date: dates[2], away: "L3", home: "L2" },
  ],
  logs: {
    m1: log("8", "2"),
    m2: log("5", "4"),
    m3: log("9", "1"),
  },
});

const groups: AgeGroup[] = [
  { id: "g9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["s1"] },
];

describe("probe", () => {
  it("M/D dates", () => {
    const d = deriveLeagueScoutGames("g9", [season(["4/12", "4/19", "5/3"])], []);
    console.log("MD games:", JSON.stringify(d.games));
    const rows = buildTeamRankings("g9", d.teams, d.games, undefined, groups);
    console.log("MD rows:", JSON.stringify(rows.map((r) => [r.teamName, r.record, r.rating])));
    console.log("MD teamsInAgeGroup:", JSON.stringify(teamsInAgeGroup("g9", d.teams, d.games).map((t) => t.name)));
    expect(true).toBe(true);
  });

  it("ISO dates", () => {
    const d = deriveLeagueScoutGames("g9", [season(["2027-04-12", "2027-04-19", "2027-05-03"])], []);
    const rows = buildTeamRankings("g9", d.teams, d.games, undefined, groups);
    console.log("ISO rows:", JSON.stringify(rows.map((r) => [r.teamName, r.record, r.rating])));
    expect(true).toBe(true);
  });

  it("no date", () => {
    const d = deriveLeagueScoutGames("g9", [season(["", "", ""])], []);
    const rows = buildTeamRankings("g9", d.teams, d.games, undefined, groups);
    console.log("EMPTY rows:", JSON.stringify(rows.map((r) => [r.teamName, r.record, r.rating])));
    expect(true).toBe(true);
  });
});
