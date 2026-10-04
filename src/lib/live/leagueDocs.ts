import type { SeasonSnapshot } from "../storage";
import type { GameLog, Matchup, Settings, TeamBase } from "../types";
import {
  coerceLogs,
  coerceMatchups,
  coerceSettings,
  coerceTeams,
  isRecord,
  isString,
} from "../validate";

/**
 * A League Standings season as the cloud keeps it for the accounts on the list: one Firestore
 * document per season, `league/{season}`, which every device listens to and writes into directly
 * (README, "League Standings in the cloud").
 *
 * The document holds the season record by record, so a write sends only the records that changed:
 * a score is `logs.<game>`, a team `teams.<team>`, a setting `settings.<field>`. Two devices
 * scoring two games then write two different fields of one document, and neither undoes the
 * other. One document per game was weighed and turned down: a season is 10 to 70 KB, and a
 * listener is billed a read per document again after half an hour away, so opening a season of
 * 240 games would have cost 240 reads on every device every time.
 *
 * A map loses the order of its records, and the order is not cosmetic: the forecast plays the
 * games out in schedule order with seeded draws, so two devices holding the games in two orders
 * would show two forecasts of one season. The orders of the teams and the games travel beside
 * the maps, whole (`teamOrder`, `order`).
 */

/** The version of this layout. A document of a later one is read by no device that predates it. */
export const LEAGUE_DOC_SCHEMA = 1;

/** Where the seasons are. */
export const LEAGUE_COLLECTION = "league";

/** Every field a season's document has; the rules refuse a document with any other. */
export const LEAGUE_DOC_FIELDS = [
  "schema",
  "name",
  "createdAt",
  "updatedAt",
  "teams",
  "teamOrder",
  "matchups",
  "order",
  "logs",
  "bracketLogs",
  "settings",
] as const;

export type LeagueDoc = {
  schema: number;
  name: string;
  createdAt: string;
  updatedAt?: string;
  /** Each team under its id's key (`encodeKey`). */
  teams: Record<string, TeamBase>;
  /** The teams' ids, in the season's order. */
  teamOrder: string[];
  /** Each game under its id's key. */
  matchups: Record<string, Matchup>;
  /** The games' ids, in schedule order: the order the forecast plays them out in. */
  order: string[];
  /** Each game's score under the game's key. */
  logs: Record<string, GameLog>;
  /** Each bracket game's score under its slot's key. */
  bracketLogs: Record<string, GameLog>;
  settings: Settings;
};

/** The fields that are maps of records, each record written on its own. */
const RECORD_FIELDS = new Set(["teams", "matchups", "logs", "bracketLogs", "settings"]);

/*
 * The keys a document can use as they are. Firestore takes almost any text as a field's name,
 * but one of `.`, `/`, `[`, a backtick or a space must be quoted in every path that names it, and
 * a name of the form `__x__` is Firestore's own. The ids this app makes (`ABCD`, `game_<time>_<n>`,
 * `season-2`) never need it; an id that came in from a schedule file can be any text.
 */
const PLAIN_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_KEY = /^__.*__$/;

const toBase64Url = (text: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (encoded: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return null;
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const isPlainKey = (id: string): boolean => PLAIN_KEY.test(id) && !RESERVED_KEY.test(id);

/**
 * The key an id is kept under in a map, and the id a season's document is named by: the id itself
 * where Firestore takes it as it is, and otherwise `~` and the id's UTF-8 in unpadded base64url,
 * which every path takes. `~` is no plain key's first character, so the two never meet.
 */
export const encodeKey = (id: string): string => (isPlainKey(id) ? id : `~${toBase64Url(id)}`);

/**
 * The id a key holds, or null for a key `encodeKey` never makes: so a record written under any
 * other is left unread rather than read under an id no device holds it by.
 */
export const decodeKey = (key: string): string | null => {
  if (!key.startsWith("~")) return isPlainKey(key) ? key : null;
  const id = fromBase64Url(key.slice(1));
  return id !== null && id !== "" && encodeKey(id) === key ? id : null;
};

/** A record with its absent fields left out, as Firestore refuses a field set to nothing. */
const present = <T extends object>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

const keyed = <T>(entries: Iterable<readonly [string, T]>): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const [id, value] of entries) {
    const key = encodeKey(id);
    if (!(key in out)) out[key] = present(value as object) as T;
  }
  return out;
};

