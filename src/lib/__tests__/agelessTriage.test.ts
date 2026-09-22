import { describe, expect, it } from "vitest";
import { AGELESS_RULES, agelessVerdicts } from "../agelessTriage";
import type { AgelessEvidence } from "../agelessEvidence";
import type { AgeUnknownTeam } from "../ageUnknown";

const evidence = (extra: Partial<AgelessEvidence> = {}): AgelessEvidence => ({
  games: 8,
  scored: 8,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 5,
  namedAnAge: 0,
  tally: [],
  ...extra,
});

const row = (name: string, extra: Partial<AgeUnknownTeam> = {}): AgeUnknownTeam => ({
  teamId: `gc-${name.replace(/\W+/g, "")}`,
  name,
  firstSeen: "2026-08-01T00:00:00.000Z",
  lastTried: "2026-09-15T00:00:00.000Z",
  tries: 3,
  evidence: evidence(),
  ...extra,
});

/** Which rules fire, by id — the whole answer for a row in one place. */
const fired = (entry: AgeUnknownTeam): string[] =>
  agelessVerdicts(entry).map(({ rule }) => rule.id);

const verdictFrom = (entry: AgeUnknownTeam, id: string) =>
  agelessVerdicts(entry).find(({ rule }) => rule.id === id)?.verdict;

describe("the rules that name a rec league", () => {
  it("reads the markers no travel club uses", () => {
    expect(fired(row("Rochester Fall 2026 Little League"))).toContain("rec-marker");
    expect(fired(row("Murrieta D28"))).toContain("rec-marker");
    expect(fired(row("Shakopee 8/ In-House Sabers"))).toContain("rec-marker");
    expect(fired(row("YMCA Rockies"))).toContain("rec-marker");
    expect(fired(row("Nampa Babe Ruth Select"))).toContain("rec-marker");
  });

  /*
   * A district all-star side plays other districts in state tournaments, so it is connected to the
   * rest of the pool — which is the entire reason the rec category is refused a table. It is the
   * one Little League team that belongs in one.
   */
  it("leaves an all-star side alone", () => {
    expect(fired(row("Northview LL All Stars"))).not.toContain("rec-marker");
    expect(fired(row("D28 Little League All-Stars"))).not.toContain("rec-marker");
  });

  /*
   * "D1 Baseball" and "D1 Athletics" are travel brands. This pool holds 81 teams matching a
   * single-digit district against 3 matching a two-digit one, which is the whole argument for
   * requiring two digits.
   */
  it("does not read a one-digit district, which is a travel brand", () => {
    expect(fired(row("D1 Baseball"))).not.toContain("rec-marker");
    expect(fired(row("Knights of OC -D3"))).not.toContain("rec-marker");
  });

  it("keeps an age the name states alongside the rec verdict", () => {
    expect(verdictFrom(row("Mt. Carmel Little League 11U"), "rec-marker")).toEqual({
      kind: "rec",
      level: 11,
    });
  });
});

/**
 * The PONY divisions are the cleanest age signal in youth baseball and the commonest mascots in it
 * at the same time. Measured over this pool's own 110,850 teams — every one already aged and
 * working — the words appear on 1,015 of them, overwhelmingly as mascots. So corroboration is not
 * a refinement of the rule; it is the rule.
 */
describe("a PONY division word", () => {
  it("says nothing on its own", () => {
    expect(fired(row("Indiana Mustangs Mann"))).not.toContain("pony-division");
    expect(fired(row("Colt 45s"))).not.toContain("pony-division");
  });

  it("is a division when the teams it played carry the sibling words", () => {
    const pony = row("Fillmore Mustangs", {
      evidence: evidence({ sampleOpponents: ["Broncos", "Pintos"] }),
    });
    expect(verdictFrom(pony, "pony-division")).toEqual({ kind: "rec", level: 10 });
  });

  it("is a mascot when the teams it played are travel clubs", () => {
    const travel = row("MVP Mustangs Red", {
      evidence: evidence({ sampleOpponents: ["Elite 12U", "Team Georgia"] }),
    });
    expect(fired(travel)).not.toContain("pony-division");
  });

  it("is a division when GameChanger says the club plays PONY", () => {
    const sanctioned = row("Fillmore Mustangs", { evidence: evidence({ ngb: ["pony"] }) });
    expect(verdictFrom(sanctioned, "pony-division")).toEqual({ kind: "rec", level: 10 });
  });

  // An age in the name outranks every reading below it, and a team whose opponents do write ages
  // is demonstrably not inside a closed league whatever its name says.
  it("stands down when the name states an age, or the opponents do", () => {
    expect(fired(row("Mustangs 12U"))).not.toContain("pony-division");
    const named = row("Fillmore Mustangs", {
      evidence: evidence({
        namedAnAge: 4,
        tally: [[10, 4]],
        sampleOpponents: ["Broncos"],
      }),
    });
    expect(fired(named)).not.toContain("pony-division");
  });
});

/**
 * USSSA grades travel teams A / AA / AAA / Major and Perfect Game does the same plus "Minor". The
 * grade rides alongside an age rather than instead of one, so a bare grade on this list is exactly
 * where reading it as an age would do the most damage — which is why the rule that matches them is
 * measured and never applied.
 */
