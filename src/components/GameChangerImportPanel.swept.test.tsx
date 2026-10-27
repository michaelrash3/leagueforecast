import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";
import type { MarksChange } from "../lib/removedForYou";

/*
 * Two clubs answer, each with a game of its own against a club nobody pulled: one that won by
 * eighty runs, which the sweep for clubs plainly made up takes off (`obviousFakes.ts`), and one
 * that did not. Not a club named as a demo, as this was: the import now refuses a page whose name
 * says it is no team before the sweep could see it (`notATeamWord`).
 */
const ROUT = "RoutClub0001";
const REAL = "RealClub0002";
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
          const rout = teamId === ROUT;
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: rout ? "Wexcombe Wreckers 12U" : "Real Club 12U",
                ageLevel: 12,
                season: { season: "fall", year: 2026 },
              },
              games: [
                {
                  id: "g1",
                  date: "2026-09-20",
                  opponentName: rout ? "Nobody 12U" : "Somebody 12U",
                  teamScore: rout ? 80 : 5,
                  opponentScore: rout ? 0 : 3,
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

/*
 * The pull files only the season being played, and these teams play Fall 2026. Pinned to a day in
 * that season so the test means the same thing after August 2027 as it does now; only the date is
 * faked, so the pull's own timers run as they always do.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("a run's end", () => {
  beforeEach(() => resetPullSession());

  it("sweeps the pool it leaves for clubs plainly made up, and hands up what that changed", async () => {
    const onSwept = vi.fn<(change: MarksChange | null) => readonly string[]>(() => []);
    const user = userEvent.setup();
    render(
      <GameChangerImportPanel
        pool={emptyPool}
        onPersist={() => true}
        savedProgress={null}
        droppedClubs={new Set()}
        onInvented={() => {}}
        onSwept={onSwept}
        namedAges={new Map()}
        onSaveProgress={() => {}}
        onClearProgress={() => {}}
        onClose={() => {}}
        showToast={() => {}}
        refreshLog={{}}
        onRefreshLog={() => {}}
      />
    );

    await user.type(screen.getByLabelText("Teams"), `${ROUT}\n${REAL}`);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(onSwept).toHaveBeenCalledTimes(1));
    const change = onSwept.mock.calls[0]?.[0];
    expect(change?.forget).toEqual([]);
    // Its own schedule's 80-0 is B's rout, and H's too (40 or more from 27 October 2026), for which
    // the page then deletes the club (`LopsidedDeleted.test.tsx`).
    expect(change?.put.map((mark) => [mark.gcTeamId, mark.signs])).toEqual([
      [ROUT, ["rout", "hundred"]],
    ]);
  });
});
