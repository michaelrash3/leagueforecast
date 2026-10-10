/**
 * The UI preferences that persist outside the league and Team Rankings data: colour theme, which
 * half of the app you were last in, and whether the written summaries fetch themselves. They live
 * here rather than inside their hooks so a whole-browser backup can read and restore them without
 * duplicating the storage keys.
 */
import type { FindingSeverity } from "./leagueFindings";
import {
  DEFAULT_NOTIFY,
  coerceNotifyPrefs,
  coerceSeen,
  type NotifyPrefs,
  type SeasonSeen,
} from "./seasonDigest";

export type Theme = "light" | "dark";
export type AppMode = "league" | "rankings";

/**
 * Whether a written summary goes and gets itself, or waits to be asked for.
 *
 * `ask` is the default, and it is the default because the summaries are not free. Each one is a
 * call to somebody's language-model quota, and they were being made on their own: the request is
 * rebuilt whenever its content changes, so switching age group or picking a different team in
 * Team Rankings sent another. A few minutes of clicking around cost a few dozen write-ups nobody
 * had asked to read.
 */
export type SummaryMode = "ask" | "auto";

const THEME_KEY = "nkb_theme_v1";
const APP_MODE_KEY = "lf_app_mode_v1";
const SUMMARY_MODE_KEY = "lf_summary_mode_v1";

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

/**
 * Calls `listener` when another tab of the app writes `key`, or clears storage whole (a null key).
 * The browser tells every other tab and never the one that wrote, so there is no echo to filter.
 */
const onWrittenElsewhere = (key: string, listener: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const heard = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener("storage", heard);
  return () => window.removeEventListener("storage", heard);
};

export const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";
export const isAppMode = (value: unknown): value is AppMode =>
  value === "league" || value === "rankings";

export const readTheme = (): Theme | null => {
  const raw = safeGet(THEME_KEY);
  return isTheme(raw) ? raw : null;
};
export const writeTheme = (theme: Theme): boolean => safeSet(THEME_KEY, theme);

export const readAppMode = (): AppMode | null => {
  const raw = safeGet(APP_MODE_KEY);
  return isAppMode(raw) ? raw : null;
};
export const writeAppMode = (mode: AppMode): boolean => safeSet(APP_MODE_KEY, mode);

export const isSummaryMode = (value: unknown): value is SummaryMode =>
  value === "ask" || value === "auto";

/** Unset reads as `ask`: a summary nobody chose to fetch is a summary nobody chose to pay for. */
export const readSummaryMode = (): SummaryMode => {
  const raw = safeGet(SUMMARY_MODE_KEY);
  return isSummaryMode(raw) ? raw : "ask";
};
export const writeSummaryMode = (mode: SummaryMode): boolean => safeSet(SUMMARY_MODE_KEY, mode);

const OUR_TEAM_KEY = "lf_our_team_v1";

