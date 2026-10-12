import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFRESH_CADENCE,
  WEEKLY_ROTATION,
  describeCadence,
  isRefreshCadence,
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
const WEDNESDAY = new Date(2027, 2, 10);

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
    expect(lines).toContain("Friday: catch up on failures, and teams still waiting on an age");
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
    const due = dueRefresh(SUNDAY, empty, groups, teams, { cadence: "rotation" });
    expect(due.ageLevels).toEqual([8, 9]);
    expect(due.teamIds.sort()).toEqual(["gc8a", "gc9a", "gc9b", "gc9old"]);
    expect(due.catchUp).toBe(false);
  });

  // The panel holds the rota to the season being played: a finished season's pages cannot change.
  it("can be held to the season being played", () => {
    const due = dueRefresh(SUNDAY, empty, groups, teams, { cadence: "rotation", seasonYear: 2027 });
    expect(due.teamIds.sort()).toEqual(["gc8a", "gc9a", "gc9b"]);
  });

  it("is nothing once the day has been done", () => {
    const log = markRefreshed(empty, [8, 9], SUNDAY);
    const due = dueRefresh(SUNDAY, log, groups, teams, { cadence: "rotation" });
    expect(due.ageLevels).toEqual([]);
    expect(due.teamIds).toEqual([]);
  });

  // Yesterday's run does not excuse today's.
  it("comes round again the next time that day falls", () => {
    const log = markRefreshed(empty, [8, 9], SUNDAY);
    const nextSunday = new Date(2027, 2, 14);
    expect(refreshedToday(log, 9, nextSunday)).toBe(false);
    expect(dueRefresh(nextSunday, log, groups, teams, { cadence: "rotation" }).ageLevels).toEqual([
      8, 9,
    ]);
  });

  it("only clears the levels that actually ran", () => {
    const log = markRefreshed(empty, [8], SUNDAY);
    expect(dueRefresh(SUNDAY, log, groups, teams, { cadence: "rotation" }).ageLevels).toEqual([9]);
  });

  it("brings nothing of its own on the catch-up day", () => {
    const due = dueRefresh(FRIDAY, empty, groups, teams, { cadence: "rotation" });
    expect(due.catchUp).toBe(true);
    expect(due.ageLevels).toEqual([]);
  });

  it("finds Tuesday's levels on a Tuesday", () => {
    expect(dueRefresh(TUESDAY, empty, groups, teams, { cadence: "rotation" }).ageLevels).toEqual([
      10, 11,
    ]);
  });
});

describe("what the panel says", () => {
  it("names the levels and the count", () => {
    expect(describeDue(dueRefresh(SUNDAY, {}, groups, teams, { cadence: "rotation" }))).toBe(
      "8U and 9U due today — 4 teams to refresh."
    );
  });

  it("says when the day is already done", () => {
    const log = markRefreshed({}, [8, 9], SUNDAY);
    expect(describeDue(dueRefresh(SUNDAY, log, groups, teams, { cadence: "rotation" }))).toBe(
      "8U and 9U already refreshed today."
    );
  });

  it("says when there is nothing pulled at those levels yet", () => {
    // Nothing in the fixture is filed at 12U or 13U.
    expect(describeDue(dueRefresh(THURSDAY, {}, groups, teams, { cadence: "rotation" }))).toBe(
      "12U and 13U are due today, but nothing has been pulled yet."
    );
  });

  it("counts one team as one team", () => {
    expect(describeDue(dueRefresh(TUESDAY, {}, groups, teams, { cadence: "rotation" }))).toBe(
      "10U and 11U due today — 1 team to refresh."
    );
  });

  it("says what the catch-up day is for", () => {
    expect(describeDue(dueRefresh(FRIDAY, {}, groups, teams, { cadence: "rotation" }))).toContain(
      "catch-up day"
    );
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
    const due = dueRefresh(SUNDAY, {}, [], [], { cadence: "rotation" });
    expect(due.teamIds).toEqual([]);
    expect(levelsDueOn(3 as Weekday)).toEqual([18]);
  });
});

