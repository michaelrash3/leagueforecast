import { describe, expect, it } from "vitest";
import { ADVICE, checkSchedule, checkTeamResponse, verdict } from "../gcPullCheck";
import type { GcGame, GcTeamSchedule } from "../gameChangerApi";

const schedule = (
  games: GcGame[],
  profile: Partial<GcTeamSchedule["profile"]> = {}
): GcTeamSchedule => ({
  profile: {
    id: "FtEExZwB4b8E",
    name: "2026 Fall Trosky Illinois 9U",
    city: "Naperville",
    state: "IL",
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    ...profile,
  },
  games,
  fetchedAt: "2026-09-16T12:00:00.000Z",
});

const played = (id: string): GcGame => ({
  id,
  date: "2026-09-12",
  opponentName: "Naperville Bandits",
  teamScore: 6,
  opponentScore: 2,
  status: "completed",
});

const statusOf = (checks: ReturnType<typeof checkSchedule>, step: string) =>
  checks.find((check) => check.step === step)?.status;

describe("what one real pull proves", () => {
  it("passes a whole, well-formed team", () => {
    const checks = checkSchedule(schedule([played("g1"), played("g2")]));
    expect(verdict(checks).ok).toBe(true);
    expect(checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails a profile that parsed but carries no name", () => {
    const checks = checkSchedule(schedule([played("g1")], { name: "  " }));
    expect(statusOf(checks, "Team profile")).toBe("fail");
    expect(verdict(checks).ok).toBe(false);
  });

  it("warns rather than fails when the age level is missing", () => {
    const checks = checkSchedule(schedule([played("g1")], { ageLevel: undefined }));
    // A team still imports; every one of its games just lands on a page chosen by hand.
    expect(statusOf(checks, "Age level")).toBe("warn");
    expect(verdict(checks).ok).toBe(true);
  });

  it("calls out a schedule where nothing carries a score", () => {
    const unplayed: GcGame = {
      id: "g1",
      date: "2026-09-12",
      opponentName: "Naperville Bandits",
      status: "scheduled",
    };
    const checks = checkSchedule(schedule([unplayed]));
    // Either nothing has been played, or the score fields have moved — worth knowing which.
    expect(statusOf(checks, "Scores")).toBe("warn");
    expect(checks.find((check) => check.step === "Scores")?.advice).toBe(ADVICE.unrecognized);
  });

  it("notices a game with no opponent and one with no date", () => {
    const nameless: GcGame = {
      id: "g2",
      date: "2026-09-13",
      opponentName: "",
      status: "completed",
    };
    const undated: GcGame = { ...played("g3"), date: undefined };
    const checks = checkSchedule(schedule([played("g1"), nameless, undated]));

    expect(statusOf(checks, "Opponents")).toBe("warn");
    expect(statusOf(checks, "Dates")).toBe("warn");
  });

  it("does not ask about games when the schedule is empty", () => {
    const checks = checkSchedule(schedule([]));
    expect(statusOf(checks, "Schedule")).toBe("warn");
    expect(checks.some((check) => check.step === "Scores")).toBe(false);
  });
});

describe("what a failed pull says to do", () => {
  it("names the WAF and the escape hatch when blocked", () => {
    const checks = checkTeamResponse("FtEExZwB4b8E", {
      ok: false,
      reason: "blocked",
      message: "GameChanger blocked the profile request (HTTP 403, AWS WAF challenge).",
    });

    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("fail");
    // The one failure a fixture could never predict, so the advice has to be the whole recipe.
    expect(checks[0]?.advice).toMatch(/x-aws-waf-token/);
    expect(checks[0]?.advice).toMatch(/GC_EXTRA_HEADERS/);
  });

  it("says throttling is a working pull being told to slow down", () => {
    const checks = checkTeamResponse("FtEExZwB4b8E", {
      ok: false,
      reason: "throttled",
      message: "GameChanger is rate-limiting the profile request.",
    });
    expect(checks[0]?.advice).toMatch(/not a broken one/);
  });

  it("has something to say about every failure the proxy can report", () => {
    const reasons = Object.keys(ADVICE) as Array<keyof typeof ADVICE>;
    reasons.forEach((reason) => {
      expect(ADVICE[reason].length).toBeGreaterThan(40);
    });
  });
});

describe("the verdict", () => {
  it("is a pass with nothing to report when everything passed", () => {
    expect(verdict([{ step: "Pull", status: "pass", detail: "fine" }])).toEqual({
      ok: true,
      line: "Every check passed against the live GameChanger.",
    });
  });

  it("passes but names what is worth a look", () => {
    const result = verdict([
      { step: "Pull", status: "pass", detail: "fine" },
      { step: "Age level", status: "warn", detail: "missing" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.line).toContain("Age level");
  });

  it("fails and names what failed", () => {
    const result = verdict([
      { step: "Pull", status: "fail", detail: "blocked" },
      { step: "Age level", status: "warn", detail: "missing" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.line).toContain("Pull");
  });
});
