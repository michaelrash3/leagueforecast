/**
 * What winning or losing one scheduled game would do to a club's place in the table.
 *
 * The scouting report already projects each fixture — a margin and a win probability off the two
 * ratings. This answers the question a coach asks next, which the projection cannot: not "are we
 * favoured on Saturday" but "where does Saturday leave us". A rating here is not a property of a
 * club, it is the solution of one least-squares fit over every counted game in the pool, so the
 * only honest way to answer is to run the fit again with the result in it and read the new table.
 *
 * Two things make that affordable and one makes it honest.
 *
 * The fit is least squares and `RATING_CAP` clamps a margin before it reaches the fit, so within
 * ±8 runs every club's fitted rating is an affine function of the margin assumed. The shown
 * rating is that less an evidence discount, and the discount's only margin-sensitive term is the
 * pool's residual scale, which one game out of thousands moves by a rounding error. So fitting the
 * two ends and drawing a straight line between them gives every whole margin in between. Measured
 * across pools of 12, 40, 120, 600, 1,500, 3,000 and 6,000 clubs, sweeping all sixteen margins
 * against a real re-fit at each: the rank was right in every case, and the worst rating error was
 * 7.4e-3 runs on the 12-club pool, falling to 1.9e-5 at 6,000. The error grows as the pool shrinks
 * — which is what the residual-scale reasoning predicts — and stays three orders below the tenth
 * of a run a table shows.
 *
 * Selecting the games once and fitting twice, rather than calling `buildTeamRankings` twice and
 * selecting twice, is measured at 41ms against 65ms over 16,000 clubs and 96,000 games.
 *
 * And the hypothetical is dated today rather than on the day the fixture is actually played. That
 * is a deliberate small falsehood and the alternative is worse: old games count for less, so a
 * result dated months out arrives as the newest thing in the pool and outweighs the season that
 * has actually happened, by more the further out the fixture is. Today is the last day about which
 * the pool has an opinion, so it is the day on which "one more result" means one more result.
 */

import {
  RATING_CAP,
  rankScoutPool,
  scoutRatingGames,
  type AgeGroup,
  type RatedScoutGame,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
} from "./teamRankings";
import { isScoutGamePlayed } from "./teamRankings/types";
import { ageGroupYear, inSegment, type SeasonSegment } from "./teamRankings/seasons";

/**
 * Why a fixture cannot be asked about.
 *
 * Three of these a reader can do something about and the panel says so in a sentence; the rest
 * cannot be reached from a schedule the app would list as upcoming, and the trigger simply does
 * not appear.
 */
export type WhatIfDeclined =
  /** Already has a score, so there is nothing to wonder about. */
  | "played"
  /** Marked not to count, so the board will never read it whatever it finishes. */
  | "excluded"
  /** Both sides are the same club. A CSV restore can write one; nothing else can. */
  | "self"
  /** The other club has not played a counted game, so a result would add a row rather than move
   *  one, and the table the reader is looking at would grow underneath the answer. */
  | "unrated-opponent"
  /** A fixture in the other half of the baseball year. It must not move this half's board. */
  | "other-half"
  /** No date, so it belongs to the year but to neither half of it. */
  | "no-date"
  /** The selection refused it for some other reason — a side off the roster, a page it does not
   *  belong to. A catch-all rather than a guess, because the selection is the authority. */
  | "not-counted";

/** One rung of the answer: a whole-run margin and where it leaves the club. */
export type WhatIfPoint = { margin: number; rank: number; rating: number };

export type WhatIfCurve = {
  gameId: string;
  forTeamId: string;
  /**
   * One point per whole run, from a loss by `RATING_CAP` to a win by it. Never zero: a tie is not
   * on the curve, because simulating one is out of scope and a record string would have to grow a
   * third number to hold it.
   */
  points: WhatIfPoint[];
  /** The record the club would carry, at either end. */
  winRecord: string;
  lossRecord: string;
  /** How many clubs the hypothetical board ranks, so a place can be shown out of something. */
  rankedCount: number;
};

/**
 * The fixture as a played game, from the scouted club's seat, dated today.
 *
 * `margin` is runs for the scouted club, so a negative one is a defeat. Five is an arbitrary base:
 * the fit reads the difference and nothing else, and a 9-1 and a 12-4 are the same evidence.
 */
