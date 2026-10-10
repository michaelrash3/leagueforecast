import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  copyOwed,
  copyReader,
  copySeen,
  liveReader,
  memberToken,
  pullJobStore,
  type CopySeen,
} from "../lib/cloud/cloudSession";
import type { CopyReader } from "../lib/live/copyArchive";
import { callStartPull, type CallDeps } from "../lib/live/editClient";
import type { PullSender } from "../lib/cloud/cloudPulls";
import { loadCloudState } from "../lib/cloud/cloudState";
import { forgetLiveBoard } from "../lib/live/liveBoard";
import {
  boardStanding,
  checkLiveMeta,
  failedLive,
  readBoard,
  readLive,
  type BoardRead,
  type BoardStanding,
  type LiveMiss,
  type LiveRead,
} from "../lib/live/liveClient";
import { openViewCache, type ViewCache } from "../lib/live/viewCache";
import type { LiveMeta, LiveReader } from "../lib/live/viewStore";
import { boardKey, type BoardView, type LivePages } from "../lib/live/views/boardShape";
import type { SeasonSegment } from "../lib/teamRankings";
import { segmentWorthShowing } from "./useRankingsPages";

/** Where the live board comes from: the browser's own, or stand-ins for a test. */
export type LiveSources = {
  /** The account this browser's cloud record is for, which the views it kept are tagged with. */
  uid: () => string | null;
  /** The signed-in member's reader of `live/`, or null (`liveReader`). */
  reader: () => Promise<LiveReader | null>;
  cache: ViewCache;
  /** The copy as this device last read or saved it (`copySeen`). */
  seen: () => CopySeen | null;
  /** The parts this device owes the copy (`copyOwed`): none of League while it is kept live. */
  owed: () => string[];
  now: () => string;
  /** How edits reach the edit function: the member's own sign-in and `fetch` when not given. */
  call?: CallDeps;
  /** The signed-in member's reader of the copy itself, or null (`copyReader`): none, when not given. */
  copy?: () => Promise<CopyReader | null>;
  /** Where a pull is sent to be run in the cloud (`cloudPulls.ts`), or null: none, when not given. */
  pulls?: () => PullSender | null;
};

let browserSources: LiveSources | null = null;
/** The browser's own sources, made once. */
export const browserLiveSources = (): LiveSources =>
  (browserSources ??= {
    uid: () => loadCloudState().uid,
    reader: liveReader,
    cache: openViewCache(),
    seen: copySeen,
    owed: copyOwed,
    now: () => new Date().toISOString(),
    copy: copyReader,
    pulls: () => {
      const jobs = pullJobStore();
      return jobs ? { jobs, start: (jobId) => callStartPull(jobId, { token: memberToken }) } : null;
    },
  });

/** Reads nothing but what the device holds: a board not kept reads as offline. */
const OFFLINE = { code: "unavailable" };
const KEPT_ONLY: LiveReader = {
  readMeta: () => Promise.reject(OFFLINE),
  getChunk: () => Promise.reject(OFFLINE),
};

export type LiveMetaState = { meta: LiveMeta; pages: LivePages; from: "cache" | "network" };

