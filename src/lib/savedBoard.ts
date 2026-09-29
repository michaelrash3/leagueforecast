import { idbGet, idbSet } from "./idb";
import type { ScoutRankingRow, SeasonSegment } from "./teamRankings";

/**
 * The last board Team Rankings showed, kept on this device so the next open shows it at once.
 *
 * A board on a nationwide pool is a fit of every game in its year, and the first one after an open
 * is seconds of work before a single row appears: on the 114,500-team pool of 29 September 2026 the
 * rows came up 8 s after the page did, and the page said "Add a game" until then. Kept here, the
 * rows of the board that was up when the page was left come up with the page, marked as refitting
 * exactly as a board is while it refits after an edit, and the fit replaces them when it lands.
 *
 * It is never taken for the answer. It is shown only until this open's own fit comes back, and only
 * on the page it was fitted for (the age group, the half, and the club marked as the user's own),
 * so a stale one costs a few seconds of last visit's numbers under a "Refitting…" and nothing else.
 * That is also why nothing needs to invalidate it: every open refits.
 *
 * One board, the last one fitted, under a key of its own in the pool's IndexedDB store: not a pool
 * key, so it is never read as the pool, never sent to the cloud copy, and gone with a reset. Read
 * before the app mounts, beside the pool (`main.tsx`), so the first render can show it.
 */

const KEY = "league_forecast_saved_board_v1";

/** The page a board belongs to: every input it was fitted for except the pool itself. */
export type BoardPage = { ageGroupId: string; segment?: SeasonSegment; myTeamId?: string };

type Saved = { page: string; rows: ScoutRankingRow[] };

export const boardPageKey = (page: BoardPage): string =>
  JSON.stringify([page.ageGroupId, page.segment ?? "", page.myTeamId ?? ""]);

/** What the store is reached through; IndexedDB's, but for a test. */
export type SavedBoardIo = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<boolean>;
};
const idbIo: SavedBoardIo = { get: idbGet, set: idbSet };

let held: Saved | null = null;

/**
 * A stored board, or null for anything else. Rows are checked for what the board reads off every
 * one of them, so a board from a build that kept different rows is dropped rather than drawn.
 */
const coerce = (raw: unknown): Saved | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { page, rows } = raw as { page?: unknown; rows?: unknown };
  if (typeof page !== "string" || !Array.isArray(rows)) return null;
  const readable = rows.every(
    (row: unknown) =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as ScoutRankingRow).teamId === "string" &&
      typeof (row as ScoutRankingRow).teamName === "string" &&
      typeof (row as ScoutRankingRow).rank === "number" &&
      typeof (row as ScoutRankingRow).rating === "number"
  );
  return readable ? { page, rows: rows as ScoutRankingRow[] } : null;
};

/** Reads the saved board into memory. Never throws: without one, the page waits for its fit. */
export const loadSavedBoard = async (io: SavedBoardIo = idbIo): Promise<void> => {
  try {
    held = coerce(await io.get(KEY));
  } catch {
    held = null;
  }
};

/** The saved board's rows, if it was fitted for `page`. */
export const savedBoardFor = (page: BoardPage): ScoutRankingRow[] | null =>
  held !== null && held.page === boardPageKey(page) ? held.rows : null;

/**
 * Keeps `rows` as the board to open on, in place of whatever was kept. The write is left to the
 * store and not waited on: a board that fails to keep costs the next open its head start, and
 * nothing else.
 */
export const saveBoard = (page: BoardPage, rows: ScoutRankingRow[], io: SavedBoardIo = idbIo) => {
  held = { page: boardPageKey(page), rows };
  void io.set(KEY, held).catch(() => false);
};

/** Only for tests: forgets the board held in memory. */
export const resetSavedBoard = (): void => {
  held = null;
};
