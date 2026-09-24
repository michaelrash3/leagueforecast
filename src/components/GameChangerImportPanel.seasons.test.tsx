import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

/*
 * Two clubs playing this fall, and one from last summer: the squad a crawl across the calendar year
 * hands over beside this fall's, with a new GameChanger id and nothing else to say it is finished.
 * On 24 September 2026 the season being played is the 2027 one, Fall 2026 through Summer 2027.
 */
const FALL_ONE = "FallTeam0001";
const FALL_TWO = "FallTeam0002";
const SUMMER = "SummerTeam01";
const lastSummer = (teamId: string) => teamId === SUMMER;

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
          const summer = lastSummer(teamId);
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: summer ? "Summer Club 12U" : `Fall Club ${teamId.slice(-1)} 12U`,
                ageLevel: 12,
                season: summer ? { season: "summer", year: 2026 } : { season: "fall", year: 2026 },
              },
              games: [
                {
                  id: `g-${teamId}`,
                  date: summer ? "2026-06-20" : "2026-09-12",
                  opponentName: "Somebody 12U",
                  teamScore: 5,
                  opponentScore: 3,
                  status: "completed",
                },
              ],
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

const panel = (onPersist: (pool: GcImportState) => boolean = () => true) =>
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
      showToast={() => {}}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );

const teamFile = (rows: string[]) =>
  new File([["Team Name,Team ID,Age Group,Season", ...rows].join("\n")], "GC_Teams.csv", {
    type: "text/csv",
  });

describe("a pull keeps to the season being played", () => {
  beforeEach(() => {
    resetPullSession();
    localStorage.clear();
    vi.mocked(fetchGcTeams).mockClear();
    // Only the date is faked: the pull's own timers and the user events run as they always do.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("leaves last season's rows out of a list that says its seasons, before a request", async () => {
    const user = userEvent.setup();
    panel();
    await user.upload(
      screen.getByLabelText("Team list CSV"),
      teamFile([
        `Fall Club 1 12U,${FALL_ONE},12U,Fall 2026`,
        `Fall Club 2 12U,${FALL_TWO},12U,Fall 2026`,
        `Summer Club 12U,${SUMMER},12U,Summer 2026`,
      ])
    );

    const thisSeason = await screen.findByRole("checkbox", {
      name: "2027: Fall 2026 to Summer 2027, this season (2 teams)",
    });
    expect(thisSeason).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "2026: Fall 2025 to Summer 2026 (1 team)" })
    ).not.toBeChecked();
    expect(screen.getByText("1 from other seasons, skipped")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pull 2 schedules" }));
    await waitFor(() => expect(fetchGcTeams).toHaveBeenCalled());
    expect(vi.mocked(fetchGcTeams).mock.calls[0]?.[0]).toEqual([FALL_ONE, FALL_TWO]);
  });

  it("pulls last season too once it is ticked", async () => {
    const user = userEvent.setup();
    panel();
    await user.upload(
      screen.getByLabelText("Team list CSV"),
      teamFile([
        `Fall Club 1 12U,${FALL_ONE},12U,Fall 2026`,
        `Summer Club 12U,${SUMMER},12U,Summer 2026`,
      ])
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "2026: Fall 2025 to Summer 2026 (1 team)" })
    );
    expect(screen.queryByText(/from other seasons, skipped/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull 2 schedules" })).toBeEnabled();
  });

  it("will not pull with no season ticked", async () => {
    const user = userEvent.setup();
    panel();
    await user.type(screen.getByLabelText("Teams"), FALL_ONE);
    await user.click(
      screen.getByRole("checkbox", { name: "2027: Fall 2026 to Summer 2027, this season" })
    );
    expect(screen.getByTestId("gc-season-note")).toHaveTextContent("Tick a season to pull.");
    expect(screen.getByRole("button", { name: /^Pull/ })).toBeDisabled();
  });

  it("files only this season's teams from a list that does not say, by GameChanger's own season", async () => {
    const persisted: GcImportState[] = [];
    const user = userEvent.setup();
    panel((pool) => {
      persisted.push(pool);
      return true;
    });
    await user.type(screen.getByLabelText("Teams"), `${FALL_ONE}\n${SUMMER}`);
    expect(screen.getByTestId("gc-season-note")).toHaveTextContent(
      "2 teams do not say their season, so each is checked when it arrives and filed only if it is from a ticked season."
    );

    await user.click(screen.getByRole("button", { name: "Pull 2 schedules" }));
    await screen.findByText("1 team from a season this pull was not asked for left out.");
    const names = (persisted[persisted.length - 1]?.teams ?? []).map((team) => team.name);
    expect(names.some((name) => name.startsWith("Fall Club"))).toBe(true);
    expect(names.some((name) => name.startsWith("Summer Club"))).toBe(false);
  });
});
