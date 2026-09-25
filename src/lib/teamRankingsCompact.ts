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

import {
  isPlaceholderName,
  type AgeGroup,
  type FoldedRow,
  type GcTeamLink,
  type ScoutGame,
  type ScoutGameSource,
  type ScoutTeam,
} from "./teamRankings";
import { isNumber, isRecord, isString } from "./validate";

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
/** `ScoutGame.scoreFromB`: the score is side B's, borrowed while side A has posted none. */
const SCORE_FROM_B = 2;
/** `ScoutGame.scoreFromTwin`: the score is another listing's of the game, on side A's schedule. */
const SCORE_FROM_TWIN = 4;
/** `ScoutGame.withdrawn`: side A's schedule no longer lists the row the game stands on. */
const WITHDRAWN = 8;

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
 * 16 also-from (other GameChanger schedules that listed this game, as source indexes)
 *
 * Positions are only ever appended to. An older file simply stops earlier, and every reader below
 * treats a missing position as the field being absent, so a pool written before a position existed
 * still reads.
 */
type GameRow = (number | string | null | number[] | (number | string | null)[][])[];

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
      (game.excluded ? EXCLUDED : 0) |
        (game.scoreFromB ? SCORE_FROM_B : 0) |
        (game.scoreFromTwin ? SCORE_FROM_TWIN : 0) |
        (game.withdrawn ? WITHDRAWN : 0),
      game.ageLevelA ?? null,
      game.ageLevelB ?? null,
      seasons.index(game.season),
      sourceTeam === undefined ? null : sources.index(sourceTeam),
      sourceGame ?? null,
      events.index(game.event),
      game.note ?? null,
      canDerive ? null : game.id,
      game.startTs ?? null,
      // Load-bearing rather than trivia: it is what tells a doubleheader from a disputed score.
      game.alsoFrom?.length
        ? game.alsoFrom.flatMap((teamId) => {
            const index = sources.index(teamId);
            return index === null ? [] : [index];
          })
        : null,
      // The same, row by row: each folded row whole — its schedule's index, its id, its start, its
      // own score and whether its club is side B — so the tidy can judge it again.
      game.alsoRows?.length
        ? game.alsoRows.flatMap((row) => {
            const index = sources.index(row.teamId);
            return index === null
              ? []
              : [
                  trimTrailing<number | string | null>([
                    index,
                    row.gameId,
                    row.startTs ?? null,
                    row.ownScore ?? null,
                    row.opponentScore ?? null,
                    row.onSideB ? 1 : null,
                    // Its own day, where a schedule dated the game a day off the other's.
                    row.date === undefined ? null : (encodeDate(row.date) ?? row.date),
                  ]),
                ];
          })
        : null,
      // Side B's own schedule's score, A's runs then B's.
      game.reportedByB ? [game.reportedByB.teamAScore, game.reportedByB.teamBScore] : null,
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
  if (flags & SCORE_FROM_B) game.scoreFromB = true;
  if (flags & SCORE_FROM_TWIN) game.scoreFromTwin = true;
  if (flags & WITHDRAWN) game.withdrawn = true;

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
  const alsoFrom = Array.isArray(row[16])
    ? row[16].flatMap((index) => {
        const teamId = at(pool.c, index);
        return teamId ? [teamId] : [];
      })
    : [];
  if (alsoFrom.length > 0) game.alsoFrom = alsoFrom;
  const alsoRows: FoldedRow[] = Array.isArray(row[17])
    ? row[17].flatMap((entry): FoldedRow[] => {
        if (!Array.isArray(entry)) return [];
        const teamId = at(pool.c, entry[0]);
        const gameId = str(entry[1]);
        if (!teamId || !gameId) return [];
        const startTs = str(entry[2]);
        const ownScore = num(entry[3]);
        const opponentScore = num(entry[4]);
        const date = decodeDate(entry[6]);
        return [
          {
            teamId,
            gameId,
            ...(startTs ? { startTs } : {}),
            ...(date ? { date } : {}),
            ...(ownScore !== undefined && opponentScore !== undefined
              ? { ownScore, opponentScore }
              : {}),
            ...(entry[5] === 1 ? { onSideB: true } : {}),
          },
        ];
      })
    : [];
  if (alsoRows.length > 0) game.alsoRows = alsoRows;
  if (Array.isArray(row[18])) {
    const reportA = num(row[18][0]);
    const reportB = num(row[18][1]);
    if (reportA !== undefined && reportB !== undefined) {
      game.reportedByB = { teamAScore: reportA, teamBScore: reportB };
    }
  }

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

