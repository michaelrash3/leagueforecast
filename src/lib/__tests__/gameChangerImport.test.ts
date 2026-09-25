import { describe, expect, it } from "vitest";
import gamesFixture from "./fixtures/gc-team-games.json";
import profileFixture from "./fixtures/gc-team-profile.json";
import {
  ageLevelFromName,
  isNotBaseball,
  isSchoolAgeLabel,
  isSchoolName,
  normalizeGcGames,
  parseGcAgeLevel,
  normalizeGcTeamProfile,
  parseGcTeamList,
  type GcTeamSchedule,
} from "../gameChangerApi";
import {
  ageFromOpponentNames,
  ageFromTwoOpponents,
  createGcImporter,
  mergeSameSquadIds,
  importGcSchedule,
  describeTidy,
  poolSignature,
  refileStandIns,
  resolveSlotGames,
  tidyChangedAnything,
  TIDY_STEPS,
  tidyPool,
  importGcSchedules,
  comparePairing,
  isSettledPairing,
  type TidyStep,
  pairSettledSquads,
  proposeSeasonPairings,
  summarizeGcImport,
  type GcImportState,
} from "../gameChangerImport";
import {
  countsTowardRating,
  isScoutGamePlayed,
  mergeScoutTeams,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

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

  /**
   * A club that writes both ages into its name — "Premier Ohio Lopez 9U/10U", whose GameChanger
   * age field says 9U — is a 10U team. Filed at 9U it sat on the younger page with every game in
   * its own bracket recorded as playing up, which is an advantage in the rating it never earned.
   */
  it("files a squad whose name spells out a bracket on the older page", () => {
    const profile = normalizeGcTeamProfile({
      ...profileFixture,
      id: "gcLOPEZ00001",
      name: "Premier Ohio Lopez 9U/10U",
      age_group: "9U",
    });
    const { state, outcome } = importGcSchedule(
      { profile: profile!, games: [], fetchedAt: "2026-09-14T12:00:00.000Z" },
      empty
    );

    expect(outcome.ageGroupName).toBe("10U 2027");
    // The age level is off the name, so the name keeps none of it — slash included.
    const pulled = state.teams.find((team) => team.gcTeams?.length);
    expect(pulled?.name).toBe("Premier Ohio Lopez");
    expect(pulled?.gcTeams?.[0]).toMatchObject({ ageLevel: 10 });
    // What GameChanger is still calling it stays on the link, which is what the panel shows.
    expect(pulled?.gcTeams?.[0]?.name).toBe("Premier Ohio Lopez 9U/10U");
  });

  it("moves a club filed at the younger end, and tidies the name it was stored under", () => {
    /*
     * The pool as the old readings left it: the younger page, and a name a cleaner that took the
     * bracket off as two labels left a slash stranded in. A club already pulled is found by its
     * GameChanger id and never by its name, so this re-pull is the only thing that can heal it.
     */
    const before: GcImportState = {
      ageGroups: [{ id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }],
      teams: [
        {
          id: "S-lopez",
          name: "Premier Ohio Lopez /",
          gcTeams: [
            {
              teamId: "gcLOPEZ00001",
              name: "Premier Ohio Lopez 9U/10U",
              ageGroupId: "ag9",
              ageLevel: 9,
              season: "fall",
              seasonYear: 2026,
              importedAt: "2026-09-07T12:00:00.000Z",
            },
          ],
        },
      ],
      games: [],
    };
    const profile = normalizeGcTeamProfile({
      ...profileFixture,
      id: "gcLOPEZ00001",
      name: "Premier Ohio Lopez 9U/10U",
      age_group: "9U",
    });
    const { state, outcome } = importGcSchedule(
      { profile: profile!, games: [], fetchedAt: "2026-09-14T12:00:00.000Z" },
      before
    );

    expect(outcome.ageGroupName).toBe("10U 2027");
    const moved = state.teams.find((team) => team.id === "S-lopez");
    expect(moved?.name).toBe("Premier Ohio Lopez");
    const group = state.ageGroups.find((entry) => entry.ageLevel === 10);
    expect(moved?.gcTeams?.[0]).toMatchObject({ ageGroupId: group?.id, ageLevel: 10 });
  });

  /*
   * The coaches now come off the profile as well as off a pasted list, which matters because most
   * of a nationwide pull is ids with no list behind them: without this the staff index — the
   * strongest club-matching signal there is, at 89% same-town for two shared names — was empty
   * for every team pulled by id alone.
   */
  it("keeps the coaches GameChanger names, and prefers the pasted list when there is one", () => {
    const fromProfile = importGcSchedule(
      {
        ...schedule({ staff: ["Dana Reed", "Kit Alvarez"] }, [game()]),
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      empty
    );
    const pulled = fromProfile.state.teams.find((team) => team.gcTeams?.length);
    expect(pulled?.gcTeams?.[0]?.staff).toEqual(["Dana Reed", "Kit Alvarez"]);

    // The list is the newer reading and the one its owner can correct, so it wins outright.
    const withList = importGcSchedule(
      {
        ...schedule({ staff: ["Dana Reed"] }, [game()]),
        listed: { staff: ["Correct Name"] },
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      empty
    );
    const listed = withList.state.teams.find((team) => team.gcTeams?.length);
    expect(listed?.gcTeams?.[0]?.staff).toEqual(["Correct Name"]);
  });

  /**
   * The league the user's list names, for a team GameChanger left ageless.
   *
   * Below the club's own word and above its opponents': a league naming an age is a statement
   * about every team in it, which beats reading the company a team keeps and loses to the club
   * filling in its own page.
   */
  it("files an ageless team under the age its league names", () => {
    const ageless = schedule({ name: "Example Multi-Event Team", ageLevel: undefined }, [game()]);
    const { state, outcome } = importGcSchedule({ ...ageless, listed: { ageLevel: 11 } }, empty);
    expect(outcome.issue).toBeUndefined();
    expect(outcome.ageGroupName).toBe("11U 2027");
    expect(outcome.ageFromLeague).toBe(11);
    expect(state.ageGroups[0]).toMatchObject({ ageLevel: 11 });
  });

  it("does not take an age from the list that GameChanger's own band rules out", () => {
    // GameChanger filed the team "Under 13" and an organization's name said 16U: the band is
    // GameChanger's word about the team, and a list that contradicts it is wrong about the team.
    const under13 = schedule(
      { name: "Example Multi-Event Team", ageLevel: undefined, ageLabel: "Under 13" },
      [game()]
    );
    expect(importGcSchedule({ ...under13, listed: { ageLevel: 16 } }, empty).outcome.skip).toBe(
      "no-age"
    );
    expect(
      importGcSchedule({ ...under13, listed: { ageLevel: 12 } }, empty).outcome.ageFromLeague
    ).toBe(12);
  });

  it("leaves a team that stated its own age exactly where it was", () => {
    // The team's own word always wins; an association only ever answers a silence.
    const { outcome } = importGcSchedule(
      { ...schedule({ ageLevel: 9 }, [game()]), listed: { ageLevel: 11 } },
      empty
    );
    expect(outcome.ageGroupName).toBe("9U 2027");
    expect(outcome.ageFromLeague).toBeUndefined();
  });

  /*
   * And a person still outranks it. A named age is applied before anything else reads the profile,
   * so the league never gets a look at a team somebody has answered for.
   */
  it("is beaten by an age somebody named by hand", () => {
    // The name has to say nothing either, or GameChanger has spoken and the named age is dropped.
    const ageless = schedule({ name: "Example Multi-Event Team", ageLevel: undefined }, [game()]);
    const { outcome } = importGcSchedule({ ...ageless, listed: { ageLevel: 11 } }, empty, {
      namedAges: new Map([
        [
          "gcAAAAAAAAAA",
          { teamId: "gcAAAAAAAAAA", level: 10, namedAt: "2026-09-01T00:00:00.000Z" },
        ],
      ]),
    });
    expect(outcome.ageGroupName).toBe("10U 2027");
    expect(outcome.ageNamedByUser).toBe(10);
    expect(outcome.ageFromLeague).toBeUndefined();
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

  /**
   * Two schedules naming a Yankees may well mean two different clubs, and there is no way to tell
   * from a name. Reusing the entry anyway is the lesser error by a long way: a second entry makes
   * every later mention of the name ambiguous, so the third mention mints a third entry and the
   * fourth a fourth. A pull of a few thousand schedules turned 7,000 clubs into 28,000 teams that
   * way, with one club's games scattered across dozens of them.
   */
  it("reuses a name-only entry rather than minting another of the same name", () => {
    const first = importGcSchedule(schedule({}, [game({ opponentName: "Yankees" })]), empty);
    const second = importGcSchedule(
      schedule({ id: "gcDDDDDDDDDD", name: "Comets 9U" }, [
        game({ id: "g2", opponentName: "Yankees", date: "2026-08-30" }),
      ]),
      first.state
    );
    expect(second.state.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);
  });

  /**
   * GameChanger sends a picture for some opponents and not others. A row with no picture
   * contradicts nothing, so it must not be the reason a second entry of the name appears — that
   * is what left a nationwide pull with twelve "Xplosion" teams where there should be one.
   */
  it("reuses the entry when this row carries no picture", () => {
    let state = importGcSchedule(
      schedule({}, [game({ opponentName: "Xplosion", opponentAvatarKey: "av-x" })]),
      empty
    ).state;
    state = importGcSchedule(
      schedule({ id: "gcBBBBBBBBBB", name: "Bears 9U" }, [
        game({ id: "b1", opponentName: "Xplosion", date: "2026-08-23" }),
      ]),
      state
    ).state;
    state = importGcSchedule(
      schedule({ id: "gcCCCCCCCCCC", name: "Comets 9U" }, [
        game({ id: "c1", opponentName: "Xplosion", date: "2026-08-24", opponentAvatarKey: "av-x" }),
      ]),
      state
    ).state;

    expect(state.teams.filter((team) => team.name === "Xplosion")).toHaveLength(1);
  });

  it("lets a club's own schedule adopt the entry others made for it", () => {
    // Two schedules name the Xplosion, one with a picture and one without; then it is pulled.
    let state = importGcSchedule(
      schedule({}, [game({ opponentName: "Xplosion", opponentAvatarKey: "av-x" })]),
      empty
    ).state;
    state = importGcSchedule(
      schedule({ id: "gcBBBBBBBBBB", name: "Bears 9U" }, [
        game({ id: "b1", opponentName: "Xplosion", date: "2026-08-23" }),
      ]),
      state
    ).state;
    const pulled = importGcSchedule(
      schedule({ id: "gcXXXXXXXXXX", name: "Xplosion 9U", avatarKey: "av-x" }, []),
      state
    );

    expect(pulled.outcome.createdTeam).toBe(false);
    expect(pulled.state.teams.filter((team) => team.name === "Xplosion")).toHaveLength(1);
    expect(pulled.state.teams.find((team) => team.name === "Xplosion")?.nameOnly).toBeUndefined();
  });

  /**
   * A picture is not an identifier. GameChanger mints a fresh one for every listing rather than
   * giving a club one that follows it about: over a nationwide pull, 7,948 teams carried 7,948
   * distinct pictures and not one was shared by two of them. Read as identity it says "different
   * club" about every mention of the same club, which is how one River City Raptors became six.
   */
  it("is one club however many pictures its mentions carry", () => {
    const first = importGcSchedule(
      schedule({}, [game({ opponentName: "Yankees", opponentAvatarKey: "av-one" })]),
      empty
    );
    const second = importGcSchedule(
      schedule({ id: "gcDDDDDDDDDD", name: "Comets 9U" }, [
        game({
          id: "g2",
          opponentName: "Yankees",
          date: "2026-08-30",
          opponentAvatarKey: "av-two",
        }),
      ]),
      first.state
    );
    expect(second.state.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);
  });

  /** Two clubs somebody pulled by id are two clubs, whatever they are called. */
  it("never folds one pulled club into a namesake", () => {
    const first = importGcSchedule(schedule({ id: "gcY100000000", name: "Yankees 9U" }, []), empty);
    const second = importGcSchedule(
      schedule({ id: "gcY200000000", name: "Yankees 9U" }, []),
      first.state
    );
    expect(second.outcome.createdTeam).toBe(true);
  });

  it("never mints a fourth entry for a name one schedule keeps repeating", () => {
    // What the real pull did: four games against one club on one day, four separate teams. A day
    // already played: four results dated ahead of today are a schedule the import refuses as
    // invented, which is not what this is about.
    const state = importGcSchedule(
      schedule({}, [
        game({ id: "t1", opponentName: "Blueclaws", date: "2026-09-05" }),
        game({ id: "t2", opponentName: "Blueclaws", date: "2026-09-05" }),
        game({ id: "t3", opponentName: "Blueclaws", date: "2026-09-05" }),
        game({ id: "t4", opponentName: "Blueclaws", date: "2026-09-05" }),
      ]),
      empty
    ).state;
    expect(state.teams.filter((team) => team.name === "Blueclaws")).toHaveLength(1);
    expect(state.games).toHaveLength(4);
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
    // Both name-only entries are reused rather than multiplied, so there is one of each.
    expect(state.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);
    expect(state.teams.filter((team) => team.name === "Aces")).toHaveLength(1);
  });

  it("is matched by name when one schedule's game is the other's, same day", () => {
    // The case a bracket makes: one side posts the fixture, the other posts a placeholder. The
    // two rows have to agree on how it finished, or they are not the same game.
    const first = importGcSchedule(
      schedule({ name: "Aces 9U" }, [game({ opponentName: "TBD", date: "2026-08-22" })]),
      empty
    );
    const second = importGcSchedule(
      schedule({ id: "gcDDDDDDDDDD", name: "Comets 9U" }, [
        game({
          id: "g2",
          opponentName: "Aces 9U",
          date: "2026-08-22",
          teamScore: 2,
          opponentScore: 12,
        }),
      ]),
      first.state
    );
    expect(second.state.teams.filter((team) => team.name === "Aces")).toHaveLength(1);
  });

  it("is not matched when the two rows disagree about the score", () => {
    // Aces beat a placeholder 12-2. Comets also won 12-2 that day, so whoever Comets beat, it was
    // not the club that beat somebody else by the same margin on the same afternoon.
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
    expect(second.state.games).toHaveLength(2);
  });
});

/**
 * A pull of a whole list holds both sides of most games, so nearly every club arrives twice: once
 * as somebody's opponent and once on its own turn. Recognising the second as the first is the
 * difference between a pool and a pool with everything in it twice.
 */
describe("both sides of a game in one run", () => {
  const fixture = (
    id: string,
    name: string,
    games: GcTeamSchedule["games"],
    profile: Partial<GcTeamSchedule["profile"]> = {}
  ): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 9, season: { season: "fall", year: 2026 }, ...profile },
    games,
    fetchedAt: "2026-09-14T12:00:00.000Z",
  });

  const played = (
    id: string,
    opponentName: string,
    teamScore: number,
    opponentScore: number,
    over: Partial<GcTeamSchedule["games"][number]> = {}
  ) => ({
    id,
    date: "2026-08-22",
    opponentName,
    status: "completed" as const,
    teamScore,
    opponentScore,
    ...over,
  });

  it("files a game once when both schedules describe it", () => {
    const { state } = importGcSchedules(
      [
        fixture("gcAAAAAAAAAA", "Aces 9U", [played("a1", "Comets", 10, 5)]),
        fixture("gcBBBBBBBBBB", "Comets 9U", [played("c1", "Aces", 5, 10)]),
      ],
      empty
    );

    // Two clubs and one game, not four and two.
    expect(state.teams).toHaveLength(2);
    expect(state.games).toHaveLength(1);
  });

  /**
   * The case that made a whole pull come out doubled: a page the run itself creates knew its pool
   * but not its level, so every game filed under it was indexed at a level of "unknown" — and the
   * club that page belonged to was then not found when its own schedule came round.
   */
  it("files a doubleheader once, on a page the run created", () => {
    const { state } = importGcSchedules(
      [
        fixture("gcAAAAAAAAAA", "Aces 9U", [
          played("a1", "Comets", 10, 5),
          played("a2", "Comets", 14, 3),
        ]),
        fixture("gcBBBBBBBBBB", "Comets 9U", [
          played("c1", "Aces", 5, 10),
          played("c2", "Aces", 3, 14),
        ]),
      ],
      empty
    );

    expect(state.teams).toHaveLength(2);
    expect(state.games).toHaveLength(2);
  });

  /**
   * A club that plays up is listed by the older team and filed at *that* team's level, so its own
   * schedule cannot find it by name. The picture can: it is the one identifier that means the same
   * thing on both schedules.
   */
  it("recognises a club that played up by the game they both filed", () => {
    const { state } = importGcSchedules(
      [
        fixture(
          "gcAAAAAAAAAA",
          "Aces 11U",
          [played("a1", "Comets", 10, 5, { opponentAvatarKey: "av-comets" })],
          { ageLevel: 11, avatarKey: "av-aces" }
        ),
        fixture(
          "gcBBBBBBBBBB",
          "Comets 9U",
          [played("c1", "Aces", 5, 10, { opponentAvatarKey: "av-aces" })],
          { avatarKey: "av-comets" }
        ),
      ],
      empty
    );

    expect(state.teams).toHaveLength(2);
    expect(state.games).toHaveLength(1);
  });

  /**
   * The two sides disagree about the level, and there is no picture worth anything — but they
   * agree about the game, and that is what settles it. This is the case the user kept asking for:
   * go and look at the other club's schedule for that exact day and result.
   */
  it("joins them on the game when the two sides disagree about the level", () => {
    const { state } = importGcSchedules(
      [
        fixture("gcAAAAAAAAAA", "Aces 11U", [played("a1", "Comets", 10, 5)], { ageLevel: 11 }),
        fixture("gcBBBBBBBBBB", "Comets 9U", [played("c1", "Aces", 5, 10)]),
      ],
      empty
    );
    expect(state.teams).toHaveLength(2);
    expect(state.games).toHaveLength(1);
  });

  /** Same day, same two names, results that contradict: not one game, and not one club either. */
  it("keeps them apart when the results disagree", () => {
    const { state } = importGcSchedules(
      [
        fixture("gcAAAAAAAAAA", "Aces 11U", [played("a1", "Comets", 10, 5)], { ageLevel: 11 }),
        fixture("gcBBBBBBBBBB", "Comets 9U", [played("c1", "Aces", 9, 9)]),
      ],
      empty
    );
    expect(state.games).toHaveLength(2);
  });
});

