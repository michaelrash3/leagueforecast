import { describe, expect, it } from "vitest";
import {
  countsTowardRating,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  leagueScoutBridge,
  type AgeGroup,
  type LeagueSeasonSnapshot,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

/*
 * A league's games are carried into Team Rankings under the clubs Settings links its teams to, not
 * under whichever club of that name the nationwide roster happens to list first.
 *
 * The shape is the real one. A Cincinnati 9U league has "Cincinnati Angels- Red"; the roster has
 * an 11U "Cincinnati Angels Red" ahead of the 9U club, because it was pulled first. By name the
 * league's game went to the 11U club, while the Trash Pandas' own pull had the same game against
 * the 9U one — two pairs of ids, so the duplicate check could not see one fixture, and the Trash
 * Pandas were 0-7 against GameChanger's 0-6.
 */
const TODAY = "2026-09-26";
const ageGroups: AgeGroup[] = [
  { id: "ag_9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["fall"] },
  { id: "ag_11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];
const club = (id: string, name: string): ScoutTeam => ({ id, name });
const roster: ScoutTeam[] = [
  // First in the roster, and an 11U club: nothing the 9U league plays.
  club("S-ANG11", "Cincinnati Angels Red"),
  club("S-ELEV", "Elevens"),
  club("S-TP", "Trash Pandas Baseball Club"),
  club("S-ANG9", "Cincinnati Angels- Red"),
];
const played = (
  id: string,
  ageGroupId: string,
  a: string,
  b: string,
  sa: number,
  sb: number,
  date: string
): ScoutGame => ({ id, ageGroupId, teamAId: a, teamBId: b, teamAScore: sa, teamBScore: sb, date });
/** What the pulls stored: the Trash Pandas' loss to the 9U Angels, and an 11U game elsewhere. */
const stored: ScoutGame[] = [
  played("gc_tp_1", "ag_9", "S-TP", "S-ANG9", 13, 21, "2026-09-18"),
  played("gc_11_1", "ag_11", "S-ANG11", "S-ELEV", 5, 3, "2026-09-19"),
];
const finalLog = (away: number, home: number) => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const league = (
  teams: LeagueSeasonSnapshot["teams"] = [
    { id: "L-TP", name: "Trash Pandas Baseball Club" },
    { id: "L-ANG", name: "Cincinnati Angels- Red" },
  ]
): LeagueSeasonSnapshot => ({
  seasonId: "fall",
  teams,
  matchups: [{ id: "m1", date: "9/18", away: teams[0]!.id, home: teams[1]!.id }],
  logs: { m1: finalLog(13, 21) },
});

/** The page's games once the league is carried in and its copies collapsed, as the view builds it. */
const onThePage = (snapshot: LeagueSeasonSnapshot, teams: ScoutTeam[] = roster) => {
  const derived = deriveLeagueScoutGames("ag_9", [snapshot], teams, 2027, {
    games: stored,
    ageGroups,
  });
  return { derived, games: dedupeLeagueFixtures([...derived.games, ...stored]) };
};
const countedFor = (teamId: string, games: ScoutGame[]) =>
  games.filter(
    (game) =>
      (game.teamAId === teamId || game.teamBId === teamId) && countsTowardRating(game, TODAY)
  );

describe("the club a league team is carried onto", () => {
  it("is the club of its name on the season's page, not the first of that name in the roster", () => {
    const { derived, games } = onThePage(league());

    expect(derived.games[0]).toMatchObject({ teamAId: "S-TP", teamBId: "S-ANG9" });
    // One game, the league's own copy: the pull's copy is the same fixture and collapses into it.
    expect(countedFor("S-TP", games).map((game) => game.id)).toEqual(["league_fall_m1"]);
    expect(countedFor("S-ANG11", games).map((game) => game.id)).toEqual(["gc_11_1"]);
  });

  it("is the club a person picked, whatever either side calls it", () => {
    // Another "Trash Pandas" is on the page under the league's own spelling, so the name alone
    // would take that one; the pick says it is the club the pull calls something longer.
    const namesake = club("S-TPX", "Trash Pandas");
    const withNamesake = [namesake, ...roster];
    const snapshot = league([
      { id: "L-TP", name: "Trash Pandas", scoutTeamId: "S-TP" },
      { id: "L-ANG", name: "Cincinnati Angels- Red" },
    ]);
    const derived = deriveLeagueScoutGames("ag_9", [snapshot], withNamesake, 2027, {
      games: [...stored, played("gc_x_1", "ag_9", "S-TPX", "S-ANG9", 2, 9, "2026-09-05")],
      ageGroups,
    });

    expect(derived.games[0]).toMatchObject({ teamAId: "S-TP", teamBId: "S-ANG9" });
  });

  it("is the club the league's own forecast reads, team for team", () => {
    const snapshot = league();
    const { derived } = onThePage(snapshot);
    const fixtures = snapshot.matchups.map((matchup) => ({
      away: snapshot.teams.find((team) => team.id === matchup.away)!.name,
      home: snapshot.teams.find((team) => team.id === matchup.home)!.name,
      date: matchup.date,
    }));
    const { rows } = leagueScoutBridge("fall", ageGroups, roster, stored, snapshot.teams, fixtures);

    expect(rows.map((row) => row.scoutTeamId)).toEqual([
      derived.games[0]!.teamAId,
      derived.games[0]!.teamBId,
    ]);
  });

  it("is still found by name where no club of it is on the season's page", () => {
    // Nobody on the 9U page is called this; the roster's only one plays 11U. As before, the name
    // finds it rather than a second club being made up for the same name.
    const snapshot = league([
      { id: "L-TP", name: "Trash Pandas Baseball Club" },
      { id: "L-EL", name: "Elevens" },
    ]);
    const { derived } = onThePage(snapshot);

    expect(derived.games[0]).toMatchObject({ teamAId: "S-TP", teamBId: "S-ELEV" });
    expect(derived.teams).toHaveLength(roster.length);
  });
});
