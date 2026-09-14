import {
  readLeagueSnapshot,
  replaceLeagueSnapshot,
  type LeagueSnapshot,
  type SeasonSnapshot,
} from "./storage";
import {
  isAppMode,
  isTheme,
  readAppMode,
  readTheme,
  writeAppMode,
  writeTheme,
  type AppMode,
  type Theme,
} from "./preferences";
import {
  coerceTeamRankingsBackup,
  readTeamRankingsBackup,
  summarizeTeamRankingsBackup,
  writeTeamRankingsBackup,
  type TeamRankingsBackup,
} from "./teamRankingsBackup";
import { STORAGE_VERSION, type GameLog, type Matchup, type Settings, type TeamBase } from "./types";
import {
  coerceLogs,
  coerceMatchups,
  coerceSettings,
  coerceTeams,
  isRecord,
  isString,
} from "./validate";

/**
 * A backup of everything this app keeps in the browser: every season (not just the active one),
 * the Team Rankings pool that sits outside the season layout, and the two UI preferences. The one
 * deliberate omission is each season's undo snapshot — scratch state for a single action, which
 * duplicates the season it belongs to and would mean restoring an "undo" to a state from another
 * session.
 *
 * Older backups carried only the active season's data at the top level. `coerceBackup` still
 * accepts those and reports them as `season`, so importing one keeps working exactly as it did.
 */
export const BACKUP_VERSION = 2;
export const BACKUP_APP = "league-forecast";

export type BackupPreferences = { theme?: Theme; appMode?: AppMode };

export type FullBackup = {
  app: typeof BACKUP_APP;
  backupVersion: number;
  storageVersion: number;
  exportedAt: string;
  activeSeasonId: string;
  seasons: SeasonSnapshot[];
  teamRankings: TeamRankingsBackup;
  preferences: BackupPreferences;
};

/** The active season's live React state, which is fresher than storage for debounced writes. */
export type LiveSeasonData = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  settings: Settings;
};

/** What a parsed backup file turned out to be. */
export type ParsedBackup =
  | { kind: "full"; backup: FullBackup }
  | { kind: "season"; season: LiveSeasonData; teamRankings: TeamRankingsBackup | null };

const nowIso = (): string => {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
};

/**
 * Assemble the whole-browser backup. `live` is the active season's React state: scores are written
 * to storage on a debounce, so reading storage alone can miss an edit made a moment ago.
 */
export const readFullBackup = (live?: LiveSeasonData): FullBackup => {
  const league: LeagueSnapshot = readLeagueSnapshot();
  const theme = readTheme();
  const appMode = readAppMode();
  return {
    app: BACKUP_APP,
    backupVersion: BACKUP_VERSION,
    storageVersion: STORAGE_VERSION,
    exportedAt: nowIso(),
    activeSeasonId: league.activeSeasonId,
    seasons: league.seasons.map((season) =>
      live && season.id === league.activeSeasonId ? { ...season, ...live } : season
    ),
    teamRankings: readTeamRankingsBackup(),
    preferences: {
      ...(theme ? { theme } : {}),
      ...(appMode ? { appMode } : {}),
    },
  };
};

const coerceSeasonSnapshot = (raw: unknown, index: number): SeasonSnapshot | null => {
  if (!isRecord(raw)) return null;
  const id = isString(raw.id) ? raw.id.trim() : "";
  if (!id) return null;
  const settings = coerceSettings(raw.settings);
  const teams = coerceTeams(raw.teams);
  const matchups = coerceMatchups(raw.matchups, teams);
  return {
    id,
    name: isString(raw.name) && raw.name.trim() ? raw.name.trim() : `Season ${index + 1}`,
    createdAt: isString(raw.createdAt) ? raw.createdAt : "",
    teams,
    matchups,
    logs: coerceLogs(raw.logs, matchups, settings),
    // Bracket logs are keyed by bracket slot rather than by a scheduled game, so they are coerced
    // without a matchup list, exactly as the storage layer reads them.
    bracketLogs: coerceLogs(raw.bracketLogs, [], settings),
    settings,
  };
};

const coercePreferences = (raw: unknown): BackupPreferences => {
  if (!isRecord(raw)) return {};
  return {
    ...(isTheme(raw.theme) ? { theme: raw.theme } : {}),
    ...(isAppMode(raw.appMode) ? { appMode: raw.appMode } : {}),
  };
};

