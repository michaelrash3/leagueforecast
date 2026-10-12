import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRankingsWorker } from "./useRankingsWorker";
import { loadSavedBoard, resetSavedBoard, saveBoard } from "../lib/savedBoard";
import { forgetLiveBoard, holdLiveBoard } from "../lib/live/liveBoard";
import { daysBefore } from "../lib/rankMovement";
import { todayIsoDay } from "../lib/date";
import type { AgeGroup, ScoutGame, ScoutRankingRow, ScoutTeam } from "../lib/teamRankings";
import type {
  MovementRequest,
  RankingsRequest,
  WhatIfRequest,
  WorkerRequest,
  WorkerResponse,
} from "../workers/rankingsProtocol";

/** A worker that records what it is sent and answers only when the test says so. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: WorkerRequest[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor() {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  postMessage(message: WorkerRequest) {
    this.posted.push(message);
  }
  terminate() {}
  reply(data: WorkerResponse) {
    this.listeners.get("message")?.forEach((listener) => listener({ data }));
  }
}

const groups: AgeGroup[] = [
  { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "u11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];
/** Over the inline limit, so the hook goes to the worker at all. */
const teams: ScoutTeam[] = Array.from({ length: 450 }, (_, i) => ({
  id: `S-${i}`,
  name: `Club ${i}`,
}));
const games: ScoutGame[] = Array.from({ length: 40 }, (_, i) => ({
  id: `g${i}`,
  teamAId: `S-${i}`,
  teamBId: `S-${i + 1}`,
  ageGroupId: "u10",
  teamAScore: 5,
  teamBScore: 3,
  date: "2026-09-05",
}));

const fits = (worker: FakeWorker): RankingsRequest[] =>
  worker.posted.filter((message): message is RankingsRequest => message.kind === "rankings");

/** The newest of a list: the worker made last, or the request posted last. */
const last = <T,>(items: readonly T[]): T => items[items.length - 1]!;

const whatIfs = (worker: FakeWorker): WhatIfRequest[] =>
  worker.posted.filter((message): message is WhatIfRequest => message.kind === "what-if");

/** A fixture with no score, which is what a game still to be played looks like. */
const upcoming: ScoutGame = {
  id: "next",
  teamAId: "S-0",
  teamBId: "S-5",
  ageGroupId: "u10",
  date: "2026-11-01",
};
/** A second one, so a reader can move from one fixture to another. */
const alsoUpcoming: ScoutGame = { ...upcoming, id: "after", teamBId: "S-7", date: "2026-11-08" };

/** Lets the debounce elapse. */
const settle = () => {
  act(() => {
    vi.advanceTimersByTime(300);
  });
};

type Props = {
  ageGroupId: string;
  games?: ScoutGame[];
  segment?: "fall" | "spring";
  myTeamId?: string;
  liveStandIn?: boolean;
};
const render = (initial: Props) =>
  renderHook(
    (props: Props) =>
      useRankingsWorker({
        ageGroupId: props.ageGroupId,
        teams,
        games: props.games ?? games,
        ageGroups: groups,
        ...(props.segment === undefined ? {} : { segment: props.segment }),
        ...(props.myTeamId === undefined ? {} : { myTeamId: props.myTeamId }),
        ...(props.liveStandIn ? { liveStandIn: true } : {}),
      }),
    { initialProps: initial }
  );

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  resetSavedBoard();
  forgetLiveBoard();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("what the rankings hook sends its worker", () => {
  it("ships the pool once, then only names it", () => {
    const { rerender } = render({ ageGroupId: "u10" });
    settle();
    const worker = FakeWorker.instances[0]!;
    const first = fits(worker)[0]!;
    expect(first.pool.teams).toBeDefined();
    expect(first.pool.games).toBeDefined();

    // Another page of the same pool: the same revision, and not a team or a game on the wire.
    rerender({ ageGroupId: "u11" });
    settle();
    const second = fits(worker)[1]!;
    expect(second.ageGroupId).toBe("u11");
    expect(second.pool).toEqual({ revision: first.pool.revision });
  });

  it("ships the pool again when the games change", () => {
    const { rerender } = render({ ageGroupId: "u10" });
    settle();
    const worker = FakeWorker.instances[0]!;
    const first = fits(worker)[0]!;

    rerender({ ageGroupId: "u10", games: [...games] });
    settle();
    const second = fits(worker)[1]!;
    expect(second.pool.games).toBeDefined();
    expect(second.pool.revision).toBe(first.pool.revision + 1);
  });

  it("ships the pool when the worker says it does not have it", () => {
    render({ ageGroupId: "u10" });
    settle();
    const worker = FakeWorker.instances[0]!;
    const first = fits(worker)[0]!;

    act(() => {
      worker.reply({ kind: "pool-needed", id: first.id, revision: first.pool.revision });
    });
    const again = fits(worker)[1]!;
    expect(again.id).toBe(first.id);
    expect(again.pool.teams).toBeDefined();
    expect(again.pool.revision).toBe(first.pool.revision + 1);
  });

  it("passes the half of the year along, so a big pool follows the tab too", () => {
    render({ ageGroupId: "u10", segment: "fall" });
    settle();
    const worker = FakeWorker.instances[0]!;
    expect(fits(worker)[0]?.segment).toBe("fall");
  });
});

