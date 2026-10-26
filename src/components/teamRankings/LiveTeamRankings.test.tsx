import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NO_REMOVALS } from "../../lib/autoRemoved";
import { BROUGHT_BACK } from "../../lib/gcIdWhereabouts";
import { SENT_PULLS_KEY, type PullSender } from "../../lib/cloud/cloudPulls";
import { newPullJob, type PullJob } from "../../lib/cloud/pullJobs";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudManifest, ManifestPart } from "../../lib/cloud/cloudManifest";
import { LEAGUE_PART } from "../../lib/cloud/cloudPlan";
import type { CopySeen } from "../../lib/cloud/cloudSession";
import { BOARD_FAMILY, builtFrom } from "../../lib/live/boardInputs";
import { forgetDecodedBoards } from "../../lib/live/liveClient";
import { forgetLiveBoard, liveBoardFor, type RankingsHandover } from "../../lib/live/liveBoard";
import {
  EDIT_LOCKS,
  EDIT_REFUSED,
  QUERY_REFUSED,
  STARTED_AGAIN_WAITING,
} from "../../lib/live/liveEdits";
import { STARTED_AGAIN } from "./LiveStartAgainCard";
import { liveLabel } from "../../lib/live/liveLabel";
import { openViewCache, type ViewCache, type ViewCacheIo } from "../../lib/live/viewCache";
import {
  LIVE_SCHEMA,
  publishViews,
  type LiveReader,
  type PublishedView,
} from "../../lib/live/viewStore";
import type { BoardRow, BoardView, LivePages } from "../../lib/live/views/boardShape";
import {
  CLUB_FAMILY,
  clubBucketOf,
  clubKey,
  coerceClubBucket,
  encodeClubCard,
  type ClubCard,
} from "../../lib/live/views/clubShape";
import { gameBreakdown } from "../../lib/gameBreakdown";
import { gameNotesOf } from "../../lib/live/gameWords";
import {
  boardViews,
  buildBoardsAndFacts,
  coerceBoardView,
  livePagesOf,
} from "../../lib/live/views/board";
import { clubViews } from "../../lib/live/views/clubs";
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
import { SCOUTING_NO_CARD } from "./LiveScouting";
import { CHECK_UNANSWERED, PAGE_NOT_ON_COPY, SETUP_PAGES_UNREAD } from "./LiveSetup";
import type { BackupAnswer, BackupRequest } from "../../workers/backupProtocol";
import { SEARCH_UNREAD } from "./RankingsSection";
import { forgetDecodedArchive } from "./LiveArchive";
import { ORGS_NO_NAMES, ORGS_NO_TEAMS, ORGS_NOTHING_NEW } from "./LiveImport";
import { commitChanges } from "../../lib/cloud/cloudEngine";
import { memoryCloud } from "../../lib/cloud/__tests__/memoryCloud";
import type { ArchivedSeason } from "../../lib/teamRankingsArchive";
import { archiveRowsKey, GC_ARCHIVE_KEY } from "../../lib/teamRankingsStorage";
import { checkTheModel } from "../../lib/scoutBacktest";
import { memoryLive, type MemoryLive } from "../../lib/live/__tests__/memoryLive";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { NAMED_GAMES_MAX } from "../../lib/teamRankings/namedGames";
import type { SeasonMeta } from "../../lib/storage";
import { readLeagueClubRanks } from "../../lib/leagueClubRanks";
import { readDefaultState, writeDefaultState } from "../../lib/preferences";
import {
  initTeamRankingsStore,
  resetTeamRankingsStore,
  saveAgeGroups,
  type PoolStoreIo,
} from "../../lib/teamRankingsStorage";
import type { LiveSources } from "../../hooks/useLiveBoard";
import { askToScout, scoutAsked } from "../../lib/scoutRequest";
import { releaseOpening, resetOpeningHold } from "../../lib/live/openingHold";
import { resetPoolFill, startPoolFill } from "../../lib/poolFill";

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

