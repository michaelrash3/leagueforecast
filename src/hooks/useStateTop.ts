/**
 * Which state a board's State top 10 is for, shared by Team Rankings on this device and the live
 * board so the two open on the same state: the one picked during the visit, else the one the card
 * opens on (`defaultStateOf`), which is the state this device keeps as its default where the page
 * has a club there.
 */
import { useMemo, useState } from "react";
import { defaultStateOf, type BoardClub } from "../lib/teamRankings/boardDisplay";
import { readDefaultState, writeDefaultState } from "../lib/preferences";

export function useStateTop(
  clubs: readonly BoardClub[],
  myTeamId: string | undefined,
  /** A state already picked, as a board handing over passes the one its reader was on. */
  picked: string | null = null
) {
  /** The state picked during this visit; `null` while the card is on the one it opened on. */
  const [stateTop, setStateTop] = useState<string | null>(picked);
  /**
   * Where Clear left the card, and the page's clubs it was pressed over. Not a pick: a pick lasts
   * the visit, and on a page with nobody from the cleared state it would leave an empty card that
   * the select, naming another state, cannot be used to leave. A new page's clubs are a new array,
   * so the hold ends on the next page or half and the card opens there as it would have.
   */
  const [held, setHeld] = useState<{ state: string; clubs: readonly BoardClub[] } | null>(null);
  const [keptState, setKeptState] = useState(() => readDefaultState());
  const opening = useMemo(
    () => defaultStateOf(clubs, myTeamId, keptState),
    [clubs, myTeamId, keptState]
  );
  const shownState = stateTop ?? (held !== null && held.clubs === clubs ? held.state : opening);

  /**
   * Keeps `state` as the default, or forgets it for `null`. Neither moves the card: making a
   * default is done from the state on screen, and clearing one holds the card where it is on this
   * page, since a card that jumped to another state under the reader's finger would look like the
   * click had picked it. The default decides where the next open lands.
   */
  const keepState = (state: string | null) => {
    if (state === null) setHeld({ state: shownState, clubs });
    writeDefaultState(state);
    setKeptState(state);
  };

  return { stateTop, shownState, pickState: setStateTop, keptState, keepState };
}