export type LiveBoardState = {
  /** The meta the board is laid out by: the one this account last read, then the network's. */
  meta: LiveMetaState | null;
  /** Why the network gave no meta to draw from, once asked; `no-reader` when it could not be. */
  metaMiss: LiveMiss | "no-reader" | null;
  /** Whether the network's board is the copy's as this device found it, once read. */
  standing: BoardStanding | null;
  /** The page's half, as the page itself would open on it, and the board's key. */
  segment: SeasonSegment | undefined;
  key: string | null;
  /**
   * The board drawn: its key and fingerprint, the board itself (rows, last week and the rank
   * line), and whether the network vouched for it.
   */
  board: { key: string; h: string; view: BoardView; checked: boolean } | null;
  /** Why the network's board for the key cannot be drawn, once asked. */
  boardMiss: Extract<BoardRead, { ok: false }>["why"] | null;
  /**
   * Whether the board for the key was looked for in what this device kept, while the meta is the
   * kept one, and not found: with no network to read it from, there is then nothing to draw.
   */
  keptMissed: boolean;
  /**
   * When the server last vouched for what is drawn, as an ISO instant: the network's read of the
   * meta, or the watch's last word from the server; for a kept meta, when this account read it.
   * While the network's board for the key cannot be read for want of a connection and an older
   * one stays drawn, when that board was last vouched for, so the label never dates it later.
   * Null before any.
   */
  heardAt: string | null;
  /**
   * Whether the watch on the meta hears the server: `live` while it does, `cut-off` once the
   * connection drops or the watch ends, while the board on screen may fall behind. Null with no
   * watch, or before it has heard anything.
   */
  link: "live" | "cut-off" | null;
  /**
   * Whether the server has answered for the meta since the page opened: the network's read of it
   * came back (Firestore Lite reads only from the server), or the watch said a snapshot came from
   * the server rather than the device's own cache. Whatever the answer was, a meta to draw or one
   * this build cannot draw, older, newer, missing or unreadable: it is the cloud's word, which is
   * what edits wait on (`editLock`), not whether a board can be drawn.
   */
  heard: boolean;
  /**
   * The copy edits are made on: the one the meta the server last answered with names, from its
   * header though this build cannot draw its boards, or, where nothing published names one, the
   * copy the cloud holds, read from its manifest (`LiveSources.copy`); before the server has
   * answered, the kept meta's. Null where none of them is known. A new object only when the copy
   * or its version is.
   */
  copy: LiveMeta["copy"] | null;
  /**
   * Where another view of the meta on screen is read from, for a page that reads more than its
   * board (a club's card): the network's reader once the meta is the network's, else only what this
   * device kept. Null before any meta.
   */
  source: LiveViewSource | null;
};

/** A meta, and what its views are read through (`readView`). */
export type LiveViewSource = {
  reader: LiveReader;
  meta: LiveMeta;
  cache: ViewCache;
  /**
   * Whether a view this source cannot read cannot be had: the meta is the network's, or the
   * network has given none. Before that, the meta is only the one this device kept and its reader
   * reads only what was kept, so a view it lacks is still to come from the network's source.
   */
  settled: boolean;
  /**
   * For a read of a view the rules refused: every board kept and held is let go and the page told
   * the account is refused, as a refused read of the meta does, since the account may no longer see
   * any of it.
   */
  refused: () => void;
};

const NO_GAMES = { fall: 0, spring: 0 } as const;

/**
 * The published board of one page (`pageId` in squad year `year`), as a member's device reads it:
 * from what this account last read and kept first, so it draws without a network read, and then
 * from the network, which checks it or replaces it. The half is the page's own choice: the URL's,
 * else the calendar's unless the published counts say it holds next to nothing
 * (`segmentWorthShowing`), as Team Rankings decides from its own pool.
 *
 * The meta is read once a mount, then watched where the reader can (`watchMeta`): a publish while
 * the page is open is taken as a read would be, and the board on screen is read again only when the
 * meta names another one for its key. A refusal by the rules, read or heard, clears every board
 * kept and held, since this account may no longer see them.
 */
