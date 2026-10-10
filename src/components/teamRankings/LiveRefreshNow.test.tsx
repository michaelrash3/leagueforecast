import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { SENT_PULLS_KEY, type PullSender } from "../../lib/cloud/cloudPulls";
import { newPullJob, newRefreshJob, type PullJob } from "../../lib/cloud/pullJobs";
import type { Called, RefreshStart } from "../../lib/live/editClient";
import type { AnswerOf, PoolQuery, QueryKind, QueryOf } from "../../lib/live/queries";
import { PULLS_SIGNED_OUT } from "./LiveCloudPulls";
import LiveImport from "./LiveImport";
import { ALREADY_RUNNING, PULL_RUNNING, REFRESH_RUNNING } from "./LiveRefreshNow";

/*
 * "Refresh now" on the live Import tab's nightly card (`LiveRefreshNow`, in `LiveImport`): what it
 * will pull said before the press, from the server's own count; off, saying why, while edits are
 * locked, nobody is signed in, or a refresh or a pull is on its way; and a press's job watched in
 * the lines a pasted list is told in, to its end. The cloud here is a stand-in that makes the job
 * a press asks for, or refuses it. Placeholder names throughout.
 */

const NOW = "2026-10-10T19:00:00.000Z";
const JOB = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

const STATUS: AnswerOf<"import.status"> = {
  kind: "import.status",
  due: {
    ageLevels: [9, 10],
    heldBack: 2,
    label: "Today",
    catchUp: true,
    cadence: "daily",
    agelessTotal: 0,
    teams: 120,
    agelessDue: 0,
  },
  refreshNow: { teams: 120, heldBack: 2, again: false },
  refreshed: [{ level: 9, day: "2026-10-09" }],
  orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
  agelessIds: [],
  rosterIds: [],
};

/** The edit function as the tab reaches it: the status it answers, and every question asked. */
const editsOf = (status: AnswerOf<"import.status"> | null, locked: string | null = null) => {
  const asked: PoolQuery[] = [];
  const edits: LiveEdits = {
    locked,
    pending: [],
    edit: async () => true,
    ask: async <K extends QueryKind>(query: QueryOf<K>) => {
      asked.push(query);
      return (status ? structuredClone(status) : null) as AnswerOf<K> | null;
    },
    warm: () => undefined,
    say: () => undefined,
  };
  return { edits, asked };
};

/** The cloud in memory: its jobs, and what a press of Refresh now is answered. */
const cloudOf = (answer?: (asked: number) => Called<RefreshStart>) => {
  const jobs = new Map<string, PullJob>();
  const presses: Array<{ timeZone: string; device: string }> = [];
  const sender: PullSender = {
    jobs: {
      put: async (jobId, job) => {
        jobs.set(jobId, job);
      },
      read: async (jobId) => jobs.get(jobId) ?? null,
      askStop: async (jobId) => {
        const job = jobs.get(jobId);
        if (job) jobs.set(jobId, { ...job, stopAsked: true });
      },
    },
    start: async () => ({ ok: true, value: { status: "queued" } }),
    startRefresh: async (ask) => {
      presses.push(ask);
      const answered = answer?.(presses.length) ?? {
        ok: true,
        value: { status: "queued", jobId: JOB, already: false },
      };
      // The server makes the job it names, as `startRefresh` does.
      if (answered.ok && !jobs.has(answered.value.jobId)) {
        jobs.set(answered.value.jobId, newRefreshJob({ ...ask, now: NOW }));
      }
      return answered;
    },
  };
  return { jobs, presses, sender };
};

const open = ({ edits, pulls }: { edits: LiveEdits; pulls: () => PullSender | null }) =>
  render(<LiveImport edits={edits} now={() => NOW} pulls={pulls} device="device-test-1" />);

const refreshButton = () => screen.getByRole("button", { name: "Refresh now" });

/** A pull this device is watching, as `sendPull` or `sendRefresh` leaves it remembered. */
const watching = (jobId: string, teams = 120) =>
  localStorage.setItem(
    SENT_PULLS_KEY,
    JSON.stringify([{ jobId, sentAt: NOW, teams, told: false }])
  );

