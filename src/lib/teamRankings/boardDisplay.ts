import { isRankedAgeLevel, MIN_RANKED_AGE_LEVEL } from "./seasons";
import type { ScoutTeam } from "./types";

/**
 * What a board says of its clubs beyond their numbers: where each is from, the state its top ten
 * opens on, and how many clubs have no state. Team Rankings works these out from the clubs behind
 * its rows (`rankedTeams`), and the live board from what each published row says of its club
 * (`clubsOfBoard`), so both draw the same board from the same code.
 */

/** A club as a board shows it: its id, and its town and state where it has them. */
export type BoardClub = Pick<ScoutTeam, "id" | "city" | "state">;

/**
 * "Prosper, TX" — where a club is from, which is what tells five Rangers apart in a list. The
 * town comes from GameChanger for a pulled club; a stand-in has neither and shows nothing.
 */
export const placeText = (club: BoardClub): string | undefined =>
  [club.city, club.state].filter(Boolean).join(", ") || undefined;

/** Each club's place (`placeText`), by id, the first of an id kept. */
export const placesOf = (clubs: readonly BoardClub[]): Map<string, string | undefined> => {
  const places = new Map<string, string | undefined>();
  clubs.forEach((club) => {
    if (!places.has(club.id)) places.set(club.id, placeText(club));
  });
  return places;
};

/**
 * Which state the top ten is for. The one this device keeps as its default (`readDefaultState`),
 * since that is a choice somebody made; then yours if we know it, otherwise whichever state has
 * the most teams on this page — the one most likely to be the reason you are here.
 *
 * The kept state only where one of the page's clubs is in it: a page with nobody from there would
 * open on an empty card, and the next page, or next season's, may well have somebody.
 */
export const defaultStateOf = (
  clubs: readonly BoardClub[],
  myTeamId: string | undefined,
  kept: string | null = null
): string => {
  if (kept !== null && clubs.some((club) => club.state === kept)) return kept;
  const mine = clubs.find((club) => club.id === myTeamId)?.state;
  if (mine) return mine;
  const counts = new Map<string, number>();
  clubs.forEach((club) => {
    if (club.state) counts.set(club.state, (counts.get(club.state) ?? 0) + 1);
  });
  let best = "";
  let most = 0;
  counts.forEach((count, state) => {
    if (count > most) {
      most = count;
      best = state;
    }
  });
  return best;
};

/** How many of the board's clubs have no state, which the state boards cannot place. */
export const unknownStateCountOf = (clubs: readonly BoardClub[]): number =>
  clubs.filter((club) => !club.state).length;

/**
 * A published board's clubs, as the page reads them off the roster of its year: each row's town
 * and state, which the publisher wrote off that roster (`BoardFacts`).
 */
export const clubsOfBoard = (
  rows: ReadonlyArray<{ teamId: string; city?: string; state?: string }>
): BoardClub[] =>
  rows.map(({ teamId, city, state }) => ({
    id: teamId,
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
  }));

/**
 * Why a page has no table, when the reason is its age level: a level below `MIN_RANKED_AGE_LEVEL`
 * has none by design, so its page would otherwise read as "no teams yet" however many games were
 * logged on it. Said plainly instead, because the games are not being ignored — they are evidence
 * about the older teams that played down. Null for a ranked level, and for no page at all.
 */
export const unrankedLevelNoteFor = (pageId: string, level: number | undefined): string | null =>
  pageId && !isRankedAgeLevel(level)
    ? `${level}U is not ranked — at that age the results say more about which league is machine pitch than about the teams. Games logged here still count as evidence about the ${MIN_RANKED_AGE_LEVEL}U and older teams that played down against them.`
    : null;
