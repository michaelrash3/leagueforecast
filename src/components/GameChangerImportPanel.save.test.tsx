import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginPull, isPoolBusy, resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";

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

const emptyPool: GcImportState = { ageGroups: [], teams: [], games: [] };

const renderPanel = (onPersist: () => boolean, pool: GcImportState = emptyPool) => {
  const toasts: string[] = [];
  render(
    <GameChangerImportPanel
      pool={pool}
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
    resetPullSession();
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

    /*
     * The message names no cause. The caller has already said which one on its way to returning
     * false — a full store, or a store that will not take this snapshot as the whole pool — and
     * this would be guessing over the top of it.
     */
    await waitFor(() =>
      expect(toasts.some((line) => /could not save the pull/i.test(line))).toBe(true)
    );
    expect(toasts.some((line) => /Stopping/i.test(line))).toBe(true);
  });

  it("says nothing of the sort when the save lands", async () => {
    const user = userEvent.setup();
    const { toasts } = renderPanel(() => true);

    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(toasts.some((line) => /could not save/i.test(line))).toBe(false);
  });
});

describe("a pull that outlives its panel", () => {
  beforeEach(() => {
    asked.length = 0;
    resetPullSession();
  });
  afterEach(() => resetPullSession());

  it("refuses to start a second run while one is going", async () => {
    /*
     * Closing the panel hides the run and keeps it going, which is what was asked for — so a
     * reopened panel must not be able to start another. Both write whole-pool snapshots, so the
     * later one overwrites the earlier's teams while the cursor records them as settled, and a
     * resume then skips them for good. Two clicks used to reach it: Close, reopen, Carry on.
     */
    const user = userEvent.setup();
    beginPull("2026-09-17T08:00:00.000Z");
    const { toasts } = renderPanel(() => true);

    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    expect(asked).toHaveLength(0);
    expect(toasts.some((line) => /already running/i.test(line))).toBe(true);
  });

  it("says so on screen, and offers to stop it", async () => {
    beginPull("2026-09-17T08:00:00.000Z");
    renderPanel(() => true);

    expect(screen.getByText(/A pull is already running/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop the running pull/i })).toBeInTheDocument();
  });

  it("offers nothing of the sort when nothing is running", async () => {
    renderPanel(() => true);
    expect(screen.queryByText(/A pull is already running/i)).not.toBeInTheDocument();
  });
});

describe("the tidy at the end of a run", () => {
  beforeEach(() => {
    asked.length = 0;
    resetPullSession();
  });
  afterEach(() => resetPullSession());

  /*
   * The tidy takes the same slot the pull does, because it reads the whole pool, works for the
   * better part of half a minute, and saves all of it. A claim it failed to give back would refuse
   * every pull and every tidy for the rest of the session, with nothing on screen to say why.
   */
  it("hands the pool back when the run is over", async () => {
    const user = userEvent.setup();
    renderPanel(() => true);

    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    // The run reaches its summary...
    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    // ...and nothing is left holding the pool.
    expect(isPoolBusy()).toBe(false);
  });

  it("will not tidy by hand while a pull is running", async () => {
    /*
     * Both write the whole pool, so the tidy would save over the teams the pull had just written —
     * and the pull's cursor has already counted them settled, so a resume would never fetch them
     * again.
     */
    beginPull("2026-09-17T08:00:00.000Z");
    renderPanel(() => true, {
      ageGroups: [],
      teams: [],
      games: [
        {
          id: "g1",
          ageGroupId: "ag",
          teamAId: "a",
          teamBId: "b",
          teamAScore: 1,
          teamBScore: 0,
        },
      ],
    });

    expect(screen.getByRole("button", { name: /tidy now/i })).toBeDisabled();
  });
});