/**
 * Both clubs post the fixture, and the two rows agree on the day, the start time and the result.
 * That identifies the opponent better than any name can: it needs no picture, it survives the two
 * schedules spelling the club differently, and it answers a name that identifies nobody at all.
 */
describe("the game itself as the identifier", () => {
  it("names a bracket slot from the other club's copy of the game", () => {
    const first = importGcSchedule(
      schedule({ id: "gcRRRRRRRRRR", name: "Rampage 9U" }, [
        game({
          id: "r1",
          opponentName: "Aces 9U",
          date: "2026-08-22",
          teamScore: 5,
          opponentScore: 10,
        }),
      ]),
      empty
    );
    // The Aces' own schedule has not been told who they played — the bracket was still open.
    const second = importGcSchedule(
      schedule({ id: "gcAAAAAAAAAA", name: "Aces 9U" }, [
        game({
          id: "a1",
          opponentName: "TBD",
          date: "2026-08-22",
          teamScore: 10,
          opponentScore: 5,
        }),
      ]),
      first.state
    );

    // No slot: the fixture says who it was, so the game joins the one already filed.
    expect(second.state.teams.some((team) => team.placeholder)).toBe(false);
    expect(second.state.games).toHaveLength(1);
  });

  it("matches a club whose two schedules spell it differently", () => {
    const first = importGcSchedule(
      schedule({ id: "gcRRRRRRRRRR", name: "Rampage 9U" }, [
        game({
          id: "r1",
          opponentName: "Lexington Aces 9U",
          date: "2026-08-22",
          teamScore: 5,
          opponentScore: 10,
        }),
      ]),
      empty
    );
    const second = importGcSchedule(
      schedule({ id: "gcAAAAAAAAAA", name: "Lexington Aces 9U" }, [
        game({
          id: "a1",
          opponentName: "The Rampage",
          date: "2026-08-22",
          teamScore: 10,
          opponentScore: 5,
        }),
      ]),
      first.state
    );
    // "The Rampage" matches nothing by name, but the fixture does.
    expect(second.outcome.opponentsCreated).toBe(0);
    expect(second.state.games).toHaveLength(1);
  });

  it("keeps a doubleheader as two games, told apart by the score", () => {
    const first = importGcSchedule(
      schedule({ id: "gcRRRRRRRRRR", name: "Rampage 9U" }, [
        game({
          id: "r1",
          opponentName: "Aces 9U",
          date: "2026-08-22",
          teamScore: 5,
          opponentScore: 10,
        }),
        game({
          id: "r2",
          opponentName: "Aces 9U",
          date: "2026-08-22",
          teamScore: 3,
          opponentScore: 14,
        }),
      ]),
      empty
    );
    const second = importGcSchedule(
      schedule({ id: "gcAAAAAAAAAA", name: "Aces 9U" }, [
        game({
          id: "a1",
          opponentName: "TBD",
          date: "2026-08-22",
          teamScore: 10,
          opponentScore: 5,
        }),
        game({
          id: "a2",
          opponentName: "TBD",
          date: "2026-08-22",
          teamScore: 14,
          opponentScore: 3,
        }),
      ]),
      first.state
    );
    expect(second.state.games).toHaveLength(2);
    expect(second.state.teams.some((team) => team.placeholder)).toBe(false);
  });

  it("does not let one of a club's own games answer for another", () => {
    // Two games in a day on one schedule are two games; neither names the other.
    const state = importGcSchedule(
      schedule({}, [
        game({ id: "s1", opponentName: "TBD", date: "2026-08-22", teamScore: 4, opponentScore: 1 }),
        game({ id: "s2", opponentName: "TBD", date: "2026-08-22", teamScore: 4, opponentScore: 1 }),
      ]),
      empty
    ).state;
    expect(state.games).toHaveLength(2);
    expect(state.teams.filter((team) => team.placeholder)).toHaveLength(2);
  });

  /**
   * The stand-in came first, so nothing could name it at the time. A pull that adds the real club
   * later has to go back over them — which is what the end-of-run pass is for.
   */
  it("goes back over a name-only club once the real one is pulled", () => {
    // The Aces play "Rampage", spelt in a way the Rampage's own page does not use.
    const first = importGcSchedule(
      schedule({ id: "gcAAAAAAAAAA", name: "Aces 9U" }, [
        game({
          id: "a1",
          opponentName: "The Rampage",
          date: "2026-08-22",
          teamScore: 10,
          opponentScore: 5,
        }),
      ]),
      empty
    );
    expect(first.state.teams.filter((team) => team.nameOnly)).toHaveLength(1);

    const second = importGcSchedule(
      schedule({ id: "gcRRRRRRRRRR", name: "Rampage 9U" }, [
        game({
          id: "r1",
          opponentName: "Aces 9U",
          date: "2026-08-22",
          teamScore: 5,
          opponentScore: 10,
        }),
      ]),
      first.state
    );
    const settled = resolveSlotGames(second.state);

    // One fixture, between two clubs that were both pulled, and the stand-in gone with it.
    expect(settled.resolved).toBe(1);
    expect(settled.state.games).toHaveLength(1);
    expect(settled.state.teams.filter((team) => team.nameOnly)).toHaveLength(0);
    expect(settled.state.teams).toHaveLength(2);
  });

  it("leaves a slot alone when nothing else describes that day", () => {
    const state = importGcSchedule(
      schedule({}, [game({ opponentName: "TBD", date: "2026-08-22" })]),
      empty
    ).state;
    expect(state.teams.filter((team) => team.placeholder)).toHaveLength(1);
  });
});

describe("a doubleheader only one side wrote down twice", () => {
  const sched = (id: string, name: string, games: GcTeamSchedule["games"]): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 11, season: { season: "spring", year: 2027 } },
    games,
    fetchedAt: "2026-09-14T12:00:00.000Z",
  });
  const played = (id: string, opponentName: string, a: number, b: number) => ({
    id,
    date: "2026-08-29",
    opponentName,
    status: "completed" as const,
    teamScore: a,
    opponentScore: b,
  });

  /**
   * Same pair, same day, two results that contradict each other: a doubleheader, not one game
   * written down twice. Matching them lost the second game whenever one schedule listed both and
   * the other listed only the first.
   */
  it("keeps both games", () => {
    let pool = importGcSchedule(
      sched("gcLEGACY11U0", "Legacy 11U", [played("l2", "Raptors 11U", 14, 2)]),
      empty
    ).state;
    pool = importGcSchedule(
      sched("gcRAPTORS110", "Raptors 11U", [
        played("r1", "Legacy 11U", 5, 14),
        played("r2", "Legacy 11U", 2, 14),
      ]),
      pool
    ).state;

    expect(pool.teams).toHaveLength(2);
    expect(pool.games).toHaveLength(2);
  });

  it("still joins the copy that agrees about the result", () => {
    let pool = importGcSchedule(
      sched("gcLEGACY11U0", "Legacy 11U", [played("l2", "Raptors 11U", 14, 2)]),
      empty
    ).state;
    pool = importGcSchedule(
      sched("gcRAPTORS110", "Raptors 11U", [played("r2", "Legacy 11U", 2, 14)]),
      pool
    ).state;
    expect(pool.games).toHaveLength(1);
  });
});

/**
 * A club can hold several GameChanger ids inside one rating pool — a Fall id and a Spring id both
 * belong to squad year 2027 — and each becomes its own team, so the table shows the club twice off
 * half a season each. Sharing a game is what proves they are one squad.
 */
/**
 * A club a schedule names is nearly always the one club of that name in this pool — a pool being
 * one season year at one age level, not the whole country. Insisting on corroboration before using
 * it made a second entry to stand beside the real club and shadow it, because two clubs that have
 * not met yet corroborate nothing. That is how a nationwide pull ended up with twelve thousand
 * name-only entries, thousands of them shadowing a club that had been pulled.
 */
describe("a club already here, named by somebody who has not met it", () => {
  const sched = (id: string, name: string, games: GcTeamSchedule["games"]): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 9, season: { season: "fall", year: 2026 } },
    games,
    fetchedAt: "2026-09-14T12:00:00.000Z",
  });
  const played = (id: string, opponentName: string, date: string, a: number, b: number) => ({
    id,
    date,
    opponentName,
    status: "completed" as const,
    teamScore: a,
    opponentScore: b,
  });

  it("is that club, not a copy of it", () => {
    // The Trash Pandas lose to Hopewell on the 5th; nobody has played the NV Stars yet.
    let pool = importGcSchedule(
      sched("gcTRASHPANDA", "Trash Pandas Baseball Club 9U", [
        played("t1", "Hopewell Titans 9U", "2026-09-05", 3, 14),
      ]),
      empty
    ).state;
    // The NV Stars name them, on a day the Trash Pandas already have a different game.
    pool = importGcSchedule(
      sched("gcNVSTARS000", "NV Stars Scout 9U", [
        played("n1", "Trash Pandas Baseball Club 9U", "2026-09-05", 13, 2),
      ]),
      pool
    ).state;

    const pandas = pool.teams.filter((team) => team.name === "Trash Pandas Baseball Club");
    expect(pandas).toHaveLength(1);
    // The one that is here is the club itself, not a name-only copy standing beside it.
    expect(pandas[0]?.nameOnly).toBeUndefined();
    expect(pandas[0]?.gcTeams?.[0]?.teamId).toBe("gcTRASHPANDA");
    // Hopewell is still name-only: nobody pulled them, which is a different thing entirely.
    expect(pool.teams.find((team) => team.name === "Hopewell Titans")?.nameOnly).toBe(true);
  });

  it("files the other club's copy of a game onto the club, not beside it", () => {
    let pool = importGcSchedule(
      sched("gcTRASHPANDA", "Trash Pandas Baseball Club 9U", [
        played("t1", "Hopewell Titans 9U", "2026-09-05", 3, 14),
      ]),
      empty
    ).state;
    pool = importGcSchedule(
      sched("gcHOPEWELL00", "Hopewell Titans 9U", [
        played("h1", "Trash Pandas Baseball Club 9U", "2026-09-05", 14, 3),
      ]),
      pool
    ).state;

    const settled = resolveSlotGames(pool).state;
    expect(settled.teams.filter((team) => team.name === "Hopewell Titans")).toHaveLength(1);
    expect(settled.games).toHaveLength(1);
  });
});

