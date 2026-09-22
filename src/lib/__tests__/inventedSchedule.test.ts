import { describe, expect, it } from "vitest";
import { forgetClubs, inventedFromOutcomes, isInventedSchedule } from "../deletedGames";
import { createGcImporter, type GcImportState } from "../gameChangerImport";
import type { GcGame, GcTeamSchedule } from "../gameChangerApi";

const TODAY = "2026-09-22";
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

const played = (id: string, date: string): GcGame => ({
  id,
  date,
  opponentName: "Some Other Club 9U",
  teamScore: 20,
  opponentScore: 0,
  status: "completed",
});
const scheduled = (id: string, date: string): GcGame => ({
  id,
  date,
  opponentName: "Some Other Club 9U",
  status: "scheduled",
});

const schedule = (id: string, ageLabel: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `Club ${id}`,
    ageLabel,
    ...(ageLabel ? { ageLevel: Number(ageLabel.replace(/\D/g, "")) } : {}),
    season: { season: "fall", year: 2026 },
  },
  games,
  fetchedAt: `${TODAY}T12:00:00.000Z`,
});

/** "Test team", 68 of 68: every game a 20-0 result on a day still to come. */
const testTeam = (ageLabel: string) =>
  schedule(
    "test",
    ageLabel,
    Array.from({ length: 68 }, (_, i) =>
      played(`g${i}`, `2026-10-${String((i % 28) + 1).padStart(2, "0")}`)
    )
  );

describe("a schedule that invented itself", () => {
  it("is every game scored on a day that has not happened, however few", () => {
    expect(isInventedSchedule([played("a", "2026-10-03")], TODAY)).toBe(true);
    expect(isInventedSchedule(testTeam("9U").games, TODAY)).toBe(true);
  });

  it("is not a schedule with one game already played", () => {
    expect(isInventedSchedule([played("a", "2026-10-03"), played("b", "2026-09-12")], TODAY)).toBe(
      false
    );
  });

  it("is not a schedule with one game still waiting for its result", () => {
    // The literal rule: the whole schedule is results. A future game without one is a fixture.
    expect(
      isInventedSchedule([played("a", "2026-10-03"), scheduled("b", "2026-10-10")], TODAY)
    ).toBe(false);
    expect(isInventedSchedule([scheduled("a", "2026-10-03")], TODAY)).toBe(false);
  });

  it("is not a game finished today, nor an empty schedule, nor a date it cannot read", () => {
    expect(isInventedSchedule([played("a", TODAY)], TODAY)).toBe(false);
    expect(isInventedSchedule([], TODAY)).toBe(false);
    // A league row's "M/D" is no date to compare: "4/12" sorts after "2026-09-22" for no reason.
    expect(isInventedSchedule([played("a", "4/12")], TODAY)).toBe(false);
    expect(isInventedSchedule([{ ...played("a", "2026-10-03"), date: undefined }], TODAY)).toBe(
      false
    );
  });

  it("takes the ids a run refused as invented, and only those", () => {
    expect(
      inventedFromOutcomes([
        { gcTeamId: "fake", skip: "invented" },
        { gcTeamId: "young", skip: "below-min-age" },
        { gcTeamId: "ageless", skip: "no-age" },
        { gcTeamId: "filed" },
      ])
    ).toEqual(["fake"]);
  });
});

describe("refusing an invented schedule at the door", () => {
  it("files nothing from it, aged or not", () => {
    for (const ageLabel of ["9U", ""]) {
      const importer = createGcImporter(empty, { today: TODAY });
      const outcome = importer.add(testTeam(ageLabel));
      expect(outcome.skip).toBe("invented");
      expect(importer.state.teams).toEqual([]);
      expect(importer.state.games).toEqual([]);
    }
  });

  it("asks it no age, so it never joins the waiting list", () => {
    // With no age of its own this would be `no-age` and carry evidence for the weekly re-ask.
    const outcome = createGcImporter(empty, { today: TODAY }).add(testTeam(""));
    expect(outcome.skip).toBe("invented");
    expect(outcome.noAgeEvidence).toBeUndefined();
  });

  it("files the same schedule once one game on it has been played", () => {
    const real = schedule("real", "9U", [...testTeam("9U").games, played("past", "2026-09-12")]);
    const outcome = createGcImporter(empty, { today: TODAY }).add(real);
    expect(outcome.skip).toBeUndefined();
  });

  it("stays out once remembered, after its dates have come and gone", () => {
    // December: every one of those October results now reads as a game already played.
    const later = createGcImporter(empty, { today: "2026-12-01" });
    expect(later.add(testTeam("9U")).skip).toBeUndefined();

    const remembered = createGcImporter(empty, {
      today: "2026-12-01",
      droppedClubs: forgetClubs(
        new Set(),
        inventedFromOutcomes([{ gcTeamId: "test", skip: "invented" }])
      ),
    });
    expect(remembered.add(testTeam("9U")).skip).toBe("deleted");
    expect(remembered.state.games).toEqual([]);
  });
});
