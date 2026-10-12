import { recencyWeightOf } from "./ratingRecency";
import {
  discountAbout,
  ratedMargin,
  ratingFilter,
  scoreSeenBy,
  type AgeGroup,
  type ScoutGame,
  type SeasonSegment,
} from "./teamRankings";
import { BOARD_FIT_VERSION, type BoardView } from "./live/views/boardShape";

/**
 * What each of a club's games did to its rating, worked out on a member's device from two things
 * it already holds: the club's card (`ClubCard.games`) and the board on screen, whose `fit` says
 * what the rows' games were fitted against (`BoardFit`). Nothing is asked of a server, so the
 * lines cost no read, no write and no wait.
 *
 * The fit is a ridge-regularised least-squares fit over a nationwide pool, so a club's rating is
 * the weighted mean of what it "played like" in each game, with the ridge's virtual games at
 * nought: `pointRating = Σ w·P / (Σ w + shrink)`, where P is the opponent's rating plus the
 * margin counted, less the runs the age gap was worth. Measured on the 29 September 2026 backup's
 * 2027 year, that identity held for every one of its 83,693 teams to 5.6e-9, the solver's own
 * tolerance. It is what lets a device rebuild the board's own row from the card's lines, and draw
 * nothing unless they agree.
 */

/** One counted game, from the club's side. */
export type GameLine = {
  /**
   * The rating that makes the game's score exactly what the fit expected of it: the opponent's
   * rating, plus the margin counted, less the runs the age gap was worth (`ageRuns`).
   */
  playedLike: number;
  /** The change the game made to the rating the board shows: `scorePart` plus `recordPart`. */
  moved: number;
  /** What the game's score did to the fit's rating (`pointRating`), with the weights held. */
  scorePart: number;
  /**
   * What one more game on the record did to the discount from the fit's rating to the one shown,
   * with the fit's residual scale and centre held. Never below nought, since a longer record is
   * trusted more, and above it wherever the fit measured any noise at all.
   */
  recordPart: number;
  /** The margin the fit counted, from the club's side: the rated margin held to the cap. */
  counted: number;
  /**
   * The margin the fit read, from the club's side, before the cap: the one score where the two
   * clubs' schedules agree or only one gave it, and their average where they disagree
   * (`ratedMargin`). Beside `counted` and `shownMargin` it says which of the cap and the average
   * made the margin counted differ from the row's score.
   */
  margin: number;
  /** The club's own schedule's margin (`scoreSeenBy`), as the game's row shows it. */
  shownMargin: number | null;
  /** The runs the age gap took off the margin counted: above nought for a club playing down. */
  ageRuns: number;
  /** How many levels the opponent was above the club; 0 where either side's level is unknown. */
  levelsUp: number;
};

/** A club's rating on the board and each of its counted games, by the card's id for the game. */
export type Breakdown = {
  rating: number;
  pointRating: number;
  /** Held fixed while describing each game's score and record effects. */
  scheduleDeduction?: number;
  lines: ReadonlyMap<string, GameLine>;
};

/**
 * How far a club's mean counted margin rebuilt from its card may sit from its row's `rawMargin`.
 * The two are the same sums in a different order, so they agree to the last few digits; the
 * check is there because the rating checks below weaken on a long record, where one game missed
 * moves the rating little.
 */
const MARGIN_TOLERANCE = 1e-9;

/**
 * How far a rating rebuilt from the card's lines may sit from the board's row. The sides away
 * carry their ratings to 4 places, so a played-like rating is within 5e-5 of the fit's, and the
 * mean of them within as much. Measured on the 29 September 2026 backup, with every board and card
 * of the day built and read back as a device reads them, the largest gap over the 88,106 clubs
 * with a row on the 20 boards that carry a fit was 3.6e-5, for the fit's rating and the shown one
 * alike. A card and board from different publishes, a game missed or one too many, or a constant
 * the device has wrong each put it far past this.
 */
const RATING_TOLERANCE = 1e-3;

type Opponent = { rating: number; games: number };

/**
 * Every side a board's rows' rated games name, with its fitted rating and its rated games: the
 * rows themselves, at full precision, and the sides away (`BoardFit.away`). Built once for each
 * board read, however many clubs are opened on it: the largest board of the 29 September 2026
 * backup names 15,540 sides, and indexing them was most of the 12.8 ms its first club took.
 */
const opponentsOfBoard = new WeakMap<BoardView, ReadonlyMap<string, Opponent>>();

