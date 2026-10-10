import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { LoadingPanel } from "./LoadingPanel";
import { StatePanel } from "./StatePanel";
import { EmptyPanel } from "./league/EmptyPanel";
import { LiveLeagueBanner } from "./league/LiveLeagueBanner";

/*
 * The five states a panel can be in instead of its content (2.5), as a screen reader meets them: a
 * failure interrupts, a wait or a fallback is announced politely, and an empty panel is just part of
 * the page. And the panels the app already had now say so through it.
 */
describe("StatePanel", () => {
  it("interrupts for a failure and announces the rest", () => {
    const { rerender } = render(<StatePanel kind="error" title="Could not load" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
    for (const kind of ["loading", "offline", "stale"] as const) {
      rerender(<StatePanel kind={kind} title={`The ${kind} one`} />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent(`The ${kind} one`);
    }
    rerender(<StatePanel kind="empty" title="Nothing yet" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes the title a heading only where asked", () => {
    const { rerender } = render(<StatePanel kind="empty" heading={3} title="No games yet" />);
    expect(screen.getByRole("heading", { level: 3, name: "No games yet" })).toBeInTheDocument();
    rerender(<StatePanel kind="empty" title="No games yet" />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("reads a loading panel as its words alone", () => {
    render(<LoadingPanel area="Standings" />);
    // What the League views wait on (`AppLeagueNumbers.test.tsx`, `e2e/design.spec.ts`).
    expect(screen.getByRole("status").textContent).toBe("Loading Standings…");
  });

  it("carries the panels the app already had", () => {
    render(
      <>
        <EmptyPanel title="No predictions yet" body="Add scores." />
        <LiveLeagueBanner state={{ kind: "offline" }} />
      </>
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "No predictions yet" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^Offline\./);
  });

  it("shows a view that failed to draw as a failure with its way on", () => {
    const Broken = () => {
      throw new Error("boom");
    };
    const quiet = console.error;
    console.error = () => {};
    try {
      render(
        <ErrorBoundary area="Standings">
          <Broken />
        </ErrorBoundary>
      );
    } finally {
      console.error = quiet;
    }
    const alert = screen.getByRole("alert");
    expect(
      screen.getByRole("heading", { level: 2, name: "Standings could not be shown" })
    ).toBeInTheDocument();
    expect(alert).toContainElement(screen.getByRole("button", { name: "Try again" }));
  });
});
