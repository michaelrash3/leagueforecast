import { describe, expect, it } from "vitest";
import {
  collectGcImportProblems,
  describeGcProblems,
  gcImportProblemsCsv,
} from "../gameChangerReport";
import type { GcImportOutcome } from "../gameChangerImport";
import type { GcPullFailure } from "../gameChangerPull";

const failure = (teamId: string, reason: GcPullFailure["reason"], message: string) => ({
  teamId,
  reason,
  message,
});

const outcome = (over: Partial<GcImportOutcome>): GcImportOutcome => ({
  gcTeamId: "gc1",
  teamName: "Aces",
  teamId: "S-ACES",
  ageGroupId: "ag1",
  ageGroupName: "9U 2027",
  createdAgeGroup: false,
  createdTeam: false,
  gamesAdded: 0,
  gamesUpdated: 0,
  gamesUnchanged: 0,
  gamesIgnored: 0,
  opponentsCreated: 0,
  opponentsMatchedByAvatar: 0,
  opponentsMatchedByName: 0,
  ...over,
});

describe("collectGcImportProblems", () => {
  it("lists both ways a team is lost, with a reason apiece", () => {
    const problems = collectGcImportProblems(
      [failure("gcA", "not-found", "GameChanger has no public team with that id.")],
      [
        outcome({ gcTeamId: "gcB", teamName: "Bears", issue: "7U is below the youngest level." }),
        // A schedule that filed cleanly is not a problem and must not appear.
        outcome({ gcTeamId: "gcC", teamName: "Cubs" }),
      ]
    );

    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatchObject({
      teamId: "gcA",
      kind: "not-reached",
      reason: "No such team",
      detail: "GameChanger has no public team with that id.",
      url: "https://web.gc.com/teams/gcA",
    });
    expect(problems[1]).toMatchObject({
      teamId: "gcB",
      teamName: "Bears",
      kind: "not-filed",
      detail: "7U is below the youngest level.",
    });
  });

  it("names a team the pull never got far enough to name, from the pasted list", () => {
    const problems = collectGcImportProblems(
      [failure("gcA", "timeout", "Timed out.")],
      [],
      new Map([["gcA", "Aces 9U Fall 2026"]])
    );
    expect(problems[0]!.teamName).toBe("Aces 9U Fall 2026");
  });

  it("leaves the name out rather than inventing one", () => {
    const problems = collectGcImportProblems(
      [failure("gcA", "network", "Could not reach it.")],
      []
    );
    expect(problems[0]!.teamName).toBeUndefined();
  });

  it("passes an unknown reason through rather than dropping the row", () => {
    const problems = collectGcImportProblems(
      [failure("gcA", "something-new" as GcPullFailure["reason"], "Who knows.")],
      []
    );
    expect(problems[0]!.reason).toBe("something-new");
  });

  it("is empty when a run lost nobody", () => {
    expect(collectGcImportProblems([], [outcome({})])).toEqual([]);
  });
});

describe("gcImportProblemsCsv", () => {
  it("writes a header and one row per team", () => {
    const csv = gcImportProblemsCsv(
      collectGcImportProblems(
        [failure("gcA", "blocked", "GameChanger refused the request.")],
        [outcome({ gcTeamId: "gcB", teamName: "Bears", issue: "No season." })]
      )
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Team ID,Team Name,Problem,Reason,Detail,GameChanger URL");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Not reached");
    expect(lines[2]).toContain("Not filed");
    expect(lines[2]).toContain("Bears");
  });

  it("flattens a newline in free text so one problem stays one row", () => {
    const csv = gcImportProblemsCsv(
      collectGcImportProblems([failure("gcA", "unrecognized", "Line one\nline two")], [])
    );
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("Line one line two");
  });

  it("writes a header even when nothing failed", () => {
    expect(gcImportProblemsCsv([])).toBe("Team ID,Team Name,Problem,Reason,Detail,GameChanger URL");
  });
});

describe("describeGcProblems", () => {
  it("counts the two kinds separately", () => {
    const problems = collectGcImportProblems(
      [failure("gcA", "timeout", "Timed out."), failure("gcB", "network", "Could not reach it.")],
      [outcome({ gcTeamId: "gcC", issue: "No age group." })]
    );
    expect(describeGcProblems(problems)).toBe("2 not reached · 1 could not be filed");
  });

  it("says only what happened", () => {
    const problems = collectGcImportProblems([failure("gcA", "timeout", "Timed out.")], []);
    expect(describeGcProblems(problems)).toBe("1 not reached");
  });
});
