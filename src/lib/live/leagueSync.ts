import { isEmptySeason } from "../cloud/leagueMerge";
import type { SeasonState, SeasonStore, OpenSeason } from "../seasonStore";
import type { SeasonSnapshot } from "../storage";
import type { BaseKeeper } from "./leagueBase";
import { docToSeason, sameContent, seasonDocId, seasonToDoc } from "./leagueDocs";
import {
  fieldsChanged,
  guardedUndo,
  layOver,
  liveSeason,
  partsOf,
  sameSeason,
  unsaved,
  writesFor,
  type SeasonEntry,
  type SeasonParts,
  type UndoTarget,
} from "./leagueLive";
import type { LeagueRemote, LeagueStore } from "./leagueStore";

/**
 * The open League Standings season kept live with its document in the cloud: every change made on
 * this device written there, and every change made on another device laid over the season on
 * screen as it arrives (README, "League Standings in the cloud").
 *
 * - **Writes** go 700 ms after the last change, or as soon as the page lets go of the field being
 *   typed in (`settle`), in one transaction each: the document as it then stands, with what changed
 *   here since this device last took it in laid over it, and only the fields that differ written.
 * - **Arrivals** are laid over the season as it stands on screen, unsent changes included, with the
 *   same merge (`leagueLive.ts`). One that comes while a field is being typed in waits until the page
 *   lets go of it, so nothing changes under the cursor.
 * - **The base**, the document as this device last took it in, moves only with what the listener
 *   hears, which Firestore delivers in the order the writes landed, so it never goes back. It is
 *   kept between visits (`leagueBase.ts`).
 * - **Undo** puts back only what no other device has changed since the step (`guardUndo`).
 *
 * Nothing is written before the cloud's version has been heard, nothing over a document a later
 * version of the app wrote, and nothing while the listener says the connection is down: the page
 * is read-only then (`LiveLeagueState`).
 */

export type LiveLeagueState =
  /** Not kept live: not a member, not signed in, or the switch is off. */
  | { kind: "off" }
  /** Waiting for the cloud's version of the open season. */
  | { kind: "connecting" }
  | { kind: "live" }
  /** The connection is down: the season is as last heard, and editing is off. */
  | { kind: "offline" }
  /** A later version of the app wrote the season, which this one must not read or write. */
  | { kind: "newer" }
  /** The season is not readable as one, or was deleted on another device. */
  | { kind: "unreadable" }
  | { kind: "gone" }
  /** This season and the cloud's of the same id were started apart, and are not merged. */
  | { kind: "apart" }
  /** The rules refused this account, or the store would not open. */
  | { kind: "refused" };

/** Whether a season in `state` may be edited on this device. */
export const editable = (state: LiveLeagueState): boolean =>
  state.kind === "off" || state.kind === "live";

export type LeagueSyncOptions = {
  store: LeagueStore;
  seasons: SeasonStore;
  /** The season's entry in this device's season list. */
  entryOf: (id: string) => SeasonEntry | undefined;
  bases: BaseKeeper;
  /** The season as the cloud copy last shared it, for a first meeting with no base of its own. */
  seed?: (id: string) => SeasonSnapshot | null;
  /** Whether a field is being typed in, which an arrival must not change. */
  editing: () => boolean;
  onState: (state: LiveLeagueState) => void;
  now?: () => Date;
  idleMs?: number;
  /** How long after a failed write to try again, doubling to a minute. */
  retryMs?: number;
};

export type LeagueSync = {
  /** The page let go of the field being typed in: take in what waited, and send what is owed. */
  settle: () => void;
  /** The open season's entry changed in the list. */
  entryChanged: () => void;
  /** What an undo of `target`, taken at `takenAt`, puts back. */
  guardUndo: (target: UndoTarget, takenAt: number) => SeasonParts;
  /** Stops listening, after sending what is owed. */
  stop: () => void;
};

type Blocked = "newer" | "unreadable" | "gone" | "apart" | "refused";

