import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastPullLog, resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

/*
 * A pasted export holding pages whose names say they are no team, and a softball side: left out
 * before a request is spent on any of them, and counted on the pill that says why. Every name is
 * invented.
 */
const REAL = "QuillTeam001";
const OTHER = "BrindTeam001";

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
                name: `Club ${teamId.slice(0, 5)} 12U`,
                ageLevel: 12,
                season: { season: "fall", year: 2026 },
              },
              games: [],
              fetchedAt: "2026-09-24T12:00:00.000Z",
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

const { fetchGcTeams } = await import("../lib/gameChangerClient");
const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

const emptyPool: GcImportState = { ageGroups: [], teams: [], games: [] };

const panel = () =>
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
      showToast={() => {}}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );

const teamFile = (rows: string[]) =>
  new File([["Team Name,Team ID,Age Group,Season", ...rows].join("\n")], "GC_Teams.csv", {
    type: "text/csv",
  });

describe("a pasted list holding pages that are no team", () => {
  beforeEach(() => {
    resetPullSession();
    localStorage.clear();
    vi.mocked(fetchGcTeams).mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("leaves them out before a request, and says how many and why", async () => {
    const user = userEvent.setup();
    panel();
    await user.upload(
      screen.getByLabelText("Team list CSV"),
      teamFile([
        `Quillfeather Quails 12U,${REAL},12U,Fall 2026`,
        `Brindlewood Badgers 12U,${OTHER},12U,Fall 2026`,
        "Thornbury Practice 12U,ThornTeam001,12U,Fall 2026",
        "Hollowmere Hornets DNU,HolloTeam001,12U,Fall 2026",
        "Gildersleeve Softball 12U,GildeTeam001,12U,Fall 2026",
      ])
    );

    const pill = await screen.findByText("2 practice, test, old or unnamed team pages, skipped");
    expect(pill.getAttribute("title")).toMatch(/^Pages whose name says they are no team/);
    expect(screen.getByText("1 wiffle ball, blitzball or softball, skipped")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pull 2 schedules" }));
    await waitFor(() => expect(fetchGcTeams).toHaveBeenCalled());
    expect(vi.mocked(fetchGcTeams).mock.calls[0]?.[0]).toEqual([REAL, OTHER]);
    // And the run's own record counts them with the rest it left out before a request.
    await waitFor(() => expect(lastPullLog()?.paste?.tooYoung).toBe(3));
    expect(lastPullLog()?.paste?.parsed).toBe(2);
  });

  it("says one page in the singular", async () => {
    const user = userEvent.setup();
    panel();
    await user.upload(
      screen.getByLabelText("Team list CSV"),
      teamFile([
        `Quillfeather Quails 12U,${REAL},12U,Fall 2026`,
        "Copperfield Scrimmage 12U,CopprTeam001,12U,Fall 2026",
      ])
    );
    expect(
      await screen.findByText("1 practice, test, old or unnamed team page, skipped")
    ).toBeInTheDocument();
  });
});
