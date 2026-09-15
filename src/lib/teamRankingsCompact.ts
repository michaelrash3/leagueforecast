/**
 * How the Team Rankings pool is written to storage.
 *
 * The pool used to be stored as the objects it is in memory, which is readable and, at the size a
 * GameChanger pull reaches, far too big: a single game costs about three hundred bytes, of which
 * two thirds are the field names repeated on every row and the same handful of ids spelled out
 * again and again. Four thousand teams came to fourteen megabytes, and browsers give a site about
 * five to ten.
 *
 * So rows become tuples and anything repeated becomes a dictionary index. A game that read
 *
 *     {"id":"gc_gcTEAM12_0-1-0","teamAId":"S-CLUB2",…,"source":{"kind":"gamechanger",…}}
 *
 * is written as
 *
 *     [2,3,5,3,0,212,0,9,9,0,0,"0-1-0"]
 *
 * which is the same game in about a seventh of the space. Nothing about the in-memory shape
 * changes: `loadScoutGames` hands back the same `ScoutGame[]` it always did, and everything above
 * storage is unaware this happened.
 *
 * The old format still loads. A stored value that is an array is the pool as it was written
 * before this existed, and is read as such; the next save writes it compactly.
 */

import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "./teamRankings";

/** Bumped when the tuple layout changes in a way an older reader would misread. */
export const COMPACT_VERSION = 2;

/** Day zero for stored dates. Every date in this app is a season date, so this is comfortably early. */
const DATE_EPOCH = Date.UTC(2020, 0, 1);
const MS_PER_DAY = 86_400_000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" as days since the epoch; `null` when it is not a plain date. */
export const encodeDate = (date: string | undefined): number | null => {
  if (!date) return null;
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - DATE_EPOCH) / MS_PER_DAY);
};

/**
 * Back to a date. A day number the calendar cannot represent — a corrupt or absurd value — is no
 * date rather than the string "NaN-NaN-NaN", which would otherwise be written straight back out
 * and stored as though it meant something.
 *
 * A string comes back as it is: `encodeDate` keeps a date it cannot read as the text it was, so
 * that a date in a shape nobody anticipated survives being stored rather than being dropped.
 */
