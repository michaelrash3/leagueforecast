import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { finalLogsOf } from "../lib/finalLogs";
import { readSeen, subscribeSeen, writeSeen } from "../lib/preferences";
import {
  adoptKept,
  changesBetween,
  foldLocal,
  keptWith,
  sameSeen,
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
   * what it holds once League kept live has heard the cloud's version, laid over its own, is where
   * its looking starts, not news. Kept on the device only once it has looked, so a reload before
   * the cloud's first word does not make that word news.
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
 * Whether a change moves what the forecast reads: the teams (a club linked to one as much as a
 * name), the schedule, a setting such as the cut line, or the finals, as the page keys its
 * forecast on them (`finalLogsOf`). Runs typed into a game still being played, or a bracket score,
 * move none of it.
 */
const movesForecast = (before: SeasonState, after: SeasonState): boolean => {
  const finals = finalLogsOf(before.logs);
  return (
    before.teams !== after.teams ||
    before.matchups !== after.matchups ||
    before.settings !== after.settings ||
    finalLogsOf(after.logs, finals) !== finals
  );
};

/**
 * What changed in the open season since this device last looked, and the way to say it has now
 * (2.6, `seasonDigest.ts`).
 *
 * The season store says where each change came from: an edit made here is taken as seen as it is
 * made, another device's stays news, and a season opened brings its own last look, kept on this
 * device. `race` is each team's place in the race from a settled forecast of the season as it
 * stands, the same object until the forecast changes, or null while there is none (no cut line,
 * or the odds still being worked out). A forecast that follows this device's own edit is taken as
 * seen too, unless news from elsewhere is still unread, which it may follow from. `heard` is
 * whether League kept live has heard the cloud's version of the open season.
 *
 * The last look is the device's, not the tab's: another tab's edit, coming back to this one
 * through the cloud, is seen here as it was there, and a Got it in one tab is one in all of them
 * (`keptWith`, `adoptKept`).
 */
export function useSeasonDigest({
  store,
  race,
  followed,
  oddsMove,
  heard,
}: {
  store: SeasonStore;
  race: Race | null;
  followed: string | null;
  oddsMove: number;
  heard: boolean;
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
      // A look with no race yet takes this one as where the race starts, owing nothing after it.
      if (was.seen.race === null) return { ...was, seen: { ...was.seen, race }, raceOwed: false };
      if (!was.raceOwed) return was;
      const unread = changesBetween(was.seen, { ...seenOf(open.season), race: null });
      return unread.length === 0 ? { ...was, seen: { ...was.seen, race }, raceOwed: false } : was;
    });
  }
  const shownRace = settled.seasonId === open.id ? settled.race : null;

  /*
   * League kept live has heard the cloud, and what it said held nothing this device lacked, or it
   * would have arrived below as the first word, in the same render. What is held is where looking
   * starts all the same, or the first news to come would be taken for that word.
   */
  if (heard && !held.looked && held.seasonId === open.id) {
    const kept = readSeen(held.seasonId);
    setHeld((was) =>
      was.looked || was.seasonId !== open.id
        ? was
        : { ...was, seen: kept ?? was.seen, looked: true }
    );
  }

  useLayoutEffect(
    () =>
      store.subscribe((change, previous) => {
        const now = store.get();
        // What this device's other tabs keep as seen, read here rather than in the updater.
        const kept = change === "arrival" ? readSeen(now.id) : null;
        setOpen(now);
        setHeld((was) => {
          if (change === "open" || was.seasonId !== now.id) {
            // The same season afresh, from a file or a backup, is this device's own doing.
            return now.id === was.seasonId
              ? { ...was, seen: { ...seenOf(now.season), race: was.seen.race }, raceOwed: true }
              : heldFor(now.id, now.season);
          }
          if (change === "edit") {
            /*
             * An edit here owes the race only when it moves what the forecast reads. Owed for
             * runs typed into a game still being played, which leave the forecast where it is,
             * the race would stay owed until some later forecast, one another device's news
             * moved, which would then be taken as this device's own.
             */
            const seen = foldLocal(was.seen, previous.season, now.season);
            const owed = was.raceOwed || movesForecast(previous.season, now.season);
            return seen === was.seen && owed === was.raceOwed
              ? was
              : { ...was, seen, raceOwed: owed };
          }
          const shown = seenOf(now.season);
          if (!was.looked) {
            // Another tab here has looked already: its look is this one's.
            if (kept) return { ...was, seen: kept, looked: true, raceOwed: false };
            // The cloud's first word is where looking starts, the race with it: the forecast of
            // the season it brought, as that settles, not the one from before it, against which
            // the finals it brought would come out as clinches with none of the games behind them.
            const race = movesForecast(previous.season, now.season) ? null : was.seen.race;
            return { ...was, seen: { ...shown, race }, looked: true, raceOwed: false };
          }
          if (!kept) return was;
          // Another tab's edit comes back through the cloud as another device's would. Where the
          // season now reads as this device keeps it, it is seen, and the forecast that follows
          // is the device's own, as it is in the tab that made the edit.
          const seen = adoptKept(was.seen, kept, shown);
          return seen === was.seen ? was : { ...was, seen, raceOwed: true };
        });
      }),
    [store]
  );

  /*
   * The look as this tab last held it, which what it writes is measured from (`keptWith`), and
   * whether this tab has written it since the season was opened here.
   */
  const synced = useRef<{ seasonId: string; seen: SeasonSeen; written: boolean } | null>(null);
  const [lookWritten, setLookWritten] = useState(0);
  useEffect(() => subscribeSeen(() => setLookWritten((count) => count + 1)), []);
  useEffect(() => {
    const mine = synced.current?.seasonId === held.seasonId ? synced.current : null;
    const was = mine ? mine.seen : held.seen;
    synced.current = { seasonId: held.seasonId, seen: held.seen, written: held.looked };
    if (!held.looked) return;
    const kept = readSeen(held.seasonId);
    const next = kept ? keptWith(kept, was, held.seen) : held.seen;
    /*
     * Written once as the season is opened here, though nothing in it changed: the looks kept are
     * those of the seasons opened most recently (`writeSeen` keeps them by when each was last
     * written), and one opened often but long unchanged would otherwise fall away before seasons
     * opened once since, its news then taken for where looking starts.
     */
    if (!kept || !mine?.written || !sameSeen(next, kept)) writeSeen(held.seasonId, next);
    const current = store.get();
    if (!kept || current.id !== held.seasonId) return;
    const seen = adoptKept(held.seen, next, seenOf(current.season, shownRace));
    if (seen !== held.seen) setHeld((latest) => (latest === held ? { ...held, seen } : latest));
  }, [store, held, shownRace, lookWritten]);

  const now = useMemo(() => seenOf(open.season, shownRace), [open, shownRace]);
  const changes = useMemo(
    () => (held.seasonId === open.id ? changesBetween(held.seen, now, { followed, oddsMove }) : []),
    [held, open.id, now, followed, oddsMove]
  );
  const acknowledge = useCallback(() => {
    const current = store.get();
    setHeld((was) => ({
      seasonId: current.id,
      // With no forecast shown yet, the race stays as last seen: what the forecast makes of what
      // was just seen is still to be told.
      seen: seenOf(
        current.season,
        shownRace ?? (was.seasonId === current.id ? was.seen.race : null)
      ),
      looked: true,
      raceOwed: false,
    }));
  }, [store, shownRace]);
  return { changes, acknowledge };
}
