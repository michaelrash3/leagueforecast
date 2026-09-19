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
 */
import { createTeamId } from "../sim";
import type { ScoutRankingRow, ScoutTeam } from "./types";

/** Prefix guarantees a scout-created id can never collide with a league season's own team ids
 * (those are plain alphanumeric codes from `createTeamId` in sim.ts). */
export const SCOUT_ID_PREFIX = "S-";

/**
 * "9U", "9u", "12 U", "U10" — an age level, anywhere in the name — and the division letters that
 * run straight on from it, as in "9UA" or "11UAA". The letters have to follow with no space, so
 * "12 United" and "9u Scout" keep the word that happens to come next.
 */
const AGE_LABEL = /\b(?:\d{1,2}\s*[uU][A-Da-d]{0,3}|[uU]\s*\d{1,2})\b/g;

/** An innermost bracketed aside, so nesting comes apart a layer at a time. */
const PARENTHETICAL = /\([^()]*\)/;

/**
 * Tidies a team name down to what the club is actually called.
 *
 * Two things come off. The **age label**, because an age level describes *this year's* squad, not
 * the club, and the same club plays up a level every year ("South Lexington Red 9u" becomes
 * "…10u") — keeping it would fragment one real-world team into a new entity every season, which
 * is what the age-group scoping already handles — the division letters on "11UAA" go with it,
 * since they are part of the same label. And anything in **parentheses**, which on a
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
    .replace(AGE_LABEL, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—,]+|[\s\-–—,]+$/g, "");
  // A name that is *only* an age label, or only an aside, still has to be called something.
  return stripped || name.trim();
};

/**
 * The key two names are compared by: age-label-free and case-insensitive. Exported so callers that
 * need to look a name up in the roster (the screenshot importer, for one) match names exactly the
 * way `resolveOrCreateTeam` does, instead of re-deriving the rule.
 */
export const teamNameKey = (name: string) =>
  cleanTeamName(name)
    .toLowerCase()
    // Punctuation between words is spacing, not spelling: "Wheaton Warriors - Grey", "Wheaton
    // Warriors Grey" and "Wheaton Warriors/Grey" are one name written three ways, and a pull
    // reads all three off different schedules. The suffix words themselves stay, so "Frisco
    // Dodgers Gomez" is still not "Frisco Dodgers".
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s*[-\u2013\u2014/]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * The key two GameChanger *listings* are compared by when asking whether they are one squad: the
 * age label off, everything else kept. `teamNameKey` drops a parenthetical because "Heat 9U
 * (Ealey)" and "Heat 9U" are one *club* for an opponent to have played — but they are two squads,
 * and the fold that decides whether two ids are one roster has to see the difference.
 */
export const squadNameKey = (listingName: string): string =>
  listingName
    .replace(AGE_LABEL, " ")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s*[-\u2013\u2014/]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();

const normalizeName = teamNameKey;

/**
 * Case-insensitive, age-label-insensitive name match against the pool; creates a new team if none
 * matches. A team stored before age labels were stripped ("Velocirabbits 9U") is healed in place on
 * its next match, so old entries converge without a migration.
 */
export const resolveOrCreateTeam = (
  name: string,
  teams: ScoutTeam[]
): { teams: ScoutTeam[]; teamId: string } => {
  const display = cleanTeamName(name);
  const key = normalizeName(name);
  // A placeholder names nobody, so two of them are not the same team and must never be matched
  // onto one another. Each gets a slot of its own, marked as one.
  if (isPlaceholderName(name)) {
    const minted = mintScoutTeamId(display, teams);
    return {
      teams: [...teams, { id: minted, name: display, placeholder: true }],
      teamId: minted,
    };
  }
  const existingIndex = teams.findIndex(
    (team) => !team.placeholder && normalizeName(team.name) === key
  );

  if (existingIndex >= 0) {
    const existing = teams[existingIndex]!;
    // Clean the *stored* name rather than adopting the incoming one, so its capitalization stands.
    const cleaned = cleanTeamName(existing.name);
    if (cleaned === existing.name) return { teams, teamId: existing.id };
    const next = teams.slice();
    next[existingIndex] = { ...existing, name: cleaned };
    return { teams: next, teamId: existing.id };
  }

  const uniqueId = mintScoutTeamId(display, teams);
  return { teams: [...teams, { id: uniqueId, name: display }], teamId: uniqueId };
};

/**
 * A fresh scout id for this name that none of `existingIds` already has.
 *
 * Taking the set rather than the roster matters when thousands of teams are created in one pass:
 * rebuilding it from the roster each time is what made a large import quadratic. A caller that
 * keeps its own set hands it in and the minting is constant.
 */
const mintScoutTeamIdFrom = (display: string, existingIds: ReadonlySet<string>): string => {
  const id = `${SCOUT_ID_PREFIX}${createTeamId(display, new Set())}`;
  let uniqueId = id;
  let counter = 2;
  while (existingIds.has(uniqueId)) {
    uniqueId = `${id}${counter}`;
    counter += 1;
  }
  return uniqueId;
};

/** A fresh scout id for this name that no team in the pool already has. */
const mintScoutTeamId = (display: string, teams: ScoutTeam[]): string =>
  mintScoutTeamIdFrom(display, new Set(teams.map((team) => team.id)));

