import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedule,
  importGcSchedules,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import {
  gcRowId,
  renameScoutTeam,
  scoreSeenBy,
  type FoldedRow,
  type ScoutGame,
} from "../teamRankings";

/*
 * #270 settled a club's row filed by name against a stand-in into the other club's copy of the
 * game with nothing to say where it was filed, and pools it tidied hold those folds still. The
 * row's next pull reads its name again and marks the fold as the claim it is (`filedMarkFor`), so
 * the claim step can give it back. Here the Aces' 7-3 at six against "Sharks", a name nobody
 * pulled, is held in the Bears' copy of a game against the Aces at half past six, as #270 left it.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const at = (clock: string, date = "2026-09-05") => `${date}T${clock}:00.000Z`;
const club = (
  id: string,
  name: string,
  games: GcTeamSchedule["games"],
  extra: Partial<GcTeamSchedule["profile"]> = {}
): GcTeamSchedule => ({
  profile: { id, name, ageLevel: 9, season: { season: "fall", year: 2026 }, state: "TX", ...extra },
  games,
  fetchedAt: "2026-09-06T00:00:00.000Z",
});
const row = (
  id: string,
  opponentName: string,
  clock: string,
  score?: [number, number],
  date = "2026-09-05"
): GcTeamSchedule["games"][number] => ({
  id,
  date,
  startTs: at(clock, date),
  opponentName,
  status: score ? "completed" : "scheduled",
  ...(score ? { teamScore: score[0], opponentScore: score[1] } : {}),
});
const pull = (state: GcImportState, ...schedules: GcTeamSchedule[]) =>
  schedules.reduce((pool, next) => importGcSchedule(next, pool).state, state);
const tidied = (state: GcImportState) => tidyPool(state).state;

const aces = (...games: GcTeamSchedule["games"]) =>
  club("gcA", "Aces 9U", games.length > 0 ? games : [row("a1", "Sharks", "18:00", [7, 3])]);
const bears = (...games: GcTeamSchedule["games"]) =>
  club("gcB", "Bears 9U", [
    ...(games.length > 0 ? games : [row("b1", "Aces 9U", "18:30")]),
    row("b9", "Cubs 9U", "12:00", [5, 5], "2026-09-12"),
  ]);

const idOf = (state: GcImportState, name: string) =>
  state.teams.find((team) => team.name === name)!.id;
const recordOf = (state: GcImportState, rowId = gcRowId("gcA", "a1")): FoldedRow | undefined =>
  state.games
    .flatMap((game) => game.alsoRows ?? [])
    .find((record) => gcRowId(record.teamId, record.gameId) === rowId);
/** A club's page: its own score first, who it played, and when. */
const page = (state: GcImportState, gcId: string) => {
  const self = state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId))!;
  return state.games
    .filter((game) => game.teamAId === self.id || game.teamBId === self.id)
    .map((game) => {
      const seen = scoreSeenBy(game, self.id);
      const otherId = game.teamAId === self.id ? game.teamBId : game.teamAId;
      const other = state.teams.find((team) => team.id === otherId)!;
      const score = seen ? `${seen.own}-${seen.opponent}` : "unplayed";
      return `${score} v ${other.name} at ${game.startTs?.slice(11, 16)}`;
    })
    .sort();
};

/** The claim a tidy makes of the pulls, taken back to the bare fold #270 made. */
const unmarked = (claimed: GcImportState, keepStandIn: boolean): GcImportState => {
  const sharks = claimed.teams.find((team) => team.name === "Sharks");
  const games: ScoutGame[] = claimed.games.map((game) =>
    game.alsoRows
      ? {
          ...game,
          alsoRows: game.alsoRows.map(
            ({ filedAgainst: _against, filedLevel: _level, ...record }) => record
          ),
        }
      : game
  );
  return {
    ...claimed,
    games,
    teams: keepStandIn ? claimed.teams : claimed.teams.filter((team) => team !== sharks),
  };
};

/**
 * The Cubs' game against "Sharks" a fortnight on, so the stand-in stands on a game of its own and
 * the name finds it again, as it does in a pool where other clubs have played the name.
 */
