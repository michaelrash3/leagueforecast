import { describe, expect, it } from "vitest";
import { byGameTimeNewest } from "../date";
import {
  buildUpcomingSchedule,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  leagueStandIns,
  offClubIdFor,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
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

  it("gives none to two league games of one score, though only one game's copy is in the pool", () => {
    // Both games won 10-0, and only the first game's copy pulled: it is one of the two, and which
    // is no guess to make, so neither takes its start.
    const one = dedupeLeagueFixtures([
      league("m1", 10, 0),
      league("m2", 10, 0),
      copy("g1", AT_THREE, 10, 0),
    ]);
    expect(one.map((game) => [game.id, game.startTs])).toEqual([
      ["league_sea_m1", undefined],
      ["league_sea_m2", undefined],
    ]);
    // Nor where the other game has a start of its own: the copy at that start may well be that
    // game's.
    const timedTwin = dedupeLeagueFixtures([
      league("m1", 10, 0, { startTs: AT_THREE }),
      league("m2", 10, 0),
      copy("g1", AT_THREE, 10, 0),
    ]);
    expect(timedTwin.map((game) => game.startTs)).toEqual([AT_THREE, undefined]);
  });

  it("tells a doubleheader split 5-1 and 1-5 apart by who won", () => {
    // The Aces won the first and lost the second by the same runs. Read lower score first, the two
    // were one score, and the second game's copy gave both games its start.
    const split = [league("m1", 5, 1), league("m2", 1, 5)];
    const second = dedupeLeagueFixtures([...split, copy("g2", AT_SIX, 1, 5)]);
    expect(second.map((game) => [game.id, game.startTs])).toEqual([
      ["league_sea_m1", undefined],
      ["league_sea_m2", AT_SIX],
    ]);
    // With both copies, each game takes its own, the second's filed from the Bears' seat.
    const both = dedupeLeagueFixtures([
      ...split,
      copy("g1", AT_THREE, 5, 1),
      {
        ...copy("g9", AT_SIX, 5, 1),
        teamAId: "B",
        teamBId: "A",
        source: { kind: "gamechanger", teamId: "gcB", gameId: "g9" },
      },
    ]);
    expect(both.map((game) => [game.id, game.startTs])).toEqual([
      ["league_sea_m1", AT_THREE],
      ["league_sea_m2", AT_SIX],
    ]);
  });

  describe("from a club's own copy filed against a slot", () => {
    const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
      id,
      name,
      gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9" }],
    });
    const roster = leagueStandIns([
      pulled("S-ACES", "Aces", "gcACES"),
      pulled("S-BEAR", "Bears", "gcBEAR"),
      { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
    ]);
    const row = (id: string, a: string, b: string, more: Partial<ScoutGame> = {}): ScoutGame => ({
      id,
      ageGroupId: "ag9",
      teamAId: a,
      teamBId: b,
      date: "2026-09-25",
      teamAScore: 0,
      teamBScore: 13,
      ...more,
    });
    const slotCopy = (id: string, club: string, startTs: string, gc: string) =>
      row(id, club, "S-TBD", {
        ...(club === "S-BEAR" ? { teamAScore: 13, teamBScore: 0 } : {}),
        startTs,
        source: { kind: "gamechanger", teamId: gc, gameId: id },
      });
    const AT_SEVEN = "2026-09-25T23:15:00.000Z";

    it("takes the copy's start onto the league row it folds into", () => {
      // The Aces' schedule was never told the opponent: its copy of the league's 0-13 loss to the
      // Bears is filed against the 7:15 PM slot, and the league row it folds into takes the time.
      const kept = dedupeLeagueFixtures(
        [
          row("league_default_m7", "S-ACES", "S-BEAR"),
          slotCopy("gc_1", "S-ACES", AT_SEVEN, "gcACES"),
        ],
        roster
      );
      expect(kept.map((game) => [game.id, game.startTs])).toEqual([
        ["league_default_m7", AT_SEVEN],
      ]);
    });

    it("leaves a league row's own start, and gives none where two copies start apart", () => {
      const own = dedupeLeagueFixtures(
        [
          row("league_default_m7", "S-ACES", "S-BEAR", { startTs: AT_SEVEN }),
          slotCopy("gc_1", "S-ACES", "2026-09-25T23:45:00.000Z", "gcACES"),
        ],
        roster
      );
      expect(own.map((game) => [game.id, game.startTs])).toEqual([["league_default_m7", AT_SEVEN]]);
      // Each club's schedule has its own copy against the slot, half an hour apart.
      const apart = dedupeLeagueFixtures(
        [
          row("league_default_m7", "S-ACES", "S-BEAR"),
          slotCopy("gc_1", "S-ACES", AT_SEVEN, "gcACES"),
          slotCopy("gc_2", "S-BEAR", "2026-09-25T23:45:00.000Z", "gcBEAR"),
        ],
        roster
      );
      expect(apart.map((game) => [game.id, game.startTs])).toEqual([
        ["league_default_m7", undefined],
      ]);
    });

    it("gives it to the league's game on each page of the year that claims the season", () => {
      // One game read off two pages of one squad year is one fit, and takes the time on both.
      const oneYear = { ...roster, poolOf: () => "2027" };
      const kept = dedupeLeagueFixtures(
        [
          row("league_default_m7", "S-ACES", "S-BEAR"),
          row("league_default_m7", "S-ACES", "S-BEAR", { ageGroupId: "ag10" }),
          slotCopy("gc_1", "S-ACES", AT_SEVEN, "gcACES"),
        ],
        oneYear
      );
      expect(kept.map((game) => [game.ageGroupId, game.startTs])).toEqual([
        ["ag9", AT_SEVEN],
        ["ag10", AT_SEVEN],
      ]);
    });
  });

  it("is kept from a copy that named the other team by a club of its name", () => {
    // The Comets were said not to be in Team Rankings, so the league's row names a club made for
    // them. The Aces' copy names a club the pull filed under the Comets' name, which sorts before
    // the Aces where the club made for them sorts after: read by the ids as they stand, the copy's
    // 5-1 came out 1-5, another score, and the row kept no start.
    const comets = offClubIdFor("Comets");
    const teams: ScoutTeam[] = [
      {
        id: "S-ACES",
        name: "Aces",
        gcTeams: [{ teamId: "gcA", name: "Aces", ageGroupId: "ag10" }],
      },
      { id: "S-AAA", name: "Comets", nameOnly: true },
      { id: comets, name: "Comets" },
    ];
    const kept = dedupeLeagueFixtures(
      [
        { ...league("m1", 5, 1), teamAId: "S-ACES", teamBId: comets },
        { ...copy("g1", AT_THREE, 5, 1), teamAId: "S-ACES", teamBId: "S-AAA" },
      ],
      leagueStandIns(teams)
    );
    expect(kept.map((game) => [game.id, game.startTs])).toEqual([["league_sea_m1", AT_THREE]]);
  });
});
