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
 * What the asking rules need to know about a hand-named age: whether there is one, and when it
 * was given.
 *
 * Structural rather than a `NamedAges`, so this file keeps knowing nothing about what a named age
 * is beyond the two facts that bear on when to ask again. A `NamedAges` map satisfies it as it
 * stands, and so does a plain `Map` in a test.
 */
export type NamedAgeAsk = {
  has: (teamId: string) => boolean;
  get: (teamId: string) => { namedAt?: string } | undefined;
};

const NOBODY_NAMED: NamedAgeAsk = { has: () => false, get: () => undefined };

/**
 * The ids nobody should be asked about again, whatever the rest of the rules say.
 *
 * A club the user threw out is the case that matters. Throwing one out records the decision and
 * takes it off the review card, but nothing took it off the *asking* rota: `ageUnknownDue` knew
 * only about tries, dates and named ages, so a refused club was handed to the puller on every
 * catch-up day, fetched twice, and refused by `importOne` after both requests had been spent. At
 * a dozen clubs that is invisible. At thirty thousand it is sixty thousand requests for answers
 * already given.
 *
 * Structural rather than a `DeletedClubs`, for the same reason `NamedAgeAsk` is structural: this
 * file stays ignorant of what a refusal is, and a `Set`, a `Map` and a stub in a test all satisfy
 * it.
 *
 * Teams GameChanger says are too young need no entry here. `updateAgeUnknown` already drops a row
 * on any outcome that is not `no-age`, and `below-min-age` is one of those, so such a team leaves
 * the list on the run that learns it and can never be on the rota to begin with.
 */
export type AgelessRefusals = { has: (teamId: string) => boolean };

const NOTHING_REFUSED: AgelessRefusals = { has: () => false };

/** The rows nobody is waiting on an answer for, because one has already been given. */
const stillWaiting = (list: AgeUnknownList, refused: AgelessRefusals): AgeUnknownList =>
  list.filter((entry) => !refused.has(entry.teamId));

/**
 * Whether somebody answered for this team after the last time it was asked about.
 *
 * Both are ISO instants, so comparing them as strings is comparing them as times. A `lastTried`
 * that was never properly recorded — `coerceAgeUnknown` writes an empty string — counts as
 * answered since, because an ask nobody can date cannot be shown to have known about the answer.
 * A `namedAt` that is empty does not, because it cannot be shown to be newer than anything; such
 * a row falls back to the week gate, which is where it was before.
 */
const answeredSinceLastAsk = (entry: AgeUnknownTeam, named: NamedAgeAsk): boolean => {
  const namedAt = named.get(entry.teamId)?.namedAt;
  if (!namedAt) return false;
  return !entry.lastTried || namedAt > entry.lastTried;
};

/**
 * The ids to ask about, answered-for first and then stalest, capped.
 *
 * Stalest first so a list longer than the cap still comes round rather than the same head of it
 * being asked every run while the tail is never touched again. The week gate is what paces this
 * now; the cap is only a ceiling on how much one run may hold at once.
 *
 * Ahead of both sits the team somebody has just answered for, and it has to. The review card's
 * whole promise is "it will be filed on the next refresh", and a team is on that card because a
 * pull has recently failed to age it — so its `lastTried` is days old at most, the week gate
 * refused it, and the promise was false for up to a week with nothing on screen saying so. Being
 * answered for is exactly the thing the last ask could not have known, which is why it is worth
 * one more ask straight away rather than on the usual pace.
 *
 * It costs one fetch per answer and no more: the ask moves `lastTried` past `namedAt`, so the
 * exemption closes behind itself. A named age that can never be applied — GameChanger has since
 * said something different, so `namedAgeStands` refuses it — therefore gets that one ask and then
 * goes back to once a week rather than being fetched on every run for ever.
 */
export const ageUnknownDue = (
  list: AgeUnknownList,
  limit: number,
  now: Date,
  /**
   * What somebody named an age for by hand.
   *
   * These are asked again whatever their try budget says, because a person answering is the third
   * thing that can change the answer and the only one `stillWorthAsking` does not know about. It
   * matters most for a team that was left alone: nothing would ever ask about it again, so the
   * age typed on the review card would sit in storage for ever and never reach a schedule.
   */
  named: NamedAgeAsk = NOBODY_NAMED,
  /** Clubs already answered for by being thrown out; see `AgelessRefusals`. */
  refused: AgelessRefusals = NOTHING_REFUSED
): string[] =>
  list
    .filter((entry) => {
      // First, and before the try budget: a refusal is an answer, and an answered team is not
      // asked again however many lives it has left.
      if (refused.has(entry.teamId)) return false;
      if (!stillWorthAsking(entry, now) && !named.has(entry.teamId)) return false;
      if (answeredSinceLastAsk(entry, named)) return true;
      const since = daysSince(entry.lastTried, now);
      // Never properly recorded, so it has not been asked within the week either.
      return since === null || since >= AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS;
    })
    .sort(
      (a, b) =>
        // A fresh answer is the most recently tried thing on the list, so stalest-first would put
        // it last and a cap would then cut off the one team somebody is actually waiting on.
        Number(answeredSinceLastAsk(b, named)) - Number(answeredSinceLastAsk(a, named)) ||
        (a.lastTried < b.lastTried ? -1 : a.lastTried > b.lastTried ? 1 : 0)
    )
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
  named: NamedAgeAsk = NOBODY_NAMED,
  refused: AgelessRefusals = NOTHING_REFUSED
): number =>
  stillWaiting(list, refused).filter(
    (entry) => stillWorthAsking(entry, now) || named.has(entry.teamId)
  ).length;

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
  named: NamedAgeAsk = NOBODY_NAMED,
  /**
   * And the same refusals, which matters for the wording as well as the count: a club somebody
   * threw out was never "left alone after 8 weeks of nobody naming an age". It was answered for.
   * Counting it in either half of this sentence would describe it wrongly, so it is in neither.
   */
  refused: AgelessRefusals = NOTHING_REFUSED
): string => {
  const waiting = stillWaiting(list, refused);
  if (waiting.length === 0) return "";
  const asking = ageUnknownAsking(waiting, now, named);
  const done = waiting.length - asking;
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

/**
 * The list without these teams, for an answer given outside a pull.
 *
 * A row only ever left this list when a later pull came back with something other than "no age"
 * (`updateAgeUnknown`), which is right for the answers a pull produces and wrong for the answers
 * a person gives: throwing a club out wrote the decision to another store and left the row here,
 * waiting to be cleaned up by a fetch that the same decision had just made pointless. So an
 * answer takes the row with it now.
 *
 * Array-taking like `forgetClubs` and `rememberTooYoung`, so a bulk answer is one call and one
 * write rather than one per team. The same array comes back when nothing matched, because the
 * pool's readers take a new array to mean new data.
 */
export const forgetAgeless = (
  list: AgeUnknownList,
  gcTeamIds: readonly string[]
): AgeUnknownList => {
  if (gcTeamIds.length === 0) return list;
  const going = new Set(gcTeamIds);
  const kept = list.filter((entry) => !going.has(entry.teamId));
  return kept.length === list.length ? list : kept;
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