const { LIVE_NOTICES, LIVE_UNREAD, LiveTeamRankings } = await import("./LiveTeamRankings");

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
  epoch: "",
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
  pages: LivePages = { pulledAt: T, halves: { [PAGE]: { fall: 10, spring: 20 } } },
  version = MANIFEST.version
) =>
  publishViews({
    store: live.store,
    views,
    owns: [BOARD_FAMILY, CLUB_FAMILY, SEARCH_FAMILY, GAMES_FAMILY],
    copy: { id: MANIFEST.copy, version },
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

const open = (sources: LiveSources, { seasons = [] as SeasonMeta[] } = {}) =>
  render(
    <LiveTeamRankings
      status={{ kind: "connecting" }}
      renderPage={page}
      preloadPage={() => Promise.resolve()}
      sources={sources}
      seasons={seasons}
      showToast={showToast}
      confirm={confirm}
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
  pool.finish = () => undefined;
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
  it("draws the published board as the page would, and brings no pool in for it", async () => {
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(screen.getAllByText("Springfield, OH").length).toBeGreaterThan(0);
    // The page's own club is starred, in its card, with its state rank, and its game still to come.
    const mine = screen.getByRole("region", { name: "My team" });
    expect(mine.textContent).toContain("Placeholder S-2");
    // No card of the club is published here, so nothing is said of its next game, rather than that
    // it has none, or that it is still coming.
    await waitFor(() => expect(mine.textContent).not.toContain("Next game: loading…"));
    expect(mine.textContent).not.toContain("No game on the schedule");
    // The state top ten opens on the club's state; the full table's League badge is the row's.
    expect((screen.getByRole("combobox", { name: "State" }) as HTMLSelectElement).value).toBe("OH");
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 teams" }));
    expect(screen.getAllByText("League")).toHaveLength(1);
    // Edits are on: a club can be marked as the page's own.
    expect(screen.getAllByRole("button", { name: /Mark mine/ }).length).toBeGreaterThan(0);
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
    // Held for the page, starred as the page stars it, for when it takes over.
    expect(
      liveBoardFor({ ageGroupId: PAGE, segment: "spring", myTeamId: "S-2" })?.map(
        (one) => one.isMine
      )
    ).toEqual([false, true, false]);
  });

  /*
   * The header's last-pull line says what a meta it read says: when, or that no pull is named. Where
   * no meta could be read it says nothing of the last pull, never that nothing was pulled, which the
   * page said under an older version's boards on 10 October 2026.
   */
  it("says when schedules were last pulled only as a meta it read says, and nothing without one", async () => {
    const NEVER = "No GameChanger schedules pulled yet.";
    const line = () => screen.queryByTestId("rankings-freshness");
    open(sourcesOf(live));
    expect(await screen.findByText(/^Schedules last pulled/)).toBeTruthy();
    cleanup();
    // A meta read that names no pull.
    const unpulled = memoryLive();
    await publish(unpulled, undefined, { halves: { [PAGE]: { fall: 10, spring: 20 } } });
    open(sourcesOf(unpulled));
    expect(await screen.findByText(NEVER)).toBeTruthy();
    cleanup();
    // No meta read: an older version's, none at all, one whose pages will not read, offline.
    const older = memoryLive();
    await publish(older);
    older.setMeta({ ...older.meta(), schema: LIVE_SCHEMA - 1 });
    const garbled = memoryLive();
    await publish(garbled);
    garbled.setMeta({ ...garbled.meta(), inline: { pages: { halves: [] } } });
    const offline: LiveReader = {
      readMeta: () => Promise.reject({ code: "unavailable" }),
      getChunk: () => Promise.reject({ code: "unavailable" }),
    };
    for (const [sources, notice] of [
      [sourcesOf(older), LIVE_NOTICES.older],
      [sourcesOf(memoryLive()), LIVE_NOTICES.none],
      [sourcesOf(garbled), LIVE_NOTICES.unreadable],
      [sourcesOf(live, { reader: async () => offline }), LIVE_NOTICES.offline],
    ] as const) {
      // Nothing kept from the reads before: a meta this device kept is one it read, and says so.
      kept.clear();
      open(sources);
      expect(await screen.findByText(notice)).toBeTruthy();
      expect(screen.queryByText(NEVER)).toBeNull();
      expect(line()).toBeNull();
      cleanup();
    }
    // Nor while the first read is on its way.
    const silent: LiveReader = {
      readMeta: () => new Promise(() => undefined),
      getChunk: () => new Promise(() => undefined),
    };
    open(sourcesOf(live, { reader: async () => silent }));
    expect(await screen.findByText("Reading the cloud's board…")).toBeTruthy();
    expect(line()).toBeNull();
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
    // No pages yet, and no meta to say whether the cloud has any: nothing is said of it.
    expect(screen.queryByText(LIVE_NOTICES.noPages)).toBeNull();
    expect(await screen.findAllByRole("button", { name: "Placeholder S-1" })).not.toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Age level" })).toHaveTextContent("12U");
    expect(screen.queryByText(LIVE_NOTICES.noPages)).toBeNull();
    expect(handedOver()).toBeNull();
  });

  it("lays the page out by the meta's pages over this device's own", async () => {
    // The cloud has a 13U page this device's copy never had, and none of its 11U.
    const THIRTEEN: AgeGroup = {
      id: "ag_13u_2027",
      name: "13U 2027",
      ageLevel: 13,
      year: 2027,
      seasonIds: [],
    };
    await publish(live, undefined, {
      pulledAt: T,
      halves: { [PAGE]: { fall: 10, spring: 20 } },
      groups: [GROUPS[0]!, THIRTEEN],
    });
    open(sourcesOf(live));
    expect(await screen.findAllByRole("button", { name: "Placeholder S-1" })).not.toHaveLength(0);
    const ages = screen.getByRole("navigation", { name: "Age level" });
    await waitFor(() => expect(ages).toHaveTextContent("13U"));
    expect(ages).not.toHaveTextContent("11U");
  });

  it("says so when neither this device nor the meta has a page to lay out, and stays", async () => {
    resetTeamRankingsStore();
    window.localStorage.clear();
    open(sourcesOf(live));
    expect(await screen.findByText(LIVE_NOTICES.noPages)).toBeTruthy();
    expect(handedOver()).toBeNull();
    // The Games tab says it too, rather than asking for a list of no page.
    fireEvent.click(screen.getByRole("tab", { name: "Games" }));
    expect(await screen.findByText(LIVE_NOTICES.noPages)).toBeTruthy();
    expect(screen.queryByText(LIVE_UNREAD.games)).toBeNull();
    // Nor when the cloud's meta says it has no pages, whatever this device's copy holds.
    cleanup();
    saveAgeGroups(GROUPS);
    await publish(live, undefined, { pulledAt: T, halves: {}, groups: [] });
    open(sourcesOf(live));
    expect(await screen.findByText(LIVE_NOTICES.noPages)).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
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

  /** The page's league seasons, as the meta names them, and the places a card was showing. */
  const STALE = { clubId: "S-1", board: "12U 2027 · Fall 2026", rank: 9, of: 9, at: T };
  const withSeasons = async (league: LivePages["league"]) => {
    saveAgeGroups([{ ...GROUPS[0]!, seasonIds: ["season-1", "season-2", "season-3"] }, GROUPS[1]!]);
    window.localStorage.setItem(
      "lf_league_club_ranks_v1",
      JSON.stringify({
        "season-1": { "L-1": STALE },
        "season-2": { "L-9": STALE },
        "season-3": { "L-8": STALE },
      })
    );
    await publish(live, undefined, {
      pulledAt: T,
      halves: { [PAGE]: { fall: 10, spring: 20 } },
      ...(league ? { league } : {}),
    });
  };

  it("writes where its league seasons' clubs stand on its board, for League Standings' card", async () => {
    await withSeasons([
      // Another page claiming the season too, whose clubs are not this page's.
      {
        page: "ag_11u_2027",
        season: "season-1",
        clubs: [{ team: "L-1", club: "S-3" }],
        halves: ["spring"],
      },
      {
        page: PAGE,
        season: "season-1",
        clubs: [
          { team: "L-1", club: "S-2" },
          { team: "L-2", club: "S-3" },
        ],
        halves: ["spring"],
      },
      // A fall league, which the spring board says nothing of.
      { page: PAGE, season: "season-2", clubs: [{ team: "L-9", club: "S-1" }], halves: ["fall"] },
      // A season none of whose teams is a club here: what the card showed of it goes.
      { page: PAGE, season: "season-3", clubs: [], halves: [] },
    ]);
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    await waitFor(() => expect(readLeagueClubRanks()["season-1"]?.["L-2"]).toBeDefined());
    const board = "12U 2027 · Spring 2027";
    expect(readLeagueClubRanks()).toEqual({
      "season-1": {
        "L-1": {
          clubId: "S-2",
          board,
          rank: 2,
          of: 3,
          state: "OH",
          stateRank: 2,
          stateOf: 2,
          movement: 0,
          at: expect.any(String),
          // The page the board is, for League Standings' Scout button to open.
          ageLevel: 12,
          year: 2027,
          segment: "spring",
        },
        "L-2": {
          clubId: "S-3",
          board,
          rank: 3,
          of: 3,
          state: "KY",
          stateRank: 1,
          stateOf: 1,
          movement: "new",
          at: expect.any(String),
          // The page the board is, for League Standings' Scout button to open.
          ageLevel: 12,
          year: 2027,
          segment: "spring",
        },
      },
      "season-2": { "L-9": STALE },
    });
  });

  it("writes no places before its board is drawn, nor for a season the meta does not name", async () => {
    await withSeasons([
      { page: PAGE, season: "season-1", clubs: [{ team: "L-1", club: "S-2" }], halves: [] },
    ]);
    const reader = readerOf(live);
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const held: LiveReader = {
      ...reader,
      getChunk: async (id) => {
        await released;
        return reader.getChunk(id);
      },
    };
    open(sourcesOf(live, { reader: async () => held }));
    expect(await screen.findByText("Reading the cloud's board…")).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(Object.keys(readLeagueClubRanks())).toEqual(["season-1", "season-2", "season-3"]);
    expect(readLeagueClubRanks()["season-1"]).toEqual({ "L-1": STALE });
    release();
    await waitFor(() => expect(readLeagueClubRanks()["season-1"]?.["L-1"]?.rank).toBe(2));
    expect(readLeagueClubRanks()["season-2"]).toEqual({ "L-9": STALE });
    expect(readLeagueClubRanks()["season-3"]).toEqual({ "L-8": STALE });
  });

  it("opens on the half the published counts say is worth reading", async () => {
    live = memoryLive();
    await publish(live, undefined, { halves: { [PAGE]: { fall: 100, spring: 2 } } });
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-F")).not.toHaveLength(0);
    expect(screen.queryByText("Placeholder S-1")).toBeNull();
  });

  it("says a page's board is not published yet, stays, and draws it once it is", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=11&year=2027");
    open(sourcesOf(live));
    expect(await screen.findByText(LIVE_NOTICES.missing)).toBeTruthy();
    // The page's header stays, and nothing of this device's copy is brought in.
    expect(screen.getByRole("navigation", { name: "Age level" })).toHaveTextContent("11U");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
    expect(screen.queryByText(/Loading this device's copy/)).toBeNull();
    // Published: the watch draws it in place.
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: "board:2027:ag_11u_2027:spring", value: FALL },
    ]);
    expect(await screen.findAllByText("Placeholder S-F")).not.toHaveLength(0);
    expect(screen.queryByText(LIVE_NOTICES.missing)).toBeNull();
  });

  it("says a page's board could not be read when its pieces are not the board published", async () => {
    const reader = readerOf(live);
    const spring = live.meta()?.views[`board:2027:${PAGE}:spring`];
    if (!spring) throw new Error("no spring board");
    open(
      sourcesOf(live, {
        reader: async () => ({
          ...reader,
          getChunk: async (id: string) =>
            id.startsWith(spring.id) ? new Uint8Array([1, 2, 3]) : reader.getChunk(id),
        }),
      })
    );
    expect(await screen.findByText(LIVE_NOTICES.damaged)).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("says on the board's own area, not another, that a page's board is not published", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=11&year=2027&section=import");
    open(sourcesOf(live));
    expect(await screen.findByRole("heading", { name: "Pull teams in the cloud" })).toBeTruthy();
    expect(screen.queryByText(LIVE_NOTICES.missing)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
    expect(await screen.findByText(LIVE_NOTICES.missing)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("says why when nothing is published, or no build like this one published it, and stays", async () => {
    open(sourcesOf(memoryLive()));
    expect(await screen.findByText(LIVE_NOTICES.none)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Games" }));
    expect(await screen.findByText(LIVE_NOTICES.none)).toBeTruthy();
    cleanup();
    const older = memoryLive();
    await publish(older);
    act(() => older.setMeta({ ...older.meta(), schema: 1 }));
    open(sourcesOf(older));
    expect(await screen.findByText(LIVE_NOTICES.older)).toBeTruthy();
    cleanup();
    // A meta whose pages this build cannot read.
    const garbled = memoryLive();
    await publish(garbled);
    act(() => garbled.setMeta({ ...garbled.meta(), inline: { pages: { halves: [] } } } as never));
    open(sourcesOf(garbled));
    expect(await screen.findByText(LIVE_NOTICES.unreadable)).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("says so offline with nothing kept at all, on the board and on Games", async () => {
    const offline: LiveReader = {
      readMeta: () => Promise.reject({ code: "unavailable" }),
      getChunk: () => Promise.reject({ code: "unavailable" }),
    };
    open(sourcesOf(live, { reader: async () => offline }));
    expect(await screen.findByText(LIVE_NOTICES.offline)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Games" }));
    expect(await screen.findByText(LIVE_NOTICES.offline)).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("keeps the board up, and says so, when it was built before changes it does not have", async () => {
    const moved = { ...MANIFEST, parts: [part(LEAGUE_PART, h(9)), MANIFEST.parts[1]!] };
    const first = open(sourcesOf(live, { seen: () => seenOf(moved) }));
    expect((await screen.findAllByText("Placeholder S-1")).length).toBeGreaterThan(0);
    expect(screen.getByText("The cloud's board, from before the latest changes")).toBeTruthy();
    first.unmount();
    // This device's own changes, not yet in the copy.
    open(sourcesOf(live, { owed: () => ["league_forecast_scout_teams_v1"] }));
    expect(
      await screen.findByText("The cloud's board, from before this device's changes")
    ).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("says a club with no card could not be read, and opens nothing on this device", async () => {
    open(sourcesOf(live));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-3" }))[0]!);
    expect(await screen.findByText(LIVE_UNREAD.club)).toBeTruthy();
    expect(handedOver()).toBeNull();
    // Asked again, it is still not there; put away, it is gone.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(LIVE_UNREAD.club)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText(LIVE_UNREAD.club)).toBeNull();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("draws the Import tab, and sends a pasted list to be pulled in the cloud, staying the page", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    fireEvent.change(await screen.findByLabelText("Teams to pull"), {
      target: { value: "gcACES000001\ngcACES000002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pull 2 teams in the cloud" }));
    await waitFor(() => expect(cloud.started).toHaveLength(1));
    const [job] = [...cloud.jobs.values()];
    // A paste: any squad year, and only the teams the pool lacks, which the cloud works out.
    expect(job).toMatchObject({ status: "queued", list: { teams: 2 }, seasonYears: [] });
    expect(job?.refresh).toBeUndefined();
    expect(
      await screen.findByText(/^Pulling 2 teams in the cloud: starting, sent just now\.$/)
    ).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("imports a CSV on the cloud Import tab without rendering the file in the text box", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    const user = userEvent.setup();
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    const button = await screen.findByRole("button", { name: "Import CSV" });
    const input = screen.getByLabelText("Team list CSV");
    const click = vi.spyOn(input, "click");
    await user.click(button);
    expect(click).toHaveBeenCalledOnce();
    await user.upload(
      input,
      new File(["Team Name,Team ID\nAces,gcACES000001\nBadgers,gcACES000002"], "teams.csv", {
        type: "text/csv",
      })
    );
    expect(await screen.findByText("teams.csv")).toBeInTheDocument();
    expect(screen.queryByLabelText("Teams to pull")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pull 2 teams in the cloud" }));
    await waitFor(() => expect(cloud.started).toHaveLength(1));
    expect([...cloud.jobs.values()][0]).toMatchObject({ list: { teams: 2 }, seasonYears: [] });
    expect(screen.queryByText("teams.csv")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Teams to pull")).toHaveValue("");
  });

  it("lets a CSV selection be cleared and the same file selected again", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    const user = userEvent.setup();
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    const input = await screen.findByLabelText("Team list CSV");
    const file = new File(["gcACES000001"], "teams.csv", { type: "text/csv" });
    await user.upload(input, file);
    await screen.findByText("teams.csv");
    await user.click(screen.getByRole("button", { name: "Choose a different file" }));
    expect(screen.getByLabelText("Teams to pull")).toHaveValue("");
    await user.upload(input, file);
    expect(await screen.findByText("teams.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull 1 team in the cloud" })).toBeEnabled();
  });

  it("reads a nationwide CSV larger than 32 MiB without filling the text box, and sends it in parts", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    const user = userEvent.setup();
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    const input = await screen.findByLabelText("Team list CSV");
    const csv =
      "\uFEFFTeam Name,Team ID,Season,Age Group,City,State,League Associations,Staff,Staff Count,Player Count,Org ID,Org Name,Org Type,GC URL,Age Source\r\n" +
      Array.from({ length: 150_000 }, (_, index) => {
        const id = `gcteam${String(index).padStart(6, "0")}`;
        return `"Club ${index} 12U","${id}","Fall 2026","12U","Town","KY","${"Export detail ".repeat(15)}","Avery, Blake, Casey","3","15","org123456","Club 12U","Organization","https://web.gc.com/teams/${id}","Team"`;
      }).join("\r\n");
    const file = new File([csv], "GC_Teams_Desktop_2026-10-12.csv", { type: "text/csv" });
    expect(file.size).toBeGreaterThan(32 * 1024 * 1024);
    await user.upload(input, file);
    expect(await screen.findByText(file.name, {}, { timeout: 20_000 })).toBeInTheDocument();
    expect(screen.queryByLabelText("Teams to pull")).not.toBeInTheDocument();
    // Read whole, and more than one pull takes (`MAX_LIST_TEAMS`): sendable, as parts it names.
    expect(screen.getByRole("button", { name: "Pull 150,000 teams in the cloud" })).toBeEnabled();
    expect(
      screen.getByText(
        "This list will run in the cloud as 3 parts of up to 50,000 teams, one after another."
      )
    ).toBeInTheDocument();
  }, 30_000);

  // The screen that sat for hours: two catch-ups "waiting to start" whose start had failed where
  // the device could not hear, and that nothing would ever run or end.
  it("asks the cloud again about a pull still waiting to start, and says what came of it", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    const jobId = "c".repeat(32);
    const sentAt = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    cloud.jobs.set(
      jobId,
      newPullJob({
        list: { hash: "h", teams: 1710, pieces: 1 },
        seasonYears: [2027],
        timeZone: "America/New_York",
        device: "phone",
        now: sentAt,
        refresh: true,
      })
    );
    localStorage.setItem(
      SENT_PULLS_KEY,
      JSON.stringify([{ jobId, sentAt, teams: 1710, told: false }])
    );
    const asked: Array<number | undefined> = [];
    const sender: PullSender = {
      ...cloud.sender,
      // As the cloud answers a job queued an hour that nothing started (`startPullJob`).
      start: async (id, waitedMs) => {
        asked.push(waitedMs);
        const job = cloud.jobs.get(id);
        if (job) cloud.jobs.set(id, { ...job, status: "failed", error: "It was never started." });
        return { ok: true, value: { status: "failed" } };
      },
    };
    open(sourcesOf(live, { pulls: () => sender }));
    expect(
      await screen.findByText("The pull of 1,710 teams in the cloud failed: It was never started.")
    ).toBeTruthy();
    expect(asked).toHaveLength(1);
    // Its own wait, by this device's clock: three hours, give or take the test's own run.
    expect(asked[0]).toBeGreaterThanOrEqual(3 * 60 * 60_000);
    expect(asked[0]).toBeLessThan(3 * 60 * 60_000 + 60_000);
  });

  it("cancels a pull stopped before it started, by asking the cloud at once", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    const jobId = "d".repeat(32);
    const sentAt = new Date().toISOString();
    cloud.jobs.set(
      jobId,
      newPullJob({
        list: { hash: "h", teams: 9270, pieces: 1 },
        seasonYears: [2027],
        timeZone: "America/New_York",
        device: "phone",
        now: sentAt,
        refresh: true,
      })
    );
    localStorage.setItem(
      SENT_PULLS_KEY,
      JSON.stringify([{ jobId, sentAt, teams: 9270, told: false }])
    );
    const sender: PullSender = {
      ...cloud.sender,
      // As the cloud answers a stopped job no leg ran: it cancels it (`startPullJob`).
      start: async (id) => {
        const job = cloud.jobs.get(id);
        if (job?.stopAsked) cloud.jobs.set(id, { ...job, status: "cancelled" });
        return { ok: true, value: { status: job?.stopAsked ? "cancelled" : "queued" } };
      },
    };
    open(sourcesOf(live, { pulls: () => sender }));
    await screen.findByText(/^Pulling 9,270 teams in the cloud: starting, sent just now\.$/);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(
      await screen.findByText(/^The pull in the cloud was stopped: 0 of 9,270 teams filed/)
    ).toBeTruthy();
  });

  it("sends the catch-ups the server names to be pulled again, in the season being played", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    const server = editFunction(() =>
      answered({
        kind: "import.status",
        due: {
          ageLevels: [],
          heldBack: 0,
          label: "",
          catchUp: true,
          cadence: "daily",
          agelessTotal: 1,
          teams: 0,
          agelessDue: 1,
        },
        refreshed: [],
        orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
        agelessIds: ["gcW1"],
        rosterIds: ["gcR1", "gcR2"],
      })
    );
    open(sourcesOf(live, { call: server.call, pulls: () => cloud.sender }));
    fireEvent.click(await screen.findByRole("button", { name: "Check 2 short rosters again" }));
    await waitFor(() => expect(cloud.started).toHaveLength(1));
    const [job] = [...cloud.jobs.values()];
    expect(job).toMatchObject({ list: { teams: 2 }, refresh: true });
    expect(job?.seasonYears).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Ask again about 1 team nobody could age" })
    ).toBeTruthy();
  });

  it("asks a pull on its way to stop, and says once how one ended", async () => {
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
    pool.wants = false;
    const cloud = cloudPulls();
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    fireEvent.change(await screen.findByLabelText("Teams to pull"), {
      target: { value: "gcACES000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pull 1 team in the cloud" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect([...cloud.jobs.values()][0]?.stopAsked).toBe(true));
    cleanup();
    // Ended, as a later visit finds it: said once, and gone when told.
    const [id, job] = [...cloud.jobs.entries()][0]!;
    cloud.jobs.set(id, { ...job, status: "cancelled", stopAsked: true });
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    expect(await screen.findByText(/The pull in the cloud was stopped/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/The pull in the cloud was stopped/)).toBeNull();
    cleanup();
    open(sourcesOf(live, { pulls: () => cloud.sender }));
    await screen.findByLabelText("Teams to pull");
    expect(screen.queryByText(/The pull in the cloud was stopped/)).toBeNull();
  });

  it("stays the page however long nobody touches the screen, and hands over for what it cannot draw", async () => {
    pool.wants = false;
    open(sourcesOf(live));
    await screen.findByText("The cloud's board");
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
    expect(handedOver()).toBeNull();
    await pullOnDevice(live);
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

  it("opens the saved board immediately while a fresh meta arrives and its changed board is still downloading", async () => {
    const first = open(sourcesOf(live));
    await screen.findByText("The cloud's board");
    await waitFor(async () => expect(await sourcesOf(live).cache.meta("uid-1")).not.toBeNull());
    first.unmount();
    forgetDecodedBoards();
    const meta = (await live.store.readMeta())?.meta;
    const newer = structuredClone(meta) as { views: Record<string, { h: string }> };
    for (const entry of Object.values(newer.views)) entry.h = "f".repeat(64);
    const slow: LiveReader = {
      readMeta: async () => newer,
      getChunk: () => new Promise(() => undefined),
    };
    open(sourcesOf(live, { reader: async () => slow }));
    await waitFor(() => expect(screen.getAllByText("Placeholder S-1").length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(screen.queryByText("Reading the cloud's board…")).toBeNull();
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
    // Handed over first, which is when the pool is asked for: finished before that, it finishes
    // nothing, which a loaded machine showed once.
    await waitFor(() => expect(pool.prepared).toBe(1));
    await act(async () => pool.finish());
    expect(handedOver()).not.toBeNull();
    // Refused, it does not listen either.
    expect(live.watching()).toBe(0);
  });

  it("keeps reading, and hands nothing over, however long the network takes", async () => {
    // A network that never answers, which the reader's own limits end in the app.
    const hanging: LiveReader = {
      readMeta: () => new Promise(() => undefined),
      getChunk: () => new Promise(() => undefined),
    };
    open(sourcesOf(live, { reader: async () => hanging }));
    expect(await screen.findByText("Reading the cloud's board…")).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(screen.getByText("Reading the cloud's board…")).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
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

  it("says the page's own club has no game ahead once a publish brings its card", async () => {
    const PAST: ClubCard = {
      team: { id: "S-2", name: "Placeholder S-2" },
      games: [
        {
          id: "0",
          teamAId: "S-2",
          teamBId: "S-1",
          ageGroupId: PAGE,
          teamAScore: 4,
          teamBScore: 2,
          date: "2027-03-20",
        },
      ],
      names: { "S-1": "Placeholder S-1" },
    };
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    // No card published yet: nothing is said of its next game.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "My team" }).textContent).not.toContain(
        "Next game: loading…"
      )
    );
    expect(screen.getByRole("region", { name: "My team" }).textContent).not.toContain(
      "No game on the schedule"
    );
    // The next publish carries its card, with no game still to play.
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      {
        key: clubKey(2027, clubBucketOf("S-2")),
        value: { clubs: { "S-2": encodeClubCard(PAST) } },
      },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "My team" }).textContent).toContain(
        "No game on the schedule yet."
      )
    );
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
    // Handed over to the visitor's own app, and only then is the pool brought in.
    await waitFor(() => expect(pool.prepared).toBe(1));
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

  it("keeps the board it drew, and says why, when it hears a meta this build cannot read", async () => {
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    act(() => live.setMeta({ ...live.meta(), schema: 99 }));
    expect(await screen.findByText(LIVE_NOTICES.newer)).toBeTruthy();
    expect(screen.getAllByText("Placeholder S-1").length).toBeGreaterThan(0);
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
    // Said over what reads the views, not Setup, which reads none.
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    await waitFor(() => expect(screen.queryByText(LIVE_NOTICES.newer)).toBeNull());
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

/** A cloud to send pulls to, in memory: the jobs written, and each start asked for. */
const cloudPulls = () => {
  const jobs = new Map<string, PullJob>();
  const started: string[] = [];
  const sender: PullSender = {
    jobs: {
      put: async (jobId, job) => {
        jobs.set(jobId, job);
      },
      read: async (jobId) => jobs.get(jobId) ?? null,
      askStop: async (jobId) => {
        const job = jobs.get(jobId);
        if (job) jobs.set(jobId, { ...job, stopAsked: true });
      },
    },
    start: async (jobId) => {
      started.push(jobId);
      return { ok: true, value: { status: "queued" } };
    },
  };
  return { jobs, started, sender };
};

/**
 * Hands the page over the one way a member's page still does (1.8): the rules end its watch, the
 * account taken off the list partway through a visit.
 */
const pullOnDevice = async (watched: { failWatches: (error: unknown) => void }) => {
  act(() => watched.failWatches({ code: "permission-denied" }));
  await Promise.resolve();
};

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

  it("draws the page's own club's next game from its card, and says it is coming until then", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await withCard({
      team: { id: "S-2", name: "Placeholder S-2", state: "OH" },
      games: [{ id: "g3", teamAId: "S-1", teamBId: "S-2", ageGroupId: PAGE, date: "2027-05-01" }],
      names: { "S-1": "Placeholder S-1" },
      age: { level: 12 },
    });
    const reader = readerOf(live);
    // The board's pieces come at once; the cards' wait until let go.
    const board = new Set(
      Object.entries(live.meta()?.views ?? {})
        .filter(([key]) => key.startsWith("board:"))
        .map(([, entry]) => entry.id)
    );
    const slow: LiveReader = {
      ...reader,
      getChunk: async (id) => {
        if (![...board].some((upload) => id.startsWith(upload))) await held;
        return reader.getChunk(id);
      },
    };
    open(sourcesOf(live, { reader: async () => slow }));
    const mine = await screen.findByRole("region", { name: "My team" });
    expect(mine.textContent).toContain("Next game: loading…");
    release();
    await waitFor(() => expect(mine.textContent).toContain("vs Placeholder S-1 (#1)"));
    expect(mine.textContent).not.toContain("loading");
  });

  it("marks a club as the page's own through the edit function, with the club as its card has it, drawn at once", async () => {
    await withCard();
    const server = editFunction((data) =>
      data.warm ? WARMED : made(5, ["league_forecast_scout_age_groups_v1"])
    );
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByRole("button", { name: "Show all 3 teams" }));
    const marks = await screen.findAllByRole("button", { name: "☆ Mark mine" });
    fireEvent.click(marks[0]!);
    await waitFor(() => expect(said.toasts).toContain("Placeholder S-1 is your team on 12U 2027."));
    expect(edited(server.sent)).toEqual([
      {
        command: { kind: "page.myTeam", ageGroupId: PAGE, teamId: "S-1", adopt: CARD.team },
        copy: MANIFEST.copy,
      },
    ]);
    // Drawn as the page's own at once, before a publish carries it.
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "My team" }).textContent).toContain(
        "Placeholder S-1"
      )
    );
    // Marked again, the mark is taken off.
    fireEvent.click(screen.getAllByRole("button", { name: "★ My team" })[0]!);
    await waitFor(() => expect(said.toasts).toContain("No club is marked as yours on 12U 2027."));
    expect(edited(server.sent)[1]).toEqual({
      command: { kind: "page.myTeam", ageGroupId: PAGE, teamId: null },
      copy: MANIFEST.copy,
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "My team" })).toBeNull());
    expect(handedOver()).toBeNull();
  });

  it("draws the page's own club as the cloud's pages have it, not this device's copy", async () => {
    // The cloud's pages mark S-1 (marked on another device); this device's copy still says S-2.
    await publish(live, undefined, {
      pulledAt: T,
      halves: { [PAGE]: { fall: 10, spring: 20 } },
      groups: [{ ...GROUPS[0]!, myTeamId: "S-1" }, GROUPS[1]!],
    });
    open(sourcesOf(live));
    const mine = await screen.findByRole("region", { name: "My team" });
    expect(mine.textContent).toContain("Placeholder S-1");
    expect(handedOver()).toBeNull();
  });

  it("sends no edit once it has handed over, while this device's copy comes in", async () => {
    await withCard();
    const server = editFunction((data) => (data.warm ? WARMED : made(5)));
    open(sourcesOf(live, { call: server.call }));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    await pullOnDevice(live);
    // The pool is still coming in; the board is drawn again, with nothing to mark on it.
    fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show all 3 teams" }));
    expect(screen.queryByRole("button", { name: /Mark mine/ })).toBeNull();
    expect(handedOver()).toBeNull();
    expect(edited(server.sent)).toEqual([]);
  });

  it("offers nothing to mark while edits are off", async () => {
    await withCard();
    open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 teams" }));
    expect(screen.getAllByRole("button", { name: /Mark mine/ }).length).toBeGreaterThan(0);
    act(() => live.cutOff());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Mark mine/ })).toBeNull());
    // The page's own club still shown as it is.
    expect(screen.getAllByText("★ My team").length).toBeGreaterThan(0);
  });

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
    // Its card names no game it has by a name alone, so none is offered to take off it.
    expect(within(panel).queryByRole("button", { name: /^Not this team/ })).toBeNull();
    expect(handedOver()).toBeNull();
    // Each game's What if, from the board behind the panel.
    const whatIf = within(panel).getAllByRole("button", {
      name: "What if Placeholder S-1 and Placeholder S-2 met today",
    })[0];
    if (whatIf) fireEvent.click(whatIf);
    expect(panel).toHaveTextContent(/Win chance: Placeholder S-\d \d+%/);
    // In a sheet over the board, which Back closes.
    expect(screen.getByRole("dialog", { name: "Placeholder S-1" })).toContainElement(panel);
    expect(window.history.state).toMatchObject({ clubSheet: true });
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("takes a game it has by a name alone off it through the edit function, drawn at once, with an Undo", async () => {
    // The 27 March loss came off another club's schedule, by a name matched to this club.
    await withCard({ ...CARD, byName: { g2: "g2" } });
    const stored = {
      ...CARD.games[1]!,
      source: { kind: "gamechanger", teamId: "gc-4", gameId: "r2" },
    };
    const server = editFunction((data) => {
      if (data.warm) return WARMED;
      const command = data.command as { kind: string; standInId?: string };
      return command.kind === "game.notThisTeam"
        ? {
            ...made(5, ["league_forecast_scout_games_v2:2027", "league_forecast_scout_teams_v1"]),
            inverse: {
              kind: "batch",
              commands: [
                { kind: "game.put", year: 2027, games: [stored] },
                { kind: "team.remove", teamId: command.standInId },
              ],
            },
          }
        : made(6, ["league_forecast_scout_games_v2:2027", "league_forecast_scout_teams_v1"]);
    });
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(panel).toHaveTextContent("1-1 in 12U 2027, from 2 games.");
    // Offered beside that game alone.
    const offered = within(panel).getAllByRole("button", { name: /^Not this team/ });
    expect(offered).toHaveLength(1);
    expect(offered[0]!.closest("li")).toHaveTextContent("2–6 · 2027-03-27");
    fireEvent.click(offered[0]!);
    const done =
      "Taken off Placeholder S-1: the game with Placeholder S-4 on 2027-03-27 stands against the name alone now.";
    await waitFor(() => expect(said.toasts).toContain(done));
    const [sent] = edited(server.sent);
    expect(sent).toEqual({
      command: {
        kind: "game.notThisTeam",
        year: 2027,
        gameId: "g2",
        teamId: "S-1",
        standInId: expect.any(String),
      },
      copy: MANIFEST.copy,
    });
    // A stand-in's id no roster holds: minted from the name, with something of its own after it.
    const standInId = (sent?.command as { standInId: string }).standInId;
    expect(standInId).not.toBe("S-1");
    expect(standInId.length).toBeGreaterThan(0);
    // Off the club at once, before a publish carries it: the record moves with it.
    await waitFor(() => expect(panel).toHaveTextContent("1-0 in 12U 2027, from 1 game."));
    expect(within(panel).queryByRole("button", { name: /^Not this team/ })).toBeNull();
    // The Undo sends the server's own inverse, and the game is drawn on the club again.
    act(() => said.actions.get(done)?.());
    await waitFor(() => expect(said.toasts).toContain("Undone."));
    expect(edited(server.sent).map(({ command }) => (command as { kind: string }).kind)).toEqual([
      "game.notThisTeam",
      "batch",
    ]);
    await waitFor(() => expect(panel).toHaveTextContent("1-1 in 12U 2027, from 2 games."));
    expect(handedOver()).toBeNull();
  });

  it("draws off at once every game the same club filed there by the name, and its Undo brings each back", async () => {
    // Placeholder S-4 named this club twice; the server takes both off, and so does the panel.
    const again = {
      id: "g4",
      teamAId: "S-4",
      teamBId: "S-1",
      ageGroupId: PAGE,
      teamAScore: 7,
      teamBScore: 1,
      date: "2027-04-03",
    };
    await withCard({
      ...CARD,
      games: [...CARD.games, again],
      byName: { g2: "g2", g4: "g4" },
    });
    const source = (gameId: string) => ({ kind: "gamechanger", teamId: "gc-4", gameId });
    const server = editFunction((data) => {
      if (data.warm) return WARMED;
      const command = data.command as { kind: string; standInId?: string };
      return command.kind === "game.notThisTeam"
        ? {
            ...made(5, ["league_forecast_scout_games_v2:2027", "league_forecast_scout_teams_v1"]),
            inverse: {
              kind: "batch",
              commands: [
                {
                  kind: "game.put",
                  year: 2027,
                  games: [
                    { ...CARD.games[1]!, source: source("r2") },
                    { ...again, source: source("r4") },
                  ],
                },
                { kind: "team.remove", teamId: command.standInId },
              ],
            },
          }
        : made(6, ["league_forecast_scout_games_v2:2027", "league_forecast_scout_teams_v1"]);
    });
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(panel).toHaveTextContent("1-2 in 12U 2027, from 3 games.");
    const line = within(panel)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("2027-03-27"))!;
    fireEvent.click(within(line).getByRole("button", { name: /^Not this team/ }));
    const done =
      "Taken off Placeholder S-1: 2 games with Placeholder S-4, on 2027-03-27 and 2027-04-03, stand against the name alone now.";
    await waitFor(() => expect(said.toasts).toContain(done));
    await waitFor(() => expect(panel).toHaveTextContent("1-0 in 12U 2027, from 1 game."));
    expect(within(panel).queryByRole("button", { name: /^Not this team/ })).toBeNull();
    act(() => said.actions.get(done)?.());
    await waitFor(() => expect(said.toasts).toContain("Undone."));
    await waitFor(() => expect(panel).toHaveTextContent("1-2 in 12U 2027, from 3 games."));
  });

  it("offers no game to take off a club while edits are off", async () => {
    await withCard({ ...CARD, byName: { g2: "g2" } });
    open(sourcesOf(live));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(within(panel).getAllByRole("button", { name: /^Not this team/ })).toHaveLength(1);
    act(() => live.cutOff());
    await waitFor(() =>
      expect(within(panel).queryByRole("button", { name: /^Not this team/ })).toBeNull()
    );
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

  it("brings the server's pool up when an edit begins, not as a club opens, and not again soon", async () => {
    await withCard();
    const server = editFunction(() => WARMED);
    open(sourcesOf(live, { call: server.call }));
    await tapClub("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    // Opened to read, and a button pressed: nothing asked of the server.
    await pause(50);
    expect(server.sent).toEqual([]);
    fireEvent.focus(within(panel).getByRole("button", { name: "Close" }));
    await pause(20);
    expect(server.sent).toEqual([]);
    // Going into the name, to change it, brings the pool up for the edit to come.
    fireEvent.focus(within(panel).getByLabelText("Team name"));
    await waitFor(() => expect(server.sent).toEqual([{ warm: true }]));
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await tapClub("Placeholder S-1");
    const again = await screen.findByRole("region", { name: "Placeholder S-1" });
    fireEvent.focus(within(again).getByLabelText("Team name"));
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

  it("says when the list could not be read, and reads it again when asked again", async () => {
    await withList();
    const ofList = listPieces();
    const reader = readerOf(live);
    let failing = true;
    let holding: Promise<void> = Promise.resolve();
    open(
      sourcesOf(live, {
        reader: async () => ({
          ...reader,
          getChunk: async (id: string) => {
            if (failing && ofList(id)) throw { code: "unavailable" };
            if (ofList(id)) await holding;
            return reader.getChunk(id);
          },
        }),
      })
    );
    const search = await screen.findByRole("button", {
      name: "Search every team or coach, any age or season",
    });
    fireEvent.click(search);
    expect(await screen.findByText(SEARCH_UNREAD)).toBeTruthy();
    expect(handedOver()).toBeNull();
    failing = false;
    let release = (): void => undefined;
    holding = new Promise<void>((resolve) => (release = resolve));
    fireEvent.click(
      screen.getByRole("button", { name: "Search every team or coach, any age or season" })
    );
    // Asked again, it is coming, not failed.
    expect(await screen.findByRole("button", { name: "Bringing in every team…" })).toBeTruthy();
    expect(screen.queryByText(SEARCH_UNREAD)).toBeNull();
    release();
    expect(await screen.findByRole("combobox", { name: /find a team/i })).toBeTruthy();
    expect(pool.prepared).toBe(0);
  });

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
    expect(await screen.findByText(/That team was deleted, so every import skips it/)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("brings a deleted team back from Find a team, with an Undo, so the next import files it", async () => {
    await withList();
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : {
            ...made(5),
            inverse: { kind: "answers", list: "droppedClubs", add: ["gcDROPPED001"], remove: [] },
          }
    );
    const user = userEvent.setup();
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    await user.type(box, "gcDROPPED001");
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    await waitFor(() => expect(said.toasts).toContain(BROUGHT_BACK));
    expect(edited(server.sent)).toEqual([
      {
        command: { kind: "answers", list: "droppedClubs", add: [], remove: ["gcDROPPED001"] },
        copy: MANIFEST.copy,
      },
    ]);
    // Said so at once, though the list the search reads still has it until the next publish.
    const list = listboxOf(box);
    await waitFor(() => expect(list).toHaveTextContent(BROUGHT_BACK));
    expect(within(list).queryByRole("button", { name: "Bring it back" })).toBeNull();
    // Undo puts it back on the deleted list, and the search says so again.
    act(() => said.actions.get(BROUGHT_BACK)?.());
    await waitFor(() => expect(said.toasts).toContain("Undone."));
    await waitFor(() => expect(list).toHaveTextContent(/That team was deleted/));
  });

  it("takes the next published list's word over a team it brought back", async () => {
    await withList();
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : {
            ...made(5),
            inverse: { kind: "answers", list: "droppedClubs", add: ["gcDROPPED001"], remove: [] },
          }
    );
    const user = userEvent.setup();
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Search every team or coach, any age or season" })
    );
    const box = await screen.findByRole("combobox", { name: /find a team/i });
    await user.type(box, "gcDROPPED001");
    await user.click(await screen.findByRole("button", { name: "Bring it back" }));
    const list = listboxOf(box);
    await waitFor(() => expect(list).toHaveTextContent(BROUGHT_BACK));
    // Deleted again elsewhere: the list published next still has it, and is the word on it.
    await act(() =>
      publish(live, [
        {
          key: searchKey(2027),
          value: encodeSearch({ ...LIST, options: LIST.options.slice(0, -1) }),
        },
      ])
    );
    await waitFor(() => expect(list).toHaveTextContent(/That team was deleted/));
    expect(within(list).getByRole("button", { name: "Bring it back" })).toBeTruthy();
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
  /** The 11U page's list: one game today, scored. */
  const LIST_OF_ELEVEN = {
    page: "ag_11u_2027",
    games: [
      {
        id: "e1",
        teamAId: "S-F",
        teamBId: "S-9",
        ageGroupId: "ag_11u_2027",
        teamAScore: 4,
        teamBScore: 3,
        date: TODAY,
      },
    ],
    names: new Map([
      ["S-F", "Placeholder S-F"],
      ["S-9", "Placeholder S-9"],
    ]),
  };

  it("offers each game's What if from the board on screen", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    onGames();
    open(sourcesOf(live));
    await screen.findByText(/^Today's games/);
    const button = screen.getByRole("button", {
      name: "What if Placeholder S-1 and Placeholder S-2 met today",
    });
    fireEvent.click(button);
    expect(button.closest("li")).toHaveTextContent(/Win chance: Placeholder S-\d \d+%/);
  });

  it("lists the page's games from its list, today's first, each with its own buttons", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    onGames();
    open(sourcesOf(live));
    await screen.findByText(/^Today's games/);
    // Today's two, the rest counted, and the one still owed a score said so.
    expect(screen.getByText(/2 more are hidden \(1 still need a score\)/)).toBeTruthy();
    expect(screen.getByText("Placeholder S-1 7")).toBeTruthy();
    expect(screen.getByText(/Placeholder S-3 vs/)).toBeTruthy();
    // Each game's own, and adding and importing, all sent to the server.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Enter score" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Don't count" })).toBeTruthy();
    for (const name of ["Add Game", "Import games"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all 4 games" }));
    expect(screen.getByText("Not counted")).toBeTruthy();
    expect(screen.getByText("All 4 games on this page.")).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  /** The edit function asked to add games: whether the page has the one typed, and the edit. */
  const addingServer = ({ logged = false } = {}) =>
    editFunction((data) => {
      const query = data.query as { kind: string; games: unknown[] } | undefined;
      if (!query)
        return {
          ...made(5, ["league_forecast_scout_games_v2:2027"]),
          inverse: { kind: "game.remove", year: 2027, gameIds: ["added"] },
        };
      return answered({
        kind: "games.check",
        checks: query.games.map(() => ({ notes: [null, null], logged })),
      });
    });
  const typeGame = (a: string, b: string, scores: [string, string] = ["", ""]) => {
    fireEvent.change(screen.getByPlaceholderText("Team name"), { target: { value: a } });
    fireEvent.change(screen.getByPlaceholderText("Opponent name"), { target: { value: b } });
    const [scoreA, scoreB] = screen.getAllByPlaceholderText("Score");
    fireEvent.change(scoreA!, { target: { value: scores[0] } });
    fireEvent.change(scoreB!, { target: { value: scores[1] } });
  };

  it("adds a game typed in through the server, by its clubs' names, asking first if it is new", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    typeGame("Placeholder S-1", "Placeholder Newcomers", ["6", "5"]);
    fireEvent.click(screen.getByRole("button", { name: "Add Game" }));
    await waitFor(() => expect(said.toasts).toContain("Game added."));
    const [check] = server.sent.flatMap((data) => (data.query ? [data.query] : []));
    expect(check).toMatchObject({
      kind: "games.check",
      page: PAGE,
      games: [{ teamA: "Placeholder S-1", teamB: "Placeholder Newcomers" }],
    });
    expect(edited(server.sent)).toEqual([
      {
        command: {
          kind: "game.import",
          year: 2027,
          page: PAGE,
          games: [
            {
              id: expect.stringMatching(/^scout_/),
              teamA: "Placeholder S-1",
              teamB: "Placeholder Newcomers",
              teamAScore: 6,
              teamBScore: 5,
            },
          ],
        },
        copy: MANIFEST.copy,
      },
    ]);
    // The form cleared for the next one, and nothing handed to this device's copy.
    expect(screen.getByPlaceholderText("Opponent name")).toHaveValue("");
    expect(said.asked).toEqual([]);
    expect(handedOver()).toBeNull();
  });

  it("asks before adding a game the page already has, and adds nothing when told not to", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer({ logged: true });
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    said.confirming = false;
    typeGame("Placeholder S-1", "Placeholder S-2", ["7", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "Add Game" }));
    await waitFor(() => expect(said.asked).toEqual(["Already logged?"]));
    expect(edited(server.sent)).toEqual([]);
    expect(screen.getByPlaceholderText("Opponent name")).toHaveValue("Placeholder S-2");
  });

  it("adds a pasted schedule through the server once it has checked the rows, with an Undo", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    fireEvent.click(screen.getByRole("button", { name: "Import games" }));
    fireEvent.change(screen.getByLabelText("Games to import"), {
      target: {
        value: "Date,Team,Opponent,Us,Them\n2027-05-02,Placeholder S-1,Placeholder Newcomers,3,1",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read games" }));
    await waitFor(() => expect(screen.queryByText(/checking these games/i)).toBeNull(), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByRole("button", { name: /add 1 game/i }));
    await waitFor(() => expect(said.toasts).toContain("Added 1 game."));
    expect(edited(server.sent)).toMatchObject([
      {
        command: {
          kind: "game.import",
          year: 2027,
          page: PAGE,
          games: [{ teamA: "Placeholder S-1", teamB: "Placeholder Newcomers", date: "2027-05-02" }],
        },
      },
    ]);
    expect(said.actions.has("Added 1 game.")).toBe(true);
  });

  it("adds a game once, however often Add is pressed while the server is asked", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer();
    // Nothing the server is sent is answered until let go.
    let letGo = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      await held;
      return server.call.fetchImpl(url, init);
    }) as typeof fetch;
    open(sourcesOf(live, { call: { ...server.call, fetchImpl } }));
    await screen.findByText(/^Today's games/);
    typeGame("Placeholder S-1", "Placeholder Newcomers", ["6", "5"]);
    const add = screen.getByRole("button", { name: "Add Game" });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    await act(async () => letGo());
    await waitFor(() => expect(said.toasts).toContain("Game added."));
    expect(server.sent.filter((data) => data.query !== undefined)).toHaveLength(1);
    expect(edited(server.sent)).toHaveLength(1);
  });

  it("keeps the next game typed while the last was being added", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer();
    let letGo = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      await held;
      return server.call.fetchImpl(url, init);
    }) as typeof fetch;
    open(sourcesOf(live, { call: { ...server.call, fetchImpl } }));
    await screen.findByText(/^Today's games/);
    typeGame("Placeholder S-1", "Placeholder Newcomers", ["6", "5"]);
    fireEvent.click(screen.getByRole("button", { name: "Add Game" }));
    fireEvent.change(screen.getByPlaceholderText("Opponent name"), {
      target: { value: "Placeholder Latecomers" },
    });
    await act(async () => letGo());
    await waitFor(() => expect(said.toasts).toContain("Game added."));
    expect(screen.getByPlaceholderText("Opponent name")).toHaveValue("Placeholder Latecomers");
  });

  it("marks a game the page already has as added again, once told to add it anyway", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer({ logged: true });
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    typeGame("Placeholder S-1", "Placeholder S-2", ["7", "2"]);
    fireEvent.click(screen.getByRole("button", { name: "Add Game" }));
    await waitFor(() => expect(said.toasts).toContain("Game added."));
    expect(said.asked).toEqual(["Already logged?"]);
    expect(edited(server.sent)).toMatchObject([
      { command: { kind: "game.import", games: [{ teamA: "Placeholder S-1", again: true }] } },
    ]);
  });

  /** Pastes `text` into the import panel and reads it, the rows then checked. */
  const pasteSchedule = (text: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Import games" }));
    fireEvent.change(screen.getByLabelText("Games to import"), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Read games" }));
  };

  it("asks the server about a long schedule a hundred rows at a time", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    const rows = Array.from(
      { length: 150 },
      (_, at) => `2027-05-02,Placeholder Home ${at},Placeholder Away ${at},3,1`
    );
    pasteSchedule(["Date,Team,Opponent,Us,Them", ...rows].join("\n"));
    await screen.findByRole("button", { name: "Add 150 games" });
    await waitFor(() => expect(screen.queryByText(/checking these games/i)).toBeNull(), {
      timeout: 5000,
    });
    const asked = server.sent.flatMap((data) =>
      data.query ? [(data.query as { games: unknown[] }).games.length] : []
    );
    expect(asked).toEqual([100, 50]);
  });

  it("turns away a schedule longer than the server adds at once, as it is read", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = addingServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    const rows = Array.from(
      { length: NAMED_GAMES_MAX + 1 },
      (_, at) => `2027-05-02,Placeholder Home ${at},Placeholder Away ${at},3,1`
    );
    pasteSchedule(["Date,Team,Opponent,Us,Them", ...rows].join("\n"));
    expect(said.toasts).toContain(
      `That is ${NAMED_GAMES_MAX + 1} games, and at most ${NAMED_GAMES_MAX} are added at once. Paste the list in parts.`
    );
    // Left to be pasted again, in parts, and nothing asked of the server.
    expect(screen.getByLabelText("Games to import")).toBeTruthy();
    expect(server.sent.filter((data) => data.query !== undefined)).toEqual([]);
  });

  it("checks the rows again when the server finds some of them on the page by now", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    // Another member adds the schedule while this one looks it over.
    let addedElsewhere = false;
    const server = editFunction((data) => {
      const query = data.query as { games: unknown[] } | undefined;
      if (query)
        return answered({
          kind: "games.check",
          checks: query.games.map(() => ({ notes: [null, null], logged: addedElsewhere })),
        });
      addedElsewhere = true;
      return { ok: false, why: "logged" };
    });
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    pasteSchedule("Date,Team,Opponent,Us,Them\n2027-05-02,Placeholder S-1,Placeholder S-2,3,1");
    await waitFor(() => expect(screen.queryByText(/checking these games/i)).toBeNull(), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByRole("button", { name: /add 1 game/i }));
    await waitFor(() => expect(said.toasts).toContain(EDIT_REFUSED.logged));
    // Asked again, and now found on the page: nothing left to add.
    expect(await screen.findByText("Already logged", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add 0 games/i })).toBeTruthy();
    expect(edited(server.sent)).toHaveLength(1);
  });

  it("reads another page's list for itself, not said to have failed with this page's", async () => {
    const ELEVEN = "ag_11u_2027";
    await publish(live, [
      ...BOARDS,
      { key: `board:2027:${ELEVEN}:spring`, value: FALL },
      { key: gamesKey(2027, ELEVEN), value: encodeGames(LIST_OF_ELEVEN) },
    ]);
    onGames();
    open(sourcesOf(live));
    expect(await screen.findByText(LIVE_UNREAD.games)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "11U" }));
    expect(await screen.findByText("Placeholder S-F 4")).toBeTruthy();
    expect(screen.queryByText(LIVE_UNREAD.games)).toBeNull();
  });

  it("says a newer build's meta above the list it drew, and not on Setup", async () => {
    const ELEVEN = "ag_11u_2027";
    // A page with a list and no board, so only the list is drawn.
    await publish(live, [
      ...BOARDS,
      { key: gamesKey(2027, ELEVEN), value: encodeGames(LIST_OF_ELEVEN) },
    ]);
    window.history.replaceState(null, "", "/?view=rankings&age=11&year=2027&section=games");
    open(sourcesOf(live));
    expect(await screen.findByText("Placeholder S-F 4")).toBeTruthy();
    act(() => live.setMeta({ ...live.meta(), schema: 99 }));
    expect(await screen.findByText(LIVE_NOTICES.newer)).toBeTruthy();
    expect(screen.getByText("Placeholder S-F 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    await waitFor(() => expect(screen.queryByText(LIVE_NOTICES.newer)).toBeNull());
  });

  it("says when the page's list could not be read, and reads it again on asking or a publish", async () => {
    onGames();
    open(sourcesOf(live));
    expect(await screen.findByText(LIVE_UNREAD.games)).toBeTruthy();
    expect(handedOver()).toBeNull();
    // Asked again, it is read again, and still is not there.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(LIVE_UNREAD.games)).toBeTruthy();
    // Published since: the list is read by the new meta, and drawn.
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    expect(await screen.findByText(/^Today's games/)).toBeTruthy();
    expect(screen.queryByText(LIVE_UNREAD.games)).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  /** The score boxes open on a game of the list, the add form's own left out. */
  const rowScoreBoxes = () =>
    screen.queryAllByPlaceholderText("Score").filter((box) => box.closest("li") !== null);
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
    expect(rowScoreBoxes()).toEqual([]);
    expect(handedOver()).toBeNull();
  });

  /** The list published again with `games` in it, of the copy as it was (before any edit made). */
  const republish = (games: ScoutGame[]) =>
    act(() =>
      publish(live, [
        ...BOARDS,
        {
          key: gamesKey(2027, PAGE),
          value: encodeGames({
            page: PAGE,
            games,
            names: new Map([
              ["S-1", "Placeholder S-1"],
              ["S-2", "Placeholder S-2"],
              ["S-3", "Placeholder S-3"],
            ]),
          }),
        },
      ])
    );
  const ROWS: ScoutGame[] = [
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
  ];
  const NEWCOMER: ScoutGame = {
    id: "g0",
    teamAId: "S-2",
    teamBId: "S-3",
    ageGroupId: PAGE,
    date: TODAY,
  };

  it("keeps a score being typed to the list it was opened on, never another game at its place", async () => {
    await publish(live, [...BOARDS, { key: gamesKey(2027, PAGE), value: LIST }]);
    pool.wants = false;
    onGames();
    const server = gamesServer();
    open(sourcesOf(live, { call: server.call }));
    await screen.findByText(/^Today's games/);
    const owed = () => rowOf(/Placeholder S-3 vs/);
    fireEvent.click(within(owed()).getByRole("button", { name: "Enter score" }));
    const [a, b] = within(owed()).getAllByPlaceholderText("Score");
    fireEvent.change(a!, { target: { value: "4" } });
    fireEvent.change(b!, { target: { value: "5" } });
    // A list published meanwhile puts another game owed a score at the place this one had.
    await republish([ROWS[0]!, NEWCOMER, ROWS[1]!]);
    await screen.findByText(/Placeholder S-2 vs/);
    expect(within(rowOf(/Placeholder S-2 vs/)).queryByPlaceholderText("Score")).toBeNull();
    expect(rowScoreBoxes()).toEqual([]);
    expect(edited(server.sent)).toEqual([]);
  });

  it("keeps drawing an edit made through a list published since, by what the list shows of its game", async () => {
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
    // Published again before the edit's version, the game at another place: still drawn.
    await republish([NEWCOMER, ...ROWS]);
    await screen.findByText(/Placeholder S-2 vs/);
    expect(within(played()).getByText("Not counted")).toBeTruthy();
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
    expect(rowScoreBoxes()).toEqual([]);
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

  it("reports on the club League Standings' Scout button asked for, and lets it go", async () => {
    await withCards([MINE, THEIRS]);
    onScouting();
    askToScout("S-3");
    open(sourcesOf(live));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /How would/ })).toHaveValue("Placeholder S-3")
    );
    expect(scoutAsked()).toBeNull();
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

  it("asks once for a fixture its card is published again with, and again for another game at its place", async () => {
    await withCards([MINE, THEIRS]);
    pool.wants = false;
    onScouting();
    const server = editFunction(() => answered({ kind: "scouting.whatIf", curve: CURVE }));
    // Every answer after the first waits until let go.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const call = {
      ...server.call,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        if (calls > 1) await held;
        return server.call.fetchImpl(url, init);
      }) as typeof fetch,
    };
    open(sourcesOf(live, { call }));
    await whatIfOnTheirs();
    const against = (name: string) => ({
      name: `What a win or a loss against ${name} would do`,
    });
    expect(await screen.findByRole("table", against("Placeholder S-2"))).toBeTruthy();
    // Published again with another game added: the fixture is as it was, and nothing is refitted.
    const later = { id: "2", teamAId: "S-3", teamBId: "S-1", ageGroupId: PAGE, date: "2027-04-29" };
    await act(() => withCards([MINE, card("S-3", [...THEIRS.games, later])]));
    await waitFor(() =>
      expect(screen.getAllByRole("table", { name: "Next up" })[0]).toHaveTextContent("Apr 29")
    );
    expect(screen.getByRole("table", against("Placeholder S-2"))).toBeTruthy();
    expect(server.sent).toHaveLength(1);
    // Published with another game at the fixture's place: asked again, for that one.
    const moved = { id: "0", teamAId: "S-3", teamBId: "S-2", ageGroupId: PAGE, date: "2027-04-21" };
    await act(() => withCards([MINE, card("S-3", [moved, ...THEIRS.games.slice(1)])]));
    // The last game's answer is not drawn under this one while its own is worked out.
    expect(await screen.findByText(/Working it out/)).toBeTruthy();
    expect(screen.queryByRole("table", against("Placeholder S-2"))).toBeNull();
    release();
    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1]).toMatchObject({ query: { game: moved } });
    expect(await screen.findByRole("table", against("Placeholder S-2"))).toBeTruthy();
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

  it("says in place of its games when the club it reports on has no card, and stays", async () => {
    // No bucket for it at all in the meta the page settled on.
    onScouting();
    open(sourcesOf(live));
    expect(await screen.findByText(SCOUTING_NO_CARD)).toBeTruthy();
    // A card the cloud has none of is no read that failed: nothing to try again, and the picker
    // stays for another club.
    expect(screen.queryByText(LIVE_UNREAD.scouting)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("combobox", { name: /How would/ })).toHaveValue("Placeholder S-2");
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("says when its card's bucket holds no card for the club it reports on, and reports on another picked", async () => {
    // The bucket the page's own club would be in, read whole, with only another club in it; and
    // the card of a club the member may pick instead.
    const buckets = new Map<string, Record<string, ReturnType<typeof encodeClubCard>>>([
      [clubKey(2027, clubBucketOf("S-2")), { "S-9": encodeClubCard(card("S-9", [])) }],
    ]);
    const theirs = clubKey(2027, clubBucketOf("S-3"));
    buckets.set(theirs, { ...(buckets.get(theirs) ?? {}), "S-3": encodeClubCard(THEIRS) });
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      ...[...buckets].map(([key, clubs]) => ({ key, value: { clubs } })),
    ]);
    onScouting();
    open(sourcesOf(live));
    expect(await screen.findByText(SCOUTING_NO_CARD)).toBeTruthy();
    expect(screen.queryByText(LIVE_UNREAD.scouting)).toBeNull();
    const user = userEvent.setup();
    const box = screen.getByRole("combobox", { name: /How would/ });
    await user.click(box);
    await user.type(box, "Placeholder S-3");
    const listbox = document.getElementById(box.getAttribute("aria-controls") ?? "")!;
    const option = within(listbox)
      .getAllByRole("option")
      .find((one) => one.textContent?.includes("Placeholder S-3"));
    await user.click(within(option!).getByRole("button"));
    await waitFor(() =>
      expect(screen.getAllByRole("table", { name: "Next up" })[0]).toHaveTextContent(
        "Placeholder S-1"
      )
    );
    expect(screen.queryByText(SCOUTING_NO_CARD)).toBeNull();
    expect(handedOver()).toBeNull();
  });

  it("says when the card it reports on could not be read, and reads it again when asked", async () => {
    await withCards([MINE]);
    const reader = readerOf(live);
    const bucket = live.meta()?.views[clubKey(2027, clubBucketOf("S-2"))];
    if (!bucket) throw new Error("no bucket");
    let failing = true;
    const flaky: LiveReader = {
      ...reader,
      getChunk: async (id) => {
        if (failing && id.startsWith(bucket.id)) throw { code: "unavailable" };
        return reader.getChunk(id);
      },
    };
    onScouting();
    open(sourcesOf(live, { reader: async () => flaky }));
    // Offline, the card is there to be had: said with Try again, not as a card the cloud lacks.
    expect(await screen.findByText(LIVE_UNREAD.scouting)).toBeTruthy();
    expect(screen.queryByText(SCOUTING_NO_CARD)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const next = await screen.findAllByRole("table", { name: "Next up" });
    expect(next[0]).toHaveTextContent("Placeholder S-3");
    expect(handedOver()).toBeNull();
  });

  /*
   * The clubs Scouting is on outlast a change of year, and a club picked on one year may have no
   * card on another: 2027 has both clubs' cards, 2026 only the page's own club's.
   */
  const twoYears = async () => {
    const LAST = "ag_12u_2026";
    saveAgeGroups([
      ...GROUPS,
      { id: LAST, name: "12U 2026", ageLevel: 12, year: 2026, seasonIds: [], myTeamId: "S-2" },
    ]);
    const buckets = new Map<string, Record<string, ReturnType<typeof encodeClubCard>>>();
    const put = (year: number, one: ClubCard) => {
      const key = clubKey(year, clubBucketOf(one.team.id));
      buckets.set(key, { ...(buckets.get(key) ?? {}), [one.team.id]: encodeClubCard(one) });
    };
    put(2027, MINE);
    put(2027, THEIRS);
    put(2026, card("S-2", []));
    await publish(
      live,
      [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        { key: `board:2026:${LAST}:spring`, value: SPRING },
        { key: `board:2026:${LAST}:fall`, value: SPRING },
        { key: `board:2026:${LAST}:year`, value: SPRING },
        ...[...buckets].map(([key, clubs]) => ({ key, value: { clubs } })),
      ],
      {
        pulledAt: T,
        halves: { [PAGE]: { fall: 10, spring: 20 }, [LAST]: { fall: 10, spring: 20 } },
      }
    );
  };
  const toLastYear = () =>
    fireEvent.change(document.getElementById("scout-season-year")!, {
      target: { value: "2026" },
    });

  it("keeps a way to pick another club when the one scouted on another year has no card here", async () => {
    await twoYears();
    onScouting();
    open(sourcesOf(live));
    // Scouts S-3 on 2027, then moves to 2026, where S-3 has no card.
    const user = userEvent.setup();
    const box = await screen.findByRole("combobox", { name: /How would/ });
    await user.click(box);
    await user.type(box, "Placeholder S-3");
    const listbox = document.getElementById(box.getAttribute("aria-controls") ?? "")!;
    const option = within(listbox)
      .getAllByRole("option")
      .find((one) => one.textContent?.includes("Placeholder S-3"));
    await user.click(within(option!).getByRole("button"));
    await waitFor(() =>
      expect(screen.getAllByRole("table", { name: "Next up" })[0]).toHaveTextContent(
        "Placeholder S-1"
      )
    );
    toLastYear();
    // Back on the page's own club, whose card that year is there, with the picker to choose another;
    // no card said to have failed to read, which reading again could never mend.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /How would/ })).toHaveValue("Placeholder S-2")
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.queryByText(LIVE_UNREAD.scouting)).toBeNull();
    expect(screen.queryByText(SCOUTING_NO_CARD)).toBeNull();
    expect(screen.getByRole("combobox", { name: /How would/ })).toHaveValue("Placeholder S-2");
    expect(handedOver()).toBeNull();
  });

  it("lets go of a club compared on another year that has no card here, and keeps the report", async () => {
    await twoYears();
    onScouting();
    const user = userEvent.setup();
    open(sourcesOf(live));
    const compare = await screen.findByLabelText("Compare with");
    await user.click(compare);
    await user.type(compare, "Placeholder S-3");
    const listbox = document.getElementById(compare.getAttribute("aria-controls") ?? "")!;
    const option = within(listbox)
      .getAllByRole("option")
      .find((one) => one.textContent?.includes("Placeholder S-3"));
    await user.click(within(option!).getByRole("button"));
    const compared = { name: "Placeholder S-2 and Placeholder S-3 compared" };
    expect(await screen.findByRole("region", compared)).toBeTruthy();
    // The answer leads on the cloud's board as it does on the browser's.
    const forecast = { name: "Forecast: Placeholder S-2 against Placeholder S-3" };
    expect(screen.getByRole("region", forecast)).toHaveTextContent(
      /should beat .* by \d+\.\d runs?|Too close to call/
    );
    toLastYear();
    await waitFor(() => expect(screen.getByLabelText("Compare with")).toHaveValue(""));
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(screen.queryByText(LIVE_UNREAD.scouting)).toBeNull();
    expect(screen.queryByRole("region", compared)).toBeNull();
    expect(screen.queryByRole("region", forecast)).toBeNull();
    expect(screen.getByRole("combobox", { name: /How would/ })).toHaveValue("Placeholder S-2");
    expect(handedOver()).toBeNull();
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

  it("says so of a list it did not keep once the network has none to give", async () => {
    await visitOnce();
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=games");
    const offline: LiveReader = {
      readMeta: () => Promise.reject({ code: "unavailable" }),
      getChunk: () => Promise.reject({ code: "unavailable" }),
    };
    open(sourcesOf(live, { reader: async () => offline }));
    expect(await screen.findByText(LIVE_UNREAD.games)).toBeTruthy();
    expect(handedOver()).toBeNull();
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
    // Handed over first, which is when the pool is asked for: finished before that, it finishes
    // nothing, which the full suite under coverage showed once on 16 October 2026.
    await waitFor(() => expect(pool.prepared).toBe(1));
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

  it("keeps reading a half moved to however long its board takes, and draws it once in", async () => {
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
    open(sourcesOf(live, { reader: async () => slowFall }));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    expect(screen.getByText("Reading the cloud's board…")).toBeTruthy();
    await pause(300);
    expect(screen.getByText("Reading the cloud's board…")).toBeTruthy();
    expect(handedOver()).toBeNull();
    release();
    expect(await screen.findAllByText("Placeholder S-F")).not.toHaveLength(0);
  });

  it("hands over when the rules refuse a half's board moved to, though the meta was read", async () => {
    const reader = readerOf(live);
    const fall = live.meta()?.views[`board:2027:${PAGE}:fall`];
    if (!fall) throw new Error("no fall board");
    const refusingFall: LiveReader = {
      ...reader,
      getChunk: (id) =>
        id.startsWith(fall.id)
          ? Promise.reject({ code: "permission-denied" })
          : reader.getChunk(id),
    };
    open(sourcesOf(live, { reader: async () => refusingFall }));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    // The refusal is heard: every board kept is let go.
    await waitFor(() => expect(kept.size).toBe(0));
    await pause(300);
    // Refused, the account may see none of it: the page hands over, as a refused card or meta does,
    // rather than reading for ever.
    expect(screen.queryByText("Reading the cloud's board…")).toBeNull();
    await waitFor(() => expect(pool.prepared).toBe(1));
    await act(async () => pool.finish());
    expect(handedOver()).not.toBeNull();
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
    open(sourcesOf(live));
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

  it("lets go of the board it held for Team Rankings when it closes", async () => {
    const shown = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).not.toBeNull();
    shown.unmount();
    expect(liveBoardFor({ ageGroupId: PAGE, segment: "spring" })).toBeNull();
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
    expect(document.activeElement?.textContent).toBe("Import");
    await pullOnDevice(live);
    expect(await screen.findByText(/Loading this device's copy/)).toBeTruthy();
    expect(screen.getByTestId("live-board")).toBe(before);
    expect(document.activeElement?.textContent).toBe("Import");
  });

  it("says a club with no card could not be read, and opens another from its card", async () => {
    await withCards(CARDS.filter((one) => one.team.id !== "S-3"));
    open(sourcesOf(live));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-3" }))[0]!);
    expect(await screen.findByText(LIVE_UNREAD.club)).toBeTruthy();
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-1" }))[0]!);
    expect(await screen.findByRole("region", { name: "Placeholder S-1" })).toBeTruthy();
    expect(screen.queryByText(LIVE_UNREAD.club)).toBeNull();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
  });

  it("reads a club's card again when asked, once it could not be read", async () => {
    await withCards();
    const reader = readerOf(live);
    const bucket = live.meta()?.views[clubKey(2027, clubBucketOf("S-1"))];
    if (!bucket) throw new Error("no bucket");
    let failing = true;
    const flaky: LiveReader = {
      ...reader,
      getChunk: async (id) => {
        if (failing && id.startsWith(bucket.id)) throw { code: "unavailable" };
        return reader.getChunk(id);
      },
    };
    open(sourcesOf(live, { reader: async () => flaky }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-1" }))[0]!);
    expect(await screen.findByText(LIVE_UNREAD.club)).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Placeholder S-1" })).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("reads a club's card again by itself once the cloud publishes, after it could not be read", async () => {
    await withCards();
    const reader = readerOf(live);
    const bucket = live.meta()?.views[clubKey(2027, clubBucketOf("S-1"))];
    if (!bucket) throw new Error("no bucket");
    let failing = true;
    const flaky: LiveReader = {
      ...reader,
      getChunk: async (id) => {
        if (failing && id.startsWith(bucket.id)) throw { code: "unavailable" };
        return reader.getChunk(id);
      },
    };
    open(sourcesOf(live, { reader: async () => flaky }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Placeholder S-1" }))[0]!);
    expect(await screen.findByText(LIVE_UNREAD.club)).toBeTruthy();
    failing = false;
    // A publish of another page's board: a new meta, with no Try again pressed.
    await act(() => withCards(CARDS, [{ key: "board:2027:ag_11u_2027:spring", value: FALL }]));
    expect(await screen.findByRole("region", { name: "Placeholder S-1" })).toBeTruthy();
    expect(screen.queryByText(LIVE_UNREAD.club)).toBeNull();
  });

  it("offers no what-if on a game against a club the board does not rank", async () => {
    await withCards();
    onScouting();
    open(sourcesOf(live));
    const next = await screen.findAllByRole("table", { name: "Next up" });
    expect(next[0]).toHaveTextContent("Placeholder S-7");
    expect(within(next[0]!).queryAllByRole("button", { name: /^What if\?/ })).toHaveLength(0);
  });

  it("hands over, with no member to read as, for a page whose board this device never kept", async () => {
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

  it("says so offline for a page whose board this device never kept, and stays", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    first.unmount();
    forgetDecodedBoards();
    window.history.replaceState(
      null,
      "",
      "/?view=rankings&age=12&year=2027&section=rankings&half=fall"
    );
    const offline: LiveReader = {
      readMeta: () => Promise.reject({ code: "unavailable" }),
      getChunk: () => Promise.reject({ code: "unavailable" }),
    };
    open(sourcesOf(live, { reader: async () => offline }));
    expect(await screen.findByText(LIVE_NOTICES.offline)).toBeTruthy();
    expect(handedOver()).toBeNull();
    // Games, with no list kept and none to be had, says it could not read one.
    fireEvent.click(screen.getByRole("tab", { name: "Games" }));
    expect(await screen.findByText(LIVE_UNREAD.games)).toBeTruthy();
    expect(handedOver()).toBeNull();
    expect(pool.prepared).toBe(0);
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

  it("opens a club Pool health names in the squad year its row is of", async () => {
    saveAgeGroups([
      ...GROUPS,
      { id: "ag_12u_2026", name: "12U 2026", ageLevel: 12, year: 2026, seasonIds: [] },
    ]);
    const LOOKED = {
      kind: "health.inspect",
      health: {
        games: 9,
        played: 9,
        teams: 3,
        clubs: 3,
        nameOnly: 0,
        placeholders: 0,
        standInGames: 0,
        standInPlayed: 0,
        undated: 0,
        futureDated: 0,
        tidied: true,
      },
      settleable: 0,
      lists: {
        toPull: [],
        duplicates: [],
        twins: [],
        twice: [],
        wrongAge: [
          {
            teamId: "W-1",
            name: "Placeholder Larks",
            year: 2026,
            gcTeamIds: ["gc-w1"],
            filed: 11,
            suggested: 12,
            reason: "name",
            opponentsAtSuggested: 2,
            opponentsKnown: 2,
            weeks: 1,
          },
        ],
      },
      toPullCount: 0,
    };
    onSetup();
    pool.wants = false;
    const server = editFunction((data) => {
      const query = data.query as { kind?: string } | undefined;
      if (query?.kind === "health.inspect") return answered(LOOKED);
      return setupAnswers(data);
    });
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    fireEvent.click(await screen.findByRole("button", { name: "Placeholder Larks" }));
    await waitFor(() => expect(window.location.search).toContain("year=2026"));
    expect(window.location.search).toContain("section=setup");
  });

  /*
   * The leaders with few outside games cover every page of the year, so most lead a board other
   * than the one on screen: each opens on the page whose board it leads, as a club found by search
   * does, and its panel speaks of that page's games. And the boards on screen are for the members'
   * day, which runs behind the device's from midnight to the night's rebuild: the look asks for the
   * list on the boards' day, so its places are theirs.
   */
  /**
   * A leader listed off 11U's spring board, opened from Setup on the 12U page the URL names: the
   * look is asked for the boards' day, and the click lands on 11U 2027.
   */
  const openLeaderFrom = async (search: string) => {
    const ELEVEN = "ag_11u_2027";
    const card: ClubCard = {
      team: { id: "L-11", name: "Placeholder Elevens", state: "OH" },
      games: [
        {
          id: "e1",
          teamAId: "L-11",
          teamBId: "E-2",
          ageGroupId: ELEVEN,
          teamAScore: 5,
          teamBScore: 1,
          date: "2027-03-20",
        },
        {
          id: "e2",
          teamAId: "E-2",
          teamBId: "L-11",
          ageGroupId: ELEVEN,
          teamAScore: 0,
          teamBScore: 4,
          date: "2027-03-27",
        },
      ],
      names: { "E-2": "Placeholder E-2" },
      age: { level: 11 },
    };
    const board = {
      rows: [
        row("L-11", 1, { state: "OH", teamName: "Placeholder Elevens", record: "2-0" }),
        row("E-2", 2, { state: "OH" }),
      ],
    };
    await publish(
      live,
      [
        { key: `board:2027:${PAGE}:spring`, value: SPRING },
        { key: `board:2027:${PAGE}:fall`, value: FALL },
        { key: `board:2027:${PAGE}:year`, value: SPRING },
        { key: `board:2027:${ELEVEN}:spring`, value: board },
        { key: `board:2027:${ELEVEN}:fall`, value: board },
        { key: `board:2027:${ELEVEN}:year`, value: board },
        {
          key: clubKey(2027, clubBucketOf("L-11")),
          value: { clubs: { "L-11": encodeClubCard(card) } },
        },
      ],
      {
        pulledAt: T,
        halves: { [PAGE]: { fall: 10, spring: 20 }, [ELEVEN]: { fall: 10, spring: 20 } },
      }
    );
    const LOOKED = {
      kind: "health.inspect",
      health: {
        games: 9,
        played: 9,
        teams: 3,
        clubs: 3,
        nameOnly: 0,
        placeholders: 0,
        standInGames: 0,
        standInPlayed: 0,
        undated: 0,
        futureDated: 0,
        tidied: true,
      },
      settleable: 0,
      lists: { toPull: [], duplicates: [], twins: [], twice: [], wrongAge: [] },
      toPullCount: 0,
      fewOutside: {
        leaders: [
          {
            teamId: "L-11",
            name: "Placeholder Elevens",
            pageId: ELEVEN,
            page: "11U 2027",
            year: 2027,
            segment: "spring",
            state: "OH",
            stateRank: 1,
            rank: 1,
            record: "2-0",
            group: 0,
            opponents: [],
          },
        ],
        groups: [
          {
            sides: 2,
            pulled: 2,
            byHand: 0,
            nameOnly: 0,
            slots: 0,
            outside: 0,
            toFind: [],
            byHandSides: [],
          },
        ],
      },
    };
    // The day after the boards' day, before the night's rebuild has published the next.
    vi.setSystemTime(new Date("2027-04-16T00:30:00"));
    window.history.replaceState(null, "", search);
    pool.wants = false;
    const server = editFunction((data) => {
      const query = data.query as { kind?: string } | undefined;
      if (query?.kind === "health.inspect") return answered(LOOKED);
      return setupAnswers(data);
    });
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByRole("button", { name: "Check the pool" }));
    const listed = await screen.findByRole("list", { name: "Leaders with few outside games" });
    expect(server.sent).toContainEqual({
      query: { kind: "health.inspect", today: "2027-04-16", boardDay: TODAY },
      copy: MANIFEST.copy,
    });
    fireEvent.click(within(listed).getByRole("button", { name: "Placeholder Elevens" }));
    await waitFor(() => expect(window.location.search).toContain("age=11"));
    expect(window.location.search).toContain("year=2027");
    const panel = await screen.findByRole("region", { name: "Placeholder Elevens" });
    await waitFor(() => expect(panel).toHaveTextContent(/in 11U 2027/));
  };

  it("opens a leader with few outside games on its own page, the list asked for the boards' day", async () => {
    await openLeaderFrom("/?view=rankings&age=12&year=2027&section=setup");
    // The page opened on the half the list was read off, so none is written in.
    expect(window.location.search).not.toContain("half=");
  });

  // Over a URL pinned to the other half, the club would open against a board it was not listed from.
  it("opens a leader on the half its row was read off, over a half the URL pins", async () => {
    await openLeaderFrom("/?view=rankings&age=12&year=2027&half=fall&section=setup");
    expect(window.location.search).toContain("half=spring");
  });

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
    // The Archive card's years, asked once beside it (`LiveArchiveCard`).
    expect(asked(server.sent)).toEqual(["ageless.queue", "health.summary", "year.list"]);
    // Deleted at once, and what the pool then shows asked for again.
    fireEvent.click(screen.getByRole("button", { name: "Delete club" }));
    await waitFor(() => expect(said.toasts).toContain("Deleted Placeholder S-1."));
    expect(edited(server.sent)).toEqual([
      { command: { kind: "club.drop", teamId: "S-1" }, copy: MANIFEST.copy },
    ]);
    await waitFor(() =>
      expect(asked(server.sent)).toEqual([
        "ageless.queue",
        "health.summary",
        "health.summary",
        "year.list",
      ])
    );
    expect(handedOver()).toBeNull();
  });

  it("says Team Rankings was started again until the boards published reach the start", async () => {
    onSetup();
    pool.wants = false;
    const server = editFunction((data) =>
      (data.command as { kind?: string } | undefined)?.kind === "copy.reset"
        ? { ...made(5), stopped: { pulls: 1, nightly: false } }
        : setupAnswers(data)
    );
    open(sourcesOf(live, { call: server.call }));
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(screen.queryByText(STARTED_AGAIN_WAITING["copy.reset"])).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Team Rankings again" }));
    await waitFor(() =>
      expect(said.toasts).toContain(
        `${STARTED_AGAIN} 1 pull under way in the cloud was asked to stop, and files nothing more.`
      )
    );
    expect(said.asked).toContain("Start Team Rankings again?");
    // Said on the page, not only in a toast, while the boards still show the pool as it was.
    expect(await screen.findByText(STARTED_AGAIN_WAITING["copy.reset"])).toBeTruthy();
    // The board's own area says it too.
    fireEvent.click(screen.getByRole("tab", { name: "Rankings" }));
    expect(await screen.findByText(STARTED_AGAIN_WAITING["copy.reset"])).toBeTruthy();
    // Gone once the views of the start's version are published.
    await publish(live, undefined, undefined, 5);
    await waitFor(() => expect(screen.queryByText(STARTED_AGAIN_WAITING["copy.reset"])).toBeNull());
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

  it("offers no season to put on a page while the cloud's pages cannot be read", async () => {
    // Over boards an older version published, the meta's pages are not drawn, and the pages to
    // hand are this device's own, which it no longer keeps in step: a season put on one of them
    // would be put on a page the cloud may not have. The rest of Setup stays on.
    onSetup();
    pool.wants = false;
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA - 1 });
    const server = editFunction(setupAnswers);
    open(sourcesOf(live, { call: server.call }), { seasons: LEAGUE });
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(screen.getByText(SETUP_PAGES_UNREAD)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Put on / })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Age groups" })).toBeNull();
    expect(edited(server.sent)).toEqual([]);
  });

  it("offers no season to put on a page over a kept meta once the cloud says its boards are older", async () => {
    // A returning member's device keeps the meta it last read, which stays drawn while the cloud's
    // own answer says the boards are an older version's: its pages are as stale as no pages.
    onSetup();
    pool.wants = false;
    const earlier = editFunction(setupAnswers);
    open(sourcesOf(live, { call: earlier.call }), { seasons: LEAGUE });
    expect(await screen.findByRole("button", { name: /^Put on / })).toBeTruthy();
    cleanup();
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA - 1 });
    const server = editFunction(setupAnswers);
    open(sourcesOf(live, { call: server.call }), { seasons: LEAGUE });
    // Once the cloud has answered, which the teams waiting on an age, asked of it, show.
    expect(await screen.findByText("Placeholder Waiting")).toBeTruthy();
    expect(screen.getByText(SETUP_PAGES_UNREAD)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Put on / })).toBeNull();
    expect(edited(server.sent)).toEqual([]);
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
    expect(handedOver()).toBeNull();
  });

  it("shows the weekly re-measure the cloud keeps on the Model check card, before any press", async () => {
    onSetup();
    pool.wants = false;
    const server = editFunction(setupAnswers);
    // The member's reader of live/, with the record the nightly kept beside the views.
    const weekly = {
      format: 1,
      measuredOn: "2026-10-12",
      measuredAt: "2026-10-12T08:40:00.000Z",
      year: 2027,
      check: {
        held: -1.6,
        level: -1.7417,
        standardError: 0.1628,
        games: 79_981,
        clusters: 10_590,
        weeks: [{ from: "2026-10-05", to: "2026-10-11", games: 6_528, level: -1.7444 }],
        paired: { by: -0.000102, standardError: 0.000133, samples: 79_981 },
        better: false,
      },
    };
    open(
      sourcesOf(live, {
        call: server.call,
        reader: async () => ({ ...readerOf(live), readClosedLevel: async () => weekly }),
      })
    );
    expect(
      await screen.findByText(
        /^Last weekly re-measure, 12 Oct, on the 2027 squad year\. Starting level for leagues with few outside games: held at −1\.6; the four weeks to 11 Oct read −1\.74/
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check the model" })).toBeTruthy();
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

  it("downloads a backup made of the cloud's copy, and brings no pool in for it", async () => {
    onSetup();
    pool.wants = false;
    const cloud = memoryCloud();
    const saved = await commitChanges({
      store: cloud.store,
      base: null,
      changes: [{ key: "league_forecast_scout_teams_v1", value: [], at: 1 }],
      device: "phone",
      now: T,
    });
    if (!saved.ok) throw new Error("not saved");
    // The backup worker, which answers with the file it made of the pieces it was handed.
    const asked: BackupRequest[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: ((event: { data: BackupAnswer }) => void) | null = null;
        postMessage(request: BackupRequest) {
          asked.push(request);
          const answer: BackupAnswer = { ok: true, file: ['{"format":', "1}"] };
          queueMicrotask(() => this.onmessage?.({ data: answer }));
        }
        terminate() {}
      }
    );
    const files: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      files.push(this.download);
    });
    try {
      const server = editFunction(setupAnswers);
      open(sourcesOf(live, { call: server.call, copy: async () => cloud.store }));
      fireEvent.click(await screen.findByRole("button", { name: "Download a backup" }));
      await waitFor(() => expect(said.toasts).toContain("Backup downloaded (12 bytes)."));
      expect(files).toEqual([expect.stringMatching(/^Team_Rankings_Backup_.*\.json$/)]);
      expect(asked.map(({ want, parts }) => [want, parts.map(({ key }) => key)])).toEqual([
        ["file", ["league_forecast_scout_teams_v1"]],
      ]);
      expect(handedOver()).toBeNull();
      expect(pool.prepared).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

describe("the Archive tab on the cloud's board", () => {
  const SEASON: ArchivedSeason = {
    version: 2,
    id: "arch-12u-2026-spring",
    name: "12U 2026 Spring",
    ageLevel: 12,
    year: 2026,
    segment: "spring",
    archivedAt: "2026-08-01T00:00:00.000Z",
    fromGames: 40,
    fromTeams: 12,
    rows: [
      {
        rank: 1,
        teamName: "Placeholder Archived",
        rating: 4.5,
        record: "9-1-0",
        wins: 9,
        losses: 1,
        ties: 0,
        games: 10,
        strengthOfSchedule: 0.4,
        sosRank: 2,
        state: "OH",
        ageLevel: 12,
        crossAgeGames: 0,
      },
    ],
  };
  /** The cloud's copy, holding `values`, as the page reads it. */
  const copyHolding = async (values: Record<string, unknown>) => {
    const cloud = memoryCloud();
    const saved = await commitChanges({
      store: cloud.store,
      base: null,
      changes: Object.entries(values).map(([key, value]) => ({ key, value, at: 1 })),
      device: "phone",
      now: T,
    });
    if (!saved.ok) throw new Error("not saved");
    return cloud;
  };
  const onArchive = () =>
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=archive");
  afterEach(() => forgetDecodedArchive());

  it("lists the copy's finished seasons and opens one's table from the copy, and stays the page", async () => {
    const cloud = await copyHolding({
      [GC_ARCHIVE_KEY]: [
        {
          id: SEASON.id,
          name: SEASON.name,
          ageLevel: 12,
          year: 2026,
          segment: "spring",
          archivedAt: SEASON.archivedAt,
          fromGames: 40,
          fromTeams: 12,
          teams: 1,
        },
      ],
      [archiveRowsKey(SEASON.id)]: SEASON,
    });
    onArchive();
    pool.wants = false;
    open(sourcesOf(live, { copy: async () => cloud.store }));
    fireEvent.click(await screen.findByRole("button", { name: "12U 2026 Spring" }));
    expect(await screen.findByText("National top 25")).toBeTruthy();
    expect(screen.getAllByText("Placeholder Archived").length).toBeGreaterThan(0);
    expect(handedOver()).toBeNull();
  });

  it("says nothing is archived for a copy that never archived anything", async () => {
    const cloud = await copyHolding({ league_forecast_scout_age_groups_v1: [] });
    onArchive();
    pool.wants = false;
    open(sourcesOf(live, { copy: async () => cloud.store }));
    expect(await screen.findByText(/Nothing archived yet/)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("says when the copy cannot be read, and reads it again on asking", async () => {
    let reads = 0;
    open(
      sourcesOf(live, {
        copy: async () => {
          reads += 1;
          return null;
        },
      })
    );
    // The board first, so the meta is in before the tab reads the copy: a read that failed
    // before it is read again when it comes (below), which would race the button here.
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "Archive" }));
    expect(await screen.findByText(LIVE_UNREAD.archive)).toBeTruthy();
    expect(handedOver()).toBeNull();
    const asked = reads;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(LIVE_UNREAD.archive)).toBeTruthy();
    await waitFor(() => expect(reads).toBeGreaterThan(asked));
  });

  it("reads the copy again once the meta comes, when it could not be read before it", async () => {
    onArchive();
    let reads = 0;
    let letIn = (): void => undefined;
    const held = new Promise<void>((resolve) => (letIn = resolve));
    open(
      sourcesOf(live, {
        reader: async () => {
          await held;
          return readerOf(live);
        },
        copy: async () => {
          reads += 1;
          return null;
        },
      })
    );
    expect(await screen.findByText(LIVE_UNREAD.archive)).toBeTruthy();
    expect(reads).toBe(1);
    // The network's meta, come since: what failed before it is read again, as on a publish.
    letIn();
    await waitFor(() => expect(reads).toBe(2));
    expect(await screen.findByText(LIVE_UNREAD.archive)).toBeTruthy();
  });
});

describe("the Import tab on the cloud's board", () => {
  const STATUS = {
    kind: "import.status",
    due: {
      ageLevels: [9, 10],
      heldBack: 2,
      label: "Thursday",
      catchUp: false,
      cadence: "daily",
      agelessTotal: 0,
      teams: 120,
      agelessDue: 0,
    },
    refreshed: [
      { level: 9, day: "2027-04-14" },
      { level: 10, day: "2027-04-14" },
      { level: 11, day: "2027-04-15" },
    ],
    orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
    agelessIds: [],
    rosterIds: [],
  };
  /** The edit function's answer to the tab's question, and to an edit, which changes `changed`. */
  const importAnswers =
    (status: unknown = STATUS, changed?: string[]) =>
    (data: Record<string, unknown>) =>
      data.query ? answered(status as Record<string, unknown>) : made(5, changed);
  const queried = (sent: Array<Record<string, unknown>>) =>
    sent.filter((data) => data.query !== undefined);
  const onImport = () =>
    window.history.replaceState(null, "", "/?view=rankings&age=12&year=2027&section=import");
  /** This device's time, apart from the page's own clock, so a question is seen to carry it. */
  const AT = "2027-04-15T13:30:00.000Z";
  const HEADER =
    "Entity Type,Entity Name,Organization ID,City,State,Season Name,Season Year,Sport,Home URL,Teams URL,Schedule URL,Team Count,Team IDs,Found Via Searches,First Seen,Last Seen";
  const orgFile = (rows: string[], header = HEADER) =>
    new File([[header, ...rows].join("\n")], "GameChanger_Organizations.csv", {
      type: "text/csv",
    });

  it("draws the nightly refresh as the server works it out, asked at this device's time", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call, now: () => AT }));
    expect(
      await screen.findByText("Every age group is due today — 120 teams to refresh.")
    ).toBeTruthy();
    expect(screen.getByText(/2 teams pulled in the last 16 hours/)).toBeTruthy();
    // Each day's levels together, the latest day first.
    const days = screen.getByRole("heading", { name: "Last refreshed" }).nextElementSibling;
    expect([...(days?.querySelectorAll("li") ?? [])].map((day) => day.textContent)).toEqual([
      "2027-04-15: 11U",
      "2027-04-14: 9U, 10U",
    ]);
    expect(screen.getByLabelText("Every age group, daily")).toHaveProperty("checked", true);
    expect(screen.getByTestId("live-orgs").textContent).toMatch(/^The Organizations export/);
    expect(queried(server.sent)).toEqual([
      { query: { kind: "import.status", at: AT }, copy: MANIFEST.copy },
    ]);
    expect(handedOver()).toBeNull();
  });

  /*
   * Edits and imports go through the edit function and need no board: they are off only while the
   * device is offline or has not heard the cloud, and over boards a newer version published. A meta
   * this build cannot draw, older, missing or unreadable, locked them for a whole day on 10 October
   * 2026; now they are made on the copy that meta names, or the copy itself names where none does.
   */
  const choosesRotation = async (server: ReturnType<typeof editFunction>, copy: string) => {
    expect(
      await screen.findByText("Every age group is due today — 120 teams to refresh.")
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("One or two levels a day"));
    await waitFor(() => expect(edited(server.sent)).toHaveLength(1));
    expect(server.sent.length).toBeGreaterThan(1);
    expect(server.sent.every((data) => data.copy === copy)).toBe(true);
  };

  it("keeps edits on over boards an older version published, made on the copy they name", async () => {
    onImport();
    pool.wants = false;
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA - 1 });
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call }));
    await choosesRotation(server, MANIFEST.copy);
    expect(screen.queryByText(EDIT_LOCKS.waiting)).toBeNull();
  });

  it("keeps edits on over a meta whose pages will not read, made on the copy it names", async () => {
    onImport();
    pool.wants = false;
    live.setMeta({ ...live.meta(), inline: { pages: { halves: [] } } });
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call }));
    await choosesRotation(server, MANIFEST.copy);
  });

  it("keeps edits on with nothing published, made on the copy the cloud holds", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction(importAnswers());
    const held = { ...MANIFEST, copy: "beef01", version: 9 };
    open(
      sourcesOf(memoryLive(), {
        call: server.call,
        copy: async () => ({ readManifest: async () => held, getChunk: async () => null }),
      })
    );
    await choosesRotation(server, "beef01");
  });

  it("makes edits on the copy a publish names, not the one read while nothing was published", async () => {
    onImport();
    pool.wants = false;
    const empty = memoryLive();
    let answer = (): void => undefined;
    const slow = new Promise<void>((resolve) => (answer = resolve));
    const held = { ...MANIFEST, copy: "beef01", version: 9 };
    const server = editFunction(importAnswers());
    open(
      sourcesOf(empty, {
        call: server.call,
        copy: async () => ({
          readManifest: async () => {
            await slow;
            return held;
          },
          getChunk: async () => null,
        }),
      })
    );
    expect(await screen.findByText(EDIT_LOCKS.waiting)).toBeTruthy();
    // Published, and heard, while the copy's manifest was still being read.
    await act(() => publish(empty));
    answer();
    await choosesRotation(server, MANIFEST.copy);
  });

  /*
   * With nothing published and no copy of the cloud's own to be read, the cloud has answered but
   * there is nothing to make an edit on: the page says so, rather than lifting the lock and turning
   * every edit and question away one toast at a time.
   */
  it("keeps edits off, and says why, when nothing published names a copy and the cloud's cannot be read", async () => {
    onImport();
    pool.wants = false;
    const unreadable = [
      {},
      { copy: async () => ({ readManifest: async () => null, getChunk: async () => null }) },
      {
        copy: async () => ({
          readManifest: () => Promise.reject(new Error("permission-denied")),
          getChunk: async () => null,
        }),
      },
    ];
    for (const more of unreadable) {
      const server = editFunction(importAnswers());
      open(sourcesOf(memoryLive(), { call: server.call, ...more }));
      expect(await screen.findByText(EDIT_LOCKS.noCopy)).toBeTruthy();
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(server.sent).toEqual([]);
      expect(said.toasts).toEqual([]);
      cleanup();
    }
  });

  it("makes nothing on the copy a meta kept from an earlier visit names, once the cloud says none is published", async () => {
    onImport();
    pool.wants = false;
    const earlier = editFunction(importAnswers());
    open(sourcesOf(live, { call: earlier.call }));
    await waitFor(() => expect(queried(earlier.sent)).toHaveLength(1));
    cleanup();
    // The kept meta names the copy; the server now says nothing is published, and the copy itself
    // cannot be read here.
    const server = editFunction(importAnswers());
    open(sourcesOf(memoryLive(), { call: server.call }));
    expect(await screen.findByText(EDIT_LOCKS.noCopy)).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(server.sent).toEqual([]);
  });

  it("keeps edits off over boards a newer version published, and says to reload", async () => {
    onImport();
    pool.wants = false;
    live.setMeta({ ...live.meta(), schema: LIVE_SCHEMA + 1 });
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call }));
    expect(await screen.findByText(EDIT_LOCKS.newer)).toBeTruthy();
    expect(server.sent).toEqual([]);
  });

  it("keeps edits off until the cloud has answered", async () => {
    onImport();
    pool.wants = false;
    const silent: LiveReader = {
      readMeta: () => new Promise(() => undefined),
      getChunk: () => new Promise(() => undefined),
    };
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call, reader: async () => silent }));
    expect(await screen.findByText(EDIT_LOCKS.waiting)).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(server.sent).toEqual([]);
  });

  it("keeps how much comes round at once on the copy, and reads the refresh again", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByLabelText("One or two levels a day"));
    await waitFor(() =>
      expect(said.toasts).toContain("The nightly refresh now pulls one or two levels a day.")
    );
    expect(edited(server.sent)).toEqual([
      { command: { kind: "refresh.cadence", cadence: "rotation" }, copy: MANIFEST.copy },
    ]);
    await waitFor(() => expect(queried(server.sent)).toHaveLength(2));
  });

  it("shows the cadence chosen until the refresh is read again, and still when that read fails", async () => {
    onImport();
    pool.wants = false;
    // The refresh is read once; the read after the edit fails.
    let reads = 0;
    const server = editFunction((data) => {
      if (!data.query) return made(5, ["league_forecast_gc_refresh_v1"]);
      reads += 1;
      return reads === 1 ? answered(STATUS) : { ok: false, why: "store-refused" };
    });
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByLabelText("One or two levels a day"));
    await waitFor(() => expect(queried(server.sent)).toHaveLength(2));
    await waitFor(() =>
      expect(said.toasts).toContain("The cloud would not answer just now. Try again in a minute.")
    );
    expect(screen.getByLabelText("One or two levels a day")).toHaveProperty("checked", true);
    // Nothing on its way: the choice is open again, the fieldset around it included.
    expect(screen.getByLabelText("One or two levels a day")).not.toBeDisabled();
  });

  it("keeps the cadence chosen through a refresh read while its edit is on its way", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction(importAnswers(STATUS, ["league_forecast_gc_org_membership_v1"]));
    // The cadence's edit waits until let go; everything else is answered at once.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const call = {
      ...server.call,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(init?.body).includes("refresh.cadence")) await held;
        return server.call.fetchImpl(url, init);
      }) as typeof fetch,
    };
    open(sourcesOf(live, { call, now: () => AT }));
    fireEvent.click(await screen.findByLabelText("One or two levels a day"));
    // An Organizations file kept meanwhile reads the refresh again, from before the cadence.
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText("Organizations CSV"),
      orgFile([
        `"travel","Placeholder 8U Fall 2026","orgPH0000001","Sampleton","TN","fall","2026","baseball","","","","2","Placeholder01; Placeholder02","x","",""`,
      ])
    );
    await waitFor(() => expect(queried(server.sent)).toHaveLength(2));
    expect(screen.getByLabelText("One or two levels a day")).toHaveProperty("checked", true);
    release();
    await waitFor(() => expect(queried(server.sent)).toHaveLength(3));
  });

  it("says why the refresh is not read with no reader of the cloud, and stays the page", async () => {
    onImport();
    pool.wants = false;
    open(sourcesOf(null));
    expect(await screen.findByText(EDIT_LOCKS.unlinked)).toBeTruthy();
    expect(handedOver()).toBeNull();
  });

  it("puts the cadence back when the edit was not made", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction((data) =>
      data.query ? answered(STATUS) : { ok: false, why: "unsaved" }
    );
    open(sourcesOf(live, { call: server.call }));
    fireEvent.click(await screen.findByLabelText("One or two levels a day"));
    await waitFor(() => expect(edited(server.sent)).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByLabelText("Every age group, daily")).toHaveProperty("checked", true)
    );
  });

  it("keeps an Organizations file's organizations on the copy, and says when it had nothing new", async () => {
    onImport();
    pool.wants = false;
    let changed: string[] = ["league_forecast_gc_org_membership_v1"];
    const server = editFunction((data) => importAnswers(STATUS, changed)(data));
    open(sourcesOf(live, { call: server.call, now: () => AT }));
    const user = userEvent.setup();
    const file = orgFile([
      `"travel","Placeholder 8U Fall 2026","orgPH0000001","Sampleton","TN","fall","2026","baseball","","","","2","Placeholder01; Placeholder02","x","",""`,
    ]);
    await user.upload(await screen.findByLabelText("Organizations CSV"), file);
    await waitFor(() => expect(said.toasts).toContain("Kept the 1 organization in that file."));
    expect(edited(server.sent)).toEqual([
      {
        command: {
          kind: "orgs.merge",
          orgs: [
            {
              orgId: "orgPH0000001",
              name: "Placeholder 8U Fall 2026",
              teamIds: ["Placeholder01", "Placeholder02"],
            },
          ],
          at: AT,
        },
        copy: MANIFEST.copy,
      },
    ]);
    await waitFor(() => expect(queried(server.sent)).toHaveLength(2));
    // The same file again: the copy held it already.
    changed = [];
    await user.upload(screen.getByLabelText("Organizations CSV"), file);
    await waitFor(() => expect(said.toasts).toContain(ORGS_NOTHING_NEW));
  });

  it("sends nothing for a file that names no teams under its organizations", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call }));
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Organizations CSV"),
      orgFile(
        ['"travel","Placeholder 8U Fall 2026","orgPH0000001"'],
        "Entity Type,Entity Name,Organization ID"
      )
    );
    await waitFor(() => expect(said.toasts).toContain(ORGS_NO_TEAMS));
    expect(edited(server.sent)).toEqual([]);
  });

  it("says a file's organizations have no names, rather than no teams, when they have teams", async () => {
    onImport();
    pool.wants = false;
    const server = editFunction(importAnswers());
    open(sourcesOf(live, { call: server.call }));
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("Organizations CSV"),
      orgFile([
        `"travel","","orgPH0000001","Sampleton","TN","fall","2026","baseball","","","","2","Placeholder01; Placeholder02","x","",""`,
      ])
    );
    await waitFor(() => expect(said.toasts).toContain(ORGS_NO_NAMES));
    expect(edited(server.sent)).toEqual([]);
  });

  it("says the refresh could not be read, and asks again when told to", async () => {
    onImport();
    pool.wants = false;
    let refused = true;
    const server = editFunction((data) =>
      refused && data.query ? { ok: false, why: "kept-moving" } : importAnswers()(data)
    );
    open(sourcesOf(live, { call: server.call }));
    expect(
      await screen.findByText("Reconnecting to the cloud. Status checks will retry automatically.")
    ).toBeTruthy();
    refused = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Every age group is due today — 120 teams to refresh.")
    ).toBeTruthy();
  });
});

