import { describe, expect, it } from "vitest";
import { parseScheduleDate, parseScorePair, parseScheduleText } from "../scheduleText";

describe("parseScheduleDate", () => {
  it("reads the shapes people actually type", () => {
    expect(parseScheduleDate("2026-08-22")).toBe("2026-08-22");
    expect(parseScheduleDate("8/22/2026")).toBe("2026-08-22");
    expect(parseScheduleDate("8-22-26")).toBe("2026-08-22");
    expect(parseScheduleDate("Aug 22 2026")).toBe("2026-08-22");
    expect(parseScheduleDate("August 22, 2026")).toBe("2026-08-22");
    expect(parseScheduleDate("Sept 5, 2026")).toBe("2026-09-05");
  });

  it("completes a partial date from the section header above it", () => {
    expect(parseScheduleDate("22", { year: 2026, month: 8 })).toBe("2026-08-22");
    expect(parseScheduleDate("8/22", { year: 2026 })).toBe("2026-08-22");
  });

  it("never invents a year", () => {
    expect(parseScheduleDate("8/22")).toBeUndefined();
    expect(parseScheduleDate("Aug 22")).toBeUndefined();
    expect(parseScheduleDate("22")).toBeUndefined();
  });

  it("rejects nonsense rather than clamping it into a real date", () => {
    expect(parseScheduleDate("2026-13-01")).toBeUndefined();
    expect(parseScheduleDate("next Saturday")).toBeUndefined();
    expect(parseScheduleDate("")).toBeUndefined();
  });

  it("rejects a day the calendar does not have", () => {
    // These read as well-formed but are not real days; storing them would look right and be wrong.
    expect(parseScheduleDate("2026-02-31")).toBeUndefined();
    expect(parseScheduleDate("April 31 2026")).toBeUndefined();
    expect(parseScheduleDate("2026-02-29")).toBeUndefined();
    // 2028 is a leap year, so this one is real.
    expect(parseScheduleDate("2028-02-29")).toBe("2028-02-29");
  });
});

describe("parseScorePair", () => {
  it("always reads the first number as the subject team's, win or loss", () => {
    expect(parseScorePair("W 6-5")).toEqual({ teamScore: 6, opponentScore: 5 });
    expect(parseScorePair("L 3-10")).toEqual({ teamScore: 3, opponentScore: 10 });
    expect(parseScorePair("T 4-4")).toEqual({ teamScore: 4, opponentScore: 4 });
    // The result letter decides who won, whichever score is written first.
    expect(parseScorePair("L 5-3")).toEqual({ teamScore: 3, opponentScore: 5 });
    expect(parseScorePair("W 3-5")).toEqual({ teamScore: 5, opponentScore: 3 });
    expect(parseScorePair("l 10-3")).toEqual({ teamScore: 3, opponentScore: 10 });
    expect(parseScorePair("T 4-5")).toBeUndefined();
    expect(parseScorePair("6 – 5")).toEqual({ teamScore: 6, opponentScore: 5 });
  });

  it("is not fooled by something that merely has a dash", () => {
    expect(parseScorePair("Rockets - Bandits")).toBeUndefined();
    expect(parseScorePair("6")).toBeUndefined();
  });
});

