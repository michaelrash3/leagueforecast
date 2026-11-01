/**
 * The roster's names: finding the club a name is, or making one (`resolveOrCreateTeam`,
 * `teamResolver`), the slots that name nobody, the near-match warning, and the states clubs are in.
 *
 * Split out of `names.ts`, whose keys and cleaning League Standings reads as it starts, because only
 * Team Rankings, and League Standings' own schedule paste and Fill once opened, run these: the
 * first download carried them. `teamRankings.ts` re-exports this, as it does `names.ts`.
 */
import type { ScoutRankingRow, ScoutTeam } from "./types";
import {
  mintedIds,
  type MintedIds,
  NO_RETIRED,
  type RetiredIds,
  type TakenIds,
} from "./retiredIds";
import { createTeamId } from "../sim";
import {
  cleanTeamName,
  isOffClubId,
  isPlaceholderName,
  nameKeyOf,
  normalizeName,
  PLACEHOLDER_NAMES,
  SCOUT_ID_PREFIX,
  teamNameKey,
} from "./names";

/**
 * Case-insensitive, age-label-insensitive name match against the pool; creates a new team if none
 * matches. A team stored before age labels were stripped ("Velocirabbits 9U") is healed in place on
 * its next match, so old entries converge without a migration.
 *
 * `ids`, where a caller looking many names up in one pass keeps it, is every id `teams` holds, and
 * a team made here is added to it: without it, each new team counts the whole pool's ids again. A
 * caller minting into a stored pool hands in its ids let go of with them (`mintedIds`).
 *
 * A club made for a league team said not to be in Team Rankings (`offClubIdFor`) carries that
 * team's name and is never found by it: it is that team's alone. Nor is `not`, the club in the
 * place of a league team's pick that moved (`readPick`), which is another club of the name.
 */
