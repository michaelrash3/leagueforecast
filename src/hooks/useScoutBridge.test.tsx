import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keptBridge, useScoutBridge, type SeasonFixture } from "./useScoutBridge";
import { BRIDGE_RULES_NOW, type LeagueBridgeAnswer } from "../lib/live/leagueAnswers";
import type { CopyAt, LeagueAsker } from "../lib/live/leagueAsk";
import type { EditMonth } from "../lib/live/rebuildLedger";
import type { QueryOf } from "../lib/live/queries";
import type { AgeGroup, ScoutTeam } from "../lib/teamRankings";
import {
  loadAgeGroups,
  loadScoutGamesForSeason,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";

// The pool's readers, watched, so a member's device can be seen to leave its pool unread.
vi.mock("../lib/teamRankingsStorage", async (actual) => {
  const real = await actual<typeof import("../lib/teamRankingsStorage")>();
  return {
    ...real,
    loadAgeGroups: vi.fn(real.loadAgeGroups),
    loadScoutTeams: vi.fn(real.loadScoutTeams),
    loadScoutGamesForSeason: vi.fn(real.loadScoutGamesForSeason),
  };
});

/**
 * Team Rankings owns this data and League Standings only borrows it, which is the whole reason
 * this is a hook rather than a memo over state: storage is not reactive, so a pull, a tidy or a
 * restore on the other side of the app changes what the league's forecasts read and nothing here
 * would otherwise notice. A revision counter is the signal, and it is the part worth guarding —
 * it is invisible in the output and silently wrong if it stops being a dependency.
 *
 * It lived in App.tsx, which has no test of its own, so none of this was covered by anything.
 */
const group = (id: string, seasonIds: string[]): AgeGroup => ({
  id,
  name: id,
  ageLevel: 10,
  year: 2027,
  seasonIds,
});

const club = (id: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name: id,
  gcTeams: [{ teamId: `gc-${id}`, name: id, ageGroupId: "ag" }],
  ...extra,
});

const setup = (over: Partial<Parameters<typeof useScoutBridge>[0]> = {}) =>
  renderHook((props: Parameters<typeof useScoutBridge>[0]) => useScoutBridge(props), {
    initialProps: {
      activeSeasonId: "s1",
      teams: [{ id: "lt1", name: "Rays" }],
      seasonFixtures: [],
      useScoutResults: true,
      onLink: vi.fn(),
      ...over,
    },
  });

describe("what Team Rankings has for a league season", () => {
  beforeEach(() => {
    resetTeamRankingsStore();
  });

  it("does not see a save until it is told there was one", () => {
    const { result } = setup();
    expect(result.current.bridge.seasonLinked).toBe(false);

    // The other side of the app claims this season. Storage says so; nothing else does.
    saveAgeGroups([group("ag", ["s1"])]);
    expect(result.current.bridge.seasonLinked).toBe(false);

    act(() => result.current.noteChange());
    expect(result.current.bridge.seasonLinked).toBe(true);
  });

  it("hands out a new club search after a save, so nothing holds the old answer", () => {
    const { result } = setup();
    const before = result.current.wideOptions;
    const search = result.current.candidatesFor;
    expect(before()).toEqual([]);

    saveScoutTeams([club("c1")]);
    act(() => result.current.noteChange());

    /*
     * Both read storage when called, so calling the old one would answer correctly anyway. What
     * would not is a consumer that memoised on the callback: the panel builds its list from these
     * and would keep the list it built before the pull. So the identity has to move, and that is
     * what this asserts — the value is the easy half.
     */
    expect(result.current.wideOptions).not.toBe(before);
    expect(result.current.candidatesFor).not.toBe(search);
    expect(result.current.wideOptions().map((club) => club.id)).toEqual(["c1"]);
  });

  it("hands out the device's own clubs, read again after a save, to follow a club by", () => {
    saveScoutTeams([club("c1")]);
    const { result } = setup();
    const before = result.current.clubs;
    expect(before?.carriersOf("gc-c1")).toEqual(["c1"]);
    saveScoutTeams([club("c2", { gcTeams: [{ teamId: "gc-c1", name: "c1", ageGroupId: "ag" }] })]);
    act(() => result.current.noteChange());
    expect(result.current.clubs).not.toBe(before);
    expect(result.current.clubs?.carriersOf("gc-c1")).toEqual(["c2"]);
  });

  it("hands out none on a member's device, whose clubs are the server's", () => {
    saveScoutTeams([club("c1")]);
    const asker = (async () => null) as unknown as LeagueAsker;
    const { result } = setup({ asker });
    expect(result.current.clubs).toBeNull();
  });

  it("offers only clubs a pick could land on", () => {
    saveScoutTeams([
      club("linked"),
      // A stand-in names nobody, and a club with no GameChanger team behind it cannot be
      // searched for — offering either is a search that could not have succeeded. A stand-in has
      // no GameChanger id of its own, which is what makes it one: a club that has been pulled is
      // a club whatever it is called, and `markPlaceholders` takes the mark back off it.
      { id: "stand-in", name: "stand-in", placeholder: true },
      { id: "by-name-only", name: "Heard Of" },
    ]);
    const { result } = setup();
    act(() => result.current.noteChange());

    expect(result.current.wideOptions().map((club) => club.id)).toEqual(["linked"]);
  });

  it("withholds the results when the setting is off, and reads the bridge anyway", () => {
    saveAgeGroups([group("ag", ["s1"])]);
    const { result } = setup({ useScoutResults: false });
    act(() => result.current.noteChange());

    // The panel says how much is ready and waiting, so the count has to be read either way.
    expect(result.current.bridge.seasonLinked).toBe(true);
    expect(result.current.externalResults).toEqual([]);
  });

  it("has nothing to say without a season, and says it the same way every time", () => {
    saveAgeGroups([group("ag", ["s1"])]);
    const { result, rerender } = setup({ activeSeasonId: "" });
    const first = result.current.bridge;

    rerender({
      activeSeasonId: "",
      teams: [{ id: "lt1", name: "Rays" }],
      seasonFixtures: [],
      useScoutResults: true,
      onLink: vi.fn(),
    });

    // The same object, not an equal one: a fresh empty every render would re-run every forecast
    // memoised on it.
    expect(result.current.bridge).toBe(first);
    expect(result.current.candidatesFor("Rays")).toEqual([]);
  });
});

