import { describe, expect, it } from "vitest";
import type { ScoutGame } from "../../teamRankings";
import {
  CLUB_BUCKETS,
  clubBucketOf,
  clubKey,
  coerceClubBucket,
  encodeClubCard,
  leagueLinkOf,
  type ClubCard,
} from "../views/clubShape";

/*
 * A club card as published and read back (`clubShape.ts`): the bucket every device must agree on,
 * the card through the wire and back, and the check that refuses one that is not a card.
 */

const game = (more: Partial<ScoutGame> & Pick<ScoutGame, "id">): ScoutGame => ({
  teamAId: "S-1",
  teamBId: "S-2",
  ageGroupId: "ag_10u_2027",
  ...more,
});

const CARD: ClubCard = {
  team: {
    id: "S-1",
    name: "Placeholder Hawks",
    state: "OH",
    gcTeams: [{ teamId: "gcAAAAAAAAAA", name: "Placeholder Hawks 10U", ageGroupId: "ag_10u_2027" }],
  },
  games: [
    game({
      id: "g1",
      teamAScore: 5,
      teamBScore: 3,
      reportedByB: { teamAScore: 5, teamBScore: 4 },
      date: "2027-03-20",
      event: "Placeholder Classic",
      ageLevelA: 10,
      ageLevelB: 9,
    }),
    game({ id: "g2", teamAId: "S-3", teamBId: "S-1", teamAScore: 40, teamBScore: 0 }),
    game({ id: "g3", teamAId: "S-3", teamBId: "S-1", excluded: true, scoreConfirmed: 40 }),
    // Against its own name, and against a club the roster has no name for.
    game({ id: "g4", teamBId: "S-1", teamAScore: 2, teamBScore: 2 }),
    game({ id: "g5", teamBId: "S-9", ageGroupId: "ag_9u_2027" }),
  ],
  names: { "S-2": "Placeholder Bees", "S-3": "Placeholder Cows" },
  leaguePages: ["ag_10u_2027"],
  picked: true,
  age: { level: 10, pinned: { level: 11, was: 10 } },
};

/** The card as a device reads it back: through JSON and the check. */
const roundTrip = (card: ClubCard) =>
  coerceClubBucket(JSON.parse(JSON.stringify({ clubs: { [card.team.id]: encodeClubCard(card) } })))
    ?.clubs[card.team.id];

describe("a club's bucket", () => {
  it("is the same on every device: pinned for a few ids, and within the buckets", () => {
    // FNV-1a worked out apart from this code for these ids (2166136261, 4213640900 and
    // 2133079584), so a change to the hash cannot pass unseen.
    expect(clubBucketOf("")).toBe(0x811c9dc5 % CLUB_BUCKETS);
    expect(clubBucketOf("")).toBe(5);
    expect(clubBucketOf("S-1")).toBe(4);
    expect(clubBucketOf("gc_abcDEF123456")).toBe(32);
    const spread = new Set(Array.from({ length: 2_000 }, (_, at) => clubBucketOf(`S-${at}`)));
    expect(spread.size).toBe(CLUB_BUCKETS);
    expect([...spread].every((bucket) => bucket >= 0 && bucket < CLUB_BUCKETS)).toBe(true);
  });

  it("is named by year, with none for the pages without one", () => {
    expect(clubKey(2027, 5)).toBe("club:2027:5");
    expect(clubKey(undefined, 63)).toBe("club:none:63");
  });
});

describe("a club card", () => {
  it("reads back as it was published, but for its games' ids, which are their places", () => {
    const read = roundTrip(CARD);
    expect(read).toEqual({
      ...CARD,
      games: CARD.games.map((one, at) => ({ ...one, id: String(at) })),
    });
  });

  it("names each opponent once on the wire, and an unnamed one by its id alone", () => {
    const wire = encodeClubCard(CARD);
    expect(wire.opponents).toEqual([
      ["S-2", "Placeholder Bees"],
      ["S-3", "Placeholder Cows"],
      ["S-9"],
    ]);
    expect(wire.games.map((one) => [one.s, one.o])).toEqual([
      [0, 0],
      [1, 1],
      [1, 1],
      [0, -1],
      [0, 2],
    ]);
  });

  it("is refused a game that is not the club's own", () => {
    expect(() =>
      encodeClubCard({ ...CARD, games: [game({ id: "x", teamAId: "S-7", teamBId: "S-8" })] })
    ).toThrow(/not its own/);
  });

  it("says the panel's League Standings link on a page: by name, by pick, or none", () => {
    expect(leagueLinkOf(CARD, "ag_10u_2027")).toBe("pick");
    expect(leagueLinkOf({ ...CARD, picked: undefined }, "ag_10u_2027")).toBe("name");
    expect(leagueLinkOf(CARD, "ag_9u_2027")).toBeUndefined();
  });
});

describe("a published bucket read back", () => {
  const wire = () =>
    JSON.parse(JSON.stringify({ clubs: { "S-1": encodeClubCard(CARD) } })) as {
      clubs: Record<string, Record<string, unknown> & { games: Array<Record<string, unknown>> }>;
    };
  const refused = (spoil: (card: ReturnType<typeof wire>["clubs"][string]) => void) => {
    const bucket = wire();
    spoil(bucket.clubs["S-1"]!);
    return coerceClubBucket(bucket);
  };

  it("is nothing at all when any card in it is not one", () => {
    expect(coerceClubBucket(null)).toBeNull();
    expect(coerceClubBucket({ clubs: [] })).toBeNull();
    expect(refused((card) => (card.team = { id: "S-2", name: "Someone else" }))).toBeNull();
    expect(refused((card) => (card.team = { name: "No id" }))).toBeNull();
    expect(refused((card) => (card.games = {} as never))).toBeNull();
    expect(refused((card) => (card.opponents = [["S-2", 4]]))).toBeNull();
    // Each alone the reason: the card's own opponents are all still there to point at.
    expect(refused((card) => (card.opponents as unknown[]).push(["S-1", "Itself"]))).toBeNull();
    expect(refused((card) => (card.opponents as unknown[]).push(["S-2"]))).toBeNull();
    expect(refused((card) => (card.games[0]!.o = 9))).toBeNull();
    expect(refused((card) => (card.games[0]!.s = 2))).toBeNull();
    expect(refused((card) => (card.games[0]!.p = ""))).toBeNull();
    expect(refused((card) => (card.games[0]!.a = "5"))).toBeNull();
    expect(refused((card) => delete card.games[0]!.rb)).toBeNull();
    expect(refused((card) => (card.games[2]!.x = true))).toBeNull();
    expect(refused((card) => (card.games[0]!.la = 0))).toBeNull();
    expect(refused((card) => (card.games[0]!.d = 20270320))).toBeNull();
    expect(refused((card) => (card.leaguePages = []))).toBeNull();
    expect(refused((card) => (card.leaguePages = [""]))).toBeNull();
    expect(refused((card) => (card.picked = false))).toBeNull();
    expect(refused((card) => (card.age = { level: "10" }))).toBeNull();
    expect(refused((card) => (card.age = { pinned: { level: 11, was: -1 } }))).toBeNull();
    // Untouched, it reads.
    expect(coerceClubBucket(wire())).not.toBeNull();
  });
});
