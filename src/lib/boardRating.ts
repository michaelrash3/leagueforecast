/**
 * A rating as a board's row prints it, in the Rating column: to a tenth, with its sign always
 * shown. A rating is a margin either side of an average team, so "+3.1" and "-3.1" are
 * opposite claims and a bare "3.1" reads as neither.
 *
 * `toFixed` rounds the number as stored, so a rating within a twentieth of nought prints "+0.0" or
 * "-0.0" by its side, and one stored a hair under a half rounds down. Anything that is to read as
 * the row does, the line above a club's games among it (`gameWords`), prints with this and no
 * other rounding, or the two disagree on the densest part of the table.
 */
export const formatBoardRating = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
