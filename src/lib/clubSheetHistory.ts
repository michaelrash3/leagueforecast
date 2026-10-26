/*
 * Back closes a club's sheet (`ClubSheet`), as it closes a sheet in any app on a phone: opening one
 * adds a history entry, the page's own URL marked `clubSheet`, and leaving that entry closes it.
 *
 * The entry is added as the club is opened, in the click, never from an effect: React's strict mode
 * mounts an effect twice in development, and an entry added and taken away again by it would leave
 * the history out of step with the sheet. A sheet closed by its own controls is shut at once by the
 * page, and the entry it added is then taken back with `history.back()`, whose popstate is this
 * module's own and is let pass; a sheet opened again before that lands is given its entry once it
 * has.
 */

/** The key the sheet's history entry carries. */
export const CLUB_SHEET_MARK = "clubSheet";

const marked = (): boolean => {
  const state: unknown = window.history.state;
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[CLUB_SHEET_MARK] === true
  );
};

const mark = (): void => {
  const state: unknown = window.history.state;
  const kept = typeof state === "object" && state !== null ? state : {};
  window.history.pushState({ ...kept, [CLUB_SHEET_MARK]: true }, "", window.location.href);
};

/** The open sheet's way to shut, while one is open (`useClubSheetBack`). */
let shutOpen: (() => void) | null = null;
/** A `history.back()` of this module's own, not yet landed. */
let popping = false;
/** A sheet opened while that was on its way, whose entry is added once it lands. */
let markAfterPop = false;
let listening = false;

const heard = (): void => {
  if (popping) {
    popping = false;
    if (markAfterPop) {
      markAfterPop = false;
      mark();
    }
    return;
  }
  // Back (or Forward) by the reader: off the sheet's entry, the sheet closes.
  if (!marked()) shutOpen?.();
};

/** Called as a club is opened from the page: adds the entry Back closes the sheet by. */
export const markClubSheet = (): void => {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    window.addEventListener("popstate", heard);
  }
  if (popping) markAfterPop = true;
  else if (!marked()) mark();
};

/**
 * Called as the page shuts a sheet by its own controls (Close, Esc, the shade around it): the entry
 * it added is taken back, so Back then leaves the page as it would have before the sheet opened.
 */
export const leftClubSheet = (): void => {
  if (typeof window === "undefined" || popping) return;
  markAfterPop = false;
  if (!marked()) return;
  popping = true;
  window.history.back();
};

/** The sheet on screen says how it shuts, for as long as it is on screen. */
export const holdClubSheet = (shut: () => void): (() => void) => {
  shutOpen = shut;
  return () => {
    if (shutOpen === shut) shutOpen = null;
  };
};

/** Only for tests: forgets a `history.back()` still on its way and the sheet held. */
export const forgetClubSheetHistory = (): void => {
  popping = false;
  markAfterPop = false;
  shutOpen = null;
};
