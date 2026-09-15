import { describe, expect, it } from "vitest";
import {
  advancedAgeGroup,
  AGE_LEVELS,
  ageGroupChain,
  ageGroupSeason,
  findAgeGroupForSeason,
  formatAgeGroupName,
  MAX_AGE_LEVEL,
  MIN_SEASON_YEAR,
  nextSeason,
  parseAgeGroupName,
  seasonAtAge,
  seasonYearOptions,
  buildScoutingReport,
  buildTeamRankings,
  collapseSameGames,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  findDuplicateGame,
  isScoutGamePlayed,
  predictMatchup,
  UNKNOWN_STATE,
  countsTowardRating,
  externalResultsForSeason,
  filterRankingsByState,
  normalizeState,
  statesInUse,
  findSimilarTeam,
  gamesForTeam,
  isPlaceholderName,
  renameScoutTeam,
  resolveOrCreateTeam,
  cleanTeamName,
  pulledGcTeamIds,
  teamNameKey,
  teamNameSuggestions,
  teamsInAgeGroup,
  ageGroupLevel,
  ageGroupYear,
  createScoutTeam,
  findGcLink,
  findTeamsByAvatarKey,
  gameSideLevels,
  gcSeasonLabel,
  isRankedAgeLevel,
  matchExistingGame,
  mergeScoutTeams,
  MIN_RANKED_AGE_LEVEL,
  rankingPoolGroupIds,
  squadYearForGcSeason,
  teamHomeAgeLevel,
  teamRecordInPool,
  teamsInRankingPool,
  unlinkGcTeam,
  type AgeGroup,
  type GcTeamLink,
  type LeagueSeasonSnapshot,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

const team = (id: string, name: string, isMine?: boolean): ScoutTeam => ({
  id,
  name,
  ...(isMine ? { isMine: true } : {}),
});

const game = (
  teamAId: string,
  teamBId: string,
  teamAScore: number | undefined,
  teamBScore: number | undefined,
  ageGroupId = "ag1"
): ScoutGame => ({
  id: `${teamAId}-${teamBId}-${Math.random()}`,
  teamAId,
  teamBId,
  ageGroupId,
  ...(teamAScore !== undefined ? { teamAScore } : {}),
  ...(teamBScore !== undefined ? { teamBScore } : {}),
});

describe("cleanTeamName", () => {
  it("drops an age label wherever it appears", () => {
    expect(cleanTeamName("South Lexington Red 9u")).toBe("South Lexington Red");
    expect(cleanTeamName("Velocirabbits 9U")).toBe("Velocirabbits");
    expect(cleanTeamName("NV Stars 9u Scout")).toBe("NV Stars Scout");
    expect(cleanTeamName("12U Thunder")).toBe("Thunder");
    expect(cleanTeamName("U10 Rockets")).toBe("Rockets");
    expect(cleanTeamName("Thunder - 9U")).toBe("Thunder");
  });

  it("drops the division letters that run on from the age", () => {
    expect(cleanTeamName("9UA Tortugas")).toBe("Tortugas");
    expect(cleanTeamName("Bandits 10UAA")).toBe("Bandits");
    expect(cleanTeamName("Rangers 9ud")).toBe("Rangers");
  });

  it("leaves names that only look like an age label alone", () => {
    expect(cleanTeamName("The 9ers")).toBe("The 9ers");
    // "12 U" here is the start of "United", not an age level.
    expect(cleanTeamName("Lexington 12 United")).toBe("Lexington 12 United");
    // A word running straight on from the age is a word, not division letters.
    expect(cleanTeamName("NV Stars 9u Scout")).toBe("NV Stars Scout");
    expect(cleanTeamName("9Ublah Raiders")).toBe("9Ublah Raiders");
  });

  it("keeps something when the name is nothing but an age label", () => {
    expect(cleanTeamName("9U")).toBe("9U");
  });

  it("drops an aside in brackets", () => {
    expect(cleanTeamName("Trash Pandas (Black)")).toBe("Trash Pandas");
    expect(cleanTeamName("Aces 11U (Fall 2026)")).toBe("Aces");
    expect(cleanTeamName("(Pool B) Rampage")).toBe("Rampage");
    // An aside inside an aside still comes apart.
    expect(cleanTeamName("Comets (12U (AA))")).toBe("Comets");
  });

  /**
   * A dash suffix is how a club tells its own squads apart, so it is the one thing standing
   * between two teams that would otherwise read alike. It stays.
   */
  it("keeps a dash suffix, which is what tells two squads of one club apart", () => {
    expect(cleanTeamName("9U North Oldham Knights - Navy")).toBe("North Oldham Knights - Navy");
    expect(cleanTeamName("Frisco Dodgers - Gomez 11UAA")).toBe("Frisco Dodgers - Gomez");
    expect(teamNameKey("Knights - Navy")).not.toBe(teamNameKey("Knights - Red"));
  });

  it("keeps something when the name is nothing but an aside", () => {
    expect(cleanTeamName("(9U)")).toBe("(9U)");
  });
});

describe("pulledGcTeamIds", () => {
  const linked = (id: string, ...gcIds: string[]): ScoutTeam => ({
    id,
    name: id,
    gcTeams: gcIds.map((teamId) => ({
      teamId,
      name: id,
      ageGroupId: "ag1",
      importedAt: "2026-09-14T12:00:00.000Z",
    })),
  });

  it("collects every id a team was pulled as", () => {
    // A club pulled across two seasons carries two ids, and both have been fetched.
    const ids = pulledGcTeamIds([linked("S-ACES", "gcFall", "gcSpring"), linked("S-COMT", "gcC")]);
    expect([...ids].sort()).toEqual(["gcC", "gcFall", "gcSpring"]);
  });

  it("is empty for a pool of teams nobody pulled", () => {
    expect(pulledGcTeamIds([{ id: "S-ACES", name: "Aces" }]).size).toBe(0);
  });

  it("leaves a list of new teams alone and subtracts the rest", () => {
    const pulled = pulledGcTeamIds([linked("S-ACES", "gcA")]);
    const list = ["gcA", "gcB", "gcC"];
    expect(list.filter((id) => !pulled.has(id))).toEqual(["gcB", "gcC"]);
  });
});

describe("teamsInAgeGroup", () => {
  it("keeps a team out of an age group it has no games in", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 5, 2, "ag1"), game("C", "A", 3, 4, "ag2")];

    const inAg1 = teamsInAgeGroup("ag1", teams, games).map((t) => t.id);
    expect(inAg1.sort()).toEqual(["A", "B"]);
    // "Cubs" was only ever logged under ag2, so it does not appear in ag1's ranking.
    expect(inAg1).not.toContain("C");
  });

  it("does not rank a team on the strength of a game it has not played", () => {
    // A scheduled game puts an opponent in the log, not in the table. Ranking them on it would
    // show a 0-0 · +0.0 row that says nothing and pushes teams with real results down.
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", undefined, undefined, "ag1")];
    expect(teamsInAgeGroup("ag1", teams, games)).toEqual([]);
  });
});

const ageGroup = (id: string, continuesFromId?: string): AgeGroup => ({
  id,
  name: id.toUpperCase(),
  seasonIds: [],
  ...(continuesFromId ? { continuesFromId } : {}),
});

describe("ageGroupChain", () => {
  it("walks back through the groups an age group continues from, nearest first", () => {
    const groups = [ageGroup("u11", "u10"), ageGroup("u10", "u9"), ageGroup("u9")];
    expect(ageGroupChain("u11", groups)).toEqual(["u11", "u10", "u9"]);
  });

  it("is just the group itself when it continues from nothing", () => {
    expect(ageGroupChain("u9", [ageGroup("u9")])).toEqual(["u9"]);
  });

  it("does not loop forever when the chain points back at itself", () => {
    const groups = [ageGroup("a", "b"), ageGroup("b", "a")];
    expect(ageGroupChain("a", groups)).toEqual(["a", "b"]);
  });

  it("stops at a group that no longer exists", () => {
    expect(ageGroupChain("u10", [ageGroup("u10", "deleted")])).toEqual(["u10", "deleted"]);
  });
});

describe("teamNameSuggestions", () => {
  const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];

  it("does not suggest a team from a concurrent age group", () => {
    // The 9U and 11U squads run at the same time and share a roster store, but play nobody in
    // common — picking a 9U name while logging an 11U game is always a mistake.
    const games = [game("A", "B", 5, 2, "u9"), game("A", "C", 3, 4, "u11")];
    const groups = [ageGroup("u9"), ageGroup("u11")];

    const names = teamNameSuggestions("u11", groups, teams, games).map((t) => t.name);
    expect(names.sort()).toEqual(["Aces", "Cubs"]);
    expect(names).not.toContain("Bears");
  });

  it("carries a squad's opponents forward into the age group that continues from it", () => {
    const games = [game("A", "B", 5, 2, "u9")];
    const groups = [ageGroup("u9"), ageGroup("u10", "u9")];

    const names = teamNameSuggestions("u10", groups, teams, games).map((t) => t.name);
    expect(names.sort()).toEqual(["Aces", "Bears"]);
  });

  it("does not carry names backwards, from the newer group into the older one", () => {
    const games = [game("A", "C", 5, 2, "u10")];
    const groups = [ageGroup("u9"), ageGroup("u10", "u9")];
    expect(teamNameSuggestions("u9", groups, teams, games)).toEqual([]);
  });

  it("suggests a scheduled opponent, not just one already played", () => {
    const games = [game("A", "B", undefined, undefined, "u9")];
    expect(teamNameSuggestions("u9", [ageGroup("u9")], teams, games)).toHaveLength(2);
  });
});

describe("findDuplicateGame", () => {
  const existing: ScoutGame = {
    id: "g1",
    teamAId: "A",
    teamBId: "B",
    teamAScore: 7,
    teamBScore: 3,
    ageGroupId: "ag1",
    date: "2026-08-22",
  };

  it("matches the same game entered again, in either team order", () => {
    const sameOrder: ScoutGame = { ...existing, id: "g2" };
    expect(findDuplicateGame(sameOrder, [existing])).toBe(existing);

    const swapped: ScoutGame = {
      id: "g3",
      teamAId: "B",
      teamBId: "A",
      teamAScore: 3,
      teamBScore: 7,
      ageGroupId: "ag1",
      date: "2026-08-22",
    };
    expect(findDuplicateGame(swapped, [existing])).toBe(existing);
  });

  it("does not match a different date, score, or age group", () => {
    expect(findDuplicateGame({ ...existing, id: "g2", date: "2026-08-23" }, [existing])).toBeNull();
    expect(findDuplicateGame({ ...existing, id: "g2", teamAScore: 6 }, [existing])).toBeNull();
    expect(findDuplicateGame({ ...existing, id: "g2", ageGroupId: "ag2" }, [existing])).toBeNull();
  });

  it("matches two scoreless scheduled games on the same date", () => {
    const scheduled: ScoutGame = { id: "s1", teamAId: "A", teamBId: "B", ageGroupId: "ag1" };
    expect(findDuplicateGame({ ...scheduled, id: "s2" }, [scheduled])).toBe(scheduled);
  });

  it("never matches a game against itself", () => {
    expect(findDuplicateGame(existing, [existing])).toBeNull();
  });
});

