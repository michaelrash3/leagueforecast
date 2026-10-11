import type { Breakdown, GameLine } from "../gameBreakdown";
import { formatRating } from "../matchupForecast";

/**
 * What a club's panel says of each counted game (`gameBreakdown`), in plain words: what the club
 * played like, what the game moved the rating the board shows, and, only where it applies, why the
 * margin counted is not the score on the row. Every figure is to a tenth, signed as the board's
 * ratings are (`formatRating`), and none is hedged: the device draws nothing at all unless the
 * lines add up to the board's own row.
 *
 * The page's own club reads "your", every other club "its".
 */

/** What the two figures on each line mean, said once above the list. */
export const GAME_NOTES_KEY =
  "Played like: the rating that makes the score exactly what was expected. Moved: the rating with the game, less the rating without it.";

/** What the panel is handed: the line above the list, its key, and each game's clauses by id. */
export type GameNotes = {
  headline: string;
  key: string;
  byGame: ReadonlyMap<string, readonly string[]>;
};

/** A whole number of tenths, signed, with "0.0" for none, as `formatRating` prints a rating. */
const tenths = (count: number): string =>
  count === 0 ? "0.0" : `${count > 0 ? "+" : "-"}${(Math.abs(count) / 10).toFixed(1)}`;

const tenthsOf = (value: number): number => Math.round(value * 10);

/** Runs as a reader counts them: "12", "1.5". The fit's margins are whole runs or halves. */
const runs = (value: number): string => String(Number(Math.abs(value).toFixed(1)));

const YEARS = ["", "a year", "two years", "three years", "four years"];
const years = (count: number): string => YEARS[count] ?? `${count} years`;

/**
 * The line above the list: the rating the board shows, how much of it the club's games give, and
 * what its record adds or takes off because it is fuller or thinner than most on the board. The
 * two parts are rounded so they add up on screen to the rating shown, as a reader will check.
 */
export const ratingHeadline = (
  breakdown: Pick<Breakdown, "rating" | "pointRating">,
  { span, own }: { span: string; own: boolean }
): string => {
  const whose = own ? "your" : "its";
  const shown = tenthsOf(breakdown.rating);
  const fromGames = tenthsOf(breakdown.pointRating);
  const record = shown - fromGames;
  const lead = `${span} rating ${tenths(shown)}`;
  if (record === 0) return `${lead}, all of it from ${whose} games.`;
  return `${lead}: ${tenths(fromGames)} from ${whose} games, ${tenths(record)} because ${whose} record is ${
    record > 0 ? "fuller" : "thinner"
  } than most.`;
};

/**
 * Why the margin the fit counted is not the score the row shows, when it is not. The row shows the
 * club's own schedule's score (`shownMargin`); the fit read the two schedules' average where they
 * disagree (`margin`, `ratedMargin`) and held that to the most one game counts (`cap`). Each clause
 * names what takes the row's score to the margin counted:
 * - the cap alone where the average went past it and the club's own score, held to it, is already
 *   the margin counted, whether the two schedules agree or not;
 * - the average alone where the average is inside the cap or exactly on it, so the cap did nothing;
 * - both where the average went past the cap and the club's own score, held to it, is not the
 *   margin counted: a score inside the cap, or one past it on the other side.
 *
 * Read off the margin before the cap, not off the two margins either side of it: a club whose own
 * schedule has it losing 0-13 and the other's has it winning 37-0 is counted as a 12-run win, the
 * average exactly, and though its own score is past the cap the cap did nothing to it.
 */
const marginClause = (line: GameLine, cap: number): string | null => {
  const { counted, margin, shownMargin } = line;
  if (shownMargin === null || counted === shownMargin) return null;
  const result = counted === 0 ? "a tie" : `a ${runs(counted)}-run ${counted > 0 ? "win" : "loss"}`;
  // Inside the cap or on it, what the fit read is what it counted, and that is not the row's score.
  if (Math.abs(margin) <= cap) return `counted as ${result}, the two schedules' scores averaged`;
  return Math.max(-cap, Math.min(cap, shownMargin)) === counted
    ? `counted as ${result}, the most one game counts`
    : `counted as ${result}, the two schedules' scores averaged and held to the most one game counts`;
};

/** The runs the age gap gave or took, for a club playing up or down. */
const ageClause = (line: GameLine): string | null => {
  if (line.levelsUp === 0 || line.ageRuns === 0) return null;
  const amount = runs(line.ageRuns);
  const said = `${amount} ${amount === "1" ? "run" : "runs"}`;
  return line.levelsUp > 0
    ? `${said} added for playing ${years(line.levelsUp)} up`
    : `${said} taken off for playing ${years(-line.levelsUp)} down`;
};

/**
 * One counted game's clauses, in order: what the club played like, what the game moved its
 * rating, then why the margin counted is not the row's score and what its age gap was worth,
 * each only where it applies.
 *
 * A move that rounds to nothing says so. A move whose score part reads as a fall while the whole
 * does not (a game below the club's rating, outweighed by one more game on the record) says both
 * parts, rounded so they add up on screen.
 */
export const gameClauses = (
  line: GameLine,
  { own, cap }: { own: boolean; cap: number }
): string[] => {
  const whose = own ? "your" : "its";
  const moved = tenthsOf(line.moved);
  const score = tenthsOf(line.scorePart);
  const split =
    score <= -1 && moved > -1
      ? ` (score ${tenths(score)}, one more game ${tenths(moved - score)})`
      : "";
  const clauses = [
    `Played like ${formatRating(line.playedLike)}`,
    `moved ${whose} rating ${moved === 0 ? "less than 0.1" : tenths(moved)}${split}`,
  ];
  const margin = marginClause(line, cap);
  if (margin) clauses.push(margin);
  const age = ageClause(line);
  if (age) clauses.push(age);
  return clauses;
};

/** Everything the panel says of a club's games on a board, from its breakdown there. */
export const gameNotesOf = (
  breakdown: Breakdown,
  { span, own, cap }: { span: string; own: boolean; cap: number }
): GameNotes => ({
  headline: ratingHeadline(breakdown, { span, own }),
  key: GAME_NOTES_KEY,
  byGame: new Map(
    [...breakdown.lines].map(([gameId, line]) => [gameId, gameClauses(line, { own, cap })])
  ),
});
