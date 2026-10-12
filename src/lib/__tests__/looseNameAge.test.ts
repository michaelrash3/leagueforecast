import { describe, expect, it } from "vitest";
import { ageLevelFromLooseName, type GcGame, type GcTeamProfile } from "../gameChangerApi";
import { createGcImporter, type GcImportState } from "../gameChangerImport";

/**
 * The age a name writes where the ordinary reader cannot see it: glued to the name's other words,
 * or a span written without its U. Only ever the last word, so it ages the teams nothing else
 * could and moves none that anything else already ages.
 */
describe("an age written loosely into a name", () => {
  it("reads one glued to the words around it", () => {
    expect(ageLevelFromLooseName("Simpson Spiders12U")).toBe(12);
    expect(ageLevelFromLooseName("10U_Getskow_Phx_PONY")).toBe(10);
    expect(ageLevelFromLooseName("Donegal Green 12u2 Fall")).toBe(12);
    expect(ageLevelFromLooseName("Wea - Young - 14U1")).toBe(14);
    expect(ageLevelFromLooseName("U13s BLUE")).toBe(13);
    expect(ageLevelFromLooseName("Rillo Dillos9U")).toBe(9);
  });

  // The user's call: in these names a span is two ages, read at the older end like one with a U.
  it("reads a span written without its U, at the older end", () => {
    expect(ageLevelFromLooseName("Giants 11-12 Fall 2026")).toBe(12);
    expect(ageLevelFromLooseName("Braves 9/10 Fall")).toBe(10);
    expect(ageLevelFromLooseName("Town of Cary 15-17")).toBe(17);
    expect(ageLevelFromLooseName("Royals (9-10)")).toBe(10);
  });

  it("leaves a name that says grade, or puts an ordinal against a number", () => {
    expect(ageLevelFromLooseName("Diamond Dirtbags 7/8 Grade")).toBeUndefined();
    expect(ageLevelFromLooseName("Wessington Springs 7-9th Teeners")).toBeUndefined();
  });

  it("does not read a date, a score, a year or a word ending in U", () => {
    expect(ageLevelFromLooseName("TBD- 09/13/26, 4:00 PM")).toBeUndefined();
    expect(ageLevelFromLooseName("Mears 1 - 2026")).toBeUndefined();
    expect(ageLevelFromLooseName("Game 3-7")).toBeUndefined();
    expect(ageLevelFromLooseName("2026-2027 Hawks")).toBeUndefined();
    expect(ageLevelFromLooseName("Hawks 12-10")).toBeUndefined();
    expect(ageLevelFromLooseName("12UNDER Hawks")).toBeUndefined();
    expect(ageLevelFromLooseName("Baseball 4U")).toBeUndefined();
    expect(ageLevelFromLooseName("Park Ridge Club")).toBeUndefined();
    // Each edge of each pattern, one case apiece.
    expect(ageLevelFromLooseName("TBD- 9/10/26")).toBeUndefined();
    expect(ageLevelFromLooseName("Rescheduled 10/11/12")).toBeUndefined();
    expect(ageLevelFromLooseName("Tigers 9-13")).toBeUndefined();
    expect(ageLevelFromLooseName("Hawks 115U")).toBeUndefined();
    expect(ageLevelFromLooseName("Kalu14 Hawks")).toBeUndefined();
  });
});

describe("the loose reading in a pull", () => {
  const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
  const today = "2026-09-23";
  const game = (opponentName: string, id: string): GcGame => ({
    id,
    opponentName,
    status: "completed",
    date: "2026-09-12",
    teamScore: 5,
    opponentScore: 3,
  });
  const pull = (profile: Partial<GcTeamProfile>, opponents: string[] = ["Hawks", "Owls"]) =>
    createGcImporter(empty, { today }).add({
      profile: {
        id: "gcSPIDERS001",
        name: "Simpson Spiders12U",
        season: { season: "fall", year: 2026 },
        ...profile,
      },
      games: opponents.map((name, at) => game(name, `g${at}`)),
      fetchedAt: "2026-09-23T12:00:00.000Z",
    });

  it("files a team nothing else could age at the age its name writes", () => {
    const outcome = pull({});
    expect(outcome.skip).toBeUndefined();
    expect(outcome.ageFromLooseName).toBe(12);
    expect(outcome.ageGroupName).toContain("12U");
  });

  it("never moves a team GameChanger's own field ages", () => {
    const outcome = pull({ ageLevel: 10, ageLabel: "10U" });
    expect(outcome.ageFromLooseName).toBeUndefined();
    expect(outcome.ageGroupName).toContain("10U");
  });

  it("comes after the opponents, so a team they age is aged by them", () => {
    const outcome = pull({}, ["Hawks 11U", "Owls 11U", "Jays 11U"]);
    expect(outcome.ageFromLooseName).toBeUndefined();
    expect(outcome.ageFromOpponents).toBe(11);
  });

  it("never files against GameChanger's own band", () => {
    const outcome = pull({ name: "Giants 11-12", ageLabel: "Between 13 - 18" });
    expect(outcome.skip).toBe("no-age");
    expect(pull({ name: "Giants 11-12", ageLabel: "Under 13" }).ageFromLooseName).toBe(12);
  });

  it("turns away a name that writes an age below the youngest level ranked", () => {
    expect(pull({ name: "Tigers6U_Smith" }).skip).toBe("below-min-age");
  });
});
