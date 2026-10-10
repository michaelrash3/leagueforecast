import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, fingerprint, poolFixture } from "../../../scripts/poolFixture";
import {
  discountAbout,
  discountMiddle,
  evidenceDiscount,
  fitScoutYear,
  fitScoutYearFor,
  ratingFilter,
  scoutFitYear,
  scoutRatingGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "../teamRankings";

/**
 * What a year's fit keeps for working out what each of a club's games did to its rating: the games
 * it read and the centre of its discount, and the pieces of the selection and the discount those
 * come from, split out so a device can ask the same questions of one club's games.
 *
 * Pinned on the seeded fixture (`scripts/poolFixture.ts`), with every pinned number taken before
 * the split, so the split is seen to move nothing.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const { teams, games, ageGroups } = fixture;
const SPANS: ReadonlyArray<SeasonSegment | undefined> = [undefined, "fall", "spring"];
const isClub = (team: ScoutTeam) => !team.placeholder && !team.nameOnly;

describe("a year's fit", () => {
  const page = "ag_10u_2027";
  const fit = fitScoutYearFor(page, teams, games, ageGroups, undefined, FIXTURE_TODAY);
  if (!fit) throw new Error("the fixture's 10U page has a table");

  it("keeps its discount's centre and discounts as it did, to the last digit", () => {
    /*
     * Taken before `evidenceDiscount` was split into its centre and the discount about it, from the
     * same fit, and the same on Node 22, Node 24 and Bun. The three clubs are this year's thinnest,
     * a middling and its thickest record on the page (1, 5 and 26 games), so the discount is seen
     * cutting a rating by 0.45, lifting one by 0.05 and lifting one by 0.45.
     */
    expect(fit.middle).toBe(0.8515232099323854);
    const shown = (teamId: string) =>
      fit.confident(fit.adjusted.ratings.get(teamId) ?? 0, fit.effective.get(teamId) ?? 0);
    expect(shown("S-10u_2027-0245")).toBe(-0.2623082623511376);
    expect(shown("S-10u_2027-0182")).toBe(-1.658437397915415);
    expect(shown("S-10u_2027-0246")).toBe(-2.1253576949313375);
  });

  it("keeps the centre its discount is about, over the year's clubs", () => {
    const clubIds = fit.nodes.filter(isClub).map((team) => team.id);
    const scale = { games: fit.effective, residualScale: fit.adjusted.residualScale };
    expect(fit.middle).toBe(discountMiddle(scale, clubIds));
    // Not every node's: two thirds of a real year's nodes are stand-ins and name-only clubs.
    expect(fit.middle).not.toBe(discountMiddle(scale));
  });

  it("keeps the very games it was handed, not a copy of them", () => {
    const rated = scoutRatingGames(page, teams, games, ageGroups, undefined, FIXTURE_TODAY);
    const again = fitScoutYear(scoutFitYear(page, ageGroups), teams, games, rated, ageGroups);
    expect(again.rated).toBe(rated);
    // And the fit a page is cut from read the same games, in the same order.
    expect(fit.rated.map(({ game }) => game)).toEqual(rated.map(({ game }) => game));
    expect(fit.rated.map(({ ageGap }) => ageGap)).toEqual(rated.map(({ ageGap }) => ageGap));
  });
});

describe("the discount, in two parts", () => {
  const pool = {
    games: new Map([
      ["thin", 2],
      ["mid", 9],
      ["thick", 31],
      ["slot", 1],
    ]),
    residualScale: 3.4,
  };
  const cases: Array<[number, number]> = [
    [0, 0],
    [2.5, 2],
    [-1.25, 9],
    [4, 31],
    [0.5, 120],
  ];

  it("is the centre and the discount about it, composed, on every input", () => {
    [undefined, ["thin", "mid", "thick"], ["mid", "missing"]].forEach((centreOn) => {
      const whole = evidenceDiscount(pool, centreOn);
      const parts = discountAbout(discountMiddle(pool, centreOn), pool.residualScale);
      cases.forEach(([rating, played]) =>
        expect(parts(rating, played)).toBe(whole(rating, played))
      );
    });
    // The shrinkage and the number of standard errors reach both parts.
    const whole = evidenceDiscount(pool, undefined, 2.5, 1);
    const parts = discountAbout(discountMiddle(pool, undefined, 2.5), pool.residualScale, 2.5, 1);
    cases.forEach(([rating, played]) => expect(parts(rating, played)).toBe(whole(rating, played)));
  });

  it("leaves a rating alone where the spread is not a number, as it always has", () => {
    // No ridge and no games: an infinite spread says nothing either way.
    const about = discountAbout(discountMiddle(pool, undefined, 0), pool.residualScale, 0);
    expect(about(1.75, 0)).toBe(1.75);
    expect(discountMiddle({ games: new Map(), residualScale: 3 })).toBe(0);
  });
});

