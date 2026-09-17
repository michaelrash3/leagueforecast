import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GcTeamResponse } from "../lib/gameChangerApi";

/**
 * The client is mocked so the run is driven entirely from here: every id answers, so the only
 * thing that can end the run early is the panel's own decision about a refused save.
 */
const asked: string[][] = [];
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
        asked.push(ids);
        const out = new Map<string, GcTeamResponse>();
        ids.forEach((teamId, index) => {
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: `Team ${index} 12U`,
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

const ids = Array.from({ length: 12 }, (_, i) => `Team${String(i).padStart(8, "0")}`);

const renderPanel = (onPersist: () => boolean) => {
  const toasts: string[] = [];
  render(
    <GameChangerImportPanel
      pool={{ ageGroups: [], teams: [], games: [] }}
      onPersist={onPersist}
      savedProgress={null}
      onSaveProgress={() => {}}
      onClearProgress={() => {}}
      onClose={() => {}}
      showToast={(message) => toasts.push(message)}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );
  return { toasts };
};

describe("a save the browser refuses", () => {
  beforeEach(() => {
    asked.length = 0;
  });

  it("stops the run and says so, rather than fetching on with nowhere to put it", async () => {
    /*
     * On localStorage this is the only signal there is: writeValue reports whether the value
     * actually landed, while flushPoolWrites can only say whether the pool is usable at all. The
     * refusal reached here and was discarded, so a full pool meant hours of fetching that saved
     * none of it, with the cursor never advancing.
     */
    const user = userEvent.setup();
    const { toasts } = renderPanel(() => false);

    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(toasts.some((line) => /storage full/i.test(line))).toBe(true));
    expect(toasts.some((line) => /Stopping/i.test(line))).toBe(true);
  });

  it("says nothing of the sort when the save lands", async () => {
    const user = userEvent.setup();
    const { toasts } = renderPanel(() => true);

    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(toasts.some((line) => /storage full/i.test(line))).toBe(false);
  });
});
