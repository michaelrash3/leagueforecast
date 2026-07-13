import { STORAGE_VERSION, type GameLog, type Matchup, type Settings, type TeamBase } from "./types";
import { coerceLogs, coerceMatchups, coerceSettings, coerceTeams, isRecord } from "./validate";

type DataKey = "teams" | "matchups" | "logs" | "bracketLogs" | "settings" | "undo";

const V = STORAGE_VERSION;

/** Index of all seasons and pointer to the active one. */
const SEASONS_KEY = `league_seasons_v${V}`;
const ACTIVE_KEY = `league_active_season_v${V}`;

/** Pre-multi-season flat keys (the previous single-league layout). Migrated on first init. */
const FLAT_KEYS: Record<DataKey, string> = {
  teams: `league_teams_v${V}`,
  matchups: `league_matchups_v${V}`,
  logs: `league_logs_v${V}`,
  bracketLogs: `league_bracket_logs_v${V}`,
  settings: `league_settings_v${V}`,
  undo: `league_undo_snapshot_v${V}`,
};

/** Oldest (unversioned) keys, migrated forward before the season split. */
const LEGACY_KEYS = {
  teams: "league_teams",
  matchups: "league_matchups",
  logs: "league_logs",
  settings: "league_settings",
} as const;

const DATA_KEYS = Object.keys(FLAT_KEYS) as DataKey[];
const DEFAULT_SEASON_ID = "default";

export type SeasonMeta = { id: string; name: string; createdAt: string };

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
const safeRemove = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};
const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const nowIso = (): string => {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
};

const seasonKey = (seasonId: string, dataKey: DataKey) =>
  `league_season_${seasonId}_${dataKey}_v${V}`;

const readSeasons = (): SeasonMeta[] => {
  const raw = parseJson(safeGet(SEASONS_KEY));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is SeasonMeta =>
        isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string"
    )
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    }));
};
const writeSeasons = (seasons: SeasonMeta[]): boolean =>
  safeSet(SEASONS_KEY, JSON.stringify(seasons));
const readActive = (): string | null => {
  const raw = safeGet(ACTIVE_KEY);
  return raw && raw.length ? raw : null;
};
const writeActive = (id: string): boolean => safeSet(ACTIVE_KEY, id);

const migrateOnce = (legacyKey: string, currentKey: string) => {
  if (safeGet(currentKey) !== null) return;
  const legacy = safeGet(legacyKey);
  if (legacy === null) return;
  if (safeSet(currentKey, legacy)) safeRemove(legacyKey);
};

const deriveSeasonName = (settingsRaw: unknown): string => {
  if (
    isRecord(settingsRaw) &&
    typeof settingsRaw.seasonLabel === "string" &&
    settingsRaw.seasonLabel.trim()
  ) {
    return settingsRaw.seasonLabel.trim();
  }
  return "Season 1";
};

/**
 * Lazily migrate the legacy single-league layout into the multi-season layout the first time
 * storage is touched: fold the oldest unversioned keys forward, move the flat keys into a
 * "default" season namespace, and record it as the active season. Idempotent — a set active
 * pointer means initialization already happened.
 */
const ensureInitialized = () => {
  if (readActive()) return;

  migrateOnce(LEGACY_KEYS.teams, FLAT_KEYS.teams);
  migrateOnce(LEGACY_KEYS.matchups, FLAT_KEYS.matchups);
  migrateOnce(LEGACY_KEYS.logs, FLAT_KEYS.logs);
  migrateOnce(LEGACY_KEYS.settings, FLAT_KEYS.settings);

  const name = deriveSeasonName(parseJson(safeGet(FLAT_KEYS.settings)));

  DATA_KEYS.forEach((dataKey) => {
    const value = safeGet(FLAT_KEYS[dataKey]);
    if (value !== null) {
      safeSet(seasonKey(DEFAULT_SEASON_ID, dataKey), value);
      safeRemove(FLAT_KEYS[dataKey]);
    }
  });

  writeSeasons([{ id: DEFAULT_SEASON_ID, name, createdAt: nowIso() }]);
  writeActive(DEFAULT_SEASON_ID);
};

const activeId = (): string => {
  ensureInitialized();
  return readActive() ?? DEFAULT_SEASON_ID;
};

export const loadTeams = (): TeamBase[] =>
  coerceTeams(parseJson(safeGet(seasonKey(activeId(), "teams"))));
export const loadMatchups = (): Matchup[] =>
  coerceMatchups(parseJson(safeGet(seasonKey(activeId(), "matchups"))), loadTeams());
