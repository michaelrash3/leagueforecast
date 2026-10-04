import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { saveMatchups, saveTeams } from "./lib/storage";

/*
 * League Standings kept live, as the page shows it: editable while live or not kept live at all,
 * and read-only, every control, with a line saying why, whenever the season may not be written.
 */

const live = vi.hoisted(() => ({ state: { kind: "off" } as LiveLeagueState }));

vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: () => ({
    state: live.state,
    guardUndo: () => null,
    removeSeason: async () => true,
  }),
}));

describe("League Standings kept live, on the page", () => {
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
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveMatchups([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    live.state = { kind: "off" };
  });

  it("takes scores while live, with nothing said", async () => {
    live.state = { kind: "live" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    expect(await screen.findByLabelText("Aces Runs")).toBeEnabled();
    expect(screen.queryByText(/editing is off/i)).toBeNull();
  });

  it("is read-only while offline, and says so", async () => {
    live.state = { kind: "offline" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    expect(await screen.findByLabelText("Aces Runs")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark game as final" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  });

  it("is read-only, with the reason as an alert, for a season it must not write", async () => {
    live.state = { kind: "newer" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    expect(await screen.findByLabelText("Aces Runs")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/newer version/i);
  });

  it("leaves the season switcher and the views' tabs usable while read-only", async () => {
    live.state = { kind: "offline" };
    render(<App />);
    const schedule = await screen.findByRole("tab", { name: /schedule/i });
    expect(schedule).toBeEnabled();
    fireEvent.click(schedule);
    expect(await screen.findByLabelText("Aces Runs")).toBeDisabled();
  });
});
