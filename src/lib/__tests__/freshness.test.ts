import { describe, expect, it } from "vitest";
import { agoLabel, daysSince, todayIsoDay } from "../date";
import { latestImportedAt } from "../gameChangerImport";

describe("today, as a pool date", () => {
  it("is the local calendar day, zero-padded", () => {
    expect(todayIsoDay(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
    expect(todayIsoDay(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});

describe("how long ago", () => {
  const now = new Date("2026-09-18T15:00:00Z");
  it("counts whole days and never goes negative", () => {
    expect(daysSince("2026-09-18T09:00:00Z", now)).toBe(0);
    expect(daysSince("2026-09-17T16:00:00Z", now)).toBe(0);
    expect(daysSince("2026-09-17T14:00:00Z", now)).toBe(1);
    expect(daysSince("2026-09-06", now)).toBe(12);
    expect(daysSince("2026-09-20", now)).toBe(0);
  });
  it("reads nothing as never", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("", now)).toBeNull();
    expect(daysSince("not a date", now)).toBeNull();
    expect(agoLabel(undefined, now)).toBe("never");
  });
  it("says it the way a person would", () => {
    expect(agoLabel("2026-09-18T09:00:00Z", now)).toBe("today");
    expect(agoLabel("2026-09-17T09:00:00Z", now)).toBe("yesterday");
    expect(agoLabel("2026-09-06T09:00:00Z", now)).toBe("12 days ago");
  });
});

describe("the newest pull in a pool", () => {
  it("is the latest importedAt across every link, or null when nothing was ever pulled", () => {
    expect(latestImportedAt([{ id: "A", name: "A" }])).toBeNull();
    expect(
      latestImportedAt([
        {
          id: "A",
          name: "A",
          gcTeams: [
            { teamId: "g1", name: "A 9U", ageGroupId: "ag", importedAt: "2026-09-01T10:00:00Z" },
            { teamId: "g2", name: "A 10U", ageGroupId: "ag", importedAt: "2026-09-12T10:00:00Z" },
          ],
        },
        {
          id: "B",
          name: "B",
          gcTeams: [
            { teamId: "g3", name: "B 9U", ageGroupId: "ag", importedAt: "2026-09-08T10:00:00Z" },
          ],
        },
      ])
    ).toBe("2026-09-12T10:00:00Z");
  });
});
