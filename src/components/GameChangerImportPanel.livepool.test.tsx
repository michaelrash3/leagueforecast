import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import {
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutGamesForGroups,
  addScoutGames,
} from "../lib/teamRankingsStorage";
import type { AgeGroup, ScoutTeam } from "../lib/teamRankings";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

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
                name: `Pulled ${index} 12U`,
                ageLevel: 12,
                season: { season: "fall", year: 2026 },
              },
              games: [],
              fetchedAt: "2026-09-17T00:00:00.000Z",
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

const ids = Array.from({ length: 3 }, (_, i) => `Team${String(i).padStart(8, "0")}`);

const club = (id: string, name: string) => ({ id, name });

/**
 * `poolRef` is the run's working copy, and the run owning it is right — the slot it claims is what
 * keeps a tidy or a second pull from writing underneath it. It was also seeded at mount and never
 * again, and this panel can sit open across a tidy, a club deletion or a restored backup. A run
 * started afterwards folded onto the pool as it was when the panel opened and saved that, undoing
 * whatever had happened in between.
 *
 * Driven here by re-rendering with a different pool, which is exactly what the page does: the prop
 * is `{ ageGroups, teams: scoutTeams, games: wholePoolGames }`, rebuilt from the view's state on
 * every render.
 */
describe("a pool that changed while the panel was open", () => {
  beforeEach(() => resetPullSession());

  it("starts the run from the pool the page has now, not the one it opened with", async () => {
    const user = userEvent.setup();
    const saved: GcImportState[] = [];
    const atOpen: GcImportState = {
      ageGroups: [],
      teams: [club("S-OLD", "Was here at open")],
      games: [],
    };
    // What a tidy, a deletion or a restore leaves behind: a different roster entirely.
    const afterTidy: GcImportState = {
      ageGroups: [],
      teams: [club("S-NEW", "Arrived while open")],
      games: [],
    };

    const panel = (pool: GcImportState) => (
      <GameChangerImportPanel
        pool={pool}
        onPersist={(next) => {
          saved.push(next);
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

    const { rerender } = render(panel(atOpen));
    rerender(panel(afterTidy));

    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const names = saved[saved.length - 1]!.teams.map((team) => team.id);
    // The club that arrived while the panel was open survives the run's first save.
    expect(names).toContain("S-NEW");
    // And the one the panel opened with, which no longer exists, is not resurrected by it.
    expect(names).not.toContain("S-OLD");
  });
});

/**
 * The same rule for a sectioned run, which is the path a nationwide refresh actually takes — and
 * where the seam showed plainly: `runSectioned` worked out its sections from this prop and then
 * folded them over the mount-time ref.
 */
describe("a sectioned run over a pool that changed while the panel was open", () => {
  const GROUPS: AgeGroup[] = [
    { id: "ag_11u_2027", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
    { id: "ag_12u_2027", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
  ];
  // Two ids, one on each page, so the run is sectioned rather than run whole.
  const PAGE_OF: Record<string, string> = {
    Team00000001: "ag_11u_2027",
    Team00000002: "ag_12u_2027",
  };
  const linked = (teamId: string): ScoutTeam => ({
    id: `team-${teamId}`,
    name: `Known ${teamId}`,
    gcTeams: [
      {
        teamId,
        name: `Known ${teamId}`,
        ageGroupId: PAGE_OF[teamId]!,
        season: "fall",
        seasonYear: 2026,
        ageLevel: PAGE_OF[teamId] === "ag_11u_2027" ? 11 : 12,
      },
    ],
  });

  beforeEach(() => {
    resetPullSession();
    resetTeamRankingsStore();
    window.localStorage.clear();
    saveAgeGroups(GROUPS);
    saveScoutGames([]);
  });

  it("folds each section over the roster the page has now", async () => {
    const user = userEvent.setup();
    const saved: GcImportState[] = [];
    const roster = Object.keys(PAGE_OF).map(linked);
    const atOpen: GcImportState = {
      ageGroups: GROUPS,
      teams: [...roster, club("S-OLD", "Was here at open")],
      games: [],
    };
    const afterTidy: GcImportState = {
      ageGroups: GROUPS,
      teams: [...roster, club("S-NEW", "Arrived while open")],
      games: [],
    };

    const panel = (pool: GcImportState) => (
      <GameChangerImportPanel
        pool={pool}
        onPersist={(next, holding) => {
          saved.push(next);
          saveAgeGroups(next.ageGroups);
          if (holding?.kind === "pages")
            return saveScoutGamesForGroups(holding.ageGroupIds, next.games);
          if (holding?.kind === "additions") return addScoutGames(next.games);
          return saveScoutGames(next.games).written;
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

    const { rerender } = render(panel(atOpen));
    rerender(panel(afterTidy));

    await user.type(screen.getByLabelText("Teams"), Object.keys(PAGE_OF).join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ again$/ }));

    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    const first = saved[0]!.teams.map((team) => team.id);
    expect(first).toContain("S-NEW");
    expect(first).not.toContain("S-OLD");
  });
});
