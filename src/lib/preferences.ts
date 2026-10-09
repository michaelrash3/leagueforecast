/**
 * The UI preferences that persist outside the league and Team Rankings data: colour theme, which
 * half of the app you were last in, and whether the written summaries fetch themselves. They live
 * here rather than inside their hooks so a whole-browser backup can read and restore them without
 * duplicating the storage keys.
 */
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

const LIVE_BOARD_KEY = "lf_live_v1";
const liveBoardListeners = new Set<() => void>();

/**
 * Whether Team Rankings opens on the cloud's published board on this device (`LiveTeamRankings`)
 * for a member: on unless turned off in the Cloud panel (1.6e), and then off until turned on again,
 * so the word kept is the member's choice either way. Kept per device, never in a backup or the
 * cloud copy, and cleared with the rest of the app's keys by a reset, which puts it back on.
 */
export const readLiveBoard = (): boolean => safeGet(LIVE_BOARD_KEY) !== "off";

export const writeLiveBoard = (on: boolean): boolean => {
  const written = safeSet(LIVE_BOARD_KEY, on ? "on" : "off");
  liveBoardListeners.forEach((listener) => listener());
  return written;
};

/** Calls `listener` whenever the switch is written here; for `useSyncExternalStore`. */
export const subscribeLiveBoard = (listener: () => void): (() => void) => {
  liveBoardListeners.add(listener);
  return () => {
    liveBoardListeners.delete(listener);
  };
};

const LIVE_LEAGUE_KEY = "lf_live_league_v1";
const liveLeagueListeners = new Set<() => void>();

/**
 * Whether League Standings is kept live with the cloud on this device (`leagueSync.ts`) for a
 * member: each season one document, written as it is edited and taken in as other devices edit it,
 * in place of the cloud copy's League part. On unless turned off in the Cloud panel (1.6e), and then
 * off until turned on again, the word kept being the member's choice either way. Kept per device,
 * never in a backup or the cloud copy, and cleared with the rest of the app's keys by a reset, which
 * puts it back on. A device turned off keeps League in the copy, apart from the devices kept live.
 */
export const readLiveLeague = (): boolean => safeGet(LIVE_LEAGUE_KEY) !== "off";

export const writeLiveLeague = (on: boolean): boolean => {
  const written = safeSet(LIVE_LEAGUE_KEY, on ? "on" : "off");
  liveLeagueListeners.forEach((listener) => listener());
  return written;
};

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
  liveLeagueListeners.forEach((listener) => listener());
  return written;
};

/** Calls `listener` whenever League's switch is written here; for `useSyncExternalStore`. */
export const subscribeLiveLeague = (listener: () => void): (() => void) => {
  liveLeagueListeners.add(listener);
  return () => {
    liveLeagueListeners.delete(listener);
  };
};
