import { describe, expect, it } from "vitest";
import { createGcImporter, tidyPool, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { mergeScoutTeams, nameFitsWithin } from "../teamRankings";

/*
 * The wrong joins a review of the crossed-halves join found, each reproduced through the real
 * import and tidy before it was fixed. The join's own behaviour is pinned in crossedHalves.test.ts;
 * these pin what it must never do.
 */

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
type Played = GcTeamSchedule["games"][number];

const played = (
  id: string,
  opponentName: string,
  date: string,
  teamScore: number | undefined,
  opponentScore: number | undefined,
  startTs?: string
): Played => ({
  id,
  date,
  opponentName,
  status: teamScore === undefined ? "scheduled" : "completed",
  ...(teamScore === undefined ? {} : { teamScore }),
  ...(opponentScore === undefined ? {} : { opponentScore }),
  ...(startTs ? { startTs } : {}),
});

const club = (
  id: string,
  name: string,
  state: string,
  games: Played[],
  options: { ageLevel?: number; city?: string } = {}
): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ageLevel: options.ageLevel ?? 9,
    season: { season: "fall", year: 2026 },
    state,
    ...(options.city ? { city: options.city } : {}),
  },
  games,
  fetchedAt: "2026-09-22T12:00:00.000Z",
});

const fold = (schedules: GcTeamSchedule[], into: GcImportState = empty): GcImportState => {
  const importer = createGcImporter(into);
  schedules.forEach((schedule) => importer.add(schedule));
  return importer.state;
};

const pulled = (state: GcImportState, gcId: string) =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId));

/** Every row between two teams. */
const between = (state: GcImportState, a: string, b: string) =>
  state.games.filter((game) => [game.teamAId, game.teamBId].sort().join() === [a, b].sort().join());

const DAY = "2026-09-20";

describe("sibling squads at one instant", () => {
  /*
   * Bucks County Generals 11U beat somebody its coach wrote as "Mustangs 11U" at six; Jersey
   * Mustangs 12U lost to somebody written "Generals 12U" at six. Two games, between each club's
   * sibling squads. The age label comes off every name before it is compared, so the names fit
   * and the levels are within two; what tells them apart is the age each coach typed.
   */
  const SIX = "2026-09-20T18:00:00.000Z";
  const generals11 = club(
    "gcGEN11",
    "Bucks County Generals 11U",
    "PA",
    [played("g11", "Mustangs 11U", DAY, 5, 3, SIX)],
    { ageLevel: 11 }
  );
  const mustangs12 = club(
    "gcMUS12",
    "Jersey Mustangs 12U",
    "NJ",
    [played("m12", "Generals 12U", DAY, 3, 5, SIX)],
    { ageLevel: 12 }
  );
  const mustangs11 = club(
    "gcMUS11",
    "Jersey Mustangs 11U",
    "NJ",
    [played("m11", "Generals 11U", DAY, 3, 5, SIX)],
    { ageLevel: 11 }
  );

  it("never joins a squad to a stand-in whose typed age is another squad's", () => {
    const pool = tidyPool(fold([generals11, mustangs12])).state;
    const a = pulled(pool, "gcGEN11")!;
    const b = pulled(pool, "gcMUS12")!;
    expect(between(pool, a.id, b.id)).toEqual([]);
  });

  it("joins it to the squad whose age the coach typed, once that squad is pulled", () => {
    const pool = tidyPool(fold([generals11, mustangs12, mustangs11])).state;
    const a = pulled(pool, "gcGEN11")!;
    const rows = between(pool, a.id, pulled(pool, "gcMUS11")!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.alsoFrom).not.toContain("gcMUS12");
  });
});