/*
 * A what-if is a place in a table. Which table matters: while the board is catching up, the rows
 * on screen were built from a pool that has already moved on, and a place in the new one placed
 * beside them would be two answers about two different tables sitting in the same panel.
 */
describe("when the hook asks its worker for a what-if", () => {
  const ask = { forTeamId: "S-0", gameId: "next", today: "2026-09-20" };

  it("waits for the board to settle, then asks", () => {
    const { result } = render({ ageGroupId: "u10", games: [...games, upcoming] });
    settle();
    const worker = FakeWorker.instances[0]!;
    const fit = fits(worker)[0]!;

    act(() => result.current.askWhatIf(ask));
    settle();
    // The board has been asked for but has not come back, so there is nothing to be placed in.
    expect(whatIfs(worker)).toHaveLength(0);
    expect(result.current.whatIf.status).toBe("working");

    act(() => {
      worker.reply({ kind: "rankings", id: fit.id, rows: [], elapsedMs: 1 });
    });
    settle();
    expect(whatIfs(worker)).toHaveLength(1);
    expect(whatIfs(worker)[0]).toMatchObject({
      gameId: "next",
      forTeamId: "S-0",
      today: "2026-09-20",
    });
  });

  it("names the pool by revision rather than shipping it a second time", () => {
    const { result } = render({ ageGroupId: "u10", games: [...games, upcoming] });
    settle();
    const worker = FakeWorker.instances[0]!;
    const fit = fits(worker)[0]!;
    act(() => {
      worker.reply({ kind: "rankings", id: fit.id, rows: [], elapsedMs: 1 });
    });

    act(() => result.current.askWhatIf(ask));
    settle();
    expect(whatIfs(worker)[0]!.pool).toEqual({ revision: fit.pool.revision });
  });

  it("puts an answer it has away when the reader closes it", () => {
    const { result } = render({ ageGroupId: "u10", games: [...games, upcoming] });
    settle();
    const worker = FakeWorker.instances[0]!;
    const fit = fits(worker)[0]!;
    act(() => {
      worker.reply({ kind: "rankings", id: fit.id, rows: [], elapsedMs: 1 });
    });

    act(() => result.current.askWhatIf(ask));
    settle();
    act(() => {
      worker.reply({
        kind: "what-if",
        id: whatIfs(worker)[0]!.id,
        curve: {
          gameId: "next",
          forTeamId: "S-0",
          points: [{ margin: 1, rank: 4, rating: 0.5 }],
          winRecord: "2-0",
          lossRecord: "1-1",
          rankedCount: 10,
        },
        elapsedMs: 1,
      });
    });
    // There is a real answer on screen before it is closed, which is the only way closing it can
    // be tested at all.
    expect(result.current.whatIf.status).toBe("ready");

    act(() => result.current.askWhatIf(null));
    expect(result.current.whatIf.status).toBe("idle");
  });

  it("does not show one fixture's answer against another fixture", () => {
    const { result } = render({
      ageGroupId: "u10",
      games: [...games, upcoming, alsoUpcoming],
    });
    settle();
    const worker = FakeWorker.instances[0]!;
    const fit = fits(worker)[0]!;
    act(() => {
      worker.reply({ kind: "rankings", id: fit.id, rows: [], elapsedMs: 1 });
    });

    act(() => result.current.askWhatIf(ask));
    settle();
    act(() => {
      worker.reply({
        kind: "what-if",
        id: whatIfs(worker)[0]!.id,
        curve: {
          gameId: "next",
          forTeamId: "S-0",
          points: [{ margin: 1, rank: 4, rating: 0.5 }],
          winRecord: "2-0",
          lossRecord: "1-1",
          rankedCount: 10,
        },
        elapsedMs: 1,
      });
    });
    expect(result.current.whatIf.status).toBe("ready");

    // The reader opens the next game on the schedule. The places for the last one are not an
    // answer about this one, and showing them for even a moment would be showing the wrong table.
    act(() => result.current.askWhatIf({ ...ask, gameId: "after" }));
    expect(result.current.whatIf.status).toBe("working");
  });
});