describe("one squad holding several GameChanger ids", () => {
  const sched = (
    id: string,
    name: string,
    games: GcTeamSchedule["games"],
    season: { season: "fall" | "spring"; year: number }
  ): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 11, season },
    games,
    fetchedAt: "2026-09-14T12:00:00.000Z",
  });
  const played = (id: string, opponentName: string, date: string, a: number, b: number) => ({
    id,
    date,
    opponentName,
    status: "completed" as const,
    teamScore: a,
    opponentScore: b,
  });
  const fall = { season: "fall" as const, year: 2026 };
  const spring = { season: "spring" as const, year: 2027 };

  it("folds two ids that filed the same game", () => {
    let pool = importGcSchedule(
      sched(
        "gcYEAGFALL00",
        "Yeager Davis 11U",
        [played("f1", "Raptors 11U", "2026-09-11", 8, 2)],
        fall
      ),
      empty
    ).state;
    pool = importGcSchedule(
      sched(
        "gcYEAGSPRG00",
        "Yeager Davis 11U",
        [played("s1", "Raptors 11U", "2026-09-11", 8, 2)],
        spring
      ),
      pool
    ).state;
    // Two ids, two teams, the same 8-2 twice: the table would show the club twice at 1-0.
    expect(pool.teams.filter((team) => team.name === "Yeager Davis")).toHaveLength(2);

    const settled = mergeSameSquadIds(pool);
    expect(settled.merged).toBe(1);
    const survivors = settled.state.teams.filter((team) => team.name === "Yeager Davis");
    expect(survivors).toHaveLength(1);
    // And the 8-2 is one game, not the club's two copies of it.
    expect(settled.state.games).toHaveLength(1);
    // Both GameChanger ids stay on the team that is left.
    expect(survivors[0]?.gcTeams?.map((link) => link.teamId).sort()).toEqual([
      "gcYEAGFALL00",
      "gcYEAGSPRG00",
    ]);
  });

  it("shows one 2-8 when the Raptors' schedule and a third Yeager id both filed it", () => {
    // What the backup showed: the Raptors pulled first and named Yeager Davis as an opponent;
    // a Yeager id with no games then adopted that entry; a third Yeager id with the game arrived
    // as a team of its own. After the tidy: one club, three ids, one game.
    let pool = importGcSchedule(
      sched(
        "gcRAPTORS0000",
        "River City Raptors 11U",
        [played("r1", "Yeager Davis 11U", "2026-09-11", 2, 8)],
        fall
      ),
      empty
    ).state;
    pool = importGcSchedule(sched("gcYEAGSPRG10", "Yeager Davis 11U", [], spring), pool).state;
    pool = importGcSchedule(
      sched(
        "gcYEAGSPRG20",
        "Yeager Davis 11U",
        [played("s1", "River City Raptors 11U", "2026-09-11", 8, 2)],
        spring
      ),
      pool
    ).state;

    const tidy = tidyPool(pool);
    // The Raptors' row was attached by name to the id that adopted the stand-in; the third id's
    // own schedule holds the game, so the row moves there and the two copies become one. The
    // empty id is not folded on an opponent's row — only its own schedule could prove it.
    expect(tidy.reclaimed).toBe(1);
    const raptors = tidy.state.teams.find((team) => team.name === "River City Raptors")!;
    const between = tidy.state.games.filter((game) =>
      [game.teamAId, game.teamBId].includes(raptors.id)
    );
    expect(between).toHaveLength(1);
    const holder = tidy.state.teams.find(
      (team) =>
        [between[0]!.teamAId, between[0]!.teamBId].includes(team.id) && team.id !== raptors.id
    );
    expect(holder?.gcTeams?.map((link) => link.teamId)).toEqual(["gcYEAGSPRG20"]);
  });

  it("does not fold two ids on a fixture that only an opponent's schedule filed", () => {
    // Chico Aces (CA) and Pansey Aces (AL): the Sandlot Syndicate's schedule named "Aces" and
    // the row landed on the wrong one. That row proves nothing about the two Aces being one.
    const played = (id: string, opponentName: string, date: string, a: number, b: number) => ({
      id,
      date,
      opponentName,
      status: "completed" as const,
      teamScore: a,
      opponentScore: b,
    });
    let pool = importGcSchedule(
      {
        profile: { id: "gcACESCHICO0", name: "Aces 10U", ageLevel: 10, season: fall, state: "CA" },
        games: [played("c1", "Chico Nuts 10U", "2026-09-05", 4, 1)],
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      empty
    ).state;
    pool = importGcSchedule(
      {
        profile: {
          id: "gcSANDLOT000",
          name: "Sandlot Syndicate 10U",
          ageLevel: 10,
          season: fall,
          state: "AL",
        },
        games: [played("s1", "Aces 10U", "2026-09-12", 3, 5)],
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      pool
    ).state;
    pool = importGcSchedule(
      {
        profile: { id: "gcACESPANSEY", name: "ACES 10U", ageLevel: 10, season: fall, state: "AL" },
        games: [played("p1", "Sandlot Syndicate 10U", "2026-09-12", 5, 3)],
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      pool
    ).state;
    const tidy = tidyPool(pool);
    expect(tidy.folded).toBe(0);
    const aces = tidy.state.teams.filter((team) => team.name.toLowerCase() === "aces");
    expect(aces).toHaveLength(2);
    // And the Sandlot row went to the Aces whose schedule holds it.
    const pansey = aces.find((team) => team.gcTeams?.[0]?.teamId === "gcACESPANSEY")!;
    const sandlot = tidy.state.teams.find((team) => team.name === "Sandlot Syndicate")!;
    const rows = tidy.state.games.filter((game) =>
      [game.teamAId, game.teamBId].includes(sandlot.id)
    );
    expect(rows).toHaveLength(1);
    expect([rows[0]!.teamAId, rows[0]!.teamBId]).toContain(pansey.id);
  });

  it("does not fold a club's two squads told apart by a parenthetical, nor two levels", () => {
    const played = (id: string, opponentName: string, date: string, a: number, b: number) => ({
      id,
      date,
      opponentName,
      status: "completed" as const,
      teamScore: a,
      opponentScore: b,
    });
    // Both Heat squads really did play the Outlaws 6-2 on the same day (two fields, one club).
    let pool = importGcSchedule(
      {
        profile: {
          id: "gcHEATEALEY0",
          name: "Heat 9U (Ealey)",
          ageLevel: 9,
          season: fall,
          state: "CA",
        },
        games: [played("e1", "Outlaws 9U", "2026-09-05", 6, 2)],
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      empty
    ).state;
    pool = importGcSchedule(
      {
        profile: {
          id: "gcHEATCAMPAN",
          name: "Heat 9U (Campana)",
          ageLevel: 9,
          season: fall,
          state: "CA",
        },
        games: [played("k1", "Outlaws 9U", "2026-09-05", 6, 2)],
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      pool
    ).state;
    pool = importGcSchedule(
      {
        profile: { id: "gcHEAT10U000", name: "Heat 10U", ageLevel: 10, season: fall, state: "CA" },
        games: [played("t1", "Outlaws 10U", "2026-09-05", 6, 2)],
        fetchedAt: "2026-09-14T12:00:00.000Z",
      },
      pool
    ).state;
    expect(mergeSameSquadIds(pool).merged).toBe(0);
  });

  it("leaves two clubs of one name that never shared a game", () => {
    let pool = importGcSchedule(
      sched(
        "gcYEAG1000000",
        "Yeager Davis 11U",
        [played("a1", "Raptors 11U", "2026-09-11", 8, 2)],
        fall
      ),
      empty
    ).state;
    pool = importGcSchedule(
      sched(
        "gcYEAG2000000",
        "Yeager Davis 11U",
        [played("b1", "Hornets 11U", "2026-10-04", 3, 9)],
        fall
      ),
      pool
    ).state;
    expect(mergeSameSquadIds(pool).merged).toBe(0);
  });

  it("does not fold on a fixture neither of them has played yet", () => {
    const scheduled = (id: string, opponentName: string) => ({
      id,
      date: "2026-10-25",
      opponentName,
      status: "scheduled" as const,
    });
    let pool = importGcSchedule(
      sched("gcYEAG1000000", "Yeager Davis 11U", [scheduled("a1", "Raptors 11U")], fall),
      empty
    ).state;
    pool = importGcSchedule(
      sched("gcYEAG2000000", "Yeager Davis 11U", [scheduled("b1", "Raptors 11U")], spring),
      pool
    ).state;
    // Two clubs can both be due to play the Raptors that day; only a result says they are one.
    expect(mergeSameSquadIds(pool).merged).toBe(0);
  });
});

describe("createGcImporter", () => {
  const one = (id: string, name: string, opponent: string, gameId: string): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 9, season: { season: "fall", year: 2026 } },
    games: [
      {
        id: gameId,
        date: "2026-08-22",
        opponentName: opponent,
        status: "completed" as const,
        teamScore: 7,
        opponentScore: 3,
      },
    ],
    fetchedAt: "2026-09-14T12:00:00.000Z",
  });

  const schedules = [
    one("gcAAAAAAAAAA", "Aces 9U", "Comets 9U", "a1"),
    one("gcBBBBBBBBBB", "Comets 9U", "Bears 9U", "c1"),
    one("gcCCCCCCCCCC", "Bears 9U", "Aces 9U", "b1"),
  ];

  /**
   * The fold is held open so a pull does not rebuild an index per team, which is the whole point
   * of it — but it has to reach the same pool as folding them one at a time, or it is just a
   * faster way to be wrong.
   */
  it("reaches the same pool as folding one at a time", () => {
    let alone = empty;
    const byHand = schedules.map((schedule) => {
      const result = importGcSchedule(schedule, alone);
      alone = result.state;
      return result.outcome;
    });

    const importer = createGcImporter(empty);
    const held = schedules.map((schedule) => importer.add(schedule));

    // A created page's id carries the moment it was made, so it is blanked before comparing.
    const settle = (value: unknown, pageIds: string[]): unknown =>
      JSON.parse(
        pageIds.reduce(
          (text, pageId) => text.split(pageId).join("PAGE"),
          JSON.stringify(value)
        ) as string
      );
    const heldPages = importer.state.ageGroups.map((group) => group.id);
    const alonePages = alone.ageGroups.map((group) => group.id);

    expect(settle(importer.state.teams, heldPages)).toEqual(settle(alone.teams, alonePages));
    expect(settle(importer.state.games, heldPages)).toEqual(settle(alone.games, alonePages));
    expect(settle(importer.state.ageGroups, heldPages)).toEqual(
      settle(alone.ageGroups, alonePages)
    );
    expect(settle(held, heldPages)).toEqual(settle(byHand, alonePages));
  });

  it("builds on a pool that already has teams in it", () => {
    const seeded = importGcSchedule(schedules[0]!, empty).state;
    const importer = createGcImporter(seeded);
    importer.add(schedules[1]!);
    // Comets was already here as the Aces' opponent, so its own schedule joins it, not a second.
    expect(importer.state.teams.filter((team) => team.name === "Comets")).toHaveLength(1);
  });

  it("leaves the pool it was handed alone", () => {
    const importer = createGcImporter(empty);
    importer.add(schedules[0]!);
    expect(empty.teams).toHaveLength(0);
    expect(empty.games).toHaveLength(0);
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
    expect(state.games.every((game) => countsTowardRating(game, "2099-01-01"))).toBe(true);
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
  /*
   * The state is part of the helper because it is part of a pairing now: two GameChanger accounts
   * with one name in two states are two clubs, and asking for the state up front is what took the
   * list down from a page of near-certain rows to the handful worth reading. A test about two
   * clubs that are *not* one overrides it.
   */
  const withLinks = (
    id: string,
    name: string,
    link: Partial<NonNullable<ScoutTeam["gcTeams"]>[number]>,
    place: Partial<ScoutTeam> = { state: "KY" }
  ): ScoutTeam => ({
    id,
    name,
    ...place,
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
      evidence: ["avatar", "state"],
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
    const pairings = proposeSeasonPairings(
      [
        // The name and a pulled club they both played: worth offering, not worth calling certain.
        withLinks("a1", "Aces", { season: "fall", seasonYear: 2026 }),
        withLinks("a2", "Aces", { season: "spring", seasonYear: 2027 }),
        withLinks("rival", "Trash Pandas", { season: "fall", seasonYear: 2026 }),
        withLinks("b1", "Bears", { season: "fall", seasonYear: 2026, avatarKey: "av-b" }),
        withLinks("b2", "Bears", { season: "spring", seasonYear: 2027, avatarKey: "av-b" }),
      ],
      [
        { id: "g1", teamAId: "a1", teamBId: "rival", ageGroupId: "ag1" },
        { id: "g2", teamAId: "a2", teamBId: "rival", ageGroupId: "ag1" },
      ]
    );
    expect(pairings[0]?.confidence).toBe("strong");
    expect(pairings[pairings.length - 1]?.confidence).toBe("likely");
  });

  it("does not offer two clubs on a shared name and state alone", () => {
    // Every rec league in a state has a Yankees; a state is not where a club is from.
    const pairings = proposeSeasonPairings([
      { ...withLinks("a1", "Yankees", { season: "fall", seasonYear: 2026 }), state: "KY" },
      { ...withLinks("a2", "Yankees", { season: "spring", seasonYear: 2027 }), state: "KY" },
    ]);
    expect(pairings).toEqual([]);
  });

  it("does not offer two clubs that only share a name", () => {
    // The pool is full of these. Offering them all is worse than offering none: read enough
    // near-certain rows and the wrong one gets approved along with the rest.
    expect(
      proposeSeasonPairings([
        withLinks("a1", "Yankees", { season: "fall", seasonYear: 2026 }, { state: "KY" }),
        withLinks("a2", "Yankees", { season: "spring", seasonYear: 2027 }, { state: "OH" }),
      ])
    ).toEqual([]);
  });

  it("offers a shared name backed by a pulled club they both played", () => {
    const teams = [
      withLinks("a1", "Yankees", { season: "fall", seasonYear: 2026 }),
      withLinks("a2", "Yankees", { season: "spring", seasonYear: 2027 }),
      withLinks("rival", "Trash Pandas", { season: "fall", seasonYear: 2026 }),
    ];
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "a1", teamBId: "rival", ageGroupId: "ag1" },
      { id: "g2", teamAId: "a2", teamBId: "rival", ageGroupId: "ag1" },
    ];
    const pairings = proposeSeasonPairings(teams, games);
    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.evidence).toEqual(["state", "shared-opponent"]);
  });

  it("does not count a stand-in as a club in common", () => {
    // Two Warriors that both list a "Briarcliffe Blazers" nobody pulled have not met anyone.
    const teams = [
      withLinks("a1", "Warriors", { season: "fall", seasonYear: 2026 }),
      withLinks("a2", "Warriors", { season: "spring", seasonYear: 2027 }),
      { id: "stub", name: "Briarcliffe Blazers", nameOnly: true as const },
    ];
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "a1", teamBId: "stub", ageGroupId: "ag1" },
      { id: "g2", teamAId: "a2", teamBId: "stub", ageGroupId: "ag1" },
    ];
    expect(proposeSeasonPairings(teams, games)).toEqual([]);
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

  it("does not fold a second club of a name into the first that claimed it", () => {
    // Two schedules naming a "Yankees", then two real Yankees pulled by id.
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
    // Two schedules naming a Yankees reuse the one entry rather than making a second.
    expect(seeded.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);

    // A club pulled by id adopts that entry — it is a name nobody has claimed, not a rival club.
    const pulled = importGcSchedule(
      schedule({ id: "gcY900000000", name: "Yankees 9U" }, []),
      seeded
    );
    expect(pulled.outcome.createdTeam).toBe(false);
    expect(pulled.state.teams.filter((team) => team.name === "Yankees")).toHaveLength(1);

    // A *second* club of that name, pulled after the first has claimed it, stays its own team:
    // adopting a club somebody has already been pulled as would take its games with it.
    const rival = importGcSchedule(
      schedule({ id: "gcY800000000", name: "Yankees 9U" }, []),
      pulled.state
    );
    expect(rival.outcome.createdTeam).toBe(true);
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

  it("lets a mirrored result settle a slot even when the two schedules disagree on the time", () => {
    // One game on each schedule that day, the same 7-3 from each side, typed at 6:00 by one coach
    // and 8:30 by the other. That is one game; a thousand of them stood unsettled on the time.
    const { state, resolved } = resolveSlotGames(
      bothSides({ slotTime: "2026-09-05T18:00:00.000Z", namedTime: "2026-09-05T20:30:00.000Z" })
    );
    expect(resolved).toBe(1);
    expect(state.games).toHaveLength(1);
  });

  it("never folds a slot into a named row whose result contradicts it", () => {
    // Aces beat TBD 7-3; Bears say they beat Aces 9-2 that day. Two games, whatever the count.
    let state = bothSides({});
    state = {
      ...state,
      games: state.games.map((game) =>
        game.source?.teamId === "gcB" ? { ...game, teamAScore: 9, teamBScore: 2 } : game
      ),
    };
    const { state: after, resolved } = resolveSlotGames(state);
    expect(resolved).toBe(0);
    expect(after.games).toHaveLength(2);
  });

  describe("a game two coaches scored apart", () => {
    /*
     * Aces beat somebody they wrote as "Bears Baseball" 7-3 at six; the Bears' own schedule has
     * them losing 3-8 to the Aces at six. Built by hand, because which step the import leaves this
     * shape to depends on what else is pulled.
     */
    const SIX = "2026-09-05T18:00:00.000Z";
    const day = (
      opts: {
        slotName?: string;
        placeholder?: boolean;
        /** Null for a named row with no start time. */
        namedTime?: string | null;
        namedSource?: string;
      } = {}
    ): GcImportState => {
      let state: GcImportState = { ageGroups: [], teams: [], games: [] };
      for (const [id, name] of [
        ["gcA", "Aces 9U"],
        ["gcB", "Bears 9U"],
      ] as const) {
        state = importGcSchedule(
          {
            profile: { id, name, ageLevel: 9, season: { season: "fall", year: 2026 } },
            games: [],
            fetchedAt: "2026-09-06T00:00:00.000Z",
          },
          state
        ).state;
      }
      const clubId = (gcId: string) =>
        state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId))!.id;
      const standIn = {
        id: "S-STAND",
        name: opts.slotName ?? "Bears Baseball",
        ...(opts.placeholder ? { placeholder: true as const } : { nameOnly: true as const }),
      };
      const ageGroupId = state.ageGroups[0]!.id;
      return {
        ...state,
        teams: [...state.teams, standIn],
        games: [
          {
            id: "gc_gcA_a1",
            teamAId: clubId("gcA"),
            teamBId: standIn.id,
            ageGroupId,
            date: "2026-09-05",
            teamAScore: 7,
            teamBScore: 3,
            startTs: SIX,
            source: { kind: "gamechanger", teamId: "gcA", gameId: "a1" },
          },
          {
            id: "gc_gcB_b1",
            teamAId: clubId("gcB"),
            teamBId: clubId("gcA"),
            ageGroupId,
            date: "2026-09-05",
            teamAScore: 3,
            teamBScore: 8,
            ...(opts.namedTime === null ? {} : { startTs: opts.namedTime ?? SIX }),
            source: { kind: "gamechanger", teamId: opts.namedSource ?? "gcB", gameId: "b1" },
          },
        ],
      };
    };

    it("keeps it once at one start time, the named row standing with the other result noted", () => {
      const { state, resolved } = resolveSlotGames(day());
      expect(resolved).toBe(1);
      expect(state.games).toHaveLength(1);
      const row = state.games[0]!;
      expect(row.id).toBe("gc_gcB_b1");
      expect([row.teamAScore, row.teamBScore]).toEqual([3, 8]);
      // In the row's own order, Bears first: the Aces had it 3-7.
      expect(row.note).toBe("Other side reported 3-7.");
      expect(state.teams.some((team) => team.id === "S-STAND")).toBe(false);
    });

    it("leaves two contradicting results at two different times as two games", () => {
      expect(resolveSlotGames(day({ namedTime: "2026-09-05T20:30:00.000Z" })).resolved).toBe(0);
    });

    it("leaves them when the named row has no start time to agree with", () => {
      // With no clock on one side, a contradicting result is the doubleheader the rule refuses.
      expect(resolveSlotGames(day({ namedTime: null })).resolved).toBe(0);
    });

    it("leaves them when the stand-in's name is not a shorthand for the club", () => {
      expect(resolveSlotGames(day({ slotName: "Sharks" })).resolved).toBe(0);
    });

    it("leaves them when the slot is a bracket placeholder, whatever it is labelled", () => {
      // A placeholder's label is the bracket's, not a club's: "Bears" here says nothing about who.
      expect(resolveSlotGames(day({ slotName: "Bears", placeholder: true })).resolved).toBe(0);
    });

    it("leaves them when one schedule wrote both", () => {
      // One coach's two rows at one instant with two results: nobody else's account of the game.
      expect(resolveSlotGames(day({ namedSource: "gcA" })).resolved).toBe(0);
    });
  });

  it("gives a doubleheader's mirrored row to the slot whose time matches", () => {
    // Aces list two "TBD"s that day, both 7-3, at 6:00 and 8:30; Bears list one game vs Aces,
    // 3-7 at 8:30. The 8:30 slot is the Bears game; the 6:00 one stays a slot.
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
            startTs: "2026-09-05T18:00:00.000Z",
            opponentName: "TBD",
            teamScore: 7,
            opponentScore: 3,
            status: "completed",
          },
          {
            id: "a2",
            date: "2026-09-05",
            startTs: "2026-09-05T20:30:00.000Z",
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
            startTs: "2026-09-05T20:30:00.000Z",
            opponentName: "Aces 9U",
            teamScore: 3,
            opponentScore: 7,
            status: "completed",
          },
        ],
        fetchedAt: "2026-09-06T00:00:00.000Z",
      },
      state
    ).state;
    const { state: after, resolved } = resolveSlotGames(state);
    expect(resolved).toBe(1);
    const slots = after.games.filter(
      (game) => after.teams.find((t) => t.id === game.teamBId)?.placeholder
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]?.startTs).toBe("2026-09-05T18:00:00.000Z");
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

