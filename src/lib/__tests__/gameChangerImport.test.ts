import { describe, expect, it } from "vitest";
import gamesFixture from "./fixtures/gc-team-games.json";
import profileFixture from "./fixtures/gc-team-profile.json";
import { normalizeGcGames, normalizeGcTeamProfile, type GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedule,
  importGcSchedules,
  proposeSeasonPairings,
  summarizeGcImport,
  type GcImportState,
} from "../gameChangerImport";
import { countsTowardRating, isScoutGamePlayed, type ScoutTeam } from "../teamRankings";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

const schedule = (
  overrides: Partial<GcTeamSchedule["profile"]> = {},
  games: GcTeamSchedule["games"] = []
): GcTeamSchedule => ({
  profile: {
    id: "gcAAAAAAAAAA",
    name: "Lexington Legends 9U",
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    ...overrides,
  },
  games,
  fetchedAt: "2026-09-14T12:00:00.000Z",
});

const game = (overrides: Partial<GcTeamSchedule["games"][number]> = {}) => ({
  id: "g1",
  date: "2026-08-22",
  opponentName: "NKY Sluggers 9U",
  status: "completed" as const,
  teamScore: 12,
  opponentScore: 2,
  ...overrides,
});

describe("importGcSchedule", () => {
  it("files a schedule under the squad year its season belongs to", () => {
    // Fall 2026 and Spring 2027 are one squad, and this app calls that squad "9U 2027".
    const { state, outcome } = importGcSchedule(schedule({}, [game()]), empty);

    expect(outcome.issue).toBeUndefined();
    expect(outcome.createdAgeGroup).toBe(true);
    expect(outcome.ageGroupName).toBe("9U 2027");
    expect(state.ageGroups).toHaveLength(1);
    expect(state.ageGroups[0]).toMatchObject({ ageLevel: 9, year: 2027 });
  });

  it("creates the team, the opponent and the game", () => {
    const { state, outcome } = importGcSchedule(schedule({}, [game()]), empty);

    expect(outcome.createdTeam).toBe(true);
    expect(outcome.gamesAdded).toBe(1);
    expect(outcome.opponentsCreated).toBe(1);
    expect(state.teams).toHaveLength(2);
    expect(state.games).toHaveLength(1);
    expect(state.games[0]).toMatchObject({ teamAScore: 12, teamBScore: 2, date: "2026-08-22" });
    expect(state.games[0]?.source).toEqual({
      kind: "gamechanger",
      teamId: "gcAAAAAAAAAA",
      gameId: "g1",
    });
  });

  it("records the GameChanger id on the team it was pulled as", () => {
    const { state } = importGcSchedule(
      schedule({ avatarKey: "av-legends", state: "ky", city: "Lexington" }, [game()]),
      empty
    );
    const pulled = state.teams.find((team) => team.gcTeams?.length);
    expect(pulled).toMatchObject({ state: "KY", city: "Lexington" });
    expect(pulled?.gcTeams?.[0]).toMatchObject({
      teamId: "gcAAAAAAAAAA",
      ageLevel: 9,
      season: "fall",
      seasonYear: 2026,
      avatarKey: "av-legends",
    });
  });

  // A schedule is pulled again and again as a season runs; almost nothing changes each time.
  it("is a no-op when the same schedule is pulled again", () => {
    const first = importGcSchedule(schedule({}, [game()]), empty);
    const second = importGcSchedule(schedule({}, [game()]), first.state);

    expect(second.outcome.gamesAdded).toBe(0);
    expect(second.outcome.gamesUnchanged).toBe(1);
    expect(second.state.games).toHaveLength(1);
    expect(second.state.teams).toHaveLength(2);
    expect(second.state.ageGroups).toHaveLength(1);
  });

  it("writes a score that has been played since the last pull", () => {
    const scheduled = importGcSchedule(
      schedule({}, [game({ status: "scheduled", teamScore: undefined, opponentScore: undefined })]),
      empty
    );
    expect(isScoutGamePlayed(scheduled.state.games[0]!)).toBe(false);

    const played = importGcSchedule(schedule({}, [game()]), scheduled.state);
    expect(played.outcome.gamesUpdated).toBe(1);
    expect(played.state.games).toHaveLength(1);
    expect(played.state.games[0]).toMatchObject({ teamAScore: 12, teamBScore: 2 });
  });

  it("leaves out games with no date and games called off", () => {
    const { state, outcome } = importGcSchedule(
      schedule({}, [
        game({ id: "g1", date: undefined }),
        game({ id: "g2", status: "canceled" }),
        game({ id: "g3" }),
      ]),
      empty
    );
    expect(outcome.gamesIgnored).toBe(2);
    expect(outcome.gamesAdded).toBe(1);
    expect(state.games).toHaveLength(1);
  });

  it("says so, and changes nothing, when there is no page to file under", () => {
    const noLevel = importGcSchedule(
      schedule({ name: "Wildcats", ageLevel: undefined }, [game()]),
      empty
    );
    expect(noLevel.outcome.issue).toContain("age group");
    expect(noLevel.state).toBe(empty);

    const noSeason = importGcSchedule(schedule({ season: undefined }, [game()]), empty);
    expect(noSeason.outcome.issue).toContain("season");
    expect(noSeason.state).toBe(empty);
  });
});

