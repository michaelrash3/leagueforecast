import { describe, expect, it } from "vitest";
import { liveLabel } from "../liveLabel";
import { BOARD_RULES } from "../views/boardShape";

/*
 * What the live board says it is (`liveLabel`): the one thing most worth knowing, first of the
 * ones that hold.
 */

const TODAY = "2027-04-15";
const label = (more: Partial<Parameters<typeof liveLabel>[0]> = {}) =>
  liveLabel({
    check: "checked",
    standing: "current",
    rules: BOARD_RULES,
    boardDay: TODAY,
    today: TODAY,
    ...more,
  });

describe("what the live board says it is", () => {
  it("is the cloud's board, plainly, when the network vouched for today's", () => {
    expect(label()).toBe("The cloud's board");
    expect(label({ standing: "unknown", rules: undefined })).toBe("The cloud's board");
  });

  it("says yesterday's, or the day's, for a board built for an earlier day", () => {
    expect(label({ boardDay: "2027-04-14" })).toBe("Yesterday's board from the cloud");
    expect(label({ boardDay: "2027-04-02" })).toBe("The cloud's board from Fri, Apr 2");
  });

  it("says what it was built before, or by, ahead of the day", () => {
    expect(label({ standing: "behind-copy", boardDay: "2027-04-14" })).toBe(
      "The cloud's board, from before the latest changes"
    );
    expect(label({ standing: "owed" })).toBe(
      "The cloud's board, from before this device's changes"
    );
    expect(label({ rules: BOARD_RULES + 1 })).toBe(
      "The cloud's board, built by another version of the app"
    );
  });

  it("says it is still checking, or offline, ahead of everything", () => {
    expect(label({ check: "checking" })).toBe("The cloud's board · checking for a newer one…");
    expect(label({ check: "checking", standing: "owed" })).toBe(
      "The cloud's board, from before this device's changes"
    );
    expect(label({ check: "offline", standing: "owed", boardDay: "2027-04-01" })).toBe(
      "Offline · the cloud's board as last read"
    );
  });

  it("says offline as of when the server last vouched for it: the time today, else the day", () => {
    // Instants made in the zone the test runs in, as the reader's own clock reads them.
    const evening = new Date(2027, 3, 15, 19, 42).toISOString();
    expect(label({ check: "offline", heardAt: evening })).toBe(
      "Offline · the cloud's board as of 7:42 PM"
    );
    const dayBefore = new Date(2027, 3, 14, 9, 5).toISOString();
    expect(label({ check: "offline", heardAt: dayBefore })).toBe(
      "Offline · the cloud's board as of Wed, Apr 14"
    );
    expect(label({ check: "offline", heardAt: "not a time" })).toBe(
      "Offline · the cloud's board as last read"
    );
    // Only offline says when: a board the network vouched for is as of now.
    expect(label({ heardAt: evening })).toBe("The cloud's board");
  });
});