export const loadLogs = (): Record<string, GameLog> =>
  coerceLogs(parseJson(safeGet(seasonKey(activeId(), "logs"))), loadMatchups(), loadSettings());
export const loadSettings = (): Settings =>
  coerceSettings(parseJson(safeGet(seasonKey(activeId(), "settings"))));
export const loadBracketLogs = (): Record<string, GameLog> =>
  coerceLogs(parseJson(safeGet(seasonKey(activeId(), "bracketLogs"))), [], loadSettings());

export const saveTeams = (teams: TeamBase[]) =>
  safeSet(seasonKey(activeId(), "teams"), JSON.stringify(teams));
export const saveMatchups = (matchups: Matchup[]) =>
  safeSet(seasonKey(activeId(), "matchups"), JSON.stringify(matchups));
export const saveLogs = (logs: Record<string, GameLog>) =>
  safeSet(seasonKey(activeId(), "logs"), JSON.stringify(logs));
export const saveBracketLogs = (logs: Record<string, GameLog>) =>
  safeSet(seasonKey(activeId(), "bracketLogs"), JSON.stringify(logs));
export const saveSettings = (settings: Settings) =>
  safeSet(seasonKey(activeId(), "settings"), JSON.stringify(settings));
export const saveUndoSnapshot = (snapshot: unknown) =>
  safeSet(seasonKey(activeId(), "undo"), JSON.stringify(snapshot));
export const readUndoSnapshot = () => parseJson(safeGet(seasonKey(activeId(), "undo")));

// ---------- Season management ----------

const genSeasonId = (existing: SeasonMeta[]): string => {
  const ids = new Set(existing.map((season) => season.id));
  let n = existing.length + 1;
  let id = `season-${n}`;
  while (ids.has(id)) {
    n += 1;
    id = `season-${n}`;
  }
  return id;
};

export const listSeasons = (): SeasonMeta[] => {
  ensureInitialized();
  return readSeasons();
};

export const getActiveSeasonId = (): string => activeId();

export const setActiveSeason = (id: string): boolean => {
  ensureInitialized();
  if (!readSeasons().some((season) => season.id === id)) return false;
  return writeActive(id);
};

/** Create a new, empty season and return its metadata (does not switch to it). */
export const createSeason = (name: string): SeasonMeta => {
  ensureInitialized();
  const seasons = readSeasons();
  const id = genSeasonId(seasons);
  const resolvedName = name.trim() || `Season ${seasons.length + 1}`;
  const meta: SeasonMeta = { id, name: resolvedName, createdAt: nowIso() };
  // Seed the new season's settings so its export label matches its name from the start.
  safeSet(seasonKey(id, "settings"), JSON.stringify({ seasonLabel: resolvedName }));
  writeSeasons([...seasons, meta]);
  return meta;
};

export const renameSeason = (id: string, name: string): boolean => {
  ensureInitialized();
  const trimmed = name.trim();
  if (!trimmed) return false;
  const seasons = readSeasons();
  if (!seasons.some((season) => season.id === id)) return false;
  writeSeasons(seasons.map((season) => (season.id === id ? { ...season, name: trimmed } : season)));
  return true;
};

/** Copy every stored key of `id` into a brand-new season and return its metadata. */
export const duplicateSeason = (id: string, name: string): SeasonMeta | null => {
  ensureInitialized();
  const seasons = readSeasons();
  if (!seasons.some((season) => season.id === id)) return null;
  const newId = genSeasonId(seasons);
  DATA_KEYS.forEach((dataKey) => {
    const value = safeGet(seasonKey(id, dataKey));
    if (value !== null) safeSet(seasonKey(newId, dataKey), value);
  });
  const meta: SeasonMeta = {
    id: newId,
    name: name.trim() || `Season ${seasons.length + 1}`,
    createdAt: nowIso(),
  };
  writeSeasons([...seasons, meta]);
  return meta;
};

/** Delete a season and its data. Refuses to remove the last remaining season. */
export const deleteSeason = (id: string): boolean => {
  ensureInitialized();
  const seasons = readSeasons();
  if (seasons.length <= 1) return false;
  if (!seasons.some((season) => season.id === id)) return false;
  DATA_KEYS.forEach((dataKey) => safeRemove(seasonKey(id, dataKey)));
  const remaining = seasons.filter((season) => season.id !== id);
  writeSeasons(remaining);
  if (readActive() === id) writeActive(remaining[0]!.id);
  return true;
};
