import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRankingsWorker } from "./useRankingsWorker";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";
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

type Props = { ageGroupId: string; games?: ScoutGame[]; segment?: "fall" | "spring" };
const render = (initial: Props) =>
  renderHook(
    (props: Props) =>
      useRankingsWorker({
        ageGroupId: props.ageGroupId,
        teams,
        games: props.games ?? games,
        ageGroups: groups,
        ...(props.segment === undefined ? {} : { segment: props.segment }),
      }),
    { initialProps: initial }
  );

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
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
