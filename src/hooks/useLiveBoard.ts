import { useEffect, useRef, useState } from "react";
import { copySeen, liveReader, type CopySeen } from "../lib/cloud/cloudSession";
import { loadCloudState, owedChanges } from "../lib/cloud/cloudState";
import { forgetLiveBoard } from "../lib/live/liveBoard";
import {
  boardStanding,
  checkLiveMeta,
  readBoard,
  readLive,
  type BoardRead,
  type BoardStanding,
  type LiveMiss,
} from "../lib/live/liveClient";
import { openViewCache, type ViewCache } from "../lib/live/viewCache";
import type { LiveMeta, LiveReader } from "../lib/live/viewStore";
import { boardKey, type BoardRow, type LivePages } from "../lib/live/views/boardShape";
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
  /** The parts this device owes the copy (`owedChanges`). */
  owed: () => string[];
  now: () => string;
};

let browserSources: LiveSources | null = null;
const browser = (): LiveSources =>
  (browserSources ??= {
    uid: () => loadCloudState().uid,
    reader: liveReader,
    cache: openViewCache(),
    seen: copySeen,
    owed: () => Object.keys(owedChanges()),
    now: () => new Date().toISOString(),
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
  /** The board drawn: its key and fingerprint, its rows, and whether the network vouched for it. */
  board: { key: string; h: string; rows: readonly BoardRow[]; checked: boolean } | null;
  /** Why the network's board for the key cannot be drawn, once asked. */
  boardMiss: Extract<BoardRead, { ok: false }>["why"] | null;
};

const NO_GAMES = { fall: 0, spring: 0 } as const;

/**
 * The published board of one page (`pageId` in squad year `year`), as a member's device reads it:
 * from what this account last read and kept first, so it draws without a network read, and then
 * from the network, which checks it or replaces it. The half is the page's own choice: the URL's,
 * else the calendar's unless the published counts say it holds next to nothing
 * (`segmentWorthShowing`), as Team Rankings decides from its own pool.
 *
 * The meta is read once a mount; a board is read whenever the key moves. A refusal by the rules
 * clears every board kept and held, since this account may no longer see them.
 */
export function useLiveBoard({
  pageId,
  year,
  routeSegment,
  calendarSegment,
  sources = browser(),
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
  const readerRef = useRef<LiveReader | null>(null);

  useEffect(() => {
    let alive = true;
    const { cache } = sources;
    void (async () => {
      const uid = sources.uid();
      if (uid) {
        const kept = await cache.meta(uid).catch(() => null);
        const read = kept ? checkLiveMeta(kept.meta) : null;
        if (alive && read?.ok)
          setMeta((shown) => shown ?? { meta: read.meta, pages: read.pages, from: "cache" });
      }
      const reader = await sources.reader().catch(() => null);
      if (!alive) return;
      if (!reader) {
        setMetaMiss("no-reader");
        return;
      }
      readerRef.current = reader;
      const live = await readLive(reader, cache);
      if (!alive) return;
      if (!live.ok) {
        if (live.why === "refused") {
          forgetLiveBoard();
          setMeta(null);
          setBoard(null);
        }
        setMetaMiss(live.why);
        return;
      }
      if (uid) void cache.keepMeta(uid, live.meta, sources.now()).catch(() => undefined);
      const stands = await boardStanding({
        meta: live.meta,
        seen: sources.seen(),
        owed: sources.owed(),
      });
      if (!alive) return;
      setStanding(stands);
      setMeta({ meta: live.meta, pages: live.pages, from: "network" });
    })();
    return () => {
      alive = false;
    };
  }, [sources]);

  const segment = meta
    ? (routeSegment ?? segmentWorthShowing(calendarSegment, meta.pages.halves[pageId] ?? NO_GAMES))
    : undefined;
  const key = meta && pageId ? boardKey(year, pageId, segment ?? "year") : null;

  useEffect(() => {
    if (!meta || !key) return;
    const network = meta.from === "network";
    const reader = network ? readerRef.current : KEPT_ONLY;
    if (!reader) return;
    let alive = true;
    void (async () => {
      const read = await readBoard({ reader, meta: meta.meta, key, cache: sources.cache });
      if (!alive) return;
      if (read.ok) {
        setBoard({ key, h: read.entry.h, rows: read.view.rows, checked: network });
        if (network) setBoardMiss(null);
        const uid = sources.uid();
        if (network && uid)
          void sources.cache.keepLastShown(uid, { key, h: read.entry.h }).catch(() => undefined);
      } else if (network) {
        if (read.why === "refused") {
          forgetLiveBoard();
          setBoard(null);
        }
        setBoardMiss(read.why);
      }
    })();
    return () => {
      alive = false;
    };
  }, [meta, key, sources]);

  return {
    meta,
    metaMiss,
    standing,
    segment,
    key,
    board: board && board.key === key ? board : null,
    boardMiss: board && board.key !== key ? null : boardMiss,
  };
}
