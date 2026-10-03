import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudManifest, ManifestPart } from "../../lib/cloud/cloudManifest";
import { LEAGUE_PART } from "../../lib/cloud/cloudPlan";
import type { CopySeen } from "../../lib/cloud/cloudSession";
import { BOARD_FAMILY, builtFrom } from "../../lib/live/boardInputs";
import { forgetDecodedBoards } from "../../lib/live/liveClient";
import { forgetLiveBoard, liveBoardFor, type RankingsHandover } from "../../lib/live/liveBoard";
import { openViewCache, type ViewCacheIo } from "../../lib/live/viewCache";
import { publishViews, type LiveReader, type PublishedView } from "../../lib/live/viewStore";
import type { BoardRow, LivePages } from "../../lib/live/views/boardShape";
import { memoryLive, type MemoryLive } from "../../lib/live/__tests__/memoryLive";
import type { AgeGroup } from "../../lib/teamRankings";
import { resetTeamRankingsStore, saveAgeGroups } from "../../lib/teamRankingsStorage";
import type { LiveSources } from "../../hooks/useLiveBoard";

/*
 * Team Rankings opened on the cloud's board (`LiveTeamRankings`), from a board published to an
 * in-memory `live/` and read, checked and kept as a member's device reads it: what it draws while
 * the pool comes in, and when, and how, it hands over to the page on this device's own copy.
 */

const pool = vi.hoisted(() => ({
  wants: true,
  prepared: 0,
  finish: (): void => undefined,
  ready: null as Promise<void> | null,
}));
vi.mock("../../lib/cloud/cloudSession", () => ({
  poolWantsCloud: () => pool.wants,
  poolOnScreen: () => undefined,
  preparePool: () => {
    pool.prepared += 1;
    pool.ready ??= new Promise<void>((resolve) => {
      pool.finish = () => {
        pool.wants = false;
        resolve();
      };
    });
    return pool.ready;
  },
  copySeen: () => null,
  liveReader: async () => null,
}));

const { LiveTeamRankings } = await import("./LiveTeamRankings");

const TODAY = "2027-04-15";
const T = `${TODAY}T12:00:00.000Z`;
const PAGE = "ag_12u_2027";

