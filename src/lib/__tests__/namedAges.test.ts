import { describe, expect, it } from "vitest";
import {
  coerceNamedAges,
  forgetNamedAge,
  isNameableLevel,
  nameAge,
  namedAgeFor,
  namedAgeStands,
  namedAgesList,
  namedAgesOverruled,
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
   * Correcting a team GameChanger has filed at the wrong age: the named level is used ahead of
   * GameChanger's own field, not merely in its absence. `insteadOf` says the 12U was what was
   * being corrected, so GameChanger has not changed its mind and the correction stands.
   */
  it("corrects a team GameChanger has filed at the wrong age", () => {
    const mislabelled: GcTeamSchedule = {
      ...unageable(),
      profile: { ...unageable().profile, ageLevel: 12, ageLabel: "12U" },
    };
    const correction = nameAge(new Map(), {
      teamId: "bKpjvY5AVqOV",
      level: 9,
      namedAt: NOW,
      insteadOf: 12,
    });
    const importer = createGcImporter(empty, { today: NOW, namedAges: correction });
    const outcome = importer.add(mislabelled);

    expect(outcome.ageGroupName).toMatch(/9U/);
    expect(outcome.ageNamedByUser).toBe(9);
  });

  /*
   * And the rule that overrides all of that. A club editing its own GameChanger page is better
   * evidence than a note somebody made weeks ago, so the moment GameChanger's answer changes from
   * what it was when the level was named, GameChanger wins and the named level is ignored.
   */
  it("gives way once GameChanger changes its mind", () => {
    // Named 9U while GameChanger said nothing at all; GameChanger now says 10U.
    const overSilence = named(9);
    const nowSays10U: GcTeamSchedule = {
      ...unageable(),
      profile: { ...unageable().profile, ageLevel: 10, ageLabel: "10U" },
    };
    const importer = createGcImporter(empty, { today: NOW, namedAges: overSilence });
    const outcome = importer.add(nowSays10U);

    expect(outcome.ageGroupName).toMatch(/10U/);
    expect(outcome.ageNamedByUser).toBeUndefined();

    // Same the other way: a correction of 12U gives way when GameChanger moves to 11U.
    const correction = nameAge(new Map(), {
      teamId: "bKpjvY5AVqOV",
      level: 9,
      namedAt: NOW,
      insteadOf: 12,
    });
    const moved: GcTeamSchedule = {
      ...unageable(),
      profile: { ...unageable().profile, ageLevel: 11, ageLabel: "11U" },
    };
    expect(
      createGcImporter(empty, { today: NOW, namedAges: correction }).add(moved).ageGroupName
    ).toMatch(/11U/);
  });

  it("knows when a named level still stands", () => {
    const overSilence = { teamId: "A", level: 9, namedAt: NOW };
    expect(namedAgeStands(overSilence, undefined)).toBe(true);
    expect(namedAgeStands(overSilence, 10)).toBe(false);

    const correction = { teamId: "A", level: 9, namedAt: NOW, insteadOf: 12 };
    expect(namedAgeStands(correction, 12)).toBe(true);
    expect(namedAgeStands(correction, 11)).toBe(false);
    // A field that has gone blank since is a change too.
    expect(namedAgeStands(correction, undefined)).toBe(false);
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
    // B was named over a GameChanger field of 12U, which still says 12U, so it stands.
    expect(namedAgeFor(stored, "B", 12)).toBe(10);
    expect(namedAgeFor(stored, "missing", undefined)).toBeUndefined();
    expect(coerceNamedAges(null).size).toBe(0);
  });

  it("gives the answer back when it is taken away", () => {
    const one = named(9);
    expect(namedAgeFor(one, "bKpjvY5AVqOV", undefined)).toBe(9);
    expect(
      namedAgeFor(forgetNamedAge(one, "bKpjvY5AVqOV"), "bKpjvY5AVqOV", undefined)
    ).toBeUndefined();
  });

  it("lists the ones GameChanger has overruled, so they can be cleared out", () => {
    const one = nameAge(new Map(), { teamId: "A", level: 9, namedAt: NOW });
    expect(namedAgesOverruled(one, () => 10).map((entry) => entry.teamId)).toEqual(["A"]);
    // Still silent, so nothing has changed and the named level is still doing its job.
    expect(namedAgesOverruled(one, () => undefined)).toEqual([]);
  });
});
