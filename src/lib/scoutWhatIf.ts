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
 * ±12 runs every club's fitted rating is an affine function of the margin assumed, and two fits,
 * the two ends, give it at every margin between. The shown rating is that less an evidence
 * discount, which is the pool's residual scale times a number fixed for each club — its games
 * weighed by its opponents', which no margin changes — and the residual scale is not linear: its
 * square is the weighted mean of squared residuals, each affine in the margin, so it is a quadratic
 * in the margin, pinned exactly by a third fit, at a tie. A straight line between the two ends
 * missed a real re-fit's rank 2 times in 160 synthetic cases with stand-ins at the cap of 8 then in
 * use, and 8 once the discount weighed opponents, which spreads the clubs' discounts further; drawn
 * exactly there are none.
 *
 * Selecting the games once and fitting three times, rather than calling `buildTeamRankings` for
 * each and selecting each time: the two fits measured 41ms against 65ms over 16,000 clubs and
 * 96,000 games, and a third fit is a third more.
 *
 * And the hypothetical is dated today rather than on the day the fixture is actually played. That
 * is a deliberate small falsehood and the alternative is worse: old games count for less, so a
 * result dated months out arrives as the newest thing in the pool and outweighs the season that
 * has actually happened, by more the further out the fixture is. Today is the last day about which
 * the pool has an opinion, so it is the day on which "one more result" means one more result.
 */

import {
  RATING_CAP,
  rankScoutPoolWithScale,
  scoutRatingGames,
  type AgeGroup,
  type RatedScoutGame,
  type ScoutGame,
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
 * The clubs the board counts a game for, over the whole pool: what a what-if's opponent is checked
 * against. The same for every club and every page of a year, so a caller that holds a year can work
 * it out once and hand it to `whatIfDeclines` rather than have each call select the year again.
 */
export const ratedClubsOf = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  segment: SeasonSegment | undefined,
  today: string
): ReadonlySet<string> =>
  ratedClubIds(scoutRatingGames(ageGroupId, teams, games, ageGroups, segment, today));

/**
 * Everything that can be refused without running the selection.
 *
 * The half-of-the-year test is here, on the fixture's OWN date, and that placement is the whole
 * reason this function is separate. The copy the selection is shown is dated today, so a spring
 * fixture asked about on an autumn board would sail through `inSegment` on the copy's date and
 * answer a question about the autumn with a game to be played in March. The fixture decides which
 * half it is in; the copy only decides how much the fit leans on it.
 */
export const refuseOnSight = (
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
  today: string,
  /** `ratedClubsOf` for this pool, half and day, when the caller already holds it. */
  ratedClubs?: ReadonlySet<string>
): Map<string, WhatIfDeclined | null> => {
  const out = new Map<string, WhatIfDeclined | null>();
  const asking: ScoutGame[] = [];
  fixtures.forEach((fixture) => {
    const onSight = refuseOnSight(fixture, ageGroups, segment);
    out.set(fixture.id, onSight);
    if (!onSight) asking.push(scored(fixture, forTeamId, RATING_CAP, today));
  });
  if (asking.length === 0) return out;

  // The selection judges each game on its own, so the copies can be put through it by themselves.
  const admitted = new Set(
    scoutRatingGames(ageGroupId, teams, asking, ageGroups, segment, today).map(
      ({ game }) => game.id
    )
  );
  // The pool as it stands, so no hypothetical can vouch for an opponent — including another row's.
  const already = ratedClubs ?? ratedClubsOf(ageGroupId, teams, games, ageGroups, segment, today);

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

  const board = (margin: number) =>
    rankScoutPoolWithScale(
      ageGroupId,
      teams,
      games,
      atMargin(rated, at, fixture, forTeamId, margin, today),
      myTeamId,
      ageGroups
    );

  const lostBoard = board(-RATING_CAP);
  const tiedBoard = board(0);
  const wonBoard = board(RATING_CAP);
  const lost = lostBoard.rows;
  const won = wonBoard.rows;
  /** The squared residual scale at a margin: the parabola through the three fits. */
  const squaredScaleAt = (margin: number): number => {
    const [low, tie, high] = [lostBoard, tiedBoard, wonBoard].map(
      ({ residualScale }) => residualScale ** 2
    ) as [number, number, number];
    const x = margin / RATING_CAP;
    return tie + ((high - low) / 2) * x + ((high + low) / 2 - tie) * x * x;
  };
  // Each club's discount per run of residual scale, off whichever end has the larger scale to divide.
  const reference = wonBoard.residualScale >= lostBoard.residualScale ? wonBoard : lostBoard;
  const perScale = new Map(
    reference.rows.map((row) => [
      row.teamId,
      reference.residualScale > 0 ? (row.pointRating - row.rating) / reference.residualScale : 0,
    ])
  );
  const lowPoint = new Map(lost.map((row) => [row.teamId, row.pointRating]));
  const highPoint = new Map(won.map((row) => [row.teamId, row.pointRating]));

  const points: WhatIfPoint[] = [];
  for (let margin = -RATING_CAP; margin <= RATING_CAP; margin += 1) {
    if (margin === 0) continue;
    const share = (margin + RATING_CAP) / (2 * RATING_CAP);
    const scale = Math.sqrt(Math.max(0, squaredScaleAt(margin)));
    const between = (teamId: string): number => {
      const low = lowPoint.get(teamId);
      const high = highPoint.get(teamId);
      if (low === undefined || high === undefined) return 0;
      return low + (high - low) * share - scale * (perScale.get(teamId) ?? 0);
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
