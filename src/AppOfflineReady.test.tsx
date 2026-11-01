import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The service worker's word that the app is stored for use offline. It came as a toast in the
 * app's words for itself, "App shell cached for offline use.", above the phone's tab bar, which on
 * a first visit to Team Rankings is the middle of the My Team card, and on League Standings' start
 * screen the Import CSV button. It is said in four plain words now, at the top of the screen, over
 * the header rather than the page's first card.
 */
const registered = vi.hoisted(() => ({ onOfflineReady: undefined as (() => void) | undefined }));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (options: { onOfflineReady?: () => void }) => {
    registered.onOfflineReady = options.onOfflineReady;
    return () => Promise.resolve();
  },
}));

const { default: App } = await import("./App");

describe("the word that the app works offline", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it("is said briefly, at the top of the screen rather than over the page", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Load Demo" });
    expect(registered.onOfflineReady).toBeDefined();
    act(() => registered.onOfflineReady?.());

    const said = screen
      .getAllByRole("status")
      .find((status) => /offline/i.test(status.textContent ?? ""));
    if (!said) throw new Error("Nothing said of working offline");
    expect(said).toHaveTextContent("Ready to use offline.");
    expect(said).not.toHaveTextContent(/shell|cached/i);
    // Placed at the top on every screen, where the toasts that ask something sit above the tab bar.
    expect(said.className).toMatch(/(^|\s)top-\d/);
    expect(said.className).not.toMatch(/(^|\s)(sm:)?bottom-\d/);
  });
});
