import { describe, expect, it } from "vitest";
import gamesFixture from "./fixtures/gc-team-games.json";
import profileFixture from "./fixtures/gc-team-profile.json";
import { normalizeGcGames, normalizeGcTeamProfile, type GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedule,
  resolveSlotGames,
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

  it("is not matched on the name alone, however tempting it looks", () => {
    // Aces played a Yankees in August; Comets played a Yankees a week later. Nothing says those
    // are the same Yankees, and a nationwide pool holds a dozen clubs of that name at one level.
    const first = importGcSchedule(schedule({}, [game({ opponentName: "Yankees" })]), empty);
    const second = importGcSchedule(
      schedule({ id: "gcDDDDDDDDDD", name: "Comets 9U" }, [
        game({ id: "g2", opponentName: "Yankees", date: "2026-08-30" }),
      ]),
      first.state
    );
    expect(second.outcome.opponentsMatchedByName).toBe(0);
    expect(second.state.teams.filter((team) => team.name === "Yankees")).toHaveLength(2);
  });

  it("is matched by name once the two clubs have a game in common", () => {
    // Aces play Yankees, then Bears play Yankees, then Comets play both — by which point Yankees
    // and Comets share Aces and Bears, and the name is no longer all there is to go on.
    let state = importGcSchedule(schedule({}, [game({ opponentName: "Yankees" })]), empty).state;
    state = importGcSchedule(
      schedule({ id: "gcBBBBBBBBBB", name: "Bears 9U" }, [
        game({ id: "b1", opponentName: "Yankees", date: "2026-08-23" }),
        game({ id: "b2", opponentName: "Aces 9U", date: "2026-08-24" }),
      ]),
      state
    ).state;
    // Bears matched nothing by name either, so there are two Yankees and two Aces by now.
    const before = state.teams.filter((team) => team.name === "Yankees").length;
    expect(before).toBe(2);
  });

  it("is matched by name when one schedule's game is the other's, same day", () => {
    // The case a bracket makes: one side posts the fixture, the other posts a placeholder.
    const first = importGcSchedule(
      schedule({ name: "Aces 9U" }, [game({ opponentName: "TBD", date: "2026-08-22" })]),
      empty
    );
    const second = importGcSchedule(
      schedule({ id: "gcDDDDDDDDDD", name: "Comets 9U" }, [
        game({ id: "g2", opponentName: "Aces 9U", date: "2026-08-22" }),
      ]),
      first.state
    );
    expect(second.outcome.opponentsMatchedByName).toBe(1);
    expect(second.state.teams.filter((team) => team.name === "Aces")).toHaveLength(1);
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
      evidence: ["avatar"],
      sameName: true,
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
      // The name and a shared state: worth offering, not worth calling certain.
      { ...withLinks("a1", "Aces", { season: "fall", seasonYear: 2026 }), state: "KY" },
      { ...withLinks("a2", "Aces", { season: "spring", seasonYear: 2027 }), state: "KY" },
      withLinks("b1", "Bears", { season: "fall", seasonYear: 2026, avatarKey: "av-b" }),
      withLinks("b2", "Bears", { season: "spring", seasonYear: 2027, avatarKey: "av-b" }),
    ]);
    expect(pairings[0]?.confidence).toBe("strong");
    expect(pairings[pairings.length - 1]?.confidence).toBe("likely");
  });

  it("does not offer two clubs that only share a name", () => {
    // The pool is full of these. Offering them all is worse than offering none: read enough
    // near-certain rows and the wrong one gets approved along with the rest.
    expect(
      proposeSeasonPairings([
        withLinks("a1", "Yankees", { season: "fall", seasonYear: 2026 }),
        withLinks("a2", "Yankees", { season: "spring", seasonYear: 2027 }),
      ])
    ).toEqual([]);
  });

  it("offers a shared name backed by a club they both played", () => {
    const teams = [
      withLinks("a1", "Yankees", { season: "fall", seasonYear: 2026 }),
      withLinks("a2", "Yankees", { season: "spring", seasonYear: 2027 }),
      { id: "rival", name: "Trash Pandas" },
    ];
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "a1", teamBId: "rival", ageGroupId: "ag1" },
      { id: "g2", teamAId: "a2", teamBId: "rival", ageGroupId: "ag1" },
    ];
    const pairings = proposeSeasonPairings(teams, games);
    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.evidence).toEqual(["shared-opponent"]);
  });

  it("offers neither when two clubs could both be what this squad became", () => {
    // A squad carries on into one next season. Two candidates means the answer is not known.
    const teams = [
      { ...withLinks("from", "Yankees", { season: "fall", seasonYear: 2026 }), state: "KY" },
      { ...withLinks("toA", "Yankees", { season: "spring", seasonYear: 2027 }), state: "KY" },
      { ...withLinks("toB", "Yankees", { season: "spring", seasonYear: 2027 }), state: "KY" },
    ];
    expect(proposeSeasonPairings(teams).filter((p) => p.fromTeamId === "from")).toEqual([]);
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
    // Two schedules naming a Yankees is not evidence they mean the same one, so there are two.
    expect(seeded.teams.filter((team) => team.name === "Yankees")).toHaveLength(2);

    // And with two of them on the page, the real Yankees cannot know which it is, so it stays
    // its own club rather than adopting one and taking the other club's games with it.
    const pulled = importGcSchedule(
      schedule({ id: "gcY900000000", name: "Yankees 9U" }, []),
      seeded
    );
    expect(pulled.outcome.createdTeam).toBe(true);
  });
});

