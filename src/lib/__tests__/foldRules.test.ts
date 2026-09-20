import { describe, expect, it } from "vitest";
import { proposeSeasonPairings } from "../gameChangerImport";
import type { ScoutTeam } from "../teamRankings";

/**
 * The fold rules as the user states them: a squad carries on into the next season, ageing up by a
 * year when it crosses into the next squad year, and two ids are one squad only when the name, the
 * state and — inside a single season — the town and the coaches all say so.
 */
const club = (
  id: string,
  listing: string,
  season: string,
  year: number,
  level: number,
  over: { city?: string; state?: string; staff?: string[]; name?: string } = {}
): ScoutTeam => ({
  id,
  name: over.name ?? "River City Raptors",
  city: over.city ?? "Hebron",
  state: over.state ?? "KY",
  gcTeams: [
    {
      teamId: `gc${id}${id}${id}`.slice(0, 12).padEnd(12, "x"),
      name: listing,
      ageGroupId: `ag${year}`,
      ageLevel: level,
      season,
      seasonYear: year,
      staff: over.staff ?? ["Nick Brodbeck", "Peter Boudreau"],
    },
  ],
});

const chain = (pairings: ReturnType<typeof proposeSeasonPairings>) =>
  pairings.map((p) => `${p.fromTeamId}->${p.toTeamId}`).sort();

describe("a squad carrying on", () => {
  it("follows the user's chain: 10U spring, 11U fall, 11U spring", () => {
    /*
     * A squad year runs Fall through the following Summer, so Spring 2026 is one squad year and
     * Fall 2026 and Spring 2027 are the next. The club is 10U in the first and 11U in the second,
     * which is the birthday the boundary exists for — and refusing the pairing whenever the ages
     * differed, which is what this did, cut the rating in half at every one of them.
     */
    const pairings = proposeSeasonPairings(
      [
        club("a", "River City Raptors 10U", "spring", 2026, 10),
        club("b", "River City Raptors 11U", "fall", 2026, 11),
        club("c", "River City Raptors 11U", "spring", 2027, 11),
      ],
      []
    );

    expect(chain(pairings)).toEqual(["a->b", "b->c"]);
  });

  it("offers the crossing once, at the first season of the next year that is here", () => {
    // Spring 2026 became the Fall 2026 squad, and by the same arithmetic the Spring 2027 one.
    // Both are true and the second is the same fold the long way round.
    const pairings = proposeSeasonPairings(
      [
        club("a", "River City Raptors 10U", "spring", 2026, 10),
        club("c", "River City Raptors 11U", "spring", 2027, 11),
      ],
      []
    );

    expect(chain(pairings)).toEqual(["a->c"]);
  });

  it("refuses a squad that gets younger", () => {
    expect(
      proposeSeasonPairings(
        [
          club("a", "River City Raptors 11U", "spring", 2026, 11),
          club("b", "River City Raptors 10U", "fall", 2026, 10),
        ],
        []
      )
    ).toEqual([]);
  });

  it("refuses a two-year jump", () => {
    expect(
      proposeSeasonPairings(
        [
          club("a", "River City Raptors 10U", "spring", 2026, 10),
          club("b", "River City Raptors 12U", "fall", 2026, 12),
        ],
        []
      )
    ).toEqual([]);
  });

  it("refuses an age that changes inside one squad year", () => {
    // Fall 2026 and Spring 2027 are one roster playing one age all the way through.
    expect(
      proposeSeasonPairings(
        [
          club("a", "River City Raptors 10U", "fall", 2026, 10),
          club("b", "River City Raptors 11U", "spring", 2027, 11),
        ],
        []
      )
    ).toEqual([]);
  });

  it("refuses two clubs in two states", () => {
    expect(
      proposeSeasonPairings(
        [
          club("a", "River City Raptors 11U", "fall", 2026, 11),
          club("b", "River City Raptors 11U", "spring", 2027, 11, { state: "OH", city: "Milford" }),
        ],
        []
      )
    ).toEqual([]);
  });

  it("refuses two listings whose names differ by more than the age", () => {
    /*
     * "Heat 9U (Ealey)" and "Heat 9U (Brown)" are one club for an opponent to have played and two
     * squads for this. Matching on the club key offered them as one team under a chip that said
     * "same name".
     */
    expect(
      proposeSeasonPairings(
        [
          club("a", "Heat 11U (Ealey)", "fall", 2026, 11, { name: "Heat" }),
          club("b", "Heat 11U (Brown)", "spring", 2027, 11, { name: "Heat" }),
        ],
        []
      )
    ).toEqual([]);
  });

  it("refuses a listing nobody gave an age, at either end", () => {
    // Two blanks are not an age two ids have in common, and treating them as one is how "same
    // name, different age" pairs were offered at all.
    const nameless = club("a", "River City Raptors", "fall", 2026, 11);
    delete nameless.gcTeams![0]!.ageLevel;

    expect(
      proposeSeasonPairings([nameless, club("b", "River City Raptors 11U", "spring", 2027, 11)], [])
    ).toEqual([]);
  });
});

describe("one squad listed twice in one season", () => {
  const twice = (over: Parameters<typeof club>[5] = {}) => [
    club("a", "Ambush 9U", "fall", 2026, 9, { city: "Prestonsburg" }),
    club("b", "Ambush 9U", "fall", 2026, 9, { city: "Prestonsburg", ...over }),
  ];

  it("is offered when the name, age, town, state and coaches all agree", () => {
    expect(proposeSeasonPairings(twice(), [])).toHaveLength(1);
  });

  it("is refused when the towns differ", () => {
    expect(proposeSeasonPairings(twice({ city: "Pikeville" }), [])).toEqual([]);
  });

  it("is refused when the coaches say nothing", () => {
    expect(proposeSeasonPairings(twice({ staff: ["Dana Hall", "Rory Estes"] }), [])).toEqual([]);
  });
});