/*
 * What each game did, on a club's panel on the cloud's board: a small pool built, published and read
 * back as a server and a member's device do it (`buildBoardsAndFacts`, `boardViews`, `clubViews`),
 * the lines worked out from the card as published and the board on screen, and drawn only where
 * they add up to the board's own row. Placeholder names throughout.
 */
describe("what each game did, on a club's panel on the cloud's board", () => {
  const pulled = (n: number): ScoutTeam => ({
    id: `S-${n}`,
    name: `Placeholder S-${n}`,
    state: "OH",
    gcTeams: [
      { teamId: `gcS-${n}`, name: `Placeholder S-${n} 12U`, ageGroupId: PAGE, ageLevel: 12 },
    ],
  });
  const TEAMS = [1, 2, 3, 4, 5, 6].map(pulled);
  /** A game as the schedule of club `listedBy` (side A's unless said) gave it. */
  const played = (
    id: string,
    a: number,
    b: number,
    scores: [number, number] | null,
    date: string,
    { listedBy = a, ...more }: Partial<ScoutGame> & { listedBy?: number } = {}
  ): ScoutGame => ({
    id,
    ageGroupId: PAGE,
    teamAId: `S-${a}`,
    teamBId: `S-${b}`,
    ...(scores ? { teamAScore: scores[0], teamBScore: scores[1] } : {}),
    date,
    source: { kind: "gamechanger", teamId: `gcS-${listedBy}`, gameId: id },
    ...more,
  });
  const GAMES: ScoutGame[] = [
    // The autumn: S-1 beats S-2 and S-4 and loses to S-3; a rout set not to count, and a game
    // against its own name.
    played("f1", 1, 2, [7, 3], "2026-09-12"),
    played("f2", 3, 1, [5, 4], "2026-09-19", { listedBy: 1 }),
    played("f3", 2, 3, [6, 2], "2026-09-26"),
    played("f4", 4, 5, [8, 1], "2026-10-03"),
    played("f5", 5, 6, [2, 2], "2026-10-10"),
    played("f6", 6, 4, [9, 3], "2026-10-17"),
    played("f7", 1, 4, [3, 1], "2026-10-24"),
    played("f8", 2, 5, [4, 6], "2026-10-31"),
    played("f9", 1, 6, [15, 0], "2026-11-07", { excluded: true }),
    played("f10", 1, 1, [3, 2], "2026-11-14"),
    played("f11", 3, 6, [1, 4], "2026-11-21"),
    // The spring: a win, a tie, a win S-1 has only by the name S-4's schedule wrote, and a game
    // still to come.
    played("s1", 1, 5, [6, 2], "2027-03-06"),
    played("s2", 2, 1, [5, 5], "2027-03-13", { listedBy: 1 }),
    played("s3", 3, 4, [4, 3], "2027-03-20"),
    played("s4", 6, 2, [7, 1], "2027-03-27"),
    played("s5", 4, 1, [2, 6], "2027-04-03"),
    played("s6", 5, 6, [3, 1], "2027-04-10"),
    played("s7", 3, 5, [2, 9], "2027-04-11"),
    played("s8", 1, 3, null, "2027-05-01"),
    // S-2's three spring games are each listed by its opponent's schedule alone.
    played("s9", 2, 4, [8, 3], "2027-04-12", { listedBy: 4 }),
  ];
  const built = () =>
    buildBoardsAndFacts({
      autoRemoved: NO_REMOVALS,
      ageGroups: GROUPS,
      teams: TEAMS,
      gamesOfYear: (year) => (year === 2027 ? GAMES : []),
      readSeason: () => ({ teams: [], matchups: [], logs: {} }),
      today: TODAY,
      past: false,
    });
  const BUILT = built();
  const VIEWS: PublishedView[] = [
    ...boardViews(GROUPS, BUILT),
    ...clubViews({ ageGroups: GROUPS, built: BUILT, namedAges: new Map() }),
  ];
  /** The pool's views published, each board changed by `board` first where it is given. */
  const publishPool = (board: (view: BoardView) => BoardView = (view) => view) =>
    publish(
      live,
      VIEWS.map((view) =>
        view.key.startsWith("board:") ? { ...view, value: board(view.value as BoardView) } : view
      ),
      livePagesOf(BUILT, T, GROUPS)
    );

  /** What the panel should say of club `teamId` on the board of `half`, worked out as a device does. */
  const notesOf = (teamId: string, half: "fall" | "spring", span: string, own: boolean) => {
    const value = VIEWS.find((view) => view.key === `board:2027:${PAGE}:${half}`)?.value;
    const view = coerceBoardView(JSON.parse(JSON.stringify(value)));
    const bucket = VIEWS.find((one) => one.key === clubKey(2027, clubBucketOf(teamId)))?.value;
    const card = coerceClubBucket(JSON.parse(JSON.stringify(bucket)))?.clubs[teamId];
    if (!view?.fit || !card) throw new Error(`no board or card for ${teamId}`);
    const breakdown = gameBreakdown({
      teamId,
      games: card.games,
      pageId: PAGE,
      ageGroups: GROUPS,
      segment: half,
      board: view,
    });
    if (!breakdown) throw new Error(`no lines for ${teamId} on ${half}`);
    const notes = gameNotesOf(breakdown, { span, own, cap: view.fit.cap });
    // Each line by its game's day, which no two of a club's games here share.
    const byDay = new Map(
      [...notes.byGame].map(([id, clauses]) => [
        card.games.find((game) => game.id === id)?.date,
        clauses.join("\u00a0· "),
      ])
    );
    return { headline: `${notes.headline} ${notes.key}`, byDay };
  };

  const tap = async (name: string) =>
    fireEvent.click((await screen.findAllByRole("button", { name }))[0]!);
  /** Each row of the panel's games, by its day, with the line under it if it has one. */
  const linesOf = (panel: HTMLElement) =>
    new Map(
      within(panel)
        .getAllByRole("listitem")
        .map((item) => [
          item.textContent?.match(/\d{4}-\d{2}-\d{2}/)?.[0],
          item.querySelector("p")?.textContent ?? null,
        ])
    );
  /** The panel's markup with its lines taken out and React's generated ids made alike. */
  const bareMarkup = (panel: HTMLElement) => {
    const copy = panel.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("li > p").forEach((line) => line.remove());
    [...copy.querySelectorAll("p")]
      .find((one) => /rating .*Played like:/.test(one.textContent ?? ""))
      ?.remove();
    return copy.innerHTML.replace(/_r_[0-9a-z]+_/g, "_id_");
  };

  it("says under each counted game what it did, as its club's or the page's own", async () => {
    await publishPool();
    open(sourcesOf(live));
    await tap("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    const spring = notesOf("S-1", "spring", "Spring 2027", false);
    expect(await within(panel).findByText(/^Spring 2027 rating /)).toHaveTextContent(
      spring.headline
    );
    expect(spring.headline).toMatch(/^Spring 2027 rating [+-]?\d+\.\d[:,] .*its games/);
    // The spring's win, tie and the win it has by a name alone; nothing on a game still to come
    // or on the autumn's games, outside the half on screen.
    expect([...spring.byDay.keys()].sort()).toEqual(["2027-03-06", "2027-03-13", "2027-04-03"]);
    const lines = linesOf(panel);
    expect(lines.get("2027-03-06")).toMatch(
      /^Played like [+-]?\d+\.\d\u00a0· moved its rating ([+-]\d+\.\d|less than 0\.1)/
    );
    for (const [day, line] of lines) expect(line, day).toBe(spring.byDay.get(day) ?? null);
    expect(lines.get("2027-05-01")).toBeNull();
    expect(lines.get("2026-09-12")).toBeNull();

    // The page's own club reads "your".
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await tap("Placeholder S-2");
    const mine = await screen.findByRole("region", { name: "Placeholder S-2" });
    const own = notesOf("S-2", "spring", "Spring 2027", true);
    expect(await within(mine).findByText(/^Spring 2027 rating /)).toHaveTextContent(own.headline);
    expect(own.headline).toMatch(/your games/);
    const ownLines = [...linesOf(mine).values()].filter((line) => line !== null);
    expect(ownLines.length).toBeGreaterThan(0);
    for (const line of ownLines) expect(line).toMatch(/moved your rating/);
    expect(handedOver()).toBeNull();
  });

  it("draws the lines of the half moved to, and none on a game set not to count or against itself", async () => {
    await publishPool();
    open(sourcesOf(live));
    await tap("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(await within(panel).findByText(/^Spring 2027 rating /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    const fall = notesOf("S-1", "fall", "Fall 2026", false);
    expect(await within(panel).findByText(/^Fall 2026 rating /)).toHaveTextContent(fall.headline);
    expect([...fall.byDay.keys()].sort()).toEqual(["2026-09-12", "2026-09-19", "2026-10-24"]);
    const lines = linesOf(panel);
    for (const [day, line] of lines) expect(line, day).toBe(fall.byDay.get(day) ?? null);
    // The rout set not to count, the game against its own name and the spring's games: none.
    for (const day of ["2026-11-07", "2026-11-14", "2027-03-06", "2027-04-03", "2027-05-01"])
      expect(lines.get(day), day).toBeNull();
  });

  it("draws no lines, and changes nothing else, from a board with no fit or a row that does not add up", async () => {
    await publishPool();
    open(sourcesOf(live));
    await tap("Placeholder S-1");
    const drawn = await screen.findByRole("region", { name: "Placeholder S-1" });
    await within(drawn).findByText(/^Spring 2027 rating /);
    const bare = bareMarkup(drawn);
    cleanup();

    const nudged = (view: BoardView): BoardView => ({
      ...view,
      rows: view.rows.map((one) =>
        one.teamId === "S-1" ? { ...one, pointRating: one.pointRating + 0.01 } : one
      ),
    });
    const unfitted = ({ fit: _fit, ...view }: BoardView): BoardView => view;
    for (const board of [unfitted, nudged]) {
      kept.clear();
      forgetDecodedBoards();
      forgetDecodedClubs();
      live = memoryLive();
      await publishPool(board);
      open(sourcesOf(live));
      await tap("Placeholder S-1");
      const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
      // The card is drawn, and with it whatever lines there were to draw.
      expect(await within(panel).findByText(/from 3 games\./)).toBeTruthy();
      expect(within(panel).queryByText(/rating .*Played like:/)).toBeNull();
      expect(panel.querySelectorAll("li > p")).toHaveLength(0);
      expect(panel.innerHTML.replace(/_r_[0-9a-z]+_/g, "_id_")).toBe(bare);
      cleanup();
    }
  });

  /*
   * A page with no squad year has no halves: it opens on the board of its whole year, keyed "year",
   * and its rating is the season's. The same pool, filed on such a page.
   */
  it("draws the lines of the whole year's board, named the season's, on a page with no year", async () => {
    const NONE = "ag_12u";
    const noYear: AgeGroup[] = [
      { id: NONE, name: "12U", ageLevel: 12, seasonIds: [], myTeamId: "S-2" },
    ];
    const teams = TEAMS.map((team) => ({
      ...team,
      gcTeams: team.gcTeams?.map((link) => ({ ...link, ageGroupId: NONE })),
    }));
    const games = GAMES.map((game) => ({ ...game, ageGroupId: NONE }));
    const builtNone = buildBoardsAndFacts({
      autoRemoved: NO_REMOVALS,
      ageGroups: noYear,
      teams,
      gamesOfYear: (year) => (year === undefined ? games : []),
      readSeason: () => ({ teams: [], matchups: [], logs: {} }),
      today: TODAY,
      past: false,
    });
    const views = [
      ...boardViews(noYear, builtNone),
      ...clubViews({ ageGroups: noYear, built: builtNone, namedAges: new Map() }),
    ];
    const value = views.find((view) => view.key === `board:none:${NONE}:year`)?.value;
    const board = coerceBoardView(JSON.parse(JSON.stringify(value)));
    const bucket = views.find(
      (view) => view.key === clubKey(undefined, clubBucketOf("S-1"))
    )?.value;
    const card = coerceClubBucket(JSON.parse(JSON.stringify(bucket)))?.clubs["S-1"];
    if (!board?.fit || !card) throw new Error("no year board or card for S-1");
    const breakdown = gameBreakdown({
      teamId: "S-1",
      games: card.games,
      pageId: NONE,
      ageGroups: noYear,
      segment: undefined,
      board,
    });
    if (!breakdown) throw new Error("no lines for S-1 on the year's board");
    const notes = gameNotesOf(breakdown, { span: "Season", own: false, cap: board.fit.cap });
    const byDay = new Map(
      [...notes.byGame].map(([id, clauses]) => [
        card.games.find((game) => game.id === id)?.date,
        clauses.join("\u00a0· "),
      ])
    );
    // Both halves' counted games, and none still to come, set not to count or against itself.
    expect([...byDay.keys()].sort()).toEqual([
      "2026-09-12",
      "2026-09-19",
      "2026-10-24",
      "2027-03-06",
      "2027-03-13",
      "2027-04-03",
    ]);

    saveAgeGroups(noYear);
    window.history.replaceState(null, "", "/?view=rankings&age=12");
    await publish(live, views, livePagesOf(builtNone, T, noYear));
    open(sourcesOf(live));
    await tap("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    expect(await within(panel).findByText(/^Season rating /)).toHaveTextContent(
      `${notes.headline} ${notes.key}`
    );
    const lines = linesOf(panel);
    for (const [day, line] of lines) expect(line, day).toBe(byDay.get(day) ?? null);
    expect([...lines.values()].filter((line) => line !== null)).toHaveLength(6);
  });

  it("takes the line above the list off too once pending edits leave no row with a line", async () => {
    await publishPool();
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : made(5, ["league_forecast_scout_games_v2:2027", "league_forecast_scout_teams_v1"])
    );
    open(sourcesOf(live, { call: server.call }));
    await tap("Placeholder S-2");
    const panel = await screen.findByRole("region", { name: "Placeholder S-2" });
    await within(panel).findByText(/^Spring 2027 rating /);
    const lined = [...linesOf(panel)].flatMap(([day, line]) => (day && line !== null ? [day] : []));
    expect(lined.sort()).toEqual(["2027-03-13", "2027-03-27", "2027-04-12"]);
    // Each of them is S-2's by another club's schedule alone, so each can be taken off.
    for (const day of lined) {
      const offered = within(panel)
        .getAllByRole("button", { name: /^Not this team/ })
        .find((button) => button.closest("li")?.textContent?.includes(day));
      if (!offered) throw new Error(`no Not this team on ${day}`);
      fireEvent.click(offered);
      await waitFor(() => expect(linesOf(panel).has(day)).toBe(false));
    }
    // The lines are still in hand, worked out from the card as published, but no row carries one,
    // so neither the line above the list nor its key is drawn.
    expect(panel.querySelectorAll("li > p")).toHaveLength(0);
    expect(within(panel).queryByText(/rating .*Played like:/)).toBeNull();
  });

  it("takes off only the line of a game a pending Not this team takes off", async () => {
    await publishPool();
    const server = editFunction((data) =>
      data.warm
        ? WARMED
        : made(5, ["league_forecast_scout_games_v2:2027", "league_forecast_scout_teams_v1"])
    );
    open(sourcesOf(live, { call: server.call }));
    await tap("Placeholder S-1");
    const panel = await screen.findByRole("region", { name: "Placeholder S-1" });
    const headline = await within(panel).findByText(/^Spring 2027 rating /);
    const before = linesOf(panel);
    expect(before.get("2027-04-03")).not.toBeNull();
    const offered = within(panel).getAllByRole("button", { name: /^Not this team/ });
    expect(offered).toHaveLength(1);
    expect(offered[0]!.closest("li")).toHaveTextContent("2027-04-03");
    fireEvent.click(offered[0]!);
    await waitFor(() => expect(linesOf(panel).has("2027-04-03")).toBe(false));
    const after = linesOf(panel);
    // Every other row as it was, its line with it: the lines explain the board, which is from
    // before the edit too.
    expect([...after]).toEqual([...before].filter(([day]) => day !== "2027-04-03"));
    expect(within(panel).getByText(/^Spring 2027 rating /).textContent).toBe(headline.textContent);
  });
});

/*
 * A phone opening the page gives the board its network and main thread first (`openingHold.ts`),
 * and opens on this device's own copy only once that is read in (`poolFill.ts`).
 */
describe("what waits for the board's first draw", () => {
  beforeEach(() => resetOpeningHold());
  afterEach(() => {
    releaseOpening();
    resetPoolFill();
  });

  it("loads the page's code, reads its own club's card and watches the meta once it is drawn", async () => {
    await publish(live, [
      { key: `board:2027:${PAGE}:spring`, value: SPRING },
      { key: `board:2027:${PAGE}:fall`, value: FALL },
      { key: `board:2027:${PAGE}:year`, value: SPRING },
      {
        key: clubKey(2027, clubBucketOf("S-2")),
        value: {
          clubs: {
            "S-2": encodeClubCard({
              team: { id: "S-2", name: "Placeholder S-2" },
              games: [],
              names: {},
            }),
          },
        },
      },
    ]);
    const board = live.meta()?.views[`board:2027:${PAGE}:spring`];
    const bucket = live.meta()?.views[clubKey(2027, clubBucketOf("S-2"))];
    if (!board || !bucket) throw new Error("nothing published");
    const reader = readerOf(live);
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    const asked: string[] = [];
    const watchMeta = vi.fn(live.watchMeta);
    const slow: LiveReader = {
      ...reader,
      watchMeta,
      getChunk: async (id) => {
        asked.push(id);
        if (id.startsWith(board.id)) await released;
        return reader.getChunk(id);
      },
    };
    const preloadPage = vi.fn(() => Promise.resolve());
    render(
      <LiveTeamRankings
        status={{ kind: "connecting" }}
        renderPage={page}
        preloadPage={preloadPage}
        sources={sourcesOf(live, { reader: async () => slow })}
        seasons={[]}
        showToast={showToast}
        confirm={confirm}
      />
    );
    await waitFor(() => expect(asked.some((id) => id.startsWith(board.id))).toBe(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(preloadPage).not.toHaveBeenCalled();
    expect(watchMeta).not.toHaveBeenCalled();
    expect(asked.some((id) => id.startsWith(bucket.id))).toBe(false);
    release();
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    await waitFor(() => expect(preloadPage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(watchMeta).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(asked.some((id) => id.startsWith(bucket.id))).toBe(true));
  });

  it("opens on this device's copy only once the device's store is read in", async () => {
    let readIn = (): void => undefined;
    startPoolFill(
      () =>
        new Promise<void>((resolve) => {
          readIn = resolve;
        })
    );
    const refusing: LiveReader = {
      readMeta: () => Promise.reject({ code: "permission-denied" }),
      getChunk: () => Promise.reject({ code: "permission-denied" }),
    };
    open(sourcesOf(live, { reader: async () => refusing }));
    await waitFor(() => expect(pool.prepared).toBe(1));
    await act(async () => pool.finish());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(handedOver()).toBeNull();
    expect(screen.getByText("This opens on this device's copy as soon as it is in…")).toBeTruthy();
    await act(async () => readIn());
    await waitFor(() => expect(handedOver()).not.toBeNull());
  });

  it("lays the page out by this device's own pages once its store is in, under a meta naming none", async () => {
    // A member's pool moved into IndexedDB: localStorage holds none of it, the store all of it,
    // read after the page; and the cloud's meta, an older build's, names no pages of its own.
    resetTeamRankingsStore();
    window.localStorage.clear();
    let letGo = (): void => undefined;
    const gate = new Promise<void>((resolve) => (letGo = resolve));
    const store = new Map<string, unknown>([["league_forecast_scout_age_groups_v1", GROUPS]]);
    const io: PoolStoreIo = {
      keys: async () => [...store.keys()],
      get: async (key) => {
        await gate;
        return store.get(key) ?? null;
      },
      set: async (key, value) => {
        store.set(key, value);
        return true;
      },
      readLocal: () => null,
      clearLocal: () => undefined,
    };
    // Its read waiting for a first draw that, with no pages, would not come.
    startPoolFill(() => initTeamRankingsStore(io), new Promise(() => undefined));
    expect(live.meta()?.inline.pages).not.toHaveProperty("groups");
    open(sourcesOf(live));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // Not said to have no pages while its own are still being read.
    expect(screen.queryByText(LIVE_NOTICES.noPages)).toBeNull();
    letGo();
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(screen.queryByText(LIVE_NOTICES.noPages)).toBeNull();
  });
});

/*
 * The state the State top 10 opens on, kept on this device. The spring board's own club is from
 * Ohio, so it opens on Ohio by itself, and Kentucky has a club on it; Texas has one only on the
 * fall board.
 */
describe("a default state on the cloud's board", () => {
  const topState = () =>
    (screen.getByRole("combobox", { name: "State" }) as HTMLSelectElement).value;

  it("is kept when made, and opens there the next time", async () => {
    const first = open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(topState()).toBe("OH");
    // A pick during the visit is only that.
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), { target: { value: "KY" } });
    expect(topState()).toBe("KY");
    expect(readDefaultState()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Make KY my default state" }));
    expect(readDefaultState()).toBe("KY");
    expect(screen.getByText("Opens on KY")).toBeTruthy();
    first.unmount();

    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(topState()).toBe("KY");
    expect(screen.getByRole("button", { name: "Clear KY as the default state" })).toBeTruthy();
  });

  it("opens on the page's own club's state where the board has no club from the kept one", async () => {
    writeDefaultState("TX");
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(topState()).toBe("OH");
    expect(screen.getByRole("button", { name: "Make OH my default state" })).toBeTruthy();
    expect(readDefaultState()).toBe("TX");
  });

  it("is forgotten by Clear, and the card opens as it would with none", async () => {
    writeDefaultState("KY");
    const first = open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(topState()).toBe("KY");
    fireEvent.click(screen.getByRole("button", { name: "Clear KY as the default state" }));
    expect(readDefaultState()).toBeNull();
    expect(topState()).toBe("OH");
    first.unmount();

    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    expect(topState()).toBe("OH");
  });

  it("opens the other half on its own state after Clear", async () => {
    // The fall board has nobody from Kentucky, so a card left on it there would be empty.
    writeDefaultState("KY");
    open(sourcesOf(live));
    expect(await screen.findAllByText("Placeholder S-1")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear KY as the default state" }));
    expect(topState()).toBe("OH");

    fireEvent.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    expect(await screen.findAllByText("Placeholder S-F")).not.toHaveLength(0);
    expect(topState()).toBe("TX");
    expect(screen.queryByText("No ranked teams in KY yet.")).toBeNull();
    expect(screen.getByRole("button", { name: "Make TX my default state" })).toBeTruthy();
  });
});
