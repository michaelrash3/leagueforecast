import { describe, expect, it } from "vitest";
import {
  AGE_UNKNOWN_GIVE_UP_DAYS,
  AGE_UNKNOWN_MAX_TRIES,
  AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS,
  ageUnknownAsking,
  ageUnknownDue,
  coerceAgeUnknown,
  describeAgeUnknown,
  updateAgeUnknown,
  type AgeUnknownList,
} from "../ageUnknown";
import type { GcImportOutcome } from "../gameChangerImport";

const NOW = "2026-09-18T12:00:00.000Z";
const LAST_WEEK = "2026-09-11T12:00:00.000Z";
/** The instant every "is it due, has it been long enough" question here is asked at. */
const TODAY = new Date(NOW);
const daysBefore = (days: number) => new Date(TODAY.getTime() - days * 86_400_000).toISOString();

const outcome = (gcTeamId: string, extra: Partial<GcImportOutcome> = {}): GcImportOutcome => ({
  gcTeamId,
  teamName: `Team ${gcTeamId}`,
  teamId: "pool-1",
  ageGroupId: "ag",
  ageGroupName: "10U 2027",
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
  ...extra,
});

describe("keeping the teams nobody could age", () => {
  it("takes on a team with no age, and nothing else", () => {
    const list = updateAgeUnknown(
      [],
      [
        outcome("A", { skip: "no-age", issue: "no age" }),
        // A 6U team is below the youngest level ranked here and always will be; asking about it
        // every week for ever is a request that can never come good.
        outcome("B", { skip: "below-min-age", issue: "too young" }),
        outcome("C", { skip: "no-season", issue: "no season" }),
        outcome("D"),
      ],
      NOW
    );
    expect(list.map((entry) => entry.teamId)).toEqual(["A"]);
    expect(list[0]?.tries).toBe(1);
    expect(list[0]?.firstSeen).toBe(NOW);
  });

  it("counts the tries and keeps the day it was first found", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 3 },
    ];
    const list = updateAgeUnknown(first, [outcome("A", { skip: "no-age", issue: "no age" })], NOW);
    expect(list[0]?.tries).toBe(4);
    expect(list[0]?.firstSeen).toBe(LAST_WEEK);
    expect(list[0]?.lastTried).toBe(NOW);
  });

  it("drops a team the moment somebody can say its age", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 2 },
    ];
    // Filed at last — by its own field, its name, or the three opponents that settled it.
    expect(updateAgeUnknown(first, [outcome("A", { ageFromOpponents: 9 })], NOW)).toEqual([]);
  });

  /*
   * A team that could not be fetched this week has not been answered — nobody asked it anything.
   * Dropping it on the absence of a skip would lose it for good, which is the bug this list exists
   * to fix in the first place.
   */
  it("keeps a team the run never reached", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 2 },
    ];
    expect(updateAgeUnknown(first, [], NOW).map((entry) => entry.teamId)).toEqual(["A"]);
  });

  it("hands over the stalest first, so a long list still comes round", () => {
    // Both past the week gate, so this is about the order and the cap and nothing else.
    const list: AgeUnknownList = [
      { teamId: "new", firstSeen: daysBefore(9), lastTried: daysBefore(9), tries: 1 },
      { teamId: "old", firstSeen: LAST_WEEK, lastTried: daysBefore(20), tries: 4 },
    ];
    expect(ageUnknownDue(list, 1, TODAY)).toEqual(["old"]);
    expect(ageUnknownDue(list, 10, TODAY)).toEqual(["old", "new"]);
    expect(ageUnknownDue(list, 0, TODAY)).toEqual([]);
  });

  it("says how many are still being asked, and how many were left alone", () => {
    const list: AgeUnknownList = [
      // Spent both its asks and its weeks, so it is genuinely left alone.
      { teamId: "A", firstSeen: daysBefore(60), lastTried: NOW, tries: AGE_UNKNOWN_MAX_TRIES },
      { teamId: "B", firstSeen: LAST_WEEK, lastTried: NOW, tries: 1 },
    ];
    expect(describeAgeUnknown(list, TODAY)).toBe(
      "1 team still being asked about, and 1 left alone after 8 weeks of nobody naming an age."
    );
    expect(describeAgeUnknown([], TODAY)).toBe("");
  });

  /*
   * Only two things can change the answer week to week: the team plays more games against
   * opponents who name an age, or the club fills GameChanger's field in. Neither ever happens in a
   * rec league where nobody names an age — "Mears 1 - 2026" playing "Mirror Lake 2 2026" all
   * season — and those are the bulk of this list. Asking for ever is a question that can never come
   * good.
   */
  it("stops asking only once both the eight asks and the eight weeks are spent", () => {
    const worn: AgeUnknownList = [
      // Eight asks and sixty days: done.
      {
        teamId: "spent",
        firstSeen: daysBefore(60),
        lastTried: daysBefore(8),
        tries: AGE_UNKNOWN_MAX_TRIES,
      },
      // Eight asks but found ten days ago, so its asks were spent far too quickly to mean
      // anything. It stays on the list until the calendar agrees.
      {
        teamId: "hurried",
        firstSeen: daysBefore(10),
        lastTried: daysBefore(8),
        tries: AGE_UNKNOWN_MAX_TRIES,
      },
      {
        teamId: "fresh",
        firstSeen: daysBefore(30),
        lastTried: daysBefore(8),
        tries: AGE_UNKNOWN_MAX_TRIES - 1,
      },
    ];
    expect(ageUnknownDue(worn, 10, TODAY)).toEqual(["hurried", "fresh"]);
  });

  it("keeps counting one it has stopped asking about, so the number still means something", () => {
    const spent: AgeUnknownList = [
      {
        teamId: "spent",
        firstSeen: daysBefore(60),
        lastTried: LAST_WEEK,
        tries: AGE_UNKNOWN_MAX_TRIES,
      },
    ];
    // Left alone, not forgotten: a full re-pull of the team is still free to answer it.
    expect(spent).toHaveLength(1);
    expect(describeAgeUnknown(spent, TODAY)).toMatch(/1 left alone/);
  });

  /*
   * The week gate. Before it, nothing here read a clock at all, so eight "passes" was whatever
   * eight presses of a button happened to take — and on the shipped daily cadence every day is a
   * catch-up day. Driving the real `dueRefresh` and `updateAgeUnknown` over a calendar, the first
   * team was abandoned on day 8 with a short list, day 15 at 4,013 against the old 2,000 cap, day
   * 8 with the cap raised, and day 2 if the button was pressed eight times in an afternoon —
   * while the card said "left alone after 8 weeks".
   */
  it("will not ask about the same team twice inside a week", () => {
    const list: AgeUnknownList = [
      { teamId: "asked-today", firstSeen: daysBefore(30), lastTried: NOW, tries: 1 },
      {
        teamId: "asked-six-days-ago",
        firstSeen: daysBefore(30),
        lastTried: daysBefore(AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS - 1),
        tries: 1,
      },
      {
        teamId: "asked-a-week-ago",
        firstSeen: daysBefore(30),
        lastTried: daysBefore(AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS),
        tries: 1,
      },
    ];
    expect(ageUnknownDue(list, 10, TODAY)).toEqual(["asked-a-week-ago"]);
  });

  it("gives a team its eight asks over eight real weeks, however often it is asked", () => {
    /*
     * The pin on the horizon. It is the week gate that produces this number — eight asks a week
     * apart is 56 days — so this passes with or without the calendar clause in `stillWorthAsking`,
     * and is not the guard for that clause. The guard for it is the "hurried" team above.
     *
     * What the calendar clause is actually for is the rows already in somebody's browser, whose
     * eight asks were spent in eight days under the old rule. Without it they would be abandoned
     * the moment this ships; with it they are asked again until the calendar agrees. It can only
     * revive a team, never abandon one sooner.
     */
    let list: AgeUnknownList = [{ teamId: "A", firstSeen: NOW, lastTried: NOW, tries: 0 }];
    let day = 0;
    // Press every single day, which is the worst case the old rule collapsed under.
    while (day < 400 && ageUnknownAsking(list, new Date(TODAY.getTime() + day * 86_400_000)) > 0) {
      day += 1;
      const now = new Date(TODAY.getTime() + day * 86_400_000);
      const due = ageUnknownDue(list, 10, now);
      if (due.length > 0) {
        list = updateAgeUnknown(
          list,
          due.map((id) => outcome(id, { skip: "no-age", issue: "no age" })),
          now.toISOString()
        );
      }
    }
    expect(day).toBe(AGE_UNKNOWN_GIVE_UP_DAYS);
  });

  it("falls back to the try budget for a row whose dates cannot be read", () => {
    // `coerceAgeUnknown` writes an empty string for a row that arrived without one, and an
    // unreadable date is not evidence that eight weeks have passed.
    const broken: AgeUnknownList = [
      { teamId: "spent", firstSeen: "", lastTried: "", tries: AGE_UNKNOWN_MAX_TRIES },
      { teamId: "young", firstSeen: "", lastTried: "", tries: 1 },
    ];
    expect(ageUnknownAsking(broken, TODAY)).toBe(1);
    // Never recorded as asked, so it has not been asked within the week either.
    expect(ageUnknownDue(broken, 10, TODAY)).toEqual(["young"]);
  });

  it("reads back what it stored, and shrugs off what it did not", () => {
    expect(coerceAgeUnknown(null)).toEqual([]);
    expect(coerceAgeUnknown([{ teamId: "" }, { nope: 1 }, "x"])).toEqual([]);
    expect(coerceAgeUnknown([{ teamId: "A", tries: "many" }])).toEqual([
      { teamId: "A", firstSeen: "", lastTried: "", tries: 0 },
    ]);
  });
});
