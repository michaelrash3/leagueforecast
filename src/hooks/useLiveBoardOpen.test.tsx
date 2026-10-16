import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetDecodedBoards } from "../lib/live/liveClient";
import { forgetLiveBoard } from "../lib/live/liveBoard";
import { releaseOpening, resetOpeningHold } from "../lib/live/openingHold";
import { openViewCache, type ViewCacheIo } from "../lib/live/viewCache";
import { publishViews, type LiveReader } from "../lib/live/viewStore";
import { memoryLive, type MemoryLive } from "../lib/live/__tests__/memoryLive";
import { BOARD_FAMILY } from "../lib/live/boardInputs";
import type { BoardRow } from "../lib/live/views/boardShape";
import { useLiveBoard, type LiveSources } from "./useLiveBoard";

/*
 * How the live board opens (`useLiveBoard`): what this account kept drawn at once and decoded
 * once, the network read beside it rather than after it, a board fetched drawn before it is kept,
 * and the watch on the meta, which loads the full Firestore SDK, left until the board is drawn.
 * Placeholder names.
 */

const PAGE = "ag_12u_2027";
const KEY = `board:2027:${PAGE}:spring`;
const T = "2027-04-15T12:00:00.000Z";
const VIEW_PREFIX = "league_forecast_live_view_v1:";

const row = (teamId: string, rank: number): BoardRow => ({
  teamId,
  teamName: `Placeholder ${teamId}`,
  rank,
  rating: 5 - rank,
  pointRating: 6 - rank,
  record: "3-1",
  wins: 3,
  losses: 1,
  ties: 0,
  games: 4,
  rawMargin: 1.5,
  strengthOfSchedule: 0.2,
  sosRank: rank,
  crossAgeGames: 0,
  componentSize: 40,
  componentId: "S-1",
  comparable: true,
  fromGameChanger: true,
});

const publish = (live: MemoryLive) =>
  publishViews({
    store: live.store,
    views: [{ key: KEY, value: { rows: [row("S-1", 1), row("S-2", 2)] } }],
    owns: [BOARD_FAMILY],
    copy: { id: "c0ffee", version: 4 },
    today: "2027-04-15",
    now: T,
    inline: { pages: { pulledAt: T, halves: { [PAGE]: { fall: 10, spring: 20 } } } },
  });

/** What the device keeps, with every read of a kept view counted: one read is one decode. */
const keeping = () => {
  const kept = new Map<string, unknown>();
  const counts = { viewReads: 0 };
  const io: ViewCacheIo = {
    enabled: () => true,
    keys: async () => [...kept.keys()],
    get: async (key) => {
      if (key.startsWith(VIEW_PREFIX)) counts.viewReads += 1;
      return kept.get(key) ?? null;
    },
    set: async (key, value) => {
      kept.set(key, value);
      return true;
    },
    remove: async (key) => {
      kept.delete(key);
    },
    now: () => 1,
  };
  return { kept, counts, io };
};

const readerOf = (live: MemoryLive, more: Partial<LiveReader> = {}): LiveReader => ({
  readMeta: async () => (await live.store.readMeta())?.meta ?? null,
  getChunk: (id) => live.store.getChunk(id),
  ...more,
});

const sourcesOf = (io: ViewCacheIo, reader: () => Promise<LiveReader | null>): LiveSources => ({
  uid: () => "uid-1",
  reader,
  cache: openViewCache(io),
  seen: () => null,
  owed: () => [],
  now: () => T,
});

const openBoard = (sources: LiveSources) =>
  renderHook(() =>
    useLiveBoard({
      pageId: PAGE,
      year: 2027,
      routeSegment: "spring",
      calendarSegment: "spring",
      sources,
    })
  );

/** A first visit: the board read off the network and kept, as the next open finds it. */
const visitOnce = async (live: MemoryLive, io: ViewCacheIo) => {
  const first = openBoard(sourcesOf(io, async () => readerOf(live)));
  await waitFor(() => expect(first.result.current.board?.checked).toBe(true));
  // The meta and the board on screen are kept behind the draw; the view's bytes with it.
  await waitFor(async () => {
    const cache = openViewCache(io);
    expect(await cache.meta("uid-1")).not.toBeNull();
  });
  first.unmount();
  forgetDecodedBoards();
};

let live: MemoryLive;
beforeEach(async () => {
  resetOpeningHold();
  forgetDecodedBoards();
  forgetLiveBoard();
  live = memoryLive();
  await publish(live);
});

afterEach(() => {
  resetOpeningHold();
});