describe("parseScheduleText", () => {
  it("reads a game list that names both teams, which needs no subject at all", () => {
    // The shape a league export actually takes: every row is a complete game.
    const { games, subjectTeam } = parseScheduleText(
      [
        "Date,Home Team,Home Team Score,Away Team,Away Team Score",
        "August 22 2026,NV Stars Scout,12,Ambush,2",
        "August 23 2026,NV Stars Scout,10,South Lexington Red,3",
        "September 5 2026,Ambush,,NV Stars Scout,",
      ].join("\n")
    );
    expect(subjectTeam).toBeUndefined();
    expect(games).toEqual([
      { date: "2026-08-22", teamA: "NV Stars Scout", teamB: "Ambush", scoreA: 12, scoreB: 2 },
      {
        date: "2026-08-23",
        teamA: "NV Stars Scout",
        teamB: "South Lexington Red",
        scoreA: 10,
        scoreB: 3,
      },
      { date: "2026-09-05", teamA: "Ambush", teamB: "NV Stars Scout" },
    ]);
  });

  it("reads a 0-0 against a game not yet played as no score at all", () => {
    const text = [
      "Date,Home Team,Home Team Score,Away Team,Away Team Score",
      "2026-04-05,Aces,0,Bruins,0",
      "2026-04-06,Aces,0,Bruins,0",
      "2026-04-12,Aces,0,Bruins,0",
      "2026-04-12,Aces,3,Bruins,0",
      "Aces,0,Bruins,0",
    ].join("\n");

    const { games } = parseScheduleText(text, "2026-04-06");

    expect(games.map((game) => [game.date, game.scoreA, game.scoreB])).toEqual([
      ["2026-04-05", 0, 0],
      ["2026-04-06", undefined, undefined],
      ["2026-04-12", undefined, undefined],
      ["2026-04-12", 3, 0],
      [undefined, undefined, undefined],
    ]);
  });

  it("recognises the other names a game list gives its two sides", () => {
    const { games } = parseScheduleText(
      ["Date,Home,Home Score,Visitor,Visitor Score", "2026-08-22,Aces,4,Bears,2"].join("\n")
    );
    expect(games).toEqual([
      { date: "2026-08-22", teamA: "Aces", teamB: "Bears", scoreA: 4, scoreB: 2 },
    ]);
  });

  it("still treats a lone Home column as home-or-away, not as a team", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,Home,Us,Them", "2026-08-22,Velocirabbits,vs,6,5"].join("\n")
    );
    expect(games).toEqual([{ date: "2026-08-22", teamB: "Velocirabbits", scoreA: 6, scoreB: 5 }]);
  });

  it("drops a game-list row missing one of its two teams", () => {
    const { games, skipped } = parseScheduleText(
      [
        "Date,Home Team,Home Team Score,Away Team,Away Team Score",
        "2026-08-22,,12,Ambush,2",
        "2026-08-23,NV Stars Scout,10,South Lexington Red,3",
      ].join("\n")
    );
    expect(games).toHaveLength(1);
    expect(skipped).toHaveLength(1);
  });

  it("reads a CSV with headers, in any column order", () => {
    const { games } = parseScheduleText(
      [
        "Opponent,Date,Our Score,Their Score",
        "Velocirabbits 9U,2026-08-22,6,5",
        "NV Stars,2026-08-23,3,10",
      ].join("\n")
    );
    expect(games).toEqual([
      { teamB: "Velocirabbits 9U", date: "2026-08-22", scoreA: 6, scoreB: 5 },
      { teamB: "NV Stars", date: "2026-08-23", scoreA: 3, scoreB: 10 },
    ]);
  });

  it("reads a headerless CSV in the order a person would write it", () => {
    const { games } = parseScheduleText("2026-08-22,Velocirabbits,6,5");
    expect(games).toEqual([{ teamB: "Velocirabbits", date: "2026-08-22", scoreA: 6, scoreB: 5 }]);
  });

  it("accepts a single combined score column", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,Score", "2026-08-22,Velocirabbits,W 6-5"].join("\n")
    );
    expect(games[0]).toEqual({
      teamB: "Velocirabbits",
      date: "2026-08-22",
      scoreA: 6,
      scoreB: 5,
    });
  });

  it("keeps an unplayed row as a scheduled game", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,Our Score,Their Score", "2026-09-05,Bourbon Bandits,,"].join("\n")
    );
    expect(games).toEqual([{ teamB: "Bourbon Bandits", date: "2026-09-05" }]);
  });

  it("strips a vs/@ marker off the opponent name", () => {
    const { games } = parseScheduleText(
      [
        "Date,Opponent,Home/Away",
        "2026-08-22,vs. Velocirabbits,",
        "2026-08-23,@ NV Stars,away",
      ].join("\n")
    );
    expect(games.map((game) => game.teamB)).toEqual(["Velocirabbits", "NV Stars"]);
  });

  it("handles a quoted name containing a comma", () => {
    const { games } = parseScheduleText('Date,Opponent,Score\n2026-08-22,"Rockets, Red",6-5');
    expect(games[0]?.teamB).toBe("Rockets, Red");
  });

  it("keeps a blank first cell of a tab-separated row in its column", () => {
    // A spreadsheet row with no date starts with a tab, which trimming the line took off, and
    // every cell moved a column left: the opponent read as the date, the score as the opponent.
    const { games } = parseScheduleText(
      "Date\tOpponent\tUs\tThem\n2026-08-22\tVelocirabbits\t6\t5\n\tNV Stars\t2\t7\n\t\t\t"
    );
    expect(games).toEqual([
      { teamB: "Velocirabbits", date: "2026-08-22", scoreA: 6, scoreB: 5 },
      { teamB: "NV Stars", scoreA: 2, scoreB: 7 },
    ]);
  });

  it("reads tab-separated text, which is what a spreadsheet paste gives you", () => {
    const { games } = parseScheduleText(
      "Date\tOpponent\tUs\tThem\n2026-08-22\tVelocirabbits\t6\t5"
    );
    expect(games[0]).toEqual({
      teamB: "Velocirabbits",
      date: "2026-08-22",
      scoreA: 6,
      scoreB: 5,
    });
  });

  it("reads schedule lines with a month header dating the bare days under it", () => {
    const { games } = parseScheduleText(
      [
        "August 2026",
        "SAT 22   vs. Velocirabbits 9U   W 6-5",
        "SUN 23   @ NV Stars 9u Scout   L 3-10",
        "",
        "September 2026",
        "SAT 5    vs. Bourbon Bandits",
      ].join("\n")
    );
    expect(games).toEqual([
      { teamB: "Velocirabbits 9U", date: "2026-08-22", scoreA: 6, scoreB: 5 },
      { teamB: "NV Stars 9u Scout", date: "2026-08-23", scoreA: 3, scoreB: 10 },
      { teamB: "Bourbon Bandits", date: "2026-09-05" },
    ]);
  });

  it("reads a line's result letter, whichever score the site writes first", () => {
    const { games } = parseScheduleText(
      ["August 2026", "SAT 22   vs. Velocirabbits 9U   L 5-3", "SUN 23   @ NV Stars   W 2-7"].join(
        "\n"
      )
    );
    expect(games).toEqual([
      { teamB: "Velocirabbits 9U", date: "2026-08-22", scoreA: 3, scoreB: 5 },
      { teamB: "NV Stars", date: "2026-08-23", scoreA: 7, scoreB: 2 },
    ]);
  });

  it("does not eat a leading number that is part of the team's name", () => {
    const { games } = parseScheduleText("vs. 513 Force Bouley 7-2");
    expect(games[0]).toEqual({ teamB: "513 Force Bouley", scoreA: 7, scoreB: 2 });
  });

  it("drops a start time without losing the opponent", () => {
    const { games } = parseScheduleText("2026-08-22 10:00 AM vs. Velocirabbits 6-5");
    expect(games[0]?.teamB).toBe("Velocirabbits");
  });

  it("credits each row to its own Team column, not to one name for the whole file", () => {
    const mixed = parseScheduleText(
      [
        "Team,Date,Opponent,Score",
        "South Lexington Red,2026-08-22,Velocirabbits,6-5",
        "Cincinnati Hornets,2026-08-23,NV Stars,3-10",
      ].join("\n")
    );
    // Without a per-row team every one of these games would be credited to whoever was typed
    // into "whose schedule is this?" — silently attributing another club's scores.
    expect(mixed.games).toEqual([
      {
        teamA: "South Lexington Red",
        teamB: "Velocirabbits",
        date: "2026-08-22",
        scoreA: 6,
        scoreB: 5,
      },
      {
        teamA: "Cincinnati Hornets",
        teamB: "NV Stars",
        date: "2026-08-23",
        scoreA: 3,
        scoreB: 10,
      },
    ]);
    expect(mixed.subjectTeam).toBeUndefined();
  });

  it("reports a single-team file's name as the subject as well as on each row", () => {
    const agreed = parseScheduleText(
      ["Team,Date,Opponent,Score", "South Lexington Red,2026-08-22,Velocirabbits,6-5"].join("\n")
    );
    expect(agreed.subjectTeam).toBe("South Lexington Red");
    expect(agreed.games[0]?.teamA).toBe("South Lexington Red");
  });

  it("reads the score even when a status word follows it", () => {
    const { games } = parseScheduleText(
      ["August 2026", "SAT 22 vs. Rockets W 6-5 Final", "SUN 23 @ Bandits L 3-10 F/6"].join("\n")
    );
    // With the status left in place the numbers are unreachable and the whole result ends up
    // inside the opponent's name.
    expect(games).toEqual([
      { teamB: "Rockets", date: "2026-08-22", scoreA: 6, scoreB: 5 },
      { teamB: "Bandits", date: "2026-08-23", scoreA: 3, scoreB: 10 },
    ]);
  });

  it("does not mistake a comma inside a schedule line for a CSV delimiter", () => {
    const { games } = parseScheduleText("August 22, 2026 vs. Rockets W 6-5");
    expect(games).toEqual([{ teamB: "Rockets", date: "2026-08-22", scoreA: 6, scoreB: 5 }]);
  });

  it("still reads a real CSV whose opponent cell carries a vs. marker", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,Us,Them", "2026-08-22,vs. Velocirabbits,6,5"].join("\n")
    );
    expect(games).toEqual([{ teamB: "Velocirabbits", date: "2026-08-22", scoreA: 6, scoreB: 5 }]);
  });

  it("reports what it could not read instead of silently dropping it", () => {
    const { games, skipped } = parseScheduleText(
      ["2026-08-22,Velocirabbits,6,5", "???", "just some prose"].join("\n")
    );
    expect(games).toHaveLength(1);
    expect(skipped).toEqual(["???", "just some prose"]);
  });

  it("finds nothing in an empty paste rather than throwing", () => {
    expect(parseScheduleText("")).toEqual({ games: [], skipped: [] });
    expect(parseScheduleText("   \n\n  ")).toEqual({ games: [], skipped: [] });
  });

  it("applies the same validation as the screenshot path", () => {
    // A half-read score becomes "not played yet"; an impossible one is dropped entirely.
    const { games } = parseScheduleText(
      ["Date,Opponent,Us,Them", "2026-08-22,Velocirabbits,6,", "2026-08-23,NV Stars,400,3"].join(
        "\n"
      )
    );
    expect(games[0]).toEqual({ teamB: "Velocirabbits", date: "2026-08-22" });
    expect(games[1]).toEqual({ teamB: "NV Stars", date: "2026-08-23" });
  });
});

