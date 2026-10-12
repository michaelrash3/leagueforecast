import { describe, expect, it } from "vitest";
import {
  AGE_UNKNOWN_GIVE_UP_DAYS,
  AGE_UNKNOWN_MAX_TRIES,
  AGE_UNKNOWN_MIN_DAYS_BETWEEN_ASKS,
  ageUnknownAsking,
  ageUnknownDue,
  coerceAgeUnknown,
  describeAgeUnknown,
  answerableNow,
  forgetAgeless,
  updateAgeUnknown,
  withRulesMoved,
  AGELESS_RULES_CHANGED_AT,
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

  // Out of its season with nothing on its schedule: off the list, and a later pull may find it.
  it("drops a team with an empty schedule outside its season", () => {
    const first: AgeUnknownList = [
      { teamId: "A", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 2 },
    ];
    expect(
      updateAgeUnknown(first, [outcome("A", { skip: "out-of-season", issue: "out" })], NOW)
    ).toEqual([]);
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

  /*
   * The frozen entry, which starved the queue it sat in.
   *
   * This list is for teams nobody could say the age of. An entry whose answer becomes something
   * else — thrown out, 6U after all, no season, a wiffle team — is no longer that question, and
   * used to be left untouched rather than taken off. Untouched meant frozen: `tries` never
   * advanced and `lastTried` never moved, so stalest-first put it at the head of every run for
   * ever. Measured before the fix, on three teams with a cap of two where one had been thrown
   * out: the thrown-out club was fetched on all twelve runs, still reading tries=1 and
   * lastTried=day one, while it held half of every run's capacity.
   */
  it("takes a team off when the answer stops being 'nobody could say'", () => {
    const list: AgeUnknownList = [
      { teamId: "thrown-out", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 1 },
      { teamId: "too-young", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 1 },
      { teamId: "still-asking", firstSeen: LAST_WEEK, lastTried: LAST_WEEK, tries: 1 },
    ];
    const after = updateAgeUnknown(
      list,
      [
        outcome("thrown-out", { skip: "deleted", issue: "thrown out" }),
        outcome("too-young", { skip: "below-min-age", issue: "too young" }),
        outcome("still-asking", { skip: "no-age", issue: "no age" }),
      ],
      NOW
    );
    expect(after.map((entry) => entry.teamId)).toEqual(["still-asking"]);
  });

  it("does not let a team it cannot answer for hold the head of the queue", () => {
    // The consequence, rather than the mechanism: with a cap, a frozen entry is asked every run
    // and the live teams behind it are not.
    let list: AgeUnknownList = [
      { teamId: "thrown-out", firstSeen: LAST_WEEK, lastTried: daysBefore(40), tries: 1 },
      { teamId: "live-a", firstSeen: LAST_WEEK, lastTried: daysBefore(30), tries: 1 },
      { teamId: "live-b", firstSeen: LAST_WEEK, lastTried: daysBefore(20), tries: 1 },
    ];
    const asked: string[][] = [];
    for (let run = 0; run < 4; run += 1) {
      const now = new Date(TODAY.getTime() + run * 8 * 86_400_000);
      const due = ageUnknownDue(list, 1, now);
      asked.push(due);
      list = updateAgeUnknown(
        list,
        due.map((id) =>
          id === "thrown-out"
            ? outcome(id, { skip: "deleted", issue: "thrown out" })
            : outcome(id, { skip: "no-age", issue: "no age" })
        ),
        now.toISOString()
      );
    }
    // Asked once, answered, gone — and never at the head again.
    expect(asked[0]).toEqual(["thrown-out"]);
    expect(asked.slice(1).flat()).not.toContain("thrown-out");
    expect(list.map((entry) => entry.teamId).sort()).toEqual(["live-a", "live-b"]);
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

  it("does not open a sentence with a count of nothing", () => {
    // Every team on the list has used up both its asks and its weeks, so "0 teams still being
    // asked about, and 2 left alone" would lead with something that is not there.
    const spent: AgeUnknownList = [
      { teamId: "A", firstSeen: daysBefore(60), lastTried: NOW, tries: AGE_UNKNOWN_MAX_TRIES },
      { teamId: "B", firstSeen: daysBefore(60), lastTried: NOW, tries: AGE_UNKNOWN_MAX_TRIES },
    ];
    expect(describeAgeUnknown(spent, TODAY)).toBe(
      "2 left alone after 8 weeks of nobody naming an age."
    );
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

/**
 * Somebody answering is the third thing that can change the answer.
 *
 * `stillWorthAsking` knows about two — the team plays somebody who names an age, or the club
 * fixes its own page — and neither involves a person. Once the review card could be searched, a
 * reader could find a team that had been left alone months ago and say what age it was; without
 * this, that answer was stored and nothing ever asked about the team again, so it never reached
 * a schedule and never got filed.
 */
describe("a team somebody named an age for", () => {
  const abandoned = {
    teamId: "GONE",
    name: "Mears 1 - 2026",
    firstSeen: daysBefore(400),
    lastTried: daysBefore(300),
    tries: 99,
  };

  /** What the review card writes: an answer, stamped with the moment it was given. */
  const namedAt = (when: string, teamId = "GONE") => new Map([[teamId, { namedAt: when }]]);

  it("is asked about again however spent its budget is", () => {
    expect(ageUnknownDue([abandoned], 10, TODAY)).toEqual([]);
    expect(ageUnknownDue([abandoned], 10, TODAY, namedAt(NOW))).toEqual(["GONE"]);
  });

  it("is counted as still being asked about, or the panel hides the run that would fetch it", () => {
    // The ask-again block is gated on this number, so a revived team with nothing offering to
    // pull it is the same as not reviving it at all.
    expect(ageUnknownAsking([abandoned], TODAY)).toBe(0);
    expect(ageUnknownAsking([abandoned], TODAY, namedAt(NOW))).toBe(1);
  });

  /**
   * The case the card actually produces, and the one that was broken.
   *
   * A team is on the review card because a pull has just failed to age it, so its `lastTried` is
   * a day or two old at most. The week gate refused it on that basis, which made the card's own
   * "it will be filed on the next refresh" false for up to a week with nothing saying so.
   */
  it("is fetched at the next opportunity when the answer is newer than the last ask", () => {
    const askedYesterday = { ...abandoned, tries: 1, lastTried: daysBefore(1) };
    expect(ageUnknownDue([askedYesterday], 10, TODAY, namedAt(NOW))).toEqual(["GONE"]);
  });

  /**
   * And the exemption is spent by the ask it buys: the pull moves `lastTried` past `namedAt`, so
   * a named age that can never be filed — GameChanger has since said something else, so
   * `namedAgeStands` refuses it — gets one more ask and then goes back to once a week rather than
   * being fetched on every run for ever.
   */
  it("goes back to waiting a week once that ask has happened", () => {
    const askedSince = { ...abandoned, lastTried: daysBefore(1) };
    expect(ageUnknownDue([askedSince], 10, TODAY, namedAt(daysBefore(2)))).toEqual([]);
  });

  /**
   * A cap cuts the tail off the list, and stalest-first puts a team answered for a minute ago at
   * the very end of it — so the one team somebody is waiting on is the first thing dropped.
   */
  it("goes to the front of the queue, not the back, however long the list is", () => {
    const stale = Array.from({ length: 10 }, (_, at) => ({
      teamId: `OLD-${at}`,
      name: `Old ${at}`,
      firstSeen: daysBefore(400),
      lastTried: daysBefore(300 - at),
      tries: 1,
    }));
    const justAnswered = { ...abandoned, teamId: "WANTED", tries: 1, lastTried: daysBefore(1) };

    const due = ageUnknownDue([...stale, justAnswered], 3, TODAY, namedAt(NOW, "WANTED"));
    expect(due[0]).toBe("WANTED");
  });
});

/**
 * A row the new rules can already settle from what it stores: a name read loosely, or two
 * opponents agreeing. It is asked once straight away, like a hand-named age, and not again.
 */
describe("a team the new rules can already settle", () => {
  const row = (name: string, tally: [number, number][], ageLabel?: string) => ({
    teamId: "T",
    name,
    firstSeen: daysBefore(20),
    lastTried: "2026-09-18T00:00:00.000Z",
    tries: 1,
    evidence: {
      games: 6,
      scored: 6,
      aheadOfToday: 0,
      shutoutBlowouts: 0,
      opponents: 4,
      namedAnAge: tally.reduce((sum, [, count]) => sum + count, 0),
      tally,
      ...(ageLabel ? { ageLabel } : {}),
    },
  });

  it("is one whose name writes its age loosely, or whose two naming opponents agree", () => {
    expect(answerableNow(row("Simpson Spiders12U", []))).toBe(true);
    expect(answerableNow(row("Warriors", [[9, 2]]))).toBe(true);
    expect(answerableNow(row("Warriors", [[9, 1]]))).toBe(false);
    expect(
      answerableNow(
        row("Warriors", [
          [9, 2],
          [10, 1],
        ])
      )
    ).toBe(false);
    expect(answerableNow(row("Warriors", []))).toBe(false);
  });

  it("is not one whose answer GameChanger's own band rules out", () => {
    expect(answerableNow(row("Warriors", [[14, 2]], "Under 13"))).toBe(false);
    expect(answerableNow(row("Giants 13-14", [], "Under 13"))).toBe(false);
  });

  it("is asked first, once, and then waits its week like any other", () => {
    const waiting = row("Warriors", [[9, 2]]);
    const plain = { ...row("Bandits", []), teamId: "P" };
    const asks = withRulesMoved(new Map(), [waiting, plain]);
    // Asked five days ago, so the week gate alone would hold both back.
    const now = new Date("2026-09-23T13:00:00.000Z");
    expect(ageUnknownDue([plain, waiting], 10, now, asks)).toEqual(["T"]);
    // Once asked after the rules moved, the exemption is spent.
    const asked = { ...waiting, lastTried: "2026-09-23T12:30:00.000Z" };
    expect(ageUnknownDue([asked], 10, now, withRulesMoved(new Map(), [asked]))).toEqual([]);
    expect(AGELESS_RULES_CHANGED_AT < asked.lastTried).toBe(true);
  });
});

/**
 * The name is the only way anybody finds a particular team in a list of thirty thousand.
 */
describe("the name on an entry", () => {
  it("survives an ask that comes back without one", () => {
    /*
     * A run that could not say what the team was called used to erase the name already stored,
     * leaving a row reading "Name not recorded" that no search could ever match. `evidence`
     * three lines below it always had this fallback; the name did not.
     */
    const first = updateAgeUnknown(
      [],
      [outcome("T1", { skip: "no-age", teamName: "Mears 1 - 2026" })],
      NOW
    );
    expect(first[0]?.name).toBe("Mears 1 - 2026");
    const second = updateAgeUnknown(first, [outcome("T1", { skip: "no-age", teamName: "" })], NOW);
    expect(second[0]?.name).toBe("Mears 1 - 2026");
  });

  it("is replaced when a later ask does say one", () => {
    const first = updateAgeUnknown(
      [],
      [outcome("T1", { skip: "no-age", teamName: "Old Name" })],
      NOW
    );
    const second = updateAgeUnknown(
      first,
      [outcome("T1", { skip: "no-age", teamName: "New Name" })],
      NOW
    );
    expect(second[0]?.name).toBe("New Name");
  });
});

/** A row on the list, asked about once a month ago, with plenty of budget left. */
const waitingRow = (teamId: string) => ({
  teamId,
  name: `Team ${teamId}`,
  firstSeen: daysBefore(30),
  lastTried: daysBefore(30),
  tries: 1,
});

/**
 * A club somebody threw out has been answered for, and the asking rota has to know it.
 *
 * It did not. Throwing one out wrote the decision to the dropped-clubs list and took it off the
 * review card, but `ageUnknownDue` reads tries, dates and named ages and nothing else — so the
 * club was handed to the puller on every catch-up day, fetched twice, and refused by `importOne`
 * only after both requests had been spent. A dozen clubs made that invisible; thirty thousand
 * would have made it sixty thousand requests for answers already given.
 */
describe("a club somebody threw out", () => {
  const list: AgeUnknownList = [waitingRow("KEPT"), waitingRow("GONE")];
  const refused = new Set(["GONE"]);

  it("is never offered to the puller again", () => {
    expect(ageUnknownDue(list, 10, TODAY)).toEqual(["KEPT", "GONE"]);
    expect(ageUnknownDue(list, 10, TODAY, undefined, refused)).toEqual(["KEPT"]);
  });

  /*
   * Both answers at once — named in March, thrown out in May. A named age revives a team that has
   * been left alone, so the two rules pull opposite ways here, and the refusal has to win: it is
   * the later word, and the undo path exists for somebody who wants the club back.
   */
  it("stays refused even when its age was named as well", () => {
    const named = new Map([["GONE", { namedAt: NOW }]]);
    expect(ageUnknownDue(list, 10, TODAY, named)).toEqual(["GONE", "KEPT"]);
    expect(ageUnknownDue(list, 10, TODAY, named, refused)).toEqual(["KEPT"]);
  });

  it("is not counted as still being asked about", () => {
    expect(ageUnknownAsking(list, TODAY)).toBe(2);
    expect(ageUnknownAsking(list, TODAY, undefined, refused)).toBe(1);
  });

  /*
   * And it is in neither half of the sentence. "Left alone after 8 weeks of nobody naming an age"
   * is untrue of a club somebody looked at and refused, so counting it there would describe it
   * wrongly; counting it as still being asked about would be worse.
   */
  it("is in neither half of the sentence", () => {
    expect(describeAgeUnknown(list, TODAY, undefined, refused)).toBe(
      "1 team still being asked about."
    );
  });
});

/**
 * Taking a row off outright, for an answer a pull did not produce.
 *
 * `updateAgeUnknown` removes a row when a pull comes back with anything other than "no age",
 * which is right for what a pull learns and useless for what a person says: the row stayed put
 * until a fetch the same answer had just made pointless.
 */
describe("forgetting a row outright", () => {
  const list: AgeUnknownList = [waitingRow("A"), waitingRow("B"), waitingRow("C")];

  it("removes exactly the ids named", () => {
    expect(forgetAgeless(list, ["B"]).map((entry) => entry.teamId)).toEqual(["A", "C"]);
    expect(forgetAgeless(list, ["A", "C"]).map((entry) => entry.teamId)).toEqual(["B"]);
  });

  // Identity is how the pool's readers tell new data from old, so a pass that changed nothing
  // must hand back the array it was given rather than a copy of it.
  it("hands back the same array when nothing matched", () => {
    expect(forgetAgeless(list, [])).toBe(list);
    expect(forgetAgeless(list, ["NOT-HERE"])).toBe(list);
  });
});
