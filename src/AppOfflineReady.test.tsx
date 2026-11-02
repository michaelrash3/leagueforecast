import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The service worker's word that the app is stored for use offline. It came as a toast, "App shell
 * cached for offline use.", above the phone's tab bar, over the middle of the My Team card on a
 * first visit to Team Rankings and League Standings' Import CSV on its start screen; then, from
 * #508, as "Ready to use offline." at the top of the screen, over the header. By the owner's
 * decision of 1 November 2026 it says nothing at all. What stays is the banner that tells a device
 * it is offline.
 */
const registered = vi.hoisted(() => ({ onOfflineReady: undefined as (() => void) | undefined }));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (options: { onOfflineReady?: () => void }) => {
    registered.onOfflineReady = options.onOfflineReady;
    return () => Promise.resolve();
  },
}));

const { default: App } = await import("./App");

describe("the app stored for use offline", () => {
  beforeEach(() => {
    window.localStorage.clear();
    registered.onOfflineReady = undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says nothing when the service worker has stored it", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Load Demo" });
    const before = document.body.textContent;
    act(() => registered.onOfflineReady?.());

    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(
      screen.queryAllByRole("status").filter((status) => /offline/i.test(status.textContent ?? ""))
    ).toEqual([]);
    expect(document.body.textContent).toBe(before);
  });

  it("still says so when the device goes offline", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Load Demo" });
    expect(screen.queryByText(/^You are offline\./)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/^You are offline\./)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(/^You are offline\./)).toBeNull();
  });
});
