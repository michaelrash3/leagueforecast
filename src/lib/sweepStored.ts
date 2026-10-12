import { sweepMarks, type SweepPool } from "./obviousFakes";
import type { AutoRemovals } from "./autoRemoved";
import {
  loadAutoRemoved,
  loadKeptApart,
  loadNamedAges,
  loadRealClubs,
} from "./teamRankingsStorage";

/**
 * The sweep for clubs plainly made up (`sweepMarks`) over `pool`, with the answers and the marks
 * the store holds: the marks before it and after it, the very same marks when it changed nothing.
 * The nightly runs it on the cloud copy after its pull and tidy (`cloudRunner.ts`). A pull in a
 * browser that keeps its own pool runs the same sweep in its tidy worker, told the same answers
 * (`tidyProtocol.ts`, `sweepAsked`).
 */
export const sweepStored = (
  pool: SweepPool,
  today: string
): [before: AutoRemovals, after: AutoRemovals] => {
  const before = loadAutoRemoved();
  const after = sweepMarks(
    pool,
    { realClubs: loadRealClubs(), keptApart: loadKeptApart(), namedAges: loadNamedAges() },
    before,
    today
  );
  return [before, after];
};
