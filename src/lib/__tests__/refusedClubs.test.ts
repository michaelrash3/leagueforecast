import { describe, expect, it } from "vitest";
import { importGcSchedule, type GcImportState } from "../gameChangerImport";
import {
  coerceRefusedClubs,
  forgetRefused,
  isRefusedClub,
  NO_REFUSED_CLUBS,
  refusedClubsStored,
  refusedCount,
  rememberRefused,
} from "../refusedClubs";

/*
 * The ids a pull fetched and turned away, kept so a paste of the same list does not fetch them
 * again. Pasting a crawl's seasonless export a second time sent 220,103 ids on 26 September 2026,
 * most of them teams already turned away as another season's.
 */
const learned = rememberRefused(NO_REFUSED_CLUBS, [
  { gcTeamId: "HighSchool01", skip: "high-school" },
  { gcTeamId: "WiffleBall01", skip: "not-baseball" },
  { gcTeamId: "MensLeague01", skip: "not-youth" },
  { gcTeamId: "NineteenU001", skip: "above-max-age" },
  { gcTeamId: "LastSummer01", skip: "other-season", otherSeasonYear: 2026 },
  { gcTeamId: "NoAgeYet0001", skip: "no-age" },
  { gcTeamId: "TooYoung0001", skip: "below-min-age" },
  { gcTeamId: "EmptyOffSzn1", skip: "out-of-season" },
  { gcTeamId: "FiledFine001" },
]);

describe("what a finished run remembers", () => {
  it("is what a team is, for good, and another season's team against its year", () => {
    expect([...learned.forGood].sort()).toEqual([
      "HighSchool01",
      "MensLeague01",
      "NineteenU001",
      "WiffleBall01",
    ]);
    expect([...(learned.bySeason.get(2026) ?? [])]).toEqual(["LastSummer01"]);
    // An age still to find, a too-young squad and an empty schedule each have their own list.
    expect(refusedCount(learned)).toBe(5);
  });

  it("hands back what it was given when a run learned nothing", () => {
    expect(rememberRefused(learned, [{ gcTeamId: "HighSchool01", skip: "high-school" }])).toBe(
      learned
    );
    expect(rememberRefused(learned, [{ gcTeamId: "FiledFine002" }])).toBe(learned);
  });
});

describe("which ids a paste leaves out", () => {
  it("leaves out a team refused for what it is, whatever is ticked", () => {
    expect(isRefusedClub(learned, "HighSchool01", [2027])).toBe(true);
    expect(isRefusedClub(learned, "HighSchool01", [2026, 2027])).toBe(true);
  });

  it("leaves out another season's team only while its season is not ticked", () => {
    expect(isRefusedClub(learned, "LastSummer01", [2027])).toBe(true);
    expect(isRefusedClub(learned, "LastSummer01", [2026, 2027])).toBe(false);
  });

  it("keeps everything else, and everything once forgotten", () => {
    expect(isRefusedClub(learned, "NoAgeYet0001", [2027])).toBe(false);
    const forgotten = forgetRefused(learned, ["HighSchool01", "LastSummer01"]);
    expect(isRefusedClub(forgotten, "HighSchool01", [2027])).toBe(false);
    expect(isRefusedClub(forgotten, "LastSummer01", [2027])).toBe(false);
    expect(refusedCount(forgotten)).toBe(3);
  });
});

describe("how the refusals are stored", () => {
  it("round-trips, sorted", () => {
    const stored = refusedClubsStored(learned);
    expect(stored).toEqual({
      forGood: ["HighSchool01", "MensLeague01", "NineteenU001", "WiffleBall01"],
      bySeason: { "2026": ["LastSummer01"] },
    });
    const back = coerceRefusedClubs(JSON.parse(JSON.stringify(stored)));
    expect(refusedClubsStored(back)).toEqual(stored);
  });

  it("reads nothing out of anything else", () => {
    for (const raw of [null, "x", [], 7, { forGood: "a", bySeason: [] }]) {
      expect(refusedCount(coerceRefusedClubs(raw))).toBe(0);
    }
    const mixed = coerceRefusedClubs({
      forGood: ["Kept00000001", 3, ""],
      bySeason: { "2026": ["Kept00000002", null], soon: ["Dropped00001"] },
    });
    expect(refusedClubsStored(mixed)).toEqual({
      forGood: ["Kept00000001"],
      bySeason: { "2026": ["Kept00000002"] },
    });
  });
});

describe("a refusal as another season's", () => {
  it("names the year it was refused for", () => {
    const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
    const { outcome } = importGcSchedule(
      {
        profile: {
          id: "LastSummer01",
          name: "River City 12U",
          ageLevel: 12,
          season: { season: "summer", year: 2026 },
        },
        games: [],
        fetchedAt: "2026-09-28T12:00:00.000Z",
      },
      empty,
      { seasonYears: new Set([2027]), today: "2026-09-28" }
    );
    expect({ skip: outcome.skip, year: outcome.otherSeasonYear }).toEqual({
      skip: "other-season",
      year: 2026,
    });
  });
});