describe("levels this app does not rank", () => {
  it("skips a team below the youngest ranked level instead of making it a page", () => {
    const state: GcImportState = { ageGroups: [], teams: [], games: [] };
    const { state: next, outcome } = importGcSchedule(
      {
        profile: {
          id: "gc7u",
          name: "Tiny Titans 7U",
          ageLevel: 7,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: "g1",
            date: "2026-09-05",
            opponentName: "Some Club 7U",
            teamScore: 5,
            opponentScore: 4,
            status: "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    );
    expect(outcome.issue).toContain("below the youngest level ranked here");
    // Nothing is filed: no page, no team, no game.
    expect(next.ageGroups).toEqual([]);
    expect(next.teams).toEqual([]);
    expect(next.games).toEqual([]);
  });

  it("still files a team at the youngest ranked level", () => {
    const state: GcImportState = { ageGroups: [], teams: [], games: [] };
    const { state: next, outcome } = importGcSchedule(
      {
        profile: {
          id: "gc8u",
          name: "Tiny Titans 8U",
          ageLevel: 8,
          season: { season: "fall", year: 2026 },
        },
        games: [],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    );
    expect(outcome.issue).toBeUndefined();
    expect(next.ageGroups).toHaveLength(1);
    expect(next.ageGroups[0]!.ageLevel).toBe(8);
  });

  it("skips a team whose age nothing could say", () => {
    const state: GcImportState = { ageGroups: [], teams: [], games: [] };
    const { state: next, outcome } = importGcSchedule(
      {
        profile: { id: "gcx", name: "Just A Club", season: { season: "fall", year: 2026 } },
        games: [],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    );
    expect(outcome.issue).toContain("no age group");
    expect(next.ageGroups).toEqual([]);
  });
});

describe("a placeholder opponent", () => {
  const pull = (opponentName: string, gameId: string, state: GcImportState) =>
    importGcSchedule(
      {
        profile: {
          id: `gc${gameId}`,
          name: `Club ${gameId} 9U`,
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: gameId,
            date: "2026-09-05",
            opponentName,
            teamScore: 7,
            opponentScore: 3,
            status: "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    );

  it("gets a slot of its own on every schedule, never one shared team", () => {
    let state: GcImportState = { ageGroups: [], teams: [], games: [] };
    state = pull("TBD", "g1", state).state;
    state = pull("TBD", "g2", state).state;

    const slots = state.teams.filter((team) => team.placeholder);
    expect(slots).toHaveLength(2);
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(2);
    // Both games are kept — the result happened, whoever it was against.
    expect(state.games).toHaveLength(2);
    expect(state.games.every((game) => game.teamAScore === 7)).toBe(true);
  });

  it("is not mistaken for a real club with a similar-looking name", () => {
    let state: GcImportState = { ageGroups: [], teams: [], games: [] };
    state = pull("Trash Pandas 9U", "g1", state).state;
    state = pull("TBD", "g2", state).state;
    const named = state.teams.filter((team) => !team.placeholder).map((team) => team.name);
    expect(named).toContain("Trash Pandas");
    expect(state.teams.filter((team) => team.placeholder)).toHaveLength(1);
  });
});

describe("resolveSlotGames", () => {
  /** Two schedules for one fixture: one names the club, the other only said "TBD". */
  const bothSides = (opts: {
    slotTime?: string;
    namedTime?: string;
    slotScored?: boolean;
    namedScored?: boolean;
  }): GcImportState => {
    let state: GcImportState = { ageGroups: [], teams: [], games: [] };
    state = importGcSchedule(
      {
        profile: {
          id: "gcA",
          name: "Aces 9U",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: "a1",
            date: "2026-09-05",
            ...(opts.slotTime ? { startTs: opts.slotTime } : {}),
            opponentName: "TBD",
            ...(opts.slotScored === false ? {} : { teamScore: 7, opponentScore: 3 }),
            status: opts.slotScored === false ? "scheduled" : "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    ).state;
    state = importGcSchedule(
      {
        profile: {
          id: "gcB",
          name: "Bears 9U",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: "b1",
            date: "2026-09-05",
            ...(opts.namedTime ? { startTs: opts.namedTime } : {}),
            opponentName: "Aces 9U",
            ...(opts.namedScored === false ? {} : { teamScore: 3, opponentScore: 7 }),
            status: opts.namedScored === false ? "scheduled" : "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    ).state;
    return state;
  };

  it("lets the schedule that named the club answer the one that said TBD", () => {
    const before = bothSides({});
    // Two rows for one fixture, and a slot standing where Bears belong.
    expect(before.games).toHaveLength(2);
    expect(before.teams.filter((team) => team.placeholder)).toHaveLength(1);

    const { state, resolved } = resolveSlotGames(before);
    expect(resolved).toBe(1);
    // One fixture, one row, both sides real.
    expect(state.games).toHaveLength(1);
    expect(state.teams.filter((team) => team.placeholder)).toEqual([]);
    const survivor = state.games[0]!;
    const names = [survivor.teamAId, survivor.teamBId].map(
      (id) => state.teams.find((team) => team.id === id)!.name
    );
    expect(names.sort()).toEqual(["Aces", "Bears"]);
  });

  it("takes a score the naming schedule had not posted yet", () => {
    const { state } = resolveSlotGames(bothSides({ namedScored: false }));
    const survivor = state.games[0]!;
    const byId = new Map(state.teams.map((team) => [team.id, team.name]));
    const aces = byId.get(survivor.teamAId) === "Aces" ? "A" : "B";
    expect(aces === "A" ? survivor.teamAScore : survivor.teamBScore).toBe(7);
    expect(aces === "A" ? survivor.teamBScore : survivor.teamAScore).toBe(3);
  });

  it("matches on the start time when both schedules give one", () => {
    const { resolved } = resolveSlotGames(
      bothSides({ slotTime: "2026-09-05T18:00:00.000Z", namedTime: "2026-09-05T18:00:00.000Z" })
    );
    expect(resolved).toBe(1);
  });

  it("will not join two games of a doubleheader that kicked off at different times", () => {
    const { state, resolved } = resolveSlotGames(
      bothSides({ slotTime: "2026-09-05T18:00:00.000Z", namedTime: "2026-09-05T20:30:00.000Z" })
    );
    expect(resolved).toBe(0);
    expect(state.games).toHaveLength(2);
  });

  it("leaves a slot alone when the club's own schedule is the only evidence", () => {
    // Aces list both a placeholder and a named opponent that day: two games they are playing,
    // neither of which names the other.
    let state: GcImportState = { ageGroups: [], teams: [], games: [] };
    state = importGcSchedule(
      {
        profile: {
          id: "gcA",
          name: "Aces 9U",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: "a1",
            date: "2026-09-05",
            opponentName: "TBD",
            teamScore: 7,
            opponentScore: 3,
            status: "completed",
          },
          {
            id: "a2",
            date: "2026-09-05",
            opponentName: "Bears 9U",
            teamScore: 2,
            opponentScore: 1,
            status: "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    ).state;
    const { resolved, state: after } = resolveSlotGames(state);
    expect(resolved).toBe(0);
    expect(after.games).toHaveLength(2);
  });

  it("will not choose between two clubs that both name this team that day", () => {
    let state: GcImportState = { ageGroups: [], teams: [], games: [] };
    const named = (gcId: string, gameId: string, name: string) => ({
      profile: {
        id: gcId,
        name,
        ageLevel: 9,
        season: { season: "fall" as const, year: 2026 },
      },
      games: [
        {
          id: gameId,
          date: "2026-09-05",
          opponentName: "Aces 9U",
          teamScore: 1,
          opponentScore: 2,
          status: "completed" as const,
        },
      ],
      fetchedAt: "2026-09-06T00:00:00.000Z",
    });
    state = importGcSchedule(
      {
        profile: {
          id: "gcA",
          name: "Aces 9U",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: "a1",
            date: "2026-09-05",
            opponentName: "TBD",
            teamScore: 7,
            opponentScore: 3,
            status: "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    ).state;
    state = importGcSchedule(named("gcB", "b1", "Bears 9U"), state).state;
    state = importGcSchedule(named("gcC", "c1", "Cubs 9U"), state).state;

    const { resolved } = resolveSlotGames(state);
    expect(resolved).toBe(0);
  });

  it("does nothing to a pool with no placeholders", () => {
    const state: GcImportState = { ageGroups: [], teams: [], games: [] };
    expect(resolveSlotGames(state)).toEqual({ state, resolved: 0 });
  });
});
