/**
 * A finished season as it is kept (`teamRankingsArchive.ts`, which re-exports all of it): its shape,
 * the entry the archive lists it by, and the reader of a kept one. Apart from the archiving itself,
 * which fits the season's board, because the pool's store and its backup read kept seasons back and
 * load at start, and only Team Rankings archives one.
 */
import { SEASON_SEGMENT_ORDER, type SeasonSegment } from "./teamRankings/seasons";

/**
 * Bumped when a row gains or loses a field, so a reader knows what it is looking at.
 *
 * 2: an archive is one half of a baseball year rather than the whole of it. A version-1 archive is
 * a whole-year table and reads fine, but it is not comparable with a half's.
 */
export const ARCHIVE_VERSION = 2;

/** One team's finishing position, and enough beside it to read the table without the games. */
export type ArchivedRankingRow = {
  rank: number;
  teamName: string;
  rating: number;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  strengthOfSchedule: number;
  sosRank: number;
  /** Where the club is, when the pull knew — the state filter in the live table reads the same. */
  state?: string;
  ageLevel?: number;
  crossAgeGames: number;
};

export type ArchivedSeason = {
  version: number;
  /** The archive's own id, minted from its name. Never a page id — see `archiveIdOf`. */
  id: string;
  /** What the page was called, kept as text: "9U 2026". */
  name: string;
  ageLevel?: number;
  year?: number;
  /** Which half of the year this is. Absent on a version-1 archive, which was the whole year. */
  segment?: SeasonSegment;
  archivedAt: string;
  /** What stood behind the table, so a reader can weigh it. */
  fromGames: number;
  fromTeams: number;
  rows: ArchivedRankingRow[];
};

/**
 * What the card lists without loading anything.
 *
 * The rows are the bulk — a hundred thousand of them a season — so the index carries only what a
 * list needs and each season's rows are fetched when somebody asks to see them. Loading every
 * archive at startup would put back the memory the archiving was for.
 */
export type ArchiveEntry = {
  id: string;
  name: string;
  ageLevel?: number;
  year?: number;
  segment?: SeasonSegment;
  archivedAt: string;
  fromGames: number;
  fromTeams: number;
  teams: number;
};

/**
 * A stored half, or nothing for a value that is not one.
 *
 * Both readers of a stored archive — the season's rows and the index that lists it — go through
 * this, because a reader that copies a whitelist of fields drops whatever it forgets: the half was
 * written by `archiveSeason` and `archiveEntryOf` and read back by neither, so an archived half
 * lost its fall or spring tag on every load and every backup restore.
 */
export const archivedSegment = (raw: unknown): SeasonSegment | undefined =>
  SEASON_SEGMENT_ORDER.find((segment) => segment === raw);

export const archiveEntryOf = (season: ArchivedSeason): ArchiveEntry => ({
  id: season.id,
  name: season.name,
  ...(season.ageLevel === undefined ? {} : { ageLevel: season.ageLevel }),
  ...(season.year === undefined ? {} : { year: season.year }),
  ...(season.segment === undefined ? {} : { segment: season.segment }),
  archivedAt: season.archivedAt,
  fromGames: season.fromGames,
  fromTeams: season.fromTeams,
  teams: season.rows.length,
});

/**
 * The same seasons with ids nothing else is using.
 *
 * An id is minted from a name, so freezing "9U 2026" a second time — a page re-created after an
 * archive, re-pulled and archived again — would mint the id the first archive already has. That
 * must not overwrite it: the two are different freezes of different games, and the older one is
 * the only record of the games it stood on. So a taken id gets a suffix and both are kept.
 *
 * Suffixed by count rather than by clock, because an archive is written once and read forever: an
 * id with a timestamp in it would be a different id every time the same call ran, which makes a
 * retry after a failed write into a second archive instead of the same one.
 */
export const withUniqueIds = (
  seasons: ArchivedSeason[],
  taken: Iterable<string>
): ArchivedSeason[] => {
  const used = new Set(taken);
  return seasons.map((season) => {
    if (!used.has(season.id)) {
      used.add(season.id);
      return season;
    }
    let at = 2;
    while (used.has(`${season.id}_${at}`)) at += 1;
    const id = `${season.id}_${at}`;
    used.add(id);
    return { ...season, id };
  });
};

/** Reads an archive back, or null because this is not one. Null rather than a throw, as elsewhere. */
export const coerceArchivedSeason = (raw: unknown): ArchivedSeason | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (!Array.isArray(value.rows)) return null;
  const num = (at: unknown, fallback = 0) =>
    typeof at === "number" && Number.isFinite(at) ? at : fallback;
  const str = (at: unknown) => (typeof at === "string" ? at : undefined);
  return {
    version: num(value.version, ARCHIVE_VERSION),
    id: value.id,
    name: value.name,
    ...(typeof value.ageLevel === "number" ? { ageLevel: value.ageLevel } : {}),
    ...(typeof value.year === "number" ? { year: value.year } : {}),
    ...(archivedSegment(value.segment) ? { segment: archivedSegment(value.segment)! } : {}),
    archivedAt: str(value.archivedAt) ?? "",
    fromGames: num(value.fromGames),
    fromTeams: num(value.fromTeams),
    rows: value.rows.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const entry = row as Record<string, unknown>;
      const teamName = str(entry.teamName);
      if (!teamName) return [];
      return [
        {
          rank: num(entry.rank),
          teamName,
          rating: num(entry.rating),
          record: str(entry.record) ?? "",
          wins: num(entry.wins),
          losses: num(entry.losses),
          ties: num(entry.ties),
          games: num(entry.games),
          strengthOfSchedule: num(entry.strengthOfSchedule),
          sosRank: num(entry.sosRank),
          ...(str(entry.state) ? { state: str(entry.state)! } : {}),
          ...(typeof entry.ageLevel === "number" ? { ageLevel: entry.ageLevel } : {}),
          crossAgeGames: num(entry.crossAgeGames),
        },
      ];
    }),
  };
};
