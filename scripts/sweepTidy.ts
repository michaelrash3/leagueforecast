/**
 * The pool the recency sweep fits (`recencySweep.ts`): a backup put through the app's own tidy, so
 * the two cannot drift apart. Here, beside the script rather than inside it, so a test can hold it
 * to the device's tidy without running a sweep.
 *
 * The tidy deletes a club every one of whose names says it is no team (`dropNotATeam`), but never
 * one the owner vouched for, and the device tells it which (`usePoolTidy.ts`): the clubs said to be
 * real, and every club a League Standings team links. A backup carries the first as
 * `answers.realClubs`, so the sweep spares them as the device does. Untold, the tidy deleted a
 * vouched club and rewrote the games it played, and the back-test read a pool the app never ranks.
 *
 * A backup carries no League Standings seasons, only their ids on its pages, so a club that only
 * League links cannot be spared here (`leagueUnread` says when that could matter).
 */
import { tidyPool, type GcImportState, type PoolTidy } from "../src/lib/gameChangerImport.ts";
import type { TeamRankingsBackup } from "../src/lib/teamRankingsBackup.ts";

/** The backup tidied as the device tidies its pool, with the clubs said to be real spared. */
export const sweepTidy = (backup: TeamRankingsBackup): PoolTidy => {
  const before: GcImportState = {
    ageGroups: backup.ageGroups,
    teams: backup.teams,
    games: backup.games,
  };
  return tidyPool(
    before,
    undefined,
    undefined,
    undefined,
    new Set(backup.answers?.realClubs ?? [])
  );
};

/**
 * Whether a page of the backup plays in a League Standings season, whose links to its clubs the
 * file cannot show: a club that only such a link vouches for is deleted by the sweep's tidy where
 * the app's would keep it.
 */
export const leagueUnread = (backup: TeamRankingsBackup): boolean =>
  backup.ageGroups.some((group) => group.seasonIds.length > 0);
