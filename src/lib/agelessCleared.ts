/**
 * The last bulk pass over the teams waiting on an age, kept whole so it can be taken back.
 *
 * Throwing out one team needs no record: the row is one of ten on screen, the toast carries an
 * undo, and a team that gets past it is still findable by name on the card. A pass that clears
 * four and a half thousand rows in one click is a different thing. Nobody can check it by eye
 * afterwards, the toast is gone in seconds, and the rows it removed are the only evidence that
 * the teams were ever asked about — everything else about them was refused at the door and never
 * filed. So the pass is stored, whole, and "undo that" stays available after the toast is not.
 *
 * One pass, not a history. What somebody wants is to take back the thing they just did, and
 * keeping every pass would pile up megabytes of rows against a need nobody has expressed. A new
 * pass replaces the last, which is also what makes the size bounded.
 *
 * It rides at a lazy key rather than in the pool cache, for the reason `GC_TRACK_KEY` gives: it
 * is read only when somebody asks to undo, and a row per cleared team is tens of thousands of
 * objects that every page would otherwise hold for the sake of a button on one of them.
 */

import { coerceAgeUnknown, type AgeUnknownList, type AgeUnknownTeam } from "./ageUnknown";

/**
 * Why a row was cleared: GameChanger's own two answers, and the three the user settled by rule on
 * 23 September 2026 — named void, tee ball and younger, and rec ball in a closed league.
 */
export type AgelessClearedReason = "not-youth" | "high-school" | "not-real" | "too-young" | "rec";

const REASONS: readonly AgelessClearedReason[] = [
  "not-youth",
  "high-school",
  "not-real",
  "too-young",
  "rec",
];

/** Whether a verdict is one a pass can record, so the caller never has to cast one. */
export const isClearedReason = (kind: string): kind is AgelessClearedReason =>
  (REASONS as readonly string[]).includes(kind);

export type AgelessClearedRow = {
  entry: AgeUnknownTeam;
  why: AgelessClearedReason;
};

export type AgelessClearedPass = {
  version: 1;
  /** When the pass ran, so the undo can name the day. */
  clearedAt: string;
  rows: AgelessClearedRow[];
};

export const AGELESS_CLEARED_VERSION = 1;

/**
 * Whatever was stored, as a pass.
 *
 * Strict about the version and lenient about everything inside it, the way the other readers
 * here are: a row that cannot be read is dropped rather than failing the pass, because a partly
 * readable undo restores most of the work and a refused one restores none of it.
 */
export const coerceAgelessCleared = (raw: unknown): AgelessClearedPass | null => {
  if (!raw || typeof raw !== "object") return null;
  const pass = raw as Partial<AgelessClearedPass>;
  if (pass.version !== AGELESS_CLEARED_VERSION) return null;
  if (!Array.isArray(pass.rows)) return null;
  const rows: AgelessClearedRow[] = [];
  pass.rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const one = row as Partial<AgelessClearedRow>;
    const why = REASONS.find((reason) => reason === one.why);
    if (!why) return;
    // Through the list reader, so one row gets exactly the validation a stored list would.
    const entry = coerceAgeUnknown([one.entry])[0];
    if (!entry) return;
    rows.push({ entry, why });
  });
  if (rows.length === 0) return null;
  return {
    version: AGELESS_CLEARED_VERSION,
    clearedAt: typeof pass.clearedAt === "string" ? pass.clearedAt : "",
    rows,
  };
};

export const agelessClearedPass = (
  rows: readonly AgelessClearedRow[],
  clearedAt: string
): AgelessClearedPass => ({
  version: AGELESS_CLEARED_VERSION,
  clearedAt,
  rows: [...rows],
});

/** The GameChanger ids a pass took off the list. */
export const clearedIds = (pass: AgelessClearedPass): string[] =>
  pass.rows.map((row) => row.entry.teamId);

/**
 * The waiting list with a pass's rows put back, in one go.
 *
 * Rows already on the list are left alone rather than duplicated: a pass can be undone after a
 * pull has re-learned one of its teams, and two entries for one team would be two questions about
 * it for ever.
 */
export const restoreCleared = (list: AgeUnknownList, pass: AgelessClearedPass): AgeUnknownList => {
  const have = new Set(list.map((entry) => entry.teamId));
  const back = pass.rows.filter((row) => !have.has(row.entry.teamId)).map((row) => row.entry);
  return back.length === 0 ? list : [...list, ...back];
};

/** "4,730 teams" — what the undo offers to put back, for the toast and the card. */
export const describeCleared = (pass: AgelessClearedPass): string =>
  `${pass.rows.length.toLocaleString()} team${pass.rows.length === 1 ? "" : "s"}`;
