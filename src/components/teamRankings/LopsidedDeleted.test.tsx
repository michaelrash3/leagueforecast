import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../../lib/pullSession";
import type { GcTeamResponse } from "../../lib/gameChangerApi";
import {
  loadAutoRemoved,
  loadDroppedClubs,
  loadScoutGames,
  loadScoutTeams,
} from "../../lib/teamRankingsStorage";
import { ageGroup, renderTeamRankings } from "../../test/teamRankingsHarness";

/*
 * A pull on this device's own copy that meets a club whose own schedule reports a game won by 80:
 * the sweep marks it (sign H), and from the owner's rule of 27 October 2026 the page deletes it
 * outright, as Delete club deletes one (`lopsidedDrops`): the club, its game and its mark go, and
 * its GameChanger id is refused, so the next paste of the same list skips it. The other club stays.
 */
const ROUT = "RoutClub0001";
const REAL = "RealClub0002";
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  resetPullSession();
});
afterEach(() => vi.useRealTimers());

const holds = (gcId: string) =>
  loadScoutTeams().some((team) => team.gcTeams?.some((link) => link.teamId === gcId));

describe("a pull from the page that meets a club reporting a game won by 40 or more", () => {
  it("deletes that club, its games and its mark, and refuses it from then on", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [], teams: [], games: [], search: "?section=import" });
    await user.type(await screen.findByLabelText("Teams"), `${ROUT}\n${REAL}`);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
    await waitFor(() => expect([...loadDroppedClubs()]).toEqual([ROUT]));
    expect(holds(ROUT)).toBe(false);
    expect(loadAutoRemoved().has(ROUT)).toBe(false);
    expect(loadScoutGames().filter((game) => game.id.includes(ROUT))).toEqual([]);
    expect(holds(REAL)).toBe(true);
  });

  it("keeps one a League Standings team picks, marked and on its boards", async () => {
    // Its 80-0 is already filed, as its own schedule's row; the pull of another club tidies and
    // sweeps the whole pool, as every pull's end does.
    const user = userEvent.setup();
    const page = ageGroup(12, 2027, { seasonIds: ["default"] });
    renderTeamRankings({
      ageGroups: [page],
      teams: [
        {
          id: "S-ROUT",
          name: "Wexcombe Wreckers",
          gcTeams: [
            { teamId: ROUT, name: "Wexcombe Wreckers 12U", ageGroupId: page.id, ageLevel: 12 },
          ],
        },
        { id: "S-NOBO", name: "Nobody", nameOnly: true },
      ],
      games: [
        {
          id: `gc_${ROUT}_g1`,
          ageGroupId: page.id,
          teamAId: "S-ROUT",
          teamBId: "S-NOBO",
          teamAScore: 80,
          teamBScore: 0,
          date: "2026-09-20",
          source: { kind: "gamechanger", teamId: ROUT, gameId: "g1" },
        },
      ],
      league: {
        teams: [{ id: "lt-w", name: "Wexcombe Wreckers", scoutTeamId: "S-ROUT" }],
        matchups: [],
        logs: {},
      },
      search: "?section=import",
    });
    await user.type(await screen.findByLabelText("Teams"), REAL);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
    await waitFor(() => expect(loadAutoRemoved().get(ROUT)?.signs).toContain("hundred"));
    expect(holds(ROUT)).toBe(true);
    expect(loadDroppedClubs().has(ROUT)).toBe(false);
  });
});