describe("settled pairings", () => {
  const squad = (
    id: string,
    name: string,
    season: "fall" | "winter" | "spring",
    seasonYear: number,
    place: { city?: string; state?: string } = {}
  ): ScoutTeam => ({
    id,
    name,
    ...place,
    gcTeams: [
      {
        teamId: `gc-${id}`,
        name: `${name} 9U`,
        ageGroupId: "ag1",
        ageLevel: 9,
        season,
        seasonYear,
      },
    ],
  });
  const state = (teams: ScoutTeam[], games: ScoutGame[] = []): GcImportState => ({
    ageGroups: [{ id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }],
    teams,
    games,
  });
  const played = (
    id: string,
    teamAId: string,
    teamBId: string,
    date: string,
    a: number,
    b: number,
    source: string
  ): ScoutGame => ({
    id,
    teamAId,
    teamBId,
    ageGroupId: "ag1",
    date,
    teamAScore: a,
    teamBScore: b,
    source: { kind: "gamechanger", teamId: source, gameId: id },
  });

  it("is settled on the same name, town and state, and nothing less", () => {
    const where = { city: "Butler", state: "PA" };
    const [three] = proposeSeasonPairings([
      squad("f", "Butler Baseball", "fall", 2026, where),
      squad("s", "Butler Baseball", "spring", 2027, where),
    ]);
    expect(three && isSettledPairing(three)).toBe(true);

    // Same name and same state is not even an offer, let alone settled.
    expect(
      proposeSeasonPairings([
        squad("f", "Mustangs", "fall", 2026, { state: "OH" }),
        squad("s", "Mustangs", "spring", 2027, { state: "OH" }),
      ])
    ).toEqual([]);
  });

  it("pairs the settled ones on its own and leaves the rest for the user", () => {
    const where = { city: "Butler", state: "PA" };
    const teams = [
      squad("bf", "Butler Baseball", "fall", 2026, where),
      squad("bs", "Butler Baseball", "spring", 2027, where),
      squad("mf", "Mustangs", "fall", 2026, { state: "OH" }),
      squad("ms", "Mustangs", "spring", 2027, { state: "OH" }),
    ];
    const out = pairSettledSquads(state(teams));
    expect(out.paired).toBe(1);
    expect(out.state.teams.map((team) => team.id).sort()).toEqual(["bs", "mf", "ms"]);
    const butler = out.state.teams.find((team) => team.id === "bs");
    expect(butler?.gcTeams?.map((link) => link.teamId).sort()).toEqual(["gc-bf", "gc-bs"]);
    // The Mustangs — same name, same state, no town in common — are neither applied nor
    // offered: every rec league in Ohio has a Mustangs.
    expect(proposeSeasonPairings(out.state.teams)).toEqual([]);
    expect(out.state.teams.filter((team) => team.name === "Mustangs")).toHaveLength(2);
  });

  it("follows a chain, so Fall, Winter and Spring end as one team whatever the order", () => {
    const where = { city: "Rillo", state: "TX" };
    const teams = [
      squad("w", "Rillo Dillos", "winter", 2026, where),
      squad("s", "Rillo Dillos", "spring", 2027, where),
      squad("f", "Rillo Dillos", "fall", 2026, where),
    ];
    const out = pairSettledSquads(state(teams));
    expect(out.state.teams).toHaveLength(1);
    expect(out.state.teams[0]?.gcTeams?.map((link) => link.teamId).sort()).toEqual([
      "gc-f",
      "gc-s",
      "gc-w",
    ]);
  });

  it("rewrites a large settled batch once, including every endpoint and chained survivor", () => {
    const where = { city: "Batchville", state: "TX" };
    const teams = Array.from({ length: 240 }, (_, n) => [
      squad(`f${n}`, `Club ${n}`, "fall", 2026, where),
      squad(`s${n}`, `Club ${n}`, "spring", 2027, where),
    ]).flat();
    teams.push(
      squad("chain-f", "Chain Club", "fall", 2026, where),
      squad("chain-w", "Chain Club", "winter", 2026, where),
      squad("chain-s", "Chain Club", "spring", 2027, where)
    );
    const games = Array.from({ length: 240 }, (_, n) =>
      played(`g${n}`, `f${n}`, `f${(n + 1) % 240}`, "2026-09-05", 5, 4, `gc-f${n}`)
    );
    games.push(played("chain-game", "chain-f", "f0", "2026-09-06", 3, 2, "gc-chain-f"));

    const beats: Array<[number, number, number]> = [];
    const out = pairSettledSquads({ ...state(teams), games }, (...beat) => beats.push(beat));

    expect(out.paired).toBe(242);
    expect(beats.length).toBeGreaterThan(1);
    // The chain has one redundant direct candidate after its two edges have already converged.
    expect(beats[beats.length - 1]?.[0]).toBe(243);
    expect(
      out.state.games.every(
        (game) => !game.teamAId.startsWith("f") && !game.teamBId.startsWith("f")
      )
    ).toBe(true);
    expect(out.state.games.find((game) => game.id === "chain-game")).toMatchObject({
      teamAId: "chain-s",
      teamBId: "s0",
    });
    expect(out.state.teams.find((team) => team.id === "chain-s")?.gcTeams).toHaveLength(3);
  });

  it("does not pair two clubs of one name in different towns", () => {
    const teams = [
      squad("f", "Yankees", "fall", 2026, { city: "Dayton", state: "OH" }),
      squad("s", "Yankees", "spring", 2027, { city: "Toledo", state: "OH" }),
    ];
    expect(pairSettledSquads(state(teams)).paired).toBe(0);
  });

  it("lays the two clubs side by side with the opponents in common marked", () => {
    const teams = [
      squad("f", "Mustangs", "fall", 2026, { city: "Mason", state: "OH" }),
      squad("s", "Mustangs", "spring", 2027, { state: "OH" }),
      { id: "a", name: "Aces" },
      // A pulled club both Mustangs played is what makes this an offer at all.
      squad("b", "Bandits", "fall", 2026, { city: "Lebanon", state: "OH" }),
      { id: "c", name: "Cubs" },
    ];
    const games = [
      played("g1", "f", "a", "2026-09-05", 5, 4, "gc-f"),
      played("g2", "f", "b", "2026-09-06", 2, 8, "gc-f"),
      played("g3", "s", "b", "2027-04-10", 7, 1, "gc-s"),
      played("g4", "c", "s", "2027-04-11", 3, 3, "gc-s"),
    ];
    const [pairing] = proposeSeasonPairings(teams, games);
    expect(pairing).toBeDefined();
    const side = comparePairing(pairing!, teams, games);
    expect(side).toMatchObject({
      from: { gcName: "Mustangs 9U", season: "Fall 2026", city: "Mason", state: "OH", games: 2 },
      to: { gcName: "Mustangs 9U", season: "Spring 2027", state: "OH", games: 2 },
      sharedOpponents: ["Bandits"],
    });
    expect(side?.from.opponents).toEqual(["Aces", "Bandits"]);
    expect(side?.to.opponents).toEqual(["Bandits", "Cubs"]);
    expect(side?.to.city).toBeUndefined();
  });
});

describe("the squad year window", () => {
  const fall = { season: "fall" as const, year: 2026 };
  const played = (id: string, opponentName: string, date: string) => ({
    id,
    date,
    opponentName,
    status: "completed" as const,
    teamScore: 5,
    opponentScore: 2,
  });

  it("leaves out a game dated before August 1 of the year the squad year starts", () => {
    // A Fall 2026 id is squad year 2027, which began on 2026-08-01. May 2026 was last year's squad.
    const { state, outcome } = importGcSchedule(
      {
        profile: { id: "gcWARRIORS0", name: "Alaska Warriors 11U", ageLevel: 11, season: fall },
        games: [
          played("g1", "Placer Grit 11U", "2026-05-02"),
          played("g2", "North Star Vikings 11U", "2026-08-01"),
          played("g3", "Last Autumn 11U", "2025-09-07"),
        ],
        fetchedAt: "2026-09-15T12:00:00.000Z",
      },
      empty
    );
    expect(outcome.gamesOutOfSeason).toBe(2);
    expect(outcome.gamesAdded).toBe(1);
    expect(state.games.map((game) => game.date)).toEqual(["2026-08-01"]);
    // The clubs it played before the season are not minted as opponents either.
    expect(state.teams.map((team) => team.name).sort()).toEqual([
      "Alaska Warriors",
      "North Star Vikings",
    ]);
  });

  it("prunes an existing pool the same way, and the tidy reports it", () => {
    const { state } = importGcSchedule(
      {
        profile: { id: "gcCARDS00000", name: "Alabama Cardinals 10U", ageLevel: 10, season: fall },
        games: [played("g1", "OM Fire Hawks 10U", "2026-08-22")],
        fetchedAt: "2026-09-15T12:00:00.000Z",
      },
      empty
    );
    // A row filed before the rule existed.
    const stale = {
      ...state,
      games: [...state.games, { ...state.games[0]!, id: "old", date: "2025-09-07" }],
    };
    const tidy = tidyPool(stale);
    expect(tidy.pruned).toBe(1);
    expect(tidy.state.games.map((game) => game.date)).toEqual(["2026-08-22"]);
    expect(describeTidy(tidy)[0]).toContain("dated before the season began (August 1)");
  });

  it("skips a team GameChanger lists above the oldest level ranked here", () => {
    const { state, outcome } = importGcSchedule(
      {
        profile: {
          id: "gcLEGION0000",
          name: "Wentzville Legion AAA 19U",
          ageLevel: 19,
          season: fall,
        },
        games: [played("g1", "Somebody 19U", "2026-08-22")],
        fetchedAt: "2026-09-15T12:00:00.000Z",
      },
      empty
    );
    expect(outcome.issue).toContain("above the oldest level");
    expect(state.ageGroups).toHaveLength(0);
    expect(state.teams).toHaveLength(0);
  });
});

describe("tidy until dry", () => {
  it("keeps going while a pass changes something, and says how many it took", () => {
    const tidy = tidyPool(empty);
    expect(tidy.passes).toBe(1);
    expect(tidy.named + tidy.folded + tidy.paired + tidy.collapsed + tidy.pruned).toBe(0);
  });
});

describe("poolSignature", () => {
  it("changes when a pull, a restore or a tidy changes the pool, and not otherwise", () => {
    const { state } = importGcSchedule(
      {
        profile: {
          id: "gcSIGN000000",
          name: "Signers 9U",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
        },
        games: [
          {
            id: "g1",
            date: "2026-09-05",
            opponentName: "Others 9U",
            status: "completed",
            teamScore: 1,
            opponentScore: 0,
          },
        ],
        fetchedAt: "2026-09-15T12:00:00.000Z",
      },
      empty
    );
    const before = poolSignature(state);
    /*
     * The leading `r` is the version of the rules the tidy applies. It rides in the signature so a
     * pool the tidy has already seen reads as one it has not, exactly once, after a release that
     * changes a rule — otherwise an untouched pool would keep whatever the old rules decided for
     * ever, because the stamp would still match and the tidy would never run.
     */
    // r8 since the tidy learned to file a stand-in onto a lone namesake in a bordering state.
    // This digit is meant to move on exactly that kind of change: it is what makes a pool nobody
    // has touched read as unseen, once, so the new rule reaches what is already filed.
    expect(before).toBe(`r9|1|2|1|2026-09-15T12:00:00.000Z`);
    expect(poolSignature({ ...state, games: [...state.games] })).toBe(before);
    expect(poolSignature({ ...state, games: [] })).not.toBe(before);
    expect(poolSignature(empty)).toBe("r9|0|0|0|");
  });
});

