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
 * The teams least likely to be real come first, then the ones that read as high school squads,
 * then everyone else, least likely real first throughout. That is the user's call, made on 27
 * September 2026, and it reverses the order this queue had for a while: likeliest real first, on
 * the argument that the real decisions are the ones a sitting should reach. Working the list is
 * clearing it, and a sitting that opens on "Test", "Practice GC" and a fantasy league's forty games
 * dated after today clears the most for the least reading. Each row sorted up says why
 * (`AgelessRow.standing`), and being sorted up is never the app throwing a team out: nothing here
 * is applied without somebody pressing the button on that row.
 */

import { looksInvented, whyNoAge, type AgelessEvidence } from "./agelessEvidence";
import {
  ageBandFromLabel,
  isSchoolAgeLabel,
  isSchoolName,
  maybeSchoolTeam,
} from "./gameChangerApi";
import { AGELESS_RULES } from "./agelessTriage";
import { rosterStanding } from "./gcRoster";
import { stillWorthAsking, type AgeUnknownList, type AgeUnknownTeam } from "./ageUnknown";
import { MIN_OPPONENT_AGE_EVIDENCE } from "./gameChangerImport";
import type { DeletedClubs } from "./deletedGames";
import type { NamedAges } from "./namedAges";

/** How many are put in front of somebody at once. More than this is not a sitting, it is a wall. */
export const AGELESS_BATCH = 10;

/**
 * Why a row was sorted to the top: it is unlikely to be a real team, or it reads as a high school
 * squad. Absent for everyone else.
 */
export type AgelessStanding = { group: "unlikely" | "school"; because: string };