/**
 * What a stored games value holds, without decoding it: how many games, and how many distinct
 * teams they mention. The compact form keeps both as array lengths. The older array form has to
 * be counted and says nothing about its teams; a value that is neither holds nothing.
 */
export const storedGamesStats = (raw: unknown): { games: number; teams: number | null } => {
  if (isCompactPool(raw)) return { games: raw.r.length, teams: raw.t.length };
  if (Array.isArray(raw)) return { games: raw.length, teams: null };
  return { games: 0, teams: 0 };
};

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
  /**
   * Coaches, interned.
   *
   * Worth its own dictionary rather than writing the names into the rows: a club's officer sits on
   * every team it runs — one name in the real export is on a hundred and thirty-three — and the
   * coaches of one club repeat across each of its age groups. Absent on anything written before
   * staff was stored, which reads as no staff rather than as an error.
   */
  p?: string[];
  /** 0 id, 1 name, 2 flags, 3 state, 4 city, 5 links, 6 avatar */
  r: TeamRow[];
};

type TeamRow = (number | string | null | CompactLink[])[];

/**
 * 0 gc id, 1 name, 2 age group, 3 season, 4 season year, 5 age level, 6 avatar, 7 w, 8 l, 9 t,
 * 10 importedAt, 11 staff (indexes into `p`), 12 player count, 13 counted at.
 *
 * Slots are only ever appended. A reader that predates the last three finds the first eleven
 * exactly where it expects them and ignores the rest, which is why adding them did not need a
 * version bump: nothing older misreads anything, it simply does not see the new fields.
 */
type CompactLink = (number | string | null | number[])[];

const MINE = 1;
/** A name that stood in for a club nobody had decided yet; never a team, never ranked. */
const PLACEHOLDER = 2;
/** Known only from somebody else's schedule: in the fit as an opponent, never in a table. */
const NAME_ONLY = 4;

