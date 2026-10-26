import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { saveMatchups, saveTeams } from "./lib/storage";

// League's views load on demand (2.1); loaded first here, so the Schedule tab is drawn at once.
beforeAll(() => prefetchAllViews());

/*
 * The schedule paste is fetched when opened (`leagueViews.ts`), inside the views' boundary. A
 * download that fails there is that boundary's Try again, which has to fetch it afresh: React's own
 * `lazy` keeps a failed load for good, and the paste could then be opened only after reloading the
 * page (found by Codex on #456).
 */
const failNext = vi.hoisted(() => ({ paste: false }));
const loads = vi.hoisted(() => ({ paste: 0 }));

// A module whose download fails, as `import()` fails when the connection drops: once, then not.
vi.mock("./components/league/LeagueSchedulePaste", async (importOriginal) => {
  loads.paste += 1;
  if (failNext.paste) {
    failNext.paste = false;
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

describe("a schedule paste that cannot be downloaded", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    vi.restoreAllMocks();
    failNext.paste = false;
  });

  it("says so, and Try again lets it be opened and fetched afresh", async () => {
    const user = userEvent.setup();
    saveTeams([
      { id: "ACES", name: "Aces" },
      { id: "BEAR", name: "Bears" },
    ]);
    saveMatchups([]);
    failNext.paste = true;
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: /schedule/i }));
    await user.click(await screen.findByRole("button", { name: "Paste the league's schedule" }));

    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(await screen.findByRole("button", { name: "Paste the league's schedule" }));

    expect(await screen.findByLabelText("League schedule to read")).toBeInTheDocument();
    expect(loads.paste).toBe(2);
  });
});
