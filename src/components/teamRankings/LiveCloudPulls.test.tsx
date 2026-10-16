import { useCallback } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSentPulls, SENT_PULLS_KEY, type PullSender } from "../../lib/cloud/cloudPulls";
import { MAX_LIST_TEAMS, newPullJob, type PullJob } from "../../lib/cloud/pullJobs";
import LiveCloudPulls, { PULL_LOOK_MS, useWatchedPulls } from "./LiveCloudPulls";
import { downloadCsv } from "../../lib/download";
vi.mock("../../lib/download", () => ({ downloadCsv: vi.fn() }));

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
  vi.mocked(downloadCsv).mockClear();
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
  it("shows overall progress and downloads the retained skipped-team report", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(
      job({
        pipeline: "staged-v1",
        stage: "fetching",
        stageStartedAt: NOW,
        download: { total: 10000, done: 2500, perMinute: 600, holdUntil: null, holdReason: null },
        report: { rows: 3, ready: true },
      })
    );
    const report = vi.fn(async () => ["CSV header", "\nCSV rows"]);
    sender.jobs.report = report;
    await open(sender);
    expect(screen.getByText(/Download progress: 2,500 of 10,000 teams \(25%\)/)).toBeTruthy();
    expect(
      screen.getByText(/Skipped downloads: 10,000\. The finished import is published/)
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download skipped teams so far" }));
    });
    expect(report).toHaveBeenCalledWith(ID);
    expect(downloadCsv).toHaveBeenCalledWith("team-import-skipped-01234567.csv", [
      "CSV header",
      "\nCSV rows",
    ]);
  });
  it("keeps report download available after completion and offers a retry when the read fails", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(
      job({
        pipeline: "staged-v1",
        status: "done",
        end: "finished",
        report: { rows: 3, ready: true },
      })
    );
    const report = vi
      .fn<() => Promise<readonly string[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(["CSV"]);
    sender.jobs.report = report;
    await open(sender);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download skipped teams" }));
    });
    expect(screen.getByText("The report could not be read. Try again.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download skipped teams" }));
    });
    expect(downloadCsv).toHaveBeenCalledWith("team-import-skipped-01234567.csv", ["CSV"]);
    expect(screen.queryByText("The report could not be read. Try again.")).toBeNull();
  });
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

/*
 * A pull whose worker died without a word: the cloud keeps saying "running" until something asks
 * about it, and the 448,645-team list of 12 October 2026 sat at "part 9 of 18, stopping" for days,
 * its Stop already pressed and nothing else to press. A line silent for five minutes now offers
 * Dismiss, which asks the cloud about the job (ending it there if it is dead) and stops showing
 * it; a staged import also offers Resume.
 */
it("says a staged import's skips apart: those for now, asked once more, and the errors", async () => {
  const { sender, read } = cloud();
  read.mockResolvedValue(
    job({
      pipeline: "staged-v1",
      stage: "fetching",
      heartbeatAt: NOW,
      tally: { ...job().tally, failed: 4 },
      skipped: { transient: 3, permanent: 1 },
    })
  );
  await open(sender);
  expect(
    screen.getByText(
      /Skipped downloads: 4: 3 for now, asked once more before the final tidy, and 1 GameChanger answered with an error\./
    )
  ).toBeTruthy();
});

it("says apart the skips of an earlier run of a resumed list", async () => {
  const { sender, read } = cloud();
  read.mockResolvedValue(
    job({
      pipeline: "staged-v1",
      stage: "fetching",
      heartbeatAt: NOW,
      tally: { ...job().tally, failed: 10 },
      skipped: { transient: 3, permanent: 1 },
    })
  );
  await open(sender);
  expect(
    screen.getByText(
      /Skipped downloads: 10: 3 for now, asked once more before the final tidy, 1 GameChanger answered with an error, and 6 in the earlier run of this list\./
    )
  ).toBeTruthy();
});

