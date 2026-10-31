import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePoolTidy } from "./usePoolTidy";
import { ageGroup, game, seasonDate, team } from "../test/teamRankingsHarness";
import type { GcImportState } from "../lib/gameChangerImport";
import { refusalOf } from "../lib/notThisTeam";
import { resetTeamRankingsStore, saveNotThisTeam, saveRealClubs } from "../lib/teamRankingsStorage";
import { createSeason, loadSettingsForSeason, writeSeasonData } from "../lib/storage";
import type { TeamBase } from "../lib/types";
import {
  createTidyHandler,
  type WorkerRequest,
  type WorkerResponse,
} from "../workers/tidyProtocol";
import {
  beginPull,
  beginTidy,
  forceReleasePool,
  isPoolBusy,
  resetPullSession,
} from "../lib/pullSession";

afterEach(() => resetPullSession());

/**
 * One club's schedule names the opponent; the other posted the same game against a stand-in with
 * the mirrored score. The tidy settles that, so a run that did anything is one that found this.
 */
const withStandIn = (): GcImportState => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-HOME", "Home Club", { state: "KY" }),
    team("S-AWAY", "Away Club", { state: "KY" }),
    team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
  ],
  games: [
    game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
    }),
    game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
    }),
  ],
});

describe("tidying the pool", () => {
  it("does the work and says what it settled", async () => {
    const { result } = renderHook(() => usePoolTidy());
    const outcome = await result.current.tidy(withStandIn());
    expect(outcome?.tidy.named).toBe(1);
  });

  /*
   * The reason this claims a slot at all. A tidy reads the whole pool, works for the better part of
   * half a minute, and then saves all of it. On the main thread nothing else could start while it
   * ran; in a worker everything can — so a pull beginning halfway through would have its first few
   * hundred teams overwritten by a tidy that never saw them, with the cursor already counting them
   * settled and a resume skipping them for good.
   */
  it("refuses while a pull is running, rather than racing its saves", async () => {
    beginPull("2026-09-17T08:00:00.000Z");
    const { result } = renderHook(() => usePoolTidy());
    expect(await result.current.tidy(withStandIn())).toBeNull();
  });

  it("refuses while another tidy has the pool", async () => {
    beginTidy("2026-09-17T08:00:00.000Z");
    const { result } = renderHook(() => usePoolTidy());
    expect(await result.current.tidy(withStandIn())).toBeNull();
  });

  it("gives the slot back when it finishes, so the next job is not locked out", async () => {
    const { result } = renderHook(() => usePoolTidy());
    await result.current.tidy(withStandIn());
    expect(isPoolBusy()).toBe(false);
    expect(beginPull("2026-09-17T08:05:00.000Z")).not.toBeNull();
  });

  it("gives the slot back even when the pool is one it cannot read", async () => {
    // Anything thrown out of the tidy must not leave the pool claimed for the rest of the session.
    const { result } = renderHook(() => usePoolTidy());
    const broken = { ageGroups: [], teams: [], games: null } as unknown as GcImportState;
    await expect(result.current.tidy(broken)).rejects.toThrow();
    expect(isPoolBusy()).toBe(false);
  });

  it("does not claim the pool to look at it", async () => {
    // Inspecting reads and writes nothing, so it has no business blocking a pull.
    beginPull("2026-09-17T08:00:00.000Z");
    const { result } = renderHook(() => usePoolTidy());
    const looked = await result.current.inspect(withStandIn(), "", new Set());
    expect(looked?.health.games).toBe(2);
  });
});

/**
 * A worker that takes the job and never answers — which is what a real one looks like from the
 * moment it is terminated.
 */
class SilentWorker {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  terminate() {}
}

describe("a tidy whose panel goes away", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPullSession();
  });

  /*
   * The bug this exists for. Terminating a worker fires neither `message` nor `error`, so the
   * promise waiting on one was never settled, so the `finally` that releases the pool never ran —
   * and every later pull was refused with "a pull is already running" while nothing was running at
   * all. It took a reload to clear, and a reload is not a thing to ask of somebody mid-season.
   */
  it("lets go of the pool instead of holding it for ever", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());

    const pending = result.current.tidy(withStandIn());
    expect(isPoolBusy()).toBe(true);

    unmount();

    await expect(pending).resolves.toBeNull();
    expect(isPoolBusy()).toBe(false);
    // And the next pull is free to start, which is the whole point.
    expect(beginPull("2026-09-17T09:00:00.000Z")).not.toBeNull();
  });

  it("settles an inspection the same way, rather than leaving it hanging", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.inspect(withStandIn(), "", new Set());
    unmount();
    await expect(pending).resolves.toBeNull();
  });
});

