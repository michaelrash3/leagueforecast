import { describe, expect, it } from "vitest";
import { importGcSchedule } from "../gameChangerImport";
import {
  countsTowardRating,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  leagueScoutBridge,
  leagueStandIns,
  NO_SCOUT_TEAM,
  offClubIdFor,
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

describe("the league's own game, pulled under another name", () => {
  it("is not handed back to the league's forecast as an outside result", () => {
    // The roster says "Trash Pandas" and a person picked the club GameChanger calls "Trash Pandas
    // Baseball Club". The pull's copy of the league game names the club the long way, so by names
    // alone it read as a tournament result, and the forecast counted the league's game twice.
    const leagueTeams = [
      { id: "L-TP", name: "Trash Pandas", scoutTeamId: "S-TP" },
      { id: "L-ANG", name: "Cincinnati Angels- Red" },
    ];
    const fixtures = [{ away: "Trash Pandas", home: "Cincinnati Angels- Red", date: "9/18" }];
    const { results, rows } = leagueScoutBridge(
      "fall",
      ageGroups,
      roster,
      stored,
      leagueTeams,
      fixtures
    );

    expect(rows.map((row) => [row.how, row.scoutTeamId])).toEqual([
      ["picked", "S-TP"],
      ["guessed", "S-ANG9"],
    ]);
    expect(results).toEqual([]);
  });

  it("still hands over the same two clubs' game on another day", () => {
    // Clubs that meet again in a tournament played a game the league did not.
    const leagueTeams = [
      { id: "L-TP", name: "Trash Pandas", scoutTeamId: "S-TP" },
      { id: "L-ANG", name: "Cincinnati Angels- Red" },
    ];
    const fixtures = [{ away: "Trash Pandas", home: "Cincinnati Angels- Red", date: "9/18" }];
    const tournament = played("gc_tp_2", "ag_9", "S-TP", "S-ANG9", 4, 6, "2026-09-06");
    const { results, squadYear } = leagueScoutBridge(
      "fall",
      ageGroups,
      roster,
      [...stored, tournament],
      leagueTeams,
      fixtures
    );

    expect(results).toEqual([
      { home: "L-TP", away: "L-ANG", homeMargin: -2, date: "2026-09-06", neutral: true },
    ]);
    // The year that places the league's "9/18" beside the tournament's ISO day in the forecast.
    expect(squadYear).toBe(2027);
  });
});

describe("a league team said not to be in Team Rankings", () => {
  const ANGELS = "Cincinnati Angels- Red";
  const own = offClubIdFor(ANGELS);
  const offLeague = (seasonId = "fall", name = ANGELS): LeagueSeasonSnapshot => ({
    ...league([
      { id: "L-TP", name: "Trash Pandas Baseball Club" },
      { id: "L-ANG", name, scoutTeamId: NO_SCOUT_TEAM },
    ]),
    seasonId,
  });

  it("has its games carried onto a club of its own, not onto a club of its name", () => {
    // By name, the game went to the 11U "Cincinnati Angels Red", first in the roster, which the
    // person had just said this team is not.
    const { derived } = onThePage(offLeague());

    expect(own).toBe("S-off-cincinnati-angels-red");
    expect(derived.games[0]).toMatchObject({ teamAId: "S-TP", teamBId: own });
    expect(derived.teams.filter((team) => team.id === own)).toEqual([{ id: own, name: ANGELS }]);
    expect(derived.teams).toHaveLength(roster.length + 1);
    expect(derived.clubByLeagueTeam.get("fall")?.get("L-ANG")).toBe(own);
    // Carried by neither a pick nor a name: nothing done to a pool club moves it.
    expect([...derived.pickedClubIds, ...derived.namedClubIds]).not.toContain(own);
    expect(derived.namedClubIds).toContain("S-TP");
  });

  it("is one game for its opponent when the opponent's pull filed its copy against the name alone", () => {
    // The Trash Pandas' schedule has the game against "Cincinnati Angels- Red", which the pull
    // filed against a club known only by that name, as it does where no pulled club played that
    // day. The league's copy names the club of the team's own; the two are still one game.
    const pulled: ScoutTeam = {
      id: "S-TP",
      name: "Trash Pandas Baseball Club",
      gcTeams: [
        { teamId: "gcTP", name: "Trash Pandas Baseball Club", ageGroupId: "ag_9", ageLevel: 9 },
      ],
    };
    const byName: ScoutTeam = { id: "S-ANGN", name: ANGELS, nameOnly: true };
    const teams = [club("S-ANG11", "Cincinnati Angels Red"), pulled, byName];
    const row: ScoutGame = {
      ...played("gc_tp_9", "ag_9", "S-TP", "S-ANGN", 13, 21, "2026-09-18"),
      source: { kind: "gamechanger", teamId: "gcTP", gameId: "g1" },
    };
    const derived = deriveLeagueScoutGames("ag_9", [offLeague()], teams, 2027, {
      games: [row],
      ageGroups,
    });
    const games = dedupeLeagueFixtures(
      [...derived.games, row],
      leagueStandIns(derived.teams, ageGroups)
    );

    expect(countedFor("S-TP", games).map((game) => game.id)).toEqual(["league_fall_m1"]);
    expect(countedFor(own, games).map((game) => game.id)).toEqual(["league_fall_m1"]);
  });

  it("is one club across the seasons and pages of a year, and on every pass", () => {
    const nine = deriveLeagueScoutGames(
      "ag_9",
      [offLeague("fall"), offLeague("spring", "Cincinnati Angels Red 9U")],
      roster,
      2027,
      { games: stored, ageGroups }
    );
    expect(nine.games.map((game) => game.teamBId)).toEqual([own, own]);
    // Another page of the year, with the same team said not to be in Team Rankings there too.
    const eleven = deriveLeagueScoutGames("ag_11", [offLeague("fall11")], nine.teams, 2027, {
      games: stored,
      ageGroups,
    });
    expect(eleven.games[0]?.teamBId).toBe(own);
    expect(eleven.teams.filter((team) => team.id === own)).toHaveLength(1);
    // And a roster that already holds it, saved there by an edit, has it carried onto it again.
    const saved = [...roster, { id: own, name: ANGELS }];
    const again = deriveLeagueScoutGames("ag_9", [offLeague()], saved, 2027, {
      games: stored,
      ageGroups,
    });
    expect(again.games[0]?.teamBId).toBe(own);
    expect(again.teams).toBe(saved);
  });

  it("is never found by its name, by a league team nobody has answered for", () => {
    // Only the club made for the answered team carries the name; a team of that name nobody has
    // answered for is given a club of its own by the name, as before, not that one.
    const saved = [club("S-TP", "Trash Pandas Baseball Club"), { id: own, name: ANGELS }];
    const derived = deriveLeagueScoutGames("ag_9", [league()], saved, 2027, {
      games: [],
      ageGroups,
    });
    const angels = derived.games[0]?.teamBId;
    expect(angels).not.toBe(own);
    expect(derived.teams.find((team) => team.id === angels)?.name).toBe(ANGELS);
  });

  it("is never guessed for anyone, nor filed onto by a pull, once a game is filed against it", () => {
    // A game typed in against it, or a club of the name merged into it, files a game against it on
    // the season's page; it is the answered team's all the same, and no name reaches it.
    const saved = [club("S-TP", "Trash Pandas Baseball Club"), { id: own, name: ANGELS }];
    const filed = played("scout_off", "ag_9", "S-TP", own, 3, 2, "2026-09-05");
    const derived = deriveLeagueScoutGames("ag_9", [league()], saved, 2027, {
      games: [filed],
      ageGroups,
    });
    expect(derived.games[0]?.teamBId).not.toBe(own);
    const fixtures = [{ away: "Trash Pandas Baseball Club", home: ANGELS, date: "9/18" }];
    const bridge = leagueScoutBridge("fall", ageGroups, saved, [filed], league().teams, fixtures);
    expect(bridge.rows.find((row) => row.leagueTeamId === "L-ANG")?.how).toBe("none");

    // A pull of a schedule that names it makes a club of the name, as where no club had it.
    const nine: AgeGroup = { id: "ag_9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] };
    const pulled = importGcSchedule(
      {
        profile: {
          id: "gcTP",
          name: "Trash Pandas Baseball Club",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
          state: "OH",
          city: "Cincinnati",
        },
        games: [
          {
            id: "g1",
            date: "2026-09-18",
            opponentName: ANGELS,
            status: "completed",
            teamScore: 13,
            opponentScore: 21,
          },
        ],
        fetchedAt: "2026-09-20T03:35:17.077Z",
      },
      { ageGroups: [nine], teams: saved, games: [filed] }
    );
    const row = pulled.state.games.find((game) => game.id !== filed.id);
    expect(row?.ageGroupId).toBe("ag_9");
    expect([row?.teamAId, row?.teamBId]).not.toContain(own);
    expect(pulled.outcome.opponentsCreated).toBe(1);
  });

  it("has an id read off its name, the same however the name is written", () => {
    expect(offClubIdFor("cincinnati angels red")).toBe(own);
    expect(offClubIdFor("Cincinnati Angels/Red 9U")).toBe(own);
    expect(offClubIdFor("Cincinnati Angels Blue")).not.toBe(own);
    expect(offClubIdFor("9U")).toBe("S-off-9u");
    expect(offClubIdFor(" - / ")).toBe("S-off-team");
  });
});

describe("every other copy of a game against a team said not to be in Team Rankings", () => {
  const ANGELS = "Cincinnati Angels- Red";
  const own = offClubIdFor(ANGELS);
  const pulled = (id: string, name: string, gc: string): ScoutTeam => ({
    id,
    name,
    gcTeams: [{ teamId: gc, name, ageGroupId: "ag_9", ageLevel: 9 }],
  });
  const TP = pulled("S-TP", "Trash Pandas Baseball Club", "gcTP");
  const ANG9 = pulled("S-ANG9", "Cincinnati Angels Red", "gcANG");
  const ANGN: ScoutTeam = { id: "S-ANGN", name: "Cincinnati Angels Red", nameOnly: true };
  const fromSchedule = (game: ScoutGame, gc: string): ScoutGame => ({
    ...game,
    source: { kind: "gamechanger", teamId: gc, gameId: `${game.id}-gc` },
  });
  /** The 9U league with the Angels answered Not here, its game final at `runs` or still to come. */
  const answered = (runs: [number, number] | null = [13, 21]): LeagueSeasonSnapshot => ({
    seasonId: "fall",
    teams: [
      { id: "L-TP", name: "Trash Pandas Baseball Club" },
      { id: "L-ANG", name: ANGELS, scoutTeamId: NO_SCOUT_TEAM },
    ],
    matchups: [{ id: "m1", date: "9/18", away: "L-TP", home: "L-ANG" }],
    logs: runs ? { m1: finalLog(...runs) } : {},
  });
  /** The page's games as the view builds them: derived, stored, and their copies collapsed. */
  const page = (
    snapshot: LeagueSeasonSnapshot,
    teams: ScoutTeam[],
    rows: ScoutGame[],
    pages: AgeGroup[] = ageGroups
  ) => {
    const derived = deriveLeagueScoutGames("ag_9", [snapshot], teams, 2027, {
      games: rows,
      ageGroups: pages,
    });
    return dedupeLeagueFixtures([...derived.games, ...rows], leagueStandIns(derived.teams, pages));
  };
  const ids = (games: ScoutGame[]) => games.map((game) => game.id);

  it("is the league's game when the opponent's pull filed it against a pulled club of the name", () => {
    // The import files a name onto a pulled club when only it could have played that day; the
    // person said that club is not this team, and it never played the game.
    const row = fromSchedule(
      played("gc_tp_1", "ag_9", "S-TP", "S-ANG9", 13, 21, "2026-09-18"),
      "gcTP"
    );
    const games = page(answered(), [TP, ANG9], [row]);
    expect(ids(countedFor("S-TP", games))).toEqual(["league_fall_m1"]);
    expect(ids(countedFor(own, games))).toEqual(["league_fall_m1"]);
    expect(countedFor("S-ANG9", games)).toEqual([]);
  });

  it("is the league's game when the club of the name pulled its own copy of it", () => {
    const row = fromSchedule(
      played("gc_ang_1", "ag_9", "S-ANG9", "S-TP", 21, 13, "2026-09-18"),
      "gcANG"
    );
    expect(ids(countedFor("S-TP", page(answered(), [TP, ANG9], [row])))).toEqual([
      "league_fall_m1",
    ]);
  });

  it("is the league's game whatever the copy says the score was, the league's book standing", () => {
    const row = fromSchedule(
      played("gc_tp_1", "ag_9", "S-TP", "S-ANGN", 13, 20, "2026-09-18"),
      "gcTP"
    );
    const games = page(answered(), [TP, ANGN], [row]);
    expect(ids(countedFor("S-TP", games))).toEqual(["league_fall_m1"]);
    expect(games.find((game) => game.id === "league_fall_m1")).toMatchObject({
      teamAScore: 13,
      teamBScore: 21,
    });
  });

  it("is one game on the schedule before it is played", () => {
    const row: ScoutGame = fromSchedule(
      { id: "gc_tp_1", ageGroupId: "ag_9", teamAId: "S-TP", teamBId: "S-ANGN", date: "2026-09-18" },
      "gcTP"
    );
    const games = page(answered(null), [TP, ANGN], [row]);
    const thatDay = games.filter(
      (game) => (game.teamAId === "S-TP" || game.teamBId === "S-TP") && game.date === "2026-09-18"
    );
    expect(thatDay).toHaveLength(1);
  });

  it("is the league's game when it was typed in by hand against the name", () => {
    const typed = played("scout_1", "ag_9", "S-TP", "S-CINC", 13, 21, "2026-09-18");
    const games = page(answered(), [TP, club("S-CINC", ANGELS)], [typed]);
    expect(ids(countedFor("S-TP", games))).toEqual(["league_fall_m1"]);
  });

  it("is not a game with a club of the name on another day, nor one with a club of another name", () => {
    const tournament = fromSchedule(
      played("gc_tp_2", "ag_9", "S-TP", "S-ANG9", 4, 6, "2026-09-05"),
      "gcTP"
    );
    const bears = fromSchedule(
      played("gc_tp_3", "ag_9", "S-TP", "S-BEAR", 7, 1, "2026-09-18"),
      "gcTP"
    );
    const games = page(answered(), [TP, ANG9, club("S-BEAR", "Bears")], [tournament, bears]);
    expect(ids(countedFor("S-TP", games)).sort()).toEqual(
      ["gc_tp_2", "gc_tp_3", "league_fall_m1"].sort()
    );
  });

  it("is not a slot's game that day, nor a game on a page of another squad year", () => {
    // Both at a score the league's game does not have, which the pass for rows filed against
    // nobody would pair; neither may be filed with the league's game here.
    const slot = fromSchedule(
      played("gc_tp_4", "ag_9", "S-TP", "S-TBD", 13, 20, "2026-09-18"),
      "gcTP"
    );
    const lastYear: AgeGroup = {
      id: "ag_9_26",
      name: "9U 2026",
      ageLevel: 9,
      year: 2026,
      seasonIds: [],
    };
    const elsewhere = fromSchedule(
      played("gc_tp_5", "ag_9_26", "S-TP", "S-ANGN", 13, 20, "2026-09-18"),
      "gcTP"
    );
    const games = page(
      answered(),
      [TP, ANGN, { id: "S-TBD", name: ANGELS, placeholder: true }],
      [slot, elsewhere],
      [...ageGroups, lastYear]
    );
    expect(ids(games)).toEqual(expect.arrayContaining(["gc_tp_4", "gc_tp_5", "league_fall_m1"]));
  });

  it("is not taken for one of two such teams whose names it fits", () => {
    const snapshot: LeagueSeasonSnapshot = {
      seasonId: "fall",
      teams: [
        { id: "L-TP", name: "Trash Pandas Baseball Club" },
        { id: "L-ANG", name: ANGELS, scoutTeamId: NO_SCOUT_TEAM },
        { id: "L-AR", name: "Angels Red", scoutTeamId: NO_SCOUT_TEAM },
      ],
      matchups: [
        { id: "m1", date: "9/18", away: "L-TP", home: "L-ANG" },
        { id: "m2", date: "9/18", away: "L-TP", home: "L-AR" },
      ],
      logs: { m1: finalLog(13, 21), m2: finalLog(2, 3) },
    };
    // A score neither league game has, so only the names could say which game it is, and they
    // fit both.
    const row = fromSchedule(
      played("gc_tp_1", "ag_9", "S-TP", "S-ANGN", 13, 20, "2026-09-18"),
      "gcTP"
    );
    expect(ids(page(snapshot, [TP, ANGN], [row]))).toContain("gc_tp_1");
  });

  describe("between two such teams", () => {
    const OWLS = "Owls Select";
    const owls = offClubIdFor(OWLS);
    const both = (runs: [number, number] = [4, 6]): LeagueSeasonSnapshot => ({
      seasonId: "fall",
      teams: [
        { id: "L-OWL", name: OWLS, scoutTeamId: NO_SCOUT_TEAM },
        { id: "L-ANG", name: ANGELS, scoutTeamId: NO_SCOUT_TEAM },
        { id: "L-TP", name: "Trash Pandas Baseball Club" },
      ],
      matchups: [
        { id: "m1", date: "9/18", away: "L-OWL", home: "L-ANG" },
        { id: "m2", date: "9/18", away: "L-TP", home: "L-OWL" },
      ],
      logs: { m1: finalLog(...runs), m2: finalLog(1, 2) },
    });
    const OWLN: ScoutTeam = { id: "S-OWLN", name: "Owls Select", nameOnly: true };
    const CINC = club("S-CINC", ANGELS);

    it("is the league's game when its clubs are one of each name, either way round", () => {
      for (const typed of [
        played("scout_1", "ag_9", "S-OWLN", "S-CINC", 4, 6, "2026-09-18"),
        played("scout_1", "ag_9", "S-CINC", "S-OWLN", 7, 4, "2026-09-18"),
      ]) {
        const games = page(both(), [TP, OWLN, CINC], [typed]);
        expect(ids(games)).not.toContain("scout_1");
        expect(ids(countedFor(owls, games)).sort()).toEqual(["league_fall_m1", "league_fall_m2"]);
        expect(ids(countedFor(own, games))).toEqual(["league_fall_m1"]);
        expect(games.find((game) => game.id === "league_fall_m1")).toMatchObject({
          teamAScore: 4,
          teamBScore: 6,
        });
      }
      // And in a league where that is the only game against such a team.
      const alone = {
        ...both(),
        matchups: both().matchups.slice(0, 1),
        logs: { m1: finalLog(4, 6) },
      };
      const typed = played("scout_1", "ag_9", "S-OWLN", "S-CINC", 4, 6, "2026-09-18");
      expect(ids(page(alone, [OWLN, CINC], [typed]))).not.toContain("scout_1");
    });

    it("is not one whose clubs fit only one of the names, nor one on another day or page", () => {
      const bears = played("scout_2", "ag_9", "S-OWLN", "S-BEAR", 4, 6, "2026-09-18");
      // Two clubs that could each be the Owls, and neither the Angels.
      const owlsTwice = played("scout_5", "ag_9", "S-OWLN", "S-OWLB", 4, 6, "2026-09-18");
      const later = played("scout_3", "ag_9", "S-OWLN", "S-CINC", 4, 6, "2026-09-19");
      const lastYear: AgeGroup = {
        id: "ag_9_26",
        name: "9U 2026",
        ageLevel: 9,
        year: 2026,
        seasonIds: [],
      };
      const elsewhere = played("scout_4", "ag_9_26", "S-OWLN", "S-CINC", 4, 6, "2026-09-18");
      const games = page(
        both(),
        [TP, OWLN, CINC, club("S-BEAR", "Bears"), club("S-OWLB", "Owls Select Black")],
        [bears, owlsTwice, later, elsewhere],
        [...ageGroups, lastYear]
      );
      expect(ids(games)).toEqual(
        expect.arrayContaining(["scout_2", "scout_3", "scout_4", "scout_5", "league_fall_m1"])
      );
    });
  });

  it("is a game between two of the league's own clubs first, where the league has that game too", () => {
    // The Trash Pandas play the answered Angels and, the same day, the pulled Angels the league
    // names as itself; their copy against the pulled club is that game, not the answered one.
    const snapshot: LeagueSeasonSnapshot = {
      seasonId: "fall",
      teams: [
        { id: "L-TP", name: "Trash Pandas Baseball Club" },
        { id: "L-ANG", name: ANGELS, scoutTeamId: NO_SCOUT_TEAM },
        { id: "L-ANG9", name: "Cincinnati Angels Red", scoutTeamId: "S-ANG9" },
      ],
      matchups: [
        { id: "m1", date: "9/18", away: "L-TP", home: "L-ANG" },
        { id: "m2", date: "9/18", away: "L-TP", home: "L-ANG9" },
      ],
      logs: { m2: finalLog(13, 21) },
    };
    const row = fromSchedule(
      played("gc_tp_1", "ag_9", "S-TP", "S-ANG9", 13, 21, "2026-09-18"),
      "gcTP"
    );
    expect(ids(countedFor("S-TP", page(snapshot, [TP, ANG9], [row])))).toEqual(["league_fall_m2"]);
  });
});