describe("a later step undoing a join", () => {
  /*
   * The Stix wrote "Hurricanes Baseball", the Hurricanes wrote "Stix", and the join made one game
   * of the two. A second Ohio "Hurricanes" has its own unplayed row against the Stix that evening.
   * Reading only the row's `source`, the reclaim that runs next saw the joined row as sitting on a
   * club that never filed it, and moved it onto the Toledo club in the very tidy that joined it.
   */
  const stix = club(
    "tu9c21dMzowB",
    "Cincy Stix 9U Navy",
    "OH",
    [played("s-0920", "Hurricanes Baseball", DAY, 13, 2, "2026-09-20T17:30:00.000Z")],
    { city: "Harrison" }
  );
  const hurricanes = club("bKpjvY5AVqOV", "Hurricanes", "OH", [
    played("h-0920", "Stix", DAY, 2, 13, "2026-09-20T17:00:00.000Z"),
  ]);
  const toledo = club(
    "gcTOLEDOHUR1",
    "Hurricanes 9U",
    "OH",
    [
      played("t-0913", "Mud Hens 9U", "2026-09-13", 4, 3),
      played("t-0920", "Cincy Stix 9U Navy", DAY, undefined, undefined, "2026-09-20T20:00:00.000Z"),
    ],
    { city: "Toledo" }
  );

  it.each([
    ["the Stix first", [stix, toledo, hurricanes]],
    ["the Hurricanes before Toledo", [stix, hurricanes, toledo]],
  ])("keeps the joined game on the club that filed it, %s", (_, order) => {
    const out = tidyPool(fold(order));
    const pool = out.state;
    const scored = pool.games.filter((game) => game.date === DAY && game.teamAScore !== undefined);
    const a = pulled(pool, "tu9c21dMzowB")!.id;
    const b = pulled(pool, "bKpjvY5AVqOV")!.id;
    expect(scored.map((game) => [game.teamAId, game.teamBId].sort())).toEqual([[a, b].sort()]);
  });
});

describe("a club somebody merged by hand", () => {
  /*
   * Merging a pulled club into a stand-in keeps the stand-in's flags, so the club that survives
   * carries GameChanger ids and `nameOnly` both. Read as a stand-in, its row was joined away to a
   * namesake and the club — links and all — was deleted as emptied.
   */
  const stix = club("tu9c21dMzowB", "Cincy Stix 9U Navy", "OH", [
    played("s-0920", "Hurricanes", DAY, 13, 2, "2026-09-20T17:30:00.000Z"),
  ]);
  const hurricanes = club("bKpjvY5AVqOV", "Hurricanes", "OH", [
    played("h-0920", "Stix", DAY, 2, 13, "2026-09-20T17:00:00.000Z"),
  ]);
  const toledo = club("gcTOLEDOHUR1", "Hurricanes 9U", "OH", [
    played("t-0913", "Mud Hens 9U", "2026-09-13", 4, 3),
  ]);
  const black = club("gcHURBLACK01", "Hurricanes", "OH", [], { city: "Dayton" });

  it("keeps the club, its links and the row somebody put on it", () => {
    const folded = fold([toledo, hurricanes, black, stix]);
    const standIn = folded.teams.find((team) => team.nameOnly && team.name === "Hurricanes")!;
    const merged = mergeScoutTeams(
      pulled(folded, "gcHURBLACK01")!.id,
      standIn.id,
      folded.teams,
      folded.games,
      folded.ageGroups
    );
    const state = { ...folded, teams: merged.teams, games: merged.games };
    const survivor = state.teams.find((team) => team.id === standIn.id)!;
    // The shape a hand merge leaves: a club still flagged as a stand-in.
    expect(survivor.nameOnly).toBe(true);
    expect(survivor.gcTeams?.map((link) => link.teamId)).toEqual(["gcHURBLACK01"]);

    const pool = tidyPool(state).state;
    const kept = pulled(pool, "gcHURBLACK01");
    expect(kept).toBeDefined();
    expect(kept!.gcTeams?.map((link) => link.teamId)).toEqual(["gcHURBLACK01"]);
    /*
     * The game itself goes where a schedule proves it: the real Hurricanes' own row holds it, the
     * result mirrored, and the merge was made on a name. Once, and not lost.
     */
    const stixId = pulled(pool, "tu9c21dMzowB")!.id;
    const game = pool.games.filter((row) => row.date === DAY && row.teamAScore !== undefined);
    expect(game).toHaveLength(1);
    expect(between(pool, stixId, pulled(pool, "bKpjvY5AVqOV")!.id)).toHaveLength(1);
  });
});

