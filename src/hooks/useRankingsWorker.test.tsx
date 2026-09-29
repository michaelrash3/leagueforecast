import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRankingsWorker } from "./useRankingsWorker";
import { loadSavedBoard, resetSavedBoard, saveBoard } from "../lib/savedBoard";
import type { AgeGroup, ScoutGame, ScoutRankingRow, ScoutTeam } from "../lib/teamRankings";
import type {
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
      }),
    { initialProps: initial }
  );

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  resetSavedBoard();
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
  const row = (teamId: string, rank: number, rating: number): ScoutRankingRow =>
    ({ teamId, teamName: teamId, rank, rating }) as ScoutRankingRow;
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

  it("opens on nothing when what the store holds is not a board", async () => {
    const here = JSON.stringify(["u10", "", ""]);
    for (const held of [
      null,
      "board",
      { page: 3, rows: [] },
      { page: here, rows: "rows" },
      // This page's, but rows that are not a board's rows.
      { page: here, rows: [{ rank: 1, rating: 2, teamName: "Aces" }] },
      { page: here, rows: [{ teamId: "S-1", rank: "1", rating: 2, teamName: "Aces" }] },
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
