import type { NamedAs } from "./types";

/**
 * The names other clubs' schedules write for a club, as the owner answered them ("Same team as",
 * `ScoutTeam.namedAs`), as lists: what a fold keeps of two clubs' lists, and whether a list changed.
 */

const byScheduleThenName = (a: NamedAs, b: NamedAs): number =>
  a.schedule < b.schedule
    ? -1
    : a.schedule > b.schedule
      ? 1
      : a.name < b.name
        ? -1
        : a.name > b.name
          ? 1
          : 0;

/**
 * Every answer of `lists` once, ordered by schedule and then name, so a club folded either way round
 * holds the same list and a roster saved twice writes it the same. Undefined where there is none.
 */
export const joinNamedAs = (
  lists: readonly (readonly NamedAs[] | undefined)[]
): NamedAs[] | undefined => {
  const seen = new Set<string>();
  const joined: NamedAs[] = [];
  lists.forEach((list) =>
    list?.forEach(({ schedule, name }) => {
      const key = `${schedule}\u0000${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      joined.push({ schedule, name });
    })
  );
  return joined.length > 0 ? joined.sort(byScheduleThenName) : undefined;
};

/** Whether two lists hold the same answers in the same order: none and an empty list alike. */
export const sameNamedAs = (
  a: readonly NamedAs[] | undefined,
  b: readonly NamedAs[] | undefined
): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) &&
  (a ?? []).every(
    (entry, at) => entry.schedule === b?.[at]?.schedule && entry.name === b?.[at]?.name
  );
