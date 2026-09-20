import { describe, expect, it } from "vitest";
import {
  apartKey,
  coerceKeptApart,
  isKeptApart,
  keepApart,
  keptApartList,
  rejoin,
} from "../keptApart";
import { proposeSeasonPairings } from "../gameChangerImport";
import type { ScoutTeam } from "../teamRankings";

describe("apartKey", () => {
  it("reads the pair the same way round either way", () => {
    expect(apartKey("bbbb", "aaaa")).toBe(apartKey("aaaa", "bbbb"));
  });
});

describe("coerceKeptApart", () => {
  it("takes what was stored and drops what was not a pair", () => {
    const apart = coerceKeptApart([
      "bbbb\u0000aaaa",
      "cccc",
      42,
      "dddd\u0000dddd",
      "eeee\u0000ffff",
    ]);

    expect(keptApartList(apart)).toEqual(["aaaa\u0000bbbb", "eeee\u0000ffff"]);
  });

  it("answers empty for anything that is not a list", () => {
    expect(coerceKeptApart(null).size).toBe(0);
    expect(coerceKeptApart({ a: 1 }).size).toBe(0);
  });
});

describe("keepApart and rejoin", () => {
  it("remembers the pair and then forgets it", () => {
    const one = keepApart(new Set<string>(), "aaaa", "bbbb");
    expect(isKeptApart(one, "bbbb", "aaaa")).toBe(true);
    expect(isKeptApart(rejoin(one, "bbbb", "aaaa"), "aaaa", "bbbb")).toBe(false);
  });
});

/** The pair the user turned down, as `proposeSeasonPairings` sees it. */
const squad = (
  id: string,
  gcId: string,
  season: string,
  year: number,
  level: number
): ScoutTeam => ({
  id,
  name: "River City Raptors",
  city: "Hebron",
  state: "KY",
  gcTeams: [
    {
      teamId: gcId,
      name: `River City Raptors ${level}U`,
      ageGroupId: `ag${year}`,
      ageLevel: level,
      season,
      seasonYear: year,
      staff: ["Nick Brodbeck", "Peter Boudreau"],
    },
  ],
});

describe("a pairing the user has turned down", () => {
  const teams = [
    squad("t1", "gcFallFallAA", "fall", 2026, 11),
    squad("t2", "gcSprgSprgBB", "spring", 2027, 11),
  ];

  it("is offered until it is turned down, and never after", () => {
    expect(proposeSeasonPairings(teams, [])).toHaveLength(1);

    const apart = keepApart(new Set<string>(), "gcFallFallAA", "gcSprgSprgBB");

    expect(proposeSeasonPairings(teams, [], apart)).toEqual([]);
  });

  it("carries the GameChanger ids, which is what the answer is recorded against", () => {
    // This app's own team ids do not survive a fold or a reset; a GameChanger id is minted once.
    expect(proposeSeasonPairings(teams, [])[0]).toMatchObject({
      fromGcId: "gcFallFallAA",
      toGcId: "gcSprgSprgBB",
    });
  });
});
