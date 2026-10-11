import { describe, expect, it } from "vitest";
import {
  ABSURD_MARGIN,
  FAR_AHEAD_DAYS,
  PLAINLY_REAL_GAMES,
  ROUTS_FROM_LEVEL,
  SURE_BLOWOUT,
  sweepMarks,
  type SweepAnswers,
  type SweepPool,
} from "../obviousFakes";
import {
  autoRemovalsList,
  coerceAutoRemovals,
  NO_REMOVALS,
  reasonsInWords,
  removedClubIds,
  type AutoRemoval,
  type AutoRemovals,
} from "../autoRemoved";
import { apartKey } from "../keptApart";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * The clubs a nightly sweep takes off every board as plainly made up (`obviousFakes.ts`), and what
 * keeps a club on them: each sign at its edge, each guard, and how a mark is lifted. Placeholder
 * names throughout; the GameChanger ids are made up.
 */

const TODAY = "2026-10-11";
const page9: AgeGroup = { id: "p9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 };
const page10: AgeGroup = { id: "p10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 };
const page12: AgeGroup = { id: "p12", name: "12U 2027", seasonIds: [], ageLevel: 12, year: 2027 };
const PAGES = [page9, page10, page12];

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
    SURE_BLOWOUT,
    ROUTS_FROM_LEVEL,
    FAR_AHEAD_DAYS,
    PLAINLY_REAL_GAMES,
  ]).toEqual([75, 50, 11, 8, 3]);
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

describe("sign A: two or more wins by more than thirty that no loser's own schedule lists", () => {
  it("marks a 12U club with two, and not one with one", () => {
    const fake = club("F", 12);
    expect(
      signsOf(
        sweep({
          teams: [fake, standIn("X"), standIn("Y")],
          games: [game("F", "X", 31, 0), game("F", "Y", 40, 2)],
        })
      )
    ).toEqual({ gcF: ["wins"] });
    expect(
      sweep({ teams: [fake, standIn("X")], games: [game("F", "X", 31, 0), game("F", "X", 6, 2)] })
        .size
    ).toBe(0);
  });

  it("leaves a 10U club with two such wins alone unless one of them is by fifty", () => {
    const young = club("Y", 10);
    const two = [game("Y", "X", 40, 0, { page: "p10" }), game("Y", "X", 41, 1, { page: "p10" })];
    expect(sweep({ teams: [young, standIn("X")], games: two }).size).toBe(0);
    const fifty = [two[0]!, game("Y", "X", 50, 0, { page: "p10" })];
    expect(signsOf(sweep({ teams: [young, standIn("X")], games: fifty }))).toEqual({
      gcY: ["wins"],
    });
    const fortyNine = [two[0]!, game("Y", "X", 49, 0, { page: "p10" })];
    expect(sweep({ teams: [young, standIn("X")], games: fortyNine }).size).toBe(0);
  });

  it("is not a sign once a loser's own schedule lists one of its wins by more than thirty", () => {
    const fake = club("F", 12);
    const loser = club("L", 12);
    expect(
      sweep({
        teams: [fake, loser, standIn("X")],
        games: [
          game("F", "X", 35, 0),
          game("F", "X", 36, 0),
          game("F", "L", 33, 1, { listedBy: ["L"] }),
        ],
      }).size
    ).toBe(0);
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

describe("sign C: half its results dated well ahead, and no opponent listing any of them", () => {
  const twoGames = (days: number, listedBy: string[] = []) => [
    game("F", "X", 5, 3, { date: ahead(days), listedBy }),
    game("F", "X", 4, 2, { date: "2026-09-01" }),
  ];

  it("marks one of two dated 8 days ahead, and not 7", () => {
    const fake = club("F", 12);
    const marks = sweep({ teams: [fake, standIn("X")], games: twoGames(8) });
    expect(signsOf(marks)).toEqual({ gcF: ["ahead"] });
    expect(marks.get("gcF")?.ahead).toEqual({ first: ahead(8), results: 1, played: 2 });
    expect(sweep({ teams: [fake, standIn("X")], games: twoGames(7) }).size).toBe(0);
  });

  it("counts only the results its own schedule filed", () => {
    // O's schedule alone filed a result ahead against F: O's, not F's, and F's own one ahead
    // stays unlisted, half of F's two.
    const fake = club("F", 12);
    const other = club("O", 12);
    expect(
      signsOf(
        sweep({
          teams: [fake, other, standIn("X")],
          games: [
            game("F", "X", 5, 3, { date: ahead(20) }),
            game("F", "O", 2, 1, { date: ahead(20), filer: "O" }),
          ],
        })
      )
    ).toEqual({ gcF: ["ahead"], gcO: ["ahead"] });
  });

  it("does not mark one of three", () => {
    const fake = club("F", 12);
    expect(
      sweep({
        teams: [fake, standIn("X")],
        games: [...twoGames(30), game("F", "X", 1, 0, { date: "2026-09-02" })],
      }).size
    ).toBe(0);
  });

  it("does not mark a club whose result ahead an opponent's own schedule lists", () => {
    // An opponent with a sign of its own, so its listing is no corroboration and only the
    // sign's own clause can keep the club.
    const fake = club("F", 12);
    const other = club("O", 12, "Demo O");
    expect(
      signsOf(
        sweep({
          teams: [fake, other],
          games: [
            game("F", "O", 5, 3, { date: ahead(30), listedBy: ["O"] }),
            game("F", "O", 4, 2, { date: "2026-09-01" }),
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
      games: [game("F", "X", 9, 2, { date: "2027-04-01" })],
    });
    expect(marks.get("gcF")?.ahead).toEqual({
      first: "2027-04-01",
      results: 1,
      played: 1,
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
  const far = game("F", "X", 5, 3, { date: ahead(30) });
  const pool = {
    teams: [fake, standIn("X")],
    games: [far, game("F", "X", 4, 2, { date: "2026-09-01" })],
  };
  const marked = sweep(pool);

  it("records the club, the day and the facts", () => {
    expect(marked.get("gcF")).toEqual({
      gcTeamId: "gcF",
      name: "Club F",
      on: TODAY,
      signs: ["ahead"],
      ahead: { first: ahead(30), results: 1, played: 2 },
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
            { gameId: "g2", margin: 35 },
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
          { gameId: "g2", margin: 35 },
        ],
      })
    ).toEqual([
      "won 2 games by more than 30 runs that the losers' own schedules do not list",
      "won a game by 80 runs that the loser's own schedule does not list",
    ]);
    expect(
      reasonsInWords({
        ...base,
        signs: ["ahead"],
        ahead: { first: "2027-04-01", results: 1, played: 1, nextSeason: true },
      })
    ).toEqual(["next season's squad, one score dated 2027-04-01"]);
    expect(
      reasonsInWords({
        ...base,
        signs: ["ahead"],
        ahead: { first: "2026-11-01", results: 3, played: 4 },
      })
    ).toEqual(["3 of its 4 results dated ahead, the first 2026-11-01"]);
  });
});
