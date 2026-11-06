/**
 * What one row of the pool says on its own: whether it is scored, the days around it, the clubs
 * whose own schedules hold it on which days, and whether it could still be another row's copy. The
 * filing, the slots and the namesake rules all read these. Split out of `gameChangerImport.ts`.
 */

import { dayApartStrength, type ScoutGame } from "../teamRankings";

/**
 * Whether a re-pull actually says anything new. A schedule is pulled repeatedly as a season runs,
 * and almost every game comes back exactly as it was; only a game that has since been played, or
 * whose score GameChanger has corrected, is worth writing.
 */
/** Whether a game carries a result at all. One score without the other is not one. */
export const isScored = (game: ScoutGame): boolean =>
  game.teamAScore !== undefined && game.teamBScore !== undefined;

/** The ISO day `days` from `date`, or undefined for a date that is not one. */
export const isoDayFrom = (date: string, days: number): string | undefined => {
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : new Date(at + days * 86_400_000).toISOString().slice(0, 10);
};

/**
 * A game's day and the day either side of it: where a club's own schedule has to have a game for a
 * name to put one on the club. Two clubs' schedules can date one game a day apart — a late start
 * read across midnight, a date typed a day off — and the collapse joins those copies later
 * (`dayApartStrength`), so a row named a day off the club's own copy of it is left for that.
 */
export const aroundDay = (date: string): string[] =>
  [date, isoDayFrom(date, -1), isoDayFrom(date, 1)].filter(
    (day): day is string => day !== undefined
  );

/**
 * The days `game` holds a row of a pulled club's own schedules on, as [club, day]: the game's day
 * for the row it stands on and for a schedule on record with no row kept, and a folded row's own
 * day where it keeps one (`FoldedRow.date`), as a row joined into a copy dated a day off does. Read
 * at the game's day alone, such a club looked to have played on the copy's day and not on its own.
 */
export const ownRowDays = (
  game: ScoutGame,
  clubOfSchedule: (schedule: string) => string | undefined
): [string, string][] => {
  const out: [string, string][] = [];
  const note = (schedule: string, day: string | undefined) => {
    const club = clubOfSchedule(schedule);
    if (club !== undefined && day) out.push([club, day]);
  };
  if (game.source) note(game.source.teamId, game.date);
  game.alsoRows?.forEach((record) => note(record.teamId, record.date ?? game.date));
  game.alsoFrom?.forEach((schedule) => {
    if (!game.alsoRows?.some((record) => record.teamId === schedule)) note(schedule, game.date);
  });
  return out;
};

/**
 * Whether the collapse could yet read a club's own row against another club, that no row of the
 * other club's is paired with, as that club's copy of a game: on the copy's own day, whose count
 * settles it, or a day off where the two read as one game across the night (`dayApartStrength`).
 * The claim step waits on such a row before it gives the copy to a row filed by name, and a pull's
 * mark with it (`filedMarkFor`). A row a day off that no reading joins is a game of its own, and
 * waiting on it waited for good. G3 - Bonanno's 3-9 against "CBU" on 19 September 2026 was CBU
 * United Faber Navy's own 9-3 at the same start; the step waited on G3's 1-2 against CBU United at
 * two the next afternoon, which no schedule of theirs lists, and the 3-9 counted twice. On the pool
 * of 24 September 2026 waiting only where the collapse could join left 41 fewer games and moved 73
 * clubs' records: 71 toward GameChanger's own, 46 of them onto it, none off it. On the pool of 26
 * September, pulled since under the rules after it, it was 3 games and 6 records, all toward.
 */
export const couldStillBeCopy = (row: ScoutGame, copy: ScoutGame): boolean => {
  if (row.date === copy.date) return true;
  // A score the copy borrowed from side B (`scoreFromB`) is the word of the club whose row this is,
  // lent by a claim into the copy: read as the copy's, it matched the row a day off, the claim that
  // lent it went back, and the pass after made the claim again.
  if (!copy.scoreFromB) return dayApartStrength(row, copy) > 0;
  const { teamAScore: _a, teamBScore: _b, ...unscored } = copy;
  return dayApartStrength(row, unscored) > 0;
};
