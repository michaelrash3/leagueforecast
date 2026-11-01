/**
 * Names, and what the app does with them.
 *
 * A club's name is the only thing two halves of this app reliably agree on, and it is not reliable
 * at all: GameChanger writes the age level into it, a league roster does not, and the same side
 * turns up as "Trash Pandas", "Trash Pandas Baseball Club" and "Trash Pandas 10U" on three
 * different pages. Everything here exists because of that — the cleaning, the comparison key, the
 * near-match warning, and the placeholders that are not a name at all.
 *
 * Split out of `teamRankings.ts`, which was three thousand lines and a hundred and four exports
 * covering rating maths, name handling, season arithmetic, GameChanger linking and ranking
 * assembly. `teamRankings.ts` re-exports this, so nothing that imports from there had to change.
 *
 * The cleaning and the keys are read as League Standings starts, so the rest, finding the club a
 * name is or making one, the slots that name nobody, the near-match warning and the states, is a
 * module of its own (`rosterNames.ts`), which `teamRankings.ts` re-exports too: in this one, the
 * first download carried all of it.
 */
import { ageSpanFromName } from "../gcAge";
import { rememberUpTo } from "../rememberUpTo";
import type { ScoutTeam } from "./types";

/** Prefix guarantees a scout-created id can never collide with a league season's own team ids
 * (those are plain alphanumeric codes from `createTeamId` in sim.ts). */
export const SCOUT_ID_PREFIX = "S-";

/**
 * "9U", "9u", "12 U", "U10" — an age level, anywhere in the name — and the division letters that
 * run straight on from it, as in "9UA" or "11UAA". The letters have to follow with no space, so
 * "12 United" and "9u Scout" keep the word that happens to come next.
 */
const AGE_LABEL = /\b(?:\d{1,2}\s*[uU][A-Da-d]{0,3}|[uU]\s*\d{1,2})\b/g;

/**
 * A bracket — "9U/10U", "13u - 14u", "11UA/12UB", and the shorthand "9/10U" — which comes off as
 * one thing, separator and all.
 *
 * Taking the two labels off separately left the separator stranded in the middle of the name:
 * "Premier Ohio Lopez 9U/10U" was stored as "Premier Ohio Lopez /", and "Alvey 9U/10U | King
 * Coconuts" as "Alvey / | King Coconuts". The level was read from the whole bracket, so the name
 * has to lose the whole bracket.
 *
 * The shape is `ageSpanFromName`'s, and what it matches is handed back to that function to decide:
 * removed when it reads as a bracket, left exactly as it was when it does not, so the cleaner
 * cannot take off something the reader would not have read. That is what keeps "Team 5 - 12U" —
 * a squad number beside a level rather than a bracket, 5 being below any age the reader will
 * take — with its 5, and the level still comes off as a plain label.
 */
const AGE_SPAN = /\b\d{1,2}\s*(?:[uU][A-Da-d]{0,3})?\s*[/\-\u2013]\s*\d{1,2}\s*[uU][A-Da-d]{0,3}/g;

/** An innermost bracketed aside, so nesting comes apart a layer at a time. */
const PARENTHETICAL = /\([^()]*\)/;

/**
 * Tidies a team name down to what the club is actually called.
 *
 * Two things come off. The **age label**, because an age level describes *this year's* squad, not
 * the club, and the same club plays up a level every year ("South Lexington Red 9u" becomes
 * "…10u") — keeping it would fragment one real-world team into a new entity every season, which
 * is what the age-group scoping already handles — the division letters on "11UAA" go with it,
 * since they are part of the same label, and a **bracket** goes as one thing, separator included,
 * so "Premier Ohio Lopez 9U/10U" is stored as "Premier Ohio Lopez" rather than with a slash left
 * where the ages were. And anything in **parentheses**, which on a
 * GameChanger schedule is an aside rather than part of the name: a season, a division, a
 * tournament, a note somebody typed. Labels anywhere in the name are handled, so
 * "NV Stars 9u Scout" becomes "NV Stars Scout".
 *
 * What is *not* touched is a dash suffix — "9U North Oldham Knights - Navy", "Frisco Dodgers -
 * Gomez 11UAA". That is how a club tells its own squads apart, and it is the only thing
 * distinguishing two teams that would otherwise read alike, so it stays in the name and in the key
 * two names are compared by.
 */
