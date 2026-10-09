import { inBatches } from "../cloud/cloudEngine";
import { chunkId } from "../cloud/cloudManifest";
import { unpackChunks } from "../cloud/cloudPack";
import type { CopySeen } from "../cloud/cloudSession";
import { BOARD_FAMILY, boardInputsPrintOf, isBoardInput } from "./boardInputs";
import type { ViewCache } from "./viewCache";
import {
  coerceLiveMeta,
  LIVE_FORMAT,
  LIVE_SCHEMA,
  type LiveMeta,
  type LiveReader,
  type ViewEntry,
} from "./viewStore";
import {
  coerceBoardView,
  coerceLivePages,
  type BoardView,
  type LivePages,
} from "./views/boardShape";

/**
 * How a member's device reads what a server publishes (`viewStore.ts`): the meta, then the pieces
 * of the one view on its screen, each checked before anything is drawn from it. Nothing read here
 * is trusted. A meta must be one this build reads, of this build's schema, with the pages' counts
 * it lays the page out by; a view's joined pieces must unzip to the very bytes its fingerprint
 * names, and those bytes to rows of the shape a board draws. Anything else is said, never drawn.
 *
 * A board read here is a stand-in, as the saved board is (`savedBoard.ts`): it is drawn until the
 * device's own fit lands, and `boardStanding` says only whether it is the copy's as the device
 * last found the copy, which decides what it is labelled and how soon the page moves to the
 * device's own pool.
 */

/**
 * Why `live/` gave nothing to draw:
 * - `none`: nothing has been published.
 * - `older`: published by an older build, in a shape this one does not read, until the next publish.
 * - `newer`: published by a newer build: this app needs updating.
 * - `unreadable`: not a meta at all, or its pages' counts are not.
 * - `refused`: this account may not read it, so the views this device kept are cleared.
 * - `offline`: the read failed or took too long.
 */
export type LiveMiss = "none" | "older" | "newer" | "unreadable" | "refused" | "offline";

export type LiveRead =
  { ok: true; meta: LiveMeta; pages: LivePages } | { ok: false; why: LiveMiss };

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * What a failed read says: refused only when the rules refused it (`permission-denied`, as
 * Firestore names it), and offline for anything else, a timeout included, which the next read may
 * not meet.
 */
export const failureOf = (error: unknown): "refused" | "offline" =>
  isRecord(error) && error.code === "permission-denied" ? "refused" : "offline";

/** A meta as read (`LiveReader.readMeta`), checked: what a page may be drawn from, or why not. */
export const checkLiveMeta = (raw: unknown): LiveRead => {
  if (raw === null || raw === undefined) return { ok: false, why: "none" };
  if (isRecord(raw) && typeof raw.format === "number" && raw.format > LIVE_FORMAT)
    return { ok: false, why: "newer" };
  const meta = coerceLiveMeta(raw);
  if (!meta) return { ok: false, why: "unreadable" };
  if (meta.schema < LIVE_SCHEMA) return { ok: false, why: "older" };
  if (meta.schema > LIVE_SCHEMA) return { ok: false, why: "newer" };
  const pages = coerceLivePages(meta.inline.pages);
  return pages ? { ok: true, meta, pages } : { ok: false, why: "unreadable" };
};

const refused = async (cache: ViewCache | undefined): Promise<void> => {
  await cache?.clear().catch(() => undefined);
};

/**
 * What a failed read or watch of `live/` says (`failureOf`), with a refusal clearing what `cache`
 * kept: this account may not see it.
 */
export const failedLive = async (
  error: unknown,
  cache?: ViewCache
): Promise<"refused" | "offline"> => {
  const why = failureOf(error);
  if (why === "refused") await refused(cache);
  return why;
};

/** Reads and checks the meta. A refusal clears what `cache` kept: this account may not see it. */
export const readLive = async (reader: LiveReader, cache?: ViewCache): Promise<LiveRead> => {
  let raw: unknown;
  try {
    raw = await reader.readMeta();
  } catch (error) {
    return { ok: false, why: await failedLive(error, cache) };
  }
  return checkLiveMeta(raw);
};

/** Views decoded this page load, by fingerprint: the last few of a kind, so going back is free. */
const DECODED_KEPT = 6;

/** A place to keep the views of one kind decoded this page load, by fingerprint. */
export type DecodedViews<T> = Map<string, T>;

const remember = <T>(memory: DecodedViews<T>, h: string, view: T): T => {
  memory.delete(h);
  memory.set(h, view);
  for (const oldest of memory.keys()) {
    if (memory.size <= DECODED_KEPT) break;
    memory.delete(oldest);
  }
  return view;
};

const decodedBoards: DecodedViews<BoardView> = new Map();

/** Only for tests: forgets the boards decoded so far. */
export const forgetDecodedBoards = (): void => decodedBoards.clear();

/**
 * One view read:
 * - `memory`, `cache` or `network`: where its checked value came from, with the meta that names
 *   it, which is a newer one than asked with when a piece was missing and the meta read again.
 * - `missing`: the meta names no view under the key: a page made since the last publish, or one
 *   only this device has.
 * - `damaged`: its pieces do not unzip to the bytes its fingerprint names, or those bytes are not
 *   a view of its kind. Never drawn and never kept.
 * - `gone`: a piece is not there, and reading the meta again found no way to it: a publish retired
 *   it, and the sweep took it, while this device held the older meta.
 * - `refused`, `offline`: as `LiveMiss`.
 */
export type ViewRead<T> =
  | {
      ok: true;
      view: T;
      entry: ViewEntry;
      meta: LiveMeta;
      from: "memory" | "cache" | "network";
    }
  | { ok: false; why: "missing" | "damaged" | "gone" | "refused" | "offline"; meta: LiveMeta };

