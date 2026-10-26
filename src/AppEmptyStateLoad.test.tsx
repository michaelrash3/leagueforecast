import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/*
 * The start screen of a season with no teams is fetched when shown (`leagueViews.ts`), inside the
 * views' boundary. A download that fails there is that boundary's Try again, which has to fetch it
 * afresh: React's own `lazy` keeps a failed load for good, and an empty season could then be
 * started only after reloading the page.
 */
const failNext = vi.hoisted(() => ({ emptyState: false }));
const loads = vi.hoisted(() => ({ emptyState: 0 }));

// A module whose download fails, as `import()` fails when the connection drops: once, then not.
vi.mock("./components/league/EmptyState", async (importOriginal) => {
  loads.emptyState += 1;
  if (failNext.emptyState) {
    failNext.emptyState = false;
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

describe("an empty season's start screen that cannot be downloaded", () => {
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
    failNext.emptyState = false;
  });

  it("says so, and Try again fetches it afresh", async () => {
    const user = userEvent.setup();
    failNext.emptyState = true;
    render(<App />);

    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Team list")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Team list")).toBeInTheDocument();
    expect(loads.emptyState).toBe(2);
  });
});
