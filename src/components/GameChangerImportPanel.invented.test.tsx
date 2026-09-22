import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

/*
 * Two clubs answer. One has a season behind it; the other's whole schedule is 20-0 results on
 * days a lifetime away, which is the shape "Test team" had with 68 of 68. Far enough ahead that no
 * clock this test runs under can reach them.
 */
const INVENTED = "Invented0001";
const REAL = "RealClub0001";
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
          const invented = teamId === INVENTED;
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: invented ? "Test team 12U" : "Real Club 12U",
                ageLevel: 12,
                season: { season: "fall", year: 2026 },
              },
              games: invented
                ? [1, 2, 3].map((n) => ({
                    id: `g${n}`,
                    date: `2099-10-0${n}`,
                    opponentName: "Nobody 12U",
                    teamScore: 20,
                    opponentScore: 0,
                    status: "completed",
                  }))
                : [],
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

describe("a run that meets an invented schedule", () => {
  beforeEach(() => resetPullSession());

  it("hands its id up to be thrown out, and no other", async () => {
    const onInvented = vi.fn();
    const user = userEvent.setup();
    render(
      <GameChangerImportPanel
        pool={emptyPool}
        onPersist={() => true}
        savedProgress={null}
        droppedClubs={new Set()}
        onInvented={onInvented}
        namedAges={new Map()}
        onSaveProgress={() => {}}
        onClearProgress={() => {}}
        onClose={() => {}}
        showToast={() => {}}
        refreshLog={{}}
        onRefreshLog={() => {}}
      />
    );

    await user.type(screen.getByLabelText("Teams"), `${INVENTED}\n${REAL}`);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(onInvented).toHaveBeenCalledTimes(1));
    expect(onInvented).toHaveBeenCalledWith([INVENTED]);
  });
});