describe("a pull gone silent", () => {
  const hoursAgo = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

  it("offers Dismiss on the stuck stopping job, which asks the cloud and hides the line", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(job({ stopAsked: true, updatedAt: hoursAgo(3) }));
    await open(sender);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(sender.start).toHaveBeenCalledWith(ID);
    expect(screen.queryByText(/Pulling 448,645 teams in the cloud/)).toBeNull();
    expect(loadSentPulls()).toEqual([expect.objectContaining({ jobId: ID, told: true })]);
  });

  it("offers neither Dismiss nor Resume on a pull heard from lately", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(job({ pipeline: "staged-v1", heartbeatAt: NOW }));
    await open(sender);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume saved import" })).toBeNull();
  });

  it("offers Resume on a staged import gone silent, beside Stop and Dismiss", async () => {
    const { sender, read } = cloud();
    const resume = vi.fn(async () => ({ ok: true as const, value: { status: "queued" } }));
    sender.resume = resume;
    read.mockResolvedValue(
      job({
        pipeline: "staged-v1",
        list: { hash: "a".repeat(64), teams: 30_000, pieces: 1 },
        stage: "fetching",
        heartbeatAt: hoursAgo(0.1),
        updatedAt: hoursAgo(0.2),
      })
    );
    await open(sender);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume saved import" }));
    });
    expect(resume).toHaveBeenCalledWith(ID);
  });

  it("says why the cloud would not resume one, rather than nothing", async () => {
    const { sender, read } = cloud();
    sender.resume = vi.fn(async () => ({
      ok: false as const,
      why: "invalid" as const,
      message: "This import cannot be resumed.",
    }));
    read.mockResolvedValue(
      job({
        pipeline: "staged-v1",
        status: "failed",
        list: { hash: "a".repeat(64), teams: 30_000, pieces: 1 },
      })
    );
    await open(sender);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume saved import" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("This import cannot be resumed.");
  });

  it("asks the cloud about a silent pull at once when Stop is pressed on it", async () => {
    const { sender, read } = cloud();
    read.mockResolvedValue(job({ updatedAt: hoursAgo(3) }));
    await open(sender);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    expect(sender.jobs.askStop).toHaveBeenCalledWith(ID);
    expect(sender.start).toHaveBeenCalledWith(ID);
  });
});

describe("a pasted list", () => {
  const paste = async (text: string) => {
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Teams to pull" }), {
        target: { value: text },
      });
    });
  };
  const ids = (count: number) =>
    Array.from({ length: count }, (_, n) => `gc${String(n).padStart(10, "0")}`).join("\n");

  it("longer than one pull takes says it runs as parts, and is sent as them", async () => {
    // Packing and fingerprinting a list this long is real work, done on the real clock.
    vi.useRealTimers();
    const { sender } = cloud();
    await open(sender);
    await paste(ids(MAX_LIST_TEAMS));
    expect(screen.queryByText(/parts of up to/)).toBeNull();
    await paste(ids(MAX_LIST_TEAMS + 1));
    expect(
      screen.getByText(
        "This list will run in the cloud as 2 parts of up to 50,000 teams, one after another."
      )
    ).toBeTruthy();
    const button = screen.getByRole("button", { name: /^Pull 50,001 teams in the cloud$/ });
    expect(button).toHaveProperty("disabled", false);
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(sender.start).toHaveBeenCalled(), { timeout: 20_000 });
    // Two parts written, the last first, and only the first started.
    const written = vi.mocked(sender.jobs.put).mock.calls.map(([jobId, job]) => [jobId, job]);
    expect(written.map(([, job]) => (job as PullJob).chain?.part)).toEqual([2, 1]);
    expect(written.map(([, job]) => (job as PullJob).list.teams)).toEqual([1, 50_000]);
    expect(sender.start).toHaveBeenCalledTimes(1);
    expect(sender.start).toHaveBeenCalledWith(written[1]?.[0]);
  }, 30_000);

  // Slugs and names where an id should be, which GameChanger answers with HTTP 400, said before
  // the list is sent rather than found in the skipped-team report after.
  it("counts what does not look like a GameChanger id, and the lines that named none", async () => {
    const { sender } = cloud();
    await open(sender);
    await paste(
      [
        "Team Name,Team ID",
        "Aces 10U,gK5JSTKGwRYz",
        "Bears 10U,bears-baseball-10u",
        // Only the name filled in, under a header that says it is a name: no id at all.
        "Cubs10Uteam,",
        "Dodgers 10U,Dodgersxx",
      ].join("\n")
    );
    expect(screen.getByRole("button", { name: /^Pull 3 teams in the cloud$/ })).toBeTruthy();
    expect(
      screen.getByText(
        "2 of these do not look like GameChanger team ids, which are the 12 letters and digits after web.gc.com/teams/; GameChanger will likely refuse them. 1 line named no team id and is left out."
      )
    ).toBeTruthy();
  });
});

/*
 * A list sent in parts (`PullJob.chain`) is one line on the card, about the whole list, carrying
 * the buttons of its part under way, or of the part it halted at.
 */