describe("the teams nobody could age", () => {
  const ageless = (teamId: string, lastTried: string) => ({
    teamId,
    firstSeen: "2026-09-01T00:00:00.000Z",
    lastTried,
    tries: 1,
  });

  const friday = new Date("2026-09-18T12:00:00");
  const sunday = new Date("2026-09-20T12:00:00");

  /*
   * They are on no page, so the per-level rotation walks straight past them; and the fetch worked,
   * so nothing retries them either. The catch-up day is the only place they can be asked about.
   */
  it("brings them round on the catch-up day", () => {
    const due = dueRefresh(friday, {}, [], [], {
      cadence: "rotation",
      ageless: [ageless("A", "2026-09-11T00:00:00.000Z"), ageless("B", "2026-09-11T00:00:00.000Z")],
    });
    expect(due.catchUp).toBe(true);
    expect(due.agelessIds).toEqual(["A", "B"]);
  });

  /*
   * A club the user threw out is answered for, and the rota has to stop handing it to the puller.
   * It did not: the row stayed on the list and was fetched twice every catch-up day before
   * `importOne` refused it, which is two requests per club per week for an answer already given.
   */
  it("does not offer a club somebody threw out", () => {
    const list = [
      ageless("KEPT", "2026-09-11T00:00:00.000Z"),
      ageless("GONE", "2026-09-11T00:00:00.000Z"),
    ];
    const due = dueRefresh(friday, {}, [], [], {
      cadence: "rotation",
      ageless: list,
      refused: new Set(["GONE"]),
    });
    expect(due.agelessIds).toEqual(["KEPT"]);
    // And the count beside the button agrees, so the panel cannot offer a pull of nothing.
    expect(due.agelessTotal).toBe(1);
  });

  it("leaves them alone on a day that belongs to a level", () => {
    const due = dueRefresh(sunday, {}, [], [], {
      cadence: "rotation",
      ageless: [ageless("A", "2026-09-11T00:00:00.000Z")],
    });
    expect(due.agelessIds).toEqual([]);
  });

  /*
   * The count on the card and the count in the button are two different questions, and conflating
   * them is what made a reader ask why they could only search 2,000 of 4,013. The button offers
   * what is due; the sentence names everyone still being asked about, on any day.
   */
  it("counts everyone still being asked about, not only today's due list", () => {
    const due = dueRefresh(friday, {}, [], [], {
      cadence: "rotation",
      ageless: [
        ageless("due", "2026-09-01T00:00:00.000Z"),
        // Asked yesterday, so inside its week and not offered today — but still on the list.
        ageless("asked-yesterday", "2026-09-17T00:00:00.000Z"),
      ],
    });
    expect(due.agelessIds).toEqual(["due"]);
    expect(due.agelessTotal).toBe(2);
    expect(describeDue(due)).toMatch(/2 teams still waiting on an age/);
  });

  it("still counts them on a day when none are due", () => {
    // The card has to be able to say "none today"; one that vanishes reads as though the teams had.
    const due = dueRefresh(sunday, {}, [], [], {
      cadence: "rotation",
      ageless: [ageless("A", "2026-09-11T00:00:00.000Z")],
    });
    expect(due.agelessIds).toEqual([]);
    expect(due.agelessTotal).toBe(1);
  });

  it("says how many are waiting", () => {
    const due = dueRefresh(friday, {}, [], [], {
      cadence: "rotation",
      ageless: [ageless("A", "2026-09-11T00:00:00.000Z")],
    });
    expect(describeDue(due)).toMatch(/1 team still waiting on an age/);
  });

  it("says nothing of the sort when none are", () => {
    expect(describeDue(dueRefresh(friday, {}, [], [], { cadence: "rotation" }))).toBe(
      "Friday is the catch-up day — anything that failed this week."
    );
  });
});

/**
 * The daily cadence, which is now the default.
 *
 * The rotation exists because a full run is thousands of requests and the best part of an hour,
 * spread over a week so no day is long. In season that trade goes the other way: a board answering
 * with a week-old week is worse than a long run, and the run is still something a person starts.
 */
