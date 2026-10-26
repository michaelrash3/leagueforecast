import { describe, expect, it } from "vitest";
import { matchPastedNames, seasonFromPaste } from "../leaguePaste";
import type { TeamBase } from "../types";
import { blankLog } from "../util";

const teams: TeamBase[] = [
  { id: "WOLV", name: "Wolves" },
  { id: "FALC", name: "Falcons" },
  { id: "SLR", name: "South Lexington Red" },
];

describe("matchPastedNames", () => {
  it("takes a name that is one of the season's teams for that team", () => {
    const matches = matchPastedNames(["Wolves", "falcons", "Wolves 9U"], teams);
    expect(matches.get("Wolves")).toEqual({ kind: "team", teamId: "WOLV" });
    expect(matches.get("falcons")).toEqual({ kind: "team", teamId: "FALC" });
    // The age label is not part of a name's key, as everywhere names are matched.
    expect(matches.get("Wolves 9U")).toEqual({ kind: "team", teamId: "WOLV" });
  });

  it("only suggests a team a name is close to", () => {
    const matches = matchPastedNames(["Wolvess", "Falcons Baseball Club"], teams);
    expect(matches.get("Wolvess")).toEqual({ kind: "similar", teamId: "WOLV" });
    expect(matches.get("Falcons Baseball Club")).toEqual({ kind: "similar", teamId: "FALC" });
  });

  it("calls a name like no team here new, even one a few letters off a real one", () => {
    const matches = matchPastedNames(["Comets", "South Lexington Blue"], teams);
    expect(matches.get("Comets")).toEqual({ kind: "new" });
    // Red and Blue are two real teams four letters apart, which is not close enough to suggest.
    expect(matches.get("South Lexington Blue")).toEqual({ kind: "new" });
  });

  it("calls every name new in a season with no teams", () => {
    expect([...matchPastedNames(["Wolves", "Falcons"], []).values()]).toEqual([
      { kind: "new" },
      { kind: "new" },
    ]);
  });
});

describe("seasonFromPaste", () => {
  const known: Record<string, string | undefined> = { Wolves: "WOLV", Falcons: "FALC" };
  const teamFor = (name: string) => known[name];

  it("keeps the season's teams, as the same array, when every name is one of them", () => {
    const made = seasonFromPaste(
      [{ date: "9/12", away: "Falcons", home: "Wolves", awayRuns: 5, homeRuns: 6 }],
      teams,
      teamFor,
      6,
      (index) => `game_100_${index}`
    );
    expect(made.teams).toBe(teams);
    expect(made.addedTeams).toBe(0);
    expect(made.matchups).toEqual([{ id: "game_100_0", date: "9/12", away: "FALC", home: "WOLV" }]);
    expect(made.logs).toEqual({
      game_100_0: { ...blankLog("6"), awayRuns: "5", homeRuns: "6", isFinal: true },
    });
    expect(made.finals).toBe(1);
  });

  it("adds a name that is no team here once, however it is written, with a minted id", () => {
    const made = seasonFromPaste(
      [
        { date: "9/12", away: "Comets", home: "Wolves" },
        { date: "9/19", away: "Wolves", home: "COMETS" },
      ],
      teams,
      teamFor,
      7,
      (index) => `game_200_${index}`
    );
    expect(made.teams).toEqual([...teams, { id: "COME", name: "Comets" }]);
    expect(made.addedTeams).toBe(1);
    expect(made.matchups.map((game) => [game.away, game.home])).toEqual([
      ["COME", "WOLV"],
      ["WOLV", "COME"],
    ]);
    // Not played: a blank score sheet with the season's innings, not final.
    expect(made.logs.game_200_1).toEqual(blankLog("7"));
    expect(made.finals).toBe(0);
  });

  it("mints ids that do not collide with the season's own", () => {
    const made = seasonFromPaste(
      [{ date: "", away: "Wolverines", home: "Falcons" }],
      teams,
      teamFor,
      6,
      (index) => `game_300_${index}`
    );
    const added = made.teams.find((team) => team.name === "Wolverines");
    expect(added?.id).toBeDefined();
    expect(added?.id).not.toBe("WOLV");
  });
});