/** One season this device has open, or had open and still owes a write. */
type Watch = {
  id: string;
  docId: string;
  /** The document as this device last took it in. */
  base: SeasonSnapshot | null;
  /** An arrival waiting for the page to let go of a field. */
  held: SeasonSnapshot | null;
  /** The season on screen, as it last was while this season was open. */
  local: SeasonSnapshot;
  /** When the cloud's version was created, once heard: the season's own, never a device's. */
  createdAt: string | null;
  met: boolean;
  blocked: Blocked | null;
  /** When another device last changed each document field, by path. */
  touched: Map<string, number>;
  /** The season the last write sent, until an arrival takes it in. */
  sent: SeasonSnapshot | null;
  /** How many arrivals have been taken in, so a write knows whether its own came back first. */
  taken: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  again: boolean;
  failures: number;
  ended: boolean;
  unwatch: () => void;
};

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** `next`'s parts, each the same object as `prev`'s where it holds the same. */
const keepParts = (prev: SeasonState, next: SeasonParts): SeasonState => ({
  teams: sameContent(prev.teams, next.teams) ? prev.teams : next.teams,
  matchups: sameContent(prev.matchups, next.matchups) ? prev.matchups : next.matchups,
  logs: sameContent(prev.logs, next.logs) ? prev.logs : next.logs,
  bracketLogs: sameContent(prev.bracketLogs, next.bracketLogs)
    ? prev.bracketLogs
    : next.bracketLogs,
  settings: sameContent(prev.settings, next.settings) ? prev.settings : next.settings,
});