export const cleanTeamName = (name: string): string => {
  let stripped = name;
  while (PARENTHETICAL.test(stripped)) stripped = stripped.replace(PARENTHETICAL, " ");
  stripped = stripped
    .replace(AGE_SPAN, (match) => (ageSpanFromName(match) ? " " : match))
    .replace(AGE_LABEL, " ")
    .replace(/\s{2,}/g, " ")
    // A slash joins two things, so one left at either end is joining the name to nothing: it is
    // always debris, and it is the debris a pool already holds. Entries stored as "Premier Ohio
    // Lopez /" by the cleaner that took a bracket off as two labels have no bracket left in them
    // to recognise, so this is what heals them when their club is next pulled.
    .replace(/^[\s\-–—,/]+|[\s\-–—,/]+$/g, "");
  // A name that is *only* an age label, or only an aside, still has to be called something.
  return stripped || name.trim();
};

/**
 * The key two names are compared by: age-label-free and case-insensitive. Exported so callers that
 * need to look a name up in the roster (the screenshot importer, for one) match names exactly the
 * way `resolveOrCreateTeam` does, instead of re-deriving the rule.
 *
 * Remembered by name, up to half a million names (`rememberUpTo`). The League pass, the bridge to
 * League Standings and the tidy clean the same names on every pass and every open, a key is several
 * passes of regular expressions, and a team object's own key (`nameKeyOf`) is only as good as the
 * object, which a pass replaces. On the seeded full-size pool (`scripts/poolFixture.ts` at 12,000
 * clubs a page: 121,204 clubs, 344,553 games) a tidy asked for 2,465,586 keys of 101,384 names;
 * remembered, the League pass over the three squad years went from about 2.8 s to 2.1 s and the
 * bridge for the three seasons from 2.7 s to 1.2 s, every answer the same to the digit
 * (`rememberedNames.test.ts`). Those 101,384 names hold about 5 MB in Node; the bound is five times
 * as many, so a page, worker or server open for days stops at a few tens of MB.
 */
export const teamNameKey = rememberUpTo(500_000, (name) =>
  cleanTeamName(name)
    .toLowerCase()
    // Punctuation between words is spacing, not spelling: "Wheaton Warriors - Grey", "Wheaton
    // Warriors Grey" and "Wheaton Warriors/Grey" are one name written three ways, and a pull
    // reads all three off different schedules. The suffix words themselves stay, so "Frisco
    // Dodgers Gomez" is still not "Frisco Dodgers".
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s*[-\u2013\u2014/]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
);

/**
 * The key two GameChanger *listings* are compared by when asking whether they are one squad: the
 * age label off, everything else kept. `teamNameKey` drops a parenthetical because "Heat 9U
 * (Ealey)" and "Heat 9U" are one *club* for an opponent to have played — but they are two squads,
 * and the fold that decides whether two ids are one roster has to see the difference.
 */
export const squadNameKey = (listingName: string): string =>
  listingName
    .replace(AGE_SPAN, (match) => (ageSpanFromName(match) ? " " : match))
    .replace(AGE_LABEL, " ")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s*[-\u2013\u2014/]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();

/**
 * The key a name written in full is told apart by: case, spacing and punctuation aside, with every
 * word kept, a bracketed coach's name and an age label included. `teamNameKey` drops both, which
 * suits matching a GameChanger opponent to its club, but one league can have "Heat (Coach A)" and
 * "Heat (Coach B)", or "Wolves 9U" and "Wolves 10U", as two of its teams, and a pasted schedule
 * names them so (`leagueScheduleText.ts`), as Fill scores reads them against the names GameChanger
 * lists each club under (`leagueScoreFill.ts`).
 */
export const pasteNameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

/**
 * Words that say what a club is rather than which one. "Dragons Baseball" is the Dragons, "Cincy
 * Stix Baseball Club" is the Stix, and a coach typing an opponent's name leaves these off as often
 * as not. Kept to the words that carry no identity at all: "Elite", "Select" and "Academy" are
 * often the half of a name that tells two clubs in one town apart, so they stay.
 */
const NAME_FILLER = new Set(["baseball", "club", "bc", "bbc", "the", "team"]);

/**
 * The words of a name that could identify a club: the `teamNameKey` words, less the filler, less
 * bare numbers (a birth year, a "2" telling a club's second squad from its first), and with a
 * number stuck on the end of a word taken off it — a coach keeping two Headlines squads apart
 * writes "Headlines1" and "Headlines2".
 */
const nameWords = (name: string): Set<string> =>
  new Set(
    teamNameKey(name)
      .split(" ")
      .map((word) => word.replace(/(?<=[a-z])\d+$/, ""))
      .filter((word) => word && !/^\d+$/.test(word) && !NAME_FILLER.has(word))
  );