describe("the selection, in two parts", () => {
  it("rates the same games on every page and half as before the split", () => {
    // Taken before `ratingFilter` was split out of `scoutRatingGames`: 68,004 rated entries over
    // 11 pages and 3 spans, 4,845 of them across ages.
    const selected = ageGroups.flatMap((group: AgeGroup) =>
      SPANS.map((segment) => ({
        page: group.id,
        half: segment ?? "year",
        rated: scoutRatingGames(group.id, teams, games, ageGroups, segment, FIXTURE_TODAY).map(
          ({ game, ageGap }) => [game.id, ageGap]
        ),
      }))
    );
    expect(selected.reduce((sum, { rated }) => sum + rated.length, 0)).toBe(68004);
    expect(fingerprint(selected)).toBe("6866a45f");
  });

  it("asks of one game what the selection asks of the pool, less the roster", () => {
    ageGroups.forEach((group) =>
      SPANS.forEach((segment) => {
        const rates = ratingFilter(group.id, ageGroups, segment, FIXTURE_TODAY);
        const roster = new Set(teams.map((team) => team.id));
        const oneByOne = games
          .filter((game) => rates.counts(game) && roster.has(game.teamAId))
          .filter((game) => roster.has(game.teamBId))
          .map((game) => ({ game, ageGap: rates.ageGap(game) }));
        expect(oneByOne).toEqual(
          scoutRatingGames(group.id, teams, games, ageGroups, segment, FIXTURE_TODAY)
        );
      })
    );
  });

  it("counts a game whose side the roster does not hold, which only the pool can know", () => {
    const groups: AgeGroup[] = [
      { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
    ];
    const known: ScoutTeam[] = [{ id: "A", name: "Club A" }];
    const game: ScoutGame = {
      id: "g1",
      ageGroupId: "u10",
      teamAId: "A",
      teamBId: "B",
      teamAScore: 5,
      teamBScore: 3,
      date: "2026-09-12",
    };
    expect(ratingFilter("u10", groups, undefined, "2026-10-01").counts(game)).toBe(true);
    expect(scoutRatingGames("u10", known, [game], groups, undefined, "2026-10-01")).toEqual([]);
    // Played after the day asked about, it does not count yet; in the other half, not at all.
    expect(ratingFilter("u10", groups, undefined, "2026-09-01").counts(game)).toBe(false);
    expect(ratingFilter("u10", groups, "spring", "2026-10-01").counts(game)).toBe(false);
  });

  it("reads the age gap with side A in the home seat, and 0 where a level is unknown", () => {
    const groups: AgeGroup[] = [
      { id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
      { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
    ];
    const rates = ratingFilter("u10", groups, undefined, "2026-10-01");
    const game: ScoutGame = {
      id: "g1",
      ageGroupId: "u10",
      teamAId: "A",
      teamBId: "B",
      teamAScore: 5,
      teamBScore: 3,
      date: "2026-09-12",
    };
    expect(rates.ageGap({ ...game, ageLevelA: 9 })).toBe(-1);
    expect(rates.ageGap({ ...game, ageLevelB: 9 })).toBe(1);
    expect(rates.ageGap(game)).toBe(0);
    expect(rates.ageGap({ ...game, ageGroupId: "elsewhere", ageLevelA: 9 })).toBe(0);
  });
});
