import { areaOf, type Area } from "./cloudPlan";

/**
 * What this browser knows of its cloud copy, kept between visits in `localStorage` beside the
 * data it describes. Deliberately not a key the cloud copy holds: it says where *this* device
 * stands, and another device taking it would be told it is somewhere it is not.
 *
 * Three kinds of record, under three kinds of key:
 * - the device's standing (`CLOUD_STATE_KEY`): whose record this is, which copy each area last
 *   met, each key's fingerprint as of then, and pieces uploaded by saves not known to have landed;
 * - the changes it owes the copy, one key each (`OWED_PREFIX`), so a mark made in one tab can
 *   never be written over by another tab saving the standing: a lost mark is a change never sent;
 * - the League Standings as this device and the copy last agreed on them (`BASE_KEY`), which is
 *   what a three-way merge of the seasons starts from.
 */
export type DeviceCloudState = {
  /** Whether this browser keeps a cloud copy now: on at sign-in, off at sign-out. */
  enabled: boolean;
  /** This browser, so a manifest can say which device saved it. Random, and made once. */
  device: string;
  /**
   * The account this record belongs to, kept through a sign-out: the same account signing in again
   * picks up where it left off, changes made in between included.
   */
  uid: string | null;
  /** The copy each area last met. */
  met: Partial<Record<Area, string>>;
  /** The copy and version this device last read, for saying whether anything moved. */
  copy: string | null;
  version: number | null;
  /** Each key's fingerprint as of the last time this device and the copy agreed on it. */
  hashes: Record<string, string>;
  syncedAt?: string;
  /** Pieces uploaded by saves not known to have landed, cleared once the copy is read again. */
  uploads: string[];
};

export const CLOUD_STATE_KEY = "league_forecast_cloud_v2";
const OWED_PREFIX = "league_forecast_cloud_owed:";
const BASE_KEY = "league_forecast_cloud_base_v2";

const newDevice = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringsOf = (raw: unknown): Record<string, string> =>
  isRecord(raw)
    ? Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : {};

const readJson = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

/** The stored standing, or a fresh one for a browser that has never kept a cloud copy. */
export const loadCloudState = (): DeviceCloudState => {
  const raw = readJson(CLOUD_STATE_KEY);
  const stored = isRecord(raw) ? raw : {};
  const met = stringsOf(stored.met);
  return {
    enabled: stored.enabled === true,
    device: typeof stored.device === "string" && stored.device ? stored.device : newDevice(),
    uid: typeof stored.uid === "string" && stored.uid ? stored.uid : null,
    met: {
      ...(met.league ? { league: met.league } : {}),
      ...(met.pool ? { pool: met.pool } : {}),
    },
    copy: typeof stored.copy === "string" && stored.copy ? stored.copy : null,
    version:
      typeof stored.version === "number" && Number.isInteger(stored.version)
        ? stored.version
        : null,
    hashes: stringsOf(stored.hashes),
    ...(typeof stored.syncedAt === "string" ? { syncedAt: stored.syncedAt } : {}),
    uploads: Array.isArray(stored.uploads)
      ? stored.uploads.filter((id): id is string => typeof id === "string")
      : [],
  };
};

/**
 * Saves the standing, and says whether it landed, read back: a tab that went on as though a take
 * were recorded when it was not would take it again at every start, and tell every other tab to
 * reload each time.
 */
export const saveCloudState = (state: DeviceCloudState): boolean => {
  const text = JSON.stringify(state);
  try {
    localStorage.setItem(CLOUD_STATE_KEY, text);
    return localStorage.getItem(CLOUD_STATE_KEY) === text;
  } catch {
    return false;
  }
};

/** Every change this device owes the copy: key, and when it was last made (ms). */
export const owedChanges = (): Record<string, number> => {
  const owed: Record<string, number> = {};
  try {
    for (let at = 0; at < localStorage.length; at += 1) {
      const name = localStorage.key(at);
      if (!name?.startsWith(OWED_PREFIX)) continue;
      const when = Number(localStorage.getItem(name));
      if (Number.isFinite(when)) owed[name.slice(OWED_PREFIX.length)] = when;
    }
  } catch {
    /* a storage that cannot be read owes nothing it can say */
  }
  return owed;
};

/** The changes owed in one area. */
export const owedIn = (area: Area): Record<string, number> =>
  Object.fromEntries(Object.entries(owedChanges()).filter(([key]) => areaOf(key) === area));

/**
 * Records that a key changed here, whenever this browser has a record at all: signed in, or signed
 * out with the same account to come back to. The time only ever moves forward for a key, so two
 * writes in one millisecond are still two, and a save that read the first cannot take away the
 * second.
 */
export const markCloudDirty = (key: string): void => {
  if (loadCloudState().uid === null) return;
  try {
    const name = `${OWED_PREFIX}${key}`;
    const before = Number(localStorage.getItem(name) ?? "0");
    const at = Math.max(Date.now(), (Number.isFinite(before) ? before : 0) + 1);
    localStorage.setItem(name, String(at));
  } catch {
    /* a full localStorage costs this mark; the next write makes it again */
  }
};

/**
 * Takes away the mark for a change that has been sent (or settled), unless the key changed again
 * since: `at` is the time the mark had when the save read it.
 */
export const settleOwed = (key: string, at: number): void => {
  try {
    const name = `${OWED_PREFIX}${key}`;
    if (Number(localStorage.getItem(name)) === at) localStorage.removeItem(name);
  } catch {
    /* left owed: sent again, which changes nothing */
  }
};

/** Takes away every mark, whatever it says: a record started afresh. */
export const clearOwed = (): void => {
  for (const key of Object.keys(owedChanges())) {
    try {
      localStorage.removeItem(`${OWED_PREFIX}${key}`);
    } catch {
      /* nothing more to do */
    }
  }
};

export type LeagueBase = { hash: string; value: unknown };

/** The League Standings this device and the copy last agreed on, or null if it has none. */
export const loadLeagueBase = (): LeagueBase | null => {
  const raw = readJson(BASE_KEY);
  return isRecord(raw) && typeof raw.hash === "string" && "value" in raw
    ? { hash: raw.hash, value: raw.value }
    : null;
};

/** Records the League Standings both sides now hold. A full storage costs a two-way merge later. */
export const saveLeagueBase = (base: LeagueBase | null): void => {
  try {
    if (base) localStorage.setItem(BASE_KEY, JSON.stringify(base));
    else localStorage.removeItem(BASE_KEY);
  } catch {
    /* without a base, the next merge of both sides' changes keeps everything either holds */
  }
};

/**
 * Forgets this browser's cloud copy entirely, before anything else is written: a browser whose data
 * is being wiped must not record the wiping as changes owed to every other device.
 */
export const forgetCloudCopyHere = (): void => {
  clearOwed();
  saveLeagueBase(null);
  try {
    localStorage.removeItem(CLOUD_STATE_KEY);
  } catch {
    /* the reset removes it with everything else */
  }
};
