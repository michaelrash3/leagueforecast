import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { prefetchView } from "./components/league/leagueViews";
import { saveMatchups, saveTeams } from "./lib/storage";

/*
 * A team's panel and the comparison it opens are each fetched the first time they are asked for
 * (2.1, 2.7). A download that fails there is theirs alone: said over the page where the panel would
 * have been, with Try again and Close, and never the whole app's. The app is drawn here as
 * `main.tsx` draws it, inside the root's own boundary, which is what a failure used to reach.
 */
const failNext = vi.hoisted(() => ({ drawer: false, compare: false }));
const loads = vi.hoisted(() => ({ drawer: 0, compare: 0 }));

// A module whose download fails, as `import()` fails when the connection drops: once, then not.
vi.mock("./components/league/TeamDrawer", async (importOriginal) => {
  loads.drawer += 1;
  if (failNext.drawer) {
    failNext.drawer = false;
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});
vi.mock("./components/CompareDrawer", async (importOriginal) => {
  loads.compare += 1;
  if (failNext.compare) {
    failNext.compare = false;
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

// The tabs' own chunks loaded first, so a tab is drawn as soon as it opens; the drawers are not.
beforeAll(() => Promise.all([prefetchView("dashboard"), prefetchView("standings")]));

const drawApp = () =>
  render(
    <ErrorBoundary area="League Forecast">
      <App />
    </ErrorBoundary>
  );

describe("a team's panel or comparison that cannot be downloaded", () => {
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
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveMatchups([{ id: "g1", date: "2026-10-01", away: "A", home: "B" }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    failNext.drawer = false;
    failNext.compare = false;
  });

  it("says so over the page, and Close leaves it and the address clear, the next tap fetching afresh", async () => {
    const user = userEvent.setup();
    failNext.drawer = true;
    drawApp();
    await user.click(await screen.findByRole("tab", { name: "Standings" }));
    const aces = (await screen.findAllByRole("link", { name: "View stats for Aces" }))[0];
    if (!aces) throw new Error("No link to the Aces' panel");
    await user.click(aces);

    const failed = await screen.findByRole("dialog", { name: "The team panel could not be shown" });
    expect(screen.queryByText("League Forecast could not be shown")).toBeNull();
    expect(screen.getByRole("tab", { name: "Standings" })).toBeInTheDocument();
    expect(loads.drawer).toBe(1);

    await user.click(within(failed).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Gone from the address too, so a reload or the root's Try again does not open it again.
    expect(new URL(window.location.href).searchParams.has("team")).toBe(false);

    const again = (await screen.findAllByRole("link", { name: "View stats for Aces" }))[0];
    if (!again) throw new Error("No link to the Aces' panel");
    await user.click(again);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "Aces" })).toBeInTheDocument();
    expect(loads.drawer).toBe(2);
  });

  it("says so over the team's panel, and Try again fetches the comparison afresh", async () => {
    const user = userEvent.setup();
    failNext.compare = true;
    window.history.replaceState(null, "", "/?team=A");
    drawApp();
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Compare" }));

    const failed = await screen.findByRole("dialog", { name: "The comparison could not be shown" });
    expect(screen.queryByText("League Forecast could not be shown")).toBeNull();
    expect(screen.getByRole("tab", { name: "Standings" })).toBeInTheDocument();
    expect(loads.compare).toBe(1);

    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(loads.compare).toBe(2));
    expect(await screen.findByRole("dialog", { name: /Aces\s+vs\s+Bears/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "The comparison could not be shown" })).toBeNull();
  });
});
