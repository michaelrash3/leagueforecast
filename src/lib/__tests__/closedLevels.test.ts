import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, mulberry32, poolFixture } from "../../../scripts/poolFixture";
import { buildOpponentAdjustedRatings } from "../powerRating";
import { dayInstant } from "../ratingRecency";
import { CLOSED_START_RUNS, startingShare } from "../scheduleCommunities";
import {
  CLOSED_LEVEL_WEEKS,
  clearlyBetterBar,
  closedLevelCuts,
  closedLevelErrors,
  compareClosedLevels,
  isClearlyBetter,
  judgeClosedLevels,
  MIN_PAIRED_GAMES,
} from "../scoutBacktest";
import {
  discountAbout,
  discountMiddle,
  fitScoutYear,
  RATING_CAP,
  ratedMargin,
  scoutRatingGames,
  yearFitGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * The weekly re-measure of where a rating starts (`compareClosedLevels`): the level a club whose
 * league plays nobody outside itself starts at, read again off the last four weeks and judged
 * against the held `CLOSED_START_RUNS` by the rule the age gap and the cap are judged by.
 *
 * On the owner's backup of 11 October 2026 it gives measure5's numbers to the sixth place: −1.7417
 * ± 0.1628 on 79,981 games in 10,590 clusters, weeks of 19,710, 25,909, 27,834 and 6,528 games
 * scored with −1.8923, −1.6357, −1.6999 and −1.7444, and 0.000102 ± 0.000133 runs a game worse
 * than −1.6 (z −0.77), so not clearly better. That backup is the owner's and stays out of the
 * repository; these are made-up pools.
 */

const tenU: AgeGroup[] = [
  { id: "ag_10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const DAY = 86_400_000;
/** Day `offset` of a season that starts on Monday 3 August 2026; 14 September is day 42. */
const dayOf = (offset: number): string =>
  new Date(Date.UTC(2026, 7, 3) + offset * DAY).toISOString().slice(0, 10);
/** The Monday after the season's tenth week: the four weeks before it are 14 September to 11 October. */
const MONDAY = "2026-10-12";

/**
 * A pool with a level planted in it: thirty well-connected clubs of strength −3 to +3, and
 * twenty-four leagues of five clubs each `level` runs below them, give or take one, that play
 * only each other until one of the four weeks, a league to each in turn, and then an outsider
 * every third day as well. Margins are the strengths' difference and a normal error of 2.5 runs.
 */
const plantedPool = (level: number, seed: number): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  const random = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const teams: ScoutTeam[] = [];
  const strength = new Map<string, number>();
  const core: string[] = [];
  for (let at = 0; at < 30; at += 1) {
    const id = `C-${at}`;
    teams.push({ id, name: `Core ${at}` });
    strength.set(id, (random() - 0.5) * 6);
    core.push(id);
  }
  const leagues: string[][] = [];
  for (let league = 0; league < 24; league += 1) {
    const clubs: string[] = [];
    for (let at = 0; at < 5; at += 1) {
      const id = `L-${league}-${at}`;
      teams.push({ id, name: `League ${league} club ${at}` });
      strength.set(id, level + (random() - 0.5) * 2);
      clubs.push(id);
    }
    leagues.push(clubs);
  }
  const games: ScoutGame[] = [];
  const play = (a: string, b: string, day: number) => {
    const margin = Math.round(strength.get(a)! - strength.get(b)! + 2.5 * normal());
    games.push({
      id: `g${games.length}`,
      ageGroupId: "ag_10",
      teamAId: a,
      teamBId: b,
      teamAScore: 6 + Math.max(0, margin),
      teamBScore: 6 + Math.max(0, -margin),
      date: dayOf(day),
    });
  };
  for (let day = 0; day < 70; day += 1) {
    for (let n = 0; n < 6; n += 1) {
      const a = pick(core);
      let b = pick(core);
      while (b === a) b = pick(core);
      play(a, b, day);
    }
    leagues.forEach((clubs, league) => {
      if ((day + league) % 3 !== 0) return;
      const a = pick(clubs);
      let b = pick(clubs);
      while (b === a) b = pick(clubs);
      play(a, b, day);
      if (day >= 42 + 7 * (league % 4)) play(pick(clubs), pick(core), day);
    });
  }
  return { teams, games };
};

describe("the starting level's weekly re-measure", () => {
  it("reads the four weeks before the day it is asked on, Monday to Sunday from a Monday", () => {
    const { teams, games } = plantedPool(-1.6, 1);
    const check = compareClosedLevels("ag_10", teams, games, tenU, MONDAY)!;

    expect(check.weeks.map(({ from, to }) => [from, to])).toEqual([
      ["2026-09-14", "2026-09-20"],
      ["2026-09-21", "2026-09-27"],
      ["2026-09-28", "2026-10-04"],
      ["2026-10-05", "2026-10-11"],
    ]);
    expect(check.weeks).toHaveLength(CLOSED_LEVEL_WEEKS);
    expect(check.games).toBe(check.weeks.reduce((sum, week) => sum + week.games, 0));
    expect(check.held).toBe(CLOSED_START_RUNS);
  });

  it("names a level clearly better when the closed leagues are far below where they start", () => {
    // Planted six runs down, the weeks read −7.11 ± 0.66, and scored a week at a time with the
    // other weeks' level, 0.129 ± 0.034 runs a game better than −1.6: z 3.8 against a bar of 2.
    const { teams, games } = plantedPool(-6, 1);
    const check = compareClosedLevels("ag_10", teams, games, tenU, MONDAY)!;

    expect(check.level!).toBeLessThan(-5);
    expect(check.paired!.by).toBeGreaterThan(clearlyBetterBar(1) * check.paired!.standardError);
    expect(check.paired!.samples).toBe(check.games);
    expect(check.better).toBe(true);
  });

  it("names none when the leagues are where the held level starts them", () => {
    // Planted at −1.6, the weeks read −1.54 ± 0.66, and scored apart 0.0025 ± 0.0029 runs worse.
    const { teams, games } = plantedPool(-1.6, 1);
    const check = compareClosedLevels("ag_10", teams, games, tenU, MONDAY)!;

    expect(Math.abs(check.level! - CLOSED_START_RUNS)).toBeLessThan(2 * check.standardError!);
    expect(check.better).toBe(false);
  });

  it("scores each week with the level the other weeks read, never its own", () => {
    const { teams, games } = plantedPool(-6, 2);
    const cuts = closedLevelCuts("ag_10", teams, games, tenU, MONDAY)!;
    const check = judgeClosedLevels(cuts);

    cuts.forEach((cut, at) => {
      expect(check.weeks[at]!.level).toBe(judgeClosedLevels(cuts.filter((c) => c !== cut)).level);
    });
    // Each week's own games move the level read, so the four differ from the one read off all.
    expect(new Set(check.weeks.map((week) => week.level)).size).toBe(CLOSED_LEVEL_WEEKS);
    expect(check.weeks.every((week) => week.level !== check.level)).toBe(true);
  });

  it("says so when the weeks hold no games, rather than naming a level", () => {
    const { teams, games } = plantedPool(-6, 1);
    const early = games.filter((game) => (game.date ?? "") < "2026-09-14");
    const check = compareClosedLevels("ag_10", teams, early, tenU, MONDAY)!;

    expect(check.games).toBe(0);
    expect(check.level).toBeNull();
    expect(check.paired).toBeNull();
    expect(check.better).toBe(false);
  });

  it("has nothing to say for a page too young to rank, or a day it cannot read", () => {
    const young: AgeGroup[] = [{ ...tenU[0]!, ageLevel: 7, name: "7U 2027" }];
    const { teams, games } = plantedPool(-1.6, 1);
    expect(compareClosedLevels("ag_10", teams, games, young, MONDAY)).toBeNull();
    expect(compareClosedLevels("ag_10", teams, games, tenU, "12 October")).toBeNull();
  });
});

describe("the fit at any level, from one more solve", () => {
  /*
   * The seeded fixture's 10U 2027 page, 3,034 clubs with stand-ins, cross-age games and leagues
   * with games outside themselves: each week's errors at a level, as the re-measure reads them off
   * the held fit and its response, against the errors of a fit made afresh with every start at
   * that level, its evidence discount read at its own residual scale, as `fitScoutYear` reads it.
   */
  const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
  const page = "ag_10u_2027";
  const cuts = closedLevelCuts(
    page,
    fixture.teams,
    fixture.games,
    fixture.ageGroups,
    FIXTURE_TODAY
  )!;
  const rated = scoutRatingGames(
    page,
    fixture.teams,
    fixture.games,
    fixture.ageGroups,
    undefined,
    FIXTURE_TODAY
  );
  const end = dayInstant(FIXTURE_TODAY);

  /** Week `week`'s errors with every start at `level`, from a fit made afresh. */
  const refitted = (week: number, level: number): number[] => {
    const cutAt = end - (CLOSED_LEVEL_WEEKS - week) * 7 * DAY;
    const train = rated.filter(({ game }) => dayInstant(game.date) < cutAt);
    const held = fitScoutYear(2027, fixture.teams, fixture.games, train, fixture.ageGroups);
    const ids = held.nodes.map((team) => team.id);
    const starts = new Map<string, number>();
    held.communities.of.forEach((community, id) =>
      starts.set(id, level * startingShare(held.communities.outside[community] ?? 0))
    );
    const fit = buildOpponentAdjustedRatings(ids, yearFitGames(train), {
      cap: RATING_CAP,
      priorCentre: starts,
    });
    const clubs = held.nodes.filter((team) => !team.placeholder && !team.nameOnly);
    const shown = discountAbout(
      discountMiddle(
        { games: held.effective, residualScale: fit.residualScale },
        clubs.map((team) => team.id)
      ),
      fit.residualScale
    );
    const rating = (id: string) => shown(fit.ratings.get(id) ?? 0, held.effective.get(id) ?? 0);
    const known = new Set(ids);
    return rated
      .filter(({ game }) => {
        const at = dayInstant(game.date);
        return at >= cutAt && at < cutAt + 7 * DAY;
      })
      .filter(({ game }) => known.has(game.teamAId) && known.has(game.teamBId))
      .map(({ game, ageGap }) =>
        Math.abs(
          rating(game.teamAId) -
            rating(game.teamBId) +
            ageGap * fit.ageGapRuns -
            Math.max(-RATING_CAP, Math.min(RATING_CAP, ratedMargin(game)!))
        )
      );
  };

  it("scores the held level as the board showed it", () => {
    cuts.forEach((cut) => {
      const errors = closedLevelErrors(cut, CLOSED_START_RUNS);
      errors.forEach((error, at) => expect(error).toBeCloseTo(cut.heldError[at]!, 5));
    });
  });

  it("matches a fit made afresh at no start and at a deeper one", () => {
    expect(cuts.every((cut) => cut.x.length > 0)).toBe(true);
    [0, -4].forEach((level) => {
      [0, CLOSED_LEVEL_WEEKS - 1].forEach((week) => {
        const fresh = refitted(week, level);
        const read = closedLevelErrors(cuts[week]!, level);
        expect(read.length).toBe(fresh.length);
        fresh.forEach((error, at) => expect(read[at]!).toBeCloseTo(error, 5));
      });
    });
  });
});

describe("the re-measure's answer on the seeded fixture, pinned", () => {
  it("is the answer it was", () => {
    // Taken when the re-measure was written, on 17 October 2026: 479 games in the four weeks to
    // 14 April 2027, too few to read a level to better than a run and a third.
    const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
    const check = compareClosedLevels(
      "ag_10u_2027",
      fixture.teams,
      fixture.games,
      fixture.ageGroups,
      FIXTURE_TODAY
    )!;
    expect(check.level!).toBeCloseTo(-0.4514346715266759, 9);
    expect(check.standardError!).toBeCloseTo(1.3081733935301154, 9);
    expect([check.games, check.clusters]).toEqual([479, 335]);
    expect(check.weeks.map((week) => week.games)).toEqual([139, 68, 129, 143]);
    [-1.3560186990096326, -0.5108054000793136, -0.516045532200112, 0.9151712426581926].forEach(
      (level, at) => expect(check.weeks[at]!.level!).toBeCloseTo(level, 9)
    );
    expect(check.paired!.by).toBeCloseTo(-0.008450586749299086, 9);
    expect(check.paired!.standardError).toBeCloseTo(0.01002871596338563, 9);
    expect(check.paired!.samples).toBe(479);
    expect(check.better).toBe(false);
  });
});

describe("what clearly better means", () => {
  it("wants enough games, a lower error, and more than the bar for the rivals tried", () => {
    const bar = clearlyBetterBar(1);
    const reading = (by: number, samples = MIN_PAIRED_GAMES) => ({
      by,
      standardError: 0.1,
      samples,
    });
    expect(isClearlyBetter(reading(bar * 0.1 + 1e-9), 1)).toBe(true);
    expect(isClearlyBetter(reading(bar * 0.1 - 1e-9), 1)).toBe(false);
    expect(isClearlyBetter(reading(1, MIN_PAIRED_GAMES - 1), 1)).toBe(false);
    expect(isClearlyBetter(reading(-1), 1)).toBe(false);
    expect(isClearlyBetter(null, 1)).toBe(false);
    // Two rivals share chance between them, so the same reading can clear one bar and not two.
    expect(isClearlyBetter(reading(0.21), 1)).toBe(true);
    expect(isClearlyBetter(reading(0.21), 2)).toBe(false);
  });
});
