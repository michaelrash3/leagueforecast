import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keptBridge, useScoutBridge } from "./useScoutBridge";
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

  /** A server that answers what it is asked, held until let go where `holding`. */
  const server = ({ answer = ANSWER as LeagueBridgeAnswer | null } = {}) => {
    const asked: QueryOf<"league.bridge" | "league.clubs" | "league.fill">[] = [];
    const asker = (async (query: QueryOf<"league.bridge" | "league.clubs" | "league.fill">) => {
      asked.push(query);
      if (query.kind === "league.clubs") return { kind: "league.clubs", clubs: CLUBS };
      return answer && { kind: "league.bridge", ...answer };
    }) as LeagueAsker;
    return { asked, asker };
  };
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
  /** An answer an earlier visit kept for `season`. */
  const keepAnswer = (season: string, answer: LeagueBridgeAnswer) =>
    localStorage.setItem("lf_league_bridge_v1", JSON.stringify({ [season]: answer }));

  beforeEach(() => {
    localStorage.clear();
    resetTeamRankingsStore();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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

  it("keeps the answer for the next visit, and reads it before the server answers", async () => {
    const { asker } = server();
    const first = setup({ asker });
    await settle();
    first.unmount();
    expect(keptBridge("s1")).toEqual(ANSWER);
    // Offline now: nothing comes, and what was kept stands.
    const offline = server({ answer: null });
    const { result } = setup({ asker: offline.asker });
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(offline.asked).toHaveLength(1);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
  });

  it("reads a kept answer only whole, as one from the network is read", () => {
    const leaning = {
      ...ANSWER,
      bridge: { ...ANSWER.bridge, results: [{ ...ANSWER.bridge.results[0], neutral: false }] },
    };
    for (const kept of [leaning, { bridge: ANSWER.bridge }, "not one"]) {
      localStorage.setItem("lf_league_bridge_v1", JSON.stringify({ s1: kept }));
      expect(keptBridge("s1")).toBeNull();
      const { asker } = server({ answer: null });
      const { result, unmount } = setup({ asker });
      expect(result.current.bridge.seasonLinked).toBe(false);
      unmount();
    }
    localStorage.setItem("lf_league_bridge_v1", "{not json");
    expect(keptBridge("s1")).toBeNull();
  });

  it("reads the server's answer over the one it kept, once it comes", async () => {
    keepAnswer("s1", ANSWER);
    const fresh: LeagueBridgeAnswer = {
      ...ANSWER,
      bridge: { ...ANSWER.bridge, results: [], countedResults: 0 },
    };
    const { asker } = server({ answer: fresh });
    const { result } = setup({ asker });
    expect(result.current.bridge).toEqual(ANSWER.bridge);
    await settle();
    expect(result.current.bridge).toEqual(fresh.bridge);
    expect(keptBridge("s1")).toEqual(fresh);
  });

  it("keeps the last few seasons' answers, and this season's alone when storage is full", async () => {
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
    // Room for one season's answer and no more.
    const room = JSON.stringify({ s6: ANSWER }).length;
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
    expect(keptBridge("s6")).toEqual(ANSWER);
    expect(keptBridge("s5")).toBeNull();
  });

  it("asks only once the season's teams stand still, for the teams as they then stand", async () => {
    const { asked, asker } = server();
    const props = (name: string) => ({
      activeSeasonId: "s1",
      teams: [{ id: "lt1", name }],
      seasonFixtures: [],
      useScoutResults: true,
      onLink: vi.fn(),
      asker,
    });
    const { rerender } = setup(props("Ra"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    rerender(props("Ray"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    rerender(props("Rays"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(asked).toEqual([]);
    await settle();
    expect(asked).toEqual([
      { kind: "league.bridge", season: "s1", teams: [{ id: "lt1", name: "Rays" }], fixtures: [] },
    ]);
  });

  it("asks again when the page is looked at anew, and not when it is put away", async () => {
    const { asked, asker } = server();
    setup({ asker });
    await settle();
    const shown = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    act(() => shown("hidden"));
    await settle();
    expect(asked).toHaveLength(1);
    act(() => shown("visible"));
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
    rerender({
      activeSeasonId: "s1",
      teams: [{ id: "lt1", name: "Rays", scoutTeamId: "S-R" }],
      seasonFixtures: [],
      useScoutResults: true,
      onLink: vi.fn(),
      asker,
    });
    await act(async () => letGo());
    // The first answer was for the Rays unpicked: not this season's as it stands.
    expect(result.current.bridge.seasonLinked).toBe(false);
    await settle();
    expect(asked).toHaveLength(2);
    expect(result.current.bridge).toEqual(ANSWER.bridge);
  });

  it("asks for the wide picker's clubs once a season, when it is first widened", async () => {
    const { asked, asker } = server();
    const { result } = setup({ asker });
    expect(result.current.wideOptions()).toEqual([]);
    await act(async () => result.current.wantWide());
    expect(result.current.wideOptions()).toEqual(CLUBS);
    await act(async () => result.current.wantWide());
    expect(asked.filter((query) => query.kind === "league.clubs")).toEqual([
      { kind: "league.clubs", season: "s1" },
    ]);
  });

  it("lists no season's clubs for another, until that season's are asked for", async () => {
    const { asked, asker } = server();
    const { result, rerender } = setup({ asker });
    await act(async () => result.current.wantWide());
    rerender({
      activeSeasonId: "s2",
      teams: [{ id: "lt1", name: "Rays" }],
      seasonFixtures: [],
      useScoutResults: true,
      onLink: vi.fn(),
      asker,
    });
    expect(result.current.wideOptions()).toEqual([]);
    await act(async () => result.current.wantWide());
    expect(result.current.wideOptions()).toEqual(CLUBS);
    expect(asked.filter((query) => query.kind === "league.clubs")).toEqual([
      { kind: "league.clubs", season: "s1" },
      { kind: "league.clubs", season: "s2" },
    ]);
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
