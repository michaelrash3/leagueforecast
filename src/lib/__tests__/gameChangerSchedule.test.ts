import { describe, expect, it } from "vitest";
import {
  WEEKLY_ROTATION,
  dayForLevel,
  describeDue,
  describeRotation,
  dueRefresh,
  gcTeamIdsForLevels,
  levelsDueOn,
  localDayKey,
  markRefreshed,
  refreshedToday,
  type RefreshLog,
  type Weekday,
} from "../gameChangerSchedule";
import { AGE_LEVELS, type AgeGroup, type ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag8", name: "8U 2027", ageLevel: 8, year: 2027, seasonIds: [] },
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "ag9old", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
];

const link = (teamId: string, ageGroupId: string) => ({
  teamId,
  name: teamId,
  ageGroupId,
});

const teams: ScoutTeam[] = [
  { id: "t1", name: "Eights", gcTeams: [link("gc8a", "ag8")] },
  { id: "t2", name: "Nines", gcTeams: [link("gc9a", "ag9"), link("gc9b", "ag9")] },
  { id: "t3", name: "Tens", gcTeams: [link("gc10a", "ag10")] },
  { id: "t4", name: "Last year's nines", gcTeams: [link("gc9old", "ag9old")] },
  { id: "t5", name: "Never pulled" },
];

/** A Sunday and a Tuesday in 2027, so the weekday is the thing under test and not the date. */
const SUNDAY = new Date(2027, 2, 7);
const TUESDAY = new Date(2027, 2, 9);
const THURSDAY = new Date(2027, 2, 11);
const FRIDAY = new Date(2027, 2, 12);

