import { describe, expect, it } from "vitest";
import { importGcSchedules, resettleOffLevel, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { decodePoolTeams } from "../teamRankingsCompact";
import { isPlaceholderName } from "../teamRankings";
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

  it("leaves a level that disagrees by a year or two alone", () => {
    const before = misfiled();
    const near = {
      ...before,
      games: [{ ...before.games[0]!, ageGroupId: "ag9", ageLevelA: 11, ageLevelB: 11 }],
    };

    expect(resettleOffLevel(near).resettled).toBe(0);
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
