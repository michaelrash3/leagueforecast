/**
 * Rules for reading the teams nobody could age, in bulk.
 *
 * Thirty-six thousand teams reach this list because GameChanger gave no age group, the name says
 * none, and too few of their opponents write one in theirs. The review card offers them ten at a
 * time, one answer per click, which is a rate nobody can work — and the queue does not drain on
 * its own, because `ageFromOpponentNames` can only answer a team whose opponents name ages and
 * these are the teams whose opponents do not.
 *
 * So: rules that read a whole row at once. Each one here is a *candidate*, not a shipped decision.
 * Nothing in this file is wired to the app. It exists to be measured first — `scripts/agelessSweep.ts`
 * runs every rule over a real backup and reports what it catches, a sample of the names, and what
 * it catches that it should not — because this repo's standing rule is that a number in a comment
 * says what was measured, and because the cost of a wrong rule here is not symmetric: a team left
 * unrated costs its own ranking, and a team rated at the wrong age corrupts every club it played.
 *
 * Two things shape every rule below, both learned from real data rather than reasoned out.
 *
 * **Division words are shared, and the sharing is not tidy.** "Majors" is a Little League division
 * of nine- to twelve-year-olds, a Dixie Boys division of *fifteen*- to nineteen-year-olds, and a
 * USSSA and Perfect Game skill class at any age at all. "Minors" spans 5-12 by Little League's own
 * two official pages, which disagree with each other, and is a Perfect Game skill class besides.
 * "AAA" is a local Little League convention, a USSSA grade, and in Canada a provincial elite tier.
 * None of those can be read as an age without knowing whose word it is, which is what `ngb` on the
 * evidence is for.
 *
 * **And the reliable division words are also the commonest mascots.** Measured over this pool's
 * own 110,850 teams — every one of which already has an age, so every hit is a team that works
 * today — the PONY division words appear on 1,015 of them: Mustang 507, Colt 232, Bronco 189,
 * Pinto 75, Palomino 12. The samples are overwhelmingly mascots ("Indiana Mustangs Mann", "MVP
 * Mustangs Red", "Colt 45s"), so a bare-word rule would have marked a thousand working teams as
 * rec ball. Corroboration is not a refinement of that rule; it is the rule.
 */

import {
  ageLevelFromName,
  ageLevelOf,
  isSchoolAgeLabel,
  isSchoolName,
  maybeSchoolTeam,
  ageFitsBand,
  isAdultAgeLabel,
} from "./gameChangerApi";
import type { AgelessEvidence } from "./agelessEvidence";
import type { AgeUnknownTeam } from "./ageUnknown";
import { MIN_OPPONENT_AGE_EVIDENCE } from "./gameChangerImport";

/** What a rule concludes about a row. */
export type AgelessVerdict =
  /** File it here. The only verdict that adds a team rather than removing one. */
  | { kind: "age"; level: number }
  /** Rec or house ball: aged from its division where one can be read, and never ranked. */
  | { kind: "rec"; level?: number }
  | { kind: "high-school" }
  /** Grown men or a college side: there is no youth age to find, so it is never asked again. */
  | { kind: "not-youth" }
  | { kind: "not-real" }
  /** Nothing to rate either way, and nothing to learn by asking again. */
  | { kind: "no-schedule" };

export type AgelessTier =
  /** Safe on what it reads alone, once the sweep has measured it. */
  | "auto"
  /** Never applied without a person: it pre-ticks a row in the review card and stops there. */
  | "review"
  /** Measured but never applied, because the reading is not safe at any corroboration. */
  | "measure";

export type AgelessRule = {
  id: string;
  /** What the review card's heading says, and what the sweep prints. */
  label: string;
  tier: AgelessTier;
  /** Why, in one line, for the row a person is looking at. */
  because: string;
  read: (row: AgeUnknownTeam) => AgelessVerdict | undefined;
};

const nameOf = (row: AgeUnknownTeam): string => row.name ?? "";

const NO_EVIDENCE: AgelessEvidence = {
  games: 0,
  scored: 0,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 0,
  namedAnAge: 0,
  tally: [],
};

const evidenceOf = (row: AgeUnknownTeam): AgelessEvidence => row.evidence ?? NO_EVIDENCE;

/** The organisations whose division words mean an age rather than a skill grade. */
const AGE_NAMING_BODIES = /little league|cal ripken|babe ruth|dixie|pony|dyb/i;

