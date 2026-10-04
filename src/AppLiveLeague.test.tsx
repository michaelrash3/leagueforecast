import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { editingOffBecause } from "./components/league/LiveLeagueBanner";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { buildShareUrl } from "./lib/share";
import { loadTeams, saveMatchups, saveTeams } from "./lib/storage";
import { DEFAULT_SETTINGS } from "./lib/types";

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

  it("keeps what only reads the season usable while read-only, and offers no rename", async () => {
    live.state = { kind: "offline" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Standings" }));
    const aces = (await screen.findAllByRole("link", { name: "View stats for Aces" }))[0];
    if (aces) fireEvent.click(aces);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).queryByRole("button", { name: "Rename" })).toBeNull();
    fireEvent.click(within(drawer).getAllByRole("button", { name: /close/i })[0] as HTMLElement);

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Export CSV" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Backup JSON" })).toBeEnabled();
    expect(screen.getByLabelText("New season name")).toBeEnabled();
    expect(screen.getByLabelText("Import schedule CSV")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset Season" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Load Demo" })).toBeDisabled();
  });

  it("offers a team's rename while live", async () => {
    live.state = { kind: "live" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Standings" }));
    const aces = (await screen.findAllByRole("link", { name: "View stats for Aces" }))[0];
    if (aces) fireEvent.click(aces);
    expect(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Rename" })
    ).toBeEnabled();
  });

  it("refuses a shared link's season while read-only, saying why, and keeps its own", async () => {
    live.state = { kind: "offline" };
    const shared = {
      v: 1 as const,
      teams: [
        { id: "X", name: "Xylos" },
        { id: "Y", name: "Yetis" },
      ],
      matchups: [{ id: "s1", date: "6/1", away: "X", home: "Y" }],
      logs: {},
      settings: { ...DEFAULT_SETTINGS, seasonLabel: "Their League" },
    };
    window.history.replaceState(null, "", buildShareUrl(window.location.href, shared));
    render(<App />);
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Load snapshot" })
    );
    const why = editingOffBecause({ kind: "offline" }) ?? "";
    // The banner says it, and so does the refusal, after whatever the link's own word was.
    await waitFor(() => expect(screen.getAllByText(why)).toHaveLength(2));
    expect(loadTeams().map((team) => team.name)).toEqual(["Aces", "Bears"]);
  });
});
