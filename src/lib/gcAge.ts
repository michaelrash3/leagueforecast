/**
 * The age a GameChanger name or label states: a team's name, a bracket in it, a loose listing, an
 * organization's name, and whether an age fits a label's band.
 *
 * Split out of `gameChangerApi.ts`, which re-exports all of it, because these are what the modules
 * League Standings loads at start read of that file (a name loses its age label as it is cleaned,
 * `cleanTeamName`, and the pool's store checks the ages it reads back), and the rest of it, the
 * client's parsers and the list reader, only Team Rankings runs: the first download carried it all.
 */

/**
 * The age a team's leagues say it plays at, when they say one and agree.
 *
 * A league is where a team plays its own age. A tournament is where it plays **up**, so this
 * deliberately takes only the leagues: the row that settles it is an 11U team whose league is
 * "NKB 11u" and whose tournaments include "NB Summer Slam 12U", and reading the tournament would
 * file it a year old and make every game in its own league read as playing down.
 *
 * Two leagues naming different ages is not an answer — one of them is about a different squad of
 * the same club — so it refuses rather than picking, which is the rule `ageFromOpponentNames`
 * already holds a tie to.
 */
/**
 * An organization's name that is an event rather than a standing body.
 *
 * "(09/25/2026) 17/18u Super Fall Invitational", "FS 4th Annual Mid-Atlantic Labor Day Classic".
 * A tournament's age is a ceiling teams reached rather than the age they are, which is the same
 * distinction `ageFromLeagueNames` draws between a league and a tournament — except that a crawl
 * types every organization the same way, so the name is all there is to go on.
 */
const EVENT_NAME =
  /\(\d{1,2}\/\d{1,2}\/\d{2,4}\)|\b(?:classic|invitational|tournament|showdown|championship|cup|slam|bash|shootout|opener|qualifier|series|festival|jamboree|clash|brawl|showcase|annual)\b/i;

/**
 * "13U-16U COBRA Fall 2026", "Suburban Travel 13/14u", "17-19u" — several ages share the
 * organization, so its top end is nobody's age in particular.
 *
 * The optional `U` after the *first* number is load-bearing: clubs write the span both ways, and
 * without it "13U-16U" reads as a plain 16U and files thirteen-year-olds three years old.
 */
const MULTI_AGE = /\b\d{1,2}\s*[uU]?\s*[-\u2013/]\s*\d{1,2}\s*[uU]\b/;

/**
 * The age an organization's own name states, where that is a statement about its teams.
 *
 * An organization named "TPABL 12U" or "GLL 8u Fall 2026" is saying what age plays under it, and
 * for a team that has no age of its own that is worth more than nothing — which is what such a
 * team has. GameChanger's public API has no route from a team to its organization, so this only
 * ever arrives from a crawl that found the team through one.
 *
 * Refused for events and for spans, and both refusals are measured. Over 17,003 teams carrying an
 * organization, 2,240 had both an org naming an age and an age of their own to check it against.
 * The org's age agreed 90.1% of the time. Excluding event-sounding names took that to 94.1%,
 * excluding spans to 93.9%, and excluding both to **95.1%** — and the errors are overwhelmingly
 * one-directional: of 221 disagreements, 197 had the organization *older* than the team. That is
 * the play-up signature. "(09/25/2026) 17/18u Super Fall Invitational" holds 16U teams;
 * "Suburban Travel 13/14u" holds 13U ones.
 *
 * 95% is not good enough to outrank anything a team says about itself, so this sits at the very
 * bottom of the ladder, under the league rung and under the company a team keeps. It only ever
 * answers a team that has no other answer at all.
 */
export const ageFromOrgName = (name: unknown): number | undefined => {
  if (typeof name !== "string" || !name.trim()) return undefined;
  if (EVENT_NAME.test(name) || MULTI_AGE.test(name)) return undefined;
  return ageLevelFromName(name);
};

const MIN_GC_AGE_LEVEL = 6;

const MAX_GC_AGE_LEVEL = 19;

