import { describe, expect, it } from "vitest";
import { SHIPPED_TIDY_RULES, tidyPool, type GcImportState } from "../gameChangerImport";
import { filedByName, leaningOf, readRules, slotsRead, wrongShare } from "../standInRules";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A small Oklahoma year, as the stand-in rule's own tests have it: Choctaw Mudcats keeps one game
 * on its own schedule, against the Tulsa Drillers; the Edmond Heat and the Norman Storm, who have
 * each played the Drillers too, name the Mudcats for games the Mudcats left off. A Moore club
 * nobody pulled, and a TBD slot the Storm played at noon.
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
  score?: [number, number]
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
  };
};

const pool: GcImportState = {
  ageGroups: groups,
  teams: [mudcats, edmond, norman, tulsa, yukon, named, moore, slot],
  games: [
    row(mudcats, tulsa.id, "2026-09-05", "15:00", [7, 3]),
    row(edmond, tulsa.id, "2026-09-06", "15:00", [2, 1]),
    row(norman, tulsa.id, "2026-09-07", "15:00", [4, 4]),
    row(yukon, moore.id, "2026-09-08", "15:00", [9, 0]),
    row(edmond, named.id, "2026-09-12", "10:00", [2, 9]),
    row(norman, named.id, "2026-09-19", "10:00", [4, 5]),
    row(norman, slot.id, "2026-09-19", "12:00", [1, 0]),
  ],
};

const inState = { inState: { rareAmong: 1, nearLevel: false } };
const tidy = (state: GcImportState, rules: typeof SHIPPED_TIDY_RULES) =>
  tidyPool(state, undefined, undefined, undefined, undefined, rules);

describe("the stand-in rule's measurement", () => {
  it("counts the year's games leaning on a stand-in or a slot", () => {
    expect(leaningOf(pool, 2027)).toEqual({
      games: 7,
      played: 7,
      withStandIn: 4,
      playedWithStandIn: 4,
      withSlot: 1,
      playedWithSlot: 1,
      standIns: 2,
    });
    expect(leaningOf(pool, 2026).games).toBe(0);
  });

  it("asks of each played slot game whether a stand-in's row is at the hour", () => {
    // The Storm's noon TBD is two hours from its game against the stand-in at ten.
    expect(slotsRead(pool, 2027)).toEqual({ played: 1, timed: 1, standInAtTheHour: 0 });
    const atTen = {
      ...pool,
      games: pool.games.map((game) =>
        game.teamBId === slot.id ? { ...game, startTs: "2026-09-19T10:30:00.000Z" } : game
      ),
    };
    expect(slotsRead(atTen, 2027).standInAtTheHour).toBe(1);
  });

  it("reads the rows already filed by name between neighbours", () => {
    // The Heat's 2-1 over the Drillers is on the Heat's schedule alone: filed by name, and the two
    // have met. The Millers' 9-0 is against a club nobody pulled, so it is not a row filed by name.
    const filed = filedByName(pool, 2027);
    expect(filed).toEqual({ rows: 3, near: 3 });
    // A game the Drillers' own schedule holds too is theirs to say, not a name's.
    const both = {
      ...row(edmond, tulsa.id, "2026-09-20", "15:00", [3, 2]),
      alsoFrom: ["gcTULSA00001"],
    };
    expect(filedByName({ ...pool, games: [...pool.games, both] }, 2027)).toEqual(filed);
  });

  it("reads the rows a rule files, and a decoy for each", () => {
    const shipped = readRules(pool, 2027, "shipped", SHIPPED_TIDY_RULES, tidy);
    expect(shipped.moved.rows).toBe(0);
    const reading = readRules(pool, 2027, "inState", inState, tidy, 25, () => 0);
    expect(reading.refiled).toBe(2);
    // Both rows' namers share the Drillers with the Mudcats.
    expect(reading.moved).toEqual({ rows: 2, near: 2 });
    // The decoys, other Oklahoma clubs on the page: neighbours of the namer where they share an
    // opponent, the Drillers or each other, not the Millers.
    expect(reading.decoy.rows).toBe(2);
    expect(reading.after.withStandIn).toBe(2);
    expect(reading.after.standIns).toBe(1);
    expect(reading.seconds).toBe(0);
    expect(reading.sample.every((one) => one.club === "Choctaw Mudcats")).toBe(true);
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
