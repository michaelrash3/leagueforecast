import { describe, expect, it } from "vitest";
import { parseDateValue, seasonStartMonth } from "../date";
import { backtestPredictions } from "../backtest";
import { buildPredictionEngine } from "../predictionEngine";
import { buildSeasonTimeline } from "../seasonTimeline";
import { calculateTeams } from "../sim";
import { buildTeamTrendSummary } from "../teamTrend";
import { buildTrendStates } from "../trend";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

/*
 * League Standings dates are "M/D" with no year. They were ordered inside one calendar year, so a
 * season played over New Year put its January first: the next game, the form, the timeline, the
 * backtest and the simulation's own walk through the results all read January as the start.
 */
describe("the month a season's year turns in", () => {
  it("is the one after the longest run of months with no game", () => {
    expect(seasonStartMonth(["11/14", "12/12", "1/9"])).toBe(11);
    // A summer league running into August starts in its June, not its August.
    expect(seasonStartMonth(["6/5", "7/10", "8/7"])).toBe(6);
    expect(seasonStartMonth(["3/7", "4/11", "5/30", "8/1"])).toBe(3);
  });

  it("is a season's own first month inside one calendar year", () => {
    expect(seasonStartMonth(["3/7", "4/11", "5/30"])).toBe(3);
    expect(seasonStartMonth(["9/6", "10/4"])).toBe(9);
    expect(seasonStartMonth(["5/1"])).toBe(5);
  });

  it("keeps the calendar where nothing says otherwise", () => {
    expect(seasonStartMonth([])).toBe(1);
    expect(seasonStartMonth(["", undefined, "TBD"])).toBe(1);
    expect(seasonStartMonth(Array.from({ length: 12 }, (_, month) => `${month + 1}/1`))).toBe(1);
    // Two equal runs: nothing says which ends the year.
    expect(seasonStartMonth(["1/10", "7/10"])).toBe(1);
  });

  it("reads ISO days and written-out months as the dates they are", () => {
    expect(seasonStartMonth(["2026-11-14", "Dec 12", "2027-01-09"])).toBe(11);
  });
});

