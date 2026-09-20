/**
 * The ages somebody said out loud, for teams the app could not work out.
 *
 * There are three ways a pulled team gets an age: GameChanger's own field, its name saying so, or
 * enough of its opponents agreeing. When all three miss, the schedule is filed nowhere and the
 * team leaves no trace — and until this existed there was no fourth way. A person could open the
 * GameChanger page, read "9U" off it with their own eyes, and still have nowhere to put that.
 *
 * So this is the fourth way, and it stands in until the club answers for itself.
 *
 * A named level is used ahead of GameChanger's own field, which is what lets somebody correct a
 * team filed at the wrong age as well as one filed at none. But the moment GameChanger's answer
 * *changes* from whatever it was when the name was given, GameChanger wins and the named level is
 * dropped. The club knows its own age, and a note somebody made weeks ago is not evidence against
 * a page its own people have since edited.
 *
 * `insteadOf` is what makes that decidable: it records what GameChanger was saying at the moment
 * somebody overrode it — including that it was saying nothing — so "has GameChanger changed its
 * mind?" is a comparison rather than a guess. Named over silence and GameChanger later says 10U:
 * GameChanger wins. Named over a wrong 12U and GameChanger still says 12U: the correction stands,
 * because nothing has changed and dropping it would just restore the error.
 *
 * Keyed on the GameChanger id, which is minted per team per season, so a named level cannot go
 * stale as a squad ages up: Fall and Spring of one squad year are one id at one level, and next
 * autumn is a different id nobody has named.
 */

import { MAX_AGE_LEVEL, MIN_AGE_LEVEL } from "./teamRankings/seasons";

export type NamedAge = {
  /** The GameChanger id, which is the identity that does not move. */
  teamId: string;
  /** A level this app ranks. Anything else is refused rather than clamped — see `coerceNamedAges`. */
  level: number;
  /** What it was called when somebody named it, so a list of ids is readable. */
  name?: string;
  namedAt: string;
  /** What GameChanger said at the time, when it said anything. */
  insteadOf?: number;
};

export type NamedAges = ReadonlyMap<string, NamedAge>;

/** Whether this is a level somebody may name. */
export const isNameableLevel = (level: unknown): level is number =>
  typeof level === "number" &&
  Number.isInteger(level) &&
  level >= MIN_AGE_LEVEL &&
  level <= MAX_AGE_LEVEL;

/**
 * Whatever was stored, as a map. A row naming a level this app does not rank is dropped.
 *
 * Refused rather than clamped, and the difference matters: a stored 6U would file the team
 * nowhere — `resolveAgeGroup` returns null below `MIN_AGE_LEVEL` — while still being an answer, so
 * the team would come off the ageless list and land on no page either. It would vanish from both.
 * Dropping the row leaves it exactly where it was, still being asked about.
 */
export const coerceNamedAges = (raw: unknown): Map<string, NamedAge> => {
  const out = new Map<string, NamedAge>();
  if (!Array.isArray(raw)) return out;
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Partial<NamedAge>;
    if (typeof row.teamId !== "string" || !row.teamId) return;
    if (!isNameableLevel(row.level)) return;
    out.set(row.teamId, {
      teamId: row.teamId,
      level: row.level,
      ...(typeof row.name === "string" && row.name ? { name: row.name } : {}),
      namedAt: typeof row.namedAt === "string" ? row.namedAt : "",
      ...(isNameableLevel(row.insteadOf) ? { insteadOf: row.insteadOf } : {}),
    });
  });
  return out;
};

/** As it is stored: a plain array, sorted so a save that changes nothing looks like it. */
export const namedAgesList = (named: NamedAges): NamedAge[] =>
  [...named.values()].sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));

/**
 * Whether a named level still stands, given what GameChanger says now.
 *
 * It does not the moment GameChanger's answer differs from what it was when the level was named.
 * `undefined` on either side is an answer in itself: named over silence and GameChanger has since
 * spoken is a change, and so is a field that has gone blank since.
 */
export const namedAgeStands = (entry: NamedAge, gcSaysNow: number | undefined): boolean =>
  gcSaysNow === entry.insteadOf;

/**
 * The level to file this team under, or undefined to let the app work it out.
 *
 * `gcSaysNow` is whatever GameChanger's own field says on the schedule in hand. When it has
 * changed since the level was named, this answers undefined and the club's own answer is used.
 */
export const namedAgeFor = (
  named: NamedAges,
  gcTeamId: string,
  gcSaysNow: number | undefined
): number | undefined => {
  const entry = named.get(gcTeamId);
  if (!entry) return undefined;
  return namedAgeStands(entry, gcSaysNow) ? entry.level : undefined;
};

/** The map with this team's age named. Refuses a level the app does not rank. */
export const nameAge = (named: NamedAges, entry: NamedAge): Map<string, NamedAge> => {
  const next = new Map(named);
  if (isNameableLevel(entry.level)) next.set(entry.teamId, entry);
  return next;
};

/** The map with this team's answer taken back, so the app works it out again. */
export const forgetNamedAge = (named: NamedAges, gcTeamId: string): Map<string, NamedAge> => {
  const next = new Map(named);
  next.delete(gcTeamId);
  return next;
};

/**
 * The named levels GameChanger has since overruled, so they can be cleared out.
 *
 * Already ignored by the time this is called — `namedAgeFor` stops honouring one as soon as
 * GameChanger's answer moves — so this only tidies away the rows that are no longer doing
 * anything. Kept as a separate step rather than deleted inside the fold, because the fold is
 * given a read-only view of these and a list somebody spent an evening on should not be rewritten
 * as a side effect of a refresh.
 */
export const namedAgesOverruled = (
  named: NamedAges,
  gcSays: (gcTeamId: string) => number | undefined
): NamedAge[] =>
  namedAgesList(named).filter((entry) => !namedAgeStands(entry, gcSays(entry.teamId)));
