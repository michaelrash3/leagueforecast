import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { readSeen, writeSeen } from "../lib/preferences";
import {
  changesBetween,
  foldLocal,
  seenOf,
  type Change,
  type RaceSeen,
  type SeasonSeen,
} from "../lib/seasonDigest";
import type { SeasonState, SeasonStore } from "../lib/seasonStore";

type Race = Record<string, RaceSeen>;

type Held = {
  seasonId: string;
  seen: SeasonSeen;
  /**
   * Whether this device has looked at the season before. One it never had has nothing to report:
   * what the cloud first brings it is where its looking starts, not news. Kept on the device only
   * once it has looked, so a reload before the cloud's first word does not make that word news.
   */
  looked: boolean;
  /** Edited here since the race was last taken as seen: the next settled forecast is its own. */
  raceOwed: boolean;
};

const heldFor = (seasonId: string, season: SeasonState): Held => {
  const stored = readSeen(seasonId);
  return stored
    ? { seasonId, seen: stored, looked: true, raceOwed: false }
    : { seasonId, seen: seenOf(season), looked: false, raceOwed: false };
};

/**
 * What changed in the open season since this device last looked, and the way to say it has now
 * (2.6, `seasonDigest.ts`).
 *
 * The season store says where each change came from: an edit made here is taken as seen as it is
 * made, another device's stays news, and a season opened brings its own last look, kept on this
 * device. `race` is each team's place in the race from a settled forecast, the same object until
 * the forecast changes, or null while there is none (no cut line, or the odds still being worked
 * out). A forecast that follows this device's own edit is taken as seen too, unless news from
 * elsewhere is still unread, which it may follow from.
 */
export function useSeasonDigest({
  store,
  race,
  followed,
  oddsMove,
}: {
  store: SeasonStore;
  race: Race | null;
  followed: string | null;
  oddsMove: number;
}): { changes: Change[]; acknowledge: () => void } {
  const [open, setOpen] = useState(() => store.get());
  const [held, setHeld] = useState<Held>(() => heldFor(open.id, open.season));
  // The open season's last settled forecast, kept while the next is worked out.
  const [settled, setSettled] = useState<{ seasonId: string; race: Race | null }>({
    seasonId: open.id,
    race: null,
  });

  if (race !== null && (race !== settled.race || settled.seasonId !== open.id)) {
    setSettled({ seasonId: open.id, race });
    setHeld((was) => {
      if (was.seasonId !== open.id) return was;
      if (was.seen.race === null) return { ...was, seen: { ...was.seen, race } };
      if (!was.raceOwed) return was;
      const unread = changesBetween(was.seen, { ...seenOf(open.season), race: null });
      return unread.length === 0 ? { ...was, seen: { ...was.seen, race }, raceOwed: false } : was;
    });
  }
  const shownRace = settled.seasonId === open.id ? settled.race : null;

  useLayoutEffect(
    () =>
      store.subscribe((change, previous) => {
        const now = store.get();
        setOpen(now);
        setHeld((was) => {
          if (change === "open" || was.seasonId !== now.id) {
            // The same season afresh, from a file or a backup, is this device's own doing.
            return now.id === was.seasonId
              ? { ...was, seen: { ...seenOf(now.season), race: was.seen.race }, raceOwed: true }
              : heldFor(now.id, now.season);
          }
          if (change === "edit") {
            // Any edit here owes the race, a setting such as the cut line as much as a score.
            const seen = foldLocal(was.seen, previous.season, now.season);
            return seen === was.seen && was.raceOwed ? was : { ...was, seen, raceOwed: true };
          }
          return was.looked
            ? was
            : { ...was, seen: { ...seenOf(now.season), race: was.seen.race }, looked: true };
        });
      }),
    [store]
  );

  useEffect(() => {
    if (held.looked) writeSeen(held.seasonId, held.seen);
  }, [held]);

  const now = useMemo(() => seenOf(open.season, shownRace), [open, shownRace]);
  const changes = useMemo(
    () => (held.seasonId === open.id ? changesBetween(held.seen, now, { followed, oddsMove }) : []),
    [held, open.id, now, followed, oddsMove]
  );
  const acknowledge = useCallback(() => {
    const current = store.get();
    setHeld({
      seasonId: current.id,
      seen: seenOf(current.season, shownRace),
      looked: true,
      raceOwed: false,
    });
  }, [store, shownRace]);
  return { changes, acknowledge };
}
