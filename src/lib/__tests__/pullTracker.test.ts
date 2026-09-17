import { describe, expect, it } from "vitest";
import {
  createPullTracker,
  failedOnFromUrl,
  outcomeOf,
  pullSummaryCsv,
  pullTeamsCsv,
  yearFromName,
  type PullRunLog,
} from "../pullTracker";
import type { GcTeamResponse } from "../gameChangerApi";
import type { GcImportOutcome } from "../gameChangerImport";

const START = "2026-09-17T08:00:00.000Z";

/** A clock the test drives, so a record is reproducible rather than whatever the machine says. */
const clock = (from = 0) => {
  let at = from;
  return { now: () => at, tick: (ms: number) => (at += ms) };
};

const ok = (name: string, extra: Record<string, unknown> = {}): GcTeamResponse => ({
  ok: true,
  schedule: {
    profile: { id: "T1", name, ...extra },
    games: [],
    fetchedAt: START,
  },
});

const blocked = (): GcTeamResponse => ({
  ok: false,
  reason: "blocked",
  message: "GameChanger refused the request.",
  status: 403,
  diagnostics: {
    url: "https://api.gc.com/public/teams/T1",
    contentType: "text/html",
    bodyPreview: "<html>awswaf challenge</html>",
  },
});

const outcome = (gcTeamId: string, extra: Partial<GcImportOutcome> = {}): GcImportOutcome => ({
  gcTeamId,
  teamName: "Team",
  teamId: "pool-1",
  ageGroupId: "ag_10u_2027",
  ageGroupName: "10U 2027",
  createdAgeGroup: false,
  createdTeam: true,
  gamesAdded: 4,
  gamesUpdated: 0,
  gamesUnchanged: 0,
  gamesIgnored: 1,
  gamesOutOfSeason: 0,
  opponentsCreated: 3,
  opponentsMatchedByAvatar: 1,
  opponentsMatchedByName: 0,
  ...extra,
});

describe("reading a name", () => {
  it("finds a four-digit year", () => {
    expect(yearFromName("Warriors Spring 2027")).toBe(2027);
    expect(yearFromName("2029 Bandits")).toBe(2029);
  });

  it("is not fooled by a jersey number or an age", () => {
    expect(yearFromName("9U Astros")).toBeUndefined();
    expect(yearFromName("Team 12")).toBeUndefined();
  });
});

describe("which upstream call died", () => {
  it("tells the games route from the profile route", () => {
    expect(failedOnFromUrl("https://api.gc.com/public/teams/T1/games")).toBe("games");
    expect(failedOnFromUrl("https://api.gc.com/public/teams/T1")).toBe("profile");
    expect(failedOnFromUrl("https://api.gc.com/public/teams/T1/games?page=2")).toBe("games");
  });

  it("says nothing when there is no url — our own limiter sends none", () => {
    expect(failedOnFromUrl(undefined)).toBeUndefined();
  });
});

