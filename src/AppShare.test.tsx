import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * "Share this season" copies a URL that carries the tab you are looking at. The command list is a
 * memo, so the copy it holds of `shareSeason` is only as fresh as that memo's dependencies: when
 * the list was memoised on the command history, the rows and the theme alone, switching tabs
 * invalidated none of them and the palette went on holding the closure built for the previous
 * tab. The URL then named the tab you had left. It self-corrected after any command ran, because
 * running one writes the history the memo did watch, which is exactly why it survived being
 * clicked through by hand.
 *
 * So this drives the real reproduction: change the tab from the tab bar, not from the palette,
 * and then share.
 */
/**
 * A keyboard used to reach the content by tabbing the mode tablist and then seven view tabs, on
 * every page. The link has to be first in the tab order, and has to point at something that can
 * take focus, or it moves the page without moving the caret.
 */
describe("the skip link", () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the first thing a Tab reaches, and points at a main that can hold focus", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toHaveFocus();

    const target = document.querySelector(String(link.getAttribute("href")));
    expect(target?.tagName).toBe("MAIN");
    expect(target).toHaveAttribute("tabindex", "-1");
  });

  it("follows the open tab, since the league main is the tab panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Standings" }));
    await user.tab();

    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toHaveAttribute("href", "#panel-standings");
    expect(document.querySelector("#panel-standings")?.tagName).toBe("MAIN");
  });
});

describe("sharing the season after a tab change", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    window.localStorage.clear();
    writeText.mockClear();
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * `userEvent.setup()` installs a clipboard stub of its own, so ours has to go in after it or it
   * is the one that gets replaced.
   */
  const setupWithClipboard = () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    return user;
  };

  const sharedUrl = () => {
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0]?.[0];
    expect(typeof url).toBe("string");
    return new URLSearchParams(String(url).split("#")[1] ?? "");
  };

  it("copies a URL naming the tab now open, not the one left behind", async () => {
    const user = setupWithClipboard();
    render(<App />);

    // The app opens on Dashboard; move to Schedule the way a person does.
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute("aria-selected", "true")
    );

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByText("Share this season (copy URL)"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(sharedUrl().get("view")).toBe("games");
  });

  it("copies a URL naming the tab now open after a second tab change", async () => {
    const user = setupWithClipboard();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Standings" })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    );

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByText("Share this season (copy URL)"));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(sharedUrl().get("view")).toBe("standings");
  });
});
