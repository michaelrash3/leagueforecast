import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudManifest, ManifestPart } from "../../lib/cloud/cloudManifest";
import { LEAGUE_PART } from "../../lib/cloud/cloudPlan";
import type { CopySeen } from "../../lib/cloud/cloudSession";
import { BOARD_FAMILY, builtFrom } from "../../lib/live/boardInputs";
import { forgetDecodedBoards } from "../../lib/live/liveClient";
import { forgetLiveBoard, liveBoardFor, type RankingsHandover } from "../../lib/live/liveBoard";
import { EDIT_REFUSED, QUERY_REFUSED } from "../../lib/live/liveEdits";
import { liveLabel } from "../../lib/live/liveLabel";
import { openViewCache, type ViewCache, type ViewCacheIo } from "../../lib/live/viewCache";
import { publishViews, type LiveReader, type PublishedView } from "../../lib/live/viewStore";
import type { BoardRow, LivePages } from "../../lib/live/views/boardShape";
import {
  CLUB_FAMILY,
  clubBucketOf,
  clubKey,
  encodeClubCard,
  type ClubCard,
} from "../../lib/live/views/clubShape";
import {
  SEARCH_FAMILY,
  encodeSearch,
  searchKey,
  type SearchView,
} from "../../lib/live/views/searchShape";
import { forgetDecodedClubs } from "../../hooks/useClubCard";
import { forgetDecodedSearches } from "../../hooks/useLiveSearch";
import { GAMES_FAMILY, encodeGames, gamesKey } from "../../lib/live/views/gamesShape";
import { forgetDecodedGames, GAME_MOVED } from "./LiveGames";
import { CHECK_UNANSWERED, PAGE_NOT_ON_COPY } from "./LiveSetup";
import { checkTheModel } from "../../lib/scoutBacktest";
import { memoryLive, type MemoryLive } from "../../lib/live/__tests__/memoryLive";
import type { AgeGroup } from "../../lib/teamRankings";
import type { SeasonMeta } from "../../lib/storage";
import { resetTeamRankingsStore, saveAgeGroups } from "../../lib/teamRankingsStorage";
import type { LiveSources } from "../../hooks/useLiveBoard";
import { useRankingsPages } from "../../hooks/useRankingsPages";

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
  // Team Rankings on screen: the pool no longer waits to be brought in (`poolWantsCloud`).
  poolOnScreen: () => {
    pool.wants = false;
  },
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
  memberToken: async () => null,
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
    row("S-1", 1, { city: "Springfield", state: "OH", was: 3 }),
    row("S-2", 2, { state: "OH", league: true, was: 2 }),
    row("S-3", 3, { state: "KY" }),
  ],
  past: { asOf: "2027-04-08", empty: false },
  history: {
    teamId: "S-2",
    points: [
      { asOf: "2027-04-01", rank: 5 },
      { asOf: "2027-04-08", rank: 2 },
    ],
  },
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
    owns: [BOARD_FAMILY, CLUB_FAMILY, SEARCH_FAMILY, GAMES_FAMILY],
    copy: { id: MANIFEST.copy, version: MANIFEST.version },
    today: TODAY,
    now: T,
    built: { family: BOARD_FAMILY, from: await builtFrom(MANIFEST, TODAY) },
    inline: { pages },
  });