const readOurTeams = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(safeGet(OUR_TEAM_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
};

/**
 * The league team this browser follows, for the Dashboard's "Our team" card, one per season.
 *
 * Kept here and not in Settings, because Settings travel in a shared link and a backup of the
 * season: a parent's own team is theirs, and the coach they send the standings to follows another.
 */
export const readOurTeam = (seasonId: string): string | null => readOurTeams()[seasonId] ?? null;

export const writeOurTeam = (seasonId: string, teamId: string | null): boolean => {
  const all = readOurTeams();
  if (teamId === null) delete all[seasonId];
  else all[seasonId] = teamId;
  return safeSet(OUR_TEAM_KEY, JSON.stringify(all));
};

const PUT_ASIDE_KEY = "lf_league_findings_put_aside_v1";

const SEVERITIES: readonly string[] = ["attention", "review", "info"];

const readAllPutAside = (): Record<string, Record<string, FindingSeverity>> => {
  try {
    const parsed: unknown = JSON.parse(safeGet(PUT_ASIDE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([seasonId, entries]: [string, unknown]) =>
        entries && typeof entries === "object" && !Array.isArray(entries)
          ? [
              [
                seasonId,
                Object.fromEntries(
                  Object.entries(entries).filter(
                    (entry): entry is [string, FindingSeverity] =>
                      typeof entry[1] === "string" && SEVERITIES.includes(entry[1])
                  )
                ),
              ],
            ]
          : []
      )
    );
  } catch {
    return {};
  }
};

/**
 * The League data-quality findings put aside on this device, one set per season: each finding's
 * fingerprint, with the severity it had when put aside (`isDismissed`, 2.3). Kept here and not in
 * the season, like the team this browser follows: what one commissioner has looked at and decided
 * to live with is theirs, and the season's document and backups carry the season.
 */
export const readPutAside = (seasonId: string): Record<string, FindingSeverity> =>
  readAllPutAside()[seasonId] ?? {};

export const writePutAside = (
  seasonId: string,
  putAside: Readonly<Record<string, FindingSeverity>>
): boolean => {
  const all = readAllPutAside();
  if (Object.keys(putAside).length === 0) delete all[seasonId];
  else all[seasonId] = { ...putAside };
  return safeSet(PUT_ASIDE_KEY, JSON.stringify(all));
};

const DEFAULT_AGE_KEY = "lf_rankings_default_age_v1";

/**
 * The age group Team Rankings opens on when the URL names none, kept as the group grows up: the
 * level it was picked at and the squad year it was picked in. A team is a year older every season,
 * and the user's rule was "If I have 9u as my default in 2027, I will want 10u as my default in
 * 2028", so the pick is read as a class, `year − level`, whose level in any year is that year less
 * the class (`defaultLevelIn`).
 */
export type DefaultAge = { level: number; year: number };

export const readDefaultAge = (): DefaultAge | null => {
  try {
    const parsed: unknown = JSON.parse(safeGet(DEFAULT_AGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { level, year } = parsed as Record<string, unknown>;
    return typeof level === "number" &&
      Number.isInteger(level) &&
      level > 0 &&
      typeof year === "number" &&
      Number.isInteger(year)
      ? { level, year }
      : null;
  } catch {
    return null;
  }
};

/** Keeps `pick` as the default age, or forgets it for `null`. */
export const writeDefaultAge = (pick: DefaultAge | null): boolean => {
  if (pick !== null) return safeSet(DEFAULT_AGE_KEY, JSON.stringify(pick));
  try {
    localStorage.removeItem(DEFAULT_AGE_KEY);
    return true;
  } catch {
    return false;
  }
};

/** The level the default age's class plays at in squad year `year`: 9U in 2027 is 10U in 2028. */
export const defaultLevelIn = (pick: DefaultAge, year: number): number =>
  year - (pick.year - pick.level);

/** Listeners told when this device first meets the cloud's League documents (`noteLeagueMet`). */
const leagueMetListeners = new Set<() => void>();

const LEAGUE_MET_KEY = "lf_league_met_v1";

/**
 * The account this device first met the cloud's League Standings documents as (`meetSeasons`), once
 * it has. Until then the cloud copy still brings League in here, so a device going live for the
 * first time is in step with the copy before its seasons meet the cloud's, and sends the copy's
 * seasons up rather than older ones of its own (`cloudSession.ts`). Kept per device, whichever
 * account is signed in after, since every account on the list shares one cloud, and cleared with
 * the rest of the app's keys by a reset.
 */
export const leagueMetAs = (): string | null => safeGet(LEAGUE_MET_KEY);

/** Notes that this device has met the cloud's League documents as `uid`, and says so. */
export const noteLeagueMet = (uid: string): boolean => {
  const written = safeSet(LEAGUE_MET_KEY, uid);
  leagueMetListeners.forEach((listener) => listener());
  return written;
};

/** Calls `listener` whenever this device's first meeting is noted; for `useSyncExternalStore`. */
export const subscribeLeagueMet = (listener: () => void): (() => void) => {
  leagueMetListeners.add(listener);
  return () => {
    leagueMetListeners.delete(listener);
  };
};

const SEEN_KEY = "lf_league_seen_v1";
/** Seasons whose last look is kept; a device follows a handful, and older ones fall away. */
const SEEN_KEPT = 12;

const readAllSeen = (): Record<string, { at: number; seen: unknown }> => {
  try {
    const parsed: unknown = JSON.parse(safeGet(SEEN_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, { at: number; seen: unknown }] =>
          !!entry[1] &&
          typeof entry[1] === "object" &&
          typeof (entry[1] as { at?: unknown }).at === "number"
      )
    );
  } catch {
    return {};
  }
};

/**
 * The season as this device last looked at it (2.6, `useSeasonDigest`), or null for a season it
 * has never kept a look at. Kept per device, like the findings put aside: what one person has seen
 * is theirs, not the season's.
 */
export const readSeen = (seasonId: string): SeasonSeen | null =>
  coerceSeen(readAllSeen()[seasonId]?.seen);

export const writeSeen = (seasonId: string, seen: SeasonSeen, now = Date.now()): boolean => {
  // The season written first, whatever the clock says of the others: never the one let go.
  const others = Object.entries(readAllSeen())
    .filter(([id]) => id !== seasonId)
    .sort(([, one], [, two]) => two.at - one.at);
  const kept = [[seasonId, { at: now, seen }] as const, ...others].slice(0, SEEN_KEPT);
  return safeSet(SEEN_KEY, JSON.stringify(Object.fromEntries(kept)));
};

/** Calls `listener` when another tab keeps a look (`writeSeen`), which `readSeen` then has. */
export const subscribeSeen = (listener: () => void): (() => void) =>
  onWrittenElsewhere(SEEN_KEY, listener);

const NOTIFY_KEY = "lf_league_notify_v1";

/** Which League changes this device notifies of (2.6), off until turned on. */
export const readNotifyPrefs = (): NotifyPrefs => {
  try {
    return coerceNotifyPrefs(JSON.parse(safeGet(NOTIFY_KEY) ?? "null"));
  } catch {
    return DEFAULT_NOTIFY;
  }
};

export const writeNotifyPrefs = (prefs: NotifyPrefs): boolean =>
  safeSet(NOTIFY_KEY, JSON.stringify(prefs));

/**
 * Calls `listener` when another tab changes the notification choices: the installed app and a
 * browser tab are two tabs of one device, and a choice turned off in one is off in both.
 */
export const subscribeNotifyPrefs = (listener: () => void): (() => void) =>
  onWrittenElsewhere(NOTIFY_KEY, listener);

const NOTIFIED_KEY = "lf_league_notified_v1";
/** The newest announcements remembered, far more than a season makes between two looks. */
const NOTIFIED_KEPT = 400;

/** What this device has already announced, so no change is announced twice (2.6). */
export const readNotified = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(safeGet(NOTIFIED_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []
    );
  } catch {
    return new Set();
  }
};

export const writeNotified = (keys: ReadonlySet<string>): boolean =>
  safeSet(NOTIFIED_KEY, JSON.stringify([...keys].slice(-NOTIFIED_KEPT)));
