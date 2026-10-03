import { fetchValues, type CloudStore } from "../cloud/cloudEngine";
import { DATA_SCHEMA, type CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import { memoryIo } from "../cloud/cloudRunner";
import { stampFromNewerRules } from "../gameChangerImport";
import {
  applyCloudPoolValues,
  initTeamRankingsStore,
  isCloudPoolKey,
  isScoutGamesKey,
  LEGACY_GAMES_KEY,
  loadTidyStamp,
  onCloudPoolWrite,
  readCloudPoolValue,
  resetPoolSync,
  resetTeamRankingsStore,
  TIDY_STAMP_KEY,
  type PoolStoreIo,
} from "../teamRankingsStorage";
import type { SeasonReader } from "./allKnown";
import { isBoardInput } from "./boardInputs";
import { seasonReaderOf } from "./publishCopy";

/**
 * The pool a server that rebuilds the views keeps between rebuilds, in this process's pool store:
 * the parts of the cloud copy the boards read (`isBoardInput`), League Standings among them, and the
 * tidy stamp. Each `ensure` brings it to the copy as it now stands by fetching only the parts whose
 * value changed, so a process still warm from the last rebuild reads one year's games after an edit
 * to that year, not the whole pool.
 *
 * It never writes the copy, and it holds nothing derived: the boards are built from the store each
 * time, by the same loaders a browser reads through.
 */

export type PoolEnsure =
  | {
      ok: true;
      /** The copy the store now holds, part for part. */
      manifest: CloudManifest;
      /** Its League Standings seasons. */
      readSeason: SeasonReader;
      /** Whether the store was started afresh, rather than brought up to date. */
      cold: boolean;
      /** The parts fetched, and the keys taken out because the copy no longer has them. */
      fetched: string[];
      gone: string[];
      /** The pieces the fetched parts were stored in, and their size as stored. */
      pieces: number;
      bytes: number;
      /** Reads of the copy it took: one, and one more each time a save moved it mid-fetch. */
      tries: number;
    }
  | {
      ok: false;
      /**
       * - `no-copy`: there is no copy.
       * - `newer-schema`: a newer build saved it.
       * - `newer-rules`: newer rules tidied it.
       * - `unknown-key`: it holds a part this build does not keep.
       * - `damaged`: a piece it names is missing or not what it says.
       * - `league-unreadable`: its League Standings part holds what a browser would refuse.
       * - `store-refused`: the pool store would not take a value.
       * - `kept-moving`: saves kept replacing the pieces being read.
       */
      reason:
        | "no-copy"
        | "newer-schema"
        | "newer-rules"
        | "unknown-key"
        | "damaged"
        | "league-unreadable"
        | "store-refused"
        | "kept-moving";
    };

export type PoolCache = {
  /** Brings the store to the copy `store` holds now. One at a time: a second waits for the first. */
  ensure: (store: CloudStore) => Promise<PoolEnsure>;
  /**
   * Empties the store and forgets the copy, so the next `ensure` starts afresh: once any bring-up
   * already under way has finished, since emptying the store under one would have it answer ok over
   * a store holding nothing.
   */
  drop: () => Promise<void>;
  /** The copy the store holds, and how many of its parts. */
  held: () => { copy: string | null; version: number | null; keys: number };
};

/** The parts a rebuild reads: what the boards are built from, and the tidy stamp. */
const loaded = (key: string): boolean => isBoardInput(key) || key === TIDY_STAMP_KEY;

const NO_SEASONS: SeasonReader = () => ({ teams: [], matchups: [], logs: {} });

/**
 * A cache for one process. The pool store is the module's, so a process has one pool and one cache:
 * a second would empty the first's store under it.
 *
 * It starts afresh when it holds no copy, when the copy is a new one (a reset, which a fresh start
 * costs only seconds to be sure of), after any write to the store it did not make itself (heard
 * through the store's write listener; a build makes none), and whenever the copy keeps an older
 * pool's games under one key. Those are split into years by the age groups as the store opens, so
 * the years the store holds are not parts of the copy, and an edit to the age groups would leave
 * them split the old way if only the age groups were laid in; and so the next start after such a
 * copy is a fresh one too, whatever that copy holds, since the years the split made are in the
 * store and in nothing the cache keeps of the copy.
 *
 * Otherwise it fetches the parts whose hash differs from the one it holds, by what they say rather
 * than which upload holds them, and takes out the keys the copy no longer has. Everything is fetched
 * before the store is touched, so a fetch that fails leaves the store as the last `ensure` did.
 */
export const createPoolCache = ({
  maxTries = 3,
  io = memoryIo,
}: {
  maxTries?: number;
  /** The store's backing, made afresh on each start; in memory by default. */
  io?: () => PoolStoreIo;
} = {}): PoolCache => {
  /** Each part the store holds, by key, with the hash of its value. */
  const held = new Map<string, string>();
  let copy: string | null = null;
  let version: number | null = null;
  let seasons: SeasonReader = NO_SEASONS;
  /** Keys written since the store was started, other than by laying the copy's values in. */
  const dirty = new Set<string>();

  /**
   * Starts the store afresh on `values`, laid into its backing before it opens, as a browser's store
   * opens on what it already holds. Opening is when an older pool's one-key games are split into
   * years, so that happens here, awaited and unheard, rather than on the build's first read with
   * the old key emptied by a write still queued when the next `ensure` starts. Says whether the
   * store opened holding every value, read back through it: a value its backing would not take, or
   * an opening that failed and left it reading nothing, says no.
   */
  const start = async (values: ReadonlyMap<string, unknown>): Promise<boolean> => {
    dropNow();
    const backing = io();
    // A backing that throws has not taken the value, as one that says so has not.
    await Promise.all(
      [...values].map(([key, value]) =>
        Promise.resolve()
          .then(() => backing.set(key, value))
          .catch(() => false)
      )
    );
    await initTeamRankingsStore(backing);
    // The store opens a channel to other tabs; a server has none, and an open channel would keep a
    // worker's thread alive.
    resetPoolSync();
    onCloudPoolWrite((key) => dirty.add(key));
    // An older pool's one key is split into years as the store opens, which empties it and writes
    // the years and their index over any the copy held, empty ones included: what the store holds
    // of the games is the split's, not the copy's, so they are not read back.
    const split = values.has(LEGACY_GAMES_KEY);
    const opened = await Promise.all(
      [...values.keys()].map(
        async (key) => (split && isScoutGamesKey(key)) || (await readCloudPoolValue(key)) != null
      )
    );
    return opened.every(Boolean);
  };

  const dropNow = (): void => {
    onCloudPoolWrite(null);
    resetTeamRankingsStore();
    held.clear();
    copy = null;
    version = null;
    seasons = NO_SEASONS;
    dirty.clear();
  };

  const load = async (store: CloudStore): Promise<PoolEnsure> => {
    let manifest = await store.readManifest();
    for (let tries = 1; ; tries += 1) {
      if (!manifest) {
        dropNow();
        return { ok: false, reason: "no-copy" };
      }
      // Both before any piece is read. A part this build does not know is refused rather than left
      // out, since a newer build's new key could be one the boards should read.
      if (manifest.schema > DATA_SCHEMA) return { ok: false, reason: "newer-schema" };
      if (manifest.parts.some(({ key }) => key !== LEAGUE_PART && !isCloudPoolKey(key))) {
        return { ok: false, reason: "unknown-key" };
      }

      const parts = manifest.parts.filter(({ key }) => loaded(key));
      const cold =
        copy !== manifest.copy ||
        dirty.size > 0 ||
        held.has(LEGACY_GAMES_KEY) ||
        parts.some(({ key }) => key === LEGACY_GAMES_KEY);
      const want = cold ? parts : parts.filter((part) => held.get(part.key) !== part.hash);
      const named = new Set(parts.map(({ key }) => key));
      const gone = cold ? [] : [...held.keys()].filter((key) => !named.has(key));

      const fetched = await fetchValues({ store, parts: want });
      if (!fetched.ok) {
        if (fetched.reason === "damaged") return { ok: false, reason: "damaged" };
        // A piece is not there. Either a save replaced the part and deleted its pieces after its
        // commit, and the copy is to be read again, or the copy still names it and is damaged.
        const again = await store.readManifest();
        const was = want.find(({ key }) => key === fetched.key);
        if (again?.parts.some(({ key, id }) => key === fetched.key && id === was?.id)) {
          return { ok: false, reason: "damaged" };
        }
        if (tries >= maxTries) return { ok: false, reason: "kept-moving" };
        manifest = again;
        continue;
      }

      let readSeason = seasons;
      if (!named.has(LEAGUE_PART)) readSeason = NO_SEASONS;
      else if (fetched.values.has(LEAGUE_PART)) {
        const reader = seasonReaderOf(fetched.values.get(LEAGUE_PART));
        if (!reader) return { ok: false, reason: "league-unreadable" };
        readSeason = reader;
      }

      const values = new Map<string, unknown>();
      fetched.values.forEach((value, key) => {
        if (key !== LEAGUE_PART) values.set(key, value);
      });
      gone.forEach((key) => {
        if (key !== LEAGUE_PART) values.set(key, null);
      });
      // A store that refuses a value, or throws rather than take it, is emptied, so the next
      // `ensure` starts afresh.
      const taken = cold ? await start(values) : await applyCloudPoolValues(values);
      if (!taken) {
        dropNow();
        return { ok: false, reason: "store-refused" };
      }
      gone.forEach((key) => held.delete(key));
      want.forEach((part) => held.set(part.key, part.hash));
      copy = manifest.copy;
      version = manifest.version;
      seasons = readSeason;

      // Read off the store, so it is the copy's stamp whether or not it was fetched this time.
      if (stampFromNewerRules(loadTidyStamp())) return { ok: false, reason: "newer-rules" };
      return {
        ok: true,
        manifest,
        readSeason,
        cold,
        fetched: want.map(({ key }) => key),
        gone,
        pieces: want.reduce((sum, part) => sum + part.chunks, 0),
        bytes: want.reduce((sum, part) => sum + part.bytes, 0),
        tries,
      };
    }
  };

  /** Bring-ups and drops, one at a time in the order asked. */
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T> | T): Promise<T> => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    ensure: (store) => inTurn(() => load(store)),
    drop: () => inTurn(dropNow),
    held: () => ({ copy, version, keys: held.size }),
  };
};