const saysAges = (evidence: AgelessEvidence): boolean =>
  (evidence.ngb ?? []).some((body) => AGE_NAMING_BODIES.test(body));

/**
 * The markers that name a rec league and nothing else.
 *
 * No travel club calls itself a Little League or a parks department. Deliberately absent: a bare
 * `rec`, `house`, `park`, `club` or `community`, each of which is an ordinary word in a real
 * club's name, and `D` followed by one digit — "D1 Baseball" and "D1 Athletics" are travel brands,
 * and this pool holds 81 teams matching a single-digit district against 3 matching a two-digit
 * one, which is the whole argument for requiring two.
 */
const REC_MARKERS =
  /\b(?:little\s+league|d(?:istrict)?\s?\d{2}\b|in[-\s]?house|house\s+league|recreation(?:al)?|rec\s+(?:league|ball|division|baseball)|babe\s+ruth|cal\s+ripken|dixie\s+(?:youth|boys)|pony\s+(?:league|baseball)|ymca|parks?\s*(?:and|&)\s*rec)/i;

/**
 * A team that plays its own league's season and a district's tournament against other districts.
 *
 * The one Little League team that belongs in a ranking: an all-star side is connected to the rest
 * of the pool, which is the whole reason the rec category is refused a table in the first place.
 * `travel` alongside it for the club that says so outright.
 */
const CONNECTED = /\b(?:all[-\s]?stars?|travel)\b/i;

/**
 * PONY's divisions, which are the cleanest age signal in youth baseball and the commonest mascots
 * in it at the same time.
 *
 * PONY brands them with the ages itself — Shetland 6U, Pinto 8U, Mustang 10U, Bronco 12U, Pony
 * 14U, Colt 16U — so where the word is a division it is exact to two years. Where it is a mascot
 * it says nothing at all, and 1,015 teams in this pool carry one.
 *
 * https://ponybbsb.freshdesk.com/en/support/solutions/articles/27000054473-age-group-f-a-q-
 */
const PONY_DIVISIONS: [RegExp, number][] = [
  [/\bshetlands?\b/i, 6],
  [/\bpintos?\b/i, 8],
  [/\bmustangs?\b/i, 10],
  [/\bbroncos?\b/i, 12],
  [/\bcolts?\b/i, 16],
  [/\bpalominos?\b/i, 18],
];

/**
 * Divisions whose word means one thing and belongs to one organisation.
 *
 * O-Zone is Dixie's 11-12 division and "Intermediate"/"50/70" is Little League's 11-13. Both are
 * listed here rather than among the auto rules because neither is as unique as it looks: this
 * pool's five "O-Zone" hits are all "Ozone Howard Royals", which is a place in Queens.
 *
 * https://cdn4.sportngin.com/attachments/document/8b3e-3334205/2025-DYB-Rule-Book-Website-Version-1-1-2025.pdf
 * https://www.littleleague.org/play-little-league/baseball/divisions/
 */
const UNIQUE_DIVISIONS: [RegExp, number][] = [
  [/\bo[-\s]zone\b/i, 12],
  [/\b(?:50\s*[/-]\s*70|intermediate)\b/i, 13],
];

/** The young end, which files below the youngest level ranked here rather than at an age. */
const YOUNGEST = /\b(?:tee|t)[-\s]?ball\b/i;

/**
 * The words that are never an age, whatever else agrees with them.
 *
 * USSSA grades travel teams A / AA / AAA / Major and Perfect Game does the same plus "Minor", and
 * the grade rides alongside an age rather than instead of one — "12U AAA". So the teams reaching
 * this list carrying a bare grade are disproportionately the ones that wrote only the grade, which
 * is exactly where reading it as an age does the most damage. This pool holds 333 teams whose name
 * says "Major" and 342 saying AA or AAA, all of them already aged and working.
 *
 * https://flbaseball.usssa.com/classifications/
 */
const GRADE_WORDS = /\b(?:a{1,3}|majors?|minors?|single[-\s]?a|double[-\s]?a|triple[-\s]?a)\b/i;

/** Whether the name states an age outright, which outranks every reading below. */
const statesItsAge = (row: AgeUnknownTeam): boolean => ageLevelFromName(nameOf(row)) !== undefined;

