import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScoutBridge } from "./useScoutBridge";
import type { AgeGroup, ScoutTeam } from "../lib/teamRankings";
import { resetTeamRankingsStore, saveAgeGroups, saveScoutTeams } from "../lib/teamRankingsStorage";

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
    const before = result.current.allClubs;
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
    expect(result.current.allClubs).not.toBe(before);
    expect(result.current.candidatesFor).not.toBe(search);
    expect(result.current.allClubs().map((team) => team.id)).toEqual(["c1"]);
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

    expect(result.current.allClubs().map((team) => team.id)).toEqual(["linked"]);
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
