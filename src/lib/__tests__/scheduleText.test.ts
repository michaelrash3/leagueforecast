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
});

describe("parseScorePair", () => {
  it("always reads the first number as the subject team's, win or loss", () => {
    expect(parseScorePair("W 6-5")).toEqual({ teamScore: 6, opponentScore: 5 });
    expect(parseScorePair("L 3-10")).toEqual({ teamScore: 3, opponentScore: 10 });
    expect(parseScorePair("T 4-4")).toEqual({ teamScore: 4, opponentScore: 4 });
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

  it("does not eat a leading number that is part of the team's name", () => {
    const { games } = parseScheduleText("vs. 513 Force Bouley 7-2");
    expect(games[0]).toEqual({ teamB: "513 Force Bouley", scoreA: 7, scoreB: 2 });
  });

  it("drops a start time without losing the opponent", () => {
    const { games } = parseScheduleText("2026-08-22 10:00 AM vs. Velocirabbits 6-5");
    expect(games[0]?.teamB).toBe("Velocirabbits");
  });

  it("takes a team column as the subject only when every row agrees", () => {
    const agreed = parseScheduleText(
      ["Team,Date,Opponent,Score", "South Lexington Red,2026-08-22,Velocirabbits,6-5"].join("\n")
    );
    expect(agreed.subjectTeam).toBe("South Lexington Red");

    const mixed = parseScheduleText(
      [
        "Team,Date,Opponent,Score",
        "South Lexington Red,2026-08-22,Velocirabbits,6-5",
        "Cincinnati Hornets,2026-08-23,NV Stars,3-10",
      ].join("\n")
    );
    expect(mixed.subjectTeam).toBeUndefined();
    expect(mixed.games).toHaveLength(2);
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