/** One row of the queue: the team, and the two things a reader needs before deciding. */
export type AgelessRow = {
  entry: AgeUnknownTeam;
  /** 0 to 1, only ever an ordering. */
  invented: number;
  /** How unlikely a real team, for the order within a group: 0 for nothing against it. */
  unlikely: number;
  standing?: AgelessStanding;
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
 *
 * Nor is a team whose roster is short of nine (`shortRoster`), which the user ruled off this list
 * on 28 September 2026.
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
  !isSchoolName(entry.name ?? "") &&
  !shortRoster(entry);

/**
 * A team GameChanger lists with fewer than nine players: not a side yet, and off the queue.
 *
 * It takes nine to field one (`MIN_REAL_ROSTER`), and the user ruled on 28 September 2026 that a
 * team without them does not belong on this list. It is a strong sign here where it would not be
 * among clubs with an age: of the 13,962 teams waiting in the backup of 26 September, 3,232 listed
 * fewer than nine and 1,742 listed nobody at all, where the clubs pulled with an age had fewer than
 * nine on 1,717 of 53,252 GameChanger teams.
 *
 * Held off, like a high school squad, rather than thrown out. The row stays stored and the rota
 * keeps asking about it while it is inside its budget, and every ask replaces the evidence — so a
 * squad still being assembled comes back on its own once a check finds nine, and a search still
 * finds it meanwhile. A count nobody gave is not a short one: those stay on the queue.
 */
export const shortRoster = (entry: AgeUnknownTeam): boolean =>
  rosterStanding(entry.evidence?.playerCount) === "short";

/**
 * Names nobody gives a team that plays: a test, a practice or scrimmage account, one marked for
 * deletion or as a copy, a placeholder. Over the 13,958 teams waiting on 27 September 2026 this
 * reads 113 names, and every one is that kind of account: "Test", "Practice GC", "Delete Me!!",
 * "Duplicate Team->Leave Team", "Placeholder" with 233 players, "2026 NJBO Minor Fall Ball
 * Practice Schedule". "Unknown" was tried and found nothing; "fresh" is not here because it is a
 * word in real names ("Surcheros Fresh Mex SuperStars").
 */
const JUNK_NAME =
  /\b(?:test(?:ing)?|demo|sample|example|dummy|fake|practice|scrimmage|delete[ds]?|duplicate|dupe|copy\s+of|old\s+team|not\s+(?:a\s+)?real|placeholder)\b/i;

/** "Team", "Team 1", "My Team": a name nobody chose. Eight in that list. */
const GENERIC_NAME = /^\s*(?:my|new|the|our)?\s*team\s*#?\s*(?:\d{1,3}|[a-z])?\s*$/i;

/**
 * What the name alone says against a team, or nothing. A name that was never recorded says
 * nothing: that is a list kept before names were, not a team without one.
 */
const junkName = (name: string): string | undefined => {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (JUNK_NAME.test(trimmed)) return "the name reads as a test, practice or placeholder account";
  if (GENERIC_NAME.test(trimmed)) return "the name is only “Team” and a number";
  // Any script's letters: "統一獅隊" is a club in Taipei, "12345" and "***" are nobody.
  if (!/\p{L}/u.test(trimmed)) return "the name has no letters in it";
  if (trimmed.length <= 2) return "the name is two characters or fewer";
  return undefined;
};

/**
 * How far past a schedule the evidence has to go before a team is sorted in with the names above.
 *
 * `looksInvented` gives a fifth of a point for one shutout blowout in one scored game, which is a
 * real team having a bad day, and 66 of the 13,958 waiting sat between 0.2 and 0.3 on little more.
 * At half a point it takes most of a schedule scored on days that have not happened: the ten there
 * are a cluster of forty-game schedules with every scored game dated after today, and one team
 * with its only scored game there.
 */
const INVENTED_CUT = 0.5;

/**
 * A school squad's name the definite rule (`isSchoolName`) does not take: "High-school" hyphened,
 * "(H.S)", a freshman or sophomore side, and a school's initials — "LCHS Fall Ball 2026",
 * "HHS FALL BALL 2026". Over the same list: one hyphen, one "H.S", six freshman or sophomore sides,
 * and 21 sets of initials, nearly all a high school's fall team.
 */
const SCHOOLISH_NAME =
  /\bhigh[-_]?school\b|\bhighschool\b|\bh\.\s?s\b|\b(?:freshm[ae]n|frosh|soph(?:omore)?s?)\b/i;
const SCHOOL_INITIALS = /\b[A-Z]{1,3}HS\b/;

/**
 * The triage rules this order reads, and only those: the two that say a page is not a real team
 * and the one that says a side plays school teams. Every rule over the 13,958 waiting took the
 * first sort from 27 ms to 159 ms, these three to 62 ms; neither verdict carries an age, so the band veto
 * `agelessVerdicts` adds has nothing to veto here.
 */
const NOT_REAL_RULES = AGELESS_RULES.filter(
  (rule) => rule.id === "void-name" || rule.id === "scored-ahead"
);
const PLAYS_SCHOOLS = AGELESS_RULES.filter((rule) => rule.id === "school-by-evidence");

/** Why a row goes to the top, worked out once per entry: a re-ask writes a new entry object. */
const standingOf = new WeakMap<AgeUnknownTeam, { unlikely: number; standing?: AgelessStanding }>();

const stand = (entry: AgeUnknownTeam): { unlikely: number; standing?: AgelessStanding } => {
  const had = standingOf.get(entry);
  if (had) return had;
  const evidence = entry.evidence ?? NO_EVIDENCE;
  const name = entry.name ?? "";
  const invented = looksInvented(evidence);
  const junk = junkName(name);
  const notReal = NOT_REAL_RULES.find((rule) => rule.read(entry)?.kind === "not-real");
  // A small lean for an empty schedule: nothing to rate, and as often a page nobody used.
  const unlikely =
    invented + (junk ? 1 : 0) + (notReal ? 1 : 0) + (evidence.games === 0 ? 0.05 : 0);

  let standing: AgelessStanding | undefined;
  if (junk) standing = { group: "unlikely", because: junk };
  else if (notReal) standing = { group: "unlikely", because: notReal.because };
  else if (invented >= INVENTED_CUT) {
    standing = {
      group: "unlikely",
      because:
        evidence.aheadOfToday > 0
          ? `${evidence.aheadOfToday} of its ${evidence.scored} scored games are dated after today`
          : "its schedule looks made up",
    };
  } else {
    // A side GameChanger bands under thirteen is not a high school squad, whatever it is called.
    const band = ageBandFromLabel(evidence.ageLabel);
    const youthBand = band?.high !== undefined && band.high <= 13;
    if (isSchoolAgeLabel(evidence.ageLabel)) {
      standing = { group: "school", because: "GameChanger files it as a school team" };
    } else if (!youthBand) {
      if (PLAYS_SCHOOLS.some((rule) => rule.read(entry)?.kind === "high-school")) {
        standing = { group: "school", because: "it plays varsity and JV sides" };
      } else if (SCHOOLISH_NAME.test(name) || SCHOOL_INITIALS.test(name)) {
        standing = { group: "school", because: "the name reads as a high school side" };
      }
    }
  }
  const found = { unlikely, ...(standing ? { standing } : {}) };
  standingOf.set(entry, found);
  return found;
};

/**
 * One entry as a row.
 *
 * Shared by the queue and the search on purpose: a team a person finds by name has to read the
 * same as the one the queue would have handed them, or the two disagree about the same team.
 */
const rowFor = (entry: AgeUnknownTeam): AgelessRow => {
  const evidence = entry.evidence;
  return {
    entry,
    invented: looksInvented(evidence ?? NO_EVIDENCE),
    ...stand(entry),
    why: evidence
      ? whyNoAge(evidence, MIN_OPPONENT_AGE_EVIDENCE)
      : "Nothing was kept about this one — the next refresh will say why.",
    ...(maybeSchoolTeam(entry.name ?? "") ? { hint: LONE_V_HINT } : {}),
    ...(evidence ? { evidence } : {}),
  };
};

/** The unlikely-to-be-real first, then the high school sides, then everyone else. */
const GROUP_ORDER: Record<AgelessStanding["group"] | "rest", number> = {
  unlikely: 0,
  school: 1,
  rest: 2,
};

/** Everyone still waiting on a person: least likely to be real first, then high school sides. */
export const agelessWaiting = (
  list: AgeUnknownList,
  named: NamedAges,
  dropped: DeletedClubs,
  now: Date
): AgelessRow[] =>
  list
    .filter((entry) => awaitingAnswer(entry, named, dropped, now))
    .map(rowFor)
    .sort(
      (a, b) =>
        GROUP_ORDER[a.standing?.group ?? "rest"] - GROUP_ORDER[b.standing?.group ?? "rest"] ||
        // Least likely to be real first, within each group as across them.
        b.unlikely - a.unlikely ||
        // Among rows nothing separates, one carrying a lead goes ahead — it is answerable at a
        // glance, so it costs the sitting least.
        Number(Boolean(b.hint)) - Number(Boolean(a.hint)) ||
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

/**
 * Why a team somebody found by name is not on the queue.
 *
 * The queue shows what is still somebody's to answer, and that is a much smaller set than the
 * list. Searching only the queue would answer "no such team" for every one of these, which is
 * the worst possible answer to "I know this club is in here" — so the search reads the whole
 * list and says which of them it is.
 */
export type AgelessAside = "dropped" | "named" | "high-school" | "short-roster" | "left-alone";

/** A team the search found, and whether anything is standing between it and the queue. */
export type AgelessHit = {
  row: AgelessRow;
  /** Absent when the team is on the queue as normal. */
  aside?: AgelessAside;
};

/**
 * How many hits are shown at once.
 *
 * Larger than a sitting because this is scanning rather than deciding — somebody typing three
 * letters of a club name is looking for one row, not working through them — and still bounded,
 * because rendering every match of "a" across thirty thousand teams is the wall again.
 */
export const AGELESS_HITS = 25;

/**
 * What stands between this team and the queue, if anything.
 *
 * The user's own decisions come first because they are the ones worth being told about: "you
 * threw this out in March" ends the search, where "left alone" invites them to answer it now.
 */
const asideFor = (
  entry: AgeUnknownTeam,
  named: NamedAges,
  dropped: DeletedClubs,
  now: Date
): AgelessAside | undefined => {
  if (dropped.has(entry.teamId)) return "dropped";
  if (named.has(entry.teamId)) return "named";
  if (recognise(entry).school) return "high-school";
  // Before the roster: a team nothing will ask about again cannot come back when its roster fills.
  if (!stillWorthAsking(entry, now)) return "left-alone";
  if (shortRoster(entry)) return "short-roster";
  return undefined;
};

/**
 * What a team can be recognised by.
 *
 * Not the name alone. Somebody hunting a club they saw once remembers the town, or who it played,
 * as readily as the exact squad name — and the card already shows all of that, so a search that
 * could not match it would be hiding what it had just displayed.
 */
type Recognised = {
  /** Everything the team can be recognised by, lowercased and run together. */
  hay: string;
  /** Its name, lowercased, which is what an exact or a prefix match is judged on. */
  lower: string;
  /** Whether the name reads as a school squad — regexes, and the same answer every time. */
  school: boolean;
};

const recognisedBy = new WeakMap<AgeUnknownTeam, Recognised>();

/**
 * The three things about a team that never change, worked out once.
 *
 * Every one is a function of the entry alone, and the entries are the same objects from one
 * render to the next because the list is memoised — so a `WeakMap` on them holds as long as the
 * list does and is collected with it.
 *
 * Measured over thirty thousand rows: a search anybody actually types went from 13ms to 7ms, and
 * a single letter — where every row matches and there is a thirty-thousand-long list to order —
 * from 48ms to 27ms. The cost was never one thing: building the recognisable string, lowering the
 * name, and running the school-name regexes were each about a third of it, and each gives the
 * same answer every keystroke. What is left at one letter is the sort, and one letter is a query
 * nobody means.
 */
const recognise = (entry: AgeUnknownTeam): Recognised => {
  const had = recognisedBy.get(entry);
  if (had) return had;
  const e = entry.evidence;
  const name = entry.name ?? "";
  const built: Recognised = {
    lower: name.toLowerCase(),
    school: isSchoolName(name),
    hay: [
      name,
      entry.teamId,
      e?.city ?? "",
      e?.state ?? "",
      e?.ageLabel ?? "",
      ...(e?.sampleOpponents ?? []),
    ]
      .join(" ")
      .toLowerCase(),
  };
  recognisedBy.set(entry, built);
  return built;
};

/**
 * Words, with the punctuation thrown away.
 *
 * Every word has to appear, and they need not be next to each other or in order. A plain
 * substring test looked reasonable and failed on the names this list is actually full of: real
 * ones read "Mears 1 - 2026", so "mears 2026" — the obvious thing to type to narrow 3,750 matches
 * down — found nothing at all, and the card's own advice to "type more to narrow it" was the way
 * to turn a long list into no list.
 */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

/**
 * How well a team answers to what was typed, as an ordering rather than a score anybody sees.
 *
 * Match quality has to beat everything else here. The queue sorts by how invented a page looks,
 * which is right for working through it and wrong for finding one club whatever direction it runs
 * in: measured on a thirty-thousand-row list, "riverdogs" matches 3,750 teams, and ordering those
 * by `looksInvented` before cutting to the first 25 puts the wanted team outside the answer almost
 * every time.
 *
 * 3 the whole name, 2 the start of it, 1 somewhere in what the team can be recognised by.
 */
const howWell = (entry: AgeUnknownTeam, needle: string, needleWords: string[]): number => {
  const { lower, hay } = recognise(entry);
  if (lower === needle || entry.teamId.toLowerCase() === needle) return 3;
  if (lower.startsWith(needle)) return 2;
  return needleWords.every((word) => hay.includes(word)) ? 1 : 0;
};

/** Alphabetical, without the collator: these are club names and it was the slowest part. */
const byName = (a: AgeUnknownTeam, b: AgeUnknownTeam): number => {
  const x = a.name ?? a.teamId;
  const y = b.name ?? b.teamId;
  return x < y ? -1 : x > y ? 1 : 0;
};

export const agelessSearch = (
  list: AgeUnknownList,
  named: NamedAges,
  dropped: DeletedClubs,
  now: Date,
  query: string,
  limit: number = AGELESS_HITS
): { hits: AgelessHit[]; total: number } => {
  const needle = query.trim().toLowerCase();
  if (!needle) return { hits: [], total: 0 };
  const needleWords = words(needle);
  if (needleWords.length === 0) return { hits: [], total: 0 };

  /*
   * Matched and ordered on cheap fields, then cut, and only then turned into rows. `rowFor` runs
   * `whyNoAge` and `looksInvented` per team, and running it over every match before the cut was
   * 39ms on the first keystroke of a search over thirty thousand rows — a dropped frame on this
   * machine and several on a phone. Twenty-five of them is nothing.
   */
  const found: { entry: AgeUnknownTeam; aside?: AgelessAside; well: number }[] = [];
  list.forEach((entry) => {
    const well = howWell(entry, needle, needleWords);
    if (well === 0) return;
    const aside = asideFor(entry, named, dropped, now);
    found.push({ entry, well, ...(aside ? { aside } : {}) });
  });
  found.sort(
    (a, b) =>
      // What somebody can act on, then how well it answers, then alphabetically — which is the
      // one order a person scanning a list can predict.
      Number(Boolean(a.aside)) - Number(Boolean(b.aside)) ||
      b.well - a.well ||
      byName(a.entry, b.entry)
  );
  return {
    hits: found.slice(0, Math.max(0, limit)).map((hit): AgelessHit => ({
      row: rowFor(hit.entry),
      ...(hit.aside ? { aside: hit.aside } : {}),
    })),
    total: found.length,
  };
};