describe("state columns", () => {
  it("reads a state per side from a game list", () => {
    const { games } = parseScheduleText(
      [
        "Date,Home Team,Home State,Home Team Score,Away Team,Away State,Away Team Score",
        "2026-08-22,NV Stars Scout,KY,12,Ambush,oh,2",
      ].join("\n")
    );
    expect(games[0]?.stateA).toBe("KY");
    expect(games[0]?.stateB).toBe("OH");
  });

  it("reads an opponent's state from a schedule", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,State,Us,Them", "2026-08-22,Velocirabbits,IN,6,5"].join("\n")
    );
    expect(games[0]?.stateB).toBe("IN");
  });

  it("ignores anything that is not two letters rather than storing junk", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,State,Us,Them", "2026-08-22,Velocirabbits,Indiana,6,5"].join("\n")
    );
    expect(games[0]?.stateB).toBeUndefined();
    expect(games[0]?.teamB).toBe("Velocirabbits");
  });

  it("is entirely optional — a file without one reads exactly as before", () => {
    const { games } = parseScheduleText(
      ["Date,Opponent,Us,Them", "2026-08-22,Velocirabbits,6,5"].join("\n")
    );
    expect(games[0]).toEqual({
      teamB: "Velocirabbits",
      date: "2026-08-22",
      scoreA: 6,
      scoreB: 5,
    });
  });
});

