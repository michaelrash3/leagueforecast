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
      "The cloud's board as last read · offline"
    );
  });
});