/**
 * Validate a parsed backup file. A file carrying a `seasons` array is a whole-browser backup; one
 * carrying top-level `teams`/`matchups`/`logs` is the older single-season shape. `null` means it is
 * neither, and the caller should reject the file rather than guess.
 */
export const coerceBackup = (raw: unknown): ParsedBackup | null => {
  if (!isRecord(raw)) return null;

  if (Array.isArray(raw.seasons)) {
    const seasons = raw.seasons
      .map((season, index) => coerceSeasonSnapshot(season, index))
      .filter((season): season is SeasonSnapshot => season !== null);
    if (!seasons.length) return null;
    // Duplicate ids would collide in the season index and silently drop a season's data.
    const seen = new Set<string>();
    const unique = seasons.filter((season) => {
      if (seen.has(season.id)) return false;
      seen.add(season.id);
      return true;
    });
    const activeSeasonId = isString(raw.activeSeasonId) ? raw.activeSeasonId : "";
    return {
      kind: "full",
      backup: {
        app: BACKUP_APP,
        backupVersion: typeof raw.backupVersion === "number" ? raw.backupVersion : BACKUP_VERSION,
        storageVersion:
          typeof raw.storageVersion === "number" ? raw.storageVersion : STORAGE_VERSION,
        exportedAt: isString(raw.exportedAt) ? raw.exportedAt : "",
        activeSeasonId: unique.some((season) => season.id === activeSeasonId)
          ? activeSeasonId
          : unique[0]!.id,
        seasons: unique,
        teamRankings: coerceTeamRankingsBackup(raw.teamRankings) ?? {
          ageGroups: [],
          teams: [],
          games: [],
        },
        preferences: coercePreferences(raw.preferences),
      },
    };
  }

  if (!Array.isArray(raw.teams) || !Array.isArray(raw.matchups) || !isRecord(raw.logs)) {
    return null;
  }

  const settings = coerceSettings(raw.settings);
  const teams = coerceTeams(raw.teams);
  const matchups = coerceMatchups(raw.matchups, teams);
  return {
    kind: "season",
    season: {
      teams,
      matchups,
      logs: coerceLogs(raw.logs, matchups, settings),
      bracketLogs: coerceLogs(isRecord(raw.bracketLogs) ? raw.bracketLogs : {}, [], settings),
      settings,
    },
    teamRankings: coerceTeamRankingsBackup(raw.teamRankings),
  };
};

export type FullRestoreResult = { ok: boolean; failed: string[] };

/**
 * Write a whole-browser backup back into storage. Each part reports separately so a partial
 * failure (a quota that runs out mid-restore) can be named rather than reported as success.
 */
export const applyFullBackup = (backup: FullBackup): FullRestoreResult => {
  const failed: string[] = [];
  if (!replaceLeagueSnapshot({ activeSeasonId: backup.activeSeasonId, seasons: backup.seasons })) {
    failed.push("seasons");
  }
  if (!writeTeamRankingsBackup(backup.teamRankings)) failed.push("Team Rankings");
  if (backup.preferences.theme && !writeTheme(backup.preferences.theme)) failed.push("theme");
  if (backup.preferences.appMode && !writeAppMode(backup.preferences.appMode)) {
    failed.push("app mode");
  }
  return { ok: failed.length === 0, failed };
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const countFinals = (logs: Record<string, GameLog>) =>
  Object.values(logs).filter((log) => log.isFinal).length;

/** A per-season line plus the rankings pool, for the restore confirmation dialog. */
export const summarizeFullBackup = (backup: FullBackup): string => {
  const lines = backup.seasons.map((season) => {
    const active = season.id === backup.activeSeasonId ? " (opens on restore)" : "";
    return `- ${season.name}: ${plural(season.teams.length, "team")}, ${plural(season.matchups.length, "game")}, ${countFinals(season.logs)} final${active}`;
  });
  return [
    `${plural(backup.seasons.length, "season")} in this backup:`,
    ...lines,
    "",
    `Team Rankings: ${summarizeTeamRankingsBackup(backup.teamRankings)}`,
  ].join("\n");
};

/** Filename for a downloaded backup, labelled by date rather than by one season's name. */
export const backupFilename = (exportedAt: string): string => {
  const stamp = /^(\d{4}-\d{2}-\d{2})/.exec(exportedAt)?.[1];
  return `League_Forecast_Backup_${stamp ?? "export"}.json`;
};
