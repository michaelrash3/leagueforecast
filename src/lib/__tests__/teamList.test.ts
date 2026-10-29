import { describe, expect, it } from "vitest";
import { buildRoundRobin, roundRobinFor } from "../roundRobin";
import { teamListLocked, teamsToAdd } from "../teamList";
import { DEFAULT_SETTINGS, type Matchup } from "../types";

/*
 * A League season's team list before its schedule: saved, added to later, then locked, with the
 * schedule made from the locked list. Placeholder names.
 */
const game: Matchup = { id: "g1", date: "5/1", away: "A", home: "B" };
const two = [
  { id: "ACES", name: "Aces" },
  { id: "BEAR", name: "Bears" },
];

describe("the teams a save adds", () => {
  it("adds each new name once, skipping the season's own and a name typed twice", () => {
    const added = teamsToAdd(two, ["Comets", "aces", " Comets ", "Ducks", ""]);
    expect(added.map((team) => team.name)).toEqual(["Comets", "Ducks"]);
  });

  it("gives each a new id beside the season's own", () => {
    const added = teamsToAdd([{ id: "COME", name: "Old Comets" }], ["Comets"]);
    expect(added[0]?.id).not.toBe("COME");
  });
});

describe("whether the team list is set", () => {
  it("is open while a list started here has no games", () => {
    expect(teamListLocked({ ...DEFAULT_SETTINGS, teamsLocked: false }, [], two)).toBe(false);
    expect(teamListLocked(DEFAULT_SETTINGS, [], [])).toBe(false);
  });

  it("is set once locked, once a game exists, and on a season from before lists were kept", () => {
    expect(teamListLocked({ ...DEFAULT_SETTINGS, teamsLocked: true }, [], two)).toBe(true);
    expect(teamListLocked({ ...DEFAULT_SETTINGS, teamsLocked: false }, [game], two)).toBe(true);
    expect(teamListLocked(DEFAULT_SETTINGS, [], two)).toBe(true);
  });
});

describe("a round robin from the saved teams", () => {
  it("keeps their ids, and is the schedule the names alone would build", () => {
    const built = roundRobinFor(two, 6);
    expect(built?.matchups).toEqual([
      { id: "game_001_ACES_BEAR", date: "", away: "ACES", home: "BEAR" },
    ]);
    // The same list typed as names builds the same schedule, ids and all.
    expect(buildRoundRobin(["Aces", "Bears"], 6)?.matchups).toEqual(built?.matchups);
    expect(roundRobinFor(two.slice(0, 1), 6)).toBeNull();
  });
});
