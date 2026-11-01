import type { MyTeamGlance } from "./myTeamGlance";
import { clubLookupOf } from "./teamRankings/leagueBridge";
import { pageGcIds, shownClubId } from "./teamRankings/rememberedClub";
import type { AgeGroup, GcTeamLink } from "./teamRankings/types";

/**
 * "Since you last looked" on Team Rankings' My Team card: the club's places, record and rating as
 * this device last saw them, kept per club in this browser's storage only, and what moved since.
 * The board the places are on is kept too: a fall board and the spring one after it count from
 * different games, so a look from the other half is a new start, not a move. And a GameChanger id
 * the club carried: its id here is the pool's own, which a fold or Team Rankings started again can
 * leave naming another club, so a look is read by that id where the club's are known
 * (`readMyTeamLook`), and another club's is never told as this one's moves.
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
  /** A GameChanger id the club carried, the page's own team first (`MyTeamGlance.gcIds`). */
  gc?: string;
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

/**
 * `glance` with its club's GameChanger ids on the page (`pageGcIds`), where the page holds the club:
 * none of them is an answer too, that a look kept with one is another club's. Left as it is where
 * the club is not held, and its looks are then read as every look was.
 */
export const withGcIds = (
  glance: MyTeamGlance,
  club: { gcTeams?: readonly GcTeamLink[] } | undefined,
  pageId: string,
  ageGroups: AgeGroup[]
): MyTeamGlance => (club ? { ...glance, gcIds: pageGcIds(club, pageId, ageGroups) } : glance);

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
  ...(glance.gcIds?.[0] ? { gc: glance.gcIds[0] } : {}),
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
    typeof look.rating === "number" &&
    (look.gc === undefined || typeof look.gc === "string")
  );
};

const lookUnder = (key: string): MyTeamLook | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLook(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * The last look kept at a club on this device, or null (none, unreadable, or storage off). With the
 * club's GameChanger ids (`MyTeamGlance.gcIds`), each look is read by the one it was kept with
 * (`readClub`, off the club alone): its own is none where it was kept for another club its id
 * named then, and one kept under another id of a team it carries now (a club folded into it, or
 * itself before Team Rankings started again) is its own, the newest of them, under its id now. A
 * look kept with no GameChanger id reads as every look did, and is never followed.
 */
export const readMyTeamLook = (teamId: string, gcIds?: readonly string[]): MyTeamLook | null => {
  const own = lookUnder(lookKey(teamId));
  if (!gcIds) return own;
  const club = clubLookupOf([{ id: teamId, gcTeams: gcIds.map((gc) => ({ teamId: gc })) }]);
  const ofClub = (look: MyTeamLook) =>
    shownClubId({ id: look.teamId, ...(look.gc ? { gc: look.gc } : {}) }, club) === teamId;
  if (own && ofClub(own)) return own;
  let followed: MyTeamLook | null = null;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(LOOK_PREFIX) || key === lookKey(teamId)) continue;
      const look = lookUnder(key);
      if (look?.gc && ofClub(look) && (!followed || look.at > followed.at)) followed = look;
    }
  } catch {
    return null;
  }
  return followed && { ...followed, teamId };
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
      others.push({ key: other, at: lookUnder(other)?.at ?? -1 });
    }
    others
      .sort((a, b) => b.at - a.at)
      .slice(LOOKS_KEPT - 1)
      .forEach((stale) => storage.removeItem(stale.key));
  } catch {
    // Storage full or off: the line is only shown again next time, which is no loss.
  }
};