const opponentsOf = (board: BoardView): ReadonlyMap<string, Opponent> => {
  const held = opponentsOfBoard.get(board);
  if (held) return held;
  const opponents = new Map<string, Opponent>();
  const away = board.fit?.away;
  away?.ids.forEach((id, at) => {
    opponents.set(id, { rating: away.ratings[at] ?? Number.NaN, games: away.games[at] ?? 0 });
  });
  for (const row of board.rows) {
    opponents.set(row.teamId, { rating: row.pointRating, games: row.games });
  }
  opponentsOfBoard.set(board, opponents);
  return opponents;
};

/** The club's meetings with one opponent: how many, their weight, and the opponent's own total. */
type Meetings = { count: number; weight: number; total: number };

/** One of the club's games the fit read, with what the sums below need of it. */
type Counted = {
  game: ScoutGame;
  opponent: Opponent;
  meetings: Meetings;
  playedLike: number;
  margin: number;
  counted: number;
  ageRuns: number;
  levelsUp: number;
  weight: number;
  evidence: number;
};

/**
 * What each of club `teamId`'s counted games did to its rating on `board`, the board of page
 * `pageId` over the half `segment` (the whole year when left out), or null where the lines
 * cannot be shown to add up to the board's own row.
 *
 * `games` is the club's card, and `ageGroups` the groups the board was built from, never the
 * device's own: which pages a page's pool spans, the year a half is read in and each side's level
 * are all read off them.
 *
 * **Which games.** Those the board's fit read: each that counts toward page `pageId`'s rating on
 * the board's day (`ratingFilter`, the very test `scoutRatingGames` puts to the pool), against a
 * side the board names. The board names every side a row's rated game names, so that stands in,
 * exactly, for the roster check a device has no roster for. The day is the board's own
 * (`BoardFit.day`), never the device's clock, which can be past a game scored ahead.
 *
 * **Checks.** Each must hold, or there are no lines: the fit is of this build's version; the games
 * picked are as many as the row's; their counted margins average to the row's `rawMargin`; the
 * fit's rating and the shown one, rebuilt from the lines, each come within `RATING_TOLERANCE` of
 * the row's; and no side was met more often than the board says it played. A card and board from
 * different publishes, a game the device counted that the fit did not, or one it missed, each
 * fail one of them.
 *
 * **Played like** is exact, but for the 4 places a side away's rating is carried to.
 *
 * **The score part** is the game's own change to the fit's rating, worked out as if the club's
 * opponents met nobody else in common (the star estimate). For game g against o, with W the
 * club's total weight, `echo` the sum over its opponents k of `w_k² / (Ŵ_k + shrink)`, `w_k` its
 * weight against k and Ŵ_k = `n_k · w_k / c_k` k's own total weight read off its game count:
 * a = W + shrink − (echo − w_o² / (Ŵ_o + shrink)), b = Ŵ_o + shrink, and
 * Δ = w·(P − r)·(b − w_o) / (a·b − w_o² − w·(a + b − 2·w_o)), which for a single meeting is
 * w·(P − r) / (a − w). It is exact for a one-game club, whose rating is all its game's, and on a
 * schedule whose opponents meet nobody else. Against exact leave-one-out with the weights held,
 * on 414 games of 60 clubs drawn from the 29 September 2026 backup's 2027 year, its error was
 * 0.0064 in the middle, 0.061 at the 95th percentile and 0.268 at most; it gave the same tenth on
 * 355 of the 414 and never the wrong sign. Taking the game alone against the club's other games
 * (the one-node form) was off by 0.207 at the 95th percentile and gave the same tenth on 238.
 *
 * **The record part** is exact, with the scale and centre held: the club's evidence
 * (`effectiveGames`) less the game, and less what the game did to the opponent's count for every
 * other meeting of the two.
 *
 * On that backup every one of the 88,106 clubs with a row on a board that carries a fit got its
 * lines, 532,020 in all, at 0.14 ms a club in the middle and 0.35 ms at the 95th percentile (Node
 * 22). The first club opened on a board also indexes the sides it names: on the largest board,
 * read afresh 20 times, that first club took 12.8 ms in the middle, and the same club again 0.13.
 */
