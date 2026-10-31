/**
 * The club ids a pool has let go of, so a mint never hands one out again.
 *
 * A club's id is `S-`, the first four letters and digits of its name, and the first counter free
 * (`S-RIVE`, `S-RIVE2`), free against the roster alone. A club folded into another (a pairing,
 * Same team as, a tidy) or deleted gave its id back, and the next club whose name starts the same
 * was minted under it. Whatever had kept the id then named the new club with nothing to say so: a
 * League Standings team picked as the folded club carried its league's games onto the new club's
 * record, and the new club's tournament results into the league's forecast.
 *
 * So the pool keeps, for each family of ids that has let one go, the highest counter it let go of,
 * and a mint skips every counter of the family up to it. A high-water rather than the ids: the
 * families are far fewer than the clubs folded and deleted over a season, and once each family
 * has one it grows no more. Measured on the seeded fixture at its full size (20,204 clubs, 58,105
 * games), its first words spread over 4,000 invented words as a real pool's are (2,790 families):
 * with a tenth of its stand-ins and slots and 1% of its pulled clubs let go of, the high-water is
 * 2,306 bytes of the gzipped copy (0.24%) where the ids themselves would be 3,900 (0.40%); with
 * every stand-in and slot and a tenth of the pulled clubs (10,695 ids, 2,020 families), 8,610
 * (0.97%) where the ids would be 27,627 (3.11%). The fixture as drawn, 26 families, is 262 at most.
 *
 * Kept inside the roster's own stored value (`CompactTeams.h`), so it is written exactly when the
 * roster is, and worked out there, from the roster the store held before the save
 * (`saveScoutTeams`), so no fold or deletion has to remember to say so. Team Rankings started
 * again empties the roster, and the high-water with it: from then on a League pick is kept to its
 * club by the GameChanger id beside it (`readPick`), not by this.
 */

/** The highest counter retired in each family of minted ids, by the family's letters. */
export type RetiredIds = ReadonlyMap<string, number>;

export const NO_RETIRED: RetiredIds = new Map();

/** What a mint asks of the ids already taken: whether one is. A `Set` of them is one. */
export type TakenIds = { has: (id: string) => boolean };

/** Ids taken for a run of mints, which each mint adds to. */
export type MintedIds = TakenIds & { add: (id: string) => unknown };

const MINTED = /^S-([A-Z0-9]+)$/;
const COUNTER = /^[1-9][0-9]*$/;

/**
 * Every family and counter `id` reads as minted from: `S-RIVE2` is RIVE's second, and `S-RIV2`
 * both RIV2's first and RIV's second, since a name of three letters makes a family of three. Up to
 * four readings, none for an id no mint makes (`S-off-…`, a stand-in minted with letters after it).
 */
const readingsOf = (id: string): [string, number][] => {
  const rest = MINTED.exec(id)?.[1];
  if (!rest) return [];
  const out: [string, number][] = [];
  for (let length = 1; length <= Math.min(4, rest.length); length += 1) {
    const suffix = rest.slice(length);
    if (suffix === "") out.push([rest, 1]);
    else if (COUNTER.test(suffix) && suffix !== "1") out.push([rest.slice(0, length), +suffix]);
  }
  return out;
};

/**
 * Whether `id` is at or under its family's high-water in `retired`: let go of, or skipped over by
 * every mint since. Read every way the id can be, as a mint of any family could make it.
 */
export const wasRetired = (retired: RetiredIds, id: string): boolean =>
  retired.size > 0 &&
  readingsOf(id).some(([family, counter]) => counter <= (retired.get(family) ?? 0));

/**
 * `retired` with every id of `before` that `after` does not hold: the high-water of each family
 * raised to it, under the longest family the id reads as, which every reading of it then meets.
 * The same map when nothing was let go of, so a save that folds nothing writes the value it had.
 */
export const retireIds = (
  retired: RetiredIds,
  before: Iterable<string>,
  after: { has: (id: string) => boolean }
): RetiredIds => {
  let next: Map<string, number> | null = null;
  for (const id of before) {
    if (after.has(id)) continue;
    const readings = readingsOf(id);
    const longest = readings[readings.length - 1];
    if (!longest) continue;
    const [family, counter] = longest;
    if (counter <= ((next ?? retired).get(family) ?? 0)) continue;
    next ??= new Map(retired);
    next.set(family, counter);
  }
  return next ?? retired;
};

/** Both high-waters, each family's the higher: a backup's laid over the store's, as one. */
export const mergeRetired = (a: RetiredIds, b: RetiredIds): RetiredIds => {
  if (a.size === 0) return b;
  let next: Map<string, number> | null = null;
  for (const [family, counter] of b) {
    if (counter <= ((next ?? a).get(family) ?? 0)) continue;
    next ??= new Map(a);
    next.set(family, counter);
  }
  return next ?? a;
};

/** The ids `taken` holds, and every one `retired` has let go of: what a mint must not hand out. */
export const withRetired = (taken: TakenIds, retired: RetiredIds): TakenIds =>
  retired.size === 0 ? taken : { has: (id) => taken.has(id) || wasRetired(retired, id) };

/**
 * The ids of a run of mints, a tidy's or a typed game's: `ids`, a roster's as the run began, every
 * one `retired` let go of, and each the run mints, so one let go of during the run is not handed
 * out again later in it either.
 */
export const mintedIds = (ids: Iterable<string>, retired: RetiredIds = NO_RETIRED): MintedIds => {
  const held = new Set(ids);
  return {
    has: (id) => held.has(id) || wasRetired(retired, id),
    add: (id) => held.add(id),
  };
};

/** As stored: each family's counter under its letters, in order, and nothing for none. */
export const storedRetired = (retired: RetiredIds): Record<string, number> | undefined =>
  retired.size === 0
    ? undefined
    : Object.fromEntries([...retired].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Whatever was stored, as a high-water: a family of a mint's letters, a whole counter of 1 up. */
export const coerceRetired = (raw: unknown): RetiredIds => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return NO_RETIRED;
  const out = new Map<string, number>();
  for (const [family, counter] of Object.entries(raw)) {
    if (/^[A-Z0-9]{1,4}$/.test(family) && Number.isSafeInteger(counter) && Number(counter) >= 1)
      out.set(family, Number(counter));
  }
  return out.size === 0 ? NO_RETIRED : out;
};