describe("the same game on two schedules", () => {
  // Both teams' schedules list the one game, so pulling both must not file it twice.
  it("is matched rather than duplicated", () => {
    const ours = schedule({}, [game()]);
    const theirs = schedule({ id: "gcBBBBBBBBBB", name: "NKY Sluggers 9U" }, [
      game({
        id: "their-g1",
        opponentName: "Lexington Legends 9U",
        teamScore: 2,
        opponentScore: 12,
      }),
    ]);

    const { state, outcomes } = importGcSchedules([ours, theirs], empty);

    expect(outcomes[0]?.gamesAdded).toBe(1);
    expect(outcomes[1]?.gamesAdded).toBe(0);
    expect(state.games).toHaveLength(1);
    // The side order of the row that was already there stands, and the scores still belong to it.
    const row = state.games[0]!;
    expect(row.teamAScore).toBe(12);
    expect(row.teamBScore).toBe(2);
  });

  it("keeps a doubleheader as two games", () => {
    const { state } = importGcSchedule(
      schedule({}, [game({ id: "g1" }), game({ id: "g2", teamScore: 4, opponentScore: 5 })]),
      empty
    );
    expect(state.games).toHaveLength(2);
  });
});

describe("who an opponent is", () => {
  it("is the team with that avatar, wherever it was pulled from", () => {
    const pulled = importGcSchedule(
      schedule({ id: "gcSLUGGERS00", name: "NKY Sluggers 9U", avatarKey: "av-sluggers" }, []),
      empty
    );

    const { state, outcome } = importGcSchedule(
      schedule({}, [game({ opponentName: "Sluggers", opponentAvatarKey: "av-sluggers" })]),
      pulled.state
    );

    expect(outcome.opponentsMatchedByAvatar).toBe(1);
    expect(outcome.opponentsCreated).toBe(0);
    // Named differently on this schedule, and still the same club.
    expect(state.teams).toHaveLength(2);
    const filed = state.games[0]!;
    expect([filed.teamAId, filed.teamBId]).toContain(
      state.teams.find((team) => team.gcTeams?.[0]?.teamId === "gcSLUGGERS00")!.id
    );
  });

  it("is not matched by name alone across a different age level", () => {
    const nineU = importGcSchedule(schedule({}, [game({ opponentName: "Yankees" })]), empty);
    const elevenU = importGcSchedule(
      schedule({ id: "gcCCCCCCCCCC", name: "Bandits 11U", ageLevel: 11 }, [
        game({ id: "g9", opponentName: "Yankees" }),
      ]),
      nineU.state
    );

    // "Yankees" on an 11U schedule is not the "Yankees" on a 9U one.
    expect(elevenU.outcome.opponentsCreated).toBe(1);
    expect(elevenU.state.teams.filter((team) => team.name === "Yankees")).toHaveLength(2);
  });

  it("is matched by name within one page", () => {
    const first = importGcSchedule(schedule({}, [game({ opponentName: "Yankees" })]), empty);
    const second = importGcSchedule(
      schedule({ id: "gcDDDDDDDDDD", name: "Comets 9U" }, [
        game({ id: "g2", opponentName: "Yankees", date: "2026-08-30" }),
      ]),
      first.state
    );
    expect(second.outcome.opponentsMatchedByName).toBe(1);
    expect(second.state.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);
  });
});

