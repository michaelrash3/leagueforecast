import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../../lib/pullSession";
import type { GcTeamResponse } from "../../lib/gameChangerApi";
import { loadDroppedClubs } from "../../lib/teamRankingsStorage";
import { renderTeamRankings } from "../../test/teamRankingsHarness";

/*
 * A pull that meets an invented schedule, on the page: the club is thrown out as one deleted by
 * hand is (`answers`, droppedClubs), so the next paste of the same list skips it. Two clubs answer
 * as in the panel's own test: one with a season behind it, one all 20-0 results decades ahead.
 */
const INVENTED = "Invented0001";
const REAL = "RealClub0001";
vi.mock("../../lib/gameChangerClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/gameChangerClient")>(
    "../../lib/gameChangerClient"
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  resetPullSession();
});
afterEach(() => vi.useRealTimers());

describe("a pull from the page that meets an invented schedule", () => {
  it("throws that club out, and no other", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [], teams: [], games: [], search: "?section=import" });
    await user.type(await screen.findByLabelText("Teams"), `${INVENTED}\n${REAL}`);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
    await waitFor(() => expect([...loadDroppedClubs()]).toEqual([INVENTED]));
  });
});