export const encodeScoutTeams = (teams: ScoutTeam[]): CompactTeams => {
  const groups = interner();
  const seasons = interner();
  const people = interner();

  const rows = teams.map((team) => {
    const links: CompactLink[] = (team.gcTeams ?? []).map((link) => {
      const staff = (link.staff ?? []).flatMap((name) => {
        const index = people.index(name);
        return index === null ? [] : [index];
      });
      return trimTrailing([
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
        staff.length > 0 ? staff : null,
        link.playerCount ?? null,
        link.countedAt ?? null,
      ]);
    });
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

  // Left off entirely when no team has staff, so a pool typed in by hand is written as it was.
  return {
    v: COMPACT_VERSION,
    g: groups.values,
    s: seasons.values,
    ...(people.values.length > 0 ? { p: people.values } : {}),
    r: rows,
  };
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
  const staff = Array.isArray(row[11])
    ? row[11].flatMap((index) => {
        const name = at(pool.p ?? [], index);
        return name ? [name] : [];
      })
    : [];
  if (staff.length > 0) link.staff = staff;
  const playerCount = num(row[12]);
  if (playerCount !== undefined) link.playerCount = playerCount;
  const countedAt = str(row[13]);
  if (countedAt) link.countedAt = countedAt;
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
    ...(Array.isArray(source.p) ? { p: source.p } : {}),
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

/* --------------------------------------------------------------- reading back what was stored */

/** A string with something in it — an id made of whitespace identifies nothing. */
export const isFilledString = (value: unknown): value is string =>
  isString(value) && value.trim() !== "";

const coerceGcRecord = (raw: unknown): GcTeamLink["record"] | undefined =>
  isRecord(raw) && isNumber(raw.win) && isNumber(raw.loss) && isNumber(raw.tie)
    ? { win: raw.win, loss: raw.loss, tie: raw.tie }
    : undefined;

/**
 * One GameChanger link, or null when it cannot be one. The three ids are what a link *is* — the
 * GameChanger team, what it is called there, and the page its schedule is filed under — so a link
 * missing any of them is dropped. Everything else is what GameChanger said last time and is kept
 * only when it is the right shape; a bad record or a numeric season loses that field, not the link.
 */
export const coerceGcTeamLink = (raw: unknown): GcTeamLink | null => {
  if (!isRecord(raw)) return null;
  if (!isFilledString(raw.teamId) || !isString(raw.name) || !isFilledString(raw.ageGroupId)) {
    return null;
  }
  const record = coerceGcRecord(raw.record);
  return {
    teamId: raw.teamId,
    name: raw.name,
    ageGroupId: raw.ageGroupId,
    ...(isString(raw.season) ? { season: raw.season } : {}),
    ...(isNumber(raw.seasonYear) ? { seasonYear: raw.seasonYear } : {}),
    ...(isNumber(raw.ageLevel) ? { ageLevel: raw.ageLevel } : {}),
    ...(isString(raw.avatarKey) ? { avatarKey: raw.avatarKey } : {}),
    ...(record ? { record } : {}),
    /*
     * The coaches, the roster count and when it was taken. Dropped here until now, which the
     * compact codec has never done — so a pool that went out to a backup and came back, or an
     * undo, was the same pool minus every coach in it. That is not cosmetic: two coaches in
     * common is the only thing in the data that says two GameChanger ids are one club inside a
     * season, so a restore emptied the fold list of exactly the pairs worth folding, and
     * `gcStaff.ts` had nothing left to measure.
     */
    ...(Array.isArray(raw.staff) && raw.staff.every(isString) ? { staff: raw.staff } : {}),
    ...(isNumber(raw.playerCount) ? { playerCount: raw.playerCount } : {}),
    ...(isString(raw.countedAt) ? { countedAt: raw.countedAt } : {}),
    ...(isString(raw.importedAt) ? { importedAt: raw.importedAt } : {}),
  };
};

/** The usable links out of a stored list; anything that is not a list yields none. */
export const coerceGcTeamLinks = (raw: unknown): GcTeamLink[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const link = coerceGcTeamLink(entry);
    return link ? [link] : [];
  });
};

/**
 * Where a game came from, when the stored shape says GameChanger. Anything else — an unknown
 * kind, a missing id — reads as no source, which turns the game back into a typed-in one rather
 * than losing it: the result is still real even if its provenance is not.
 */
const coerceGameSource = (raw: unknown): ScoutGameSource | undefined =>
  isRecord(raw) &&
  raw.kind === "gamechanger" &&
  isFilledString(raw.teamId) &&
  isFilledString(raw.gameId)
    ? { kind: "gamechanger", teamId: raw.teamId, gameId: raw.gameId }
    : undefined;

export const coerceScoutTeams = (raw: unknown): ScoutTeam[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && isString(entry.id) && isString(entry.name)
    )
    .map((entry) => {
      // Malformed links are dropped one at a time; the team itself is never lost over one.
      const gcTeams = coerceGcTeamLinks(entry.gcTeams);
      return {
        id: entry.id as string,
        name: entry.name as string,
        ...(entry.isMine === true ? { isMine: true } : {}),
        ...(isString(entry.state) ? { state: entry.state } : {}),
        ...(isString(entry.city) ? { city: entry.city } : {}),
        ...(entry.placeholder === true ? { placeholder: true as const } : {}),
        /*
         * A stand-in is a club somebody named and nobody pulled, and it is kept out of the
         * rankings for it. Losing the mark on the way back in put every one of them into the
         * tables, ranked on whatever fraction of a season happened to face a club that *was*
         * pulled — and the picture is what lets the next schedule recognise the same club rather
         * than making a second of it.
         */
        ...(entry.nameOnly === true ? { nameOnly: true as const } : {}),
        ...(isString(entry.avatarKey) ? { avatarKey: entry.avatarKey } : {}),
        ...(gcTeams.length ? { gcTeams } : {}),
      };
    });
};

/** Folded rows read leniently: each needs both ids; a start or a score it cannot read is dropped. */
const coerceFoldedRows = (raw: unknown): FoldedRow[] =>
  Array.isArray(raw)
    ? raw.flatMap((entry): FoldedRow[] =>
        isRecord(entry) && isFilledString(entry.teamId) && isFilledString(entry.gameId)
          ? [
              {
                teamId: entry.teamId,
                gameId: entry.gameId,
                ...(isFilledString(entry.startTs) ? { startTs: entry.startTs } : {}),
                ...(isFilledString(entry.date) ? { date: entry.date } : {}),
                ...(isNumber(entry.ownScore) && isNumber(entry.opponentScore)
                  ? { ownScore: entry.ownScore, opponentScore: entry.opponentScore }
                  : {}),
                ...(entry.onSideB === true ? { onSideB: true } : {}),
              },
            ]
          : []
      )
    : [];