/**
 * Creates a team without looking for one by name first. The GameChanger importer decides identity
 * itself — a team pulled by id *is* that id, and a name-only opponent is only ever matched after
 * the level and year have been checked — so it needs a way to add a team that will not quietly
 * fold "Yankees" into whichever other Yankees was stored first. Same id minting and age-label
 * stripping as `resolveOrCreateTeam`, so the two produce indistinguishable teams. `extras` fills
 * the optional fields (state, city, links); the id and name always come from here, and an
 * undefined extra adds no key, so a caller can pass what it has without checking each field.
 */
export const createScoutTeam = (
  name: string,
  teams: ScoutTeam[],
  extras: Partial<ScoutTeam> = {}
): { teams: ScoutTeam[]; teamId: string; team: ScoutTeam } => {
  const team = buildScoutTeam(name, new Set(teams.map((entry) => entry.id)), extras);
  return { teams: [...teams, team], teamId: team.id, team };
};

/**
 * The team `createScoutTeam` would make, without building a new roster to hold it. For a caller
 * adding thousands in one pass, which cannot afford a copy of the roster per team; the two share
 * this so the teams they produce stay indistinguishable.
 */
export const buildScoutTeam = (
  name: string,
  existingIds: ReadonlySet<string>,
  extras: Partial<ScoutTeam> = {}
): ScoutTeam => {
  const display = cleanTeamName(name).trim();
  const team: ScoutTeam = { id: mintScoutTeamIdFrom(display, existingIds), name: display };
  (Object.keys(extras) as (keyof ScoutTeam)[]).forEach((key) => {
    if (key === "id" || key === "name") return;
    const value = extras[key];
    if (value !== undefined) Object.assign(team, { [key]: value });
  });
  return team;
};
/**
 * Names that stand in for a team nobody has decided yet: a bracket slot, a rained-out reschedule,
 * a blank cell. Worth flagging on import, because logging one creates a "team" that will collect
 * games belonging to whoever actually turns up.
 */
const PLACEHOLDER_NAMES = new Set([
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

/** Levenshtein distance, capped short-circuit free — names here are at most a line long. */
const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const row = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((row[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = row[j] ?? 0;
  }
  return prev[b.length] ?? 0;
};

/**
 * The team this name was probably meant to be, when it is close to one already known but not the
 * same. Returns nothing for an exact match — that is not a near miss, it is the team.
 *
 * Two kinds of "close" matter here, and they are different mistakes. One name containing the other
 * is usually a suffix nobody agreed on ("NV Stars" against "NV Stars Scout"). A small edit distance
 * is a typo. Both are offered as a suggestion and never applied automatically, because
 * "South Lexington Red" and "South Lexington Blue" are two real teams four characters apart.
 */
export const findSimilarTeam = (name: string, teams: ScoutTeam[]): ScoutTeam | null => {
  const key = teamNameKey(name);
  if (key.length < 4 || isPlaceholderName(name)) return null;

  let best: { team: ScoutTeam; score: number } | null = null;
  teams.forEach((team) => {
    const other = teamNameKey(team.name);
    if (other === key || other.length < 4) return;

    const contains = other.startsWith(key) || key.startsWith(other);
    const distance = editDistance(key, other);
    const ratio = 1 - distance / Math.max(key.length, other.length);
    // A shared prefix is strong evidence; otherwise the names have to be nearly identical.
    const score = contains ? Math.max(ratio, 0.9) : ratio;
    // 0.82 admits a two-edit typo in a twelve-character name. It deliberately stops short of
    // "South Lexington Red" against "…Blue", which lands at 0.80 and is two real teams.
    if (score < 0.82) return;
    if (!best || score > best.score) best = { team, score };
  });

  return best ? (best as { team: ScoutTeam }).team : null;
};

/** Two letters, uppercased. Anything else is not a state and is stored as no state at all. */
export const normalizeState = (value: string): string | undefined => {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : undefined;
};

/**
 * The states represented among these teams, alphabetically. Drives the filter's options, so it
 * only ever offers a state that some team on the table actually has.
 */
export const statesInUse = (teams: ScoutTeam[]): string[] =>
  [
    ...new Set(teams.map((team) => team.state).filter((state): state is string => Boolean(state))),
  ].sort();

/**
 * Narrows a ranking to one state, or to the teams whose state is unknown.
 *
 * Filtering is presentational — the ratings themselves are computed from every game, because a
 * team's strength does not change based on which rows you are looking at. Ranks are renumbered so
 * a filtered table reads 1, 2, 3 rather than 4, 9, 12; each row keeps `overallRank` so the
 * position in the full table is still there to show.
 */
export const filterRankingsByState = (
  rows: ScoutRankingRow[],
  teams: ScoutTeam[],
  state: string
): ScoutRankingRow[] => {
  if (!state) return rows;
  const stateById = new Map(teams.map((team) => [team.id, team.state]));
  const matches = (id: string) =>
    state === UNKNOWN_STATE ? !stateById.get(id) : stateById.get(id) === state;

  return rows
    .filter((row) => matches(row.teamId))
    .map((row, index) => ({ ...row, overallRank: row.rank, rank: index + 1 }));
};

/** Filter value for "teams I have not given a state to". */
export const UNKNOWN_STATE = "__unknown__";