const cubs = club("gcC", "Cubs 9U", [row("c1", "Sharks", "09:00", [4, 1], "2026-09-19")]);

/**
 * The pulls, tidied, then made bare as #270 left its folds: `aceRows` and `bearRows` as listed.
 * With the Cubs' game, or, as a #270 pool mostly has it, with the stand-in gone.
 */
const folded = (
  aceRows: GcTeamSchedule["games"] = [],
  bearRows: GcTeamSchedule["games"] = [],
  standIn = true
) => {
  const claimed = tidied(
    pull(empty, aces(...aceRows), bears(...bearRows), ...(standIn ? [cubs] : []))
  );
  expect(recordOf(claimed)).toBeDefined();
  return { claimed, bare: unmarked(claimed, standIn) };
};

describe("a row #270 folded with no mark, read again on its schedule's next pull", () => {
  it("is marked with the team its name gives, as the claim step would have made it", () => {
    const { claimed, bare } = folded();
    expect(recordOf(claimed)?.filedAgainst).toBe(idOf(claimed, "Sharks"));
    expect(recordOf(bare)?.filedAgainst).toBeUndefined();
    const noted = pull(bare, aces());
    expect(recordOf(noted)).toEqual(recordOf(claimed));
    expect(noted.teams).toHaveLength(bare.teams.length);
    const state = tidied(noted);
    expect(state.games).toEqual(claimed.games);
    expect(page(state, "gcA")).toEqual(["7-3 v Bears at 18:30"]);
  });

  it("makes a stand-in for the name where the one it had is gone, once", () => {
    const { bare } = folded([], [], false);
    expect(bare.teams.some((team) => team.name === "Sharks")).toBe(false);
    const { state: noted, outcome } = importGcSchedule(aces(), bare);
    // The pull says it made a team.
    expect(outcome.opponentsCreated).toBe(1);
    const sharks = noted.teams.find((team) => team.name === "Sharks")!;
    expect(sharks.nameOnly).toBe(true);
    expect(recordOf(noted)?.filedAgainst).toBe(sharks.id);
    expect(noted.teams).toHaveLength(bare.teams.length + 1);
    const again = pull(tidied(noted), aces());
    expect(again.teams.filter((team) => team.name === "Sharks")).toHaveLength(1);
    expect(recordOf(again)?.filedAgainst).toBe(sharks.id);
    expect(tidyChangedAnything(tidyPool(again))).toBe(false);
  });

  it("makes one stand-in for two rows of one name in one pull", () => {
    const doubleheader = [
      row("a1", "Sharks", "18:00", [7, 3]),
      row("a3", "Sharks", "20:30", [2, 4]),
    ];
    const { bare } = folded(
      doubleheader,
      [row("b1", "Aces 9U", "18:30"), row("b3", "Aces 9U", "21:00")],
      false
    );
    const noted = pull(bare, aces(...doubleheader));
    const sharks = noted.teams.filter((team) => team.name === "Sharks");
    expect(sharks).toHaveLength(1);
    expect(recordOf(noted)?.filedAgainst).toBe(sharks[0]!.id);
    expect(recordOf(noted, gcRowId("gcA", "a3"))?.filedAgainst).toBe(sharks[0]!.id);
  });

  it("makes a stand-in the Texans' name, not one an Ohio club's row reads as its opponent", () => {
    const { bare } = folded([], [], false);
    const ohio = club("gcO", "Buckeyes 9U", [row("o1", "Sharks", "10:00", [3, 3], "2026-09-19")], {
      state: "OH",
    });
    const state = importGcSchedules([aces(), ohio], bare).state;
    expect(state.teams.filter((team) => team.name === "Sharks")).toHaveLength(2);
    expect(recordOf(state)?.filedAgainst).not.toBe(
      state.games.find((game) => game.id === gcRowId("gcO", "o1"))!.teamBId
    );
  });

  it("gives the row back once marked, when the other club's copy goes", () => {
    const { bare } = folded([], [], false);
    const noted = tidied(pull(bare, aces()));
    const state = tidied(pull(noted, bears(row("b2", "Cubs 9U", "10:00", [2, 1], "2026-09-19"))));
    expect(page(state, "gcA")).toEqual(["7-3 v Sharks at 18:00"]);
    // Left with no mark, the fold went with the Bears' copy and the Aces' row came back against
    // the Bears, the club whose copy had held it.
    const kept = tidied(pull(bare, bears(row("b2", "Cubs 9U", "10:00", [2, 1], "2026-09-19"))));
    expect(page(kept, "gcA")).toEqual(["7-3 v Bears at 18:00"]);
  });

  /*
   * Rows naming one team on one day go to one club or none (`claimFiledRows`). The Aces typed
   * "Sharks" for both their games of the day, the Bears' copy at half past six and the Owls' at ten,
   * each at its copy's very start and a run apart, so the pull filed each against the club whose
   * copy it was. Marked against one "Sharks", both went back to it, each beside the copy it had
   * been in: two games, each counted twice.
   */
  it("marks no fold under a name the day's other rows are in another club's copy under", () => {
    const owls = club("gcO", "Owls 9U", [row("o1", "Aces 9U", "10:00", [5, 2])]);
    const twoGames = [row("a1", "Sharks", "18:30", [7, 3]), row("a3", "Sharks", "10:00", [2, 4])];
    const scored = (state: GcImportState) =>
      page(state, "gcA").filter((line) => !line.startsWith("unplayed"));
    const first = tidied(
      pull(empty, bears(row("b1", "Aces 9U", "18:30", [4, 7])), owls, aces(...twoGames))
    );
    expect(scored(first)).toEqual(["2-4 v Owls at 10:00", "7-3 v Bears at 18:30"]);
    const again = tidied(pull(first, aces(...twoGames)));
    expect(again.games).toEqual(first.games);
    expect(scored(again)).toEqual(["2-4 v Owls at 10:00", "7-3 v Bears at 18:30"]);
  });

  it("marks no fold beside a claim of the club's under the same name in another club's copy", () => {
    const { bare } = folded();
    const sharks = idOf(bare, "Sharks");
    const aceId = idOf(bare, "Aces");
    const group = bare.games.find((game) => game.alsoRows)!.ageGroupId;
    const owls = {
      id: "S-OWLS",
      name: "Owls",
      gcTeams: [{ teamId: "gcO", name: "Owls 9U", ageGroupId: group }],
    };
    const owlsCopy: ScoutGame = {
      id: gcRowId("gcO", "o1"),
      teamAId: "S-OWLS",
      teamBId: aceId,
      ageGroupId: group,
      date: "2026-09-05",
      startTs: at("10:00"),
      source: { kind: "gamechanger", teamId: "gcO", gameId: "o1" },
      alsoFrom: ["gcA"],
      alsoRows: [
        { teamId: "gcA", gameId: "a3", startTs: at("10:00"), onSideB: true, filedAgainst: sharks },
      ],
    };
    const state = pull(
      { ...bare, teams: [...bare.teams, owls], games: [...bare.games, owlsCopy] },
      aces(row("a1", "Sharks", "18:00", [7, 3]), row("a3", "Sharks", "10:00"))
    );
    expect(recordOf(state)?.filedAgainst).toBeUndefined();
  });

  /*
   * A fold the slot settle made, which the claim step claims where the rows come in the other
   * order, is marked the first time its club is pulled after it, and holds from then on. The
   * Giants list the Cubs twice that day, once with no start; the Cubs' unscored "Canes" row went
   * to the Giants' 2-9 at one.
   */
  it("marks a fold the slot settle made once, then holds", () => {
    const ohio = (id: string, name: string, level: number, games: GcTeamSchedule["games"]) =>
      club(id, name, games, { ageLevel: level, state: "OH" });
    const day = "2026-09-06";
    const cubsRow = ohio("gcCU", "Cubs 9U", 9, [row("cu3", "Canes 9U", "13:30", undefined, day)]);
    const acesRow = ohio("gcAC", "Aces 9U", 9, [row("ac3", "Canes 9U", "09:15", [12, 4], day)]);
    const giants = ohio("gcGI", "Giants 10U", 10, [
      { id: "gi1", date: day, opponentName: "Cubs 9U", status: "scheduled" },
      row("gi2", "Cubs 9U", "13:00", [2, 9], day),
    ]);
    const all = [cubsRow, acesRow, giants];
    const first = tidied(pull(empty, ...all));
    const cu3 = gcRowId("gcCU", "cu3");
    expect(recordOf(first, cu3)?.filedAgainst).toBeUndefined();
    const second = tidied(pull(first, ...all));
    expect(recordOf(second, cu3)?.filedAgainst).toBe(idOf(second, "Canes"));
    expect(second.games.length).toBe(first.games.length);
    expect(tidied(pull(second, ...all)).games).toEqual(second.games);
  });

  describe("leaves a fold its name, day, clock or company file against the other club", () => {
    /** The fold #270 made, re-pulled with the Aces' row as `aceRow`: its mark, if any. */
    const markAfter = (
      aceRow: GcTeamSchedule["games"][number],
      shape: (bare: GcImportState) => GcImportState = (bare) => bare,
      ...extra: GcTeamSchedule[]
    ) => {
      const { bare } = folded();
      return recordOf(pull(shape(bare), ...extra, aces(aceRow)))?.filedAgainst;
    };

    it("marks the fold these cases start from", () => {
      expect(markAfter(row("a1", "Sharks", "18:00", [7, 3]))).toBeDefined();
    });

    it("marks one at the very start whose score disagrees by a run, not reading the game", () => {
      expect(
        markAfter(
          row("a1", "Sharks", "18:30", [7, 3]),
          undefined,
          bears(row("b1", "Aces 9U", "18:30", [4, 7]))
        )
      ).toBeDefined();
    });

    it("a name that is the other club's own", () => {
      expect(markAfter(row("a1", "Bears 9U", "18:00", [7, 3]))).toBeUndefined();
    });

    it("a name its GameChanger listing gives the other club", () => {
      expect(
        markAfter(row("a1", "Old Town Bruins", "18:00", [7, 3]), (bare) => ({
          ...bare,
          teams: bare.teams.map((team) =>
            team.gcTeams?.some((link) => link.teamId === "gcB")
              ? {
                  ...team,
                  gcTeams: team.gcTeams.map((link) => ({ ...link, name: "Old Town Bruins 9U" })),
                }
              : team
          ),
        }))
      ).toBeUndefined();
    });

    // Shared with the Cubs, the picture is not one the name lookup reads as anybody's.
    it("the other club's picture", () => {
      expect(
        markAfter(
          { ...row("a1", "Sharks", "18:00", [7, 3]), opponentAvatarKey: "bear-face" },
          (bare) => ({
            ...bare,
            teams: bare.teams.map((team) =>
              team.gcTeams?.some((link) => link.teamId === "gcB" || link.teamId === "gcC")
                ? { ...team, avatarKey: "bear-face" }
                : team
            ),
          })
        )
      ).toBeUndefined();
    });

    it("a name the Aces' own rows already stand against the Bears under, as a hand merge leaves", () => {
      const merged = (bare: GcImportState): GcImportState => {
        const bearsId = idOf(bare, "Bears");
        const aceId = idOf(bare, "Aces");
        const group = bare.games[0]!.ageGroupId;
        const earlier: ScoutGame = {
          id: gcRowId("gcA", "a0"),
          teamAId: aceId,
          teamBId: bearsId,
          ageGroupId: group,
          date: "2026-08-29",
          startTs: at("10:00", "2026-08-29"),
          teamAScore: 1,
          teamBScore: 0,
          source: { kind: "gamechanger", teamId: "gcA", gameId: "a0" },
        };
        return { ...bare, games: [...bare.games, earlier] };
      };
      const { bare } = folded();
      const state = pull(
        merged(bare),
        aces(
          row("a1", "Sharks", "18:00", [7, 3]),
          row("a0", "Sharks", "10:00", [1, 0], "2026-08-29")
        )
      );
      expect(recordOf(state)?.filedAgainst).toBeUndefined();
    });

    it("the same result, which the slot settle folds with no mark", () => {
      const { bare } = folded([], [row("b1", "Aces 9U", "18:30", [3, 7])]);
      expect(recordOf(pull(bare, aces()))?.filedAgainst).toBeUndefined();
    });

    it("the very start, with results that do not disagree", () => {
      const { bare } = folded([row("a1", "Sharks", "18:30", [7, 3])]);
      expect(
        recordOf(pull(bare, aces(row("a1", "Sharks", "18:30", [7, 3]))))?.filedAgainst
      ).toBeUndefined();
    });

    it("scores more than four runs apart", () => {
      expect(
        markAfter(
          row("a1", "Sharks", "18:00", [7, 3]),
          undefined,
          bears(row("b1", "Aces 9U", "18:30", [12, 1]))
        )
      ).toBeUndefined();
    });

    it("more than an hour apart", () => {
      expect(markAfter(row("a1", "Sharks", "16:00", [7, 3]))).toBeUndefined();
    });

    it("another day", () => {
      expect(markAfter(row("a1", "Sharks", "18:00", [7, 3], "2026-09-06"))).toBeUndefined();
    });

    it("a level out of reach of the other club's", () => {
      expect(markAfter(row("a1", "Sharks 13U", "18:00", [7, 3]))).toBeUndefined();
    });

    it("a stand-in the other club's own schedule has played", () => {
      expect(
        markAfter(
          row("a1", "Sharks", "18:00", [7, 3]),
          undefined,
          bears(row("b1", "Aces 9U", "18:30"), row("b3", "Sharks", "09:00", [4, 4], "2026-09-19"))
        )
      ).toBeUndefined();
    });

    it("a club somebody pulled", () => {
      expect(
        markAfter(
          row("a1", "Marlins 9U", "18:00", [7, 3]),
          undefined,
          // A game of their own, so a later pull finds them by name.
          club("gcM", "Marlins 9U", [row("m1", "Cubs 9U", "11:00", [1, 1], "2026-09-19")])
        )
      ).toBeUndefined();
    });

    it("a copy nobody's schedule gave, typed in by hand", () => {
      expect(
        markAfter(row("a1", "Sharks", "18:00", [7, 3]), (bare) => ({
          ...bare,
          games: bare.games.map((game) => {
            if (!game.alsoRows) return game;
            const { source: _source, ...typedIn } = game;
            return { ...typedIn, id: "typed-in" };
          }),
        }))
      ).toBeUndefined();
    });

    it("a day apart, though the clocks are within the hour across midnight", () => {
      const { bare } = folded(
        [row("a1", "Sharks", "23:10", [7, 3])],
        [row("b1", "Aces 9U", "23:40")]
      );
      const state = pull(bare, aces(row("a1", "Sharks", "00:05", [7, 3], "2026-09-06")));
      expect(recordOf(state)?.filedAgainst).toBeUndefined();
    });

    it("a copy the user has thrown out", () => {
      expect(
        markAfter(row("a1", "Sharks", "18:00", [7, 3]), (bare) => ({
          ...bare,
          games: bare.games.map((game) => (game.alsoRows ? { ...game, excluded: true } : game)),
        }))
      ).toBeUndefined();
    });

    it("a copy holding another row of the Aces' club", () => {
      expect(
        markAfter(row("a1", "Sharks", "18:00", [7, 3]), (bare) => ({
          ...bare,
          games: bare.games.map((game) =>
            game.alsoRows
              ? {
                  ...game,
                  alsoRows: [...game.alsoRows, { ...game.alsoRows[0]!, gameId: "a7" }],
                }
              : game
          ),
        }))
      ).toBeUndefined();
    });

    /** The Bears renamed "Round Rock Bears", which "Bears" is a coach's shorthand for. */
    const roundRock = (bare: GcImportState): GcImportState => ({
      ...bare,
      teams: bare.teams.map((team) =>
        team.gcTeams?.some((link) => link.teamId === "gcB")
          ? {
              ...team,
              name: "Round Rock Bears",
              gcTeams: team.gcTeams.map((link) => ({ ...link, name: "Round Rock Bears 9U" })),
            }
          : team
      ),
    });
    const disputed = club("gcB", "Round Rock Bears 9U", [row("b1", "Aces 9U", "18:30", [4, 7])]);

    it("a shorthand for the other club's name at the very start, wherever the two clubs are", () => {
      expect(markAfter(row("a1", "Bears", "18:30", [7, 3]), roundRock, disputed)).toBeUndefined();
      // The slot settle files it against the other club at the start with no region to ask.
      const california = (bare: GcImportState): GcImportState => {
        const renamed = roundRock(bare);
        return {
          ...renamed,
          teams: renamed.teams.map((team) =>
            team.name === "Round Rock Bears" ? { ...team, state: "CA" } : team
          ),
        };
      };
      expect(markAfter(row("a1", "Bears", "18:30", [7, 3]), california, disputed)).toBeUndefined();
      // Half an hour off, the shorthand is a name like any other.
      expect(markAfter(row("a1", "Bears", "18:00", [7, 3]), roundRock, disputed)).toBeDefined();
    });

    it("a copy holding another of the Aces' schedules on record", () => {
      expect(
        markAfter(row("a1", "Sharks", "18:00", [7, 3]), (bare) => ({
          ...bare,
          teams: bare.teams.map((team) =>
            team.gcTeams?.some((link) => link.teamId === "gcA")
              ? { ...team, gcTeams: [...team.gcTeams, { ...team.gcTeams[0]!, teamId: "gcA2" }] }
              : team
          ),
          games: bare.games.map((game) =>
            game.alsoRows ? { ...game, alsoFrom: [...(game.alsoFrom ?? []), "gcA2"] } : game
          ),
        }))
      ).toBeUndefined();
    });

    it("the Aces' own copy of the game, listed twice", () => {
      const { bare } = folded();
      const aceId = idOf(bare, "Aces");
      const bearsId = idOf(bare, "Bears");
      const holder = bare.games.find((game) => game.alsoRows)!;
      const own: ScoutGame = {
        id: gcRowId("gcA", "a2"),
        teamAId: aceId,
        teamBId: bearsId,
        ageGroupId: holder.ageGroupId,
        date: holder.date!,
        startTs: at("18:30"),
        source: { kind: "gamechanger", teamId: "gcA", gameId: "a2" },
        alsoRows: [
          { teamId: "gcA", gameId: "a1", startTs: at("18:00"), ownScore: 7, opponentScore: 3 },
        ],
      };
      const state = pull(
        { ...bare, games: [...bare.games.filter((game) => game !== holder), own] },
        aces(row("a1", "Sharks", "18:00", [7, 3]), row("a2", "Bears 9U", "18:30"))
      );
      expect(recordOf(state)?.filedAgainst).toBeUndefined();
    });

    it("a row of the Aces' own against the Bears the day before, that no row of theirs answers", () => {
      // At the same clock, with a result the Bears' copy has none of its own to say two games
      // against: the collapse could join the two across the night, and the claim step waits.
      for (const score of [undefined, [2, 2] as [number, number]]) {
        const { bare } = folded();
        const state = pull(
          bare,
          aces(
            row("a1", "Sharks", "18:00", [7, 3]),
            row("a4", "Bears 9U", "18:30", score, "2026-09-04")
          )
        );
        expect(recordOf(state)?.filedAgainst).toBeUndefined();
      }
    });
  });

  it("marks one past a row of the Aces' own against the Bears a day off that is another game", () => {
    // At eleven the day before, nothing joins the two: the claim step does not wait on it. Nor on
    // a 7-3 there, which is the score the Aces' row lent the Bears' copy, not the Bears' own word.
    for (const score of [
      [2, 2],
      [7, 3],
    ] as [number, number][]) {
      const { claimed, bare } = folded();
      const state = pull(
        bare,
        aces(
          row("a1", "Sharks", "18:00", [7, 3]),
          row("a4", "Bears 9U", "11:00", score, "2026-09-04")
        )
      );
      expect(recordOf(state)).toEqual(recordOf(claimed));
      expect(tidyPool(state).claimed).toBe(0);
    }
  });
});