const readerOf = (live: MemoryLive): LiveReader => ({
  readMeta: async () => (await live.store.readMeta())?.meta ?? null,
  getChunk: (id) => live.store.getChunk(id),
  watchMeta: live.watchMeta,
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

/** What the page said in toasts, and the questions it asked before an edit, in turn. */
const said = {
  toasts: [] as string[],
  asked: [] as string[],
  confirming: true,
  // Each toast's action, an Undo, by what the toast said.
  actions: new Map<string, () => void>(),
};
const showToast = (message: string, options?: { onAction?: () => void }) => {
  said.toasts.push(message);
  if (options?.onAction) said.actions.set(message, options.onAction);
};
const confirm = async ({ title }: { title: string }) => {
  said.asked.push(title);
  return said.confirming;
};

const open = (sources: LiveSources, { waitMs = 60_000, seasons = [] as SeasonMeta[] } = {}) =>
  render(
    <LiveTeamRankings
      status={{ kind: "connecting" }}
      renderPage={page}
      preloadPage={() => Promise.resolve()}
      sources={sources}
      seasons={seasons}
      showToast={showToast}
      confirm={confirm}
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
  forgetDecodedClubs();
  forgetDecodedSearches();
  forgetDecodedGames();
  forgetLiveBoard();
  resetTeamRankingsStore();
  window.localStorage.clear();
  saveAgeGroups(GROUPS);
  window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027");
  said.toasts = [];
  said.asked = [];
  said.confirming = true;
  said.actions.clear();
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

  it("draws the board on a device that has never held the copy, by the pages the meta names", async () => {
    await publish(live, undefined, {
      pulledAt: T,
      halves: { [PAGE]: { fall: 10, spring: 20 } },
      groups: GROUPS,
    });
    resetTeamRankingsStore();
    window.localStorage.clear();
    open(sourcesOf(live));
    expect(await screen.findAllByRole("button", { name: "Placeholder S-1" })).not.toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Age level" })).toHaveTextContent("12U");
    // And it did not hand over while it waited for the pages: with the copy in, the board stays.
    await act(async () => pool.finish());
    expect(handedOver()).toBeNull();
  });

  it("hands over when neither this device nor the meta has a page to lay out", async () => {
    pool.wants = false;
    resetTeamRankingsStore();
    window.localStorage.clear();
    open(sourcesOf(live));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("draws last week's arrows and the page's own club's rank line from the board", async () => {
    open(sourcesOf(live));
    expect(await screen.findAllByLabelText("up 2 since last week")).not.toHaveLength(0);
    expect(screen.getAllByText("new").length).toBeGreaterThan(0);
    const mine = screen.getByRole("region", { name: "My team" });
    expect(mine.querySelector('[aria-label^="Place by week:"]')).not.toBeNull();
  });

  it("draws no rank line made for another club than the page's own", async () => {
    live = memoryLive();
    const other = { ...SPRING, history: { ...SPRING.history, teamId: "S-9" } };
    await publish(live, [{ key: `board:2027:${PAGE}:spring`, value: other }]);
    open(sourcesOf(live));
    expect(await screen.findAllByLabelText("up 2 since last week")).not.toHaveLength(0);
    const mine = screen.getByRole("region", { name: "My team" });
    expect(mine.querySelector('[aria-label^="Place by week:"]')).toBeNull();
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
    // The page's header stays, with how far the pool has got and what opens once it is in.
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    expect(screen.getByText("This opens on this device's copy as soon as it is in…")).toBeTruthy();
    expect(handedOver()).toBeNull();
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
    expect((await screen.findAllByText("Placeholder S-1")).length).toBeGreaterThan(0);
    expect(screen.getByText("The cloud's board, from before the latest changes")).toBeTruthy();
    await act(async () => pool.finish());
    expect(handedOver()).toEqual({ stateTop: null, stateFilter: "", showAll: false });
  });

  it("hands a club over when it has no card to open its panel from", async () => {
    open(sourcesOf(live));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-3" }))[0]!);
    await act(async () => pool.finish());
    await waitFor(() => expect(handedOver()).toMatchObject({ openTeamId: "S-3" }));
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

  it("hands over at once for an area it does not draw yet", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    open(sourcesOf(live));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("stays the page however long nobody touches the screen, and hands over for what it cannot draw", async () => {
    pool.wants = false;
    open(sourcesOf(live));
    await screen.findByText("The cloud's board");
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
    expect(handedOver()).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("draws the board it kept when the network is not there, and says so", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    open(sourcesOf(null));
    // As of when this account last read the meta, which the device kept with it.
    expect(await screen.findByText(/^Offline · the cloud's board as of /)).toBeTruthy();
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
      watchMeta: live.watchMeta,
    };
    open(sourcesOf(live, { reader: async () => refusing }));
    await waitFor(() => expect(kept.size).toBe(0));
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
    await act(async () => pool.finish());
    expect(handedOver()).not.toBeNull();
    // Refused, it does not listen either.
    expect(live.watching()).toBe(0);
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

  it("stays the page while the pool comes in and once it is in", async () => {
    open(sourcesOf(live));
    await screen.findByText("The cloud's board");
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    // Not handed over at all: no wait for this device's copy on screen, as there is after one.
    expect(handedOver()).toBeNull();
    expect(screen.queryByText(/Loading this device's copy/)).toBeNull();
    await act(async () => pool.finish());
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(handedOver()).toBeNull();
    expect(screen.getByText("The cloud's board")).toBeTruthy();
  });
});

/*
 * While it is open the page listens to the meta (`watchMeta`), so a publish draws the new board in
 * place, and a dropped connection says the board may be behind rather than passing it off as the
 * latest.
 */
describe("the cloud's board while it is open", () => {
  const SPRING_NEXT = { rows: [row("S-7", 1, { state: "OH" }), row("S-1", 2, { state: "OH" })] };

  it("draws a board published while it is open, in place", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(screen.queryAllByText("Placeholder S-7")).toHaveLength(0);
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING_NEXT },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING_NEXT },
    ]);
    expect((await screen.findAllByText("Placeholder S-7")).length).toBeGreaterThan(0);
    expect(screen.getByText("The cloud's board")).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("leaves the board on screen as it is when a publish names the same one", async () => {
    const cache = openViewCache(cacheIo);
    let shownKept = 0;
    const counting: ViewCache = {
      ...cache,
      keepLastShown: (uid, shown) => {
        shownKept += 1;
        return cache.keepLastShown(uid, shown);
      },
    };
    open(sourcesOf(live, { cache: counting }));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    await waitFor(() => expect(shownKept).toBe(1));
    // A later pull, the same boards: a new meta, naming the very board on screen.
    const later = "2027-04-15T13:00:00.000Z";
    await publish(live, undefined, {
      pulledAt: later,
      halves: { [PAGE]: { fall: 10, spring: 20 } },
    });
    expect(live.meta()?.inline.pages).toMatchObject({ pulledAt: later });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(shownKept).toBe(1);
  });

  it("says it is offline, as of the server's last word, while cut off, and keeps the board", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    act(() => live.cutOff());
    expect(await screen.findByText(/^Offline · the cloud's board as of /)).toBeTruthy();
    expect(screen.getAllByText("Placeholder S-1").length).toBeGreaterThan(0);
    expect(handedOver()).toBeNull();
    act(() => live.reconnect());
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
  });

  it("is vouched for once the server is heard, after opening offline on the board it kept", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    const unreachable: LiveReader = {
      ...readerOf(live),
      readMeta: () => Promise.reject({ code: "unavailable" }),
    };
    act(() => live.cutOff());
    // Hours later, still cut off: as of the read that kept the board, not of what the watch has
    // from before, which says nothing new.
    const later = `${TODAY}T15:00:00.000Z`;
    open(sourcesOf(live, { reader: async () => unreachable, now: () => later }));
    const asOf = (heardAt: string) =>
      liveLabel({
        check: "offline",
        standing: null,
        rules: undefined,
        boardDay: TODAY,
        today: TODAY,
        heardAt,
      });
    expect(asOf(T)).not.toBe(asOf(later));
    expect(await screen.findByText(asOf(T))).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByText(asOf(T))).toBeTruthy();
    act(() => live.reconnect());
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("takes a meta heard again unchanged as nothing new", async () => {
    let looks = 0;
    open(
      sourcesOf(live, {
        seen: () => {
          looks += 1;
          return seenOf(MANIFEST);
        },
      })
    );
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    await waitFor(() => expect(live.watching()).toBe(1));
    act(() => live.reconnect());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // Once, for the read on opening: the watch's first word and the reconnect repeat it.
    expect(looks).toBe(1);
  });

  it("keeps the later of two metas heard together, though the earlier takes longer", async () => {
    // Two publishes, the later the one on screen; the earlier's pieces are kept out their grace.
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING_NEXT },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING_NEXT },
    ]);
    const earlier = live.meta();
    await publish(live);
    const later = live.meta();
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    await waitFor(() => expect(live.watching()).toBe(1));
    // The earlier is checked against the copy, which takes a hash; the later is already on screen.
    act(() => {
      live.setMeta(earlier);
      live.setMeta(later);
    });
    // Never drawn, though there is time for the earlier's check and its board's read, were it
    // taken: tens of ms here.
    await expect(screen.findAllByText("Placeholder S-7", {}, { timeout: 500 })).rejects.toThrow();
    expect(screen.getAllByText("Placeholder S-1").length).toBeGreaterThan(0);
  });

  it("forgets every board it kept, and hands over, when the rules end its watch", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(kept.size).toBeGreaterThan(0);
    act(() => live.failWatches({ code: "permission-denied" }));
    // The keep is emptied first and the held board let go after it, a tick apart: both are waited
    // for, or a check between the two finds the board still held.
    await waitFor(() => {
      expect(kept.size).toBe(0);
      expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
    });
    await act(async () => pool.finish());
    expect(handedOver()).not.toBeNull();
  });

  it("keeps the board, offline, when its watch ends for any other reason", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    act(() => live.failWatches({ code: "internal" }));
    expect(await screen.findByText(/^Offline · the cloud's board as of /)).toBeTruthy();
    expect(kept.size).toBeGreaterThan(0);
    expect(handedOver()).toBeNull();
  });

  it("hands over when it hears a meta this build cannot read", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    act(() => live.setMeta({ ...live.meta(), schema: 99 }));
    await act(async () => pool.finish());
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("stops listening when it closes", async () => {
    const shown = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(live.watching()).toBe(1);
    shown.unmount();
    expect(live.watching()).toBe(0);
  });
});

/*
 * A club tapped on the board opens its panel from the card a server published for it
 * (`LiveClubPanel`), drawn by Team Rankings' own panel with nothing on it to change.
 */
/** The edit function, as the page reaches it: what it was sent, and its answer to each. */
const editFunction = (answer: (data: Record<string, unknown>) => unknown) => {
  const sent: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { data } = JSON.parse(String(init?.body)) as { data: Record<string, unknown> };
    sent.push(data);
    return new Response(JSON.stringify({ result: answer(data) }), { status: 200 });
  }) as typeof fetch;
  return { sent, call: { token: async () => "id-token", fetchImpl } };
};
const WARMED = { warmed: { ok: true, cold: false, fetched: 0, loadMs: 1 } };
const made = (version: number, changed = ["league_forecast_scout_teams_v1"]) => ({
  ok: true,
  copy: MANIFEST.copy,
  version,
  inverse: { kind: "none" },
  changed,
  ms: { load: 1, apply: 1, commit: 1 },
});
const answered = (answer: Record<string, unknown>) => ({
  ok: true,
  copy: MANIFEST.copy,
  version: MANIFEST.version,
  answer,
});
const edited = (sent: Array<Record<string, unknown>>) =>
  sent.filter((data) => data.command !== undefined);

describe("a club's panel on the cloud's board", () => {
  const CARD: ClubCard = {
    team: { id: "S-1", name: "Placeholder S-1", state: "OH" },
    games: [
      {
        id: "g1",
        teamAId: "S-1",
        teamBId: "S-2",
        ageGroupId: PAGE,
        teamAScore: 5,
        teamBScore: 3,
        date: "2027-03-20",
        event: "Placeholder Classic",
      },
      {
        id: "g2",
        teamAId: "S-4",
        teamBId: "S-1",
        ageGroupId: PAGE,
        teamAScore: 6,
        teamBScore: 2,
        date: "2027-03-27",
      },
      { id: "g3", teamAId: "S-1", teamBId: "S-2", ageGroupId: PAGE, date: "2027-05-01" },
    ],
    names: { "S-2": "Placeholder S-2", "S-4": "Placeholder S-4" },
    age: { level: 12 },
  };
  /** The board, with S-1's card, and another club's card where one is given. */
  const withCard = (other?: ClubCard) => {
    const buckets = new Map<number, Record<string, ReturnType<typeof encodeClubCard>>>();
    for (const card of other ? [CARD, other] : [CARD]) {
      const bucket = clubBucketOf(card.team.id);
      buckets.set(bucket, { ...buckets.get(bucket), [card.team.id]: encodeClubCard(card) });
    }
    return publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      ...[...buckets].map(([bucket, clubs]) => ({ key: clubKey(2027, bucket), value: { clubs } })),
    ]);
  };
  /** S-1's card published again as `card`, of the copy at `version`. */
  const publishCard = async (card: ClubCard, version: number) =>
    publishViews({
      store: live.store,
      views: [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        {
          key: clubKey(2027, clubBucketOf("S-1")),
          value: { clubs: { "S-1": encodeClubCard(card) } },
        },
      ],
      owns: [BOARD_FAMILY, CLUB_FAMILY, SEARCH_FAMILY, GAMES_FAMILY],
      copy: { id: MANIFEST.copy, version },
      today: TODAY,
      now: T,
      built: { family: BOARD_FAMILY, from: await builtFrom({ ...MANIFEST, version }, TODAY) },
      inline: { pages: { pulledAt: T, halves: { [PAGE]: { fall: 10, spring: 20 } } } },
    });
  const tapClub = async (name: string) =>
    fireEvent.click((await screen.findAllByRole("button", { name }))[0]!);

  it("opens from its card, with its record and games", async () => {
    await withCard();
    open(sourcesOf(live));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(panel).toHaveTextContent("1-1 in 12U 2027, from 2 games.");
    expect(panel).toHaveTextContent("The app filed this club at 12U.");
    expect(within(panel).getAllByText("Placeholder S-2")).toHaveLength(2);
    expect(panel).toHaveTextContent("5–3 · 2027-03-20 · Placeholder Classic");
    expect(panel).toHaveTextContent("2–6 · 2027-03-27");
    expect(within(panel).getByText("Sched")).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  it("sends an edit made on its panel to the edit function, against the board's copy, and says so", async () => {
    await withCard();
    const server = editFunction((data) => (data.warm ? WARMED : made(5)));
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.change(within(panel).getByLabelText("State"), { target: { value: "KY" } });
    await waitFor(() => expect(said.toasts).toContain("Set to KY."));
    expect(edited(server.sent)).toEqual([
      {
        command: { kind: "team.state", teamId: "S-1", state: "KY", adopt: CARD.team },
        copy: MANIFEST.copy,
      },
    ]);
    expect(handedOver()).toBeNull();
  });

  it("draws a new name at once, and the card as published once a publish of the edit's version is out", async () => {
    await withCard();
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : data.query
          ? answered({
              kind: "rename.preview",
              name: "Placeholder Q",
              into: null,
              games: 0,
              dropped: 0,
            })
          : made(5)
    );
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.change(within(panel).getByLabelText("Team name"), {
      target: { value: "Placeholder Q" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("region", { name: "Placeholder Q" })).toBeTruthy();
    expect(said.toasts).toContain("Team renamed.");
    expect(edited(server.sent)).toEqual([
      { command: { kind: "team.rename", teamId: "S-1", name: "Placeholder Q" }, copy: "c0ffee" },
    ]);
    // A publish of an older version than the edit's leaves the edit drawn over it.
    await act(() => publishCard({ ...CARD, team: { ...CARD.team, name: "Placeholder Old" } }, 4));
    await pause(50);
    expect(screen.getByRole("region", { name: "Placeholder Q" })).toBeTruthy();
    // One of its version, or later, is the card to draw: whatever it says is the copy's word.
    await act(() => publishCard({ ...CARD, team: { ...CARD.team, name: "Placeholder R" } }, 5));
    expect(await screen.findByRole("region", { name: "Placeholder R" })).toBeTruthy();
  });

  it("asks before folding a club renamed onto another's name, and opens the club it went into", async () => {
    await withCard({
      team: { id: "S-2", name: "Placeholder S-2" },
      games: [],
      names: {},
    });
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : data.query
          ? answered({
              kind: "rename.preview",
              name: "Placeholder S-2",
              into: { id: "S-2", name: "Placeholder S-2" },
              games: 3,
              dropped: 2,
            })
          : made(5, ["league_forecast_scout_teams_v1", "league_forecast_scout_games_v2:2027"])
    );
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    const rename = () => {
      fireEvent.change(within(panel).getByLabelText("Team name"), {
        target: { value: "placeholder s-2" },
      });
      fireEvent.click(within(panel).getByRole("button", { name: /Rename|Merge/ }));
    };
    said.confirming = false;
    rename();
    await waitFor(() => expect(said.asked).toEqual(["Fold Placeholder S-1 into Placeholder S-2?"]));
    expect(edited(server.sent)).toEqual([]);
    said.confirming = true;
    rename();
    expect(await screen.findByRole("region", { name: "Placeholder S-2" })).toBeTruthy();
    expect(said.toasts).toContain("Folded into Placeholder S-2.");
    expect(edited(server.sent)).toEqual([
      {
        command: { kind: "teams.merge", fromId: "S-1", intoId: "S-2", adopt: [CARD.team] },
        copy: "c0ffee",
      },
    ]);
  });

  it("says why an edit was not made, and draws nothing of it", async () => {
    await withCard();
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : data.query
          ? answered({ kind: "rename.preview", name: "Gone", into: null, games: 0, dropped: 0 })
          : { ok: false, why: "missing" }
    );
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.change(within(panel).getByLabelText("Team name"), { target: { value: "Gone" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(said.toasts).toContain(EDIT_REFUSED.missing));
    expect(screen.getByRole("region", { name: "Placeholder S-1" })).toBeTruthy();
  });

  it("brings the server's pool up as a club opens, and not again soon after a call", async () => {
    await withCard();
    const server = editFunction(() => WARMED);
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    await waitFor(() => expect(server.sent).toEqual([{ warm: true }]));
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await tapClub("Placeholder S-1");
    await screen.findByRole("region", { name: "Placeholder S-1" });
    await pause(50);
    expect(server.sent).toEqual([{ warm: true }]);
  });

  it("changes nothing, and sends nothing, before the network has answered for the board", async () => {
    await withCard();
    const first = open(sourcesOf(live));
    await tapClub("Placeholder S-1");
    await screen.findByRole("region", { name: "Placeholder S-1" });
    first.unmount();
    forgetDecodedBoards();
    forgetDecodedClubs();
    const server = editFunction(() => WARMED);
    const hanging: LiveReader = {
      readMeta: () => new Promise(() => undefined),
      getChunk: () => new Promise(() => undefined),
    };
    open(sourcesOf(live, { reader: async () => hanging, call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(within(panel).queryByLabelText("Team name")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Rename" })).toBeNull();
    await pause(50);
    expect(server.sent).toEqual([]);
  });

  it("closes, and opens Team Rankings on the club open when it hands over", async () => {
    await withCard();
    open(sourcesOf(live));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Placeholder S-1" })).toBeNull();
    await tapClub("Placeholder S-1");
    await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    await act(async () => pool.finish());
    await waitFor(() => expect(handedOver()).toMatchObject({ openTeamId: "S-1" }), {
      timeout: 2_000,
    });
  });
});

describe("Find a team on the cloud's board", () => {
  const ELEVEN = "ag_11u_2027";
  const LIST: SearchView = {
    options: [
      { id: "S-1", label: "Placeholder S-1", detail: "12U 2027 · Springfield, OH" },
      {
        id: "S-9",
        label: "Placeholder Niners",
        detail: "11U 2027 · OH",
        coaches: ["Placeholder Coach A"],
        gcIds: ["gcNINERS0001"],
      },
    ],
    pageOf: new Map([
      ["S-1", PAGE],
      ["S-9", ELEVEN],
    ]),
    held: { dropped: new Set(["gcDROPPED001"]), ageless: [], tooYoung: new Set() },
  };
  const NINERS: ClubCard = {
    team: { id: "S-9", name: "Placeholder Niners", state: "OH" },
    games: [
      {
        id: "g1",
        teamAId: "S-9",
        teamBId: "S-1",
        ageGroupId: ELEVEN,
        teamAScore: 4,
        teamBScore: 1,
        date: "2027-03-20",
      },
    ],
    names: { "S-1": "Placeholder S-1" },
  };
  const ELEVEN_BOARD = { rows: [row("S-9", 1, { teamName: "Placeholder Niners", state: "OH" })] };
  const withList = () =>
    publish(
      live,
      [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        { key: `board:2027:${ELEVEN}:spring`, value: ELEVEN_BOARD },
        { key: `board:2027:${ELEVEN}:fall`, value: { rows: [] } },
        { key: `board:2027:${ELEVEN}:year`, value: ELEVEN_BOARD },
        { key: searchKey(2027), value: encodeSearch(LIST) },
        {
          key: clubKey(2027, clubBucketOf("S-9")),
          value: { clubs: { "S-9": encodeClubCard(NINERS) } },
        },
      ],
      {
        pulledAt: T,
        halves: { [PAGE]: { fall: 10, spring: 20 }, [ELEVEN]: { fall: 0, spring: 5 } },
      }
    );
  /** The reader, noting each piece it fetches, and holding back the pieces `held` names. */
  const fetching = (held: (id: string) => boolean = () => false) => {
    const fetched: string[] = [];
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const reader = readerOf(live);
    return {
      fetched,
      release,
      sources: sourcesOf(live, {
        reader: async () => ({
          ...reader,
          getChunk: async (id: string) => {
            fetched.push(id);
            if (held(id)) await released;
            return reader.getChunk(id);
          },
        }),
      }),
    };
  };
  const listPieces = () => {
    const entry = live.meta()?.views[searchKey(2027)];
    if (!entry) throw new Error("no list published");
    return (id: string) => id.startsWith(entry.id);
  };
  const listboxOf = (box: HTMLElement): HTMLElement =>
    document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement;

  it("reads the year's list only once somebody goes to search, and opens a club picked on its page", async () => {
    await withList();
    const ofList = listPieces();
    const { fetched, release, sources } = fetching(ofList);
    const user = userEvent.setup();
    open(sources);
    await screen.findByText("The cloud's board");
    expect(fetched.some(ofList)).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Search every team or coach, any age or season" })
    );
    // Said while it comes in, and not to be asked twice.
    const coming = await screen.findByRole("button", { name: "Bringing in every team…" });
    expect(coming).toBeDisabled();
    await waitFor(() => expect(fetched.some(ofList)).toBe(true));
    release();
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    // The caret is in the box the moment the list is in.
    expect(document.activeElement).toBe(box);
    // Searched by a coach, as the page's own box is.
    await user.type(box, "coach a");
    const found = within(listboxOf(box)).getAllByRole("option");
    expect(found).toHaveLength(1);
    expect(found[0]).toHaveTextContent("Placeholder Niners");
    expect(found[0]).toHaveTextContent("11U 2027");
    await user.click(within(found[0]!).getByRole("button"));
    // On the club's own page, with its panel from its card, and nothing handed over.
    await waitFor(() => expect(window.location.search).toContain("age=11"));
    const panel = await screen.findByRole("region", { name: "Placeholder Niners" });
    expect(panel).toHaveTextContent("4–1 · 2027-03-20");
    expect(handedOver()).toBeNull();
  });

  it("says where a pasted GameChanger id the copy keeps off every page went", async () => {
    await withList();
    const user = userEvent.setup();
    open(sourcesOf(live));
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    await user.type(box, "gcDROPPED001");
    expect(await screen.findByText(/That team was thrown out, so pulls refuse it/)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("asks again on another year's pages rather than read that year's list unasked", async () => {
    saveAgeGroups([
      ...GROUPS,
      { id: "ag_12u_2028", name: "12U 2028", ageLevel: 12, year: 2028, seasonIds: [] },
    ]);
    await publish(
      live,
      [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        { key: "board:2028:ag_12u_2028:spring", value: FALL },
        { key: "board:2028:ag_12u_2028:fall", value: FALL },
        { key: "board:2028:ag_12u_2028:year", value: FALL },
        { key: searchKey(2027), value: encodeSearch(LIST) },
      ],
      {
        pulledAt: T,
        halves: { [PAGE]: { fall: 10, spring: 20 }, ag_12u_2028: { fall: 3, spring: 3 } },
      }
    );
    open(sourcesOf(live));
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    await screen.findByRole("combobox", { name: /find a team/i });
    fireEvent.change(screen.getByLabelText("Season"), { target: { value: "2028" } });
    // The 2028 page's own board, with its box to be asked again: 2027's list is not its list.
    await screen.findAllByRole("button", { name: "Placeholder S-F" });
    expect(screen.queryByRole("combobox", { name: /find a team/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Search every team or coach, any age or season" })
    ).toBeEnabled();
    expect(handedOver()).toBeNull();
  });
});

describe("the Games tab on the cloud's board", () => {
  const BOARDS: PublishedView[] = [
    { key: `board:2027:${PAGE}:spring`, value: SPRING },
    { key: `board:2027:${PAGE}:fall`, value: FALL },
    { key: `board:2027:${PAGE}:year`, value: SPRING },
  ];
  const LIST = encodeGames({
    page: PAGE,
    games: [
      {
        id: "g1",
        teamAId: "S-1",
        teamBId: "S-2",
        ageGroupId: PAGE,
        teamAScore: 7,
        teamBScore: 2,
        date: TODAY,
        event: "Placeholder Cup",
      },
      { id: "g2", teamAId: "S-3", teamBId: "S-1", ageGroupId: PAGE, date: TODAY },
      {
        id: "g3",
        teamAId: "S-2",
        teamBId: "S-3",
        ageGroupId: PAGE,
        teamAScore: 30,
        teamBScore: 0,
        date: "2027-04-01",
        excluded: true,
      },
      { id: "g4", teamAId: "S-1", teamBId: "S-3", ageGroupId: PAGE, date: "2027-03-01" },
    ],
    names: new Map([
      ["S-1", "Placeholder S-1"],
      ["S-2", "Placeholder S-2"],
      ["S-3", "Placeholder S-3"],
    ]),
  });
  const onGames = () =>
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=games");

  it("lists the page's games from its list, today's first, each with its own buttons", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    onGames();
    open(sourcesOf(live));
    await screen.findByText(/^Today's games/);
    // Today's two, the rest counted, and the one still owed a score said so.
    expect(screen.getByText(/2 more are hidden \(1 still need a score\)/)).toBeTruthy();
    expect(screen.getByText("Placeholder S-1 7")).toBeTruthy();
    expect(screen.getByText(/Placeholder S-3 vs/)).toBeTruthy();
    // Each game's own, sent to the server; adding and importing are on this device's copy.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Enter score" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Don't count" })).toBeTruthy();
    for (const name of ["Add Game", "Import games"])
      expect(screen.queryByRole("button", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 4 games" }));
    expect(screen.getByText("Not counted")).toBeTruthy();
    expect(screen.getByText("All 4 games on this page.")).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("hands over to add a game", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    open(sourcesOf(live));
    fireEvent.click(await screen.findByRole("button", { name: "Add, import or pull games" }));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("hands over when the page has no list to read", async () => {
    pool.wants = false;
    onGames();
    open(sourcesOf(live));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  const rowOf = (text: RegExp) => {
    const row = screen.getByText(text).closest("li");
    if (!row) throw new Error(`no row for ${text}`);
    return row;
  };
  /**
   * The edit function on the Games tab: each game's id by its place in the list (the list's ids
   * are g1 to g4, in order), or none at all, and an edit made.
   */
  const gamesServer = ({ found = true } = {}) =>
    editFunction((data) => {
      const query = data.query as { at: number } | undefined;
      if (!query) return made(5);
      return answered({ kind: "games.find", gameId: found ? `g${query.at + 1}` : null });
    });
  const finds = (sent: Array<Record<string, unknown>>) =>
    sent.flatMap((data) => (data.query ? [data.query] : []));

  it("enters a score through the server, and shows it at once", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = gamesServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    const owed = () => rowOf(/Placeholder S-3 vs/);
    fireEvent.click(within(owed()).getByRole("button", { name: "Enter score" }));
    // Nothing typed: nothing sent, and said.
    fireEvent.click(within(owed()).getByRole("button", { name: "Save" }));
    expect(said.toasts).toEqual(["Enter two scores, in whole runs."]);
    const [a, b] = within(owed()).getAllByPlaceholderText("Score");
    fireEvent.change(a!, { target: { value: "4" } });
    fireEvent.change(b!, { target: { value: "5" } });
    fireEvent.click(within(owed()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(said.toasts).toContain("Score saved."));
    // Its id asked first, by its place and what the list shows of it.
    expect(finds(server.sent)).toEqual([
      {
        kind: "games.find",
        year: 2027,
        page: PAGE,
        at: 1,
        game: { teamAId: "S-3", teamBId: "S-1", date: TODAY },
      },
    ]);
    expect(edited(server.sent)).toEqual([
      {
        command: { kind: "game.score", year: 2027, gameId: "g2", teamAScore: 4, teamBScore: 5 },
        copy: MANIFEST.copy,
      },
    ]);
    // Drawn as played before any publish carries it, and the boxes put away.
    expect(screen.getByText("Placeholder S-3 4")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Score")).toBeNull();
    expect(handedOver()).toBeNull();
  });

  it("puts the score boxes away once saved, even when the copy already held that score", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    // Typed on another device first: made, with nothing changed, so nothing is drawn over the list.
    const server = editFunction((data) => {
      const query = data.query as { at: number } | undefined;
      return query ? answered({ kind: "games.find", gameId: `g${query.at + 1}` }) : made(5, []);
    });
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    const owed = () => rowOf(/Placeholder S-3 vs/);
    fireEvent.click(within(owed()).getByRole("button", { name: "Enter score" }));
    const [a, b] = within(owed()).getAllByPlaceholderText("Score");
    fireEvent.change(a!, { target: { value: "4" } });
    fireEvent.change(b!, { target: { value: "5" } });
    fireEvent.click(within(owed()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(said.toasts).toContain("Score saved."));
    expect(screen.queryByPlaceholderText("Score")).toBeNull();
  });

  it("keeps a game out of the maths, and removes one once asked, with an Undo", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = gamesServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    const played = () => rowOf(/Placeholder S-1 7/);
    fireEvent.click(within(played()).getByRole("button", { name: "Don't count" }));
    await waitFor(() => expect(said.toasts).toContain("Game no longer counts."));
    expect(within(played()).getByText("Not counted")).toBeTruthy();
    fireEvent.click(within(played()).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(said.toasts).toContain("Game removed."));
    expect(said.asked).toEqual(["Remove this game?"]);
    expect(edited(server.sent).map(({ command }) => command)).toEqual([
      { kind: "game.exclude", year: 2027, gameId: "g1", excluded: true },
      { kind: "game.remove", year: 2027, gameIds: ["g1"] },
    ]);
    // Asked once: the second edit named the game by the id the first was given.
    expect(finds(server.sent)).toHaveLength(1);
    expect(screen.queryByText(/Placeholder S-1 7/)).toBeNull();
  });

  it("puts a game removed back where it was when its Undo is pressed", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const first = {
      id: "g1",
      teamAId: "S-1",
      teamBId: "S-2",
      ageGroupId: PAGE,
      teamAScore: 7,
      teamBScore: 2,
      date: TODAY,
      event: "Placeholder Cup",
    };
    const server = editFunction((data) => {
      const query = data.query as { at: number } | undefined;
      if (query) return answered({ kind: "games.find", gameId: `g${query.at + 1}` });
      const command = data.command as { kind: string };
      // The removal's inverse is the server's, the game as the copy holds it, at its place.
      return command.kind === "game.remove"
        ? {
            ...made(5),
            inverse: { kind: "game.insert", year: 2027, games: [{ game: first, at: 0 }] },
          }
        : made(6);
    });
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    fireEvent.click(within(rowOf(/Placeholder S-1 7/)).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(said.toasts).toContain("Game removed."));
    expect(screen.queryByText(/Placeholder S-1 7/)).toBeNull();
    act(() => said.actions.get("Game removed.")?.());
    await waitFor(() => expect(said.toasts).toContain("Undone."));
    expect(edited(server.sent).map(({ command }) => (command as { kind: string }).kind)).toEqual([
      "game.remove",
      "game.insert",
    ]);
    expect(screen.getByText(/Placeholder S-1 7/)).toBeTruthy();
  });

  it("removes nothing when told no", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    said.confirming = false;
    const server = gamesServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    fireEvent.click(within(rowOf(/Placeholder S-1 7/)).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(said.asked).toEqual(["Remove this game?"]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.sent).toEqual([]);
    expect(screen.getByText(/Placeholder S-1 7/)).toBeTruthy();
  });

  it("changes nothing when the server finds no game as the list shows it", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = gamesServer({ found: false });
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    fireEvent.click(
      within(rowOf(/Placeholder S-1 7/)).getByRole("button", { name: "Don't count" })
    );
    await waitFor(() => expect(said.toasts).toContain(GAME_MOVED));
    expect(edited(server.sent)).toEqual([]);
    expect(within(rowOf(/Placeholder S-1 7/)).queryByText("Not counted")).toBeNull();
  });
});

describe("Scouting on the cloud's board", () => {
  const card = (teamId: string, games: ClubCard["games"]): ClubCard => ({
    team: { id: teamId, name: `Placeholder ${teamId}` },
    games,
    names: Object.fromEntries(
      ["S-1", "S-2", "S-3"].filter((id) => id !== teamId).map((id) => [id, `Placeholder ${id}`])
    ),
  });
  const MINE = card("S-2", [
    {
      id: "0",
      teamAId: "S-2",
      teamBId: "S-1",
      ageGroupId: PAGE,
      teamAScore: 4,
      teamBScore: 2,
      date: "2027-03-20",
    },
    { id: "1", teamAId: "S-3", teamBId: "S-2", ageGroupId: PAGE, date: "2027-04-20" },
  ]);
  const THEIRS = card("S-3", [
    { id: "0", teamAId: "S-3", teamBId: "S-2", ageGroupId: PAGE, date: "2027-04-20" },
    { id: "1", teamAId: "S-3", teamBId: "S-1", ageGroupId: PAGE, date: "2027-04-22" },
  ]);
  const withCards = (cards: ClubCard[]) => {
    const buckets = new Map<string, Record<string, ReturnType<typeof encodeClubCard>>>();
    for (const one of cards) {
      const key = clubKey(2027, clubBucketOf(one.team.id));
      buckets.set(key, { ...(buckets.get(key) ?? {}), [one.team.id]: encodeClubCard(one) });
    }
    return publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      ...[...buckets].map(([key, clubs]) => ({ key, value: { clubs } })),
    ]);
  };
  const onScouting = () =>
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=scouting");

  it("reports on the page's own club from the board and its card, with its next game", async () => {
    await withCards([MINE]);
    onScouting();
    open(sourcesOf(live));
    const next = await screen.findAllByRole("table", { name: "Next up" });
    expect(next[0]).toHaveTextContent("Placeholder S-3");
    expect(screen.getByRole("combobox", { name: /How would/ })).toHaveValue("Placeholder S-2");
    expect(handedOver()).toBeNull();
  });

  /** Scouts S-3, whose card's first game still to play is against S-2, and opens its what-if. */
  const whatIfOnTheirs = async () => {
    const user = userEvent.setup();
    const box = await screen.findByRole("combobox", { name: /How would/ });
    await user.click(box);
    await user.type(box, "Placeholder S-3");
    const listbox = document.getElementById(box.getAttribute("aria-controls") ?? "")!;
    const option = within(listbox)
      .getAllByRole("option")
      .find((one) => one.textContent?.includes("Placeholder S-3"));
    await user.click(within(option!).getByRole("button"));
    // Its own next games, off its own card.
    await waitFor(() =>
      expect(screen.getAllByRole("table", { name: "Next up" })[0]).toHaveTextContent(
        "Placeholder S-1"
      )
    );
    fireEvent.click((await screen.findAllByRole("button", { name: /^What if\?/ }))[0]!);
  };
  const CURVE = {
    gameId: "0",
    forTeamId: "S-3",
    points: [
      { margin: -1, rank: 3, rating: 1.5 },
      { margin: 1, rank: 2, rating: 2.5 },
    ],
    winRecord: "4-1",
    lossRecord: "3-2",
    rankedCount: 3,
  };

  it("asks the server for a what-if on the club it reports on, and draws its answer", async () => {
    await withCards([MINE, THEIRS]);
    pool.wants = false;
    onScouting();
    const server = editFunction(() => answered({ kind: "scouting.whatIf", curve: CURVE }));
    open(sourcesOf(live, { call: server.call }));
    await whatIfOnTheirs();
    expect(
      await screen.findByRole("table", {
        name: "What a win or a loss against Placeholder S-2 would do",
      })
    ).toBeTruthy();
    // The fixture as the card holds it, its id its place there, on the board's half.
    expect(server.sent).toEqual([
      {
        query: {
          kind: "scouting.whatIf",
          page: PAGE,
          segment: "spring",
          forTeamId: "S-3",
          game: { id: "0", teamAId: "S-3", teamBId: "S-2", ageGroupId: PAGE, date: "2027-04-20" },
          today: TODAY,
        },
        copy: MANIFEST.copy,
      },
    ]);
    // Put away when pressed again.
    fireEvent.click(
      screen.getByRole("button", { name: /^Hide\s*what a win or a loss against Placeholder S-2/ })
    );
    expect(
      screen.queryByRole("table", { name: "What a win or a loss against Placeholder S-2 would do" })
    ).toBeNull();
    // Another fixture is working until its own answer is in, never drawn with the last one's.
    fireEvent.click(
      screen.getByRole("button", {
        name: /^What if\?\s*what a win or a loss against Placeholder S-1/,
      })
    );
    expect(screen.getByText(/Working it out/)).toBeTruthy();
    expect(
      await screen.findByRole("table", {
        name: "What a win or a loss against Placeholder S-1 would do",
      })
    ).toBeTruthy();
    expect(server.sent).toHaveLength(2);
    expect(handedOver()).toBeNull();
  });

  it("says a what-if could not be worked out when the server has no curve for it", async () => {
    await withCards([MINE, THEIRS]);
    pool.wants = false;
    onScouting();
    const server = editFunction(() => answered({ kind: "scouting.whatIf", curve: null }));
    open(sourcesOf(live, { call: server.call }));
    await whatIfOnTheirs();
    expect(await screen.findByText(/That could not be worked out/)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("hands over when the club it reports on has no card", async () => {
    pool.wants = false;
    onScouting();
    open(sourcesOf(live));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("hands over when its card's bucket holds no card for the club it reports on", async () => {
    // The bucket the page's own club would be in, read whole, with only another club in it.
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      {
        key: clubKey(2027, clubBucketOf("S-2")),
        value: { clubs: { "S-9": encodeClubCard(card("S-9", [])) } },
      },
    ]);
    pool.wants = false;
    onScouting();
    open(sourcesOf(live));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });
});

describe("what the board reads beside it, while the meta is only the one this device kept", () => {
  const WITH_VIEWS: PublishedView[] = [
    { key: `board:2027:${PAGE}:spring`, value: SPRING },
    { key: `board:2027:${PAGE}:fall`, value: FALL },
    { key: `board:2027:${PAGE}:year`, value: SPRING },
    {
      key: gamesKey(2027, PAGE),
      value: encodeGames({
        page: PAGE,
        games: [
          {
            id: "g1",
            teamAId: "S-1",
            teamBId: "S-2",
            ageGroupId: PAGE,
            teamAScore: 7,
            teamBScore: 2,
            date: TODAY,
          },
        ],
        names: new Map([
          ["S-1", "Placeholder S-1"],
          ["S-2", "Placeholder S-2"],
        ]),
      }),
    },
    {
      key: clubKey(2027, clubBucketOf("S-1")),
      value: {
        clubs: {
          "S-1": encodeClubCard({
            team: { id: "S-1", name: "Placeholder S-1", state: "OH" },
            games: [
              {
                id: "g1",
                teamAId: "S-1",
                teamBId: "S-2",
                ageGroupId: PAGE,
                teamAScore: 5,
                teamBScore: 3,
                date: "2027-03-20",
              },
            ],
            names: { "S-2": "Placeholder S-2" },
            age: { level: 12 },
          }),
        },
      },
    },
  ];

  /** One visit on the board alone, so the meta and the board are kept and nothing else. */
  const visitOnce = async () => {
    await publish(live, WITH_VIEWS);
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
  };
  /** The network's reader, its meta read held back until `answer`: a slow network. */
  const slow = () => {
    let answer = (): void => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const reader = readerOf(live);
    const held: LiveReader = {
      ...reader,
      readMeta: async () => {
        await answered;
        return reader.readMeta();
      },
    };
    return { answer: () => answer(), reader: held };
  };
  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  it("waits for the network's meta for a Games list it did not keep, and draws it then", async () => {
    await visitOnce();
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=games");
    pool.wants = false;
    const net = slow();
    open(sourcesOf(live, { reader: async () => net.reader }));
    await pause(100);
    expect(handedOver()).toBeNull();
    await act(async () => net.answer());
    expect(await screen.findByText("Placeholder S-1 7")).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("waits for the network's meta for a club's card it did not keep, and opens the panel then", async () => {
    await visitOnce();
    const net = slow();
    open(sourcesOf(live, { reader: async () => net.reader }));
    expect(await screen.findByText("The cloud's board · checking for a newer one…")).toBeTruthy();
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-1" }))[0]!);
    await pause(100);
    expect(handedOver()).toBeNull();
    await act(async () => net.answer());
    expect(await screen.findByRole("region", { name: "Placeholder S-1" })).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("hands over for a list it did not keep once the network has none to give", async () => {
    await visitOnce();
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=games");
    pool.wants = false;
    const offline: LiveReader = {
      readMeta: () => Promise.reject({ code: "unavailable" }),
      getChunk: () => Promise.reject({ code: "unavailable" }),
    };
    open(sourcesOf(live, { reader: async () => offline }));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("forgets every board it kept and held, and hands over, when the rules refuse a card", async () => {
    await publish(live, WITH_VIEWS);
    const bucket = live.meta()?.views[clubKey(2027, clubBucketOf("S-1"))];
    if (!bucket) throw new Error("no bucket");
    const reader = readerOf(live);
    const refusingCards: LiveReader = {
      ...reader,
      getChunk: (id) =>
        id.startsWith(bucket.id)
          ? Promise.reject({ code: "permission-denied" })
          : reader.getChunk(id),
    };
    open(sourcesOf(live, { reader: async () => refusingCards }));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(screen.getByText(/^Schedules last pulled/)).toBeTruthy();
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-1" }))[0]!);
    await waitFor(() => expect(kept.size).toBe(0));
    // Nothing the refused account read stays on screen while the pool comes in, or held after.
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    expect(screen.queryByText(/^Schedules last pulled/)).toBeNull();
    expect(screen.queryAllByText("Placeholder S-2")).toHaveLength(0);
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
    await act(async () => pool.finish());
    expect(handedOver()).not.toBeNull();
  });

  it("reads a board again once the server is heard again, dating the old one by its own read", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    const NEXT = { rows: [row("S-7", 1, { state: "OH" }), ...SPRING.rows.slice(1)] };
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: NEXT },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: NEXT },
    ]);
    let down = true;
    const net = slow();
    const flaky: LiveReader = {
      ...net.reader,
      getChunk: (id) => (down ? Promise.reject({ code: "unavailable" }) : net.reader.getChunk(id)),
    };
    const later = `${TODAY}T15:00:00.000Z`;
    open(sourcesOf(live, { reader: async () => flaky, now: () => later }));
    expect(await screen.findByText("The cloud's board · checking for a newer one…")).toBeTruthy();
    await act(async () => net.answer());
    const asOf = (heardAt: string) =>
      liveLabel({
        check: "offline",
        standing: null,
        rules: undefined,
        boardDay: TODAY,
        today: TODAY,
        heardAt,
      });
    // The rows on screen are the board read at T, and the label dates them by that read.
    expect(await screen.findByText(asOf(T))).toBeTruthy();
    expect(screen.queryAllByText("Placeholder S-7")).toHaveLength(0);
    await waitFor(() => expect(live.watching()).toBe(1));
    down = false;
    act(() => live.reconnect());
    expect((await screen.findAllByText("Placeholder S-7")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Offline · the cloud's board as of /)).toBeNull();
  });
});

describe("what it hands over, when, and what stays after", () => {
  const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
  const cardOf = (teamId: string, games: ClubCard["games"]): ClubCard => ({
    team: { id: teamId, name: `Placeholder ${teamId}` },
    games,
    names: Object.fromEntries(
      ["S-1", "S-2", "S-3", "S-7"]
        .filter((id) => id !== teamId)
        .map((id) => [id, `Placeholder ${id}`])
    ),
  });
  const MEETING = {
    id: "0",
    teamAId: "S-2",
    teamBId: "S-3",
    ageGroupId: PAGE,
    teamAScore: 4,
    teamBScore: 2,
    date: "2027-03-20",
  };
  const CARDS = [
    cardOf("S-1", [
      {
        id: "0",
        teamAId: "S-1",
        teamBId: "S-2",
        ageGroupId: PAGE,
        teamAScore: 5,
        teamBScore: 3,
        date: "2027-03-20",
      },
    ]),
    cardOf("S-2", [
      MEETING,
      { id: "1", teamAId: "S-7", teamBId: "S-2", ageGroupId: PAGE, date: "2027-04-20" },
    ]),
    cardOf("S-3", [MEETING]),
  ];
  const withCards = (cards: ClubCard[] = CARDS, more: PublishedView[] = []) => {
    const buckets = new Map<string, Record<string, ReturnType<typeof encodeClubCard>>>();
    for (const one of cards) {
      const key = clubKey(2027, clubBucketOf(one.team.id));
      buckets.set(key, { ...(buckets.get(key) ?? {}), [one.team.id]: encodeClubCard(one) });
    }
    return publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: SPRING },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      ...[...buckets].map(([key, clubs]) => ({ key, value: { clubs } })),
      ...more,
    ]);
  };
  const onScouting = () =>
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=scouting");
  const pick = async (user: ReturnType<typeof userEvent.setup>, box: HTMLElement, name: string) => {
    await user.click(box);
    await user.type(box, name);
    const listbox = document.getElementById(box.getAttribute("aria-controls") ?? "");
    if (!listbox) throw new Error("no listbox");
    const option = within(listbox)
      .getAllByRole("option")
      .find((one) => one.textContent?.includes(name));
    if (!option) throw new Error(`no option ${name}`);
    await user.click(within(option).getByRole("button"));
  };

  it("gives a half moved to after the first board a while of its own to draw", async () => {
    pool.wants = false;
    const reader = readerOf(live);
    const fall = live.meta()?.views[`board:2027:${PAGE}:fall`];
    if (!fall) throw new Error("no fall board");
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const slowFall: LiveReader = {
      ...reader,
      getChunk: async (id) => {
        if (id.startsWith(fall.id)) await released;
        return reader.getChunk(id);
      },
    };
    open(sourcesOf(live, { reader: async () => slowFall }), { waitMs: 200 });
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    // The first while runs out with the board drawn.
    await pause(300);
    fireEvent.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    expect(handedOver()).toBeNull();
    expect(screen.getByText("Reading the cloud's board…")).toBeTruthy();
    // The half's own while runs out with its board not drawn: it hands over.
    await waitFor(() => expect(handedOver()).not.toBeNull());
    release();
  });

  it("opens a club picked in Find a team on another page from its card, long after opening", async () => {
    const ELEVEN = "ag_11u_2027";
    const NINERS: ClubCard = {
      team: { id: "S-9", name: "Placeholder S-9", state: "OH" },
      games: [],
      names: {},
    };
    await publish(
      live,
      [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        { key: `board:2027:${ELEVEN}:spring`, value: { rows: [row("S-9", 1, { state: "OH" })] } },
        { key: `board:2027:${ELEVEN}:fall`, value: { rows: [] } },
        { key: `board:2027:${ELEVEN}:year`, value: { rows: [] } },
        {
          key: searchKey(2027),
          value: encodeSearch({
            options: [{ id: "S-9", label: "Placeholder S-9", detail: "11U 2027 · OH" }],
            pageOf: new Map([["S-9", ELEVEN]]),
            held: { dropped: new Set(), ageless: [], tooYoung: new Set() },
          }),
        },
        {
          key: clubKey(2027, clubBucketOf("S-9")),
          value: { clubs: { "S-9": encodeClubCard(NINERS) } },
        },
      ],
      {
        pulledAt: T,
        halves: { [PAGE]: { fall: 10, spring: 20 }, [ELEVEN]: { fall: 0, spring: 5 } },
      }
    );
    const user = userEvent.setup();
    open(sourcesOf(live), { waitMs: 150 });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    await pause(250);
    await pick(user, box, "Placeholder S-9");
    expect(await screen.findByRole("region", { name: "Placeholder S-9" })).toBeTruthy();
    expect(screen.queryByText(/Loading this device's copy/)).toBeNull();
    expect(handedOver()).toBeNull();
  });

  it("goes when Team Rankings opens, so Back to a page only Team Rankings knows stays there", async () => {
    const THIRTEEN: AgeGroup = {
      id: "ag_13u_2027",
      name: "13U 2027",
      ageLevel: 13,
      year: 2027,
      seasonIds: [],
    };
    function Page() {
      const { selectedAgeGroupId } = useRankingsPages([...GROUPS, THIRTEEN], TODAY);
      return <p data-testid="probe">{selectedAgeGroupId}</p>;
    }
    pool.wants = false;
    // An area the board does not draw: it hands over at once.
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    render(
      <LiveTeamRankings
        status={{ kind: "connecting" }}
        renderPage={() => <Page />}
        preloadPage={() => Promise.resolve()}
        sources={sourcesOf(live)}
        seasons={[]}
        showToast={showToast}
        confirm={confirm}
        waitMs={60_000}
      />
    );
    await screen.findByTestId("probe");
    // Its listener went with it.
    expect(live.watching()).toBe(0);
    act(() => {
      window.history.pushState(null, "", "/?view=rankings&age=13&year=2027");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await pause(50);
    expect(screen.getByTestId("probe").textContent).toBe("ag_13u_2027");
    expect(window.location.search).toContain("age=13");
  });

  it("lets go of the board it held for Team Rankings when it closes", async () => {
    const shown = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).not.toBeNull();
    shown.unmount();
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
  });

  it("opens Team Rankings on the club compared and the opponents asked for, kept across a half", async () => {
    await withCards();
    onScouting();
    const user = userEvent.setup();
    open(sourcesOf(live));
    await pick(user, await screen.findByLabelText("Compare with"), "Placeholder S-3");
    const compared = { name: "Placeholder S-2 and Placeholder S-3 compared" };
    expect(await screen.findByRole("region", compared)).toBeTruthy();
    // A half moved to reads its board again, and the comparison stays.
    fireEvent.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    await waitFor(() => expect(window.location.search).toContain("fall"));
    expect(await screen.findByRole("region", compared)).toBeTruthy();
    await pick(user, screen.getByLabelText("Check a team"), "Placeholder S-1");
    expect(
      await screen.findByRole("button", { name: "Remove Placeholder S-1 from the report" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    await act(async () => pool.finish());
    await waitFor(() => expect(handedOver()).not.toBeNull(), { timeout: 5_000 });
    expect(handedOver()).toMatchObject({ compareTeamId: "S-3", pickedOpponentIds: ["S-1"] });
  });

  it("puts the caret in the search box once the list asked for is in, however long it takes", async () => {
    await withCards(CARDS, [
      {
        key: searchKey(2027),
        value: encodeSearch({
          options: [{ id: "S-1", label: "Placeholder S-1", detail: "12U 2027 · Springfield, OH" }],
          pageOf: new Map([["S-1", PAGE]]),
          held: { dropped: new Set(), ageless: [], tooYoung: new Set() },
        }),
      },
    ]);
    const entry = live.meta()?.views[searchKey(2027)];
    if (!entry) throw new Error("no list");
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const reader = readerOf(live);
    pool.wants = false;
    open(
      sourcesOf(live, {
        reader: async () => ({
          ...reader,
          getChunk: async (id: string) => {
            if (id.startsWith(entry.id)) await released;
            return reader.getChunk(id);
          },
        }),
      })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    await pause(600);
    expect(handedOver()).toBeNull();
    await act(async () => release());
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it("keeps the board, and the focus in it, when it hands over while the pool comes in", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    const before = screen.getByTestId("live-board");
    const rankings = screen.getByRole("tab", { name: "Rankings" });
    rankings.focus();
    fireEvent.keyDown(rankings, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement ?? rankings, { key: "ArrowRight" });
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    expect(screen.getByTestId("live-board")).toBe(before);
    expect(document.activeElement?.textContent).toBe("Import");
  });

  it("says an area it cannot draw opens on this device's copy, while the pool comes in", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    const panel = document.getElementById("team-rankings-panel");
    if (!panel) throw new Error("no panel");
    expect(panel.getAttribute("aria-labelledby")).toBe("team-rankings-tab-import");
    expect(within(panel).queryAllByText("Placeholder S-1")).toHaveLength(0);
    expect(
      within(panel).getByText("This opens on this device's copy as soon as it is in…")
    ).toBeTruthy();
  });

  it("opens Team Rankings on the club open once the pool is in, though another was handed over", async () => {
    await withCards(CARDS.filter((one) => one.team.id !== "S-3"));
    open(sourcesOf(live));
    // S-3 has no card: it hands over, with the pool still coming in.
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-3" }))[0]!);
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    expect(
      screen.getByText("This club opens on this device's copy as soon as it is in…")
    ).toBeTruthy();
    // The board still opens clubs from their cards meanwhile.
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-1" }))[0]!);
    expect(await screen.findByRole("region", { name: "Placeholder S-1" })).toBeTruthy();
    await act(async () => pool.finish());
    expect(handedOver()).toMatchObject({ openTeamId: "S-1" });
  });

  it("hands a club with no card tapped while the pool comes in over to Team Rankings", async () => {
    await withCards(CARDS.filter((one) => one.team.id !== "S-3"));
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    open(sourcesOf(live));
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-3" }))[0]!);
    expect(
      await screen.findByText("This club opens on this device's copy as soon as it is in…")
    ).toBeTruthy();
    await act(async () => pool.finish());
    expect(handedOver()).toMatchObject({ openTeamId: "S-3" });
  });

  it("offers no what-if on a game against a club the board does not rank", async () => {
    await withCards();
    onScouting();
    open(sourcesOf(live));
    const next = await screen.findAllByRole("table", { name: "Next up" });
    expect(next[0]).toHaveTextContent("Placeholder S-7");
    expect(within(next[0]!).queryAllByRole("button", { name: /^What if\?/ })).toHaveLength(0);
  });

  it("hands over offline for a page whose board this device never kept", async () => {
    await publish(
      live,
      [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        { key: "board:2027:ag_11u_2027:spring", value: FALL },
        { key: "board:2027:ag_11u_2027:fall", value: FALL },
        { key: "board:2027:ag_11u_2027:year", value: FALL },
      ],
      {
        pulledAt: T,
        halves: { [PAGE]: { fall: 10, spring: 20 }, ag_11u_2027: { fall: 10, spring: 20 } },
      }
    );
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    window.history.replaceState(null, "", "/?view=rankings&age=11&year=2027");
    pool.wants = false;
    open(sourcesOf(null));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("draws the board it kept when the network fails before that board is read", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    const offline: LiveReader = {
      readMeta: () => Promise.reject({ code: "unavailable" }),
      getChunk: () => Promise.reject({ code: "unavailable" }),
    };
    pool.wants = false;
    open(sourcesOf(live, { reader: async () => offline }));
    expect(await screen.findByText(/^Offline · the cloud's board as of /)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("opens Team Rankings at once when asked to stop waiting for the pool", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    open(sourcesOf(live));
    fireEvent.click(await screen.findByRole("button", { name: "Show this device's copy now" }));
    expect(handedOver()).toEqual({ stateTop: null, stateFilter: "", showAll: false });
  });
});

describe("Setup on the cloud's board", () => {
  const OPENED = {
    kind: "health.summary",
    summary: {
      holdings: [{ year: 2027, pages: 2, teams: 3, games: 9, emptied: false }],
      datedAhead: [
        {
          id: "g-ahead",
          date: "2027-05-01",
          teamAId: "S-1",
          teamBId: "S-2",
          teamAScore: 3,
          teamBScore: 2,
          year: 2027,
          filers: ["S-1"],
        },
      ],
      implausible: [],
      suspected: [
        {
          teamId: "S-1",
          name: "Placeholder S-1",
          ahead: 1,
          implausible: 0,
          played: 2,
          gcTeamIds: ["gc-1"],
          gameIds: ["g-ahead"],
        },
      ],
      clubs: {
        "S-1": { name: "Placeholder S-1", gcId: "gc-1" },
        "S-2": { name: "Placeholder S-2" },
      },
    },
    answers: { ageRight: [], realClubs: [], keptApart: [] },
  };
  const WAITING = {
    kind: "ageless.queue",
    listed: 1,
    waiting: 1,
    batch: [
      {
        teamId: "gcWAIT0001",
        name: "Placeholder Waiting",
        firstSeen: "2027-04-01T00:00:00.000Z",
        lastTried: "2027-04-08T00:00:00.000Z",
        tries: 1,
      },
    ],
    groups: [],
  };
  /** The edit function's answer to each question Setup asks, and an edit made otherwise. */
  const setupAnswers = (data: Record<string, unknown>) => {
    const query = data.query as { kind?: string } | undefined;
    if (!query) return made(5);
    return answered(query.kind === "ageless.queue" ? WAITING : OPENED);
  };
  const asked = (sent: Array<Record<string, unknown>>) =>
    sent.flatMap((data) => (data.query ? [(data.query as { kind: string }).kind] : [])).sort();
  const onSetup = () =>
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=setup");

  it("draws Pool health from the server's pool, and stays the page", async () => {
    onSetup();
    pool.wants = false;
    const server = editFunction(setupAnswers);
    open(sourcesOf(live, { call: server.call }));
    expect(await screen.findByText("Scored on a day that has not happened")).toBeTruthy();
    expect(screen.getByText(/Placeholder S-1 3–2 Placeholder S-2/)).toBeTruthy();
    // The teams waiting on an age, above it, as on this device's Setup.
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(server.sent).toContainEqual({
      query: { kind: "health.summary", today: TODAY },
      copy: MANIFEST.copy,
    });
    expect(server.sent).toContainEqual({
      query: { kind: "ageless.queue", today: TODAY, pinned: [] },
      copy: MANIFEST.copy,
    });
    expect(asked(server.sent)).toEqual(["ageless.queue", "health.summary"]);
    // Deleted at once, and what the pool then shows asked for again.
    fireEvent.click(screen.getByRole("button", { name: "Delete club" }));
    await waitFor(() => expect(said.toasts).toContain("Deleted Placeholder S-1."));
    expect(edited(server.sent)).toEqual([
      { command: { kind: "club.drop", teamId: "S-1" }, copy: MANIFEST.copy },
    ]);
    await waitFor(() =>
      expect(asked(server.sent)).toEqual(["ageless.queue", "health.summary", "health.summary"])
    );
    expect(handedOver()).toBeNull();
  });

  const LEAGUE: SeasonMeta[] = [{ id: "season-1", name: "Placeholder League", createdAt: T }];
  const seasonRow = (text: string) => {
    const row = screen
      .getByText("Placeholder League", { selector: "span.font-bold" })
      .closest("li");
    if (!row) throw new Error("no row for the league season");
    return within(row).getByText(text);
  };

  it("puts a league season on a page through the server, and shows it there at once", async () => {
    onSetup();
    pool.wants = false;
    const server = editFunction(setupAnswers);
    open(sourcesOf(live, { call: server.call }), { seasons: LEAGUE });
    // Once the network has answered for the board, and edits can be sent.
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(screen.getByText("Not on Team Rankings yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2027" } });
    fireEvent.click(screen.getByRole("button", { name: "Put on 12U 2027" }));
    await waitFor(() => expect(said.toasts).toContain("League season added to 12U 2027."));
    expect(edited(server.sent)).toEqual([
      {
        command: {
          kind: "season.assign",
          seasonId: "season-1",
          season: { ageLevel: 12, year: 2027 },
          pageId: expect.any(String),
        },
        copy: MANIFEST.copy,
      },
    ]);
    // On the page at once, in both cards, before any publish carries it.
    expect(seasonRow("On 12U 2027")).toBeTruthy();
    const pages = screen.getByRole("heading", { name: "Age groups" }).parentElement;
    expect(pages?.querySelector("li")?.textContent).toBe("12U 2027Placeholder League");
    // What Team Rankings is, and this browser's own diagnostics, as on this device's Setup.
    expect(screen.getByRole("heading", { name: "What Team Rankings is" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What has gone wrong here" })).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("says what a season joins by the pages drawn, the edits not yet published among them", async () => {
    onSetup();
    pool.wants = false;
    const server = editFunction(setupAnswers);
    const two: SeasonMeta[] = [
      { id: "season-1", name: "Placeholder League", createdAt: T },
      { id: "season-2", name: "Placeholder Cup", createdAt: T },
    ];
    open(sourcesOf(live, { call: server.call }), { seasons: two });
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    const put = (index: number) => {
      fireEvent.change(screen.getAllByLabelText("Age")[index]!, { target: { value: "9" } });
      fireEvent.change(screen.getAllByLabelText("Year")[index]!, { target: { value: "2028" } });
      fireEvent.click(screen.getByRole("button", { name: "Put on 9U 2028" }));
    };
    put(0);
    await waitFor(() =>
      expect(said.toasts).toContain("9U 2028 created, with your league season on it.")
    );
    // The page the first made is drawn already, so the second joins it rather than making another.
    put(1);
    await waitFor(() => expect(said.toasts).toContain("League season added to 9U 2028."));
    const [first, second] = edited(server.sent).map(
      (data) => data.command as { pageId: string; seasonId: string }
    );
    expect([first?.seasonId, second?.seasonId]).toEqual(["season-1", "season-2"]);
    const pages = screen.getByRole("heading", { name: "Age groups" }).parentElement;
    expect(pages?.querySelector("li")?.textContent).toBe(
      "9U 2028Placeholder League, Placeholder Cup"
    );
  });

  it("reads which page holds a season off the cloud's pages, not this device's copy", async () => {
    await publish(live, undefined, {
      pulledAt: T,
      halves: { [PAGE]: { fall: 10, spring: 20 } },
      groups: [GROUPS[0], { ...GROUPS[1], seasonIds: ["season-1"] }],
    });
    onSetup();
    pool.wants = false;
    const server = editFunction(setupAnswers);
    open(sourcesOf(live, { call: server.call }), { seasons: LEAGUE });
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(screen.getByText("On 11U 2027")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take off" }));
    await waitFor(() => expect(said.toasts).toContain("League season taken off Team Rankings."));
    expect(edited(server.sent)).toEqual([
      {
        command: {
          kind: "season.assign",
          seasonId: "season-1",
          season: null,
          pageId: expect.any(String),
        },
        copy: MANIFEST.copy,
      },
    ]);
    expect(seasonRow("Not on Team Rankings yet")).toBeTruthy();
  });

  /** The edit function's answers, with `check` its answer to the model check. */
  const checkedWith = (check: unknown) => (data: Record<string, unknown>) =>
    (data.query as { kind?: string } | undefined)?.kind === "model.check"
      ? check
      : setupAnswers(data);

  it("checks the model of the page open on the server, and draws its answer", async () => {
    onSetup();
    pool.wants = false;
    // A check of a page with nothing dated to hold back, as the server would send it.
    const answer = JSON.parse(JSON.stringify(checkTheModel(PAGE, [], [], GROUPS))) as unknown;
    const server = editFunction(checkedWith(answered({ kind: "model.check", answer })));
    open(sourcesOf(live, { call: server.call }));
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(screen.getByText(/later ones, which the fit never saw/).textContent).toContain(
      "earlier games in 12U 2027"
    );
    fireEvent.click(screen.getByRole("button", { name: "Check the model" }));
    expect(await screen.findByText(/Not enough dated games here to hold any back/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run it again" })).toBeTruthy();
    expect(server.sent).toContainEqual({
      query: { kind: "model.check", page: PAGE },
      copy: MANIFEST.copy,
    });
    // Nothing of it is this device's copy's: the rest of Setup no longer offers it.
    expect(screen.getByText(/open on this device's copy for now/).textContent).not.toContain(
      "model check"
    );
    expect(handedOver()).toBeNull();
  });

  it("says why a model check went unanswered, and not that the pool changed", async () => {
    onSetup();
    pool.wants = false;
    let check: unknown = answered({ kind: "model.check", answer: null });
    const server = editFunction((data) => checkedWith(check)(data));
    open(sourcesOf(live, { call: server.call }));
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check the model" }));
    await waitFor(() => expect(said.toasts).toContain(PAGE_NOT_ON_COPY));
    expect(await screen.findByText(CHECK_UNANSWERED)).toBeTruthy();
    expect(screen.queryByText(/The pool changed while this ran/)).toBeNull();
    check = { ok: false, why: "kept-moving" };
    fireEvent.click(screen.getByRole("button", { name: "Check the model" }));
    await waitFor(() => expect(said.toasts).toContain(QUERY_REFUSED["kept-moving"]));
    expect(screen.getByText(CHECK_UNANSWERED)).toBeTruthy();
  });

  it("opens the rest of Setup on this device's copy when asked", async () => {
    onSetup();
    pool.wants = false;
    const server = editFunction(setupAnswers);
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByRole("button", { name: "Open them on this device's copy" }));
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });
});
