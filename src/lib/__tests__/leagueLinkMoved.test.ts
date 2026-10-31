import { describe, expect, it } from "vitest";
import { auditLeague } from "../leagueFindings";
import { leagueBridgeOf } from "../live/leagueAnswers";
import { planLeagueScoreFill } from "../leagueScoreFill";
import { seasonFromStart } from "../leagueStart";
import {
  buildScoutTeam,
  leagueScoutBridge,
  mergeScoutTeams,
  NO_SCOUT_TEAM,
  type AgeGroup,
  type LeagueTeamLink,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { DEFAULT_SETTINGS, type TeamBase } from "../types";
import { blankLog } from "../util";
import { coerceTeams } from "../validate";

/*
 * A League Standings pick kept beside the GameChanger id of the club it picked
 * (`TeamBase.scoutGcTeamId`): where the club under the pick's id no longer carries it, the pick
 * has moved, and is followed to the one club that does, or said to have moved and not used.
 * Placeholder names throughout.
 */

const AGE: AgeGroup = {
  id: "ag10",
  name: "10U 2027",
  ageLevel: 10,
  year: 2027,
  seasonIds: ["season-x"],
};
const gcOf = (name: string) => `gc${name.replace(/\W/g, "").slice(0, 10)}`;

/** Clubs pulled in the order given, each minted as a pull mints it. */
const roster = (names: string[]): ScoutTeam[] => {
  const ids = new Set<string>();
  return names.map((name) => {
    const team = buildScoutTeam(name, ids, {
      gcTeams: [{ teamId: gcOf(name), name, ageGroupId: AGE.id }],
    });
    ids.add(team.id);
    return team;
  });
};
const idOf = (teams: ScoutTeam[], name: string): string => {
  const team = teams.find((one) => one.name === name);
  if (!team) throw new Error(`no ${name}`);
  return team.id;
};
const game = (id: string, a: string, b: string, runs: [number, number]): ScoutGame => ({
  id,
  ageGroupId: AGE.id,
  teamAId: a,
  teamBId: b,
  teamAScore: runs[0],
  teamBScore: runs[1],
  date: "2026-09-12",
});
const bridgeOf = (teams: ScoutTeam[], games: ScoutGame[], picks: LeagueTeamLink[]) =>
  leagueScoutBridge("season-x", [AGE], teams, games, picks, []);

/** The League team "Rays", picked as Riverside Rays while the pool called it `S-RIVE`. */
const RAYS: LeagueTeamLink = {
  id: "RAYS",
  name: "Rays",
  scoutTeamId: "S-RIVE",
  scoutGcTeamId: gcOf("Riverside Rays"),
};

describe("a League pick whose club's id now names another club", () => {
  // Start again, and the pulls this time make Riverbend Robins first: the Robins are S-RIVE now.
  const after = roster(["Riverbend Robins", "Riverside Rays", "Other Opponent"]);
  const robins = idOf(after, "Riverbend Robins");
  const rays = idOf(after, "Riverside Rays");
  const other = idOf(after, "Other Opponent");
  const games = [game("g1", robins, other, [12, 1]), game("g2", rays, other, [3, 2])];

  it("is followed to the club that carries the GameChanger id it was picked by", () => {
    expect([robins, rays]).toEqual(["S-RIVE", "S-RIVE2"]);
    const bridge = bridgeOf(after, games, [RAYS]);
    expect(bridge.rows[0]).toMatchObject({
      how: "picked",
      scoutTeamId: "S-RIVE2",
      suggestedName: "Riverside Rays",
    });
    // The Rays' own 3-2 is the league team's, and the Robins' 12-1 is the Robins' alone.
    const ofRays = (results: typeof bridge.results) =>
      results.filter((result) => result.home === "RAYS" || result.away === "RAYS");
    expect(ofRays(bridge.results)).toEqual([
      { home: "RAYS", away: `S-${other}`, homeMargin: 1, date: "2026-09-12", neutral: true },
    ]);
    // Where the pick was kept with no GameChanger id, the Robins' game is the league team's.
    expect(ofRays(bridgeOf(after, games, [{ ...RAYS, scoutGcTeamId: undefined }]).results)).toEqual(
      [{ home: "RAYS", away: `S-${other}`, homeMargin: 11, date: "2026-09-12", neutral: true }]
    );
  });

  it("is said to have moved, and reaches no club, where no one club carries the id", () => {
    // The Rays not pulled again yet: nobody carries their id.
    const unpulled = roster(["Riverbend Robins", "Other Opponent"]);
    const bridge = bridgeOf(unpulled, games.slice(0, 1), [RAYS]);
    expect(bridge.rows[0]).toMatchObject({ how: "none", movedScoutTeamId: "S-RIVE" });
    expect(bridge.rows[0]?.scoutTeamId).toBeUndefined();
    expect(bridge.results.some((result) => result.home === "RAYS" || result.away === "RAYS")).toBe(
      false
    );
    // Two clubs carrying it is no answer either.
    const twice = [
      ...after,
      {
        id: "S-RIVE3",
        name: "Riverside Rays B",
        gcTeams: [{ teamId: RAYS.scoutGcTeamId!, name: "B", ageGroupId: AGE.id }],
      },
    ];
    expect(bridgeOf(twice, games, [RAYS]).rows[0]).toMatchObject({
      how: "none",
      movedScoutTeamId: "S-RIVE",
    });
    // And the League tab says so, beside the picks merely gone.
    const findings = auditLeague({
      teams: [{ id: "RAYS", name: "Rays" }],
      matchups: [],
      logs: {},
      settings: DEFAULT_SETTINGS,
      today: new Date(2026, 9, 1),
      links: bridge.rows,
    });
    const moved = findings.find((finding) => finding.code === "link-moved");
    expect(moved?.targets.map((target) => target.id)).toEqual(["scoutLinks", "RAYS"]);
    expect(findings.some((finding) => finding.code === "link-gone")).toBe(false);
    // The answer a member's phone is sent reads the row back, and a row naming no id is no row.
    expect(leagueBridgeOf(bridge)).toEqual(bridge);
    expect(
      leagueBridgeOf({ ...bridge, rows: [{ ...bridge.rows[0], movedScoutTeamId: "" }] })
    ).toBeNull();
  });

  it("is not guessed back onto the club in its place, though that club bears the team's name", () => {
    // In the Rays' place now, a club called just what the league calls its team, with a game on
    // the season's page: the name would guess it, and it is the very club the pick is not.
    const namesake = roster(["Rays", "Other Opponent"]);
    expect(idOf(namesake, "Rays")).toBe("S-RAYS");
    const inPlace = namesake.map((team) =>
      team.name === "Rays" ? { ...team, id: "S-RIVE" } : team
    );
    const played = [game("g3", "S-RIVE", idOf(namesake, "Other Opponent"), [5, 4])];
    expect(
      bridgeOf(inPlace, played, [{ ...RAYS, scoutGcTeamId: gcOf("Riverside Rays") }]).rows[0]
    ).toMatchObject({ how: "none", movedScoutTeamId: "S-RIVE" });
    // Its own pick of it, as one made before the id was kept, guesses as ever.
    expect(bridgeOf(inPlace, played, [{ id: "RAYS", name: "Rays" }]).rows[0]).toMatchObject({
      how: "guessed",
      scoutTeamId: "S-RIVE",
    });
  });

  it("follows a club folded into another, which carries its GameChanger ids on", () => {
    // The sweep's reproduction: Gold picked, then folded into the Rays.
    const before = roster(["Riverside Rays", "Riverside Rays Gold", "Oak Hill Owls"]);
    const gold = idOf(before, "Riverside Rays Gold");
    const folded = mergeScoutTeams(gold, idOf(before, "Riverside Rays"), before, [], [AGE]);
    const pick = {
      id: "RAYS",
      name: "Rays",
      scoutTeamId: gold,
      scoutGcTeamId: gcOf("Riverside Rays Gold"),
    };
    expect(bridgeOf(folded.teams, [], [pick]).rows[0]).toMatchObject({
      how: "picked",
      scoutTeamId: "S-RIVE",
    });
  });

  it("is as it was for a pick kept with no GameChanger id: one made before, or of a club with none", () => {
    const { scoutGcTeamId: _id, ...older } = RAYS;
    expect(bridgeOf(after, games, [older]).rows[0]).toMatchObject({
      how: "picked",
      scoutTeamId: "S-RIVE",
    });
    expect(bridgeOf(after, games, [{ ...older, scoutTeamId: "S-GONE" }]).rows[0]).toMatchObject({
      staleScoutTeamId: "S-GONE",
    });
    expect(bridgeOf(after, games, [{ ...RAYS, scoutTeamId: NO_SCOUT_TEAM }]).rows[0]?.how).toBe(
      "off"
    );
  });

  it("is read the same by Fill, which fills nothing from the club the pick no longer is", () => {
    const leagueTeams: TeamBase[] = [
      { id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE", scoutGcTeamId: gcOf("Riverside Rays") },
      { id: "OTHE", name: "Other Opponent" },
    ];
    const fill = (teams: ScoutTeam[], pool: ScoutGame[]) =>
      planLeagueScoreFill({
        seasonId: "season-x",
        teams: leagueTeams,
        matchups: [{ id: "m1", date: "9/12", away: "RAYS", home: "OTHE" }],
        logs: { m1: blankLog() },
        ageGroups: [AGE],
        scoutTeams: teams,
        scoutGames: pool,
        today: "2026-10-01",
      });
    // Followed: the Rays' own 3-2 is the score offered.
    const followed = fill(after, games).rows.find((row) => row.matchupId === "m1");
    expect(followed).toMatchObject({ awayRuns: 3, homeRuns: 2 });
    // Moved and unfollowable: the Robins' 12-1 against the same opponent that day is no one's.
    const unpulled = roster(["Riverbend Robins", "Other Opponent"]);
    const moved = fill(unpulled, games.slice(0, 1)).rows.find((row) => row.matchupId === "m1");
    expect(moved?.awayRuns).not.toBe(12);
  });
});

describe("the GameChanger id kept beside a pick", () => {
  it("is kept by storage's readers with a pick, and left out without one", () => {
    expect(
      coerceTeams([
        { id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE", scoutGcTeamId: "gcRAYS" },
        { id: "OWLS", name: "Owls", scoutGcTeamId: "gcOWLS" },
        { id: "BEAR", name: "Bears", scoutTeamId: "S-BEAR", scoutGcTeamId: 4 },
      ])
    ).toEqual([
      { id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE", scoutGcTeamId: "gcRAYS" },
      { id: "OWLS", name: "Owls" },
      { id: "BEAR", name: "Bears", scoutTeamId: "S-BEAR" },
    ]);
  });

  it("is set by a season started from a GameChanger organization, where its club is linked", () => {
    const built = seasonFromStart(
      [
        { id: "gcRAYS", name: "Rays" },
        { id: "gcOWLS", name: "Owls" },
      ],
      { games: [] } as unknown as Parameters<typeof seasonFromStart>[1],
      [],
      6,
      (id) => (id === "gcRAYS" ? "S-RIVE" : undefined),
      (id) => id
    );
    expect(built.teams).toEqual([
      { id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE", scoutGcTeamId: "gcRAYS" },
      { id: "OWLS", name: "Owls" },
    ]);
  });
});
