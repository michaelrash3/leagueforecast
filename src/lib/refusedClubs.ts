import type { GcImportOutcome, GcSkipReason } from "./gameChangerImport";

/**
 * The GameChanger ids a pull fetched and turned away, remembered so the next paste of the same
 * list does not fetch them again.
 *
 * A crawl's export has no Season column when the crawl searched every season, and on 26 September
 * 2026 pasting it again sent 220,103 ids, 22,011 calls, most of them teams an earlier pull had
 * already turned away as another season's: the app kept no record of those, so every paste asked
 * GameChanger all over again for an answer it already had. Kept beside the too-young list
 * (`tooYoungClubs.ts`), and for the same reason apart from the clubs the user threw out: this is a
 * cache of facts about ids, not a record of anybody's decisions.
 *
 * Two kinds of refusal are worth keeping. What an id is — a wiffle ball side, a high school squad,
 * grown men, an age above the oldest ranked — cannot change for that id, since GameChanger mints
 * one per team per season, so those hold for good. A team refused as another season's is only
 * refused while that season is not asked for, so it is kept against its squad year and skipped
 * only while that year is unticked. The rest are left to what already handles them: a team with no
 * age waits on its own list, a too-young one on its, and an empty schedule out of season is asked
 * about again when its season comes round.
 */
export type RefusedClubs = {
  /** Refused for what the team is. */
  forGood: ReadonlySet<string>;
  /** Refused as another season's, by the squad year its season falls in. */
  bySeason: ReadonlyMap<number, ReadonlySet<string>>;
};

export const NO_REFUSED_CLUBS: RefusedClubs = { forGood: new Set(), bySeason: new Map() };

/** The refusals no later pull can change. */
export const REFUSED_FOR_GOOD: ReadonlySet<GcSkipReason> = new Set<GcSkipReason>([
  "not-baseball",
  "high-school",
  "not-youth",
  "above-max-age",
]);

type Stored = { forGood: string[]; bySeason: Record<string, string[]> };

const idsOf = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];

/** Whatever was stored, as refusals; anything unreadable is left out rather than guessed at. */
export const coerceRefusedClubs = (raw: unknown): RefusedClubs => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_REFUSED_CLUBS;
  const stored = raw as Partial<Record<keyof Stored, unknown>>;
  const bySeason = new Map<number, Set<string>>();
  if (stored.bySeason && typeof stored.bySeason === "object" && !Array.isArray(stored.bySeason)) {
    Object.entries(stored.bySeason as Record<string, unknown>).forEach(([key, ids]) => {
      const year = Number(key);
      const kept = idsOf(ids);
      if (Number.isInteger(year) && kept.length > 0) bySeason.set(year, new Set(kept));
    });
  }
  return { forGood: new Set(idsOf(stored.forGood)), bySeason };
};

/** As it is stored: plain arrays, sorted, so a save that changes nothing looks like it. */
export const refusedClubsStored = (refused: RefusedClubs): Stored => ({
  forGood: [...refused.forGood].sort(),
  bySeason: Object.fromEntries(
    [...refused.bySeason.entries()]
      .filter(([, ids]) => ids.size > 0)
      .sort(([a], [b]) => a - b)
      .map(([year, ids]) => [String(year), [...ids].sort()])
  ),
});

/** How many ids are remembered, for saying so. */
export const refusedCount = (refused: RefusedClubs): number =>
  refused.forGood.size + [...refused.bySeason.values()].reduce((sum, ids) => sum + ids.size, 0);

/**
 * Whether a paste should leave this id out: refused for good, or refused as another season's
 * while that season is not among the ones this pull asks for.
 */
export const isRefusedClub = (
  refused: RefusedClubs,
  gcTeamId: string,
  seasonYears: readonly number[]
): boolean => {
  if (refused.forGood.has(gcTeamId)) return true;
  for (const [year, ids] of refused.bySeason) {
    if (ids.has(gcTeamId) && !seasonYears.includes(year)) return true;
  }
  return false;
};

/** The refusals a finished run learned, added to what was kept. */
export const rememberRefused = (
  refused: RefusedClubs,
  outcomes: readonly Pick<GcImportOutcome, "gcTeamId" | "skip" | "otherSeasonYear">[]
): RefusedClubs => {
  const forGood = new Set(refused.forGood);
  const bySeason = new Map([...refused.bySeason].map(([year, ids]) => [year, new Set(ids)]));
  let learned = false;
  outcomes.forEach(({ gcTeamId, skip, otherSeasonYear }) => {
    if (skip && REFUSED_FOR_GOOD.has(skip) && !forGood.has(gcTeamId)) {
      forGood.add(gcTeamId);
      learned = true;
    } else if (skip === "other-season" && otherSeasonYear !== undefined) {
      const ids = bySeason.get(otherSeasonYear) ?? new Set<string>();
      if (!ids.has(gcTeamId)) {
        ids.add(gcTeamId);
        bySeason.set(otherSeasonYear, ids);
        learned = true;
      }
    }
  });
  return learned ? { forGood, bySeason } : refused;
};

/** The refusals with these ids forgotten, so the next pull asks about them again. */
export const forgetRefused = (refused: RefusedClubs, gcTeamIds: Iterable<string>): RefusedClubs => {
  const drop = new Set(gcTeamIds);
  return {
    forGood: new Set([...refused.forGood].filter((id) => !drop.has(id))),
    bySeason: new Map(
      [...refused.bySeason].map(([year, ids]) => [
        year,
        new Set([...ids].filter((id) => !drop.has(id))),
      ])
    ),
  };
};
