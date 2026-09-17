import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPoolBusy, lastPullLog, resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";

/**
 * Two teams answer, one is refused with a WAF-shaped body. Everything the tracker is for is in
 * the difference between those two rows.
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
            attempts: number;
            firstFailure?: string;
          }) => void;
          onBlocked?: () => void;
          onHold?: (ms: number, source: string) => void;
        }
      ) => {
        asked.push(ids);
        const out = new Map<string, GcTeamResponse>();
        ids.forEach((teamId, index) => {
          const refused = index % 2 === 1;
          const result: GcTeamResponse = refused
            ? {
                ok: false,
                reason: "blocked",
                message: "GameChanger refused the request.",
                status: 403,
                diagnostics: {
                  url: `https://api.gc.com/public/teams/${teamId}`,
                  contentType: "text/html",
                  bodyPreview: "<html>awswaf challenge</html>",
                },
              }
            : {
                ok: true,
                schedule: {
                  profile: {
                    id: teamId,
                    name: `Warriors ${index} 2027`,
                    ageLabel: "2027",
                    season: { season: "fall", year: 2026 },
                  },
                  games: [],
                  fetchedAt: "2026-09-17T00:00:00.000Z",
                },
              };
          if (refused) {
            options?.onBlocked?.();
            options?.onHold?.(5_000, "refused");
          }
          out.set(teamId, result);
          options?.onProgress?.({
            done: index + 1,
            total: ids.length,
            teamId,
            result,
            attempts: refused ? 1 : 2,
            ...(refused ? {} : { firstFailure: "throttled" }),
          });
        });
        return out;
      }
    ),
  };
});

const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

const ids = Array.from({ length: 12 }, (_, i) => `Team${String(i).padStart(8, "0")}`);

const renderPanel = (onPersist: () => boolean = () => true) => {
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

const runPull = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText("Teams"), ids.join("\n"));
  await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Summary$/ })).toBeInTheDocument()
  );
};

describe("what the run wrote down about itself", () => {
  beforeEach(() => {
    asked.length = 0;
    resetPullSession();
    window.localStorage.clear();
  });
  afterEach(() => {
    resetPullSession();
    vi.restoreAllMocks();
  });

  it("records a row for every id, with what GameChanger said about each", async () => {
    const user = userEvent.setup();
    renderPanel();
    await runPull(user);

    const log = lastPullLog();
    expect(log?.ids).toHaveLength(12);
    expect(log?.teams).toHaveLength(12);
    const filed = log?.teams.find((row) => row.ok);
    /*
     * The label is the whole reason this column exists: "2027" parses to no age level at all, so
     * without it a team with no age looks the same whether GameChanger filed it under a graduation
     * year, an unreadable bracket, or nothing.
     */
    expect(filed?.ageLabel).toBe("2027");
    expect(filed?.ageLevel).toBeUndefined();
    expect(filed?.nameYear).toBe(2027);
  });

  it("keeps the diagnostics the panel used to throw away", async () => {
    const user = userEvent.setup();
    renderPanel();
    await runPull(user);

    const log = lastPullLog();
    const refused = log?.teams.find((row) => row.reason === "blocked");
    expect(refused?.status).toBe(403);
    expect(refused?.contentType).toBe("text/html");
    expect(refused?.failedOn).toBe("profile");
    // The challenge page once, with a count — not six copies of the same sentence.
    expect(log?.samples).toHaveLength(1);
    expect(log?.samples[0]?.body).toContain("awswaf");
    expect(log?.blocked).toBe(6);
  });

  it("counts what held the run up, and what the retries rescued", async () => {
    const user = userEvent.setup();
    renderPanel();
    await runPull(user);

    const log = lastPullLog();
    expect(log?.holdsBySource).toEqual({ refused: 6 });
    expect(log?.heldMs).toBe(30_000);
    // A team that failed once and came back on the second attempt is invisible without this.
    expect(log?.teams.filter((row) => row.firstFailure === "throttled")).toHaveLength(6);
  });

  it("says what the paste turned into before a single id was asked for", async () => {
    const user = userEvent.setup();
    renderPanel();
    await runPull(user);

    const paste = lastPullLog()?.paste;
    expect(paste?.parsed).toBe(12);
    expect(paste?.asked).toBe(12);
  });

  it("offers both files, and a row count that matches what was asked for", async () => {
    const user = userEvent.setup();
    renderPanel();
    await runPull(user);

    expect(screen.getByRole("button", { name: /^Summary$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Every team \(12 rows\)/ })).toBeInTheDocument();
  });

  it("writes the files with a byte order mark, or Excel mangles every name", async () => {
    const bodies: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:stub");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          bodies.push(parts.map(String).join(""));
          super(parts, options);
        }
      }
    );

    const user = userEvent.setup();
    renderPanel();
    await runPull(user);
    await user.click(screen.getByRole("button", { name: /^Summary$/ }));

    expect(bodies[bodies.length - 1]?.startsWith("﻿")).toBe(true);
    expect(bodies[bodies.length - 1]).toContain("# Section: Run");
    vi.unstubAllGlobals();
  });

  /*
   * The one rule the tracker cannot break. It exists to record an hour of fetching that cannot be
   * repeated cheaply; taking that hour down to record it is exactly backwards. So every call into
   * it is wrapped, and a tracker that throws costs a blank cell and nothing else.
   */
  it("cannot take the run down with it", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText("Teams"), ids.join("\n"));

    // A storage that throws on every write is the likeliest way this happens for real.
    const storage = await import("../lib/teamRankingsStorage");
    vi.spyOn(storage, "savePullLog").mockImplementation(() => {
      throw new Error("quota");
    });

    await user.click(screen.getByRole("button", { name: /^Pull \d+ schedules?$/ }));

    // The run still reaches its summary, and lets go of the pool.
    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    expect(isPoolBusy()).toBe(false);
    expect(asked).toHaveLength(1);
  });
});
