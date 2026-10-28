import { describe, expect, it } from "vitest";
import {
  DAY_CHECK_TIDY_RULES,
  IN_STATE_TIDY_RULES,
  ONE_NAMESAKE_TIDY_RULES,
  SHIPPED_TIDY_RULES,
  tidyPool,
  type GcImportState,
  type TidyRules,
} from "../gameChangerImport";
import {
  filedByName,
  fittedJoinsOf,
  leaningOf,
  readingWrongShare,
  readRules,
  withSlotRowsMoved,
  wrongShare,
} from "../standInRules";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A small Oklahoma year, as the stand-in rule's own tests have it: the Tulsa Drillers' own schedule
 * holds a game against each of Choctaw Mudcats, the Edmond Heat and the Norman Storm, as theirs do;
 * the Heat and the Storm name the Mudcats for games the Mudcats left off. The Heat's schedule alone
 * has the Storm and the Yukon Millers, whose own schedule has only a Moore club nobody pulled. And a
 * TBD slot the Storm played at noon.
 */
const groups: AgeGroup[] = [{ id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 }];
const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
  id,
  name,
  state: "OK",
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9", ageLevel: 9 }],
});
const mudcats = pulled("S-MUDC", "Choctaw Mudcats", "gcMUDCATS001");
const edmond = pulled("S-EDMO", "Edmond Heat", "gcEDMOND0001");
const norman = pulled("S-NORM", "Norman Storm", "gcNORMAN0001");
const tulsa = pulled("S-TULS", "Tulsa Drillers", "gcTULSA00001");
const yukon = pulled("S-YUKO", "Yukon Millers", "gcYUKON00001");
const named: ScoutTeam = { id: "S-MUDC2", name: "Choctaw Mudcats", nameOnly: true };
const moore: ScoutTeam = { id: "S-MOOR", name: "Moore Stars", nameOnly: true };
const slot: ScoutTeam = { id: "S-TBD", name: "TBD", placeholder: true };

const row = (
  club: ScoutTeam,
  against: string,
  date: string,
  clock: string,
  score?: [number, number],
  alsoFrom?: string[]
): ScoutGame => {
  const gcId = club.gcTeams![0]!.teamId;
  return {
    id: `gc_${gcId}_${date}_${clock}`,
    teamAId: club.id,
    teamBId: against,
    ageGroupId: "ag9",
    date,
    startTs: `${date}T${clock}:00.000Z`,
    source: { kind: "gamechanger", teamId: gcId, gameId: `${date}_${clock}` },
    ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
    ...(alsoFrom ? { alsoFrom } : {}),
  };
};
const tulsaToo = ["gcTULSA00001"];

const pool: GcImportState = {
  ageGroups: groups,
  teams: [mudcats, edmond, norman, tulsa, yukon, named, moore, slot],
  games: [
    row(mudcats, tulsa.id, "2026-09-05", "15:00", [7, 3], tulsaToo),
    row(edmond, tulsa.id, "2026-09-06", "15:00", [2, 1], tulsaToo),
    row(norman, tulsa.id, "2026-09-07", "15:00", [4, 4], tulsaToo),
    row(yukon, moore.id, "2026-09-08", "15:00", [9, 0]),
    row(edmond, named.id, "2026-09-12", "10:00", [2, 9]),
    row(norman, named.id, "2026-09-19", "10:00", [4, 5]),
    row(norman, slot.id, "2026-09-19", "12:00", [1, 0]),
    row(edmond, norman.id, "2026-09-26", "15:00", [5, 1]),
    row(edmond, yukon.id, "2026-09-27", "15:00", [8, 2]),
  ],
};

const inState: TidyRules = { inState: { rareAmong: 1, nearLevel: false, vouched: false } };
const tidy = (state: GcImportState, rules: TidyRules) =>
  tidyPool(state, undefined, undefined, undefined, undefined, rules);

