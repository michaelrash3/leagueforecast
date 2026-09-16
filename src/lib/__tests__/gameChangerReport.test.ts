import { describe, expect, it } from "vitest";
import {
  checkPulledTeam,
  collectGcImportProblems,
  describeGcProblems,
  gcImportProblemsCsv,
} from "../gameChangerReport";
import type { GcTeamListEntry, GcTeamProfile } from "../gameChangerApi";
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
  gamesOutOfSeason: 0,
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

describe("checkPulledTeam", () => {
  const entry = (over: Partial<GcTeamListEntry> = {}): GcTeamListEntry => ({
    teamId: "gcAAAAAAAAAA",
    name: "Trash Pandas Baseball Club",
    ageLevel: 10,
    season: { season: "fall", year: 2026 },
    state: "KY",
    ...over,
  });
  const profile = (over: Partial<GcTeamProfile> = {}): GcTeamProfile => ({
    id: "gcAAAAAAAAAA",
    name: "Trash Pandas Baseball Club 10U",
    ageLevel: 10,
    season: { season: "fall", year: 2026 },
    state: "KY",
    ...over,
  });

  it("says nothing when the team is the team the list named", () => {
    expect(checkPulledTeam(entry(), profile())).toBeNull();
  });

  it("says nothing when the two spell one club differently", () => {
    // "Trash Pandas" and "Trash Pandas Baseball Club" are one club written two ways, which is the
    // normal case and must never be reported: 40,752 of 40,760 real rows matched outright.
    expect(checkPulledTeam(entry({ name: "Trash Pandas" }), profile())).toBeNull();
  });

  it("reports a name with no word in common as a different team", () => {
    const found = checkPulledTeam(entry(), profile({ name: "Prosper Cougars 10U" }));
    expect(found?.reason).toBe("Not the team the list named");
    expect(found?.detail).toContain("Trash Pandas Baseball Club");
    expect(found?.detail).toContain("Prosper Cougars 10U");
  });

  it("reports a season the id no longer belongs to", () => {
    // An id reused for last year's squad is the quiet way a pull goes wrong; it fired on none of
    // the 40,760 real rows, so it costs nothing to watch for.
    const found = checkPulledTeam(entry(), profile({ season: { season: "fall", year: 2025 } }));
    expect(found?.reason).toBe("Not the team the list named");
    expect(found?.detail).toContain("Fall 2026");
    expect(found?.detail).toContain("Fall 2025");
  });

  it("reports a different state more quietly, since the club is still recognisable", () => {
    const found = checkPulledTeam(entry(), profile({ state: "TX" }));
    expect(found?.reason).toBe("Not quite the team the list named");
    expect(found?.detail).toContain("KY");
    expect(found?.detail).toContain("TX");
  });

  it("ignores an age level one year apart and reports two", () => {
    // 343 of 374 real disagreements were one year, and in 267 of those the team's own name held
    // the list's level — GameChanger's age group wanders, and reporting it would bury the rest.
    expect(checkPulledTeam(entry(), profile({ ageLevel: 11 }))).toBeNull();
    expect(checkPulledTeam(entry(), profile({ ageLevel: 12 }))?.detail).toContain("12U");
  });

  it("questions nothing about an id the list said nothing about", () => {
    expect(checkPulledTeam({ teamId: "gcAAAAAAAAAA" }, profile())).toBeNull();
  });

  it("does not count a shared generic word as a shared name", () => {
    const found = checkPulledTeam(
      entry({ name: "Hebron Baseball Club" }),
      profile({ name: "Prosper Baseball Club" })
    );
    expect(found?.reason).toBe("Not the team the list named");
  });
});

describe("collectGcImportProblems with pulled teams", () => {
  it("lists a filed schedule whose id returned another team, after the ones that failed", () => {
    const problems = collectGcImportProblems(
      [failure("gcBAD", "not-found", "No such team")],
      [],
      new Map([["gcBAD", "Missing Club"]]),
      new Map([
        [
          "gcWRONG",
          {
            entry: { teamId: "gcWRONG", name: "Trash Pandas" },
            profile: { id: "gcWRONG", name: "Prosper Cougars" },
          },
        ],
      ])
    );
    expect(problems.map((problem) => problem.kind)).toEqual(["not-reached", "check-id"]);
    expect(problems[1]!.teamName).toBe("Prosper Cougars");
    expect(problems[1]!.url).toContain("gcWRONG");
    expect(describeGcProblems(problems)).toBe("1 not reached · 1 to check");
    expect(gcImportProblemsCsv(problems)).toContain("Check the id");
  });

  it("checks nothing when no list described the ids", () => {
    expect(collectGcImportProblems([], [])).toEqual([]);
  });
});
