import { describe, expect, it } from "vitest";
import nightlyWorkflow from "../../../../.github/workflows/nightly.yml?raw";
import nightlyScript from "../../../../scripts/nightly.ts?raw";
import { deferralDetail } from "../rebuildJobControl";
import { describeRebuilds, rebuildsTrouble, unansweredWord } from "../rebuildReport";

/*
 * What the nightly says of the rebuilds after saves (`rebuildReport.ts`): the switch, the runs,
 * failures and compute of the ledger's day and month against their caps, and a run not yet
 * settled, in counts, days and times only.
 */

const OPEN = {
  at: "2027-04-15T14:00:00.000Z",
  day: "2027-04-15",
  cost: { gibs: 2_560, vcpuS: 640 },
  task: "lg-2027-0415T1400",
  by: "handling-7f3a",
};

describe("the nightly's lines on the rebuilds", () => {
  it("says the edits' own compute apart, and the job held back by its budget until when", () => {
    const now = Date.parse("2026-10-16T09:00:00Z");
    const lines = describeRebuilds(
      {
        on: true,
        mode: "live",
        day: "2026-10-14",
        month: "2026-10",
        monthGiBs: 113_924,
        monthVcpuS: 49_530,
        monthRuns: 34,
        monthFailed: 9,
        editMonthGiBs: 2_000,
        editMonthVcpuS: 500,
      },
      {
        format: 1,
        deferredUntil: "2026-11-01T04:01:00.000Z",
        state: "deferred",
        detail: deferralDetail("month-cap", new Date("2026-11-01T04:01:00.000Z")),
      },
      now
    );
    expect(lines).toContain(
      "  Edits and questions, 2026-10: 2,000 of 120,000 GiB-seconds and 500 of 60,000 vCPU-seconds."
    );
    expect(lines).toContain(
      "  Held back by their budget until 2026-11-01T04:01:00.000Z: saves wait for then, or for a cap raised in ops/rebuild."
    );
    // A deferral for anything but the budget says what it waits on, and no cap to raise: only a
    // budget's deferral is lifted by one.
    const until = new Date("2026-10-16T09:05:00.000Z");
    const said = (why: "busy" | "failing" | "day-cap" | "budget") =>
      describeRebuilds(
        { on: true, month: "2026-10" },
        { deferredUntil: until.toISOString(), detail: deferralDetail(why, until) },
        now
      ).filter((line) => line.includes("2026-10-16T09:05"));
    expect(said("busy")).toEqual([
      "  Waiting until 2026-10-16T09:05:00.000Z for a rebuild still running to end.",
    ]);
    expect(said("failing")).toEqual([
      "  Paused until 2026-10-16T09:05:00.000Z after failures in a row.",
    ]);
    for (const why of ["day-cap", "budget"] as const) {
      expect(said(why)[0]).toMatch(/^ {2}Held back by their budget until .*a cap raised/);
    }
    expect(
      describeRebuilds(
        { on: true, month: "2026-10" },
        { deferredUntil: until.toISOString(), detail: "something else" },
        now
      )
    ).toContain("  Deferred until 2026-10-16T09:05:00.000Z.");
    // A deferral past, or none, says nothing; nor do edits that spent nothing.
    for (const job of [null, { deferredUntil: "" }, { deferredUntil: "2026-10-15T04:01:00Z" }]) {
      expect(describeRebuilds({ on: true, month: "2026-10" }, job, now).join("\n")).not.toMatch(
        /Held back|Edits and questions/
      );
    }
  });

  it("says the month's questions by kind, the most asked first, read off the ledger it reads already", () => {
    const lines = describeRebuilds({
      on: true,
      mode: "live",
      month: "2026-11",
      editMonthGiBs: 9_600,
      editMonthVcpuS: 2_400,
      editMonthAsked: { "health.summary": 12, "league.bridge": 1_204, "import.status": 12 },
    });
    // Counts and kinds only: the log is public, and a kind names a question, never anyone.
    expect(lines).toContain(
      "  Questions asked, 2026-11: league.bridge 1,204, health.summary 12, import.status 12."
    );
    expect(
      lines.indexOf(
        "  Questions asked, 2026-11: league.bridge 1,204, health.summary 12, import.status 12."
      )
    ).toBe(lines.findIndex((line) => line.startsWith("  Edits and questions, 2026-11")) + 1);
    // A month with none counted yet, or a ledger from before the count, says nothing of them.
    expect(
      describeRebuilds({ on: true, month: "2026-11", editMonthGiBs: 8 }).join("\n")
    ).not.toMatch(/Questions asked/);
  });

  it("says they are off where there is no ledger, or none this build reads", () => {
    expect(describeRebuilds(null)).toEqual([
      "Rebuilds after saves: there is no ledger in ops/rebuild, so they are off.",
    ]);
    expect(describeRebuilds(undefined)).toEqual(describeRebuilds(null));
    expect(describeRebuilds({ on: true, mode: "Live" })).toEqual([
      "Rebuilds after saves: ops/rebuild is not a ledger this build reads, so they are off.",
    ]);
  });

  it("says the switch as the owner makes it, before any run", () => {
    expect(describeRebuilds({ on: true })).toEqual([
      "Rebuilds after saves: on, dry: each builds every board and publishes none.",
      "  None has run yet.",
      "  0 failed in a row, of the 3 that pause them; no run open.",
    ]);
    expect(describeRebuilds({ on: true, mode: "live" })[0]).toBe("Rebuilds after saves: on, live.");
    expect(describeRebuilds({ on: false, mode: "live" })[0]).toBe("Rebuilds after saves: off.");
  });

  it("says the day's and the month's runs, failures and compute against their caps", () => {
    expect(
      describeRebuilds({
        on: true,
        mode: "dry",
        day: "2027-04-14",
        dayGiBs: 4_321,
        dayRuns: 6,
        dayFailed: 1,
        month: "2027-04",
        monthGiBs: 31_000,
        monthVcpuS: 7_750,
        monthRuns: 41,
        monthFailed: 2,
        failures: 1,
        caps: { dayGiBs: 12_000 },
      })
    ).toEqual([
      "Rebuilds after saves: on, dry: each builds every board and publishes none.",
      "  2027-04-14: 6 runs, 1 failed; 4,321 of 12,000 GiB-seconds.",
      "  2027-04: 41 runs, 2 failed; 31,000 of 120,000 GiB-seconds and 7,750 of 30,000 vCPU-seconds.",
      "  1 failed in a row, of the 3 that pause them; no run open.",
    ]);
    expect(
      describeRebuilds({
        on: true,
        day: "2027-04-14",
        dayRuns: 1,
        month: "2027-04",
        monthRuns: 1,
      })[1]
    ).toBe("  2027-04-14: 1 run, 0 failed; 0 of 10,000 GiB-seconds.");
  });

  it("says the last day before the ledger's that had a run", () => {
    const lines = describeRebuilds({
      on: true,
      day: "2027-04-16",
      dayRuns: 0,
      lastDay: { day: "2027-04-14", runs: 6, failed: 1, gibs: 4_321 },
      month: "2027-04",
      monthRuns: 9,
      monthFailed: 1,
    });
    expect(lines.slice(1, 3)).toEqual([
      "  2027-04-16: 0 runs, 0 failed; 0 of 10,000 GiB-seconds.",
      "  Before that, 2027-04-14: 6 runs, 1 failed; 4,321 GiB-seconds.",
    ]);
    expect(lines).toHaveLength(5);
  });

  it("says a pause and a run not yet settled, and not whose task the run was", () => {
    const lines = describeRebuilds({
      on: true,
      day: "2027-04-15",
      dayRuns: 4,
      dayFailed: 3,
      month: "2027-04",
      monthRuns: 4,
      monthFailed: 3,
      failures: 3,
      pausedDay: "2027-04-15",
      open: OPEN,
    });
    expect(lines[3]).toBe(
      "  Paused for 2027-04-15, after 3 failed in a row; a run reserved at 2027-04-15T14:00:00.000Z has not settled."
    );
    expect(lines.join("\n")).not.toContain(OPEN.task);
    expect(lines.join("\n")).not.toContain(OPEN.by);
  });
});