const scored = (
  fixture: ScoutGame,
  forTeamId: string,
  margin: number,
  today: string
): ScoutGame => {
  const ours = 5 + Math.max(0, margin);
  const theirs = 5 + Math.max(0, -margin);
  const weAreA = fixture.teamAId === forTeamId;
  return {
    ...fixture,
    date: today,
    teamAScore: weAreA ? ours : theirs,
    teamBScore: weAreA ? theirs : ours,
  };
};

/** The clubs with at least one game the board counts. */
const ratedClubIds = (rated: readonly RatedScoutGame[]): Set<string> => {
  const ids = new Set<string>();
  rated.forEach(({ game }) => {
    ids.add(game.teamAId);
    ids.add(game.teamBId);
  });
  return ids;
};

/**
 * Everything that can be refused without running the selection.
 *
 * The half-of-the-year test is here, on the fixture's OWN date, and that placement is the whole
 * reason this function is separate. The copy the selection is shown is dated today, so a spring
 * fixture asked about on an autumn board would sail through `inSegment` on the copy's date and
 * answer a question about the autumn with a game to be played in March. The fixture decides which
 * half it is in; the copy only decides how much the fit leans on it.
 */
const refuseOnSight = (
  fixture: ScoutGame,
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined
): WhatIfDeclined | null => {
  if (isScoutGamePlayed(fixture)) return "played";
  if (fixture.excluded === true) return "excluded";
  if (fixture.teamAId === fixture.teamBId) return "self";
  if (segment === undefined) return null;
  if (fixture.date === undefined || fixture.date === "") return "no-date";
  const year = ageGroupYear(ageGroups.find((group) => group.id === fixture.ageGroupId));
  return inSegment(fixture.date, year, segment) ? null : "other-half";
};

/**
 * Whether this fixture can be asked about, and if not, why.
 *
 * What cannot be settled by looking at the fixture is delegated rather than re-decided: a scored
 * copy is put through `scoutRatingGames` and the answer is whether it came out the other side.
 * The selection is the authority on what a board counts, and a second copy of its rules here
 * would be a second copy to keep in step.
 */
export const whatIfDecline = (
  fixture: ScoutGame,
  forTeamId: string,
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  today: string
): WhatIfDeclined | null => {
  const onSight = refuseOnSight(fixture, ageGroups, segment);
  if (onSight) return onSight;

  const copy = scored(fixture, forTeamId, RATING_CAP, today);
  const rated = scoutRatingGames(ageGroupId, teams, [...games, copy], ageGroups, segment, today);
  if (!rated.some(({ game }) => game.id === fixture.id)) return "not-counted";

  const opponentId = fixture.teamAId === forTeamId ? fixture.teamBId : fixture.teamAId;
  // Off the pool as it stands, so the hypothetical itself cannot vouch for the opponent.
  const already = ratedClubIds(rated.filter(({ game }) => game.id !== fixture.id));
  return already.has(opponentId) ? null : "unrated-opponent";
};

/**
 * The same answer for a whole schedule at once, in one pass over the pool.
 *
 * The table asks this of every fixture it lists, and the selection is the expensive part —
 * measured at 11ms over 16,000 clubs and 96,000 games. Asking per fixture would pay that once a
 * row; asking once with every hypothetical appended pays it once a board. The copies cannot
 * affect one another, because the selection judges each game on its own.
 */
export const whatIfDeclines = (
  fixtures: readonly ScoutGame[],
  forTeamId: string,
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  today: string
): Map<string, WhatIfDeclined | null> => {
  const out = new Map<string, WhatIfDeclined | null>();
  const asking: ScoutGame[] = [];
  fixtures.forEach((fixture) => {
    const onSight = refuseOnSight(fixture, ageGroups, segment);
    out.set(fixture.id, onSight);
    if (!onSight) asking.push(scored(fixture, forTeamId, RATING_CAP, today));
  });
  if (asking.length === 0) return out;

  const rated = scoutRatingGames(
    ageGroupId,
    teams,
    [...games, ...asking],
    ageGroups,
    segment,
    today
  );
  const hypothetical = new Set(asking.map((game) => game.id));
  const admitted = new Set(
    rated.filter(({ game }) => hypothetical.has(game.id)).map(({ game }) => game.id)
  );
  // The pool as it stands, so no hypothetical can vouch for an opponent — including another row's.
  const already = ratedClubIds(rated.filter(({ game }) => !hypothetical.has(game.id)));

  fixtures.forEach((fixture) => {
    if (out.get(fixture.id) !== null) return;
    if (!admitted.has(fixture.id)) {
      out.set(fixture.id, "not-counted");
      return;
    }
    const opponentId = fixture.teamAId === forTeamId ? fixture.teamBId : fixture.teamAId;
    out.set(fixture.id, already.has(opponentId) ? null : "unrated-opponent");
  });
  return out;
};