/*
 * Pinned before the league paste (`leagueScheduleText.ts`) began reading with this module's own
 * pieces — the cell splitter, the header reader, the month words — which were exported for it
 * unchanged. Every output below is what these pastes gave before that, quirks included: the
 * weekday in front of a full date that leaves it undated, "W 4-2" in a column with a partner left
 * unread, and a positional row that reads a score as a name. Fixing any of them is a change of its
 * own, made on purpose, not something sharing the pieces may do on the way past.
 */
describe("parseScheduleText, pinned before its pieces were shared", () => {
  const today = "2026-08-30";

  it("reads a headed game list, with home and away kept, to the field", () => {
    expect(
      parseScheduleText(
        [
          "Date,Home Team,Home Team Score,Away Team,Away Team Score,Home State",
          "2026-04-12,Falcons,6,Wolves,5,oh",
          '4/19/2026,"Comets, Blue",,Rockets,',
          "4/26,Falcons,0,Comets,0",
        ].join("\n"),
        today
      )
    ).toEqual({
      games: [
        {
          teamA: "Falcons",
          teamB: "Wolves",
          date: "2026-04-12",
          stateA: "OH",
          scoreA: 6,
          scoreB: 5,
        },
        { teamA: "Comets, Blue", teamB: "Rockets", date: "2026-04-19" },
        { teamA: "Falcons", teamB: "Comets" },
      ],
      skipped: [],
    });
  });

  it("reads a tab-separated table with a Visitor column", () => {
    expect(
      parseScheduleText(
        [
          "Date\tTime\tVisitor\tHome\tField",
          "4/12/2027\t9:00 AM\tFalcons\tWolves\tField 1",
          "Sat 4/19/2027\t11:00 AM\tComets\tRockets\t",
        ].join("\n"),
        today
      )
    ).toEqual({
      games: [
        { teamA: "Wolves", teamB: "Falcons", date: "2027-04-12" },
        { teamA: "Rockets", teamB: "Comets" },
      ],
      skipped: [],
    });
  });

  it("reads schedule lines under month headings, and skips what it cannot", () => {
    expect(
      parseScheduleText(
        [
          "August 2026",
          "SAT 22 vs. Velocirabbits 9U W 6-5 Final",
          "SUN 23 @ NV Stars L 3-10",
          "Apr 31 vs. Ghosts",
          "TBD",
          "September 2026",
          "5 at Bourbon Bandits 0-0",
          "August 22, 2026 vs. Rockets W 6-5",
        ].join("\n"),
        today
      )
    ).toEqual({
      games: [
        { teamB: "Velocirabbits 9U", date: "2026-08-22", scoreA: 6, scoreB: 5 },
        { teamB: "NV Stars", date: "2026-08-23", scoreA: 3, scoreB: 10 },
        { teamB: "Bourbon Bandits", date: "2026-09-05" },
        { teamB: "Rockets", date: "2026-08-22", scoreA: 6, scoreB: 5 },
      ],
      skipped: ["Apr 31 vs. Ghosts", "TBD"],
    });
  });

  it("reads a schedule with a Team column onto each row", () => {
    expect(
      parseScheduleText(
        [
          "Team,Date,Opponent,Us,Them,State",
          "Falcons,2026-08-22,Wolves,6,5,KY",
          "Comets,2026-08-23,vs. Rockets,,,",
          "Falcons,8/30/2026,@ Rockets,W 4-2,,",
        ].join("\n"),
        today
      )
    ).toEqual({
      games: [
        {
          teamA: "Falcons",
          teamB: "Wolves",
          date: "2026-08-22",
          stateB: "KY",
          scoreA: 6,
          scoreB: 5,
        },
        { teamA: "Comets", teamB: "Rockets", date: "2026-08-23" },
        { teamA: "Falcons", teamB: "Rockets", date: "2026-08-30" },
      ],
      skipped: [],
    });
  });

  it("reads a headerless table by position, from its first row", () => {
    expect(
      parseScheduleText(
        ["8/22/2026, Velocirabbits, 6, 5", "Rockets, 3, 4", "9/1/2026, NV Stars"].join("\n"),
        today
      )
    ).toEqual({
      games: [
        { teamB: "Velocirabbits", date: "2026-08-22", scoreA: 6, scoreB: 5 },
        { teamB: "3" },
        { teamB: "NV Stars", date: "2026-09-01" },
      ],
      skipped: [],
    });
  });
});