/*
 * Where the pulls run on GitHub (the dispatch token set, `rebuildsRun` false), no rebuild runs on
 * Google: a save's boards go out by the boards' publish on GitHub within minutes, and a rebuild's
 * task deferred to a later month publishes through it when it comes. The deferral is then nothing
 * a save waits for, and through the second half of October 2026 the nightly said "saves wait for
 * then" of a deferral to 1 November that no save was waiting on.
 */
describe("the nightly's line on a deferral, where the pulls run on GitHub", () => {
  const now = Date.parse("2026-10-30T10:51:00Z");
  const ledger = { on: true, mode: "live", month: "2026-10" };
  const deferred = (why: "month-cap" | "busy" | "failing") => {
    const until = new Date("2026-11-01T04:01:00.000Z");
    return { deferredUntil: until.toISOString(), detail: deferralDetail(why, until) };
  };

  it("says the boards' publish on GitHub replaces them, and that no save waits", () => {
    for (const why of ["month-cap", "busy", "failing"] as const) {
      const lines = describeRebuilds(ledger, deferred(why), now, true);
      expect(lines).toContain(
        "  Replaced by the boards' publish on GitHub, which publishes each save: none waits for the deferral until 2026-11-01T04:01:00.000Z."
      );
      expect(lines.join("\n")).not.toMatch(/wait for then|a cap raised|Held back|Waiting until/);
    }
  });

  it("says the deferral as before where the pulls are on Google, or nothing where there is none", () => {
    expect(describeRebuilds(ledger, deferred("month-cap"), now, false)).toContain(
      "  Held back by their budget until 2026-11-01T04:01:00.000Z: saves wait for then, or for a cap raised in ops/rebuild."
    );
    expect(describeRebuilds(ledger, deferred("month-cap"), now)).toEqual(
      describeRebuilds(ledger, deferred("month-cap"), now, false)
    );
    expect(describeRebuilds(ledger, null, now, true).join("\n")).not.toMatch(/Replaced/);
  });

  it("is told by the workflow whether the dispatch token is set, and hands it on", () => {
    const refresh = nightlyWorkflow
      .split(/^(?= {6}- )/m)
      .find((step) => /id: refresh\b/.test(step));
    expect(refresh).toMatch(
      /^ {10}PULLS_ON_GITHUB: \$\{\{ secrets\.PULL_DISPATCH_TOKEN != '' \}\}$/m
    );
    expect(nightlyScript).toMatch(/const onGithub = process\.env\.PULLS_ON_GITHUB === "true";/);
    expect(nightlyScript).toMatch(/describeRebuilds\(ledger, job, Date\.now\(\), onGithub\)/);
  });
});