/**
 * A division word corroborated by the company the team keeps.
 *
 * `sampleOpponents` is the right sample to ask, and it is the only one that would do: the evidence
 * keeps at most three, and keeps *only* the opponents that named no age themselves. "Mustangs"
 * whose opponents are "Broncos" and "Pintos" is PONY; "Mustangs" whose opponents are "Elite 12U"
 * and "Team Georgia" is a travel club with a horse on its cap.
 */
const opponentsAgree = (evidence: AgelessEvidence): boolean =>
  (evidence.sampleOpponents ?? []).some(
    (opponent) =>
      // Any of the sibling words, not only this team's own: a league that calls one division
      // Mustang calls the next one Bronco, so a Mustang playing Broncos and Pintos is in a PONY
      // league, while a Mustang playing "Elite 12U" has a horse on its cap.
      PONY_DIVISIONS.some(([sibling]) => sibling.test(opponent)) || REC_MARKERS.test(opponent)
  );

const ponyDivision = (name: string): [RegExp, number] | undefined =>
  PONY_DIVISIONS.find(([word]) => word.test(name));

export const AGELESS_RULES: readonly AgelessRule[] = [
  {
    id: "name-resolves",
    label: "The name says an age under today's rules",
    tier: "auto",
    because: "the rules moved under this row since it was last asked about",
    read: (row) => {
      const evidence = evidenceOf(row);
      const level = ageLevelOf(evidence.ageLabel, nameOf(row), undefined);
      return level === undefined ? undefined : { kind: "age", level };
    },
  },
  {
    id: "adult-label",
    label: "GameChanger filed it as adult or college",
    tier: "auto",
    because: "this app ranks youth baseball, and there is no youth age here to find",
    read: (row) => (isAdultAgeLabel(evidenceOf(row).ageLabel) ? { kind: "not-youth" } : undefined),
  },
  {
    id: "school-label",
    label: "GameChanger filed it as a school team",
    tier: "auto",
    because: "its age field names a school band, which the school rule now reads",
    read: (row) =>
      isSchoolAgeLabel(evidenceOf(row).ageLabel) ? { kind: "high-school" } : undefined,
  },
  {
    id: "school-name",
    label: "The name says high school",
    tier: "auto",
    because: "the name carries a squad word the school rule reads",
    read: (row) => (isSchoolName(nameOf(row)) ? { kind: "high-school" } : undefined),
  },
  {
    id: "tee-ball",
    label: "Tee ball",
    tier: "auto",
    because: "tee ball is played below the youngest level ranked here",
    read: (row) => (YOUNGEST.test(nameOf(row)) ? { kind: "no-schedule" } : undefined),
  },
  {
    id: "rec-marker",
    label: "The name names a rec league",
    tier: "review",
    because: "no travel club calls itself a Little League or a parks department",
    read: (row) => {
      const name = nameOf(row);
      if (!REC_MARKERS.test(name) || CONNECTED.test(name)) return undefined;
      const level = ageLevelFromName(name);
      return { kind: "rec", ...(level === undefined ? {} : { level }) };
    },
  },
  {
    id: "pony-division",
    label: "A PONY division, agreed to by its opponents",
    tier: "review",
    because: "the word is a division here rather than a mascot, and the teams it played say so",
    read: (row) => {
      if (statesItsAge(row)) return undefined;
      const found = ponyDivision(nameOf(row));
      if (!found) return undefined;
      const [, level] = found;
      const evidence = evidenceOf(row);
      if (evidence.namedAnAge >= MIN_OPPONENT_AGE_EVIDENCE) return undefined;
      if (!opponentsAgree(evidence) && !saysAges(evidence)) return undefined;
      return { kind: "rec", level };
    },
  },
  {
    id: "unique-division",
    label: "A division only one organisation uses",
    tier: "review",
    because: "the word belongs to one league and means one age there",
    read: (row) => {
      if (statesItsAge(row)) return undefined;
      const name = nameOf(row);
      const found = UNIQUE_DIVISIONS.find(([word]) => word.test(name));
      return found ? { kind: "rec", level: found[1] } : undefined;
    },
  },
  {
    id: "closed-cluster",
    label: "Nobody it plays writes an age either",
    tier: "review",
    because: "a league where no name carries an age can never be settled by its opponents",
    read: (row) => {
      const evidence = evidenceOf(row);
      const closed =
        evidence.games > 0 &&
        evidence.namedAnAge === 0 &&
        evidence.opponents >= CLOSED_CLUSTER_SIZE;
      return closed ? { kind: "rec" } : undefined;
    },
  },
  {
    id: "school-by-evidence",
    label: "It plays school teams",
    tier: "review",
    because: "an opponent on its schedule names itself a varsity or JV side",
    read: (row) => {
      const name = nameOf(row);
      const stated = ageLevelFromName(name);
      if (stated !== undefined && stated < 14) return undefined;
      const evidence = evidenceOf(row);
      const plays = (evidence.sampleOpponents ?? []).some(isSchoolName);
      if (!plays) return undefined;
      return maybeSchoolTeam(name) || SCHOOL_HINTS.test(name) || evidence.namedAnAge === 0
        ? { kind: "high-school" }
        : undefined;
    },
  },
  {
    id: "near-miss-tally",
    label: "Its opponents nearly agree",
    tier: "review",
    because: "every opponent that named an age named the same one, but there were too few",
    read: (row) => {
      const evidence = evidenceOf(row);
      const top = evidence.tally[0];
      if (!top || evidence.tally.length !== 1) return undefined;
      if (top[1] < 2 || evidence.namedAnAge !== evidence.opponents) return undefined;
      return { kind: "age", level: top[0] };
    },
  },
  {
    id: "no-games",
    label: "No games at all",
    tier: "review",
    because: "there is nothing here to rate, and nothing to learn by asking again",
    read: (row) =>
      evidenceOf(row).games === 0 && row.tries >= 2 ? { kind: "no-schedule" } : undefined,
  },
  {
    id: "scored-ahead",
    label: "Every game scored on a day that has not happened",
    tier: "review",
    because: "you cannot score a game early",
    read: (row) => {
      const evidence = evidenceOf(row);
      return evidence.scored >= 5 && evidence.aheadOfToday === evidence.scored
        ? { kind: "not-real" }
        : undefined;
    },
  },
  {
    id: "grade-word",
    label: "A name carrying a USSSA or Perfect Game grade",
    tier: "measure",
    because: "measured only — A, AA, AAA, Major and Minor are skill grades, never ages",
    read: (row) => (GRADE_WORDS.test(nameOf(row)) ? { kind: "rec" } : undefined),
  },
];