describe("recording a run", () => {
  it("keeps what GameChanger said about a team, label and all", () => {
    const time = clock();
    const tracker = createPullTracker(START, time.now);
    tracker.beginSegment(START, ["T1"]);
    time.tick(9_000);
    tracker.answered({
      teamId: "T1",
      result: ok("Warriors Spring 2027", { ageLabel: "2027" }),
      attempts: 1,
    });

    const row = tracker.log().teams[0]!;
    expect(row.ageLabel).toBe("2027");
    // The label parses to nothing, so the level is blank — and the year in the name is the clue.
    expect(row.ageLevel).toBeUndefined();
    expect(row.nameYear).toBe(2027);
    expect(row.second).toBe(9);
  });

  it("counts every failure reason, and keeps the body once rather than per team", () => {
    const tracker = createPullTracker(START, clock().now);
    tracker.beginSegment(START, ["T1", "T2", "T3"]);
    ["T1", "T2", "T3"].forEach((teamId) => {
      tracker.answered({ teamId, result: blocked() });
      tracker.blocked();
    });

    const log = tracker.log();
    expect(log.reasons.blocked).toBe(3);
    expect(log.blocked).toBe(3);
    // One sample carrying the count, not three copies of a 250-character challenge page.
    expect(log.samples).toHaveLength(1);
    expect(log.samples[0]!.count).toBe(3);
    expect(log.samples[0]!.body).toContain("awswaf");
    // And one interned message, referenced by index from every row.
    expect(log.messages).toHaveLength(1);
    expect(log.teams.every((row) => row.message === 0)).toBe(true);
  });

  it("stamps a flush onto the teams it saved, and nothing onto one it refused", () => {
    const tracker = createPullTracker(START, clock().now);
    tracker.beginSegment(START, ["T1", "T2"]);
    tracker.answered({ teamId: "T1", result: ok("A 10U") });
    tracker.answered({ teamId: "T2", result: ok("B 10U") });
    tracker.flushed(
      {
        flush: 1,
        second: 4,
        teams: 1,
        settled: 1,
        poolTeams: 1,
        poolGames: 0,
        poolPages: 1,
        ms: 20,
        ok: true,
      },
      ["T1"]
    );
    tracker.flushed(
      {
        flush: 2,
        second: 8,
        teams: 1,
        settled: 1,
        poolTeams: 1,
        poolGames: 0,
        poolPages: 1,
        ms: 20,
        ok: false,
      },
      ["T2"]
    );

    const byId = new Map(tracker.log().teams.map((row) => [row.teamId, row]));
    expect(byId.get("T1")?.flush).toBe(1);
    // A flush number on a row the store refused would claim the team is kept when it is not.
    expect(byId.get("T2")?.flush).toBeUndefined();
    expect(tracker.log().flushFailures).toBe(1);
  });

  it("counts the holds and who asked for them", () => {
    const tracker = createPullTracker(START, clock().now);
    tracker.hold(2_000, "retry-after");
    tracker.hold(5_000, "backoff");
    tracker.hold(1_000, "retry-after");

    const log = tracker.log();
    expect(log.holds).toBe(3);
    expect(log.heldMs).toBe(8_000);
    expect(log.longestHoldMs).toBe(5_000);
    expect(log.holdsBySource).toEqual({ "retry-after": 2, backoff: 1 });
  });

  it("folds the importer's answer onto the team it belongs to", () => {
    const tracker = createPullTracker(START, clock().now);
    tracker.beginSegment(START, ["T1"]);
    tracker.answered({ teamId: "T1", result: ok("A 10U") });
    tracker.imported(outcome("T1"));

    const row = tracker.log().teams[0]!;
    expect(row.poolTeamId).toBe("pool-1");
    expect(row.gamesAdded).toBe(4);
    expect(row.oppCreated).toBe(3);
  });

  it("numbers each pass, so a retry does not read as a first attempt", () => {
    const tracker = createPullTracker(START, clock().now);
    tracker.beginSegment(START, ["T1"]);
    tracker.answered({ teamId: "T1", result: blocked() });
    tracker.endSegment("2026-09-17T08:10:00.000Z", "gave-up");
    tracker.beginSegment("2026-09-17T08:20:00.000Z", ["T1"]);
    tracker.answered({ teamId: "T1", result: ok("A 10U"), attempts: 2, firstFailure: "throttled" });

    const log = tracker.log();
    expect(log.segments).toHaveLength(2);
    expect(log.segments[0]!.endReason).toBe("gave-up");
    // Upserted, not appended: one row per id, carrying which pass finally settled it.
    expect(log.teams).toHaveLength(1);
    expect(log.teams[0]!.segment).toBe(2);
    expect(log.teams[0]!.firstFailure).toBe("throttled");
  });
});