/**
 * A worker that answers as the real one does: the protocol's own handler (`createTidyHandler`)
 * runs on each message, and its replies come back as message events, a turn later, as a worker's
 * do. jsdom has no Worker, so without one the hook only ever takes the inline path.
 */
class ReplyingWorker {
  private listeners = new Set<(event: { data: WorkerResponse }) => void>();
  private handle = createTidyHandler((response) =>
    queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: response })))
  );
  addEventListener(kind: string, listener: (event: { data: WorkerResponse }) => void) {
    if (kind === "message") this.listeners.add(listener);
  }
  removeEventListener(kind: string, listener: (event: { data: WorkerResponse }) => void) {
    if (kind === "message") this.listeners.delete(listener);
  }
  postMessage(message: WorkerRequest) {
    this.handle(message);
  }
  terminate() {}
}

/** A worker that keeps what it was sent and never answers. */
class RecordingWorker {
  static sent: unknown[] = [];
  addEventListener() {}
  removeEventListener() {}
  postMessage(message: unknown) {
    RecordingWorker.sent.push(message);
  }
  terminate() {}
}

describe("what the tidy worker is told", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPullSession();
    resetTeamRankingsStore();
    window.localStorage.clear();
  });

  /*
   * The worker has no storage, so a refusal it is not handed is one it overrules: its refile would
   * file the name straight back onto the club the owner said it is not ("Not this team").
   */
  it("hands it the names the owner has said are not a club, as stored", async () => {
    const refused = refusalOf("gcAWAY", "Home Club", "gcHOME");
    saveNotThisTeam(new Set([refused]));
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.tidy(withStandIn());
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({ kind: "tidy", notThisTeam: [refused] }),
    ]);
    unmount();
    await pending;
  });

  /*
   * Nor can it read the clubs the owner said are real, so a list it is not handed is one it
   * overrules: the step that deletes a page whose every name says it is no team would delete one.
   */
  it("hands it the clubs the owner has said are real, as stored", async () => {
    saveRealClubs(new Set(["gcHOME", "S-AWAY"]));
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.tidy(withStandIn());
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({ kind: "tidy", realClubs: ["S-AWAY", "gcHOME"] }),
    ]);
    unmount();
    await pending;
  });

  // jsdom has no Worker, so this tidy runs inline, and the list must reach that call too.
  it("keeps a club said to be real when it tidies inline", async () => {
    const pool = withStandIn();
    const practice = {
      ...pool.teams[0]!,
      name: "Thornbury Practice",
      gcTeams: [{ teamId: "gcHOME", name: "Thornbury Practice 10U", ageGroupId: "ag_10u_2027" }],
    };
    const state = { ...pool, teams: [practice, ...pool.teams.slice(1)] };
    const { result } = renderHook(() => usePoolTidy());
    expect((await result.current.tidy(state))?.tidy.notATeam).toBe(1);
    saveRealClubs(new Set(["gcHOME"]));
    expect((await result.current.tidy(state))?.tidy.notATeam).toBe(0);
  });

  // And its inspection, whose count of what a tidy would settle has to be the tidy's.
  it("hands the inspection the same names, as stored", async () => {
    const refused = refusalOf("gcAWAY", "Home Club", "gcHOME");
    saveNotThisTeam(new Set([refused]));
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.inspect(withStandIn(), "", new Set());
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({ kind: "inspect", notThisTeam: [refused] }),
    ]);
    unmount();
    await pending;
  });

  /*
   * The leaders with few outside games read the boards, and the worker reads no storage: the look
   * hands it every page's League Standings season once, as the page reads it, and the marks.
   */
  it("hands the inspection what the boards read, each season once, when asked for the leaders", async () => {
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const pool = withStandIn();
    const paged = {
      ...pool,
      ageGroups: [
        { ...pool.ageGroups[0]!, seasonIds: ["s1", "s2"] },
        { ...ageGroup(11, 2027), seasonIds: ["s1"] },
      ],
    };
    const read: string[] = [];
    const readSeason = (seasonId: string) => {
      read.push(seasonId);
      return { teams: [{ id: `t-${seasonId}`, name: `Lea ${seasonId}` }], matchups: [], logs: {} };
    };
    const marks = new Map([
      [
        "gcX",
        {
          gcTeamId: "gcX",
          name: "Made Up",
          on: "2026-09-18",
          signs: ["named" as const],
          word: "test",
        },
      ],
    ]);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.inspect(paged, "", new Set(), {
      readSeason,
      autoRemoved: marks,
    });
    expect(read).toEqual(["s1", "s2"]);
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({
        kind: "inspect",
        boards: {
          seasons: [
            ["s1", readSeason("s1")],
            ["s2", readSeason("s2")],
          ],
          marks: [...marks.values()],
        },
      }),
    ]);
    unmount();
    await pending;
  });

  // The boards hold them, so the leaders worked out beside the boards hold them as well.
  it("hands the inspection the ids League Standings picks that the pool no longer holds", async () => {
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const pool = withStandIn();
    const paged = { ...pool, ageGroups: [{ ...pool.ageGroups[0]!, seasonIds: ["s1"] }] };
    const readSeason = Object.assign(
      () => ({
        teams: [{ id: "lt-gone", name: "Gone Club", scoutTeamId: "S-GONE2" }],
        matchups: [],
        logs: {},
      }),
      { picks: () => ["S-GONE2", "S-HOME"] }
    );
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.inspect(paged, "", new Set(), {
      readSeason,
      autoRemoved: new Map(),
    });
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({
        kind: "inspect",
        boards: expect.objectContaining({ retired: { GONE: 2 } }),
      }),
    ]);
    unmount();
    await pending;
  });

  /*
   * In a browser the look's answer comes from the worker, through the hook's reading of its reply:
   * the list is the worker's, carried over whole, and none where the look was asked without what
   * the boards read.
   */
  it("hands on the worker's leaders with few outside games from its reply", async () => {
    vi.stubGlobal("Worker", ReplyingWorker);
    const pool = withStandIn();
    const { result } = renderHook(() => usePoolTidy());
    const plain = await result.current.inspect(pool, "", new Set());
    expect(plain?.health).toBeDefined();
    expect(plain?.fewOutside).toBeUndefined();
    const looked = await result.current.inspect(pool, "", new Set(), {
      readSeason: () => ({ teams: [], matchups: [], logs: {} }),
      autoRemoved: new Map(),
    });
    expect(looked?.fewOutside?.leaders.map(({ name }) => name)).toEqual(["Home Club", "Away Club"]);
  });

  // jsdom has no Worker, so this looks inline.
  it("lists the leaders inline as the worker would, where there is no worker", async () => {
    const { result } = renderHook(() => usePoolTidy());
    const pool = withStandIn();
    const plain = await result.current.inspect(pool, "", new Set());
    expect(plain?.fewOutside).toBeUndefined();
    const looked = await result.current.inspect(pool, "", new Set(), {
      readSeason: () => ({ teams: [], matchups: [], logs: {} }),
      autoRemoved: new Map(),
    });
    expect(looked?.fewOutside?.leaders.map(({ name }) => name)).toEqual(["Home Club", "Away Club"]);
  });
});

