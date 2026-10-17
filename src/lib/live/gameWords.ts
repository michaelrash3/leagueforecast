import { formatBoardRating } from "../boardRating";
import type { Breakdown, GameLine } from "../gameBreakdown";
import { formatRating } from "../matchupForecast";

/**
 * What a club's panel says of each counted game (`gameBreakdown`), in plain words: what the club
 * played like, what the game moved the rating the board shows, and, only where it applies, why the
 * margin counted is not the score on the row. Every figure is to a tenth and signed, and none is
 * hedged: the device draws nothing at all unless the lines add up to the board's own row. The two
 * ratings above the list are printed exactly as the board's row prints them (`formatBoardRating`),
 * "-0.0" and all, since a reader holds them against it; the figures under each game, which no row
 * prints, read "0.0" for anything that rounds to nothing (`formatRating`).
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

/** The tenths a rating printed as the board's row prints it shows: "+2.8" is 28, "-0.0" none. */
const tenthsPrinted = (printed: string): number => Math.round(Number(printed) * 10);

/**
 * The line above the list: the rating the board shows, how much of it the club's games give, and
 * what its record adds or takes off.
 *
 * The record's part is the evidence discount (`discountAbout`): the fit's rating plus a standard
 * error times how far the club's spread (`ratingSpread`, how unsure its rating is) sits below the
 * mean spread over every club the fit rated in the span (`discountMiddle`), on every page of the
 * pool. So it adds where the club's record makes its rating surer than the average club's, and
 * takes off where it makes it less sure, and that is what the line says. It is neither a count of
 * the board's clubs nor one of games: the spread falls ever more slowly as games are added, so the
 * mean spread sits above the median club's, and a club short of the average number of games can
 * still be surer than the average club. On the 29 September 2026 backup more than half the clubs
 * gained on 10 of the 20 boards with lines, 57.8% on one, so "fuller than most", as the line first
 * said, was false there; and of the 45,554 clubs that gained, 8,146 had fewer effective games than
 * their board's average, so "fuller than the average club's" would have been false for them.
 *
 * The two ratings are printed as the row prints its Rating and Best guess (`formatBoardRating`),
 * so the line never reads "0.0" above a row reading "-0.0", nor rounds a rating stored a hair under
 * a half the other way from the row. The record's part is what those two printed figures differ
 * by, so the three add up on screen to the rating shown, as a reader will check.
 *
 * Then, where the club's league starts it a tenth of a run or more below average
 * (`startingSentence`), a sentence saying so, which ends on the figure from its games again. The
 * start is inside that figure, not beside it: the fit plays the ridge's virtual games at the
 * league's level, and an opponent from the same league started there as well. Said only as
 * "starts 1.6 runs below average" after a split that already adds up, it read as a third part
 * the split had left out, or as a start never applied: on the 11 October 2026 year boards the
 * strongest unbeaten island club read "+8.6 from its games, +0.3 because its record..." for a
 * Season rating of +8.9, and then "starts 1.6 runs below average", with the 1.6 already in the
 * +8.6. So the sentence says the games take the rating from the start to that figure.
 */
export const ratingHeadline = (
  breakdown: Pick<Breakdown, "rating" | "pointRating" | "levelPrior" | "outsideGames">,
  { span, own }: { span: string; own: boolean }
): string => {
  const whose = own ? "your" : "its";
  const shown = formatBoardRating(breakdown.rating);
  const fromGames = formatBoardRating(breakdown.pointRating);
  const record = tenthsPrinted(shown) - tenthsPrinted(fromGames);
  const lead = `${span} rating ${shown}`;
  // The figure the line gives the games: the rating shown where all of it is theirs, which may
  // print the other side of nought from the fit's own ("+0.0" over "-0.0").
  const start = startingSentence(breakdown, { own, fromGames: record === 0 ? shown : fromGames });
  const after = start === null ? "" : ` ${start}`;
  if (record === 0) return `${lead}, all of it from ${whose} games.${after}`;
  return `${lead}: ${fromGames} from ${whose} games, ${tenths(record)} because ${whose} record makes ${whose} rating ${
    record > 0 ? "surer" : "less sure"
  } than the average club's.${after}`;
};

/**
 * Where the fit started the club, in plain words: how many games its league, its community of
 * the schedule (`scheduleCommunities.ts`), has played outside itself, and so how far below average
 * its rating starts (`levelPrior`), to a tenth; and, given the rating from its games as the line
 * above prints it (`fromGames`), that its games take it from there to that figure. Null where the
 * start rounds to less than a tenth, which is a league with more than 310 games outside itself and
 * says nothing a reader could weigh, and where the board did not say (a row from before board
 * rules 7).
 */
export const startingSentence = (
  breakdown: Pick<Breakdown, "levelPrior" | "outsideGames">,
  { own, fromGames }: { own: boolean; fromGames?: string }
): string | null => {
  const { levelPrior, outsideGames } = breakdown;
  if (levelPrior === undefined || outsideGames === undefined) return null;
  const below = tenthsOf(-levelPrior);
  if (below < 1) return null;
  const whose = own ? "your" : "its";
  const games =
    outsideGames === 0 ? "no games" : `${outsideGames} ${outsideGames === 1 ? "game" : "games"}`;
  const amount = (below / 10).toFixed(1);
  const reach =
    fromGames === undefined ? "" : `, and ${whose} games take it from there to ${fromGames}`;
  return `${own ? "Your" : "Its"} league has played ${games} outside itself, so ${whose} rating starts ${amount} ${
    amount === "1.0" ? "run" : "runs"
  } below average${reach}.`;
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

/**
 * What the key adds where the line above says the club's start (`startingSentence`): what each
 * game moved is read with every club's start held where it is (`GameLine.scorePart`), as the
 * exact refit it stands for holds it, though a refit without one of a league's few outside games
 * would start the league lower: from −1.45 to −1.60 for a league with one, from −1.23 to −1.33
 * for one with three. Board rules 6's key said the same of its schedule deduction.
 */
export const START_HELD_NOTE = "Game effects hold each league's start fixed.";

/** Everything the panel says of a club's games on a board, from its breakdown there. */
export const gameNotesOf = (
  breakdown: Breakdown,
  { span, own, cap }: { span: string; own: boolean; cap: number }
): GameNotes => ({
  headline: ratingHeadline(breakdown, { span, own }),
  key:
    startingSentence(breakdown, { own }) === null
      ? GAME_NOTES_KEY
      : `${GAME_NOTES_KEY} ${START_HELD_NOTE}`,
  byGame: new Map(
    [...breakdown.lines].map(([gameId, line]) => [gameId, gameClauses(line, { own, cap })])
  ),
});