describe("resolveOrCreateTeam", () => {
  it("matches an existing team case-insensitively and trims whitespace", () => {
    const teams = [team("S-ICEC", "Ice Cats")];
    const result = resolveOrCreateTeam("  ice cats  ", teams);
    expect(result.teamId).toBe("S-ICEC");
    expect(result.teams).toBe(teams);
  });

  it("creates a new team with a prefixed id that cannot collide with a league id", () => {
    const result = resolveOrCreateTeam("Thunder Hawks", []);
    expect(result.teamId.startsWith("S-")).toBe(true);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]!.name).toBe("Thunder Hawks");
  });

  it("disambiguates two different names that would otherwise collide", () => {
    const first = resolveOrCreateTeam("Ice Cats", []);
    const second = resolveOrCreateTeam("Ice Castles", first.teams);
    expect(second.teamId).not.toBe(first.teamId);
    expect(second.teams).toHaveLength(2);
  });

  it("stores a new team without its age label", () => {
    const result = resolveOrCreateTeam("South Lexington Red 9u", []);
    expect(result.teams[0]!.name).toBe("South Lexington Red");
  });

  it("treats the same club at different age levels as one team", () => {
    const first = resolveOrCreateTeam("Velocirabbits 9U", []);
    const nextYear = resolveOrCreateTeam("Velocirabbits 10U", first.teams);
    expect(nextYear.teamId).toBe(first.teamId);
    expect(nextYear.teams).toHaveLength(1);
  });

  it("heals a name stored before age labels were stripped, keeping its capitalization", () => {
    const stored = [team("S-VELO", "VelociRabbits 9U")];
    const result = resolveOrCreateTeam("velocirabbits", stored);
    expect(result.teamId).toBe("S-VELO");
    expect(result.teams[0]!.name).toBe("VelociRabbits");
  });
});

describe("isScoutGamePlayed", () => {
  it("is true only when both scores are present", () => {
    expect(isScoutGamePlayed(game("A", "B", 5, 3))).toBe(true);
    expect(isScoutGamePlayed(game("A", "B", undefined, undefined))).toBe(false);
  });
});

describe("buildTeamRankings", () => {
  it("ranks a dominant team above a weak one and computes correct W-L-T", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 10, 2), game("A", "C", 8, 1), game("B", "C", 4, 4)];
    const rows = buildTeamRankings("ag1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));

    expect(byId.get("A")!.rank).toBe(1);
    expect(byId.get("A")!.record).toBe("2-0");
    expect(byId.get("B")!.record).toBe("0-1-1");
    expect(byId.get("A")!.rating).toBeGreaterThan(byId.get("C")!.rating);
  });

  /**
   * A club known only from somebody else's schedule has no id anybody pulled and a record made of
   * whichever fraction of its season faced a team that was. Ranking that against clubs whose whole
   * season is here is not a comparison, so it is left out of the table — while the game it played
   * still counts for the club that played it.
   */
  it("leaves a name-only club out of the table but keeps its game in the fit", () => {
    const teams = [
      team("A", "Aces"),
      team("B", "Bears"),
      { id: "N", name: "Nomads", nameOnly: true as const },
    ];
    const games = [game("A", "B", 6, 2), game("A", "N", 9, 1), game("B", "N", 3, 2)];
    const rows = buildTeamRankings("ag1", teams, games);

    expect(rows.map((row) => row.teamId).sort()).toEqual(["A", "B"]);
    // Beating the Nomads is still a win, and still counted.
    expect(rows.find((row) => row.teamId === "A")!.record).toBe("2-0");
    expect(rows.find((row) => row.teamId === "B")!.record).toBe("1-1");
  });

  it("ranks a club the moment somebody vouches for it", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("N", "Nomads")];
    const games = [game("A", "B", 6, 2), game("A", "N", 9, 1), game("B", "N", 3, 2)];
    // The same pool with the mark off — a club pulled by id, or one added by hand.
    expect(
      buildTeamRankings("ag1", teams, games)
        .map((row) => row.teamId)
        .sort()
    ).toEqual(["A", "B", "N"]);
  });

  it("ignores scheduled games with no score yet", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", undefined, undefined)];
    const rows = buildTeamRankings("ag1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get("A")!.games).toBe(0);
    expect(byId.get("A")!.record).toBe("0-0");
  });

  it("only rates games tagged with the requested age group", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", 10, 0, "ag1"), game("A", "B", 0, 10, "ag2")];
    const rows = buildTeamRankings("ag1", teams, games);
    const a = rows.find((row) => row.teamId === "A")!;
    expect(a.record).toBe("1-0");
  });

  it("never lets isMine influence the rating: swapping it changes nothing but the flag", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 6, 2), game("B", "C", 5, 3), game("A", "C", 7, 1)];

    const withMine = buildTeamRankings(
      "ag1",
      teams.map((t) => (t.id === "B" ? { ...t, isMine: true } : t)),
      games
    );
    const withoutMine = buildTeamRankings("ag1", teams, games);

    withMine.forEach((row) => {
      const other = withoutMine.find((r) => r.teamId === row.teamId)!;
      expect(row.rating).toBeCloseTo(other.rating, 10);
      expect(row.rank).toBe(other.rank);
    });
  });

  it("flags the age group's own team, not the legacy global one", () => {
    const teams = [team("A", "Aces", true), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 6, 2), game("B", "C", 5, 3)];

    const rows = buildTeamRankings("ag1", teams, games, "B");
    expect(rows.filter((row) => row.isMine).map((row) => row.teamId)).toEqual(["B"]);
  });

  it("falls back to the legacy isMine flag when the age group has no team of its own", () => {
    const teams = [team("A", "Aces", true), team("B", "Bears")];
    const games = [game("A", "B", 6, 2)];

    const rows = buildTeamRankings("ag1", teams, games);
    expect(rows.find((row) => row.isMine)?.teamId).toBe("A");
  });

  it("does not let the age group's own team influence the rating either", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 6, 2), game("B", "C", 5, 3), game("A", "C", 7, 1)];

    const withMine = buildTeamRankings("ag1", teams, games, "B");
    const withoutMine = buildTeamRankings("ag1", teams, games);

    withMine.forEach((row) => {
      const other = withoutMine.find((r) => r.teamId === row.teamId)!;
      expect(row.rating).toBeCloseTo(other.rating, 10);
      expect(row.rank).toBe(other.rank);
    });
  });
});

describe("deriveLeagueScoutGames", () => {
  const fallSeason: LeagueSeasonSnapshot = {
    seasonId: "fall2026",
    teams: [
      { id: "L1", name: "Ice Cats" },
      { id: "L2", name: "Rockets" },
    ],
    matchups: [{ id: "g1", date: "10/1", away: "L1", home: "L2" }],
    logs: {
      g1: {
        awayRuns: "5",
        awayHits: "8",
        awayK: "4",
        homeRuns: "2",
        homeHits: "3",
        homeK: "6",
        innings: "6",
        isFinal: true,
      },
    },
  };
  const springSeason: LeagueSeasonSnapshot = {
    seasonId: "spring2027",
    // Same real-world teams, but a fresh per-season id namespace (as League Standings actually
    // generates them) — resolution must go by name, not by these ids.
    teams: [
      { id: "X1", name: "Ice Cats" },
      { id: "X2", name: "Comets" },
    ],
    matchups: [{ id: "g2", date: "4/1", away: "X1", home: "X2" }],
    logs: {
      g2: {
        awayRuns: "4",
        awayHits: "5",
        awayK: "3",
        homeRuns: "6",
        homeHits: "7",
        homeK: "2",
        innings: "6",
        isFinal: true,
      },
    },
  };

  it("carries over the whole schedule — a completed game gets its score, an unfinished one comes across as scheduled", () => {
    const unfinished: LeagueSeasonSnapshot = {
      seasonId: "fall2026",
      teams: fallSeason.teams,
      matchups: [{ id: "g3", date: "10/8", away: "L1", home: "L2" }],
      logs: {
        g3: {
          awayRuns: "",
          awayHits: "",
          awayK: "",
          homeRuns: "",
          homeHits: "",
          homeK: "",
          innings: "6",
          isFinal: false,
        },
      },
    };

    const result = deriveLeagueScoutGames("ag1", [fallSeason, unfinished], []);
    expect(result.games).toHaveLength(2);
    expect(result.teams.map((t) => t.name).sort()).toEqual(["Ice Cats", "Rockets"]);

    const finished = result.games.find((g) => g.id === "league_fall2026_g1")!;
    expect(finished.ageGroupId).toBe("ag1");
    expect(finished.teamAScore).toBe(5);
    expect(finished.teamBScore).toBe(2);
    expect(isScoutGamePlayed(finished)).toBe(true);

    const scheduled = result.games.find((g) => g.id === "league_fall2026_g3")!;
    expect(scheduled.ageGroupId).toBe("ag1");
    expect(scheduled.teamAScore).toBeUndefined();
    expect(scheduled.teamBScore).toBeUndefined();
    expect(isScoutGamePlayed(scheduled)).toBe(false);
  });

  it("merges multiple seasons in the same age group and resolves the same team name to one id across them", () => {
    const result = deriveLeagueScoutGames("ag1", [fallSeason, springSeason], []);
    expect(result.games).toHaveLength(2);
    // "Ice Cats" appears in both seasons under different League Standings ids — resolved once.
    const iceCats = result.teams.filter((t) => t.name === "Ice Cats");
    expect(iceCats).toHaveLength(1);
    const iceCatsGames = result.games.filter(
      (g) => g.teamAId === iceCats[0]!.id || g.teamBId === iceCats[0]!.id
    );
    expect(iceCatsGames).toHaveLength(2);
  });

  it("resolves a league team into an existing scout team with the same name instead of duplicating it", () => {
    const existing = [team("S-ICEC", "Ice Cats")];
    const result = deriveLeagueScoutGames("ag1", [fallSeason], existing);
    expect(result.teams.filter((t) => t.name === "Ice Cats")).toHaveLength(1);
    expect(result.games[0]!.teamAId).toBe("S-ICEC");
  });
});

describe("predictMatchup", () => {
  it("returns ~50% for equal ratings", () => {
    const { winProbA } = predictMatchup(2, 2);
    expect(winProbA).toBeCloseTo(0.5, 2);
  });

  it("favors the higher-rated team, clamped within [0.08, 0.92]", () => {
    const close = predictMatchup(3, 1);
    expect(close.winProbA).toBeGreaterThan(0.5);
    expect(close.winProbA).toBeLessThanOrEqual(0.92);

    const blowout = predictMatchup(50, -50);
    expect(blowout.winProbA).toBeLessThanOrEqual(0.92);
    expect(blowout.winProbB).toBeCloseTo(0.08, 6);
  });
});

describe("buildScoutingReport", () => {
  it("returns one tiered preview per other team, sorted by opponent rank", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 10, 1), game("A", "C", 9, 2), game("B", "C", 5, 4)];
    const rows = buildTeamRankings("ag1", teams, games);

    const report = buildScoutingReport("C", rows);
    expect(report).toHaveLength(2);
    expect(report.map((r) => r.opponentId)).toEqual(["A", "B"]);
    expect(report.every((r) => ["Favored", "Toss-up", "Underdog"].includes(r.tier))).toBe(true);
  });

  it("returns an empty list for an unknown team id", () => {
    expect(buildScoutingReport("nope", [])).toEqual([]);
  });
});

