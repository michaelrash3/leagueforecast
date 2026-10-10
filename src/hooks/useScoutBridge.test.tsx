import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keptBridge, useScoutBridge, type SeasonFixture } from "./useScoutBridge";
import type { LeagueBridgeAnswer } from "../lib/live/leagueAnswers";
import type { LeagueAsker } from "../lib/live/leagueAsk";
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
  /** A bridge an earlier visit kept for `season`. */
  const keepBridge = (season: string, bridge: LeagueBridgeAnswer["bridge"]) =>
    localStorage.setItem("lf_league_bridge_v2", JSON.stringify({ [season]: bridge }));
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
    // The clock too, since being shown anew asks at most once every few minutes.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
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

  it("keeps the bridge alone for the next visit, and reads it before the server answers", async () => {
    const { asker } = server();
    const first = setup({ asker });
    await settle();
    first.unmount();
    // The clubs each team could be are this visit's alone: the bridge is all that is kept.
    expect(JSON.parse(localStorage.getItem("lf_league_bridge_v2") ?? "null")).toEqual({
      s1: ANSWER.bridge,
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
    for (const kept of [leaning, { ...ANSWER.bridge, rows: "none" }, ANSWER, "not one"]) {
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
    // Room for one season's bridge and no more.
    const room = JSON.stringify({ s6: ANSWER.bridge }).length;
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

  it("asks again after 5 s, 30 s, and then every 2 minutes, until it is answered", async () => {
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
    await wait(120_000);
    expect(asked.map((at) => at - start)).toEqual([800, 5_800, 35_800, 155_800, 275_800]);
    answering = true;
    await wait(120_000);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    expect(result.current.unanswered).toBeUndefined();
    await wait(10 * 60_000);
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
