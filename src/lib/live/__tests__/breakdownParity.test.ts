import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { todayIsoDay } from "../../date";
import { gameBreakdown, type Breakdown } from "../../gameBreakdown";
import { ratingHeadline } from "../gameWords";
import {
  countedInWindow,
  fitScoutYearFor,
  playsItself,
  RATING_CAP,
  ratedMargin,
  ratingFilter,
  ratingSpread,
  rankingPoolGroupIds,
  scoreSeenBy,
  scoutFitYear,
  type AgeGroup,
  type ScoutGame,
  type ScoutYearFit,
  type SeasonSegment,
} from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadNamedAges,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { gamesOnPages, type SeasonReader } from "../allKnown";
import {
  asWorkerSees,
  BOARD_HALVES,
  boardViews,
  buildBoardsAndFacts,
  coerceBoardView,
  type BoardsBuilt,
  type BoardView,
} from "../views/board";
import { cardGamesOf, clubViews } from "../views/clubs";
import { clubBucketOf, clubKey, coerceClubBucket, type ClubBucket } from "../views/clubShape";

/**
 * What each game did, worked out on a device from what a server publishes (`gameBreakdown`), held
 * to the fit the server cut the board from: for every club with a row on every board of the seeded
 * fixture, its lines are exactly the fit's games for it, each played like the fit says, every one a
 * counted row of the club's panel. Boards and cards come from the real builders, stored and read
 * back through the store as a server reads its copy, and reach the device through JSON and their
 * own checks, as a member's device reads them.
 *
 * The device's clock is set past the board's day, beyond games scored ahead of it, so lines worked
 * out by the clock rather than by the board's own day (`BoardFit.day`) would pick games the fit
 * never read.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 120 });
const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};
/** The device's clock: months past the board's day, beyond every game the fixture scored ahead. */
const CLOCK = "2027-07-31";

let ageGroups: AgeGroup[] = [];
let built: BoardsBuilt | undefined;
const boards: Array<{
  year: number | undefined;
  pageId: string;
  segment?: SeasonSegment;
  view: BoardView;
}> = [];
const buckets = new Map<string, ClubBucket>();

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${CLOCK}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  ageGroups = loadAgeGroups();
  built = buildBoardsAndFacts({
    ageGroups,
    teams: loadScoutTeams(),
    gamesOfYear: loadScoutGamesForYear,
    readSeason,
    today: FIXTURE_TODAY,
    past: false,
  });
  for (const { key, value } of boardViews(ageGroups, built)) {
    const view = coerceBoardView(JSON.parse(JSON.stringify(value)));
    if (!view) throw new Error(`board ${key} does not read back`);
    if (!view.fit) continue;
    const [, year, pageId = "", half] = key.split(":");
    const { segment } = BOARD_HALVES.find((span) => span.half === half) ?? {};
    boards.push({
      year: year === "none" ? undefined : Number(year),
      pageId,
      ...(segment ? { segment } : {}),
      view,
    });
  }
  for (const { key, value } of clubViews({ ageGroups, built, namedAges: loadNamedAges() })) {
    const read = coerceClubBucket(JSON.parse(JSON.stringify(value)));
    if (!read) throw new Error(`bucket ${key} does not read back`);
    buckets.set(key, read);
  }
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

/** The fit a board was cut from, fitted again as the builder fits the page's pool, once a pool. */
const fits = new Map<string, ScoutYearFit>();
const fitOf = (year: number | undefined, pageId: string, segment: SeasonSegment | undefined) => {
  const poolIds = rankingPoolGroupIds(pageId, ageGroups);
  const key = JSON.stringify([
    year ?? null,
    poolIds,
    segment ?? null,
    scoutFitYear(pageId, ageGroups),
  ]);
  const held = fits.get(key);
  if (held) return held;
  const known = built?.known.get(year);
  if (!known) throw new Error(`nothing known of ${year}`);
  const pool = asWorkerSees(known.teams, gamesOnPages(known.games, poolIds));
  const fit = fitScoutYearFor(pageId, pool.teams, pool.games, ageGroups, segment, FIXTURE_TODAY);
  if (!fit) throw new Error(`no fit for ${pageId}`);
  fits.set(key, fit);
  return fit;
};

/**
 * The fit's played-like rating for each of its games, from each side, by club, as a list of the
 * game's id and the rating: a list, since a League Standings season two pages claim gives each of
 * its games to both, under one id.
 */
