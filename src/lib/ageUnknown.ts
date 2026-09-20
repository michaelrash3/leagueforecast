import { daysSince } from "./date";
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
 * "Warriors 10U", or the team plays more games against opponents who do name an age. The moment
 * one is filed it drops off this list and joins the ordinary weekly rotation for its level.
 *
 * Pulling other teams is not on that list, and used to be. It cannot help: `ageFromOpponentNames`
 * reads the opponent names off the schedule just fetched for *this* team, and neither the pool nor
 * the index is on that path. Only this team's own schedule can answer the question about it.
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
 * Passes a team gets before it is left alone.
 *
 * Only two things can change the answer. The team plays more games, against opponents who do name
 * an age — the opponents' names come off the team's own schedule, so pulling other teams never
 * helps. Or the club fills in GameChanger's age field, or renames the squad.
 *
 * Eight covers a full fall season, and a team that has played two months without once facing an
 * opponent who names an age is in a league where nobody does. Those exist and they are the bulk of
 * this list: rec leagues whose teams are "Mears 1 - 2026", "Mirror Lake 2 2026", playing each other
 * all season. No number of passes settles them, so the honest thing is to stop, count them, and say
 * so — rather than ask a question for ever that can never come good.
 */
export const AGE_UNKNOWN_MAX_TRIES = 8;

/**
 * And the calendar that has to have passed as well.
 *
 * This number exists because the count above was, on its own, a lie. Nothing here used to read a
 * clock, so eight *passes* was whatever eight presses of a button happened to take — and on the
 * shipped daily cadence every day is a catch-up day. Driving the real `dueRefresh` and
 * `updateAgeUnknown` over a calendar: a list shorter than the cap was abandoned on day 8, a list
 * of 4,013 against the 2,000 cap on day 15, the same list against a 10,000 cap on day 8, and eight
 * presses in one afternoon finished it on day 2. On the weekly rotation it went the other way and
 * took 101 days, because the cap stranded the tail. The card meanwhile told the reader they had
 * been "left alone after 8 weeks of nobody naming an age".
 *
 * The reasoning behind the eight was always about a season passing, not about how often somebody
 * pressed a button, so the rule now says both: a team is left alone once it has had its eight asks
 * AND eight real weeks have gone by since it was first found.
 */
export const AGE_UNKNOWN_GIVE_UP_DAYS = 56;

/**
 * The least time between two asks about the same team.
 *
 * A team is asked again because it might have played since, or because somebody might have edited
 * its GameChanger page. Neither happens twice in an afternoon, so asking twice in one is a request
 * that cannot come good — and, before this, one that cost the team two of its eight lives.
 */
export const AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS = 7;

/**
 * Whether a team is still worth asking about.
 *
 * A date that cannot be read is not evidence of age, so it falls back to the try budget alone —
 * `coerceAgeUnknown` writes an empty string for a row that arrived without one.
 */
export const stillWorthAsking = (entry: AgeUnknownTeam, now: Date): boolean => {
  if (entry.tries < AGE_UNKNOWN_MAX_TRIES) return true;
  const age = daysSince(entry.firstSeen, now);
  return age !== null && age < AGE_UNKNOWN_GIVE_UP_DAYS;
};

/**
 * The ids to ask about, stalest first, capped.
 *
 * Stalest first so a list longer than the cap still comes round rather than the same head of it
 * being asked every run while the tail is never touched again. The week gate is what paces this
 * now; the cap is only a ceiling on how much one run may hold at once.
 */
export const ageUnknownDue = (list: AgeUnknownList, limit: number, now: Date): string[] =>
  list
    .filter((entry) => {
      if (!stillWorthAsking(entry, now)) return false;
      const since = daysSince(entry.lastTried, now);
      // Never properly recorded, so it has not been asked within the week either.
      return since === null || since >= AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS;
    })
    .sort((a, b) => (a.lastTried < b.lastTried ? -1 : a.lastTried > b.lastTried ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.teamId);

/** How many are still being asked about at all, whether or not any are due today. */
export const ageUnknownAsking = (list: AgeUnknownList, now: Date): number =>
  list.filter((entry) => stillWorthAsking(entry, now)).length;

/** A line for the panel. */
export const describeAgeUnknown = (list: AgeUnknownList, now: Date): string => {
  if (list.length === 0) return "";
  const asking = ageUnknownAsking(list, now);
  const done = list.length - asking;
  return (
    `${asking.toLocaleString()} team${asking === 1 ? "" : "s"} still being asked about` +
    (done > 0
      ? `, and ${done.toLocaleString()} left alone after ${AGE_UNKNOWN_MAX_TRIES} weeks of nobody naming an age`
      : "") +
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
