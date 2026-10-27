import { describe, expect, it } from "vitest";
import {
  findHalves,
  funnel,
  funnelEnd,
  HALF_FUNNEL,
  HALF_KINDS,
  nearScores,
  shiftDay,
  tallyFunnel,
  testKnownPairs,
  type HalfCandidate,
  type HalfKind,
  type HalfStep,
} from "../standInHalves";
import type { FoldedRow, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * Where the other half of a game against a stand-in is: another pulled club's own row a day either
 * side with the result mirrored, by what that row is filed against, narrowed a step at a time until
 * one is left, and the same a week either side for the rate each step settles on one by chance.
 * Placeholder names throughout.
 */
const PAGE = "ag_10u_2027";
const club = (id: string, name: string, state: string): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc-${id}`, name, ageGroupId: PAGE, ageLevel: 10 }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });

const TEAMS: ScoutTeam[] = [
  club("N", "Northside Owls", "KY"),
  club("C", "Cincy Flames 10U", "OH"),
  club("D", "Desert Hawks", "AZ"),
  club("E", "Eastside Bats", "KY"),
  standIn("X", "Flames"),
  standIn("Y", "Owls Blue"),
  { id: "SLOT", name: "Pool A #1", placeholder: true },
];

let made = 0;
/** A row of `schedule`'s own: A against B on a day, at 2 PM, A's runs first. */
const row = (
  schedule: string,
  a: string,
  b: string,
  date: string,
  runs: [number, number] | null,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId: PAGE,
  teamAId: a,
  teamBId: b,
  date,
  startTs: `${date}T14:00:00Z`,
  ...(runs ? { teamAScore: runs[0], teamBScore: runs[1] } : {}),
  source: { kind: "gamechanger", teamId: `gc-${schedule}`, gameId: `x${made}` },
  ...more,
});
const noStart = ({ startTs: _dropped, ...game }: ScoutGame): ScoutGame => game;
/** A page's level off its id, as `ageGroupLevel` reads a page. */
const levelOf = (ageGroupId: string): number | undefined => {
  const level = /^ag_(\d+)u_/.exec(ageGroupId)?.[1];
  return level === undefined ? undefined : Number(level);
};

const ALL: HalfStep = { key: "all", keeps: () => true };
const byKind = (kind: HalfKind): HalfStep[] => [
  ALL,
  { key: kind, keeps: (one) => one.kind === kind },
];
/** How many candidates of each kind the first row has, through a funnel that only sorts by kind. */
const kindsOf = (games: ScoutGame[]) =>
  Object.fromEntries(
    HALF_KINDS.map((kind) => [
      kind,
      findHalves(TEAMS, games, levelOf, byKind(kind)).rows[0]!.found.left[1],
    ])
  ) as Record<HalfKind, number>;
/** The one candidate of a kind the first row has, with what was read of it. */
const onlyOf = (games: ScoutGame[], kind: HalfKind) =>
  findHalves(TEAMS, games, levelOf, byKind(kind)).rows[0]!.found.furthest!;

describe("the other half of a game against a stand-in", () => {
  const against = row("N", "N", "X", "2026-09-12", [5, 3]);
  const games = [
    against,
    // The Flames' own row against the Owls themselves: the claim step's case.
    row("C", "C", "N", "2026-09-12", [3, 5], { startTs: "2026-09-12T14:40:00Z" }),
    // A row a day later, a level up, the result mirrored, against a stand-in: the crossed halves'.
    row("E", "Y", "E", "2026-09-13", [5, 3], { ageGroupId: "ag_11u_2027" }),
    // Against a third club whose own schedule does not list it, across the country.
    row("D", "D", "C", "2026-09-11", [3, 5]),
    // Not mirrored, two days off, the namer's own, or a game both clubs list: none of them.
    row("C", "C", "N", "2026-09-12", [5, 3]),
    row("C", "C", "N", "2026-09-14", [3, 5]),
    row("N", "N", "E", "2026-09-12", [5, 3]),
    { ...row("D", "D", "E", "2026-09-12", [3, 5]), alsoFrom: ["gc-E"] },
  ];

  it("is another pulled club's own row a day either side with the result mirrored, by its kind", () => {
    const search = findHalves(TEAMS, games, levelOf);
    // The Bats' row against "Owls Blue" is a row against a stand-in as well.
    expect(search.rows.map((one) => `${one.namerId}>${one.standInId}`)).toEqual(["N>X", "E>Y"]);
    expect(search.rows[0]!.found.left[0]).toBe(3);
    expect(kindsOf(games)).toEqual({ namer: 1, standIn: 1, other: 1 });
  });

  it("reads each candidate's day, start, region and level beside the row's", () => {
    expect(onlyOf(games, "namer")).toMatchObject({
      clubId: "C",
      opponentId: "N",
      daysApart: 0,
      minutesApart: 40,
      inRegion: true,
      levelGap: 0,
    });
    expect(onlyOf(games, "standIn")).toMatchObject({
      clubId: "E",
      opponentId: "Y",
      daysApart: 1,
      minutesApart: 1440,
      inRegion: true,
      levelGap: 1,
    });
    expect(onlyOf(games, "other")).toMatchObject({ clubId: "D", inRegion: false, levelGap: 0 });
    // A row with no start, and a page with no level, are not read as either.
    const bare = onlyOf([against, noStart(row("C", "C", "N", "2026-09-12", [3, 5]))], "namer");
    expect(bare).not.toHaveProperty("minutesApart");
    const levelless = findHalves(TEAMS, games, () => undefined, byKind("namer")).rows[0]!.found
      .furthest!;
    expect(levelless).not.toHaveProperty("levelGap");
  });

  it("reads a bracket slot as a stand-in on the other row's side, and a row with no result not at all", () => {
    const slotted = [
      row("N", "N", "X", "2026-09-12", [2, 7]),
      row("C", "C", "SLOT", "2026-09-12", [7, 2]),
      row("E", "E", "X", "2026-09-12", null),
      { ...row("E", "E", "X", "2026-09-19", [4, 4]), excluded: true },
    ];
    expect(findHalves(TEAMS, slotted, levelOf).unplayed).toBe(2);
    expect(kindsOf(slotted)).toEqual({ namer: 0, standIn: 1, other: 0 });
  });

  it("is never the row itself nor another of the namer's own, a tie included", () => {
    const search = findHalves(
      TEAMS,
      [row("N", "N", "X", "2026-09-12", [4, 4]), row("N", "N", "E", "2026-09-12", [4, 4])],
      levelOf
    );
    expect(search.rows[0]!.found.left[0]).toBe(0);
  });

  it("searches the weeks either side, the start compared at the decoy week's own hour", () => {
    const search = findHalves(
      TEAMS,
      [
        row("N", "N", "X", "2026-09-12", [5, 3]),
        // A week back: no start. A week on: two, the one at 2:30 within the hour.
        noStart(row("C", "C", "N", "2026-09-05", [3, 5])),
        row("C", "C", "N", "2026-09-19", [3, 5], { startTs: "2026-09-19T14:30:00Z" }),
        row("D", "D", "N", "2026-09-19", [3, 5], { startTs: "2026-09-19T19:00:00Z" }),
      ],
      levelOf
    );
    const [back, on] = search.rows[0]!.decoys;
    expect(search.rows[0]!.found.left[0]).toBe(0);
    expect(back!.left).toEqual([1, 1, 1, 1, 0, 0]);
    expect(on!.left).toEqual([2, 1, 1, 1, 1, 1]);
    expect(on!.furthest!.clubId).toBe("C");
  });
});

describe("the funnel", () => {
  const candidate = (more: Partial<HalfCandidate>): HalfCandidate => ({
    game: row("C", "C", "N", "2026-09-12", [3, 5]),
    clubId: "C",
    opponentId: "N",
    kind: "namer",
    daysApart: 0,
    minutesApart: 0,
    inRegion: true,
    levelGap: 0,
    ...more,
  });

  it("settles on the one left at the first step that leaves one", () => {
    const near = candidate({ clubId: "near", levelGap: 1, minutesApart: 30 });
    const dayOff = candidate({ clubId: "dayOff", daysApart: 1, minutesApart: 1440 });
    const far = candidate({ clubId: "far", inRegion: false });
    const through = funnel([far, dayOff, near], HALF_FUNNEL);
    expect(through.left).toEqual([3, 2, 2, 1, 1, 0]);
    expect(funnelEnd(through)).toEqual({ settled: 3, one: near });
  });

  it("keeps a row's only candidate whatever a later step would say of it", () => {
    const only = candidate({ inRegion: false, levelGap: 5, daysApart: 1 });
    expect(funnelEnd(funnel([only], HALF_FUNNEL))).toEqual({ settled: 0, one: only });
  });

  it("is emptied by a step that leaves none of several, and several where every step leaves two", () => {
    const away = candidate({ inRegion: false });
    expect(funnelEnd(funnel([away, away], HALF_FUNNEL))).toEqual({ emptied: 1 });
    const twin = candidate({});
    expect(funnelEnd(funnel([twin, twin], HALF_FUNNEL))).toEqual({ several: true });
    expect(funnelEnd(funnel([], HALF_FUNNEL))).toEqual({ emptied: 0 });
  });

  it("reads levels within two and a page with no level as no disagreement, and no start as one", () => {
    const step = (key: string) => HALF_FUNNEL.find((one) => one.key === key)!;
    expect(step("levels within two").keeps(candidate({ levelGap: 2 }))).toBe(true);
    expect(step("levels within two").keeps(candidate({ levelGap: 3 }))).toBe(false);
    const { levelGap: _gap, ...levelless } = candidate({});
    expect(step("the same level").keeps(levelless)).toBe(true);
    const { minutesApart: _start, ...startless } = candidate({});
    expect(step("starts within the hour").keeps(startless)).toBe(false);
  });
});

describe("the tally", () => {
  it("says where the rows settled beside where the weeks either side did, and on what", () => {
    const games = [
      // Settled at the namer's region: the Flames next door, the Hawks away.
      row("N", "N", "X", "2026-09-12", [5, 3]),
      row("C", "C", "N", "2026-09-12", [3, 5]),
      row("D", "D", "N", "2026-09-12", [3, 5]),
      // Settled on the Flames again, a day off: the only candidate.
      row("N", "N", "X", "2026-09-19", [1, 0]),
      row("C", "C", "N", "2026-09-20", [0, 1]),
      // Nothing anywhere, and two the funnel cannot part.
      row("N", "N", "X", "2026-10-03", [9, 9]),
      row("N", "N", "X", "2026-10-17", [6, 2]),
      row("C", "C", "N", "2026-10-17", [2, 6]),
      row("E", "E", "N", "2026-10-17", [2, 6]),
      // A decoy a week on for the 3 October row: one, settled at once.
      row("E", "E", "N", "2026-10-10", [9, 9]),
    ];
    const search = findHalves(TEAMS, games, levelOf);
    const tally = tallyFunnel(search, TEAMS);
    expect(tally).toEqual({
      rows: 4,
      settled: [1, 1, 0, 0, 0, 0],
      decoySettled: [0.5, 0, 0, 0, 0, 0],
      emptied: 1,
      several: 1,
      decoyEmptied: 3.5,
      decoySeveral: 0,
      kinds: { namer: 2, standIn: 0, other: 0 },
      namesFit: 2,
      shareWord: 2,
      samePage: 2,
      agreeing: 1,
      split: 0,
      agreeingRows: 2,
    });
    // Kept to some rows only, as the stand-ins of one bucket are read.
    expect(
      tallyFunnel(search, TEAMS, HALF_FUNNEL, (one) => one.game.date === "2026-10-03")
    ).toMatchObject({ rows: 1, emptied: 1 });
  });

  it("says when one stand-in's rows settle on two clubs", () => {
    const games = [
      row("N", "N", "X", "2026-09-12", [5, 3]),
      row("D", "D", "N", "2026-09-12", [3, 5]),
      row("N", "N", "X", "2026-09-19", [4, 1]),
      row("C", "C", "N", "2026-09-19", [1, 4]),
    ];
    const tally = tallyFunnel(findHalves(TEAMS, games, levelOf), TEAMS);
    expect(tally).toMatchObject({ agreeing: 0, split: 1, agreeingRows: 0, namesFit: 1 });
  });
});

describe("the funnel where the answer is known", () => {
  /** A game both clubs' schedules list: the Owls' row, and the other club's own row folded in. */
  const pair = (other: string, folded: Partial<FoldedRow>, more: Partial<ScoutGame> = {}) =>
    row("N", "N", other, "2026-09-12", [5, 3], {
      alsoRows: [
        {
          teamId: `gc-${other}`,
          gameId: "theirs",
          startTs: "2026-09-12T14:20:00Z",
          ownScore: 3,
          opponentScore: 5,
          onSideB: true,
          ...folded,
        },
      ],
      ...more,
    });
  // The Hawks' row against a stand-in, the same result: away. The Bats': in the region.
  const hawks = row("D", "D", "Y", "2026-09-12", [3, 5]);
  const bats = row("E", "E", "Y", "2026-09-12", [3, 5]);

  it("settles on the club whose own schedule lists the game, its row held out and put back", () => {
    expect(testKnownPairs(TEAMS, [pair("C", {}), hawks], levelOf)).toEqual({
      pairs: 1,
      notMirrored: 0,
      right: [0, 1, 0, 0, 0, 0],
      wrong: [0, 0, 0, 0, 0, 0],
      emptied: 0,
      several: 0,
    });
  });

  it("is wrong where its own row was dated a day off and another club's was not", () => {
    const off = pair("C", { date: "2026-09-13", startTs: "2026-09-13T14:00:00Z" });
    expect(testKnownPairs(TEAMS, [off, bats], levelOf)).toMatchObject({
      right: [0, 0, 0, 0, 0, 0],
      wrong: [0, 0, 0, 1, 0, 0],
    });
  });

  it("reads the club's level off its own schedule's page", () => {
    // The Flames' schedule is filed a level up; the Bats', on the Owls' own level, the same start.
    const teams = TEAMS.map((team) =>
      team.id === "C"
        ? { ...team, gcTeams: [{ ...team.gcTeams![0]!, ageGroupId: "ag_11u_2027" }] }
        : team
    );
    const sameStart = pair("C", { startTs: "2026-09-12T14:00:00Z" });
    expect(testKnownPairs(teams, [sameStart, bats], levelOf)).toMatchObject({
      wrong: [0, 0, 0, 0, 0, 1],
    });
    expect(testKnownPairs(TEAMS, [sameStart, bats], levelOf)).toMatchObject({ several: 1 });
  });

  it("counts a pair whose results do not mirror, and reads only the pairs kept", () => {
    const apart = pair("C", { ownScore: 4 });
    expect(testKnownPairs(TEAMS, [apart], levelOf)).toMatchObject({ pairs: 1, notMirrored: 1 });
    const claimed = pair("C", { filedAgainst: "X" });
    // Another pair, by another result so the two are not each other's candidates, not claimed.
    const plain = pair("E", { ownScore: 7, opponentScore: 5 }, { teamAScore: 5, teamBScore: 7 });
    expect(
      testKnownPairs(TEAMS, [claimed, plain], levelOf, HALF_FUNNEL, (one) =>
        Boolean(one.filedAgainst)
      )
    ).toMatchObject({ pairs: 1, right: [1, 0, 0, 0, 0, 0] });
    expect(testKnownPairs(TEAMS, [claimed, plain], levelOf)).toMatchObject({
      pairs: 2,
      right: [2, 0, 0, 0, 0, 0],
    });
  });
});

describe("results a run or two apart at the same start", () => {
  const against = row("N", "N", "X", "2026-09-12", [5, 3]);

  it("counts a row whose other club's row at its start is off by a run or two, and by how many", () => {
    const tally = nearScores(
      TEAMS,
      [
        against,
        // The Flames at the same start, 3-4 from their seat: the Owls' 5 read as 4, one run off.
        row("C", "C", "N", "2026-09-12", [3, 4]),
        // The Bats at 4 PM, and the Hawks away, both mirrored exactly: neither read.
        row("E", "E", "Y", "2026-09-12", [3, 5], { startTs: "2026-09-12T16:00:00Z" }),
        row("D", "D", "Y", "2026-09-12", [3, 5]),
        // A week on at the same hour, one off: the chance rate.
        row("E", "E", "Y", "2026-09-19", [3, 6]),
      ],
      levelOf,
      1,
      // The Owls' row only: the Bats' and the Hawks' rows against "Owls Blue" are rows too.
      [(one) => one.namerId === "N"]
    )[0];
    expect(tally).toEqual({
      rows: 1,
      noStart: 0,
      exact: 0,
      near: 1,
      nearOne: 1,
      nearSameWinner: 1,
      far: 0,
      none: 0,
      decoyExact: 0,
      decoyNear: 0.5,
      decoyNearOne: 0.5,
    });
  });

  it("puts an exact mirror first, three runs off apart, a flipped winner apart, and a row with no start aside", () => {
    const read = (games: ScoutGame[], within = 1) =>
      nearScores(TEAMS, games, levelOf, within, [(one) => one.namerId === "N"])[0];
    expect(
      read([
        against,
        row("C", "C", "N", "2026-09-12", [3, 5]),
        row("E", "E", "Y", "2026-09-12", [3, 4]),
      ])
    ).toMatchObject({ exact: 1, near: 0 });
    expect(read([against, row("C", "C", "N", "2026-09-12", [6, 4])])).toMatchObject({ far: 1 });
    // 5-3 read as 5-5 from the other seat: two off, no longer the same winner.
    expect(read([against, row("C", "C", "N", "2026-09-12", [5, 5])])).toMatchObject({
      near: 1,
      nearSameWinner: 0,
    });
    expect(read([noStart(against), row("C", "C", "N", "2026-09-12", [3, 4])])).toMatchObject({
      noStart: 1,
      near: 0,
    });
    // Another squad four levels up is not read.
    expect(
      read([against, row("C", "C", "N", "2026-09-12", [3, 4], { ageGroupId: "ag_14u_2027" })])
    ).toMatchObject({ near: 0, none: 1 });
    // Within the hour, a start forty minutes on is read.
    const later = row("C", "C", "N", "2026-09-12", [3, 4], { startTs: "2026-09-12T14:40:00Z" });
    expect(read([against, later])).toMatchObject({ near: 0, none: 1 });
    expect(read([against, later], 60)).toMatchObject({ near: 1 });
    // Two hours before is outside the hour either way.
    const earlier = row("C", "C", "N", "2026-09-12", [3, 4], { startTs: "2026-09-12T12:00:00Z" });
    expect(read([against, earlier], 60)).toMatchObject({ near: 0, none: 1 });
  });
});

describe("results a run or two apart, groups read in one pass", () => {
  it("tallies each group of rows by its own test", () => {
    const games = [
      row("N", "N", "X", "2026-09-12", [5, 3]),
      row("C", "C", "N", "2026-09-12", [3, 4]),
      row("E", "E", "Y", "2026-09-19", [3, 5]),
    ];
    const [every, owls, none] = nearScores(TEAMS, games, levelOf, 60, [
      () => true,
      (one) => one.namerId === "N",
      () => false,
    ]);
    expect(every).toMatchObject({ rows: 2, near: 1 });
    expect(owls).toMatchObject({ rows: 1, near: 1 });
    expect(none).toMatchObject({ rows: 0, near: 0 });
  });
});

describe("a day moved", () => {
  it("crosses a month and a year, and is nothing for what is not a day", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2027-01-03", -7)).toBe("2026-12-27");
    expect(shiftDay("someday", 1)).toBeUndefined();
  });
});