describe("every age group, every day", () => {
  const empty: RefreshLog = {};

  it("is what you get when nothing says otherwise", () => {
    expect(DEFAULT_REFRESH_CADENCE).toBe("daily");
    // The same call the panel makes, with no cadence named.
    expect(dueRefresh(WEDNESDAY, empty, groups, teams).ageLevels).toEqual(AGE_LEVELS);
  });

  it("offers every level whatever the weekday, not that weekday's one or two", () => {
    for (const day of [SUNDAY, TUESDAY, THURSDAY, FRIDAY]) {
      const due = dueRefresh(day, empty, groups, teams, { cadence: "daily" });
      expect(due.ageLevels).toEqual(AGE_LEVELS);
      expect(due.cadence).toBe("daily");
    }
  });

  it("gathers every id across every level and every squad year in one list", () => {
    const due = dueRefresh(WEDNESDAY, empty, groups, teams, { cadence: "daily" });
    // Wednesday is 18U alone on the rotation. These are 8U, 9U, 10U and a past year's 9U, so
    // every one of them is a level and a year this weekday would otherwise have walked past.
    expect(due.teamIds.sort()).toEqual(["gc10a", "gc8a", "gc9a", "gc9b", "gc9old"]);
    expect(dueRefresh(WEDNESDAY, empty, groups, teams, { cadence: "rotation" }).teamIds).toEqual(
      []
    );
  });

  it("still counts a day as done once, so opening the app twice does not pull twice", () => {
    const log = markRefreshed(empty, AGE_LEVELS, WEDNESDAY);
    const due = dueRefresh(WEDNESDAY, log, groups, teams, { cadence: "daily" });
    expect(due.ageLevels).toEqual([]);
    expect(due.teamIds).toEqual([]);
  });

  it("comes round again the next day", () => {
    const log = markRefreshed(empty, AGE_LEVELS, WEDNESDAY);
    const thursday = new Date(WEDNESDAY.getTime() + 24 * 60 * 60 * 1000);
    expect(dueRefresh(thursday, log, groups, teams, { cadence: "daily" }).ageLevels).toEqual(
      AGE_LEVELS
    );
  });

  /*
   * A team with no age is on no page, so a refresh by level walks past it for ever. On the
   * rotation Friday is the only day that asks. A daily cadence with no Friday would have quietly
   * stopped asking altogether, which is why every day is a catch-up day.
   */
  it("keeps asking about teams with no age, which the rotation only does on Fridays", () => {
    const options = {
      cadence: "daily" as const,
      ageless: [
        {
          teamId: "A",
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-11T00:00:00.000Z",
          tries: 1,
        },
        {
          teamId: "B",
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-11T00:00:00.000Z",
          tries: 1,
        },
      ],
    };
    for (const day of [SUNDAY, TUESDAY, WEDNESDAY]) {
      const due = dueRefresh(day, empty, [], [], options);
      expect(due.catchUp).toBe(true);
      expect(due.agelessIds).toEqual(["A", "B"]);
    }
    // The rotation asks on its catch-up day and no other.
    expect(
      dueRefresh(SUNDAY, empty, [], [], { ...options, cadence: "rotation" }).agelessIds
    ).toEqual([]);
  });

  it("offers the lot again when asked, even though today is marked done", () => {
    const log = markRefreshed(empty, AGE_LEVELS, WEDNESDAY);
    const forced = dueRefresh(WEDNESDAY, log, groups, teams, { cadence: "daily", force: true });
    expect(forced.ageLevels).toEqual(AGE_LEVELS);
    expect(forced.teamIds.sort()).toEqual(["gc10a", "gc8a", "gc9a", "gc9b", "gc9old"]);
  });

  it("says what is due in words that do not name a weekday", () => {
    expect(describeDue(dueRefresh(WEDNESDAY, empty, groups, teams, { cadence: "daily" }))).toBe(
      "Every age group is due today — 5 teams to refresh."
    );
    const log = markRefreshed(empty, AGE_LEVELS, WEDNESDAY);
    expect(describeDue(dueRefresh(WEDNESDAY, log, groups, teams, { cadence: "daily" }))).toBe(
      "Every age group has been refreshed today."
    );
  });

  it("describes each cadence in a line the chooser can show", () => {
    expect(describeCadence("daily")).toContain("Every age group, every day");
    expect(describeCadence("rotation")).toContain("round the week");
  });

  it("recognises a stored cadence and nothing else", () => {
    expect(isRefreshCadence("daily")).toBe(true);
    expect(isRefreshCadence("rotation")).toBe(true);
    expect(isRefreshCadence("nightly")).toBe(false);
    expect(isRefreshCadence(undefined)).toBe(false);
  });
});