export const decodeDate = (day: unknown): string | undefined => {
  if (typeof day === "string") return day || undefined;
  if (typeof day !== "number" || !Number.isFinite(day)) return undefined;
  const date = new Date(DATE_EPOCH + day * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
};

/** Builds a dictionary as values are met, returning each one's index. */
const interner = () => {
  const values: string[] = [];
  const seen = new Map<string, number>();
  return {
    values,
    index(value: string | undefined): number | null {
      if (value === undefined || value === "") return null;
      const known = seen.get(value);
      if (known !== undefined) return known;
      const next = values.length;
      values.push(value);
      seen.set(value, next);
      return next;
    },
  };
};

const at = (values: unknown, index: unknown): string | undefined => {
  if (!Array.isArray(values) || typeof index !== "number") return undefined;
  const value: unknown = values[index];
  return typeof value === "string" ? value : undefined;
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** The one flag a game carries that is neither a number nor a name. */
const EXCLUDED = 1;

/**
 * A game as stored. Fixed positions, trailing nothings trimmed off the end — most games are a
 * pair, a pair of scores, a page and a date, so most rows stop after six entries.
 *
 * 0 team A     1 team B      2 score A    3 score B     4 age group   5 date (a day number,
 *                                                                        or the raw text when it
 *                                                                        is not a plain date)
 * 6 flags      7 level A     8 level B    9 season     10 source team 11 source game
 * 12 event    13 note       14 id (only when it cannot be rebuilt from the source)
 * 15 start time (the instant the source gave, when it gave one)
 *
 * Positions are only ever appended to. An older file simply stops earlier, and every reader below
 * treats a missing position as the field being absent, so a pool written before a position existed
 * still reads.
 */
type GameRow = (number | string | null)[];

export type CompactPool = {
  v: number;
  /** Team ids, in the order first met. */
  t: string[];
  /** Age group ids. */
  g: string[];
  /** Season labels, as in "Fall 2026". */
  s: string[];
  /** GameChanger team ids that sourced a game. */
  c: string[];
  /** Event names. */
  e: string[];
  r: GameRow[];
};

/** The id a GameChanger-sourced game is given, so it need not be stored alongside its source. */
const derivedId = (gcTeamId: string, gameId: string): string => `gc_${gcTeamId}_${gameId}`;

/** Drops the nothings off the end of a row; most rows stop well before their last position. */
const trimTrailing = <T>(row: T[]): T[] => {
  let end = row.length;
  while (end > 0 && (row[end - 1] === null || row[end - 1] === undefined)) end -= 1;
  return row.slice(0, end);
};

export const encodeScoutGames = (games: ScoutGame[]): CompactPool => {
  const teams = interner();
  const groups = interner();
  const seasons = interner();
  const sources = interner();
  const events = interner();

  const rows = games.map((game): GameRow => {
    const sourceTeam = game.source?.teamId;
    const sourceGame = game.source?.gameId;
    const canDerive =
      sourceTeam !== undefined &&
      sourceGame !== undefined &&
      game.id === derivedId(sourceTeam, sourceGame);

    return trimTrailing([
      teams.index(game.teamAId) ?? -1,
      teams.index(game.teamBId) ?? -1,
      game.teamAScore ?? null,
      game.teamBScore ?? null,
      groups.index(game.ageGroupId) ?? -1,
      // A date this cannot read is kept as the text it was, not thrown away.
      encodeDate(game.date) ?? game.date ?? null,
      game.excluded ? EXCLUDED : 0,
      game.ageLevelA ?? null,
      game.ageLevelB ?? null,
      seasons.index(game.season),
      sourceTeam === undefined ? null : sources.index(sourceTeam),
      sourceGame ?? null,
      events.index(game.event),
      game.note ?? null,
      canDerive ? null : game.id,
      game.startTs ?? null,
    ]);
  });

  return {
    v: COMPACT_VERSION,
    t: teams.values,
    g: groups.values,
    s: seasons.values,
    c: sources.values,
    e: events.values,
    r: rows,
  };
};

/**
 * Reads a row back. A row that has lost the things a game cannot do without — either team, or the
 * page it belongs to — is dropped rather than guessed at, the same way the coercers elsewhere drop
 * a record they cannot vouch for.
 */
const decodeRow = (row: unknown, pool: CompactPool, fallbackIndex: number): ScoutGame | null => {
  if (!Array.isArray(row)) return null;
  const teamAId = at(pool.t, row[0]);
  const teamBId = at(pool.t, row[1]);
  const ageGroupId = at(pool.g, row[4]);
  if (!teamAId || !teamBId || !ageGroupId) return null;

  const sourceTeam = at(pool.c, row[10]);
  const sourceGame = str(row[11]);
  const storedId = str(row[14]);
  const id =
    storedId ??
    (sourceTeam && sourceGame
      ? derivedId(sourceTeam, sourceGame)
      : `sg_${fallbackIndex}_${teamAId}_${teamBId}`);

  const game: ScoutGame = { id, teamAId, teamBId, ageGroupId };

  const scoreA = num(row[2]);
  const scoreB = num(row[3]);
  if (scoreA !== undefined) game.teamAScore = scoreA;
  if (scoreB !== undefined) game.teamBScore = scoreB;

  const date = decodeDate(row[5]);
  if (date) game.date = date;

  const flags = num(row[6]) ?? 0;
  if (flags & EXCLUDED) game.excluded = true;

  const levelA = num(row[7]);
  const levelB = num(row[8]);
  if (levelA !== undefined) game.ageLevelA = levelA;
  if (levelB !== undefined) game.ageLevelB = levelB;

  const season = at(pool.s, row[9]);
  if (season) game.season = season;

  const event = at(pool.e, row[12]);
  if (event) game.event = event;

  const note = str(row[13]);
  if (note) game.note = note;

  const startTs = str(row[15]);
  if (startTs) game.startTs = startTs;

  if (sourceTeam && sourceGame) {
    game.source = { kind: "gamechanger", teamId: sourceTeam, gameId: sourceGame };
  }

  return game;
};

const isCompactPool = (value: unknown): value is CompactPool =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Array.isArray((value as CompactPool).r);

/** A stored pool, whichever way it was written. An unreadable value reads as no games at all. */
export const decodeScoutGames = (
  raw: unknown,
  readLegacy: (raw: unknown) => ScoutGame[]
): ScoutGame[] => {
  // Written before this format existed: the objects themselves, in an array.
  if (Array.isArray(raw)) return readLegacy(raw);
  if (!isCompactPool(raw)) return [];

  const pool: CompactPool = {
    v: typeof raw.v === "number" ? raw.v : COMPACT_VERSION,
    t: Array.isArray(raw.t) ? raw.t : [],
    g: Array.isArray(raw.g) ? raw.g : [],
    s: Array.isArray(raw.s) ? raw.s : [],
    c: Array.isArray(raw.c) ? raw.c : [],
    e: Array.isArray(raw.e) ? raw.e : [],
    r: raw.r,
  };

  const games: ScoutGame[] = [];
  pool.r.forEach((row, index) => {
    const game = decodeRow(row, pool, index);
    if (game) games.push(game);
  });
  return games;
};

// ---------- Teams ----------

/**
 * Teams compress less dramatically — there are far fewer of them, and a name is a name — but the
 * GameChanger links on a pulled team are as repetitive as the games were, so they get the same
 * treatment. Age group ids and season names are the repeated parts.
 */
export type CompactTeams = {
  v: number;
  g: string[];
  s: string[];
  /** 0 id, 1 name, 2 flags, 3 state, 4 city, 5 links, 6 avatar */
  r: TeamRow[];
};

type TeamRow = (number | string | null | CompactLink[])[];

/** 0 gc id, 1 name, 2 age group, 3 season, 4 season year, 5 age level, 6 avatar, 7 w, 8 l, 9 t, 10 importedAt */
type CompactLink = (number | string | null)[];

const MINE = 1;
/** A name that stood in for a club nobody had decided yet; never a team, never ranked. */
const PLACEHOLDER = 2;
/** Known only from somebody else's schedule: in the fit as an opponent, never in a table. */
const NAME_ONLY = 4;

export const encodeScoutTeams = (teams: ScoutTeam[]): CompactTeams => {
  const groups = interner();
  const seasons = interner();

  const rows = teams.map((team) => {
    const links: CompactLink[] = (team.gcTeams ?? []).map((link) =>
      trimTrailing([
        link.teamId,
        link.name,
        groups.index(link.ageGroupId) ?? -1,
        seasons.index(link.season),
        link.seasonYear ?? null,
        link.ageLevel ?? null,
        link.avatarKey ?? null,
        link.record?.win ?? null,
        link.record?.loss ?? null,
        link.record?.tie ?? null,
        link.importedAt ?? null,
      ])
    );
    const row: TeamRow = [
      team.id,
      team.name,
      (team.isMine ? MINE : 0) |
        (team.placeholder ? PLACEHOLDER : 0) |
        (team.nameOnly ? NAME_ONLY : 0),
      team.state ?? null,
      team.city ?? null,
      links.length ? links : null,
      team.avatarKey ?? null,
    ];
    return trimTrailing(row);
  });

  return { v: COMPACT_VERSION, g: groups.values, s: seasons.values, r: rows };
};

const decodeLink = (row: unknown, pool: CompactTeams): GcTeamLink | null => {
  if (!Array.isArray(row)) return null;
  const teamId = str(row[0]);
  // As above: a link's name is whatever GameChanger called it, empty included.
  const name = typeof row[1] === "string" ? row[1] : undefined;
  const ageGroupId = at(pool.g, row[2]);
  if (!teamId || name === undefined || !ageGroupId) return null;

  const link: GcTeamLink = { teamId, name, ageGroupId };
  const season = at(pool.s, row[3]);
  if (season) link.season = season;
  const seasonYear = num(row[4]);
  if (seasonYear !== undefined) link.seasonYear = seasonYear;
  const ageLevel = num(row[5]);
  if (ageLevel !== undefined) link.ageLevel = ageLevel;
  const avatarKey = str(row[6]);
  if (avatarKey) link.avatarKey = avatarKey;
  const win = num(row[7]);
  const loss = num(row[8]);
  const tie = num(row[9]);
  if (win !== undefined && loss !== undefined && tie !== undefined) {
    link.record = { win, loss, tie };
  }
  const importedAt = str(row[10]);
  if (importedAt) link.importedAt = importedAt;
  return link;
};

export const decodeScoutTeams = (
  raw: unknown,
  readLegacy: (raw: unknown) => ScoutTeam[]
): ScoutTeam[] => {
  if (Array.isArray(raw)) return readLegacy(raw);
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as CompactTeams).r)) {
    return [];
  }
  const source = raw as CompactTeams;
  const pool: CompactTeams = {
    v: typeof source.v === "number" ? source.v : COMPACT_VERSION,
    g: Array.isArray(source.g) ? source.g : [],
    s: Array.isArray(source.s) ? source.s : [],
    r: source.r,
  };

  const teams: ScoutTeam[] = [];
  pool.r.forEach((row) => {
    if (!Array.isArray(row)) return;
    const id = str(row[0]);
    // The name may legitimately be empty — `cleanTeamName` leaves nothing behind for a team called
    // only "9U" — and dropping the team for that would lose it and every game pointing at it. An
    // id is the one thing a team cannot do without.
    const name = typeof row[1] === "string" ? row[1] : undefined;
    if (!id || name === undefined) return;

    const team: ScoutTeam = { id, name };
    const flags = num(row[2]) ?? 0;
    if (flags & MINE) team.isMine = true;
    if (flags & PLACEHOLDER) team.placeholder = true;
    if (flags & NAME_ONLY) team.nameOnly = true;
    const state = str(row[3]);
    if (state) team.state = state;
    const city = str(row[4]);
    if (city) team.city = city;

    const avatarKey = str(row[6]);
    if (avatarKey) team.avatarKey = avatarKey;

    const linkRows = row[5];
    if (Array.isArray(linkRows)) {
      const links = linkRows
        .map((link) => decodeLink(link, pool))
        .filter((link): link is GcTeamLink => link !== null);
      if (links.length) team.gcTeams = links;
    }
    teams.push(team);
  });
  return teams;
};

/**
 * Age groups are few — one per level per season year — so they are stored as they are. Kept here
 * so every part of the pool is written through one module.
 */
export const encodeAgeGroups = (ageGroups: AgeGroup[]): AgeGroup[] => ageGroups;