export const inAgeRange = (level: number): boolean =>
  Number.isInteger(level) && level >= MIN_GC_AGE_LEVEL && level <= MAX_GC_AGE_LEVEL;

/**
 * The bracket a team name spells out — "Braves 9u/10u Fall", "Astros (9U/10U)", "AZ Core 17U/18U",
 * and the shorthand "OM 9/10U" where only the second age carries its U. Undefined when the name
 * carries no bracket, or when either end is not an age this app ranks.
 *
 * Its own function, rather than a step inside `ageLevelFromName`, because a bracket is not simply
 * another way of writing a level. A single label is one age somebody typed; a bracket is the team
 * saying which two ages it takes the field against, which is why `ageLevelOf` lets it outrank an
 * age written anywhere else, and why `cleanTeamName` takes it off a name as one thing rather than
 * as two labels with a separator stranded between them.
 *
 * The second age must carry the U, which is what keeps "Mears 1 - 2026" and other stray number
 * pairs out.
 */
export const ageSpanFromName = (name: string): { low: number; high: number } | undefined => {
  if (typeof name !== "string") return undefined;
  const span =
    /\b(\d{1,2})\s*(?:[uU][A-Da-d]{0,3})?\s*[/\-\u2013]\s*(\d{1,2})\s*[uU][A-Da-d]{0,3}/.exec(name);
  if (!span) return undefined;
  const first = Number(span[1]);
  const second = Number(span[2]);
  if (!inAgeRange(first) || !inAgeRange(second)) return undefined;
  // Written both ways round in the wild — "9U/10U" and "12U/11U" are both in the export — so the
  // two ends are sorted rather than assumed to be in order.
  return { low: Math.min(first, second), high: Math.max(first, second) };
};

/**
 * The age label a team name carries ("9u Astros", "Trash Pandas 9u", "U11 Bandits") — the
 * fallback when GameChanger's profile or a CSV column leaves the age blank. The label is loose
 * evidence, so callers only use it when nothing better is known.
 *
 * The tier letters travel ball hangs off the level — "9UA", "9UB", "11UAA" — are part of the
 * label, not a different word, so they are consumed rather than read as the end of the name. A
 * plain word boundary rejected every one of them, and a blank age column with the level only in
 * the name is exactly when this function is asked. Only A through D are allowed through, so
 * "12UNDER" is still not a 12U team.
 */
export const ageLevelFromName = (name: string): number | undefined => {
  if (typeof name !== "string") return undefined;
  // A bracket reads as its older end, the same as the age column does. Checked first, because the
  // plain search below would stop on the younger number and never see the rest of it. A bracket
  // with an unrankable end is no bracket at all, and falls through to that search.
  const span = ageSpanFromName(name);
  if (span) return span.high;
  const match = /\b(?:(\d{1,2})\s*[uU][A-Da-d]{0,3}|[uU]\s*(\d{1,2}))\b/.exec(name);
  if (!match) return undefined;
  const level = Number(match[1] ?? match[2]);
  return inAgeRange(level) ? level : undefined;
};

/*
 * ---------------------------------------------------------------------------------------------
 * GameChanger's own age vocabulary
 * ---------------------------------------------------------------------------------------------
 *
 * The age field does not only carry "12U" and "Varsity". It carries a small closed vocabulary of
 * its own, and until these readers existed this app understood none of it — `parseGcAgeLevel`,
 * `ageLevelOf` and `isSchoolAgeLabel` all returned nothing for every value below, which is why
 * teams whose page plainly said what they were sat on the waiting list being asked about weekly.
 *
 * Measured over the 36,194 teams waiting on an age on 22 September 2026, where the field is set
 * on 36,182 of them — 99.97% — and holds exactly eleven distinct values:
 *
 *   Under 13            27,485   75.9%   a ceiling, not an age
 *   Between 13 - 18      3,967   11.0%   a band, not an age
 *   Over 18              2,049    5.7%   adults
 *   college                719    2.0%   college
 *   18O                    535    1.5%   adults
 *   middle_13O             419    1.2%   a school season
 *   middle_12U             379    1.0%   a school season
 *   high_varsity           313    0.9%   a school season
 *   high_freshman          164    0.5%   a school season
 *   elementary             104    0.3%   a school season
 *   high_junior_varsity     48    0.1%   a school season
 *
 * The values are truthful where they were sampled: the `Over 18` rows include "Long island Angels
 * 44" playing "LISM Patriots 44+", the `college` rows "MCC Wolves" playing "Coffeyville CC", and
 * the `high_varsity` rows "Flaming Bulldogs" playing "Casa Roble Varsity Rams".
 */

