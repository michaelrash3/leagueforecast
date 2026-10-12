import { describe, expect, it } from "vitest";
import { ageLevelOf, nameStatesUnrankableAge, parseGcTeamList } from "../gameChangerApi";

/**
 * The ladder, pinned over the cases that distinguish its rungs.
 *
 * Every row is `[age field, name, squad year]`. The table exists so a change to the order of the
 * rungs has to state which of these it means to move — the repo's "pin, then change" rule, applied
 * to the one function every age in this app comes out of.
 */
const LADDER: [unknown, string, number | undefined][] = [
  // A bracket in the name, read as its older end, above the field.
  ["9U", "Premier Ohio Lopez 9U/10U", undefined],
  // The field alone.
  ["12U", "Cincy Legends Baseball", undefined],
  ["Under 13", "Cincy Legends Baseball", undefined],
  ["Varsity", "Lincoln Eagles", undefined],
  // A graduating class in the field.
  ["2029", "Midwest Nationals", 2027],
  // A single age label in the name, with nothing readable in the field.
  ["Minors", "Trash Pandas 9u", undefined],
  ["", "Trash Pandas 9u", undefined],
  // A graduating class in the name.
  ["Minors", "Elite 2029", 2027],
  // The field and the name both readable, and disagreeing. This is where the two paths part.
  ["11U", "BattleHawks 10U", undefined],
  ["9U", "MBC 8U", undefined],
  ["18U", "BNE NTH 1 12U", undefined],
  ["9U", "4U Ole Glory", undefined],
  // Nothing anywhere.
  ["Minors", "Park Ridge Club", undefined],
];

const shown = (field: unknown, name: string, got: number | undefined) =>
  `${JSON.stringify(name)} + ${JSON.stringify(field)} -> ${got}`;

/** One row through the list reader, which is the only way to reach the list path. */
const viaList = (field: unknown, name: string) =>
  parseGcTeamList(
    `Team Name,Team ID,Age Group\n${JSON.stringify(name)},"gcABCDEFGHIJKL",${JSON.stringify(String(field))}\n`
  ).entries[0]?.ageLevel;

describe("the age ladder, as GameChanger's own profile is read", () => {
  it("is this, rung by rung", () => {
    expect(
      LADDER.map(([field, name, year]) => shown(field, name, ageLevelOf(field, name, year)))
    ).toEqual([
      '"Premier Ohio Lopez 9U/10U" + "9U" -> 10',
      '"Cincy Legends Baseball" + "12U" -> 12',
      '"Cincy Legends Baseball" + "Under 13" -> undefined',
      '"Lincoln Eagles" + "Varsity" -> undefined',
      '"Midwest Nationals" + "2029" -> 16',
      '"Trash Pandas 9u" + "Minors" -> 9',
      '"Trash Pandas 9u" + "" -> 9',
      '"Elite 2029" + "Minors" -> 16',
      // The field wins here, because first-hand from GameChanger it is the better witness.
      '"BattleHawks 10U" + "11U" -> 11',
      '"MBC 8U" + "9U" -> 9',
      '"BNE NTH 1 12U" + "18U" -> 18',
      '"4U Ole Glory" + "9U" -> 9',
      '"Park Ridge Club" + "Minors" -> undefined',
    ]);
  });
});

describe("the same ladder, as a pasted list is read", () => {
  it("is this, rung by rung", () => {
    expect(
      LADDER.filter(([, , year]) => year === undefined).map(([field, name]) =>
        shown(field, name, viaList(field, name))
      )
    ).toEqual([
      '"Premier Ohio Lopez 9U/10U" + "9U" -> 10',
      '"Cincy Legends Baseball" + "12U" -> 12',
      '"Cincy Legends Baseball" + "Under 13" -> undefined',
      '"Lincoln Eagles" + "Varsity" -> undefined',
      '"Trash Pandas 9u" + "Minors" -> 9',
      '"Trash Pandas 9u" + "" -> 9',
      // These four are the whole difference: the name wins, and an unreadable one stops the ladder.
      '"BattleHawks 10U" + "11U" -> 10',
      '"MBC 8U" + "9U" -> 8',
      '"BNE NTH 1 12U" + "18U" -> 12',
      '"4U Ole Glory" + "9U" -> undefined',
      '"Park Ridge Club" + "Minors" -> undefined',
    ]);
  });

  /*
   * Why the two tables differ.
   *
   * A pasted column is only as good as whoever built the file; a name is the club's own statement.
   * Measured against the 60,040 teams this pool already ranks: over an 83,941-row export the age
   * column and the name disagree 21,320 times, and for the 8,822 of those whose team could be
   * found in the pool by name, the **name** matched the filed age 7,603 times (86.2%) against the
   * column's 187 (2.1%). That export's column turned out to be the age bucket its crawler had
   * searched — identical to its own `Found Via Ages` in 59,794 of 59,799 rows — which is exactly
   * the kind of thing a second-hand column can be and a name cannot.
   *
   * A correctly built list points the same way, less starkly: the README's "Check the id" pull of
   * 40,760 teams found the two disagreeing by one 343 times, with the name carrying the right
   * level in 267 of them.
   */
  it("prefers the name over the column, where the profile ladder prefers the field", () => {
    expect(viaList("11U", "BattleHawks 10U")).toBe(10);
    expect(ageLevelOf("11U", "BattleHawks 10U", undefined)).toBe(11);
  });

  /*
   * And a name too young to read stops the ladder rather than letting the column answer for it.
   * 298 names in that export state an age below the floor, and the column offers 9U or 8U for 248
   * of them — tee-ballers filed against nine-year-olds, which corrupts every club they played.
   */
  it("refuses a name that states an age below what it can read", () => {
    ["4U Sparrows", "5U T-Ball Couto Baseball", "PYBSA 4U Cubs"].forEach((name) =>
      expect(viaList("9U", name)).toBeUndefined()
    );
    // 6U is the youngest GameChanger itself writes, so it is read, and filtered as too young later.
    expect(viaList("9U", "6U Sluggers")).toBe(6);
    // A name with no age at all still takes the column: refusing needs a statement to refuse.
    expect(viaList("9U", "Park Ridge Club")).toBe(9);
  });

  it("knows a stated-but-unreadable age from a name that says nothing", () => {
    expect(nameStatesUnrankableAge("4U Sparrows")).toBe(true);
    expect(nameStatesUnrankableAge("5U T-Ball Couto Baseball")).toBe(true);
    expect(nameStatesUnrankableAge("6U Sluggers")).toBe(false);
    expect(nameStatesUnrankableAge("BattleHawks 10U")).toBe(false);
    expect(nameStatesUnrankableAge("Park Ridge Club")).toBe(false);
  });
});
