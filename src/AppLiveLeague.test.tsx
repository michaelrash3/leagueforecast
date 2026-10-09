import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { buildShareUrl } from "./lib/share";
import { loadCloudState, saveCloudState } from "./lib/cloud/cloudState";
import { noteLeagueMet } from "./lib/preferences";
import { createSeason, listSeasons, loadTeams, saveMatchups, saveTeams } from "./lib/storage";
import { DEFAULT_SETTINGS } from "./lib/types";
import { prefetchAllViews } from "./components/league/leagueViews";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * League Standings kept live, as the page shows it: editable while live or not kept live at all,
 * and read-only, every control, with a line saying why, whenever the season may not be written.
 */

const live = vi.hoisted(() => ({
  state: { kind: "off" } as LiveLeagueState,
  /** Seasons deleted from the cloud, and what the page asked of whether League is kept live. */
  removed: 0,
  wanted: [] as { met: boolean; inStep: boolean }[],
}));

vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: () => ({
    state: live.state,
    guardUndo: () => null,
    removeSeason: async () => {
      live.removed += 1;
      return true;
    },
  }),
}));

vi.mock("./lib/live/leagueWanted", async (actual) => {
  const real = await actual<typeof import("./lib/live/leagueWanted")>();
  return {
    ...real,
    leagueLiveWanted: (asked: Parameters<typeof real.leagueLiveWanted>[0]) => {
      live.wanted.push({ met: asked.met, inStep: asked.inStep });
      return real.leagueLiveWanted(asked);
    },
  };
});

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
    live.removed = 0;
    live.wanted = [];
  });

  it("asks whether League is kept live by the meeting this device has had", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: "Settings" });
    // Nothing met here, and not in step with a copy no settlement here has read.
    expect(live.wanted[live.wanted.length - 1]).toEqual({ met: false, inStep: false });
    cleanup();
    saveCloudState({ ...loadCloudState(), uid: "member-uid" });
    noteLeagueMet("member-uid");
    render(<App />);
    await screen.findByRole("tab", { name: "Settings" });
    expect(live.wanted[live.wanted.length - 1]).toEqual({ met: true, inStep: false });
  });

  /** Deletes Fall from Settings' season list, and says whether it is still listed. */
  const deleteFall = async () => {
    const fall = createSeason("Fall");
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const seasonList = await screen.findByRole("region", { name: "Seasons" });
    const row = within(seasonList).getByText("Fall").closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete season" })
    );
    return () => listSeasons().some((season) => season.id === fall.id);
  };

  it("refuses a delete on a device met live whose League is not live this moment (1.6e review)", async () => {
    // Met live here, the cloud's answer not in yet at boot, or signed out since: the live store
    // is off, and the season's document is still in the cloud.
    saveCloudState({ ...loadCloudState(), uid: "member-uid" });
    noteLeagueMet("member-uid");
    const listed = await deleteFall();
    expect(
      await screen.findByText("Connect to the cloud to delete a season every device shares.")
    ).toBeInTheDocument();
    expect(listed()).toBe(true);
    expect(live.removed).toBe(0);
  });

  it("refuses a delete on a member's device still to meet the cloud's seasons (1.6e review)", async () => {
    saveCloudState({ ...loadCloudState(), enabled: true, uid: "member-uid" });
    const listed = await deleteFall();
    expect(
      await screen.findByText("Connect to the cloud to delete a season every device shares.")
    ).toBeInTheDocument();
    expect(listed()).toBe(true);
  });

  it("deletes a season here alone where League is not kept live, asking no cloud", async () => {
    const fall = createSeason("Fall");
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const seasonList = await screen.findByRole("region", { name: "Seasons" });
    const row = within(seasonList).getByText("Fall").closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete season" })
    );
    await waitFor(() => expect(listSeasons().map((season) => season.id)).not.toContain(fall.id));
    expect(live.removed).toBe(0);
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

  it("asks about a shared link once the season may be written, keeping it until then", async () => {
    live.state = { kind: "connecting" };
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
    const view = render(<App />);
    await screen.findByRole("tab", { name: /schedule/i });
    expect(screen.queryByRole("dialog")).toBeNull();
    live.state = { kind: "live" };
    view.rerender(<App />);
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Load snapshot" })
    );
    await waitFor(() => expect(loadTeams().map((team) => team.name)).toEqual(["Xylos", "Yetis"]));
  });

  it("lets a team be followed while read-only: the pick is this browser's own", async () => {
    live.state = { kind: "offline" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Dashboard" }));
    expect(await screen.findByLabelText(/follow a team/i)).toBeEnabled();
  });

  it("deletes another season while the open one is kept apart, the cloud answering", async () => {
    const fall = createSeason("Fall");
    live.state = { kind: "apart" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const seasonList = await screen.findByRole("region", { name: "Seasons" });
    const row = within(seasonList).getByText("Fall").closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete season" })
    );
    await waitFor(() => expect(listSeasons().map((season) => season.id)).not.toContain(fall.id));
  });

  it("refuses a delete while offline, with no cloud to delete it from", async () => {
    const fall = createSeason("Fall");
    live.state = { kind: "offline" };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const seasonList = await screen.findByRole("region", { name: "Seasons" });
    const row = within(seasonList).getByText("Fall").closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete season" })
    );
    expect(await screen.findByText(/connect to the cloud/i)).toBeInTheDocument();
    expect(listSeasons().map((season) => season.id)).toContain(fall.id);
  });

  it("refuses the demo season from the command palette before it asks anything", async () => {
    live.state = { kind: "offline" };
    render(<App />);
    await screen.findByRole("tab", { name: /schedule/i });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Load demo season"));
    await waitFor(() => expect(screen.getAllByText(/offline/i).length).toBeGreaterThan(1));
    expect(screen.queryByText("Load demo season?")).toBeNull();
    expect(loadTeams().map((team) => team.name)).toEqual(["Aces", "Bears"]);
  });

  it("offers the tour and the blank schedule on an empty season while read-only, and no edits", async () => {
    saveTeams([]);
    saveMatchups([]);
    live.state = { kind: "offline" };
    render(<App />);
    expect(await screen.findByRole("button", { name: /take the quick tour/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Blank CSV" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Load Demo" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Create Schedule" })[0]).toBeDisabled();
    expect(screen.getByLabelText("Import schedule CSV")).toBeDisabled();
  });
});
