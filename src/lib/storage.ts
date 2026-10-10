import { STORAGE_VERSION, type GameLog, type Matchup, type Settings, type TeamBase } from "./types";
import { coerceLogs, coerceMatchups, coerceSettings, coerceTeams, isRecord } from "./validate";
import { mayWrite } from "./cloud/cloudGuard";
import { forgetSeasons } from "./preferences";

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

/**
 * Told whenever a season, the list of them or the active one changes, so the cloud copy
 * (`cloudSession.ts`) knows it owes a save. Not for the undo snapshots: those are scratch for one
 * action on one device, and the cloud copy leaves them out as a backup does.
 */
let leagueWriteListener: (() => void) | null = null;

export const onLeagueWrite = (handler: (() => void) | null): void => {
  leagueWriteListener = handler;
};

const isUndoKey = (key: string): boolean =>
  key.endsWith(`_undo_v${V}`) || key === `league_undo_snapshot_v${V}`;

/**
 * The keys the cloud copy carries. The season a device has open is that device's own, like its
 * theme: switching it is no change to the league, and the cloud copy does not carry it
 * (`cloudLocal.ts`). An undo snapshot is scratch for one action on one device.
 */
const isShared = (key: string): boolean => !isUndoKey(key) && key !== ACTIVE_KEY;

/** Writes that are the cloud copy arriving, not changes made here: counted while one runs. */
let arriving = 0;

const noteLeagueWrite = (key: string): void => {
  if (!leagueWriteListener || arriving > 0 || !isShared(key)) return;
  try {
    leagueWriteListener();
  } catch {
    /* the cloud copy is a courtesy; the write is the job */
  }
};

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
/*
 * A write of what is already stored is not a change to the cloud copy. The app writes every
 * season value back as it opens, the same text it has just read, and each of those would otherwise
 * be a save to send on every start.
 */
/*
 * A tab that read its seasons before another tab took a newer copy in may not write them
 * (`cloudGuard.ts`): its values are older than what is stored, and would go back over it.
 */
