import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import {
  loadAgeUnknown,
  saveAgeUnknown,
  saveOrgMembership,
  saveRefreshCadence,
} from "../lib/teamRankingsStorage";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

/*
 * GameChanger gives the Pistons no age and neither does their name; the Organizations file put
 * them under "ENA 8U Fall 2026". Their one game is against somebody whose name says nothing either.
 */
const PISTONS = "Pistons00001";
vi.mock("../lib/gameChangerClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/gameChangerClient")>(
    "../lib/gameChangerClient"
  );
  return {
    ...actual,
    fetchGcTeams: vi.fn(
      async (
        ids: string[],
        options?: {
          onProgress?: (p: {
            done: number;
            total: number;
            teamId: string;
            result: GcTeamResponse;
          }) => void;
        }
      ) => {
        const out = new Map<string, GcTeamResponse>();
        ids.forEach((teamId, index) => {
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: "Pistons",
                season: { season: "fall", year: 2026 },
                state: "TN",
              },
              games: [
                {
                  id: "p1",
                  date: "2026-09-12",
                  opponentName: "Twins",
                  teamScore: 7,
                  opponentScore: 4,
                  status: "completed",
                },
              ],
              fetchedAt: "2026-09-22T00:00:00.000Z",
            },
          };
          out.set(teamId, result);
          options?.onProgress?.({ done: index + 1, total: ids.length, teamId, result });
        });
        return out;
      }
    ),
  };
});

const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

const emptyPool: GcImportState = { ageGroups: [], teams: [], games: [] };

const panel = (
  onPersist: (pool: GcImportState) => boolean,
  showToast: (message: string, options?: { tone?: string }) => void = () => {}
) =>
  render(
    <GameChangerImportPanel
      pool={emptyPool}
      onPersist={onPersist}
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

const HEADER =
  "Entity Type,Entity Name,Organization ID,City,State,Season Name,Season Year,Sport,Home URL,Teams URL,Schedule URL,Team Count,Team IDs,Found Via Searches,First Seen,Last Seen";
const orgFile = (rows: string[]) =>
  new File([[HEADER, ...rows].join("\n")], "GameChanger_Organizations.csv", { type: "text/csv" });

describe("reading an Organizations file", () => {
  beforeEach(() => {
    resetPullSession();
    localStorage.clear();
  });

  it("keeps the teams under each organization and says what it can age", async () => {
    const user = userEvent.setup();
    panel(() => true);
    await user.upload(
      screen.getByLabelText("Organizations CSV"),
      orgFile([
        `"travel","ENA 8U Fall 2026","orgENA000001","Nashville","TN","fall","2026","baseball","","","","2","${PISTONS}; Twins0000001","x","",""`,
      ])
    );
    await waitFor(() =>
      expect(screen.getByTestId("gc-org-membership").textContent).toMatch(
        /^1 organizations kept, 2 teams under them\. 2 can take an age/
      )
    );
  });

  it("says so, and keeps nothing, when the file names no teams", async () => {
    const toast = vi.fn();
    const user = userEvent.setup();
    panel(() => true, toast);
    const noTeams = new File(
      ['Entity Type,Entity Name,Organization ID\n"travel","ENA 8U Fall 2026","orgENA000001"'],
      "old.csv",
      { type: "text/csv" }
    );
    await user.upload(screen.getByLabelText("Organizations CSV"), noTeams);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Team IDs column/), {
        tone: "error",
      })
    );
    expect(screen.getByTestId("gc-org-membership").textContent).toMatch(
      /^The Organizations export/
    );
  });
});

describe("a team with no age, under an organization whose name states one", () => {
  beforeEach(() => {
    resetPullSession();
    localStorage.clear();
  });

  it("is filed at the age the organization's name states", async () => {
    saveOrgMembership({
      orgs: [{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: [PISTONS] }],
      savedAt: "2026-09-22T12:00:00.000Z",
    });
    let saved: GcImportState = emptyPool;
    const user = userEvent.setup();
    panel((pool) => {
      saved = pool;
      return true;
    });
    expect(screen.getByTestId("gc-org-membership").textContent).toMatch(
      /1 organizations kept, 1 teams under them\. 1 can take an age/
    );

    await user.type(screen.getByLabelText("Teams"), PISTONS);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(saved.teams.some((team) => team.name === "Pistons")).toBe(true));
    const pistons = saved.teams.find((team) => team.name === "Pistons")!;
    expect(pistons.gcTeams?.[0]?.ageLevel).toBe(8);
    expect(
      saved.ageGroups.find((group) => group.id === pistons.gcTeams?.[0]?.ageGroupId)?.name
    ).toMatch(/^8U/);
  });

  it("is still left waiting when no organization file says anything about it", async () => {
    let saved: GcImportState = emptyPool;
    const user = userEvent.setup();
    panel((pool) => {
      saved = pool;
      return true;
    });
    await user.type(screen.getByLabelText("Teams"), PISTONS);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
    // The run is over once the team is on the waiting list, which is where it goes unfiled.
    await waitFor(() =>
      expect(loadAgeUnknown().some((entry) => entry.teamId === PISTONS)).toBe(true)
    );
    expect(saved.teams.some((team) => team.name === "Pistons")).toBe(false);
  });

  it("is asked about again at once, and filed, when a file read since its last ask ages it", async () => {
    // Asked yesterday, so the week's gate holds it back; the file read today is what it could not
    // have known. On the daily cadence every day is the one waiting teams are asked on.
    saveRefreshCadence("daily");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    saveAgeUnknown([
      { teamId: PISTONS, name: "Pistons", firstSeen: yesterday, lastTried: yesterday, tries: 1 },
    ]);
    const ask = () =>
      screen.queryByRole("button", { name: /^Ask again about 1 team with no age$/ });

    const before = panel(() => true);
    expect(ask()).toBeNull();
    before.unmount();

    saveOrgMembership({
      orgs: [{ orgId: "orgENA000001", name: "ENA 8U Fall 2026", teamIds: [PISTONS] }],
      savedAt: new Date().toISOString(),
    });
    let saved: GcImportState = emptyPool;
    const user = userEvent.setup();
    panel((pool) => {
      saved = pool;
      return true;
    });
    // The rota's own pull: no list describes this team, so only the file can age it.
    await user.click(ask()!);
    await waitFor(() => expect(saved.teams.some((team) => team.name === "Pistons")).toBe(true));
    expect(saved.teams.find((team) => team.name === "Pistons")?.gcTeams?.[0]?.ageLevel).toBe(8);
  });
});