/**
 * The school squads, in GameChanger's own age field.
 *
 * Two vocabularies in one test. "Varsity" and "JV" arrive verbatim — this file has cited
 * "Varsity" as an unreadable value for as long as the parser has existed — and beside them sits
 * GameChanger's own school taxonomy, `high_`, `middle_` and `elementary`, which names the school
 * band outright. A middle school team plays the school season exactly as a varsity side does, so
 * it is refused on the same grounds and by the same rule rather than by a second one.
 *
 * Note `middle_12U` names an age and is still not read as one. A seventh-grade school side is a
 * school side; reading the 12 would file it against travel clubs it never plays.
 *
 * Whole value only, the same strictness `parseGcAgeLevel` holds the column to: a team whose age
 * field is a sentence containing the word is not thereby a high school team.
 */
const SCHOOL_LABEL =
  /^(?:varsity|jv|junior\s+varsity|hs|high\s+school|jv\s*[/\-\u2013]\s*v|v\s*[/\-\u2013]\s*jv|high_[a-z_]+|middle_[a-z0-9]+|elementary)$/i;

export const isSchoolAgeLabel = (label: unknown): boolean =>
  typeof label === "string" && SCHOOL_LABEL.test(label.trim());

/**
 * Grown men, in GameChanger's own age field.
 *
 * This app ranks youth baseball — `MAX_AGE_LEVEL` is 18 — and an over-40 men's league is not a
 * hard age to read so much as a different sport's worth of irrelevance. These teams can never be
 * aged, because there is no youth age to find, so they are refused rather than asked about.
 *
 * `18O` means eighteen and over, which is the one value here that brushes against a real 18U
 * squad. Of the 3,303 rows carrying any of these three, thirty have a name that reads 18U-ish,
 * and almost all of those are plainly college ("UNT Club Baseball 2026-2027") or a league's own
 * administrative account ("FALL Board 2027", "2026-2027 AAA Board Members"). The handful left is
 * the price of the other three thousand, and a refusal here is undoable where a wrong age is not.
 */
const ADULT_LABEL = /^(?:over\s*18|18\s*o|college|adult)$/i;

export const isAdultAgeLabel = (label: unknown): boolean =>
  typeof label === "string" && ADULT_LABEL.test(label.trim());

/**
 * The bands, which bound an age without giving one.
 *
 * "Under 13" and "Between 13 - 18" are the two values that say something true about the age
 * without saying what it is, and they cover 87% of the backlog between them. They cannot file a
 * team — there is no single age in either — but they can refuse one, and that turns out to be
 * where their value is.
 *
 * Measured against every candidate rule in `agelessTriage.ts` over the same 36,194 rows: 1,186 of
 * the 1,203 ages those rules derive sit inside the band GameChanger states, 98.6%. All seventeen
 * that do not are the same rule reading a mascot or a university as a PONY division — "SMSU
 * Mustangs Home" is Southwest Minnesota State and is labelled `college`; "Owls Colt" and "Canes
 * Colts" are labelled `Under 13` and would have been filed at 16U. The band catches every one.
 *
 * `Under 13` is read as a ceiling of 13 rather than 12, deliberately loosely. Little League's
 * Intermediate division is ages 11 to 13 and this app files it at 13U, so a twelve-year-old in
 * that division is `Under 13` and 13U at the same time and neither is wrong. Read strictly, the
 * band would veto 178 Intermediate teams it has no business vetoing.
 */
