import { describe, expect, it } from "vitest";
import {
  collapseSameGames,
  sameStart,
  scoreSeenBy,
  type AgeGroup,
  type ScoutGame,
} from "../teamRankings";
import {
  importGcSchedule,
  importGcSchedules,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";

/*
 * The pool is re-pulled every day, and a schedule changes under it: a start moves, a score is
 * posted, a game is entered again under a new id. A fold made on one day's evidence has to stay
 * right on the next day's, or a result is lost or counted twice. Each case here was found by an
 * adversarial review of the rules for one game on two schedules, and each failed before the fix.
 */

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const club = (id: string, name: string, games: GcTeamSchedule["games"]): GcTeamSchedule => ({
  profile: { id, name, ageLevel: 11, season: { season: "fall", year: 2026 } },
  games,
  fetchedAt: "2026-09-20T12:00:00.000Z",
});
const at = (
  id: string,
  opponentName: string,
  time: string | undefined,
  teamScore?: number,
  opponentScore?: number
) => ({
  id,
  date: "2026-08-29",
  ...(time ? { startTs: `2026-08-29T${time}:00.000Z` } : {}),
  opponentName,
  status: teamScore === undefined ? ("scheduled" as const) : ("completed" as const),
  ...(teamScore === undefined ? {} : { teamScore }),
  ...(opponentScore === undefined ? {} : { opponentScore }),
});
const LEGACY = "Legacy Baseball Club 11U";
const RAPTORS = "River City Raptors 11U";
const legacy = (games: GcTeamSchedule["games"]) => club("gcLEGACY0001", LEGACY, games);
const raptors = (games: GcTeamSchedule["games"]) => club("gcRAPTORS001", RAPTORS, games);

/** Every game's score as Legacy's page reads it, in start order. */
const legacySees = (state: GcImportState) => {
  const id = state.teams.find((team) => team.name === "Legacy Baseball Club")!.id;
  return state.games
    .filter((game) => game.teamAId === id || game.teamBId === id)
    .sort((a, b) => (a.startTs ?? "").localeCompare(b.startTs ?? ""))
    .map((game) => {
      const seen = scoreSeenBy(game, id);
      return seen ? `${seen.own}-${seen.opponent}` : "unplayed";
    });
};
const raptorsSee = (state: GcImportState) => {
  const id = state.teams.find((team) => team.name === "River City Raptors")!.id;
  return state.games
    .filter((game) => game.teamAId === id || game.teamBId === id)
    .map((game) => scoreSeenBy(game, id))
    .filter((seen) => seen !== undefined)
    .map((seen) => `${seen.own}-${seen.opponent}`)
    .sort();
};
const pull = (state: GcImportState, schedule: GcTeamSchedule) =>
  tidyPool(importGcSchedule(schedule, state).state).state;

describe("a fold made on a tie is taken back when the scores say otherwise", () => {
  // The Raptors list game 2 of a doubleheader as one all-day row: no start, no score yet. It could
  // be either of Legacy's two games, and it once went to the first by pool order.
  it("moves the Raptors' copy to the game its score matches", () => {
    const both = [at("l1", RAPTORS, "10:00", 14, 5), at("l2", RAPTORS, "14:00", 14, 2)];
    let state = importGcSchedules(
      [legacy(both), raptors([at("r2", LEGACY, undefined)])],
      empty
    ).state;
    state = pull(state, raptors([at("r2", LEGACY, undefined, 2, 14)]));
    expect(legacySees(state)).toEqual(["14-5", "14-2"]);
    expect(raptorsSee(state)).toEqual(["2-14", "5-14"]);
    state = pull(state, legacy(both));
    state = pull(state, raptors([at("r2", LEGACY, undefined, 2, 14)]));
    expect(legacySees(state)).toEqual(["14-5", "14-2"]);
    expect(state.games).toHaveLength(2);
  });
});

describe("one schedule's two games once at one placeholder start", () => {
  it("splits them again when the schedule moves one", () => {
    let state = pull(empty, legacy([at("a1", RAPTORS, "09:00"), at("a2", RAPTORS, "09:00")]));
    expect(state.games).toHaveLength(1);
    state = pull(state, legacy([at("a1", RAPTORS, "09:00"), at("a2", RAPTORS, "11:30")]));
    expect(state.games).toHaveLength(2);
    state = pull(
      state,
      legacy([at("a1", RAPTORS, "09:00", 5, 3), at("a2", RAPTORS, "11:30", 7, 2)])
    );
    expect(legacySees(state)).toEqual(["5-3", "7-2"]);
  });

  it("splits them again when a start moved onto the other is moved back", () => {
    let state = pull(
      empty,
      legacy([at("a1", RAPTORS, "09:00", 5, 3), at("a2", RAPTORS, "10:00", 7, 2)])
    );
    state = pull(
      state,
      legacy([at("a1", RAPTORS, "10:00", 5, 3), at("a2", RAPTORS, "10:00", 7, 2)])
    );
    state = pull(
      state,
      legacy([at("a1", RAPTORS, "09:00", 5, 3), at("a2", RAPTORS, "10:00", 7, 2)])
    );
    expect(legacySees(state)).toEqual(["5-3", "7-2"]);
  });
});

describe("a doubleheader whose two clocks sit apart", () => {
  // The Raptors' clock runs 40 minutes behind Legacy's, and the pull comes between the games.
  it("keeps both results through every pull, whichever club was pulled last", () => {
    let state = pull(empty, legacy([at("a1", RAPTORS, "10:00", 5, 3), at("a2", RAPTORS, "11:00")]));
    state = pull(state, raptors([at("b1", LEGACY, "10:40", 3, 5), at("b2", LEGACY, "11:40")]));
    const final = {
      legacy: legacy([at("a1", RAPTORS, "10:00", 5, 3), at("a2", RAPTORS, "11:00", 7, 2)]),
      raptors: raptors([at("b1", LEGACY, "10:40", 3, 5), at("b2", LEGACY, "11:40", 2, 7)]),
    };
    for (const order of [
      ["legacy", "raptors"],
      ["raptors", "legacy"],
      ["legacy", "raptors"],
    ] as const) {
      order.forEach((who) => (state = pull(state, final[who])));
      expect(legacySees(state)).toEqual(["5-3", "7-2"]);
      expect(raptorsSee(state)).toEqual(["2-7", "3-5"]);
    }
  });

  it("pairs the two schedules' games in start order in the tidy", () => {
    const u11: AgeGroup = { id: "u11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] };
    const row = (
      id: string,
      schedule: string,
      a: string,
      b: string,
      time: string,
      score?: [number, number]
    ): ScoutGame => ({
      id: `gc_${schedule}_${id}`,
      teamAId: a,
      teamBId: b,
      ageGroupId: "u11",
      date: "2026-08-29",
      startTs: `2026-08-29T${time}:00.000Z`,
      ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
      source: { kind: "gamechanger", teamId: schedule, gameId: id },
    });
    const out = collapseSameGames(
      [
        row("a1", "gcA", "A", "B", "10:00", [14, 5]),
        row("a2", "gcA", "A", "B", "11:30", [14, 2]),
        row("b1", "gcB", "B", "A", "10:50"),
        row("b2", "gcB", "B", "A", "12:20"),
      ],
      [u11]
    );
    expect(out.games.map((game) => [game.id, (game.alsoRows ?? []).map((r) => r.gameId)])).toEqual([
      ["gc_gcA_a1", ["b1"]],
      ["gc_gcA_a2", ["b2"]],
    ]);
  });

  // A mercy-rule doubleheader: both clubs list both games, 10-0 each, at the same two slots.
  it("keeps two games both schedules list at two slots with one result", () => {
    const { state } = importGcSchedules(
      [
        legacy([at("a1", RAPTORS, "13:00", 10, 0), at("a2", RAPTORS, "14:00", 10, 0)]),
        raptors([at("b1", LEGACY, "13:00", 0, 10), at("b2", LEGACY, "14:00", 0, 10)]),
      ],
      empty
    );
    // The import alone folds them, a result repeated within the hour on one schedule; the tidy
    // that ends every pull reads both schedules and stands the second game back up.
    const tidied = tidyPool(state).state;
    expect(tidied.games).toHaveLength(2);
    expect(legacySees(tidied)).toEqual(["10-0", "10-0"]);
  });
});

describe("a schedule's copy that comes back under another id", () => {
  it("joins the game when the schedule lists it twice, the new copy first", () => {
    let state = importGcSchedules(
      [legacy([at("l1", RAPTORS, "17:00", 14, 2)]), raptors([at("r1", LEGACY, "17:00", 2, 14)])],
      empty
    ).state;
    state = pull(
      state,
      raptors([at("r1b", LEGACY, "17:00", 2, 14), at("r1", LEGACY, "17:00", 2, 14)])
    );
    expect(state.games).toHaveLength(1);
  });

  it("joins the game when the coach deleted it and entered it again", () => {
    let state = importGcSchedules(
      [legacy([at("l1", RAPTORS, "17:00", 14, 2)]), raptors([at("r1", LEGACY, "17:00", 2, 14)])],
      empty
    ).state;
    state = pull(state, raptors([at("r9", LEGACY, "17:00", 2, 14)]));
    state = pull(state, legacy([at("l1", RAPTORS, "17:00", 14, 2)]));
    expect(state.games).toHaveLength(1);
  });
});

describe("a folded row pulled again", () => {
  // Its game was settled by result from a "TBD": finding it again must not mint another slot.
  it("adds no team", () => {
    const dragons = club("gcDRAGONS001", "Dragons 11U", [
      { ...at("d1", "TBD", "14:00", 5, 3), date: "2026-08-29" },
    ]);
    const hens = club("gcHENS000001", "Hens 11U", [at("h1", "Dragons 11U", "14:40", 3, 5)]);
    let state = tidyPool(importGcSchedules([dragons, hens], empty).state).state;
    const teams = state.teams.length;
    state = pull(state, dragons);
    state = pull(state, dragons);
    expect(state.teams).toHaveLength(teams);
    expect(state.games).toHaveLength(1);
  });
});

describe("the same start", () => {
  it("is the same minute, so an index keyed on the minute finds every pair it matches", () => {
    expect(sameStart("2026-08-29T17:30:00.000Z", "2026-08-29T17:30:00.355Z")).toBe(true);
    expect(sameStart("2026-08-29T17:30:00.000Z", "2026-08-29T17:30:20.000Z")).toBe(true);
    expect(sameStart("2026-08-29T17:30:00.000Z", "2026-08-29T17:30:40.000Z")).toBe(false);
  });
});

describe("a folded row its schedule no longer lists", () => {
  /*
   * Legacy lists two games against the Raptors that day; the Raptors list the second, and then
   * delete it. Legacy moves that game and corrects its score. A record left behind would fit
   * neither game and stand up as a third that nobody lists.
   */
  it("goes, rather than standing up as a game of its own later", () => {
    let state = importGcSchedules(
      [
        legacy([at("l0", RAPTORS, "12:00", 5, 5), at("l1", RAPTORS, "17:00", 14, 2)]),
        raptors([at("r1", LEGACY, "18:00", 2, 14)]),
      ],
      empty
    ).state;
    state = tidyPool(state).state;
    state = pull(state, raptors([at("other", "Somebody Else 11U", "09:00", 4, 4)]));
    state = pull(
      state,
      legacy([at("l0", RAPTORS, "12:00", 5, 5), at("l1", RAPTORS, "20:00", 14, 3)])
    );
    expect(legacySees(state)).toEqual(["5-5", "14-3"]);
  });
});

describe("a score borrowed from the other schedule", () => {
  // The Dragons' schedule had nothing while the Hens' had 8-10; the Dragons then post 11-8.
  it("gives way to side A's own once it is posted, through every tidy after", () => {
    const hens = club("gcHENS000001", "Hens 11U", [at("h1", "Dragons 11U", "14:00", 8, 10)]);
    const dragons = (score?: [number, number]) =>
      club("gcDRAGONS001", "Dragons 11U", [at("d1", "Hens 11U", "14:00", ...(score ?? []))]);
    let state = tidyPool(importGcSchedules([dragons(), hens], empty).state).state;
    state = pull(state, dragons([11, 8]));
    state = tidyPool(state).state;
    const id = state.teams.find((team) => team.name === "Dragons")!.id;
    expect(scoreSeenBy(state.games[0]!, id)).toEqual({ own: 11, opponent: 8 });
  });
});

describe("a score borrowed for the wrong game", () => {
  /*
   * The Raptors post their copy of one of two Legacy games with no start, before Legacy has posted
   * either; it goes to the first by a tie, and Legacy's first game shows its score. When Legacy
   * posts the second as that very result, the copy moves there, and the score it lent the first
   * game goes with it rather than staying behind as Legacy's own.
   */
  it("goes with the copy when the copy moves", () => {
    let state = tidyPool(
      importGcSchedules(
        [
          legacy([at("l1", RAPTORS, "10:00"), at("l2", RAPTORS, "14:00")]),
          raptors([at("r", LEGACY, undefined, 2, 14)]),
        ],
        empty
      ).state
    ).state;
    state = pull(state, legacy([at("l1", RAPTORS, "10:00"), at("l2", RAPTORS, "14:00", 14, 2)]));
    expect(legacySees(state)).toEqual(["unplayed", "14-2"]);
  });
});

describe("a tie between two copies", () => {
  // Legacy's game sits exactly an hour from each of two Raptors rows with nothing posted. Either
  // could be it; the tidy has to give the same answer every time it is asked.
  it("is broken the same way on every pass", () => {
    const state = tidyPool(
      importGcSchedules(
        [
          legacy([at("l1", RAPTORS, "15:00")]),
          raptors([at("r1", LEGACY, "14:00"), at("r2", LEGACY, "16:00")]),
        ],
        empty
      ).state
    ).state;
    const again = tidyPool(state).state;
    expect(again.games).toBe(state.games);
  });
});

describe("naming an opponent among namesakes", () => {
  /*
   * Two clubs called Hurricanes, one in Ohio and one in Kentucky, each played the Dragons that day,
   * an hour apart. The Ohio club's own game against the Dragons at 14:00 does not make it the club
   * the Dragons played at 15:00 as well.
   */
  it("takes a namesake's game only at the same start", () => {
    const hurricanes = (id: string, state: string, gameId: string, time: string) => ({
      profile: {
        id,
        name: "Hurricanes 11U",
        ageLevel: 11,
        state,
        season: { season: "fall" as const, year: 2026 },
      },
      games: [at(gameId, "Dragons 11U", time)],
      fetchedAt: "2026-09-20T12:00:00.000Z",
    });
    const dragons = {
      profile: {
        id: "gcDRAGONS001",
        name: "Dragons 11U",
        ageLevel: 11,
        state: "OH",
        season: { season: "fall" as const, year: 2026 },
      },
      games: [at("d1", "Hurricanes", "14:00"), at("d2", "Hurricanes", "15:00")],
      fetchedAt: "2026-09-20T12:00:00.000Z",
    };
    const { state } = importGcSchedules(
      [
        hurricanes("gcHURR000001", "OH", "h1", "14:00"),
        hurricanes("gcHURR000002", "KY", "k1", "15:00"),
        dragons,
      ],
      empty
    );
    expect(tidyPool(state).state.games).toHaveLength(2);
  });
});
