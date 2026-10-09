import { isEmptySeason } from "../cloud/leagueMerge";
import type { OpenSeason, SeasonStore } from "../seasonStore";
import type { SeasonSnapshot } from "../storage";
import type { BaseKeeper, Landed } from "./leagueBase";
import {
  createdApart,
  docToSeason,
  readBack,
  sameContent,
  seasonDocId,
  seasonToDoc,
  storableSeason,
  type LeagueDocChange,
} from "./leagueDocs";
import {
  fieldsChanged,
  guardedUndo,
  layOver,
  liveSeason,
  partsOf,
  sameSeason,
  unsaved,
  withChanges,
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
 *   here laid over it, and only the fields that differ written, with the document's write number
 *   one higher (`rev`).
 * - **Arrivals** are laid over the season on screen as it stands, unsent changes included, with the
 *   same merge (`leagueLive.ts`). One that would change the screen while a field is being typed in
 *   waits until the page lets go of it, so nothing changes under the cursor; one that changes
 *   nothing on screen, such as this device's own write coming back, is taken in at once.
 * - **What changed here** is the season on screen, as it reads back (`readBack`), against what this
 *   device knows the document holds: the version it last took in (the base), with its own writes
 *   that have landed since (`Landed`). An arrival is placed by its write number: one at or before
 *   the base is nothing new, and one past it holds exactly those of this device's writes numbered
 *   up to it. So a write of this device's is never taken for another device's change, and a value
 *   changed back to what it was is a change like any other.
 * - **The base and the landed writes** are kept between visits (`leagueBase.ts`), always after the
 *   season itself has been written to this device's storage (`persist`), so what is kept is never
 *   ahead of what storage holds. A base is this season's only if it was made at the same moment: a
 *   season made since under a deleted season's id is a season of its own.
 * - **Undo** puts back only what no other device has changed since the step (`guardUndo`).
 *
 * Nothing is written before the cloud's version has been heard, nothing over a document a later
 * version of the app wrote, over a season deleted elsewhere, into a season of the same id started
 * apart, while the listener says the connection is down, or for a season with a record no key can
 * hold: the page is read-only then (`LiveLeagueState`).
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
  /** A team or game id here is too long for any key the cloud takes. */
  | { kind: "unstorable" }
  /** The rules refused this account, or the store would not open. */
  | { kind: "refused" };

/** Whether a season in `state` may be edited on this device. */
export const editable = (state: LiveLeagueState): boolean =>
  state.kind === "off" || state.kind === "live";

/**
 * Whether the cloud is answering in `state`: the season heard from it, whatever it said of the
 * season. A season may be deleted then, not while connecting, offline, or refused.
 */
export const reachable = (state: LiveLeagueState): boolean =>
  state.kind !== "off" &&
  state.kind !== "connecting" &&
  state.kind !== "offline" &&
  state.kind !== "refused";

export type LeagueSyncOptions = {
  store: LeagueStore;
  seasons: SeasonStore;
  /** The season's entry in this device's season list. */
  entryOf: (id: string) => SeasonEntry | undefined;
  bases: BaseKeeper;
  /**
   * Writes a season's data to this device's storage, at once. Called before any base is kept, so
   * a base never holds more than storage does: a page closed between the two would otherwise open
   * on a season missing what the base has, and read that as deleted here.
   */
  persist: (id: string, parts: SeasonParts) => void;
  /**
   * Gives a season in this device's list the creation time of the cloud's season it took in whole,
   * held nothing itself (`adoptSeasonCreatedAt`): from then on it is that season.
   */
  adopt?: (id: string, createdAt: string) => void;
  /** Whether a field is being typed in, which an arrival must not change. */
  editing: () => boolean;
  onState: (state: LiveLeagueState) => void;
  now?: () => Date;
  idleMs?: number;
  /** How long after a failed write, or a listener that ended, to try again, doubling to a minute. */
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

type Blocked = "newer" | "unreadable" | "gone" | "apart" | "unstorable" | "refused";

/** One season this device has open, or had open and still owes a write. */
type Watch = {
  id: string;
  docId: string;
  /** The document as this device last took it in, and the write it is at (0: none). */
  base: SeasonSnapshot | null;
  baseRev: number;
  /** This device's writes that have landed past the base, each with its write number. */
  landed: Landed[];
  /** An arrival waiting for the page to let go of a field, and its write number. */
  held: { season: SeasonSnapshot; rev: number } | null;
  /** The season on screen, as it reads back, as it last was while this season was open. */
  local: SeasonSnapshot;
  /** When the cloud's version was created, once known: the season's own, never a device's. */
  createdAt: string | null;
  met: boolean;
  blocked: Blocked | null;
  /** When another device last changed each document field, by path. */
  touched: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  relisten: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  /**
   * The latest version heard while a write was out: taken in once the write has said what it
   * landed as, since a write heard before it is known to be this device's would be taken for
   * another device's change, and undo a change made on screen meanwhile.
   */
  pending: { remote: LeagueRemote; fromServer: boolean } | null;
  again: boolean;
  failures: number;
  listenFailures: number;
  ended: boolean;
  unwatch: () => void;
};

type Outcome =
  | { kind: "made" }
  | { kind: "sent"; rev: number; changes: LeagueDocChange[] }
  | { kind: "none" }
  | { kind: Blocked };

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** `next`'s parts, each the same object as `prev`'s where it holds the same. */
const keepParts = (prev: SeasonParts, next: SeasonParts): SeasonParts => ({
  teams: sameContent(prev.teams, next.teams) ? prev.teams : next.teams,
  matchups: sameContent(prev.matchups, next.matchups) ? prev.matchups : next.matchups,
  logs: sameContent(prev.logs, next.logs) ? prev.logs : next.logs,
  bracketLogs: sameContent(prev.bracketLogs, next.bracketLogs)
    ? prev.bracketLogs
    : next.bracketLogs,
  settings: sameContent(prev.settings, next.settings) ? prev.settings : next.settings,
});

/** Two seasons given one id (every browser's first is `default`), not one season twice. */
const startedApart = (local: SeasonSnapshot, theirs: SeasonSnapshot): boolean =>
  !isEmptySeason(local) && createdApart(local.createdAt, theirs.createdAt);

/**
 * Whether the cloud's version is another season than this device's of the same id. Once this
 * device knows when its season was made (a base, or the cloud's met this visit), any version made
 * at another moment is another season: one made elsewhere since under this id, after this one was
 * deleted there, which laid over this one would take its place. Before that, this device's season
 * is the cloud's unless both hold something and were made at two moments.
 */
const otherSeason = (
  watch: { createdAt: string | null },
  local: SeasonSnapshot,
  theirs: SeasonSnapshot
): boolean =>
  watch.createdAt !== null
    ? createdApart(watch.createdAt, theirs.createdAt)
    : startedApart(local, theirs);

/** Whether `season` was read from `parts`, part for part. */
const readFrom = (season: SeasonSnapshot, parts: SeasonParts): boolean =>
  season.teams === parts.teams &&
  season.matchups === parts.matchups &&
  season.logs === parts.logs &&
  season.bracketLogs === parts.bracketLogs &&
  season.settings === parts.settings;

export const startLeagueSync = ({
  store,
  seasons,
  entryOf,
  bases,
  persist,
  adopt,
  editing,
  onState,
  now = () => new Date(),
  idleMs = 700,
  retryMs = 2_000,
}: LeagueSyncOptions): LeagueSync => {
  let current: Watch | null = null;
  let stopped = false;
  let told: LiveLeagueState | null = null;
  // The last season read back, by what it was read from: each change on screen is read once.
  let readCache: { from: SeasonSnapshot; key: string; back: SeasonSnapshot } | null = null;

  const tell = (watch: Watch, state: LiveLeagueState) => {
    if (watch !== current || stopped) return;
    if (told && told.kind === state.kind) return;
    told = state;
    onState(state);
  };

  /*
   * The season on screen as the live store compares it: as it reads back. Its name is its
   * label's, as the season list's is (`useSeasons`), so a rename travels in the settings; with no
   * label, the cloud's, so two devices whose lists name it differently do not each write their own
   * for ever. Its creation time is the cloud's once known, which is the season's own.
   */
  const localOf = (watch: Watch | null, open: OpenSeason): SeasonSnapshot => {
    const entry = entryOf(open.id);
    const name =
      open.season.settings.seasonLabel.trim() || watch?.base?.name || entry?.name || open.id;
    const createdAt = watch?.createdAt ?? entry?.createdAt ?? "";
    const key = `${open.id}\n${name}\n${createdAt}`;
    if (readCache && readCache.key === key && readFrom(readCache.from, open.season))
      return readCache.back;
    const from = liveSeason({ id: open.id, name, createdAt }, open.season);
    const back = readBack(from);
    readCache = { from, key, back };
    return back;
  };

  /**
   * What the document holds as this device knows it: the base, with its landed writes to `upTo`.
   * Every landed write is past the base: one is added only past it, and a base taken in drops the
   * writes it holds (`takeIn`).
   */
  const effective = (watch: Watch, upTo = Number.POSITIVE_INFINITY): SeasonSnapshot | null => {
    if (!watch.base) return null;
    const changes = watch.landed.filter((one) => one.rev <= upTo).flatMap((one) => one.changes);
    return changes.length === 0 ? watch.base : withChanges(watch.base, changes);
  };

  /** Writes the season to storage, then keeps what this device knows of its document. */
  const keep = (watch: Watch) => {
    const open = seasons.get();
    persist(
      watch.id,
      watch === current && open.id === watch.id ? open.season : partsOf(watch.local)
    );
    if (watch.base)
      bases.write(watch.docId, { season: watch.base, rev: watch.baseRev, landed: watch.landed });
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
  const takeIn = (watch: Watch, theirs: SeasonSnapshot, rev: number) => {
    const mergeBase = effective(watch, rev);
    watch.base = theirs;
    watch.baseRev = rev;
    watch.landed = watch.landed.filter((one) => one.rev > rev);
    const open = seasons.get();
    if (watch === current && open.id === watch.id) {
      const local = localOf(watch, open);
      const merged = layOver(mergeBase, local, theirs);
      if (!sameSeason(merged, local)) seasons.apply(keepParts(open.season, partsOf(merged)));
      watch.local = localOf(watch, seasons.get());
    }
    keep(watch);
    const known = effective(watch);
    if (known && !sameSeason(watch.local, known)) schedule(watch);
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
      if (watch.met || watch.base) {
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
    if (otherSeason(watch, watch.local, theirs)) {
      block(watch, "apart");
      return;
    }
    if (watch.createdAt === null) {
      // Met for the first time: this device's season held nothing, or is the cloud's. Either way
      // it is the cloud's from now on, made when that one was, and its entry says so.
      watch.createdAt = theirs.createdAt;
      if (theirs.createdAt !== "" && entryOf(watch.id)?.createdAt !== theirs.createdAt)
        adopt?.(watch.id, theirs.createdAt);
    }
    tell(watch, { kind: "live" });
    // Nothing past what this device already holds (a version it took in, or one it made), but
    // word from the cloud all the same: what is still owed here goes now, not at the next retry.
    if (read.rev <= watch.baseRev) {
      const known = effective(watch);
      if (known && !sameSeason(watch.local, known)) schedule(watch);
      return;
    }
    const mergeBase = effective(watch, read.rev);
    if (!first && mergeBase) {
      // Another device's changes: what moved past what this device knew the document held, and
      // is not already held here.
      const at = now().getTime();
      const fresh = new Set(fieldsChanged(watch.local, theirs));
      for (const path of fieldsChanged(mergeBase, theirs))
        if (fresh.has(path)) watch.touched.set(path, at);
    }
    if (!first && editing() && !sameSeason(layOver(mergeBase, watch.local, theirs), watch.local)) {
      watch.held = { season: theirs, rev: read.rev };
      return;
    }
    takeIn(watch, theirs, read.rev);
  };

  const settleWatch = (watch: Watch) => {
    const held = watch.held;
    if (held && !editing()) {
      watch.held = null;
      // Taken in already, or passed by a later version taken in: nothing more to lay over.
      if (held.rev > watch.baseRev) takeIn(watch, held.season, held.rev);
    }
    void flush(watch);
  };

  /** Sends what changed here, laid over the document as it then stands. */
  const flush = async (watch: Watch): Promise<void> => {
    if (!watch.met || watch.blocked) return;
    const local = watch.local;
    if (!storableSeason(local)) {
      block(watch, "unstorable");
      return;
    }
    const known = effective(watch);
    if (known && sameSeason(local, known)) return;
    if (watch.flushing) {
      watch.again = true;
      return;
    }
    watch.flushing = true;
    try {
      const outcome = await store.update<Outcome>(watch.docId, (remote) => {
        const savedAt = now().toISOString();
        if (!remote.exists) {
          // Made here first. A season this device has met before is not made again: that would
          // bring back one deleted elsewhere.
          if (known) return { write: null, result: { kind: "gone" } };
          return {
            write: { create: seasonToDoc({ ...local, updatedAt: savedAt }, 1) },
            result: { kind: "made" },
          };
        }
        const read = docToSeason(remote.data, watch.docId);
        if (!read.ok) return { write: null, result: { kind: read.reason } };
        const theirs = unsaved(read.season);
        // Made elsewhere a moment before, met here for the first time inside the write; or made
        // elsewhere since under a deleted season's id, before the listener has said so.
        if (otherSeason(watch, local, theirs)) return { write: null, result: { kind: "apart" } };
        const changes = writesFor(theirs, read.rev, layOver(known, local, theirs), savedAt);
        return changes.length > 0
          ? { write: { changes }, result: { kind: "sent", rev: read.rev + 1, changes } }
          : { write: null, result: { kind: "none" } };
      });
      watch.failures = 0;
      if (outcome.kind === "made") {
        if (watch.baseRev < 1) {
          watch.base = local;
          watch.baseRev = 1;
          watch.landed = [];
          watch.createdAt = local.createdAt;
          keep(watch);
        }
      } else if (outcome.kind === "sent") {
        if (outcome.rev > watch.baseRev) {
          watch.landed = [...watch.landed, { rev: outcome.rev, changes: outcome.changes }];
          keep(watch);
        }
      } else if (outcome.kind !== "none") block(watch, outcome.kind);
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
      const pending = watch.pending;
      watch.pending = null;
      if (pending) heard(watch, pending.remote, pending.fromServer);
      if (watch.again) {
        watch.again = false;
        void flush(watch);
      }
    }
  };

  const listen = (watch: Watch) => {
    watch.unwatch = store.watch(watch.docId, {
      next: (remote, fromServer) => {
        watch.listenFailures = 0;
        if (watch.flushing) watch.pending = { remote, fromServer };
        else heard(watch, remote, fromServer);
      },
      error: (error) => {
        if (watch.ended || stopped || watch.blocked) return;
        if (codeOf(error) === "permission-denied") {
          block(watch, "refused");
          return;
        }
        // Firestore ends a listener that fails; a new one is opened after a wait, and until it
        // hears the cloud the season is read-only.
        tell(watch, { kind: watch.met ? "offline" : "connecting" });
        watch.listenFailures += 1;
        watch.relisten = setTimeout(
          () => {
            watch.relisten = null;
            if (watch.ended || stopped || watch.blocked) return;
            watch.unwatch();
            listen(watch);
          },
          Math.min(60_000, retryMs * 2 ** (watch.listenFailures - 1))
        );
      },
    });
  };

  const begin = (open: OpenSeason) => {
    const docId = seasonDocId(open.id);
    const entry = entryOf(open.id);
    const stored = bases.read(docId);
    // A base kept for a season deleted since, whose id this one reuses, is not this season's.
    const known =
      stored && !createdApart(stored.season.createdAt, entry?.createdAt ?? "") ? stored : null;
    if (stored && !known) bases.remove(docId);
    const watch: Watch = {
      id: open.id,
      docId,
      base: known?.season ?? null,
      baseRev: known?.rev ?? 0,
      landed: known?.landed ?? [],
      held: null,
      local: localOf(null, open),
      createdAt: known?.season.createdAt ?? null,
      met: false,
      blocked: null,
      touched: new Map(),
      timer: null,
      relisten: null,
      flushing: false,
      pending: null,
      again: false,
      failures: 0,
      listenFailures: 0,
      ended: false,
      unwatch: () => {},
    };
    watch.local = localOf(watch, open);
    current = watch;
    told = null;
    tell(watch, { kind: "connecting" });
    if (!storableSeason(watch.local)) {
      block(watch, "unstorable");
      return;
    }
    listen(watch);
  };

  /** Stops watching a season, writing it to storage and sending what it still owes. */
  const end = (watch: Watch) => {
    watch.unwatch();
    if (watch.timer) clearTimeout(watch.timer);
    if (watch.relisten) clearTimeout(watch.relisten);
    watch.timer = null;
    watch.relisten = null;
    persist(watch.id, partsOf(watch.local));
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
