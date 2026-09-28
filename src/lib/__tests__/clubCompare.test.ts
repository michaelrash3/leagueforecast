import { describe, expect, it } from "vitest";
import { compareClubs } from "../clubCompare";
import type { ScoutGame, ScoutRankingRow } from "../teamRankings";

const played = (id: string, a: string, b: string, sa: number, sb: number, date: string) =>
  ({
    id,
    ageGroupId: "ag",
    teamAId: a,
    teamBId: b,
    teamAScore: sa,
    teamBScore: sb,
    date,
  }) as ScoutGame;
const rows = ["US", "THEM", "BEARS", "CUBS", "OWLS"].map(
  (teamId, at) => ({ teamId, teamName: teamId, rank: at + 1 }) as ScoutRankingRow
);
const nameOf = (id: string) => id.charAt(0) + id.slice(1).toLowerCase();

const games = [
  played("h1", "US", "THEM", 4, 6, "2026-09-05"),
  played("u1", "US", "BEARS", 8, 3, "2026-09-06"),
  played("t1", "BEARS", "THEM", 5, 6, "2026-09-07"),
  played("u2", "CUBS", "US", 2, 1, "2026-09-12"),
  played("t2", "THEM", "CUBS", 9, 0, "2026-09-13"),
  played("u3", "US", "OWLS", 10, 0, "2026-09-14"),
  played("u4", "US", "NOBODY", 3, 7, "2026-09-15"),
  // Not counted on this board: left out everywhere.
  played("x1", "US", "BEARS", 0, 20, "2026-09-20"),
];
const counts = (game: ScoutGame) => game.id !== "x1";

describe("two clubs side by side", () => {
  const compared = compareClubs("US", "THEM", games, rows, nameOf, counts);

  it("lists their meetings from the first club's side", () => {
    expect(compared.headToHead.map((r) => [r.gameId, r.runsFor, r.runsAgainst])).toEqual([
      ["h1", 4, 6],
    ]);
  });

  it("puts each club's score against the clubs both have played, best-ranked first", () => {
    expect(
      compared.common.map((c) => [
        c.opponentName,
        c.a.map((r) => r.margin),
        c.b.map((r) => r.margin),
      ])
    ).toEqual([
      ["Bears", [5], [1]],
      ["Cubs", [-1], [9]],
    ]);
  });

  it("gives each side its best wins by who they beat, and its worst losses", () => {
    expect(compared.a.bestWins.map((r) => r.opponentId)).toEqual(["BEARS", "OWLS"]);
    // An unranked opponent is the worst loss of all.
    expect(compared.a.worstLosses.map((r) => r.opponentId)).toEqual(["NOBODY", "CUBS", "THEM"]);
    expect(compared.b.bestWins.map((r) => r.opponentId)).toEqual(["US", "BEARS", "CUBS"]);
  });

  it("gives each side its latest results, newest first, and only what the board counts", () => {
    expect(compared.a.lastFive.map((r) => r.gameId)).toEqual(["u4", "u3", "u2", "u1", "h1"]);
  });

  it("reads each side's score as its own schedule gave it", () => {
    const disputed = { ...games[0]!, reportedByB: { teamAScore: 4, teamBScore: 7 } } as ScoutGame;
    const both = compareClubs("US", "THEM", [disputed], rows, nameOf, () => true);
    expect(both.headToHead[0]?.runsAgainst).toBe(6);
    expect(both.b.lastFive[0]?.runsFor).toBe(7);
  });
});