describe("a list sent in parts", () => {
  const PARTS = ["1".repeat(32), "2".repeat(32), "3".repeat(32)] as const;
  const [FIRST, SECOND, THIRD] = PARTS;
  const partJob = (index: number, patch: Partial<PullJob>): PullJob => {
    const next = PARTS[index + 1];
    return {
      ...newPullJob({
        list: { hash: "a".repeat(64), teams: index < 2 ? 50_000 : 1, pieces: 1 },
        seasonYears: [],
        timeZone: "America/New_York",
        device: "test-device",
        now: NOW,
        chain: { id: FIRST, part: index + 1, parts: 3, teams: 100_001, ...(next ? { next } : {}) },
      }),
      ...patch,
    };
  };
  /** The card watching the three parts, as `patches` leave each. */
  const watchingParts = (patches: [Partial<PullJob>, Partial<PullJob>, Partial<PullJob>]) => {
    localStorage.setItem(
      SENT_PULLS_KEY,
      JSON.stringify(
        PARTS.map((jobId, index) => ({
          jobId,
          sentAt: NOW,
          teams: index < 2 ? 50_000 : 1,
          told: false,
        }))
      )
    );
    const jobs = new Map(PARTS.map((jobId, index) => [jobId, partJob(index, patches[index]!)]));
    const { sender, read } = cloud();
    read.mockImplementation(async (jobId?: string) => (jobId ? (jobs.get(jobId) ?? null) : null));
    sender.resume = vi.fn(async () => ({ ok: true as const, value: { status: "queued" } }));
    return { sender, jobs };
  };
  const hoursAgo = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

  it("is one line about the whole list, with one Stop that stops the parts after it too", async () => {
    const { sender } = watchingParts([
      { status: "done" },
      {
        status: "running",
        stage: "fetching",
        legs: 5,
        heartbeatAt: NOW,
        progress: { done: 4_000, total: 10_000, failed: 0 },
      },
      {},
    ]);
    await open(sender);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByText(
        "Pulling 100,001 teams in the cloud as 3 parts, one after another. Part 2 of 3 (50,000 teams): download batch 1 of 5, 4,000 downloaded, 0 skipped, 6,000 remaining in this batch. Part 1 is done; part 3 waits its turn."
      )
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    // The part after it first, then the part under way; the one that never ran asked about,
    // which cancels it.
    expect(vi.mocked(sender.jobs.askStop).mock.calls).toEqual([[THIRD], [SECOND]]);
    expect(sender.start).toHaveBeenCalledWith(THIRD);
    expect(sender.start).not.toHaveBeenCalledWith(SECOND, expect.anything());
  });

  it("says the whole list's end once, and OK tells of every part", async () => {
    const tally = {
      asked: 50_000,
      answered: 50_000,
      failed: 0,
      filed: 50_000,
      gamesAdded: 9,
      gamesUpdated: 1,
    };
    const { sender } = watchingParts([
      { status: "done", tally },
      { status: "done", tally },
      { status: "done", tally: { ...tally, asked: 1, answered: 1, filed: 1 } },
    ]);
    await open(sender);
    expect(
      screen.getByText(
        "The pull of 100,001 teams in the cloud is done, in 3 parts: 100,001 of 100,001 teams filed, 27 games added and 3 updated."
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    expect(loadSentPulls().map(({ told }) => told)).toEqual([true, true, true]);
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("offers Resume on the part it halted at, saying the list carries on from there", async () => {
    const { sender } = watchingParts([
      { status: "done" },
      { status: "failed", error: "The importer stopped without saying why." },
      {},
    ]);
    await open(sender);
    expect(
      screen.getByText(
        "The pull of 100,001 teams in the cloud stopped at part 2 of 3, which failed: The importer stopped without saying why. Resume carries the list on from part 2."
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume saved import" }));
    });
    expect(sender.resume).toHaveBeenCalledWith(SECOND);
    // Its later part, waiting on it, is never asked to start meanwhile.
    expect(sender.start).not.toHaveBeenCalledWith(THIRD, expect.anything());
    expect(sender.start).not.toHaveBeenCalledWith(THIRD);
  });

  it("stops reading once it halts at a part that failed, its later part still queued", async () => {
    const { sender } = watchingParts([{ status: "done" }, { status: "failed" }, {}]);
    await open(sender);
    const reads = vi.mocked(sender.jobs.read).mock.calls.length;
    await tick();
    await tick();
    expect(vi.mocked(sender.jobs.read).mock.calls.length).toBe(reads);
    // While a part is under way it is read again at every look.
    cleanup();
    const moving = watchingParts([{ status: "done" }, { status: "running", heartbeatAt: NOW }, {}]);
    await open(moving.sender);
    const before = vi.mocked(moving.sender.jobs.read).mock.calls.length;
    await tick();
    expect(vi.mocked(moving.sender.jobs.read).mock.calls.length).toBeGreaterThan(before);
  });

  it("asks the cloud to start a part whose turn has come, the part before it done", async () => {
    const { sender } = watchingParts([{ status: "done" }, {}, {}]);
    await open(sender);
    expect(sender.start).toHaveBeenCalledWith(SECOND, undefined);
    expect(sender.start).not.toHaveBeenCalledWith(THIRD, expect.anything());
  });

  it("Dismiss on a silent part cancels the parts after it and tells of the whole list", async () => {
    const { sender } = watchingParts([
      { status: "done" },
      { status: "running", stage: "fetching", heartbeatAt: hoursAgo(1), updatedAt: hoursAgo(1) },
      {},
    ]);
    await open(sender);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(sender.start).toHaveBeenCalledWith(SECOND);
    expect(sender.jobs.askStop).toHaveBeenCalledWith(THIRD);
    expect(sender.jobs.askStop).not.toHaveBeenCalledWith(SECOND);
    expect(sender.start).toHaveBeenCalledWith(THIRD);
    expect(loadSentPulls().map(({ told }) => told)).toEqual([true, true, true]);
  });
});