describe("who a name belongs to: level, state and the game", () => {
  const fall = { season: "fall" as const, year: 2026 };
  const played = (
    id: string,
    opponentName: string,
    date: string,
    a: number,
    b: number,
    startTs?: string
  ) => ({
    id,
    date,
    opponentName,
    status: "completed" as const,
    teamScore: a,
    opponentScore: b,
    ...(startTs ? { startTs } : {}),
  });
  const club = (
    id: string,
    name: string,
    ageLevel: number,
    state: string,
    games: ReturnType<typeof played>[],
    city?: string
  ): GcTeamSchedule => ({
    profile: { id, name, ageLevel, season: fall, state, ...(city ? { city } : {}) },
    games,
    fetchedAt: "2026-09-15T12:00:00.000Z",
  });
  const fold = (schedules: GcTeamSchedule[]): GcImportState => {
    const importer = createGcImporter(empty);
    schedules.forEach((schedule) => importer.add(schedule));
    return importer.state;
  };
  const named = (state: GcImportState, name: string) =>
    state.teams.filter((team) => team.name === name);

  it("adopts the stand-in at its own level when the name has stand-ins at several", () => {
    // Two FL schedules name JCB Diamond Kings Elite, one at 9U and one at 10U, before the 9U club
    // is pulled. The 9U club is the 9U stand-in; the 10U one is its older squad.
    const pool = fold([
      club("gcFLA9000000", "Boca Pirates 9U", 9, "FL", [
        played("a1", "JCB Diamond Kings Elite 9U", "2026-09-05", 2, 6),
      ]),
      club("gcFLB1000000", "Wellington Wolves 10U", 10, "FL", [
        played("b1", "JCB Diamond Kings Elite 10U", "2026-09-05", 4, 4),
      ]),
      club("gcJCB9000000", "JCB Diamond Kings Elite 9U", 9, "FL", []),
    ]);
    const jcb = named(pool, "JCB Diamond Kings Elite");
    expect(jcb).toHaveLength(2);
    const pulled = jcb.find((team) => team.gcTeams?.length);
    expect(pulled?.nameOnly).toBeUndefined();
    // The 9U stand-in's game is on the pulled club now; the 10U stand-in still holds its own.
    const pirates = named(pool, "Boca Pirates")[0]!;
    const row = pool.games.find((game) => [game.teamAId, game.teamBId].includes(pirates.id))!;
    expect([row.teamAId, row.teamBId]).toContain(pulled!.id);
  });

  it("adopts the stand-in its own schedule confirms, even at another level", () => {
    // A CA schedule named "Inferno" at 8U and lost 2-5 to them; the Inferno pulled is a 9U whose
    // own schedule holds that 5-2. The game says which stand-in is theirs.
    const pool = fold([
      club("gcCAA8000000", "Sharks 8U", 8, "CA", [played("a1", "Inferno 8U", "2026-09-05", 2, 5)]),
      club("gcCAB9000000", "Rays 9U", 9, "CA", [played("b1", "Inferno 9U", "2026-09-12", 1, 9)]),
      club("gcINFERNO900", "Inferno 9U", 9, "MD", [played("i1", "Sharks 8U", "2026-09-05", 5, 2)]),
    ]);
    const inferno = named(pool, "Inferno");
    const pulled = inferno.find((team) => team.gcTeams?.length)!;
    const sharks = named(pool, "Sharks")[0]!;
    const rows = pool.games.filter((game) => [game.teamAId, game.teamBId].includes(sharks.id));
    expect(rows).toHaveLength(1);
    expect([rows[0]!.teamAId, rows[0]!.teamBId]).toContain(pulled.id);
  });

  it("does not adopt a lone stand-in that only clubs in other states named", () => {
    // Three Texas schedules name "Grit"; the only Grit pulled is in New York and never played them.
    const pool = fold([
      club("gcTXA9000000", "Colleyville Cubs 9U", 9, "TX", [
        played("a1", "Grit 9U", "2026-09-05", 3, 4),
      ]),
      club("gcTXB9000000", "Denton Dawgs 9U", 9, "TX", [
        played("b1", "Grit 9U", "2026-09-06", 1, 8),
      ]),
      club("gcGRITNY9000", "Grit 9U", 9, "NY", [
        played("g1", "Chestnut Ridge 9U", "2026-09-05", 6, 0),
      ]),
    ]);
    const grit = named(pool, "Grit");
    expect(grit).toHaveLength(2);
    expect(grit.filter((team) => team.nameOnly)).toHaveLength(1);
    expect(grit.filter((team) => team.gcTeams?.length)).toHaveLength(1);
  });

  it("still matches a club whose schedule was empty when a neighbour names it", () => {
    // Brazos Valley Bucks (TX) came back with no games at all; a Texas schedule then names them.
    const pool = fold([
      club("gcBRAZOS1100", "Brazos Valley Bucks Lemons 11U", 11, "TX", []),
      club("gcTXC1100000", "Katy Krush 11U", 11, "TX", [
        played("k1", "Brazos Valley Bucks Lemons 11U", "2026-09-05", 2, 3),
      ]),
    ]);
    const bucks = named(pool, "Brazos Valley Bucks Lemons");
    expect(bucks).toHaveLength(1);
    expect(bucks[0]?.gcTeams?.[0]?.teamId).toBe("gcBRAZOS1100");
    expect(pool.games).toHaveLength(1);
  });

  it("leaves a sole namesake in another state as a stand-in unless something vouches for it", () => {
    // Hixson Braves (TN) list the Dodgers; the only Dodgers pulled so far are in Florida.
    const pool = fold([
      club("gcDODGFL0000", "Dodgers 10U", 10, "FL", [
        played("d1", "Marlins 10U", "2026-09-01", 5, 1),
      ]),
      club("gcHIXSON0000", "Hixson Braves 10U", 10, "TN", [
        played("h1", "Dodgers 10U", "2026-09-08", 7, 2),
      ]),
    ]);
    const dodgers = named(pool, "Dodgers");
    expect(dodgers).toHaveLength(2);
    const fl = dodgers.find((team) => team.state === "FL")!;
    const braves = named(pool, "Hixson Braves")[0]!;
    const row = pool.games.find((game) => [game.teamAId, game.teamBId].includes(braves.id))!;
    expect([row.teamAId, row.teamBId]).not.toContain(fl.id);
  });

  it("takes a sole namesake in another state when its own schedule holds the game", () => {
    // Albertville Aggies (AL) really did play Douglas (OH), and Douglas' schedule says so.
    const pool = fold([
      club("gcDOUGLASOH0", "Douglas 9U", 9, "OH", [
        played("d1", "Albertiville Aggies 9U", "2026-09-01", 1, 13),
      ]),
      club("gcAGGIESAL00", "Albertiville Aggies 9U", 9, "AL", [
        played("a1", "Douglas 9U", "2026-09-01", 13, 1),
      ]),
    ]);
    expect(named(pool, "Douglas")).toHaveLength(1);
    expect(pool.games).toHaveLength(1);
  });

  it("keeps a stand-in per state for a name that is nobody in particular", () => {
    const pool = fold([
      club("gcTXD8000000", "Frisco Fury 8U", 8, "TX", [
        played("a1", "Bandits 8U", "2026-09-05", 3, 4),
      ]),
      club("gcFLD8000000", "Tampa Terror 8U", 8, "FL", [
        played("b1", "Bandits 8U", "2026-09-05", 1, 8),
      ]),
      club("gcTXE8000000", "Plano Power 8U", 8, "TX", [
        played("c1", "Bandits 8U", "2026-09-12", 0, 6),
      ]),
    ]);
    const bandits = named(pool, "Bandits");
    expect(bandits).toHaveLength(2);
    const games = (id: string) =>
      pool.games.filter((game) => [game.teamAId, game.teamBId].includes(id)).length;
    expect(bandits.map((team) => games(team.id)).sort()).toEqual([1, 2]);
  });

  it("files a stand-in's rows onto the one club of that name in the puller's state at tidy", () => {
    // A pool filed before the rules above existed: two Mississippi schedules' games sit on a
    // "Cubs" stand-in while a Grenada MS Cubs and a Texas Cubs were both pulled. Only the state
    // can say which Cubs; the pass is order-independent, which nothing at arrival was.
    const pool = fold([
      club("gcCUBSTX0000", "Cubs 8U", 8, "TX", [
        played("t1", "Wylie Wolves 8U", "2026-09-01", 9, 0),
      ]),
      club(
        "gcCUBSMS0000",
        "Cubs 8U",
        8,
        "MS",
        [played("m1", "Delta Dogs 8U", "2026-09-05", 3, 3)],
        "Grenada"
      ),
      club(
        "gcMSA8000000",
        "OES Mayhem 8U",
        8,
        "MS",
        [played("a1", "Wylie Wolves 8U", "2026-08-27", 2, 5)],
        "Grenada"
      ),
    ]);
    const mayhem = named(pool, "OES Mayhem")[0]!;
    const standIn: ScoutTeam = { id: "S-CUBS-STUB", name: "Cubs", nameOnly: true };
    const stale: GcImportState = {
      ...pool,
      teams: [...pool.teams, standIn],
      games: [
        ...pool.games,
        {
          id: "gc_gcMSA8000000_old",
          teamAId: mayhem.id,
          teamBId: standIn.id,
          ageGroupId: pool.games[0]!.ageGroupId,
          date: "2026-08-15",
          teamAScore: 4,
          teamBScore: 6,
          ageLevelA: 8,
          ageLevelB: 8,
          source: { kind: "gamechanger", teamId: "gcMSA8000000", gameId: "old" },
        },
      ],
    };
    const out = refileStandIns(stale);
    expect(out.refiled).toBe(1);
    const ms = named(out.state, "Cubs").find((team) => team.state === "MS")!;
    const row = out.state.games.find((game) => game.id === "gc_gcMSA8000000_old")!;
    expect(row.teamBId).toBe(ms.id);
    expect(out.state.teams.find((team) => team.id === "S-CUBS-STUB")).toBeUndefined();
  });

  describe("a namesake across a state line", () => {
    /*
     * A Kentucky club's game sits on a "Cubs" stand-in, with no Cubs pulled in Kentucky. On the
     * stand-in fixtures export of 22 September 2026, a sole namesake in a bordering state was the
     * club the game itself identified 1,174 times in 1,240 — nearer the one-in-ten miss this
     * rule already accepts within a state than a refusal is worth.
     */
    const cubsAt = (states: { state: string; city?: string }[]) => {
      const clubs = states.map(({ state, city }, at) =>
        club(`gcCUBS${state}${String(at).padStart(4, "0")}`, "Cubs 8U", 8, state, [], city)
      );
      const pool = fold([
        ...clubs,
        club(
          "gcKYPULLER00",
          "Louisville Legends 8U",
          8,
          "KY",
          [played("k1", "Wylie Wolves 8U", "2026-09-01", 9, 0)],
          "Louisville"
        ),
      ]);
      const legends = named(pool, "Louisville Legends")[0]!;
      const standIn: ScoutTeam = { id: "S-CUBS-STUB", name: "Cubs", nameOnly: true };
      const stale: GcImportState = {
        ...pool,
        teams: [...pool.teams, standIn],
        games: [
          ...pool.games,
          {
            id: "gc_gcKYPULLER00_old",
            teamAId: legends.id,
            teamBId: standIn.id,
            ageGroupId: pool.games[0]!.ageGroupId,
            date: "2026-08-15",
            teamAScore: 4,
            teamBScore: 6,
            ageLevelA: 8,
            ageLevelB: 8,
            source: { kind: "gamechanger", teamId: "gcKYPULLER00", gameId: "old" },
          },
        ],
      };
      const out = refileStandIns(stale);
      const row = out.state.games.find((game) => game.id === "gc_gcKYPULLER00_old")!;
      return { out, on: out.state.teams.find((team) => team.id === row.teamBId)! };
    };

    it("files a stand-in onto the one club of that name in a bordering state", () => {
      const { out, on } = cubsAt([{ state: "OH" }, { state: "FL" }]);
      expect(out.refiled).toBe(1);
      expect(on.state).toBe("OH");
      expect(on.nameOnly).toBeUndefined();
    });

    it("leaves it where the only namesake is in a state that does not border", () => {
      const { out, on } = cubsAt([{ state: "FL" }]);
      expect(out.refiled).toBe(0);
      expect(on.id).toBe("S-CUBS-STUB");
    });

    it("leaves it where two namesakes sit across the borders", () => {
      expect(cubsAt([{ state: "OH" }, { state: "IN" }]).out.refiled).toBe(0);
    });

    it("does not look across a border when two in the state cannot be told apart", () => {
      // Two Kentucky Cubs, neither in the puller's town: that is a guess, and so is Ohio's.
      const { out } = cubsAt([
        { state: "KY", city: "Lexington" },
        { state: "KY", city: "Paducah" },
        { state: "OH" },
      ]);
      expect(out.refiled).toBe(0);
    });
  });

  it("breaks a tie between two in-state clubs by the puller's own town", () => {
    // Five Texas Rangers; the Prosper schedules keep naming "Rangers". The Prosper one it is.
    const pool = fold([
      club(
        "gcRANGERSA00",
        "Rangers 10U",
        10,
        "TX",
        [played("r1", "Garland Gators 10U", "2026-09-01", 1, 0)],
        "Garland"
      ),
      club(
        "gcRANGERSB00",
        "Rangers 10U",
        10,
        "TX",
        [played("r2", "Celina Cubs 10U", "2026-09-01", 2, 0)],
        "Prosper"
      ),
      club("gcPROSPER000", "Prosper Pride 10U", 10, "TX", [], "Prosper"),
    ]);
    const pride = named(pool, "Prosper Pride")[0]!;
    const standIn: ScoutTeam = { id: "S-RANGERS-STUB", name: "Rangers", nameOnly: true };
    const stale: GcImportState = {
      ...pool,
      teams: [...pool.teams, standIn],
      games: [
        ...pool.games,
        {
          id: "gc_gcPROSPER000_old",
          teamAId: pride.id,
          teamBId: standIn.id,
          ageGroupId: pool.games[0]!.ageGroupId,
          date: "2026-09-05",
          teamAScore: 2,
          teamBScore: 3,
          ageLevelA: 10,
          ageLevelB: 10,
          source: { kind: "gamechanger", teamId: "gcPROSPER000", gameId: "old" },
        },
      ],
    };
    const out = refileStandIns(stale);
    expect(out.refiled).toBe(1);
    const prosper = named(out.state, "Rangers").find((team) => team.city === "Prosper")!;
    expect(out.state.games.find((game) => game.id === "gc_gcPROSPER000_old")?.teamBId).toBe(
      prosper.id
    );
  });

  it("counts a shared town as pairing evidence only in the same state", () => {
    const pairings = proposeSeasonPairings([
      {
        id: "in",
        name: "Dragons Baseball Club",
        city: "Lawrenceburg",
        state: "IN",
        gcTeams: [
          {
            teamId: "gc-in",
            name: "Dragons Baseball Club 10U",
            ageGroupId: "ag1",
            ageLevel: 10,
            season: "fall",
            seasonYear: 2026,
          },
        ],
      },
      {
        id: "ky",
        name: "Dragons Baseball Club",
        city: "Lawrenceburg",
        state: "KY",
        gcTeams: [
          {
            teamId: "gc-ky",
            name: "Dragons Baseball Club 10U",
            ageGroupId: "ag1",
            ageLevel: 10,
            season: "spring",
            seasonYear: 2027,
          },
        ],
      },
    ]);
    expect(pairings).toEqual([]);
  });

  it("leaves a stand-in alone when two clubs of the name share the puller's state", () => {
    const pool = fold([
      club("gcRANGERSA00", "Rangers 10U", 10, "TX", [], "Garland"),
      club("gcRANGERSB00", "Rangers 10U", 10, "TX", [], "Prosper"),
      club("gcTXF1000000", "Allen Aces 10U", 10, "TX", [
        played("a1", "Rangers 10U", "2026-09-05", 2, 3),
      ]),
    ]);
    const tidy = tidyPool(pool);
    expect(tidy.refiled).toBe(0);
    expect(named(tidy.state, "Rangers").filter((team) => team.nameOnly)).toHaveLength(1);
  });
});

/**
 * Taken from a real pool, where the result went missing.
 *
 * River City Raptors beat Legacy Baseball Club 15-7 on 22 August 2026. The pool kept Legacy's
 * "13-10 River City Raptors" with a note reading "Other side reported 7-15." and nothing else —
 * the Raptors' win was gone. They had played twice that day, and Legacy's scorekeeper entered the
 * second one against "TBD".
 */
describe("a club met twice in one day", () => {
  const legacySchedule = () =>
    schedule({ id: "5pK3fIt1gYIR", name: "Legacy Baseball Club 11U" }, [
      // The first meeting, which Legacy won.
      game({
        id: "027f019e",
        opponentName: "River City Raptors",
        date: "2026-08-22",
        teamScore: 13,
        opponentScore: 10,
      }),
      // The second, which Legacy's scorekeeper left unnamed.
      game({
        id: "62c9ff4f",
        opponentName: "TBD- 08/22/26, 3:00 PM",
        date: "2026-08-22",
        teamScore: 7,
        opponentScore: 15,
      }),
    ]);

  const raptorsSchedule = () =>
    schedule({ id: "T1P0KzfKw4QY", name: "River City Raptors 11U" }, [
      game({
        id: "7d923672",
        opponentName: "Legacy Baseball Club",
        date: "2026-08-22",
        teamScore: 15,
        opponentScore: 7,
      }),
    ]);

  const bothPulled = () => {
    const first = importGcSchedule(legacySchedule(), empty);
    return importGcSchedule(raptorsSchedule(), first.state).state;
  };

  const scoresBetween = (state: GcImportState) => {
    const legacy = state.teams.find((team) => team.name.startsWith("Legacy"));
    const raptors = state.teams.find((team) => team.name.startsWith("River City"));
    return state.games
      .filter(
        (g) =>
          [g.teamAId, g.teamBId].includes(legacy?.id ?? "") &&
          [g.teamAId, g.teamBId].includes(raptors?.id ?? "")
      )
      .map((g) =>
        g.teamAId === legacy?.id
          ? `${g.teamAScore}-${g.teamBScore}`
          : `${g.teamBScore}-${g.teamAScore}`
      )
      .sort();
  };

  it("keeps both results through the tidy", () => {
    const tidied = tidyPool(bothPulled()).state;
    // Legacy won one and lost one. Before this, the 7-15 was deleted as a disputed score.
    expect(scoresBetween(tidied)).toEqual(["13-10", "7-15"]);
  });

  it("settles the stand-in rather than leaving it standing", () => {
    const tidied = tidyPool(bothPulled()).state;
    expect(tidied.teams.some((team) => team.placeholder)).toBe(false);
    expect(tidied.games.some((g) => g.note?.includes("Other side reported"))).toBe(false);
  });

  it("remembers that the settled row came from the other schedule", () => {
    const tidied = tidyPool(bothPulled()).state;
    // The fold removed a row; without this the collapse cannot tell two meetings from one dispute.
    const second = tidied.games.find(
      (g) => g.teamAScore === 15 || (g.teamBScore === 15 && g.teamAScore === 7)
    );
    expect(second?.alsoFrom).toContain("5pK3fIt1gYIR");
  });

  it("still collapses a genuine disagreement about one game", () => {
    // Each schedule lists the other once, with different scores, and neither posted a stand-in:
    // that is one game two coaches scored differently, and it stays one game.
    const first = importGcSchedule(
      schedule({ id: "gcHOMEHOMEHO", name: "Aces 9U" }, [
        game({
          id: "h1",
          opponentName: "Badgers 9U",
          date: "2026-08-22",
          teamScore: 6,
          opponentScore: 4,
        }),
      ]),
      empty
    );
    const both = importGcSchedule(
      schedule({ id: "gcAWAYAWAYAW", name: "Badgers 9U" }, [
        game({
          id: "a1",
          opponentName: "Aces 9U",
          date: "2026-08-22",
          teamScore: 5,
          opponentScore: 6,
        }),
      ]),
      first.state
    ).state;

    const tidied = tidyPool(both).state;
    expect(tidied.games).toHaveLength(1);
    expect(tidied.games[0]?.note).toMatch(/Other side reported/);
  });
});

describe("what a refresh keeps", () => {
  const withListed = (listed: GcTeamSchedule["listed"]): GcTeamSchedule => ({
    ...schedule({}, [game()]),
    ...(listed ? { listed } : {}),
  });
  const linkOf = (state: GcImportState) =>
    state.teams
      .find((team) => team.gcTeams?.some((l) => l.teamId === "gcAAAAAAAAAA"))
      ?.gcTeams?.find((l) => l.teamId === "gcAAAAAAAAAA");

  it("keeps the staff and roster size when the refresh was run without the list", () => {
    /*
     * The weekly rota is exactly this run: a pull with nothing in the paste box. Both fields come
     * from the user's list and from nowhere else, so a link written without one carries neither —
     * and replacing the link outright used to erase what the last list had said. That silently
     * stripped the evidence the merge suggestions and the watch list are built on, every week.
     */
    const first = importGcSchedule(
      withListed({ staff: ["Ada Coach", "Bo Coach"], playerCount: 11 }),
      empty
    ).state;
    expect(linkOf(first)?.staff).toEqual(["Ada Coach", "Bo Coach"]);
    expect(linkOf(first)?.playerCount).toBe(11);
    const countedAt = linkOf(first)?.countedAt;
    expect(countedAt).toBeDefined();

    const refreshed = importGcSchedule(withListed(undefined), first).state;
    expect(linkOf(refreshed)?.staff).toEqual(["Ada Coach", "Bo Coach"]);
    expect(linkOf(refreshed)?.playerCount).toBe(11);
    // The day the count was taken travels with it, or it could never be re-checked.
    expect(linkOf(refreshed)?.countedAt).toBe(countedAt);
  });

  it("lets a newer list overwrite both", () => {
    const first = importGcSchedule(
      withListed({ staff: ["Ada Coach"], playerCount: 8 }),
      empty
    ).state;
    const second = importGcSchedule(
      withListed({ staff: ["Cy Coach", "Di Coach"], playerCount: 13 }),
      first
    ).state;

    expect(linkOf(second)?.staff).toEqual(["Cy Coach", "Di Coach"]);
    expect(linkOf(second)?.playerCount).toBe(13);
  });

  it("carries nothing forward for a team that never had it", () => {
    const first = importGcSchedule(withListed(undefined), empty).state;
    const refreshed = importGcSchedule(withListed(undefined), first).state;

    expect(linkOf(refreshed)?.staff).toBeUndefined();
    expect(linkOf(refreshed)?.playerCount).toBeUndefined();
    expect(linkOf(refreshed)?.countedAt).toBeUndefined();
  });
});

describe("asking the opponents what age a team is", () => {
  /** A schedule against named opponents, with nothing said about the team's own age. */
  const against = (...opponents: string[]): GcTeamSchedule =>
    schedule(
      { name: "Warriors Spring 2027", ageLevel: undefined },
      opponents.map((opponentName, at) => game({ id: `g${at}`, opponentName, date: "2026-08-22" }))
    );

  it("takes the level the opponents agree on", () => {
    expect(ageFromOpponentNames(against("A 9U", "B 9U", "C 9U").games)).toBe(9);
  });

  it("takes a clear majority over the odd game played up", () => {
    // A side that plays its own age four times and up twice is still its own age.
    expect(
      ageFromOpponentNames(against("A 10U", "B 10U", "C 10U", "D 10U", "E 11U", "F 11U").games)
    ).toBe(10);
  });

  /*
   * It refuses far more readily than it answers, because the cost is not symmetric: a team left
   * unrated costs its own ranking, and a team rated at the wrong age corrupts every club it
   * played.
   */
  it("refuses fewer than three opponents who name an age", () => {
    expect(ageFromOpponentNames(against("A 9U", "B 9U").games)).toBeUndefined();
    expect(ageFromOpponentNames(against("A 9U", "Bandits", "Sluggers").games)).toBeUndefined();
  });

  it("refuses a tie, and anything short of a majority", () => {
    expect(ageFromOpponentNames(against("A 9U", "B 9U", "C 10U", "D 10U").games)).toBeUndefined();
    // Four different ages, three apiece for two of them: no level is what most of them played.
    expect(
      ageFromOpponentNames(
        against("A 9U", "B 9U", "C 9U", "D 10U", "E 11U", "F 12U", "G 13U").games
      )
    ).toBeUndefined();
  });

  it("counts a club once however many times it was played", () => {
    // A tournament against the same side four times is one club's opinion, not four.
    expect(ageFromOpponentNames(against("A 9U", "A 9U", "A 9U", "A 9U").games)).toBeUndefined();
  });

  it("reads a bracketed opponent as the older age, the same as everywhere else", () => {
    expect(ageFromOpponentNames(against("A 11U/12U", "B 12U", "C 12U").games)).toBe(12);
  });

  it("files the team under it, and says that is where the age came from", () => {
    /*
     * The case this exists for. "Warriors Spring 2027" is a season and not a graduating class, so
     * nothing about the team names an age — and every opponent on its schedule is 9U.
     */
    const { state, outcome } = importGcSchedule(against("A 9U", "B 9U", "C 9U"), empty);
    expect(outcome.ageFromOpponents).toBe(9);
    expect(outcome.issue).toBeUndefined();
    expect(state.ageGroups[0]?.ageLevel).toBe(9);
    // The link records it too, so a later pull is not asked the same question again.
    expect(state.teams[0]?.gcTeams?.[0]?.ageLevel).toBe(9);
  });

  it("leaves the team alone when it says its own age", () => {
    // Never second-guesses a stated age: the opponents are a fallback, not an audit.
    const stated = schedule({ name: "Warriors 14U", ageLevel: 14 }, [
      game({ id: "g0", opponentName: "A 9U" }),
      game({ id: "g1", opponentName: "B 9U" }),
      game({ id: "g2", opponentName: "C 9U" }),
    ]);
    const { outcome } = importGcSchedule(stated, empty);
    expect(outcome.ageFromOpponents).toBeUndefined();
    expect(outcome.ageGroupName).toContain("14U");
  });

  it("says so plainly when the opponents could not settle it either", () => {
    const { outcome } = importGcSchedule(against("Bandits", "Sluggers"), empty);
    expect(outcome.issue).toMatch(/opponents do not settle one either/i);
  });
});