/*
 * The first fit after an open is seconds of work on a nationwide pool. The board last fitted is kept
 * (`savedBoard.ts`) and shown until this open's own fit lands, marked stale as any refit is, and
 * only on the page it was fitted for.
 */
describe("opening on the board last fitted", () => {
  /** A whole row, as the worker sends: the saved board keeps nothing less. */
  const row = (teamId: string, rank: number, rating: number): ScoutRankingRow => ({
    teamId,
    teamName: teamId,
    isMine: false,
    rank,
    rating,
    pointRating: rating + 0.5,
    record: "3-1",
    wins: 3,
    losses: 1,
    ties: 0,
    games: 4,
    rawMargin: 2,
    strengthOfSchedule: 0.4,
    sosRank: rank,
    crossAgeGames: 0,
    componentSize: 2,
    componentId: "S-1",
    comparable: true,
    fromGameChanger: true,
  });
  const lastVisit = [row("S-1", 1, 4.2), row("S-2", 2, 1.1)];

  /** A visit that fits `page` and leaves, keeping its board. */
  const visit = (page: Props, rows: ScoutRankingRow[]) => {
    const { unmount } = render(page);
    settle();
    const worker = last(FakeWorker.instances);
    act(() => {
      worker.reply({ kind: "rankings", id: last(fits(worker)).id, rows, elapsedMs: 1 });
    });
    unmount();
  };

  it("shows last visit's rows at once, stale, until its own fit replaces them", () => {
    visit({ ageGroupId: "u10" }, lastVisit);

    const { result } = render({ ageGroupId: "u10" });
    expect(result.current.rows).toEqual(lastVisit);
    expect(result.current.stale).toBe(true);

    settle();
    const worker = last(FakeWorker.instances);
    const fresh = [row("S-2", 1, 3.3), row("S-1", 2, 2.2)];
    act(() => {
      worker.reply({ kind: "rankings", id: last(fits(worker)).id, rows: fresh, elapsedMs: 1 });
    });
    expect(result.current.rows).toEqual(fresh);
    expect(result.current.stale).toBe(false);
  });

  it("shows no board kept for another page, half or club", () => {
    visit({ ageGroupId: "u10" }, lastVisit);
    for (const other of [
      { ageGroupId: "u11" },
      { ageGroupId: "u10", segment: "fall" as const },
      { ageGroupId: "u10", myTeamId: "S-3" },
    ]) {
      const { result, unmount } = render(other);
      expect(result.current.rows).toEqual([]);
      unmount();
    }
  });

  it("keeps the latest board only", () => {
    visit({ ageGroupId: "u10" }, lastVisit);
    visit({ ageGroupId: "u11" }, [row("S-9", 1, 0.5)]);
    expect(render({ ageGroupId: "u11" }).result.current.rows).toEqual([row("S-9", 1, 0.5)]);
    expect(render({ ageGroupId: "u10" }).result.current.rows).toEqual([]);
  });

  it("reads a kept board back, on the next open, as it was written", async () => {
    const kept = new Map<string, unknown>();
    const io = {
      get: async (key: string) => kept.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        kept.set(key, structuredClone(value));
        return true;
      },
    };
    saveBoard({ ageGroupId: "u11" }, lastVisit, io);
    // A new open: nothing in memory until the store is read.
    resetSavedBoard();
    expect(render({ ageGroupId: "u11" }).result.current.rows).toEqual([]);
    await loadSavedBoard(io);
    expect(render({ ageGroupId: "u11" }).result.current.rows).toEqual(lastVisit);
  });

  const omit = (whole: ScoutRankingRow, field: keyof ScoutRankingRow): Record<string, unknown> =>
    Object.fromEntries(Object.entries(whole).filter(([key]) => key !== field));

  it("reads back a row without the fields a row may go without", async () => {
    const kept = [{ ...row("S-1", 1, 2), overallRank: 4, ageLevel: 10 }, row("S-2", 2, 1)];
    await loadSavedBoard({
      get: async () => ({ page: JSON.stringify(["u10", "", ""]), rows: kept }),
      set: async () => true,
    });
    expect(render({ ageGroupId: "u10" }).result.current.rows).toEqual(kept);
  });

  it("opens on nothing when what the store holds is not a board", async () => {
    const here = JSON.stringify(["u10", "", ""]);
    for (const held of [
      null,
      "board",
      { page: 3, rows: [] },
      { page: here, rows: "rows" },
      // This page's, but rows that are not a board's rows.
      { page: here, rows: [{ rank: 1, rating: 2, teamName: "Aces" }] },
      { page: here, rows: [{ ...row("S-1", 1, 2), rank: "1" }] },
      // Cut short, or kept by a build whose rows had no `pointRating`: the board reads it on every
      // row (`formatRating(row.pointRating)`), and threw on this one.
      { page: here, rows: [row("S-1", 1, 2), omit(row("S-2", 2, 1), "pointRating")] },
      { page: here, rows: [omit(row("S-1", 1, 2), "fromGameChanger")] },
      // A field the row may go without is still held to its type when it is there.
      { page: here, rows: [{ ...row("S-1", 1, 2), ageLevel: "10" }] },
    ]) {
      await loadSavedBoard({ get: async () => held, set: async () => true });
      const { result, unmount } = render({ ageGroupId: "u10" });
      expect(result.current.rows).toEqual([]);
      unmount();
    }
    await loadSavedBoard({
      get: async () => {
        throw new Error("store gone");
      },
      set: async () => true,
    });
    expect(render({ ageGroupId: "u10" }).result.current.rows).toEqual([]);
  });
});

