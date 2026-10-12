import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import { resetTeamRankingsStore, saveNotThisTeam } from "../lib/teamRankingsStorage";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../lib/gameChangerApi";
import { importGcSchedule, type GcImportState } from "../lib/gameChangerImport";
import { refusalOf } from "../lib/notThisTeam";

/**
 * "Not this team" reaching a pull in the browser: the names the owner has said are not a club are
 * read from storage and handed to the importer, so a pulled schedule's new row of such a name is
 * filed against a stand-in rather than the club. A guard on one line of wiring, run through the
 * real panel, since the importer honouring the refusal says nothing about the panel passing it.
 * Placeholder names throughout.
 */
const HAWKS = "gcHAWKS00001";
const EAGLES = "gcEAGLES0001";

const row = (id: string, date: string, opponentName: string, hour: number): GcGame => ({
  id,
  date,
  startTs: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  opponentName,
  status: "completed",
  teamScore: 3,
  opponentScore: 5,
});
const schedule = (id: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `${name} 9U`,
    ageLevel: 9,
    state: "IL",
    season: { season: "fall", year: 2026 },
  },
  games,
  fetchedAt: "2026-09-24T12:00:00.000Z",
});
// The Eagles play a club nobody pulled each Saturday morning; the Hawks name "Eagles" one afternoon.
const eagles = schedule(EAGLES, "Eagles", [
  row("e1", "2026-08-08", "Comets", 10),
  row("e2", "2026-08-15", "Comets", 10),
]);
const hawks = schedule(HAWKS, "Prairie Hawks", [row("h1", "2026-08-15", "Eagles", 14)]);

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
          const result: GcTeamResponse = { ok: true, schedule: hawks };
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
  vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  resetPullSession();
  resetTeamRankingsStore();
  window.localStorage.clear();
});
afterEach(() => vi.useRealTimers());

/** The Hawks pulled into a pool holding the Eagles, and where their "Eagles" row was filed. */
const pull = async (): Promise<string | undefined> => {
  const saved: GcImportState[] = [];
  const pool = importGcSchedule(eagles, { ageGroups: [], teams: [], games: [] }).state;
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
  await user.type(screen.getByLabelText("Teams"), HAWKS);
  await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
  await waitFor(() => expect(saved.length).toBeGreaterThan(0));
  // The pull's own save, before the tidy at the end of the run, which reads the refusals too and
  // would take a row the import filed off the club whatever the import was told.
  const state = saved[0]!;
  const filed = state.games.find((game) => game.source?.teamId === HAWKS);
  const opponent = state.teams.find((team) => team.id === filed?.teamBId);
  return opponent?.gcTeams?.[0]?.teamId;
};

describe("a pull in the browser, with the owner's refusals", () => {
  it("files the name onto the club when nothing is refused", async () => {
    expect(await pull()).toBe(EAGLES);
  });

  it("files it onto no club the owner has said the name is not", async () => {
    saveNotThisTeam(new Set([refusalOf(HAWKS, "Eagles", EAGLES)]));
    expect(await pull()).toBeUndefined();
  });
});