describe("dedupeLeagueFixtures", () => {
  const leagueRow = (
    id: string,
    teamAId: string,
    teamBId: string,
    date: string,
    teamAScore?: number,
    teamBScore?: number
  ): ScoutGame => ({
    ...game(teamAId, teamBId, teamAScore, teamBScore),
    id: `league_spring2027_${id}`,
    date,
  });

  const storedRow = (
    id: string,
    teamAId: string,
    teamBId: string,
    date: string,
    teamAScore?: number,
    teamBScore?: number
  ): ScoutGame => ({
    ...game(teamAId, teamBId, teamAScore, teamBScore),
    id: `gc_t1_${id}`,
    date,
  });

  it("drops the pulled copy of a league game the league has already scored", () => {
    // The league's own book is authoritative for its own games, and the pull is a second copy of
    // the same fixture rather than a second game.
    const league = leagueRow("m1", "A", "B", "4/12", 7, 3);
    const pulled = storedRow("g1", "A", "B", "2027-04-12", 7, 3);

    const out = dedupeLeagueFixtures([league, pulled]);
    expect(out).toEqual([league]);
  });

  it("counts a fixture once in the ratings after the duplicate is dropped", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const pool = dedupeLeagueFixtures([
      leagueRow("m1", "A", "B", "4/12", 7, 3),
      storedRow("g1", "A", "B", "2027-04-12", 7, 3),
    ]);
    const rows = buildTeamRankings("ag1", teams, pool);
    expect(rows.map((row) => row.games)).toEqual([1, 1]);
    expect(rows.find((row) => row.teamId === "A")?.record).toBe("1-0");
  });

  it("keeps both when the same pair met on another day", () => {
    // Two league opponents can meet at a tournament outside league play. That is a real second
    // game and must not be folded into the league fixture.
    const league = leagueRow("m1", "A", "B", "4/12", 7, 3);
    const tournament = storedRow("g1", "A", "B", "2027-06-01", 2, 5);

    expect(dedupeLeagueFixtures([league, tournament])).toEqual([league, tournament]);
  });

  it("keeps the pulled result when the league row has no score yet", () => {
    // The pull is the only evidence the game was played, so it stands in for the empty league row.
    const league = leagueRow("m1", "A", "B", "4/12");
    const pulled = storedRow("g1", "B", "A", "2027-04-12", 3, 7);

    expect(dedupeLeagueFixtures([league, pulled])).toEqual([pulled]);
  });

  it("resolves a doubleheader by count rather than by pairing rows off", () => {
    const leagueOne = leagueRow("m1", "A", "B", "4/12", 7, 3);
    const leagueTwo = leagueRow("m2", "A", "B", "4/12", 1, 2);
    const pulledOne = storedRow("g1", "A", "B", "2027-04-12", 7, 3);
    const pulledTwo = storedRow("g2", "A", "B", "2027-04-12", 1, 2);

    const bothScored = dedupeLeagueFixtures([leagueOne, leagueTwo, pulledOne, pulledTwo]);
    expect(bothScored).toEqual([leagueOne, leagueTwo]);

    // With the league rows still empty the two pulled rows are the only results there are.
    const empty = [leagueRow("m1", "A", "B", "4/12"), leagueRow("m2", "A", "B", "4/12")];
    expect(dedupeLeagueFixtures([...empty, pulledOne, pulledTwo])).toEqual([pulledOne, pulledTwo]);
  });

  it("leaves a league row over for a fixture no stored row stands in for", () => {
    // Two league games that day, one pulled result. The pulled row stands in for one of them; the
    // other is left alone so the fixture nobody has a result for still shows as scheduled.
    const first = leagueRow("m1", "A", "B", "4/12");
    const second = leagueRow("m2", "A", "B", "4/12");
    const pulled = storedRow("g1", "A", "B", "2027-04-12", 7, 3);

    const out = dedupeLeagueFixtures([first, second, pulled]);
    expect(out).toHaveLength(2);
    expect(out.filter((row) => row.id.startsWith("league_"))).toHaveLength(1);
    expect(out).toContain(pulled);
  });

  it("leaves two hand-logged games on one day alone when no league row claims them", () => {
    // A doubleheader somebody logged twice on purpose. Only a league row triggers a collapse.
    const first = storedRow("g1", "A", "B", "2027-04-12", 7, 3);
    const second = storedRow("g2", "A", "B", "2027-04-12", 1, 2);

    expect(dedupeLeagueFixtures([first, second])).toEqual([first, second]);
  });

  it("hands back the same array when there is nothing to collapse", () => {
    const games = [
      storedRow("g1", "A", "B", "2027-04-12", 7, 3),
      storedRow("g2", "A", "C", "2027-04-19", 5, 4),
    ];
    expect(dedupeLeagueFixtures(games)).toBe(games);
  });

  it("does not fold together games filed under different age groups", () => {
    const league = { ...leagueRow("m1", "A", "B", "4/12", 7, 3), ageGroupId: "ag1" };
    const pulled = { ...storedRow("g1", "A", "B", "2027-04-12", 7, 3), ageGroupId: "ag2" };

    expect(dedupeLeagueFixtures([league, pulled])).toEqual([league, pulled]);
  });

  it("leaves a dateless game alone, since nothing says which fixture it is", () => {
    const league = leagueRow("m1", "A", "B", "", 7, 3);
    const pulled = storedRow("g1", "A", "B", "", 7, 3);

    expect(dedupeLeagueFixtures([league, pulled])).toEqual([league, pulled]);
  });
});

describe("externalResultsForSeason", () => {
  const leagueTeams = [
    { id: "L-ACE", name: "Aces" },
    { id: "L-BEA", name: "Bears" },
  ];
  const groups: AgeGroup[] = [
    { id: "ag1", name: "2027", seasonIds: ["spring2027"] },
    { id: "ag2", name: "Other", seasonIds: ["fall2030"] },
  ];
  const teams = [team("A", "Aces"), team("B", "Bears"), team("X", "Travel Club")];

  it("maps a team to its league id by name and reports the margin", () => {
    const games = [game("A", "B", 7, 3, "ag1")];
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, [])).toEqual([
      { home: "L-ACE", away: "L-BEA", homeMargin: 4, neutral: true },
    ]);
  });

  it("never counts a game that came from the league schedule twice", () => {
    // deriveLeagueScoutGames carries the league's own games into Team Rankings. Feeding them back
    // would double the weight of every league result in the league's own forecast.
    const games: ScoutGame[] = [
      { ...game("A", "B", 7, 3, "ag1"), id: "league_spring2027_m1" },
      game("A", "B", 5, 4, "ag1"),
    ];
    const out = externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, []);
    expect(out).toEqual([{ home: "L-ACE", away: "L-BEA", homeMargin: 1, neutral: true }]);
  });

  it("keeps an outside opponent under an id of its own", () => {
    // The point of including these: the model estimates how good the travel club was, rather than
    // assuming, which is what makes a shared opponent informative.
    const games = [game("A", "X", 2, 6, "ag1")];
    const out = externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, []);
    expect(out).toHaveLength(1);
    expect(out[0]?.home).toBe("L-ACE");
    expect(out[0]?.away).not.toBe("L-BEA");
    expect(out[0]?.away).toContain("X");
    expect(out[0]?.homeMargin).toBe(-4);
  });

  it("ignores age groups that do not include this season", () => {
    const games = [game("A", "B", 7, 3, "ag2")];
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, [])).toEqual(
      []
    );
  });

  it("returns nothing when no age group is linked to the season at all", () => {
    const games = [game("A", "B", 7, 3, "ag1")];
    expect(externalResultsForSeason("winter2099", groups, teams, games, leagueTeams, [])).toEqual(
      []
    );
  });

  it("skips a scheduled game that has no score yet", () => {
    const games = [game("A", "B", undefined, undefined, "ag1")];
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, [])).toEqual(
      []
    );
  });

  it("skips a pulled game that is really one of this season's own fixtures", () => {
    // A GameChanger row for a league game has no `league_` id to give it away, so without the
    // season's schedule it would be fed back as an outside result and counted twice.
    const games: ScoutGame[] = [
      { ...game("A", "B", 7, 3, "ag1"), id: "gc_t1_g1", date: "2027-04-12" },
    ];
    const fixtures = [{ away: "Bears", home: "Aces", date: "4/12" }];
    expect(
      externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, fixtures)
    ).toEqual([]);
  });

  it("still returns the same pair's tournament game on another date", () => {
    const games: ScoutGame[] = [
      { ...game("A", "B", 7, 3, "ag1"), id: "gc_t1_g2", date: "2027-06-01" },
    ];
    const fixtures = [{ away: "Aces", home: "Bears", date: "4/12" }];
    expect(
      externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, fixtures)
    ).toEqual([{ home: "L-ACE", away: "L-BEA", homeMargin: 4, neutral: true }]);
  });

  it("matches names across age labels, as everything else here does", () => {
    const aged = [team("A", "Aces 9U"), team("B", "Bears")];
    const games = [game("A", "B", 7, 3, "ag1")];
    const out = externalResultsForSeason("spring2027", groups, aged, games, leagueTeams, []);
    expect(out[0]?.home).toBe("L-ACE");
  });
});

describe("renameScoutTeam", () => {
  const teams = [team("A", "Aces"), team("B", "Bears"), team("T", "TBD")];

  it("renames in place when the name is free", () => {
    const out = renameScoutTeam("A", "Aces Red", teams, [], []);
    expect(out.mergedInto).toBeNull();
    expect(out.teams.find((t) => t.id === "A")?.name).toBe("Aces Red");
  });

  it("strips an age label from the new name, like every other entry point", () => {
    const out = renameScoutTeam("A", "Aces 10U", teams, [], []);
    expect(out.teams.find((t) => t.id === "A")?.name).toBe("Aces");
  });

  it("merges into the existing team when the name is taken, routing its games over", () => {
    // This is how a placeholder gets sent to the team it really was.
    const games = [game("T", "B", 4, 9, "ag1"), game("A", "B", 3, 2, "ag1")];
    const out = renameScoutTeam("T", "Aces", teams, games, []);

    expect(out.mergedInto?.id).toBe("A");
    expect(out.teams.map((t) => t.id).sort()).toEqual(["A", "B"]);
    expect(out.games).toHaveLength(2);
    expect(out.games[0]?.teamAId).toBe("A");
    expect(out.games[0]?.teamBId).toBe("B");
    // The untouched game keeps its identity, so React does not see a new object for nothing.
    expect(out.games[1]).toBe(games[1]);
  });

  it("drops a game between the two teams being merged rather than keeping a self-match", () => {
    const games = [game("T", "A", 4, 9, "ag1"), game("T", "B", 1, 0, "ag1")];
    const out = renameScoutTeam("T", "Aces", teams, games, []);
    expect(out.droppedGames).toBe(1);
    expect(out.games).toHaveLength(1);
    expect(out.games[0]?.teamAId).toBe("A");
  });

  it("refuses a name that is empty once the age label comes off", () => {
    const out = renameScoutTeam("A", "   ", teams, [], []);
    expect(out.teams).toBe(teams);
    expect(out.mergedInto).toBeNull();
  });

  it("is a no-op rename when the name only differs by case or age label", () => {
    const out = renameScoutTeam("A", "aces 9u", teams, [], []);
    // Matching itself is not a merge; the stored spelling just updates.
    expect(out.mergedInto).toBeNull();
    expect(out.teams.find((t) => t.id === "A")?.name).toBe("aces");
  });
});

describe("gamesForTeam", () => {
  it("returns every game the team appears in, newest first, across age groups", () => {
    const games = [
      { ...game("A", "B", 1, 2, "ag1"), date: "2026-08-01" },
      { ...game("C", "A", 3, 4, "ag2"), date: "2026-09-01" },
      { ...game("B", "C", 5, 6, "ag1"), date: "2026-10-01" },
    ];
    const out = gamesForTeam("A", games);
    expect(out).toHaveLength(2);
    expect(out[0]?.date).toBe("2026-09-01");
    expect(out[1]?.date).toBe("2026-08-01");
  });

  it("has nothing to show for a team with no games", () => {
    expect(gamesForTeam("Z", [game("A", "B", 1, 2, "ag1")])).toEqual([]);
  });
});

