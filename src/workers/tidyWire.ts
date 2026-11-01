/**
 * The pool as it crosses to the tidy worker and back (`tidyProtocol.ts`): packed compact, as
 * IndexedDB stores it, and the worker's answer laid over the caller's own arrays.
 *
 * Apart from the protocol because the page packs a pool and reads an answer whether or not it
 * runs the tidy itself, and the protocol imports the tidy and the inspection, which only the worker
 * and a page with no worker run (`usePoolTidy`).
 */
import type { GcImportState } from "../lib/gameChangerImport";
import type { AgeGroup } from "../lib/teamRankings/types";
import {
  decodePoolGames,
  decodePoolTeams,
  encodeScoutGames,
  encodeScoutTeams,
} from "../lib/teamRankingsCompact";

/** The pool as it crosses: teams and games compact, age groups as they are (they are few). */
export type PoolWire = { ageGroups: AgeGroup[]; teams: unknown; games: unknown };

export const packPool = (state: GcImportState): PoolWire => ({
  ageGroups: state.ageGroups,
  teams: encodeScoutTeams(state.teams),
  games: encodeScoutGames(state.games),
});

export const unpackPool = (wire: PoolWire): GcImportState => ({
  ageGroups: wire.ageGroups,
  teams: decodePoolTeams(wire.teams),
  games: decodePoolGames(wire.games),
});

/**
 * The tidied pool, as the caller should hold it: what the tidy changed laid over what it was
 * handed, so a part it did not touch is the very array the caller already has — and an identity
 * check downstream reads it as unchanged, which it is.
 */
export const applyTidied = (
  before: GcImportState,
  changed: Partial<GcImportState>
): GcImportState => ({
  ageGroups: changed.ageGroups ?? before.ageGroups,
  teams: changed.teams ?? before.teams,
  games: changed.games ?? before.games,
});
