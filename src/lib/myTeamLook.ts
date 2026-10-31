import type { MyTeamGlance } from "./myTeamGlance";

/**
 * "Since you last looked" on Team Rankings' My Team card: the club's places, record and rating as
 * this device last saw them, kept per club in this browser's storage only, and what moved since.
 * The board the places are on is kept too: a fall board and the spring one after it count from
 * different games, so a look from the other half is a new start, not a move.
 */
export type MyTeamLook = {
  v: 1;
  /** When it was taken, in milliseconds. */
  at: number;
  teamId: string;
  /** The half of the season the board is for, where the page has halves. */
  board?: string;
  national: number;
  nationalOf: number;
  state?: string;
  stateRank?: number;
  record: string;
  rating: number;
};

export type MyTeamMoves = {
  since: number;
  national: { before: number; now: number };
  /** Where the club's state is known both times, and is the same. */
  state?: { name: string; before: number; now: number };
  record: { before: string; now: string };
  rating: { before: number; now: number };
};

/** A rating move smaller than this is the fit's own jitter, not news. */
const RATING_STEP = 0.05;

export const takeMyTeamLook = (
  at: number,
  glance: MyTeamGlance,
  board: string | undefined
): MyTeamLook => ({
  v: 1,
  at,
  teamId: glance.teamId,
  ...(board ? { board } : {}),
  national: glance.nationalRank,
  nationalOf: glance.nationalOf,
  ...(glance.state && glance.stateRank !== undefined
    ? { state: glance.state, stateRank: glance.stateRank }
    : {}),
  record: glance.record,
  rating: glance.rating,
});

/**
 * What moved between two looks at one club on one board, or null: another club, another board, or
 * nothing worth telling (the same places and record, the rating within a twentieth of a run).
 */
export const myTeamMoves = (prev: MyTeamLook, now: MyTeamLook): MyTeamMoves | null => {
  if (prev.teamId !== now.teamId || prev.board !== now.board) return null;
  const state =
    prev.state !== undefined &&
    prev.state === now.state &&
    prev.stateRank !== undefined &&
    now.stateRank !== undefined
      ? { name: now.state, before: prev.stateRank, now: now.stateRank }
      : undefined;
  const moved =
    prev.national !== now.national ||
    (state !== undefined && state.before !== state.now) ||
    prev.record !== now.record ||
    Math.abs(prev.rating - now.rating) >= RATING_STEP;
  if (!moved) return null;
  return {
    since: prev.at,
    national: { before: prev.national, now: now.national },
    ...(state ? { state } : {}),
    record: { before: prev.record, now: now.record },
    rating: { before: prev.rating, now: now.rating },
  };
};

const LOOK_PREFIX = "lf_my_team_look_v1_";
const lookKey = (teamId: string) => `${LOOK_PREFIX}${teamId}`;

/**
 * How many clubs' looks are kept: those looked at last, far more than the clubs one person marks
 * as theirs at once, a club for each page they follow.
 */
const LOOKS_KEPT = 12;

const isLook = (value: unknown): value is MyTeamLook => {
  if (!value || typeof value !== "object") return false;
  const look = value as Partial<MyTeamLook>;
  return (
    look.v === 1 &&
    typeof look.at === "number" &&
    typeof look.teamId === "string" &&
    typeof look.national === "number" &&
    typeof look.nationalOf === "number" &&
    typeof look.record === "string" &&
    typeof look.rating === "number"
  );
};

/** The last look kept at a club on this device, or null (none, unreadable, or storage off). */
export const readMyTeamLook = (teamId: string): MyTeamLook | null => {
  try {
    const raw = window.localStorage.getItem(lookKey(teamId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLook(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Keeps a look at a club on this device; a storage that refuses it changes nothing else. A look is
 * kept a club, and a browser that marked a club its own each season kept one for every club it
 * ever did, never removed: now the looks beyond the `LOOKS_KEPT` looked at last go, an unreadable
 * one first, and a club whose look went starts afresh if it is looked at again.
 */
export const saveMyTeamLook = (look: MyTeamLook): void => {
  try {
    const storage = window.localStorage;
    const key = lookKey(look.teamId);
    storage.setItem(key, JSON.stringify(look));
    const others: { key: string; at: number }[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const other = storage.key(index);
      if (!other?.startsWith(LOOK_PREFIX) || other === key) continue;
      others.push({ key: other, at: readMyTeamLook(other.slice(LOOK_PREFIX.length))?.at ?? -1 });
    }
    others
      .sort((a, b) => b.at - a.at)
      .slice(LOOKS_KEPT - 1)
      .forEach((stale) => storage.removeItem(stale.key));
  } catch {
    // Storage full or off: the line is only shown again next time, which is no loss.
  }
};
