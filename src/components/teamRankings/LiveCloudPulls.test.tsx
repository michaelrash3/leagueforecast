import { useCallback } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SENT_PULLS_KEY, type PullSender } from "../../lib/cloud/cloudPulls";
import { newPullJob, type PullJob } from "../../lib/cloud/pullJobs";
import LiveCloudPulls, { PULL_LOOK_MS, useWatchedPulls } from "./LiveCloudPulls";

const NOW = "2026-10-12T23:00:00.000Z";
const ID = "0123456789abcdef0123456789abcdef";

const job = (patch: Partial<PullJob> = {}): PullJob => ({
  ...newPullJob({
    list: { hash: "a".repeat(64), teams: 448645, pieces: 1 },
    seasonYears: [],
    timeZone: "America/New_York",
    device: "test-device",
    now: NOW,
  }),
  pipeline: undefined,
  status: "running",
  stage: "loading",
  legs: 18,
  legsDone: 8,
  tally: {
    asked: 200000,
    answered: 190000,
    failed: 10000,
    filed: 190000,
    gamesAdded: 750000,
    gamesUpdated: 1000,
  },
  ...patch,
});

const cloud = () => {
  const read = vi.fn(async (): Promise<PullJob | null> => job());
  const sender: PullSender = {
    jobs: { read, put: vi.fn(), askStop: vi.fn() },
    start: vi.fn(async () => ({ ok: true as const, value: { status: "queued" } })),
  };
  return { sender, read };
};

function Panel({ sender }: { sender: PullSender }) {
  const pulls = useCallback(() => sender, [sender]);
  const watching = useWatchedPulls(pulls);
  return (
    <LiveCloudPulls
      pulls={pulls}
      watching={watching}
      locked={null}
      agelessIds={[]}
      rosterIds={[]}
      playing={2026}
      device="test-device"
      now={() => NOW}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  localStorage.clear();
  localStorage.setItem(
    SENT_PULLS_KEY,
    JSON.stringify([{ jobId: ID, sentAt: NOW, teams: 448645, told: false }])
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = async (sender: PullSender) => {
  await act(async () => {
    render(<Panel sender={sender} />);
  });
};
const tick = async (ms = PULL_LOOK_MS) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("visibility of a cloud pull", () => {
  it("shows the current part, server update age, saved counts, and a manual check", async () => {
    const { sender } = cloud();
    await open(sender);
    expect(
      screen.getByText("Pulling 448,645 teams in the cloud: part 9 of 18, reading the copy.")
    ).toBeTruthy();
    expect(screen.getByText("Last server update just now.")).toBeTruthy();
    expect(
      screen.getByText("Saved so far: 190,000 teams; 750,000 games added and 1,000 updated.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check progress now" })).toBeTruthy();
  });

  it("warns about an old stopping job without calling it cancelled or failed", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(job({ stopAsked: true, updatedAt: "2026-10-12T20:00:00.000Z" }));
    await open(sender);
    expect(screen.getByText("Pulling 448,645 teams in the cloud: stopping.")).toBeTruthy();
    expect(
      screen.getByText(
        "Last server update 3 hours ago. No recent progress; this pull may be stalled."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("keeps the last known progress after a failed read and automatically recovers", async () => {
    const { sender, read } = cloud();
    read
      .mockResolvedValueOnce(job())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(
        job({ stage: "fetching", progress: { done: 40, total: 25000, failed: 0 } })
      );
    await open(sender);
    await tick();
    expect(
      screen.getByText(
        "Last known status: Pulling 448,645 teams in the cloud: part 9 of 18, reading the copy."
      )
    ).toBeTruthy();
    expect(screen.getByText("Could not confirm the current status. Retrying.")).toBeTruthy();
    expect(screen.getByText(/Saved so far: 190,000 teams/)).toBeTruthy();
    await tick();
    expect(
      screen.getByText(
        "Pulling 448,645 teams in the cloud: part 9 of 18, asking GameChanger, 40 of 25,000."
      )
    ).toBeTruthy();
    expect(screen.queryByText("Could not confirm the current status. Retrying.")).toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
    expect(sender.jobs.put).not.toHaveBeenCalled();
  });

  it("keeps polling when the very first read fails instead of leaving an empty screen", async () => {
    const { sender, read } = cloud();
    read.mockRejectedValueOnce(new Error("offline"));
    await open(sender);
    expect(
      screen.getByText("Could not read progress for the pull of 448,645 teams. Retrying.")
    ).toBeTruthy();
    await tick();
    expect(screen.getByText("Last server update just now.")).toBeTruthy();
    expect(screen.queryByText(/Could not read progress for the pull/)).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("ages the last update even while a read hangs, and lets a manual check recover", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValueOnce(job()).mockImplementationOnce(() => new Promise(() => {}));
    await open(sender);
    await tick(5 * 60_000);
    expect(
      screen.getByText(
        "Last server update 5 minutes ago. No recent progress; this pull may be stalled."
      )
    ).toBeTruthy();
    read.mockResolvedValue(job({ updatedAt: new Date(Date.now()).toISOString() }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check progress now" }));
    });
    expect(screen.getByText("Last server update just now.")).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("stops automatic checks when the pull ends", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(job({ status: "done", end: "finished" }));
    await open(sender);
    expect(screen.getByText(/The pull in the cloud is done/)).toBeTruthy();
    expect(screen.queryByText(/may be stalled/)).toBeNull();
    await tick(2 * PULL_LOOK_MS);
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not bring back an acknowledged job when a pending read finishes", async () => {
    const { sender, read } = cloud();
    const done = job({ status: "done", end: "finished" });
    let release!: (value: PullJob) => void;
    read.mockResolvedValueOnce(done).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await open(sender);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check progress now" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await act(async () => {
      release(done);
    });
    expect(screen.queryByText(/The pull in the cloud is done/)).toBeNull();
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });
});