/**
 * Two opponents naming one age, and nobody naming another. Measured on the pool-names export of
 * 23 September 2026 at 97.2% exact over 10,623 teams whose age the pool already files.
 */
describe("two opponents agreeing", () => {
  const against = (opponents: string[], label?: string): GcTeamSchedule =>
    schedule(
      { name: "Warriors Spring 2027", ageLevel: undefined, ...(label ? { ageLabel: label } : {}) },
      opponents.map((opponentName, at) => game({ id: `g${at}`, opponentName, date: "2026-08-22" }))
    );

  it("is enough when they both name the same age and nobody names another", () => {
    expect(ageFromTwoOpponents(against(["A 9U", "B 9U"]).games)).toBe(9);
    expect(ageFromTwoOpponents(against(["A 9U", "Bandits", "B 9U"]).games)).toBe(9);
  });

  it("is not two agreeing when they disagree, when one speaks, or when a third names anything", () => {
    expect(ageFromTwoOpponents(against(["A 9U", "B 10U"]).games)).toBeUndefined();
    expect(ageFromTwoOpponents(against(["A 9U", "Bandits"]).games)).toBeUndefined();
    expect(ageFromTwoOpponents(against(["A 9U", "B 9U", "C 10U"]).games)).toBeUndefined();
  });

  // One club played four times is one club's opinion, as it is for three.
  it("counts a club once however many times it was played", () => {
    expect(ageFromTwoOpponents(against(["A 9U", "A 9U"]).games)).toBeUndefined();
  });

  it("files the team under that age", () => {
    const { state, outcome } = importGcSchedule(against(["A 9U", "B 9U"]), empty);
    expect(outcome.ageFromOpponents).toBe(9);
    expect(state.ageGroups[0]?.ageLevel).toBe(9);
  });

  it("never files against GameChanger's own band", () => {
    const { outcome } = importGcSchedule(against(["A 14U", "B 14U"], "Under 13"), empty);
    expect(outcome.skip).toBe("no-age");
    expect(
      importGcSchedule(against(["A 11U", "B 11U"], "Under 13"), empty).outcome.ageFromOpponents
    ).toBe(11);
  });

  // The three-opponent reading is left exactly as it was: never held to the band.
  it("leaves three agreeing exactly as it was", () => {
    const { outcome } = importGcSchedule(against(["A 14U", "B 14U", "C 14U"], "Under 13"), empty);
    expect(outcome.ageFromOpponents).toBe(14);
  });
});

describe("an opponent who names a graduating class", () => {
  /*
   * Above about 13U most names carry a year rather than an age. Reading nothing from them left the
   * game with no level for that side, which the rating reads as a game between equals — so a 16U
   * side playing the class of 2031 got no age adjustment and counted as no cross-age game at all.
   */
  it("records the level the class implies, not the page's", () => {
    const { state } = importGcSchedule(
      schedule({ name: "Elite 2029", ageLevel: 16 }, [
        game({ id: "g0", opponentName: "Nationals 2031" }),
      ]),
      empty
    );
    const [filed] = state.games;
    expect(filed?.ageLevelA).toBe(16);
    // The class of 2031 are two years behind the class of 2029: 14U against 16U.
    expect(filed?.ageLevelB).toBe(14);
  });

  it("still prefers an age label when the name carries one", () => {
    const { state } = importGcSchedule(
      schedule({ name: "Elite 2029", ageLevel: 16 }, [
        game({ id: "g0", opponentName: "Nationals 15U 2031" }),
      ]),
      empty
    );
    expect(state.games[0]?.ageLevelB).toBe(15);
  });

  it("reads nothing from a season, the same as everywhere else", () => {
    const { state } = importGcSchedule(
      schedule({ name: "Elite 2029", ageLevel: 16 }, [
        game({ id: "g0", opponentName: "Nationals Spring 2031" }),
      ]),
      empty
    );
    // A season beside the year is refused, so the side has no level rather than a guessed one.
    expect(state.games[0]?.ageLevelB).toBeUndefined();
  });
});

describe("re-reading levels the pool already has", () => {
  /*
   * Every other tidy pass is about the shape of the pool. This one is about the rules having
   * changed: a club called "Nationals 2031" that has been sitting here for a month has no level,
   * and every game against it was recorded as a game between equals — a side with no level falls
   * back to the level of the page the game is filed under.
   */
  const page: AgeGroup = {
    id: "ag_16u_2029",
    name: "16U 2029",
    ageLevel: 16,
    year: 2029,
    seasonIds: [],
  };

  const poolWith = (opponentName: string): GcImportState => ({
    ageGroups: [page],
    teams: [
      { id: "own", name: "Elite 2029" },
      // Known only from somebody else's schedule: no id of its own, so no pull will ever reach it.
      { id: "opp", name: opponentName, nameOnly: true },
    ],
    games: [
      {
        id: "g1",
        ageGroupId: page.id,
        teamAId: "own",
        teamBId: "opp",
        teamAScore: 5,
        teamBScore: 1,
        date: "2028-09-12",
        ageLevelA: 16,
      },
    ],
  });

  it("works out a level a name said all along", () => {
    // The page is 16U in squad year 2029, so the class of 2033 are four years behind the seniors:
    // 14U against 16U, and two years the rating never saw.
    const tidy = tidyPool(poolWith("Nationals 2033"));
    expect(tidy.releveled).toBe(1);
    expect(tidy.state.games[0]?.ageLevelB).toBe(14);
  });

  it("says nothing when the class works out to the page it is filed on", () => {
    // The class of 2031 are 16U in squad year 2029, which is what the page already says.
    const tidy = tidyPool(poolWith("Nationals 2031"));
    expect(tidy.releveled).toBe(0);
    expect(tidy.state.games[0]?.ageLevelB).toBeUndefined();
  });

  it("says nothing when the name agrees with the page it is filed on", () => {
    // Recording a level equal to the page's changes no answer, and writing it anyway would rewrite
    // every row in the pool to say nothing new.
    const tidy = tidyPool(poolWith("Nationals 16U"));
    expect(tidy.releveled).toBe(0);
    expect(tidy.state.games[0]?.ageLevelB).toBeUndefined();
  });

  it("never overwrites a level a pull recorded", () => {
    const pool = poolWith("Nationals 2033");
    const first = pool.games[0]!;
    const withLevel: GcImportState = {
      ...pool,
      games: [{ ...first, ageLevelB: 15 }],
    };
    // What a pull recorded is what GameChanger said; this is a reading of a name.
    const tidy = tidyPool(withLevel);
    expect(tidy.state.games[0]?.ageLevelB).toBe(15);
  });

  it("leaves a stand-in alone, because a slot names nobody", () => {
    const pool = poolWith("TBD- 3:00 PM");
    const stand: GcImportState = {
      ...pool,
      teams: [pool.teams[0]!, { id: "opp", name: "TBD- 3:00 PM", placeholder: true as const }],
    };
    expect(tidyPool(stand).releveled).toBe(0);
  });

  it("says what it did", () => {
    expect(describeTidy(tidyPool(poolWith("Nationals 2033")))).toContain(
      "1 age level worked out from a name that said one all along."
    );
  });
});

describe("applying several folds at once", () => {
  /**
   * Three clubs, each pulled twice under two GameChanger ids, each pair proved one squad by a game
   * both ids filed. Three folds in one pass, which is what the batched version exists for.
   */
  const messy = () => {
    const fall = { season: "fall" as const, year: 2026 };
    const spring = { season: "spring" as const, year: 2027 };
    const sched = (
      id: string,
      name: string,
      opponent: string,
      season: { season: "fall" | "spring"; year: number }
    ): GcTeamSchedule => ({
      profile: { id, name, ageLevel: 11, season },
      games: [
        {
          id: `${id}-1`,
          date: "2026-09-11",
          opponentName: opponent,
          status: "completed" as const,
          teamScore: 8,
          opponentScore: 2,
        },
      ],
      fetchedAt: "2026-09-14T12:00:00.000Z",
    });

    let pool = empty;
    ["Yeager Davis 11U", "Canes Triad 11U", "Dirtbags 11U"].forEach((name, at) => {
      const tag = String(at).padStart(2, "0");
      pool = importGcSchedule(
        sched(`gcFALL0000${tag}`, name, `Raptors ${at} 11U`, fall),
        pool
      ).state;
      pool = importGcSchedule(
        sched(`gcSPRG0000${tag}`, name, `Raptors ${at} 11U`, spring),
        pool
      ).state;
    });
    return pool;
  };

  /** The old way: one whole walk of the pool per fold. */
  const oneAtATime = (pool: GcImportState, folds: [string, string][]): GcImportState => {
    let teams = pool.teams;
    let games = pool.games;
    folds.forEach(([fromId, intoId]) => {
      const result = mergeScoutTeams(fromId, intoId, teams, games, pool.ageGroups);
      teams = result.teams;
      games = result.games;
    });
    return { ...pool, teams, games };
  };

  it("leaves the same pool as merging them one at a time", () => {
    const pool = messy();
    const settled = mergeSameSquadIds(pool);
    expect(settled.merged).toBe(3);

    /*
     * The same three folds applied the old way. The merges are independent — a team folded away is
     * never also a target — so there is no order in which they have to be applied, and the two
     * paths have to agree on every team, every link and every game.
     */
    const survivors = new Set(settled.state.teams.map((team) => team.id));
    const folds = pool.teams
      .filter((team) => team.gcTeams?.length && !survivors.has(team.id))
      .map((gone): [string, string] => {
        const into = settled.state.teams.find((team) =>
          (team.gcTeams ?? []).some((link) =>
            (gone.gcTeams ?? []).some((mine) => mine.teamId === link.teamId)
          )
        );
        return [gone.id, into!.id];
      });
    const sequential = oneAtATime(pool, folds);

    const shape = (state: GcImportState) => ({
      teams: state.teams
        .map(
          (team) =>
            `${team.name}|${(team.gcTeams ?? [])
              .map((l) => l.teamId)
              .sort()
              .join(",")}`
        )
        .sort(),
      games: state.games.map((game) => [game.teamAId, game.teamBId, game.date].join("|")).sort(),
    });
    expect(shape(settled.state)).toEqual(shape(sequential));
  });

  it("keeps both GameChanger ids on every survivor, and one copy of each game", () => {
    const settled = mergeSameSquadIds(messy());
    const clubs = settled.state.teams.filter((team) => team.gcTeams?.length);
    expect(clubs).toHaveLength(3);
    clubs.forEach((club) => expect(club.gcTeams).toHaveLength(2));
    // Three clubs, one 8-2 apiece — not the six rows the two ids filed between them.
    expect(settled.state.games).toHaveLength(3);
  });

  it("drops a game both sides of which turned out to be the same club", () => {
    // Two ids of one squad listed each other: after the fold it is a club playing itself.
    const pool = messy();
    const [a, b] = pool.teams.filter((team) => team.gcTeams?.length);
    const withSelf: GcImportState = {
      ...pool,
      games: [
        ...pool.games,
        {
          id: "self",
          ageGroupId: pool.games[0]!.ageGroupId,
          teamAId: a!.id,
          teamBId: b!.id,
          teamAScore: 3,
          teamBScore: 3,
          date: "2026-10-01",
        },
      ],
    };
    const settled = mergeSameSquadIds(withSelf);
    expect(settled.state.games.some((game) => game.id === "self")).toBe(false);
  });
});

describe("teams that are not playing baseball", () => {
  /*
   * Wiffle ball is a different game — a plastic ball, a plastic bat, and scores that say nothing
   * about how a baseball team would fare. Nine were in a 48,035-team export, filed under ordinary
   * age groups in five states, and nothing in the GameChanger record marks them apart. The name is
   * the only signal there is.
   */
  const wiffle = (name: string) =>
    schedule({ id: "gcWIFFLE0000", name, ageLevel: 12 }, [game({ id: "w1" })]);

  it("recognises both spellings, and the compound", () => {
    // Eight of the nine in the export spell it "Wiffle"; one spells it "Whiffle".
    expect(isNotBaseball("Wiffle Ball 12U")).toBe(true);
    expect(isNotBaseball("Philly Whiffleball Bros 11U")).toBe(true);
    expect(isNotBaseball("Premium Elite Wiffleball 11U")).toBe(true);
    expect(isNotBaseball("Elite Power Select Wiffle 13u")).toBe(true);
  });

  it("leaves baseball names alone", () => {
    expect(isNotBaseball("Lexington Legends 9U")).toBe(false);
    expect(isNotBaseball("Whitfield Warriors 12U")).toBe(false);
    expect(isNotBaseball("")).toBe(false);
    expect(isNotBaseball(undefined)).toBe(false);
  });

  it("reads blitzball the same way, run together or ending at the ball", () => {
    // Names off the desktop crawl's export of 24 September 2026, which carried 93 of them.
    expect(isNotBaseball("Blitzball Dingers 12U")).toBe(true);
    expect(isNotBaseball("Gw23blitzball")).toBe(true);
    expect(isNotBaseball("Pottstown Scout Team Blitz Ball 11U")).toBe(true);
    expect(isNotBaseball("Blake's Blitzballers")).toBe(true);
  });

  it("leaves a baseball club called Blitz alone, and a pun on one", () => {
    // The same export held 46 clubs simply called Blitz. Written apart, "Blitz Ballers" is as
    // likely a baseball team's pun as the game, and refusing a real club leaves no trace.
    expect(isNotBaseball("Mid Ohio Blitz 13U")).toBe(false);
    expect(isNotBaseball("Blitz Baseball 11U")).toBe(false);
    expect(isNotBaseball("Zach's Blitz Ballers")).toBe(false);
  });

  it("refuses the schedule, and says why in a word", () => {
    const { state, outcome } = importGcSchedule(wiffle("Wiffle Ball 12U"), empty);
    expect(outcome.skip).toBe("not-baseball");
    // The pool is handed back exactly as it came in: no team, no page, no games.
    expect(state).toBe(empty);
  });

  it("refuses one whose age group is perfectly good", () => {
    // Which is the whole problem: filed under 12U, it looks like any other 12U club.
    const { outcome } = importGcSchedule(wiffle("S.M Oaks Wiffle Ball 10U-C"), empty);
    expect(outcome.skip).toBe("not-baseball");
  });

  it("drops a game against one, rather than minting a team for it", () => {
    /*
     * The one route by which a wiffle team could arrive without ever being pulled. Keeping the row
     * would hand the club that played it a result against nobody, on both sides of the ledger.
     */
    const { state, outcome } = importGcSchedule(
      schedule({}, [
        game({ id: "real", opponentName: "NKY Sluggers 9U" }),
        game({ id: "plastic", opponentName: "Wiffle Ball Gladatera 12U" }),
      ]),
      empty
    );
    expect(outcome.gamesAdded).toBe(1);
    expect(state.games).toHaveLength(1);
    expect(state.teams.some((team) => isNotBaseball(team.name))).toBe(false);
  });

  it("deletes one already in the pool, and its results with it", () => {
    /*
     * "Leave it out from now on" and "it is not in the pool" are different things. One pulled
     * before the rule existed sits in the 12U table beside clubs it has nothing to do with.
     */
    const page: AgeGroup = {
      id: "ag_12u_2027",
      name: "12U 2027",
      ageLevel: 12,
      year: 2027,
      seasonIds: [],
    };
    const pool: GcImportState = {
      ageGroups: [page],
      teams: [
        { id: "real", name: "Lexington Legends 12U" },
        { id: "plastic", name: "Wiffle Ball 12U" },
        { id: "other", name: "NKY Sluggers 12U" },
      ],
      games: [
        {
          id: "g1",
          ageGroupId: page.id,
          teamAId: "real",
          teamBId: "plastic",
          teamAScore: 9,
          teamBScore: 1,
          date: "2026-09-12",
        },
        {
          id: "g2",
          ageGroupId: page.id,
          teamAId: "real",
          teamBId: "other",
          teamAScore: 4,
          teamBScore: 3,
          date: "2026-09-13",
        },
      ],
    };

    const tidy = tidyPool(pool);
    expect(tidy.notBaseball).toBe(1);
    expect(tidy.state.teams.map((team) => team.id).sort()).toEqual(["other", "real"]);
    // The 9-1 goes with it: a result against a wiffle team is not a baseball result on either side.
    expect(tidy.state.games.map((game) => game.id)).toEqual(["g2"]);
  });

  it("says what it deleted", () => {
    const page: AgeGroup = { id: "ag", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] };
    const tidy = tidyPool({
      ageGroups: [page],
      teams: [{ id: "plastic", name: "J&J Wiffle Ball club 13U" }],
      games: [],
    });
    expect(describeTidy(tidy)).toContain(
      "1 wiffle ball or blitzball team deleted, and their results with them."
    );
  });

  it("keeps them out of a pasted list, so no request is spent on one", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        "Lexington Legends 12U,gcAAAAAAAAAA,12U",
        "Wiffle Ball 12U,gcBBBBBBBBBB,12U",
      ].join("\n")
    );
    expect(list.entries).toHaveLength(2);
    expect(list.entries.find((entry) => entry.teamId === "gcBBBBBBBBBB")?.notBaseball).toBe(true);
    expect(
      list.entries.find((entry) => entry.teamId === "gcAAAAAAAAAA")?.notBaseball
    ).toBeUndefined();
  });
});