export const startLeagueSync = ({
  store,
  seasons,
  entryOf,
  bases,
  seed,
  editing,
  onState,
  now = () => new Date(),
  idleMs = 700,
  retryMs = 2_000,
}: LeagueSyncOptions): LeagueSync => {
  let current: Watch | null = null;
  let stopped = false;
  let told: LiveLeagueState | null = null;

  const tell = (watch: Watch, state: LiveLeagueState) => {
    if (watch !== current || stopped) return;
    if (told && told.kind === state.kind) return;
    told = state;
    onState(state);
  };

  /*
   * The season on screen as the live store compares it. Its name is its label's, as the season
   * list's is (`useSeasons`), so a rename travels in the settings and the name never disagrees
   * with them; its creation time the cloud's once heard, which is the season's own.
   */
  const localOf = (watch: Pick<Watch, "createdAt"> | null, open: OpenSeason): SeasonSnapshot => {
    const entry = entryOf(open.id);
    return liveSeason(
      {
        id: open.id,
        name: open.season.settings.seasonLabel.trim() || entry?.name || open.id,
        createdAt: watch?.createdAt ?? entry?.createdAt ?? "",
      },
      open.season
    );
  };

  const schedule = (watch: Watch, delay = idleMs) => {
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = setTimeout(() => {
      watch.timer = null;
      settleWatch(watch);
    }, delay);
  };

  const block = (watch: Watch, why: Blocked) => {
    watch.blocked = why;
    tell(watch, { kind: why });
  };

  /** An arrival, laid over the season on screen; the base moves to it. */
  const takeIn = (watch: Watch, theirs: SeasonSnapshot) => {
    const before = watch.base;
    watch.base = theirs;
    watch.held = null;
    watch.sent = null;
    watch.taken += 1;
    bases.write(watch.docId, theirs);
    if (watch !== current) return;
    const open = seasons.get();
    if (open.id !== watch.id) return;
    const local = localOf(watch, open);
    const merged = layOver(before, local, theirs);
    if (!sameSeason(merged, local)) seasons.setSeason(keepParts(open.season, partsOf(merged)));
    watch.local = localOf(watch, seasons.get());
    if (!sameSeason(watch.local, theirs)) schedule(watch);
  };

  const heard = (watch: Watch, remote: LeagueRemote, fromServer: boolean) => {
    // A season stopped for a reason stays stopped for the visit: nothing here says the reason
    // has gone, and writing on would be the harm the stop was for.
    if (watch.ended || stopped || watch.blocked) return;
    if (!fromServer) {
      tell(watch, { kind: "offline" });
      return;
    }
    if (!remote.exists) {
      if (watch.met && watch.base) {
        // Deleted on another device: nothing is written back, which would bring it back.
        block(watch, "gone");
        return;
      }
      watch.met = true;
      tell(watch, { kind: "live" });
      void flush(watch);
      return;
    }
    const read = docToSeason(remote.data, watch.docId);
    if (!read.ok) {
      block(watch, read.reason);
      return;
    }
    const theirs = unsaved(read.season);
    const first = !watch.met;
    watch.met = true;
    watch.createdAt = theirs.createdAt;
    if (first && !watch.base) {
      const local = watch.local;
      const started = local.createdAt;
      // Two seasons given one id (every browser's first is `default`), not one season twice.
      if (!isEmptySeason(local) && started && theirs.createdAt && started !== theirs.createdAt) {
        block(watch, "apart");
        return;
      }
      watch.base = seed?.(watch.id) ?? null;
    }
    tell(watch, { kind: "live" });
    if (!first && watch.base) {
      if (sameSeason(watch.base, theirs)) return;
      // Another device's changes: what moved since the base and is not already held here. This
      // device's own writes come back too, and are no other device's.
      const at = now().getTime();
      const fresh = new Set(fieldsChanged(watch.local, theirs));
      for (const path of fieldsChanged(watch.base, theirs))
        if (fresh.has(path)) watch.touched.set(path, at);
    }
    if (!first && editing()) {
      watch.held = theirs;
      return;
    }
    takeIn(watch, theirs);
  };

  const settleWatch = (watch: Watch) => {
    if (watch.held && !editing()) takeIn(watch, watch.held);
    void flush(watch);
  };

  /** Sends what changed here since the base, laid over the document as it then stands. */
  const flush = async (watch: Watch): Promise<void> => {
    if (!watch.met || watch.blocked) return;
    const local = watch.local;
    if (watch.base && sameSeason(local, watch.base)) return;
    if (watch.sent && sameSeason(local, watch.sent)) return;
    if (watch.flushing) {
      watch.again = true;
      return;
    }
    watch.flushing = true;
    const base = watch.base;
    const taken = watch.taken;
    try {
      const outcome = await store.update(watch.docId, (remote) => {
        const savedAt = now().toISOString();
        if (!remote.exists) {
          // Made here first. A season this device has met before is not made again: that would
          // bring back one deleted elsewhere.
          if (base) return { write: null, result: "gone" as const };
          return {
            write: { create: seasonToDoc({ ...local, updatedAt: savedAt }) },
            result: "sent" as const,
          };
        }
        const read = docToSeason(remote.data, watch.docId);
        if (!read.ok) return { write: null, result: read.reason };
        const theirs = unsaved(read.season);
        const changes = writesFor(theirs, layOver(base, local, theirs), savedAt);
        return { write: changes.length > 0 ? { changes } : null, result: "sent" as const };
      });
      watch.failures = 0;
      // Firestore can deliver the write back before saying it landed; taken in already, it is
      // nothing to wait for.
      if (outcome !== "sent") block(watch, outcome);
      else if (watch.taken === taken) watch.sent = local;
    } catch (error) {
      if (codeOf(error) === "permission-denied") block(watch, "refused");
      else if (!watch.ended) {
        // Offline, or the write lost to others too often: the change is still on screen and in
        // this device's storage, and goes with the next try.
        watch.failures += 1;
        schedule(watch, Math.min(60_000, retryMs * 2 ** (watch.failures - 1)));
      }
    } finally {
      watch.flushing = false;
      if (watch.again) {
        watch.again = false;
        void flush(watch);
      }
    }
  };

  const begin = (open: OpenSeason) => {
    const docId = seasonDocId(open.id);
    const watch: Watch = {
      id: open.id,
      docId,
      base: bases.read(docId),
      held: null,
      local: localOf(null, open),
      createdAt: null,
      met: false,
      blocked: null,
      touched: new Map(),
      sent: null,
      taken: 0,
      timer: null,
      flushing: false,
      again: false,
      failures: 0,
      ended: false,
      unwatch: () => {},
    };
    if (watch.base) watch.createdAt = watch.base.createdAt;
    current = watch;
    told = null;
    tell(watch, { kind: "connecting" });
    watch.unwatch = store.watch(docId, {
      next: (remote, fromServer) => heard(watch, remote, fromServer),
      error: (error) => {
        if (codeOf(error) === "permission-denied" || !watch.met) block(watch, "refused");
        else tell(watch, { kind: "offline" });
      },
    });
  };

  /** Stops watching a season, sending what it still owes. */
  const end = (watch: Watch) => {
    watch.unwatch();
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = null;
    void flush(watch).finally(() => {
      watch.ended = true;
    });
  };

  const changed = () => {
    if (stopped) return;
    const open = seasons.get();
    if (!current || open.id !== current.id) {
      if (current) end(current);
      begin(open);
      return;
    }
    current.local = localOf(current, open);
    schedule(current);
  };

  const unsubscribe = seasons.subscribe(changed);
  begin(seasons.get());

  return {
    settle: () => {
      if (!current || stopped) return;
      if (current.timer) clearTimeout(current.timer);
      current.timer = null;
      settleWatch(current);
    },
    entryChanged: () => {
      if (!current || stopped) return;
      current.local = localOf(current, seasons.get());
      schedule(current);
    },
    guardUndo: (target, takenAt) => {
      const watch = current;
      if (!watch?.base)
        return { ...target, settings: target.settings ?? seasons.get().season.settings };
      const undone = guardedUndo(target, localOf(watch, seasons.get()), (path) => {
        const at = watch.touched.get(path);
        return at !== undefined && at >= takenAt;
      });
      return partsOf(undone);
    },
    stop: () => {
      if (stopped) return;
      unsubscribe();
      if (current) end(current);
      stopped = true;
    },
  };
};
