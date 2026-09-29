import type { SyncState } from "./cloudEngine";

/**
 * What this browser knows of its cloud copy, kept between visits in `localStorage` beside the
 * data it describes. Deliberately not a key the cloud copy holds: it says where *this* device
 * stands, and another device taking it would be told it is somewhere it is not.
 */
export type DeviceCloudState = SyncState & {
  /** Whether this browser keeps a cloud copy: on from its first sign-in, off once signed out. */
  enabled: boolean;
  /** This browser, so a manifest can say which device saved it. Random, and made once. */
  device: string;
};

export const CLOUD_STATE_KEY = "league_forecast_cloud_v1";

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

const numbersOf = (raw: unknown): Record<string, number> =>
  isRecord(raw)
    ? Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1])
        )
      )
    : {};

/** The stored state, or a fresh one for a browser that has never kept a cloud copy. */
export const loadCloudState = (): DeviceCloudState => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(CLOUD_STATE_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const stored = isRecord(raw) ? raw : {};
  return {
    enabled: stored.enabled === true,
    device: typeof stored.device === "string" && stored.device ? stored.device : newDevice(),
    version:
      typeof stored.version === "number" && Number.isInteger(stored.version)
        ? stored.version
        : null,
    hashes: stringsOf(stored.hashes),
    dirty: numbersOf(stored.dirty),
    ...(typeof stored.syncedAt === "string" ? { syncedAt: stored.syncedAt } : {}),
  };
};

export const saveCloudState = (state: DeviceCloudState): void => {
  try {
    localStorage.setItem(CLOUD_STATE_KEY, JSON.stringify(state));
  } catch {
    /* a full localStorage costs a save being owed, and the next write says so again */
  }
};

/**
 * Records that a key changed here. The time only ever moves forward for a key, so two writes in
 * one millisecond are still two, and a save that read the first cannot take away the second.
 */
export const markCloudDirty = (key: string): void => {
  const state = loadCloudState();
  if (!state.enabled) return;
  const at = Math.max(Date.now(), (state.dirty[key] ?? 0) + 1);
  saveCloudState({ ...state, dirty: { ...state.dirty, [key]: at } });
};