export function useLiveBoard({
  pageId,
  year,
  routeSegment,
  calendarSegment,
  sources = browserLiveSources(),
}: {
  pageId: string;
  year: number | undefined;
  routeSegment: SeasonSegment | undefined;
  calendarSegment: SeasonSegment | undefined;
  sources?: LiveSources;
}): LiveBoardState {
  const [meta, setMeta] = useState<LiveMetaState | null>(null);
  const [metaMiss, setMetaMiss] = useState<LiveBoardState["metaMiss"]>(null);
  const [standing, setStanding] = useState<BoardStanding | null>(null);
  const [board, setBoard] = useState<LiveBoardState["board"]>(null);
  const [boardMiss, setBoardMiss] = useState<LiveBoardState["boardMiss"]>(null);
  const [heardAt, setHeardAt] = useState<string | null>(null);
  const [link, setLink] = useState<LiveBoardState["link"]>(null);
  // The server's last answer for the meta, by the copy it named; null before any.
  const [heard, setHeard] = useState<{ copy: LiveMeta["copy"] | null } | null>(null);
  const readerRef = useRef<LiveReader | null>(null);
  // The same reader, for what a render hands on (`source`), which may not read a ref.
  const [networkReader, setNetworkReader] = useState<LiveReader | null>(null);
  // The board on screen, for the read of a board to see without depending on it.
  const boardRef = useRef<LiveBoardState["board"]>(null);
  const show = (next: LiveBoardState["board"]) => {
    boardRef.current = next;
    setBoard(next);
  };
  // When the board on screen was last vouched for, and when the kept meta was read.
  const [boardAt, setBoardAt] = useState<string | null>(null);
  const keptAtRef = useRef<string | null>(null);
  /*
   * Why the network's board could not be read, for the watch to see, and a count it moves on when
   * the server is heard again after a board read failed for want of a connection, so that board is
   * read again then rather than at the next publish.
   */
  const boardMissRef = useRef<LiveBoardState["boardMiss"]>(null);
  const [keptMissKey, setKeptMissKey] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const missBoard = (why: LiveBoardState["boardMiss"]) => {
    boardMissRef.current = why;
    setBoardMiss(why);
  };

  useEffect(() => {
    let alive = true;
    let unwatch: (() => void) | null = null;
    const { cache } = sources;
    const forgetAll = () => {
      forgetLiveBoard();
      setMeta(null);
      setHeard(null);
      show(null);
    };
    /** The server's answer, by the copy it names: the same object while that copy and version are. */
    const hear = (copy: LiveMeta["copy"] | null) =>
      setHeard((was) =>
        was && was.copy?.id === copy?.id && was.copy?.version === copy?.version ? was : { copy }
      );
    /**
     * The copy the cloud holds, by its manifest, for edits to be made on where nothing published
     * names one; null where it cannot be read.
     */
    const heldCopy = async (): Promise<LiveMeta["copy"] | null> => {
      const reader = await (sources.copy?.() ?? Promise.resolve(null)).catch(() => null);
      const manifest = await (reader?.readManifest() ?? Promise.resolve(null)).catch(() => null);
      return manifest ? { id: manifest.copy, version: manifest.version } : null;
    };
    // The meta on screen as JSON, so one heard again unchanged is not taken again, and a count of
    // takes, so a slower take cannot put an older meta over a later one.
    let shownPrint: string | null = null;
    let takes = 0;
    /**
     * A read of the meta from the network, or one heard from the server: kept, and put on screen if
     * it is new. Every one that is not a failure is the server's word (`heard`), drawn or not.
     */
    const take = async (read: LiveRead) => {
      // Reads and snapshots come in order, so the latest take is the meta as it now stands.
      const turn = (takes += 1);
      if (!read.ok) {
        if (read.why === "refused") forgetAll();
        setMetaMiss(read.why);
        if (read.why === "offline" || read.why === "refused") return;
        // A meta this build does not draw: edits go on, made on the copy its header names.
        if (read.copy) {
          hear(read.copy);
          return;
        }
        // Nothing published names one, so the cloud's own manifest does: read beside the watch,
        // which this does not hold up, and dropped if the server has said more meanwhile.
        void heldCopy().then((copy) => {
          if (alive && turn === takes) hear(copy);
        });
        return;
      }
      hear(read.meta.copy);
      const at = sources.now();
      setHeardAt(at);
      const uid = sources.uid();
      if (uid) void cache.keepMeta(uid, read.meta, at).catch(() => undefined);
      const print = JSON.stringify(read.meta);
      if (print === shownPrint) {
        setMetaMiss(null);
        return;
      }
      const stands = await boardStanding({
        meta: read.meta,
        seen: sources.seen(),
        owed: sources.owed(),
      });
      if (!alive || turn !== takes) return;
      shownPrint = print;
      setStanding(stands);
      setMeta({ meta: read.meta, pages: read.pages, from: "network" });
      setMetaMiss(null);
    };
    void (async () => {
      const uid = sources.uid();
      if (uid) {
        const kept = await cache.meta(uid).catch(() => null);
        const read = kept ? checkLiveMeta(kept.meta) : null;
        if (alive && kept && read?.ok) {
          keptAtRef.current = kept.readAt;
          setMeta((shown) => shown ?? { meta: read.meta, pages: read.pages, from: "cache" });
          setHeardAt((at) => at ?? kept.readAt);
        }
      }
      const reader = await sources.reader().catch(() => null);
      if (!alive) return;
      if (!reader) {
        setMetaMiss("no-reader");
        return;
      }
      readerRef.current = reader;
      setNetworkReader(reader);
      const first = await readLive(reader, cache);
      if (!alive) return;
      await take(first);
      if (!alive || !reader.watchMeta || (!first.ok && first.why === "refused")) return;
      // Nothing after the last wait: the watch is in place before a cleanup could run.
      unwatch = reader.watchMeta({
        next: (raw, fromServer) => {
          if (!alive) return;
          setLink(fromServer ? "live" : "cut-off");
          if (fromServer && boardMissRef.current === "offline") setRetries((count) => count + 1);
          // Cut off, it hears only what it last heard: nothing to take.
          if (fromServer) void take(checkLiveMeta(raw));
        },
        error: (error) => {
          if (!alive) return;
          setLink("cut-off");
          void failedLive(error, cache).then((why) => {
            if (!alive || why !== "refused") return;
            forgetAll();
            setMetaMiss("refused");
          });
        },
      });
    })();
    return () => {
      alive = false;
      unwatch?.();
    };
  }, [sources]);

  const segment = meta
    ? (routeSegment ?? segmentWorthShowing(calendarSegment, meta.pages.halves[pageId] ?? NO_GAMES))
    : undefined;
  const key = meta && pageId ? boardKey(year, pageId, segment ?? "year") : null;

  /*
   * A read the rules refused, of a board or of another view the page reads beside it: every board
   * kept and held is let go and the page told the account is refused, as a refused read of the meta
   * does, since the account may no longer see any of it.
   */
  const refuse = useCallback(() => {
    forgetLiveBoard();
    boardRef.current = null;
    setBoard(null);
    setMeta(null);
    setHeard(null);
    setMetaMiss("refused");
  }, []);

  useEffect(() => {
    if (!meta || !key) return;
    const network = meta.from === "network";
    const reader = network ? readerRef.current : KEPT_ONLY;
    if (!reader) return;
    // A newer meta that names the same board for this key, as a publish of other pages' boards
    // does, leaves the board on screen as it is.
    const shown = boardRef.current;
    if (shown?.key === key && shown.h === meta.meta.views[key]?.h && (shown.checked || !network))
      return;
    let alive = true;
    void (async () => {
      const read = await readBoard({ reader, meta: meta.meta, key, cache: sources.cache });
      if (!alive) return;
      if (read.ok) {
        show({ key, h: read.entry.h, view: read.view, checked: network });
        setBoardAt(network ? sources.now() : keptAtRef.current);
        if (network) missBoard(null);
        const uid = sources.uid();
        if (network && uid)
          void sources.cache.keepLastShown(uid, { key, h: read.entry.h }).catch(() => undefined);
      } else if (network) {
        missBoard(read.why);
        // A board refused, though its meta was read (a half or page moved to after the account was
        // taken off the list), is the meta's refusal: missed alone, it would say nothing and keep
        // reading for ever, with edits on that the server refuses.
        if (read.why === "refused") refuse();
      } else setKeptMissKey(key);
    })();
    return () => {
      alive = false;
    };
  }, [meta, key, sources, retries, refuse]);

  const settled = meta?.from === "network" || metaMiss !== null;
  const source = useMemo(
    (): LiveViewSource | null =>
      meta
        ? {
            reader: (meta.from === "network" ? networkReader : null) ?? KEPT_ONLY,
            meta: meta.meta,
            cache: sources.cache,
            settled,
            refused: refuse,
          }
        : null,
    [meta, networkReader, sources, settled, refuse]
  );
  const shownBoard = board && board.key === key ? board : null;
  const shownMiss = board && board.key !== key ? null : boardMiss;

  return {
    meta,
    metaMiss,
    standing,
    segment,
    key,
    board: shownBoard,
    boardMiss: shownMiss,
    keptMissed: meta?.from === "cache" && keptMissKey === key,
    heardAt: shownBoard && shownMiss === "offline" ? (boardAt ?? heardAt) : heardAt,
    link,
    heard: heard !== null,
    copy: heard?.copy ?? meta?.meta.copy ?? null,
    source,
  };
}