describe("high school squads", () => {
  /*
   * A school squad plays other school squads, so its results join nothing this pool ranks: the
   * fit would see a cluster tied to the rest by almost nothing, and a rating across it is
   * relative to itself and to nothing else. So the whole category is refused rather than filed
   * at 18U, on the same three terms wiffle ball is — out of a pasted list before a request is
   * spent, out of an import, and out of a pool it reached before the rule existed.
   */
  const varsity = (name: string, over: Record<string, unknown> = {}) =>
    schedule({ id: "gcSCHOOL0000", name, ...over }, [game({ id: "h1" })]);

  it("reads the three ways a name says it", () => {
    expect(isSchoolName("Lincoln HS Varsity")).toBe(true);
    expect(isSchoolName("Oak Grove JV")).toBe(true);
    expect(isSchoolName("Eastview Junior Varsity Baseball")).toBe(true);
    expect(isSchoolName("Northside High School")).toBe(true);
    expect(isSchoolName("Centerville HS")).toBe(true);
    // "JV/V" is a programme listing both squads; the JV is what says the lone V is varsity.
    expect(isSchoolName("Madison JV/V")).toBe(true);
  });

  it("leaves a club name alone", () => {
    expect(isSchoolName("Lexington Legends 9U")).toBe(false);
    expect(isSchoolName("")).toBe(false);
    expect(isSchoolName(undefined)).toBe(false);
    // The letters have to be their own word. An abbreviation ending in them is not a school.
    expect(isSchoolName("CHS Cardinals 12U")).toBe(false);
    expect(isSchoolName("Jvillle Bandits 11U")).toBe(false);
  });

  it("leaves a school's summer squad alone, because the age label says it plays travel ball", () => {
    /*
     * This is the one deliberate hole in the rule. "Lincoln HS 16U" is a summer side playing an
     * age bracket against travel clubs, which is connected to the pool and belongs in it. A
     * stated age is the thing that says so — and a squad word overrides it, because a side
     * calling itself varsity is playing the school season whatever else it writes.
     */
    expect(isSchoolName("Lincoln HS 16U")).toBe(false);
    expect(isSchoolName("Lincoln High School 14u Gold")).toBe(false);
    expect(isSchoolName("Lincoln HS Varsity 16U")).toBe(true);
  });

  it("will not call a young travel club a school side, whatever word it likes", () => {
    /*
     * A freshman is fourteen at the youngest, so a name stating an age below that cannot mean
     * high school however it is branded — and "Varsity" and "JV" are both used as travel-club
     * branding. Without this the rule deleted them, and a wrongly refused club leaves nothing
     * behind to notice it by: no row, no count against its name, nothing.
     */
    expect(isSchoolName("Varsity Elite 12U")).toBe(false);
    expect(isSchoolName("JV Sluggers 10U")).toBe(false);
    expect(isSchoolName("Varsity Baseball Academy 9u")).toBe(false);
    // At fourteen and up the word is taken at its word again.
    expect(isSchoolName("Varsity Elite 15U")).toBe(true);
    expect(isSchoolName("Lincoln HS Varsity 16U")).toBe(true);
  });

  it("reads it in GameChanger's own age field, whole and not loose", () => {
    expect(isSchoolAgeLabel("Varsity")).toBe(true);
    expect(isSchoolAgeLabel("JV")).toBe(true);
    expect(isSchoolAgeLabel(" Junior Varsity ")).toBe(true);
    expect(isSchoolAgeLabel("JV/V")).toBe(true);
    expect(isSchoolAgeLabel("High School")).toBe(true);
    expect(isSchoolAgeLabel("12U")).toBe(false);
    expect(isSchoolAgeLabel("varsity tryouts monday")).toBe(false);
    expect(isSchoolAgeLabel(undefined)).toBe(false);
  });

  it("never turns a school squad into an age", () => {
    /*
     * The guard against the obvious wrong fix. Reading "Varsity" as 18U would file the cluster
     * into the 18U table, which is the outcome this whole rule exists to prevent.
     */
    expect(parseGcAgeLevel("Varsity")).toBeUndefined();
    expect(parseGcAgeLevel("JV")).toBeUndefined();
    expect(ageLevelFromName("Lincoln HS Varsity")).toBeUndefined();
  });

  it("refuses the schedule, and says why in a word", () => {
    const { state, outcome } = importGcSchedule(varsity("Lincoln HS Varsity"), empty);
    expect(outcome.skip).toBe("high-school");
    expect(state).toBe(empty);
  });

  it("refuses one whose age group is perfectly good", () => {
    // Which is the whole problem: filed under 18U it looks like any other 18U club.
    const { outcome } = importGcSchedule(varsity("Lincoln Varsity", { ageLevel: 18 }), empty);
    expect(outcome.skip).toBe("high-school");
  });

  /*
   * The other thing that field says. GameChanger files 3,303 of the 36,194 teams waiting on an
   * age as `Over 18`, `18O` or `college` — men's leagues, JUCO and university club sides. There
   * is no youth age to find on any of them, so asking weekly is two requests a week spent on a
   * question with no answer.
   */
  it("refuses a team GameChanger files as adult or college", () => {
    ["Over 18", "18O", "college"].forEach((label) => {
      const { state, outcome } = importGcSchedule(
        varsity("Long Island Angels 44", { ageLevel: undefined, ageLabel: label }),
        empty
      );
      expect({ label, skip: outcome.skip }).toEqual({ label, skip: "not-youth" });
      expect(state).toBe(empty);
    });
  });

  it("does not put an adult team on the list of teams nobody could age", () => {
    // Same reason as the school squads below: "not-youth" is terminal, "no-age" asks for ever.
    const { outcome } = importGcSchedule(
      varsity("The Red Sea Splitters", { ageLevel: undefined, ageLabel: "Over 18" }),
      empty
    );
    expect(outcome.skip).not.toBe("no-age");
  });

  it("refuses one only GameChanger's age field gives away", () => {
    // A club that writes "Varsity" in the age column very often leaves the name plain.
    const { outcome } = importGcSchedule(
      varsity("Lincoln Eagles", { ageLevel: undefined, ageLabel: "Varsity" }),
      empty
    );
    expect(outcome.skip).toBe("high-school");
  });

  it("does not put one on the list of teams nobody could age", () => {
    /*
     * The reason this matters: "high-school" is a terminal answer and "no-age" is a weekly
     * question. Getting it wrong would park thousands of school squads on a list that asks about
     * them for eight weeks and can never come good.
     */
    const { outcome } = importGcSchedule(
      varsity("Lincoln HS Varsity", { ageLevel: undefined }),
      empty
    );
    expect(outcome.skip).not.toBe("no-age");
  });

  it("drops a game against one, rather than minting a team for it", () => {
    /*
     * The one route by which a refused team could arrive without ever being pulled — and it would
     * arrive un-refusable, because nothing downstream re-reads an opponent's name. The result is
     * a real baseball result, unlike the wiffle case; it goes because the other half of it is a
     * club this pool refuses, and a game with one side missing is a dangling row, not a result.
     */
    const { state, outcome } = importGcSchedule(
      schedule({}, [
        game({ id: "real", opponentName: "NKY Sluggers 9U" }),
        game({ id: "school", opponentName: "Lincoln HS Varsity" }),
      ]),
      empty
    );
    expect(outcome.gamesAdded).toBe(1);
    expect(state.games).toHaveLength(1);
    expect(state.teams.some((team) => isSchoolName(team.name))).toBe(false);
  });

  it("deletes one already in the pool, and its results with it", () => {
    const page: AgeGroup = { id: "ag", name: "18U 2027", ageLevel: 18, year: 2027, seasonIds: [] };
    const tidy = tidyPool({
      ageGroups: [page],
      teams: [
        { id: "real", name: "Lexington Legends 18U" },
        { id: "school", name: "Lincoln HS Varsity" },
        { id: "other", name: "NKY Sluggers 18U" },
      ],
      games: [
        { id: "g1", ageGroupId: page.id, teamAId: "real", teamBId: "school", date: "2026-09-12" },
        { id: "g2", ageGroupId: page.id, teamAId: "real", teamBId: "other", date: "2026-09-13" },
      ],
    });
    expect(tidy.highSchool).toBe(1);
    expect(tidy.state.teams.map((team) => team.id).sort()).toEqual(["other", "real"]);
    expect(tidy.state.games.map((g) => g.id)).toEqual(["g2"]);
    expect(describeTidy(tidy)).toContain(
      "1 high school squad deleted, and their results with them."
    );
  });

  it("keeps them out of a pasted list, so no request is spent on one", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        "Lexington Legends 12U,gcAAAAAAAAAA,12U",
        "Lincoln HS Varsity,gcBBBBBBBBBB,",
        "Lincoln Eagles,gcCCCCCCCCCC,Varsity",
      ].join("\n")
    );
    expect(list.entries.find((e) => e.teamId === "gcBBBBBBBBBB")?.highSchool).toBe(true);
    // Caught by the age column alone, with nothing in the name to give it away.
    expect(list.entries.find((e) => e.teamId === "gcCCCCCCCCCC")?.highSchool).toBe(true);
    expect(list.entries.find((e) => e.teamId === "gcAAAAAAAAAA")?.highSchool).toBeUndefined();
  });
});

describe("one squad listed twice in one season", () => {
  /*
   * The Ambush case. Two GameChanger entries called "Ambush 9U", both Fall 2026, both 9U, both in
   * Prestonsburg KY — one with eight games on its own schedule and one with none at all, which
   * still shows a record because every club that played it listed the fixture from its side.
   *
   * Nothing here would offer them. The test for a pairing was that the two seasons were
   * consecutive, and these are the same season, so a club split across two entries in one season
   * was invisible however obvious it looked on the page.
   *
   * What makes it hard is the innocent explanation: a club running an A and a B squad at 9U gives
   * them the same name, in the same town, in the same state. Only two things tell that apart —
   * the coaches, and whether one of the two has a schedule of its own.
   */
  const staffed = (
    id: string,
    name: string,
    link: Partial<NonNullable<ScoutTeam["gcTeams"]>[number]> = {},
    place: Partial<ScoutTeam> = {}
  ): ScoutTeam => ({
    id,
    name,
    city: "Prestonsburg",
    state: "KY",
    ...place,
    gcTeams: [
      {
        teamId: `gc-${id}`,
        name,
        ageGroupId: "ag1",
        ageLevel: 9,
        season: "fall",
        seasonYear: 2026,
        /*
         * Two of the three coaches in common, as the real pair had. An empty id on its own is no
         * longer an offer: an A squad and a B squad at one age differ in their coaches and in
         * nothing else a schedule records, so the coaches are what has to say these are one
         * roster listed twice.
         */
        staff: ["Ali Castle", "Crystal Akers"],
        ...link,
      },
    ],
  });

  /** A game the named GameChanger id listed on its own schedule. */
  const listed = (by: string, id: string): ScoutGame => ({
    id,
    teamAId: "x",
    teamBId: "y",
    ageGroupId: "ag1",
    teamAScore: 2,
    teamBScore: 12,
    source: { kind: "gamechanger", teamId: by, gameId: id },
  });

  it("offers the entry with no schedule of its own, folded into the one that has one", () => {
    const pairings = proposeSeasonPairings(
      [staffed("shell", "Ambush 9U"), staffed("real", "Ambush 9U")],
      [listed("gc-real", "g1"), listed("gc-real", "g2")]
    );

    expect(pairings).toHaveLength(1);
    expect(pairings[0]).toMatchObject({
      fromTeamId: "shell",
      toTeamId: "real",
      kind: "same-season",
      sameName: true,
    });
    expect(pairings[0]?.evidence).toContain("no-schedule");
  });

  it("offers it once, not once in each direction", () => {
    /*
     * A season apart there is an earlier and a later and the pairing points one way by itself. In
     * one season there is no such order, so both directions qualify and the same pair would be
     * offered twice pointing opposite ways — and approving both folds each into the other.
     */
    const pairings = proposeSeasonPairings(
      [staffed("shell", "Ambush 9U"), staffed("real", "Ambush 9U")],
      [listed("gc-real", "g1")]
    );

    expect(pairings).toHaveLength(1);
  });

  it("offers nothing when both sides have a schedule of their own", () => {
    /*
     * Two real squads at one age in one town: an A team and a B team, and merging them is a club
     * losing half its history. Different coaches, which is the one thing that is true of an A and
     * a B squad and not of one roster listed twice — the next test is the same fixture with the
     * coaches shared, and it *is* offered.
     */
    const pairings = proposeSeasonPairings(
      [
        staffed("a", "Ambush 9U", { staff: ["Dana Hall", "Rory Estes"] }),
        staffed("b", "Ambush 9U", { staff: ["Marie Ochoa", "Glenn Tapp"] }),
      ],
      [listed("gc-a", "g1"), listed("gc-b", "g2")]
    );

    expect(pairings).toEqual([]);
  });

  it("offers two real squads anyway when the same coaches run both", () => {
    /*
     * Two coaches in common is the same town 89% of the time against 43% for one — see
     * `gcStaff.ts` — and at one age level in one season that is a roster somebody listed twice far
     * more often than a club fielding two identical squads. Strong enough to offer; never strong
     * enough to apply on its own.
     */
    const coaches = ["Dana Hall", "Rory Estes"];
    const pairings = proposeSeasonPairings(
      [
        staffed("a", "Ambush 9U", { staff: coaches }),
        staffed("b", "Ambush 9U", { staff: coaches }),
      ],
      [listed("gc-a", "g1"), listed("gc-b", "g2")]
    );

    expect(pairings).toHaveLength(1);
    expect(pairings[0]).toMatchObject({ kind: "same-season", confidence: "strong" });
    expect(pairings[0]?.evidence).toContain("staff");
  });

  it("will not take one shared coach for two", () => {
    // One name in common is as likely to be a club officer sitting on both cards as anything else.
    const pairings = proposeSeasonPairings(
      [
        staffed("a", "Ambush 9U", { staff: ["Dana Hall", "Rory Estes"] }),
        staffed("b", "Ambush 9U", { staff: ["Dana Hall", "Wes Pruitt"] }),
      ],
      [listed("gc-a", "g1"), listed("gc-b", "g2")]
    );

    expect(pairings).toEqual([]);
  });

  it("will not pair two towns, however empty one of the schedules is", () => {
    const pairings = proposeSeasonPairings(
      [staffed("shell", "Ambush 9U", {}, { city: "Pikeville" }), staffed("real", "Ambush 9U")],
      [listed("gc-real", "g1")]
    );

    expect(pairings).toEqual([]);
  });

  it("will not pair two ids GameChanger gave no season", () => {
    // Two unlabelled ids are not "the same season" — they are two questions nobody has answered,
    // and treating them as one would pair every such id in the pool with every other.
    const pairings = proposeSeasonPairings(
      [
        staffed("shell", "Ambush 9U", { season: undefined, seasonYear: undefined }),
        staffed("real", "Ambush 9U", { season: undefined, seasonYear: undefined }),
      ],
      [listed("gc-real", "g1")]
    );

    expect(pairings).toEqual([]);
  });

  it("is never applied without being asked, whatever it carries", () => {
    /*
     * A season apart, the same name in one town is one roster: a club does not run two squads a
     * season apart under one name at one age. Inside a season that is exactly what an A and a B
     * squad look like, so this one is always a question for the user.
     */
    const [pairing] = proposeSeasonPairings(
      [staffed("shell", "Ambush 9U"), staffed("real", "Ambush 9U")],
      [listed("gc-real", "g1")]
    );

    expect(pairing?.evidence).toEqual(expect.arrayContaining(["city", "state"]));
    expect(pairing && isSettledPairing(pairing)).toBe(false);
  });
});

