/**
 * The teams waiting for somebody to say what age they are, ten at a time.
 *
 * Four thousand rows is not a queue, it is a wall. This hands over ten, and does not change them
 * while they are being worked: a list that reshuffles as each row is answered means looking away
 * and back to find everything somewhere else. The next ten arrive only once all ten are done.
 *
 * "Done" is not a flag this file keeps. A team has been answered when somebody named its age or
 * threw it out, and both of those are already stored — so the queue is derived from them and
 * cannot disagree with them. Closing the tab half way through a batch loses the batch's identity
 * and nothing else: the next sitting starts a fresh ten off the top of whatever is still waiting.
 *
 * Worst first, because the junk is quick. A page with three 20-0 wins on days that have not
 * happened and a roster of two is thrown out in a second, and every one of those cleared is a row
 * that never costs anybody a real decision. That ordering is `looksInvented` and it is only an
 * ordering — see its note; nothing is ever thrown out on that number by the app itself.
 */

import { looksInvented, whyNoAge, type AgelessEvidence } from "./agelessEvidence";
import { isSchoolName, maybeSchoolTeam } from "./gameChangerApi";
import { stillWorthAsking, type AgeUnknownList, type AgeUnknownTeam } from "./ageUnknown";
import { MIN_OPPONENT_AGE_EVIDENCE } from "./gameChangerImport";
import type { DeletedClubs } from "./deletedGames";
import type { NamedAges } from "./namedAges";

/** How many are put in front of somebody at once. More than this is not a sitting, it is a wall. */
export const AGELESS_BATCH = 10;

/** One row of the queue: the team, and the two things a reader needs before deciding. */
export type AgelessRow = {
  entry: AgeUnknownTeam;
  /** 0 to 1, only ever an ordering. */
  invented: number;
  /** Why the age could not be read, in a sentence. */
  why: string;
  /** A lead the name carries, when it carries one. Present only when there is one. */
  hint?: string;
  evidence?: AgelessEvidence;
};

/**
 * What a lone "V" is worth saying.
 *
 * Every other row on this card is a question the name cannot answer. This one is a question the
 * name half answers, and the half it gives is the half a person can finish in a second by opening
 * the page — which is why it comes to the top and why it says what to look for.
 */
const LONE_V_HINT =
  'The name carries a lone "V" with no letter against it. On a school schedule that is the ' +
  "varsity side, and high school squads are left out of the rankings — but a single letter is " +
  "also a squad number, a colour or an initial, so this is worth opening rather than guessing.";

const NO_EVIDENCE: AgelessEvidence = {
  games: 0,
  scored: 0,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 0,
  namedAnAge: 0,
  tally: [],
};

/**
 * Whether this team is still somebody's to answer.
 *
 * The last clause is a rule having changed underneath a list written before it. A high school
 * squad is refused outright now, but every one that was pulled earlier went onto this list as a
 * team nobody could age, and there is nothing for a person to investigate about it — the name
 * settles it. What changes is that it stops costing one of the ten slots in front of a person,
 * which is the whole reason the queue is ten.
 *
 * It comes off the queue, not off the list, and it is worth being exact about what that means.
 * An entry still inside its budget is asked again by the rota, the ask now comes back "high
 * school" rather than "no age", and `updateAgeUnknown` retires it. An entry that has already
 * spent its eight tries or its fifty-six days is never returned by `ageUnknownDue` at all, so
 * nothing ever asks about it again and its row sits in storage for good. That is true of every
 * abandoned entry and not something this rule introduced — but the row is hidden from here
 * rather than deleted, and saying otherwise would be a claim this file cannot keep.
 *
 * A lone "V" is deliberately NOT caught here. That one really is a question for a person, and it
 * gets a hint instead — see `LONE_V_HINT`.
 */
export const awaitingAnswer = (
  entry: AgeUnknownTeam,
  named: NamedAges,
  dropped: DeletedClubs,
  now: Date
): boolean =>
  stillWorthAsking(entry, now) &&
  !named.has(entry.teamId) &&
  !dropped.has(entry.teamId) &&
  !isSchoolName(entry.name ?? "");

/** Everyone still waiting on a person, worst-looking first. */
export const agelessWaiting = (
  list: AgeUnknownList,
  named: NamedAges,
  dropped: DeletedClubs,
  now: Date
): AgelessRow[] =>
  list
    .filter((entry) => awaitingAnswer(entry, named, dropped, now))
    .map((entry): AgelessRow => {
      const evidence = entry.evidence;
      return {
        entry,
        invented: looksInvented(evidence ?? NO_EVIDENCE),
        why: evidence
          ? whyNoAge(evidence, MIN_OPPONENT_AGE_EVIDENCE)
          : "Nothing was kept about this one — the next refresh will say why.",
        ...(maybeSchoolTeam(entry.name ?? "") ? { hint: LONE_V_HINT } : {}),
        ...(evidence ? { evidence } : {}),
      };
    })
    .sort(
      (a, b) =>
        // A row carrying a lead comes first, on the same reasoning that puts the junk first: it
        // is answerable at a glance, and every one cleared never costs anybody a real decision.
        Number(Boolean(b.hint)) - Number(Boolean(a.hint)) ||
        b.invented - a.invented ||
        // Then the stalest, so a tie does not park the same rows at the top for ever.
        (a.entry.lastTried < b.entry.lastTried ? -1 : a.entry.lastTried > b.entry.lastTried ? 1 : 0)
    );

/**
 * The batch to show, given the one already on screen.
 *
 * `pinned` is what was handed over last time. While any of it is still waiting, it is handed back
 * unchanged — minus the ones that have been answered, which simply disappear rather than being
 * replaced under the reader's cursor. Only when the last of them is answered does the next ten
 * come up.
 */
export const agelessBatch = (
  waiting: readonly AgelessRow[],
  pinned: readonly string[],
  size: number = AGELESS_BATCH
): AgelessRow[] => {
  const byId = new Map(waiting.map((row) => [row.entry.teamId, row]));
  const held = pinned.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  return held.length > 0 ? held : waiting.slice(0, Math.max(0, size));
};

/** The ids of a batch, for pinning it. */
export const batchIds = (rows: readonly AgelessRow[]): string[] =>
  rows.map((row) => row.entry.teamId);
