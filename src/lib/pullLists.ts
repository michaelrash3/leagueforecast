import { updateAgeUnknown, type AgeUnknownList } from "./ageUnknown";
import { inventedFromOutcomes } from "./deletedGames";
import type { GcImportOutcome } from "./gameChangerImport";
import { rememberRefused, type RefusedClubs } from "./refusedClubs";
import {
  loadAgeUnknown,
  loadRefusedClubs,
  loadTooYoungClubs,
  saveAgeUnknown,
  saveRefusedClubs,
  saveTooYoungClubs,
} from "./teamRankingsStorage";
import { rememberTooYoung, tooYoungFromOutcomes, type TooYoungClubs } from "./tooYoungClubs";

/** What a finished run leaves the lists a pull keeps beside the pool, as written. */
export type RunLists = {
  /** The teams waiting on an age, after this run. */
  ageless: AgeUnknownList;
  /**
   * Whether that list was written. It is the one that can fail quietly: without IndexedDB the whole
   * pool lives in localStorage, where a list this size does not fit, the write throws, the store
   * catches it and answers false, and every answer the run learned is gone with nothing said.
   * `onPoolWriteError` does not cover it — that fires on the IndexedDB path only.
   */
  agelessSaved: boolean;
  /** The teams turned away for good or as another season's, where this run turned any away. */
  refused?: RefusedClubs;
  /** The teams GameChanger says are too young to rank, where this run learned of any. */
  tooYoung?: TooYoungClubs;
  /**
   * The teams whose whole schedule was results on days that have not happened, for the caller to
   * throw out like a club somebody deleted by hand (`forgetClubs`), so the refusal outlasts the
   * dates that gave it away.
   */
  invented: string[];
};

/**
 * Writes what a finished run learned into the lists kept beside the pool, and says what they are
 * now. The pull in the browser and the pull run in the cloud both end through this, so a list one
 * of them keeps cannot be one the other forgets.
 *
 * Teams nobody could age go on the waiting list and teams that were filed come off it — for every
 * run, not just the catch-up one, because the opponent names that settle an age are read off the
 * team's own schedule, so whichever run happens to pull a team is the run that can answer for it.
 * Every team turned away for good or as another season's is remembered, so the next paste of the
 * same list leaves it out rather than asking GameChanger again (`refusedClubs.ts`). And the teams
 * GameChanger says are too young to rank, so the next export does not spend two requests each
 * rediscovering it: a nationwide list carries thousands, the paste can only skip the rows that name
 * an age themselves, and every other one is a fetch whose answer never changes. Safe to keep for
 * good — a GameChanger id is minted per team per season, so this cannot hold a club down as it
 * ages up.
 */
export const settleRunLists = (outcomes: readonly GcImportOutcome[], now: string): RunLists => {
  const ageless = updateAgeUnknown(loadAgeUnknown(), outcomes, now);
  const agelessSaved = saveAgeUnknown(ageless);
  const heldRefusals = loadRefusedClubs();
  const nextRefused = rememberRefused(heldRefusals, outcomes);
  if (nextRefused !== heldRefusals) saveRefusedClubs(nextRefused);
  const learnedTooYoung = tooYoungFromOutcomes(outcomes);
  const nextTooYoung =
    learnedTooYoung.length > 0 ? rememberTooYoung(loadTooYoungClubs(), learnedTooYoung) : undefined;
  if (nextTooYoung) saveTooYoungClubs(nextTooYoung);
  return {
    ageless,
    agelessSaved,
    ...(nextRefused !== heldRefusals ? { refused: nextRefused } : {}),
    ...(nextTooYoung ? { tooYoung: nextTooYoung } : {}),
    invented: inventedFromOutcomes(outcomes),
  };
};