export const resolveOrCreateTeam = (
  name: string,
  teams: ScoutTeam[],
  ids?: MintedIds,
  not?: string
): { teams: ScoutTeam[]; teamId: string } => {
  const display = cleanTeamName(name);
  const key = normalizeName(name);
  const mint = (): string => {
    if (!ids) return mintScoutTeamId(display, teams);
    const minted = mintScoutTeamIdFrom(display, ids);
    ids.add(minted);
    return minted;
  };
  // A placeholder names nobody, so two of them are not the same team and must never be matched
  // onto one another. Each gets a slot of its own, marked as one.
  if (isPlaceholderName(name)) {
    const minted = mint();
    return {
      teams: [...teams, { id: minted, name: display, placeholder: true }],
      teamId: minted,
    };
  }
  const existingIndex = teams.findIndex(
    (team) =>
      !team.placeholder && !isOffClubId(team.id) && team.id !== not && nameKeyOf(team) === key
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

  const uniqueId = mint();
  return { teams: [...teams, { id: uniqueId, name: display }], teamId: uniqueId };
};

/**
 * `resolveOrCreateTeam` for many names, one after another against the roster as each leaves it,
 * as a pasted schedule's are: the same clubs found, tidied and made, with the same ids, but each
 * name found by its key in an index made once, where `resolveOrCreateTeam` walks the roster for it.
 * On a nationwide roster the walk made 500 rows of new names 44 seconds (measured in the 1.6d
 * review), most of the edit function's minute. The index stays true as names are tidied, since a
 * name is found by the key of its tidied self and tidying a tidied name changes nothing (none of
 * the 116,485 names of 29 September 2026 moved).
 *
 * `fillState` fills in a club's state where it has none, as a file's state is. `teams` is the
 * roster as it now stands: the one handed over, where nothing on it changed. A club made is minted
 * under no id the stored pool let go of (`retired`).
 */
export const teamResolver = (teams: ScoutTeam[], retired: RetiredIds = NO_RETIRED) => {
  const pool = teams.slice();
  let changed = false;
  const ids = mintedIds([], retired);
  const placesById = new Map<string, number[]>();
  const placeByKey = new Map<string, number>();
  pool.forEach((team, place) => {
    ids.add(team.id);
    const same = placesById.get(team.id);
    if (same) same.push(place);
    else placesById.set(team.id, [place]);
    // As `resolveOrCreateTeam` passes them over: a slot, and a club only a league team names.
    if (team.placeholder || isOffClubId(team.id)) return;
    const key = nameKeyOf(team);
    if (!placeByKey.has(key)) placeByKey.set(key, place);
  });
  const add = (team: ScoutTeam): string => {
    ids.add(team.id);
    placesById.set(team.id, [pool.length]);
    pool.push(team);
    changed = true;
    return team.id;
  };
  const resolve = (name: string): string => {
    const display = cleanTeamName(name);
    if (isPlaceholderName(name))
      return add({ id: mintScoutTeamIdFrom(display, ids), name: display, placeholder: true });
    const key = normalizeName(name);
    const place = placeByKey.get(key);
    const existing = place === undefined ? undefined : pool[place];
    if (place === undefined || !existing) {
      placeByKey.set(key, pool.length);
      return add({ id: mintScoutTeamIdFrom(display, ids), name: display });
    }
    const cleaned = cleanTeamName(existing.name);
    if (cleaned !== existing.name) {
      pool[place] = { ...existing, name: cleaned };
      changed = true;
    }
    return existing.id;
  };
  const fillState = (teamId: string, state: string | undefined) => {
    if (!state) return;
    for (const place of placesById.get(teamId) ?? []) {
      const team = pool[place];
      if (team && !team.state) {
        pool[place] = { ...team, state };
        changed = true;
      }
    }
  };
  return { resolve, fillState, teams: (): ScoutTeam[] => (changed ? pool : teams) };
};

/**
 * A fresh scout id for this name that none of `existingIds` already has.
 *
 * Taking the set rather than the roster matters when thousands of teams are created in one pass:
 * rebuilding it from the roster each time is what made a large import quadratic. A caller that
 * keeps its own set hands it in and the minting is constant. Anything that says whether an id is
 * taken will do, so a caller holding the ids its pool let go of hands those in too (`withRetired`):
 * against the roster alone, a club folded or deleted gave its id to the next club of its letters.
 */
const mintScoutTeamIdFrom = (display: string, existingIds: TakenIds): string => {
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
  existingIds: TakenIds,
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

/** The round words `ROUND_WORDS` starts on, as a whole name and nothing more. */
const WHOLE_ROUND =
  /^(?:tournament|tourney|playoffs?|championships?|bracket(?: play)?|pool play|scrimmage|practice|double ?header|dh|semis?|semi-?finals?|finals?|consolation|elimination)$/;

/**
 * A name that is a slot and could not be anything else: the whole of it a slot word, a round, an
 * age, or "TBD" with nothing after it but when.
 *
 * Narrower than `isPlaceholderName` on purpose. That reads a name as a slot, and then lets the one
 * pulled club carrying the name have it, because a club really can call its squad "Miami Bulldogs
 * Tournament", "TBC" is Tampa Bay Cobras and "Game 7 Sports" is a club. These cannot be. GameChanger
 * does hold teams called "Tbd", "Practice", "Scrimmage" and "14U" — a coach's way of holding a date
 * — and a nationwide pull fetches them like any other. Filed on one, every undecided game in the
 * country joins one club: a Puerto Rico club's and an Ohio club's "TBD" sat on a Washington "Tbd".
 * On the backup of 26 September 2026 at 18:40 there were 31 of them, holding 35 rows other clubs'
 * schedules had filed on them. Their own schedules are left alone here; a name like this only ever
 * names a slot on somebody else's. A pulled "Practice" or "Scrimmage" is no team at all, and the
 * tidy deletes it before this is asked (`dropNotATeam`), unless the owner keeps it.
 */
export const namesNobody = (name: string): boolean => {
  const raw = name.trim();
  if (!raw) return true;
  if (/^(?:\d{1,2}\s*u|u\s*\d{1,2})$/i.test(raw)) return true;
  const value = cleanTeamName(raw)
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s{2,}/g, " ");
  if (!value) return true;
  if (PLACEHOLDER_NAMES.has(value) && value !== "tbc") return true;
  if (WHOLE_ROUND.test(value)) return true;
  // "TBD- 08/04/26, 5:00 PM": the slot and when it is, which is all GameChanger appends to one.
  if (/^(?:tbd|tba)\b[\s\d/:,@–-]*(?:[ap]\.?m\.?)?[\s\d/:,@–-]*$/.test(value)) return true;
  return /^(?:to be (?:determined|announced)|winner of\b|loser of\b)/.test(value);
};

/**
 * A name listed as "TBD": the opponent nobody knew when the game went on the schedule, with
 * whatever a source appends to it, as GameChanger does the date and start ("TBD- 08/29/26, 3:00
 * PM").
 *
 * A game against a slot of this name counts only as the game another team's schedule holds at that
 * date and time, and otherwise not at all (`markTbdGames`). Narrower than `isPlaceholderName`
 * because the owner, setting that rule on 26 October 2026, held it to "Placeholder games listed as
 * TBD": "TBA" and "TBC" can be a club's initials ("TBC" is Tampa Bay Cobras), and a bracket slot
 * such as "Winner of Game 3" is not one.
 */
export const namesTbd = (name: string): boolean =>
  /^(?:tbd|to be determined)\b/.test(cleanTeamName(name).trim().toLowerCase().replace(/\./g, ""));

/** The rows `editDistanceWithin` works in, kept between calls: it is called for most of a roster. */
let distanceRows: [Int32Array, Int32Array] = [new Int32Array(64), new Int32Array(64)];

/**
 * The Levenshtein distance of `a` and `b` where it is at most `cap`, and `cap + 1` where it is more.
 * Only the cells within `cap` of the diagonal are worked out, since any other is further than `cap`
 * already; and every way from the start of the table to its end crosses each row, so once a whole
 * row is past `cap` the distance is too, and the rest is not worked out. Against a nationwide
 * roster nearly every name is far from the one asked about, and is found to be within a few rows.
 */
const editDistanceWithin = (a: string, b: string, cap: number): number => {
  const far = cap + 1;
  if (Math.abs(a.length - b.length) > cap) return far;
  if (distanceRows[0].length <= b.length)
    distanceRows = [new Int32Array(b.length + 1), new Int32Array(b.length + 1)];
  let [prev, row] = distanceRows;
  for (let j = 0; j <= b.length; j += 1) prev[j] = Math.min(j, far);
  for (let i = 1; i <= a.length; i += 1) {
    const from = Math.max(1, i - cap);
    const to = Math.min(b.length, i + cap);
    // The cell before the band: the first column's, or one too far from the diagonal to matter.
    row[from - 1] = from === 1 ? Math.min(i, far) : far;
    let least = row[from - 1] ?? far;
    const letter = a.charCodeAt(i - 1);
    for (let j = from; j <= to; j += 1) {
      let cell = (prev[j - 1] ?? far) + (letter === b.charCodeAt(j - 1) ? 0 : 1);
      cell = Math.min(cell, (prev[j] ?? far) + 1, (row[j - 1] ?? far) + 1, far);
      row[j] = cell;
      if (cell < least) least = cell;
    }
    // The cell after the band, which the next row reads above it.
    if (to < b.length) row[to + 1] = far;
    if (least > cap) return far;
    [prev, row] = [row, prev];
  }
  return Math.min(prev[b.length] ?? far, far);
};

/** How close a name must come to be offered (`findSimilarTeam`). */
const SIMILAR_AT = 0.82;

/**
 * A roster's name keys as `findSimilarTeam` looks through them: each key once, with the first club
 * to carry it and that club's place, since clubs of one key are equally close to any name and the
 * first of the closest is the one offered; the keys by length, since a name further in length than
 * a near miss can be is never one; and in order, so the keys a name begins lie together.
 */
type SimilarIndex = {
  first: Map<string, { team: ScoutTeam; at: number }>;
  byLength: Map<number, string[]>;
  sorted: string[];
};

const similarIndexOf = new WeakMap<readonly ScoutTeam[], SimilarIndex>();

const similarIndex = (teams: readonly ScoutTeam[]): SimilarIndex => {
  const held = similarIndexOf.get(teams);
  if (held) return held;
  const first = new Map<string, { team: ScoutTeam; at: number }>();
  const byLength = new Map<number, string[]>();
  teams.forEach((team, at) => {
    const key = nameKeyOf(team);
    if (key.length < 4 || first.has(key)) return;
    first.set(key, { team, at });
    const same = byLength.get(key.length);
    if (same) same.push(key);
    else byLength.set(key.length, [key]);
  });
  const made = { first, byLength, sorted: [...first.keys()].sort() };
  similarIndexOf.set(teams, made);
  return made;
};

/**
 * The team this name was probably meant to be, when it is close to one already known but not the
 * same. Returns nothing for an exact match — that is not a near miss, it is the team.
 *
 * Two kinds of "close" matter here, and they are different mistakes. One name containing the other
 * is usually a suffix nobody agreed on ("NV Stars" against "NV Stars Scout"). A small edit distance
 * is a typo. Both are offered as a suggestion and never applied automatically, because
 * "South Lexington Red" and "South Lexington Blue" are two real teams four characters apart.
 *
 * Asked of every name a pasted schedule carries, against the cloud's nationwide roster (1.6d), so
 * the roster is indexed once (`similarIndex`, kept for as long as the roster is): a name that
 * begins another is as many edits from it as the letters past it, and a typo is looked for only
 * among names near enough in length, and only as far as it could still come close. On the 116,485
 * clubs of 29 September 2026 that took a name from 397 ms to 6.7, the same club named for each of
 * 80 names compared; `similarTeam.test.ts` holds it to the answers it gave before, name for name.
 */
export const findSimilarTeam = (name: string, teams: ScoutTeam[]): ScoutTeam | null => {
  const key = teamNameKey(name);
  if (key.length < 4 || isPlaceholderName(name)) return null;
  const { first, byLength, sorted } = similarIndex(teams);

  let best: { team: ScoutTeam; at: number; score: number } | null = null;
  const consider = (other: string, distance: number, contains: boolean) => {
    const found = first.get(other);
    if (!found) return;
    const ratio = 1 - distance / Math.max(key.length, other.length);
    // A shared prefix is strong evidence; otherwise the names have to be nearly identical.
    const score = contains ? Math.max(ratio, 0.9) : ratio;
    // 0.82 admits a two-edit typo in a twelve-character name. It deliberately stops short of
    // "South Lexington Red" against "…Blue", which lands at 0.80 and is two real teams.
    if (score < SIMILAR_AT) return;
    // The closest, and of those the first on the roster, as a walk down it in order would keep.
    if (!best || score > best.score || (score === best.score && found.at < best.at))
      best = { ...found, score };
  };

  // Names this one begins, and names that begin it: as far as the letters past them.
  for (let length = 4; length < key.length; length += 1)
    consider(key.slice(0, length), key.length - length, true);
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? "") < key) low = middle + 1;
    else high = middle;
  }
  for (let at = low; at < sorted.length; at += 1) {
    const other = sorted[at] ?? "";
    if (!other.startsWith(key)) break;
    if (other !== key) consider(other, other.length - key.length, true);
  }
  // Typos: past this many edits a name is well short of close, whatever its length.
  byLength.forEach((others, length) => {
    const cap = Math.floor((1 - SIMILAR_AT) * Math.max(key.length, length)) + 1;
    if (Math.abs(length - key.length) > cap) return;
    for (const other of others) {
      if (other === key || other.startsWith(key) || key.startsWith(other)) continue;
      const distance = editDistanceWithin(key, other, cap);
      if (distance <= cap) consider(other, distance, false);
    }
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
export const statesInUse = <T extends Pick<ScoutTeam, "id" | "state">>(
  teams: readonly T[]
): string[] =>
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
  teams: ReadonlyArray<Pick<ScoutTeam, "id" | "state">>,
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

/** Words a schedule adds to or drops from a club's name that say nothing about which club it is. */
const FILLER = new Set([
  "baseball",
  "bb",
  "bsb",
  "bc",
  "club",
  "the",
  "travel",
  "team",
  "org",
  "organization",
]);

/**
 * A name read loosely, for measuring how many stand-ins a looser match would join: `teamNameKey`,
 * then "Saint" and "St. Louis" as "st" and "stl", full stops, commas, apostrophes and ampersands as
 * spacing, the filler words out (`FILLER`), and no spaces at all. A colour, a coach or a sponsor
 * stays, so "KC Crushers Black" is still not "KC Crushers".
 */
export const looseNameKey = (name: string): string =>
  teamNameKey(name)
    .replace(/\bsaint\b/g, "st")
    .replace(/\bst\.?\s*louis\b/g, "stl")
    .replace(/[.,'&]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !FILLER.has(word))
    .join("");
