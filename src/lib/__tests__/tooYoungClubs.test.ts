import { describe, expect, it } from "vitest";
import {
  coerceTooYoungClubs,
  forgetTooYoung,
  isTooYoungClub,
  rememberTooYoung,
  tooYoungClubsList,
  tooYoungFromOutcomes,
} from "../tooYoungClubs";
import { createGcImporter, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

/** A schedule GameChanger would answer for, whose own field says a rankable age. */
const schedule = (id: string, ageLabel: string): GcTeamSchedule => ({
  profile: {
    id,
    name: `Club ${id}`,
    ageLabel,
    ageLevel: Number(ageLabel.replace(/\D/g, "")),
    season: { season: "fall", year: 2026 },
  },
  games: [
    {
      id: "g1",
      date: "2026-09-12",
      opponentName: "Some Other Club 9U",
      teamScore: 6,
      opponentScore: 2,
      status: "completed",
    },
  ],
  fetchedAt: "2026-09-20T12:00:00.000Z",
});

describe("the clubs too young to rank", () => {
  it("reads back what it stored, and shrugs off what it did not", () => {
    expect(coerceTooYoungClubs(null)).toEqual(new Set());
    expect(coerceTooYoungClubs([{ nope: 1 }, "", "A", 7])).toEqual(new Set(["A"]));
    expect(tooYoungClubsList(new Set(["B", "A"]))).toEqual(["A", "B"]);
  });

  it("takes the ids a run found to be below the youngest level ranked", () => {
    expect(
      tooYoungFromOutcomes([
        { gcTeamId: "young", skip: "below-min-age" },
        { gcTeamId: "old", skip: "above-max-age" },
        { gcTeamId: "ageless", skip: "no-age" },
        { gcTeamId: "filed" },
      ])
    ).toEqual(["young"]);
  });

  it("remembers and forgets", () => {
    const remembered = rememberTooYoung(new Set<string>(), ["A"]);
    expect(isTooYoungClub(remembered, "A")).toBe(true);
    expect(isTooYoungClub(forgetTooYoung(remembered, ["A"]), "A")).toBe(false);
  });

  /*
   * The point of remembering. A nationwide export carries thousands of these; the paste can only
   * skip the rows that name an age themselves, and every other one costs a fetch whose answer
   * never changes. Once it is known, the schedule is refused before a game is read off it.
   */
  it("refuses a known-too-young club's schedule without reading it", () => {
    const filed = createGcImporter(empty, {});
    const before = filed.add(schedule("kid", "9U"));
    expect(before.skip).toBeUndefined();
    expect(filed.state.games).toHaveLength(1);

    const refused = createGcImporter(empty, { tooYoung: rememberTooYoung(new Set(), ["kid"]) });
    const outcome = refused.add(schedule("kid", "9U"));
    expect(outcome.skip).toBe("below-min-age");
    expect(refused.state.games).toEqual([]);
    expect(refused.state.teams).toEqual([]);
  });
});
