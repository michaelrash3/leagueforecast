import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { saveMatchups, saveTeams } from "./lib/storage";
import { resetTeamRankingsStore, saveScoutTeams } from "./lib/teamRankingsStorage";
import { scoutAsked, scoutTaken } from "./lib/scoutRequest";
import { prefetchAllViews } from "./components/league/leagueViews";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * A League team's club's place on Team Rankings, kept on this device with a GameChanger id its club
 * carried (`LeagueClubRank.gc`), and read by it where this device holds the pool (`readClub`): a
 * club folded into another, or pulled again under another id, is followed, so Scout opens the club
 * the place was of; and one whose id is another club's now has no place, never that club's.
 * Placeholder names.
 */

const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: "ag_9u_2027" });
const place = (clubId: string, gc: string[], rank: number) => ({
  clubId,
  gc,
  board: "9U 2027",
  rank,
  of: 50,
  at: "2026-10-11T00:00:00.000Z",
});

describe("a League team's club's place on Team Rankings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    resetTeamRankingsStore();
    scoutTaken();
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
      // S-HIVE is another club now; the Owls, kept as S-OWL2, are S-OWLS since a fold.
      { id: "S-HIVE", name: "Hive Academy", gcTeams: [link("gcHiveAca1")] },
      { id: "S-OWLS", name: "Owls Baseball", gcTeams: [link("gcOwls0001"), link("gcOwls0002")] },
    ]);
    saveTeams([
      { id: "L-HIVE", name: "Hive" },
      { id: "L-OWLS", name: "Owls" },
    ]);
    saveMatchups([{ id: "g1", date: "5/1", away: "L-HIVE", home: "L-OWLS" }]);
    window.localStorage.setItem(
      "lf_league_club_ranks_v1",
      JSON.stringify({
        default: {
          "L-HIVE": place("S-HIVE", ["gcHive0001"], 12),
          "L-OWLS": place("S-OWL2", ["gcOwls0002"], 7),
        },
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTeamRankingsStore();
    scoutTaken();
    window.history.replaceState(null, "", "/");
  });

  it("is followed where its club moved, and none where its id is another club's now", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Standings" }));
    expect((await screen.findAllByText("#7 of 50 nationally · top 14%")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/#12 of 50 nationally/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Scout Hive/ })).toBeNull();
    const [scout] = screen.getAllByRole("button", { name: "Scout Owls in Team Rankings" });
    if (!scout) throw new Error("no Scout button");
    fireEvent.click(scout);
    expect(scoutAsked()).toBe("S-OWLS");
  });

  it("is told on the Our team card as its club now is, or not at all", async () => {
    window.localStorage.setItem("lf_our_team_v1", JSON.stringify({ default: "L-OWLS" }));
    const first = render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Dashboard" }));
    const owls = await screen.findByRole("region", { name: "Our team" });
    expect(owls).toHaveTextContent("Team Rankings: 7th of 50 nationally");
    first.unmount();

    window.localStorage.setItem("lf_our_team_v1", JSON.stringify({ default: "L-HIVE" }));
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Dashboard" }));
    const hive = await screen.findByRole("region", { name: "Our team" });
    expect(hive).not.toHaveTextContent("Team Rankings:");
  });
});
