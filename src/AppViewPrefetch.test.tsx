import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { saveMatchups, saveTeams } from "./lib/storage";

/*
 * League's views load on demand (2.1), and the app starts loading a tab before it is opened: when
 * its tab is pointed at or focused, and, once a tab is drawn and the page is idle, the tab most
 * often opened after it.
 */
const views = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("./components/league/leagueViews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./components/league/leagueViews")>();
  return {
    ...actual,
    prefetchView: (view: Parameters<typeof actual.prefetchView>[0]) => {
      views.asked.push(view);
      return actual.prefetchView(view);
    },
  };
});

beforeAll(() => prefetchAllViews());

describe("League's views, loaded ahead", () => {
  beforeEach(() => {
    views.asked = [];
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts a tab's load when it is pointed at or focused", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.hover(await screen.findByRole("tab", { name: "Forecast" }));
    expect(views.asked).toContain("model");
    screen.getByRole("tab", { name: "League Stats" }).focus();
    expect(views.asked).toContain("teamStats");
  });

  it("loads the schedule once the dashboard is drawn and the page is idle, and nothing else", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    expect(views.asked).not.toContain("games");
    await vi.advanceTimersByTimeAsync(1_600);
    expect(views.asked).toEqual(["games"]);
  });
});
