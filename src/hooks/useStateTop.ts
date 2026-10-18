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
  const [keptState, setKeptState] = useState(() => readDefaultState());
  const opening = useMemo(
    () => defaultStateOf(clubs, myTeamId, keptState),
    [clubs, myTeamId, keptState]
  );
  const shownState = stateTop ?? opening;

  /**
   * Keeps `state` as the default, or forgets it for `null`, and lets go of a state picked in the
   * select either way, so the card is the default's to place from here: kept, it stays where it is,
   * since it is made from the state on screen; cleared, it opens as it would with no default.
   *
   * Left as the visit's pick, a state made the default and then cleared, or made the default and
   * carried to a page with nobody from it, showed an empty card there under a select naming another
   * state. Holding the cleared state on its page instead was tried and dropped: a refit or a newly
   * published board on that same page ended the hold, and a handover from the cloud's board to this
   * device's lost it, so the card jumped later rather than at the click.
   */
  const keepState = (state: string | null) => {
    setStateTop(null);
    writeDefaultState(state);
    setKeptState(state);
  };

  return { stateTop, shownState, pickState: setStateTop, keptState, keepState };
}
