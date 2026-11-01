/**
 * The saves this device's own edits made this page load (`callEdit`): the copy, the version each
 * landed as and the keys it changed. League Standings' published answers (`publishedLeague.ts`) are
 * a publish behind a save until the boards after it go out, six or seven minutes on GitHub; a member
 * who has just put a season on a page, or folded a club, and comes back to League Standings would
 * otherwise be shown the season as it was before it, so an answer published from before such a save
 * of this device's is not taken, and the question is asked as before. Another device's save is the
 * publish's to catch up on, as the boards are. Kept in memory alone, a few at a time: a reload is a
 * publish or more later.
 */
export type OwnEdit = { copy: string; version: number; changed: readonly string[] };

const KEPT = 20;
let made: OwnEdit[] = [];

/** Notes a save this device's edit made. */
export const noteOwnEdit = (edit: OwnEdit): void => {
  made = [...made.slice(-(KEPT - 1)), edit];
};

/** This page load's saves of `copy` past `version`. */
export const ownEditsPast = (copy: string, version: number): OwnEdit[] =>
  made.filter((edit) => edit.copy === copy && edit.version > version);

/** Only for tests: forgets every save noted. */
export const forgetOwnEdits = (): void => {
  made = [];
};
