import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { CLOUD_STATE_KEY } from "./lib/cloud/cloudState";
import { loadLogs, loadTeams, saveMatchups, saveTeams } from "./lib/storage";
import { resetTeamRankingsStore, saveScoutTeams } from "./lib/teamRankingsStorage";
import { prefetchAllViews } from "./components/league/leagueViews";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * A pick made before the GameChanger id was kept beside it (League layout 2) takes the id of the
 * club picked at the season's next save of its own, in a browser no member has signed in to, whose
 * seasons and pool are its own, where the club carries exactly one (`stampPicks`), and never at a
 * save made for it alone. Placeholder names.
 */

const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: "ag10" });

describe("an old League pick", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    resetTeamRankingsStore();
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
    saveScoutTeams([
      { id: "S-ACES", name: "Aces Baseball", gcTeams: [link("gcAces001")] },
      { id: "S-BEAR", name: "Bears Baseball", gcTeams: [link("gcBears01"), link("gcBears02")] },
    ]);
    saveTeams([
      { id: "A", name: "Aces", scoutTeamId: "S-ACES" },
      { id: "B", name: "Bears", scoutTeamId: "S-BEAR" },
    ]);
    saveMatchups([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTeamRankingsStore();
    window.history.replaceState(null, "", "/");
  });

  it("is left as it was by a visit that saves nothing", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /schedule/i });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(loadTeams()).toEqual([
      { id: "A", name: "Aces", scoutTeamId: "S-ACES" },
      { id: "B", name: "Bears", scoutTeamId: "S-BEAR" },
    ]);
  });

  it("takes its club's one GameChanger id with the next score saved, and a club of two none", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    const away = await screen.findByLabelText("Aces Runs");
    act(() => {
      fireEvent.change(away, { target: { value: "7" } });
    });
    await waitFor(() => expect(loadLogs().g1).toMatchObject({ awayRuns: "7" }));
    await waitFor(() =>
      expect(loadTeams()).toEqual([
        { id: "A", name: "Aces", scoutTeamId: "S-ACES", scoutGcTeamId: "gcAces001" },
        { id: "B", name: "Bears", scoutTeamId: "S-BEAR" },
      ])
    );
  });

  it("takes none in a browser a member has signed in to, whose seasons the cloud's documents hold", async () => {
    // Signed out since: the record keeps the account, and the seasons edited here meet their
    // documents at its next sign-in, where an id read off this pool, not the cloud's, would go.
    window.localStorage.setItem(
      CLOUD_STATE_KEY,
      JSON.stringify({ enabled: false, device: "d1", uid: "u-member" })
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    const away = await screen.findByLabelText("Aces Runs");
    act(() => {
      fireEvent.change(away, { target: { value: "7" } });
    });
    await waitFor(() => expect(loadLogs().g1).toMatchObject({ awayRuns: "7" }));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(loadTeams()).toEqual([
      { id: "A", name: "Aces", scoutTeamId: "S-ACES" },
      { id: "B", name: "Bears", scoutTeamId: "S-BEAR" },
    ]);
  });
});
