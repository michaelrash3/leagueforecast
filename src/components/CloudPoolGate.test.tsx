import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStatus } from "../lib/cloud/cloudSession";
import { resetPoolFill, startPoolFill } from "../lib/poolFill";

/*
 * Team Rankings' wait for its pool to come from the cloud copy (`CloudPoolGate`): the progress card
 * and its skip button as they have always been, and what the live board puts in its place.
 */

const pool = vi.hoisted(() => ({
  wants: true,
  shown: 0,
  finish: (): void => undefined,
}));
vi.mock("../lib/cloud/cloudSession", () => ({
  poolWantsCloud: () => pool.wants,
  poolOnScreen: () => {
    pool.shown += 1;
  },
  preparePool: () =>
    new Promise<void>((resolve) => {
      pool.finish = resolve;
    }),
}));

const { CloudPoolGate } = await import("./CloudPoolGate");

const working = (done: number, total: number): CloudStatus =>
  ({ kind: "working", progress: [done, total] }) as CloudStatus;

beforeEach(() => {
  pool.wants = true;
  pool.shown = 0;
});
afterEach(() => resetPoolFill());

describe("the wait for Team Rankings' pool", () => {
  it("shows its progress and a way past it, then the page once the pool is in", async () => {
    render(
      <CloudPoolGate status={working(3, 12)}>
        <p>the page</p>
      </CloudPoolGate>
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Loading Team Rankings from your cloud copy… 3 of 12"
    );
    expect(screen.queryByText("the page")).toBeNull();
    await act(async () => pool.finish());
    expect(screen.getByText("the page")).toBeTruthy();
    expect(pool.shown).toBe(1);
  });

  it("goes straight to the page when asked not to wait", () => {
    render(
      <CloudPoolGate status={{ kind: "saved" } as CloudStatus}>
        <p>the page</p>
      </CloudPoolGate>
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Checking your cloud copy for newer Team Rankings…"
    );
    fireEvent.click(screen.getByRole("button", { name: "Show this device's copy now" }));
    expect(screen.getByText("the page")).toBeTruthy();
  });

  it("is not there at all when the pool needs nothing from the cloud", () => {
    pool.wants = false;
    render(
      <CloudPoolGate status={working(0, 0)}>
        <p>the page</p>
      </CloudPoolGate>
    );
    expect(screen.getByText("the page")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows what it is handed in place of its card while it waits, with the progress and the skip", async () => {
    const waiting = vi.fn((progress: { done: number; total: number }, skip: () => void) => (
      <button type="button" onClick={skip}>
        board {progress.done}/{progress.total}
      </button>
    ));
    render(
      <CloudPoolGate status={working(5, 20)} waiting={waiting}>
        <p>the page</p>
      </CloudPoolGate>
    );
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "board 5/20" }));
    expect(screen.getByText("the page")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /board/ })).toBeNull();
  });

  it("waits for this device's own store, read at once though it was waiting for the board", async () => {
    const reads: string[] = [];
    let readIn = (): void => undefined;
    // A member's device, whose store is read once the live board is drawn, which here it never is.
    startPoolFill(
      () =>
        new Promise<void>((resolve) => {
          reads.push("read");
          readIn = resolve;
        }),
      new Promise(() => undefined)
    );
    render(
      <CloudPoolGate status={working(0, 0)}>
        <p>the page</p>
      </CloudPoolGate>
    );
    // Read at once, though the cloud's pool is still being brought in step.
    await act(async () => undefined);
    expect(reads).toEqual(["read"]);
    await act(async () => pool.finish());
    expect(screen.getByRole("status").textContent).toContain(
      "Reading Team Rankings on this device…"
    );
    expect(screen.queryByText("the page")).toBeNull();
    expect(pool.shown).toBe(0);
    await act(async () => readIn());
    expect(screen.getByText("the page")).toBeTruthy();
    expect(pool.shown).toBe(1);
  });
});