describe("a real schedule", () => {
  const real: GcTeamSchedule = {
    profile: normalizeGcTeamProfile(profileFixture)!,
    games: normalizeGcGames(gamesFixture),
    fetchedAt: "2026-09-14T12:44:04.965Z",
  };

  it("files all twelve games, and rates them", () => {
    const { state, outcome } = importGcSchedule(real, empty);

    expect(outcome.issue).toBeUndefined();
    expect(outcome.gamesAdded).toBe(12);
    expect(state.games).toHaveLength(12);
    expect(state.games.every(countsTowardRating)).toBe(true);
    expect(outcome.ageGroupName).toBe("9U 2027");
  });

  it("agrees with the record GameChanger reported", () => {
    const { state } = importGcSchedule(real, empty);
    const ours = state.teams.find((team) => team.gcTeams?.[0]?.teamId === real.profile.id)!;
    const wins = state.games.filter((entry) =>
      entry.teamAId === ours.id
        ? entry.teamAScore! > entry.teamBScore!
        : entry.teamBScore! > entry.teamAScore!
    ).length;
    expect(wins).toBe(real.profile.record?.win);
  });
});

describe("proposeSeasonPairings", () => {
  const withLinks = (
    id: string,
    name: string,
    link: Partial<NonNullable<ScoutTeam["gcTeams"]>[number]>
  ): ScoutTeam => ({
    id,
    name,
    gcTeams: [
      {
        teamId: `gc-${id}`,
        name,
        ageGroupId: "ag1",
        ageLevel: 9,
        ...link,
      },
    ],
  });

  it("offers a Fall squad and the Spring squad that follows it", () => {
    const pairings = proposeSeasonPairings([
      withLinks("t1", "Trosky Illinois 9U", {
        season: "fall",
        seasonYear: 2026,
        avatarKey: "av-1",
      }),
      withLinks("t2", "Trosky Illinois 9U", {
        season: "spring",
        seasonYear: 2027,
        avatarKey: "av-1",
      }),
    ]);

    expect(pairings).toHaveLength(1);
    expect(pairings[0]).toMatchObject({
      fromTeamId: "t1",
      toTeamId: "t2",
      basis: "avatar",
      confidence: "strong",
      fromSeason: "Fall 2026",
      toSeason: "Spring 2027",
    });
  });

  it("does not offer two clubs that only share a name at different levels", () => {
    const pairings = proposeSeasonPairings([
      withLinks("t1", "Yankees", { season: "fall", seasonYear: 2026, ageLevel: 9 }),
      withLinks("t2", "Yankees", { season: "spring", seasonYear: 2027, ageLevel: 11 }),
    ]);
    expect(pairings).toEqual([]);
  });

  // Summer to the next Fall is a squad ageing up, not the same squad continuing.
  it("does not offer a pairing across a squad year", () => {
    const pairings = proposeSeasonPairings([
      withLinks("t1", "Trosky", { season: "spring", seasonYear: 2027, avatarKey: "av-1" }),
      withLinks("t2", "Trosky", { season: "fall", seasonYear: 2027, avatarKey: "av-1" }),
    ]);
    expect(pairings).toEqual([]);
  });

  it("puts the strongest evidence first", () => {
    const pairings = proposeSeasonPairings([
      withLinks("a1", "Aces", { season: "fall", seasonYear: 2026 }),
      withLinks("a2", "Aces", { season: "spring", seasonYear: 2027 }),
      withLinks("b1", "Bears", { season: "fall", seasonYear: 2026, avatarKey: "av-b" }),
      withLinks("b2", "Bears", { season: "spring", seasonYear: 2027, avatarKey: "av-b" }),
    ]);
    expect(pairings[0]?.confidence).toBe("strong");
    expect(pairings[pairings.length - 1]?.confidence).toBe("likely");
  });
});