/**
 * How many opponents a team needs before "none of them writes an age" means anything.
 *
 * A starting point for the sweep to move rather than a settled number: it prints the catch at
 * three, four, five, six, eight and ten so the threshold is chosen off a curve.
 */
export const CLOSED_CLUSTER_SIZE = 6;

/** The hint words that are never enough on their own; 972 teams in this pool carry one. */
const SCHOOL_HINTS = /\b(?:fresh(?:man|men)?|frosh|soph(?:omore)?|academy|prep(?:aratory)?)\b/i;

/** Every rule that fires on a row, in the order they are declared. */
/**
 * Every rule, with the ones GameChanger's own band contradicts thrown away.
 *
 * Central rather than repeated inside each rule, because a veto a rule has to remember to apply
 * is a veto the next rule will forget. Anything deriving an age passes through here, so the band
 * cannot be skipped by writing a new rule.
 *
 * What it is worth, measured over the 36,194 rows waiting on 22 September 2026: of the 1,203
 * ages the rules derive, 1,186 sit inside the band already — 98.6% — so this changes almost
 * nothing and what it does change is all one mistake. Every one of the seventeen it drops is a
 * PONY division word read off a mascot or a university: "SMSU Mustangs Home" is Southwest
 * Minnesota State, filed `college`, and was about to be ranked at 10U; "Owls Colt" and "Canes
 * Colts" are filed `Under 13` and were about to be ranked at 16U.
 *
 * The whole verdict goes, not just its number. A rule that read a university as a ten-year-old
 * side has not got the age slightly wrong; it has misread what the team is, and the rest of what
 * it concluded is worth no more than the part that was checkable.
 */
export const agelessVerdicts = (
  row: AgeUnknownTeam
): { rule: AgelessRule; verdict: AgelessVerdict }[] =>
  AGELESS_RULES.flatMap((rule) => {
    const verdict = rule.read(row);
    if (!verdict) return [];
    const level = verdict.kind === "age" || verdict.kind === "rec" ? verdict.level : undefined;
    if (level !== undefined && !ageFitsBand(level, row.evidence?.ageLabel)) return [];
    return [{ rule, verdict }];
  });