describe("isPlaceholderName", () => {
  it("catches the ways a schedule says nobody has decided yet", () => {
    [
      "TBD",
      "tba",
      "T.B.D.",
      "BYE",
      "?",
      "--",
      "To be determined",
      "Winner of Game 3",
      "Seed 4",
    ].forEach((name) => expect(isPlaceholderName(name)).toBe(true));
  });

  it("treats a blank as a placeholder too", () => {
    expect(isPlaceholderName("   ")).toBe(true);
    expect(isPlaceholderName("9U")).toBe(true);
  });

  it("leaves real team names alone", () => {
    ["Aces", "NV Stars Scout", "606 Outlaws", "Trash Pandas", "Bye Bye Birdies"].forEach((name) =>
      expect(isPlaceholderName(name)).toBe(false)
    );
  });
});

describe("findSimilarTeam", () => {
  const teams = [
    team("A", "NV Stars"),
    team("B", "South Lexington Red"),
    team("C", "South Lexington Blue"),
    team("D", "Trash Pandas"),
  ];

  it("suggests the team a longer variant was probably meant to be", () => {
    expect(findSimilarTeam("NV Stars Scout", teams)?.id).toBe("A");
  });

  it("catches a typo", () => {
    expect(findSimilarTeam("Trash Panda", teams)?.id).toBe("D");
    expect(findSimilarTeam("Trsah Pandas", teams)?.id).toBe("D");
  });

  it("does not confuse two real teams that share a long prefix", () => {
    // The whole reason this suggests rather than applies.
    const withoutBlue = teams.filter((t) => t.id !== "C");
    expect(findSimilarTeam("South Lexington Blue", withoutBlue)).toBeNull();
  });

  it("says nothing for an exact match, which is not a near miss", () => {
    expect(findSimilarTeam("NV Stars", teams)).toBeNull();
    expect(findSimilarTeam("nv stars 9u", teams)).toBeNull();
  });

  it("says nothing for a placeholder or a name too short to judge", () => {
    expect(findSimilarTeam("TBD", teams)).toBeNull();
    expect(findSimilarTeam("NV", teams)).toBeNull();
  });

  it("says nothing when nothing is close", () => {
    expect(findSimilarTeam("Bourbon Bandits", teams)).toBeNull();
  });
});

describe("games that do not count", () => {
  const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];

  it("keeps a scheduled game out of the ratings, as before", () => {
    expect(countsTowardRating(game("A", "B", undefined, undefined, "ag1"))).toBe(false);
  });

  it("keeps an excluded game out even though it was played", () => {
    // A fall tournament pairing a 10U against an 8U: real, worth keeping, but it says nothing
    // about this age group.
    expect(countsTowardRating({ ...game("A", "B", 12, 1, "ag1"), excluded: true })).toBe(false);
    expect(countsTowardRating(game("A", "B", 12, 1, "ag1"))).toBe(true);
  });

  it("leaves an excluded game out of records and ratings", () => {
    const games = [
      game("A", "B", 6, 2, "ag1"),
      { ...game("A", "C", 20, 0, "ag1"), excluded: true },
    ];
    const rows = buildTeamRankings("ag1", teams, games);
    const aces = rows.find((row) => row.teamId === "A")!;
    expect(aces.record).toBe("1-0");
    expect(aces.games).toBe(1);
    // The 20-0 would have dominated the rating had it counted.
    const withoutIt = buildTeamRankings("ag1", teams, [games[0]!]);
    expect(aces.rating).toBeCloseTo(withoutIt.find((r) => r.teamId === "A")!.rating, 10);
  });

  it("does not rank a team whose only game here does not count", () => {
    const games = [
      game("A", "B", 6, 2, "ag1"),
      { ...game("A", "C", 20, 0, "ag1"), excluded: true },
    ];
    expect(
      teamsInAgeGroup("ag1", teams, games)
        .map((t) => t.id)
        .sort()
    ).toEqual(["A", "B"]);
  });

  it("does not rank a team that has only scheduled games", () => {
    // In the league but yet to play: a 0-0 · +0.0 row says nothing and pushes real teams down.
    const games = [game("A", "B", 6, 2, "ag1"), game("A", "C", undefined, undefined, "ag1")];
    expect(
      teamsInAgeGroup("ag1", teams, games)
        .map((t) => t.id)
        .sort()
    ).toEqual(["A", "B"]);
  });

  it("keeps an excluded game out of what reaches the league forecast", () => {
    const groups: AgeGroup[] = [{ id: "ag1", name: "2027", seasonIds: ["spring2027"] }];
    const leagueTeams = [
      { id: "L-ACE", name: "Aces" },
      { id: "L-BEA", name: "Bears" },
    ];
    const games = [{ ...game("A", "B", 12, 1, "ag1"), excluded: true }];
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams, [])).toEqual(
      []
    );
  });
});

describe("state", () => {
  const teams: ScoutTeam[] = [
    { id: "A", name: "Aces", state: "KY" },
    { id: "B", name: "Bears", state: "OH" },
    { id: "C", name: "Cubs", state: "KY" },
    { id: "D", name: "Ducks" },
  ];
  const games = [
    game("A", "B", 6, 2, "ag1"),
    game("A", "C", 5, 4, "ag1"),
    game("B", "D", 3, 1, "ag1"),
  ];
  const rows = () => buildTeamRankings("ag1", teams, games);

  it("takes two letters and nothing else", () => {
    expect(normalizeState(" ky ")).toBe("KY");
    expect(normalizeState("Ky")).toBe("KY");
    expect(normalizeState("Kentucky")).toBeUndefined();
    expect(normalizeState("K")).toBeUndefined();
    expect(normalizeState("")).toBeUndefined();
    expect(normalizeState("K1")).toBeUndefined();
  });

  it("offers only states some team actually has", () => {
    expect(statesInUse(teams)).toEqual(["KY", "OH"]);
    expect(statesInUse([{ id: "X", name: "X" }])).toEqual([]);
  });

  it("narrows to one state and renumbers, keeping the overall place", () => {
    const filtered = filterRankingsByState(rows(), teams, "KY");
    expect(filtered.map((row) => row.teamId).sort()).toEqual(["A", "C"]);
    expect(filtered.map((row) => row.rank)).toEqual([1, 2]);
    // The position in the full table is still there to show alongside.
    filtered.forEach((row) => expect(row.overallRank).toBeDefined());
  });

  it("does not change any rating — filtering is presentational", () => {
    const all = rows();
    const filtered = filterRankingsByState(all, teams, "KY");
    filtered.forEach((row) => {
      const full = all.find((r) => r.teamId === row.teamId)!;
      expect(row.rating).toBe(full.rating);
      expect(row.record).toBe(full.record);
    });
  });

  it("can show the teams whose state is unknown", () => {
    const filtered = filterRankingsByState(rows(), teams, UNKNOWN_STATE);
    expect(filtered.map((row) => row.teamId)).toEqual(["D"]);
  });

  it("returns everything when no state is chosen", () => {
    expect(filterRankingsByState(rows(), teams, "")).toHaveLength(4);
  });
});

describe("age group seasons", () => {
  const group = (over: Partial<AgeGroup> & { id: string }): AgeGroup => ({
    name: "",
    seasonIds: [],
    ...over,
  });

  it("offers every age level from 8U to 18U", () => {
    expect(AGE_LEVELS[0]).toBe(8);
    expect(AGE_LEVELS[AGE_LEVELS.length - 1]).toBe(MAX_AGE_LEVEL);
    expect(AGE_LEVELS).toHaveLength(11);
  });

  it("names a season by its age and year", () => {
    expect(formatAgeGroupName(9, 2027)).toBe("9U 2027");
  });

  it("reads age and year back out of the free text older groups were named with", () => {
    expect(parseAgeGroupName("2027, 10U")).toEqual({ ageLevel: 10, year: 2027 });
    expect(parseAgeGroupName("9U 2027")).toEqual({ ageLevel: 9, year: 2027 });
    expect(parseAgeGroupName("u12 2029")).toEqual({ ageLevel: 12, year: 2029 });
  });

  it("reads only what is there, and refuses an age off the ladder", () => {
    expect(parseAgeGroupName("2028")).toEqual({ year: 2028 });
    expect(parseAgeGroupName("10U")).toEqual({ ageLevel: 10 });
    expect(parseAgeGroupName("Travel squad")).toEqual({});
    expect(parseAgeGroupName("22U 2027")).toEqual({ year: 2027 });
  });

  it("does not mistake a bare year for an age level", () => {
    expect(parseAgeGroupName("2027").ageLevel).toBeUndefined();
  });

  it("prefers the stored fields over the name", () => {
    const stored = group({ id: "a", name: "9U 2027", ageLevel: 10, year: 2028 });
    expect(ageGroupSeason(stored)).toEqual({ ageLevel: 10, year: 2028 });
  });

  it("falls back to the name when a group predates the picker", () => {
    expect(ageGroupSeason(group({ id: "a", name: "2027, 10U" }))).toEqual({
      ageLevel: 10,
      year: 2027,
    });
  });

  it("offers years from 2027 on, plus any year already in use", () => {
    const years = seasonYearOptions([group({ id: "a", name: "9U 2024" })]);
    expect(years[0]).toBe(2024);
    expect(years).toContain(MIN_SEASON_YEAR);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(new Set(years).size).toBe(years.length);
  });

  it("advances both the age and the year", () => {
    expect(nextSeason({ ageLevel: 9, year: 2027 })).toEqual({ ageLevel: 10, year: 2028 });
  });

  it("holds an 18U squad at 18U while the year still moves", () => {
    expect(nextSeason({ ageLevel: 18, year: 2036 })).toEqual({ ageLevel: 18, year: 2037 });
  });

  it("finds the group already covering a season, however it was named", () => {
    const groups = [group({ id: "a", name: "2028, 10U" }), group({ id: "b", name: "9U 2027" })];
    expect(findAgeGroupForSeason({ ageLevel: 10, year: 2028 }, groups)?.id).toBe("a");
    expect(findAgeGroupForSeason({ ageLevel: 11, year: 2029 }, groups)).toBeUndefined();
  });

  it("carries the squad, not the results, into the new season", () => {
    const previous = group({
      id: "a",
      name: "9U 2027",
      ageLevel: 9,
      year: 2027,
      seasonIds: ["fall-2026", "spring-2027"],
      myTeamId: "S-mine",
    });
    const next = advancedAgeGroup(previous, nextSeason({ ageLevel: 9, year: 2027 }));
    expect(next.name).toBe("10U 2028");
    expect(next.ageLevel).toBe(10);
    expect(next.year).toBe(2028);
    expect(next.continuesFromId).toBe("a");
    expect(next.myTeamId).toBe("S-mine");
    expect(next.seasonIds).toEqual([]);
    expect(next.id).not.toBe(previous.id);
  });

  it("makes the age group when the league season is put at an age that has no page yet", () => {
    const result = seasonAtAge("spring-2027", { ageLevel: 9, year: 2027 }, []);
    expect(result.created).toBe(true);
    expect(result.group?.name).toBe("9U 2027");
    expect(result.ageGroups).toHaveLength(1);
    expect(result.ageGroups[0]?.seasonIds).toEqual(["spring-2027"]);
  });

  it("uses the page the import already made rather than a second one of the same name", () => {
    const existing = group({ id: "a", name: "9U 2027", ageLevel: 9, year: 2027 });
    const result = seasonAtAge("spring-2027", { ageLevel: 9, year: 2027 }, [existing]);
    expect(result.created).toBe(false);
    expect(result.group?.id).toBe("a");
    expect(result.ageGroups).toHaveLength(1);
    expect(result.ageGroups[0]?.seasonIds).toEqual(["spring-2027"]);
  });

  it("moves a league season rather than leaving it counted on two tables", () => {
    const groups = [
      group({ id: "a", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["spring-2027"] }),
      group({ id: "b", name: "10U 2028", ageLevel: 10, year: 2028 }),
    ];
    const result = seasonAtAge("spring-2027", { ageLevel: 10, year: 2028 }, groups);
    expect(result.group?.id).toBe("b");
    expect(result.ageGroups.find((current) => current.id === "a")?.seasonIds).toEqual([]);
    expect(result.ageGroups.find((current) => current.id === "b")?.seasonIds).toEqual([
      "spring-2027",
    ]);
  });

  it("takes a league season off Team Rankings without touching the page it was on", () => {
    const groups = [
      group({ id: "a", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["spring-2027"] }),
    ];
    const result = seasonAtAge("spring-2027", null, groups);
    expect(result.group).toBeUndefined();
    expect(result.created).toBe(false);
    expect(result.ageGroups).toHaveLength(1);
    expect(result.ageGroups[0]?.seasonIds).toEqual([]);
  });

  it("links the new season to the old one, so last year's opponents stay suggested", () => {
    const previous = group({ id: "a", name: "9U 2027", ageLevel: 9, year: 2027 });
    const next = advancedAgeGroup(previous, nextSeason({ ageLevel: 9, year: 2027 }));
    expect(ageGroupChain(next.id, [previous, next])).toEqual([next.id, "a"]);
  });
});