describe("summarizeGcImport", () => {
  it("counts what a pull did", () => {
    const { outcomes } = importGcSchedules(
      [schedule({}, [game()]), schedule({ id: "gcEEEEEEEEEE", name: "Comets 9U" }, [])],
      empty
    );
    const lines = summarizeGcImport(outcomes);
    expect(lines[0]).toContain("2 schedules read");
    expect(lines[1]).toContain("1 game added");
  });

  it("names the schedules it could not file", () => {
    const { outcomes } = importGcSchedules([schedule({ season: undefined }, [game()])], empty);
    expect(summarizeGcImport(outcomes)[0]).toContain("could not be filed");
  });
});

describe("a schedule that has not caught up", () => {
  // GameChanger posts a result on one team's schedule before the other's, so the opponent's copy
  // of a game that has been played routinely arrives with nothing in it.
  it("does not erase a score with an unscored copy of the same game", () => {
    const scored = importGcSchedule(schedule({}, [game()]), empty);
    expect(scored.state.games[0]).toMatchObject({ teamAScore: 12, teamBScore: 2 });

    const theirs = schedule({ id: "gcBBBBBBBBBB", name: "NKY Sluggers 9U" }, [
      game({
        id: "their-g1",
        opponentName: "Lexington Legends 9U",
        teamScore: undefined,
        opponentScore: undefined,
        status: "scheduled",
      }),
    ]);
    const after = importGcSchedule(theirs, scored.state);

    expect(after.state.games).toHaveLength(1);
    expect(after.state.games[0]).toMatchObject({ teamAScore: 12, teamBScore: 2 });
  });

  it("still writes a score that has genuinely been corrected", () => {
    const first = importGcSchedule(schedule({}, [game()]), empty);
    const corrected = importGcSchedule(
      schedule({}, [game({ teamScore: 11, opponentScore: 3 })]),
      first.state
    );
    expect(corrected.outcome.gamesUpdated).toBe(1);
    expect(corrected.state.games[0]).toMatchObject({ teamAScore: 11, teamBScore: 3 });
  });

  // The other team lists itself first, so its copy is the mirror of the row already here.
  it("does not call a mirrored copy a change", () => {
    const ours = importGcSchedule(schedule({}, [game()]), empty);
    const theirs = importGcSchedule(
      schedule({ id: "gcBBBBBBBBBB", name: "NKY Sluggers 9U" }, [
        game({
          id: "their-g1",
          opponentName: "Lexington Legends 9U",
          teamScore: 2,
          opponentScore: 12,
        }),
      ]),
      ours.state
    );
    expect(theirs.outcome.gamesUnchanged).toBe(1);
    expect(theirs.outcome.gamesUpdated).toBe(0);
  });
});