describe("the stand-in rule's measurement", () => {
  it("counts the year's games leaning on a stand-in or a slot", () => {
    expect(leaningOf(pool, 2027)).toEqual({
      games: 9,
      played: 9,
      withStandIn: 4,
      playedWithStandIn: 4,
      withSlot: 1,
      playedWithSlot: 1,
      standIns: 2,
    });
    expect(leaningOf(pool, 2026).games).toBe(0);
  });

  it("reads the rows already filed by name between neighbours by their own schedules", () => {
    // The Heat's games against the Storm and the Millers are on the Heat's schedule alone: filed by
    // name. The Heat and the Storm have each played the Drillers on their own; nothing of the
    // Millers' own is against a pulled club. The games against the Drillers are on the Drillers'
    // schedule too, and the Millers' 9-0 is against a club nobody pulled: neither is filed by name.
    const filed = filedByName(pool, 2027);
    expect(filed).toEqual({ rows: 2, near: 1 });
    // A game the Drillers' own schedule holds too is theirs to say, not a name's.
    const both = {
      ...row(edmond, tulsa.id, "2026-09-20", "15:00", [3, 2]),
      alsoFrom: ["gcTULSA00001"],
    };
    expect(filedByName({ ...pool, games: [...pool.games, both] }, 2027)).toEqual(filed);
  });

  it("reads the rows a rule files, and a decoy for each", () => {
    // The day check files neither row onto the Mudcats, and takes the Heat's games against the
    // Storm and the Millers off them, neither club having a game of its own those days.
    const dayCheck = readRules(pool, 2027, "day-check", DAY_CHECK_TIDY_RULES, tidy);
    expect(dayCheck.moved.rows).toBe(0);
    expect(dayCheck.after.standIns).toBe(4);
    const reading = readRules(pool, 2027, "inState", inState, tidy, 25, () => 0);
    expect(reading.refiled).toBe(2);
    // Both rows' namers have played the Drillers, as the Mudcats have.
    expect(reading.moved).toEqual({ rows: 2, near: 2 });
    // A decoy for each: another Oklahoma club on the page.
    expect(reading.decoy.rows).toBe(2);
    // Left on stand-ins: the Millers' game against Moore, and the slot.
    expect(reading.after.withStandIn).toBe(2);
    expect(reading.after.standIns).toBe(1);
    expect(reading.seconds).toBe(0);
    expect(reading.sample.every((one) => one.club === "Choctaw Mudcats")).toBe(true);
    // As it shipped on 27 October 2026: the same two rows, and the Heat's game against the Millers,
    // whom nothing of the Heat's own vouches for, taken off them onto a stand-in of the name.
    const inStateShipped = readRules(pool, 2027, "in-state", IN_STATE_TIDY_RULES, tidy);
    expect(inStateShipped.moved).toEqual({ rows: 2, near: 2 });
    expect(inStateShipped.after.withStandIn).toBe(3);
    expect(inStateShipped.after.standIns).toBe(2);
    // As it ships since rules 34: the Millers are the one pulled club of the name near the Heat, so
    // the game stays on them (`oneNamesake`).
    const shipped = readRules(pool, 2027, "shipped", SHIPPED_TIDY_RULES, tidy);
    expect(shipped.moved).toEqual({ rows: 2, near: 2 });
    expect(shipped.after.withStandIn).toBe(2);
    expect(shipped.after.standIns).toBe(1);
  });

  it("reads no wrong share for a rule that chose its rows for being neighbours", () => {
    // Codex on #471: the rule as it ships files a row only where the clubs are neighbours, so its
    // rows are neighbours every time, and the share read from that rate would say none are wrong.
    const right = { rows: 10, near: 8 };
    const shipped = readRules(pool, 2027, "in-state", IN_STATE_TIDY_RULES, tidy);
    expect(shipped.selectedOnNeighbours).toBe(true);
    expect(wrongShare(shipped.moved, { rows: 10, near: 1 }, right)).toBe(0);
    expect(readingWrongShare({ ...shipped, decoy: { rows: 10, near: 1 } }, right)).toBeNull();
    const nameAlone = readRules(pool, 2027, "inState", inState, tidy);
    expect(nameAlone.selectedOnNeighbours).toBe(false);
    const decoys = { ...nameAlone, decoy: { rows: 2, near: 1 } };
    expect(readingWrongShare(decoys, right)).toBe(wrongShare(decoys.moved, decoys.decoy, right));
  });

  it("reads the wrong share between the right rows' rate and the decoys'", () => {
    const right = { rows: 100, near: 80 };
    const decoy = { rows: 100, near: 20 };
    expect(wrongShare({ rows: 100, near: 70 }, decoy, right)).toBeCloseTo(1 / 6, 10);
    expect(wrongShare({ rows: 100, near: 90 }, decoy, right)).toBe(0);
    expect(wrongShare({ rows: 100, near: 10 }, decoy, right)).toBe(1);
    expect(wrongShare({ rows: 100, near: 70 }, { rows: 100, near: 80 }, right)).toBeNull();
    expect(wrongShare({ rows: 0, near: 0 }, decoy, right)).toBeNull();
  });
});

