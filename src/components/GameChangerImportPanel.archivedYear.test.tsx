import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";
import { loadAgeUnknown, saveAgeUnknown } from "../lib/teamRankingsStorage";

/*
 * Squad year 2027 put away in September 2027, and the two re-asks that named no season: the roster
 * check of under-strength pages, and the teams waiting on an age. A club keeps the ids it was
 * pulled as, and the waiting list is not the pool's, so both still reached last season's squads
 * and filed them back onto a 2027 page. Invented names.
 */
const LAST_SUMMER = "SumrTeam0027";
const THIS_FALL = "ShrtTeam0028";

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
          const summer = teamId !== THIS_FALL;
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: summer ? "River City 12U" : "River City Fall 12U",
                ageLevel: 12,
                city: "Louisville",
                state: "KY",
                playerCount: 6,
                season: summer ? { season: "summer", year: 2027 } : { season: "fall", year: 2027 },
              },
              games: [
                {
                  id: `g-${teamId}`,
                  date: summer ? "2027-07-17" : "2027-09-18",
                  opponentName: "Derby City 12U",
                  teamScore: 5,
                  opponentScore: 3,
                  status: "completed",
                },
              ],
              fetchedAt: "2027-09-20T12:00:00.000Z",
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

/** As `archiveSquadYear` leaves it: 2027's pages gone, the ids its clubs were pulled as kept. */
const afterArchive: GcImportState = {
  ageGroups: [{ id: "ag12-28", name: "12U 2028", ageLevel: 12, year: 2028, seasonIds: [] }],
  teams: [
    {
      id: "S-RIVER",
      name: "River City",
      city: "Louisville",
      state: "KY",
      gcTeams: [
        {
          teamId: LAST_SUMMER,
          name: "River City 12U",
          ageGroupId: "ag12-27",
          season: "summer",
          seasonYear: 2027,
          playerCount: 6,
          countedAt: "2027-07-01T12:00:00.000Z",
        },
        {
          teamId: THIS_FALL,
          name: "River City Fall 12U",
          ageGroupId: "ag12-28",
          season: "fall",
          seasonYear: 2027,
          playerCount: 7,
          countedAt: "2027-09-01T12:00:00.000Z",
        },
      ],
    },
    { id: "S-OTHER", name: "Other Club" },
  ],
  games: [
    {
      id: "n1",
      ageGroupId: "ag12-28",
      teamAId: "S-RIVER",
      teamBId: "S-OTHER",
      teamAScore: 4,
      teamBScore: 2,
      date: "2027-09-11",
    },
  ],
};

const panel = (pool: GcImportState, persisted: GcImportState[]) =>
  render(
    <GameChangerImportPanel
      pool={pool}
      onPersist={(next) => {
        persisted.push(next);
        return true;
      }}
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

beforeEach(() => {
  resetPullSession();
  localStorage.clear();
  vi.mocked(fetchGcTeams).mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-09-20T12:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("the roster check after 2027 is archived", () => {
  it("asks only about this season's pages, and brings no 2027 page back", async () => {
    const persisted: GcImportState[] = [];
    const user = userEvent.setup();
    panel(afterArchive, persisted);
    // Last season's six-player page is not this season's question.
    expect(screen.getByText(/^1 page may not be a team yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Check them again$/ }));
    await waitFor(() => expect(persisted.length).toBeGreaterThan(0));
    expect(vi.mocked(fetchGcTeams).mock.calls[0]?.[0]).toEqual([THIS_FALL]);
    expect(persisted[persisted.length - 1]!.ageGroups.map((group) => group.name)).toEqual([
      "12U 2028",
    ]);
  });
});

describe("the roster check of a link saved before links carried a season", () => {
  it("still files nothing in 2027 when GameChanger says that is the squad's season", async () => {
    // No season on the link and no page left for it: nothing here can say which year it is, so
    // the watch keeps it and the pull asks GameChanger, whose answer the importer holds to.
    const legacy: GcImportState = {
      ...afterArchive,
      teams: [
        {
          id: "S-RIVER",
          name: "River City",
          gcTeams: [
            {
              teamId: "OldTeam0026",
              name: "River City 12U",
              ageGroupId: "ag12-27",
              playerCount: 5,
              countedAt: "2027-07-01T12:00:00.000Z",
            },
          ],
        },
        { id: "S-OTHER", name: "Other Club" },
      ],
    };
    const persisted: GcImportState[] = [];
    const user = userEvent.setup();
    panel(legacy, persisted);
    await user.click(screen.getByRole("button", { name: /^Check them again$/ }));
    await waitFor(() => expect(persisted.length).toBeGreaterThan(0));
    expect(vi.mocked(fetchGcTeams).mock.calls[0]?.[0]).toEqual(["OldTeam0026"]);
    expect(persisted[persisted.length - 1]!.ageGroups.map((group) => group.name)).toEqual([
      "12U 2028",
    ]);
  });
});

describe("asking again about a 2027 team with no age, after 2027 is deleted", () => {
  it("files nothing in 2027, and takes the team off the waiting list", async () => {
    // A Summer 2027 squad found with no age in July, due its weekly ask in September.
    saveAgeUnknown([
      {
        teamId: LAST_SUMMER,
        name: "River City",
        firstSeen: "2027-07-20T12:00:00.000Z",
        lastTried: "2027-09-01T12:00:00.000Z",
        tries: 3,
      },
    ]);
    // `deleteSquadYear` takes the year's pages and the ids filed under them; the waiting list is
    // not the pool's, so it is left as it was.
    const afterDelete: GcImportState = {
      ...afterArchive,
      teams: [
        { id: "S-RIVER", name: "River City", gcTeams: [afterArchive.teams[0]!.gcTeams![1]!] },
        { id: "S-OTHER", name: "Other Club" },
      ],
    };
    const persisted: GcImportState[] = [];
    const user = userEvent.setup();
    panel(afterDelete, persisted);

    await user.click(screen.getByRole("button", { name: /^Ask again about 1 team with no age/ }));
    await waitFor(() => expect(persisted.length).toBeGreaterThan(0));
    expect(persisted[persisted.length - 1]!.ageGroups.map((group) => group.name)).toEqual([
      "12U 2028",
    ]);
    await waitFor(() => expect(loadAgeUnknown().map((row) => row.teamId)).toEqual([]));
  });
});
