import type { SeasonSegment, ScoutRankingRow, ScoutTeam } from "../teamRankings";
import { withMine, type BoardRow } from "./views/boardShape";

/**
 * The published board the live page last drew (`LiveTeamRankings`), held for Team Rankings to
 * open on when the page hands over to this device's own copy: the same rows stay on screen, marked
 * as refitting, until the device's own fit lands, as the saved board's do (`savedBoard.ts`), and
 * in place of it, since the live board is the copy's as the server last built it and the saved
 * one only this device's last visit.
 *
 * Held in memory for the page load, never stored: the live page reads it from the device's view
 * cache on the next open. Held without a star, which is the page's own to set by the worker's rule
 * (`withMine`), legacy roster star and all, now that the roster is in hand.
 */

type Held = { page: string; rows: readonly BoardRow[] };

/** The page a published board is drawn for: its age group and half. The star is set on reading. */
export type LiveBoardPage = { ageGroupId: string; segment?: SeasonSegment };

const pageKey = (page: LiveBoardPage): string =>
  JSON.stringify([page.ageGroupId, page.segment ?? ""]);

let held: Held | null = null;
let starred: {
  rows: readonly BoardRow[];
  myTeamId: string | undefined;
  legacyMine: ReadonlySet<string> | undefined;
  out: ScoutRankingRow[];
} | null = null;
/** The roster's own stars, by the roster they were read off, so each is read once. */
const legacyStars = new WeakMap<readonly ScoutTeam[], ReadonlySet<string>>();

const legacyMineOf = (roster: readonly ScoutTeam[]): ReadonlySet<string> => {
  let ids = legacyStars.get(roster);
  if (!ids) {
    ids = new Set(roster.filter((team) => team.isMine).map((team) => team.id));
    legacyStars.set(roster, ids);
  }
  return ids;
};

/** Holds `rows`, the published board of `page`, in place of any held before. */
export const holdLiveBoard = (page: LiveBoardPage, rows: readonly BoardRow[]): void => {
  held = { page: pageKey(page), rows };
};

/**
 * The held board's rows with the page's star on them, when it is `page`'s, or null: the club the
 * page names as its own, or where it names none, the clubs `roster` marks as the user's, as the
 * worker stars its rows. The same array for the same rows, star and roster, so what is worked out
 * from it is not worked out again on every render.
 */
export const liveBoardFor = (
  page: LiveBoardPage & { myTeamId?: string; roster?: readonly ScoutTeam[] }
): ScoutRankingRow[] | null => {
  if (!held || held.page !== pageKey(page)) return null;
  const legacyMine = page.myTeamId || !page.roster ? undefined : legacyMineOf(page.roster);
  if (
    starred?.rows === held.rows &&
    starred.myTeamId === page.myTeamId &&
    starred.legacyMine === legacyMine
  )
    return starred.out;
  const out = withMine(held.rows, page.myTeamId, legacyMine);
  starred = { rows: held.rows, myTeamId: page.myTeamId, legacyMine, out };
  return out;
};

/** Lets go of the held board: for tests, and for an account that may no longer read it. */
export const forgetLiveBoard = (): void => {
  held = null;
  starred = null;
};