describe("squads told apart by a number", () => {
  it("does not read two numbered squads as one name", () => {
    expect(nameFitsWithin("Xposure Warriors 3", "Xposure Warriors 1")).toBe(false);
    expect(nameFitsWithin("Warriors3", "Xposure Warriors 1")).toBe(false);
    expect(nameFitsWithin("Hawks 2", "Ohio Hawks 1")).toBe(false);
    expect(nameFitsWithin("STX Showtime 2032", "STX Showtime 2033")).toBe(false);
  });

  it("still reads a number on one side only as a shorthand", () => {
    expect(nameFitsWithin("Headlines1", "Headlines 9U Nagel")).toBe(true);
    expect(nameFitsWithin("Warriors", "Xposure Warriors 1")).toBe(true);
    // The same number on both sides is the same squad.
    expect(nameFitsWithin("Warriors 1", "Xposure Warriors 1")).toBe(true);
  });

  it("does not join two numbered squads that never met", () => {
    /*
     * Ohio Hawks 1 beat somebody written "Xposure Warriors 3" 10-0 at two; Xposure Warriors 1
     * lost 0-10 to somebody written "Hawks 2" at five. The words fit, the states border and the
     * results mirror, and there is one candidate each way — the squad numbers are all that say
     * these are two games, since the join does not read the clock of two results that mirror.
     */
    const pool = tidyPool(
      fold([
        club("gcHAWKS00001", "Ohio Hawks 1", "OH", [
          played("h1", "Xposure Warriors 3", DAY, 10, 0, "2026-09-20T18:00:00.000Z"),
        ]),
        club("gcWARRIOR001", "Xposure Warriors 1", "KY", [
          played("w1", "Hawks 2", DAY, 0, 10, "2026-09-20T21:00:00.000Z"),
        ]),
      ])
    ).state;
    const a = pulled(pool, "gcHAWKS00001")!.id;
    const b = pulled(pool, "gcWARRIOR001")!.id;
    expect(between(pool, a, b)).toEqual([]);
  });
});

describe("a namesake a squad older", () => {
  /*
   * The Stix (9U) filed a 13-2 win over "Hurricanes", which went by name to Toledo's 9U Hurricanes.
   * A "Hurricanes 12U" lost 2-13 to a "Stix" at the same time — its own game, against the Stix's
   * 12U squad. Its row fits the reclaim's shorthand and mirrors, but a 12U club is no home for a 9U
   * game: taking it there set the reclaim and the level step handing the row back and forth every
   * pass until the tidy stopped at its limit.
   */
  it("leaves the row where it is, and the tidy settles", () => {
    const T = "2026-09-20T17:00:00.000Z";
    const folded = fold([
      club("gcTOLEDOHUR1", "Hurricanes 9U", "OH", [
        played("t-0913", "Mud Hens 9U", "2026-09-13", 4, 3),
      ]),
      club("tu9c21dMzowB", "Cincy Stix 9U Navy", "OH", [
        played("s-0920", "Hurricanes", DAY, 13, 2, T),
      ]),
      club("gcHUR12U0001", "Hurricanes 12U", "OH", [played("h12-0920", "Stix", DAY, 2, 13, T)], {
        ageLevel: 12,
      }),
    ]);
    const out = tidyPool(folded);
    expect([out.reclaimed, out.resettled, out.passes]).toEqual([0, 0, 1]);
    const twelve = pulled(out.state, "gcHUR12U0001")!.id;
    const stixId = pulled(out.state, "tu9c21dMzowB")!.id;
    expect(between(out.state, stixId, twelve)).toEqual([]);
  });
});
