/**
 * When each kind of backup was last downloaded, so the app can say so beside the button.
 *
 * All data lives in one browser, and the only copy anywhere else is a file somebody remembered to
 * download. Clearing site data, a dead laptop, or Safari's seven-day eviction of storage loses a
 * season, and nothing on screen said how long it had been. Two kinds, because they are two files:
 * the whole-browser backup on the League Standings side and the Team Rankings pool on its own.
 *
 * `localStorage` rather than the pool's store on purpose: it is a note about the browser, not part
 * of any season, and it must survive a Team Rankings reset.
 */
export type BackupKind = "league" | "pool";

const KEY = "league_forecast_last_backup_v1";

/** Beyond this many days without a backup the reminder turns amber. */
export const BACKUP_REMINDER_DAYS = 14;

const read = (): Partial<Record<BackupKind, string>> => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<BackupKind, string>> = {};
    const record = parsed as Record<string, unknown>;
    if (typeof record.league === "string") out.league = record.league;
    if (typeof record.pool === "string") out.pool = record.pool;
    return out;
  } catch {
    return {};
  }
};

/** Records that a backup of `kind` was just downloaded. Quietly does nothing where storage refuses. */
export const noteBackupTaken = (kind: BackupKind, at: string = new Date().toISOString()): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [kind]: at }));
  } catch {
    /* a reminder that cannot be stored is not worth failing a download over */
  }
};

/** When a backup of `kind` was last downloaded, or null for never. */
export const lastBackupTakenAt = (kind: BackupKind): string | null => read()[kind] ?? null;