describe("the grade words", () => {
  it("is a measurement, not a rule anything may act on", () => {
    const grade = AGELESS_RULES.find((entry) => entry.id === "grade-word")!;
    expect(grade.tier).toBe("measure");
    expect(fired(row("EFLL AAA Select Fall 2026"))).toContain("grade-word");
    expect(fired(row("Sacred Heart Majors Red"))).toContain("grade-word");
  });

  it("is never read as an age by any rule", () => {
    const verdicts = agelessVerdicts(row("Thunder AAA"));
    expect(verdicts.filter(({ verdict }) => verdict.kind === "age")).toEqual([]);
    expect(
      agelessVerdicts(row("Dukes Major")).filter(({ verdict }) => verdict.kind === "age")
    ).toEqual([]);
  });
});

describe("the rules that read the evidence rather than the name", () => {
  it("calls a schedule where nobody writes an age a closed league", () => {
    expect(fired(row("Mears 1 - 2026", { evidence: evidence({ opponents: 7 }) }))).toContain(
      "closed-cluster"
    );
    // Too few opponents to say anything, and a team with no games at all is a different problem.
    expect(fired(row("Mears 1 - 2026", { evidence: evidence({ opponents: 3 }) }))).not.toContain(
      "closed-cluster"
    );
    expect(
      fired(row("Mears 1 - 2026", { evidence: evidence({ games: 0, opponents: 0 }) }))
    ).not.toContain("closed-cluster");
  });

  /*
   * `ageFromOpponentNames` needs three opponents naming an age. "Two of two said 9U" is a
   * one-second decision for a person and an answer the automatic rule is not allowed to give, so
   * it is offered rather than taken.
   */
  it("offers the age when every opponent that spoke agreed, but there were too few", () => {
    const near = row("Warriors", {
      evidence: evidence({ opponents: 2, namedAnAge: 2, tally: [[9, 2]] }),
    });
    expect(verdictFrom(near, "near-miss-tally")).toEqual({ kind: "age", level: 9 });
    // Split opponents are not a near miss.
    const split = row("Warriors", {
      evidence: evidence({
        opponents: 2,
        namedAnAge: 2,
        tally: [
          [9, 1],
          [10, 1],
        ],
      }),
    });
    expect(fired(split)).not.toContain("near-miss-tally");
  });

  it("calls a schedule of games scored before they were played invented", () => {
    const invented = row("Test team", {
      evidence: evidence({ scored: 8, aheadOfToday: 8 }),
    });
    expect(verdictFrom(invented, "scored-ahead")).toEqual({ kind: "not-real" });
    // One game ahead of today is a schedule with a date typed wrong.
    expect(
      fired(row("Test team", { evidence: evidence({ scored: 8, aheadOfToday: 1 }) }))
    ).not.toContain("scored-ahead");
  });

  it("stops asking about a team with no games, once it has been asked twice", () => {
    const empty = evidence({ games: 0, scored: 0, opponents: 0 });
    expect(verdictFrom(row("New Club", { evidence: empty, tries: 2 }), "no-games")).toEqual({
      kind: "no-schedule",
    });
    // A club that has only been asked once might just be new.
    expect(fired(row("New Club", { evidence: empty, tries: 1 }))).not.toContain("no-games");
  });

  /*
   * A team whose opponents name themselves varsity is in the school season, which is the only way
   * to reach the high school teams whose own names never say so.
   */
  it("reads a high school team off the company it keeps", () => {
    const plays = row("Lincoln Lions", {
      evidence: evidence({ sampleOpponents: ["Central JV", "Madison Varsity"] }),
    });
    expect(verdictFrom(plays, "school-by-evidence")).toEqual({ kind: "high-school" });
  });

  it("will not call a travel club a school on the word Academy alone", () => {
    const academy = row("Reb Sports Academy Grinders", {
      evidence: evidence({ sampleOpponents: ["Elite 12U", "Team Georgia"], namedAnAge: 2 }),
    });
    expect(fired(academy)).not.toContain("school-by-evidence");
  });
});

describe("the rules that are safe on what they read alone", () => {
  it("files a team whose name the rules can now read", () => {
    // A row recorded before the bracket rule shipped: its name said its age all along.
    expect(verdictFrom(row("Premier Ohio Lopez 9U/10U"), "name-resolves")).toEqual({
      kind: "age",
      level: 10,
    });
  });

  it("retires a row GameChanger filed as a school team", () => {
    const legacy = row("Lincoln Lions", { evidence: evidence({ ageLabel: "Varsity" }) });
    expect(verdictFrom(legacy, "school-label")).toEqual({ kind: "high-school" });
  });

  it("puts tee ball below the youngest level ranked here", () => {
    expect(verdictFrom(row("MTAA TBall White Fall 2026"), "tee-ball")).toEqual({
      kind: "no-schedule",
    });
  });
});

/**
 * Nothing in this file is wired to the app, and that is deliberate: every rule is a candidate to
 * be measured by `scripts/agelessSweep.ts` against a real export before any of it ships.
 */
describe("the shape of the rule set", () => {
  it("gives every rule an id, a tier and a reason", () => {
    AGELESS_RULES.forEach((entry) => {
      expect(entry.id).toMatch(/^[a-z-]+$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.because.length).toBeGreaterThan(0);
      expect(["auto", "review", "measure"]).toContain(entry.tier);
    });
  });

  it("uses each id once, since the sweep reports by id", () => {
    const ids = AGELESS_RULES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says nothing at all about a row with no name and no evidence", () => {
    const bare: AgeUnknownTeam = {
      teamId: "gcEMPTY00001",
      firstSeen: "",
      lastTried: "",
      tries: 0,
    };
    expect(fired(bare)).toEqual([]);
  });
});