/**
 * Whether one of two names could be a coach's shorthand for the other: every word of the shorter
 * is in the longer. "Stix" for "Cincy Stix Navy", "Dragons" for "Dragons Baseball", "Hurricanes"
 * for "Northern Kentucky Hurricanes".
 *
 * Nowhere near an identity on its own — every state has a club with "Dragons" in its name — and
 * nothing may use it as one. It is the name half of a test whose other half is a fixture: two
 * schedules that each describe the same game, on the same day, with the same result. A coach who
 * writes two different clubs as "Headlines1" and "Headlines2" is read as "Headlines" twice, which
 * is right only because the game, not the name, says which Headlines each row was; a rule that
 * matches on names alone keeps `teamNameKey`, where those two stay apart.
 */
/**
 * The numbers a name carries once its age label is off: a squad ("Xposure Warriors 3"), a squad
 * written onto the word ("Headlines1"), a graduating class ("STX Showtime 2032"), an area code.
 */
const nameMarkers = (name: string): Set<string> => new Set(teamNameKey(name).match(/\d+/g) ?? []);

/** What `nameFitsWithin` reads off a name: its words and its numbers. */
type NameParts = { words: Set<string>; markers: Set<string> };

const partsOf = (name: string): NameParts => ({
  words: nameWords(name),
  markers: nameMarkers(name),
});

const partsFit = (a: NameParts, b: NameParts): boolean => {
  /*
   * Two names that each carry a number and share none are two squads, however well the words
   * fit: "Xposure Warriors 1" is not "Xposure Warriors 3", nor "STX Showtime 2032" the 2033s —
   * the spelling measurement judged every such pair it looked at two clubs, and a three-hour gap
   * between the rows was all that separated a joined game from one neither played. A number on
   * one side only is still a shorthand: "Headlines1" is what a coach calls "Headlines 9U Nagel".
   */
  if (
    a.markers.size > 0 &&
    b.markers.size > 0 &&
    ![...a.markers].some((marker) => b.markers.has(marker))
  ) {
    return false;
  }
  if (a.words.size === 0 || b.words.size === 0) return false;
  const [short, long] = a.words.size <= b.words.size ? [a.words, b.words] : [b.words, a.words];
  for (const word of short) {
    if (!long.has(word)) return false;
  }
  return true;
};

export const nameFitsWithin = (a: string, b: string): boolean => partsFit(partsOf(a), partsOf(b));

/**
 * The words `nameFitsWithin` compares. Two names that fit share every word of the shorter, and a
 * name with none fits nothing, so a lookup filed under these words finds every name that could fit
 * a given one among those sharing a word with it.
 */
export const nameFitWords = (name: string): ReadonlySet<string> => nameWords(name);

/**
 * `nameFitsWithin`, remembering what it has read of each name for as long as the fitter is kept.
 *
 * A tidy compares every half of a day against every other that could be its partner, and the same
 * few thousand names come round again and again; reading each one through `teamNameKey` every time
 * was most of the join's cost — nine seconds a pass on a pool of 240,000 games. One fitter per
 * pass, so nothing is kept once the pass is over.
 */
export const nameFitter = (): ((a: string, b: string) => boolean) => {
  const read = new Map<string, NameParts>();
  const parts = (name: string): NameParts => {
    const known = read.get(name);
    if (known) return known;
    const made = partsOf(name);
    read.set(name, made);
    return made;
  };
  return (a, b) => partsFit(parts(a), parts(b));
};

export const normalizeName = teamNameKey;

/**
 * The start of the id of a club made for a league team a person said is not in Team Rankings. No
 * minted id has it: those are the prefix and capitals (`mintScoutTeamIdFrom`).
 */
const OFF_CLUB_PREFIX = `${SCOUT_ID_PREFIX}off-`;

/**
 * `text` in base64url, from its UTF-8: every character of it kept, so two texts are never one, in
 * letters an id can hold.
 */
