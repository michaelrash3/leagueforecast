import { isNumber, isRecord, isString } from "./validate";

export const NOTIFICATION_PREFERENCES_VERSION = 1 as const;
export type NotificationEventKind =
  | "final-score"
  | "schedule-change"
  | "clinch"
  | "elimination"
  | "forecast-change"
  | "refresh-failure";

export type NotificationPreferences = {
  version: typeof NOTIFICATION_PREFERENCES_VERSION;
  enabled: boolean;
  finalScores: boolean;
  scheduleChanges: boolean;
  clinches: boolean;
  eliminations: boolean;
  forecastChanges: boolean;
  forecastThreshold: number;
  refreshFailures: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  version: NOTIFICATION_PREFERENCES_VERSION,
  enabled: false,
  finalScores: true,
  scheduleChanges: true,
  clinches: true,
  eliminations: true,
  forecastChanges: false,
  forecastThreshold: 10,
  refreshFailures: true,
};

export type NotificationEvent = {
  id: string;
  kind: NotificationEventKind;
  occurredAt: string;
  title: string;
  detail: string;
  teamId?: string;
  changePercent?: number;
};

export type NotificationDigest = { id: string; title: string; body: string; eventIds: string[] };

const enabledKind = (event: NotificationEvent, preferences: NotificationPreferences): boolean => {
  if (!preferences.enabled) return false;
  if (event.kind === "final-score") return preferences.finalScores;
  if (event.kind === "schedule-change") return preferences.scheduleChanges;
  if (event.kind === "clinch") return preferences.clinches;
  if (event.kind === "elimination") return preferences.eliminations;
  if (event.kind === "refresh-failure") return preferences.refreshFailures;
  return (
    preferences.forecastChanges &&
    Math.abs(event.changePercent ?? 0) >= preferences.forecastThreshold
  );
};

/** Deduplicates retries, filters opt-outs, and combines a refresh batch into one notification. */
export const buildNotificationDigest = (
  events: readonly NotificationEvent[],
  preferences: NotificationPreferences,
  deliveredIds: ReadonlySet<string>
): NotificationDigest | null => {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()].filter(
    (event) => !deliveredIds.has(event.id) && enabledKind(event, preferences)
  );
  if (unique.length === 0) return null;
  const counts = new Map<NotificationEventKind, number>();
  unique.forEach((event) => counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1));
  const labels: Record<NotificationEventKind, string> = {
    "final-score": "final score",
    "schedule-change": "schedule change",
    clinch: "clinch",
    elimination: "elimination",
    "forecast-change": "forecast change",
    "refresh-failure": "refresh issue",
  };
  const summary = [...counts]
    .map(([kind, count]) => `${count} ${labels[kind]}${count === 1 ? "" : "s"}`)
    .join(", ");
  return {
    id: unique
      .map((event) => event.id)
      .sort()
      .join("|"),
    title: unique.length === 1 ? unique[0]!.title : `${unique.length} league updates`,
    body: unique.length === 1 ? unique[0]!.detail : summary,
    eventIds: unique.map((event) => event.id),
  };
};

export const coerceNotificationPreferences = (raw: unknown): NotificationPreferences => {
  if (!isRecord(raw) || raw.version !== NOTIFICATION_PREFERENCES_VERSION) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  const boolean = (key: keyof NotificationPreferences, fallback: boolean) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;
  return {
    version: NOTIFICATION_PREFERENCES_VERSION,
    enabled: boolean("enabled", false),
    finalScores: boolean("finalScores", true),
    scheduleChanges: boolean("scheduleChanges", true),
    clinches: boolean("clinches", true),
    eliminations: boolean("eliminations", true),
    forecastChanges: boolean("forecastChanges", false),
    forecastThreshold: isNumber(raw.forecastThreshold)
      ? Math.max(1, Math.min(100, raw.forecastThreshold))
      : 10,
    refreshFailures: boolean("refreshFailures", true),
  };
};

const PREFERENCES_KEY = "league_forecast_notifications_v1";
const DEVICE_KEY = "league_forecast_notification_device_v1";
const DELIVERED_KEY = "league_forecast_notification_delivered_v1";

export const loadNotificationPreferences = (): NotificationPreferences => {
  try {
    return coerceNotificationPreferences(
      JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null")
    );
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
};
export const saveNotificationPreferences = (value: NotificationPreferences): boolean => {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const notificationDeviceId = (): string => {
  try {
    const held = localStorage.getItem(DEVICE_KEY);
    if (held) return held;
    const id = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "device-unavailable";
  }
};

export const loadDeliveredNotificationIds = (): Set<string> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DELIVERED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter(isString).slice(-500) : []);
  } catch {
    return new Set();
  }
};
export const rememberDeliveredNotificationIds = (ids: readonly string[]): boolean => {
  try {
    const merged = [...new Set([...loadDeliveredNotificationIds(), ...ids])].slice(-500);
    localStorage.setItem(DELIVERED_KEY, JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
};