describe("both sides of a cross-age game", () => {
  const nineU = schedule({ id: "gcNINE000000", name: "Lexington Legends 9U", ageLevel: 9 }, [
    game({ id: "g1", opponentName: "Bandits 11U", teamScore: 12, opponentScore: 2 }),
  ]);
  const elevenU = schedule({ id: "gcELEVEN0000", name: "Bandits 11U", ageLevel: 11 }, [
    game({ id: "t1", opponentName: "Lexington Legends 9U", teamScore: 2, opponentScore: 12 }),
  ]);

  /**
   * The two sides of a cross-age game are filed under different pages — the 9U's copy on the 9U
   * page, the 11U's on its own — so a name looked up on the page could never find the opponent the
   * other side had already created. Pulling both made a second Bandits and a second row.
   */
  it("is one team each and one game, whichever order they are pulled in", () => {
    const forwards = importGcSchedules([nineU, elevenU], empty);
    expect(forwards.state.teams).toHaveLength(2);
    expect(forwards.state.games).toHaveLength(1);

    const backwards = importGcSchedules([elevenU, nineU], empty);
    expect(backwards.state.teams).toHaveLength(2);
    expect(backwards.state.games).toHaveLength(1);
  });

  it("gives each side its own page and keeps the level each played at", () => {
    const { state } = importGcSchedules([nineU, elevenU], empty);
    expect(state.ageGroups.map((group) => group.name).sort()).toEqual(["11U 2027", "9U 2027"]);
    const filed = state.games[0]!;
    expect([filed.ageLevelA, filed.ageLevelB].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([9, 11]);
  });

  // The level still has to agree, or a club's own two squads would fold into one team.
  it("keeps a club's 9U and 11U squads apart", () => {
    const clubNine = schedule({ id: "gcCLUB9", name: "Bandits 9U", ageLevel: 9 }, [
      game({ id: "a1", opponentName: "Aces 9U" }),
    ]);
    const clubEleven = schedule({ id: "gcCLUB11", name: "Bandits 11U", ageLevel: 11 }, [
      game({ id: "b1", opponentName: "Comets 11U" }),
    ]);
    const { state } = importGcSchedules([clubNine, clubEleven], empty);
    expect(state.teams.filter((team) => team.name === "Bandits")).toHaveLength(2);
  });
});

describe("a name two clubs share", () => {
  // Both pulled by id, so neither is name-matched: two real teams called Yankees, which is exactly
  // what identity-by-id is for.
  const first = schedule({ id: "gcY100000000", name: "Yankees 9U" }, [
    game({ id: "y1", opponentName: "Aces 9U" }),
  ]);
  const second = schedule({ id: "gcY200000000", name: "Yankees 9U" }, [
    game({ id: "y2", opponentName: "Bears 9U", date: "2026-08-24" }),
  ]);
  // A third schedule names "Yankees" as an opponent, and cannot say which.
  const third = schedule({ id: "gcC000000000", name: "Comets 9U" }, [
    game({ id: "c1", opponentName: "Yankees", date: "2026-08-25" }),
  ]);

  /**
   * The ambiguous name has to become *a* team — the game happened and needs an opponent — but the
   * next pull must find that team rather than make another. The opponent a known game already
   * settled on is the answer, so a weekly re-pull no longer adds a Yankees a week forever.
   */
  it("stops making a new team on every re-pull", () => {
    let state = importGcSchedules([first, second, third], empty).state;
    const afterFirst = state.teams.length;

    for (let round = 0; round < 3; round += 1) {
      state = importGcSchedules([first, second, third], state).state;
    }

    expect(state.teams).toHaveLength(afterFirst);
    expect(state.games).toHaveLength(3);
  });

  it("does not fold a club into a namesake by adopting an ambiguous placeholder", () => {
    // Two name-only "Yankees" on the page, then a real Yankees pulled by id.
    const seeded = importGcSchedules(
      [
        schedule({ id: "gcP100000000", name: "Aces 9U" }, [
          game({ id: "p1", opponentName: "Yankees" }),
        ]),
        schedule({ id: "gcP200000000", name: "Bears 9U" }, [
          game({ id: "p2", opponentName: "Yankees", date: "2026-08-26" }),
        ]),
      ],
      empty
    ).state;
    // Those two both matched by name, so there is one placeholder, and adopting it is right.
    expect(seeded.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);

    const pulled = importGcSchedule(
      schedule({ id: "gcY900000000", name: "Yankees 9U" }, []),
      seeded
    );
    expect(pulled.outcome.createdTeam).toBe(false);
  });
});
