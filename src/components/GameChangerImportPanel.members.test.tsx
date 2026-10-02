import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStatus } from "../lib/cloud/cloudSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import { markRefreshed, type RefreshLog } from "../lib/gameChangerSchedule";
import type { GcImportState } from "../lib/gameChangerImport";
import { remainingIds, startPull, type GcPullProgress } from "../lib/gameChangerPull";
import { MEMBERS_ONLY_MESSAGES } from "../lib/memberCheck";
import { lastPullLog, resetPullSession } from "../lib/pullSession";
import type { AgeGroup, ScoutTeam } from "../lib/teamRankings";
import { saveAgeUnknown } from "../lib/teamRankingsStorage";

/**
 * The import panel in a browser the GameChanger proxy will not serve.
 *
 * The proxy is for the accounts on the cloud copy's list (`memberCheck.ts`). The panel knows from
 * the cloud session whether this browser is signed in with one, and says so before a run rather
 * than letting one start and stop on its first request. The session is a stand-in here, set by
 * each test; what the proxy itself answers is `memberCheck.test.ts`'s. Invented names throughout.
 */
const cloud = vi.hoisted(() => {
  let status: CloudStatus = { kind: "none" };
  const listeners = new Set<(next: CloudStatus) => void>();
  return {
    get: (): CloudStatus => status,
    set: (next: CloudStatus) => {
      status = next;
      listeners.forEach((listener) => listener(next));
    },
    subscribe: (listener: (next: CloudStatus) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
vi.mock("../lib/cloud/cloudSession", async () => ({
  ...(await vi.importActual<typeof import("../lib/cloud/cloudSession")>(
    "../lib/cloud/cloudSession"
  )),
  cloudStatus: cloud.get,
  subscribeCloud: cloud.subscribe,
}));

const asked: string[][] = [];
/** How the stand-in proxy answers: every team, one team unreached, or the browser turned away. */
let answer: "all" | "one-unreached" | "turned-away" = "all";
/** Held open so a run can be looked at while it is going. */
let pause: Promise<void> | null = null;
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
          }) => void;
          onMembersOnly?: (message: string) => void;
        }
      ) => {
        asked.push(ids);
        if (pause) await pause;
        const out = new Map<string, GcTeamResponse>();
        if (answer === "turned-away") {
          // As `fetchGcTeams` does: said once, and no team settled.
          options?.onMembersOnly?.(MEMBERS_ONLY_MESSAGES["not-member"]);
          return out;
        }
        ids.forEach((teamId, index) => {
          const result: GcTeamResponse =
            answer === "one-unreached" && index === 0
              ? { ok: false, reason: "network", message: "Could not reach the proxy." }
              : {
                  ok: true,
                  schedule: {
                    profile: {
                      id: teamId,
                      name: `${teamId} 10U`,
                      ageLevel: 10,
                      season: { season: "fall", year: 2026 },
                    },
                    games: [],
                    fetchedAt: "2026-09-24T11:00:00.000Z",
                  },
                };
          out.set(teamId, result);
          options?.onProgress?.({
            done: index + 1,
            total: ids.length,
            teamId,
            result,
            attempts: 1,
          });
        });
        return out;
      }
    ),
  };
});

const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

