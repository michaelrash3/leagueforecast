import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudManifest, ManifestPart } from "../../lib/cloud/cloudManifest";
import { LEAGUE_PART } from "../../lib/cloud/cloudPlan";
import type { CopySeen } from "../../lib/cloud/cloudSession";
import { BOARD_FAMILY, builtFrom } from "../../lib/live/boardInputs";
import { forgetDecodedBoards } from "../../lib/live/liveClient";
import { forgetLiveBoard, liveBoardFor, type RankingsHandover } from "../../lib/live/liveBoard";
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
import { forgetDecodedClubs } from "./LiveClubPanel";
import { forgetDecodedSearches } from "../../hooks/useLiveSearch";
import { GAMES_FAMILY, encodeGames, gamesKey } from "../../lib/live/views/gamesShape";
import { forgetDecodedGames } from "./LiveGames";
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
  forgetDecodedClubs();
  forgetDecodedSearches();
  forgetDecodedGames();
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

  it("hands over at once for any area but the boards and the games", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=setup");
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
    await waitFor(() => expect(kept.size).toBe(0));
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
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
  const withCard = () =>
    publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      {
        key: clubKey(2027, clubBucketOf("S-1")),
        value: { clubs: { "S-1": encodeClubCard(CARD) } },
      },
    ]);
  const tapClub = async (name: string) =>
    fireEvent.click((await screen.findAllByRole("button", { name }))[0]!);

  it("opens from its card, with its record and games, and nothing on it to change", async () => {
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
    for (const name of ["Rename", "Merge", "Set age", "Fold into it", "Unlink"])
      expect(within(panel).queryByRole("button", { name })).toBeNull();
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(handedOver()).toBeNull();
  });

  it("closes, and opens Team Rankings on the club open when it hands over", async () => {
    await withCard();
    open(sourcesOf(live), { quietMs: 100 });
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Placeholder S-1" })).toBeNull();
    await tapClub("Placeholder S-1");
    await screen.findByRole("region", { name: "Placeholder S-1" });
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

  it("does not hand over on its own while somebody is in the search box", async () => {
    await withList();
    pool.wants = false;
    open(sourcesOf(live), { quietMs: 100 });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(handedOver()).toBeNull();
    act(() => box.blur());
    await waitFor(() => expect(handedOver()).not.toBeNull(), { timeout: 2_000 });
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

  it("lists the page's games from its list, today's first, with nothing on it to change", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    onGames();
    open(sourcesOf(live));
    await screen.findByText(/^Today's games/);
    // Today's two, the rest counted, and the one still owed a score said so.
    expect(screen.getByText(/2 more are hidden \(1 still need a score\)/)).toBeTruthy();
    expect(screen.getByText("Placeholder S-1 7")).toBeTruthy();
    expect(screen.getByText(/Placeholder S-3 vs/)).toBeTruthy();
    for (const name of ["Remove", "Enter score", "Don't count", "Add Game", "Import games"])
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
});
