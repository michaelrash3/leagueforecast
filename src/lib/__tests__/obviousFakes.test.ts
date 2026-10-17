import { describe, expect, it } from "vitest";
import {
  AHEAD_FEWEST_PLAYED,
  FAR_AHEAD_DAYS,
  PLAINLY_REAL_GAMES,
  sweepMarks,
  type SweepAnswers,
  type SweepPool,
} from "../obviousFakes";
import {
  ABSURD_MARGIN,
  autoRemovalsList,
  coerceAutoRemovals,
  NO_REMOVALS,
  ROUT_MARGIN,
  type AutoRemoval,
  type AutoRemovals,
} from "../autoRemoved";
import { removedClubIds } from "../removedClubs";
import { reasonsInWords } from "../removedForYou";
import { apartKey } from "../keptApart";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * The clubs a nightly sweep takes off every board as plainly made up (`obviousFakes.ts`), and what
 * keeps a club on them: each sign at its edge, each guard, and how a mark is lifted. Placeholder
 * names throughout; the GameChanger ids are made up.
 */

const TODAY = "2026-10-11";
const page8: AgeGroup = { id: "p8", name: "8U 2027", seasonIds: [], ageLevel: 8, year: 2027 };
const page9: AgeGroup = { id: "p9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 };
const page10: AgeGroup = { id: "p10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 };
const page12: AgeGroup = { id: "p12", name: "12U 2027", seasonIds: [], ageLevel: 12, year: 2027 };
const PAGES = [page8, page9, page10, page12];

/** A day `days` from today. */
const ahead = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A pulled club: its own GameChanger schedule, at a level. */
const club = (
  id: string,
  level: number,
  name = `Club ${id}`,
  more: Partial<ScoutTeam> = {}
): ScoutTeam => ({
  id,
  name,
  gcTeams: [
    {
      teamId: `gc${id}`,
      name,
      ageGroupId: `p${level}`,
      ageLevel: level,
      season: "fall",
      seasonYear: 2026,
    },
  ],
  ...more,
});

/** A club only another schedule named: never pulled. */
const standIn = (id: string): ScoutTeam => ({ id, name: `Stand-in ${id}`, nameOnly: true });

let made = 0;
/**
 * A scored game off `filer`'s own schedule (its club's id), `a` scoring `aRuns` against `b`.
 * `listedBy` are the other clubs whose own schedules also list it.
 */
const game = (
  a: string,
  b: string,
  aRuns: number,
  bRuns: number,
  {
    date = "2026-09-20",
    filer = a,
    listedBy = [] as string[],
    page = "p12",
    more = {} as Partial<ScoutGame>,
  } = {}
): ScoutGame => {
  made += 1;
  return {
    id: `g${made}`,
    ageGroupId: page,
    teamAId: a,
    teamBId: b,
    teamAScore: aRuns,
    teamBScore: bRuns,
    date,
    source: { kind: "gamechanger", teamId: `gc${filer}`, gameId: `r${made}` },
    ...(listedBy.length > 0 ? { alsoFrom: listedBy.map((id) => `gc${id}`) } : {}),
    ...more,
  };
};

/*
 * The lines as measured, written out rather than read off the module, so a line moved there fails
 * here: a test that asked the module for its own line would move with it.
 */
it("draws the lines where they were measured", () => {
  expect([
    ABSURD_MARGIN,
    ROUT_MARGIN,
    FAR_AHEAD_DAYS,
    AHEAD_FEWEST_PLAYED,
    PLAINLY_REAL_GAMES,
  ]).toEqual([75, 40, 8, 3, 3]);
});

const NO_WORD: SweepAnswers = { realClubs: new Set(), keptApart: new Set(), namedAges: new Map() };

const sweep = (
  pool: Partial<SweepPool>,
  answers: Partial<SweepAnswers> = {},
  marks: AutoRemovals = NO_REMOVALS,
  today = TODAY
) =>
  sweepMarks(
    { ageGroups: PAGES, teams: [], games: [], ...pool },
    { ...NO_WORD, ...answers },
    marks,
    today
  );

/** The signs each marked GameChanger id carries. */
const signsOf = (marks: AutoRemovals) =>
  Object.fromEntries([...marks].map(([id, mark]) => [id, mark.signs]));

describe("sign A: two or more wins by 40 or more that no loser's own schedule lists", () => {
  it("marks a club with two, and not one with one", () => {
    const fake = club("F", 12);
    expect(
      signsOf(
        sweep({
          teams: [fake, standIn("X"), standIn("Y")],
          games: [game("F", "X", 40, 0), game("F", "Y", 42, 2)],
        })
      )
    ).toEqual({ gcF: ["wins"] });
    expect(
      sweep({ teams: [fake, standIn("X")], games: [game("F", "X", 40, 0), game("F", "X", 6, 2)] })
        .size
    ).toBe(0);
  });

  it("counts a win by 40 and not one by 39", () => {
    // The user's line, 11 October 2026: "repeated wins by 40 or more instead of 30".
    const fake = club("F", 12);
    const teams = [fake, standIn("X")];
    expect(
      signsOf(sweep({ teams, games: [game("F", "X", 45, 5), game("F", "X", 60, 0)] }))
    ).toEqual({ gcF: ["wins"] });
    expect(sweep({ teams, games: [game("F", "X", 39, 0), game("F", "X", 60, 0)] }).size).toBe(0);
  });

  it("is a sign at every age, with no win of fifty asked for", () => {
    const eight = club("E", 8);
    const at8 = (runs: number) => game("E", "X", runs, 0, { page: "p8" });
    expect(signsOf(sweep({ teams: [eight, standIn("X")], games: [at8(41), at8(41)] }))).toEqual({
      gcE: ["wins"],
    });
    // A young travel team's routs of stand-ins by 31 and 35 are no sign at any age.
    expect(sweep({ teams: [eight, standIn("X")], games: [at8(31), at8(35)] }).size).toBe(0);
    const ten = club("T", 10);
    const at10 = (runs: number) => game("T", "X", runs, 0, { page: "p10" });
    expect(signsOf(sweep({ teams: [ten, standIn("X")], games: [at10(40), at10(49)] }))).toEqual({
      gcT: ["wins"],
    });
  });

  it("is not a sign once a loser's own schedule lists one of its wins by 40 or more", () => {
    const fake = club("F", 12);
    const loser = club("L", 12);
    const teams = [fake, loser, standIn("X")];
    const routs = [game("F", "X", 45, 0), game("F", "X", 46, 0)];
    expect(
      sweep({ teams, games: [...routs, game("F", "L", 40, 0, { listedBy: ["L"] })] }).size
    ).toBe(0);
    // A win by 39 a loser lists is none of them, and the two unlisted stand.
    expect(
      signsOf(sweep({ teams, games: [...routs, game("F", "L", 39, 0, { listedBy: ["L"] })] }))
    ).toEqual({ gcF: ["wins"] });
  });

  it("counts only the wins its own schedule filed", () => {
    const fake = club("F", 12);
    const other = club("O", 12);
    // Two routs of F that only O's schedule wrote: O's word against F, not F's.
    expect(
      sweep({
        teams: [fake, other],
        games: [game("F", "O", 40, 0, { filer: "O" }), game("F", "O", 45, 0, { filer: "O" })],
      }).size
    ).toBe(0);
  });
});

describe("sign B: one win by seventy-five or more that the loser's own schedule does not list", () => {
  it("marks at seventy-five and not at seventy-four", () => {
    const fake = club("F", 9);
    expect(signsOf(sweep({ teams: [fake, standIn("X")], games: [game("F", "X", 75, 0)] }))).toEqual(
      { gcF: ["rout"] }
    );
    expect(sweep({ teams: [fake, standIn("X")], games: [game("F", "X", 74, 0)] }).size).toBe(0);
  });

  it("is not a sign when the loser's own schedule lists it", () => {
    // A loser with a sign of its own, so its listing is no corroboration.
    const fake = club("F", 9);
    const loser = club("L", 9, "Demo L");
    expect(
      signsOf(sweep({ teams: [fake, loser], games: [game("F", "L", 80, 0, { listedBy: ["L"] })] }))
    ).toEqual({ gcL: ["named"] });
  });
});

describe("sign C: half of three or more results dated well ahead, none listed by an opponent", () => {
  /** `far` results dated `days` ahead and `past` played already, all against a stand-in. */
  const results = (far: number, days: number, past = 0) => [
    ...Array.from({ length: far }, (_, at) => game("F", "X", 5 + at, 3, { date: ahead(days) })),
    ...Array.from({ length: past }, (_, at) => game("F", "X", 4, at, { date: "2026-09-01" })),
  ];
  const marked = (games: ScoutGame[]) => sweep({ teams: [club("F", 12), standIn("X")], games });

  it("marks two of three dated 8 days ahead, and not 7", () => {
    const marks = marked(results(2, 8, 1));
    expect(signsOf(marks)).toEqual({ gcF: ["ahead"] });
    expect(marks.get("gcF")?.ahead).toEqual({ first: ahead(8), results: 2, played: 3 });
    expect(marked(results(2, 7, 1)).size).toBe(0);
  });

  it("never marks a club with fewer than three scored games", () => {
    // The user's word, 11 October 2026: it "can't be a situation where they only have 2 games
    // listed and one of them is in the future".
    expect(marked(results(1, 30, 1)).size).toBe(0);
    expect(marked(results(2, 30)).size).toBe(0);
    expect(marked(results(1, 30)).size).toBe(0);
    expect(signsOf(marked(results(3, 30)))).toEqual({ gcF: ["ahead"] });
    expect(signsOf(marked(results(2, 30, 2)))).toEqual({ gcF: ["ahead"] });
  });

  it("counts only the results its own schedule filed", () => {
    // O's schedule alone filed a result ahead against F: O's, not F's, so it is no result of F's
    // that an opponent lists, and F's own two ahead stay unlisted, two of its three.
    const fake = club("F", 12);
    const other = club("O", 12);
    const marks = sweep({
      teams: [fake, other, standIn("X"), standIn("Y")],
      games: [
        game("F", "X", 5, 3, { date: ahead(20) }),
        game("F", "X", 6, 3, { date: ahead(21) }),
        game("F", "O", 2, 1, { date: ahead(20), filer: "O" }),
        game("O", "Y", 7, 1, { date: ahead(22) }),
        game("O", "Y", 8, 1, { date: ahead(23) }),
      ],
    });
    expect(signsOf(marks)).toEqual({ gcF: ["ahead"], gcO: ["ahead"] });
    expect(marks.get("gcF")?.ahead).toEqual({ first: ahead(20), results: 2, played: 3 });
  });

  it("does not mark one of three", () => {
    expect(marked(results(1, 30, 2)).size).toBe(0);
  });

  it("does not mark a club whose result ahead an opponent's own schedule lists", () => {
    // An opponent with a sign of its own, so its listing is no corroboration and only the
    // sign's own clause can keep the club.
    const fake = club("F", 12);
    const other = club("O", 12, "Demo O");
    expect(
      signsOf(
        sweep({
          teams: [fake, other, standIn("X")],
          games: [
            game("F", "O", 5, 3, { date: ahead(30), listedBy: ["O"] }),
            game("F", "X", 6, 3, { date: ahead(31) }),
            game("F", "X", 4, 2, { date: "2026-09-01" }),
          ],
        })
      )
    ).toEqual({ gcO: ["named"] });
  });

  it("says when the club is next season's squad", () => {
    const spring: ScoutTeam = {
      ...club("F", 12),
      gcTeams: [
        {
          teamId: "gcF",
          name: "Club F",
          ageGroupId: "p12",
          ageLevel: 12,
          season: "spring",
          seasonYear: 2027,
        },
      ],
    };
    const marks = sweep({
      teams: [spring, standIn("X")],
      games: ["2027-04-01", "2027-04-02", "2027-04-03"].map((date) =>
        game("F", "X", 9, 2, { date })
      ),
    });
    expect(marks.get("gcF")?.ahead).toEqual({
      first: "2027-04-01",
      results: 3,
      played: 3,
      nextSeason: true,
    });
  });
});

describe("sign N: a name with void, test or demo in it as a word of its own", () => {
  it.each(["Demo Squad", "VOID", "Test 12U", "Club (Voided)", "testing team"])(
    "marks %s",
    (name) => {
      const marks = sweep({ teams: [club("F", 12, name)] });
      expect(signsOf(marks)).toEqual({ gcF: ["named"] });
    }
  );

  it.each(["Contest Kings", "Avoid Errors", "Demons", "Testudo", "Tests"])("leaves %s", (name) => {
    expect(sweep({ teams: [club("F", 12, name)] }).size).toBe(0);
  });

  /*
   * Read by the import's own rules for the three words (`madeUpHit`): on the backup of 11 October
   * 2026 the sign's own pattern marked every one of the Austin organisation called TEST's teams,
   * written as "TEST Black" and "TEST Red", which play a season of confirmed games.
   */
  it.each([
    "Test Black Kestrelmoor 12U",
    "Test Red Kestrelmoor 12U",
    "Test Blaze Kestrelmoor",
    "Skiles Test Nettlefield 12U",
    "Bramblecote Test Prep 12U",
    "Gildersleeve Demo Dawgs 12U",
  ])("leaves %s, which the rules for its word leave alone", (name) => {
    expect(sweep({ teams: [club("F", 12, name)] }).size).toBe(0);
  });

  it.each([
    ["Hollowmere Hornets DNU", "dnu"],
    ["Copperfield Do Not Use", "do not use"],
    ["zTestNettlefield", "test"],
  ])("marks %s, for the word as the name writes it", (name, word) => {
    const marks = sweep({ teams: [club("F", 12, name)] });
    expect([...marks.values()].map((mark) => mark.word)).toEqual([word]);
  });

  it("marks only the GameChanger team whose own name has the word, so the club stands", () => {
    const two: ScoutTeam = {
      id: "F",
      name: "Club F",
      gcTeams: [
        { teamId: "gcF1", name: "Club F", ageGroupId: "p12", ageLevel: 12 },
        { teamId: "gcF2", name: "Club F demo", ageGroupId: "p12", ageLevel: 12 },
      ],
    };
    const marks = sweep({ teams: [two] });
    expect(signsOf(marks)).toEqual({ gcF2: ["named"] });
    expect(removedClubIds([two], PAGES, marks)).toEqual(new Set());
    const named = { ...two, name: "Void Club F" };
    const both = sweep({ teams: [named] });
    expect(signsOf(both)).toEqual({ gcF1: ["named"], gcF2: ["named"] });
    expect(removedClubIds([named], PAGES, both)).toEqual(new Set(["F"]));
  });

  it("is not held back by real opponents' schedules listing its games", () => {
    const demo = club("F", 12, "Demo F");
    const real = club("R", 12);
    const games = [1, 2, 3, 4].map((at) =>
      game("F", "R", 5, at, { date: `2026-09-0${at}`, listedBy: ["R"] })
    );
    expect(signsOf(sweep({ teams: [demo, real], games }))).toEqual({ gcF: ["named"] });
  });
});

describe("what keeps a club with a sign", () => {
  // A 12U club with two unlisted routs: sign A, nothing else.
  const fake = club("F", 12);
  const routs = [game("F", "X", 40, 0), game("F", "X", 41, 0)];
  const pool = { teams: [fake, standIn("X")], games: routs };

  it("is marked with none of them", () => {
    expect(sweep(pool).size).toBe(1);
  });

  it("is kept by a GameChanger id or a club id said to be real", () => {
    expect(sweep(pool, { realClubs: new Set(["gcF"]) }).size).toBe(0);
    expect(sweep(pool, { realClubs: new Set(["F"]) }).size).toBe(0);
  });

  it("is kept as any page's own team", () => {
    expect(sweep({ ...pool, ageGroups: [page9, { ...page12, myTeamId: "F" }] }).size).toBe(0);
  });

  it("is kept by a pair kept apart, an age named, or a score vouched for", () => {
    expect(sweep(pool, { keptApart: new Set([apartKey("gcF", "gcZ")]) }).size).toBe(0);
    expect(
      sweep(pool, {
        namedAges: new Map([["gcF", { teamId: "gcF", level: 12, namedAt: "" }]]),
      }).size
    ).toBe(0);
    const vouched = { ...routs[0]!, scoreConfirmed: 40 };
    expect(sweep({ ...pool, games: [vouched, routs[1]!, game("F", "X", 45, 0)] }).size).toBe(0);
  });

  it("is kept when real opponents' schedules list 3 of its games", () => {
    const real = club("R", 12);
    const listed = (count: number) =>
      Array.from({ length: count }, (_, at) =>
        game("F", "R", 6, at, { date: `2026-08-${10 + at}`, listedBy: ["R"] })
      );
    // Nine more games against stand-ins, so three is well under half.
    const rest = Array.from({ length: 9 }, (_, at) =>
      game("F", "X", 3, at, { date: "2026-08-01" })
    );
    expect(
      sweep({ teams: [fake, real, standIn("X")], games: [...routs, ...rest, ...listed(3)] }).size
    ).toBe(0);
    expect(
      sweep({ teams: [fake, real, standIn("X")], games: [...routs, ...rest, ...listed(2)] }).size
    ).toBe(1);
  });

  it("is kept when real opponents' schedules list half of its games", () => {
    const real = club("R", 12);
    const listed = [1, 2].map((at) => game("F", "R", 6, at, { listedBy: ["R"] }));
    expect(sweep({ teams: [fake, real, standIn("X")], games: [...routs, ...listed] }).size).toBe(0);
    expect(
      sweep({
        teams: [fake, real, standIn("X")],
        games: [...routs, listed[0]!, game("F", "X", 2, 1)],
      }).size
    ).toBe(1);
  });

  it("is not kept by an opponent that shows a sign itself", () => {
    const named = club("R", 12, "Demo R");
    const listed = [1, 2, 3].map((at) => game("F", "R", 6, at, { listedBy: ["R"] }));
    expect(
      signsOf(sweep({ teams: [fake, named, standIn("X")], games: [...routs, ...listed] }))
    ).toEqual({ gcF: ["wins"], gcR: ["named"] });
  });
});

describe("a mark, once made", () => {
  const fake = club("F", 12);
  const pool = {
    teams: [fake, standIn("X")],
    games: [
      game("F", "X", 5, 3, { date: ahead(30) }),
      game("F", "X", 6, 3, { date: ahead(31) }),
      game("F", "X", 4, 2, { date: "2026-09-01" }),
    ],
  };
  const marked = sweep(pool);

  it("records the club, the day and the facts", () => {
    expect(marked.get("gcF")).toEqual({
      gcTeamId: "gcF",
      name: "Club F",
      on: TODAY,
      signs: ["ahead"],
      ahead: { first: ahead(30), results: 2, played: 3 },
    } satisfies AutoRemoval);
  });

  it("stays when the sign fades as the days pass, and is the same map when nothing changes", () => {
    expect(sweep(pool, {}, marked, ahead(40))).toBe(marked);
    expect(sweep(pool, {}, marked)).toBe(marked);
  });

  it("is lifted when a guard appears", () => {
    expect(sweep(pool, { realClubs: new Set(["gcF"]) }, marked).size).toBe(0);
  });

  it("is lifted from a club ahead once a real opponent lists one game of it played since", () => {
    const real = club("R", 12);
    const since = game("F", "R", 2, 1, { date: ahead(3), listedBy: ["R"] });
    const before = game("F", "R", 2, 1, { date: "2026-10-01", listedBy: ["R"] });
    const later = { teams: [fake, real, standIn("X")], games: [...pool.games, since] };
    expect(sweep(later, {}, marked, ahead(5)).size).toBe(0);
    // One listed from before the mark is no news, and short of the guard's half.
    const older = { teams: [fake, real, standIn("X")], games: [...pool.games, before] };
    expect(sweep(older, {}, marked, ahead(5))).toBe(marked);
  });

  it("is lifted from a club's routs once a loser's own schedule lists one of them", () => {
    const loser = club("L", 12);
    // Two more games, so one listed is short of the guard's half and only the clause lifts it.
    const rest = [game("F", "X", 3, 1), game("F", "X", 3, 2)];
    const routs = [game("F", "L", 40, 0), game("F", "L", 41, 0)];
    const teams = [fake, loser, standIn("X")];
    const rout = sweep({ teams, games: [...routs, ...rest] });
    expect(signsOf(rout)).toEqual({ gcF: ["wins"] });
    const listed = [{ ...routs[0]!, alsoFrom: ["gcL"] }, routs[1]!, ...rest];
    expect(sweep({ teams, games: listed }, {}, rout).size).toBe(0);
  });

  it("is lifted from a club's routs once a loser lists any win of it by 40, and not by 39", () => {
    const loser = club("L", 12);
    const teams = [fake, loser, standIn("X")];
    const routs = [game("F", "X", 40, 0), game("F", "X", 41, 0)];
    const rout = sweep({ teams, games: routs });
    expect(signsOf(rout)).toEqual({ gcF: ["wins"] });
    const forty = game("F", "L", 40, 0, { listedBy: ["L"] });
    expect(sweep({ teams, games: [...routs, forty] }, {}, rout).size).toBe(0);
    const thirtyNine = game("F", "L", 39, 0, { listedBy: ["L"] });
    expect(sweep({ teams, games: [...routs, thirtyNine] }, {}, rout)).toBe(rout);
  });

  it("is lifted from a name once GameChanger's no longer has the word", () => {
    const demo = sweep({ teams: [club("F", 12, "Demo F")] });
    expect(demo.size).toBe(1);
    expect(sweep({ teams: [club("F", 12, "Hawks F")] }, {}, demo).size).toBe(0);
  });
});

describe("the clubs a set of marks takes off", () => {
  const two: ScoutTeam = {
    id: "F",
    name: "Club F",
    gcTeams: [
      { teamId: "gcF1", name: "Club F", ageGroupId: "p12" },
      { teamId: "gcF2", name: "Club F", ageGroupId: "p12" },
    ],
  };
  const mark = (gcTeamId: string): [string, AutoRemoval] => [
    gcTeamId,
    { gcTeamId, name: "Club F", on: TODAY, signs: ["named"], word: "demo" },
  ];

  it("takes a club off only when every one of its GameChanger ids is marked", () => {
    expect(removedClubIds([two], PAGES, new Map([mark("gcF1")]))).toEqual(new Set());
    expect(removedClubIds([two], PAGES, new Map([mark("gcF1"), mark("gcF2")]))).toEqual(
      new Set(["F"])
    );
  });

  it("never takes off a page's own team", () => {
    const marks = new Map([mark("gcF1"), mark("gcF2")]);
    expect(removedClubIds([two], [{ ...page12, myTeamId: "F" }], marks)).toEqual(new Set());
  });
});

describe("a mark as stored and said", () => {
  it("reads back what it wrote, and drops what is not a mark", () => {
    const marks = new Map<string, AutoRemoval>([
      [
        "gcB",
        {
          gcTeamId: "gcB",
          name: "Club B",
          on: TODAY,
          signs: ["wins", "rout"],
          wins: [
            { gameId: "g1", margin: 80, date: "2026-09-01" },
            { gameId: "g2", margin: 45 },
          ],
        },
      ],
      ["gcA", { gcTeamId: "gcA", name: "Club A", on: TODAY, signs: ["named"], word: "test" }],
    ]);
    const stored = JSON.parse(JSON.stringify(autoRemovalsList(marks))) as unknown[];
    expect(stored.map((entry) => (entry as AutoRemoval).gcTeamId)).toEqual(["gcA", "gcB"]);
    expect(coerceAutoRemovals(stored)).toEqual(marks);
    expect(
      coerceAutoRemovals([...stored, { gcTeamId: "gcC", name: "x", on: TODAY, signs: [] }, 7])
    ).toEqual(marks);
  });

  it("says why in words", () => {
    const base = { gcTeamId: "gcA", name: "Club A", on: TODAY };
    expect(reasonsInWords({ ...base, signs: ["named"], word: "test" })).toEqual(["named 'test'"]);
    expect(
      reasonsInWords({
        ...base,
        signs: ["wins", "rout"],
        wins: [
          { gameId: "g1", margin: 80 },
          { gameId: "g2", margin: 45 },
        ],
      })
    ).toEqual([
      "won 2 games by 40 or more runs that the losers' own schedules do not list",
      "won a game by 80 runs that the loser's own schedule does not list",
    ]);
    expect(
      reasonsInWords({
        ...base,
        signs: ["ahead"],
        ahead: { first: "2027-04-01", results: 3, played: 3, nextSeason: true },
      })
    ).toEqual(["next season's squad, 3 scores dated from 2027-04-01"]);
    expect(
      reasonsInWords({
        ...base,
        signs: ["ahead"],
        ahead: { first: "2026-11-01", results: 3, played: 4 },
      })
    ).toEqual(["3 of its 4 results dated well ahead, the first 2026-11-01"]);
  });

  it("says when the word is in the GameChanger team's name rather than the club's", () => {
    const base = { gcTeamId: "gcA", name: "Club A", on: TODAY, signs: ["named" as const] };
    expect(reasonsInWords({ ...base, word: "demo", teamName: "Club A Demo" })).toEqual([
      "its GameChanger team is named 'Club A Demo'",
    ]);
  });
});

describe("what the review of the sweep found", () => {
  it("keeps a C mark lifted once a real opponent lists a game of the club played since", () => {
    // A club with three stray scores months ahead, all against a stand-in: still half its games
    // once a real game is played, and one real game short of the guard's half.
    const fake = club("F", 12);
    const real = club("R", 12);
    const strays = [60, 70, 80].map((days) => game("F", "X", 5, 3, { date: ahead(days) }));
    const teams = [fake, real, standIn("X")];
    const marked = sweep({ teams, games: strays });
    expect(signsOf(marked)).toEqual({ gcF: ["ahead"] });
    const games = [...strays, game("F", "R", 2, 1, { date: ahead(3), listedBy: ["R"] })];
    const night = sweep({ teams, games }, {}, marked, ahead(5));
    expect(night.size).toBe(0);
    // And the nights after, the mark stays lifted rather than made again on a later day.
    expect(sweep({ teams, games }, {}, night, ahead(6)).size).toBe(0);
    expect(sweep({ teams, games }, {}, night, ahead(40)).size).toBe(0);
    // A club a real opponent lists a game of shows no C at all, however few.
    expect(sweep({ teams, games }).size).toBe(0);
  });

  it("lets two marked clubs whose signs have gone vouch for each other", () => {
    const f = club("F", 12);
    const g = club("G", 12);
    const teams = [f, g, standIn("X")];
    const strays = [20, 21, 22].flatMap((day) => [
      game("F", "X", 5, 3, { date: `2026-11-${day}` }),
      game("G", "X", 6, 3, { date: `2026-11-${day + 1}` }),
    ]);
    const marked = sweep({ teams, games: strays });
    expect(signsOf(marked)).toEqual({ gcF: ["ahead"], gcG: ["ahead"] });
    // In the spring they play each other, both schedules list it, and November has passed.
    const spring = [...strays, game("F", "G", 4, 2, { date: "2027-03-14", listedBy: ["G"] })];
    expect(sweep({ teams, games: spring }, {}, marked, "2027-03-20").size).toBe(0);
  });

  it("lifts A once the loser lists a counted win, though it now stands under another id", () => {
    const fake = club("F", 12);
    const loser = club("L", 12);
    const teams = [fake, loser, standIn("X")];
    const first = game("F", "L", 40, 0);
    const second = game("F", "X", 40, 0);
    const rest = [1, 2, 3, 4].map((at) => game("F", "X", 3, at));
    const marked = sweep({ teams, games: [first, second, ...rest] });
    expect(signsOf(marked)).toEqual({ gcF: ["wins"] });
    // Re-pulled, the loser's schedule lists the game, held as its own row with F's folded in.
    const relisted = game("L", "F", 0, 40, { filer: "L", listedBy: ["F"] });
    const pool = { teams, games: [relisted, second, ...rest] };
    expect(sweep(pool).size).toBe(0);
    expect(sweep(pool, {}, marked).size).toBe(0);
  });

  it("lifts B once the loser lists the win counted, though it now stands under another id", () => {
    const fake = club("F", 9);
    const loser = club("L", 9);
    const teams = [fake, loser, standIn("X")];
    const rout = game("F", "L", 80, 0, { page: "p9" });
    const rest = [1, 2, 3].map((at) => game("F", "X", 3, at, { page: "p9" }));
    const marked = sweep({ teams, games: [rout, ...rest] });
    expect(signsOf(marked)).toEqual({ gcF: ["rout"] });
    const relisted = game("L", "F", 0, 80, { filer: "L", listedBy: ["F"], page: "p9" });
    const pool = { teams, games: [relisted, ...rest] };
    expect(sweep(pool).size).toBe(0);
    expect(sweep(pool, {}, marked).size).toBe(0);
    // While another win by the line stays unlisted, B stands, the mark as it was made rather than
    // lifted and made again on a later day.
    const another = game("F", "X", 90, 0, { page: "p9" });
    const still = { teams, games: [relisted, another, ...rest] };
    expect(sweep(still, {}, marked, ahead(1))).toBe(marked);
  });

  it("names the first score far ahead, not one a day or two ahead", () => {
    const fake = club("F", 12);
    const marks = sweep({
      teams: [fake, standIn("X")],
      games: [
        game("F", "X", 5, 3, { date: ahead(3) }),
        game("F", "X", 6, 3, { date: "2027-04-01" }),
        game("F", "X", 7, 3, { date: "2027-04-02" }),
      ],
    });
    expect(marks.get("gcF")?.ahead).toEqual({ first: "2027-04-01", results: 2, played: 3 });
  });

  it("keeps the GameChanger team's name when only it has the word", () => {
    const linkOnly: ScoutTeam = {
      id: "F",
      name: "Hawks F",
      gcTeams: [{ teamId: "gcF", name: "Hawks F Demo", ageGroupId: "p12", ageLevel: 12 }],
    };
    expect(sweep({ teams: [linkOnly] }).get("gcF")).toEqual({
      gcTeamId: "gcF",
      name: "Hawks F",
      on: TODAY,
      signs: ["named"],
      word: "demo",
      teamName: "Hawks F Demo",
    } satisfies AutoRemoval);
    expect(sweep({ teams: [club("G", 12, "Demo G")] }).get("gcG")?.teamName).toBeUndefined();
  });
});
