import { describe, expect, it } from "vitest";
import {
  FIXTURE_TODAY,
  fingerprint,
  poolFixture,
  type PoolFixture,
} from "../../../../scripts/poolFixture";
import { NO_REMOVALS } from "../../autoRemoved";
import { ageGroupYear, type ScoutGame } from "../../teamRankings";
import { dateInSquadYear } from "../../teamRankings/seasons";
import { deriveAllKnown, type SeasonReader } from "../allKnown";
import { buildAllBoards, type PageBoard } from "../views/board";

/*
 * League Standings games carry their starts into Team Rankings, and no board reads a start: the
 * seeded fixture's boards, with every league game timed but one, whose pulled copy is, are the
 * boards of the same pool with no start anywhere, to the last digit. The pin below was taken on
 * the code from before the starts were carried, so it also says the change moved no board.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 40 });
/** This year's 10U league, whose first game has a pulled copy filed by its away club. */
const LEAGUE = "fx-10u-fall";
const COPY = "pulled-league-copy";

/** The squad year of the page that claims each season, which places a league's "M/D" dates. */
const yearOfSeason = new Map(
  fixture.ageGroups.flatMap((group) =>
    group.seasonIds.map((seasonId) => [seasonId, ageGroupYear(group)] as const)
  )
);

/**
 * The fixture with a start on every league game, at 3 or 6 PM UTC on its own day, except the first
 * game of the 10U league: its pulled copy carries one instead, and gives that game's score, so the
 * league's row, which the copy folds into, keeps the copy's start.
 */
const timed = (): PoolFixture => {
  const first = fixture.seasons[LEAGUE]?.matchups[0];
  const log = first ? fixture.seasons[LEAGUE]?.logs[first.id] : undefined;
  return {
    ...fixture,
    seasons: Object.fromEntries(
      Object.entries(fixture.seasons).map(([seasonId, season]) => [
        seasonId,
        {
          ...season,
          matchups: season.matchups.map((matchup, at) => {
            const day = dateInSquadYear(matchup.date, yearOfSeason.get(seasonId));
            return seasonId === LEAGUE && at === 0
              ? matchup
              : { ...matchup, startTs: `${day}T${at % 2 ? "15" : "18"}:00:00.000Z` };
          }),
        },
      ])
    ),
    games: fixture.games.map((game): ScoutGame =>
      game.id === COPY
        ? {
            ...game,
            startTs: `${game.date}T16:00:00.000Z`,
            ...(log ? { teamAScore: Number(log.awayRuns), teamBScore: Number(log.homeRuns) } : {}),
          }
        : game
    ),
  };
};

/** The same pool with every start taken out. */
const untimed = (pool: PoolFixture): PoolFixture => ({
  ...pool,
  seasons: Object.fromEntries(
    Object.entries(pool.seasons).map(([seasonId, season]) => [
      seasonId,
      { ...season, matchups: season.matchups.map(({ startTs: _start, ...matchup }) => matchup) },
    ])
  ),
  games: pool.games.map(({ startTs: _start, ...game }) => game),
});

const readerOf =
  (pool: PoolFixture): SeasonReader =>
  (seasonId) =>
    pool.seasons[seasonId] ?? { teams: [], matchups: [], logs: {} };
const gamesOf = (pool: PoolFixture) => (year: number | undefined) =>
  pool.games.filter(
    (game) => ageGroupYear(pool.ageGroups.find((group) => group.id === game.ageGroupId)) === year
  );

const boardsOf = (pool: PoolFixture): PageBoard[] =>
  buildAllBoards({
    ageGroups: pool.ageGroups,
    teams: pool.teams,
    gamesOfYear: gamesOf(pool),
    readSeason: readerOf(pool),
    autoRemoved: NO_REMOVALS,
    today: FIXTURE_TODAY,
  });

/** A number to the millionth, which no engine's last bit reaches (`boardParity.test.ts`). */
const toMillionth = (value: number) => Math.round(value * 1e6) / 1e6 || 0;

/** The boards' rows less what one engine's last bit can move, in id order, as the parity pins. */
const steady = (boards: PageBoard[]) =>
  boards.map(({ pageId, half, rows }) => ({
    pageId,
    half,
    rows: rows
      .map(({ rank: _rank, sosRank: _sosRank, overallRank: _overall, ...row }) => ({
        ...row,
        rating: toMillionth(row.rating),
        pointRating: toMillionth(row.pointRating),
        ...(row.levelPrior === undefined ? {} : { levelPrior: toMillionth(row.levelPrior) }),
        rawMargin: toMillionth(row.rawMargin),
        strengthOfSchedule: toMillionth(row.strengthOfSchedule),
      }))
      .sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0)),
  }));

describe("League Standings starts on the boards", () => {
  it("are carried into what the boards are built from, the copy's onto the row it folds into", () => {
    const pool = timed();
    const first = pool.seasons[LEAGUE]?.matchups[0];
    expect(first && pool.seasons[LEAGUE]?.logs[first.id]?.isFinal).toBe(true);
    const known = deriveAllKnown({
      ageGroups: pool.ageGroups,
      teams: pool.teams,
      yearGames: gamesOf(pool)(2027),
      readSeason: readerOf(pool),
      autoRemoved: NO_REMOVALS,
    });
    const league = known.games.filter((game) => game.id.startsWith(`league_${LEAGUE}_`));
    expect(league.length).toBeGreaterThan(1);
    expect(league.filter((game) => game.startTs === undefined)).toEqual([]);
    expect(known.games.some((game) => game.id === COPY)).toBe(false);
    expect(league.find((game) => game.id === `league_${LEAGUE}_${first?.id}`)?.startTs).toBe(
      pool.games.find((game) => game.id === COPY)?.startTs
    );
  });

  it("move no board, to the last digit", () => {
    const rowsOf = (boards: PageBoard[]) =>
      boards.map(({ pageId, half, rows }) => ({ pageId, half, rows }));
    const withStarts = boardsOf(timed());
    expect(rowsOf(withStarts)).toStrictEqual(rowsOf(boardsOf(untimed(timed()))));
    expect(fingerprint(steady(withStarts))).toBe("aa8e91c9");
  });
});
