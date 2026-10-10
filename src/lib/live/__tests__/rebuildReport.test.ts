import { describe, expect, it } from "vitest";
import { describeRebuilds, rebuildsTrouble } from "../rebuildReport";

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