/*
 * Four more of the paste's misreadings, each reproduced with the real parser (PR 7): a start time
 * read as a final score, a team name carrying an age range read as a score or skipped, and dates
 * after December kept in the year before.
 */
describe("a pasted schedule's times, age ranges and new years", () => {
  it("reads a start time as no score", () => {
    expect(parseScorePair("6:00")).toBeUndefined();
    expect(parseScorePair("12:30")).toBeUndefined();
    // A colon between two runs is still a score.
    expect(parseScorePair("6:5")).toEqual({ teamScore: 6, opponentScore: 5 });
    expect(parseScheduleText("8/22/2026,Velocirabbits,6:00", "2026-10-26").games).toEqual([
      { teamB: "Velocirabbits", date: "2026-08-22" },
    ]);
  });

  it("keeps an age range in a team's name in a table", () => {
    expect(parseScheduleText("Date,Opponent\n8/22/2026,Majors 11-12", "2026-10-26")).toEqual({
      games: [{ teamB: "Majors 11-12", date: "2026-08-22" }],
      skipped: [],
    });
    const away = parseScheduleText("Date,Home,Away\n8/22/2026,Aces,Bombers 9-10U", "2026-10-26");
    expect(away.skipped).toEqual([]);
    expect(away.games).toHaveLength(1);
    expect(JSON.stringify(away.games[0])).toContain("Bombers 9-10U");
  });

  it("keeps an age range in the name of a game still to come, where it cannot be a result", () => {
    expect(parseScheduleText("Sat 8/22/2026 vs Majors 11-12", "2026-08-01").games).toEqual([
      { teamB: "Majors 11-12", date: "2026-08-22" },
    ]);
    // A result letter says it is one, whatever the numbers.
    expect(parseScheduleText("Sat 8/22/2026 vs Majors 11-12 W 5-3", "2026-10-26").games).toEqual([
      { teamB: "Majors 11-12", date: "2026-08-22", scoreA: 5, scoreB: 3 },
    ]);
  });

  it("reads a game of today, or one marked final, as played whatever its numbers", () => {
    // Today's game may be over already: its two numbers are its result.
    expect(parseScheduleText("10/26/2026 vs Bears 6-7", "2026-10-26").games).toEqual([
      { teamB: "Bears", date: "2026-10-26", scoreA: 6, scoreB: 7 },
    ]);
    // "Final" says it was played, today or on a day still to come by the device's clock.
    for (const today of ["2026-10-26", "2026-10-01"]) {
      expect(parseScheduleText("10/26/2026 vs Bears 6-7 Final", today).games).toEqual([
        { teamB: "Bears", date: "2026-10-26", scoreA: 6, scoreB: 7 },
      ]);
    }
    // A postponed game was not played: the range is still the name's.
    expect(parseScheduleText("10/27/2026 vs Majors 11-12 Postponed", "2026-10-26").games).toEqual([
      { teamB: "Majors 11-12", date: "2026-10-27" },
    ]);
  });

  it("moves on a year when the dates turn from December to January", () => {
    expect(
      parseScheduleText("December 2026\n12/12 vs Aces\n1/9 vs Bears", "2026-10-26").games
    ).toEqual([
      { teamB: "Aces", date: "2026-12-12" },
      { teamB: "Bears", date: "2027-01-09" },
    ]);
    expect(
      parseScheduleText(
        "December 2026\nSat 12 vs Aces\nJanuary\nSun 3 vs Comets\nSun 10 vs Ducks",
        "2026-10-26"
      )
    ).toEqual({
      games: [
        { teamB: "Aces", date: "2026-12-12" },
        { teamB: "Comets", date: "2027-01-03" },
        { teamB: "Ducks", date: "2027-01-10" },
      ],
      skipped: [],
    });
    // A year written with the date is the date's, however the dates before it ran.
    expect(
      parseScheduleText("December 2026\n12/12 vs Aces\n1/9/2026 vs Bears", "2026-10-26").games[1]
    ).toEqual({ teamB: "Bears", date: "2026-01-09" });
  });
});
