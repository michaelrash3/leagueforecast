import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, fingerprint, poolFixture } from "../../../scripts/poolFixture";
import { connectedLeagues, plantClosedLeague } from "../../../scripts/closedLeagueFixture";
import { resultsAwareRestart, type ResultsAwareLevel } from "../resultsAwareLevel";
import { startingLevel } from "../scheduleCommunities";
import {
  filterRankingsByState,
  fitScoutYear,
  rowsOfYearFit,
  scoutFitYear,
  scoutRatingGames,
  type AgeGroup,
  type ScoutYearFit,
} from "../teamRankings";

/*
 * A year's fit as the boards make it, pinned on the seeded fixture (`scripts/poolFixture.ts`)
 * before the results-aware league level was added beside it, so the default path is seen to move
 * nothing.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const { teams, games, ageGroups } = fixture;
const PAGE = "ag_9u_2027";
const rated = scoutRatingGames(PAGE, teams, games, ageGroups, undefined, FIXTURE_TODAY);
const year = scoutFitYear(PAGE, ageGroups);

/** Everything a fit hands its boards, every digit of it. */
const everyDigit = (fit: ScoutYearFit) => ({
  ratings: [...fit.adjusted.ratings],
  effective: [...fit.effective],
  middle: fit.middle,
  scale: fit.adjusted.residualScale,
  home: fit.adjusted.homeAdvantage,
  gap: fit.adjusted.ageGapRuns,
  communities: [...fit.communities.of],
  outside: fit.communities.outside,
});

/** The same, its ratings to nine places: what every engine agrees on. */
const steady = (fit: ScoutYearFit) => ({
  ratings: [...fit.adjusted.ratings].map(([id, rating]) => [id, rating.toFixed(9)]),
  middle: fit.middle.toFixed(9),
  communities: [...fit.communities.of],
  outside: fit.communities.outside,
});

/**
 * The fixture's 2027 year fit to the last digit, by the V8 version that drew it: Node 22's and
 * Node 24's round a few ratings apart in the last place, as the boards' pins do
 * (`boardParity.test.ts`). An engine not listed keeps the steady pin.
 */
const DIGIT_PINS: Record<string, string> = { "12.4": "e877d666", "13.6": "fed1add9" };
const engine = (globalThis as { process?: { versions?: { v8?: string } } }).process?.versions?.v8;
const digitPin = DIGIT_PINS[(engine ?? "").split(".").slice(0, 2).join(".")];

describe("a year's fit as the boards make it", () => {
  const fit = fitScoutYear(year, teams, games, rated, ageGroups);

  it("holds still to nine places on every engine", () => {
    expect(fingerprint(steady(fit))).toBe("b07b6ef3");
  });

  it.skipIf(!digitPin)("holds still to the last digit on the engine running", () => {
    expect(fingerprint(everyDigit(fit))).toBe(digitPin);
  });

  it("is the same fit when asked for nothing beyond the boards", () => {
    const asked = fitScoutYear(year, teams, games, rated, ageGroups, {});
    expect(fingerprint(everyDigit(asked))).toBe(fingerprint(everyDigit(fit)));
    expect(asked.startLevels).toBeUndefined();
  });
});