export const coerceScoutGames = (raw: unknown): ScoutGame[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.teamAId) &&
        isString(entry.teamBId) &&
        isString(entry.ageGroupId) &&
        (entry.teamAScore === undefined || isNumber(entry.teamAScore)) &&
        (entry.teamBScore === undefined || isNumber(entry.teamBScore))
    )
    .map((entry) => {
      const source = coerceGameSource(entry.source);
      return {
        id: entry.id as string,
        teamAId: entry.teamAId as string,
        teamBId: entry.teamBId as string,
        ageGroupId: entry.ageGroupId as string,
        ...(isNumber(entry.teamAScore) ? { teamAScore: entry.teamAScore } : {}),
        ...(isNumber(entry.teamBScore) ? { teamBScore: entry.teamBScore } : {}),
        ...(isString(entry.date) ? { date: entry.date } : {}),
        ...(isString(entry.event) ? { event: entry.event } : {}),
        ...(isString(entry.note) ? { note: entry.note } : {}),
        ...(entry.excluded === true ? { excluded: true } : {}),
        ...(entry.scoreFromB === true ? { scoreFromB: true } : {}),
        ...(entry.scoreFromTwin === true ? { scoreFromTwin: true } : {}),
        ...(entry.withdrawn === true ? { withdrawn: true } : {}),
        ...(isNumber(entry.ageLevelA) ? { ageLevelA: entry.ageLevelA } : {}),
        ...(isNumber(entry.ageLevelB) ? { ageLevelB: entry.ageLevelB } : {}),
        ...(isString(entry.season) ? { season: entry.season } : {}),
        ...(isString(entry.startTs) ? { startTs: entry.startTs } : {}),
        ...(Array.isArray(entry.alsoFrom) && entry.alsoFrom.some(isString)
          ? { alsoFrom: entry.alsoFrom.filter(isString) }
          : {}),
        ...(coerceFoldedRows(entry.alsoRows).length > 0
          ? { alsoRows: coerceFoldedRows(entry.alsoRows) }
          : {}),
        ...(isRecord(entry.reportedByB) &&
        isNumber(entry.reportedByB.teamAScore) &&
        isNumber(entry.reportedByB.teamBScore)
          ? {
              reportedByB: {
                teamAScore: entry.reportedByB.teamAScore,
                teamBScore: entry.reportedByB.teamBScore,
              },
            }
          : {}),
        ...(source ? { source } : {}),
      };
    });
};

/**
 * Marks the teams that were never teams.
 *
 * A pool saved before placeholders were understood holds them as ordinary clubs, and GameChanger
 * writes an undecided bracket slot as "TBD- 08/04/26, 5:00 PM" — a different string every time —
 * so a season of them filled the rankings with a row apiece. Reading the name again on the way out
 * drops them from the tables without asking anyone to import it all a second time. It happens here
 * rather than in either decoder because a pool can arrive through either, and a slot missed by one
 * path would be a slot ranked.
 *
 * The games they hold are untouched: the result happened, whoever it turned out to be against.
 */
export const markPlaceholders = (teams: ScoutTeam[]): ScoutTeam[] =>
  teams.map((team) => {
    /*
     * A club pulled by its own GameChanger id is a club, whatever it is called. Both directions
     * matter. Names really do read as slots — "TBC" is Tampa Bay Cobras and "Tourney Contenders
     * Coral Springs" is a travel squad — and a pool here held 39 of them marked as slots from
     * before their own schedule was pulled, which left 39 real clubs out of the rankings with
     * nothing on screen to say why. So the id clears the mark as well as preventing it: the mark
     * is a reading of a name, and an id is not a reading of anything.
     */
    if (team.gcTeams?.length) {
      if (!team.placeholder) return team;
      const { placeholder: _slot, ...rest } = team;
      return rest;
    }
    return team.placeholder || !isPlaceholderName(team.name)
      ? team
      : { ...team, placeholder: true };
  });

/**
 * Whatever was stored for the teams, as teams.
 *
 * Compact or the older array of objects, coerced, and with the stand-ins marked. This is the one
 * path every reader of a stored pool goes through — the storage cache, a backup, and the workers,
 * which are handed the compact form rather than a copy of every object — so a slot missed on one
 * path cannot be a slot ranked on another.
 */
export const decodePoolTeams = (raw: unknown): ScoutTeam[] =>
  markPlaceholders(decodeScoutTeams(raw, coerceScoutTeams));

/** Whatever was stored for the games, as games. Games have no pass after decoding. */
export const decodePoolGames = (raw: unknown): ScoutGame[] =>
  decodeScoutGames(raw, coerceScoutGames);