const safeSet = (key: string, value: string): boolean => {
  try {
    const changed = localStorage.getItem(key) !== value;
    if (changed && isShared(key) && !mayWrite("league")) return false;
    localStorage.setItem(key, value);
    if (changed) noteLeagueWrite(key);
    return true;
  } catch {
    return false;
  }
};
const safeRemove = (key: string) => {
  try {
    const held = localStorage.getItem(key) !== null;
    if (held && isShared(key) && !mayWrite("league")) return;
    localStorage.removeItem(key);
    if (held) noteLeagueWrite(key);
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
 * Marks a season as changed now. Called by every save that changes its data, so the list carries
 * the one fact about freshness League Standings never had: not when a season was made, but when it
 * was last touched. The undo snapshot is not a change to the season and does not call this.
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
  coerceLogs(parseJson(safeGet(seasonKey(seasonId, "logs"))), loadMatchupsFor(seasonId));

export const loadTeams = (): TeamBase[] => loadTeamsFor(activeId());
export const loadMatchups = (): Matchup[] => loadMatchupsFor(activeId());
export const loadLogs = (): Record<string, GameLog> => loadLogsFor(activeId());
export const loadSettings = (): Settings => loadSettingsFor(activeId());
export const loadBracketLogs = (): Record<string, GameLog> =>
  coerceLogs(parseJson(safeGet(seasonKey(activeId(), "bracketLogs"))), []);

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
  coerceLogs(parseJson(safeGet(seasonKey(seasonId, "bracketLogs"))), []);

/**
 * Writes one of the active season's keys and marks the season changed, if it did. The app writes
 * every value back as it opens, the same text it has just read. Stamped, that made each opening
 * look like an edit: the Settings panel's "changed since the last backup" was true of any season
 * merely looked at, and the cloud copy would have been sent again every time.
 */
const saveActive = (dataKey: DataKey, value: unknown): boolean => {
  const id = activeId();
  const key = seasonKey(id, dataKey);
  const text = JSON.stringify(value);
  const changed = safeGet(key) !== text;
  const ok = safeSet(key, text);
  if (ok && changed) touchSeason(id);
  return ok;
};
/**
 * Writes a season's data, all of it at once, to the season named, if this browser still holds it:
 * League kept live writes a season here before it keeps anything of its document
 * (`leagueSync.ts`), and a season deleted meanwhile is not written back into storage.
 */
export const writeSeasonData = (
  id: string,
  data: {
    teams: TeamBase[];
    matchups: Matchup[];
    logs: Record<string, GameLog>;
    bracketLogs: Record<string, GameLog>;
    settings: Settings;
  }
): boolean => {
  ensureInitialized();
  if (!readSeasons().some((season) => season.id === id)) return false;
  let ok = true;
  let changed = false;
  const write = (dataKey: DataKey, value: unknown) => {
    const key = seasonKey(id, dataKey);
    const text = JSON.stringify(value);
    if (safeGet(key) === text) return;
    changed = true;
    if (!safeSet(key, text)) ok = false;
  };
  write("teams", data.teams);
  write("matchups", data.matchups);
  write("logs", data.logs);
  write("bracketLogs", data.bracketLogs);
  write("settings", data.settings);
  if (ok && changed) touchSeason(id);
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

/*
 * Ids are handed out again: counted from the seasons held, so deleting the last season and making
 * one gives its id back, and every browser's first season is `default`. What this device keeps of
 * a season outside the season itself (`forgetSeasons`: its last look, the findings put aside, the
 * team followed and its club's place, the saved scenarios, the news announced) goes with the
 * season when it leaves this browser, and an id given to a season new here starts with nothing
 * under it, whatever a season before it left there. Otherwise the new season took the old one's:
 * its games and teams reported as removed since the last look, its findings already put aside.
 */
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
  if (writeSeasons([...seasons, meta])) forgetSeasons([id]);
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

/**
 * Gives a season the creation time of the season it has become: League kept live, a device whose
 * season of this id held nothing takes in the cloud's season of it whole (`leagueSync.ts`), and from
 * then on it is that season, made when that one was. Without it, the next visit would take the two
 * times for two seasons and keep them apart.
 */
export const adoptSeasonCreatedAt = (id: string, createdAt: string): boolean => {
  ensureInitialized();
  const seasons = readSeasons();
  const season = seasons.find((one) => one.id === id);
  if (!season || season.createdAt === createdAt) return false;
  return writeSeasons(seasons.map((one) => (one.id === id ? { ...one, createdAt } : one)));
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
  /*
   * The copy's label is its own name, as `createSeason` seeds it. The switcher renames a season to
   * match its label, so a copy left holding the original's was renamed back to it the first time
   * it was opened. Everything else in the settings is copied as it was.
   */
  const settings = parseJson(safeGet(seasonKey(newId, "settings")));
  safeSet(
    seasonKey(newId, "settings"),
    JSON.stringify({ ...(isRecord(settings) ? settings : {}), seasonLabel: meta.name })
  );
  // The copy takes the original's data, and none of what this device kept of the original.
  if (writeSeasons([...seasons, meta])) forgetSeasons([newId]);
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
  /*
   * Let go of only once the list no longer names the season. A tab another has taken a copy in
   * under may not write the list (`cloudGuard.ts`), and the season it could not delete is still
   * here, with everything this device kept of it.
   */
  if (writeSeasons(remaining)) forgetSeasons([id]);
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
    seasons: readSeasons().map(snapshotOf),
  };
};

const snapshotOf = (season: SeasonMeta): SeasonSnapshot => ({
  ...season,
  teams: loadTeamsFor(season.id),
  matchups: loadMatchupsFor(season.id),
  logs: loadLogsFor(season.id),
  bracketLogs: loadBracketLogsForSeason(season.id),
  settings: loadSettingsFor(season.id),
});

/** One season and all of its data, as a backup carries it, or null for a season not here. */
export const readSeasonSnapshot = (id: string): SeasonSnapshot | null => {
  ensureInitialized();
  const season = readSeasons().find((one) => one.id === id);
  return season ? snapshotOf(season) : null;
};

/**
 * Replace the whole multi-season layout with a restored one: every season currently stored is
 * cleared first, so a season absent from the backup does not survive the restore. Refuses an
 * empty season list rather than leaving the app with no season to open. `renamed` names this
 * device's seasons that a cloud merge gave new ids (`leagueMerge.ts`), each now under its new id.
 */
export const replaceLeagueSnapshot = (
  snapshot: LeagueSnapshot,
  {
    fromCloud = false,
    renamed = {},
  }: { fromCloud?: boolean; renamed?: Readonly<Record<string, string>> } = {}
): boolean => {
  ensureInitialized();
  if (!snapshot.seasons.length) return false;
  // The cloud copy's own seasons arriving are no change made here, and owe it nothing.
  if (fromCloud) arriving += 1;
  try {
    return replaceSeasons(snapshot, renamed);
  } finally {
    if (fromCloud) arriving -= 1;
  }
};

/**
 * Adds seasons this browser does not hold, each under its own id, after those it has: seasons made
 * on another device and taken in from the cloud (`leagueSeasons.ts`). A season whose id is already
 * here is left as it is. Written as the cloud's own arriving, which owes the cloud copy nothing.
 */
export const addSeasons = (seasons: readonly SeasonSnapshot[]): boolean => {
  ensureInitialized();
  const held = readSeasons();
  const taken = new Set(held.map((season) => season.id));
  const fresh = seasons.filter((season) => !taken.has(season.id));
  if (fresh.length === 0) return true;
  arriving += 1;
  try {
    let ok = true;
    fresh.forEach((season) => {
      const write = (dataKey: DataKey, value: unknown) => {
        if (!safeSet(seasonKey(season.id, dataKey), JSON.stringify(value))) ok = false;
      };
      write("teams", season.teams);
      write("matchups", season.matchups);
      write("logs", season.logs);
      write("bracketLogs", season.bracketLogs);
      write("settings", season.settings);
    });
    const meta = fresh.map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      ...(updatedAt ? { updatedAt } : {}),
    }));
    if (writeSeasons([...held, ...meta])) forgetSeasons(fresh.map((season) => season.id));
    else ok = false;
    return ok;
  } finally {
    arriving -= 1;
  }
};