describe("the rotation itself", () => {
  it("uses every day of the week exactly once", () => {
    expect(WEEKLY_ROTATION).toHaveLength(7);
    expect(WEEKLY_ROTATION.map((entry) => entry.day).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("covers the whole ladder, no level twice", () => {
    const covered = WEEKLY_ROTATION.flatMap((entry) => entry.ageLevels);
    expect(covered.slice().sort((a, b) => a - b)).toEqual(AGE_LEVELS);
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("puts the youngest two on Sunday and the next two on Tuesday", () => {
    expect(levelsDueOn(0)).toEqual([8, 9]);
    expect(levelsDueOn(2)).toEqual([10, 11]);
  });

  it("keeps one day for catching up", () => {
    const catchUp = WEEKLY_ROTATION.filter((entry) => entry.catchUp);
    expect(catchUp).toHaveLength(1);
    expect(catchUp[0]?.ageLevels).toEqual([]);
  });

  it("can say which day a level comes round on", () => {
    expect(dayForLevel(9)?.label).toBe("Sunday");
    expect(dayForLevel(11)?.label).toBe("Tuesday");
    expect(dayForLevel(99)).toBeUndefined();
  });

  it("describes the week", () => {
    const lines = describeRotation();
    expect(lines[0]).toBe("Sunday: 8U, 9U");
    expect(lines).toContain("Friday: catch up on failures");
  });
});

describe("which teams a day is for", () => {
  it("is every GameChanger id filed at those levels", () => {
    expect(gcTeamIdsForLevels([8, 9], groups, teams).sort()).toEqual([
      "gc8a",
      "gc9a",
      "gc9b",
      "gc9old",
    ]);
  });

  // A team carries an id per GameChanger season, and each is a schedule of its own to fetch.
  it("takes every id a team is known by", () => {
    expect(gcTeamIdsForLevels([9], groups, teams)).toContain("gc9a");
    expect(gcTeamIdsForLevels([9], groups, teams)).toContain("gc9b");
  });

  it("can be held to one season year", () => {
    expect(gcTeamIdsForLevels([9], groups, teams, 2027).sort()).toEqual(["gc9a", "gc9b"]);
    expect(gcTeamIdsForLevels([9], groups, teams, 2026)).toEqual(["gc9old"]);
  });

  it("is empty for a level with no page, and skips teams never pulled", () => {
    expect(gcTeamIdsForLevels([14], groups, teams)).toEqual([]);
    expect(gcTeamIdsForLevels([8, 9, 10], groups, teams)).not.toContain("t5");
  });
});

describe("what is due", () => {
  const empty: RefreshLog = {};

  it("is the levels this weekday is for", () => {
    const due = dueRefresh(SUNDAY, empty, groups, teams);
    expect(due.ageLevels).toEqual([8, 9]);
    expect(due.teamIds.sort()).toEqual(["gc8a", "gc9a", "gc9b", "gc9old"]);
    expect(due.catchUp).toBe(false);
  });

  it("is nothing once the day has been done", () => {
    const log = markRefreshed(empty, [8, 9], SUNDAY);
    const due = dueRefresh(SUNDAY, log, groups, teams);
    expect(due.ageLevels).toEqual([]);
    expect(due.teamIds).toEqual([]);
  });

  // Yesterday's run does not excuse today's.
  it("comes round again the next time that day falls", () => {
    const log = markRefreshed(empty, [8, 9], SUNDAY);
    const nextSunday = new Date(2027, 2, 14);
    expect(refreshedToday(log, 9, nextSunday)).toBe(false);
    expect(dueRefresh(nextSunday, log, groups, teams).ageLevels).toEqual([8, 9]);
  });

  it("only clears the levels that actually ran", () => {
    const log = markRefreshed(empty, [8], SUNDAY);
    expect(dueRefresh(SUNDAY, log, groups, teams).ageLevels).toEqual([9]);
  });

  it("brings nothing of its own on the catch-up day", () => {
    const due = dueRefresh(FRIDAY, empty, groups, teams);
    expect(due.catchUp).toBe(true);
    expect(due.ageLevels).toEqual([]);
  });

  it("finds Tuesday's levels on a Tuesday", () => {
    expect(dueRefresh(TUESDAY, empty, groups, teams).ageLevels).toEqual([10, 11]);
  });
});

describe("what the panel says", () => {
  it("names the levels and the count", () => {
    expect(describeDue(dueRefresh(SUNDAY, {}, groups, teams))).toBe(
      "8U and 9U due today — 4 teams to refresh."
    );
  });

  it("says when the day is already done", () => {
    const log = markRefreshed({}, [8, 9], SUNDAY);
    expect(describeDue(dueRefresh(SUNDAY, log, groups, teams))).toBe(
      "8U and 9U already refreshed today."
    );
  });

  it("says when there is nothing pulled at those levels yet", () => {
    // Nothing in the fixture is filed at 12U or 13U.
    expect(describeDue(dueRefresh(THURSDAY, {}, groups, teams))).toBe(
      "12U and 13U are due today, but nothing has been pulled yet."
    );
  });

  it("counts one team as one team", () => {
    expect(describeDue(dueRefresh(TUESDAY, {}, groups, teams))).toBe(
      "10U and 11U due today — 1 team to refresh."
    );
  });

  it("says what the catch-up day is for", () => {
    expect(describeDue(dueRefresh(FRIDAY, {}, groups, teams))).toContain("catch-up day");
  });
});

describe("the day a refresh is counted in", () => {
  it("is the viewer's own calendar day", () => {
    expect(localDayKey(new Date(2027, 0, 5))).toBe("2027-01-05");
    expect(localDayKey(new Date(2027, 11, 31))).toBe("2027-12-31");
  });

  // A run just before midnight and one just after are different days, which is the point.
  it("changes over midnight", () => {
    const before = new Date(2027, 2, 7, 23, 59);
    const after = new Date(2027, 2, 8, 0, 1);
    expect(localDayKey(before)).not.toBe(localDayKey(after));
  });

  it("treats an unknown weekday as having nothing scheduled", () => {
    const due = dueRefresh(SUNDAY, {}, [], []);
    expect(due.teamIds).toEqual([]);
    expect(levelsDueOn(3 as Weekday)).toEqual([18]);
  });
});