export const gameBreakdown = ({
  teamId,
  games,
  pageId,
  ageGroups,
  segment,
  board,
}: {
  teamId: string;
  games: readonly ScoutGame[];
  pageId: string;
  ageGroups: AgeGroup[];
  segment: SeasonSegment | undefined;
  board: BoardView;
}): Breakdown | null => {
  const { fit } = board;
  if (!fit || fit.v !== BOARD_FIT_VERSION) return null;
  const row = board.rows.find((candidate) => candidate.teamId === teamId);
  if (!row) return null;
  const opponents = opponentsOf(board);
  const rates = ratingFilter(pageId, ageGroups, segment, fit.day);
  const { shrink, cap } = fit;

  const picked: Counted[] = [];
  const met = new Map<string, Meetings>();
  for (const game of games) {
    const side = game.teamAId === teamId ? 1 : game.teamBId === teamId ? -1 : 0;
    if (side === 0 || !rates.counts(game)) continue;
    const opponentId = side === 1 ? game.teamBId : game.teamAId;
    const opponent = opponents.get(opponentId);
    const margin = ratedMargin(game);
    if (!opponent || margin === undefined) continue;
    // A margin held to the cap reads the same from either side, so the club's own is the fit's.
    const counted = Math.max(-cap, Math.min(cap, side * margin));
    const gap = rates.ageGap(game);
    // The fit took `gap · gapRuns` off side A's margin; from side B's seat that is added back.
    const ageRuns = gap === 0 ? 0 : side * gap * fit.gapRuns;
    const weight = recencyWeightOf(game.date, fit.recency);
    const meetings = met.get(opponentId) ?? { count: 0, weight: 0, total: 0 };
    meetings.count += 1;
    meetings.weight += weight;
    met.set(opponentId, meetings);
    picked.push({
      game,
      opponent,
      meetings,
      playedLike: opponent.rating + counted - ageRuns,
      margin: side * margin,
      counted,
      ageRuns,
      levelsUp: gap === 0 ? 0 : -side * rates.levelsApart(game),
      weight,
      evidence: 1 - 1 / (shrink + opponent.games),
    });
  }

  if (picked.length === 0 || picked.length !== row.games) return null;
  let weight = 0;
  let weighed = 0;
  let evidence = 0;
  let margins = 0;
  for (const line of picked) {
    weight += line.weight;
    weighed += line.weight * line.playedLike;
    evidence += line.evidence;
    margins += line.counted;
  }
  if (!(Math.abs(margins / picked.length - row.rawMargin) <= MARGIN_TOLERANCE)) return null;
  const discount = discountAbout(fit.middle, fit.scale, shrink, fit.errors);
  const pointRating = weighed / (weight + shrink);
  if (!(Math.abs(pointRating - row.pointRating) <= RATING_TOLERANCE)) return null;
  if (
    !(
      Math.abs(discount(pointRating, evidence) - (row.scheduleDeduction ?? 0) - row.rating) <=
      RATING_TOLERANCE
    )
  ) {
    return null;
  }

  // Each opponent's own total weight, read off its games as if each weighed what its meetings
  // with the club did, and the echo of the club's games back through its opponents.
  let echo = 0;
  for (const [opponentId, meetings] of met) {
    const games = opponents.get(opponentId)?.games ?? 0;
    // A side met more often than it played is a board and card that do not belong together.
    if (meetings.count > games) return null;
    meetings.total = (games * meetings.weight) / meetings.count;
    echo += meetings.weight ** 2 / (meetings.total + shrink);
  }

  const r = row.pointRating;
  const shown = discount(r, evidence);
  const lines = new Map<string, GameLine>();
  for (const line of picked) {
    const { meetings } = line;
    const w = line.weight;
    const between = meetings.weight;
    const a = weight + shrink - (echo - between ** 2 / (meetings.total + shrink));
    const b = meetings.total + shrink;
    const denominator = a * b - between ** 2 - w * (a + b - 2 * between);
    // Above nought whenever the ridge is and no side is met more often than it played; a board
    // whose numbers allow anything else is not one to draw from.
    if (!(denominator > 0)) return null;
    const scorePart = (w * (line.playedLike - r) * (b - between)) / denominator;
    // Without the game the opponent has one game fewer, which every other meeting of the two reads.
    const n = line.opponent.games;
    const without =
      evidence - line.evidence + (meetings.count - 1) * (1 / (shrink + n) - 1 / (shrink + n - 1));
    const recordPart = shown - discount(r, without);
    const seen = scoreSeenBy(line.game, teamId);
    lines.set(line.game.id, {
      playedLike: line.playedLike,
      moved: scorePart + recordPart,
      scorePart,
      recordPart,
      counted: line.counted,
      margin: line.margin,
      shownMargin: seen ? seen.own - seen.opponent : null,
      ageRuns: line.ageRuns,
      levelsUp: line.levelsUp,
    });
  }
  return {
    rating: row.rating,
    pointRating: row.pointRating,
    ...(row.scheduleDeduction === undefined ? {} : { scheduleDeduction: row.scheduleDeduction }),
    lines,
  };
};
