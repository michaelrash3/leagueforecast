import { describe, expect, it } from "vitest";
import {
  dedupeLeagueFixtures,
  leagueStandIns,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * A league game and a club's own copy of it, on two pages of one squad year.
 *
 * The case that found it: the Cincinnati Hornets' fall team is on GameChanger as "Cincinnati
 * Hornets *Fall Ball*", listed at 8U, so every row its schedule holds is filed on the 8U page,
 * while the league plays 9U. The rating is fitted over the whole year, so a copy on the 8U page is
 * the league's game counted again, and the collapse only ever looked on the league's own page. With
 * the league's Hornets linked to the fall team in Settings, the 18:40 pool's 13-0 of 25 September
 * counted twice for both clubs, and once October is played so would the 2 and 30 October games.
 */
const groups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", seasonIds: ["default"], ageLevel: 9, year: 2027 },
  { id: "ag8", name: "8U 2027", seasonIds: [], ageLevel: 8, year: 2027 },
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  { id: "ag8old", name: "8U 2026", seasonIds: [], ageLevel: 8, year: 2026 },
];
const pulled = (id: string, name: string, gcId: string, ageGroupId: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: gcId, name, ageGroupId }],
});
const teams: ScoutTeam[] = [
  pulled("S-FALL", "Cincinnati Hornets *Fall Ball*", "gcFALL", "ag8"),
  pulled("S-YEAG", "Yeager Dreyer", "gcYEAG", "ag9"),
  { id: "S-TBD", name: "TBD- 10/02/26, 9:00 PM", placeholder: true },
];
const row = (
  id: string,
  ageGroupId: string,
  a: string,
  b: string,
  sa: number,
  sb: number,
  schedule?: string
): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: a,
  teamBId: b,
  date: "2026-10-02",
  teamAScore: sa,
  teamBScore: sb,
  ...(schedule ? { source: { kind: "gamechanger" as const, teamId: schedule, gameId: id } } : {}),
});
/** The league's copy, on its own page: away Yeager 5, home the Hornets 3. */
const league = row("league_default_m7", "ag9", "S-YEAG", "S-FALL", 5, 3);
/** The Hornets' own copy, where their listing is. */
const ownCopy = row("gc_fall_1", "ag8", "S-FALL", "S-YEAG", 3, 5, "gcFALL");
const collapse = (games: ScoutGame[]) => dedupeLeagueFixtures(games, leagueStandIns(teams, groups));

describe("a league game's copy on another page of the year", () => {
  it("is one game with the league's", () => {
    expect(collapse([league, ownCopy])).toEqual([league]);
  });

  it("is one game when the copy is filed against a slot", () => {
    const againstSlot = row("gc_fall_2", "ag8", "S-FALL", "S-TBD", 3, 5, "gcFALL");
    expect(collapse([league, againstSlot])).toEqual([league]);
  });

  it("is still a game of its own in another squad year", () => {
    const lastYear = { ...ownCopy, ageGroupId: "ag8old" };
    expect(collapse([league, lastYear])).toEqual([league, lastYear]);
  });

  it("is looked for page by page when the pages are not given, as the forecast reads it", () => {
    expect(dedupeLeagueFixtures([league, ownCopy], leagueStandIns(teams))).toEqual([
      league,
      ownCopy,
    ]);
  });

  it("is one fit a year when pages of two years claim the league's season", () => {
    // Carried onto a page of each year under one id, the league's game is dated into each; each
    // year's slot copy fits its own year's once. Read by the id alone, the two copies were two fits
    // of one league game, and neither was paired.
    const twoYears: AgeGroup[] = [
      ...groups,
      { id: "ag9next", name: "9U 2028", seasonIds: ["default"], ageLevel: 9, year: 2028 },
      { id: "ag8next", name: "8U 2028", seasonIds: [], ageLevel: 8, year: 2028 },
    ];
    const nextYear = { ...league, ageGroupId: "ag9next", date: "2027-10-02" };
    const slotNow = row("gc_fall_2", "ag8", "S-FALL", "S-TBD", 3, 5, "gcFALL");
    const slotNext = {
      ...row("gc_fall_3", "ag8next", "S-FALL", "S-TBD", 3, 5, "gcFALL"),
      date: "2027-10-02",
    };
    expect(
      dedupeLeagueFixtures([league, nextYear, slotNow, slotNext], leagueStandIns(teams, twoYears))
    ).toEqual([league, nextYear]);
  });

  it("is one fit when the league's season is on two pages of the year", () => {
    // A season two pages claim is carried onto both under one id; the slot copy fits it once.
    const onTen = { ...league, ageGroupId: "ag10" };
    const againstSlot = row("gc_fall_2", "ag8", "S-FALL", "S-TBD", 3, 5, "gcFALL");
    expect(collapse([league, onTen, againstSlot])).toEqual([league, onTen]);
  });
});