describe("a results-aware league level", () => {
  const PAGE_10U = "ag_10";
  const groups: AgeGroup[] = [
    { id: PAGE_10U, name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  ];
  const core = connectedLeagues({ seed: 11, page: PAGE_10U });
  const planted = plantClosedLeague({ seed: 12, page: PAGE_10U, outsider: core.strongest });
  const poolTeams = [...core.teams, ...planted.teams];
  const poolGames = [...core.games, ...planted.games];
  const poolRated = scoutRatingGames(
    PAGE_10U,
    poolTeams,
    poolGames,
    groups,
    undefined,
    "2026-11-01"
  );
  const fitWith = (rule?: ResultsAwareLevel) =>
    fitScoutYear(
      2027,
      poolTeams,
      poolGames,
      poolRated,
      groups,
      rule && { restart: resultsAwareRestart(rule) }
    );
  const control = fitWith();
  const { best, ids: leagueIds } = planted.league;
  const rowsOf = (fit: ScoutYearFit) => rowsOfYearFit(fit, PAGE_10U, undefined, groups);
  const stateRank = (fit: ScoutYearFit, teamId: string) =>
    filterRankingsByState(rowsOf(fit), poolTeams, "KY").find((row) => row.teamId === teamId)?.rank;
  const point = (fit: ScoutYearFit, teamId: string) => fit.adjusted.ratings.get(teamId) ?? 0;

  it("finds the planted league as a league of its own, with its one outside game", () => {
    const community = control.communities.of.get(best)!;
    expect(leagueIds.every((id) => control.communities.of.get(id) === community)).toBe(true);
    expect(control.communities.outside[community]).toBe(1);
    // As the boards have it: unbeaten, third in its state (+1.62 shown), at the counted level.
    expect(control.records.get(best)).toEqual({ wins: 14, losses: 0, ties: 0 });
    expect(stateRank(control, best)).toBe(3);
    expect(rowsOf(control).find((row) => row.teamId === best)?.levelPrior).toBe(startingLevel(1));
  });

  it("drops the league's best club well below where the counted level puts it", () => {
    /*
     * The rout's residual against the first fit is −6.5 runs (the loser at −2.27, the outsider at
     * +3.18, the margin capped at 12), so at five games of belief the league's level goes from
     * −1.45 to −2.42 and every club of it falls with it: the best by 0.91 runs, from third in its
     * state to eighth, and at two games of belief by 1.87, to twenty-second.
     */
    const aware = fitWith({ kappa: 5 });
    const drop = point(control, best) - point(aware, best);
    expect(drop).toBeGreaterThan(0.75);
    leagueIds.forEach((id) => expect(point(control, id) - point(aware, id)).toBeGreaterThan(0.75));
    expect(stateRank(aware, best)).toBeGreaterThan(5);
    const harder = fitWith({ kappa: 2 });
    expect(point(control, best) - point(harder, best)).toBeGreaterThan(1.5);
    expect(stateRank(harder, best)).toBeGreaterThan(10);
    // The level it started from is on its row, so a device rebuilding its rating reads that one.
    const row = rowsOf(aware).find((entry) => entry.teamId === best)!;
    expect(row.levelPrior).toBe(aware.startLevels?.get(best));
    expect(row.levelPrior!).toBeLessThan(startingLevel(1) - 0.9);
  });

  it("moves less the more outside games' worth of belief the counted level keeps", () => {
    const drops = [2, 5, 10, 20].map(
      (kappa) => point(control, best) - point(fitWith({ kappa }), best)
    );
    drops.slice(1).forEach((drop, at) => expect(drop).toBeLessThan(drops[at]!));
    expect(drops[3]!).toBeGreaterThan(0);
  });

  it("is the boards' fit to the last digit when the counted level keeps all the belief", () => {
    const kept = fitWith({ kappa: Number.POSITIVE_INFINITY });
    expect([...kept.adjusted.ratings]).toEqual([...control.adjusted.ratings]);
    expect(kept.middle).toBe(control.middle);
    expect(control.startLevels).toBeUndefined();
  });

  it("moves only leagues with as few outside games as asked, the rest at the counted level", () => {
    const weakOnly = fitWith({ kappa: 5, maxOutside: 10 });
    const levels = weakOnly.startLevels!;
    let kept = 0;
    weakOnly.communities.of.forEach((community, id) => {
      const outside = weakOnly.communities.outside[community]!;
      if (outside <= 10) return;
      expect(levels.get(id)).toBe(startingLevel(outside));
      kept += 1;
    });
    expect(kept).toBeGreaterThan(100);
    expect(point(control, best) - point(weakOnly, best)).toBeGreaterThan(0.75);
    // With no outside games allowed, the planted league, which has one, is left where it was.
    const closedOnly = fitWith({ kappa: 5, maxOutside: 0 });
    expect(closedOnly.startLevels!.get(best)).toBe(startingLevel(1));
  });
});