describe("a bracket slot and the named game beside it on one schedule", () => {
  /*
   * Legacy Baseball Club, 22 August 2026. Its own schedule listed a pool game against the River
   * City Raptors it lost 7-15, and a "TBD- 08/22/26, 3:00 PM" it also lost 7-15 — the same game,
   * posted once as a bracket slot before the opponent was known and once after. The Raptors' own
   * schedule named both of the day's meetings, so both of its rows folded into Legacy's at import
   * and there was nothing left of a different source to answer the slot with.
   *
   * The slot stood as a fourth game. The club read 14-4 from 18 games when it was 14-3 from 17,
   * and the extra loss was against a stand-in that is nobody, so it counted for the Raptors on
   * neither side. Nothing here was a regression: `resolveSlotGames` has refused a naming row from
   * the slot's own schedule since it was written, on the grounds that a club listing a placeholder
   * and a named opponent the same day is playing two games.
   *
   * Which is true of a day, and not of an instant. One schedule listing both at the same start
   * time is not two games, because nobody plays two at once. The real doubleheader on the same
   * day — 13-10, two hours earlier — has to survive it untouched.
   */
  const AT_3PM = "2026-08-22T19:00:00Z";
  const AT_1PM = "2026-08-22T17:00:00Z";
  const RAPTORS = "River City Raptors 11U";

  const season = { season: "fall", year: 2026 } as const;

  /**
   * The day as both clubs posted it. The Raptors have to be pulled for their name on Legacy's
   * schedule to be a club rather than another stand-in — which is the whole starting position:
   * their rows fold into Legacy's at import, leaving the slot with nobody else to answer it.
   */
  const legacyDay = (
    slot: { startTs?: string; score?: [number, number] },
    /** Dropped from every row, for the pools that reach here with no clock on anything. */
    times = true
  ): GcImportState => {
    const importer = createGcImporter({ ageGroups: [], teams: [], games: [] });
    importer.add({
      profile: { id: "gcLegacy0001", name: "Legacy Fall Ball 11U", ageLevel: 11, season },
      games: [
        {
          id: "L-early",
          date: "2026-08-22",
          ...(times ? { startTs: AT_1PM } : {}),
          opponentName: RAPTORS,
          teamScore: 13,
          opponentScore: 10,
          status: "completed",
        },
        {
          id: "L-late",
          date: "2026-08-22",
          ...(times ? { startTs: AT_3PM } : {}),
          opponentName: RAPTORS,
          teamScore: 7,
          opponentScore: 15,
          status: "completed",
        },
        {
          id: "L-slot",
          date: "2026-08-22",
          ...(slot.startTs ? { startTs: slot.startTs } : {}),
          opponentName: "TBD- 08/22/26, 3:00 PM",
          ...(slot.score ? { teamScore: slot.score[0], opponentScore: slot.score[1] } : {}),
          status: slot.score ? "completed" : "scheduled",
        },
      ],
      fetchedAt: "2026-09-19T00:00:00.000Z",
    });
    importer.add({
      profile: { id: "gcRaptors001", name: RAPTORS, ageLevel: 11, season },
      games: [
        {
          id: "R-early",
          date: "2026-08-22",
          ...(times ? { startTs: AT_1PM } : {}),
          opponentName: "Legacy Fall Ball 11U",
          teamScore: 10,
          opponentScore: 13,
          status: "completed",
        },
        {
          id: "R-late",
          date: "2026-08-22",
          ...(times ? { startTs: AT_3PM } : {}),
          opponentName: "Legacy Fall Ball 11U",
          teamScore: 15,
          opponentScore: 7,
          status: "completed",
        },
      ],
      fetchedAt: "2026-09-19T00:00:00.000Z",
    });
    return importer.state;
  };

  /** What Legacy's day reads as, "us-them" from its seat, so a lost half of a pair shows up. */
  const legacyScores = (state: GcImportState) => {
    const legacy = state.teams.find((team) => team.gcTeams?.[0]?.teamId === "gcLegacy0001")!;
    return state.games
      .map((game) =>
        game.teamAId === legacy.id
          ? `${game.teamAScore}-${game.teamBScore}`
          : `${game.teamBScore}-${game.teamAScore}`
      )
      .sort();
  };

  it("starts with the slot standing as a game of its own", () => {
    // The position this is about: three rows for two meetings, and nothing of another source left.
    expect(legacyDay({ startTs: AT_3PM, score: [7, 15] }).games).toHaveLength(3);
  });

  it("folds the slot into the named game that starts at the same instant", () => {
    const { state, resolved } = resolveSlotGames(legacyDay({ startTs: AT_3PM, score: [7, 15] }));

    expect(resolved).toBe(1);
    // The doubleheader survives whole: two meetings, two different results.
    expect(legacyScores(state)).toEqual(["13-10", "7-15"]);
  });

  it("leaves a slot at a different time alone, because that is a third game", () => {
    /*
     * Three meetings in a day happens — pool play and then a bracket — and the slot can be the
     * only record of the third. Folding it away on a matching score would delete a real game.
     */
    const { state, resolved } = resolveSlotGames(legacyDay({ startTs: AT_1PM, score: [7, 15] }));

    expect(resolved).toBe(0);
    expect(state.games).toHaveLength(3);
  });

  it("leaves a slot with no time alone, however well the score matches", () => {
    // Without the clock there is nothing here that a doubleheader does not also look like.
    expect(resolveSlotGames(legacyDay({ score: [7, 15] })).resolved).toBe(0);
  });

  it("will not read two rows with no time at all as starting at the same one", () => {
    /*
     * Both absent is not both equal. A pool that reached here with no clock on anything — an older
     * export, a hand-typed season — would otherwise have every slot on a schedule answered by that
     * schedule's own named game of the day, which is the guess this whole function refuses to make
     * and the one that deleted 1,976 scored games the last time it was made.
     */
    expect(resolveSlotGames(legacyDay({ score: [7, 15] }, false)).resolved).toBe(0);
  });

  it("folds an unplayed slot that starts when a named game does", () => {
    // A bracket slot nobody went back to score, sitting on top of the game it became.
    const { state, resolved } = resolveSlotGames(legacyDay({ startTs: AT_3PM }));

    expect(resolved).toBe(1);
    expect(legacyScores(state)).toEqual(["13-10", "7-15"]);
  });

  it("will not let one named game answer two slots at its own start time", () => {
    /*
     * A schedule that posted the same bracket slot twice. The first takes the named row and the
     * second finds it spoken for, rather than both collapsing onto the one result.
     */
    const importer = createGcImporter(legacyDay({ startTs: AT_3PM, score: [7, 15] }));
    importer.add({
      profile: { id: "gcLegacy0001", name: "Legacy Fall Ball 11U", ageLevel: 11, season },
      games: [
        {
          id: "L-slot2",
          date: "2026-08-22",
          startTs: AT_3PM,
          opponentName: "TBD- 08/22/26, 3:00 PM (2)",
          teamScore: 7,
          opponentScore: 15,
          status: "completed",
        },
      ],
      fetchedAt: "2026-09-19T00:00:00.000Z",
    });

    expect(resolveSlotGames(importer.state).resolved).toBe(1);
  });
});

describe("watching a tidy run", () => {
  const watched = (): GcImportState => ({
    ageGroups: [{ id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }],
    teams: [
      { id: "W-HOME", name: "Home Club", state: "KY" },
      { id: "W-AWAY", name: "Away Club", state: "KY" },
      { id: "W-TBD", name: "TBD- 3:00 PM", placeholder: true },
    ],
    games: [
      {
        id: "w-named",
        ageGroupId: "ag_10u_2027",
        teamAId: "W-HOME",
        teamBId: "W-AWAY",
        teamAScore: 6,
        teamBScore: 2,
        date: "2026-09-12",
        source: { kind: "gamechanger", teamId: "gcW-HOME", gameId: "n1" },
      },
      {
        id: "w-slot",
        ageGroupId: "ag_10u_2027",
        teamAId: "W-AWAY",
        teamBId: "W-TBD",
        teamAScore: 2,
        teamBScore: 6,
        date: "2026-09-12",
        source: { kind: "gamechanger", teamId: "gcW-AWAY", gameId: "s1" },
      },
    ],
  });

  it("counts the same things the answer does", () => {
    /*
     * The watcher is what the progress view draws, and the summary underneath it is the answer.
     * Two numbers for one run that disagree is worse than no numbers at all.
     */
    const steps: TidyStep[] = [];
    const result = tidyPool(watched(), (step) => steps.push(step));

    // Only what a step reported on the way out: going in it has not run, so it has found nothing.
    const summed = (name: TidyStep["step"]) =>
      steps
        .filter((step) => step.step === name && step.done)
        .reduce((total, step) => total + step.found, 0);
    expect(summed("named")).toBe(result.named);
    expect(summed("collapsed")).toBe(result.collapsed);
    expect(summed("folded")).toBe(result.folded);
    expect(steps.filter((step) => step.step === "named" && step.done)).toHaveLength(result.passes);
    // And every step that started also finished, or the run stopped somewhere it should not have.
    expect(steps.filter((step) => !step.done)).toHaveLength(
      steps.filter((step) => step.done).length
    );
  });

  it("carries on when the watcher throws", () => {
    /*
     * Half an hour of work is not worth a progress bar. A watcher is a drawing concern and must
     * never be able to take the tidy down with it.
     */
    const good = tidyPool(watched());

    const result = tidyPool(watched(), () => {
      throw new Error("the view blew up");
    });

    expect(result.named).toBe(good.named);
    expect(result.passes).toBe(good.passes);
  });

  it("tidies the same pool whether anyone is watching or not", () => {
    const alone = tidyPool(watched());
    const watchedRun = tidyPool(watched(), () => {});

    expect(watchedRun.state.games.map((game) => game.id).sort()).toEqual(
      alone.state.games.map((game) => game.id).sort()
    );
    expect(watchedRun.passes).toBe(alone.passes);
  });
});

/**
 * Whether a tidy is worth saving.
 *
 * The panel used to answer this with a sum written out by hand, and the sum named eight of the
 * eleven counts. A pass whose only effect was deleting wiffle-ball or high school teams, or
 * resettling a game onto a club that plays near its level, therefore stamped the pool as tidied
 * and then did not save it: the deletions were lost, and the stamp said they had happened, so
 * nothing would redo them until `TIDY_RULES_VERSION` moved.
 */
describe("whether a tidy changed anything", () => {
  const nothing = {
    state: { ageGroups: [], teams: [], games: [] },
    named: 0,
    joined: 0,
    folded: 0,
    paired: 0,
    collapsed: 0,
    pruned: 0,
    reclaimed: 0,
    resettled: 0,
    refiled: 0,
    releveled: 0,
    notBaseball: 0,
    highSchool: 0,
    passes: 1,
  };

  it("is false for a pass that found nothing, however many passes it took", () => {
    expect(tidyChangedAnything(nothing)).toBe(false);
    expect(tidyChangedAnything({ ...nothing, passes: 6 })).toBe(false);
  });

  // The three the hand-written sum left out, each on its own.
  it("is true for the counts the old sum forgot", () => {
    expect(tidyChangedAnything({ ...nothing, notBaseball: 1 })).toBe(true);
    expect(tidyChangedAnything({ ...nothing, highSchool: 1 })).toBe(true);
    expect(tidyChangedAnything({ ...nothing, resettled: 1 })).toBe(true);
  });

  /*
   * And it cannot forget the next one either: the question is asked of `TIDY_STEPS`, which is the
   * list a new step has to be added to anyway for the progress display to name it.
   */
  it("asks every step there is", () => {
    TIDY_STEPS.forEach((step) => {
      expect(tidyChangedAnything({ ...nothing, [step]: 1 })).toBe(true);
    });
  });
});

/**
 * The age the pool already files a team's opponents at.
 *
 * This is the rung that reaches the backlog's worst population. `ageFromOpponentNames` reads an
 * age out of an opponent's *name*, so it can never settle a team in a closed league where nobody
 * writes an age in anything — "Team 4" playing "Team 2" and "Team 5". Measured over a real 36,194
 * row backlog, 10,709 rows are exactly that shape. This settles one the moment any of those
 * opponents has been filed by some other route.
 */
describe("an age from the company the pool already knows", () => {
  /** A closed league: four teams whose names say nothing, three of them already filed at 10U. */
  const filed = (): GcImportState => {
    let state = empty;
    ["Team 2", "Team 3", "Team 5"].forEach((name, i) => {
      const built = importGcSchedule(
        schedule({ id: `gcFILED0000${i}`, name, ageLevel: 10, avatarKey: `av-${i}` }, [
          game({ id: `f${i}`, opponentName: "Somebody 10U" }),
        ]),
        state
      );
      state = built.state;
    });
    return state;
  };

  const closedLeague = (avatars: string[]) =>
    schedule({ id: "gcTEAM400001", name: "Team 4", ageLevel: undefined }, [
      ...avatars.map((key, i) =>
        game({ id: `c${i}`, opponentName: `Team ${i + 2}`, opponentAvatarKey: key })
      ),
    ]);

  it("ages a team whose opponents the pool has all filed at one age", () => {
    const { outcome } = importGcSchedule(closedLeague(["av-0", "av-1", "av-2"]), filed());
    expect(outcome.skip).toBeUndefined();
    expect(outcome.ageGroupName).toContain("10U");
  });

  /*
   * The same bar the name rule is held to. This is circumstantial evidence about the company a
   * club keeps, and a squad that plays up all season is wrong in exactly the way three agreeing
   * opponents is meant to guard against.
   */
  it("will not act on fewer opponents than the name rule needs", () => {
    const { outcome } = importGcSchedule(closedLeague(["av-0", "av-1"]), filed());
    expect(outcome.skip).toBe("no-age");
  });

  /*
   * By identity, never by name. A pool holding tens of thousands of teams has a great many
   * "Team 4"s, and matching one by name would collect a stranger from the other side of the
   * country and file this club at their age.
   */
  it("says nothing about an opponent it cannot identify by picture", () => {
    const { outcome } = importGcSchedule(closedLeague([]), filed());
    expect(outcome.skip).toBe("no-age");
  });

  it("skips an opponent two clubs share a picture with", () => {
    let state = filed();
    // A second club on the same avatar: that picture now identifies nobody.
    state = importGcSchedule(
      schedule({ id: "gcTWIN000001", name: "Twin", ageLevel: 14, avatarKey: "av-0" }, [
        game({ id: "t1", opponentName: "Somebody 14U" }),
      ]),
      state
    ).state;
    const { outcome } = importGcSchedule(closedLeague(["av-0", "av-1", "av-2"]), state);
    // Two of the three still agree, but the bar is three, so nothing is claimed.
    expect(outcome.skip).toBe("no-age");
  });

  it("leaves a team that already has an age exactly where it was", () => {
    const own = schedule({ id: "gcOWN0000001", name: "Team 4", ageLevel: 12 }, [
      game({ id: "o1", opponentName: "Team 2", opponentAvatarKey: "av-0" }),
      game({ id: "o2", opponentName: "Team 3", opponentAvatarKey: "av-1" }),
      game({ id: "o3", opponentName: "Team 5", opponentAvatarKey: "av-2" }),
    ]);
    expect(importGcSchedule(own, filed()).outcome.ageGroupName).toContain("12U");
  });
});

describe("a pull asked for particular seasons", () => {
  /*
   * Seasons in this app's sense: the baseball year from August to July. Fall 2026 is the 2027
   * season, Summer 2026 the 2026 one — the squad a crawl across the calendar year hands over beside
   * this fall's, with a new GameChanger id and nothing else to say it is finished.
   */
  const lastSummer = { season: "summer", year: 2026 } as const;
  const thisSeasonOnly = { seasonYears: new Set([2027]) };

  it("files a team from a season it was asked for", () => {
    const { state, outcome } = importGcSchedule(schedule({}, [game()]), empty, thisSeasonOnly);
    expect(outcome.skip).toBeUndefined();
    expect(state.games).toHaveLength(1);
  });

  it("refuses one from any other, by GameChanger's own season, and files nothing", () => {
    const { state, outcome } = importGcSchedule(
      schedule({ season: lastSummer }, [game({ date: "2026-06-20" })]),
      empty,
      thisSeasonOnly
    );
    expect(outcome.skip).toBe("other-season");
    expect(outcome.issue).toBe(
      "Summer 2026 falls in the 2026 season, which this pull was not asked for, so its schedule was not read."
    );
    expect(state).toBe(empty);
  });

  it("refuses it before its age is asked, so it never joins the waiting list", () => {
    // Nothing anywhere says this team's age. Asked first, that is "no-age", and the waiting list
    // would ask about it every week for a season nobody wanted.
    const { outcome } = importGcSchedule(
      schedule({ name: "Hawks", ageLevel: undefined, season: lastSummer }, [
        game({ date: "2026-06-20", opponentName: "Eagles" }),
      ]),
      empty,
      thisSeasonOnly
    );
    expect(outcome.skip).toBe("other-season");
  });

  it("files every season when none is named, which is what the rota asks for", () => {
    const { state, outcome } = importGcSchedule(
      schedule({ season: lastSummer }, [game({ date: "2026-06-20" })]),
      empty
    );
    expect(outcome.skip).toBeUndefined();
    expect(state.games).toHaveLength(1);
  });

  it("counts them in a line of their own, not among the teams that could not be filed", () => {
    const filed = importGcSchedule(schedule({}, [game()]), empty, thisSeasonOnly).outcome;
    const refused = importGcSchedule(
      schedule({ season: lastSummer }),
      empty,
      thisSeasonOnly
    ).outcome;
    const lines = summarizeGcImport([filed, refused]);
    expect(lines[0]).toBe("1 schedule read.");
    expect(lines).toContain("1 team from a season this pull was not asked for left out.");
  });
});
