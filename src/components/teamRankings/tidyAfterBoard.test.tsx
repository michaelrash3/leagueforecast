import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import { loadTidyStamp } from "../../lib/teamRankingsStorage";

/*
 * The tidy on open waits for the page's first board. Handing it the pool is a second copy of all
 * of it made on the page's own thread, and made while the rankings were asking for theirs it put
 * the rows back by a second on a nationwide pool. A board still being fitted says so rather than
 * telling the user to add a game.
 *
 * The board is held back here by standing in front of the rankings hook: while `board.held`, it
 * answers as a first fit still under way does, with no rows and marked stale.
 */
const board = vi.hoisted(() => ({ held: true, listeners: new Set<() => void>() }));
const releaseBoard = () => {
  board.held = false;
  board.listeners.forEach((listener) => listener());
};

vi.mock("../../hooks/useRankingsWorker", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../hooks/useRankingsWorker")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    board.listeners.add(listener);
    return () => board.listeners.delete(listener);
  };
  return {
    ...real,
    useRankingsWorker: (input: Parameters<typeof real.useRankingsWorker>[0]) => {
      const answer = real.useRankingsWorker(input);
      const held = useSyncExternalStore(subscribe, () => board.held);
      return held ? { ...answer, rows: [], stale: true } : answer;
    },
  };
});

afterEach(() => {
  board.held = true;
});

/** A stand-in row the other club's schedule names: the tidy's first pass has work to do. */
const untidiedPool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-HOME", "Home Club", { state: "KY" }),
    team("S-AWAY", "Away Club", { state: "KY" }),
    team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
  ],
  games: [
    game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
      date: seasonDate(2027),
      source: { kind: "gamechanger" as const, teamId: "gcHOME", gameId: "n1" },
    }),
    game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
      date: seasonDate(2027),
      source: { kind: "gamechanger" as const, teamId: "gcAWAY", gameId: "s1" },
    }),
  ],
  untidied: true,
});

describe("opening on a pool the tidy has not seen", () => {
  it("shows the board first, and tidies once it is up", async () => {
    const harness = renderTeamRankings(untidiedPool());

    // The first fit is still out: the board says so, and the tidy has not started.
    expect(await screen.findByText("Ranking the teams…")).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(harness.toasts()).toEqual([]);
    expect(loadTidyStamp()).toBeNull();

    act(() => releaseBoard());
    await waitFor(() =>
      expect(harness.toasts().join(" ")).toMatch(
        /placeholder named from the other team's schedule/i
      )
    );
    expect(loadTidyStamp()).toBeTruthy();
    expect(screen.queryByText("Ranking the teams…")).toBeNull();
  });
});