const base64UrlOf = (text: string): string => {
  let binary = "";
  new TextEncoder().encode(text).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * The club a league team said not to be in Team Rankings is carried onto: one of its own, so its
 * games stay its own rather than land on a club of the same name the person said it is not.
 *
 * The id is read off the name, not minted against the roster, so it is the same on every pass and
 * on every device, and a club saved to the roster once (marking it "our team" saves it) is the same
 * club the next pass carries the team onto, not a second one. Every such team of one name, on any
 * page, is the one club, as a name is one club everywhere else, and two names are two clubs: a name
 * of plain letters, digits and spaces is spelled out ("S-off-cincinnati-angels-red"), and any other
 * ("A.B", an accent, a name in another script, punctuation alone) is spelled as nearly as those
 * letters allow and then written out whole, in base64url, after an underscore, which no name
 * spelled out has. A hash would be shorter, and two names could share one.
 */
export const offClubIdFor = (name: string): string => {
  const key = normalizeName(name);
  const words = key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (words !== "" && words === key.replace(/ /g, "-")) return `${OFF_CLUB_PREFIX}${words}`;
  return `${OFF_CLUB_PREFIX}${words || "team"}_${base64UrlOf(key)}`;
};

/** Whether a club is one made for a league team said not to be in Team Rankings. */
export const isOffClubId = (id: string): boolean => id.startsWith(OFF_CLUB_PREFIX);

/**
 * A team's name key, worked out once for each team object: a team is replaced rather than edited,
 * so the object stands for the version of its name. Looking a league team up by name used to work
 * out the key of every club in the pool on every look, and the League Standings seasons carried
 * onto the page look a dozen teams up on every open: on the 114,500-team pool of 29 September 2026
 * that was most of the 741 ms `allKnown` took, which the first board waits on.
 */
const nameKeyByTeam = new WeakMap<ScoutTeam, string>();
export const nameKeyOf = (team: ScoutTeam): string => {
  let key = nameKeyByTeam.get(team);
  if (key === undefined) {
    key = normalizeName(team.name);
    nameKeyByTeam.set(team, key);
  }
  return key;
};

/**
 * Names that stand in for a team nobody has decided yet: a bracket slot, a rained-out reschedule,
 * a blank cell. Worth flagging on import, because logging one creates a "team" that will collect
 * games belonging to whoever actually turns up.
 */
export const PLACEHOLDER_NAMES = new Set([
  "tbd",
  "tba",
  "tbc",
  "bye",
  "n/a",
  "na",
  "none",
  "unknown",
  "opponent",
  "team",
  "?",
  "??",
  "???",
  "-",
  "--",
]);

/**
 * A name that is the round, not the opponent: "Tournament", "Playoffs", "Bracket Play", "DH". A
 * nationwide pull carried a hundred of these as shared clubs, each one "played" by up to nine
 * unrelated schedules.
 */
const ROUND_WORDS =
  /^(?:tournament|tourney|playoffs?|championships?|bracket(?: play)?|pool play|scrimmage|practice|double ?header|dh|semis?|semi-?finals?|finals?|consolation|elimination)\b/;

/**
 * The same thing with the event's own name in front of it: "USSSA Cactus Classic", "Arkansas Fall
 * Shootout Championship", "Snead Tournament 10/17 - 10/18". `ROUND_WORDS` is anchored, so it only
 * ever caught the bare word, and a schedule almost never writes the bare word — it writes what the
 * organiser called the weekend. Over this app's own nationwide pool that left 2,034 of these
 * standing as clubs, holding 3,145 games between them: 1,302 named "tournament", 422 "classic",
 * 310 "championship". Each is a different weekend written a different way, so each became its own
 * "club", and the rating graph gained two thousand opponents that nobody ever played.
 *
 * A club pulled by its own GameChanger id is exempt wherever this is asked, because a club really
 * can call its travel squad "Miami Bulldogs Tournament" and 74 of them do. That exemption is the
 * whole safety of matching a word in the middle of a name: it is the difference between a name
 * somebody wrote on a schedule and a team somebody pulled.
 */
const EVENT_WORDS = /\b(?:tournament|tourney|championships?|classic)\b/;

export const isPlaceholderName = (name: string): boolean => {
  const raw = name.trim();
  if (!raw) return true;
  // A name that is nothing but an age level names no team. `cleanTeamName` keeps it rather than
  // returning an empty string, so it has to be recognised here.
  if (/^(?:\d{1,2}\s*u|u\s*\d{1,2})$/i.test(raw)) return true;

  // Dots go so "T.B.D." reads as "tbd"; they are punctuation in an abbreviation, not a name.
  const value = cleanTeamName(raw)
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s{2,}/g, " ");
  if (!value) return true;
  if (PLACEHOLDER_NAMES.has(value)) return true;
  if (ROUND_WORDS.test(value)) return true;
  if (EVENT_WORDS.test(value)) return true;
  /**
   * A placeholder rarely arrives on its own. GameChanger writes an undecided bracket slot as
   * "TBD- 08/04/26, 5:00 PM", so the date and the start time are part of the name, and every one
   * of them is a different string — which made them all look like different clubs and put a
   * thousand of them in the rankings. Matching the opening token catches the whole family without
   * having to know what a source will append to it.
   *
   * Only the tokens that name nothing on their own are matched this way. "Bye" and "Team" stay
   * exact matches above, because a real club can begin with either.
   */
  if (/^(tbd|tba|tbc)\b/.test(value)) return true;
  // "To be determined", "Winner of Game 3", "Loser of semifinal" — a slot, not a club.
  return /^(to be (determined|announced)|winner of\b|loser of\b|game \d+|seed \d+)/.test(value);
};
