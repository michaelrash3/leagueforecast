import { describe, expect, it } from "vitest";
import {
  agelessClearedPass,
  clearedIds,
  coerceAgelessCleared,
  describeCleared,
  restoreCleared,
} from "../agelessCleared";
import { agelessClearable, CLEARABLE_RULES } from "../agelessTriage";
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
 * Which rows a bulk pass may take: GameChanger's own answers and the calls the user settled. The
 * test that matters most is the one showing a rule that only proposes is not swept along.
 */
describe("the rows a rule has settled", () => {
  it("takes the adult and school labels", () => {
    const list = [
      row("a1", "Long Island Angels 44", "Over 18"),
      row("a2", "MCC Wolves", "college"),
      row("a3", "White Lightnin 40+", "18O"),
      row("s1", "Flaming Bulldogs", "high_varsity"),
      row("s2", "Sentinel JH Bulldogs", "middle_13O"),
    ];
    expect(agelessClearable(list).map(({ row: hit }) => hit.teamId)).toEqual([
      "a1",
      "a2",
      "a3",
      "s1",
      "s2",
    ]);
  });

  it("takes tee ball, a void name and rec ball in a closed league", () => {
    const rec = row("r1", "Fire Chiefs", "Under 13");
    rec.evidence = { ...rec.evidence!, ngb: ["little_league"] };
    const claimed = agelessClearable([
      row("t1", "MTAA TBall White Fall 2026", "Under 13"),
      row("v1", "VOID - DO NOT USE", "Under 13"),
      rec,
    ]);
    expect(claimed.map(({ rule }) => rule.id)).toEqual(["tee-ball", "void-name", "rec-sanctioned"]);
  });

  /*
   * A horse mascot is not a PONY division, and a closed league that names itself nothing a rule
   * can read is not one this pass may guess at. Both stay for somebody to look at.
   */
  it("leaves the rules that only propose alone", () => {
    expect(CLEARABLE_RULES).not.toContain("closed-cluster");
    expect(CLEARABLE_RULES).not.toContain("pony-division");
    expect(CLEARABLE_RULES).not.toContain("grade-word");
    const proposed = [
      row("p1", "Fillmore Mustangs", "Under 13"),
      row("c1", "Mears 1 - 2026", "Under 13"),
    ];
    expect(agelessClearable(proposed)).toEqual([]);
  });

  it("says nothing about a row with no label and nothing to read", () => {
    expect(agelessClearable([row("n1", "Some Club")])).toEqual([]);
  });

  // "VOID" wins over every other reading of the same row, since it is the user's own call.
  it("claims each row once, by the first rule in the list", () => {
    const [hit] = agelessClearable([row("v1", "Void T-Ball", "Over 18")]);
    expect(hit?.rule.id).toBe("void-name");
  });

  // Answers are kept per row object; a re-ask writes a new one, and that has to be read afresh.
  it("reads a row again once a re-ask has replaced it", () => {
    const before = row("r1", "Fire Chiefs", "Under 13");
    expect(agelessClearable([before])).toEqual([]);
    const after: AgeUnknownTeam = { ...before, evidence: { ...before.evidence!, ngb: ["pony"] } };
    expect(agelessClearable([after]).map(({ rule }) => rule.id)).toEqual(["rec-sanctioned"]);
    expect(agelessClearable([before])).toEqual([]);
  });

  it("carries the verdict, so the pass can say which kind each row was", () => {
    const [adult, school] = agelessClearable([
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
        { entry: row("v1", "VOID"), why: "not-real" },
        { entry: row("t1", "Tball Bulls"), why: "too-young" },
        { entry: row("r1", "Fire Chiefs"), why: "rec" },
      ],
      "2026-09-22T12:00:00.000Z"
    );

  it("names the ids it took off the list", () => {
    expect(clearedIds(pass())).toEqual(["a1", "s1", "v1", "t1", "r1"]);
    expect(describeCleared(pass())).toBe("5 teams");
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
    expect(coerceAgelessCleared(damaged)?.rows).toHaveLength(5);
  });

  it("puts the rows back on the waiting list", () => {
    const list: AgeUnknownList = [row("other", "Still Waiting")];
    expect(restoreCleared(list, pass()).map((entry) => entry.teamId)).toEqual([
      "other",
      "a1",
      "s1",
      "v1",
      "t1",
      "r1",
    ]);
  });

  /*
   * A pass can be undone after a pull has already re-learned one of its teams. Two entries for
   * one team would be two questions about it for ever.
   */
  it("does not put a row back twice", () => {
    const relearned: AgeUnknownList = [row("a1", "Long Island Angels 44", "Over 18")];
    const back = restoreCleared(relearned, pass());
    expect(back.map((entry) => entry.teamId)).toEqual(["a1", "s1", "v1", "t1", "r1"]);
  });
});
