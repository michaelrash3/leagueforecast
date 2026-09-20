/**
 * The ages somebody said out loud, for teams the app could not work out.
 *
 * There are three ways a pulled team gets an age: GameChanger's own field, its name saying so, or
 * enough of its opponents agreeing. When all three miss, the schedule is filed nowhere and the
 * team leaves no trace — and until this existed there was no fourth way. A person could open the
 * GameChanger page, read "9U" off it with their own eyes, and still have nowhere to put that.
 *
 * So this is the fourth way, and it goes first: a level named here beats GameChanger's own field,
 * not just its absence. That is deliberate. It is the only placement that also fixes the next bug
 * along — a team GameChanger has filed at the *wrong* age — and a person who opened the page is
 * better evidence than a field the rest of this codebase already treats as unreliable;
 * `profileAgeLevel` exists precisely because it is so often blank.
 *
 * It is keyed on the GameChanger id, which is minted per team per season. So an override cannot go
 * stale as a squad ages up: Fall and Spring of one squad year are one id at one level, and next
 * autumn is a different id that nobody has named yet.
 *
 * `insteadOf` records what GameChanger was saying at the moment somebody overrode it, so the panel
 * can notice later that GameChanger has changed its mind and say so. That is a notice rather than
 * a silent revert in either direction — the app neither ignores the club's own correction nor
 * throws away a person's answer behind their back.
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

/** The level somebody named for this team, if anybody did. */
export const namedAgeFor = (named: NamedAges, gcTeamId: string): number | undefined =>
  named.get(gcTeamId)?.level;

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
 * The names whose GameChanger age has since changed to something else.
 *
 * Not acted on — only listed, so the panel can say "you said 9U; GameChanger now says 10U" and let
 * the reader decide. Silently preferring either one would be the app making a judgement it has no
 * standing to make.
 */
export const namedAgesNowDisputed = (
  named: NamedAges,
  gcSays: (gcTeamId: string) => number | undefined
): NamedAge[] =>
  namedAgesList(named).filter((entry) => {
    const now = gcSays(entry.teamId);
    return now !== undefined && now !== entry.level;
  });