describe("a date's place in its season", () => {
  it("puts January after December in a season that turns in November", () => {
    expect(parseDateValue("1/9", 11)).toBeGreaterThan(parseDateValue("12/12", 11));
    expect(parseDateValue("12/12", 11)).toBeGreaterThan(parseDateValue("11/14", 11));
    expect(parseDateValue("", 11)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is the value it always was for a season inside one calendar year", () => {
    const dates = ["3/7", "4/11", "5/30", "6/2"];
    const start = seasonStartMonth(dates);
    dates.forEach((date) => expect(parseDateValue(date, start)).toBe(parseDateValue(date)));
  });
});

/*
 * The same league played twice: once from November into January, and once two months earlier, all
 * inside one year. Ordered by the season, every result and forecast built from the order is the
 * same for both; ordered by the calendar, the first season's January came first.
 */
describe("a season over New Year reads as the same season inside one year", () => {
  const teams: TeamBase[] = [
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
    { id: "C", name: "Comets" },
    { id: "D", name: "Dukes" },
  ];
  const fixtures: Array<[string, string, string, number, number]> = [
    ["A", "B", "11/7", 9, 2],
    ["C", "D", "11/14", 4, 3],
    ["A", "C", "11/21", 3, 6],
    ["B", "D", "12/5", 7, 7],
    ["D", "A", "12/12", 2, 8],
    ["B", "C", "1/9", 10, 1],
    ["C", "A", "1/16", 5, 4],
    ["D", "B", "1/23", 0, 6],
  ];
  const twoMonthsEarlier = (date: string) => {
    const [month, day] = date.split("/").map(Number);
    return `${((month! + 9) % 12) + 1}/${day}`;
  };
  const season = (shift: (date: string) => string) => {
    const matchups: Matchup[] = fixtures.map(([away, home, date], index) => ({
      id: `g${index + 1}`,
      date: shift(date),
      away,
      home,
    }));
    const logs: Record<string, GameLog> = Object.fromEntries(
      fixtures.map(([, , , awayRuns, homeRuns], index) => [
        `g${index + 1}`,
        {
          awayRuns: String(awayRuns),
          homeRuns: String(homeRuns),
          awayHits: "",
          homeHits: "",
          awayK: "",
          homeK: "",
          innings: "6",
          isFinal: true,
        },
      ])
    );
    return { matchups, logs };
  };
  const overNewYear = season((date) => date);
  const insideOneYear = season(twoMonthsEarlier);
  const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2 };

  it("the shifted season is November to January, and the other September to November", () => {
    expect(twoMonthsEarlier("1/9")).toBe("11/9");
    expect(twoMonthsEarlier("11/7")).toBe("9/7");
  });

  it("walks the results in the season's order, which weighs the latest the most", () => {
    // `calculateTeams` walks the finals oldest first, and a team's last six set its momentum.
    const teamsAfter = (played: ReturnType<typeof season>) =>
      calculateTeams(teams, played.matchups, played.logs, settings);
    expect(teamsAfter(overNewYear)).toEqual(teamsAfter(insideOneYear));
  });

  it("draws a team's form in the season's order", () => {
    const form = (played: ReturnType<typeof season>) =>
      buildTeamTrendSummary("A", played.matchups, played.logs, true).games.map((game) => game.id);
    expect(form(overNewYear)).toEqual(["g1", "g3", "g5", "g7"]);
    expect(form(insideOneYear)).toEqual(form(overNewYear));
  });

  it("tells the season's story in its order", () => {
    const story = (played: ReturnType<typeof season>) =>
      buildSeasonTimeline(teams, played.matchups, played.logs, settings).map((entry) => entry.id);
    expect(story(overNewYear)).toEqual(story(insideOneYear));
  });

  it("backtests each game on the ones before it", () => {
    expect(backtestPredictions(teams, overNewYear.matchups, overNewYear.logs, settings)).toEqual(
      backtestPredictions(teams, insideOneYear.matchups, insideOneYear.logs, settings)
    );
  });

  it("reads recent form and the Gold-odds trend in the season's order", () => {
    const engine = (played: ReturnType<typeof season>) =>
      buildPredictionEngine(
        calculateTeams(teams, played.matchups, played.logs, settings),
        played.matchups,
        played.logs,
        settings
      ).powerRatings.map((row) => [row.teamId, row.recentForm]);
    expect(engine(overNewYear)).toEqual(engine(insideOneYear));

    /*
     * A tournament result the day after the first January game: each point of the trend is rated
     * with the outside results played by its own last game, so it joins from the next point on.
     */
    const trend = (played: ReturnType<typeof season>, tournamentDay: string) =>
      buildTrendStates(teams, played.matchups, played.logs, played.matchups.slice(), {
        states: 8,
        goldCutoff: 2,
        settings,
        externalResults: [{ away: "B", home: "OUT-1", homeMargin: -9, date: tournamentDay }],
      }).map((state) => [state.seedText, state.teams]);
    expect(trend(overNewYear, "2027-01-10")).toEqual(trend(insideOneYear, "2026-11-10"));
  });

  it("starts the year at a tournament the league's own dates come after", () => {
    // An October tournament before a November-to-January league is the start of its year, as a
    // result on 1 November, before the first league game, plainly is.
    const outside = (date: string) => [{ away: "B", home: "OUT-1", homeMargin: -9, date }];
    const form = (date: string) =>
      buildPredictionEngine(
        calculateTeams(teams, overNewYear.matchups, overNewYear.logs, settings),
        overNewYear.matchups,
        overNewYear.logs,
        settings,
        outside(date)
      ).powerRatings.map((row) => [row.teamId, row.recentForm]);
    expect(form("2026-10-24")).toEqual(form("2026-11-01"));

    const trend = (date: string) =>
      buildTrendStates(
        teams,
        overNewYear.matchups,
        overNewYear.logs,
        overNewYear.matchups.slice(),
        {
          states: 8,
          goldCutoff: 2,
          settings,
          externalResults: outside(date),
        }
      ).map((state) => state.teams);
    expect(trend("2026-10-24")).toEqual(trend("2026-11-01"));
  });
});
