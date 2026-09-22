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

  /*
   * A club called the Colts runs several squads and calls them all Colts, so a same-word test is
   * satisfied trivially by a club playing itself. This is what the tripwire caught: accepting the
   * team's own word, the rule fired on 102 teams the pool already ranks and got 46 wrong — "Irvine
   * Colts" filed at 8U read as 16U, "OKC Broncos Gray" at 8U read as 12U.
   */
  it("is not corroborated by a club's own sibling squads", () => {
    const ownSquads = row("Wellington Colts Blue", {
      evidence: evidence({ sampleOpponents: ["Wellington Colts Orange", "Wellington Colts"] }),
    });
    expect(fired(ownSquads)).not.toContain("pony-division");
  });

  /*
   * And why the rule is measured rather than applied even after that fix. Requiring a different
   * sibling word cut it to 7 fires on the working pool, of which 6 were still wrong: horse-mascot
   * clubs play each other. "Broncos Red" played "Mundelein Mustangs Red" — two words, two
   * unrelated travel clubs, filed 9U and 12U.
   */
  it("is measured only, at one right answer in seven", () => {
    expect(AGELESS_RULES.find((entry) => entry.id === "pony-division")?.tier).toBe("measure");
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
 * Little League's Intermediate division, and the number the tripwire corrected.
 *
 * The division is ages 11 to 13, so 13U looked like the right ceiling to file it at. Run against
 * the 60,040 teams this pool already ranks, the rule fires on nine and six carry an age to check
 * against — and 13U disagreed with four of those six. "Brick Surge 50/70", "Corvallis Fall Ball
 * 50/70", "BABL 50/70 Royals" and "MSM Victory Lakes Intermediate 6th Grade - Maroon" are all
 * filed 12U in a pool that took their ages from GameChanger's own field, and the last of those
 * names says why: sixth grade is eleven and twelve. It is the 50/70 field that makes the
 * division, not the age of the boys on it.
 */
describe("the Intermediate division", () => {
  it("files at 12U, which is where the teams that already work are filed", () => {
    expect(verdictFrom(row("WSLL 50/70 Ballers"), "unique-division")).toEqual({
      kind: "rec",
      level: 12,
    });
    expect(verdictFrom(row("Harbor Hawks (Intermediate)"), "unique-division")).toEqual({
      kind: "rec",
      level: 12,
    });
  });

  // Two of six agreeing is not a measurement to ship on, whatever the number is.
  it("stays a proposal rather than an automatic answer", () => {
    expect(AGELESS_RULES.find((entry) => entry.id === "unique-division")?.tier).toBe("review");
  });

  it("still stands down when the name states an age", () => {
    expect(fired(row("Intermediate 13U Rangers"))).not.toContain("unique-division");
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
    // However short: the whole schedule is the rule, not how much of it there is.
    expect(
      verdictFrom(
        row("One game", { evidence: evidence({ games: 1, scored: 1, aheadOfToday: 1 }) }),
        "scored-ahead"
      )
    ).toEqual({ kind: "not-real" });
    // One game ahead of today is a schedule with a date typed wrong.
    expect(
      fired(row("Test team", { evidence: evidence({ scored: 8, aheadOfToday: 1 }) }))
    ).not.toContain("scored-ahead");
    // One game still waiting for its result is not a schedule that is all results.
    expect(
      fired(row("Test team", { evidence: evidence({ games: 9, scored: 8, aheadOfToday: 8 }) }))
    ).not.toContain("scored-ahead");
    // Nor is one with no games at all.
    expect(
      fired(row("Nothing", { evidence: evidence({ games: 0, scored: 0, aheadOfToday: 0 }) }))
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
 * The rules that read the field GameChanger was already sending.
 *
 * Measured over the 36,194 rows waiting on 22 September 2026: `adult-label` reaches 3,303 (9.1%)
 * and `school-label` 1,427 (3.9%), and between them 3,443 of those are rows no other rule in this
 * file touches at all. They are the two largest certain answers in the set, and neither infers
 * anything — both read GameChanger's own word for what the team is.
 */
describe("the rules that read GameChanger's own age field", () => {
  const labelled = (label: string) => row("Some Club", { evidence: evidence({ ageLabel: label }) });

  it("retires a team filed as adult or college", () => {
    ["Over 18", "18O", "college"].forEach((label) => {
      expect(verdictFrom(labelled(label), "adult-label")).toEqual({ kind: "not-youth" });
    });
  });

  it("retires a team filed under any of the school bands", () => {
    ["high_varsity", "high_junior_varsity", "high_freshman", "middle_13O", "elementary"].forEach(
      (label) => {
        expect(verdictFrom(labelled(label), "school-label")).toEqual({ kind: "high-school" });
      }
    );
  });

  it("reads middle_12U as a school team, never as a 12U age", () => {
    expect(verdictFrom(labelled("middle_12U"), "school-label")).toEqual({ kind: "high-school" });
    expect(agelessVerdicts(labelled("middle_12U")).filter((v) => v.verdict.kind === "age")).toEqual(
      []
    );
  });

  it("says nothing about the two bands, which name no team and no age", () => {
    ["Under 13", "Between 13 - 18"].forEach((label) => {
      expect(fired(labelled(label))).not.toContain("adult-label");
      expect(fired(labelled(label))).not.toContain("school-label");
    });
  });
});

/**
 * The band as a veto over every other rule.
 *
 * Measured over the same 36,194 rows: 1,186 of the 1,203 ages the rules derive already sit inside
 * the band GameChanger states, 98.6%. So this changes almost nothing — and every one of the
 * seventeen it does change is the same mistake, a PONY division word read off a mascot or a
 * university.
 */
describe("an age GameChanger's band contradicts", () => {
  it("drops a university read as a ten-year-old side", () => {
    // "SMSU Mustangs" is Southwest Minnesota State, filed `college`, and was headed for 10U.
    const uni = row("SMSU Mustangs Home", {
      evidence: evidence({ ageLabel: "college", sampleOpponents: ["Broncos", "Pintos"] }),
    });
    expect(fired(uni)).not.toContain("pony-division");
  });

  it("drops a mascot read as a sixteen-year-old side", () => {
    // "Owls Colt" and "Canes Colts" are filed `Under 13`; Colt would have filed them at 16U.
    const mascot = row("Owls Colt", {
      evidence: evidence({ ageLabel: "Under 13", sampleOpponents: ["Broncos", "Pintos"] }),
    });
    expect(fired(mascot)).not.toContain("pony-division");
  });

  it("leaves an age the band agrees with exactly where it was", () => {
    const agrees = row("Fillmore Mustangs", {
      evidence: evidence({ ageLabel: "Under 13", sampleOpponents: ["Broncos", "Pintos"] }),
    });
    expect(verdictFrom(agrees, "pony-division")).toEqual({ kind: "rec", level: 10 });
  });

  /*
   * The veto lives in `agelessVerdicts` rather than inside each rule, so a rule written later
   * cannot forget to apply it. This is the test that says so: the rule itself still answers, and
   * the answer is dropped on the way out.
   */
  it("is applied centrally, not by the rule that derived the age", () => {
    const mascot = row("Owls Colt", {
      evidence: evidence({ ageLabel: "Under 13", sampleOpponents: ["Broncos", "Pintos"] }),
    });
    const rule = AGELESS_RULES.find((entry) => entry.id === "pony-division")!;
    expect(rule.read(mascot)).toEqual({ kind: "rec", level: 16 });
    expect(agelessVerdicts(mascot).map(({ rule: hit }) => hit.id)).not.toContain("pony-division");
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
