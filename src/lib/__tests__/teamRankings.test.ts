import { describe, expect, it } from "vitest";
import {
  ageGroupChain,
  buildScoutingReport,
  buildTeamRankings,
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
  stripAgeLabel,
  teamNameSuggestions,
  teamsInAgeGroup,
  type AgeGroup,
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

describe("stripAgeLabel", () => {
  it("drops an age label wherever it appears", () => {
    expect(stripAgeLabel("South Lexington Red 9u")).toBe("South Lexington Red");
    expect(stripAgeLabel("Velocirabbits 9U")).toBe("Velocirabbits");
    expect(stripAgeLabel("NV Stars 9u Scout")).toBe("NV Stars Scout");
    expect(stripAgeLabel("12U Thunder")).toBe("Thunder");
    expect(stripAgeLabel("U10 Rockets")).toBe("Rockets");
    expect(stripAgeLabel("Thunder - 9U")).toBe("Thunder");
  });

  it("leaves names that only look like an age label alone", () => {
    expect(stripAgeLabel("The 9ers")).toBe("The 9ers");
    // "12 U" here is the start of "United", not an age level.
    expect(stripAgeLabel("Lexington 12 United")).toBe("Lexington 12 United");
  });

  it("keeps something when the name is nothing but an age label", () => {
    expect(stripAgeLabel("9U")).toBe("9U");
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
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams)).toEqual([
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
    const out = externalResultsForSeason("spring2027", groups, teams, games, leagueTeams);
    expect(out).toEqual([{ home: "L-ACE", away: "L-BEA", homeMargin: 1, neutral: true }]);
  });

  it("keeps an outside opponent under an id of its own", () => {
    // The point of including these: the model estimates how good the travel club was, rather than
    // assuming, which is what makes a shared opponent informative.
    const games = [game("A", "X", 2, 6, "ag1")];
    const out = externalResultsForSeason("spring2027", groups, teams, games, leagueTeams);
    expect(out).toHaveLength(1);
    expect(out[0]?.home).toBe("L-ACE");
    expect(out[0]?.away).not.toBe("L-BEA");
    expect(out[0]?.away).toContain("X");
    expect(out[0]?.homeMargin).toBe(-4);
  });

  it("ignores age groups that do not include this season", () => {
    const games = [game("A", "B", 7, 3, "ag2")];
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams)).toEqual([]);
  });

  it("returns nothing when no age group is linked to the season at all", () => {
    const games = [game("A", "B", 7, 3, "ag1")];
    expect(externalResultsForSeason("winter2099", groups, teams, games, leagueTeams)).toEqual([]);
  });

  it("skips a scheduled game that has no score yet", () => {
    const games = [game("A", "B", undefined, undefined, "ag1")];
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams)).toEqual([]);
  });

  it("matches names across age labels, as everything else here does", () => {
    const aged = [team("A", "Aces 9U"), team("B", "Bears")];
    const games = [game("A", "B", 7, 3, "ag1")];
    const out = externalResultsForSeason("spring2027", groups, aged, games, leagueTeams);
    expect(out[0]?.home).toBe("L-ACE");
  });
});

describe("renameScoutTeam", () => {
  const teams = [team("A", "Aces"), team("B", "Bears"), team("T", "TBD")];

  it("renames in place when the name is free", () => {
    const out = renameScoutTeam("A", "Aces Red", teams, []);
    expect(out.mergedInto).toBeNull();
    expect(out.teams.find((t) => t.id === "A")?.name).toBe("Aces Red");
  });

  it("strips an age label from the new name, like every other entry point", () => {
    const out = renameScoutTeam("A", "Aces 10U", teams, []);
    expect(out.teams.find((t) => t.id === "A")?.name).toBe("Aces");
  });

  it("merges into the existing team when the name is taken, routing its games over", () => {
    // This is how a placeholder gets sent to the team it really was.
    const games = [game("T", "B", 4, 9, "ag1"), game("A", "B", 3, 2, "ag1")];
    const out = renameScoutTeam("T", "Aces", teams, games);

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
    const out = renameScoutTeam("T", "Aces", teams, games);
    expect(out.droppedGames).toBe(1);
    expect(out.games).toHaveLength(1);
    expect(out.games[0]?.teamAId).toBe("A");
  });

  it("refuses a name that is empty once the age label comes off", () => {
    const out = renameScoutTeam("A", "   ", teams, []);
    expect(out.teams).toBe(teams);
    expect(out.mergedInto).toBeNull();
  });

  it("is a no-op rename when the name only differs by case or age label", () => {
    const out = renameScoutTeam("A", "aces 9u", teams, []);
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
    expect(externalResultsForSeason("spring2027", groups, teams, games, leagueTeams)).toEqual([]);
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
