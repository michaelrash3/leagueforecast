import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastPullLog, resetPullSession } from "../lib/pullSession";
import { resetTeamRankingsStore, saveRealClubs } from "../lib/teamRankingsStorage";
import { createSeason, loadSettingsForSeason, writeSeasonData } from "../lib/storage";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../lib/gameChangerApi";
import { importGcSchedule, type GcImportState } from "../lib/gameChangerImport";

/**
 * The clubs the owner vouched for reaching a pull in the browser: a club on the real list, or one a
 * League Standings team links, whose GameChanger name reads as a tryout, is pulled again rather
 * than refused on the word. A guard on the panel's wiring, run through the real panel, since the
 * importer honouring `realClubs` says nothing about the panel passing it. Placeholder names.
 */
const WEX = "gcWEXCO00001";

const row = (id: string, date: string, opponentName: string): GcGame => ({
  id,
  date,
  opponentName,
  status: "completed",
  teamScore: 6,
  opponentScore: 2,
});
const schedule = (id: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: { id, name: `${name} 12U`, ageLevel: 12, season: { season: "fall", year: 2026 } },
  games,
  fetchedAt: "2026-10-01T12:00:00.000Z",
});
const workouts = (games: GcGame[]) => schedule(WEX, "Wexcombe Workouts", games);
const answers = new Map<string, GcTeamSchedule>([
  [
    WEX,
    workouts([
      row("w1", "2026-09-12", "Brindlewood Badgers 12U"),
      row("w2", "2026-09-19", "Copperfield Cubs 12U"),
    ]),
  ],
]);

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
          const found = answers.get(teamId);
          const result: GcTeamResponse = found
            ? { ok: true, schedule: found }
            : { ok: false, reason: "not-found", message: "No such team." };
          out.set(teamId, result);
          options?.onProgress?.({ done: index + 1, total: ids.length, teamId, result });
        });
        return out;
      }
    ),
  };
});

const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T12:00:00"));
  resetPullSession();
  resetTeamRankingsStore();
  window.localStorage.clear();
});
afterEach(() => vi.useRealTimers());

/** The club as the pool held it, pulled once with its first game, when somebody vouched for it. */
const held: GcImportState = importGcSchedule(
  workouts([row("w1", "2026-09-12", "Brindlewood Badgers 12U")]),
  { ageGroups: [], teams: [], games: [] },
  { today: "2026-10-11", realClubs: new Set([WEX]) }
).state;
const clubId = held.teams.find((team) => team.gcTeams?.length)!.id;

/** Whether pulling the club again files its new game: a handful pasted by hand, none new. */
const pullsAgain = async (pool: GcImportState = held): Promise<boolean> => {
  const saved: GcImportState[] = [];
  const user = userEvent.setup();
  render(
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
  await user.type(screen.getByLabelText("Teams"), WEX);
  // Held already, so the panel offers it as a refresh of the one club.
  await user.click(screen.getByRole("button", { name: "Pull it again" }));
  // To the run's end, since a refused schedule changes nothing and so saves nothing.
  await waitFor(() => expect(lastPullLog()?.endedAt).toBeDefined());
  return saved.some((pool) => pool.games.some((game) => game.id === `gc_${WEX}_w2`));
};

describe("a pull in the browser, with the clubs the owner vouched for", () => {
  it("refuses the club on its name when nobody vouched for it", async () => {
    expect(await pullsAgain()).toBe(false);
  });

  it("pulls it again when it is on the real list", async () => {
    saveRealClubs(new Set([WEX]));
    expect(await pullsAgain()).toBe(true);
  });

  it("pulls it again when a League Standings team picks it", async () => {
    const season = createSeason("Fall 2026");
    writeSeasonData(season.id, {
      teams: [{ id: "lt-wex", name: "Workouts", scoutTeamId: clubId }],
      matchups: [],
      logs: {},
      bracketLogs: {},
      settings: loadSettingsForSeason(season.id),
    });
    const withLeague = {
      ...held,
      ageGroups: held.ageGroups.map((group) => ({ ...group, seasonIds: [season.id] })),
    };
    expect(await pullsAgain(withLeague)).toBe(true);
  });
});