/** A refresh whose first leg has worked out 118 teams and is asking GameChanger about them. */
const running = (): PullJob => ({
  ...newRefreshJob({ timeZone: "America/New_York", device: "device-test-1", now: NOW }),
  status: "running",
  stage: "fetching",
  list: { hash: "b".repeat(64), teams: 118, pieces: 1 },
  rota: { at: NOW, ageLevels: [9, 10], again: false, heldBack: 2 },
  progress: { done: 40, total: 118, failed: 0 },
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Refresh now on the Import tab", () => {
  it("says what it will pull before the press: about this many teams, and what waits", async () => {
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf();
    open({ edits, pulls: () => cloud.sender });
    expect((await screen.findByTestId("refresh-offer")).textContent).toBe(
      "Refresh now pulls today's refresh in the cloud now rather than tonight: about 120 teams. 2 teams pulled in the last 16 hours with no game yesterday, today or tomorrow wait."
    );
    expect(refreshButton()).toHaveProperty("disabled", false);
  });

  it("says once today's levels are done that it pulls them again, held to the gap", async () => {
    const { edits } = editsOf({
      ...STATUS,
      due: { ...STATUS.due, ageLevels: [], teams: 0 },
      refreshNow: { teams: 12, heldBack: 108, again: true },
    });
    open({ edits, pulls: () => cloudOf().sender });
    expect((await screen.findByTestId("refresh-offer")).textContent).toBe(
      "Today's refresh has run. Refresh now pulls today's levels again in the cloud: about 12 teams. 108 teams pulled in the last 16 hours with no game yesterday, today or tomorrow wait."
    );
    expect(refreshButton()).toHaveProperty("disabled", false);
  });

  it("is off with nothing to pull, and not offered at all by a server from before it", async () => {
    const nothing = editsOf({ ...STATUS, refreshNow: { teams: 0, heldBack: 0, again: true } });
    open({ edits: nothing.edits, pulls: () => cloudOf().sender });
    expect((await screen.findByTestId("refresh-offer")).textContent).toBe(
      "Refresh now has nothing to pull just now."
    );
    expect(refreshButton()).toHaveProperty("disabled", true);
    cleanup();
    const older = { ...STATUS };
    delete older.refreshNow;
    open({ edits: editsOf(older).edits, pulls: () => cloudOf().sender });
    await screen.findByText(/Every age group is due today/);
    expect(screen.queryByRole("button", { name: "Refresh now" })).toBeNull();
  });

  it("is off, with the lock's reason, once edits are locked, and with nobody signed in", async () => {
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf();
    const view = open({ edits, pulls: () => cloud.sender });
    await screen.findByTestId("refresh-offer");
    const lock = "Edits wait for the cloud's board to come in.";
    view.rerender(
      <LiveImport
        edits={{ ...edits, locked: lock }}
        now={() => NOW}
        pulls={() => cloud.sender}
        device="device-test-1"
      />
    );
    expect(refreshButton()).toHaveProperty("disabled", true);
    expect(screen.getAllByText(lock).length).toBeGreaterThan(0);
    cleanup();
    open({ edits: editsOf(STATUS).edits, pulls: () => null });
    await screen.findByTestId("refresh-offer");
    expect(refreshButton()).toHaveProperty("disabled", true);
    expect(screen.getAllByText(PULLS_SIGNED_OUT).length).toBeGreaterThan(0);
    expect(cloud.presses).toEqual([]);
  });

  it("starts the refresh in the cloud on a press, sending no list, and watches it", async () => {
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf();
    open({ edits, pulls: () => cloud.sender });
    await screen.findByTestId("refresh-offer");
    fireEvent.click(refreshButton());
    expect(await screen.findByText("Refreshing in the cloud: waiting to start.")).toBeTruthy();
    expect(cloud.presses).toEqual([
      { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, device: "device-test-1" },
    ]);
    // While it is on its way the button is off, and says why.
    expect(refreshButton()).toHaveProperty("disabled", true);
    expect(screen.getByText(REFRESH_RUNNING)).toBeTruthy();
  });

  it("says how a refresh on its way is getting on, and its end once, reading the status again", async () => {
    watching(JOB);
    const { edits, asked } = editsOf(STATUS);
    const cloud = cloudOf();
    cloud.jobs.set(JOB, running());
    const view = open({ edits, pulls: () => cloud.sender });
    expect(
      await screen.findByText(/Refreshing 118 teams in the cloud: asking GameChanger, 40 of 118\./)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(refreshButton()).toHaveProperty("disabled", true);
    const before = asked.length;

    // Done, as the tab finds it on its next look.
    cloud.jobs.set(JOB, {
      ...running(),
      status: "done",
      stage: "waiting",
      end: "finished",
      tally: { asked: 118, answered: 118, failed: 0, filed: 118, gamesAdded: 9, gamesUpdated: 4 },
    });
    view.unmount();
    open({ edits, pulls: () => cloud.sender });
    expect(
      await screen.findByText(
        /The refresh in the cloud is done: 118 of 118 teams filed, 9 games added and 4 updated\./
      )
    ).toBeTruthy();
    // Its end moves what the card counts, so the status is read again.
    await waitFor(() => expect(asked.length).toBeGreaterThan(before + 1));
    expect(refreshButton()).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/The refresh in the cloud is done/)).toBeNull();
  });

  it("asks a refresh on its way to stop", async () => {
    watching(JOB);
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf();
    cloud.jobs.set(JOB, running());
    open({ edits, pulls: () => cloud.sender });
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(cloud.jobs.get(JOB)?.stopAsked).toBe(true));
    expect(await screen.findByText("Refreshing in the cloud: stopping.")).toBeTruthy();
  });

  it("shows the refresh another press started rather than starting another", async () => {
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf(() => ({
      ok: true,
      value: { status: "running", jobId: OTHER, already: true },
    }));
    cloud.jobs.set(OTHER, running());
    open({ edits, pulls: () => cloud.sender });
    await screen.findByTestId("refresh-offer");
    fireEvent.click(refreshButton());
    expect(await screen.findByText(ALREADY_RUNNING)).toBeTruthy();
    expect(
      await screen.findByText(/Refreshing 118 teams in the cloud: asking GameChanger/)
    ).toBeTruthy();
    expect(cloud.jobs.size).toBe(1);
  });

  it("says a refusal plainly, and watches nothing", async () => {
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf(() => ({
      ok: false,
      why: "failed",
      message: "The nightly refresh is pulling in the cloud right now.",
    }));
    open({ edits, pulls: () => cloud.sender });
    await screen.findByTestId("refresh-offer");
    fireEvent.click(refreshButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The cloud would not start the refresh: The nightly refresh is pulling in the cloud right now."
    );
    expect(cloud.jobs.size).toBe(0);
    expect(refreshButton()).toHaveProperty("disabled", false);
  });

  it("waits while a list this device sent is being pulled, saying so", async () => {
    watching(OTHER, 3);
    const { edits } = editsOf(STATUS);
    const cloud = cloudOf();
    cloud.jobs.set(OTHER, {
      ...newPullJob({
        list: { hash: "c".repeat(64), teams: 3, pieces: 1 },
        seasonYears: [],
        timeZone: "America/New_York",
        device: "device-test-1",
        now: NOW,
      }),
      status: "running",
    });
    open({ edits, pulls: () => cloud.sender });
    expect(await screen.findByText(PULL_RUNNING)).toBeTruthy();
    expect(refreshButton()).toHaveProperty("disabled", true);
    // The list's own lines stay in the pull card, not the nightly's.
    expect(screen.getByText(/Pulling 3 teams in the cloud/)).toBeTruthy();
  });

  it("still tells of a refresh on its way while the status cannot be read", async () => {
    watching(JOB);
    const cloud = cloudOf();
    cloud.jobs.set(JOB, running());
    await act(async () => {
      open({ edits: editsOf(null).edits, pulls: () => cloud.sender });
    });
    expect(await screen.findByText(/Refreshing 118 teams in the cloud/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh now" })).toBeNull();
  });
});