/** A season as its document: what is written when the season first reaches the cloud. */
export const seasonToDoc = (season: SeasonSnapshot): LeagueDoc => ({
  schema: LEAGUE_DOC_SCHEMA,
  name: season.name,
  createdAt: season.createdAt,
  ...(season.updatedAt === undefined ? {} : { updatedAt: season.updatedAt }),
  teams: keyed(season.teams.map((team) => [team.id, team] as const)),
  teamOrder: [...new Set(season.teams.map((team) => team.id))],
  matchups: keyed(season.matchups.map((game) => [game.id, game] as const)),
  order: [...new Set(season.matchups.map((game) => game.id))],
  logs: keyed(Object.entries(season.logs)),
  bracketLogs: keyed(Object.entries(season.bracketLogs)),
  settings: present(season.settings),
});

/** The document of a season, by its id. */
export const seasonDocId = (seasonId: string): string => encodeKey(seasonId);

const stringsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((item): item is string => isString(item)) : [];

/**
 * The records of a map that sit under the key of their own id, in `order`, then any the order
 * leaves out, by key. A record can be left out of the order by two devices adding at once, each
 * writing an order without the other's addition; every device then reads it in the same place.
 */
const listed = (raw: unknown, order: readonly string[]): unknown[] => {
  if (!isRecord(raw)) return [];
  const own = (key: string): unknown => {
    const record = raw[key];
    return isRecord(record) && isString(record.id) && encodeKey(record.id) === key
      ? record
      : undefined;
  };
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const key of [...order.map(encodeKey), ...Object.keys(raw).sort()]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const record = own(key);
    if (record !== undefined) out.push(record);
  }
  return out;
};

/** The records of a map by the ids their keys hold. */
const byId = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort()) {
    const id = decodeKey(key);
    if (id !== null && !(id in out)) out[id] = raw[key];
  }
  return out;
};

export type LeagueDocRead =
  | { ok: true; season: SeasonSnapshot }
  /** `newer`: written by a later version of the app, which this one must not read or write. */
  | { ok: false; reason: "unreadable" | "newer" };

/**
 * A season's document as the season, checked as a backup's season is (`backup.ts`): every record
 * through the validators storage reads with, so nothing a device holds came in unchecked.
 */
export const docToSeason = (raw: unknown, docId: string): LeagueDocRead => {
  const id = decodeKey(docId);
  if (!isRecord(raw) || id === null) return { ok: false, reason: "unreadable" };
  if (typeof raw.schema !== "number" || !Number.isInteger(raw.schema) || raw.schema < 1)
    return { ok: false, reason: "unreadable" };
  if (raw.schema > LEAGUE_DOC_SCHEMA) return { ok: false, reason: "newer" };
  const teams = coerceTeams(listed(raw.teams, stringsOf(raw.teamOrder)));
  const matchups = coerceMatchups(listed(raw.matchups, stringsOf(raw.order)), teams);
  return {
    ok: true,
    season: {
      id,
      name: isString(raw.name) && raw.name.trim() ? raw.name.trim() : id,
      createdAt: isString(raw.createdAt) ? raw.createdAt : "",
      ...(isString(raw.updatedAt) ? { updatedAt: raw.updatedAt } : {}),
      teams,
      matchups,
      logs: coerceLogs(byId(raw.logs), matchups),
      bracketLogs: coerceLogs(byId(raw.bracketLogs), []),
      settings: coerceSettings(raw.settings),
    },
  };
};

/** One field of a season's document to set, or to take out. */
export type LeagueDocChange =
  { path: readonly string[]; value: unknown } | { path: readonly string[]; remove: true };

/** A value as text with every object's keys in order, so two orders of one record read alike. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );

/*
 * Equality by content, whatever order a record's fields are in: Firestore hands a map's fields
 * back in an order of its own, which is not the order this app builds a record in, and a record
 * read back unchanged must not read as changed and be written again.
 */
const same = (a: unknown, b: unknown): boolean =>
  a === b || (a !== undefined && b !== undefined && canonical(a) === canonical(b));

/**
 * What to write to turn the document `base` into `next`: each record, setting and order that
 * differs, as a field of its own, and nothing else. Two edits on two devices then touch two
 * different fields, so neither undoes the other.
 */
export const docChanges = (base: LeagueDoc, next: LeagueDoc): LeagueDocChange[] => {
  const changes: LeagueDocChange[] = [];
  const was = base as Record<string, unknown>;
  const now = next as Record<string, unknown>;
  for (const field of LEAGUE_DOC_FIELDS) {
    const before = was[field];
    const after = now[field];
    if (RECORD_FIELDS.has(field) && isRecord(before) && isRecord(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (same(before[key], after[key])) continue;
        changes.push(
          after[key] === undefined
            ? { path: [field, key], remove: true }
            : { path: [field, key], value: after[key] }
        );
      }
    } else if (!same(before, after)) {
      changes.push(
        after === undefined ? { path: [field], remove: true } : { path: [field], value: after }
      );
    }
  }
  return changes;
};