// ---------- Season-year pools, GameChanger links and cross-age games ----------

const season = (
  id: string,
  ageLevel: number,
  year: number,
  extra: Partial<AgeGroup> = {}
): AgeGroup => ({
  id,
  name: formatAgeGroupName(ageLevel, year),
  ageLevel,
  year,
  seasonIds: [],
  ...extra,
});

const link = (teamId: string, ageGroupId: string, over: Partial<GcTeamLink> = {}): GcTeamLink => ({
  teamId,
  name: `${teamId} 9U`,
  ageGroupId,
  ...over,
});

const withLevels = (base: ScoutGame, levels: { a?: number; b?: number }): ScoutGame => ({
  ...base,
  ...(levels.a === undefined ? {} : { ageLevelA: levels.a }),
  ...(levels.b === undefined ? {} : { ageLevelB: levels.b }),
});

const u8 = season("u8", 8, 2027);
const u9 = season("u9", 9, 2027);
const u10 = season("u10", 10, 2027);
const u9next = season("u9next", 9, 2028);
// A group saved before the picker: free text that says nothing about level or year.
const legacy: AgeGroup = { id: "old", name: "Travel squad", seasonIds: [] };
const pool: AgeGroup[] = [u8, u9, u10, u9next, legacy];

describe("ageGroupLevel / ageGroupYear", () => {
  it("reads the stored fields", () => {
    expect(ageGroupLevel(u10)).toBe(10);
    expect(ageGroupYear(u10)).toBe(2027);
  });

  it("parses a group named before the picker", () => {
    const named: AgeGroup = { id: "n", name: "2027, 10U", seasonIds: [] };
    expect(ageGroupLevel(named)).toBe(10);
    expect(ageGroupYear(named)).toBe(2027);
  });

  it("is undefined for a group with nothing to read, or no group at all", () => {
    expect(ageGroupLevel(legacy)).toBeUndefined();
    expect(ageGroupYear(legacy)).toBeUndefined();
    expect(ageGroupLevel(undefined)).toBeUndefined();
    expect(ageGroupYear(undefined)).toBeUndefined();
  });
});

describe("rankingPoolGroupIds", () => {
  it("pools every group of the season year, itself included, youngest first", () => {
    expect(rankingPoolGroupIds("u10", pool)).toEqual(["u8", "u9", "u10"]);
    expect(rankingPoolGroupIds("u8", pool)).toEqual(["u8", "u9", "u10"]);
  });

  it("leaves a group with no year on its own", () => {
    expect(rankingPoolGroupIds("old", pool)).toEqual(["old"]);
  });

  it("is just the id when the group is not known", () => {
    expect(rankingPoolGroupIds("ghost", pool)).toEqual(["ghost"]);
  });

  it("pools a group whose year is only in its name", () => {
    const named: AgeGroup = { id: "named", name: "2027 11U", seasonIds: [] };
    expect(rankingPoolGroupIds("named", [u9, named])).toEqual(["u9", "named"]);
  });

  it("keeps the stored order of groups at the same level", () => {
    const twinA = season("twinA", 9, 2027);
    const twinB = season("twinB", 9, 2027);
    expect(rankingPoolGroupIds("twinB", [twinA, twinB])).toEqual(["twinA", "twinB"]);
    expect(rankingPoolGroupIds("twinB", [twinB, twinA])).toEqual(["twinB", "twinA"]);
  });
});

describe("squadYearForGcSeason", () => {
  it("rolls fall and winter into the following year", () => {
    expect(squadYearForGcSeason("fall", 2026)).toBe(2027);
    expect(squadYearForGcSeason("winter", 2026)).toBe(2027);
    expect(squadYearForGcSeason("Fall", 2026)).toBe(2027);
  });

  it("keeps spring and summer in their own year", () => {
    expect(squadYearForGcSeason("spring", 2027)).toBe(2027);
    expect(squadYearForGcSeason("summer", 2027)).toBe(2027);
  });

  it("keeps the year for a season it does not recognise", () => {
    expect(squadYearForGcSeason(undefined, 2027)).toBe(2027);
    expect(squadYearForGcSeason("autumn", 2027)).toBe(2027);
  });
});

describe("gcSeasonLabel", () => {
  it("writes the season the way GameChanger shows it", () => {
    expect(gcSeasonLabel({ season: "fall", seasonYear: 2026 })).toBe("Fall 2026");
    expect(gcSeasonLabel({ season: "SPRING", seasonYear: 2027 })).toBe("Spring 2027");
  });

  it("is empty when either half is unknown", () => {
    expect(gcSeasonLabel({ seasonYear: 2026 })).toBe("");
    expect(gcSeasonLabel({ season: "fall" })).toBe("");
    expect(gcSeasonLabel({ season: " ", seasonYear: 2026 })).toBe("");
    expect(gcSeasonLabel({})).toBe("");
  });
});

describe("findGcLink / findTeamsByAvatarKey", () => {
  const teams: ScoutTeam[] = [
    team("A", "Aces"),
    { ...team("B", "Bears"), gcTeams: [link("gcB1", "u9", { avatarKey: "av-b" })] },
    {
      ...team("C", "Cubs"),
      gcTeams: [link("gcC1", "u9", { avatarKey: "av-c" }), link("gcC2", "u10")],
    },
  ];

  it("finds the team carrying a GameChanger id, and the link itself", () => {
    const found = findGcLink("gcC2", teams);
    expect(found?.team.id).toBe("C");
    expect(found?.link.ageGroupId).toBe("u10");
  });

  it("is null for an id nobody carries", () => {
    expect(findGcLink("nope", teams)).toBeNull();
    expect(findGcLink("gcB1", [team("A", "Aces")])).toBeNull();
  });

  it("finds teams by the avatar on any of their links", () => {
    expect(findTeamsByAvatarKey("av-c", teams).map((t) => t.id)).toEqual(["C"]);
    expect(findTeamsByAvatarKey("av-b", teams).map((t) => t.id)).toEqual(["B"]);
  });

  it("matches nothing for an unknown or blank key", () => {
    expect(findTeamsByAvatarKey("av-z", teams)).toEqual([]);
    expect(findTeamsByAvatarKey("", teams)).toEqual([]);
  });
});

describe("gameSideLevels", () => {
  it("uses the level recorded on the game", () => {
    const g = withLevels(game("A", "B", 5, 3, "u10"), { a: 9 });
    expect(gameSideLevels(g, pool)).toEqual({ a: 9, b: 10 });
  });

  it("falls back to the filed group's level for both sides", () => {
    expect(gameSideLevels(game("A", "B", 5, 3, "u9"), pool)).toEqual({ a: 9, b: 9 });
  });

  it("says nothing about a side it cannot read", () => {
    expect(gameSideLevels(game("A", "B", 5, 3, "old"), pool)).toEqual({});
    expect(gameSideLevels(withLevels(game("A", "B", 5, 3, "old"), { b: 8 }), pool)).toEqual({
      b: 8,
    });
  });
});

describe("teamHomeAgeLevel", () => {
  it("takes the level of the group a GameChanger link for that year is filed under", () => {
    const teams = [{ ...team("C", "Cubs"), gcTeams: [link("gc1", "u10")] }];
    // Three games recorded at 9U do not outvote GameChanger's word.
    const games = [
      withLevels(game("C", "A", 5, 3, "u9"), { a: 9 }),
      withLevels(game("C", "A", 5, 3, "u9"), { a: 9 }),
      withLevels(game("C", "A", 5, 3, "u9"), { a: 9 }),
    ];
    expect(teamHomeAgeLevel("C", 2027, teams, games, pool)).toBe(10);
  });

  it("lets the latest season of the squad year win, whatever order the links are in", () => {
    const fall = link("gcFall", "u9", { season: "fall", seasonYear: 2026 });
    const spring = link("gcSpring", "u10", { season: "spring", seasonYear: 2027 });
    expect(
      teamHomeAgeLevel("C", 2027, [{ ...team("C", "Cubs"), gcTeams: [fall, spring] }], [], pool)
    ).toBe(10);
    expect(
      teamHomeAgeLevel("C", 2027, [{ ...team("C", "Cubs"), gcTeams: [spring, fall] }], [], pool)
    ).toBe(10);
  });

  it("ignores a link from another season year", () => {
    const teams = [{ ...team("C", "Cubs"), gcTeams: [link("gc1", "u9next")] }];
    const games = [game("C", "A", 5, 3, "u10")];
    expect(teamHomeAgeLevel("C", 2027, teams, games, pool)).toBe(10);
    expect(teamHomeAgeLevel("C", 2028, teams, games, pool)).toBe(9);
  });

  it("uses the link's own level and season when its group is gone", () => {
    const orphan = link("gc1", "deleted", { season: "fall", seasonYear: 2026, ageLevel: 11 });
    expect(
      teamHomeAgeLevel("C", 2027, [{ ...team("C", "Cubs"), gcTeams: [orphan] }], [], pool)
    ).toBe(11);
  });

  it("falls back to the level the team's games most often record for it", () => {
    const games = [
      withLevels(game("C", "A", 5, 3, "u10"), { a: 9 }),
      withLevels(game("A", "C", 5, 3, "u10"), { b: 9 }),
      withLevels(game("C", "A", 5, 3, "u9"), { a: 10 }),
    ];
    expect(teamHomeAgeLevel("C", 2027, [team("C", "Cubs")], games, pool)).toBe(9);
  });

  it("then falls back to where the games are filed", () => {
    const games = [
      game("C", "A", 5, 3, "u10"),
      game("A", "C", 5, 3, "u10"),
      game("C", "A", 5, 3, "u9"),
    ];
    expect(teamHomeAgeLevel("C", 2027, [team("C", "Cubs")], games, pool)).toBe(10);
  });

  it("is undefined for a team with nothing in that year", () => {
    const games = [game("C", "A", 5, 3, "u9next")];
    expect(teamHomeAgeLevel("C", 2027, [team("C", "Cubs")], games, pool)).toBeUndefined();
    expect(teamHomeAgeLevel("Z", 2027, [], games, pool)).toBeUndefined();
  });

  it("treats the groups with no year as a season of their own", () => {
    const games = [withLevels(game("C", "A", 5, 3, "old"), { a: 12 }), game("C", "A", 5, 3, "u9")];
    expect(teamHomeAgeLevel("C", undefined, [team("C", "Cubs")], games, pool)).toBe(12);
  });
});

