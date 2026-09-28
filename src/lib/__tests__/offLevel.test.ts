import { describe, expect, it } from "vitest";
import {
  importGcSchedules,
  refileStandIns,
  resettleOffLevel,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { decodePoolTeams } from "../teamRankingsCompact";
import { isPlaceholderName, namesNobody } from "../teamRankings";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

/**
 * The pair that put a 15U result on a 9U club, cut down to the two schedules it took.
 *
 * Both clubs are called "Lookouts Baseball Club" and both are in Union, Kentucky; one plays 9U and
 * the other 15U. A 15U schedule named the club as an opponent before either had been pulled, so
 * the mention became a stand-in filed at 15U. The 9U club was pulled next, and being the only
 * entry of that name it took the stand-in — and the 20-0 loss on it.
 */
const pandas15u: GcTeamSchedule = {
  profile: {
    id: "sd2CKtYsvOFh",
    name: "Trash Pandas 15U",
    ageLevel: 15,
    season: { season: "fall", year: 2026 },
    state: "KY",
    city: "Erlanger",
  },
  games: [
    {
      id: "g-15u",
      date: "2026-09-13",
      startTs: "2026-09-13T16:00:00.000Z",
      opponentName: "Lookouts Baseball Club",
      status: "completed",
      teamScore: 20,
      opponentScore: 0,
    },
  ],
  fetchedAt: "2026-09-14T12:00:00.000Z",
};

const lookouts9u: GcTeamSchedule = {
  profile: {
    id: "p8KJXdIzoYPR",
    name: "Lookouts Baseball Club 9U",
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state: "KY",
    city: "Union",
  },
  games: [
    {
      id: "g-9u",
      date: "2026-09-11",
      opponentName: "Eagles",
      status: "completed",
      teamScore: 6,
      opponentScore: 14,
    },
  ],
  fetchedAt: "2026-09-14T12:00:00.000Z",
};

const gamesOf = (state: GcImportState, gcId: string): ScoutGame[] => {
  const team = state.teams.find((row) => row.gcTeams?.some((link) => link.teamId === gcId));
  if (!team) throw new Error(`no team for ${gcId}`);
  return state.games.filter((game) => game.teamAId === team.id || game.teamBId === team.id);
};

describe("a club is not handed a stand-in from an age it does not play", () => {
  it("leaves the 9U Lookouts with its own two rows and not the 15U loss", () => {
    const { state } = importGcSchedules([pandas15u, lookouts9u], empty);

    expect(gamesOf(state, "p8KJXdIzoYPR").map((game) => game.date)).toEqual(["2026-09-11"]);
  });

  it("still adopts a stand-in the club really could have played, a level up", () => {
    // A 9U side in a 10U bracket is routine, and the mention is filed at the level of whoever
    // named it. Refusing that would mint a second team for every club that ever played up.
    const tenU: GcTeamSchedule = {
      ...pandas15u,
      profile: { ...pandas15u.profile, id: "gcTenUTenUte", name: "Trash Pandas 10U", ageLevel: 10 },
    };
    const { state } = importGcSchedules([tenU, lookouts9u], empty);

    expect(gamesOf(state, "p8KJXdIzoYPR").map((game) => game.date)).toEqual([
      "2026-09-13",
      "2026-09-11",
    ]);
  });
});

/** A pool as the old rules left one: the 15U row already resting on the 9U club. */
const misfiled = (): GcImportState => {
  const groups: AgeGroup[] = [
    { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
    { id: "ag15", name: "15U 2027", seasonIds: [], ageLevel: 15, year: 2027 },
  ];
  const teams: ScoutTeam[] = [
    {
      id: "S-PANDAS",
      name: "Trash Pandas",
      state: "KY",
      gcTeams: [
        { teamId: "sd2CKtYsvOFh", name: "Trash Pandas 15U", ageGroupId: "ag15", ageLevel: 15 },
      ],
    },
    {
      id: "S-LOOK9",
      name: "Lookouts Baseball Club",
      state: "KY",
      gcTeams: [
        {
          teamId: "p8KJXdIzoYPR",
          name: "Lookouts Baseball Club 9U",
          ageGroupId: "ag9",
          ageLevel: 9,
        },
      ],
    },
    {
      id: "S-LOOK15",
      name: "Lookouts Baseball Club",
      state: "KY",
      gcTeams: [
        {
          teamId: "bTL9fmm4EEgy",
          name: "Lookouts Baseball Club 15U",
          ageGroupId: "ag15",
          ageLevel: 15,
        },
      ],
    },
  ];
  const games: ScoutGame[] = [
    {
      id: "gc_sd2CKtYsvOFh_1",
      teamAId: "S-PANDAS",
      teamBId: "S-LOOK9",
      teamAScore: 20,
      teamBScore: 0,
      ageGroupId: "ag15",
      ageLevelA: 15,
      ageLevelB: 15,
      date: "2026-09-13",
      source: { kind: "gamechanger", teamId: "sd2CKtYsvOFh", gameId: "1" },
    },
  ];
  return { ageGroups: groups, teams, games };
};

describe("resettleOffLevel", () => {
  it("moves the row to the namesake that does play that age", () => {
    const { state, resettled } = resettleOffLevel(misfiled());

    expect(resettled).toBe(1);
    expect(state.games[0]?.teamBId).toBe("S-LOOK15");
  });

  it("gives it a stand-in when no namesake plays anywhere near it", () => {
    const before = misfiled();
    const only = { ...before, teams: before.teams.filter((team) => team.id !== "S-LOOK15") };

    const { state, resettled } = resettleOffLevel(only);

    expect(resettled).toBe(1);
    const moved = state.games[0]!;
    expect(moved.teamBId).not.toBe("S-LOOK9");
    const landed = state.teams.find((team) => team.id === moved.teamBId);
    // A club nobody can identify is a stand-in, which is kept out of the rankings rather than
    // ranked on somebody else's result.
    expect(landed?.nameOnly).toBe(true);
    expect(landed?.name).toBe("Lookouts Baseball Club");
  });

  describe("onto a stand-in of the name already here", () => {
    /**
     * The 15U row with no 15U Lookouts pulled, beside another 15U club's game against a stand-in
     * of the name: the Trash Pandas' neighbours in `state`, or further off.
     */
    const withStandIn = (state: string): GcImportState => {
      const before = misfiled();
      return {
        ...before,
        teams: [
          ...before.teams.filter((team) => team.id !== "S-LOOK15"),
          {
            id: "S-RIVALS",
            name: "Rivals",
            state,
            gcTeams: [
              { teamId: "gcRIVALS001", name: "Rivals 15U", ageGroupId: "ag15", ageLevel: 15 },
            ],
          },
          { id: "S-LOOKNAME", name: "Lookouts Baseball Club", nameOnly: true },
        ],
        games: [
          ...before.games,
          {
            id: "gc_gcRIVALS001_1",
            teamAId: "S-RIVALS",
            teamBId: "S-LOOKNAME",
            teamAScore: 4,
            teamBScore: 3,
            ageGroupId: "ag15",
            date: "2026-09-06",
            source: { kind: "gamechanger", teamId: "gcRIVALS001", gameId: "1" },
          },
        ],
      };
    };

    it("takes the one a club of the mover's state named, rather than making another", () => {
      const before = withStandIn("KY");
      const { state, resettled } = resettleOffLevel(before);
      expect(resettled).toBe(1);
      expect(state.games[0]?.teamBId).toBe("S-LOOKNAME");
      expect(state.teams).toHaveLength(before.teams.length);
    });

    it("makes one where the name's stand-in was named from another state", () => {
      const before = withStandIn("OH");
      const { state } = resettleOffLevel(before);
      const landed = state.teams.find((team) => team.id === state.games[0]?.teamBId);
      expect(landed?.id).not.toBe("S-LOOKNAME");
      expect(landed?.nameOnly).toBe(true);
      expect(state.teams).toHaveLength(before.teams.length + 1);
    });

    it("makes one per state for rows it moves from two, and one for two from the same", () => {
      const before = misfiled();
      const alone = { ...before, teams: before.teams.filter((team) => team.id !== "S-LOOK15") };
      const second = (clubState: string): GcImportState => ({
        ...alone,
        teams: [
          ...alone.teams,
          {
            id: "S-RIVALS",
            name: "Rivals",
            state: clubState,
            gcTeams: [
              { teamId: "gcRIVALS001", name: "Rivals 15U", ageGroupId: "ag15", ageLevel: 15 },
            ],
          },
        ],
        games: [
          ...alone.games,
          {
            ...alone.games[0]!,
            id: "gc_gcRIVALS001_1",
            teamAId: "S-RIVALS",
            date: "2026-09-20",
            source: { kind: "gamechanger", teamId: "gcRIVALS001", gameId: "1" },
          },
        ],
      });
      const apart = resettleOffLevel(second("OH")).state;
      expect(apart.games[0]?.teamBId).not.toBe(apart.games[1]?.teamBId);
      const together = resettleOffLevel(second("KY")).state;
      expect(together.games[0]?.teamBId).toBe(together.games[1]?.teamBId);
    });
  });

  it("never moves the side whose own schedule filed the row", () => {
    /*
     * The same disagreement, seen from the other side: the 9U club's own schedule carries the row,
     * filed at 15U. Its GameChanger listing says 9U and the row says 15U, and the row wins —
     * a club's own schedule is what it played, whatever its listing is called. Only the side
     * somebody else's schedule named by name is ever moved.
     */
    const before = misfiled();
    const own = {
      ...before,
      games: [
        {
          ...before.games[0]!,
          source: { kind: "gamechanger" as const, teamId: "p8KJXdIzoYPR", gameId: "1" },
        },
      ],
    };

    const { state, resettled } = resettleOffLevel(own);

    expect(resettled).toBe(0);
    expect(state.games[0]?.teamBId).toBe("S-LOOK9");
  });

  it("leaves a game the named club's own schedule gave a row too", () => {
    /*
     * The 9U club's own row of this game is folded into it, as a slot settled at one start or the
     * collapse leaves one: its own schedule lists the game, so it is its game, whatever level the
     * other schedule typed. Moved off, the 9U club's row went with it into a game the club was not
     * in, and the club's next pull filed that row a second time.
     */
    const before = misfiled();
    const record = { teamId: "p8KJXdIzoYPR", gameId: "9", ownScore: 0, opponentScore: 20 };
    const folded = {
      ...before,
      games: [
        {
          ...before.games[0]!,
          alsoFrom: ["p8KJXdIzoYPR"],
          alsoRows: [{ ...record, onSideB: true as const }],
        },
      ],
    };

    expect(resettleOffLevel(folded).resettled).toBe(0);
    // A row of the club's held only as a claim — filed against somebody else, and read as this game
    // by the clock — is not the club's word for it, and the game moves as it would without it.
    const claimed = {
      ...folded,
      games: [
        {
          ...folded.games[0]!,
          alsoRows: [{ ...record, onSideB: true as const, filedAgainst: "S-EAGL" }],
        },
      ],
    };
    const { state, resettled } = resettleOffLevel(claimed);
    expect(resettled).toBe(1);
    expect(state.games[0]?.teamBId).toBe("S-LOOK15");
  });

  it("keeps a stand-in with no game that a claimed row goes back to", () => {
    const before = misfiled();
    const sharks: ScoutTeam = { id: "S-SHARKS", name: "Sharks", nameOnly: true };
    const claimed = {
      ...before,
      teams: [...before.teams, sharks],
      games: [
        ...before.games,
        {
          id: "gc_gcOTHER_1",
          teamAId: "S-PANDAS",
          teamBId: "S-LOOK15",
          ageGroupId: "ag15",
          date: "2026-09-20",
          source: { kind: "gamechanger" as const, teamId: "sd2CKtYsvOFh", gameId: "2" },
          alsoFrom: ["gcELSE"],
          alsoRows: [{ teamId: "gcELSE", gameId: "e1", filedAgainst: sharks.id }],
        },
      ],
    };
    const { state, resettled } = resettleOffLevel(claimed);
    expect(resettled).toBe(1);
    expect(state.teams.some((team) => team.id === sharks.id)).toBe(true);
  });

  it("leaves a game nobody pulled alone", () => {
    const before = misfiled();
    const typed = { ...before, games: [{ ...before.games[0]!, source: undefined }] };

    expect(resettleOffLevel(typed).resettled).toBe(0);
  });

  it("leaves a level that disagrees by a year alone", () => {
    const before = misfiled();
    const near = {
      ...before,
      games: [{ ...before.games[0]!, ageGroupId: "ag9", ageLevelA: 10, ageLevelB: 10 }],
    };

    expect(resettleOffLevel(near).resettled).toBe(0);
  });
});

/*
 * Two levels off is inside `PLAYS_UP_TO`, and still somebody else's where the age was typed into
 * the name and nothing of the club's own says it plays there. Here an 11U club, the Rivals, typed
 * "Lookouts Baseball Club 11U", and the row sits on the 9U Lookouts.
 */
describe("a row typed two levels from every level a club plays", () => {
  const groups: AgeGroup[] = [
    { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
    { id: "ag11", name: "11U 2027", seasonIds: [], ageLevel: 11, year: 2027 },
  ];
  const rivals: ScoutTeam = {
    id: "S-RIVALS",
    name: "Rivals",
    state: "KY",
    gcTeams: [{ teamId: "gcRIVALS011", name: "Rivals 11U", ageGroupId: "ag11", ageLevel: 11 }],
  };
  const lookouts9: ScoutTeam = {
    id: "S-LOOK9",
    name: "Lookouts Baseball Club",
    state: "KY",
    gcTeams: [
      { teamId: "p8KJXdIzoYPR", name: "Lookouts Baseball Club 9U", ageGroupId: "ag9", ageLevel: 9 },
    ],
  };
  const lookouts11: ScoutTeam = {
    id: "S-LOOK11",
    name: "Lookouts Baseball Club",
    state: "KY",
    gcTeams: [
      {
        teamId: "gcLOOKOUT11",
        name: "Lookouts Baseball Club 11U",
        ageGroupId: "ag11",
        ageLevel: 11,
      },
    ],
  };
  const typedRow: ScoutGame = {
    id: "gc_gcRIVALS011_1",
    teamAId: "S-RIVALS",
    teamBId: "S-LOOK9",
    teamAScore: 7,
    teamBScore: 2,
    ageGroupId: "ag11",
    ageLevelA: 11,
    ageLevelB: 11,
    date: "2026-09-13",
    source: { kind: "gamechanger", teamId: "gcRIVALS011", gameId: "1" },
  };
  /** A row of a club's own schedule, on its own side A. */
  const own = (club: ScoutTeam, date: string, level: number): ScoutGame => ({
    id: `gc_${club.gcTeams![0]!.teamId}_${date}`,
    teamAId: club.id,
    teamBId: "S-RIVALS",
    teamAScore: 3,
    teamBScore: 3,
    ageGroupId: level === 9 ? "ag9" : "ag11",
    ageLevelA: level,
    date,
    source: { kind: "gamechanger", teamId: club.gcTeams![0]!.teamId, gameId: date },
  });
  const pool = (games: ScoutGame[], teams: ScoutTeam[] = [rivals, lookouts9]): GcImportState => ({
    ageGroups: groups,
    teams,
    games,
  });

  it("takes it off the club, onto a stand-in rather than the namesake at the typed age", () => {
    const before = pool([typedRow], [rivals, lookouts9, lookouts11]);
    const { state, resettled } = resettleOffLevel(before);
    expect(resettled).toBe(1);
    const landed = state.teams.find((team) => team.id === state.games[0]?.teamBId);
    expect(landed?.nameOnly).toBe(true);
    expect(landed?.name).toBe("Lookouts Baseball Club");
  });

  it("leaves it where the age was the page's, not typed", () => {
    const { ageLevelB: _typed, ...untyped } = typedRow;
    expect(resettleOffLevel(pool([untyped])).resettled).toBe(0);
  });

  it("leaves it where the club's own rows play within a level of it", () => {
    expect(resettleOffLevel(pool([typedRow, own(lookouts9, "2026-09-20", 10)])).resettled).toBe(0);
  });

  it("leaves it where the club's own schedule lists a game that day", () => {
    expect(resettleOffLevel(pool([typedRow, own(lookouts9, "2026-09-13", 9)])).resettled).toBe(0);
  });

  it("leaves a club no level is known of", () => {
    const unlisted: ScoutTeam = {
      ...lookouts9,
      gcTeams: [{ teamId: "p8KJXdIzoYPR", name: "Lookouts Baseball Club", ageGroupId: "agX" }],
    };
    expect(resettleOffLevel(pool([typedRow], [rivals, unlisted])).resettled).toBe(0);
  });

  /*
   * And the stand-in it goes to is not filed back onto the namesake at the typed age on the name
   * alone: the name is a club's at two levels in reach, and the 11U's own schedules list nothing
   * that day, so nothing says which squad it was.
   */
  describe("the stand-in it goes to", () => {
    const moved = (extra: ScoutGame[] = []) =>
      resettleOffLevel(pool([typedRow, ...extra], [rivals, lookouts9, lookouts11])).state;

    it("is not filed onto the namesake whose own schedules list nothing that day", () => {
      expect(refileStandIns(moved()).refiled).toBe(0);
    });

    it("is filed onto it where its own schedule lists a game that day", () => {
      const state = moved([own(lookouts11, "2026-09-13", 11)]);
      const out = refileStandIns(state);
      expect(out.refiled).toBe(1);
      expect(out.state.games.find((game) => game.id === typedRow.id)?.teamBId).toBe("S-LOOK11");
    });

    it("is filed onto the one club of the name as before, where no other level is in reach", () => {
      const state = moved();
      const alone = { ...state, teams: state.teams.filter((team) => team.id !== "S-LOOK9") };
      const out = refileStandIns(alone);
      expect(out.refiled).toBe(1);
      expect(out.state.games.find((game) => game.id === typedRow.id)?.teamBId).toBe("S-LOOK11");
    });
  });
});

describe("a weekend written in the opponent column is not a club", () => {
  it.each([
    "USSSA Cactus Classic",
    "Snead Tournament 10/17 - 10/18",
    "Arkansas Fall Shootout Championship",
    "Ephrata Fall Brawl Tourney",
  ])("reads %s as a slot", (name) => {
    expect(isPlaceholderName(name)).toBe(true);
  });

  it("still reads an ordinary club name as a club", () => {
    expect(isPlaceholderName("Lookouts Baseball Club")).toBe(false);
  });

  it("gives the mention to the club when one of that name was pulled by id", () => {
    // A club really can call its travel squad this, and 74 do in a nationwide pool.
    const bulldogs: GcTeamSchedule = {
      profile: {
        id: "gcBulldogsAA",
        name: "Miami Bulldogs Tournament 11U",
        ageLevel: 11,
        season: { season: "fall", year: 2026 },
        state: "FL",
      },
      games: [],
      fetchedAt: "2026-09-14T12:00:00.000Z",
    };
    const other: GcTeamSchedule = {
      profile: {
        id: "gcOtherClubB",
        name: "Miami Wolves 11U",
        ageLevel: 11,
        season: { season: "fall", year: 2026 },
        state: "FL",
      },
      games: [
        {
          id: "g-1",
          date: "2026-09-13",
          opponentName: "Miami Bulldogs Tournament",
          status: "completed",
          teamScore: 3,
          opponentScore: 4,
        },
      ],
      fetchedAt: "2026-09-14T12:00:00.000Z",
    };

    const { state } = importGcSchedules([bulldogs, other], empty);

    expect(gamesOf(state, "gcBulldogsAA").map((game) => game.date)).toEqual(["2026-09-13"]);
  });
});

describe("markPlaceholders", () => {
  it("takes the slot mark off a club that has since been pulled by id", () => {
    // "TBC" is Tampa Bay Cobras. A pool here held 39 real clubs marked as slots from before their
    // own schedule arrived, every one of them left out of the rankings with nothing to say why.
    const stored = [
      {
        id: "S-TBC",
        name: "TBC",
        placeholder: true,
        gcTeams: [{ teamId: "fVAIR0JBRCrN", name: "TBC 11U", ageGroupId: "ag11", ageLevel: 11 }],
      },
      { id: "S-TBD", name: "TBD", placeholder: true },
    ];

    const [cobras, slot] = decodePoolTeams(stored);

    expect(cobras?.placeholder).toBeUndefined();
    expect(slot?.placeholder).toBe(true);
  });
});

/*
 * A row filed by name onto a pulled club in a region its filer does not play in. A Tennessee rec
 * league's "Phillies" was filed onto the one Phillies pulled at that age, in Texas, before the
 * import asked anything more of a namesake in another state than its name.
 */
describe("a row filed by name onto a club regions away", () => {
  const groups: AgeGroup[] = [
    { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  ];
  const pulled = (id: string, name: string, state: string): ScoutTeam => ({
    id,
    name,
    state,
    gcTeams: [{ teamId: `gc${id}`, name: `${name} 10U`, ageGroupId: "ag10", ageLevel: 10 }],
  });
  const whiteSox = pulled("SOX", "White Sox", "TN");
  const phillies = pulled("PHILTX", "Phillies", "TX");
  /** A row of `clubId`'s own schedule against `against`. */
  const row = (clubId: string, against: string, date: string, extra: Partial<ScoutGame> = {}) => ({
    id: `gc_gc${clubId}_${date}`,
    teamAId: clubId,
    teamBId: against,
    teamAScore: 8,
    teamBScore: 1,
    ageGroupId: "ag10",
    date,
    source: { kind: "gamechanger" as const, teamId: `gc${clubId}`, gameId: date },
    ...extra,
  });
  const filed = row("SOX", "PHILTX", "2026-09-12");
  const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
    ageGroups: groups,
    teams: [whiteSox, phillies, ...teams],
    games: [filed, ...games],
  });
  const resettledIn = (teams: ScoutTeam[], games: ScoutGame[] = []) =>
    resettleOffLevel(pool(teams, games)).resettled;

  it("takes it off the club, onto a stand-in of the name", () => {
    const { state, resettled } = resettleOffLevel(pool([], []));
    expect(resettled).toBe(1);
    const landed = state.teams.find((team) => team.id === state.games[0]?.teamBId);
    expect(landed?.nameOnly).toBe(true);
    expect(landed?.name).toBe("Phillies");
  });

  it("and the tidy files it onto the one club of the name in its filer's state", () => {
    const home = pulled("PHILTN", "Phillies", "TN");
    const tidy = tidyPool(pool([home], []));
    expect(tidy.state.games.find((game) => game.id === filed.id)?.teamBId).toBe("PHILTN");
  });

  it("leaves it where the two met in a game both clubs' own schedules have a row in", () => {
    const met = row("PHILTX", "SOX", "2026-08-30", { alsoFrom: ["gcSOX"] });
    expect(resettledIn([], [met])).toBe(0);
    // A row only the named club's schedule holds may be its own misfile of the other, as this one
    // may be of it, and the two would vouch for each other. Neither does, and both go.
    expect(resettledIn([], [row("PHILTX", "SOX", "2026-08-30")])).toBe(2);
  });

  it("leaves it where each met one pulled club in a game both sides' schedules have", () => {
    // Arkansas borders both, and each club's own schedule played its Rangers, which listed both.
    const rangers = pulled("RANG", "Rangers", "AR");
    const listed = { alsoFrom: ["gcRANG"] };
    const both = [
      row("PHILTX", "RANG", "2026-08-29", listed),
      row("SOX", "RANG", "2026-08-30", listed),
    ];
    expect(resettledIn([rangers], both)).toBe(0);
    // Met by one of them only, or once only on its own word, it says nothing.
    expect(resettledIn([rangers], both.slice(0, 1))).toBe(1);
    expect(resettledIn([rangers], [both[0]!, row("SOX", "RANG", "2026-08-30")])).toBe(1);
  });

  it("leaves a game the named club's own schedule has a row in, claimed or not", () => {
    const held: ScoutGame = {
      ...filed,
      alsoRows: [{ teamId: "gcPHILTX", gameId: "x", filedAgainst: "S-SOXSTAND", onSideB: true }],
      alsoFrom: ["gcPHILTX"],
    };
    const state = { ...pool([], []), games: [held] };
    expect(resettleOffLevel(state).resettled).toBe(0);
  });

  it("leaves a club across a border, and one in a state the border map does not hold", () => {
    const next = { ...pool([], []), teams: [whiteSox, { ...phillies, state: "AR" }] };
    expect(resettleOffLevel(next).resettled).toBe(0);
    // Alberta's clubs play British Columbia's, and the map knows neither.
    const west = {
      ...pool([], []),
      teams: [
        { ...whiteSox, state: "AB" },
        { ...phillies, state: "BC" },
      ],
    };
    expect(resettleOffLevel(west).resettled).toBe(0);
  });

  it("leaves a name the import reads as a slot on the one pulled club that carries it", () => {
    const bulldogs = { ...phillies, name: "Miami Bulldogs Tournament" };
    expect(resettleOffLevel({ ...pool([], []), teams: [whiteSox, bulldogs] }).resettled).toBe(0);
  });
});

/*
 * GameChanger holds teams a coach made to hold a date — "Tbd", "Practice", "Scrimmage", "14U" —
 * and a nationwide pull fetches them like any other. A schedule writing "TBD" in the opponent
 * column then found exactly one pulled club of that name and filed the game on it: a Puerto Rico
 * club's and an Ohio club's undecided games sat on one Washington "Tbd", tying clubs that never
 * met into one graph. On the backup of 26 September 2026 at 18:40, 31 pulled clubs had such a
 * name, carrying 35 rows other clubs' schedules had filed on them.
 */
describe("a name that names nobody is never a pulled club", () => {
  it.each([
    "TBD",
    "Tbd",
    "tba",
    "T.B.D.",
    "TBD- 09/20/26, 10:00 AM",
    "Practice",
    "Scrimmage",
    "10u",
    "14U",
    "To be determined",
    "Winner of Game 3",
  ])("%s names nobody", (name) => {
    expect(namesNobody(name)).toBe(true);
  });

  it.each([
    // Real clubs, or names that could be: a word or an event in a longer name is not the whole of it.
    "Game 7 Sports- White",
    "TBA Rangers Jones",
    "TBD Baseball",
    "TBC",
    "Miami Bulldogs Tournament",
    "Tourney Contenders Coral Springs",
    "Practice Niehoff",
    "Lookouts Baseball Club",
  ])("%s may name somebody", (name) => {
    expect(namesNobody(name)).toBe(false);
  });

  const club = (id: string, name: string, state: string, games: GcTeamSchedule["games"] = []) => ({
    profile: {
      id,
      name,
      ageLevel: 11,
      season: { season: "fall" as const, year: 2026 },
      state,
    },
    games,
    fetchedAt: "2026-09-14T12:00:00.000Z",
  });

  it("files a TBD game on a slot, not on the one pulled club called Tbd", () => {
    const tbd = club("gcTbdWA", "Tbd", "WA");
    const potros = club("gcPotros", "Potros 11U", "PR", [
      {
        id: "g-1",
        date: "2026-09-19",
        opponentName: "TBD",
        status: "completed",
        teamScore: 2,
        opponentScore: 2,
      },
    ]);

    const { state } = importGcSchedules([tbd, potros], empty);

    expect(gamesOf(state, "gcTbdWA")).toEqual([]);
    const [game] = gamesOf(state, "gcPotros");
    const opponent = state.teams.find((team) => team.id === game?.teamBId);
    expect(opponent?.placeholder).toBe(true);
    expect(opponent?.gcTeams).toBeUndefined();
  });

  it("takes a row filed that way off the club in the tidy, onto a slot, and leaves its own", () => {
    const groups: AgeGroup[] = [
      { id: "ag11", name: "11U 2027", seasonIds: [], ageLevel: 11, year: 2027 },
    ];
    const practice: ScoutTeam = {
      id: "S-PRAC",
      name: "Practice",
      state: "TX",
      gcTeams: [{ teamId: "gcPRAC", name: "Practice", ageGroupId: "ag11", ageLevel: 11 }],
    };
    const bandits: ScoutTeam = {
      id: "S-BAND",
      name: "Long Island Bandits",
      state: "NY",
      gcTeams: [{ teamId: "gcBAND", name: "Long Island Bandits 11U", ageGroupId: "ag11" }],
    };
    const filedOn: ScoutGame = {
      id: "gc_gcBAND_x",
      ageGroupId: "ag11",
      teamAId: "S-BAND",
      teamBId: "S-PRAC",
      date: "2026-09-08",
      source: { kind: "gamechanger", teamId: "gcBAND", gameId: "x" },
    };
    const riders: ScoutTeam = {
      id: "S-RIDE",
      name: "Texas Riders",
      state: "TX",
      gcTeams: [{ teamId: "gcRIDE", name: "Texas Riders 11U", ageGroupId: "ag11" }],
    };
    const itsOwn: ScoutGame = {
      id: "gc_gcPRAC_y",
      ageGroupId: "ag11",
      teamAId: "S-PRAC",
      teamBId: "S-RIDE",
      teamAScore: 3,
      teamBScore: 1,
      date: "2026-09-10",
      source: { kind: "gamechanger", teamId: "gcPRAC", gameId: "y" },
    };

    const { state, resettled } = resettleOffLevel({
      ageGroups: groups,
      teams: [practice, bandits, riders],
      games: [filedOn, itsOwn],
    });

    expect(resettled).toBe(1);
    const moved = state.games.find((game) => game.id === filedOn.id)!;
    const slot = state.teams.find((team) => team.id === moved.teamBId);
    expect(slot?.placeholder).toBe(true);
    expect(slot?.name).toBe("Practice");
    expect(state.games.find((game) => game.id === itsOwn.id)?.teamAId).toBe("S-PRAC");
  });
});