describe("the fitted namesake join, measured against its slot rows a week off", () => {
  const nine = (id: string, name: string, state: string): ScoutTeam => ({
    id,
    name,
    state,
    gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag9", ageLevel: 9 }],
  });
  const at = (
    club: string,
    gameId: string,
    against: string,
    start: string,
    score: [number, number]
  ) => ({
    id: `gc_gc${club}_${gameId}`,
    teamAId: club,
    teamBId: against,
    teamAScore: score[0],
    teamBScore: score[1],
    ageGroupId: "ag9",
    date: start.slice(0, 10),
    startTs: start,
    source: { kind: "gamechanger" as const, teamId: `gc${club}`, gameId },
  });
  const state: GcImportState = {
    ageGroups: groups,
    teams: [
      nine("OTTERS", "Otters", "KY"),
      nine("COMETS", "Riverside Comets", "OH"),
      { id: "S-OTTERS", name: "Northern Kentucky Otters", nameOnly: true },
      { id: "TBD-1", name: "TBD", placeholder: true },
    ],
    games: [
      at("COMETS", "c1", "S-OTTERS", "2026-10-25T14:30:00.000Z", [11, 4]),
      at("OTTERS", "o1", "TBD-1", "2026-10-25T14:30:00.000Z", [4, 11]),
    ],
  };
  const near = (a: string | undefined, b: string | undefined) =>
    a === b || a === "KY" || b === "KY";

  it("moves every row against a slot, its date and its start, and nothing else", () => {
    const moved = withSlotRowsMoved(state, -7);
    expect(moved.games[0]).toBe(state.games[0]);
    expect(moved.games[1]).toMatchObject({
      date: "2026-10-18",
      startTs: "2026-10-18T14:30:00.000Z",
    });
    expect(withSlotRowsMoved(state, 0)).toBe(state);
  });

  it("counts the joins the reading adds, on the day and none a week off", () => {
    const counted = fittedJoinsOf(
      state,
      SHIPPED_TIDY_RULES,
      ONE_NAMESAKE_TIDY_RULES,
      new Set(),
      near,
      5
    );
    expect(counted).toMatchObject({ joined: 1, near: 1 });
    expect(counted.sample).toEqual(
      [
        {
          namer: "Riverside Comets",
          name: "Northern Kentucky Otters",
          club: "Otters",
          states: "OH-KY",
          score: "11-4",
        },
      ].slice(0, counted.sample.length)
    );
    expect(
      fittedJoinsOf(
        withSlotRowsMoved(state, 7),
        SHIPPED_TIDY_RULES,
        ONE_NAMESAKE_TIDY_RULES,
        new Set(),
        near
      ).joined
    ).toBe(0);
    expect(
      fittedJoinsOf(state, ONE_NAMESAKE_TIDY_RULES, ONE_NAMESAKE_TIDY_RULES, new Set(), near).joined
    ).toBe(0);
  });
});
