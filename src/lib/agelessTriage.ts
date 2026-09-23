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
  ageWrittenInName,
  isSchoolAgeLabel,
  isSchoolName,
  maybeSchoolTeam,
  ageFitsBand,
  isAdultAgeLabel,
} from "./gameChangerApi";
import { MIN_AGE_LEVEL } from "./teamRankings/seasons";
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
  /** Below the youngest level ranked here, and always will be: next year is a different id. */
  | { kind: "too-young" }
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
 * **Intermediate files at 12U, not 13U, and the tripwire is why.** The division is ages 11 to 13,
 * so 13U looked like the right ceiling to file it at. Run against the 60,040 teams this pool
 * already ranks, the rule fires on nine of them and six carry an age to check it against — and it
 * disagrees with four: "Brick Surge 50/70", "Corvallis Fall Ball 50/70", "BABL 50/70 Royals" and
 * "MSM Victory Lakes Intermediate 6th Grade - Maroon" are all filed 12U in a pool that got their
 * ages from GameChanger's own field. Only two agree. The last of those names says it plainly:
 * sixth grade is eleven and twelve, and it is the 50/70 field that makes the division, not the
 * age of the boys on it. Filing them 13U would have moved four working teams up a year and put
 * every future one in the wrong table.
 *
 * Two of six is not a measurement to ship on either, which is why this stays `review`.
 *
 * https://cdn4.sportngin.com/attachments/document/8b3e-3334205/2025-DYB-Rule-Book-Website-Version-1-1-2025.pdf
 * https://www.littleleague.org/play-little-league/baseball/divisions/
 */
const UNIQUE_DIVISIONS: [RegExp, number][] = [
  [/\bo[-\s]zone\b/i, 12],
  [/\b(?:50\s*[/-]\s*70|intermediate)\b/i, 12],
];

/**
 * The young end, which files below the youngest level ranked here rather than at an age: tee ball,
 * and PONY's Shetland (5-6) and Foal (3-4), which are that age by PONY's own definition.
 */
const YOUNGEST = /\b(?:(?:tee|t)[-\s]?ball|shetlands?|foals?)\b/i;

/**
 * A name somebody gave a team to say it should not be used — "VOID", "Old Team - Do Not Use". The
 * user's own rule: these are cleared whatever the schedule says. 68 of the 38,603 rows waiting on
 * 22 September 2026, 57 of them with no games at all.
 */