describe("matchExistingGame", () => {
  const existing: ScoutGame = {
    id: "g1",
    teamAId: "A",
    teamBId: "B",
    teamAScore: 7,
    teamBScore: 3,
    ageGroupId: "u9",
    date: "2026-08-22",
  };

  it("matches the same pair on the same date in either order", () => {
    const swapped: ScoutGame = {
      id: "g2",
      teamAId: "B",
      teamBId: "A",
      ageGroupId: "u9",
      date: "2026-08-22",
    };
    // Nothing to contradict: an unscored copy of a game already here is that game.
    expect(matchExistingGame(swapped, [existing], pool)).toBe(existing);
    // And the same result seen from the other side — 7-3 becomes 3-7 — is still the same game.
    expect(matchExistingGame({ ...swapped, teamAScore: 3, teamBScore: 7 }, [existing], pool)).toBe(
      existing
    );
  });

  /**
   * Two results that contradict each other are two games. Matching them lost the second half of a
   * doubleheader whenever one club's schedule listed both and the other listed only the first.
   */
  it("is not the same game when the two rows disagree about the result", () => {
    const other: ScoutGame = {
      id: "g2",
      teamAId: "B",
      teamBId: "A",
      teamAScore: 3,
      teamBScore: 8,
      ageGroupId: "u9",
      date: "2026-08-22",
    };
    expect(matchExistingGame(other, [existing], pool)).toBeNull();
  });

  it("is not the same game when the two rows start at different times", () => {
    const later: ScoutGame = {
      id: "g2",
      teamAId: "A",
      teamBId: "B",
      ageGroupId: "u9",
      date: "2026-08-22",
      startTs: "2026-08-22T18:00:00Z",
    };
    const morning = { ...existing, startTs: "2026-08-22T14:00:00Z" };
    expect(matchExistingGame(later, [morning], pool)).toBeNull();
  });

  it("matches across the groups of one pool, but not across years", () => {
    const fromTheOtherPage: ScoutGame = { ...existing, id: "g2", ageGroupId: "u10" };
    expect(matchExistingGame(fromTheOtherPage, [existing], pool)).toBe(existing);
    expect(
      matchExistingGame({ ...existing, id: "g2", ageGroupId: "u9next" }, [existing], pool)
    ).toBeNull();
  });

  it("does not match a different date or pair, or itself", () => {
    expect(
      matchExistingGame({ ...existing, id: "g2", date: "2026-08-23" }, [existing], pool)
    ).toBeNull();
    expect(matchExistingGame({ ...existing, id: "g2", teamBId: "C" }, [existing], pool)).toBeNull();
    expect(matchExistingGame(existing, [existing], pool)).toBeNull();
  });

  it("recognises the same GameChanger game id on the same schedule first", () => {
    const source = { kind: "gamechanger" as const, teamId: "gcA", gameId: "x1" };
    const sameDay: ScoutGame = { ...existing, id: "g1", teamAScore: 2, teamBScore: 1 };
    const sourced: ScoutGame = { ...existing, id: "g2", source };
    const candidate: ScoutGame = { ...existing, id: "cand", teamAScore: 2, teamBScore: 1, source };
    expect(matchExistingGame(candidate, [sameDay, sourced], pool)).toBe(sourced);
  });

  it("never matches two different games off one schedule — a doubleheader is two games", () => {
    const first: ScoutGame = {
      ...existing,
      source: { kind: "gamechanger", teamId: "gcA", gameId: "x1" },
    };
    const second: ScoutGame = {
      ...existing,
      id: "g2",
      teamAScore: 5,
      teamBScore: 4,
      source: { kind: "gamechanger", teamId: "gcA", gameId: "x2" },
    };
    expect(matchExistingGame(second, [first], pool)).toBeNull();
  });

  it("prefers the copy whose score agrees when several fit", () => {
    const gameOne: ScoutGame = { ...existing, id: "g1", teamAScore: 7, teamBScore: 3 };
    const gameTwo: ScoutGame = { ...existing, id: "g2", teamAScore: 5, teamBScore: 4 };
    // The other team's schedule reports the second game from its own seat.
    const theirCopy: ScoutGame = {
      id: "cand",
      teamAId: "B",
      teamBId: "A",
      teamAScore: 4,
      teamBScore: 5,
      ageGroupId: "u9",
      date: "2026-08-22",
      source: { kind: "gamechanger", teamId: "gcB", gameId: "y2" },
    };
    expect(matchExistingGame(theirCopy, [gameOne, gameTwo], pool)).toBe(gameTwo);
  });

  it("matches two scoreless entries on the same date", () => {
    const scheduled: ScoutGame = { id: "s1", teamAId: "A", teamBId: "B", ageGroupId: "u9" };
    expect(matchExistingGame({ ...scheduled, id: "s2" }, [scheduled], pool)).toBe(scheduled);
  });
});

describe("collapseSameGames", () => {
  const u9: AgeGroup = { id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] };
  const u10: AgeGroup = { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] };
  const row = (
    teamAId: string,
    teamBId: string,
    a: number,
    b: number,
    ageGroupId: string,
    source: string
  ): ScoutGame => ({
    ...game(teamAId, teamBId, a, b, ageGroupId),
    id: `gc_${source}`,
    date: "2026-09-11",
    source: { kind: "gamechanger", teamId: source, gameId: "1" },
  });

  it("folds the two copies of a cross-age game, filed under different pages of one pool", () => {
    const games = [row("A", "B", 5, 4, "u9", "gcA"), row("B", "A", 4, 5, "u10", "gcB")];
    const out = collapseSameGames(games, [u9, u10]);
    expect(out.collapsed).toBe(1);
    expect(out.games.map((g) => g.id)).toEqual(["gc_gcA"]);
  });

  it("does not reach across pages that share no year", () => {
    const games = [row("A", "B", 5, 4, "u9", "gcA"), row("B", "A", 4, 5, "u10", "gcB")];
    expect(collapseSameGames(games, []).collapsed).toBe(0);
  });

  it("narrowed to one team, leaves everyone else's rows as they are", () => {
    const games = [
      row("A", "B", 5, 4, "u9", "gcA"),
      row("B", "A", 4, 5, "u9", "gcB"),
      row("C", "D", 1, 0, "u9", "gcC"),
      row("D", "C", 0, 1, "u9", "gcD"),
    ];
    const out = collapseSameGames(games, [u9], "A");
    expect(out.collapsed).toBe(1);
    expect(out.games).toHaveLength(3);
  });

  it("hands back the same array when there is nothing to fold", () => {
    const games = [row("A", "B", 5, 4, "u9", "gcA")];
    expect(collapseSameGames(games, [u9]).games).toBe(games);
  });
});

describe("mergeScoutTeams", () => {
  const fall = link("gcFall", "u9", { season: "fall", seasonYear: 2026, avatarKey: "av" });
  const spring = link("gcSpring", "u9", { season: "spring", seasonYear: 2027 });
  const teams: ScoutTeam[] = [
    { ...team("A", "Aces"), state: "KY", gcTeams: [fall] },
    { ...team("B", "Aces Spring"), city: "Georgetown", gcTeams: [spring, fall] },
    team("C", "Cubs"),
  ];

  it("keeps the survivor's id and name, repoints the games and unions the links by id", () => {
    const games = [game("B", "C", 4, 9, "u9"), game("A", "C", 3, 2, "u9")];
    const out = mergeScoutTeams("B", "A", teams, games, []);

    expect(out.teams.map((t) => t.id)).toEqual(["A", "C"]);
    const survivor = out.teams.find((t) => t.id === "A")!;
    expect(survivor.name).toBe("Aces");
    expect(survivor.gcTeams?.map((l) => l.teamId)).toEqual(["gcFall", "gcSpring"]);
    expect(out.games[0]?.teamAId).toBe("A");
    // The untouched game keeps its identity.
    expect(out.games[1]).toBe(games[1]);
    expect(out.droppedGames).toBe(0);
  });

  const filed = (
    teamAId: string,
    teamBId: string,
    teamAScore: number | undefined,
    teamBScore: number | undefined,
    source: { teamId: string; gameId: string },
    ageGroupId = "u9"
  ): ScoutGame => ({
    ...game(teamAId, teamBId, teamAScore, teamBScore, ageGroupId),
    id: `gc_${source.teamId}_${source.gameId}`,
    date: "2026-09-11",
    source: { kind: "gamechanger", ...source },
  });

  it("makes one row of the game both halves filed against the same opponent", () => {
    // Fall id and Spring id each pulled their own schedule; both had the 3-2 over the Cubs.
    const games = [
      filed("A", "C", 3, 2, { teamId: "gcFall", gameId: "f1" }),
      filed("C", "B", 2, 3, { teamId: "gcSpring", gameId: "s1" }),
    ];
    const out = mergeScoutTeams("B", "A", teams, games, []);
    expect(out.games).toHaveLength(1);
    expect(out.games[0]?.id).toBe("gc_gcFall_f1");
    expect(out.collapsedGames).toBe(1);
    expect(out.droppedGames).toBe(0);
  });

  it("keeps a doubleheader apart: two results that contradict are two games", () => {
    const games = [
      filed("A", "C", 3, 2, { teamId: "gcFall", gameId: "f1" }),
      filed("C", "B", 7, 1, { teamId: "gcSpring", gameId: "s1" }),
    ];
    const out = mergeScoutTeams("B", "A", teams, games, []);
    expect(out.games).toHaveLength(2);
    expect(out.collapsedGames).toBe(0);
  });

  it("fills a result from the copy folded in when the kept row had none", () => {
    const games = [
      filed("A", "C", undefined, undefined, { teamId: "gcFall", gameId: "f1" }),
      filed("C", "B", 2, 3, { teamId: "gcSpring", gameId: "s1" }),
    ];
    const out = mergeScoutTeams("B", "A", teams, games, []);
    expect(out.games).toHaveLength(1);
    expect(out.games[0]).toMatchObject({ id: "gc_gcFall_f1", teamAScore: 3, teamBScore: 2 });
  });

  it("never folds two game ids off one schedule, even with the same score", () => {
    const games = [
      filed("A", "C", 3, 2, { teamId: "gcFall", gameId: "f1" }),
      filed("A", "C", 3, 2, { teamId: "gcFall", gameId: "f2" }),
      filed("B", "C", 9, 0, { teamId: "gcSpring", gameId: "s1" }),
    ];
    const out = mergeScoutTeams("B", "A", teams, games, []);
    expect(out.games).toHaveLength(3);
    expect(out.collapsedGames).toBe(0);
  });

  it("fills a blank state or city from the team folded in, never overwriting one", () => {
    const out = mergeScoutTeams("B", "A", teams, [], []);
    const survivor = out.teams.find((t) => t.id === "A")!;
    expect(survivor.state).toBe("KY");
    expect(survivor.city).toBe("Georgetown");

    const reverse = mergeScoutTeams("A", "B", [{ ...teams[1]!, state: "OH" }, teams[0]!], [], []);
    expect(reverse.teams.find((t) => t.id === "B")?.state).toBe("OH");
  });

  it("drops a game between the two teams rather than keeping a self-match", () => {
    const games = [game("A", "B", 4, 9, "u9"), game("B", "C", 1, 0, "u9")];
    const out = mergeScoutTeams("B", "A", teams, games, []);
    expect(out.droppedGames).toBe(1);
    expect(out.games).toHaveLength(1);
    expect(out.games[0]?.teamAId).toBe("A");
  });

  it("carries the legacy 'my team' mark over", () => {
    const out = mergeScoutTeams("B", "C", [...teams.slice(0, 2), team("C", "Cubs", true)], [], []);
    expect(out.teams.find((t) => t.id === "C")?.isMine).toBe(true);
    const other = mergeScoutTeams("C", "A", [teams[0]!, team("C", "Cubs", true)], [], []);
    expect(other.teams.find((t) => t.id === "A")?.isMine).toBe(true);
  });

  it("does nothing for an unknown team or a team merged into itself", () => {
    const games = [game("A", "C", 3, 2, "u9")];
    expect(mergeScoutTeams("Z", "A", teams, games, [])).toEqual({
      teams,
      games,
      droppedGames: 0,
      collapsedGames: 0,
    });
    expect(mergeScoutTeams("A", "Z", teams, games, [])).toEqual({
      teams,
      games,
      droppedGames: 0,
      collapsedGames: 0,
    });
    expect(mergeScoutTeams("A", "A", teams, games, []).teams).toBe(teams);
  });

  it("leaves a survivor with nothing to gain as the same object", () => {
    const out = mergeScoutTeams("C", "A", teams, [], []);
    expect(out.teams.find((t) => t.id === "A")).toBe(teams[0]);
  });

  it("is what renameScoutTeam does when the new name is taken", () => {
    const games = [game("B", "C", 4, 9, "u9")];
    const renamed = renameScoutTeam("B", "Aces", teams, games, []);
    const merged = mergeScoutTeams("B", "A", teams, games, []);
    expect(renamed.mergedInto?.id).toBe("A");
    expect(renamed.teams).toEqual(merged.teams);
    expect(renamed.games).toEqual(merged.games);
    // The links came along, which a plain rename-and-delete would have lost.
    expect(renamed.teams.find((t) => t.id === "A")?.gcTeams).toHaveLength(2);
  });
});

