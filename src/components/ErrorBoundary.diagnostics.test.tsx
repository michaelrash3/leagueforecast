import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { DiagnosticsCard } from "./teamRankings/DiagnosticsCard";
import { readDiagnostics } from "../lib/diagnostics";

/**
 * The boundary already stopped one bad row blanking the page. What it could not do was tell
 * anybody afterwards: the console was the only record, and a console on a phone at a ballfield is
 * gone by the time the app is opened on something with a keyboard.
 */
function Throws(): never {
  throw new Error("a game names a team that is not there");
}

describe("a crash the boundary caught", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // React logs a caught error itself; the boundary logs another. Neither is the thing under test.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is written down where it can be found later", () => {
    render(
      <ErrorBoundary area="Team Rankings">
        <Throws />
      </ErrorBoundary>
    );

    const [entry] = readDiagnostics();
    expect(entry?.kind).toBe("crash");
    expect(entry?.where).toBe("Team Rankings");
    expect(entry?.message).toContain("names a team that is not there");
    // The component stack is the difference between a fixable report and "it went blank".
    expect(entry?.detail).toBeTruthy();
  });

  it("offers the copy on the screen that is showing the failure", async () => {
    const user = userEvent.setup();
    // After `setup`, which installs a clipboard stub of its own; this one is the one being read.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <ErrorBoundary area="Team Rankings">
        <Throws />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Team Rankings"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("still shows the app when nothing throws", () => {
    render(
      <ErrorBoundary area="Team Rankings">
        <p>the rankings</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("the rankings")).toBeInTheDocument();
    expect(readDiagnostics()).toEqual([]);
  });
});

describe("finding it afterwards", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists what was recorded, and says plainly that it goes nowhere", () => {
    render(
      <ErrorBoundary area="Team Rankings">
        <Throws />
      </ErrorBoundary>
    );
    render(<DiagnosticsCard />);

    expect(screen.getByText("Screen could not be drawn")).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent anywhere/i)).toBeInTheDocument();
  });

  it("has nothing to copy on a browser where nothing has gone wrong", () => {
    render(<DiagnosticsCard />);

    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("forgets them when asked", async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary area="Team Rankings">
        <Throws />
      </ErrorBoundary>
    );
    render(<DiagnosticsCard />);

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(readDiagnostics()).toEqual([]);
    expect(screen.queryByText("Screen could not be drawn")).toBeNull();
  });
});
