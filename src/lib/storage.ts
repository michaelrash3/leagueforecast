import { STORAGE_VERSION, type GameLog, type Matchup, type Settings, type TeamBase } from "./types";
import { coerceLogs, coerceMatchups, coerceSettings, coerceTeams } from "./validate";

const KEYS = {
  teams: `league_teams_v${STORAGE_VERSION}`,
  matchups: `league_matchups_v${STORAGE_VERSION}`,
  logs: `league_logs_v${STORAGE_VERSION}`,
  bracketLogs: `league_bracket_logs_v${STORAGE_VERSION}`,
  settings: `league_settings_v${STORAGE_VERSION}`,
  undo: `league_undo_snapshot_v${STORAGE_VERSION}`,
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

const migrateOnce = (legacyKey: string, currentKey: string) => {
  if (safeGet(currentKey) !== null) return;
  const legacy = safeGet(legacyKey);
  if (legacy === null) return;
  if (safeSet(currentKey, legacy)) safeRemove(legacyKey);
};

export const loadTeams = (): TeamBase[] => {
  migrateOnce(LEGACY_KEYS.teams, KEYS.teams);
  return coerceTeams(parseJson(safeGet(KEYS.teams)));
};
export const loadMatchups = (): Matchup[] => {
  migrateOnce(LEGACY_KEYS.matchups, KEYS.matchups);
  return coerceMatchups(parseJson(safeGet(KEYS.matchups)), loadTeams());
};
export const loadLogs = (): Record<string, GameLog> => {
  migrateOnce(LEGACY_KEYS.logs, KEYS.logs);
  return coerceLogs(parseJson(safeGet(KEYS.logs)), loadMatchups(), loadSettings());
};
export const loadSettings = (): Settings => {
  migrateOnce(LEGACY_KEYS.settings, KEYS.settings);
  return coerceSettings(parseJson(safeGet(KEYS.settings)));
};
export const loadBracketLogs = (): Record<string, GameLog> =>
  coerceLogs(parseJson(safeGet(KEYS.bracketLogs)), [], loadSettings());

export const saveTeams = (teams: TeamBase[]) => safeSet(KEYS.teams, JSON.stringify(teams));
export const saveMatchups = (matchups: Matchup[]) =>
  safeSet(KEYS.matchups, JSON.stringify(matchups));
export const saveLogs = (logs: Record<string, GameLog>) => safeSet(KEYS.logs, JSON.stringify(logs));
export const saveBracketLogs = (logs: Record<string, GameLog>) =>
  safeSet(KEYS.bracketLogs, JSON.stringify(logs));
export const saveSettings = (settings: Settings) =>
  safeSet(KEYS.settings, JSON.stringify(settings));
export const saveUndoSnapshot = (snapshot: unknown) => safeSet(KEYS.undo, JSON.stringify(snapshot));
export const readUndoSnapshot = () => parseJson(safeGet(KEYS.undo));
export const STORAGE_KEYS = KEYS;
