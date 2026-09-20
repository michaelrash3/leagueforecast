import { describe, expect, it } from "vitest";
import {
  coerceNamedAges,
  forgetNamedAge,
  isNameableLevel,
  nameAge,
  namedAgeFor,
  namedAgesList,
  namedAgesNowDisputed,
} from "../namedAges";
import { createGcImporter, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { MAX_AGE_LEVEL, MIN_AGE_LEVEL } from "../teamRankings/seasons";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const NOW = "2026-09-20";

/** A schedule nothing can age on its own: no field, a name that says nothing, silent opponents. */
const unageable = (id = "bKpjvY5AVqOV"): GcTeamSchedule => ({
  profile: { id, name: "Warriors Spring 2027", season: { season: "fall", year: 2026 } },
  games: [
    {
      id: "g1",
      date: "2026-09-12",
      opponentName: "Mears 1 - 2026",
      teamScore: 6,
      opponentScore: 2,
      status: "completed",
    },
  ],
  fetchedAt: "2026-09-20T12:00:00.000Z",
});

const named = (level: number, id = "bKpjvY5AVqOV") =>
  nameAge(new Map(), { teamId: id, level, namedAt: NOW });

describe("an age somebody named by hand", () => {
  it("files a team nothing else could age", () => {
    const without = createGcImporter(empty, { today: NOW });
    expect(without.add(unageable()).skip).toBe("no-age");
    expect(without.state.teams).toEqual([]);

    const with9U = createGcImporter(empty, { today: NOW, namedAges: named(9) });
    const outcome = with9U.add(unageable());

    expect(outcome.skip).toBeUndefined();
    expect(outcome.ageNamedByUser).toBe(9);
    expect(outcome.ageGroupName).toMatch(/9U/);
    expect(with9U.state.games).toHaveLength(1);
  });

  /*
   * First in the chain, not a last resort. It is the only placement that also answers the next
   * problem along — a team GameChanger has filed at the wrong age — and a person who opened the
   * page is better evidence than a field this codebase already treats as unreliable.
   */
  it("beats GameChanger's own field, not merely its absence", () => {
    const mislabelled: GcTeamSchedule = {
      ...unageable(),
      profile: { ...unageable().profile, ageLevel: 12, ageLabel: "12U" },
    };
    const importer = createGcImporter(empty, { today: NOW, namedAges: named(9) });
    const outcome = importer.add(mislabelled);

    expect(outcome.ageGroupName).toMatch(/9U/);
    expect(outcome.ageNamedByUser).toBe(9);
  });

  /*
   * A stored level the app does not rank would be an answer that files nowhere: `resolveAgeGroup`
   * refuses below MIN_AGE_LEVEL, so the team would come off the ageless list AND land on no page,
   * vanishing from both. Dropping the row leaves it exactly where it was, still being asked about.
   */
  it("refuses a level the app does not rank rather than clamping it", () => {
    expect(isNameableLevel(MIN_AGE_LEVEL)).toBe(true);
    expect(isNameableLevel(MAX_AGE_LEVEL)).toBe(true);
    expect(isNameableLevel(MIN_AGE_LEVEL - 1)).toBe(false);
    expect(isNameableLevel(MAX_AGE_LEVEL + 1)).toBe(false);
    expect(isNameableLevel(9.5)).toBe(false);

    expect(nameAge(new Map(), { teamId: "A", level: 6, namedAt: NOW }).size).toBe(0);
    expect(coerceNamedAges([{ teamId: "A", level: 6, namedAt: NOW }]).size).toBe(0);

    // And the team it would have been about is still unfiled rather than half-filed.
    const importer = createGcImporter(empty, {
      today: NOW,
      namedAges: coerceNamedAges([{ teamId: "bKpjvY5AVqOV", level: 6, namedAt: NOW }]),
    });
    expect(importer.add(unageable()).skip).toBe("no-age");
  });

  it("reads back what it stored, and shrugs off what it did not", () => {
    const stored = coerceNamedAges([
      { teamId: "B", level: 10, namedAt: NOW, insteadOf: 12 },
      { teamId: "A", level: 9, namedAt: NOW, name: "Warriors" },
      { teamId: "", level: 9 },
      { level: 9 },
      "nope",
    ]);
    expect(namedAgesList(stored).map((one) => one.teamId)).toEqual(["A", "B"]);
    expect(namedAgeFor(stored, "B")).toBe(10);
    expect(namedAgeFor(stored, "missing")).toBeUndefined();
    expect(coerceNamedAges(null).size).toBe(0);
  });

  it("gives the answer back when it is taken away", () => {
    const one = named(9);
    expect(namedAgeFor(forgetNamedAge(one, "bKpjvY5AVqOV"), "bKpjvY5AVqOV")).toBeUndefined();
  });

  /*
   * Listed, never acted on. Silently preferring either answer would be the app making a judgement
   * it has no standing to make: the club may have corrected its own page, or mis-typed it.
   */
  it("notices when GameChanger has since said something else, without deciding", () => {
    const one = nameAge(new Map(), { teamId: "A", level: 9, namedAt: NOW, insteadOf: undefined });
    expect(namedAgesNowDisputed(one, () => 10).map((e) => e.teamId)).toEqual(["A"]);
    expect(namedAgesNowDisputed(one, () => 9)).toEqual([]);
    expect(namedAgesNowDisputed(one, () => undefined)).toEqual([]);
  });
});