const replaceSeasons = (
  snapshot: LeagueSnapshot,
  renamed: Readonly<Record<string, string>>
): boolean => {
  const held = readSeasons();
  held.forEach((season) => {
    DATA_KEYS.forEach((dataKey) => safeRemove(seasonKey(season.id, dataKey)));
  });
  /*
   * A season held here and carried again, made at the same moment, is still that season and keeps
   * what this device kept of it. One the snapshot leaves out has left this browser; one under an
   * id held for a season made at another moment, or under an id not held, is a season new here.
   * A time missing on either side, as on a season from before they were kept, says nothing.
   */
  const madeAt = new Map(held.map((season) => [season.id, season.createdAt]));
  const same = new Set(
    snapshot.seasons
      .filter((season) => {
        const was = madeAt.get(season.id);
        return (
          was !== undefined && (was === "" || season.createdAt === "" || was === season.createdAt)
        );
      })
      .map((season) => season.id)
  );
  const left = [...held, ...snapshot.seasons]
    .map((season) => season.id)
    .filter((id) => !same.has(id));
  /*
   * A season of this device's that a merge gave a new id is still this device's season, under the
   * new id, and what was kept of it goes there; its old id is now the other side's season. Only a
   * season held here and carried under the new id is moved.
   */
  const carried = new Set(snapshot.seasons.map((season) => season.id));
  const moved = Object.fromEntries(
    Object.entries(renamed).filter(([from, to]) => madeAt.has(from) && carried.has(to))
  );

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

  // Each season's last-changed time goes back with it: dropped, a restored or cloud-taken league
  // would never be the same value it was, and the next comparison would call it changed.
  const meta = snapshot.seasons.map(({ id, name, createdAt, updatedAt }) => ({
    id,
    name,
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
  }));
  // As in `deleteSeason`, nothing is let go of until the list says the seasons have gone.
  if (writeSeasons(meta)) forgetSeasons(left, { moved });
  else ok = false;
  // A pointer at a season the backup does not carry would leave the app on an empty season.
  const active = meta.some((season) => season.id === snapshot.activeSeasonId)
    ? snapshot.activeSeasonId
    : meta[0]!.id;
  if (!writeActive(active)) ok = false;
  return ok;
};