const VOID_NAME = /\bvoid(?:ed)?\b|\bdo\s*n[o'\u2019]?t\s*use\b/i;

/**
 * A side that says it travels or plays tournaments, which is the one thing that joins a league team
 * to the rest of the pool. Wider than `CONNECTED` because it guards a rule that clears a team
 * rather than one that only proposes it.
 */
const TRAVELS = /\b(?:all[-\s]?stars?|travel|select|elite|tournament|tourney|showcase)\b/i;

/** The sanctioning bodies whose teams are league ball: GameChanger writes them `little_league`. */
const REC_BODIES = /little league|babe ruth|cal ripken|pony|dixie/;

const playsUnderRecBody = (evidence: AgelessEvidence): boolean =>
  (evidence.ngb ?? []).some((body) => REC_BODIES.test(body.replace(/_/g, " ")));

/**
 * The words a rec league names its divisions and itself by: Little League's Majors, Minors, AAA,
 * AA, Farm and Rookie; the pitching divisions; house and in-house; "LL" standing alone.
 *
 * A bare "A" is left out — "Team A" and the "A's" are everywhere — and so are the PONY horses,
 * which are the commonest mascots in youth baseball (see `PONY_DIVISIONS`). None of these is ever
 * read as an age here; the grade words mean one thing to Little League and another to USSSA, which
 * is why `grade-word` is only ever measured. Here they only say the team is in a league.
 */
const DIVISION_WORDS =
  /\b(?:ll|little\s+league|babe\s+ruth|cal\s+ripken|majors?|minors?|farm|rookies?|aaa|aa|(?:single|double|triple)[-\s]?a|(?:coach|machine|kid|player)[-\s]?pitch|pee[-\s]?wee|instructional|in[-\s]?house|house\s+league|rec|recreation(?:al)?|parks?\s*(?:and|&)\s*rec|ymca)\b/i;

/**
 * A league's initials ending in LL — "NCLL", "SFLL", "PALL" — as clubs write them in capitals.
 *
 * Capitals only, a stem of four letters or fewer with at most one vowel, and never an ordinary
 * word: read case-blind, "Fall", "Ball" and "O'Neill" all end in LL, and a first draft of this
 * rule cleared "Aces" for having played "Riverside Rats Fall 26".
 */
const LEAGUE_INITIALS = /\b([A-Z]{1,4})LL\b/g;
const NOT_INITIALS = new Set(
  "ALL BALL BELL BILL BULL CALL CELL CHILL DELL DILL DOLL DRILL DULL FALL FILL FULL GILL GRILL GULL HALL HILL HULL JILL KILL KNOLL KRALL MALL MILL NELL NULL PILL POLL PULL QUILL ROLL SELL SHELL SILL SKILL SMALL SMELL SNELL SPELL SPILL STALL STILL SWELL TALL TELL TILL TOLL TROLL WALL WELL WILL YELL".split(
    " "
  )
);

const namesLeagueInitials = (text: string): boolean =>
  [...text.matchAll(LEAGUE_INITIALS)].some(
    ([initials, stem]) =>
      !NOT_INITIALS.has(initials) && (stem ?? "").replace(/[^AEIOU]/g, "").length <= 1
  );

const namesALeague = (text: string): boolean =>
  DIVISION_WORDS.test(text) || namesLeagueInitials(text);

/** Major League Baseball's thirty clubs, which a house league hands out as team names. */
const MLB_CLUB =
  /\b(?:yankees|red\s*sox|orioles|rays|blue\s*jays|white\s*sox|guardians|tigers|royals|twins|astros|angels|athletics|a's|mariners|rangers|braves|marlins|mets|phillies|nationals|cubs|reds|brewers|pirates|cardinals|diamondbacks|d-?backs|rockies|dodgers|padres|giants)\b/i;

/**
 * A team in a closed league: it has played, nobody it played writes an age, its own name states
 * none, and it does not say it travels. What the three rec rules below have in common, and why
 * they can clear a team rather than only propose it — nothing will ever age a team like this from
 * its opponents, and nothing joins it to a club this app ranks.
 */
const inClosedLeague = (row: AgeUnknownTeam): boolean => {
  const evidence = evidenceOf(row);
  return (
    evidence.games > 0 &&
    evidence.namedAnAge === 0 &&
    !TRAVELS.test(nameOf(row)) &&
    ageLevelFromName(nameOf(row)) === undefined
  );
};

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
/**
 * Whether the teams this one played say its PONY word is a division rather than a mascot.
 *
 * A **different** sibling word, never its own, and that distinction is the whole rule. A league
 * that calls one division Mustang calls the next one Bronco, so a Mustang playing Broncos and
 * Pintos is in a PONY league. But a *club* called the Colts runs several squads and calls them
 * all Colts, so "Wellington Colts Blue" playing "Wellington Colts Orange" satisfies a same-word
 * test trivially and means nothing at all.
 *
 * Measured, once the pool-names export carried evidence for the tripwire to read: accepting the
 * team's own word, this fired on 102 teams the pool already ranks and got 46 of them wrong —
 * "Irvine Colts" filed at 8U read as 16U, "OKC Broncos Gray" at 8U read as 12U, every one of them
 * a club whose other squads share its mascot. There was no way to see that before the export
 * carried opponents, because with no `sampleOpponents` the corroborator could never fire at all.
 */
const opponentsAgree = (evidence: AgelessEvidence, own: RegExp): boolean =>
  (evidence.sampleOpponents ?? []).some(
    (opponent) =>
      PONY_DIVISIONS.some(([sibling]) => sibling !== own && sibling.test(opponent)) ||
      REC_MARKERS.test(opponent)
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
    id: "void-name",
    label: "Named void or do not use",
    tier: "review",
    because: "whoever made the team named it so nobody would use it",
    read: (row) => (VOID_NAME.test(nameOf(row)) ? { kind: "not-real" } : undefined),
  },
  {
    id: "tee-ball",
    label: "Tee ball and younger",
    tier: "auto",
    because:
      "tee ball, Shetland, Foal and a name stating an age under 8U are all below the youngest level ranked here",
    read: (row) => {
      const name = nameOf(row);
      const written = ageWrittenInName(name);
      // A name stating an age says it outright, tee ball or not: "Tee Ball & 8U" is an 8U side.
      if (written !== undefined) return written < MIN_AGE_LEVEL ? { kind: "too-young" } : undefined;
      return YOUNGEST.test(name) ? { kind: "too-young" } : undefined;
    },
  },
  {
    id: "rec-sanctioned",
    label: "A Little League, Cal Ripken or PONY team in a closed league",
    tier: "review",
    because:
      "GameChanger says it plays under a rec body, and nobody it plays writes an age, so nothing will ever age it or join it to travel ball",
    read: (row) =>
      inClosedLeague(row) && playsUnderRecBody(evidenceOf(row)) ? { kind: "rec" } : undefined,
  },
  {
    id: "rec-division",
    label: "A rec division in a closed league",
    tier: "review",
    because:
      "it or a team it plays is named for a rec division or league — Majors, AAA, Farm, Coach Pitch, NCLL — and nobody it plays writes an age",
    read: (row) =>
      inClosedLeague(row) &&
      (namesALeague(nameOf(row)) || (evidenceOf(row).sampleOpponents ?? []).some(namesALeague))
        ? { kind: "rec" }
        : undefined,
  },
  {
    id: "house-league",
    label: "A house league named after big-league clubs",
    tier: "review",
    because:
      "two of the teams it plays carry a Major League club's name, and nobody it plays writes an age",
    read: (row) =>
      inClosedLeague(row) &&
      (evidenceOf(row).sampleOpponents ?? []).filter((opponent) => MLB_CLUB.test(opponent))
        .length >= 2
        ? { kind: "rec" }
        : undefined,
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
    /*
     * Measured only, and it earned that the hard way.
     *
     * The premise was that a PONY division word plus a *sibling* word in the opponents means a
     * PONY league rather than a mascot. The tripwire, once the pool-names export carried the
     * opponents it needed, says otherwise. Accepting the team's own word it fired on 102 teams
     * the pool already ranks and got 46 wrong — every one a club whose other squads share its
     * mascot, "Wellington Colts Blue" playing "Wellington Colts Orange". Requiring a *different*
     * sibling word, which is the correct reading and is what the code now does, cuts that to 7
     * fires — and 6 of those 7 are still wrong.
     *
     * Because horse-mascot clubs play each other. "Broncos Red" played "Mundelein Mustangs Red":
     * two different words, two unrelated travel clubs, filed 9U and 12U. And "Colts Neck Cougars
     * White" carries a place in New Jersey. One right out of seven is not a rule, it is a
     * coincidence detector, and offering it to a person to confirm would waste their time at the
     * same rate.
     *
     * Kept and counted rather than deleted: the sweep still reports what it would catch, and the
     * 914 backlog rows it reaches are a real population that something else may yet settle.
     */
    tier: "measure",
    because: "measured only — one of seven hits on teams that already work had the right age",
    read: (row) => {
      if (statesItsAge(row)) return undefined;
      const found = ponyDivision(nameOf(row));
      if (!found) return undefined;
      const [own, level] = found;
      const evidence = evidenceOf(row);
      if (evidence.namedAnAge >= MIN_OPPONENT_AGE_EVIDENCE) return undefined;
      if (!opponentsAgree(evidence, own) && !saysAges(evidence)) return undefined;
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
    /*
     * The whole schedule, however short, and nothing less: every game has a result and every
     * result is ahead of today. It is the rule the import now refuses a schedule by
     * (`isInventedSchedule`), read here off the evidence a row kept, so a team already waiting is
     * named the same way before its next re-ask throws it out. The floor of five this used to
     * carry is gone because the user settled the rule outright; one unscored game, or one played,
     * still keeps a team off it.
     */
    read: (row) => {
      const evidence = evidenceOf(row);
      return evidence.games > 0 &&
        evidence.scored === evidence.games &&
        evidence.aheadOfToday === evidence.scored
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

/** A row, the rule that claimed it, and what the rule concluded. */
export type AgelessAnswered = {
  row: AgeUnknownTeam;
  rule: AgelessRule;
  verdict: AgelessVerdict;
};

/**
 * The rules the waiting card clears with, in the order a row is claimed by one.
 *
 * GameChanger's own two answers, and then the user's calls, made over the 38,603 rows waiting on
 * 22 September 2026: a team named void or do-not-use goes whatever its schedule; tee ball and
 * younger go, as every team under the floor already does at the door; and a rec-league team in a
 * closed league goes for good, since nothing will ever age it from its opponents or join it to the
 * clubs this app ranks. Over that file they claim 68, 0, 0, 1,919, 13,701, 4,400 and 1,869 rows —
 * 21,957 of the 38,603, 57%. (GameChanger's two find nothing there because the import refuses
 * those teams at the door now; they stay for lists kept from before it did.) Of the 19,970 rec
 * rows, 38 carry a word a travel club might — "Academy", "Prospects", "Baseball Club",
 * "National" — and all but four of those are Little League "National" divisions or plainly house
 * league: "D33 Majors La Mesa National 1", "FHLL National - Hoffman".
 *
 * What is left is the other 43%: 5,885 with no games at all (asked again weekly in their own
 * season, and dropped from the list outside it by the import), 2,691 whose opponents do name an
 * age, and 8,070 closed leagues that name themselves nothing a rule here can read.
 *
 * Deliberately a list of ids rather than a tier. `school-name` and `name-resolves` are `auto`
 * too, and neither belongs here: one would clear teams the import already refuses by the same
 * name, the other is an age to file rather than a team to clear. And `tee-ball`, which does, fires
 * on five teams this pool already ranks — which is why it stands down for a name that writes an
 * age of its own, and why this list reads only rows that are still waiting.
 *
 * Every clear goes through the one confirmed, undoable pass: none of these is applied on its own.
 */
export const CLEARABLE_RULES: readonly string[] = [
  "void-name",
  "adult-label",
  "school-label",
  "tee-ball",
  "rec-sanctioned",
  "rec-division",
  "house-league",
];

/**
 * What each row was claimed by, kept per row object.
 *
 * The card asks again after every answer given on it, and every rule over 38,603 rows took 190 ms
 * a pass. A waiting row is never changed in place — a re-ask writes a new object — so the answer
 * for an object already seen is the answer still, and only rows new since the last pass are read.
 */
const claimedBy = new WeakMap<AgeUnknownTeam, AgelessAnswered | null>();

const claim = (row: AgeUnknownTeam): AgelessAnswered | null => {
  const verdicts = agelessVerdicts(row);
  for (const id of CLEARABLE_RULES) {
    const hit = verdicts.find(({ rule }) => rule.id === id);
    if (hit) return { row, rule: hit.rule, verdict: hit.verdict };
  }
  return null;
};

/** The rows the card can clear, each claimed by the first of `CLEARABLE_RULES` that fires on it. */
export const agelessClearable = (rows: readonly AgeUnknownTeam[]): AgelessAnswered[] =>
  rows.flatMap((row) => {
    let hit = claimedBy.get(row);
    if (hit === undefined) {
      hit = claim(row);
      claimedBy.set(row, hit);
    }
    return hit ? [hit] : [];
  });

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