export type GcAgeBand = { low?: number; high?: number };

export const ageBandFromLabel = (label: unknown): GcAgeBand | undefined => {
  if (typeof label !== "string") return undefined;
  const value = label.trim().toLowerCase();
  if (/^under\s*13$/.test(value)) return { high: 13 };
  if (/^between\s*13\s*[-\u2013]\s*18$/.test(value)) return { low: 13, high: 18 };
  return undefined;
};

/**
 * Whether an age this app derived could be true of a team GameChanger filed under that label.
 *
 * Every reading of the field at once, because the question a caller has is one question. The two
 * bands bound the age. The adult and school labels admit no youth age at all — a side filed
 * `college` or `high_varsity` is not a nine-year-old team that happens to be labelled oddly, and
 * a rule that derived a youth age for one has misread what the team is rather than by how much.
 *
 * A label this app does not recognise says nothing, and nothing is what it is taken to say: the
 * common case is an ordinary unreadable label like "Minors", where the rules are on their own.
 */
export const ageFitsBand = (level: number, label: unknown): boolean => {
  if (isAdultAgeLabel(label) || isSchoolAgeLabel(label)) return false;
  const band = ageBandFromLabel(label);
  if (!band) return true;
  if (band.low !== undefined && level < band.low) return false;
  return !(band.high !== undefined && level > band.high);
};

/**
 * An age written against the rest of a name, where `ageLevelFromName` reads none — "Spiders12U",
 * "10U_Hartman", "Donegal Green 12u2", "U13s Blue" — or a span written without its U, "Giants
 * 11-12", "Braves 9/10", read as its older end the way `ageSpanFromName` reads one with it.
 *
 * The ordinary reader's word boundaries are what keep "12UNDER" out, and its demand for a U on a
 * span is what keeps a date or a team number out, so neither is loosened there: this is a separate
 * reading, and only ever the last word — see `importOne`, where it answers a team nothing else
 * could age, so no team the pool already files moves.
 *
 * Measured over the 115,053 teams in the pool-names export of 23 September 2026, on the 102,845
 * whose name the ordinary reader finds nothing in. The glued forms fire on 254 and 236 (92.9%)
 * are filed at exactly the age read, 251 (98.8%) within a year. The spans fire on 283, 205
 * (72.4%) exactly and 264 (93.3%) within a year, most of the rest filed at the younger end. A span
 * can be two school grades as well as two ages; the user settled that in these names it is ages,
 * and a name that says "grade", or puts an ordinal against a number, is left alone. On the 38,603
 * teams waiting on an age the week before, it reads 545, and GameChanger's own band refuses 12.
 */
const GLUED_AGE =
  /(?<![0-9])(\d{1,2})\s*[uU][A-Da-d]{0,3}(?![a-zA-Z])|(?<![a-zA-Z0-9])[uU]\s*(\d{1,2})(?![0-9])/;

const BARE_SPAN = /(?<![\d/.:$#-])(\d{1,2})\s*[-/&\u2013]\s*(\d{1,2})(?![\d/:%.-])/g;

const SAYS_GRADE = /\bgrades?\b|\b\d{1,2}(?:st|nd|rd|th)\b/i;

export const ageLevelFromLooseName = (name: string): number | undefined => {
  if (typeof name !== "string") return undefined;
  const glued = GLUED_AGE.exec(name);
  if (glued) {
    const level = Number(glued[1] ?? glued[2]);
    if (inAgeRange(level)) return level;
  }
  if (SAYS_GRADE.test(name)) return undefined;
  for (const [, first, second] of name.matchAll(BARE_SPAN)) {
    const low = Number(first);
    const high = Number(second);
    // Two ages a year or two apart, in order: "11-12", "13/14", "15-17". Anything else is a date,
    // a score or a squad number.
    if (inAgeRange(low) && inAgeRange(high) && high > low && high - low <= 2) return high;
  }
  return undefined;
};
