import { daysSince } from "./date";
import { coerceAgelessEvidence, type AgelessEvidence } from "./agelessEvidence";
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
  /**
   * What GameChanger said about it, from the last time anybody asked.
   *
   * The team is filed nowhere, so nothing else in the app holds a single fact about it — not a
   * town, not a roster size, not an opponent. Without this a list of these teams can only show an
   * id and a name, and the question somebody is trying to answer about each one ("is this a real
   * club, and what age is it?") has nothing to go on. Replaced rather than accumulated on each
   * ask, because it describes the schedule as it is now.
   */
  evidence?: AgelessEvidence;
};

export type AgeUnknownList = AgeUnknownTeam[];

/**
 * The list after a run: teams nobody could age go on, and teams that are no longer that question
 * come off.
 *
 * Three cases, and the third is the one that was wrong.
 *
 * A run that came back "no age" is the reason this list exists: the team goes on, or its count
 * goes up. A run that filed the team has answered the question: it comes off. And a run that came
 * back with any OTHER answer — the club was thrown out, it turned out to be 6U, it lost its
 * season, it is a wiffle team — has also stopped being a team nobody could age, so it comes off
 * too. It may well be a problem, but it is not this list's problem.
 *
 * That last case used to leave the entry sitting there untouched, and untouched meant frozen:
 * `tries` never advanced and `lastTried` never moved, so a stalest-first queue put it at the head
 * for ever. Measured on a three-team list with a cap of two, where one had been thrown out — the
 * thrown-out club was fetched on all twelve runs, still reading tries=1 and lastTried=day one,
 * while it held half the capacity of every run. At a real list's size that is how the teams behind
 * it stop being asked at all.
 *
 * A run that never reached a team is not an answer and leaves it exactly as it was, which is why
 * this keys on the outcomes it was given rather than on the absence of one.
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
        // What this run was told it was called, or what the last one was told. The fallback is
        // the point: a run that comes back without a name used to erase the one already stored,
        // and a row reading "Name not recorded" cannot be found by somebody searching for the
        // club by name — which is the one way anybody looks for a particular team in here.
        // `||`, not `??`: a run that comes back with an EMPTY name has to fall back too, and an
        // empty string is exactly the shape that caused this.
        ...(outcome.teamName || known?.name ? { name: outcome.teamName || known?.name } : {}),
        firstSeen: known?.firstSeen ?? now,
        lastTried: now,
        tries: (known?.tries ?? 0) + 1,
        // What this run saw, or what the last one saw if this run could not say.
        ...((outcome.noAgeEvidence ?? known?.evidence)
          ? { evidence: outcome.noAgeEvidence ?? known?.evidence }
          : {}),
      });
      return;
    }
    /*
     * Anything else the run actually came back with. Filed at any level by any route, or refused
     * for a reason that is not "nobody could say the age" — either way this list is done with it.
     * A failure to fetch is not an outcome at all and never reaches here.
     */
    byId.delete(outcome.gcTeamId);
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
 *
 * Being left alone is not final. Somebody who finds the team by name on the review card and says
 * what age it is puts it back in the queue — see `ageUnknownDue`'s `named`.
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
export const ageUnknownDue = (
  list: AgeUnknownList,
  limit: number,
  now: Date,
  /**
   * The ids somebody has named an age for by hand.
   *
   * These are asked again whatever their budget says, because a person answering is the third
   * thing that can change the answer and the only one `stillWorthAsking` does not know about. It
   * matters most for a team that was left alone: nothing would ever ask about it again, so the
   * age typed on the review card would sit in storage for ever and never reach a schedule.
   *
   * Structural rather than a `NamedAges`, so a `Set` of ids does as well as the map and this file
   * keeps knowing nothing about what a named age is.
   */
  named: { has: (teamId: string) => boolean } = { has: () => false }
): string[] =>
  list
    .filter((entry) => {
      // The week gate still applies: a named age that cannot be applied — GameChanger has since
      // said something different, so `namedAgeStands` refuses it — would otherwise be fetched on
      // every run for ever rather than once a week.
      if (!stillWorthAsking(entry, now) && !named.has(entry.teamId)) return false;
      const since = daysSince(entry.lastTried, now);
      // Never properly recorded, so it has not been asked within the week either.
      return since === null || since >= AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS;
    })
    .sort((a, b) => (a.lastTried < b.lastTried ? -1 : a.lastTried > b.lastTried ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.teamId);

/**
 * How many are still being asked about at all, whether or not any are due today.
 *
 * Takes `named` for the same reason `ageUnknownDue` does, and it has to: the panel hides the
 * whole ask-again block on this number, so a team revived by somebody naming its age would be
 * queued for a pull that nothing offers to run.
 */
export const ageUnknownAsking = (
  list: AgeUnknownList,
  now: Date,
  named: { has: (teamId: string) => boolean } = { has: () => false }
): number => list.filter((entry) => stillWorthAsking(entry, now) || named.has(entry.teamId)).length;

/**
 * A line for the panel.
 *
 * When nobody is left to ask about, the sentence leads with the part that is true rather than
 * with a zero: "0 teams still being asked about, and 412 left alone" opens by telling the reader
 * about something that is not there.
 */
export const describeAgeUnknown = (
  list: AgeUnknownList,
  now: Date,
  /** The same argument the two counts above take, so this sentence agrees with them. */
  named: { has: (teamId: string) => boolean } = { has: () => false }
): string => {
  if (list.length === 0) return "";
  const asking = ageUnknownAsking(list, now, named);
  const done = list.length - asking;
  const leftAlone = `${done.toLocaleString()} left alone after ${AGE_UNKNOWN_MAX_TRIES} weeks of nobody naming an age`;
  if (asking === 0) {
    return `${leftAlone.charAt(0).toUpperCase()}${leftAlone.slice(1)}.`;
  }
  return (
    `${asking.toLocaleString()} team${asking === 1 ? "" : "s"} still being asked about` +
    (done > 0 ? `, and ${leftAlone}` : "") +
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
        ...(row.evidence && typeof row.evidence === "object"
          ? { evidence: coerceAgelessEvidence(row.evidence) }
          : {}),
      },
    ];
  });
};