describe("opening on the board the live page drew", () => {
  const row = (teamId: string, rank: number): ScoutRankingRow => ({
    teamId,
    teamName: teamId,
    isMine: false,
    rank,
    rating: 5 - rank,
    pointRating: 6 - rank,
    record: "3-1",
    wins: 3,
    losses: 1,
    ties: 0,
    games: 4,
    rawMargin: 2,
    strengthOfSchedule: 0.4,
    sosRank: rank,
    crossAgeGames: 0,
    componentSize: 2,
    componentId: "S-1",
    comparable: true,
    fromGameChanger: true,
  });
  /** A published board's rows: no star, and what it says of its clubs. */
  const published = [row("S-1", 1), row("S-2", 2)].map(({ isMine: _mine, ...bare }) => ({
    ...bare,
    state: "OH",
  }));
  const savedRows = [row("S-9", 1)];

  it("shows the published board in place of the saved one, stale, until its own fit lands", () => {
    saveBoard({ ageGroupId: "u10" }, savedRows, { get: async () => null, set: async () => true });
    holdLiveBoard({ ageGroupId: "u10" }, published);
    const { result, rerender } = render({ ageGroupId: "u10", liveStandIn: true });
    expect(result.current.rows).toEqual(published.map((one) => ({ ...one, isMine: false })));
    expect(result.current.stale).toBe(true);
    expect(result.current.standIn).toBe("live");
    // The same rows for the same board and star, render after render.
    const first = result.current.rows;
    rerender({ ageGroupId: "u10", liveStandIn: true });
    expect(result.current.rows).toBe(first);

    settle();
    const worker = last(FakeWorker.instances);
    const fresh = [row("S-2", 1), row("S-1", 2)];
    act(() => {
      worker.reply({ kind: "rankings", id: last(fits(worker)).id, rows: fresh, elapsedMs: 1 });
    });
    expect(result.current.rows).toEqual(fresh);
    expect(result.current.stale).toBe(false);
    expect(result.current.standIn).toBeNull();
  });

  it("stars the page's own club, or where it names none the roster's, as the worker does", () => {
    holdLiveBoard({ ageGroupId: "u10" }, published);
    const mine = render({ ageGroupId: "u10", myTeamId: "S-2", liveStandIn: true }).result.current
      .rows;
    expect(mine.map((one) => one.isMine)).toEqual([false, true]);
    const starred = teams.map((team) => (team.id === "S-1" ? { ...team, isMine: true } : team));
    const { result } = renderHook(() =>
      useRankingsWorker({
        ageGroupId: "u10",
        teams: starred,
        games,
        ageGroups: groups,
        liveStandIn: true,
      })
    );
    expect(result.current.rows.map((one) => one.isMine)).toEqual([true, false]);
  });

  it("is not shown for another page or half, which fall back to the saved board", () => {
    saveBoard({ ageGroupId: "u10", segment: "fall" }, savedRows, {
      get: async () => null,
      set: async () => true,
    });
    holdLiveBoard({ ageGroupId: "u10" }, published);
    const fall = render({ ageGroupId: "u10", segment: "fall", liveStandIn: true }).result.current;
    expect(fall.rows).toEqual(savedRows);
    expect(fall.standIn).toBe("saved");
    const other = render({ ageGroupId: "u11", liveStandIn: true }).result.current;
    expect(other.rows).toEqual([]);
    expect(other.standIn).toBeNull();
  });

  it("is not shown on a page opened the old way, which the saved board stands in for", () => {
    saveBoard({ ageGroupId: "u10" }, savedRows, { get: async () => null, set: async () => true });
    holdLiveBoard({ ageGroupId: "u10" }, published);
    const opened = render({ ageGroupId: "u10" }).result.current;
    expect(opened.rows).toEqual(savedRows);
    expect(opened.standIn).toBe("saved");
  });
});

