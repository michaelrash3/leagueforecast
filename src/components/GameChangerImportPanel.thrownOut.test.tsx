import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";
import type { GcPullProgress } from "../lib/gameChangerPull";
import { saveDroppedClubs } from "../lib/teamRankingsStorage";

/*
 * A club somebody threw out is not fetched again because a list names it.
 *
 * The importer refuses a thrown-out club, but only after its profile and games have been fetched,
 * and each refusal was then listed under "Worth a look". Re-pasting a list is how the rows that
 * never made it in are retried, and on the seasoned list 20,146 of the 53,385 rows it would send
 * were clubs already thrown out: 38% of the requests, spent on answers already given.
 */
const KEPT_ONE = "KeptTeam0001";
const KEPT_TWO = "KeptTeam0002";
const THROWN = "ThrownTeam01";

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
                name: `Club ${teamId.slice(-2)} 12U`,
                ageLevel: 12,
                season: { season: "fall", year: 2026 },
              },
              games: [
                {
                  id: `g-${teamId}`,
                  date: "2026-09-12",
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

const panel = ({
  savedProgress = null,
  onSaveProgress = () => {},
}: {
  savedProgress?: GcPullProgress | null;
  onSaveProgress?: (progress: GcPullProgress) => void;
} = {}) =>
  render(
    <GameChangerImportPanel
      pool={emptyPool}
      onPersist={() => true}
      savedProgress={savedProgress}
      droppedClubs={new Set([THROWN])}
      onInvented={() => {}}
      namedAges={new Map()}
      onSaveProgress={onSaveProgress}
      onClearProgress={() => {}}
      onClose={() => {}}
      showToast={() => {}}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );

describe("a club somebody threw out", () => {
  beforeEach(() => {
    resetPullSession();
    localStorage.clear();
    saveDroppedClubs(new Set([THROWN]));
    vi.mocked(fetchGcTeams).mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("is left out of a pasted list before a request, and counted", async () => {
    const user = userEvent.setup();
    panel();
    await user.type(screen.getByLabelText("Teams"), `${KEPT_ONE}\n${THROWN}\n${KEPT_TWO}`);

    expect(screen.getByText("1 you threw out, skipped")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pull 2 schedules" }));
    await waitFor(() => expect(fetchGcTeams).toHaveBeenCalled());
    expect(vi.mocked(fetchGcTeams).mock.calls.flatMap((call) => call[0])).toEqual([
      KEPT_ONE,
      KEPT_TWO,
    ]);
  });

  it("is not fetched by a run saved before it was thrown out, and the run settles it", async () => {
    const saved: GcPullProgress[] = [];
    const user = userEvent.setup();
    panel({
      savedProgress: {
        ids: [KEPT_ONE, THROWN],
        settled: [],
        failures: [],
        startedAt: "2026-09-24T11:00:00.000Z",
        updatedAt: "2026-09-24T11:00:00.000Z",
      },
      onSaveProgress: (progress) => saved.push(progress),
    });

    await user.click(screen.getByRole("button", { name: "Carry on" }));
    await waitFor(() => expect(fetchGcTeams).toHaveBeenCalled());
    expect(vi.mocked(fetchGcTeams).mock.calls.flatMap((call) => call[0])).toEqual([KEPT_ONE]);
    await waitFor(() =>
      expect(saved[saved.length - 1]?.settled.slice().sort()).toEqual([KEPT_ONE, THROWN].sort())
    );
  });
});