describe("the live board as it opens", () => {
  it("decodes the board this account kept once, on a warm open the network vouches for", async () => {
    const { io, counts } = keeping();
    await visitOnce(live, io);
    counts.viewReads = 0;
    const warm = openBoard(sourcesOf(io, async () => readerOf(live)));
    await waitFor(() => expect(warm.result.current.board?.checked).toBe(true));
    expect(warm.result.current.board?.view.rows.map((one) => one.teamId)).toEqual(["S-1", "S-2"]);
    expect(counts.viewReads).toBe(1);
  });

  it("remembers a previous board it decoded, when the page moves to a kept board's key", async () => {
    const { io, counts } = keeping();
    await visitOnce(live, io);
    counts.viewReads = 0;
    // Opened before the page is known, as before its pages are laid out, with no network.
    const sources = sourcesOf(io, async () => null);
    const opened = renderHook(
      ({ pageId }: { pageId: string }) =>
        useLiveBoard({
          pageId,
          year: 2027,
          routeSegment: "spring",
          calendarSegment: "spring",
          sources,
        }),
      { initialProps: { pageId: "" } }
    );
    await waitFor(() => expect(opened.result.current.metaMiss).toBe("no-reader"));
    expect(opened.result.current.board).toBeNull();
    opened.rerender({ pageId: PAGE });
    await waitFor(() => expect(opened.result.current.board?.view.rows).toHaveLength(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(counts.viewReads).toBe(1);
  });

  it("reads the network's meta while the kept board is still being read", async () => {
    const { io } = keeping();
    await visitOnce(live, io);
    // The kept board's bytes never come off the disk.
    const stuck: ViewCacheIo = {
      ...io,
      get: (key) => (key.startsWith(VIEW_PREFIX) ? new Promise(() => undefined) : io.get(key)),
    };
    const readMeta = vi.fn(async () => (await live.store.readMeta())?.meta ?? null);
    const opened = openBoard(sourcesOf(stuck, async () => readerOf(live, { readMeta })));
    await waitFor(() => expect(readMeta).toHaveBeenCalled());
    await waitFor(() => expect(opened.result.current.meta?.from).toBe("network"));
  });

  it("draws a board fetched from the network before it is kept", async () => {
    const { io } = keeping();
    // Keeping a view's bytes never finishes.
    const slow: ViewCacheIo = {
      ...io,
      set: (key, value) =>
        key.startsWith(VIEW_PREFIX) ? new Promise(() => undefined) : io.set(key, value),
    };
    const opened = openBoard(sourcesOf(slow, async () => readerOf(live)));
    await waitFor(() => expect(opened.result.current.board?.checked).toBe(true));
  });

  it("starts the watch on the meta only once the board's first draw lets it", async () => {
    const { io } = keeping();
    const watchMeta = vi.fn(live.watchMeta);
    const opened = openBoard(sourcesOf(io, async () => readerOf(live, { watchMeta })));
    await waitFor(() => expect(opened.result.current.board?.checked).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(watchMeta).not.toHaveBeenCalled();
    act(() => releaseOpening());
    await waitFor(() => expect(watchMeta).toHaveBeenCalledTimes(1));
  });

  it("says there is no reader only once what was kept has been looked at", async () => {
    const { io } = keeping();
    await visitOnce(live, io);
    let letGo = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const held: ViewCacheIo = {
      ...io,
      get: async (key) => {
        if (key.startsWith(VIEW_PREFIX)) await gate;
        return io.get(key);
      },
    };
    const opened = openBoard(sourcesOf(held, async () => null));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // Said now, with nothing drawn, the page would hand over though a board is kept.
    expect(opened.result.current.metaMiss).toBeNull();
    letGo();
    await waitFor(() => expect(opened.result.current.metaMiss).toBe("no-reader"));
    expect(opened.result.current.board?.view.rows).toHaveLength(2);
  });

  it("draws nothing kept once the network has refused the account", async () => {
    const { io } = keeping();
    await visitOnce(live, io);
    let letGo = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const held: ViewCacheIo = {
      ...io,
      get: async (key) => {
        if (key.startsWith(VIEW_PREFIX)) await gate;
        return io.get(key);
      },
    };
    const refused = readerOf(live, {
      readMeta: () => Promise.reject({ code: "permission-denied" }),
    });
    const opened = openBoard(sourcesOf(held, async () => refused));
    await waitFor(() => expect(opened.result.current.metaMiss).toBe("refused"));
    letGo();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(opened.result.current.board).toBeNull();
    expect(opened.result.current.meta).toBeNull();
  });
});
