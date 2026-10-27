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

  it("keeps two results of one day in the order the games are given, as a club's panel does", () => {
    // Ids that sort the other way round: the order is the list's, not the ids'.
    const sameDay = [
      played("z9", "US", "BEARS", 5, 1, "2026-09-20"),
      played("a1", "US", "CUBS", 3, 2, "2026-09-20"),
    ];
    const both = compareClubs("US", "THEM", sameDay, rows, nameOf, () => true);
    expect(both.a.lastFive.map((r) => r.gameId)).toEqual(["z9", "a1"]);
    const reversed = compareClubs("US", "THEM", [...sameDay].reverse(), rows, nameOf, () => true);
    expect(reversed.a.lastFive.map((r) => r.gameId)).toEqual(["a1", "z9"]);
  });

  it("reads each side's score as its own schedule gave it", () => {
    const disputed = { ...games[0]!, reportedByB: { teamAScore: 4, teamBScore: 7 } } as ScoutGame;
    const both = compareClubs("US", "THEM", [disputed], rows, nameOf, () => true);
    expect(both.headToHead[0]?.runsAgainst).toBe(6);
    expect(both.b.lastFive[0]?.runsFor).toBe(7);
  });
});

describe("each club's profile, its record by the strength of who it played, and its form", () => {
  // Ratings for the split: US at 2, the others above, near and below it.
  const rated = rows.map((row) => ({
    ...row,
    rating: { US: 2, THEM: 4, BEARS: 0, CUBS: 2.5, OWLS: -5 }[row.teamId] ?? 0,
  }));
  const compared = compareClubs("US", "THEM", games, rated, nameOf, counts);

  it("gives runs scored and allowed a game, and the margin, over the games counted", () => {
    // 4-6, 8-3, 1-2, 10-0 and 3-7: the game not counted is left out.
    expect(compared.a.profile).toEqual({ games: 5, runsFor: 5.2, runsAgainst: 3.6, margin: 1.6 });
  });

  it("splits the record by opponents rated above, near and below the club", () => {
    // THEM (+2) is stronger, CUBS (+0.5) similar, BEARS (-2) and OWLS (-7) weaker; NOBODY has no
    // rating on the board and is in none of the three.
    expect(compared.a.split).toEqual({
      stronger: { wins: 0, losses: 1, ties: 0 },
      similar: { wins: 0, losses: 1, ties: 0 },
      weaker: { wins: 2, losses: 0, ties: 0 },
    });
    // A club with no rating has nothing to measure its opponents by.
    expect(compareClubs("NOBODY", "US", games, rated, nameOf, counts).a.split).toBeNull();
  });

  it("gives the last five as letters, newest first", () => {
    expect(compared.a.form).toBe("LWLWL");
    // The Cubs lost to THEM on the 13th after beating US on the 12th.
    expect(compareClubs("CUBS", "US", games, rated, nameOf, counts).a.form).toBe("LW");
  });

  it("says how much better the first did against the clubs both played, on average", () => {
    // Bears: +5 against +1, four better; Cubs: -1 against +9, ten worse. Three worse on average.
    expect(compared.commonEdge).toBe(-3);
    // The Owls played no one but US.
    expect(compareClubs("US", "OWLS", games, rated, nameOf, counts).commonEdge).toBeNull();
  });
});