const GROUPS: AgeGroup[] = [
  { id: "10u", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const LINKED = ["TenA00000010", "TenA00000020"];
/** Every way a pull starts, all on screen at once: the day's refresh, an under-strength page… */
const teams: ScoutTeam[] = LINKED.map((teamId, index) => ({
  id: `team-${teamId}`,
  name: `River City ${index + 1} 10U`,
  gcTeams: [
    {
      teamId,
      name: `River City ${index + 1} 10U`,
      ageGroupId: "10u",
      season: "fall",
      seasonYear: 2026,
      ageLevel: 10,
      ...(index === 0 ? { playerCount: 7, countedAt: "2026-09-01T12:00:00.000Z" } : {}),
    },
  ],
}));
const pool: GcImportState = { ageGroups: GROUPS, teams, games: [] };
/** …a run that was interrupted… */
const interrupted = startPull(["OldA00000010", "OldA00000020"], "2026-09-24T10:00:00.000Z");
/** …and a pasted list of teams nobody has pulled. */
const FRESH = ["NewA00000010", "NewA00000020"];

const MEMBER: CloudStatus = {
  kind: "saved",
  account: { uid: "uid-member", email: "member@example.com" },
  owed: false,
  newer: [],
};

const renderPanel = ({
  savedProgress = null,
  refreshLog = {},
}: { savedProgress?: GcPullProgress | null; refreshLog?: RefreshLog } = {}) => {
  const toasts: string[] = [];
  const cursors: GcPullProgress[] = [];
  const { unmount } = render(
    <GameChangerImportPanel
      pool={pool}
      onPersist={() => true}
      savedProgress={savedProgress}
      droppedClubs={new Set()}
      onInvented={() => {}}
      namedAges={new Map()}
      onSaveProgress={(progress) => cursors.push(progress)}
      onClearProgress={() => {}}
      onClose={() => {}}
      showToast={(message) => toasts.push(message)}
      refreshLog={refreshLog}
      onRefreshLog={() => {}}
    />
  );
  return { toasts, cursors, unmount };
};

const note = () => screen.queryByTestId("gc-pull-blocked");
const pullButton = () => screen.getByRole("button", { name: /^Pull \d+ schedules?$/ });

/*
 * Pinned to a day in Fall 2026, the season these teams play, so the day's refresh, the roster
 * check and the age ask are all due; only the date is faked, so the pull's own timers run.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00"));
  asked.length = 0;
  answer = "all";
  pause = null;
  resetPullSession();
  window.localStorage.clear();
  // A team nobody could age, last asked about a fortnight ago: due its weekly ask.
  saveAgeUnknown([
    {
      teamId: "AgeA00000010",
      name: "Derby City",
      firstSeen: "2026-09-01T12:00:00.000Z",
      lastTried: "2026-09-10T12:00:00.000Z",
      tries: 1,
    },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  resetPullSession();
});

describe("pulling from GameChanger in a browser the proxy will not serve", () => {
  it("tells a browser nobody has signed in to why, turns off every way to start, and asks nothing", async () => {
    cloud.set({ kind: "none" });
    const user = userEvent.setup();
    const { cursors } = renderPanel({ savedProgress: interrupted });

    expect(note()).toHaveTextContent(
      "Pulling from GameChanger is for the accounts on the cloud copy's list. Sign in with one from the cloud button, then pull."
    );
    await user.type(screen.getByLabelText("Teams"), FRESH.join("\n"));
    const starters = [
      screen.getByRole("button", { name: /^Refresh all \d+ teams$/ }),
      screen.getByRole("button", { name: /^Ask again about 1 team with no age/ }),
      screen.getByRole("button", { name: /^Check them again$/ }),
      screen.getByRole("button", { name: "Carry on" }),
      pullButton(),
    ];
    for (const button of starters) {
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(asked).toEqual([]);
    // Nothing saved over the interrupted run either.
    expect(cursors).toEqual([]);
  });

  it("turns off running a day again once it is done", async () => {
    cloud.set({ kind: "signed-out" });
    const user = userEvent.setup();
    renderPanel({ refreshLog: markRefreshed({}, [10], new Date()) });
    const again = screen.getByRole("button", { name: /^Refresh all \d+ teams again$/ });
    expect(again).toBeDisabled();
    await user.click(again);
    expect(asked).toEqual([]);
  });

  it("names the account the copy turned away, and tells it to ask", () => {
    cloud.set({ kind: "not-owner", account: { uid: "uid-x", email: "coach@example.com" } });
    renderPanel();
    expect(note()).toHaveTextContent(
      "coach@example.com is not on the cloud copy's list, so it cannot pull from GameChanger. Ask the list's owner to add it."
    );
    expect(screen.getByRole("button", { name: /^Refresh all \d+ teams$/ })).toBeDisabled();
  });

  it("leaves a member alone, and a build or a copy it cannot be sure of to the proxy", () => {
    for (const status of [
      MEMBER,
      { kind: "off" },
      { kind: "connecting" },
      { kind: "error", account: null, message: "Could not reach the cloud." },
    ] satisfies CloudStatus[]) {
      cloud.set(status);
      const { unmount } = renderPanel();
      expect(note()).toBeNull();
      expect(screen.getByRole("button", { name: /^Refresh all \d+ teams$/ })).toBeEnabled();
      unmount();
    }
  });

  it("opens the moment the account signs in, and the pull goes ahead", async () => {
    cloud.set({ kind: "signed-out" });
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText("Teams"), FRESH.join("\n"));
    expect(pullButton()).toBeDisabled();

    act(() => cloud.set(MEMBER));
    expect(note()).toBeNull();
    await user.click(pullButton());
    await waitFor(() => expect(asked).toEqual([FRESH]));
  });

  it("stops a run the proxy turns away, says why, and leaves its teams to ask again", async () => {
    cloud.set(MEMBER);
    answer = "turned-away";
    const user = userEvent.setup();
    const { toasts, cursors } = renderPanel();
    await user.type(screen.getByLabelText("Teams"), FRESH.join("\n"));
    await user.click(pullButton());

    await waitFor(() => expect(lastPullLog()?.endReason).toBe("stopped"));
    expect(asked).toEqual([FRESH]);
    expect(toasts).toContain(MEMBERS_ONLY_MESSAGES["not-member"]);
    const cursor = cursors[cursors.length - 1];
    expect(cursor && remainingIds(cursor)).toEqual(FRESH);
  });

  it("says nothing while a run is going, and turns off its retry once the account has gone", async () => {
    cloud.set(MEMBER);
    answer = "one-unreached";
    let release = () => {};
    pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText("Teams"), FRESH.join("\n"));
    await user.click(pullButton());
    await waitFor(() => expect(asked).toHaveLength(1));

    // Signed out part way: the run is under way, and the proxy will say so if it minds.
    act(() => cloud.set({ kind: "signed-out" }));
    expect(note()).toBeNull();

    release();
    const retry = await screen.findByRole("button", { name: "Try the unreached ones again" });
    expect(note()).not.toBeNull();
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(asked).toHaveLength(1);
  });
});
