import { describe, expect, it } from "vitest";
import { parseLeagueSchedule, pasteSquadYear } from "../leagueScheduleText";

/** Squad year 2027 is Fall 2026 and Spring 2027; the clock is set mid-fall. */
const SQUAD = 2027;
const TODAY = "2026-10-26";
const read = (lines: string[], squadYear = SQUAD) =>
  parseLeagueSchedule(lines.join("\n"), squadYear, TODAY);

describe("parseLeagueSchedule", () => {
  it.each<[string, string[], ReturnType<typeof parseLeagueSchedule>]>([
    [
      "a headed CSV, home and away by column, scores where played",
      [
        "Date,Time,Home Team,Home Score,Away Team,Away Score,Field",
        "9/12/2026,9:00 AM,Wolves,6,Falcons,5,Field 1",
        '9/13/2026,11:00 AM,"Comets, Blue",,Rockets,,Field 2',
      ],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves", awayRuns: 5, homeRuns: 6 },
          { date: "9/13", away: "Rockets", home: "Comets, Blue" },
        ],
        skipped: [],
      },
    ],
    [
      "a tab-separated table off a site, with a Visitor column and a weekday on each date",
      [
        "Date\tTime\tVisitor\tHome\tLocation",
        "Sat 4/10\t9:00 AM\tFalcons\tWolves\tRiverside",
        "Sun 4/11\t1:00 PM\tComets\tRockets\t",
      ],
      {
        rows: [
          { date: "4/10", away: "Falcons", home: "Wolves" },
          { date: "4/11", away: "Comets", home: "Rockets" },
        ],
        skipped: [],
      },
    ],
    [
      "lines with @ and at, the host second",
      ["9/12 Falcons @ Wolves", "9/13 Comets at Rockets"],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves" },
          { date: "9/13", away: "Comets", home: "Rockets" },
        ],
        skipped: [],
      },
    ],
    [
      "lines with vs and v, the host first, as league sites print them",
      ["9/12 Wolves vs Falcons", "9/13 Rockets vs. Comets", "9/14 Bears v Lions"],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves" },
          { date: "9/13", away: "Comets", home: "Rockets" },
          { date: "9/14", away: "Lions", home: "Bears" },
        ],
        skipped: [],
      },
    ],
    [
      "start times and fields, wherever they are on the line",
      [
        "Sat 9/12 9:00 AM Falcons @ Wolves Field 3",
        "9/12 11am Comets @ Rockets - Fld 2",
        "9/13 Bears vs Lions 18:30 @ Diamond B",
      ],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves" },
          { date: "9/12", away: "Comets", home: "Rockets" },
          { date: "9/13", away: "Lions", home: "Bears" },
        ],
        skipped: [],
      },
    ],
    [
      "a month heading over bare days, and a day-only line over the games played on it",
      [
        "September 2026",
        "SAT 12 Falcons @ Wolves",
        "Saturday, September 19",
        "9:00 AM Comets @ Rockets",
        "11:00 AM Bears @ Lions",
      ],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves" },
          { date: "9/19", away: "Comets", home: "Rockets" },
          { date: "9/19", away: "Bears", home: "Lions" },
        ],
        skipped: [],
      },
    ],
    [
      "a day no calendar has, skipped and never rolled on to the next month",
      ["Apr 31 Falcons @ Wolves", "4/31", "Comets @ Rockets", "5/1", "Bears @ Lions"],
      {
        rows: [{ date: "5/1", away: "Bears", home: "Lions" }],
        skipped: ["Apr 31 Falcons @ Wolves", "4/31", "Comets @ Rockets"],
      },
    ],
    [
      "a TBD side, which is no team, and a line with two markers, which is no one game",
      ["10/3 TBD @ Wolves", "10/3 Winner of Game 3 vs Falcons", "10/4 Cats at Bat @ Wolves"],
      {
        rows: [],
        skipped: [
          "10/3 TBD @ Wolves",
          "10/3 Winner of Game 3 vs Falcons",
          "10/4 Cats at Bat @ Wolves",
        ],
      },
    ],
    [
      "scores off the end of a line, in the order the sides were written",
      [
        "9/12 Falcons @ Wolves 5-6 Final",
        "9/13 Wolves vs Comets 7-2",
        "9/14 Bears @ Lions 3 - 3 F/6",
      ],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves", awayRuns: 5, homeRuns: 6 },
          { date: "9/13", away: "Comets", home: "Wolves", awayRuns: 2, homeRuns: 7 },
          { date: "9/14", away: "Bears", home: "Lions", awayRuns: 3, homeRuns: 3 },
        ],
        skipped: [],
      },
    ],
    [
      "a 0-0 still to come is a placeholder, and one already played is a result",
      ["10/24 Falcons @ Wolves 0-0", "11/7 Comets @ Rockets 0-0", "Bears @ Lions 0-0"],
      {
        rows: [
          { date: "10/24", away: "Falcons", home: "Wolves", awayRuns: 0, homeRuns: 0 },
          { date: "11/7", away: "Comets", home: "Rockets" },
          { date: "", away: "Bears", home: "Lions" },
        ],
        skipped: [],
      },
    ],
    [
      "a CSV with no header, read away then home and marked as guessed",
      ["9/12/2026, Falcons, Wolves, 5, 6", "9/13/2026, Comets, Rockets, 4-4"],
      {
        rows: [
          {
            date: "9/12",
            away: "Falcons",
            home: "Wolves",
            awayRuns: 5,
            homeRuns: 6,
            guessed: true,
          },
          {
            date: "9/13",
            away: "Comets",
            home: "Rockets",
            awayRuns: 4,
            homeRuns: 4,
            guessed: true,
          },
        ],
        skipped: [],
      },
    ],
    [
      "a pasted table with no header, its weekday, time and field cells passed over",
      ["Sat\t9/13\t9:00 AM\tComets\tRockets\tField 2"],
      { rows: [{ date: "9/13", away: "Comets", home: "Rockets", guessed: true }], skipped: [] },
    ],
    [
      "a CSV with no header, its field and status cells passed over before the teams (Codex on #456)",
      ["4/10/2027,9:00 AM,Field 1,Falcons,Wolves,6,5", "Final,4/11/2027,Hawks,Owls,7,3"],
      {
        rows: [
          {
            date: "4/10",
            away: "Falcons",
            home: "Wolves",
            awayRuns: 6,
            homeRuns: 5,
            guessed: true,
          },
          { date: "4/11", away: "Hawks", home: "Owls", awayRuns: 7, homeRuns: 3, guessed: true },
        ],
        skipped: [],
      },
    ],
    [
      "a header naming two teams but not which hosted, read by position",
      ["Date,Time,Team 1,Team 2", "9/12/2026,9:00 AM,Falcons,Wolves"],
      { rows: [{ date: "9/12", away: "Falcons", home: "Wolves", guessed: true }], skipped: [] },
    ],
    [
      "two teams told apart only by a coach's name or an age, as two teams",
      ["9/12 Heat (Ealey) @ Heat (Smith)", "9/13 Wolves 9U vs Wolves 10U", "9/14 Wolves @ WOLVES"],
      {
        rows: [
          { date: "9/12", away: "Heat (Ealey)", home: "Heat (Smith)" },
          { date: "9/13", away: "Wolves 10U", home: "Wolves 9U" },
        ],
        skipped: ["9/14 Wolves @ WOLVES"],
      },
    ],
    [
      "a start time written without its minutes under a day's heading, which is no day",
      [
        "September 2026",
        "Saturday, September 19",
        "9 AM Comets @ Rockets",
        "10 a.m. Bears @ Lions",
      ],
      {
        rows: [
          { date: "9/19", away: "Comets", home: "Rockets" },
          { date: "9/19", away: "Bears", home: "Lions" },
        ],
        skipped: [],
      },
    ],
    [
      "a day's heading with its start time, which dates the games under it",
      [
        "Saturday, April 5",
        "Falcons @ Wolves",
        "Sat 4/12 9:00 AM",
        "Comets @ Rockets",
        "Sun, Apr 13 · 11:00 AM · Field 2",
        "Bears @ Lions",
      ],
      {
        rows: [
          { date: "4/5", away: "Falcons", home: "Wolves" },
          { date: "4/12", away: "Comets", home: "Rockets" },
          { date: "4/13", away: "Bears", home: "Lions" },
        ],
        skipped: [],
      },
    ],
    [
      "a headed table whose Day column comes before its Date, or whose date holds the time",
      [
        "Day,Date,Time,Away,Home",
        "Sat,9/12/2026,9:00 AM,Falcons,Wolves",
        "Date,Time,Away,Home",
        "9/13/2026 9:00 AM,,Comets,Rockets",
        "Sat 4/10/2027 9:00 AM,,Bears,Lions",
        "Date,Away,Home,Result",
        "TBD,Hawks,Owls,6-5",
      ],
      {
        rows: [
          { date: "9/12", away: "Falcons", home: "Wolves" },
          { date: "9/13", away: "Comets", home: "Rockets" },
          { date: "4/10", away: "Bears", home: "Lions" },
          // A result cell is not a date: "6-5" is no June 5th.
          { date: "", away: "Hawks", home: "Owls" },
        ],
        skipped: [],
      },
    ],
    [
      "a headed table's day no calendar has, skipped as on a line, scored or not (Codex on #456)",
      [
        "Date,Away,Home",
        "4/31/2027,Falcons,Wolves",
        "4/10/2027,Bears,Lions",
        "Date,Time,Home Team,Home Score,Away Team,Away Score",
        "2/30/2027,9:00 AM,Comets,7,Rockets,2",
      ],
      {
        rows: [{ date: "4/10", away: "Bears", home: "Lions" }],
        skipped: ["4/31/2027,Falcons,Wolves", "2/30/2027,9:00 AM,Comets,7,Rockets,2"],
      },
    ],
    [
      "a day written with its year after a comma, kept whole rather than split as a cell (Codex on #456)",
      [
        "April 10, 2027 Falcons @ Wolves",
        "Sat, Apr 17, 2027 Comets @ Rockets",
        "February 29, 2028 Bears @ Lions",
        "Sun, May 2, 2027,9:00 AM,Cubs @ Reds,Field 3",
        "Date,Away,Home",
        "April 24, 2027,Hawks,Owls",
      ],
      {
        rows: [
          { date: "4/10", away: "Falcons", home: "Wolves" },
          { date: "4/17", away: "Comets", home: "Rockets" },
          { date: "2/29", away: "Bears", home: "Lions" },
          { date: "5/2", away: "Cubs", home: "Reds" },
          { date: "4/24", away: "Hawks", home: "Owls" },
        ],
        skipped: [],
      },
    ],
    [
      "a game that will not be played as written, left out rather than added as a fixture",
      [
        "9/12 Falcons @ Wolves Cancelled",
        "9/13 RAINED OUT: Comets @ Rockets",
        "9/14 Bears @ Lions PPD",
        "9/15 Hawks @ Owls - Postponed - Field 2",
        "9/16,Cubs @ Reds,Suspended",
      ],
      {
        rows: [],
        skipped: [
          "9/12 Falcons @ Wolves Cancelled",
          "9/13 RAINED OUT: Comets @ Rockets",
          "9/14 Bears @ Lions PPD",
          "9/15 Hawks @ Owls - Postponed - Field 2",
          "9/16,Cubs @ Reds,Suspended",
        ],
      },
    ],
    [
      "an age span written on both names, which is no final score, and one after both, which is",
      [
        "4/12 Falcons 9-10 @ Wolves 9-10",
        "4/13 Comets 9-10 vs Rockets 9-10",
        // Both names carry their span and the score follows (Codex on #456), in a line and in cells.
        "4/14 Falcons 9-10 @ Wolves 9-10 6-5 Final",
        "4/15,Hawks 9-10 @ Owls 9-10,7-3",
      ],
      {
        rows: [
          { date: "4/12", away: "Falcons 9-10", home: "Wolves 9-10" },
          { date: "4/13", away: "Rockets 9-10", home: "Comets 9-10" },
          { date: "4/14", away: "Falcons 9-10", home: "Wolves 9-10", awayRuns: 6, homeRuns: 5 },
          { date: "4/15", away: "Hawks 9-10", home: "Owls 9-10", awayRuns: 7, homeRuns: 3 },
        ],
        skipped: [],
      },
    ],
    [
      "rows laid out in cells, a game in one and its day, time, field and place in others",
      [
        "4/10/2027,9:00 AM,Falcons @ Wolves",
        "Saturday, April 10, 11:00 AM, Comets @ Rockets",
        "Bears @ Lions,4/11/2027,9:00 AM,Riverside Park,5-6",
        "4-12,Hawks vs Owls,Fld 2",
        "Date,Time,Game,Field",
        "4/17/2027,9:00 AM,Cubs @ Reds,Field 1",
      ],
      {
        rows: [
          { date: "4/10", away: "Falcons", home: "Wolves" },
          { date: "4/10", away: "Comets", home: "Rockets" },
          { date: "4/11", away: "Bears", home: "Lions", awayRuns: 5, homeRuns: 6 },
          { date: "4/12", away: "Owls", home: "Hawks" },
          { date: "4/17", away: "Cubs", home: "Reds" },
        ],
        skipped: ["Date,Time,Game,Field"],
      },
    ],
    [
      "a line with a comma in a team's name, read whole when no cell is only a day or a time",
      ["9/12 Comets, Blue @ Wolves"],
      { rows: [{ date: "9/12", away: "Comets, Blue", home: "Wolves" }], skipped: [] },
    ],
  ])("reads %s", (_, lines, expected) => {
    expect(read(lines)).toEqual(expected);
  });

  it("places a day with no year in the squad year: August on in the year before it", () => {
    const { rows } = read(["8/29 Falcons @ Wolves", "12/5 Comets @ Rockets", "3/6 Bears @ Lions"]);
    expect(rows.map((row) => row.date)).toEqual(["8/29", "12/5", "3/6"]);
    // Only the year decides whether a 2/29 is a day, so it is checked against the one it lands in.
    expect(read(["2/29 Falcons @ Wolves"], 2027).skipped).toEqual(["2/29 Falcons @ Wolves"]);
    expect(read(["2/29 Falcons @ Wolves"], 2028).rows).toHaveLength(1);
  });

  it("reads a year written in the paste before the squad year", () => {
    // The heading's year places the day even where the squad year would not have it.
    expect(read(["February 2027", "Sat 29 Falcons @ Wolves"], 2028).skipped).toEqual([
      "Sat 29 Falcons @ Wolves",
    ]);
    // A title naming a season places the days after it, and is not reported as lost.
    const titled = read(["NKB 9U Spring 2028 Schedule", "2/29 Falcons @ Wolves"], 2027);
    expect(titled).toEqual({
      rows: [{ date: "2/29", away: "Falcons", home: "Wolves" }],
      skipped: [],
    });
  });

  it("does not take a team's name for a date or a time", () => {
    expect(read(["9/12 Marlins 10U @ Mayhem", "9/13 Sun Devils vs June Bugs"]).rows).toEqual([
      { date: "9/12", away: "Marlins 10U", home: "Mayhem" },
      { date: "9/13", away: "June Bugs", home: "Sun Devils" },
    ]);
  });

  it("leaves out one team's schedule, whose scores are from that team's side", () => {
    // Read by position this would be a game, Falcons away at Wolves, with the scores the wrong
    // way round for one of them: "Us" and "Them" say whose they are, not who hosted.
    expect(read(["Date,Team,Opponent,Us,Them", "9/12/2026,Falcons,Wolves,6,5"])).toEqual({
      rows: [],
      skipped: ["9/12/2026,Falcons,Wolves,6,5"],
    });
  });

  it("does not read a header it does not know as a game", () => {
    // With no day on it, a row of a table with no header is not taken: it may be the header.
    expect(read(["Game,Start,Side A,Side B", "9/12/2026,9:00 AM,Falcons,Wolves"])).toEqual({
      rows: [{ date: "9/12", away: "Falcons", home: "Wolves", guessed: true }],
      skipped: ["Game,Start,Side A,Side B"],
    });
    // Nor under a day's heading, whose day is the games', not a header's (Codex on #456).
    expect(
      read(["April 10", "Game,Start,Side A,Side B", "4/10/2027,9:00 AM,Falcons,Wolves"])
    ).toEqual({
      rows: [{ date: "4/10", away: "Falcons", home: "Wolves", guessed: true }],
      skipped: ["Game,Start,Side A,Side B"],
    });
  });

  it("reads a bare day before the game, under a month's heading, as its day (Codex on #456)", () => {
    expect(read(["April 2027", "12,9:00 AM,Falcons @ Wolves,6,5"])).toEqual({
      rows: [{ date: "4/12", away: "Falcons", home: "Wolves", awayRuns: 6, homeRuns: 5 }],
      skipped: [],
    });
    // A day written out in full is the day, and a number before the game is no score either.
    expect(read(["April 2027", "17,4/10/2027,Falcons @ Wolves,6,5"])).toEqual({
      rows: [{ date: "4/10", away: "Falcons", home: "Wolves", awayRuns: 6, homeRuns: 5 }],
      skipped: [],
    });
    // A day no calendar has is still skipped, with no bare day or heading's day to stand in for it.
    expect(read(["4/31/2027,9:00 AM,Falcons @ Wolves,6,5"])).toEqual({
      rows: [],
      skipped: ["4/31/2027,9:00 AM,Falcons @ Wolves,6,5"],
    });
    expect(read(["April 10", "4/31/2027,9:00 AM,Falcons @ Wolves,6,5"])).toEqual({
      rows: [],
      skipped: ["4/31/2027,9:00 AM,Falcons @ Wolves,6,5"],
    });
  });

  it("reads a header printed again partway down as a header", () => {
    expect(
      read([
        "Date,Away,Home",
        "9/12/2026,Falcons,Wolves",
        "Date,Away,Home",
        "9/19/2026,Comets,Rockets",
      ]).rows
    ).toEqual([
      { date: "9/12", away: "Falcons", home: "Wolves" },
      { date: "9/19", away: "Comets", home: "Rockets" },
    ]);
  });
});

describe("pasteSquadYear", () => {
  it("takes the linked year, then the season's name, then the year being played today", () => {
    expect(pasteSquadYear(2025, "Fall 2026", TODAY)).toBe(2025);
    expect(pasteSquadYear(undefined, "Fall 2026", TODAY)).toBe(2027);
    expect(pasteSquadYear(undefined, "Spring League", "2026-10-26")).toBe(2027);
    expect(pasteSquadYear(undefined, "Spring League", "2026-03-02")).toBe(2026);
  });
});
