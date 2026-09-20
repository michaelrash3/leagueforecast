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

export type SeasonMeta = {
  id: string;
  name: string;
  createdAt: string;
  /** When any of this season's data was last saved. Absent on a season from before it was kept. */
  updatedAt?: string;
};

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
      ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}),
    }));
};

/**
 * Marks a season as changed now. Called by every save of its data, so the list carries the one
 * fact about freshness League Standings never had: not when a season was made, but when it was
 * last touched. The undo snapshot is not a change to the season and does not call this.
 */
const touchSeason = (id: string): void => {
  const seasons = readSeasons();
  if (!seasons.some((season) => season.id === id)) return;
  writeSeasons(
    seasons.map((season) => (season.id === id ? { ...season, updatedAt: nowIso() } : season))
  );
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

  /*
   * The copy has to land before the original goes. `safeSet` answers whether it did — the quota is
   * the ordinary way it does not, and this runs at startup on a browser whose localStorage is
   * already as full as the season that is about to be copied into it. Removing regardless meant a
   * refused write destroyed the league it was migrating, at the one moment the user had done
   * nothing but open the app. A copy that fails leaves both keys where they are, and the flat key
   * is read by everything below until the next start tries again.
   */
  DATA_KEYS.forEach((dataKey) => {
    const value = safeGet(FLAT_KEYS[dataKey]);
    if (value === null) return;
    if (safeSet(seasonKey(DEFAULT_SEASON_ID, dataKey), value)) {
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

// Parameterized internals: the exported no-arg loaders below apply these to the *active* season;
// the `*ForSeason` exports apply them to any season without disturbing the active pointer.
const loadSettingsFor = (seasonId: string): Settings =>
  coerceSettings(parseJson(safeGet(seasonKey(seasonId, "settings"))));
const loadTeamsFor = (seasonId: string): TeamBase[] =>
  coerceTeams(parseJson(safeGet(seasonKey(seasonId, "teams"))));
const loadMatchupsFor = (seasonId: string): Matchup[] =>
  coerceMatchups(parseJson(safeGet(seasonKey(seasonId, "matchups"))), loadTeamsFor(seasonId));
const loadLogsFor = (seasonId: string): Record<string, GameLog> =>
  coerceLogs(
    parseJson(safeGet(seasonKey(seasonId, "logs"))),
    loadMatchupsFor(seasonId),
    loadSettingsFor(seasonId)
  );

export const loadTeams = (): TeamBase[] => loadTeamsFor(activeId());
export const loadMatchups = (): Matchup[] => loadMatchupsFor(activeId());
export const loadLogs = (): Record<string, GameLog> => loadLogsFor(activeId());
export const loadSettings = (): Settings => loadSettingsFor(activeId());
export const loadBracketLogs = (): Record<string, GameLog> =>
  coerceLogs(parseJson(safeGet(seasonKey(activeId(), "bracketLogs"))), [], loadSettings());

/**
 * Read a *specific* season's data without switching the active season. Used by features (e.g.
 * Team Rankings) that need to pull results from any season, active or not, purely for reading.
 */
export const loadTeamsForSeason = (seasonId: string): TeamBase[] => loadTeamsFor(seasonId);
export const loadMatchupsForSeason = (seasonId: string): Matchup[] => loadMatchupsFor(seasonId);
export const loadLogsForSeason = (seasonId: string): Record<string, GameLog> =>
  loadLogsFor(seasonId);
export const loadSettingsForSeason = (seasonId: string): Settings => loadSettingsFor(seasonId);
export const loadBracketLogsForSeason = (seasonId: string): Record<string, GameLog> =>
  coerceLogs(parseJson(safeGet(seasonKey(seasonId, "bracketLogs"))), [], loadSettingsFor(seasonId));

/** Writes one of the active season's keys and marks the season changed. */
const saveActive = (dataKey: DataKey, value: unknown): boolean => {
  const id = activeId();
  const ok = safeSet(seasonKey(id, dataKey), JSON.stringify(value));
  if (ok) touchSeason(id);
  return ok;
};
export const saveTeams = (teams: TeamBase[]) => saveActive("teams", teams);
export const saveMatchups = (matchups: Matchup[]) => saveActive("matchups", matchups);
export const saveLogs = (logs: Record<string, GameLog>) => saveActive("logs", logs);
export const saveBracketLogs = (logs: Record<string, GameLog>) => saveActive("bracketLogs", logs);
export const saveSettings = (settings: Settings) => saveActive("settings", settings);
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

// ---------- Whole-layout read/write (backups) ----------

/** One season's index entry and all of its data, as a backup carries it. */
export type SeasonSnapshot = SeasonMeta & {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  settings: Settings;
};

export type LeagueSnapshot = {
  activeSeasonId: string;
  seasons: SeasonSnapshot[];
};

/**
 * Read every season, not just the active one. The per-season undo snapshot is deliberately left
 * out: it is scratch state for one action, it duplicates the season it belongs to, and restoring
 * a stale one into a different session would offer an "undo" to a state nobody remembers.
 */
export const readLeagueSnapshot = (): LeagueSnapshot => {
  ensureInitialized();
  return {
    activeSeasonId: activeId(),
    seasons: readSeasons().map((season) => ({
      ...season,
      teams: loadTeamsFor(season.id),
      matchups: loadMatchupsFor(season.id),
      logs: loadLogsFor(season.id),
      bracketLogs: loadBracketLogsForSeason(season.id),
      settings: loadSettingsFor(season.id),
    })),
  };
};

/**
 * Replace the whole multi-season layout with a restored one: every season currently stored is
 * cleared first, so a season absent from the backup does not survive the restore. Refuses an
 * empty season list rather than leaving the app with no season to open.
 */
export const replaceLeagueSnapshot = (snapshot: LeagueSnapshot): boolean => {
  ensureInitialized();
  if (!snapshot.seasons.length) return false;

  readSeasons().forEach((season) => {
    DATA_KEYS.forEach((dataKey) => safeRemove(seasonKey(season.id, dataKey)));
  });

  let ok = true;
  snapshot.seasons.forEach((season) => {
    const write = (dataKey: DataKey, value: unknown) => {
      if (!safeSet(seasonKey(season.id, dataKey), JSON.stringify(value))) ok = false;
    };
    write("teams", season.teams);
    write("matchups", season.matchups);
    write("logs", season.logs);
    write("bracketLogs", season.bracketLogs);
    write("settings", season.settings);
  });

  const meta = snapshot.seasons.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  if (!writeSeasons(meta)) ok = false;
  // A pointer at a season the backup does not carry would leave the app on an empty season.
  const active = meta.some((season) => season.id === snapshot.activeSeasonId)
    ? snapshot.activeSeasonId
    : meta[0]!.id;
  if (!writeActive(active)) ok = false;
  return ok;
};
