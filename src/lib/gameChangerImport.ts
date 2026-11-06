/**
 * Folding a pulled GameChanger schedule into the Team Rankings pool.
 *
 * Everything here is pure: it takes the pool as it stands and a schedule, and returns the pool as
 * it would stand plus a report of what happened to that team. Nothing is saved, so the panel can
 * pull first, show the report, and only then write — and a re-pull of the same schedule is a
 * no-op rather than a second copy of every game.
 *
 * The identity rules are the whole of the difficulty, and they are deliberately asymmetric:
 *
 * - **A team pulled by id is that id.** GameChanger mints a new team id every season, so a club's
 *   Fall and Spring squads arrive as two ids. They are two teams here until somebody says
 *   otherwise — see `proposeSeasonPairings`, which suggests the pairing and waits. Folding them
 *   together automatically would be guessing, and the country has a great many Yankees.
 * - **An opponent is a name.** GameChanger never gives an opponent's team id, and the picture it
 *   shows beside the name is no identity either: none of 12,994 opponents' pictures on 3,000 pulled
 *   schedules was a pulled club's own (28 October 2026). A matching name is only the same club within
 *   one age level and season year, because "Yankees" on a 9U schedule in Kentucky and "Yankees" on an
 *   11U schedule in California are not related; the game itself, where the other club's own schedule
 *   holds it, is what says which one.
 */

/*
 * The importer and the tidy are split by what each part does, one module each under
 * `gameChangerImport/`, the way `teamRankings.ts` was. This file names exactly what it always
 * exported, from wherever it now lives, so nothing that imports from here had to change: the
 * index an import keeps (`poolIndex`), what one row says (`rows`), the shapes an import is handed
 * and hands back (`types`), a team's age (`ages`), where a pulled row is filed (`filing`), the
 * import itself (`importer`), the tidy's passes (`slots`, `claims`, `halves`, `pairings`, `folds`,
 * `namesakes`, `standIns`, `sweeps`) and the tidy that runs them (`tidy`).
 */

export {
  type GcImportState,
  type GcImportOutcome,
  type GcSeasonPairing,
  type GcSkipReason,
} from "./gameChangerImport/types";
export {
  ageFromOpponentNames,
  ageFromTwoOpponents,
  ageFromFixtures,
  oldestOpponentAge,
} from "./gameChangerImport/ages";
export {
  type GcImportOptions,
  importGcSchedule,
  vouchedByImport,
  type GcImporter,
  createGcImporter,
  importGcSchedules,
  summarizeGcImport,
} from "./gameChangerImport/importer";
export { claimFiledRows } from "./gameChangerImport/claims";
export { resolveSlotGames } from "./gameChangerImport/slots";
export { joinCrossedHalves, joinNamesakeHalves } from "./gameChangerImport/halves";
export {
  type GcTwinGame,
  type GcTwinSquad,
  proposeTwinSquads,
  markCountedElsewhere,
  markTbdGames,
  proposeSeasonPairings,
  isSettledPairing,
  pairSettledSquads,
  type GcPairingSide,
  type GcPairingComparison,
  comparePairing,
} from "./gameChangerImport/pairings";
export { mergeSameSquadIds, reclaimMisfiled } from "./gameChangerImport/folds";
export {
  type InStateRule,
  type NamesakeRule,
  type FittedRule,
  type TidyRules,
  SHIPPED_TIDY_RULES,
  DAY_CHECK_TIDY_RULES,
  IN_STATE_TIDY_RULES,
  ONE_NAMESAKE_TIDY_RULES,
  type NamesakeRefusal,
  type RefileRefusal,
  ownOpponentsOf,
  areOwnNeighbours,
  inStateNamesakes,
  oneNamesake,
} from "./gameChangerImport/namesakes";
export {
  resettleOffLevel,
  refileStandIns,
  mergeDuplicateStandIns,
} from "./gameChangerImport/standIns";
export {
  pruneOutOfSeason,
  type PoolTidy,
  schoolNamedTravelStandIns,
  dropNotATeam,
} from "./gameChangerImport/sweeps";
export {
  TIDY_STEPS,
  type TidyStepName,
  tidyChangedAnything,
  type TidyStep,
  type TidyWatcher,
  tidyPool,
} from "./gameChangerImport/tidy";

export { GC_PAIRING_EVIDENCE_LABEL, type GcPairingEvidence } from "./gcPairingEvidence";

export { MIN_OPPONENT_AGE_EVIDENCE } from "./opponentAgeBar";

/*
 * The rules version, the pool's fingerprint and the lines that say what a tidy did are a module of
 * their own (`tidyStamp.ts`), so Team Rankings can read a pool's stamp as it opens without loading
 * the tidy. Everything that has always read them here still can.
 */
export {
  describeTidy,
  latestImportedAt,
  poolSignature,
  poolSignatureOf,
  stampFromNewerRules,
} from "./tidyStamp";
