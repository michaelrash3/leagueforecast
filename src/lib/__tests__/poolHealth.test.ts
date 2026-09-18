import { describe, expect, it } from "vitest";
import { poolHealth, settleableNow } from "../poolHealth";
import { poolSignature, type GcImportState } from "../gameChangerImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const group: AgeGroup = { id: "ag_1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] };

const team = (id: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name: `Team ${id}`,
  ...extra,
});

const game = (id: string, a: string, b: string, extra: Partial<ScoutGame> = {}): ScoutGame => ({
  id,
  ageGroupId: "ag_1",
  teamAId: a,
  teamBId: b,
  date: "2026-08-22",
  ...extra,
});

const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
  ageGroups: [group],
  teams,
  games,
});

describe("what state the pool is in", () => {
  it("tells a club from a stand-in", () => {
    const health = poolHealth(
      pool(
        [
          team("A"),
          team("B"),
          team("TBD", { placeholder: true }),
          team("HEARD", { nameOnly: true }),
        ],
        []
      ),
      ""
    );
    expect(health).toMatchObject({ teams: 4, clubs: 2, placeholders: 1, nameOnly: 1 });
  });

  it("counts the games still filed against a stand-in", () => {
    const health = poolHealth(
      pool(
        [team("A"), team("B"), team("TBD", { placeholder: true })],
        [
          game("g1", "A", "B", { teamAScore: 5, teamBScore: 1 }),
          game("g2", "A", "TBD", { teamAScore: 7, teamBScore: 2 }),
          game("g3", "B", "TBD"),
        ]
      ),
      ""
    );
    // Two of the three touch a stand-in; only one of those has a result worth settling.
    expect(health).toMatchObject({ games: 3, standInGames: 2, standInPlayed: 1, played: 2 });
  });

  it("does not count a game between two stand-ins, which nothing can settle", () => {
    const health = poolHealth(
      pool(
        [team("X", { placeholder: true }), team("Y", { nameOnly: true })],
        [game("g1", "X", "Y", { teamAScore: 3, teamBScore: 2 })]
      ),
      ""
    );
    expect(health.standInGames).toBe(0);
  });

  it("counts the games no squad year can hold", () => {
    const health = poolHealth(
      pool([team("A"), team("B")], [game("g1", "A", "B", { date: "" })]),
      ""
    );
    expect(health.undated).toBe(1);
  });

  it("says whether the pool is in the shape the tidy left it", () => {
    const state = pool([team("A"), team("B")], [game("g1", "A", "B")]);
    expect(poolHealth(state, poolSignature(state)).tidied).toBe(true);
    expect(poolHealth(state, "something else").tidied).toBe(false);
  });
});

describe("what a tidy would settle", () => {
  /** One club's schedule names the opponent; the other's posted it as a stand-in, same score. */
  const settleable = (): GcImportState =>
    pool(
      [team("HOME"), team("AWAY"), team("TBD", { placeholder: true })],
      [
        game("named", "HOME", "AWAY", {
          teamAScore: 6,
          teamBScore: 2,
          source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
        }),
        game("slot", "AWAY", "TBD", {
          teamAScore: 2,
          teamBScore: 6,
          source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
        }),
      ]
    );

  it("counts one that the other side already names", () => {
    expect(settleableNow(settleable())).toBe(1);
  });

  it("counts none when there is nothing to settle", () => {
    const state = pool(
      [team("A"), team("B")],
      [game("g1", "A", "B", { teamAScore: 1, teamBScore: 0 })]
    );
    expect(settleableNow(state)).toBe(0);
  });

  it("leaves the pool exactly as it found it", () => {
    const state = settleable();
    const before = poolSignature(state);
    settleableNow(state);
    // It answers "is there work waiting" without doing the work.
    expect(poolSignature(state)).toBe(before);
  });
});

describe("results dated after today", () => {
  it("counts a scored game on a day that has not happened, and only that", () => {
    const health = poolHealth(
      pool(
        [team("A"), team("B")],
        [
          game("ahead", "A", "B", { date: "2026-12-01", teamAScore: 5, teamBScore: 2 }),
          game("fixture", "A", "B", { date: "2026-12-01" }),
          game("today", "A", "B", { date: "2026-09-18", teamAScore: 3, teamBScore: 1 }),
          game("past", "A", "B", { date: "2026-09-01", teamAScore: 3, teamBScore: 1 }),
        ]
      ),
      "",
      "2026-09-18"
    );
    expect(health.futureDated).toBe(1);
    expect(health.played).toBe(3);
  });
});
