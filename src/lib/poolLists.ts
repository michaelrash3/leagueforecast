import { countedTwice, type CountedTwice } from "./countedTwice";
import {
  proposeSeasonPairings,
  proposeTwinSquads,
  type GcImportState,
  type GcSeasonPairing,
  type GcTwinSquad,
} from "./gameChangerImport";
import type { KeptApart } from "./keptApart";
import { segmentOn } from "./teamRankings/seasons";
import { unpulledClubs, type UnpulledClub } from "./unpulledClubs";
import { withoutClubs } from "./unrealClubs";
import { filedAtWrongAge, type WrongAgeClub } from "./wrongAge";

/**
 * The lists Pool health shows under its numbers: the clubs worth pulling, one club twice in a
 * season, one squad on GameChanger twice, a club holding one game twice, and the clubs that look
 * filed at the wrong age in the squad year being played.
 *
 * Worked out in the worker, beside the numbers. Each walks the whole pool, and the page did the
 * first four after the worker's answer arrived, on the pool the worker had just unpacked and thrown
 * away: on the 18:40 pool a second long task of 2.4 s after each press, 12 to 13 s at a phone's
 * speed. The wrong-age list adds 0.9 to 1.1 s on the 26 and 28 September pools, off the page's
 * thread.
 */
export type PoolLists = {
  toPull: UnpulledClub[];
  duplicates: GcSeasonPairing[];
  twins: GcTwinSquad[];
  twice: CountedTwice[];
  wrongAge: WrongAgeClub[];
};

/** How many of the clubs worth pulling Pool health draws; the rest are in its file. */
export const TO_PULL_DRAWN = 5;

/**
 * The lists, of the pool without the clubs `leftOut` (taken off as plainly made up and left off the
 * boards, `withoutClubs` as the boards take them out): Pool health asks about none of them but in
 * Removed for you. A list naming one would ask about games that count for nothing, and a pair of
 * twins offering one to fold into a standing club would, pressed, put its games back on the boards
 * without a word. On the 11 October 2026 pool 1 of the 100 twin pairs paired a removed club with a
 * standing one, and 7 of the 985 rows counted twice named one.
 */
export const poolLists = (
  whole: GcImportState,
  apart: KeptApart,
  today: string,
  leftOut: ReadonlySet<string>
): PoolLists => {
  const state =
    leftOut.size === 0
      ? whole
      : { ...whole, ...withoutClubs(leftOut, whole.teams, whole.games, whole.ageGroups) };
  return {
    toPull: unpulledClubs(state),
    duplicates: proposeSeasonPairings(state.teams, state.games, apart, state.ageGroups).filter(
      (pairing) => pairing.kind === "same-season"
    ),
    twins: proposeTwinSquads(state.teams, state.games, apart),
    twice: countedTwice(state.teams, state.games, today),
    wrongAge: filedAtWrongAge(state, segmentOn(today).year),
  };
};
