import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { RANKINGS_COMMAND_SECTIONS } from "./lib/rankingsRoute";

/**
 * Team Rankings had the palette and the shortcut sheet from the start — those are the app's, not
 * one half's — and no way at all to move between its six sections from the keyboard. That is the
 * half with a nationwide pool in it and the most places to be.
 *
 * The shortcuts are built from the commands the view publishes rather than from a second
 * navigation path, because the view owns its own route and a second one would drift from it. So
 * what is worth guarding is that the two stay joined: a section with a key but no command reaches
 * nothing, and the keys are useless if they never arrive.
 */
const openRankings = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<App />);
  await user.click(await screen.findByRole("tab", { name: /team rankings/i }));
  await screen.findByRole("tablist", { name: "Team Rankings section" });
};

describe("moving around Team Rankings from the keyboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
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

  it("reaches every section by its own key", async () => {
    const user = userEvent.setup();
    await openRankings(user);

    for (const { label, key } of RANKINGS_COMMAND_SECTIONS) {
      await user.keyboard(`g${key}`);
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true")
      );
    }
  });

  it("lists them on the shortcut sheet, so they are discoverable rather than folklore", async () => {
    const user = userEvent.setup();
    await openRankings(user);

    await user.keyboard("{Shift>}/{/Shift}");

    const sheet = await screen.findByRole("dialog");
    for (const { label, key } of RANKINGS_COMMAND_SECTIONS) {
      expect(sheet.textContent).toContain(`Go to ${label}`);
      expect(sheet.textContent).toContain(`g ${key}`);
    }
  });

  it("does not offer them on the league half, whose sections are different", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("tab", { name: /league standings/i });

    await user.keyboard("{Shift>}/{/Shift}");

    // The league has its own `g` list; "Go to Scouting" belongs to the other half entirely.
    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).not.toContain("Go to Scouting");
  });
});
