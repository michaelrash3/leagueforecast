import { describe, expect, it } from "vitest";
import { byGameTimeNewest } from "../date";
import {
  buildUpcomingSchedule,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  type ScoutGame,
  type ScoutRankingRow,
} from "../teamRankings";
import type { Matchup } from "../types";

/*
 * A League Standings game's start, carried into Team Rankings (`Matchup.startTs`, data schema 9),
 * where every list of games is in the order they are played. League games arrived with no start,
 * and where the league's scored row stood in for a pulled copy, the copy's start went with the copy:
 * a league doubleheader listed its second game first, and the My Team card could name the later
 * game as next. Placeholder names.
 */
const AT_THREE = "2026-11-07T15:00:00.000Z";
const AT_SIX = "2026-11-07T18:00:00.000Z";

describe("a League Standings game's start in Team Rankings", () => {
  it("comes with the game, so a doubleheader stored late game first is in playing order", () => {
    const matchups: Matchup[] = [
      { id: "m2", date: "11/7", away: "t1", home: "t2", startTs: AT_SIX },
      { id: "m1", date: "11/7", away: "t2", home: "t1", startTs: AT_THREE },
    ];
    const derived = deriveLeagueScoutGames(
      "ag10",
      [
        {
          seasonId: "sea",
          teams: [
            { id: "t1", name: "Aces" },
            { id: "t2", name: "Bees" },
          ],
          matchups,
          logs: {},
        },
      ],
      [],
      2027
    );
    expect(derived.games.map((game) => [game.id, game.startTs])).toEqual([
      ["league_sea_m2", AT_SIX],
      ["league_sea_m1", AT_THREE],
    ]);
    const aces = derived.teams.find((team) => team.name === "Aces")!.id;
    const bees = derived.teams.find((team) => team.name === "Bees")!.id;
    const row = (teamId: string, teamName: string) =>
      ({ teamId, teamName, rank: 1, rating: 0, componentId: "x" }) as ScoutRankingRow;
    const upcoming = buildUpcomingSchedule(
      aces,
      [row(aces, "Aces"), row(bees, "Bees")],
      derived.games,
      derived.teams,
      "2026-10-30"
    );
    expect(upcoming.map((game) => game.gameId)).toEqual(["league_sea_m1", "league_sea_m2"]);
  });

  const league = (id: string, a: number, b: number, more: Partial<ScoutGame> = {}): ScoutGame => ({
    id: `league_sea_${id}`,
    teamAId: "A",
    teamBId: "B",
    ageGroupId: "ag10",
    date: "2026-11-07",
    teamAScore: a,
    teamBScore: b,
    ...more,
  });
  const copy = (id: string, startTs: string, a: number, b: number): ScoutGame => ({
    id: `gc_gcA_${id}`,
    teamAId: "A",
    teamBId: "B",
    ageGroupId: "ag10",
    date: "2026-11-07",
    startTs,
    teamAScore: a,
    teamBScore: b,
    source: { kind: "gamechanger", teamId: "gcA", gameId: id },
  });

  it("is kept from the pulled copy a scored league row stands in for, by the copy with its score", () => {
    // A doubleheader the league typed with no starts: the Aces won the first 5-1 at 3 PM UTC and
    // lost the second 2-6 at 6 PM, and the club's own pull has both. The league's book is the one
    // kept, so the copies go, and each of the league's rows takes the start of its own.
    const kept = dedupeLeagueFixtures([
      league("m1", 5, 1),
      league("m2", 2, 6),
      copy("g1", AT_THREE, 5, 1),
      copy("g2", AT_SIX, 2, 6),
    ]);
    expect(kept.map((game) => [game.id, game.startTs])).toEqual([
      ["league_sea_m1", AT_THREE],
      ["league_sea_m2", AT_SIX],
    ]);
    // Newest first, as a club's list reads, the late game is first.
    expect([...kept].sort(byGameTimeNewest).map((game) => game.id)).toEqual([
      "league_sea_m2",
      "league_sea_m1",
    ]);
  });

  it("keeps a league row's own start, and gives none where the copies cannot be told apart", () => {
    // The league's own start stands; a copy at another minute does not move it.
    const own = dedupeLeagueFixtures([
      league("m1", 5, 1, { startTs: AT_SIX }),
      copy("g1", AT_THREE, 5, 1),
    ]);
    expect(own.map((game) => game.startTs)).toEqual([AT_SIX]);
    // Both games won 5-1: which copy is which game is not for a guess, so neither takes a start.
    const twins = dedupeLeagueFixtures([
      league("m1", 5, 1),
      league("m2", 5, 1),
      copy("g1", AT_THREE, 5, 1),
      copy("g2", AT_SIX, 5, 1),
    ]);
    expect(twins.map((game) => game.startTs)).toEqual([undefined, undefined]);
    // A copy giving another score is not the league row's game as far as a start goes.
    const apart = dedupeLeagueFixtures([league("m1", 5, 1), copy("g1", AT_THREE, 4, 1)]);
    expect(apart.map((game) => [game.id, game.startTs])).toEqual([["league_sea_m1", undefined]]);
    // Two copies of one game, from both clubs' pulls, at the same minute: one start, given.
    const both = dedupeLeagueFixtures([
      league("m1", 5, 1),
      copy("g1", AT_THREE, 5, 1),
      {
        ...copy("g9", "2026-11-07T15:00:20.000Z", 1, 5),
        teamAId: "B",
        teamBId: "A",
        source: { kind: "gamechanger", teamId: "gcB", gameId: "g9" },
      },
    ]);
    expect(both.map((game) => [game.id, game.startTs])).toEqual([["league_sea_m1", AT_THREE]]);
  });
});
