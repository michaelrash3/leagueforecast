import type { GcImportOutcome } from "./gameChangerImport";

/**
 * The teams GameChanger answered for, and nobody could say the age of.
 *
 * A schedule with no age level has nowhere to go: there is no page to file it under, so the import
 * hands the pool back untouched and the team leaves no trace at all. It is not a failure — the
 * fetch worked, the schedule is fine — so the cursor counts it settled, the retry button will not
 * look at it, and next week's rota will not either, because the rota walks the pages and this team
 * is on none of them. Four thousand six hundred of them disappeared exactly that way.
 *
 * So their ids are kept here instead, and they go back through the same route they came in on,
 * once a week, until somebody can say what age they are. That happens more often than it sounds:
 * GameChanger's own field gets filled in, a club renames a squad from "Warriors Spring 2027" to
 * "Warriors 10U", or enough of the team's opponents get pulled that their names settle it between
 * them. The moment one is filed it drops off this list and joins the ordinary weekly rotation for
 * its level.
 *
 * Only "no age" is kept. A 6U team is below the youngest level this app ranks and always will be,
 * and asking about it every week for ever is a request that can never come good.
 */
export type AgeUnknownTeam = {
  teamId: string;
  /** What it was called last time anybody asked, so a list of ids is readable. */
  name?: string;
  /** When it was first found to have no age. */
  firstSeen: string;
  /** When it was last asked about, so a run can take the stalest first. */
  lastTried: string;
  /** How many times it has been asked and still had no age. */
  tries: number;
};

export type AgeUnknownList = AgeUnknownTeam[];

/**
 * The list after a run: teams that could not be filed for want of an age go on, and teams that
 * were filed come off.
 *
 * Both halves matter. Adding is how a team gets asked about again; removing is how the list stops
 * growing for ever, and it has to key on being *filed* rather than on the absence of a skip —
 * a team that failed to fetch this week has not been answered and must stay.
 */
export const updateAgeUnknown = (
  list: AgeUnknownList,
  outcomes: readonly GcImportOutcome[],
  now: string
): AgeUnknownList => {
  const byId = new Map(list.map((entry) => [entry.teamId, entry]));
  outcomes.forEach((outcome) => {
    if (outcome.skip === "no-age") {
      const known = byId.get(outcome.gcTeamId);
      byId.set(outcome.gcTeamId, {
        teamId: outcome.gcTeamId,
        ...(outcome.teamName ? { name: outcome.teamName } : {}),
        firstSeen: known?.firstSeen ?? now,
        lastTried: now,
        tries: (known?.tries ?? 0) + 1,
      });
      return;
    }
    // Filed, at any level, by any route — including one its opponents settled. Question answered.
    if (!outcome.skip && !outcome.issue) byId.delete(outcome.gcTeamId);
  });
  return [...byId.values()];
};

/**
 * The ids to ask about, stalest first, capped.
 *
 * Stalest first so a list longer than the cap still comes round rather than the same head of it
 * being asked every week while the tail is never touched again.
 */
export const ageUnknownDue = (list: AgeUnknownList, limit: number): string[] =>
  [...list]
    .sort((a, b) => (a.lastTried < b.lastTried ? -1 : a.lastTried > b.lastTried ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.teamId);

/** A line for the panel. */
export const describeAgeUnknown = (list: AgeUnknownList): string => {
  if (list.length === 0) return "";
  const stubborn = list.filter((entry) => entry.tries >= 4).length;
  return (
    `${list.length.toLocaleString()} team${list.length === 1 ? "" : "s"} still have no age` +
    (stubborn > 0 ? `, ${stubborn.toLocaleString()} of them asked four times or more` : "") +
    "."
  );
};

export const coerceAgeUnknown = (raw: unknown): AgeUnknownList => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Partial<AgeUnknownTeam>;
    if (typeof row.teamId !== "string" || !row.teamId) return [];
    return [
      {
        teamId: row.teamId,
        ...(typeof row.name === "string" && row.name ? { name: row.name } : {}),
        firstSeen: typeof row.firstSeen === "string" ? row.firstSeen : "",
        lastTried: typeof row.lastTried === "string" ? row.lastTried : "",
        tries: typeof row.tries === "number" && Number.isFinite(row.tries) ? row.tries : 0,
      },
    ];
  });
};
