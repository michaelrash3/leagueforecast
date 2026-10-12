/**
 * The GameChanger ids this app has learned are below the youngest level it ranks.
 *
 * A nationwide export carries thousands of 6U and 7U squads. The paste already drops the ones
 * whose row names an age — that is `MIN_AGE_LEVEL` filtering in the import panel — but a row that
 * names no age is kept, because a pasted id usually does not say one and GameChanger's own answer
 * settles it. So those are fetched, GameChanger says 7U, the schedule is refused, and nothing
 * remembers. The next export does it all again: two requests per team, every time, for a schedule
 * that can never be filed.
 *
 * This is where the answer is kept. It is not the list of clubs the user threw out, and mixing the
 * two would be a mistake in both directions: that list is a record of somebody's decisions, a
 * dozen fakes they looked at and refused, and burying it under four thousand rec-league toddlers
 * would make it unreadable. This one is a cache of a fact about the world.
 *
 * It is safe to keep for ever because a GameChanger id is minted per team per season. A club's 7U
 * squad this year has a different id from its 8U squad next year, so remembering "this id is too
 * young" can never hold a team down as it ages up. If GameChanger itself was wrong about the age,
 * forgetting the id is one call and the next pull decides again.
 */

export type TooYoungClubs = ReadonlySet<string>;

/** Whatever was stored, as a set. Anything that is not an id is dropped. */
export const coerceTooYoungClubs = (raw: unknown): Set<string> => {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  raw.forEach((entry) => {
    if (typeof entry === "string" && entry.length > 0) out.add(entry);
  });
  return out;
};

/** The set as it is stored: a plain array, sorted so a save that changes nothing looks like it. */
export const tooYoungClubsList = (clubs: TooYoungClubs): string[] => [...clubs].sort();

export const isTooYoungClub = (clubs: TooYoungClubs, gcTeamId: string): boolean =>
  clubs.has(gcTeamId);

/** The set with these ids remembered as below the youngest ranked level. */
export const rememberTooYoung = (clubs: TooYoungClubs, gcTeamIds: readonly string[]): Set<string> =>
  new Set([...clubs, ...gcTeamIds]);

/** The set with these ids allowed back, for when GameChanger's own answer was wrong. */
export const forgetTooYoung = (clubs: TooYoungClubs, gcTeamIds: readonly string[]): Set<string> => {
  const next = new Set(clubs);
  gcTeamIds.forEach((id) => next.delete(id));
  return next;
};

/** The ids on a finished run that turned out to be too young to rank. */
export const tooYoungFromOutcomes = (
  outcomes: readonly { gcTeamId: string; skip?: string }[]
): string[] =>
  outcomes.filter((outcome) => outcome.skip === "below-min-age").map((outcome) => outcome.gcTeamId);