describe("unlinkGcTeam", () => {
  const teams: ScoutTeam[] = [
    { ...team("A", "Aces"), gcTeams: [link("gc1", "u9"), link("gc2", "u10")] },
    { ...team("B", "Bears"), gcTeams: [link("gc3", "u9")] },
  ];

  it("removes one link and leaves the rest", () => {
    const out = unlinkGcTeam("A", "gc1", teams);
    expect(out.find((t) => t.id === "A")?.gcTeams?.map((l) => l.teamId)).toEqual(["gc2"]);
    expect(out.find((t) => t.id === "B")).toBe(teams[1]);
  });

  it("leaves a plain name-only team when the last link comes off", () => {
    const out = unlinkGcTeam("B", "gc3", teams);
    expect(out.find((t) => t.id === "B")).toEqual({ id: "B", name: "Bears" });
    expect("gcTeams" in out.find((t) => t.id === "B")!).toBe(false);
  });

  it("changes nothing when the team does not carry that id", () => {
    const out = unlinkGcTeam("A", "gc3", teams);
    expect(out[0]).toBe(teams[0]);
    expect(out[1]).toBe(teams[1]);
  });
});

describe("createScoutTeam", () => {
  it("creates a team without matching an existing one by name", () => {
    const first = createScoutTeam("Yankees", []);
    const second = createScoutTeam("Yankees", first.teams);
    expect(second.teams).toHaveLength(2);
    expect(second.teamId).not.toBe(first.teamId);
    expect(second.team.name).toBe("Yankees");
  });

  it("mints ids the way resolveOrCreateTeam does", () => {
    const resolved = resolveOrCreateTeam("Thunder Hawks", []);
    const created = createScoutTeam("Thunder Hawks", []);
    expect(created.teamId).toBe(resolved.teamId);
    expect(created.teamId.startsWith("S-")).toBe(true);
  });

  it("strips the age label and applies extras, but never the id or name", () => {
    const { team: created } = createScoutTeam("NV Stars 9u Scout", [], {
      id: "hijack",
      name: "Other",
      state: "KY",
      city: "Georgetown",
      gcTeams: [link("gc1", "u9")],
    });
    expect(created.name).toBe("NV Stars Scout");
    expect(created.id).not.toBe("hijack");
    expect(created.state).toBe("KY");
    expect(created.city).toBe("Georgetown");
    expect(created.gcTeams).toHaveLength(1);
  });

  it("adds no key for an extra that is undefined", () => {
    const { team: created } = createScoutTeam("Aces", [], { state: undefined, city: undefined });
    expect(created).toEqual({ id: created.id, name: "Aces" });
    expect("state" in created).toBe(false);
  });
});

describe("teamsInRankingPool / teamRecordInPool", () => {
  const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs"), team("D", "Ducks")];
  const games = [
    game("A", "B", 5, 3, "u9"),
    withLevels(game("A", "C", 2, 6, "u10"), { a: 9 }),
    game("C", "D", undefined, undefined, "u10"),
    game("A", "D", 8, 1, "u9next"),
  ];

  it("lists every team with a counted game anywhere in the pool", () => {
    expect(
      teamsInRankingPool("u9", teams, games, pool)
        .map((t) => t.id)
        .sort()
    ).toEqual(["A", "B", "C"]);
    // teamsInAgeGroup keeps its narrower meaning.
    expect(
      teamsInAgeGroup("u9", teams, games)
        .map((t) => t.id)
        .sort()
    ).toEqual(["A", "B"]);
  });

  it("counts a team's record across the pool, cross-age games included", () => {
    expect(teamRecordInPool("A", "u9", games, pool)).toEqual({
      wins: 1,
      losses: 1,
      ties: 0,
      games: 2,
      crossAgeGames: 1,
    });
    expect(teamRecordInPool("C", "u10", games, pool)).toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
      games: 1,
      crossAgeGames: 1,
    });
    expect(teamRecordInPool("A", "u9next", games, pool).games).toBe(1);
  });
});

describe("buildTeamRankings with a season-year pool", () => {
  const rowsById = (rows: ReturnType<typeof buildTeamRankings>) =>
    new Map(rows.map((row) => [row.teamId, row]));

  it("rates two groups of one year together", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [
      game("A", "B", 6, 3, "u9"),
      // B, a 9U, beat a 10U on the 10U page.
      withLevels(game("B", "C", 5, 2, "u10"), { a: 9 }),
    ];
    const pooled = rowsById(buildTeamRankings("u9", teams, games, undefined, pool));
    const alone = rowsById(buildTeamRankings("u9", teams, games));

    expect([...pooled.keys()].sort()).toEqual(["A", "B"]);
    expect(pooled.get("B")!.rating).toBeGreaterThan(alone.get("B")!.rating);
    expect(pooled.get("B")!.record).toBe("1-1");
    expect(pooled.get("B")!.games).toBe(2);
    expect(pooled.get("B")!.crossAgeGames).toBe(1);
    expect(pooled.get("A")!.crossAgeGames).toBe(0);
    expect(pooled.get("A")!.ageLevel).toBe(9);
  });

  it("lists a team on the page of its home level, not where its games are filed", () => {
    const teams = [
      team("A", "Aces"),
      team("B", "Bears"),
      { ...team("C", "Cubs"), gcTeams: [link("gcC", "u10", { season: "fall", seasonYear: 2026 })] },
    ];
    // C played down in the 9U group and nothing is filed under its own page.
    const games = [game("A", "B", 6, 3, "u9"), game("C", "A", 9, 2, "u9")];

    const nine = buildTeamRankings("u9", teams, games, undefined, pool);
    expect(nine.map((row) => row.teamId).sort()).toEqual(["A", "B"]);
    // C is still a node: A's rating reflects the loss to it.
    const aloneA = buildTeamRankings("u9", teams, [games[0]!]).find((r) => r.teamId === "A")!;
    expect(nine.find((r) => r.teamId === "A")!.rating).not.toBeCloseTo(aloneA.rating, 6);

    const ten = buildTeamRankings("u10", teams, games, undefined, pool);
    expect(ten.map((row) => row.teamId)).toEqual(["C"]);
    expect(ten[0]!.ageLevel).toBe(10);
    expect(ten[0]!.fromGameChanger).toBe(true);
    expect(ten[0]!.record).toBe("1-0");
  });

  it("returns no table for an 8U page, whose games still count as evidence", () => {
    expect(isRankedAgeLevel(8)).toBe(false);
    expect(isRankedAgeLevel(MIN_RANKED_AGE_LEVEL)).toBe(true);
    const teams = [team("A", "Aces"), team("B", "Bears"), team("E", "Eights")];
    const games = [
      game("A", "B", 4, 3, "u9"),
      // A 9U playing down against an 8U, filed on the 8U page.
      withLevels(game("A", "E", 10, 2, "u8"), { a: 9 }),
    ];
    expect(buildTeamRankings("u8", teams, games, undefined, pool)).toEqual([]);
    expect(
      teamsInRankingPool("u8", teams, games, pool)
        .map((t) => t.id)
        .sort()
    ).toEqual(["A", "B", "E"]);

    const nine = rowsById(buildTeamRankings("u9", teams, games, undefined, pool));
    expect([...nine.keys()].sort()).toEqual(["A", "B"]);
    expect(nine.get("A")!.record).toBe("2-0");
    expect(nine.get("A")!.crossAgeGames).toBe(1);
  });

  it("credits playing up in strength of schedule and debits playing down", () => {
    const teams = [team("A", "Aces"), team("C", "Cubs"), team("D", "Ducks")];
    const games = [
      // Two evenly matched 10Us.
      game("C", "D", 4, 4, "u10"),
      game("D", "C", 3, 3, "u10"),
      // A 9U loses to one of them by the two runs a year of age is expected to be worth.
      withLevels(game("A", "C", 3, 5, "u10"), { a: 9 }),
    ];
    const nine = buildTeamRankings("u9", teams, games, undefined, pool);
    const ten = rowsById(buildTeamRankings("u10", teams, games, undefined, pool));

    expect(nine.map((row) => row.teamId)).toEqual(["A"]);
    const a = nine[0]!;
    // Losing by the expected margin is playing even, not losing.
    expect(Math.abs(a.rating)).toBeLessThan(0.5);
    expect(a.strengthOfSchedule).toBeGreaterThan(1);
    expect(a.record).toBe("0-1");
    expect(a.sosRank).toBe(1);

    // From C's seat the 9U was worth about two runs less than its rating.
    expect(ten.get("C")!.strengthOfSchedule).toBeLessThan(0);
    expect(ten.get("C")!.strengthOfSchedule).toBeLessThan(ten.get("D")!.strengthOfSchedule);
    expect(ten.get("C")!.crossAgeGames).toBe(1);
    expect(ten.get("D")!.crossAgeGames).toBe(0);

    // The same loss read as a same-level game would have counted against A.
    const flat = buildTeamRankings("u10", teams, [
      games[0]!,
      games[1]!,
      game("A", "C", 3, 5, "u10"),
    ]);
    expect(flat.find((row) => row.teamId === "A")!.rating).toBeLessThan(-0.5);
  });

  it("skips a game whose team is not in the roster", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    const games = [game("A", "B", 6, 3, "u9"), game("A", "Z", 0, 9, "u9")];
    const rows = buildTeamRankings("u9", teams, games, undefined, pool);
    expect(rows.map((row) => row.teamId).sort()).toEqual(["A", "B"]);
    expect(rows.find((row) => row.teamId === "A")!.games).toBe(1);
    expect(rows.find((row) => row.teamId === "A")!.record).toBe("1-0");
  });

  it("lists only teams with a counted game in the pool", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [game("A", "B", 6, 3, "u9"), game("A", "C", undefined, undefined, "u9")];
    expect(
      buildTeamRankings("u9", teams, games, undefined, pool)
        .map((row) => row.teamId)
        .sort()
    ).toEqual(["A", "B"]);
  });

  it("keeps a team of unknown level on the page its games are filed under", () => {
    const teams = [team("A", "Aces"), team("B", "Bears")];
    // Filed under a legacy group with no level: nothing says what level anyone is.
    const games = [game("A", "B", 6, 3, "old")];
    const rows = buildTeamRankings("old", teams, games, undefined, pool);
    expect(rows.map((row) => row.teamId).sort()).toEqual(["A", "B"]);
    rows.forEach((row) => expect(row.ageLevel).toBeUndefined());
  });

  it("agrees with the single-group ranking when the pool is one group with no cross-age games", () => {
    const teams = [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs")];
    const games = [
      game("A", "B", 10, 2, "u9next"),
      game("A", "C", 8, 1, "u9next"),
      game("B", "C", 4, 4, "u9next"),
    ];
    const pooled = buildTeamRankings("u9next", teams, games, undefined, pool);
    const alone = buildTeamRankings("u9next", teams, games);
    expect(pooled.map((row) => row.teamId)).toEqual(alone.map((row) => row.teamId));
    pooled.forEach((row, index) => {
      expect(row.rating).toBeCloseTo(alone[index]!.rating, 8);
      expect(row.strengthOfSchedule).toBeCloseTo(alone[index]!.strengthOfSchedule, 8);
      expect(row.record).toBe(alone[index]!.record);
      expect(row.sosRank).toBe(alone[index]!.sosRank);
    });
  });

  it("flags the page's own team the same way", () => {
    const teams = [team("A", "Aces", true), team("B", "Bears")];
    const games = [game("A", "B", 6, 3, "u9")];
    const rows = buildTeamRankings("u9", teams, games, "B", pool);
    expect(rows.filter((row) => row.isMine).map((row) => row.teamId)).toEqual(["B"]);
  });
});

