import { describe, expect, it } from "vitest";
import {
  agelessClearedPass,
  clearedIds,
  coerceAgelessCleared,
  describeCleared,
  restoreCleared,
} from "../agelessCleared";
import { agelessAlreadyAnswered, GC_ANSWERED_RULES } from "../agelessTriage";
import type { AgeUnknownList, AgeUnknownTeam } from "../ageUnknown";

const row = (teamId: string, name: string, ageLabel?: string): AgeUnknownTeam => ({
  teamId,
  name,
  firstSeen: "2026-08-01T00:00:00.000Z",
  lastTried: "2026-09-15T00:00:00.000Z",
  tries: 3,
  evidence: {
    games: 8,
    scored: 8,
    aheadOfToday: 0,
    shutoutBlowouts: 0,
    opponents: 6,
    namedAnAge: 0,
    tally: [],
    ...(ageLabel ? { ageLabel } : {}),
  },
});

/**
 * Which rows a bulk pass may take. The whole safety of the button is that these two rules repeat
 * GameChanger's own age field rather than inferring anything, so the test that matters is the one
 * that shows an inference rule is not swept along with them.
 */
describe("the rows GameChanger has already answered", () => {
  it("takes the adult and school labels", () => {
    const list = [
      row("a1", "Long Island Angels 44", "Over 18"),
      row("a2", "MCC Wolves", "college"),
      row("a3", "White Lightnin 40+", "18O"),
      row("s1", "Flaming Bulldogs", "high_varsity"),
      row("s2", "Sentinel JH Bulldogs", "middle_13O"),
    ];
    expect(agelessAlreadyAnswered(list).map(({ row: hit }) => hit.teamId)).toEqual([
      "a1",
      "a2",
      "a3",
      "s1",
      "s2",
    ]);
  });

  /*
   * The accident this list exists to prevent. `tee-ball` is `auto` too, and it is a name rule
   * that fires on five teams this pool already ranks — selecting by tier rather than by id would
   * sweep it into a bulk pass nobody measured it for.
   */
  it("leaves every rule that infers something alone", () => {
    expect(GC_ANSWERED_RULES).toEqual(["adult-label", "school-label"]);
    const inferred = [
      row("t1", "MTAA TBall White Fall 2026", "Under 13"),
      row("p1", "Fillmore Mustangs", "Under 13"),
      row("c1", "Mears 1 - 2026", "Under 13"),
    ];
    expect(agelessAlreadyAnswered(inferred)).toEqual([]);
  });

  it("says nothing about a row with no label at all", () => {
    expect(agelessAlreadyAnswered([row("n1", "Some Club")])).toEqual([]);
    expect(agelessAlreadyAnswered([row("n2", "Some Club", "Minors")])).toEqual([]);
  });

  it("carries the verdict, so the pass can say which kind each row was", () => {
    const [adult, school] = agelessAlreadyAnswered([
      row("a1", "Long Island Angels 44", "Over 18"),
      row("s1", "Flaming Bulldogs", "high_varsity"),
    ]);
    expect(adult?.verdict).toEqual({ kind: "not-youth" });
    expect(school?.verdict).toEqual({ kind: "high-school" });
  });
});

describe("the pass, kept so it can be taken back", () => {
  const pass = () =>
    agelessClearedPass(
      [
        { entry: row("a1", "Long Island Angels 44", "Over 18"), why: "not-youth" },
        { entry: row("s1", "Flaming Bulldogs", "high_varsity"), why: "high-school" },
      ],
      "2026-09-22T12:00:00.000Z"
    );

  it("names the ids it took off the list", () => {
    expect(clearedIds(pass())).toEqual(["a1", "s1"]);
    expect(describeCleared(pass())).toBe("2 teams");
  });

  it("round-trips through storage", () => {
    const back = coerceAgelessCleared(JSON.parse(JSON.stringify(pass())));
    expect(back).toEqual(pass());
  });

  it("refuses a stored value of the wrong version, rather than half-reading it", () => {
    expect(coerceAgelessCleared({ ...pass(), version: 99 })).toBeNull();
    expect(coerceAgelessCleared(null)).toBeNull();
    expect(coerceAgelessCleared({ version: 1, clearedAt: "", rows: [] })).toBeNull();
  });

  /*
   * Lenient inside a readable pass, for the reason every reader here is: a partly readable undo
   * restores most of the work, and a refused one restores none of it.
   */
  it("drops a row it cannot read and keeps the rest", () => {
    const damaged = {
      ...pass(),
      rows: [...pass().rows, { entry: { teamId: "" }, why: "nonsense" }],
    };
    expect(coerceAgelessCleared(damaged)?.rows).toHaveLength(2);
  });

  it("puts the rows back on the waiting list", () => {
    const list: AgeUnknownList = [row("other", "Still Waiting")];
    expect(restoreCleared(list, pass()).map((entry) => entry.teamId)).toEqual([
      "other",
      "a1",
      "s1",
    ]);
  });

  /*
   * A pass can be undone after a pull has already re-learned one of its teams. Two entries for
   * one team would be two questions about it for ever.
   */
  it("does not put a row back twice", () => {
    const relearned: AgeUnknownList = [row("a1", "Long Island Angels 44", "Over 18")];
    const back = restoreCleared(relearned, pass());
    expect(back.map((entry) => entry.teamId)).toEqual(["a1", "s1"]);
  });
});
