import { describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../../teamRankings";
import { archiveSquadYear } from "../../teamRankingsArchive";
import { NO_REMOVALS, type AutoRemoval, type AutoRemovals } from "../../autoRemoved";
import {
  archivedFrom,
  deriveAllKnown,
  leagueKeptClubs,
  leagueLinkedClubs,
  gamesOnPages,
  type LeagueSeasonData,
  type SeasonReader,
} from "../allKnown";

/**
 * What a page knows, as a function of the stored pool (`deriveAllKnown`): the rules it keeps that
 * a server must keep too, each on the smallest case that shows it. That the page itself derives
 * exactly this is `TeamRankingsView.allKnown.test.tsx`'s to show.
 */

const NOTHING: LeagueSeasonData = { teams: [], matchups: [], logs: {} };
const readerOf =
  (seasons: Record<string, LeagueSeasonData>): SeasonReader =>
  (seasonId) =>
    seasons[seasonId] ?? NOTHING;

const fixture = poolFixture({ seed: 7, clubsPerPage: 60 });
const fixtureReader = readerOf(fixture.seasons);
const yearOf = (year: number | undefined) =>
  fixture.games.filter(
    (game) => fixture.ageGroups.find((group) => group.id === game.ageGroupId)?.year === year
  );
const known = (year: number | undefined) =>
  deriveAllKnown({
    ageGroups: fixture.ageGroups,
    teams: fixture.teams,
    yearGames: yearOf(year),
    readSeason: fixtureReader,
    autoRemoved: NO_REMOVALS,
  });

describe("what a page knows", () => {
  it("mints a league team's id against every page's league, walked in stored order", () => {
    /*
     * Last year's 9U league is stored first, so its Lexington Lions take S-LEXI and this year's
     * Lexington Legends S-LEXI2, whichever year is being read. A pass over one year's pages alone
     * would give the Legends S-LEXI, the Lions' id on the other year's page. Between them, the club
     * made for the 10U team said not to be in Team Rankings, whose id is read off its name.
     */
    [2026, 2027].forEach((year) => {
      const minted = known(year).teams.slice(fixture.teams.length);
      expect(minted.map((team) => [team.id, team.name])).toEqual([
        ["S-LEXI", "Lexington Lions"],
        ["S-off-fir-club-12", "Fir Club 12"],
        ["S-LEXI2", "Lexington Legends"],
      ]);
    });
  });

  it("carries a league team onto the club of its name that played on the season's pages that year", () => {
    const groups: AgeGroup[] = [
      { id: "p26", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: ["s"] },
      { id: "p27", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
    ];
    const teams: ScoutTeam[] = [
      { id: "P1", name: "Bears" },
      { id: "P2", name: "Bears" },
      { id: "X", name: "Foxes" },
    ];
    const played: ScoutGame = {
      id: "g",
      ageGroupId: "p26",
      teamAId: "P2",
      teamBId: "X",
      teamAScore: 3,
      teamBScore: 1,
      date: "2026-03-07",
    };
    const season: LeagueSeasonData = {
      teams: [
        { id: "b", name: "Bears" },
        { id: "f", name: "Foxes" },
      ],
      matchups: [{ id: "m", date: "3/14", away: "b", home: "f" }],
      logs: {},
    };
    const carriedOnto = (yearGames: ScoutGame[]) =>
      deriveAllKnown({
        ageGroups: groups,
        teams,
        yearGames,
        readSeason: readerOf({ s: season }),
        autoRemoved: NO_REMOVALS,
      })
        .leagueClubs.get("p26")
        ?.get("s")
        ?.get("b");
    // Read with 2026's games, the Bears who played on the season's page; with 2027's, none of
    // them did, and the name goes to the first club that has it.
    expect(carriedOnto([played])).toBe("P2");
    expect(carriedOnto([])).toBe("P1");
  });

  it("keeps a season a page claims with nothing stored, as nothing", () => {
    const all = known(2027);
    expect(all.leagueClubs.get("ag_11u_2027")).toEqual(new Map([["fx-nothing-stored", new Map()]]));
    expect(all.leagueHalves.get("ag_11u_2027")).toEqual(
      new Map([["fx-nothing-stored", new Set()]])
    );
  });

  it("carries a season two pages claim onto both, so its game ids alone do not name a row", () => {
    const shared = known(2027).derivedGames.filter((game) =>
      game.id.startsWith("league_fx-shared_")
    );
    const pages = new Set(shared.map((game) => game.ageGroupId));
    expect(pages).toEqual(new Set(["ag_12u_2027", "ag_13u_2027"]));
    expect(new Set(shared.map((game) => game.id)).size).toBe(shared.length / 2);
  });

  it("folds a club's pulled copy of a league game into the league's row", () => {
    const all = known(2027);
    expect(fixture.games.some((game) => game.id === "pulled-league-copy")).toBe(true);
    expect(all.games.some((game) => game.id === "pulled-league-copy")).toBe(false);
    expect(all.derivedGames.length).toBeGreaterThan(0);
    // The league's rows come first, then the stored ones, which is the order the fit sums them in.
    const firstStored = all.games.findIndex((game) => !game.id.startsWith("league_"));
    expect(firstStored).toBeGreaterThan(0);
    expect(all.games.slice(firstStored).some((game) => game.id.startsWith("league_"))).toBe(false);
  });

  it("knows the halves each league season is played in", () => {
    const all = known(2027);
    expect(all.leagueHalves.get("ag_10u_2027")?.get("fx-10u-fall")).toEqual(new Set(["fall"]));
    expect(all.leagueHalves.get("ag_12u_2027")?.get("fx-shared")).toEqual(new Set(["spring"]));
  });

  it("leaves out of the picked clubs one another season reaches by its name", () => {
    /*
     * A pick holds by id, so a club reached only that way can be renamed freely; one a season also
     * reaches by its name cannot, since the rename would move that season's games off it.
     */
    const groups: AgeGroup[] = [
      { id: "p", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: ["picks", "names"] },
    ];
    const teams: ScoutTeam[] = [
      { id: "F", name: "Foxes" },
      { id: "G", name: "Geckos" },
    ];
    const versus = (away: string, home: string): LeagueSeasonData["matchups"] => [
      { id: "m", date: "9/13", away, home },
    ];
    const seasons: Record<string, LeagueSeasonData> = {
      picks: {
        teams: [
          { id: "a", name: "Foxes Blue", scoutTeamId: "F" },
          { id: "b", name: "Geckos Gold", scoutTeamId: "G" },
        ],
        matchups: versus("a", "b"),
        logs: {},
      },
      names: {
        teams: [
          { id: "c", name: "Foxes" },
          { id: "d", name: "Owls" },
        ],
        matchups: versus("c", "d"),
        logs: {},
      },
    };
    const all = deriveAllKnown({
      ageGroups: groups,
      teams,
      yearGames: [],
      readSeason: readerOf(seasons),
      autoRemoved: NO_REMOVALS,
    });
    expect([...all.pickedOnly]).toEqual(["G"]);
  });

  it("names the clubs reached only by a person's pick", () => {
    const all = known(2027);
    const pick = fixture.seasons["fx-10u-fall"]?.teams.find((team) => team.id === "t10-pick");
    expect(pick?.scoutTeamId).toBeDefined();
    expect([...all.pickedOnly]).toEqual([pick?.scoutTeamId]);
  });
});

describe("a club taken off as plainly made up", () => {
  const page: AgeGroup = { id: "p", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] };
  const pulled = (id: string, ...gcIds: string[]): ScoutTeam => ({
    id,
    name: `Club ${id}`,
    gcTeams: gcIds.map((teamId) => ({ teamId, name: `Club ${id}`, ageGroupId: "p" })),
  });
  const teams = [pulled("F", "gcF1", "gcF2"), pulled("R", "gcR"), { id: "X", name: "Stand-in X" }];
  const played = (id: string, a: string, b: string): ScoutGame => ({
    id,
    ageGroupId: "p",
    teamAId: a,
    teamBId: b,
    teamAScore: 4,
    teamBScore: 2,
    date: "2026-09-20",
  });
  const yearGames = [played("fx", "F", "X"), played("rx", "R", "X"), played("fr", "F", "R")];
  const mark = (gcTeamId: string): [string, AutoRemoval] => [
    gcTeamId,
    { gcTeamId, name: "Club F", on: "2026-10-11", signs: ["named"], word: "demo" },
  ];
  const BOTH: AutoRemovals = new Map([mark("gcF1"), mark("gcF2")]);
  const derive = (
    autoRemoved: AutoRemovals,
    { groups = [page], seasons = {} as Record<string, LeagueSeasonData> } = {}
  ) =>
    deriveAllKnown({
      ageGroups: groups,
      teams,
      yearGames,
      readSeason: readerOf(seasons),
      autoRemoved,
    });

  it("is left out, with every game naming it", () => {
    const all = derive(BOTH);
    expect(all.teams.map((team) => team.id)).toEqual(["R", "X"]);
    expect(all.games.map((game) => game.id)).toEqual(["rx"]);
  });

  it("stands while one of its GameChanger ids is unmarked, and with no marks is as it was", () => {
    const one = derive(new Map([mark("gcF1")]));
    const none = derive(NO_REMOVALS);
    expect(one).toEqual(none);
    expect(none.games.map((game) => game.id)).toEqual(["fx", "rx", "fr"]);
    expect(none.teams).toBe(teams);
  });

  it("stands as a page's own team", () => {
    const all = derive(BOTH, { groups: [{ ...page, myTeamId: "F" }] });
    expect(all.games.map((game) => game.id)).toEqual(["fx", "rx", "fr"]);
  });

  it("stands when a League Standings team picks it or is carried onto it by its name", () => {
    const league = (team: LeagueSeasonData["teams"][number]): Record<string, LeagueSeasonData> => ({
      s: {
        teams: [team, { id: "o", name: "Owls" }],
        matchups: [{ id: "m", date: "9/13", away: team.id, home: "o" }],
        logs: {},
      },
    });
    const groups = [{ ...page, seasonIds: ["s"] }];
    const picked = derive(BOTH, {
      groups,
      seasons: league({ id: "t", name: "Foxes", scoutTeamId: "F" }),
    });
    expect(picked.teams.some((team) => team.id === "F")).toBe(true);
    expect(picked.games.some((game) => game.id === "fx")).toBe(true);
    const named = derive(BOTH, { groups, seasons: league({ id: "t", name: "Club F" }) });
    expect(named.games.some((game) => game.id === "fx")).toBe(true);
    // A league that links some other club leaves it off.
    const other = derive(BOTH, { groups, seasons: league({ id: "t", name: "Club R" }) });
    expect(other.games.some((game) => game.id === "fx")).toBe(false);
    // And says which it left out and which the league kept, for the lists that read the store.
    expect([...picked.removed, ...picked.leagueKept]).toEqual(["F"]);
    expect(picked.leagueKept.has("F")).toBe(true);
    expect([...other.removed]).toEqual(["F"]);
    expect(other.leagueKept.size).toBe(0);
    // Pool health asks the same of every year with a season on a page, the League pass alone.
    const ask = (seasons: Record<string, LeagueSeasonData>, marks: AutoRemovals = BOTH) =>
      leagueKeptClubs({
        ageGroups: groups,
        teams,
        gamesOfYear: () => yearGames,
        readSeason: readerOf(seasons),
        autoRemoved: marks,
      });
    expect([...ask(league({ id: "t", name: "Foxes", scoutTeamId: "F" }))]).toEqual(["F"]);
    expect([...ask(league({ id: "t", name: "Club F" }))]).toEqual(["F"]);
    expect(ask(league({ id: "t", name: "Club R" })).size).toBe(0);
    expect(ask(league({ id: "t", name: "Club F" }), NO_REMOVALS).size).toBe(0);
    // And every club the league links, marked or not, which the tidy's not-a-team step keeps.
    const linked = (seasons: Record<string, LeagueSeasonData>, onPages = groups) =>
      leagueLinkedClubs({
        ageGroups: onPages,
        teams,
        gamesOfYear: () => yearGames,
        readSeason: readerOf(seasons),
      });
    expect(linked(league({ id: "t", name: "Foxes", scoutTeamId: "F" })).has("F")).toBe(true);
    expect(linked(league({ id: "t", name: "Club R" })).has("R")).toBe(true);
    expect(linked(league({ id: "t", name: "Club R" })).has("F")).toBe(false);
    // None with no season on a page, whatever the seasons hold.
    expect(linked(league({ id: "t", name: "Foxes", scoutTeamId: "F" }), [page]).size).toBe(0);
  });

  it("is left out of a year's archive as the board leaves it out", () => {
    // F beats R in F's copy, which holds R's own row, filed by name against stand-in X and
    // claimed; Q's own row, filed by name against F, is claimed into Z's copy of Z v Q, and keeps F
    // as a name only. The archive is frozen from what the board rates, not every stored game.
    const roster = [...teams, pulled("Q", "gcQ"), pulled("Z", "gcZ"), pulled("W", "gcW")];
    const g = (id: string, a: string, b: string, as: number, bs: number, day: number) => ({
      ...played(id, a, b),
      teamAScore: as,
      teamBScore: bs,
      date: `2026-09-${10 + day}`,
      source: { kind: "gamechanger" as const, teamId: `gc${a}`, gameId: id },
    });
    const stored = [
      {
        ...g("fr", "F", "R", 12, 0, 1),
        alsoRows: [
          {
            teamId: "gcR",
            gameId: "r1",
            ownScore: 0,
            opponentScore: 12,
            onSideB: true,
            filedAgainst: "X",
          },
        ],
      },
      g("rq", "R", "Q", 5, 4, 2),
      g("qw", "Q", "W", 6, 5, 3),
      g("wz", "W", "Z", 3, 3, 4),
      {
        ...g("zq", "Z", "Q", 3, 2, 5),
        alsoRows: [
          {
            teamId: "gcQ",
            gameId: "q1",
            ownScore: 2,
            opponentScore: 3,
            onSideB: true,
            filedAgainst: "F",
          },
        ],
      },
    ];
    const all = deriveAllKnown({
      ageGroups: [page],
      teams: roster,
      yearGames: stored,
      readSeason: readerOf({}),
      autoRemoved: BOTH,
    });
    expect(all.teams.find((team) => team.id === "F")?.nameOnly).toBe(true);
    expect(all.games.some((game) => game.teamAId === "R" && game.teamBId === "X")).toBe(true);
    const ratingOf = (rows: readonly { teamName: string; rating: number }[]) =>
      rows.find((row) => row.teamName === "Club R")?.rating;
    const board = buildTeamRankings("p", all.teams, all.games, undefined, [page], "fall");
    const pool = { ageGroups: [page], teams: roster, games: stored };
    const done = archiveSquadYear(2027, archivedFrom(all, pool), pool, "at");
    const fall = done.seasons.find((season) => season.segment === "fall");
    expect(ratingOf(fall?.rows ?? [])).toBe(ratingOf(board));
    // Q's row stood back up is the pool's own, not a game League Standings carried in.
    expect(done.archivedLeagueGames).toBe(0);
  });

  it("leaves no game naming it, its own row another club's copy claimed included", () => {
    // R's copy of R v F holds F's own row, filed by name against stand-in X and claimed.
    const held: ScoutGame = {
      ...played("rf", "R", "F"),
      source: { kind: "gamechanger", teamId: "gcR", gameId: "r1" },
      alsoRows: [
        {
          teamId: "gcF1",
          gameId: "f1",
          ownScore: 2,
          opponentScore: 4,
          onSideB: true,
          filedAgainst: "X",
        },
      ],
    };
    const all = deriveAllKnown({
      ageGroups: [page],
      teams,
      yearGames: [held, played("rx", "R", "X")],
      readSeason: readerOf({}),
      autoRemoved: BOTH,
    });
    expect(all.teams.some((team) => team.id === "F")).toBe(false);
    expect(all.games.filter((game) => game.teamAId === "F" || game.teamBId === "F")).toEqual([]);
  });
});

describe("the games on a pool's pages", () => {
  const games = fixture.games.slice(0, 50);

  it("is the very same list when every game is on them", () => {
    const pages = [...new Set(games.map((game) => game.ageGroupId))];
    expect(gamesOnPages(games, pages)).toBe(games);
  });

  it("keeps those games, in order, when some are not", () => {
    const page = games[0]!.ageGroupId;
    expect(gamesOnPages(games, [page])).toEqual(games.filter((game) => game.ageGroupId === page));
    expect(gamesOnPages(games, [])).toEqual([]);
  });
});