describe("what the tidy keeps for League Standings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPullSession();
    resetTeamRankingsStore();
    window.localStorage.clear();
  });

  /*
   * The home club's one GameChanger page is named as an old page marked do not use, as a coach's
   * abandoned page that still holds the league's games is, and a League Standings season on its
   * page holds `leagueTeam`. The club's own name has no word, so only its link's name hits.
   */
  const withLeague = (leagueTeam: TeamBase | null): GcImportState => {
    const pool = withStandIn();
    const season = createSeason("Fall 2026");
    writeSeasonData(season.id, {
      teams: [...(leagueTeam ? [leagueTeam] : []), { id: "lt-owls", name: "Owls" }],
      matchups: [],
      logs: {},
      bracketLogs: {},
      settings: loadSettingsForSeason(season.id),
    });
    return {
      ...pool,
      ageGroups: pool.ageGroups.map((group) => ({ ...group, seasonIds: [season.id] })),
      teams: pool.teams.map((club) =>
        club.id === "S-HOME"
          ? {
              ...club,
              name: "Hollowmere Hawks",
              gcTeams: [
                { teamId: "gcHOME", name: "Hollowmere Hawks 10U DNU", ageGroupId: "ag_10u_2027" },
              ],
            }
          : club
      ),
    };
  };

  // jsdom has no Worker, so these tidy inline.
  it("deletes the page when no League Standings team links it", async () => {
    const { result } = renderHook(() => usePoolTidy());
    expect((await result.current.tidy(withLeague(null)))?.tidy.notATeam).toBe(1);
  });

  it("keeps a club a League Standings team picks in Settings", async () => {
    const state = withLeague({ id: "lt-hawks", name: "Hawks", scoutTeamId: "S-HOME" });
    const { result } = renderHook(() => usePoolTidy());
    const outcome = await result.current.tidy(state);
    expect(outcome?.tidy.notATeam).toBe(0);
    expect(outcome?.state.teams.some((club) => club.id === "S-HOME")).toBe(true);
  });

  it("keeps one a League Standings team reaches by its name alone", async () => {
    const { result } = renderHook(() => usePoolTidy());
    const state = withLeague({ id: "lt-hawks", name: "Hollowmere Hawks" });
    expect((await result.current.tidy(state))?.tidy.notATeam).toBe(0);
  });

  /*
   * A pick of a club the pool no longer holds names an id let go of before the pool kept a
   * high-water, or across a start of Team Rankings: a slot or stand-in the tidy minted under it
   * would be the club the pick names. The worker cannot read League Standings to know it.
   */
  it("tells the worker the ids League Standings picks that the pool no longer holds", async () => {
    const state = withLeague({ id: "lt-gone", name: "Gone Club", scoutTeamId: "S-GONE2" });
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.tidy(state);
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({ kind: "tidy", retired: { GONE: 2 } }),
    ]);
    unmount();
    await pending;
  });

  it("tells the worker the clubs League Standings links, beside the clubs said to be real", async () => {
    const state = withLeague({ id: "lt-hawks", name: "Hawks", scoutTeamId: "S-HOME" });
    RecordingWorker.sent = [];
    vi.stubGlobal("Worker", RecordingWorker);
    const { result, unmount } = renderHook(() => usePoolTidy());
    const pending = result.current.tidy(state);
    expect(RecordingWorker.sent).toEqual([
      expect.objectContaining({ kind: "tidy", realClubs: ["S-HOME"] }),
    ]);
    unmount();
    await pending;
  });
});