const GROUPS: AgeGroup[] = [
  { id: PAGE, name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [], myTeamId: "S-2" },
  { id: "ag_11u_2027", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];

const row = (teamId: string, rank: number, more: Partial<BoardRow> = {}): BoardRow => ({
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
  ...more,
});

const SPRING = {
  rows: [
    row("S-1", 1, { city: "Springfield", state: "OH" }),
    row("S-2", 2, { state: "OH", league: true }),
    row("S-3", 3, { state: "KY" }),
  ],
};
const FALL = { rows: [row("S-F", 1, { state: "TX" })] };

const h = (n: number) => n.toString(16).padStart(64, "0");
const part = (key: string, hash: string): ManifestPart => ({
  key,
  hash,
  bytes: 10,
  chunks: 1,
  id: "0123456789abcdef",
  at: 1,
  by: "phone",
});
const MANIFEST: CloudManifest = {
  format: 2,
  schema: 1,
  copy: "c0ffee",
  version: 4,
  save: "s",
  updatedAt: T,
  device: "phone",
  parts: [part(LEAGUE_PART, h(1)), part("league_forecast_scout_teams_v1", h(2))],
  kept: [],
};
const seenOf = (manifest: CloudManifest): CopySeen => ({
  copy: manifest.copy,
  version: manifest.version,
  parts: manifest.parts.map((one) => [one.key, one.hash] as const),
});

const publish = async (
  live: MemoryLive,
  views: PublishedView[] = [
    { key: `board:2027:${PAGE}:spring`, value: SPRING },
    { key: `board:2027:${PAGE}:fall`, value: FALL },
    { key: `board:2027:${PAGE}:year`, value: SPRING },
  ],
  pages: LivePages = { pulledAt: T, halves: { [PAGE]: { fall: 10, spring: 20 } } }
) =>
  publishViews({
    store: live.store,
    views,
    owns: [BOARD_FAMILY],
    copy: { id: MANIFEST.copy, version: MANIFEST.version },
    today: TODAY,
    now: T,
    built: { family: BOARD_FAMILY, from: await builtFrom(MANIFEST, TODAY) },
    inline: { pages },
  });

const readerOf = (live: MemoryLive): LiveReader => ({
  readMeta: async () => (await live.store.readMeta())?.meta ?? null,
  getChunk: (id) => live.store.getChunk(id),
});

const kept = new Map<string, unknown>();
const cacheIo: ViewCacheIo = {
  enabled: () => true,
  keys: async () => [...kept.keys()],
  get: async (key) => kept.get(key) ?? null,
  set: async (key, value) => {
    kept.set(key, value);
    return true;
  },
  remove: async (key) => {
    kept.delete(key);
  },
  now: () => 1,
};

const sourcesOf = (live: MemoryLive | null, more: Partial<LiveSources> = {}): LiveSources => ({
  uid: () => "uid-1",
  reader: async () => (live ? readerOf(live) : null),
  cache: openViewCache(cacheIo),
  seen: () => seenOf(MANIFEST),
  owed: () => [],
  now: () => T,
  ...more,
});

const page = (handover: RankingsHandover) => <p data-testid="page">{JSON.stringify(handover)}</p>;

const open = (sources: LiveSources, { quietMs = 60_000, waitMs = 60_000 } = {}) =>
  render(
    <LiveTeamRankings
      status={{ kind: "connecting" }}
      renderPage={page}
      preloadPage={() => Promise.resolve()}
      sources={sources}
      quietMs={quietMs}
      waitMs={waitMs}
    />
  );

const handedOver = (): RankingsHandover | null => {
  const shown = screen.queryByTestId("page");
  return shown ? (JSON.parse(shown.textContent ?? "null") as RankingsHandover) : null;
};

let live: MemoryLive;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  pool.wants = true;
  pool.prepared = 0;
  pool.ready = null;
  kept.clear();
  forgetDecodedBoards();
  forgetLiveBoard();
  resetTeamRankingsStore();
  window.localStorage.clear();
  saveAgeGroups(GROUPS);
  window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027");
  live = memoryLive();
  await publish(live);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Team Rankings on the cloud's board", () => {
  it("draws the published board as the page would, while the pool comes in", async () => {
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(screen.getAllByText("Springfield, OH").length).toBeGreaterThan(0);
    // The page's own club is starred, in its card, with its state rank, and its game still to come.
    const mine = screen.getByRole("region", { name: "My team" });
    expect(mine.textContent).toContain("Placeholder S-2");
    expect(mine.textContent).toContain("Next game: loading…");
    // The state top ten opens on the club's state; the full table's League badge is the row's.
    expect((screen.getByRole("combobox", { name: "State" }) as HTMLSelectElement).value).toBe("OH");
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 teams" }));
    expect(screen.getAllByText("League")).toHaveLength(1);
    // Read-only: nothing to mark, the page's own club shown as it is.
    expect(screen.queryByRole("button", { name: /Mark mine/ })).toBeNull();
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(1);
    // Held for the page, starred as the page stars it, for when it takes over.
    expect(
      liveBoardFor({ ageGroupId: PAGE, segment: "spring", myTeamId: "S-2" })?.map(
        (one) => one.isMine
      )
    ).toEqual([false, true, false]);
  });

  it("opens on the half the published counts say is worth reading", async () => {
    live = memoryLive();
    await publish(live, undefined, { halves: { [PAGE]: { fall: 100, spring: 2 } } });
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-F")).not.toHaveLength(0);
    expect(screen.queryByText("Placeholder S-1")).toBeNull();
  });

  it("hands over at once for a page with no published board", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=11&year=2027");
    open(sourcesOf(live));
    expect(await screen.findByText(/Checking your cloud copy/)).toBeTruthy();
    await act(async () => pool.finish());
    expect(handedOver()).toEqual({ stateTop: null, stateFilter: "", showAll: false });
  });

  it("hands over at once when nothing is published, or no build like this one published it", async () => {
    open(sourcesOf(memoryLive()));
    await act(async () => pool.finish());
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("keeps the board up while the pool comes in, when it was built before the copy's changes", async () => {
    const moved = { ...MANIFEST, parts: [part(LEAGUE_PART, h(9)), MANIFEST.parts[1]!] };
    open(sourcesOf(live, { seen: () => seenOf(moved) }));
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    expect(screen.getAllByText("Placeholder S-1").length).toBeGreaterThan(0);
    expect(screen.getByText("The cloud's board, from before the latest changes")).toBeTruthy();
    await act(async () => pool.finish());
    expect(handedOver()).toEqual({ stateTop: null, stateFilter: "", showAll: false });
  });

  it("hands over with the club opened, or the search asked for", async () => {
    open(sourcesOf(live));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-3" }))[0]!);
    await act(async () => pool.finish());
    expect(handedOver()).toMatchObject({ openTeamId: "S-3" });
  });

  it("hands over with the search asked for, and the state boards as they were", async () => {
    open(sourcesOf(live));
    const state = await screen.findByRole("combobox", { name: "State" });
    fireEvent.change(state, { target: { value: "KY" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Search every team or coach, any age or season" })
    );
    await act(async () => pool.finish());
    expect(handedOver()).toEqual({
      stateTop: "KY",
      stateFilter: "",
      showAll: false,
      focusSearch: true,
    });
  });

  it("hands over at once for any area but the boards", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=games");
    pool.wants = false;
    open(sourcesOf(live));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("hands over on its own only once nobody has touched the screen for a while", async () => {
    pool.wants = false;
    open(sourcesOf(live), { quietMs: 150 });
    await screen.findByText("The cloud's board");
    // Taps, keys and scrolling put it off.
    for (let step = 0; step < 6; step += 1) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
      fireEvent.pointerDown(window);
      fireEvent.scroll(window);
    }
    expect(handedOver()).toBeNull();
    await waitFor(() => expect(handedOver()).not.toBeNull(), { timeout: 2_000 });
  });

  it("draws the board it kept when the network is not there, and says so", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    open(sourcesOf(null));
    expect(await screen.findByText("The cloud's board as last read · offline")).toBeTruthy();
    expect(screen.getAllByText("Placeholder S-1").length).toBeGreaterThan(0);
    expect(handedOver()).toBeNull();
  });

  it("forgets every board it kept, and hands over, when the rules refuse this account", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    expect(kept.size).toBeGreaterThan(0);
    const refusing: LiveReader = {
      readMeta: () => Promise.reject({ code: "permission-denied" }),
      getChunk: () => Promise.reject({ code: "permission-denied" }),
    };
    open(sourcesOf(live, { reader: async () => refusing }));
    await waitFor(() => expect(kept.size).toBe(0));
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
    await act(async () => pool.finish());
    expect(handedOver()).not.toBeNull();
  });

  it("hands over when nothing draws in the time allowed", async () => {
    pool.wants = false;
    // A network that never answers: only the time allowed ends the wait.
    const hanging: LiveReader = {
      readMeta: () => new Promise(() => undefined),
      getChunk: () => new Promise(() => undefined),
    };
    open(sourcesOf(live, { reader: async () => hanging }), { waitMs: 150 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(handedOver()).toBeNull();
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("does not hand over on its own while the pool is still coming in", async () => {
    open(sourcesOf(live), { quietMs: 50 });
    await screen.findByText("The cloud's board");
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    // Not handed over at all: no wait for this device's copy on screen, as there is after one.
    expect(handedOver()).toBeNull();
    expect(screen.queryByText(/Loading this device's copy/)).toBeNull();
    await act(async () => pool.finish());
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });
});
