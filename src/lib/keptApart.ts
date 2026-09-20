/**
 * The pairs of GameChanger ids the user has said are two different clubs.
 *
 * Folding is never done for anybody: a wrong merge pools two clubs' results into one rating and
 * leaves nothing behind to notice, so every pairing is offered and waits. But offering is only
 * half of asking. A list that re-offers a pair the user has already turned down is a list that
 * trains them to stop reading it, and a nationwide pool has enough namesakes — one name at one age
 * in one state, twice — that the same handful come back after every pull. An answer of "no" has to
 * stick, and this is where it sticks.
 *
 * Keyed by GameChanger team id rather than by the pool's own ids, because those are the identities
 * that do not move. A fold deletes one of this app's team ids and a reset mints new ones for
 * everybody, either of which would quietly forget every "no" ever given; a GameChanger id is
 * minted once by GameChanger and never again.
 */

/** A pair of GameChanger team ids, in a fixed order so the pair reads the same either way round. */
export const apartKey = (a: string, b: string): string =>
  a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;

export type KeptApart = ReadonlySet<string>;

/** Whatever was stored, as a set. Anything that is not a pair of ids is dropped. */
export const coerceKeptApart = (raw: unknown): Set<string> => {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  raw.forEach((entry) => {
    if (typeof entry !== "string") return;
    const [a, b] = entry.split("\u0000");
    if (!a || !b || a === b) return;
    out.add(apartKey(a, b));
  });
  return out;
};

/** The set as it is stored: a plain array, sorted so a save that changes nothing looks like it. */
export const keptApartList = (apart: KeptApart): string[] => [...apart].sort();

export const isKeptApart = (apart: KeptApart, a: string, b: string): boolean =>
  apart.has(apartKey(a, b));

/** The list with this pair marked as two clubs. Returns the same set when it already was. */
export const keepApart = (apart: KeptApart, a: string, b: string): Set<string> =>
  new Set([...apart, apartKey(a, b)]);

/** The list with this pair forgotten, so it can be offered again. */
export const rejoin = (apart: KeptApart, a: string, b: string): Set<string> => {
  const next = new Set(apart);
  next.delete(apartKey(a, b));
  return next;
};