describe("taking the pool back", () => {
  afterEach(() => resetPullSession());

  it("frees it whatever holds it, so a stuck slot never needs a reload", () => {
    const held = beginTidy("2026-09-17T08:00:00.000Z")!;
    expect(isPoolBusy()).toBe(true);
    forceReleasePool();
    expect(isPoolBusy()).toBe(false);
    // Aborted on the way out, so a job that really was going stops rather than carrying on unseen.
    expect(held.controller.signal.aborted).toBe(true);
  });

  it("is harmless when nothing holds it", () => {
    expect(() => forceReleasePool()).not.toThrow();
    expect(isPoolBusy()).toBe(false);
  });
});

/**
 * The tidy that nobody asked for.
 *
 * In jsdom there is no `Worker`, so these render exactly the situation the guard is for: the work
 * has nowhere to go but the main thread. A person pressing the button in Setup has asked for that
 * wait and gets it. The pass that starts by itself on page load has not, and on a nationwide pool
 * it is twenty or thirty seconds of frozen tab — long enough for the browser to reload the page,
 * which cancels the run before it can record that it happened, so the next load starts it again.
 * That loop is what took the app down when a refactor stopped the workers being built at all.
 */
describe("a tidy that started by itself", () => {
  it("does nothing rather than freeze the page when there is no worker", async () => {
    const { result } = renderHook(() => usePoolTidy());

    const outcome = await result.current.tidy(withStandIn(), { workerOnly: true });

    expect(outcome).toBeNull();
    // And it did not take the pool hostage on the way out.
    expect(isPoolBusy()).toBe(false);
  });

  it("still does the work when a person asked for it", async () => {
    const { result } = renderHook(() => usePoolTidy());

    const outcome = await result.current.tidy(withStandIn());

    expect(outcome).not.toBeNull();
    expect(outcome?.tidy.named).toBe(1);
    expect(isPoolBusy()).toBe(false);
  });
});
