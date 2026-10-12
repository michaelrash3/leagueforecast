/**
 * The club League Standings' Scout button asked Team Rankings to report on, held until Team
 * Rankings opens and takes it.
 *
 * Not in the URL with the rest of the route (`scoutRoute`): Team Rankings carries every parameter
 * it does not own from page to page, so a club named there would keep reopening its report long
 * after the reader moved on, and on every reload. Held here, it is read once by whichever page
 * opens (the cloud's board, or this device's own), and gone.
 */
let asked: string | null = null;

/** Asks the next Team Rankings page to open Scouting's report on this club. */
export const askToScout = (clubId: string): void => {
  asked = clubId;
};

/**
 * The club asked for, if any, left in place: a page reads it as its state starts, which React may
 * do twice, and lets it go once it is on screen (`scoutTaken`).
 */
export const scoutAsked = (): string | null => asked;

/** The club asked for is on screen: the next page opens as it otherwise would. */
export const scoutTaken = (): void => {
  asked = null;
};
