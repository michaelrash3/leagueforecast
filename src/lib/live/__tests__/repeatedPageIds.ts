import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings";

/*
 * Pages whose id a hand-edited restore repeats. Ids are minted unique, but a restore can repeat
 * one, and its readers then read different copies: the page and its request the first
 * (`ageGroups.find`), the fit a page's level and year the last (`indexGroups`). The board parity
 * tests hold the boards to the worker's on these, and the leaders with few outside games hold their
 * boards to the published ones, from one list so neither can drift from the other unseen.
 */

/** The clubs every case plays, each with a state so the boards' places are read for one. */
export const REPEAT_TEAMS: ScoutTeam[] = [
  { id: "A", name: "Club A", state: "OH" },
  { id: "B", name: "Club B", state: "OH" },
  { id: "C", name: "Club C", state: "KY" },
  { id: "D", name: "Club D", state: "KY" },
];

const played = (id: string, ageGroupId: string, pair: string, date: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: pair[0] ?? "",
  teamBId: pair[1] ?? "",
  teamAScore: 7,
  teamBScore: 4,
  date,
});

const page = (
  id: string,
  ageLevel: number,
  year: number,
  more: Partial<AgeGroup> = {}
): AgeGroup => ({
  id,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
  ...more,
});

const thisYear = [
  played("a", "d9", "AB", "2027-03-07"),
  played("b", "d9", "BC", "2027-03-07"),
  played("c", "d10", "CA", "2027-03-07"),
  played("d", "d10", "DA", "2027-03-14"),
];

/**
 * Each case: what it is, the pages as a restore lists them, the games, and the pages whose year
 * boards have rows.
 */
export type RepeatCase = [string, AgeGroup[], ScoutGame[], string[]];

export const REPEAT_CASES: RepeatCase[] = [
  [
    "with a club of its own, which the page's first copy does not name",
    [page("d9", 9, 2027), page("d10", 10, 2027), page("d9", 9, 2027, { myTeamId: "B" })],
    thisYear,
    ["d9", "d10"],
  ],
  [
    "too young to rank, after the copy that is not",
    [page("d9", 9, 2027), page("d10", 10, 2027), page("d9", 8, 2027)],
    thisYear,
    ["d10"],
  ],
  [
    "old enough to rank, after the copy that is not",
    [page("d9", 8, 2027), page("d9", 9, 2027), page("d10", 10, 2027)],
    thisYear,
    ["d9", "d10"],
  ],
  [
    // The fit reads the repeat's year, so the first copy's games fall outside it: no rows,
    // from the worker as from the builder.
    "in another squad year",
    [page("d10", 10, 2027), page("e10", 10, 2026), page("d10", 10, 2026)],
    [
      played("a", "d10", "AB", "2027-03-07"),
      played("b", "d10", "BC", "2027-03-07"),
      played("c", "e10", "CD", "2026-03-07"),
      played("d", "e10", "DA", "2026-03-14"),
    ],
    ["e10"],
  ],
  [
    // Listed in last year's rating pool, which names the repeat, but asked with its own.
    "in another squad year, whose pool names it first",
    [page("e10", 10, 2026), page("d10", 10, 2027), page("d10", 10, 2026)],
    [
      played("a", "d10", "AB", "2027-03-07"),
      played("b", "d10", "BC", "2027-03-07"),
      played("c", "e10", "CD", "2026-03-07"),
      played("d", "e10", "DA", "2026-03-14"),
    ],
    ["e10"],
  ],
  [
    // One pool, two fits: the repeat's year for its own page, this year for the other.
    "in another squad year, beside a page of its first copy's year",
    [page("d9", 9, 2027), page("d10", 10, 2027), page("d9", 9, 2026)],
    thisYear,
    ["d9", "d10"],
  ],
  [
    // One pool's pages under the same ids, read from two different years' games.
    "with another page, each repeated in the other's year",
    [page("d9", 9, 2026), page("d10", 10, 2027), page("d9", 9, 2027), page("d10", 10, 2026)],
    [
      played("a", "d9", "AB", "2027-03-07"),
      played("b", "d9", "BC", "2027-03-07"),
      played("c", "d10", "CD", "2026-03-07"),
      played("d", "d10", "DA", "2026-03-14"),
    ],
    ["d9", "d10"],
  ],
  [
    // Two pages with no year, listed in this year's pool by their repeats, each its own pool.
    "with no year, beside another, both repeated in this year",
    [
      page("d10", 10, 2027),
      { id: "u9", name: "Rec 9U", seasonIds: [] },
      { id: "u11", name: "Rec 11U", seasonIds: [] },
      page("u9", 9, 2027),
      page("u11", 11, 2027),
    ],
    [
      played("a", "u9", "AB", "2027-03-07"),
      played("b", "u11", "CD", "2027-03-07"),
      played("c", "d10", "DA", "2027-03-14"),
    ],
    ["d10", "u9", "u11"],
  ],
];