const playedLikeIn = (fit: ScoutYearFit): Map<string, Array<[string, number]>> => {
  const out = new Map<string, Array<[string, number]>>();
  for (const { game, ageGap } of fit.rated) {
    const margin = Math.max(-RATING_CAP, Math.min(RATING_CAP, ratedMargin(game) ?? Number.NaN));
    const y = margin - ageGap * fit.adjusted.ageGapRuns;
    for (const [teamId, opponent, side] of [
      [game.teamAId, game.teamBId, 1],
      [game.teamBId, game.teamAId, -1],
    ] as const) {
      const held = out.get(teamId) ?? [];
      held.push([game.id, (fit.adjusted.ratings.get(opponent) ?? Number.NaN) + side * y]);
      out.set(teamId, held);
    }
  }
  return out;
};

/** A club's card for a squad year, as a device reads it. */
const cardOf = (year: number | undefined, teamId: string) => {
  const card = buckets.get(clubKey(year, clubBucketOf(teamId)))?.clubs[teamId];
  if (!card) throw new Error(`no card for ${teamId} in ${year}`);
  return card;
};

/** Each club with a row on each board, its card, and its lines worked out by `groups`. */
const everyRow = (groups: AgeGroup[]) =>
  boards.flatMap(({ year, pageId, segment, view }) =>
    view.rows.map((row) => {
      const card = cardOf(year, row.teamId);
      const breakdown: Breakdown | null = gameBreakdown({
        teamId: row.teamId,
        games: card.games,
        pageId,
        ageGroups: groups,
        segment,
        board: view,
      });
      return { year, pageId, segment, teamId: row.teamId, card, breakdown };
    })
  );

/**
 * Why a club's lines are not exactly the fit's games for it, each played like the fit's, or null
 * when they are. Each line is matched to a game of the fit's of its id, and that game taken, so a
 * game the fit read twice must have two lines.
 */
const sameAsFit = (entry: ReturnType<typeof everyRow>[number]): string | null => {
  const { year, pageId, segment, teamId, breakdown } = entry;
  const known = built?.known.get(year);
  if (!breakdown || !known) return "no lines";
  const fitted = [...(playedLikeIn(fitOf(year, pageId, segment)).get(teamId) ?? [])];
  const stored = cardGamesOf(known.games, teamId);
  if (breakdown.lines.size !== fitted.length) {
    return `${breakdown.lines.size} lines against the fit's ${fitted.length} games`;
  }
  for (const [place, line] of breakdown.lines) {
    const id = stored[Number(place)]?.id ?? "?";
    const at = fitted.findIndex(
      ([fittedId, playedLike]) => fittedId === id && Math.abs(line.playedLike - playedLike) < 1e-4
    );
    if (at < 0) return `game ${id}, played like ${line.playedLike}, is no game of the fit's`;
    fitted.splice(at, 1);
  }
  return null;
};

