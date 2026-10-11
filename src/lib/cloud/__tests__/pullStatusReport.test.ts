import { describe, expect, it } from "vitest";
import { newPullJob } from "../pullJobs";
import {
  clipped,
  jobLine,
  logLine,
  masked,
  minutesBefore,
  queueLine,
  taskLine,
} from "../pullStatusReport";

const ID = "0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-10-11T05:00:00Z");

const job = newPullJob({
  list: { hash: "h", teams: 9270, pieces: 1 },
  seasonYears: [2027],
  timeZone: "America/New_York",
  device: "Phone",
  now: "2026-10-11T04:20:00Z",
  refresh: true,
});

describe("masked", () => {
  it("cuts a pull's id to six characters wherever it sits, a task's name included", () => {
    expect(masked(`Leg 0 of pull ${ID}: done`)).toBe("Leg 0 of pull 012345…: done");
    expect(masked(`queues/runPull/tasks/${ID}-0`)).toBe("queues/runPull/tasks/012345…-0");
    const other = "fedcba9876543210fedcba9876543210";
    expect(masked(`${ID} then ${other}`)).toBe("012345… then fedcba…");
  });

  it("takes out an address unless it is a Google service account's", () => {
    expect(masked("refused coach.name@example.com here")).toBe("refused (an address) here");
    const account = "live-runner@league-forecast-youth.iam.gserviceaccount.com";
    expect(masked(`denied to ${account}`)).toBe(`denied to ${account}`);
  });

  it("leaves a longer hash whole", () => {
    const hash = "ab".repeat(32);
    expect(masked(hash)).toBe(hash);
  });
});

describe("clipped", () => {
  it("keeps a long text to its limit and folds its whitespace", () => {
    expect(clipped("a\n  b")).toBe("a b");
    const long = clipped("x".repeat(500));
    expect(long).toHaveLength(400);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("minutesBefore", () => {
  it("says minutes, just now, or never", () => {
    expect(minutesBefore("2026-10-11T04:20:00Z", NOW)).toBe("40 min ago");
    expect(minutesBefore("2026-10-11T04:59:50Z", NOW)).toBe("just now");
    expect(minutesBefore(undefined, NOW)).toBe("never");
  });
});

describe("jobLine", () => {
  it("says a job never written since it was made", () => {
    expect(jobLine(ID, job, NOW)).toBe(
      "012345… list of 9,270 teams, every one again: queued; part 1 of 1 (0 done); " +
        "made 2026-10-11T04:20:00Z (40 min ago); never written since; 0 filed, 0 games added"
    );
  });

  it("says a running job's stage, its stop, when it was last written and its error", () => {
    const line = jobLine(
      ID,
      {
        ...job,
        status: "running",
        stage: "fetching",
        stopAsked: true,
        progress: { done: 1200, total: 9270, failed: 3 },
        updatedAt: "2026-10-11T04:30:00Z",
        error: `The pull's worker stopped (exit 1) on ${ID}.`,
      },
      NOW
    );
    expect(line).toContain("running, asking GameChanger: 1,200 of 9,270, 3 unanswered");
    expect(line).toContain("stop asked");
    expect(line).toContain("last written 2026-10-11T04:30:00Z (30 min ago)");
    expect(line).toContain("error: The pull's worker stopped (exit 1) on 012345….");
  });
});

describe("queueLine and taskLine", () => {
  it("say a queue's state, limits and what waits in it", () => {
    expect(
      queueLine(
        {
          name: "projects/p/locations/us-central1/queues/runPull",
          state: "RUNNING",
          rateLimits: { maxConcurrentDispatches: 1 },
          retryConfig: { maxAttempts: 3, minBackoff: "120s", maxBackoff: "3600s" },
          stats: { tasksCount: "2", concurrentDispatchesCount: "1" },
        },
        NOW
      )
    ).toBe(
      "Queue runPull: RUNNING; 1 at a time; 3 tries, 120s to 3600s apart; 2 tasks in it; " +
        "1 running now; 0 run in the last minute"
    );
  });

  it("says a task's tries and how the last was answered", () => {
    expect(
      taskLine(
        {
          name: `projects/p/locations/us-central1/queues/runPull/tasks/${ID}-0`,
          createTime: "2026-10-11T04:20:00Z",
          scheduleTime: "2026-10-11T04:58:00Z",
          dispatchCount: 2,
          responseCount: 1,
          lastAttempt: {
            dispatchTime: "2026-10-11T04:40:00Z",
            responseTime: "2026-10-11T04:50:00Z",
            responseStatus: { code: 13, message: "Internal" },
          },
        },
        NOW
      )
    ).toBe(
      "Task 012345…-0; made 40 min ago; due 2 min ago; sent 2 times, answered 1; " +
        "last try: sent 20 min ago, answered 10 min ago with code 13 (Internal)"
    );
  });
});

describe("logLine", () => {
  const at = {
    timestamp: "2026-10-11T04:21:00Z",
    resource: { labels: { service_name: "runpull" } },
  };

  it("says a request's method, answer and time, and never who sent it", () => {
    expect(
      logLine({
        ...at,
        severity: "ERROR",
        httpRequest: { requestMethod: "POST", status: 500, latency: "1800s" },
      })
    ).toBe("2026-10-11T04:21:00Z ERROR runpull request POST answered 500 after 1800s");
  });

  it("says a structured line's message and fields, masked", () => {
    expect(
      logLine({
        ...at,
        severity: "INFO",
        jsonPayload: { message: "startPull", kind: "list", status: "queued", job: ID },
      })
    ).toBe(
      '2026-10-11T04:21:00Z INFO runpull: startPull {"kind":"list","status":"queued","job":"012345…"}'
    );
  });

  it("says what an audit entry did and how it ended, and never by whom", () => {
    expect(
      logLine({
        ...at,
        severity: "NOTICE",
        protoPayload: {
          methodName: "google.cloud.run.v2.Services.UpdateService",
          status: { code: 7, message: "Permission denied for coach@example.com" },
        },
      })
    ).toBe(
      "2026-10-11T04:21:00Z NOTICE runpull: google.cloud.run.v2.Services.UpdateService, " +
        "refused with code 7 (Permission denied for (an address))"
    );
    expect(logLine({ ...at, severity: "NOTICE", protoPayload: { methodName: "CreateTask" } })).toBe(
      "2026-10-11T04:21:00Z NOTICE runpull: CreateTask"
    );
  });

  it("says a text line, masked", () => {
    expect(logLine({ ...at, severity: "ERROR", textPayload: `Leg 0 of pull ${ID}: failed` })).toBe(
      "2026-10-11T04:21:00Z ERROR runpull: Leg 0 of pull 012345…: failed"
    );
  });
});