/** The rated list with the hypothetical's scores swapped for another margin. */
const atMargin = (
  rated: readonly RatedScoutGame[],
  at: number,
  fixture: ScoutGame,
  forTeamId: string,
  margin: number,
  today: string
): RatedScoutGame[] => {
  const next = rated.slice();
  const held = rated[at];
  if (held === undefined) return next;
  next[at] = { game: scored(fixture, forTeamId, margin, today), ageGap: held.ageGap };
  return next;
};

const ratingsOf = (rows: ScoutRankingRow[]): Map<string, number> =>
  new Map(rows.map((row) => [row.teamId, row.rating]));

/**
 * Where every whole margin from a defeat by `RATING_CAP` to a win by it would leave the club.
 *
 * Null when the selection will not take the fixture — the same answer `whatIfDecline` gives, asked
 * again here so that a caller which skipped it cannot get a confident number for a game the board
 * would never read.
 *
 * `games` is passed to `rankScoutPool` without the hypothetical in it on purpose: that argument is
 * read only to work out each club's home age level for the year, which is a fact about its season
 * and must not move because of a game nobody has played.
 */
export const whatIfCurve = (
  fixture: ScoutGame,
  forTeamId: string,
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  myTeamId: string | undefined,
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  today: string
): WhatIfCurve | null => {
  // The same refusals, so a caller that skipped `whatIfDecline` cannot get a confident number for
  // a game the board would never read — above all a fixture in the half of the year this board is
  // not, which the selection alone would not catch.
  if (refuseOnSight(fixture, ageGroups, segment)) return null;

  const top = scored(fixture, forTeamId, RATING_CAP, today);
  const rated = scoutRatingGames(ageGroupId, teams, [...games, top], ageGroups, segment, today);
  const at = rated.findIndex(({ game }) => game.id === fixture.id);
  if (at < 0) return null;

  const board = (margin: number): ScoutRankingRow[] =>
    rankScoutPool(
      ageGroupId,
      teams,
      games,
      atMargin(rated, at, fixture, forTeamId, margin, today),
      myTeamId,
      ageGroups
    );

  const lost = board(-RATING_CAP);
  const won = board(RATING_CAP);
  const lostBy = ratingsOf(lost);
  const wonBy = ratingsOf(won);

  const points: WhatIfPoint[] = [];
  for (let margin = -RATING_CAP; margin <= RATING_CAP; margin += 1) {
    if (margin === 0) continue;
    const share = (margin + RATING_CAP) / (2 * RATING_CAP);
    const between = (teamId: string): number => {
      const low = lostBy.get(teamId);
      const high = wonBy.get(teamId);
      return low === undefined || high === undefined ? 0 : low + (high - low) * share;
    };
    const mine = between(forTeamId);
    // Counting who is above is what a rank is. Strictly above, so a club level with this one on
    // the drawn line does not displace it — the same test the sweep above was verified against.
    let above = 0;
    won.forEach((row) => {
      if (row.teamId !== forTeamId && between(row.teamId) > mine) above += 1;
    });
    points.push({ margin, rank: above + 1, rating: mine });
  }

  const wonRow = won.find((row) => row.teamId === forTeamId);
  const lostRow = lost.find((row) => row.teamId === forTeamId);
  if (!wonRow || !lostRow) return null;

  return {
    gameId: fixture.id,
    forTeamId,
    points,
    winRecord: wonRow.record,
    lossRecord: lostRow.record,
    rankedCount: won.length,
  };
};

/**
 * The narrowest win that still leaves the club no lower than where it stands, or null when none
 * does.
 *
 * This is the sentence worth leading with, because it turns a table into an instruction: win by
 * three and you hold your place. `<=` rather than `<` on purpose — a win that lands exactly on the
 * current rank has held it, and a heavy favourite whose best case is precisely its present place
 * would otherwise be told no win can help.
 */
export const holdsFrom = (curve: WhatIfCurve, fromRank: number): number | null => {
  for (const point of curve.points) {
    if (point.margin > 0 && point.rank <= fromRank) return point.margin;
  }
  return null;
};
