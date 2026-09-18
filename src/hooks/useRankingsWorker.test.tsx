import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRankingsWorker } from "./useRankingsWorker";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";
import type { RankingsRequest, WorkerRequest, WorkerResponse } from "../workers/rankingsProtocol";

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
