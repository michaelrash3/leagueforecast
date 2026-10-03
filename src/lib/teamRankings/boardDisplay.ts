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
 * Which state the top ten is for. Yours if we know it, otherwise whichever state has the most
 * teams on this page — the one most likely to be the reason you are here.
 */
export const defaultStateOf = (
  clubs: readonly BoardClub[],
  myTeamId: string | undefined
): string => {
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
