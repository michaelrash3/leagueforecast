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
    const matches = matchPastedNames(
      ["Wolves", "falcons", "Wolves 9U", "Heat 9U (Ealey)"],
      [...teams, { id: "HEAT", name: "Heat (Ealey)" }]
    );
    expect(matches.get("Wolves")).toEqual({ kind: "team", teamId: "WOLV" });
    expect(matches.get("falcons")).toEqual({ kind: "team", teamId: "FALC" });
    // An age label more is the same team, said so, since the name is not written as the team's.
    expect(matches.get("Wolves 9U")).toEqual({ kind: "team", teamId: "WOLV", loose: true });
    expect(matches.get("Heat 9U (Ealey)")).toEqual({ kind: "team", teamId: "HEAT", loose: true });
  });

  it("keeps two teams told apart by a coach's name or an age apart", () => {
    const heats: TeamBase[] = [
      { id: "HEAT", name: "Heat (Ealey)" },
      { id: "HEA1", name: "Heat (Smith)" },
      { id: "WOLV", name: "Wolves 10U" },
    ];
    const matches = matchPastedNames(["Heat (Smith)", "Heat (Ealey)", "Heat", "Wolves 9U"], heats);
    expect(matches.get("Heat (Smith)")).toEqual({ kind: "team", teamId: "HEA1" });
    expect(matches.get("Heat (Ealey)")).toEqual({ kind: "team", teamId: "HEAT" });
    // A bare "Heat" fits both, so it is neither.
    expect(matches.get("Heat")).toEqual({ kind: "new" });
    // Another age than the season's one Wolves is not taken for it.
    expect(matches.get("Wolves 9U")).toEqual({ kind: "new" });
    // A season with one Heat does not take another coach's Heat for it, and does take a bare one.
    const one = [{ id: "HEAT", name: "Heat (Ealey)" }];
    expect(matchPastedNames(["Heat (Smith)"], one).get("Heat (Smith)")).toEqual({ kind: "new" });
    expect(matchPastedNames(["Heat"], one).get("Heat")).toEqual({
      kind: "team",
      teamId: "HEAT",
      loose: true,
    });
  });

  it("takes a name written as the app shows a team", () => {
    const shown: TeamBase[] = [
      { id: "WOLV", name: "NKB Wolves 9U" },
      { id: "FALC", name: "NKB Falcons 9U" },
    ];
    const matches = matchPastedNames(["Wolves 9U", "Falcons", "NKB Wolves"], shown);
    // Shown as "Wolves 9U", so written so it needs no note.
    expect(matches.get("Wolves 9U")).toEqual({ kind: "team", teamId: "WOLV" });
    expect(matches.get("Falcons")).toEqual({ kind: "team", teamId: "FALC", loose: true });
    expect(matches.get("NKB Wolves")).toEqual({ kind: "team", teamId: "WOLV", loose: true });
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

  it("adds two names told apart by a coach's name as two teams", () => {
    const made = seasonFromPaste(
      [
        { date: "9/12", away: "Heat (Ealey)", home: "Heat (Smith)" },
        { date: "9/13", away: "Heat (Smith)", home: "Wolves" },
        { date: "9/14", away: "heat ealey", home: "Wolves" },
      ],
      [],
      () => undefined,
      6,
      (index) => `game_400_${index}`
    );
    expect(made.teams.map((team) => team.name)).toEqual(["Heat (Ealey)", "Heat (Smith)", "Wolves"]);
    const [ealey, smith, wolves] = made.teams.map((team) => team.id);
    expect(new Set([ealey, smith, wolves]).size).toBe(3);
    expect(made.matchups.map((game) => [game.away, game.home])).toEqual([
      [ealey, smith],
      [smith, wolves],
      [ealey, wolves],
    ]);
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
