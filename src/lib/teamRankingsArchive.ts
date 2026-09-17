import { buildTeamRankings, type AgeGroup, type ScoutGame, type ScoutTeam } from "./teamRankings";
import type { ScoutRankingRow } from "./teamRankings";

/**
 * A finished season, kept as its table rather than its games.
 *
 * A squad year that is over is three hundred and seventy-five thousand games and a hundred and
 * twelve thousand teams, and every one of them sits in the tab for as long as the pool holds it —
 * which is most of why a nationwide pool runs a browser out of memory. But nobody asks a finished
 * season for its game rows. They ask it who was good. So what is kept is the table the app showed:
 * rank, rating, record, strength of schedule, one row a team, and the games are let go.
 *
 * It is about a twentieth of the size, and the difference is the whole difference between carrying
 * last season and not being able to.
 *
 * What it costs, and it is a real cost: an archived table cannot be recomputed. Change how ratings
 * are worked out and every live page changes with it while the archives keep the numbers they were
 * archived with. That is what "final" means, and it is the reason the card says which version of
 * the model stands behind each one — a table from a different model is not wrong, but it is not
 * comparable either.
 */

/** Bumped when a row gains or loses a field, so a reader knows what it is looking at. */
export const ARCHIVE_VERSION = 1;

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
  /** The page it was, as it was named: "9U 2026". */
  id: string;
  name: string;
  ageLevel?: number;
  year?: number;
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
  archivedAt: string;
  fromGames: number;
  fromTeams: number;
  teams: number;
};

export const archiveEntryOf = (season: ArchivedSeason): ArchiveEntry => ({
  id: season.id,
  name: season.name,
  ...(season.ageLevel === undefined ? {} : { ageLevel: season.ageLevel }),
  ...(season.year === undefined ? {} : { year: season.year }),
  archivedAt: season.archivedAt,
  fromGames: season.fromGames,
  fromTeams: season.fromTeams,
  teams: season.rows.length,
});

/**
 * Builds the table for a page and keeps it, using the app's own ranking function.
 *
 * The same call the Rankings tab makes, so what is archived is what was on screen rather than a
 * second opinion about it. `state` is carried across from the team because the row does not hold
 * it and the live table's state filter reads it from there.
 */
export const archiveSeason = (
  group: AgeGroup,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  archivedAt: string
): ArchivedSeason => {
  const rows = buildTeamRankings(group.id, teams, games, group.myTeamId, ageGroups);
  const stateOf = new Map(teams.map((team) => [team.id, team.state]));
  const onPage = games.filter((game) => game.ageGroupId === group.id);
  return {
    version: ARCHIVE_VERSION,
    id: group.id,
    name: group.name,
    ...(group.ageLevel === undefined ? {} : { ageLevel: group.ageLevel }),
    ...(group.year === undefined ? {} : { year: group.year }),
    archivedAt,
    fromGames: onPage.length,
    fromTeams: new Set(onPage.flatMap((game) => [game.teamAId, game.teamBId])).size,
    rows: rows.map((row) => keepRow(row, stateOf.get(row.teamId))),
  };
};

const keepRow = (row: ScoutRankingRow, state: string | undefined): ArchivedRankingRow => ({
  rank: row.rank,
  teamName: row.teamName,
  rating: row.rating,
  record: row.record,
  wins: row.wins,
  losses: row.losses,
  ties: row.ties,
  games: row.games,
  strengthOfSchedule: row.strengthOfSchedule,
  sosRank: row.sosRank,
  ...(state ? { state } : {}),
  ...(row.ageLevel === undefined ? {} : { ageLevel: row.ageLevel }),
  crossAgeGames: row.crossAgeGames,
});

/**
 * Freezes a whole squad year's tables and takes the year out of the live pool.
 *
 * A squad year, not a page, because a page is not fitted on its own: every group sharing a season
 * year is rated together, so a 9U table is computed partly from the 8U teams that played down
 * against it. Archive one page of a year and the ones left behind lose games their ratings stood
 * on — the tables would quietly change, which is the one thing an archive must not cause.
 *
 * Some pages have no table to keep. 8U is below `MIN_RANKED_AGE_LEVEL` on purpose, so its games
 * exist only to inform the ages above it, and on a real pool that is a hundred and seventy-five
 * thousand of them. They go without a row, and the caller is told so it can say as much: they were
 * never a table, and the tables they did inform are frozen by the same call.
 */
export const archiveSquadYear = (
  year: number,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  archivedAt: string
): {
  seasons: ArchivedSeason[];
  state: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] };
  /** Games the year held, table or no table. */
  droppedGames: number;
  /** Teams no remaining game mentions. */
  droppedTeams: number;
  /** The pages whose games went without a table of their own, and how many each held. */
  unranked: Array<{ name: string; games: number }>;
} => {
  const ofYear = ageGroups.filter((group) => group.year === year);
  const seasons: ArchivedSeason[] = [];
  const unranked: Array<{ name: string; games: number }> = [];
  let droppedGames = 0;

  /*
   * Every table is built against the pool as it was, before anything is removed — so a page
   * archived second is frozen from the same games as the page archived first.
   */
  ofYear.forEach((group) => {
    const kept = archiveSeason(group, teams, games, ageGroups, archivedAt);
    droppedGames += kept.fromGames;
    if (kept.rows.length > 0) seasons.push(kept);
    else if (kept.fromGames > 0) unranked.push({ name: group.name, games: kept.fromGames });
  });

  const going = new Set(ofYear.map((group) => group.id));
  const remaining = games.filter((game) => !going.has(game.ageGroupId));
  const wanted = new Set(remaining.flatMap((game) => [game.teamAId, game.teamBId]));
  const keptTeams = teams.filter((team) => wanted.has(team.id));
  return {
    seasons,
    state: {
      ageGroups: ageGroups.filter((group) => !going.has(group.id)),
      teams: keptTeams,
      games: remaining,
    },
    droppedGames,
    droppedTeams: teams.length - keptTeams.length,
    unranked,
  };
};

/** The squad years a pool could freeze, newest first. A year with no page is not one. */
export const archivableYears = (ageGroups: AgeGroup[]): number[] =>
  [...new Set(ageGroups.flatMap((group) => (group.year === undefined ? [] : [group.year])))].sort(
    (a, b) => b - a
  );

/**
 * The pool with a page's games gone, and the teams no remaining game mentions.
 *
 * A team is not owned by a page — it plays on whichever ones its games are filed under — so
 * dropping a season drops its games first and then only the teams nothing else needs. A club that
 * played in the archived year and is playing in the live one stays exactly where it was; it is in
 * the archive as a row and in the pool as a team, which is what makes an archive readable on its
 * own and a restore unnecessary.
 *
 * One page at a time, which is almost never what a caller wants: use `archiveSquadYear`, because
 * the pages of a year are rated together and removing one of them changes the others. This is kept
 * for the single-page case and for the tests that pin the team-keeping rule.
 */
export const withoutSeason = (
  groupId: string,
  state: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] }
): { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[]; dropped: number } => {
  const games = state.games.filter((game) => game.ageGroupId !== groupId);
  const wanted = new Set(games.flatMap((game) => [game.teamAId, game.teamBId]));
  const teams = state.teams.filter((team) => wanted.has(team.id));
  return {
    // The page goes with its games: a page exists exactly when something is filed on it.
    ageGroups: state.ageGroups.filter((group) => group.id !== groupId),
    teams,
    games,
    dropped: state.teams.length - teams.length,
  };
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
