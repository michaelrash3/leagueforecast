import type { Settings } from "./types";

/**
 * A League Standings season put away once the league is done with it. The owner's choices of 2
 * November 2026: the mark is the season's own setting (`Settings.archived`), so it is the same on
 * every device; an archived season is read-only until it is brought back; the season picker and
 * the Seasons card list it under Archived, after the seasons in use; and any season can be
 * archived, with the Dashboard offering it once a season is over. Its games and scores are as they
 * were, and still count wherever they counted, Team Rankings included.
 */

/** Whether a season is archived: only when its setting says so, never by default. */
export const isArchived = (settings: Pick<Settings, "archived">): boolean =>
  settings.archived === true;

/** Why an archived season refuses an edit, said where the edit was tried. */
export const ARCHIVED_READ_ONLY =
  "This season is archived, so it is read-only. Unarchive it to change anything.";

/** The seasons in use, then the archived ones, each group in the order the list keeps. */
export const archiveGroups = <T extends { id: string }>(
  seasons: readonly T[],
  archived: ReadonlySet<string>
): { inUse: T[]; archived: T[] } => ({
  inUse: seasons.filter((season) => !archived.has(season.id)),
  archived: seasons.filter((season) => archived.has(season.id)),
});