describe("the rank line it walks", () => {
  const movements = (worker: FakeWorker): MovementRequest[] =>
    worker.posted.filter((message): message is MovementRequest => message.kind === "movement");

  it("walks on past a week its club was missing from when the club was on last week's board", () => {
    const { result } = render({ ageGroupId: "u10", myTeamId: "S-3" });
    settle();
    const worker = last(FakeWorker.instances);
    act(() => {
      worker.reply({ kind: "rankings", id: last(fits(worker)).id, rows: [], elapsedMs: 1 });
    });
    settle();
    const reply = (ranks: Record<string, number>) =>
      act(() => {
        const asked = last(movements(worker));
        worker.reply({
          kind: "movement",
          id: asked.id,
          asOf: asked.asOf,
          ranks,
          empty: false,
          elapsedMs: 1,
        });
      });
    // Last week the club had a place; the week before it had none, on a board others were on.
    reply({ "S-3": 5, "S-1": 1 });
    reply({});
    // One week without it is not two running, last week counting as the first: one more is asked.
    expect(movements(worker)).toHaveLength(3);
    expect(last(movements(worker))).toMatchObject({
      asOf: daysBefore(todayIsoDay(), 21),
      teamIds: ["S-3"],
    });
    reply({});
    expect(movements(worker)).toHaveLength(3);
    expect(result.current.history).toEqual([
      { asOf: daysBefore(todayIsoDay(), 21), rank: null },
      { asOf: daysBefore(todayIsoDay(), 14), rank: null },
      { asOf: daysBefore(todayIsoDay(), 7), rank: 5 },
    ]);
  });
});
