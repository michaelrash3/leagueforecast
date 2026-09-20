import { describe, expect, it } from "vitest";
import {
  buildRoundRobin,
  builderTeamNames,
  roundRobinCsv,
  roundRobinFileName,
} from "../roundRobin";
import { DEFAULT_SETTINGS } from "../types";

/**
 * A blank season built from a pasted list. Every expectation here was taken from the code as it
 * ran inside the component before it was lifted out, so the lift is provably a move rather than a
 * rewrite — the ids, the pairing order and both score sheets match to the byte.
 */
const NAMES = "Aces\nBears, Cubs\n  Ducks  \n\nAces";

describe("reading the pasted list", () => {
  it("takes a name per line or per comma, trimmed", () => {
    expect(builderTeamNames(NAMES)).toEqual(["Aces", "Bears", "Cubs", "Ducks"]);
  });

  it("keeps a name typed twice only once", () => {
    // A repeat is a slip, not two clubs: a round robin over it would schedule a side against
    // itself, and the two rows would be indistinguishable in the standings.
    expect(builderTeamNames("Aces\nAces\nBears")).toEqual(["Aces", "Bears"]);
  });

  it("finds nothing in a box holding only separators", () => {
    expect(builderTeamNames("\n , \n,,\n  ")).toEqual([]);
  });
});

describe("building the schedule", () => {
  it("plays every pair exactly once, in the order the names were given", () => {
    const built = buildRoundRobin(builderTeamNames(NAMES), 6)!;

    expect(built.teams.map((team) => team.id)).toEqual(["ACES", "BEAR", "CUBS", "DUCK"]);
    expect(built.matchups.map((game) => game.id)).toEqual([
      "game_001_ACES_BEAR",
      "game_002_ACES_CUBS",
      "game_003_ACES_DUCK",
      "game_004_BEAR_CUBS",
      "game_005_BEAR_DUCK",
      "game_006_CUBS_DUCK",
    ]);
    // Four teams, six games: n(n-1)/2, and each side away in the games it opens.
    expect(built.matchups).toHaveLength(6);
  });

  it("gives every game an empty score sheet at the league's own innings", () => {
    const built = buildRoundRobin(["A", "B"], 5)!;
    const log = built.logs[built.matchups[0]!.id]!;

    expect(log.innings).toBe("5");
    expect(log.awayRuns).toBe("");
    expect(log.isFinal).toBeFalsy();
  });

  it("refuses a list too short to schedule, rather than building a season of nobody", () => {
    expect(buildRoundRobin(["Aces"], 6)).toBeNull();
    expect(buildRoundRobin([], 6)).toBeNull();
  });

  it("builds the same schedule from the same list, every time", () => {
    // The ids are in the game ids, which is what lets a downloaded sheet be re-imported against
    // the schedule it came from; a build that reordered would break that quietly.
    const once = buildRoundRobin(builderTeamNames(NAMES), 6)!;
    const twice = buildRoundRobin(builderTeamNames(NAMES), 6)!;
    expect(twice.matchups).toEqual(once.matchups);
  });
});

describe("the blank score sheet", () => {
  const built = buildRoundRobin(builderTeamNames(NAMES), DEFAULT_SETTINGS.defaultGameInnings)!;

  it("counts errors and walks where the players pitch", () => {
    const csv = roundRobinCsv(built, { ...DEFAULT_SETTINGS, pitchMode: "player" });

    expect(csv).toBe(
      [
        "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away E,Away BB,Home Team,Home Runs,Home Hits,Home E,Home BB",
        "game_001_ACES_BEAR,,Aces,6,,,,,Bears,,,,",
        "game_002_ACES_CUBS,,Aces,6,,,,,Cubs,,,,",
        "game_003_ACES_DUCK,,Aces,6,,,,,Ducks,,,,",
        "game_004_BEAR_CUBS,,Bears,6,,,,,Cubs,,,,",
        "game_005_BEAR_DUCK,,Bears,6,,,,,Ducks,,,,",
        "game_006_CUBS_DUCK,,Cubs,6,,,,,Ducks,,,,",
      ].join("\n")
    );
  });

  it("counts strikeouts where the machine does, and says balls in play are never coming", () => {
    const csv = roundRobinCsv(built, { ...DEFAULT_SETTINGS, pitchMode: "machine" });

    expect(csv).toBe(
      [
        "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Away BIP,Home Team,Home Runs,Home Hits,Home K,Home BIP",
        "game_001_ACES_BEAR,,Aces,6,,,,N/A,Bears,,,,N/A",
        "game_002_ACES_CUBS,,Aces,6,,,,N/A,Cubs,,,,N/A",
        "game_003_ACES_DUCK,,Aces,6,,,,N/A,Ducks,,,,N/A",
        "game_004_BEAR_CUBS,,Bears,6,,,,N/A,Cubs,,,,N/A",
        "game_005_BEAR_DUCK,,Bears,6,,,,N/A,Ducks,,,,N/A",
        "game_006_CUBS_DUCK,,Cubs,6,,,,N/A,Ducks,,,,N/A",
      ].join("\n")
    );
  });

  it("writes names rather than ids, and quotes one holding a comma", () => {
    // The sheet is filled in by a person at a field, and "ACES" is not what is on the shirts.
    const commas = buildRoundRobin(["Aces, of Newport", "Bears"], 6)!;
    const csv = roundRobinCsv(commas, { ...DEFAULT_SETTINGS, pitchMode: "player" });

    expect(csv.split("\n")[1]).toContain('"Aces, of Newport"');
  });
});

describe("what the file is called", () => {
  it("is named after the season, without the spaces", () => {
    expect(roundRobinFileName("Spring 2027 Season")).toBe(
      "Spring_2027_Season_Blank_Round_Robin.csv"
    );
  });
});
