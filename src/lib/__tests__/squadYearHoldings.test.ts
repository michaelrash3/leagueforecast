import { describe, expect, it } from "vitest";
import { squadYearHoldings } from "../poolHealth";

/**
 * A pull started from the Import section once wrote an empty pool over every squad year it did not
 * itself refetch. Nothing said so: the pull reported success, the year on screen looked right, and
 * a year nobody had opened lately was simply gone.
 *
 * What makes it findable is that the two halves of the pool disagree. Emptying a year drops it
 * from storage rather than writing it empty, so the games alone cannot say a year is missing —
 * there is nothing left to look at. The age groups survive, and they are the record that the year
 * existed and was pulled.
 */
const page = (id: string, year?: number) => ({ id, ...(year === undefined ? {} : { year }) });
const linked = (...ageGroupIds: string[]) => ({
  gcTeams: ageGroupIds.map((id) => ({ ageGroupId: id })),
});

describe("what each squad year holds", () => {
  it("flags a year whose pages and teams are there but whose games are gone", () => {
    const holdings = squadYearHoldings(
      [page("a", 2027), page("b", 2028)],
      [linked("a"), linked("b")],
      // 2028 is absent entirely, which is how an emptied year looks.
      [{ year: 2027, games: 120 }]
    );

    expect(holdings.map((h) => [h.year, h.emptied])).toEqual([
      [2027, false],
      [2028, true],
    ]);
  });

  it("says nothing about a year whose pages were made but never pulled", () => {
    const holdings = squadYearHoldings(
      [page("a", 2027), page("new", 2029)],
      // Nothing is linked to the 2029 page, so it has no games because it never had any.
      [linked("a")],
      [{ year: 2027, games: 120 }]
    );

    expect(holdings.find((h) => h.year === 2029)?.emptied).toBe(false);
  });

  it("counts a team once per year however many of that year's pages it is on", () => {
    const holdings = squadYearHoldings(
      [page("10u", 2027), page("12u", 2027)],
      [linked("10u", "12u")],
      [{ year: 2027, games: 4 }]
    );

    expect(holdings[0]?.teams).toBe(1);
    expect(holdings[0]?.pages).toBe(2);
  });

  it("keeps the pages with no year together, and puts them last", () => {
    const holdings = squadYearHoldings(
      [page("undated"), page("a", 2028), page("b", 2027)],
      [linked("undated"), linked("a"), linked("b")],
      [
        { year: 2027, games: 5 },
        { year: 2028, games: 6 },
        { year: undefined, games: 7 },
      ]
    );

    expect(holdings.map((h) => h.year)).toEqual([2027, 2028, undefined]);
    expect(holdings[2]?.games).toBe(7);
  });

  it("reports a year that holds games but has lost its pages, without calling it emptied", () => {
    const holdings = squadYearHoldings([], [], [{ year: 2027, games: 9 }]);

    // The games are the thing that matters and they are still there; a missing page is a
    // different problem, and calling it this one would be a false alarm.
    expect(holdings).toEqual([{ year: 2027, pages: 0, teams: 0, games: 9, emptied: false }]);
  });

  it("has nothing to say about an empty pool", () => {
    expect(squadYearHoldings([], [], [])).toEqual([]);
  });
});