describe("the rebuilds' trouble, as the nightly hands it to the alarm", () => {
  it("is a pause wherever the ledger shows one, whatever the failures since", () => {
    expect(rebuildsTrouble({ on: true, failures: 3, pausedDay: "2027-04-15" })).toBe("paused");
    // A pause from an earlier day is cleared only by the next reserve: until then it stands.
    expect(rebuildsTrouble({ on: true, failures: 0, pausedDay: "2027-04-01" })).toBe("paused");
  });

  it("is failing with any failure in a row and no pause", () => {
    expect(rebuildsTrouble({ on: true, failures: 1 })).toBe("failing");
  });

  it("is none with no failure in a row and no pause", () => {
    expect(rebuildsTrouble({ on: true, failures: 0, dayFailed: 4, monthFailed: 9 })).toBe("none");
    expect(rebuildsTrouble({ on: true })).toBe("none");
  });

  it("is off while they are switched off, whatever the ledger kept from before, or with no ledger", () => {
    // Off, no run reserves, so the failures and the pause stay as they were: the alarm would
    // comment on them every night until the console was edited.
    expect(rebuildsTrouble({ on: false, failures: 2 })).toBe("off");
    expect(rebuildsTrouble({ on: false, failures: 3, pausedDay: "2027-04-15" })).toBe("off");
    expect(rebuildsTrouble({ on: false })).toBe("off");
    expect(rebuildsTrouble(null)).toBe("off");
    expect(rebuildsTrouble(undefined)).toBe("off");
  });

  it("is not known for a ledger this build cannot read", () => {
    expect(rebuildsTrouble({ on: true, mode: "Live" })).toBeNull();
    expect(rebuildsTrouble("ledger")).toBeNull();
  });
});

/*
 * The questions the edit function spent compute on and could not answer (`dayUnanswered`), counted
 * in the ledger each question's charge already writes, and the alarm the nightly raises past 20 a
 * day from the ledger it already reads.
 */
