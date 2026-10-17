/**
 * The pool the recency sweep fits (`recencySweep.ts`): a backup put through the app's own tidy, so
 * the two cannot drift apart. Here, beside the script rather than inside it, so a test can hold it
 * to the device's tidy without running a sweep.
 *
 * The tidy deletes a club every one of whose names says it is no team (`dropNotATeam`), but never
 * one the owner vouched for, and the device tells it which (`usePoolTidy.ts`): the clubs said to be
 * real, and every club a League Standings team links (`leagueLinkedClubsOf`). Untold, the tidy
 * deleted a vouched club and rewrote the games it played, and the back-test read a pool the app
 * never ranks.
 *
 * Every backup carries the first, as `answers.realClubs`. The second needs the League Standings
 * seasons themselves, which only the whole-browser backup (Settings, "Backup JSON") carries
 * beside its pool; a Team Rankings file, JSON or CSV, holds only the seasons' ids on its
 * pages. So the sweep spares what the device spares from a whole-browser backup, and from a Team
 * Rankings file spares the real list alone, saying when that could matter (`leagueUnread`).
 */
import { coerceBackup } from "../src/lib/backup.ts";
import { tidyPool, type GcImportState, type PoolTidy } from "../src/lib/gameChangerImport.ts";
import {
  leagueLinkedClubsOf,
  type LeagueSeasonData,
  type SeasonReader,
} from "../src/lib/live/allKnown.ts";
import {
  looksLikeJsonBackup,
  parseTeamRankingsCsv,
  readTeamRankingsFile,
  type TeamRankingsBackup,
} from "../src/lib/teamRankingsBackup.ts";

/** A file the sweep reads: its pool, and its League Standings seasons where it carries them. */
export type SweepFile = { pool: TeamRankingsBackup; seasons: SeasonReader | null };

/** A season the file does not hold, read as the device's storage reads one: empty. */
const NO_SEASON: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

/**
 * Any backup the app writes that holds a pool, or null for a file that is none: the Team Rankings
 * JSON or the older CSV, read as the app reads them, or the whole-browser backup, read as a restore
 * reads it (`coerceBackup`), whose seasons are handed over by id as the device's storage hands
 * them to the League pass. One parse of the JSON, since a whole-browser backup of a nationwide pool
 * runs to hundreds of megabytes.
 */
export const readSweepFile = (raw: string): SweepFile | null => {
  if (!looksLikeJsonBackup(raw)) {
    const pool = parseTeamRankingsCsv(raw);
    return pool ? { pool, seasons: null } : null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const pool = readTeamRankingsFile(parsed);
  if (pool) return { pool, seasons: null };
  const whole = coerceBackup(parsed);
  if (whole?.kind !== "full") return null;
  const held = new Map(
    whole.backup.seasons.map(({ id, teams, matchups, logs }) => [id, { teams, matchups, logs }])
  );
  return {
    pool: whole.backup.teamRankings,
    seasons: (seasonId) => held.get(seasonId) ?? NO_SEASON,
  };
};

/**
 * The backup tidied as the device tidies its pool: the clubs said to be real spared, and with
 * `seasons`, every club a League Standings team links, as the device spares them.
 */
export const sweepTidy = (
  backup: TeamRankingsBackup,
  seasons: SeasonReader | null = null
): PoolTidy => {
  const before: GcImportState = {
    ageGroups: backup.ageGroups,
    teams: backup.teams,
    games: backup.games,
  };
  const spared = new Set([
    ...(backup.answers?.realClubs ?? []),
    ...(seasons ? leagueLinkedClubsOf(before, seasons) : []),
  ]);
  return tidyPool(before, undefined, undefined, undefined, spared);
};

/**
 * Whether a page of the backup plays in a League Standings season: read without the seasons (a
 * Team Rankings file), a club that only such a season links is deleted by the sweep's tidy where
 * the app's would keep it.
 */
export const leagueUnread = (backup: TeamRankingsBackup): boolean =>
  backup.ageGroups.some((group) => group.seasonIds.length > 0);