/** One board read (`readView`). */
export type BoardRead = ViewRead<BoardView>;

/** The pieces of `entry`'s upload, joined, or null when one of them is not there. */
const fetchPieces = async (reader: LiveReader, entry: ViewEntry): Promise<Uint8Array | null> => {
  const ids = Array.from({ length: entry.c }, (_, index) => chunkId(entry.id, index));
  const pieces = new Map<string, Uint8Array | null>();
  await inBatches(ids, async (id) => {
    pieces.set(id, await reader.getChunk(id));
  });
  const ordered = ids.map((id) => pieces.get(id) ?? null);
  if (ordered.some((piece) => piece === null)) return null;
  const joined = new Uint8Array(ordered.reduce((sum, piece) => sum + (piece?.length ?? 0), 0));
  let at = 0;
  for (const piece of ordered) {
    if (!piece) continue;
    joined.set(piece, at);
    at += piece.length;
  }
  return joined;
};

/**
 * The view under `key` in `meta`: from those of its kind decoded this page load (`memory`), then
 * from `cache`, then from the network, every one checked against the fingerprint the meta names
 * and read as a view of its kind (`coerce`). A piece that is not there costs one read of the meta,
 * and the view is fetched again from whatever upload it names now; never more than one. A view
 * fetched is kept in `cache` by its fingerprint. The checker is the caller's, so a page that reads
 * one kind of view loads no other kind's.
 */
export const readView = async <T>({
  reader,
  meta,
  key,
  cache,
  coerce,
  memory,
}: {
  reader: LiveReader;
  meta: LiveMeta;
  key: string;
  cache?: ViewCache | undefined;
  coerce: (raw: unknown) => T | null;
  memory: DecodedViews<T>;
}): Promise<ViewRead<T>> => {
  let current = meta;
  let entry = current.views[key];
  if (!entry) return { ok: false, why: "missing", meta: current };

  const held = memory.get(entry.h);
  if (held !== undefined)
    return {
      ok: true,
      view: remember(memory, entry.h, held),
      entry,
      meta: current,
      from: "memory",
    };

  const kept = cache ? await cache.view(entry.h).catch(() => null) : null;
  if (kept !== null) {
    const view = coerce(kept);
    if (view === null) return { ok: false, why: "damaged", meta: current };
    return { ok: true, view: remember(memory, entry.h, view), entry, meta: current, from: "cache" };
  }

  try {
    let joined = await fetchPieces(reader, entry);
    if (!joined) {
      const again = await readLive(reader, cache);
      if (!again.ok) {
        const why = again.why === "refused" || again.why === "offline" ? again.why : "gone";
        return { ok: false, why, meta: current };
      }
      current = again.meta;
      const moved = current.views[key];
      if (!moved) return { ok: false, why: "missing", meta: current };
      if (moved.id === entry.id) return { ok: false, why: "gone", meta: current };
      entry = moved;
      joined = await fetchPieces(reader, entry);
      if (!joined) return { ok: false, why: "gone", meta: current };
    }
    let view: T | null;
    try {
      view = coerce(await unpackChunks([joined], entry.h));
    } catch {
      view = null;
    }
    if (view === null) return { ok: false, why: "damaged", meta: current };
    await cache?.keepView(entry.h, joined).catch(() => undefined);
    return {
      ok: true,
      view: remember(memory, entry.h, view),
      entry,
      meta: current,
      from: "network",
    };
  } catch (error) {
    const why = failureOf(error);
    if (why === "refused") await refused(cache);
    return { ok: false, why, meta: current };
  }
};

/** The board under `key` in `meta` (`readView`), read as a board (`coerceBoardView`). */
export const readBoard = ({
  reader,
  meta,
  key,
  cache,
}: {
  reader: LiveReader;
  meta: LiveMeta;
  key: string;
  cache?: ViewCache;
}): Promise<BoardRead> =>
  readView({ reader, meta, key, cache, coerce: coerceBoardView, memory: decodedBoards });

/**
 * Whether a published board is the copy's as this device knows it:
 * - `owed`: this device has changes to a board input it has not saved yet, so no published board
 *   has them.
 * - `current`: built, every board of them by one build, from the very board inputs the copy held
 *   when this device last read or saved it (`copySeen`).
 * - `behind-copy`: built from other inputs at a version of the copy no later than the one this
 *   device holds: the copy has moved on since they were built, or they are of another copy, or the
 *   boards were last written by more than one build (a floor record, `BuiltFrom`), which vouches
 *   for no inputs. A board built from a later version of the same copy is `current`: the copy moved
 *   past what this device holds (by an edit sent from this page, or another device's), and the board
 *   has what the device's own copy, which a handover opens, does not yet.
 * - `unknown`: this device has not read the copy this session.
 *
 * Only board inputs count (`isBoardInput`): a change to anything else leaves every board as it was.
 * The members' day is the label's business, not this: yesterday's board of today's copy is still
 * the copy's.
 */
export type BoardStanding = "current" | "behind-copy" | "owed" | "unknown";

export const boardStanding = async ({
  meta,
  seen,
  owed,
}: {
  meta: LiveMeta;
  seen: CopySeen | null;
  /** The parts this device owes the copy (`owedChanges`), by key. */
  owed: Iterable<string>;
}): Promise<BoardStanding> => {
  for (const key of owed) if (isBoardInput(key)) return "owed";
  if (!seen) return "unknown";
  // A floor record's inputs are empty, which no copy's fingerprint is.
  const built = meta.built[BOARD_FAMILY];
  if (!built) return "behind-copy";
  if (built.inputs === (await boardInputsPrintOf(seen.parts))) return "current";
  return built.k === seen.copy && built.v > seen.version ? "current" : "behind-copy";
};
