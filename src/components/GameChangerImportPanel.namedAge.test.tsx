import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import { resetTeamRankingsStore, saveNamedAges } from "../lib/teamRankingsStorage";
import { nameAge, type NamedAges } from "../lib/namedAges";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

/**
 * A team GameChanger gives no age for, whose age somebody typed on the review card.
 *
 * The name is one of the real ones this list is full of — a rec-league squad in a league where
 * nobody writes an age — so nothing in the pull can work a level out, and the only thing that can
 * file it is the answer a person already gave.
 */
const NAMELESS = "Mears 1 - 2026";
const ID = "Team00000001";

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
                name: "Mears 1 - 2026",
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

/**
 * The ages somebody typed by hand, and whether the pull reads them.
 *
 * This is an end-to-end guard on one line of wiring rather than on any logic, and it exists
 * because the logic was right and the wiring was absent. `createGcImporter` takes a `namedAges`
 * option, `importOne` reads it, and the one place in the app that builds an importer did not pass
 * it — so a level typed on the review card was stored, the row vanished from the card because the
 * queue hides a team once it is named, and the next pull read an empty map and refused the team
 * for having no age all over again. Nothing looked broken from the outside, which is exactly why
 * the guard has to run the real panel rather than the importer.
 */
describe("an age somebody typed on the review card", () => {
  beforeEach(() => {
    resetPullSession();
    resetTeamRankingsStore();
    window.localStorage.clear();
  });

  const run = async (saved: GcImportState[], named: NamedAges = new Map()) => {
    const user = userEvent.setup();
    render(
      <GameChangerImportPanel
        pool={{ ageGroups: [], teams: [], games: [] }}
        onPersist={(next) => {
          saved.push(next);
          return true;
        }}
        savedProgress={null}
        droppedClubs={new Set()}
        namedAges={named}
        onSaveProgress={() => {}}
        onClearProgress={() => {}}
        onClose={() => {}}
        showToast={() => {}}
        refreshLog={{}}
        onRefreshLog={() => {}}
      />
    );
    await user.type(screen.getByLabelText("Teams"), ID);
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    return saved[saved.length - 1]!;
  };

  it("files the team at the level that was named", async () => {
    const named = nameAge(new Map(), {
      teamId: ID,
      level: 16,
      name: NAMELESS,
      namedAt: "2026-09-18T00:00:00.000Z",
    });
    // Stored as well as handed over, because both are real: the card writes it to storage and
    // `TeamRankingsView` holds the same map as state and passes it down.
    saveNamedAges(named);
    const state = await run([], named);
    expect(state.ageGroups.map((group) => group.ageLevel)).toEqual([16]);
    expect(state.teams.map((team) => team.name)).toContain(NAMELESS);
  });

  it("files it nowhere when nobody named one, which is what makes the case above a real one", () => {
    // The same pull with an empty store. Asserted so the test above cannot pass by accident on a
    // team that would have been filed anyway.
    return run([]).then((state) => {
      expect(state.ageGroups).toEqual([]);
      expect(state.teams).toEqual([]);
    });
  });
});
