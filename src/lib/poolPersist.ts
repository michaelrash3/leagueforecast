import type { GcImportState } from "./gameChangerImport";
import {
  addScoutGames,
  saveAgeGroups,
  saveScoutGames,
  saveScoutGamesForGroups,
  saveScoutTeams,
  type PoolHolding,
} from "./teamRankingsStorage";

/** What saving a pull's pool came to. */
export type PoolPersisted = {
  /** Everything was written and no squad year was spared: what lets a pull go on. */
  saved: boolean;
  /**
   * Squad years a whole-pool save left as stored because the pool it was given has no games in
   * them (`saveScoutGames`). A pull never empties a year, so one here means the pull is holding a
   * pool it was not given.
   */
  spared: (number | undefined)[];
};

/**
 * Saves the pool a pull is holding: the pages, the roster, and the games wherever the hold says.
 *
 * The pull in the browser (`GameChangerImportPanel`) and the pull run in the cloud save through
 * this one function, so what a hold means cannot come apart between them. Only the whole-pool save
 * can spare a year, because it is the only one that decides what every year should hold; a section
 * holding pages, or one only adding what nobody had pulled before, is scoped to what it names and
 * leaves the rest of the pool alone by construction.
 *
 * A spared year counts as a refusal, not a partial success. The pull stops on it, which is what
 * should happen: it is holding a pool the store will not take, so everything it fetches from there
 * on could not be kept either. The caller says so; this only reports it.
 */
export const persistPool = (
  next: GcImportState,
  holding: PoolHolding | undefined
): PoolPersisted => {
  const savedGroups = saveAgeGroups(next.ageGroups);
  const savedTeams = saveScoutTeams(next.teams);
  if (holding?.kind === "pages") {
    const savedGames = saveScoutGamesForGroups(holding.ageGroupIds, next.games);
    return { saved: savedGroups && savedTeams && savedGames, spared: [] };
  }
  if (holding?.kind === "additions") {
    const savedGames = addScoutGames(next.games);
    return { saved: savedGroups && savedTeams && savedGames, spared: [] };
  }
  const whole = saveScoutGames(next.games);
  return {
    saved: savedGroups && savedTeams && whole.written && whole.spared.length === 0,
    spared: whole.spared,
  };
};
