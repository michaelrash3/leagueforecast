import {
  DEFAULT_SETTINGS,
  STORAGE_VERSION,
  type AiModel,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type Settings,
  type TeamBase,
} from "./types";

const KEYS = {
  teams: `league_teams_v${STORAGE_VERSION}`,
  matchups: `league_matchups_v${STORAGE_VERSION}`,
  logs: `league_logs_v${STORAGE_VERSION}`,
  settings: `league_settings_v${STORAGE_VERSION}`,
  undo: `league_undo_snapshot_v${STORAGE_VERSION}`,
  geminiKey: `nkb_gemini_key_v1`,
  geminiCache: `nkb_gemini_cache_v1`,
} as const;

const LEGACY_KEYS = {
  teams: "league_teams",
  matchups: "league_matchups",
  logs: "league_logs",
  settings: "league_settings",
} as const;

export type StorageKey = keyof typeof KEYS;

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

// ---------- Type guards ----------

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isTeamBase = (v: unknown): v is TeamBase =>
  isRecord(v) && isString(v.id) && isString(v.name);

const isMatchup = (v: unknown): v is Matchup =>
  isRecord(v) &&
  isString(v.id) &&
  isString(v.date) &&
  isString(v.away) &&
  isString(v.home);

const isGameLog = (v: unknown): v is GameLog =>
  isRecord(v) &&
  isString(v.awayRuns) &&
  isString(v.awayHits) &&
  isString(v.awayK) &&
  isString(v.homeRuns) &&
  isString(v.homeHits) &&
  isString(v.homeK) &&
  isString(v.innings) &&
  (v.isFinal === undefined || isBoolean(v.isFinal));

const AGGRESSION_VALUES: ModelAggression[] = ["Conservative", "Balanced", "Aggressive"];
const AI_MODEL_VALUES: AiModel[] = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

const coerceSettings = (raw: unknown): Settings => {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const aggressionRaw = raw.modelAggression;
  const modelAggression: ModelAggression = isString(aggressionRaw) && AGGRESSION_VALUES.includes(aggressionRaw as ModelAggression)
    ? (aggressionRaw as ModelAggression)
    : DEFAULT_SETTINGS.modelAggression;

  const aiModelRaw = raw.aiModel;
  const aiModel: AiModel = isString(aiModelRaw) && AI_MODEL_VALUES.includes(aiModelRaw as AiModel)
    ? (aiModelRaw as AiModel)
    : DEFAULT_SETTINGS.aiModel;

  return {
    goldCutoff: isNumber(raw.goldCutoff) ? raw.goldCutoff : DEFAULT_SETTINGS.goldCutoff,
    seasonLabel: isString(raw.seasonLabel) ? raw.seasonLabel : DEFAULT_SETTINGS.seasonLabel,
    winPoints: isNumber(raw.winPoints) ? raw.winPoints : DEFAULT_SETTINGS.winPoints,
    tiePoints: isNumber(raw.tiePoints) ? raw.tiePoints : DEFAULT_SETTINGS.tiePoints,
    runDiffTiebreaker:
      isBoolean(raw.runDiffTiebreaker)
        ? raw.runDiffTiebreaker
        : DEFAULT_SETTINGS.runDiffTiebreaker,
    maxScoreCap: isNumber(raw.maxScoreCap) ? raw.maxScoreCap : DEFAULT_SETTINGS.maxScoreCap,
    modelAggression,
    aiNarrative: isBoolean(raw.aiNarrative) ? raw.aiNarrative : DEFAULT_SETTINGS.aiNarrative,
    aiModel,
  };
};

// ---------- Gemini API key + cache (separate keys so they don't get bundled
// into the Backup JSON export). ----------

export const loadGeminiKey = (): string => {
  const raw = safeGet(KEYS.geminiKey);
  return raw ?? "";
};

export const saveGeminiKey = (key: string): boolean => {
  if (!key) {
    safeRemove(KEYS.geminiKey);
    return true;
  }
  return safeSet(KEYS.geminiKey, key);
};

export type GeminiCacheEntry = { text: string; timestamp: number };

const MAX_CACHE_ENTRIES = 80;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export const loadGeminiCache = (): Record<string, GeminiCacheEntry> => {
  const raw = parseJson(safeGet(KEYS.geminiCache));
  if (!isRecord(raw)) return {};
  const now = Date.now();
  const out: Record<string, GeminiCacheEntry> = {};
  Object.entries(raw).forEach(([hash, value]) => {
    if (
      isRecord(value) &&
      isString(value.text) &&
      isNumber(value.timestamp) &&
      now - value.timestamp < CACHE_TTL_MS
    ) {
      out[hash] = { text: value.text, timestamp: value.timestamp };
    }
  });
  return out;
};

export const writeGeminiCache = (cache: Record<string, GeminiCacheEntry>): boolean => {
  // Trim to MAX_CACHE_ENTRIES newest entries.
  const entries = Object.entries(cache).sort(
    (a, b) => b[1].timestamp - a[1].timestamp
  );
  const trimmed: Record<string, GeminiCacheEntry> = {};
  entries.slice(0, MAX_CACHE_ENTRIES).forEach(([hash, value]) => {
    trimmed[hash] = value;
  });
  return safeSet(KEYS.geminiCache, JSON.stringify(trimmed));
};

export const clearGeminiCache = () => safeRemove(KEYS.geminiCache);

// ---------- Public loaders ----------

const migrateOnce = (legacyKey: string, currentKey: string) => {
  if (safeGet(currentKey) !== null) return;
  const legacy = safeGet(legacyKey);
  if (legacy === null) return;
  if (safeSet(currentKey, legacy)) safeRemove(legacyKey);
};

export const loadTeams = (): TeamBase[] => {
  migrateOnce(LEGACY_KEYS.teams, KEYS.teams);
  const raw = parseJson(safeGet(KEYS.teams));
  if (!Array.isArray(raw)) return [];
  return raw.filter(isTeamBase);
};

export const loadMatchups = (): Matchup[] => {
  migrateOnce(LEGACY_KEYS.matchups, KEYS.matchups);
  const raw = parseJson(safeGet(KEYS.matchups));
  if (!Array.isArray(raw)) return [];
  return raw.filter(isMatchup);
};

export const loadLogs = (): Record<string, GameLog> => {
  migrateOnce(LEGACY_KEYS.logs, KEYS.logs);
  const raw = parseJson(safeGet(KEYS.logs));
  if (!isRecord(raw)) return {};
  const out: Record<string, GameLog> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (isGameLog(value)) out[key] = value;
  });
  return out;
};

export const loadSettings = (): Settings => {
  migrateOnce(LEGACY_KEYS.settings, KEYS.settings);
  return coerceSettings(parseJson(safeGet(KEYS.settings)));
};

// ---------- Public writers (return false on quota) ----------

export const saveTeams = (teams: TeamBase[]) =>
  safeSet(KEYS.teams, JSON.stringify(teams));

export const saveMatchups = (matchups: Matchup[]) =>
  safeSet(KEYS.matchups, JSON.stringify(matchups));

export const saveLogs = (logs: Record<string, GameLog>) =>
  safeSet(KEYS.logs, JSON.stringify(logs));

export const saveSettings = (settings: Settings) =>
  safeSet(KEYS.settings, JSON.stringify(settings));

export const saveUndoSnapshot = (snapshot: unknown) =>
  safeSet(KEYS.undo, JSON.stringify(snapshot));

export const readUndoSnapshot = () => parseJson(safeGet(KEYS.undo));

export const STORAGE_KEYS = KEYS;