describe("the nightly's line on the questions left unanswered", () => {
  it("says the ledger's day's count and the last day before it that had any", () => {
    const line = (raw: Record<string, unknown>) =>
      describeRebuilds({ on: true, month: "2026-10", ...raw }).filter((said) =>
        said.includes("unanswered")
      );
    expect(
      line({
        day: "2026-10-31",
        dayUnanswered: 47,
        lastUnanswered: { day: "2026-10-30", count: 3 },
      })
    ).toEqual([
      "  Questions left unanswered after a turn: 47 on 2026-10-31; before that, 3 on 2026-10-30.",
    ]);
    expect(line({ day: "2026-10-31", dayUnanswered: 1_234 })).toEqual([
      "  Questions left unanswered after a turn: 1,234 on 2026-10-31.",
    ]);
    expect(line({ day: "2026-10-31", lastUnanswered: { day: "2026-10-29", count: 25 } })).toEqual([
      "  Questions left unanswered after a turn: 0 on 2026-10-31; before that, 25 on 2026-10-29.",
    ]);
    // None, as nearly every night: nothing said.
    expect(line({ day: "2026-10-31" })).toEqual([]);
  });
});

describe("the questions left unanswered, as the nightly hands them to the alarm", () => {
  const TODAY = "2026-10-31";

  it("is over, with the day and its count, past 20 on the nightly's day or the day before", () => {
    expect(unansweredWord({ on: true, day: TODAY, dayUnanswered: 21 }, TODAY)).toBe(
      "over 2026-10-31 21"
    );
    expect(unansweredWord({ on: true, day: "2026-10-30", dayUnanswered: 47 }, TODAY)).toBe(
      "over 2026-10-30 47"
    );
    // A charge after New York's midnight empties the day's count before the nightly reads it; the
    // day before is kept, and judged.
    expect(
      unansweredWord(
        {
          on: true,
          day: TODAY,
          dayUnanswered: 2,
          lastUnanswered: { day: "2026-10-30", count: 47 },
        },
        TODAY
      )
    ).toBe("over 2026-10-30 47");
    // The day with more is said.
    expect(
      unansweredWord(
        {
          on: true,
          day: TODAY,
          dayUnanswered: 30,
          lastUnanswered: { day: "2026-10-30", count: 25 },
        },
        TODAY
      )
    ).toBe("over 2026-10-31 30");
    // Across a month's turn the day before is still the day before.
    expect(unansweredWord({ on: true, day: TODAY, dayUnanswered: 21 }, "2026-11-01")).toBe(
      "over 2026-10-31 21"
    );
    // The edits are charged whatever the rebuilds' switch says, so their count is read either way.
    expect(unansweredWord({ on: false, day: TODAY, dayUnanswered: 21 }, TODAY)).toBe(
      "over 2026-10-31 21"
    );
  });

  it("is fine at 20 and under, and for a day an earlier nightly judged", () => {
    expect(unansweredWord({ on: true, day: TODAY, dayUnanswered: 20 }, TODAY)).toBe("fine");
    expect(unansweredWord({ on: true }, TODAY)).toBe("fine");
    expect(
      unansweredWord(
        {
          on: true,
          day: TODAY,
          dayUnanswered: 20,
          lastUnanswered: { day: "2026-10-30", count: 20 },
        },
        TODAY
      )
    ).toBe("fine");
    // Two days back or more: the nightly of the day after it judged it, and its alarm stood then.
    expect(unansweredWord({ on: true, day: "2026-10-29", dayUnanswered: 400 }, TODAY)).toBe("fine");
    expect(
      unansweredWord(
        {
          on: true,
          day: TODAY,
          dayUnanswered: 0,
          lastUnanswered: { day: "2026-10-28", count: 400 },
        },
        TODAY
      )
    ).toBe("fine");
  });

  it("is nothing for no ledger, or one this build cannot read, which leaves the alarm as it is", () => {
    expect(unansweredWord(null, TODAY)).toBe("");
    expect(unansweredWord(undefined, TODAY)).toBe("");
    expect(unansweredWord({ on: true, dayUnanswered: "lots" }, TODAY)).toBe("");
  });
});