describe("what Team Rankings has for a league season, asked of the server", () => {
  /** The server's answer: one outside result, the Rays guessed, and the club they could be. */
  const ANSWER: LeagueBridgeAnswer = {
    bridge: {
      results: [{ home: "Rays", away: "S-OWLS", homeMargin: 2, neutral: true }],
      seasonLinked: true,
      rows: [
        {
          leagueTeamId: "lt1",
          leagueTeamName: "Rays",
          how: "guessed",
          scoutTeamId: "S-R",
          suggestedName: "Rays",
        },
      ],
      linkedCount: 1,
      countedResults: 1,
    },
    candidates: [
      {
        name: "Rays",
        clubs: [{ scoutTeamId: "S-R", name: "Rays", sharedOpponents: [], games: 3 }],
      },
    ],
  };
  const CLUBS = [{ id: "S-R", label: "Rays", detail: "10U" }];
  type Asked = QueryOf<"league.bridge" | "league.clubs" | "league.fill">;

  /** A server that answers what it is asked. */
  const server = ({ answer = ANSWER as LeagueBridgeAnswer | null } = {}) => {
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      if (query.kind === "league.clubs") return { kind: "league.clubs", clubs: CLUBS };
      return answer && { kind: "league.bridge", ...answer };
    }) as LeagueAsker;
    return { asked, asker };
  };
  const wait = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const settle = () => wait(1_000);
  /** A bridge an earlier build kept for `season`, the bridge alone. */
  const keepBridge = (season: string, bridge: LeagueBridgeAnswer["bridge"]) =>
    localStorage.setItem("lf_league_bridge_v2", JSON.stringify({ [season]: bridge }));
  /** The question about `season` with these teams and fixtures, as a kept bridge holds it. */
  const askedFor = (
    season: string,
    teams: { id: string; name: string; scoutTeamId?: string }[] = [{ id: "lt1", name: "Rays" }],
    fixtures: SeasonFixture[] = []
  ) => JSON.stringify({ kind: "league.bridge", season, teams, fixtures });
  /** A bridge an earlier visit kept for `season`, with the question it answered. */
  const keepAnswered = (
    season: string,
    bridge: LeagueBridgeAnswer["bridge"],
    asked: string = askedFor(season)
  ) => localStorage.setItem("lf_league_bridge_v2", JSON.stringify({ [season]: { bridge, asked } }));
  const shown = (state: DocumentVisibilityState) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  /*
   * A season's teams and fixtures as App hands them over: the same arrays until they change, so a
   * rerender that changes something else asks nothing for them.
   */
  const TEAMS = [{ id: "lt1", name: "Rays" }];
  const FIXTURES: SeasonFixture[] = [];
  const onLink = vi.fn();
  /** Every prop, for a test that starts and rerenders with the same teams and fixtures. */
  const props = (over: Partial<Parameters<typeof useScoutBridge>[0]> = {}) => ({
    activeSeasonId: "s1",
    teams: TEAMS,
    seasonFixtures: FIXTURES,
    useScoutResults: true,
    onLink,
    ...over,
  });

  beforeEach(() => {
    localStorage.clear();
    resetTeamRankingsStore();
    // The clock too, since being shown anew asks at most once every few minutes; set to noon in
    // New York, so a test's hours of waiting cross the day a question's timer retries are counted
    // by (`RETRIES_A_DAY`) only where it means to.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-30T16:00:00.000Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => vi.useRealTimers());

  it("asks once the season's teams stand still, and the forecast reads its results", async () => {
    const { asked, asker } = server();
    const { result } = setup({ asker, teams: [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }] });
    expect(result.current.bridge.seasonLinked).toBe(false);
    await settle();
    expect(asked).toEqual([
      {
        kind: "league.bridge",
        season: "s1",
        teams: [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }],
        fixtures: [],
      },
    ]);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    expect(result.current.externalResults).toEqual(ANSWER.bridge.results);
    expect(result.current.candidatesFor("Rays")).toEqual(ANSWER.candidates[0]?.clubs);
    expect(result.current.candidatesFor("Owls")).toEqual([]);
  });

  it("asks with the GameChanger id kept beside a pick, which the server follows the club by", async () => {
    const { asked, asker } = server();
    const picked = [{ id: "lt1", name: "Rays", scoutTeamId: "S-R", scoutGcTeamId: "gcRAYS" }];
    setup({ asker, teams: picked });
    await settle();
    expect(asked).toEqual([{ kind: "league.bridge", season: "s1", teams: picked, fixtures: [] }]);
  });

  it("asks nothing while held back for the live board's first draw, and asks once let go", async () => {
    const { asked, asker } = server();
    const { result, rerender } = setup({ asker, held: true, signedIn: true });
    await settle();
    expect(asked).toEqual([]);
    expect(result.current.unanswered).toBe("asking");
    rerender({ ...props(), asker, held: false, signedIn: true });
    await settle();
    expect(asked).toHaveLength(1);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
  });

  it("keeps the bridge alone for the next visit, and reads it before the server answers", async () => {
    const { asker } = server();
    const first = setup({ asker });
    await settle();
    first.unmount();
    // The clubs each team could be are this visit's alone: the bridge is all that is kept, with
    // the question it answered.
    expect(JSON.parse(localStorage.getItem("lf_league_bridge_v2") ?? "null")).toEqual({
      s1: { bridge: ANSWER.bridge, asked: askedFor("s1") },
    });
    expect(keptBridge("s1")).toEqual(ANSWER.bridge);
    // Offline now: nothing comes, and what was kept stands, with no clubs to offer until it does.
    const offline = server({ answer: null });
    const { result } = setup({ asker: offline.asker });
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    expect(result.current.unanswered).toBeUndefined();
    await settle();
    expect(offline.asked).toHaveLength(1);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    expect(result.current.candidatesFor("Rays")).toEqual([]);
  });

  it("lets go of what an earlier build kept, every club of every team", () => {
    localStorage.setItem("lf_league_bridge_v1", JSON.stringify({ s1: ANSWER }));
    setup();
    expect(localStorage.getItem("lf_league_bridge_v1")).toBeNull();
  });

  it("reads a kept bridge only whole, as one from the network is read", () => {
    const leaning = {
      ...ANSWER.bridge,
      results: [{ ...ANSWER.bridge.results[0], neutral: false }],
    };
    for (const kept of [
      leaning,
      { ...ANSWER.bridge, rows: "none" },
      ANSWER,
      "not one",
      { bridge: leaning, asked: askedFor("s1") },
      { bridge: ANSWER.bridge, asked: 5 },
      { bridge: ANSWER.bridge, asked: null },
    ]) {
      localStorage.setItem("lf_league_bridge_v2", JSON.stringify({ s1: kept }));
      expect(keptBridge("s1")).toBeNull();
      const { asker } = server({ answer: null });
      const { result, unmount } = setup({ asker });
      expect(result.current.bridge.seasonLinked).toBe(false);
      unmount();
    }
    localStorage.setItem("lf_league_bridge_v2", "{not json");
    expect(keptBridge("s1")).toBeNull();
  });

  it("reads the server's answer over the one it kept, once it comes", async () => {
    keepBridge("s1", ANSWER.bridge);
    const fresh: LeagueBridgeAnswer = {
      ...ANSWER,
      bridge: { ...ANSWER.bridge, results: [], countedResults: 0 },
    };
    const { asker } = server({ answer: fresh });
    const { result } = setup({ asker });
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(result.current.bridge).toEqual(fresh.bridge);
    expect(keptBridge("s1")).toEqual(fresh.bridge);
  });

  /*
   * Season ids are given out again, so a season made under a deleted one's id, or restored over
   * the open one, is told apart by the moment it was made (`seasonKey`), as App holds the team
   * followed. Storage has let go of the bridge kept for the season that went (`forgetSeasons`).
   */
  /** A server that answers until the device goes offline. */
  const goesOffline = () => {
    const state = { online: true };
    const asker = (async (query: Asked) =>
      state.online && query.kind === "league.bridge"
        ? { kind: "league.bridge", ...ANSWER }
        : null) as LeagueAsker;
    return { state, asker };
  };

  it("shows a season made under the id nothing heard for the season before it", async () => {
    const { state, asker } = goesOffline();
    const { result, rerender } = setup(props({ asker, seasonKey: "s1\n2026-03-01" }));
    await settle();
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    state.online = false;
    localStorage.removeItem("lf_league_bridge_v2");
    // Restored over here, with the same teams: another season under the open id, asked about.
    rerender(props({ asker, seasonKey: "s1\n2025-03-01" }));
    expect(result.current.bridge.seasonLinked).toBe(false);
    expect(result.current.externalResults).toEqual([]);
    await settle();
    expect(result.current.unanswered).toBe("failed");
    // Deleted in turn, and a season made under the id: offline, it has still heard nothing.
    rerender(props({ asker, activeSeasonId: "s2", seasonKey: "s2\n2026-01-01" }));
    rerender(props({ asker, seasonKey: "s1\n2026-04-01" }));
    expect(result.current.bridge.seasonLinked).toBe(false);
  });

  it("reads the bridge kept afresh, and asks afresh, for a season restored over the open one", async () => {
    keepBridge("s1", ANSWER.bridge);
    const { asker } = server({ answer: null });
    const { result, rerender } = setup(props({ asker, seasonKey: "s1\n2026-03-01" }));
    await settle();
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    localStorage.removeItem("lf_league_bridge_v2");
    rerender(props({ asker, seasonKey: "s1\n2025-03-01" }));
    expect(result.current.bridge.seasonLinked).toBe(false);
    // Not yet asked about, so not yet unanswered: the season before it was.
    expect(result.current.unanswered).toBe("asking");
  });

  it("reads what it heard for a season again on coming back to it", async () => {
    const { state, asker } = goesOffline();
    const { result, rerender } = setup(props({ asker, seasonKey: "s1\n2026-03-01" }));
    await settle();
    state.online = false;
    localStorage.removeItem("lf_league_bridge_v2");
    rerender(props({ asker, activeSeasonId: "s2", seasonKey: "s2\n2026-01-01" }));
    rerender(props({ asker, seasonKey: "s1\n2026-03-01" }));
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    expect(result.current.candidatesFor("Rays")).toEqual(ANSWER.candidates[0]?.clubs);
  });

  it("keeps the last few seasons' bridges, and this season's alone when storage is full", async () => {
    for (const season of ["s1", "s2", "s3", "s4", "s5"]) {
      const { asker } = server();
      const visit = setup({ asker, activeSeasonId: season });
      await settle();
      visit.unmount();
    }
    expect(["s1", "s2", "s3", "s4", "s5"].map((season) => keptBridge(season) !== null)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    // Room for one season's bridge and its question, and no more.
    const room = JSON.stringify({ s6: { bridge: ANSWER.bridge, asked: askedFor("s6") } }).length;
    const setItem = Storage.prototype.setItem;
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (value.length > room) throw new DOMException("full", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    const { asker } = server();
    setup({ asker, activeSeasonId: "s6" });
    await settle();
    full.mockRestore();
    expect(keptBridge("s6")).toEqual(ANSWER.bridge);
    expect(keptBridge("s5")).toBeNull();
  });

  it("asks only once the season's teams stand still, for the teams as they then stand", async () => {
    const { asked, asker } = server();
    const named = (name: string) => props({ teams: [{ id: "lt1", name }], asker });
    const { rerender } = setup(named("Ra"));
    await wait(500);
    rerender(named("Ray"));
    await wait(500);
    rerender(named("Rays"));
    await wait(700);
    expect(asked).toEqual([]);
    await settle();
    expect(asked).toEqual([
      { kind: "league.bridge", season: "s1", teams: [{ id: "lt1", name: "Rays" }], fixtures: [] },
    ]);
  });

  it("asks again when the page is looked at anew, at most once every few minutes", async () => {
    const { asked, asker } = server();
    setup({ asker });
    await settle();
    // Put away and looked at again a minute later: what was just answered stands.
    act(() => shown("hidden"));
    await wait(60_000);
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(1);
    act(() => shown("hidden"));
    await wait(5 * 60_000);
    expect(asked).toHaveLength(1);
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("reads the answer on its way when the page is looked at anew, rather than ask again", async () => {
    let letGo = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const asked: unknown[] = [];
    const asker = (async (query: unknown) => {
      asked.push(query);
      await held;
      return { kind: "league.bridge", ...ANSWER };
    }) as LeagueAsker;
    const { result } = setup({ asker });
    await settle();
    // A server waking up takes its time, and the member looks away and back meanwhile.
    await wait(10 * 60_000);
    act(() => shown("hidden"));
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(1);
    await act(async () => letGo());
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(asked).toHaveLength(1);
  });

  it("asks nothing when shown anew on Team Rankings, and asks again on coming back", async () => {
    const { asked, asker } = server();
    const { rerender } = setup(props({ asker, leagueOnScreen: true }));
    await settle();
    rerender(props({ asker, leagueOnScreen: false }));
    await wait(10 * 60_000);
    act(() => shown("hidden"));
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(1);
    // Back on League Standings, where the member may just have ticked this season on a page.
    rerender(props({ asker, leagueOnScreen: true }));
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("asks again on coming back once the answer on its way is in", async () => {
    let letGo = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const asked: unknown[] = [];
    const asker = (async (query: unknown) => {
      asked.push(query);
      if (asked.length === 1) await held;
      return { kind: "league.bridge", ...ANSWER };
    }) as LeagueAsker;
    const { result, rerender } = setup(props({ asker, leagueOnScreen: true }));
    await settle();
    rerender(props({ asker, leagueOnScreen: false }));
    rerender(props({ asker, leagueOnScreen: true }));
    await settle();
    // The first answer is still read, and the change made meanwhile is asked about after it.
    expect(asked).toHaveLength(1);
    await act(async () => letGo());
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("asks nothing on Team Rankings while the bridge on hand answers the season, and asks on coming back", async () => {
    keepAnswered("s1", ANSWER.bridge);
    const { asked, asker } = server();
    // Opened on Team Rankings, its board drawn and the sign-in through.
    const { result, rerender } = setup(props({ asker, leagueOnScreen: false, signedIn: true }));
    await settle();
    // What asks on League Standings asks nothing here: the device back online, the page shown anew
    // long after, the season's teams handed over anew as they stood.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    act(() => shown("hidden"));
    await wait(10 * 60_000);
    act(() => shown("visible"));
    rerender(props({ asker, leagueOnScreen: false, signedIn: true, teams: [...TEAMS] }));
    await settle();
    expect(asked).toEqual([]);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    // League Standings shown: asked once.
    rerender(props({ asker, leagueOnScreen: true, signedIn: true }));
    await settle();
    expect(asked).toHaveLength(1);
  });

  it("asks on Team Rankings about teams or final scores changed there, and then nothing more", async () => {
    keepAnswered("s1", ANSWER.bridge);
    const { asked, asker } = server();
    const { result, rerender } = setup(props({ asker, leagueOnScreen: false }));
    await settle();
    expect(asked).toEqual([]);
    // Another device picks the Rays' club, and League's listener brings it here.
    const picked = [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }];
    rerender(props({ asker, leagueOnScreen: false, teams: picked }));
    await settle();
    expect(asked).toEqual([{ kind: "league.bridge", season: "s1", teams: picked, fixtures: [] }]);
    // A final comes the same way: the bridge answers the scores it was asked with.
    const scored: SeasonFixture[] = [
      { away: "Rays", home: "Owls", date: "5/1", awayRuns: 4, homeRuns: 2 },
    ];
    rerender(props({ asker, leagueOnScreen: false, teams: picked, seasonFixtures: scored }));
    await settle();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({ fixtures: scored });
    // Answered, the bridge on hand is the season's: nothing else asks while Team Rankings is shown.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(asked).toHaveLength(2);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
  });

  it("asks on Team Rankings where no bridge is on hand, or one an earlier build kept alone", async () => {
    const nothing = server();
    const first = setup(props({ asker: nothing.asker, leagueOnScreen: false }));
    await settle();
    expect(nothing.asked).toHaveLength(1);
    first.unmount();
    // A bridge kept without its question is shown, and asked about once to learn it.
    localStorage.clear();
    keepBridge("s1", ANSWER.bridge);
    const earlier = server();
    const { result, rerender } = setup(props({ asker: earlier.asker, leagueOnScreen: false }));
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(earlier.asked).toHaveLength(1);
    rerender(props({ asker: earlier.asker, leagueOnScreen: false, teams: [...TEAMS] }));
    await settle();
    expect(earlier.asked).toHaveLength(1);
  });

  it("asks an unanswered question again on Team Rankings only where the bridge on hand is not the season's", async () => {
    // A bridge on hand for the season as it stands: its retries wait for coming back.
    keepAnswered("s1", ANSWER.bridge);
    const answering = server({ answer: null });
    const { rerender, unmount } = setup(props({ asker: answering.asker, leagueOnScreen: true }));
    await settle();
    expect(answering.asked).toHaveLength(1);
    rerender(props({ asker: answering.asker, leagueOnScreen: false }));
    await wait(3 * 60 * 60_000);
    expect(answering.asked).toHaveLength(1);
    rerender(props({ asker: answering.asker, leagueOnScreen: true }));
    await settle();
    expect(answering.asked).toHaveLength(2);
    unmount();
    // None on hand: the forecast has nothing to read, so the retries go on.
    localStorage.clear();
    const nothing = server({ answer: null });
    const none = setup(props({ asker: nothing.asker, leagueOnScreen: false }));
    await wait(800);
    await wait(5_000);
    await wait(30_000);
    expect(nothing.asked).toHaveLength(3);
    none.unmount();
    // One on hand for the teams before a club was picked: not the season's, so they go on too. On
    // a device of its own, which has sent none of the day's timer retries.
    localStorage.clear();
    keepAnswered("s1", ANSWER.bridge);
    const stale = server({ answer: null });
    const picked = [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }];
    setup(props({ asker: stale.asker, leagueOnScreen: false, teams: picked }));
    await wait(800);
    await wait(5_000);
    await wait(30_000);
    expect(stale.asked).toHaveLength(3);
  });

  it("holds a question off League Standings to the bridge shown, not to one another tab kept since", async () => {
    keepAnswered("s1", ANSWER.bridge);
    const { asked, asker } = server();
    const { result, rerender, unmount } = setup(props({ asker, leagueOnScreen: false }));
    await settle();
    expect(asked).toEqual([]);
    // Another tab, on League Standings, keeps its answer for the Rays' club picked, and the pick
    // reaches this one: the bridge shown here is still the one read as the season opened.
    const picked = [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }];
    keepAnswered("s1", { ...ANSWER.bridge, results: [] }, askedFor("s1", picked));
    rerender(props({ asker, leagueOnScreen: false, teams: picked }));
    await settle();
    expect(asked).toHaveLength(1);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    unmount();
    // None kept as the season opened, and the first question unanswered: another tab's answer
    // since is not shown here, so the retries go on.
    localStorage.clear();
    const nothing = server({ answer: null });
    const second = setup(props({ asker: nothing.asker, leagueOnScreen: false }));
    await settle();
    expect(nothing.asked).toHaveLength(1);
    keepAnswered("s1", ANSWER.bridge);
    await wait(5_000);
    expect(nothing.asked).toHaveLength(2);
    expect(second.result.current.bridge.seasonLinked).toBe(false);
  });

  it("leaves unread an answer for teams since changed, and asks again for them", async () => {
    let letGo = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const asked: unknown[] = [];
    const asker = (async (query: unknown) => {
      asked.push(query);
      if (asked.length === 1) await held;
      return { kind: "league.bridge", ...ANSWER };
    }) as LeagueAsker;
    const { result, rerender } = setup({ asker });
    await settle();
    rerender(props({ asker, teams: [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }] }));
    await act(async () => letGo());
    // The first answer was for the Rays unpicked: not this season's as it stands.
    expect(result.current.bridge.seasonLinked).toBe(false);
    await settle();
    expect(asked).toHaveLength(2);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
  });

  /** An asker whose first question is held until let go, and every other answered at once. */
  const holdingFirst = () => {
    let letGo = () => {};
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const asked: unknown[] = [];
    const asker = (async (query: unknown) => {
      asked.push(query);
      if (asked.length === 1) await held;
      return { kind: "league.bridge", ...ANSWER };
    }) as LeagueAsker;
    return { asked, asker, letGo: () => letGo() };
  };
  const RENAMED = [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }];

  it("holds nothing up for a question about teams since changed", async () => {
    const { asked, asker, letGo } = holdingFirst();
    const { result, rerender } = setup(props({ asker }));
    await settle();
    // The teams change while the first is out; coming back meanwhile asks about them at once.
    rerender(props({ asker, teams: RENAMED }));
    rerender(props({ asker, teams: RENAMED, leagueOnScreen: false }));
    rerender(props({ asker, teams: RENAMED, leagueOnScreen: true }));
    await settle();
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await act(async () => letGo());
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("asks nothing more for a change noted while a question about other teams was out", async () => {
    const { asked, asker, letGo } = holdingFirst();
    const { result, rerender } = setup(props({ asker }));
    await settle();
    rerender(props({ asker, leagueOnScreen: false }));
    rerender(props({ asker, leagueOnScreen: true }));
    // The teams change too: the question asked for them is after the change noted.
    rerender(props({ asker, teams: RENAMED }));
    await settle();
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await act(async () => letGo());
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("says it is asking, and then that it could not, rather than that nothing claims the season", async () => {
    const { asker } = server({ answer: null });
    const { result } = setup({ asker });
    expect(result.current.unanswered).toBe("asking");
    await settle();
    expect(result.current.unanswered).toBe("failed");
    expect(result.current.bridge.seasonLinked).toBe(false);
    // A device that reads its own pool is never waiting on anybody.
    expect(setup().result.current.unanswered).toBeUndefined();
  });

  /*
   * A question the server cannot answer, a worker out of memory say, is a cold load of the whole
   * pool on the 8 GiB server each try. Asked again every half hour with no end, a page left open,
   * hidden or not, was 48 of them a day; now its timer sends three a season a New York day, none
   * while the page is hidden, and none while the server says the edits' month is spent.
   */

  /** A server that answers nothing, saying of the edits' month what `said.month` holds, if any. */
  const unanswering = (said: { month: EditMonth | null } = { month: null }) => {
    const asked: number[] = [];
    const asker = (async (_query: Asked, heard?: (month: EditMonth) => void) => {
      asked.push(Date.now());
      if (said.month) heard?.(said.month);
      return null;
    }) as LeagueAsker;
    return { asked, asker, said };
  };

  it("asks again after 5 s, 30 s and 2 minutes, on a timer no more that New York day, and nothing once answered", async () => {
    let answering = false;
    const asked: number[] = [];
    const asker = (async () => {
      asked.push(Date.now());
      return answering ? { kind: "league.bridge", ...ANSWER } : null;
    }) as LeagueAsker;
    const start = Date.now();
    const { result } = setup({ asker });
    await wait(800);
    await wait(5_000);
    await wait(30_000);
    await wait(120_000);
    // The day's three are made: the ten minutes' wait and every half hour's after it send nothing.
    await wait(600_000);
    await wait(6 * 60 * 60_000);
    expect(asked.map((at) => at - start)).toEqual([800, 5_800, 35_800, 155_800]);
    expect(result.current.unanswered).toBe("failed");
    // Coming online asks all the same, and once answered nothing more is asked.
    answering = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    expect(result.current.unanswered).toBeUndefined();
    await wait(24 * 60 * 60_000);
    expect(asked).toHaveLength(5);
  });

  it("asks three more on a timer once New York's day has turned, with nothing else asking", async () => {
    const { asked, asker } = unanswering();
    const start = Date.now();
    const upTo = (ms: number) => wait(start + ms - Date.now());
    setup({ asker });
    // Noon to midnight in New York: the question and its three, then waits that send nothing.
    await upTo(12 * 60 * 60_000);
    expect(asked).toHaveLength(4);
    // The first wait to end after midnight sends, and the two after it, half an hour apart.
    await upTo(15 * 60 * 60_000);
    expect(asked.map((at) => at - start).slice(4)).toEqual([43_955_800, 45_755_800, 47_555_800]);
  });

  it("keeps the day's count on the device, so a reload sends none of the day's again, and each season its own", async () => {
    const { asked, asker } = unanswering();
    const first = setup({ asker });
    await wait(800 + 5_000 + 30_000 + 120_000);
    expect(asked).toHaveLength(4);
    first.unmount();
    // Reloaded the same day: its first question goes, as a visit's always does, and no retry.
    const again = setup({ asker });
    await settle();
    expect(asked).toHaveLength(5);
    await wait(60 * 60_000);
    expect(asked).toHaveLength(5);
    again.unmount();
    // Another season's are its own.
    const other = setup({ asker, activeSeasonId: "s2" });
    await wait(800 + 5_000 + 30_000 + 120_000 + 600_000);
    expect(asked).toHaveLength(9);
    other.unmount();
    // Kept with its day, and that day's alone, so what is kept is never more than a day's seasons.
    const kept = () =>
      JSON.parse(localStorage.getItem("lf_bridge_retries_v1") ?? "null") as unknown;
    expect(kept()).toEqual({ day: "2026-10-30", tries: { s1: 3, s2: 3 } });
    vi.setSystemTime(new Date("2026-10-31T16:00:00.000Z"));
    setup({ asker });
    await wait(800 + 5_000);
    expect(asked).toHaveLength(11);
    expect(kept()).toEqual({ day: "2026-10-31", tries: { s1: 1 } });
  });

  it("holds the day's count on the page where storage will not keep it or read it back", async () => {
    for (const method of ["setItem", "getItem"] as const) {
      const refused = vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("The quota has been exceeded.");
      });
      try {
        const { asked, asker } = unanswering();
        const { unmount } = setup({ asker });
        await wait(800 + 5_000 + 30_000 + 120_000 + 600_000 + 60 * 60_000);
        expect(asked, method).toHaveLength(4);
        unmount();
      } finally {
        refused.mockRestore();
      }
    }
  });

  it("leaves a timer retry that falls due while the page is hidden until it is shown, and then asks it once", async () => {
    const { asked, asker } = unanswering();
    setup({ asker });
    await settle();
    expect(asked).toHaveLength(1);
    act(() => shown("hidden"));
    // Its retry falls due, and an hour passes, hidden: nothing is sent.
    await wait(5_000);
    await wait(60 * 60_000);
    expect(asked).toHaveLength(1);
    // Shown an hour on, when being shown anew would ask too: the retry goes, and nothing beside it.
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(2);
    // Looked away and back at once, well inside the half minute its next wait takes: the retry just
    // sent is not sent again, which would start a second line of waits beside the first, and the
    // next falls due once.
    act(() => shown("hidden"));
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(2);
    await wait(30_000);
    expect(asked).toHaveLength(3);
    // Looked away for the two minutes its next wait takes: being shown anew asks nothing so soon
    // after a question, and the retry left waiting goes all the same, once.
    act(() => shown("hidden"));
    await wait(120_000);
    expect(asked).toHaveLength(3);
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(4);
    await wait(60_000);
    expect(asked).toHaveLength(4);
  });

  it("drops a retry left waiting for the page to be shown once the question it was for is gone", async () => {
    let answering = false;
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      return answering ? { kind: "league.bridge", ...ANSWER } : null;
    }) as LeagueAsker;
    const { rerender } = setup(props({ asker }));
    await settle();
    act(() => shown("hidden"));
    await wait(5_000);
    expect(asked).toHaveLength(1);
    // A team added meanwhile, as another device's change can be while the page is hidden: asked
    // about at once, as a change always is, and answered.
    answering = true;
    const more = [...TEAMS, { id: "lt2", name: "Owls" }];
    rerender(props({ asker, teams: more }));
    await settle();
    expect(asked).toHaveLength(2);
    // Shown: the retry for the teams before is not sent.
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("makes no timer retry while the server says the edits' month is spent, until New York's month turns", async () => {
    // Noon on the last day of October in New York.
    vi.setSystemTime(new Date("2026-10-31T16:00:00.000Z"));
    const { asked, asker, said } = unanswering({ month: { month: "2026-10", spent: true } });
    const start = Date.now();
    const upTo = (ms: number) => wait(start + ms - Date.now());
    setup({ asker });
    await upTo(12 * 60 * 60_000);
    expect(asked).toHaveLength(1);
    // Past midnight it is November there, whatever the server said of October: the waits that
    // went on send again, and the server's new month is not spent.
    said.month = { month: "2026-11", spent: false };
    await upTo(12.25 * 60 * 60_000);
    expect(asked.map((at) => at - start).slice(1)).toEqual([43_955_800]);
  });

  it("asks what a person's own doing asks while the edits' month is spent, and retries once a reply says it is not", async () => {
    const { asked, asker, said } = unanswering({ month: { month: "2026-10", spent: true } });
    const { rerender } = setup(props({ asker, signedIn: false }));
    await settle();
    await wait(60 * 60_000);
    expect(asked).toHaveLength(1);
    // Online again, and signed in: each asks, and nothing on a timer after it.
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(asked).toHaveLength(2);
    rerender(props({ asker, signedIn: true }));
    await settle();
    expect(asked).toHaveLength(3);
    await wait(60 * 60_000);
    expect(asked).toHaveLength(3);
    // A reply that says nothing of the month, from an older server or a charge the ledger was slow
    // to take, is not known: what was heard stands.
    said.month = null;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    await wait(60 * 60_000);
    expect(asked).toHaveLength(4);
    // One that says it is not spent, as once the owner raises a cap, lets the timer ask again.
    said.month = { month: "2026-10", spent: false };
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    await wait(5_000);
    expect(asked).toHaveLength(6);
  });

  it("still asks on the sign-in and the page shown anew past the day's three, and on a timer no more", async () => {
    const { asked, asker } = unanswering();
    const { rerender } = setup(props({ asker, signedIn: false }));
    await wait(800 + 5_000 + 30_000 + 120_000);
    expect(asked).toHaveLength(4);
    rerender(props({ asker, signedIn: true }));
    await settle();
    expect(asked).toHaveLength(5);
    // Put away and looked at again past the few minutes being shown anew waits.
    act(() => shown("hidden"));
    await wait(10 * 60_000);
    act(() => shown("visible"));
    await settle();
    expect(asked).toHaveLength(6);
    await wait(60 * 60_000);
    expect(asked).toHaveLength(6);
  });

  it("is asked again once the sign-in is ready, or the device is back online", async () => {
    // The first question goes out before the sign-in is ready (or offline): no answer comes.
    let ready = false;
    const asked: unknown[] = [];
    const asker = (async (query: { kind: string }) => {
      asked.push(query);
      if (!ready) return null;
      return query.kind === "league.bridge" ? { kind: "league.bridge", ...ANSWER } : null;
    }) as LeagueAsker;
    const { result } = setup({ asker });
    await settle();
    expect(asked).toHaveLength(1);
    expect(result.current.bridge.seasonLinked).toBe(false);
    // Online now; the tab stays in front and nothing about the season changes.
    ready = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(asked).toHaveLength(2);
    expect(result.current.bridge.seasonLinked).toBe(true);
  });

  it("asks again the moment the member's sign-in comes through", async () => {
    let ready = false;
    const asked: unknown[] = [];
    const asker = (async () => {
      asked.push(1);
      return ready ? { kind: "league.bridge", ...ANSWER } : null;
    }) as LeagueAsker;
    const { result, rerender } = setup(props({ asker, signedIn: false }));
    await settle();
    expect(asked).toHaveLength(1);
    ready = true;
    rerender(props({ asker, signedIn: true }));
    await settle();
    expect(asked).toHaveLength(2);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    // Signed in all along, nothing more is asked for it.
    rerender(props({ asker, signedIn: true }));
    await settle();
    expect(asked).toHaveLength(2);
  });

  /** The cloud copy as `copyAtNow` reads it, which can move or be unreadable, counting its reads. */
  const cloudCopy = () => {
    const state = { at: { copy: "c1", version: 5 } as CopyAt, readable: true, reads: 0 };
    const copyNow = async () => {
      state.reads += 1;
      return state.readable ? { ...state.at } : null;
    };
    return { state, copyNow };
  };
  /** A server whose answers name the copy they were worked out from, while `answering` says so. */
  const stamped = (copy: { at: CopyAt }, control = { answering: true, naming: true }) => {
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      if (query.kind === "league.clubs") return { kind: "league.clubs", clubs: CLUBS };
      if (!control.answering) return null;
      return {
        kind: "league.bridge",
        ...ANSWER,
        ...(control.naming ? { at: { ...copy.at } } : {}),
      };
    }) as LeagueAsker;
    return { asked, asker, control };
  };
  /** Off to Team Rankings and back, as the tabs do. */
  const roundTrip = (
    rerender: (next: Parameters<typeof useScoutBridge>[0]) => void,
    over: Partial<Parameters<typeof useScoutBridge>[0]>
  ) => {
    rerender(props({ ...over, leagueOnScreen: false }));
    rerender(props({ ...over, leagueOnScreen: true }));
  };

  it("asks again on coming back from Team Rankings only where the copy has moved since its answer", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const given = { asker, copyNow: copy.copyNow };
    const { result, rerender } = setup(props(given));
    await settle();
    // The visit's first question goes to the server without a read.
    expect(asked).toHaveLength(1);
    expect(copy.state.reads).toBe(0);
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(1);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    // A save since, the member's own on the cloud's board or anyone's: asked.
    copy.state.at = { copy: "c1", version: 6 };
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(2);
    expect(asked).toHaveLength(2);
  });

  it("asks where the copy was made anew under the same version", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const given = { asker, copyNow: copy.copyNow };
    const { rerender } = setup(props(given));
    await settle();
    copy.state.at = { copy: "c2", version: 5 };
    roundTrip(rerender, given);
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("asks where the copy cannot be read, or the answer named no copy", async () => {
    const copy = cloudCopy();
    const { asked, asker, control } = stamped(copy.state);
    const given = { asker, copyNow: copy.copyNow };
    const { rerender } = setup(props(given));
    await settle();
    // Unreadable on coming back: asked, and answered by a reply that names no copy.
    copy.state.readable = false;
    control.naming = false;
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(2);
    // That answer stands for no copy: the next return asks without a read.
    copy.state.readable = true;
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(3);
  });

  it("asks where reading the copy fails outright", async () => {
    const { asked, asker } = stamped({ at: { copy: "c1", version: 5 } });
    const given = {
      asker,
      copyNow: () => Promise.reject(new Error("timed out reading the cloud's copy")),
    };
    const { rerender } = setup(props(given));
    await settle();
    roundTrip(rerender, given);
    await settle();
    expect(asked).toHaveLength(2);
  });

  it("asks about a team renamed without reading the copy", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const { rerender } = setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    rerender(props({ asker, copyNow: copy.copyNow, teams: [{ id: "lt1", name: "Rays II" }] }));
    await settle();
    expect(copy.state.reads).toBe(0);
    expect(asked).toHaveLength(2);
  });

  it("reads the copy rather than ask for the same question handed over anew, or a season come back to", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const given = { asker, copyNow: copy.copyNow };
    const { rerender } = setup(props(given));
    await settle();
    rerender(props({ ...given, teams: [...TEAMS] }));
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(1);
    // Another season, asked about as its own; and back to the first, whose answer still stands.
    rerender(props({ ...given, activeSeasonId: "s2" }));
    await settle();
    expect(asked).toHaveLength(2);
    rerender(props(given));
    await settle();
    expect(copy.state.reads).toBe(2);
    expect(asked).toHaveLength(2);
  });

  it("reads the copy for the page shown anew at most once every few minutes", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    act(() => shown("hidden"));
    await wait(5 * 60_000);
    act(() => shown("visible"));
    await settle();
    expect(copy.state.reads).toBe(1);
    act(() => shown("hidden"));
    await wait(60_000);
    act(() => shown("visible"));
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(1);
  });

  it("holds a change noted while the copy is read until it is, then reads once more", async () => {
    let reads = 0;
    let release = () => {};
    const copyNow = () => {
      reads += 1;
      return new Promise<CopyAt | null>((resolve) => {
        release = () => resolve({ copy: "c1", version: 5 });
      });
    };
    const { asked, asker } = stamped({ at: { copy: "c1", version: 5 } });
    const given = { asker, copyNow };
    const { result, rerender } = setup(props(given));
    await settle();
    roundTrip(rerender, given);
    await settle();
    expect(reads).toBe(1);
    act(() => result.current.noteChange());
    await settle();
    expect(reads).toBe(1);
    await act(async () => release());
    await settle();
    expect(reads).toBe(2);
    await act(async () => release());
    await settle();
    expect(asked).toHaveLength(1);
  });

  it("ends the retries once the copy is read and found where the answer was", async () => {
    const copy = cloudCopy();
    const { asked, asker, control } = stamped(copy.state);
    const given = { asker, copyNow: copy.copyNow };
    const { rerender } = setup(props(given));
    await settle();
    // Back from Team Rankings with the copy unreadable: asked, and the server does not answer.
    copy.state.readable = false;
    control.answering = false;
    roundTrip(rerender, given);
    await settle();
    expect(asked).toHaveLength(2);
    // Readable by the first retry, and unmoved: the answer on hand stands, and nothing more asks.
    copy.state.readable = true;
    await wait(5_000);
    expect(copy.state.reads).toBe(2);
    await wait(60 * 60_000);
    expect(asked).toHaveLength(2);
  });

  it("reads nothing off League Standings for a question its bridge answers", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const { rerender } = setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    rerender(props({ asker, copyNow: copy.copyNow, leagueOnScreen: false, teams: [...TEAMS] }));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();
    expect(copy.state.reads).toBe(0);
    expect(asked).toHaveLength(1);
  });

  it("asks again once the server's day has turned, however still the copy", async () => {
    // 23:40 in New York: a game scored for tomorrow is not counted yet.
    vi.setSystemTime(new Date("2026-10-26T03:40:00.000Z"));
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const given = { asker, copyNow: copy.copyNow };
    const { rerender } = setup(props(given));
    await settle();
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(1);
    // Half an hour on it is tomorrow there, and the game counts: asked, with no save between.
    await wait(30 * 60_000);
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(2);
  });

  it("holds an answer asked for before the server's midnight and heard after it to the day before", async () => {
    // Sent at 23:59 in New York, and worked out by a server waking up for a minute.
    vi.setSystemTime(new Date("2026-10-26T03:59:00.000Z"));
    const copy = cloudCopy();
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return { kind: "league.bridge", ...ANSWER, at: { ...copy.state.at } };
    }) as LeagueAsker;
    const given = { asker, copyNow: copy.copyNow };
    const { result, rerender } = setup(props(given));
    await settle();
    await wait(60_000);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    // Heard after midnight, it may leave out a game that counts from today: asked again.
    roundTrip(rerender, given);
    await settle();
    expect(copy.state.reads).toBe(0);
    expect(asked).toHaveLength(2);
  });

  it("asks again a day after an answer, however still the copy", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    act(() => shown("hidden"));
    await wait(24 * 60 * 60_000);
    act(() => shown("visible"));
    await settle();
    expect(copy.state.reads).toBe(0);
    expect(asked).toHaveLength(2);
  });

  /** A bridge an earlier visit kept for `season`, with its question and the copy it came from. */
  const keepStamped = (
    season: string,
    at: Record<string, unknown> = {
      copy: "c1",
      version: 5,
      heard: Date.now(),
      rules: BRIDGE_RULES_NOW,
    }
  ) =>
    localStorage.setItem(
      "lf_league_bridge_v2",
      JSON.stringify({ [season]: { bridge: ANSWER.bridge, asked: askedFor(season), at } })
    );

  it("finds a visit's first question answered by the kept bridge where the copy has not moved", async () => {
    keepStamped("s1");
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const { result } = setup(props({ asker, copyNow: copy.copyNow }));
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toEqual([]);
    expect(result.current.unanswered).toBeUndefined();
    // Moved since: asked.
    copy.state.at = { copy: "c1", version: 6 };
    const later = setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    expect(asked).toHaveLength(1);
    later.unmount();
  });

  it("keeps the copy an answer came from with it, so the next visit asks nothing", async () => {
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const first = setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    first.unmount();
    expect(JSON.parse(localStorage.getItem("lf_league_bridge_v2") ?? "null")).toEqual({
      s1: {
        bridge: ANSWER.bridge,
        asked: askedFor("s1"),
        at: { copy: "c1", version: 5, heard: expect.any(Number), rules: BRIDGE_RULES_NOW },
      },
    });
    setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    expect(copy.state.reads).toBe(1);
    expect(asked).toHaveLength(1);
  });

  it("asks about a kept bridge with no copy kept beside it, and keeps one after", async () => {
    keepAnswered("s1", ANSWER.bridge);
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    expect(copy.state.reads).toBe(0);
    expect(asked).toHaveLength(1);
    expect(localStorage.getItem("lf_league_bridge_v2")).toContain(`"rules":"${BRIDGE_RULES_NOW}"`);
  });

  it("asks where the copy kept cannot be read whole, or no longer stands", async () => {
    // 10:00 in New York, so a stamp from 23:00 the evening before is another day's.
    vi.setSystemTime(new Date("2026-10-26T14:00:00.000Z"));
    const now = Date.now();
    const good = { copy: "c1", version: 5, heard: now - 60_000, rules: BRIDGE_RULES_NOW };
    for (const at of [
      { ...good, version: "5" },
      { ...good, version: -1 },
      { ...good, version: 1.5 },
      { ...good, copy: "" },
      { ...good, copy: undefined },
      { ...good, heard: "now" },
      { ...good, rules: 1 },
      { ...good, rules: "0.0" },
      { ...good, heard: now + 60_000 },
      { ...good, heard: Date.parse("2026-10-26T03:00:00.000Z") },
    ]) {
      localStorage.clear();
      keepStamped("s1", at);
      const copy = cloudCopy();
      const { asked, asker } = stamped(copy.state);
      const { result, unmount } = setup(props({ asker, copyNow: copy.copyNow }));
      expect(result.current.bridge).toEqual(ANSWER.bridge);
      await settle();
      expect({ at, asked: asked.length, reads: copy.state.reads }).toEqual({
        at,
        asked: 1,
        reads: 0,
      });
      unmount();
    }
  });

  it("asks for the clubs once the link panel opens, the kept answer standing all the same", async () => {
    keepStamped("s1");
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const { result } = setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    expect(asked).toEqual([]);
    expect(result.current.candidatesFor("Rays")).toEqual([]);
    act(() => result.current.wantLinks(true));
    await settle();
    expect(asked).toHaveLength(1);
    expect(copy.state.reads).toBe(1);
    expect(result.current.candidatesFor("Rays")).toEqual(ANSWER.candidates[0]?.clubs);
    // Closed and opened again with this visit's answer in: nothing more.
    act(() => result.current.wantLinks(false));
    act(() => result.current.wantLinks(true));
    await settle();
    expect(asked).toHaveLength(1);
    expect(copy.state.reads).toBe(1);
  });

  it("asks a visit's first question of the server while the link panel is open", async () => {
    keepStamped("s1");
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state);
    const { result } = setup(props({ asker, copyNow: copy.copyNow }));
    act(() => result.current.wantLinks(true));
    await settle();
    expect(copy.state.reads).toBe(0);
    expect(asked).toHaveLength(1);
  });

  it("ends the retries of a visit's first question once the copy is read and found unmoved", async () => {
    keepStamped("s1");
    const copy = cloudCopy();
    const { asked, asker } = stamped(copy.state, { answering: false, naming: true });
    // Signed in only later, as a slow boot is: the copy cannot be read yet, and the server is asked.
    copy.state.readable = false;
    setup(props({ asker, copyNow: copy.copyNow }));
    await settle();
    expect(asked).toHaveLength(1);
    copy.state.readable = true;
    await wait(5_000);
    expect(copy.state.reads).toBe(2);
    await wait(60 * 60_000);
    expect(asked).toHaveLength(1);
  });

  it("asks for the wide picker's clubs once a season, when it is first widened", async () => {
    const { asked, asker } = server();
    const { result } = setup({ asker });
    expect(result.current.wideOptions()).toEqual([]);
    await act(async () => result.current.wantWide(true));
    expect(result.current.wideOptions()).toEqual(CLUBS);
    await act(async () => result.current.wantWide(true));
    expect(asked.filter((query) => query.kind === "league.clubs")).toEqual([
      { kind: "league.clubs", season: "s1" },
    ]);
  });

  it("asks for another season's clubs by itself while the wide list is wanted", async () => {
    const { asked, asker } = server();
    const { result, rerender } = setup({ asker });
    await act(async () => result.current.wantWide(true));
    rerender(props({ asker, activeSeasonId: "s2" }));
    // Not the first season's clubs, while the second's are asked for.
    expect(result.current.wideOptions()).toEqual([]);
    expect(result.current.wideStatus).toBe("asking");
    await act(async () => {});
    expect(result.current.wideOptions()).toEqual(CLUBS);
    expect(result.current.wideStatus).toBeUndefined();
    // Not wanted, a season switched to asks for none.
    await act(async () => result.current.wantWide(false));
    rerender(props({ asker, activeSeasonId: "s3" }));
    await act(async () => {});
    expect(asked.filter((query) => query.kind === "league.clubs")).toEqual([
      { kind: "league.clubs", season: "s1" },
      { kind: "league.clubs", season: "s2" },
    ]);
  });

  it("says when the wide list could not be asked for, and asks again when wanted again", async () => {
    let answering = false;
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      if (query.kind !== "league.clubs") return null;
      return answering ? { kind: "league.clubs", clubs: CLUBS } : null;
    }) as LeagueAsker;
    const { result } = setup({ asker });
    await act(async () => result.current.wantWide(true));
    expect(result.current.wideStatus).toBe("failed");
    expect(result.current.wideOptions()).toEqual([]);
    answering = true;
    await act(async () => result.current.wantWide(true));
    expect(result.current.wideStatus).toBeUndefined();
    expect(result.current.wideOptions()).toEqual(CLUBS);
    expect(asked.filter((query) => query.kind === "league.clubs")).toHaveLength(2);
  });

  it("reads nothing of this device's pool while the server is asked", async () => {
    saveAgeGroups([group("ag", ["s1"])]);
    saveScoutTeams([club("c1")]);
    const reads = [loadAgeGroups, loadScoutTeams, loadScoutGamesForSeason].map((read) =>
      vi.mocked(read)
    );
    reads.forEach((read) => read.mockClear());
    const { asker } = server({ answer: null });
    const { result } = setup({ asker });
    act(() => result.current.noteChange());
    expect(result.current.bridge.seasonLinked).toBe(false);
    expect(result.current.wideOptions()).toEqual([]);
    expect(result.current.candidatesFor("c1")).toEqual([]);
    await settle();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });
});