describe("what became of an id", () => {
  const settled = new Set(["kept"]);

  it("tells a run that ended early from a tracker that lost the rows", () => {
    // No row at all and nothing suppressed: a worker never claimed it.
    expect(outcomeOf(undefined, settled)).toBe("never-attempted");
  });

  it("calls a suppressed refusal left unsettled, not failed", () => {
    /*
     * The give-up drops these deliberately so a resume asks again. Recording them as failures
     * would write off the rest of the list on the way out — which is the bug the give-up exists
     * to prevent.
     */
    expect(outcomeOf({ teamId: "x", reason: "blocked" }, settled)).toBe("left-unsettled");
    expect(outcomeOf({ teamId: "x", seq: 1, ok: false, reason: "blocked" }, settled)).toBe(
      "left-unsettled"
    );
  });

  it("calls a recorded failure failed", () => {
    expect(outcomeOf({ teamId: "kept", seq: 1, ok: false, reason: "not-found" }, settled)).toBe(
      "failed"
    );
  });

  it("separates a schedule that arrived and was never saved", () => {
    expect(outcomeOf({ teamId: "lost", seq: 1, ok: true }, settled)).toBe("fetched-not-saved");
  });

  it("separates one that was filed from one that had nowhere to go", () => {
    expect(outcomeOf({ teamId: "kept", seq: 1, ok: true }, settled)).toBe("filed");
    expect(outcomeOf({ teamId: "kept", seq: 1, ok: true, issue: "No age group" }, settled)).toBe(
      "skipped"
    );
  });
});

describe("the files", () => {
  const runLog = (): PullRunLog => {
    const tracker = createPullTracker(START, clock().now);
    tracker.beginSegment(START, ["T1", "T2", "T3"]);
    tracker.config({ concurrency: 8, batchSize: 10 });
    tracker.eta(11);
    tracker.answered({ teamId: "T1", result: ok("A 10U", { ageLabel: "10U", ageLevel: 10 }) });
    tracker.imported(outcome("T1"));
    tracker.answered({ teamId: "T2", result: blocked() });
    tracker.flushed(
      {
        flush: 1,
        second: 2,
        teams: 2,
        settled: 2,
        poolTeams: 4,
        poolGames: 9,
        poolPages: 1,
        ms: 30,
        ok: true,
      },
      ["T1", "T2"]
    );
    tracker.finish("2026-09-17T08:11:00.000Z", "stopped");
    return tracker.log();
  };

  it("writes one row per id asked for, including the one never reached", () => {
    const rows = pullTeamsCsv(runLog(), ["T1", "T2"]).split("\n");
    // Header plus three ids — T3 was never attempted and still gets a row.
    expect(rows).toHaveLength(4);
    expect(rows[3]).toContain("T3");
    expect(rows[3]).toContain("never-attempted");
  });

  it("names the outcome and the reason in separate columns", () => {
    const rows = pullTeamsCsv(runLog(), ["T1", "T2"]).split("\n");
    expect(rows[1]).toContain("filed");
    expect(rows[2]).toContain("failed");
    expect(rows[2]).toContain("blocked");
  });

  it("puts the run's own numbers in the summary, not on every row", () => {
    const summary = pullSummaryCsv(runLog(), ["T1", "T2"]);
    expect(summary).toContain("# Section: Run");
    expect(summary).toContain("End reason,stopped");
    expect(summary).toContain("Ids asked,3");
    expect(summary).toContain("Outcome: never-attempted,1");
    expect(summary).toContain("Config: concurrency,8");
    expect(summary).toContain("# Section: Timeline");
    expect(summary).toContain("# Section: Samples");
    // The per-team file carries none of it.
    expect(pullTeamsCsv(runLog(), ["T1", "T2"])).not.toContain("End reason");
  });

  it("counts the levels, and how many blank ones have a clue in the name", () => {
    const tracker = createPullTracker(START, clock().now);
    tracker.beginSegment(START, ["T1", "T2"]);
    tracker.answered({ teamId: "T1", result: ok("A 10U", { ageLabel: "10U", ageLevel: 10 }) });
    tracker.answered({ teamId: "T2", result: ok("Warriors 2027", { ageLabel: "2027" }) });
    const summary = pullSummaryCsv(tracker.log(), ["T1", "T2"]);

    expect(summary).toContain("# Section: Levels");
    // One team at 10U, one with no level at all whose name carries a year.
    expect(summary).toMatch(/^10,1,1,0$/m);
    expect(summary).toMatch(/^none,1,0,1$/m);
  });
});
