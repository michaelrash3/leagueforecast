import type { SquadYearDeletion } from "./deleteSquadYear";
import { ageGroupYear } from "./teamRankings/seasons";
import type { AgeGroup } from "./teamRankings/types";
import type { ArchiveEntry, ArchivedSeason } from "./teamRankingsArchive";

/**
 * What Setup's Archive card says of each squad year, and of an archive or a delete before it is
 * made: worked out from the stored pool wherever it is held, the page's own store on a device or
 * the edit function's on the server (`yearOps.ts`), and said in the same words either way. Kept
 * apart from both, and from storage, so the live page reads it without the pool's code.
 */

/** What a squad year holds, so the size of the decision is on the card and not behind a button. */
export type YearSummary = {
  year: number;
  pages: number;
  games: number;
  teams: number;
  /** Tables already archived from this year, which a delete takes too. */
  archives: number;
};

/**
 * Every year with anything to archive or delete, newest first, which includes a year that is only
 * archived tables now (`deletableYears`): its pages, and the stored games and the sides they name
 * as the store counts them (`storedGamesByYear`), so no year is decoded to say what it holds. The
 * stored games, because those are the ones a delete can take: the league's fixtures are derived,
 * and go from the archive's point of view by the page going, not by being deleted.
 */
export const summariseYears = (
  ageGroups: readonly AgeGroup[],
  storedYears: readonly { year: number | undefined; games: number; teams: number | null }[],
  archives: readonly ArchiveEntry[]
): YearSummary[] => {
  const pages = new Map<number, number>();
  ageGroups.forEach((group) => {
    const year = ageGroupYear(group);
    if (year !== undefined) pages.set(year, (pages.get(year) ?? 0) + 1);
  });
  const stored = new Map(
    storedYears.flatMap((entry) => (entry.year === undefined ? [] : [[entry.year, entry] as const]))
  );
  const years = new Set([
    ...pages.keys(),
    ...archives.flatMap((entry) => (entry.year === undefined ? [] : [entry.year])),
  ]);
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      pages: pages.get(year) ?? 0,
      games: stored.get(year)?.games ?? 0,
      teams: stored.get(year)?.teams ?? 0,
      archives: archives.filter((entry) => entry.year === year).length,
    }));
};

/** What an archive would keep and take (`archiveSquadYear`'s counts). */
export type YearArchivePreview = {
  tables: { name: string; rows: number }[];
  droppedGames: number;
  droppedTeams: number;
  archivedLeagueGames: number;
  unranked: { name: string; games: number }[];
};

/** An archived table as the confirmation and the message name it. */
export const archiveTableOf = (season: ArchivedSeason): { name: string; rows: number } => ({
  name: season.name,
  rows: season.rows.length,
});

export const archivePreviewOf = (done: {
  seasons: readonly ArchivedSeason[];
  droppedGames: number;
  droppedTeams: number;
  archivedLeagueGames: number;
  unranked: readonly { name: string; games: number }[];
}): YearArchivePreview => ({
  tables: done.seasons.map(archiveTableOf),
  droppedGames: done.droppedGames,
  droppedTeams: done.droppedTeams,
  archivedLeagueGames: done.archivedLeagueGames,
  unranked: done.unranked.map(({ name, games }) => ({ name, games })),
});

/** What a delete would take (`deleteSquadYear`'s counts). */
export type YearDeletePreview = {
  pages: string[];
  droppedGames: number;
  droppedTeams: number;
  unlinkedTeams: number;
  tables: number;
  leagueSeasons: number;
};

export const deletePreviewOf = (done: SquadYearDeletion): YearDeletePreview => ({
  pages: [...done.pages],
  droppedGames: done.droppedGames,
  droppedTeams: done.droppedTeams,
  unlinkedTeams: done.unlinkedTeams,
  tables: done.archiveIds.length,
  leagueSeasons: done.leagueSeasonIds.length,
});

/** Whether there is anything under the year to archive, or to delete. */
export const archivesAnything = (preview: YearArchivePreview): boolean =>
  preview.tables.length > 0 || preview.unranked.length > 0;
export const deletesAnything = (preview: YearDeletePreview): boolean =>
  preview.pages.length > 0 || preview.tables > 0;

export const nothingUnder = (year: number): string => `Nothing is filed under ${year}.`;

const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/** The confirmation an archive asks, with what it keeps and takes. */
export const archiveConfirmation = (year: number, preview: YearArchivePreview) => {
  const lines = [
    `${preview.tables.length} final table${preview.tables.length === 1 ? "" : "s"} kept: ${preview.tables
      .map((table) => `${table.name} (${table.rows.toLocaleString()} teams)`)
      .join(", ")}.`,
    `${preview.droppedGames.toLocaleString()} stored game${preview.droppedGames === 1 ? "" : "s"} and ${preview.droppedTeams.toLocaleString()} team${preview.droppedTeams === 1 ? "" : "s"} deleted.`,
  ];
  if (preview.archivedLeagueGames > 0) {
    lines.push(
      `${preview.archivedLeagueGames.toLocaleString()} league game${preview.archivedLeagueGames === 1 ? "" : "s"} are in these tables and will no longer be counted in any live ranking. League Standings keeps its own seasons — this does not touch them.`
    );
  }
  if (preview.unranked.length > 0) {
    lines.push(
      `No table for ${preview.unranked.map((page) => `${page.name} (${page.games.toLocaleString()} games)`).join(", ")} — those ages are not ranked, so their games informed the tables above and keep no rows of their own.`
    );
  }
  lines.push("The tables become read-only. This cannot be undone.");
  return {
    title: `Archive ${year} and delete its games?`,
    message: lines.join("\n\n"),
    confirmLabel: `Archive ${year}`,
  };
};

/** What is said once an archive is made. */
export const archivedSaid = (year: number, preview: YearArchivePreview): string =>
  `${year} archived. ${plural(preview.tables.length, "final table")} kept under Archive; ${preview.droppedGames.toLocaleString()} games deleted.`;

/** The confirmation a delete asks, with what it takes. */
export const deleteConfirmation = (year: number, preview: YearDeletePreview) => {
  const lines: string[] = [];
  if (preview.pages.length > 0) {
    lines.push(
      `${preview.pages.length} page${preview.pages.length === 1 ? "" : "s"}: ${preview.pages.join(", ")}.`,
      `${preview.droppedGames.toLocaleString()} stored game${preview.droppedGames === 1 ? "" : "s"} and ${preview.droppedTeams.toLocaleString()} team${preview.droppedTeams === 1 ? "" : "s"} with nothing in any other year.`
    );
  }
  if (preview.unlinkedTeams > 0) {
    lines.push(
      `${preview.unlinkedTeams.toLocaleString()} club${preview.unlinkedTeams === 1 ? " plays" : "s play"} in another year too, so ${preview.unlinkedTeams === 1 ? "it stays" : "they stay"} — without the GameChanger ids ${preview.unlinkedTeams === 1 ? "it was" : "they were"} pulled as in ${year}.`
    );
  }
  if (preview.tables > 0) {
    lines.push(`${preview.tables} archived table${preview.tables === 1 ? "" : "s"} from ${year}.`);
  }
  if (preview.leagueSeasons > 0) {
    lines.push(
      "The League Standings seasons linked to these pages stop feeding a ranking. League Standings keeps them — this does not touch them."
    );
  }
  lines.push("Nothing is kept, and this cannot be undone.");
  return {
    title: `Delete ${year} and everything in it?`,
    message: lines.join("\n\n"),
    confirmLabel: `Delete ${year}`,
  };
};