describe("a claim a merge settles on the club whose copy holds it", () => {
  /*
   * The user merges "Sharks" into the Bears by hand: the Aces' row was the Bears' game all along.
   * The claim is filed against the Bears now (`withFiledRepointed`), the very club whose copy holds
   * it. There is nothing for it to go back to, so it stays where it is, and a re-pull leaves it be.
   */
  const settled = () => {
    const claimed = tidied(pull(empty, aces(), bears()));
    const sharks = idOf(claimed, "Sharks");
    const merged = renameScoutTeam(
      sharks,
      "Bears 9U",
      claimed.teams,
      claimed.games,
      claimed.ageGroups
    );
    const state = { ...claimed, teams: merged.teams, games: merged.games };
    expect(recordOf(state)?.filedAgainst).toBe(idOf(state, "Bears"));
    return state;
  };

  it("stays in the copy through a tidy and a re-pull, and nothing is made for the name again", () => {
    const state = settled();
    const tidy = tidyPool(state);
    expect(tidy.claimed).toBe(0);
    expect(tidy.state.games).toEqual(state.games);
    const again = tidied(pull(tidy.state, aces()));
    expect(again.games).toEqual(state.games);
    expect(again.teams.some((team) => team.name === "Sharks")).toBe(false);
    expect(page(again, "gcA")).toEqual(["7-3 v Bears at 18:30"]);
  });

  it("is what a merge made before any tidy leaves too, which the next pull leaves alone", () => {
    const pulled = pull(empty, bears(), aces());
    const merged = renameScoutTeam(
      idOf(pulled, "Sharks"),
      "Bears 9U",
      pulled.teams,
      pulled.games,
      pulled.ageGroups
    );
    const state = tidied({ ...pulled, teams: merged.teams, games: merged.games });
    expect(recordOf(state)?.filedAgainst).toBe(idOf(state, "Bears"));
    const again = pull(state, aces());
    expect(again.teams.some((team) => team.name === "Sharks")).toBe(false);
    expect(again.games).toEqual(state.games);
  });

  it("keeps the Aces' other game against the Bears that day a game of its own", () => {
    const doubleheader = [
      row("a1", "Sharks", "18:00", [7, 3]),
      row("a3", "Sharks", "20:30", [2, 4]),
    ];
    const claimed = tidied(pull(empty, aces(...doubleheader), bears()));
    const merged = renameScoutTeam(
      idOf(claimed, "Sharks"),
      "Bears 9U",
      claimed.teams,
      claimed.games,
      claimed.ageGroups
    );
    const state = tidied(
      pull(tidied({ ...claimed, teams: merged.teams, games: merged.games }), aces(...doubleheader))
    );
    expect(page(state, "gcA")).toEqual(["2-4 v Bears at 20:30", "7-3 v Bears at 18:30"]);
    // And a game against them the Bears never listed, pulled later, stays one too.
    const later = tidied(
      pull(
        settled(),
        aces(row("a1", "Sharks", "18:00", [7, 3]), row("a2", "Bears 9U", "12:00", [1, 0]))
      )
    );
    expect(page(later, "gcA")).toEqual(["1-0 v Bears at 12:00", "7-3 v Bears at 18:30"]);
  });

  it("keeps the copy from a namesake of the Aces pulled later", () => {
    const claimed = tidied(pull(empty, aces(), bears(row("b1", "Aces 9U", "18:30", [3, 6]))));
    const merged = renameScoutTeam(
      idOf(claimed, "Sharks"),
      "Bears 9U",
      claimed.teams,
      claimed.games,
      claimed.ageGroups
    );
    const state = tidied({ ...claimed, teams: merged.teams, games: merged.games });
    const otherAces = club("gcZ", "Aces 9U", [row("z1", "Bears 9U", "18:30")], { state: "OK" });
    const next = tidied(pull(state, otherAces));
    // The Bears list one game against an Aces that day, a 3-6 loss: it is counted once.
    expect(page(next, "gcB").filter((line) => line.includes("v Aces"))).toEqual([
      "3-6 v Aces at 18:30",
      "unplayed v Aces at 18:30",
    ]);
  });

  it("is the Aces' own row there, so no other row of theirs is claimed into the copy", () => {
    const state = settled();
    const next = tidyPool(
      pull(state, aces(row("a1", "Sharks", "18:00", [7, 3]), row("a2", "Marlins", "18:45")))
    );
    expect(page(next.state, "gcA")).toEqual([
      "7-3 v Bears at 18:30",
      "unplayed v Marlins at 18:45",
    ]);
  });
});
