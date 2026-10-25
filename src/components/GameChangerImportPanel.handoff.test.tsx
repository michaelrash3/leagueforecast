import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdHandoff, onHandoffLoaded, resetHandoffForTests } from "../lib/crawlHandoffStore";
import { resetPullSession } from "../lib/pullSession";
import { loadOrgMembership } from "../lib/teamRankingsStorage";
import type { GcImportState } from "../lib/gameChangerImport";

/*
 * The crawl's files handed over by the owner's userscript, taken by this device's own Import as the
 * same files chosen by hand would be. Placeholder names throughout.
 */
const fetchGcTeams = vi.fn();
vi.mock("../lib/gameChangerClient", async () => ({
  ...(await vi.importActual<typeof import("../lib/gameChangerClient")>("../lib/gameChangerClient")),
  fetchGcTeams: (...args: unknown[]) => fetchGcTeams(...args),
}));

const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

const emptyPool: GcImportState = { ageGroups: [], teams: [], games: [] };
const panel = (showToast: (message: string) => void = () => {}) =>
  render(
    <GameChangerImportPanel
      pool={emptyPool}
      onPersist={() => true}
      savedProgress={null}
      droppedClubs={new Set()}
      onInvented={() => {}}
      namedAges={new Map()}
      onSaveProgress={() => {}}
      onClearProgress={() => {}}
      onClose={() => {}}
      showToast={showToast}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );

// As the miner's NEW exports write them: quoted cells, CRLF.
const TEAMS = [
  '"Team Name","Team ID","Season","Age Group","City","State"',
  '"Placeholder Owls 9U","Ab3dE5gH7jK9","Spring 2027","9U","Nashville","TN"',
  '"Placeholder Hive 9U","Bc4eF6hJ8kL0","Spring 2027","9U","Nashville","TN"',
].join("\r\n");
const ORGS = [
  '"Organization Name","Organization ID","Type","Season Name","Season Year","City","State","Team Count","Team IDs"',
  '"Placeholder League 9U","Pqy5Av4tHncy","league","Spring","2027","Nashville","TN","2","Ab3dE5gH7jK9; Bc4eF6hJ8kL0"',
].join("\r\n");
// A delta of only tournaments, which is kept out.
const TOURNAMENTS = [
  '"Organization Name","Organization ID","Type","Season Name","Season Year","City","State","Team Count","Team IDs"',
  '"Placeholder Slam 14U","Tq7Bw3sKmXcz","tournament","Summer","2027","Nashville","TN","1","Ab3dE5gH7jK9"',
].join("\r\n");

beforeEach(() => {
  resetHandoffForTests();
  resetPullSession();
  localStorage.clear();
  fetchGcTeams.mockReset();
});
afterEach(() => resetHandoffForTests());

describe("the crawl's files on this device's Import", () => {
  it("go in as the files chosen by hand would, and pull nothing", async () => {
    const told = vi.fn();
    onHandoffLoaded(told);
    holdHandoff({
      id: "run_1",
      teams: { name: "GC_Teams_New.csv", text: TEAMS },
      orgs: { name: "GC_Organizations_New.csv", text: ORGS },
    });
    panel();
    await waitFor(() => expect(screen.getByText("GC_Teams_New.csv")).toBeInTheDocument());
    expect(screen.getByText(/3 lines/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("gc-org-membership").textContent).toMatch(
        /^1 organizations kept, 2 teams under them/
      )
    );
    expect(loadOrgMembership().orgs.map((org) => org.orgId)).toEqual(["Pqy5Av4tHncy"]);
    expect(told.mock.calls.sort()).toEqual([
      ["run_1", "orgs"],
      ["run_1", "teams"],
    ]);
    expect(fetchGcTeams).not.toHaveBeenCalled();
  });

  it("go in when they arrive with Import already open", async () => {
    panel();
    expect(screen.queryByText("GC_Teams_New.csv")).toBeNull();
    act(() => {
      holdHandoff({ id: "run_2", teams: { name: "GC_Teams_New.csv", text: TEAMS }, orgs: null });
    });
    await waitFor(() => expect(screen.getByText("GC_Teams_New.csv")).toBeInTheDocument());
  });

  it("tell the miner nothing of an Organizations file that did not go in", async () => {
    const told = vi.fn();
    const toast = vi.fn();
    onHandoffLoaded(told);
    holdHandoff({
      id: "run_3",
      teams: null,
      orgs: { name: "GC_Organizations_New.csv", text: '"Organization Name","Organization ID"' },
    });
    panel(toast);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Team IDs/), expect.anything())
    );
    expect(told).not.toHaveBeenCalled();
  });

  it("tell the miner an Organizations file of only tournaments is done, keeping none of it", async () => {
    const told = vi.fn();
    const toast = vi.fn();
    onHandoffLoaded(told);
    holdHandoff({
      id: "run_4",
      teams: null,
      orgs: { name: "GC_Organizations_New.csv", text: TOURNAMENTS },
    });
    panel(toast);
    await waitFor(() => expect(told).toHaveBeenCalledWith("run_4", "orgs"));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Nothing to keep .* tournaments/));
    expect(loadOrgMembership().orgs).toEqual([]);
  });
});