describe("buildTeamRankings without ageGroups", () => {
  it("is the single-group ranking, with the new fields defaulted", () => {
    const teams = [team("A", "Aces"), { ...team("B", "Bears"), gcTeams: [link("gcB", "ag1")] }];
    // A recorded level makes no difference without age groups: nothing pools, nothing gaps.
    const games = [withLevels(game("A", "B", 6, 3, "ag1"), { b: 8 })];
    const rows = buildTeamRankings("ag1", teams, games);
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get("A")!.crossAgeGames).toBe(0);
    expect(byId.get("A")!.fromGameChanger).toBe(false);
    expect(byId.get("B")!.fromGameChanger).toBe(true);
    expect(byId.get("A")!.ageLevel).toBeUndefined();
    expect(byId.get("A")!.rating).toBeCloseTo(-byId.get("B")!.rating, 10);
  });
});

describe("teamNameSuggestions with a pool", () => {
  it("offers a team pulled onto this page before it has played anyone here", () => {
    const teams = [
      team("A", "Aces"),
      { ...team("B", "Bears"), gcTeams: [link("gcB", "u9", { season: "fall", seasonYear: 2026 })] },
      { ...team("C", "Cubs"), gcTeams: [link("gcC", "u10", { season: "fall", seasonYear: 2026 })] },
    ];
    const games = [game("A", "D", 5, 2, "u9")];
    expect(
      teamNameSuggestions("u9", pool, teams, games)
        .map((t) => t.id)
        .sort()
    ).toEqual(["A", "B"]);
    expect(teamNameSuggestions("u10", pool, teams, games).map((t) => t.id)).toEqual(["C"]);
  });

  it("does not offer a team from another season year", () => {
    const teams = [{ ...team("B", "Bears"), gcTeams: [link("gcB", "u9next")] }];
    expect(teamNameSuggestions("u9", pool, teams, [])).toEqual([]);
  });
});

describe("scout ids minted for league teams depend on what came first", () => {
  const finalLog = (away: number, home: number) => ({
    awayRuns: String(away),
    awayHits: "0",
    awayK: "0",
    homeRuns: String(home),
    homeHits: "0",
    homeK: "0",
    innings: "6",
    isFinal: true,
  });

  const nineU: LeagueSeasonSnapshot = {
    seasonId: "s9",
    teams: [
      { id: "L1", name: "Lexington Legends" },
      { id: "L2", name: "Owensboro Oilers" },
    ],
    matchups: [{ id: "m1", date: "2027-04-01", away: "L1", home: "L2" }],
    logs: { m1: finalLog(7, 3) },
  };

  const tenU: LeagueSeasonSnapshot = {
    seasonId: "s10",
    teams: [
      { id: "X1", name: "Lexington Lions" },
      { id: "X2", name: "Paducah Pirates" },
    ],
    matchups: [{ id: "n1", date: "2027-04-02", away: "X1", home: "X2" }],
    logs: { n1: finalLog(4, 1) },
  };

  const idOf = (name: string, teams: ScoutTeam[]) => teams.find((t) => t.name === name)?.id;

  /**
   * `mintScoutTeamId` breaks a name collision by counting, so which club gets the plain id is
   * decided by which one was derived first. This is the property that makes a second derivation
   * pass over a different set of age groups dangerous: it produces a whole second set of ids for
   * the same clubs, and a row carrying one set cannot be looked up in the other.
   */
  it("gives the same club a different id when another club is derived ahead of it", () => {
    const nineFirst = deriveLeagueScoutGames("g9", [nineU], []);
    const bothFromTen = deriveLeagueScoutGames(
      "g9",
      [nineU],
      deriveLeagueScoutGames("g10", [tenU], []).teams
    );

    expect(idOf("Lexington Legends", nineFirst.teams)).toBe("S-LEXI");
    expect(idOf("Lexington Legends", bothFromTen.teams)).toBe("S-LEXI2");
    // Same club, same name, two different ids — so a view must derive once and filter, never
    // derive twice over different sets of groups.
    expect(idOf("Lexington Legends", nineFirst.teams)).not.toBe(
      idOf("Lexington Legends", bothFromTen.teams)
    );
  });

  it("leaves an already stored team on the id it was saved with", () => {
    const stored: ScoutTeam[] = [{ id: "S-LEXI", name: "Lexington Legends" }];
    // The 10U season is walked first, so without the stored roster the Lions would take S-LEXI.
    const afterTen = deriveLeagueScoutGames("g10", [tenU], stored).teams;
    const afterNine = deriveLeagueScoutGames("g9", [nineU], afterTen).teams;

    expect(idOf("Lexington Legends", afterNine)).toBe("S-LEXI");
    expect(idOf("Lexington Lions", afterNine)).toBe("S-LEXI2");
  });
});

describe("what counts as a placeholder", () => {
  it("catches the shape GameChanger actually writes", () => {
    // A bracket slot arrives with the date and kick-off appended, so every one is a different
    // string — which is how a season of them ended up in the rankings as a row apiece.
    expect(isPlaceholderName("TBD- 08/04/26, 5:00 PM")).toBe(true);
    expect(isPlaceholderName("TBD- 08/30/26, 10:45 AM")).toBe(true);
    expect(isPlaceholderName("TBA 9/1")).toBe(true);
    expect(isPlaceholderName("T.B.D.")).toBe(true);
    expect(isPlaceholderName("TBD")).toBe(true);
  });

  it("still leaves real clubs alone", () => {
    expect(isPlaceholderName("Trash Pandas Baseball Club")).toBe(false);
    expect(isPlaceholderName("Tigers")).toBe(false);
    // "Bye" and "Team" are matched exactly and never as a prefix, since a club can begin with one.
    expect(isPlaceholderName("Byers Bulldogs")).toBe(false);
    expect(isPlaceholderName("Team Elite Premier")).toBe(false);
  });
});

describe("placeholders are slots, not teams", () => {
  const slotTeams = (names: string[]): { teams: ScoutTeam[]; ids: string[] } => {
    let teams: ScoutTeam[] = [];
    const ids: string[] = [];
    names.forEach((name) => {
      const made = resolveOrCreateTeam(name, teams);
      teams = made.teams;
      ids.push(made.teamId);
    });
    return { teams, ids };
  };

  it("never folds two placeholders into one team", () => {
    // The whole point: one shared "TBD" would be an opponent that unrelated teams had all played.
    const { teams, ids } = slotTeams(["TBD", "TBD", "Winner of Game 3"]);
    expect(new Set(ids).size).toBe(3);
    expect(teams).toHaveLength(3);
    expect(teams.every((team) => team.placeholder)).toBe(true);
  });

  it("still matches real names to the team already there", () => {
    const { ids } = slotTeams(["Aces", "Aces"]);
    expect(ids[0]).toBe(ids[1]);
  });

  it("keeps a real name off a slot that happens to be near it", () => {
    let teams: ScoutTeam[] = [];
    const slot = resolveOrCreateTeam("TBD", teams);
    teams = slot.teams;
    const real = resolveOrCreateTeam("Aces", teams);
    expect(real.teamId).not.toBe(slot.teamId);
  });

  it("does not rank a slot, but counts the game for the team that played it", () => {
    const groups: AgeGroup[] = [
      { id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
    ];
    let teams: ScoutTeam[] = [team("A", "Aces"), team("B", "Bears")];
    const slotA = resolveOrCreateTeam("TBD", teams);
    teams = slotA.teams;
    const slotB = resolveOrCreateTeam("TBD", teams);
    teams = slotB.teams;

    const games = [
      game("A", "B", 6, 2, "ag1"),
      game("A", slotA.teamId, 9, 1, "ag1"),
      game("B", slotB.teamId, 1, 7, "ag1"),
    ];
    const rows = buildTeamRankings("ag1", teams, games, undefined, groups);

    // Only the two real clubs are listed.
    expect(rows.map((row) => row.teamName).sort()).toEqual(["Aces", "Bears"]);
    // And the game against the slot is in the record, not discarded.
    const aces = rows.find((row) => row.teamName === "Aces")!;
    expect(aces.record).toBe("2-0");
    expect(aces.games).toBe(2);
    const bears = rows.find((row) => row.teamName === "Bears")!;
    expect(bears.record).toBe("0-2");
  });

  it("does not let two slots carry a comparison between the teams that played them", () => {
    const groups: AgeGroup[] = [
      { id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
    ];
    let teams: ScoutTeam[] = [team("A", "Aces"), team("B", "Bears")];
    const slotA = resolveOrCreateTeam("TBD", teams);
    teams = slotA.teams;
    const slotB = resolveOrCreateTeam("TBD", teams);
    teams = slotB.teams;

    // Aces thrash their slot; Bears are thrashed by theirs. Nothing here says Aces beat Bears,
    // because the two slots are different unknown clubs.
    const rows = buildTeamRankings(
      "ag1",
      teams,
      [game("A", slotA.teamId, 8, 0, "ag1"), game(slotB.teamId, "B", 8, 0, "ag1")],
      undefined,
      groups
    );
    const aces = rows.find((row) => row.teamName === "Aces")!;
    const bears = rows.find((row) => row.teamName === "Bears")!;
    // Each is judged on its own game, so neither has met the other even indirectly: their
    // strengths of schedule are the mirror image rather than a chain through one shared opponent.
    expect(aces.strengthOfSchedule).toBeCloseTo(-bears.strengthOfSchedule, 10);
  });

  it("keeps a slot out of the names offered when logging a game", () => {
    const groups: AgeGroup[] = [
      { id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
    ];
    let teams: ScoutTeam[] = [team("A", "Aces")];
    const slot = resolveOrCreateTeam("TBD", teams);
    teams = slot.teams;
    const names = teamNameSuggestions("ag1", groups, teams, [
      game("A", slot.teamId, 5, 4, "ag1"),
    ]).map((entry) => entry.name);
    expect(names).toContain("Aces");
    expect(names).not.toContain("TBD");
  });
});