describe("what each game did, worked out on a device", { timeout: 60_000 }, () => {
  it("is exactly the fit's games for every club with a row on every board, each played like the fit's", () => {
    expect(todayIsoDay()).toBe(CLOCK);
    expect(boards.length).toBeGreaterThanOrEqual(15);
    const rows = everyRow(ageGroups);
    expect(rows.length).toBeGreaterThan(1000);
    let lines = 0;
    for (const entry of rows) {
      const at = `${entry.teamId} on ${entry.pageId} ${entry.segment ?? "year"}`;
      expect(entry.breakdown, at).not.toBeNull();
      const wrong = sameAsFit(entry);
      if (wrong !== null) expect(wrong, at).toBeNull();
      lines += entry.breakdown?.lines.size ?? 0;
    }
    expect(lines).toBeGreaterThan(5000);
  });

  it("would pick games the fit never read, were it to read the device's clock", () => {
    // Games on row clubs' cards that count by the clock and not by the board's day: scored ahead of
    // the board, and played since. Without them the clock and the day would pick alike.
    let ahead = 0;
    let clubs = 0;
    for (const { year, pageId, segment, view } of boards) {
      const byClock = ratingFilter(pageId, ageGroups, segment, CLOCK);
      const byDay = ratingFilter(pageId, ageGroups, segment, view.fit?.day);
      for (const row of view.rows) {
        const card = cardOf(year, row.teamId);
        const found = card.games.filter((game) => byClock.counts(game) && !byDay.counts(game));
        ahead += found.length;
        if (found.length > 0) clubs += 1;
      }
    }
    expect(ahead).toBeGreaterThan(0);
    expect(clubs).toBeGreaterThan(0);
  });

  it("is drawn only on counted W, L and T rows of the panel's window on the board's day", () => {
    const rows = everyRow(ageGroups);
    vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
    try {
      let checked = 0;
      for (const { segment, teamId, card, breakdown } of rows) {
        for (const place of breakdown?.lines.keys() ?? []) {
          const game: ScoutGame | undefined = card.games[Number(place)];
          const at = `${teamId} game ${place}`;
          if (!game) throw new Error(`no game ${at}`);
          expect(scoreSeenBy(game, teamId), at).toBeDefined();
          expect(game.excluded === true || playsItself(game), at).toBe(false);
          expect(countedInWindow(game, ageGroups, segment), at).toBe(true);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(5000);
    } finally {
      vi.setSystemTime(new Date(`${CLOCK}T12:00:00`));
    }
  });

  /*
   * The line above a club's games says its record makes its rating surer, or less sure, than the
   * average club's. That is the comparison the discount makes: the club's spread against the mean
   * spread over every club the fit rated, on every page of the pool, worked out here from the fit
   * itself. Not most of the board's clubs, which it was first said as: the spread falls ever more
   * slowly as games are added, so the mean sits above the median, and more than half a board can
   * be on the side that gains.
   */
  it("says a record makes a rating surer or less sure than the average club's as the discount compares them", () => {
    let surer = 0;
    let lessSure = 0;
    let moreThanHalf = 0;
    for (const { year, pageId, segment, view } of boards) {
      const fit = fitOf(year, pageId, segment);
      const scale = fit.adjusted.residualScale;
      const spreadOf = (teamId: string) => ratingSpread(fit.effective.get(teamId) ?? 0, scale);
      const clubs = fit.nodes.filter((team) => !team.placeholder && !team.nameOnly);
      const average = clubs.reduce((sum, team) => sum + spreadOf(team.id), 0) / clubs.length;
      let gaining = 0;
      for (const row of view.rows) {
        const said = ratingHeadline(row, { span: "Season", own: false });
        const at = `${row.teamId} on ${pageId} ${segment ?? "year"}: ${said}`;
        if (said.endsWith("because its record makes its rating surer than the average club's.")) {
          surer += 1;
          expect(spreadOf(row.teamId), at).toBeLessThan(average);
        } else if (
          said.endsWith("because its record makes its rating less sure than the average club's.")
        ) {
          lessSure += 1;
          expect(spreadOf(row.teamId), at).toBeGreaterThan(average);
        } else {
          expect(said, at).toMatch(/^Season rating [+-]\d+\.\d, all of it from its games\.$/);
        }
        if (spreadOf(row.teamId) < average) gaining += 1;
      }
      if (gaining * 2 > view.rows.length) moreThanHalf += 1;
    }
    expect(surer).toBeGreaterThan(100);
    expect(lessSure).toBeGreaterThan(100);
    // On 19 of the fixture's 28 boards more than half the clubs gain, which "most" could not say.
    expect(moreThanHalf).toBeGreaterThan(0);
  });

  it.each<[string, (groups: AgeGroup[]) => AgeGroup[]]>([
    [
      "with a page of the pool missing",
      (groups) => groups.filter((group) => group.id !== "ag_12u_2027"),
    ],
    [
      "with a page moved a year on",
      (groups) =>
        groups.map((group) => (group.id === "ag_13u_2027" ? { ...group, year: 2028 } : group)),
    ],
  ])(
    "draws nothing, or exactly the fit's lines, for a device reading groups other than the board's: %s",
    (_case, change) => {
      const rows = everyRow(change(ageGroups));
      let none = 0;
      for (const entry of rows) {
        if (!entry.breakdown) {
          none += 1;
          continue;
        }
        const wrong = sameAsFit(entry);
        if (wrong !== null) expect(wrong, `${entry.teamId} on ${entry.pageId}`).toBeNull();
      }
      // The change reaches clubs, so it is the checks that hold their lines back.
      expect(none).toBeGreaterThan(20);
    }
  );
});
