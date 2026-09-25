import { describe, expect, it } from "vitest";
import {
  collapseSameGames,
  countsTowardRating,
  gcRowId,
  ratedMargin,
  rowOfRecord,
  sameStart,
  scoreSeenBy,
  withScoreTyped,
  type AgeGroup,
  type ScoutGame,
} from "../teamRankings";
import {
  describeTidy,
  importGcSchedule,
  importGcSchedules,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { unrealClubs } from "../unrealClubs";

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

describe("a game the other club still lists, which this club's schedule no longer does", () => {
  /*
   * Kentucky Athletics' 6-5 over Ironmen Prime-Isenburg is on the Ironmen's schedule and no longer
   * on the Athletics'. A team does not always keep every game on GameChanger, so the game one
   * club still lists counts, once, whichever club's row it stands on and however the other
   * club's schedule once held it.
   */
  const counted = (state: GcImportState) =>
    state.games.filter((game) => countsTowardRating(game, "2026-09-20"));

  it("still counts once the other club's own row is all that holds it", () => {
    for (const legacyFirst of [true, false]) {
      const pulls = [
        legacy([at("l1", RAPTORS, "12:00", 6, 5)]),
        raptors([at("r1", LEGACY, "12:00", 5, 6)]),
      ];
      let state = tidyPool(
        importGcSchedules(legacyFirst ? pulls : pulls.slice().reverse(), empty).state
      ).state;
      expect(counted(state)).toHaveLength(1);
      state = tidyPool(pull(state, legacy([at("l9", "Somebody Else 11U", "09:00", 4, 4)]))).state;
      expect(legacySees(state)).toEqual(["4-4", "6-5"]);
      expect(raptorsSee(state)).toEqual(["5-6"]);
      expect(counted(state)).toHaveLength(2);
    }
  });

  it("still counts where this club's schedule is only on record, with no row of its own", () => {
    // How the Athletics' game sits: the Ironmen's row, and the Athletics' schedule on record from
    // before rows were kept.
    let state = importGcSchedules([raptors([at("r1", LEGACY, "12:00", 5, 6)])], empty).state;
    state = {
      ...state,
      games: state.games.map((game) => ({ ...game, alsoFrom: ["gcLEGACY0001"] })),
    };
    state = pull(state, legacy([at("l9", "Somebody Else 11U", "09:00", 4, 4)]));
    state = tidyPool(state).state;
    expect(legacySees(state)).toEqual(["4-4", "6-5"]);
    expect(counted(state)).toHaveLength(2);
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

/*
 * The second review's cases. Each is a schedule, or two, pulled in the order the reviewer pulled
 * them, and each lost or doubled a result before the fix.
 */
describe("a start taken from the other club's copy", () => {
  /*
   * Legacy lists its first game with no start and its second at 14:00; the Raptors list only the
   * first, at 14:00. Given the Raptors' start, Legacy's first game sat at the very start of its
   * second, and the next tidy read the two as Legacy listing one game twice.
   */
  it("is never written over a game, so the next tidy does not fold away the other", () => {
    let state = pull(
      empty,
      legacy([at("l1", RAPTORS, undefined, 5, 3), at("l2", RAPTORS, "14:00", 7, 2)])
    );
    state = pull(state, raptors([at("r1", LEGACY, "14:00", 3, 5)]));
    state = tidyPool(state).state;
    expect(legacySees(state)).toEqual(["5-3", "7-2"]);
    expect(state.games.find((game) => game.id.endsWith("_l1"))!.startTs).toBeUndefined();
  });
});

describe("a tidy that only moves a folded row", () => {
  // The Raptors post their all-day copy as game 2's result after it went to game 1 by a tie.
  it("counts as a change, so the pull that ran it saves it", () => {
    const both = [at("l1", RAPTORS, "10:00", 14, 5), at("l2", RAPTORS, "14:00", 14, 2)];
    let state = tidyPool(
      importGcSchedules([legacy(both), raptors([at("r2", LEGACY, undefined)])], empty).state
    ).state;
    state = importGcSchedule(raptors([at("r2", LEGACY, undefined, 2, 14)]), state).state;
    const tidy = tidyPool(state);
    expect(tidy.state.games).not.toBe(state.games);
    expect(tidyChangedAnything(tidy)).toBe(true);
    expect(describeTidy(tidy).length).toBeGreaterThan(0);
    expect(raptorsSee(tidy.state)).toEqual(["2-14", "5-14"]);
  });

  // The Raptors delete the only copy that scored Legacy's game: the score it lent goes too. Their
  // other game is hours off: within the hour, a row against a name nobody pulled is the Raptors'
  // own copy of the game Legacy lists and no Raptors schedule does (`resolveSlotGames`).
  it("counts taking back a score whose copy is gone", () => {
    let state = pull(empty, legacy([at("l1", RAPTORS, "10:00")]));
    state = pull(state, raptors([at("r1", LEGACY, "10:00", 3, 5)]));
    expect(legacySees(state)).toEqual(["5-3"]);
    state = importGcSchedule(
      raptors([at("other", "Somebody Else 11U", "13:00", 4, 4)]),
      state
    ).state;
    const tidy = tidyPool(state);
    expect(tidyChangedAnything(tidy)).toBe(true);
    expect(legacySees(tidy.state)).toEqual(["unplayed"]);
  });
});

describe("a tie between two links with no start on either", () => {
  /*
   * Legacy's all-day 10-0 and two all-day Raptors rows with nothing posted: two links of one
   * strength and no gap to compare. The comparison read Infinity less Infinity, which is not a
   * number, as a tie settled by where the rows sat, and the rows traded places on every pass.
   */
  it("is broken the same way on every pass", () => {
    const state = tidyPool(
      importGcSchedules(
        [
          legacy([at("l1", RAPTORS, undefined, 10, 0)]),
          raptors([at("r1", LEGACY, undefined), at("r2", LEGACY, undefined)]),
        ],
        empty
      ).state
    ).state;
    const again = tidyPool(state);
    expect(again.state.games).toBe(state.games);
    expect(again.passes).toBe(1);
  });
});

describe("a doubleheader only one club has scored", () => {
  // Two mercy-rule wins an hour apart, 10-0 each; the Raptors list both slots, unscored.
  it("stays two games in either pull order", () => {
    const l = legacy([at("l0", RAPTORS, "13:00", 10, 0), at("l1", RAPTORS, "14:00", 10, 0)]);
    const r = raptors([at("r0", LEGACY, "13:00"), at("r1", LEGACY, "14:00")]);
    for (const order of [
      [l, r],
      [r, l],
    ]) {
      const state = order.reduce(pull, empty);
      expect(state.games).toHaveLength(2);
      expect(legacySees(state)).toEqual(["10-0", "10-0"]);
      expect(raptorsSee(state)).toEqual(["0-10", "0-10"]);
    }
  });
});

describe("each club posting a different game of a doubleheader", () => {
  /*
   * Both clubs list both games at 09:00 and 12:00. Legacy posted game 1, 8-11; the Raptors posted
   * game 2, which ended by the same score. The same result three hours off is weaker than the
   * very same start with nothing posted, so each posted result stays on its own game.
   */
  it("keeps both results", () => {
    const state = [
      legacy([at("l0", RAPTORS, "09:00", 8, 11), at("l2", RAPTORS, "12:00")]),
      raptors([at("r1", LEGACY, "09:00"), at("r3", LEGACY, "12:00", 11, 8)]),
    ].reduce(pull, empty);
    expect(state.games).toHaveLength(2);
    expect(legacySees(state)).toEqual(["8-11", "8-11"]);
    expect(raptorsSee(state)).toEqual(["11-8", "11-8"]);
  });
});

describe("a schedule that lists a doubleheader with no starts", () => {
  /*
   * Legacy lists 09:00, lost 8-9, and 12:00, not posted. The Raptors list both with no start, one
   * posted 5-2. The posted one fits only the game Legacy has not scored; the unposted one fits
   * either, so the posted one goes first and neither result is lost.
   */
  it("pairs the posted copy with the game it can be first", () => {
    const state = [
      legacy([at("l0", RAPTORS, "09:00", 8, 9), at("l2", RAPTORS, "12:00")]),
      raptors([at("r1", LEGACY, undefined), at("r3", LEGACY, undefined, 5, 2)]),
    ].reduce(pull, empty);
    expect(legacySees(state)).toEqual(["8-9", "2-5"]);
    expect(raptorsSee(state)).toEqual(["5-2", "9-8"]);
  });
});

describe("a score typed in by hand", () => {
  const typed = (state: GcImportState, a: number, b: number): GcImportState => ({
    ...state,
    games: state.games.map((game) => withScoreTyped(game, a, b)),
  });

  it("stands through the next tidy where it replaced a score borrowed from side B", () => {
    let state = pull(empty, legacy([at("l1", RAPTORS, "14:00")]));
    state = pull(state, raptors([at("r1", LEGACY, "14:00", 3, 5)]));
    state = tidyPool(typed(state, 6, 3)).state;
    expect(legacySees(state)).toEqual(["6-3"]);
    expect(raptorsSee(state)).toEqual(["3-6"]);
    // Legacy's score now, not one lent: the Raptors' next pull puts their own beside it, not over.
    state = pull(state, raptors([at("r1", LEGACY, "14:00", 3, 5)]));
    expect(legacySees(state)).toEqual(["6-3"]);
    expect(raptorsSee(state)).toEqual(["3-5"]);
  });

  it("stands for both clubs through the next tidy where the two schedules disagreed", () => {
    let state = pull(empty, legacy([at("l1", RAPTORS, "14:00", 5, 3)]));
    state = pull(state, raptors([at("r1", LEGACY, "14:00", 2, 4)]));
    expect(raptorsSee(state)).toEqual(["2-4"]);
    state = tidyPool(typed(state, 5, 3)).state;
    expect(raptorsSee(state)).toEqual(["3-5"]);
    expect(ratedMargin(state.games[0]!)).toBe(2);
  });
});

describe("side A's own score from a second listing of its game", () => {
  // The Raptors' 3-6 was lent to Legacy's unscored copy; Legacy then lists the game again, 5-3.
  it("replaces the score lent by side B, whichever order the schedules came in", () => {
    const first = legacy([at("l1", RAPTORS, "14:00")]);
    const twice = legacy([at("l1", RAPTORS, "14:00"), at("l1b", RAPTORS, "14:00", 5, 3)]);
    const r = raptors([at("r1", LEGACY, "14:00", 3, 6)]);
    for (const order of [
      [first, r, twice],
      [twice, r],
      [r, twice],
    ]) {
      const state = tidyPool(order.reduce(pull, empty)).state;
      expect(legacySees(state)).toEqual(["5-3"]);
      expect(raptorsSee(state)).toEqual(["3-6"]);
    }
  });
});

describe("a game its schedule deleted and entered again", () => {
  /*
   * The Raptors' game stands on their own row, with Legacy's copy folded in. They delete the row,
   * enter the game again under a new id, and then correct the new one's score.
   */
  it("takes the correction made to the new row", () => {
    let state = pull(empty, raptors([at("r1", LEGACY, "10:00", 6, 0)]));
    state = pull(state, legacy([at("l1", RAPTORS, "10:00", 0, 6)]));
    state = pull(state, raptors([at("r2", LEGACY, "10:00", 6, 0)]));
    state = pull(state, raptors([at("r2", LEGACY, "10:00", 7, 0)]));
    expect(raptorsSee(state)).toEqual(["7-0"]);
    expect(legacySees(state)).toEqual(["0-6"]);
    expect(state.games[0]!.note).toBeUndefined();
  });
});

describe("a game its club's schedule no longer lists", () => {
  /** Which rows each game holds, as sorted ids. */
  const together = (state: GcImportState) =>
    state.games
      .map((game) =>
        [game.id, ...(game.alsoRows ?? []).map((row) => gcRowId(row.teamId, row.gameId))]
          .sort()
          .join(",")
      )
      .sort();

  /*
   * Legacy's game stood all day, with the Raptors' copy at 10:00 folded in. Legacy deletes its row
   * and enters the game again at 10:00: the new row cannot be the old one's second listing, one
   * all day and one timed, so it stood beside it, and the game was counted twice.
   */
  it("is taken away, and its club's new entry takes the other club's copy", () => {
    for (const score of [undefined, [5, 3]] as const) {
      let state = pull(empty, legacy([at("l1", RAPTORS, undefined, ...(score ?? []))]));
      state = pull(state, raptors([at("r1", LEGACY, "10:00", ...(score ? [3, 5] : []))]));
      expect(together(state)).toEqual(["gc_gcLEGACY0001_l1,gc_gcRAPTORS001_r1"]);
      const imported = importGcSchedule(
        legacy([at("l2", RAPTORS, "10:00", ...(score ?? []))]),
        state
      ).state;
      const tidy = tidyPool(imported);
      expect(tidy.withdrawn).toBe(1);
      expect(describeTidy(tidy).join(" ")).toContain("no longer lists");
      state = tidy.state;
      expect(together(state)).toEqual(["gc_gcLEGACY0001_l2,gc_gcRAPTORS001_r1"]);
      expect(legacySees(state)).toEqual([score ? "5-3" : "unplayed"]);
      expect(tidyPool(state).state.games).toBe(state.games);
    }
  });

  // Legacy cancels the game, then the Raptors do: their copy stands alone, then goes too.
  it("leaves the other club's copy standing until that club lets it go", () => {
    let state = [legacy([at("l1", RAPTORS, "10:00")]), raptors([at("r1", LEGACY, "10:00")])].reduce(
      pull,
      empty
    );
    expect(state.games).toHaveLength(1);
    const cancelled = { ...at("l1", RAPTORS, "10:00"), status: "canceled" as const };
    const other = at("l9", "Somebody Else 11U", "15:00");
    state = pull(state, legacy([cancelled, other]));
    expect(together(state)).toEqual(["gc_gcLEGACY0001_l9", "gc_gcRAPTORS001_r1"]);
    state = pull(state, raptors([at("r9", "Somebody Else 11U", "15:00")]));
    expect(together(state)).toEqual(["gc_gcLEGACY0001_l9", "gc_gcRAPTORS001_r9"]);
  });

  // An answer with nothing in it is as likely a failed read as a club that deleted its season.
  it("is kept when the schedule comes back empty", () => {
    const state = pull(empty, legacy([at("l1", RAPTORS, "10:00", 5, 3)]));
    const again = pull(state, legacy([]));
    expect(again.games).toEqual(state.games);
  });

  // An answer none of whose rows can be filed says nothing about which rows went.
  it("is kept when every row comes back undated or cancelled", () => {
    const games = [at("l0", RAPTORS, "10:00", 1, 9), at("l1", RAPTORS, "12:00", 5, 3)];
    const state = pull(empty, legacy(games));
    for (const unreadable of [
      games.map(({ date: _date, startTs: _start, ...row }) => row),
      games.map((row) => ({ ...row, status: "canceled" as const })),
    ]) {
      const tidied = tidyPool(importGcSchedule(legacy(unreadable), state).state);
      expect(tidied.withdrawn).toBe(0);
      expect(legacySees(tidied.state)).toEqual(["1-9", "5-3"]);
    }
  });

  // Nor does it take the club's copies out of the other club's games they were folded into.
  it("keeps the club's folded copies when its answer holds nothing it can file", () => {
    const state = [
      legacy([at("l1", RAPTORS, "10:00", 5, 3)]),
      raptors([at("r1", LEGACY, "10:00", 3, 5)]),
    ].reduce(pull, empty);
    const undated = raptors(
      [at("r1", LEGACY, "10:00", 3, 5)].map(({ date: _d, startTs: _s, ...row }) => row)
    );
    const after = pull(state, undated);
    expect(after.games[0]!.alsoRows?.map((row) => gcRowId(row.teamId, row.gameId))).toEqual([
      "gc_gcRAPTORS001_r1",
    ]);
  });

  // An entry the answer held but this app could not read — no opponent — is not a row it dropped.
  it("is kept when its row came back unread, and taken when it did not come back", () => {
    const state = [
      legacy([at("l0", RAPTORS, "10:00", 1, 9), at("l1", RAPTORS, "12:00", 7, 2)]),
      raptors([at("r1", LEGACY, "12:00", 2, 7)]),
    ].reduce(pull, empty);
    const answer = { ...legacy([at("l0", RAPTORS, "10:00", 1, 9)]), rowIds: ["l0", "l1"] };
    const kept = tidyPool(importGcSchedule(answer, state).state);
    expect(kept.withdrawn).toBe(0);
    expect(legacySees(kept.state)).toEqual(["1-9", "7-2"]);
    expect(raptorsSee(kept.state)).toEqual(["2-7", "9-1"]);
    const gone = tidyPool(importGcSchedule({ ...answer, rowIds: ["l0"] }, state).state);
    expect(gone.withdrawn).toBe(1);
  });

  // The Raptors' copy is on record only by their schedule's id, from before rows were kept.
  it("is kept while another club's copy is on record only by its schedule", () => {
    const state = pull(
      empty,
      legacy([at("l1", RAPTORS, "10:00", 5, 3), at("l2", RAPTORS, "13:00")])
    );
    const onRecord: GcImportState = {
      ...state,
      games: state.games.map((game) =>
        game.id === "gc_gcLEGACY0001_l1" ? { ...game, alsoFrom: ["gcRAPTORS001"] } : game
      ),
    };
    const tidied = tidyPool(importGcSchedule(legacy([at("l2", RAPTORS, "13:00")]), onRecord).state);
    expect(tidied.withdrawn).toBe(0);
    expect(tidied.state.games).toHaveLength(2);
  });

  // What the user said of the game — a score typed in, or not counting it — outlives Legacy's row.
  it("hands the user's word on to the other club's copy", () => {
    const both = [legacy([at("l1", RAPTORS, "10:00")]), raptors([at("r1", LEGACY, "10:00")])];
    const state = both.reduce(pull, empty);
    const [game] = state.games;
    const withdraw = (edited: ScoutGame) =>
      pull(
        { ...state, games: [edited] },
        legacy([at("l9", "Somebody Else 11U", "15:00")])
      ).games.filter((entry) => entry.id === "gc_gcRAPTORS001_r1");
    const [typed] = withdraw(withScoreTyped(game!, 6, 4));
    expect(typed && scoreSeenBy(typed, typed.teamAId)).toEqual({ own: 4, opponent: 6 });
    const [excluded] = withdraw({ ...game!, excluded: true });
    expect(excluded?.excluded).toBe(true);
  });

  it("is kept when its row is listed again before the tidy", () => {
    const state = pull(
      empty,
      legacy([at("l1", RAPTORS, "10:00", 5, 3), at("l2", RAPTORS, "12:00")])
    );
    const marked = importGcSchedule(legacy([at("l2", RAPTORS, "12:00")]), state).state;
    expect(marked.games.find((game) => game.id === "gc_gcLEGACY0001_l1")?.withdrawn).toBe(true);
    const back = importGcSchedule(
      legacy([at("l1", RAPTORS, "10:00", 5, 3), at("l2", RAPTORS, "12:00")]),
      marked
    ).state;
    expect(back.games.some((game) => game.withdrawn)).toBe(false);
    expect(legacySees(tidyPool(back).state)).toEqual(["5-3", "unplayed"]);
  });
});

describe("a result dated ahead that one club's schedule lists unscored", () => {
  /*
   * A club that files scores for games not yet played lists three October games against a real
   * club, whose own schedule has the same three with nothing in them. Only the club that wrote the
   * scores wrote anything impossible.
   */
  it("is charged to the club that scored it", () => {
    const october = (id: string, day: string, opponentName: string, score?: [number, number]) => ({
      id,
      date: `2026-10-${day}`,
      startTs: `2026-10-${day}T15:00:00.000Z`,
      opponentName,
      status: score ? ("completed" as const) : ("scheduled" as const),
      ...(score ? { teamScore: score[0], opponentScore: score[1] } : {}),
    });
    const real = club("gcREAL000001", "Real Club 11U", [
      at("r0", "Somebody Else 11U", "12:00", 4, 2),
      october("r1", "03", "Pre Filled 11U"),
      october("r2", "10", "Pre Filled 11U"),
      october("r3", "17", "Pre Filled 11U"),
    ]);
    const filled = club("gcFILLED0001", "Pre Filled 11U", [
      at("f0", "Somebody Else 11U", "13:00", 3, 1),
      october("f1", "03", "Real Club 11U", [9, 1]),
      october("f2", "10", "Real Club 11U", [8, 0]),
      october("f3", "17", "Real Club 11U", [7, 2]),
    ]);
    for (const order of [
      [real, filled],
      [filled, real],
    ]) {
      const state = order.reduce(pull, empty);
      expect(unrealClubs(state, "2026-09-25").map((found) => [found.name, found.ahead])).toEqual([
        ["Pre Filled", 3],
      ]);
    }
  });
});

describe("a score lent to a named game from a placeholder's schedule", () => {
  /*
   * The Raptors played "TBD" at 10:00 and lost 2-14; Legacy lists two games, 10:00 and 14:00, and
   * has posted neither. The tidy settles the placeholder into Legacy's 10:00 game with the
   * Raptors' result. That result is lent, and goes with the Raptors' row wherever it goes.
   */
  it("goes with the row when the row moves to the other game", () => {
    let state = pull(empty, raptors([at("r", "TBD", "10:00", 2, 14)]));
    state = pull(state, legacy([at("l1", RAPTORS, "10:00"), at("l2", RAPTORS, "14:00")]));
    expect(legacySees(state)).toEqual(["14-2", "unplayed"]);
    state = pull(state, raptors([at("r", "TBD", "14:00", 2, 14)]));
    state = pull(state, legacy([at("l1", RAPTORS, "10:00"), at("l2", RAPTORS, "14:00", 14, 2)]));
    expect(legacySees(state)).toEqual(["unplayed", "14-2"]);
    expect(raptorsSee(state)).toEqual(["2-14"]);
  });

  // The Dragons' "TBD" is the Hens' unscored game at the same start.
  it("follows the lending schedule's correction, and goes when that schedule drops the game", () => {
    const hens = club("gcHENS000001", "Hens 11U", [at("h1", "Dragons 11U", "14:00")]);
    const dragons = (games: GcTeamSchedule["games"]) => club("gcDRAGONS001", "Dragons 11U", games);
    let state = [dragons([at("d1", "TBD", "14:00", 5, 3)]), hens].reduce(pull, empty);
    const hensId = state.teams.find((team) => team.name === "Hens")!.id;
    const hensSee = (pool: GcImportState) =>
      pool.games
        .filter((game) => game.teamAId === hensId || game.teamBId === hensId)
        .map((game) => scoreSeenBy(game, hensId) ?? "unplayed");
    expect(hensSee(state)).toEqual([{ own: 3, opponent: 5 }]);
    state = pull(state, dragons([at("d1", "TBD", "14:00", 6, 3)]));
    expect(hensSee(state)).toEqual([{ own: 3, opponent: 6 }]);
    state = pull(state, dragons([at("d9", "Somebody Else 11U", "09:00", 4, 4)]));
    expect(hensSee(state)).toEqual(["unplayed"]);
  });
});

describe("a game joined before rows were kept, as two coaches' scores at one start", () => {
  /*
   * The earlier join left one row naming the Raptors' schedule (`alsoFrom`) and nothing of its
   * row. The Raptors' next pull brings the row back at that very start with its own score, which
   * is the same game, not a second one.
   */
  const l = legacy([at("l1", RAPTORS, "17:30", 13, 2)]);
  const r = raptors([at("r1", LEGACY, "17:30", 3, 13)]);
  const joined = [l, r].reduce(pull, empty);
  const { alsoRows, reportedByB: _report, ...fields } = joined.games[0]!;
  const before: ScoutGame = {
    ...fields,
    alsoFrom: ["gcRAPTORS001"],
    note: "Other side reported 13-3.",
  };

  it("takes the other club's row back on its pull rather than filing the game twice", () => {
    expect(joined.games).toHaveLength(1);
    let state: GcImportState = { ...joined, games: [before] };
    state = importGcSchedule(r, state).state;
    expect(state.games).toHaveLength(1);
    for (const next of [l, r]) {
      state = pull(state, next);
      expect(state.games).toHaveLength(1);
      expect(legacySees(state)).toEqual(["13-2"]);
      expect(raptorsSee(state)).toEqual(["3-13"]);
    }
  });

  it("joins the row in the tidy where it was filed apart", () => {
    const row = rowOfRecord(joined.games[0]!, alsoRows![0]!);
    const state = tidyPool({ ...joined, games: [before, row] }).state;
    expect(state.games).toHaveLength(1);
    expect(raptorsSee(state)).toEqual(["3-13"]);
  });
});

describe("a game joined before rows were kept, and the other club's copy hours off", () => {
  /*
   * The earlier join left Legacy's 4-3 win at 20:00 naming the Raptors' schedule and nothing of its
   * row. The Raptors' row comes back at 17:15 with the same result: the same game whatever the
   * clocks say, as two schedules' copies of one game are.
   */
  const l = legacy([at("l1", RAPTORS, "20:00", 4, 3)]);
  const r = raptors([at("r1", LEGACY, "17:15", 3, 4)]);
  const joined = [l, r].reduce(pull, empty);
  const { alsoRows, reportedByB: _report, ...fields } = joined.games[0]!;
  const before: ScoutGame = { ...fields, alsoFrom: ["gcRAPTORS001"] };

  it("takes the row back on its pull", () => {
    expect(joined.games).toHaveLength(1);
    let state: GcImportState = { ...joined, games: [before] };
    state = importGcSchedule(r, state).state;
    expect(state.games).toHaveLength(1);
    state = pull(state, r);
    expect(state.games).toHaveLength(1);
    expect(raptorsSee(state)).toEqual(["3-4"]);
  });

  it("joins the row in the tidy where it was filed apart", () => {
    const row = rowOfRecord(joined.games[0]!, alsoRows![0]!);
    const state = tidyPool({ ...joined, games: [before, row] }).state;
    expect(state.games).toHaveLength(1);
    expect(raptorsSee(state)).toEqual(["3-4"]);
  });

  /*
   * A different result that far off, the Raptors' one row against Legacy that day as Legacy's is
   * its one row against them: one game, each club's own score, as where the row was kept. The
   * record once read as a second Raptors row in the game, and the row came back as a second game.
   */
  it("reads a different result that far off as the game where the row was kept", () => {
    const other = raptors([at("r1", LEGACY, "17:15", 13, 12)]);
    const kept = pull(joined, other);
    expect(kept.games).toHaveLength(1);
    expect(raptorsSee(kept)).toEqual(["13-12"]);
    const state = pull({ ...joined, games: [before] }, other);
    expect(state.games).toHaveLength(1);
    expect(raptorsSee(state)).toEqual(["13-12"]);
    expect(legacySees(state)).toEqual(["4-3"]);
  });
});

describe("a game joined before rows were kept, whose row comes back under another name", () => {
  /*
   * The Raptors' 3-13 was joined to Legacy's copy before rows were kept, which left the Raptors'
   * schedule on record there and nothing of the row. It comes back against a name that finds
   * nobody. The record answered for the Raptors' row that day, so the claim step took Legacy's
   * copy as holding it already, and the row stood beside it: the game counted twice.
   */
  const l = legacy([at("l1", RAPTORS, "17:30", 13, 3)]);
  const r = raptors([at("r1", LEGACY, "17:30", 3, 13)]);
  const joined = [l, r].reduce(pull, empty);
  const { alsoRows: _rows, reportedByB: _report, ...fields } = joined.games[0]!;
  const before: ScoutGame = { ...fields, alsoFrom: ["gcRAPTORS001"] };

  it("puts the row back on record there when it comes back within the hour", () => {
    expect(joined.games).toHaveLength(1);
    const renamed = raptors([at("r1", "Summer Stars 11U", "17:40", 3, 13)]);
    const state = importGcSchedule(renamed, { ...joined, games: [before] }).state;
    expect(state.games).toHaveLength(1);
    const game = state.games[0]!;
    expect(game.alsoFrom).toEqual(["gcRAPTORS001"]);
    expect(game.alsoRows?.map((row) => row.gameId)).toEqual(["r1"]);
    expect(state.teams.some((team) => team.name === "Summer Stars")).toBe(false);
    expect(raptorsSee(tidyPool(state).state)).toEqual(["3-13"]);
  });

  it("takes the schedule off the record when its answer files no row into the game", () => {
    // Two hours off: not the row the record stood for, but the claim step's, as the same result.
    const renamed = raptors([at("r1", "Summer Stars 11U", "19:30", 3, 13)]);
    const state = importGcSchedule(renamed, { ...joined, games: [before] }).state;
    const game = state.games.find((entry) => entry.id === before.id)!;
    expect(game.alsoFrom).toBeUndefined();
    expect(state.games).toHaveLength(2);
    const tidied = tidyPool(state).state;
    expect(tidied.games).toHaveLength(1);
    expect(raptorsSee(tidied)).toEqual(["3-13"]);
    expect(legacySees(tidied)).toEqual(["13-3"]);
  });

  /** The record's copy after the Raptors' pull brings `rows`, and what it holds. */
  const holderAfter = (state: GcImportState, ...rows: GcTeamSchedule["games"]) => {
    const pulled = importGcSchedule(raptors(rows), state).state;
    const game = pulled.games.find((entry) => entry.id === before.id)!;
    return { pulled, rows: game.alsoRows?.map((row) => row.gameId) ?? [], from: game.alsoFrom };
  };

  it("does not put back a row scored further apart than scorekeepers are", () => {
    const { rows, from } = holderAfter(
      { ...joined, games: [before] },
      at("r1", "Summer Stars 11U", "17:40", 12, 1)
    );
    expect(rows).toEqual([]);
    expect(from).toBeUndefined();
  });

  it("does not put back a row whose name finds a club somebody pulled", () => {
    const marlins = club("gcMARLINS001", "Marlins 11U", [at("m1", "Somebody 11U", "09:00", 1, 1)]);
    const withMarlins = pull({ ...joined, games: [before] }, marlins);
    const { pulled, rows } = holderAfter(withMarlins, at("r1", "Marlins 11U", "17:40", 3, 13));
    expect(rows).toEqual([]);
    const marlinsId = pulled.teams.find((team) => team.name === "Marlins")!.id;
    expect(pulled.games.some((game) => game.teamBId === marlinsId && game.teamAScore === 3)).toBe(
      true
    );
  });

  it("does not put back a row two copies holding the schedule on record could be", () => {
    const second: ScoutGame = {
      ...before,
      id: "gc_gcLEGACY0001_l2",
      startTs: "2026-08-29T17:50:00.000Z",
      source: { kind: "gamechanger", teamId: "gcLEGACY0001", gameId: "l2" },
    };
    const state = importGcSchedule(raptors([at("r1", "Summer Stars 11U", "17:40", 3, 13)]), {
      ...joined,
      games: [before, second],
    }).state;
    expect(state.games.flatMap((game) => game.alsoRows ?? [])).toEqual([]);
  });

  it("reads a row put back as any fold with nothing to say where it was filed", () => {
    // A run apart, ten minutes off: the claim step's to claim, so marked in the same pull.
    const { pulled } = holderAfter(
      { ...joined, games: [before] },
      at("r1", "Summer Stars 11U", "17:40", 3, 12)
    );
    const game = pulled.games.find((entry) => entry.id === before.id)!;
    const summer = pulled.teams.find((team) => team.name === "Summer Stars")!;
    expect(game.alsoRows?.map((row) => row.filedAgainst)).toEqual([summer.id]);
  });

  it("keeps it through an answer with no row to trust", () => {
    const state = importGcSchedule(raptors([]), { ...joined, games: [before] }).state;
    expect(state.games.find((entry) => entry.id === before.id)!.alsoFrom).toEqual(["gcRAPTORS001"]);
  });

  /*
   * Legacy's 6-3 at ten holds the Raptors' schedule on record; the Raptors' 3-12 at two is a second
   * meeting that only they list. Their row of the first game comes back against a name that finds
   * nobody, ten minutes off and a run apart. Filed as a game of its own, the record came off, the
   * claim step waited on the second meeting, and the regroup paired it with Legacy's copy by count:
   * a 3-12 folded into a 6-3, Legacy's 12-3 win gone.
   */
  it("keeps the day's second meeting apart from the game the record was", () => {
    const l2 = legacy([at("l1", RAPTORS, "10:00", 6, 3)]);
    const r2 = raptors([at("r1", LEGACY, "10:00", 3, 6), at("r2", LEGACY, "14:00", 3, 12)]);
    const both = [l2, r2].reduce(pull, empty);
    const copy = both.games.find((game) => game.id === "gc_gcLEGACY0001_l1")!;
    const { alsoRows: _held, reportedByB: _lent, ...kept } = copy;
    const onRecord: GcImportState = {
      ...both,
      games: both.games.map((game) =>
        game === copy ? { ...kept, alsoFrom: ["gcRAPTORS001"] } : game
      ),
    };
    const back = raptors([
      at("r1", "Gold Rush 11U", "10:10", 3, 7),
      at("r2", LEGACY, "14:00", 3, 12),
    ]);
    const state = pull(onRecord, back);
    expect(legacySees(state)).toEqual(["6-3", "12-3"]);
    expect(
      state.games.find((game) => game.id === copy.id)!.alsoRows?.map((row) => row.gameId)
    ).toEqual(["r1"]);
  });
});

/*
 * The third review's days. Each is read whole now (`planDay`) rather than a link at a time, and each
 * lost a result, or kept a game twice, while the strongest single link went first.
 */
describe("a doubleheader read as a whole day", () => {
  /** Whether two rows are one game, whichever of them holds it. */
  const together = (state: GcImportState, x: string, y: string) =>
    state.games.some((game) => {
      const rows = [
        game.id,
        ...(game.alsoRows ?? []).map((row) => gcRowId(row.teamId, row.gameId)),
      ];
      return rows.includes(x) && rows.includes(y);
    });
  const bothOrders = (l: GcTeamSchedule, r: GcTeamSchedule) => [
    [l, r].reduce(pull, empty),
    [r, l].reduce(pull, empty),
  ];

  // Legacy posted game 1, 8-11; the Raptors posted game 2, which ended by the same score.
  it("keeps both results when game 2 repeats game 1's score an hour on", () => {
    for (const slots of [
      ["09:00", "10:00"],
      ["09:00", "09:45"],
    ] as const) {
      const l = legacy([at("l1", RAPTORS, slots[0], 8, 11), at("l2", RAPTORS, slots[1])]);
      const r = raptors([at("r1", LEGACY, slots[0]), at("r2", LEGACY, slots[1], 11, 8)]);
      for (const state of bothOrders(l, r)) {
        expect(state.games).toHaveLength(2);
        expect(legacySees(state)).toEqual(["8-11", "8-11"]);
        expect(tidyPool(state).state.games).toBe(state.games);
      }
    }
  });

  // Two mercy-rule wins an hour apart; the Raptors have posted one of the two.
  it("keeps a mercy-rule doubleheader two games when the other club posted one", () => {
    const l = legacy([at("l0", RAPTORS, "13:00", 10, 0), at("l1", RAPTORS, "14:00", 10, 0)]);
    for (const r of [
      raptors([at("r0", LEGACY, "13:00", 0, 10), at("r1", LEGACY, "14:00")]),
      raptors([at("r0", LEGACY, "13:00"), at("r1", LEGACY, "14:00", 0, 10)]),
    ]) {
      for (const state of bothOrders(l, r)) {
        expect(state.games).toHaveLength(2);
        expect(legacySees(state)).toEqual(["10-0", "10-0"]);
      }
    }
  });

  // The Raptors' clock runs exactly an hour ahead of Legacy's, all day.
  it("pairs first with first when one clock is an hour out", () => {
    const l = (one?: [number, number]) =>
      legacy([at("l1", RAPTORS, "09:00", ...(one ?? [])), at("l2", RAPTORS, "10:00")]);
    const r = (two?: [number, number]) =>
      raptors([at("r1", LEGACY, "10:00"), at("r2", LEGACY, "11:00", ...(two ?? []))]);
    for (const state of bothOrders(l([5, 3]), r([7, 2]))) {
      expect(state.games).toHaveLength(2);
      expect(legacySees(state)).toEqual(["5-3", "2-7"]);
      expect(raptorsSee(state)).toEqual(["3-5", "7-2"]);
    }
    for (const state of [...bothOrders(l(), r()), ...bothOrders(l([5, 3]), r())]) {
      expect(state.games).toHaveLength(2);
    }
    // A tripleheader, the same hour out.
    const three = legacy([
      at("l1", RAPTORS, "09:00", 5, 3),
      at("l2", RAPTORS, "10:00"),
      at("l3", RAPTORS, "11:00", 4, 4),
    ]);
    const threeR = raptors([
      at("r1", LEGACY, "10:00"),
      at("r2", LEGACY, "11:00", 7, 2),
      at("r3", LEGACY, "12:00"),
    ]);
    for (const state of bothOrders(three, threeR)) {
      expect(state.games).toHaveLength(3);
      expect(legacySees(state)).toEqual(["5-3", "2-7", "4-4"]);
    }
  });

  /*
   * Legacy lists game 1 twice at 09:00, once scored 0-10 and once blank, and game 2 at 11:00. The
   * Raptors list only game 2, all day, as Legacy's 10-0 win: it contradicts game 1's score, so it is
   * game 2's, whichever id sorts first.
   */
  it("never pairs a copy with a game whose score it contradicts", () => {
    for (const blank of ["a1", "a9"]) {
      const l = legacy([
        at("a0", RAPTORS, "09:00", 0, 10),
        at(blank, RAPTORS, "09:00"),
        at("a2", RAPTORS, "11:00"),
      ]);
      const r = raptors([at("r0", LEGACY, undefined, 0, 10)]);
      for (const state of bothOrders(l, r)) {
        expect(state.games).toHaveLength(2);
        expect(legacySees(state).sort()).toEqual(["0-10", "10-0"]);
        const scored = state.games.find((game) => game.id === "gc_gcLEGACY0001_a0")!;
        expect(scored.reportedByB).toBeUndefined();
      }
    }
  });

  // The Raptors list game 1 twice, 09:00 and 09:50, and game 2 all day; Legacy lists 09:00 and 10:30.
  it("reads one club's game listed twice as one game beside a slot of the other's own", () => {
    const l = legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "10:30")]);
    const r = raptors([
      at("r1", LEGACY, "09:00", 0, 10),
      at("r1b", LEGACY, "09:50", 0, 10),
      at("r2", LEGACY, undefined),
    ]);
    for (const state of bothOrders(l, r)) {
      expect(state.games).toHaveLength(2);
      expect(legacySees(state).sort()).toEqual(["10-0", "unplayed"]);
    }
  });

  // Game 1 all day on the Raptors' schedule, their clock half an hour behind for games 2 and 3.
  it("places an all-day copy by its result in a tripleheader", () => {
    const l = legacy([
      at("l1", RAPTORS, "09:00", 3, 5),
      at("l2", RAPTORS, "10:30"),
      at("l3", RAPTORS, "12:00"),
    ]);
    const r = raptors([
      at("r1", LEGACY, undefined, 5, 3),
      at("r2", LEGACY, "10:00", 7, 2),
      at("r3", LEGACY, "11:30", 10, 0),
    ]);
    for (const state of bothOrders(l, r)) {
      expect(state.games).toHaveLength(3);
      expect(raptorsSee(state)).toEqual(["10-0", "5-3", "7-2"]);
    }
  });

  /*
   * The Raptors' copy posted at 10:30 is Legacy's 11:00 win, not the 10:00 one it contradicts, and
   * their blank 11:30 is a slot Legacy has no row for. A dispute is worth only a little more than
   * two games, so pairing in both clocks' order does not outbid a result that agrees.
   */
  it("lets a result that agrees outbid a dispute in the clocks' order", () => {
    const l = legacy([at("l1", RAPTORS, "10:00", 5, 3), at("l2", RAPTORS, "11:00", 7, 2)]);
    const r = raptors([at("r1", LEGACY, "10:30", 2, 7), at("r2", LEGACY, "11:30")]);
    for (const state of bothOrders(l, r)) {
      const agreed = state.games.find((game) =>
        [game.id, ...(game.alsoRows ?? []).map((row) => gcRowId(row.teamId, row.gameId))].includes(
          "gc_gcRAPTORS001_r1"
        )
      )!;
      expect(Math.abs(ratedMargin(agreed)!)).toBe(5);
    }
  });

  /*
   * Legacy's one game, a 17-5 win at 17:10; the Raptors have the 5-17 loss at 16:00, the game run
   * late, and a blank row at 17:00. The blank ten minutes off is not the game the result names: taken
   * for it, the 5-17 stood as a second game and one result counted twice.
   */
  it("pairs a game with the same result an hour and more off over a blank row beside it", () => {
    const l = legacy([at("l1", RAPTORS, "17:10", 17, 5)]);
    const r = raptors([at("r1", LEGACY, "16:00", 5, 17), at("r2", LEGACY, "17:00")]);
    for (const state of bothOrders(l, r)) {
      expect(raptorsSee(state)).toEqual(["5-17"]);
      expect(legacySees(state).filter((seen) => seen !== "unplayed")).toEqual(["17-5"]);
    }
    const allDay = raptors([at("r1", LEGACY, undefined, 5, 17), at("r2", LEGACY, "17:20")]);
    for (const state of bothOrders(l, allDay)) {
      expect(raptorsSee(state)).toEqual(["5-17"]);
    }
  });

  /*
   * The Raptors' one copy of the day is half an hour from Legacy's blank game 2 and five and a half
   * hours from game 1, which it repeats the score of. Taken for the blank game, the result counts
   * twice until Legacy posts game 2, and for good if game 2 was a slot never played; taken for game
   * 1, the worst is game 2 missing until it is posted — and once it is, the same result within the
   * hour puts the copy there.
   */
  it("pairs a copy with the game it repeats over a blank game beside it, until both are scored", () => {
    const l = (two?: [number, number]) =>
      legacy([at("l1", RAPTORS, "10:00", 12, 9), at("l2", RAPTORS, "16:00", ...(two ?? []))]);
    for (const time of ["15:30", "16:00"]) {
      const r = raptors([at("r1", LEGACY, time, 9, 12)]);
      for (const state of bothOrders(l(), r)) {
        expect(legacySees(state)).toEqual(["12-9", "unplayed"]);
        expect(raptorsSee(state)).toEqual(["9-12"]);
        const posted = pull(state, l([12, 9]));
        expect(legacySees(posted)).toEqual(["12-9", "12-9"]);
        expect(together(posted, "gc_gcRAPTORS001_r1", "gc_gcLEGACY0001_l2")).toBe(true);
      }
    }
  });

  // Two blank copies either side of Legacy's blank game, 31 and 29 minutes off: worth the same.
  it("breaks a tie between two pairings by the nearer start", () => {
    const l = legacy([at("l1", RAPTORS, "10:00")]);
    const r = raptors([at("ra", LEGACY, "09:29"), at("rb", LEGACY, "10:29")]);
    for (const state of bothOrders(l, r)) {
      expect(together(state, "gc_gcLEGACY0001_l1", "gc_gcRAPTORS001_rb")).toBe(true);
    }
  });

  // Legacy's one game, blank, against two all-day Raptors rows: the posted one fits fewer games.
  it("pairs a lone game with the all-day copy that has a result", () => {
    const l = legacy([at("l1", RAPTORS, "10:00")]);
    const r = raptors([at("ra", LEGACY, undefined), at("rb", LEGACY, undefined, 3, 5)]);
    for (const state of bothOrders(l, r)) {
      expect(legacySees(state).sort()).toEqual(["5-3", "unplayed"]);
      const lone = state.games.find((game) =>
        [game.id, ...(game.alsoRows ?? []).map((row) => gcRowId(row.teamId, row.gameId))].includes(
          "gc_gcLEGACY0001_l1"
        )
      )!;
      expect(Math.abs(ratedMargin(lone)!)).toBe(2);
    }
  });

  // Each club lists one game all day and the other at a start: the two all-day rows are not one.
  it("pairs each all-day copy with the other club's timed game", () => {
    const l = legacy([at("l1", RAPTORS, undefined), at("l2", RAPTORS, "11:00")]);
    const r = raptors([at("r1", LEGACY, "09:00"), at("r2", LEGACY, undefined, 3, 5)]);
    for (const state of bothOrders(l, r)) {
      expect(state.games).toHaveLength(2);
      expect(legacySees(state).sort()).toEqual(["5-3", "unplayed"]);
    }
  });
});

describe("a stand-in row beside the same club's own row of the game", () => {
  /*
   * Legacy lists its game against the Raptors and, the same day, an all-day game against "Bama
   * Ballers 11U", a club nobody pulled. The settle used to put the Bama Ballers row into the
   * Raptors game, and the regroup, finding Legacy's own row already there, stood it back up against
   * the Raptors: Legacy's 7-4 over the Bama Ballers became a loss the Raptors never played.
   */
  it("stays against the stand-in", () => {
    let state = pull(empty, raptors([at("r1", LEGACY, "10:00", 5, 2)]));
    const withBama = (score?: [number, number]) =>
      legacy([
        at("l1", RAPTORS, "10:00", 2, 5),
        at("l2", "Bama Ballers 11U", undefined, ...(score ?? [])),
      ]);
    state = pull(state, withBama());
    state = pull(state, withBama([7, 4]));
    expect(raptorsSee(state)).toEqual(["5-2"]);
    expect(legacySees(state).sort()).toEqual(["2-5", "7-4"]);
    expect(tidyPool(state).state.games).toBe(state.games);
  });

  // The Raptors' bracket game against "TBD", all day, beside their game against Legacy.
  it("keeps a bracket slot's result off the club the day's other game was against", () => {
    const r = (score?: [number, number]) =>
      raptors([at("r2", LEGACY, "13:00", 5, 2), at("r1", "TBD", undefined, ...(score ?? []))]);
    for (const order of [
      [legacy([at("l1", RAPTORS, "13:00", 2, 5)]), r()],
      [r(), legacy([at("l1", RAPTORS, "13:00", 2, 5)])],
    ]) {
      let state = order.reduce(pull, empty);
      state = pull(state, r([8, 1]));
      expect(legacySees(state)).toEqual(["2-5"]);
    }
  });
});

describe("a club's own game whose first row says nothing of the result", () => {
  // The Raptors delete their row, enter the game again at the same start, then post it all day.
  it("takes a re-entered row's start with its result, set or cleared", () => {
    let state = pull(empty, raptors([at("r1", LEGACY, "09:00")]));
    state = pull(state, raptors([at("r4", LEGACY, "09:00")]));
    state = pull(state, raptors([at("r4", LEGACY, undefined, 5, 3)]));
    expect(raptorsSee(state)).toEqual(["5-3"]);
    expect(state.games).toHaveLength(1);
    expect(state.games[0]!.startTs).toBeUndefined();
    // The game stands on the new row now: its next pulls, and Legacy's copy, find it.
    state = pull(state, raptors([at("r4", LEGACY, "11:00", 6, 3)]));
    expect(state.games[0]!.startTs).toBe("2026-08-29T11:00:00.000Z");
    // Found as its own row, not as a second listing of itself: its score is never "also reported".
    expect(state.games[0]!.note ?? "").not.toContain("6-3");
    state = pull(state, legacy([at("l1", RAPTORS, "11:00", 3, 6)]));
    expect(state.games).toHaveLength(1);
    expect(raptorsSee(state)).toEqual(["6-3"]);
    expect(legacySees(state)).toEqual(["3-6"]);
    expect(tidyPool(state).state.games).toBe(state.games);

    let twice = pull(empty, legacy([at("l1", RAPTORS, "09:00"), at("l1b", RAPTORS, "09:00")]));
    twice = pull(twice, legacy([at("l1b", RAPTORS, undefined, 5, 3)]));
    expect(legacySees(twice)).toEqual(["5-3"]);
  });

  // Legacy lists the game twice and scores only the second copy, then corrects it.
  it("takes a correction to the second listing", () => {
    const twice = (score: [number, number]) =>
      legacy([at("l1", RAPTORS, "09:00"), at("l1b", RAPTORS, "09:00", ...score)]);
    let state = pull(empty, twice([5, 3]));
    state = pull(state, twice([7, 3]));
    expect(legacySees(state)).toEqual(["7-3"]);
    expect(state.games[0]!.note).toBeUndefined();

    const r = (score: [number, number]) =>
      raptors([at("r1", LEGACY, "09:00"), at("r1b", LEGACY, "09:00", ...score)]);
    let other = [r([5, 3]), legacy([at("l1", RAPTORS, "09:00")])].reduce(pull, empty);
    other = pull(other, r([7, 3]));
    expect(raptorsSee(other)).toEqual(["7-3"]);
    expect(legacySees(other)).toEqual(["3-7"]);
  });
});

describe("a cross-age game's copy stood back up", () => {
  /*
   * Legacy's 11U and the Raptors' 12U list one game at 10:00, filed under each club's own page and
   * folded into one. The Raptors then move theirs to 14:00 and list the 10:00 game again under a
   * new id — they played twice, and Legacy lists one — so their moved row stands up as a game of
   * its own, under their own page, where a refresh of that page alone finds it by id.
   */
  it("is filed under its own club's page", () => {
    const raptors12 = (games: GcTeamSchedule["games"]): GcTeamSchedule => ({
      ...club("gcRAPTORS001", "River City Raptors 12U", games),
      profile: {
        id: "gcRAPTORS001",
        name: "River City Raptors 12U",
        ageLevel: 12,
        season: { season: "fall", year: 2026 },
      },
    });
    let state = [
      legacy([at("l1", "River City Raptors 12U", "10:00")]),
      raptors12([at("r1", LEGACY, "10:00")]),
    ].reduce(pull, empty);
    expect(state.games).toHaveLength(1);
    state = pull(state, raptors12([at("r1", LEGACY, "14:00"), at("r2", LEGACY, "10:00")]));
    expect(state.games).toHaveLength(2);
    const page = (id: string) =>
      state.ageGroups.find((group) => group.id === state.games.find((g) => g.id === id)?.ageGroupId)
        ?.ageLevel;
    expect(page("gc_gcRAPTORS001_r1")).toBe(12);
    expect(page("gc_gcLEGACY0001_l1")).toBe(11);
  });
});

describe("one row filed twice under one id", () => {
  // A refresh of one page files a row the pool already holds on another: one GameChanger row.
  it("is kept once by the tidy, not dropped with its copy", () => {
    const state = pull(empty, raptors([at("r1", LEGACY, "10:00")]));
    const [game] = state.games;
    const twice: GcImportState = {
      ...state,
      games: [game!, { ...game!, teamAScore: 7, teamBScore: 2 }],
    };
    const tidied = tidyPool(twice).state;
    expect(tidied.games).toHaveLength(1);
    expect(raptorsSee(tidied)).toEqual(["7-2"]);
  });
});

/*
 * The fourth review's days: the whole-day reading itself. Each counted a result twice, lost one, or
 * read the same rows two ways depending on the order they were pulled in.
 */
describe("a day read the same whatever order its rows came in", () => {
  const bothOrders = (l: GcTeamSchedule, r: GcTeamSchedule) => [
    [l, r].reduce(pull, empty),
    [r, l].reduce(pull, empty),
  ];
  const permutations = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, at) =>
          permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [
            item,
            ...rest,
          ])
        );
  /** Which rows went together, whichever of them holds each game. */
  const grouping = (games: ScoutGame[]) =>
    games
      .map((game) =>
        [game.id, ...(game.alsoRows ?? []).map((row) => gcRowId(row.teamId, row.gameId))]
          .sort()
          .join(",")
      )
      .sort();
  const u11: AgeGroup = { id: "u11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] };
  const bare = (
    schedule: string,
    id: string,
    a: string,
    b: string,
    time: string | undefined,
    score?: [number, number]
  ): ScoutGame => ({
    id: `gc_${schedule}_${id}`,
    teamAId: a,
    teamBId: b,
    ageGroupId: "u11",
    date: "2026-08-29",
    ...(time ? { startTs: `2026-08-29T${time}:00.000Z` } : {}),
    ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
    source: { kind: "gamechanger", teamId: schedule, gameId: id },
  });
  const sameEveryWay = (rows: ScoutGame[]) => {
    const readings = new Set(
      permutations(rows).map((order) =>
        JSON.stringify(grouping(collapseSameGames(order, [u11]).games))
      )
    );
    expect(readings.size).toBe(1);
  };

  /*
   * Legacy lost a mercy-rule doubleheader 0-10 twice: game 1 listed twice at 09:00, once scored and
   * once blank, game 2 at 10:00. The Raptors list game 1 all day, blank, and game 2 at 10:00.
   */
  it("keeps a doubleheader's two results in either pull order", () => {
    const l = legacy([
      at("l0", RAPTORS, "09:00", 0, 10),
      at("l1", RAPTORS, "09:00"),
      at("l3", RAPTORS, "10:00", 0, 10),
    ]);
    const r = raptors([at("r2", LEGACY, undefined), at("r4", LEGACY, "10:00", 10, 0)]);
    for (const state of bothOrders(l, r)) {
      expect(legacySees(state).filter((seen) => seen !== "unplayed")).toEqual(["0-10", "0-10"]);
    }
    sameEveryWay([
      bare("gcL", "l0", "L", "R", "09:00", [0, 10]),
      bare("gcL", "l1", "L", "R", "09:00"),
      bare("gcL", "l3", "L", "R", "10:00", [0, 10]),
      bare("gcR", "r2", "R", "L", undefined),
      bare("gcR", "r4", "R", "L", "10:00", [10, 0]),
    ]);
    // The Raptors' clock an hour ahead, and game 2 blank on their side and all day.
    const l2 = legacy([at("l1", RAPTORS, "09:00", 3, 5), at("l2", RAPTORS, "10:00", 3, 5)]);
    const r2 = raptors([at("r1", LEGACY, "10:00", 5, 3), at("r2", LEGACY, undefined)]);
    for (const state of bothOrders(l2, r2)) {
      expect(legacySees(state).filter((seen) => seen !== "unplayed")).toEqual(["3-5", "3-5"]);
    }
  });

  // One schedule lists a game twice at 09:00 with two scores, and one of them again at 09:40.
  it("reads a game listed twice with two scores the same whichever row came first", () => {
    sameEveryWay([
      bare("gcL", "a1", "L", "R", "09:00", [5, 3]),
      bare("gcL", "a2", "L", "R", "09:00", [7, 2]),
      bare("gcL", "a3", "L", "R", "09:40", [7, 2]),
    ]);
  });

  it("reads a crowded day the same whichever row came first", () => {
    sameEveryWay([
      bare("gcR", "r2", "R", "L", "10:30", [10, 0]),
      bare("gcR", "r3", "R", "L", "09:30", [4, 4]),
      bare("gcR", "r4", "R", "L", "12:00"),
      bare("gcR", "r5", "R", "L", "10:00", [10, 0]),
      bare("gcL", "l0", "L", "R", "11:00", [3, 5]),
      bare("gcL", "l1", "L", "R", undefined, [6, 3]),
    ]);
  });

  /*
   * One game at 10:00, its scorekeepers a run apart, beside a blank game one club lists all day or
   * later. The disputed copy is the game at its own start, not a result for the blank one.
   */
  it("keeps a dispute at one start one game beside a blank game", () => {
    const scored = (state: GcImportState) =>
      legacySees(state).filter((seen) => seen !== "unplayed");
    for (const [l, r] of [
      [
        legacy([at("l1", RAPTORS, "10:00", 4, 4), at("l0", RAPTORS, undefined)]),
        raptors([at("r2", LEGACY, "10:00", 5, 4)]),
      ],
      [
        legacy([at("l1", RAPTORS, "10:00", 4, 4)]),
        raptors([at("r2", LEGACY, "10:10", 5, 4), at("r0", LEGACY, undefined)]),
      ],
      [
        legacy([at("l1", RAPTORS, "10:00", 4, 4), at("l2", RAPTORS, "10:45")]),
        raptors([at("r2", LEGACY, "10:00", 5, 4)]),
      ],
      [
        legacy([at("l1", RAPTORS, "09:00", 7, 2), at("l0", RAPTORS, undefined)]),
        raptors([at("r1", LEGACY, "09:00", 3, 7), at("r0", LEGACY, undefined)]),
      ],
    ] as const) {
      for (const state of bothOrders(l, r)) expect(scored(state)).toHaveLength(1);
    }
  });

  // Both clubs list the one result all day; each also lists a blank game the other does not.
  it("keeps two clubs' all-day copies of one result together", () => {
    for (const time of ["15:00", "10:15"]) {
      const l = legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, undefined, 5, 3)]);
      const r = raptors([at("r1", LEGACY, time), at("r2", LEGACY, undefined, 3, 5)]);
      for (const state of bothOrders(l, r)) {
        expect(legacySees(state).filter((seen) => seen !== "unplayed")).toEqual(["5-3"]);
      }
    }
  });

  // The Raptors list their 5-3 win twice, 11:45 and 12:05; Legacy's blank copy is at 12:50.
  it("keeps a game listed twice one game beside the other club's blank copy", () => {
    const r = raptors([at("r4", LEGACY, "11:45", 5, 3), at("r5", LEGACY, "12:05", 5, 3)]);
    const l = legacy([at("l3", RAPTORS, "12:50")]);
    for (const state of bothOrders(l, r)) expect(raptorsSee(state)).toEqual(["5-3"]);
    const l2 = legacy([at("l1", RAPTORS, "09:00", 10, 0), at("l2", RAPTORS, "09:20", 10, 0)]);
    const r2 = raptors([at("r1", LEGACY, "10:15")]);
    for (const state of bothOrders(l2, r2)) {
      expect(legacySees(state).filter((seen) => seen !== "unplayed")).toEqual(["10-0"]);
    }
  });
});

describe("a score given to a game by the same club's second listing", () => {
  const scored = (state: GcImportState) => legacySees(state).filter((seen) => seen !== "unplayed");

  // A doubleheader first listed at one placeholder start, game 1 posted on the second row.
  it("goes with the listing when the two rows turn out to be two games", () => {
    let state = pull(empty, legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "09:00")]));
    state = pull(state, legacy([at("l1", RAPTORS, "11:00"), at("l2", RAPTORS, "09:00", 5, 3)]));
    expect(legacySees(state)).toEqual(["5-3", "unplayed"]);

    // The score first, the move after, the other club's copies, then game 2 cancelled by both.
    let later = pull(empty, legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "09:00")]));
    later = pull(later, legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "09:00", 5, 3)]));
    later = pull(later, legacy([at("l1", RAPTORS, "11:00"), at("l2", RAPTORS, "09:00", 5, 3)]));
    later = pull(later, raptors([at("r1", LEGACY, "09:00", 3, 5), at("r2", LEGACY, "11:00")]));
    expect(legacySees(later)).toEqual(["5-3", "unplayed"]);
    later = pull(later, legacy([at("l2", RAPTORS, "09:00", 5, 3)]));
    later = pull(later, raptors([at("r1", LEGACY, "09:00", 3, 5)]));
    expect(scored(later)).toEqual(["5-3"]);

    // Game 2 posted while both rows sat at 09:00, then moved to its own start.
    let moved = pull(empty, legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "09:00")]));
    moved = pull(moved, legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "09:00", 5, 3)]));
    moved = pull(moved, legacy([at("l1", RAPTORS, "09:00"), at("l2", RAPTORS, "11:00", 5, 3)]));
    expect(legacySees(moved)).toEqual(["unplayed", "5-3"]);
  });

  // The game's own row is deleted; a blank listing of it and a re-entered scored one remain.
  it("does not keep a deleted row's result when a blank listing takes the game over", () => {
    let state = pull(empty, legacy([at("l0", RAPTORS, "13:00", 4, 4), at("l3", RAPTORS, "13:00")]));
    state = pull(state, legacy([at("l3", RAPTORS, "13:00"), at("l6", RAPTORS, "13:00", 4, 4)]));
    state = pull(state, legacy([at("l3", RAPTORS, "13:00"), at("l6", RAPTORS, "11:00", 4, 4)]));
    expect(scored(state)).toEqual(["4-4"]);
  });

  // One game listed twice, 5-3 both times; the user types 6-3 over it.
  it("keeps a typed score one game where the club listed it twice", () => {
    let state = pull(
      empty,
      legacy([at("l1", RAPTORS, "09:00", 5, 3), at("l2", RAPTORS, "09:40", 5, 3)])
    );
    expect(state.games).toHaveLength(1);
    state = tidyPool({
      ...state,
      games: state.games.map((game) => withScoreTyped(game, 6, 3)),
    }).state;
    expect(legacySees(state)).toEqual(["6-3"]);
  });
});

describe("a row a refresh of one page files again", () => {
  // Legacy is a club of its own in the pool, pulled, with its game against the Raptors another day.
  const elsewhere = {
    ...at("l0", RAPTORS, "08:00"),
    date: "2026-08-30",
    startTs: "2026-08-30T08:00:00.000Z",
  };
  const raptors12 = (games: GcTeamSchedule["games"]): GcTeamSchedule => ({
    ...club("gcRAPTORS001", "River City Raptors 12U", games),
    profile: {
      id: "gcRAPTORS001",
      name: "River City Raptors 12U",
      ageLevel: 12,
      season: { season: "fall", year: 2026 },
    },
  });
  const levelOf = (state: GcImportState, ageGroupId: string) =>
    state.ageGroups.find((group) => group.id === ageGroupId)?.ageLevel;
  /** A refresh of the 12U page alone: it sees only that page's games, and saves only them. */
  const refresh12 = (state: GcImportState, schedule: GcTeamSchedule): GcImportState => {
    const onPage = (game: ScoutGame) => levelOf(state, game.ageGroupId) === 12;
    const section = importGcSchedule(schedule, {
      ...state,
      games: state.games.filter(onPage),
    }).state;
    return {
      ...section,
      games: [...state.games.filter((game) => !onPage(game)), ...section.games],
    };
  };

  /*
   * The Raptors' copy of an 11U-12U game, written against "LBC", was settled into Legacy's game on
   * the 11U page. A refresh of the 12U page cannot see that game and files the row again against
   * the stand-in; the tidy after the run settles it back, since the row the game holds of the
   * Raptors' schedule is this very row.
   */
  it("settles back into the game that holds it", () => {
    const l = legacy([at("l1", "River City Raptors 12U", "10:00", 3, 5)]);
    const r = raptors12([at("r1", "LBC", "10:30", 5, 3)]);
    let state = [l, r].reduce(pull, empty);
    expect(state.games).toHaveLength(1);
    state = tidyPool(refresh12(state, r)).state;
    expect(state.games).toHaveLength(1);
    expect(legacySees(state)).toEqual(["3-5"]);
  });

  /*
   * Two copies of one row: a stale one against the real club and the refresh's, scored, against a
   * stand-in. One game stays, against the real club, with the result the refresh brought.
   */
  it("keeps one copy, against the real club, with the newer result", () => {
    let state = [legacy([elsewhere]), raptors([at("r1", LEGACY, "13:00")])].reduce(pull, empty);
    const stale = state.games.find((game) => game.id === "gc_gcRAPTORS001_r1")!;
    const standIn = { id: "S-LBC", name: "LBC", nameOnly: true as const };
    state = {
      ...state,
      teams: [...state.teams, standIn],
      games: [...state.games, { ...stale, teamBId: standIn.id, teamAScore: 6, teamBScore: 0 }],
    };
    const tidied = tidyPool(state).state;
    expect(tidied.games.filter((game) => game.id === "gc_gcRAPTORS001_r1")).toHaveLength(1);
    expect(raptorsSee(tidied)).toEqual(["6-0"]);
    expect(legacySees(tidied)).toEqual(["0-6", "unplayed"]);
  });

  // A game that took over a re-entered row, and a refresh's copy of that row under the row's id.
  it("keeps one game for a row filed under two ids", () => {
    let state = pull(empty, legacy([elsewhere]));
    state = pull(state, raptors([at("r1", LEGACY, "13:00")]));
    state = pull(state, raptors([at("r2", LEGACY, "13:00")]));
    state = pull(state, raptors([at("r2", LEGACY, undefined, 6, 0)]));
    const held = state.games.find((game) => game.source?.gameId === "r2")!;
    expect(held.id).toBe("gc_gcRAPTORS001_r1");
    const copy: ScoutGame = { ...held, id: "gc_gcRAPTORS001_r2" };
    const tidied = tidyPool({ ...state, games: [...state.games, copy] }).state;
    expect(raptorsSee(tidied)).toEqual(["6-0"]);
  });
});

describe("a club's own row posting over its second listing's score", () => {
  // Legacy lists the game twice at 09:00 and scores the second copy first, then the first, 6-3.
  it("takes the row the game stands on at its word", () => {
    let state = pull(
      empty,
      legacy([at("l1", RAPTORS, "09:00"), at("l1b", RAPTORS, "09:00", 5, 3)])
    );
    expect(legacySees(state)).toEqual(["5-3"]);
    state = pull(
      state,
      legacy([at("l1", RAPTORS, "09:00", 6, 3), at("l1b", RAPTORS, "09:00", 5, 3)])
    );
    expect(legacySees(state)).toEqual(["6-3"]);
    expect(state.games[0]!.note).toContain("5-3");
  });
});

describe("two different results between the same two clubs", () => {
  const bothOrders = (l: GcTeamSchedule, r: GcTeamSchedule) => [
    [l, r].reduce(pull, empty),
    [r, l].reduce(pull, empty),
  ];

  /*
   * Scorekeepers who disagree are one game when nothing reads better, however wide the gap: a
   * 10-11 loss the other club typed as 10-20 a quarter of an hour on, and a 13-6 win the other club
   * entered from the wrong seat, both from the pool of 24 September 2026.
   */
  it("are one game a slip apart", () => {
    const typo = bothOrders(
      legacy([at("l1", RAPTORS, "16:00", 16, 13), at("l2", RAPTORS, "18:15", 10, 11)]),
      raptors([at("r1", LEGACY, "18:00", 20, 10)])
    );
    for (const state of typo) expect(state.games).toHaveLength(2);
    const seat = bothOrders(
      legacy([at("l1", RAPTORS, "14:30", 9, 4), at("l2", RAPTORS, "16:30", 13, 6)]),
      raptors([at("r1", LEGACY, "17:00", 13, 6)])
    );
    for (const state of seat) expect(state.games).toHaveLength(2);
  });

  /*
   * A wide dispute is worth no more than the least of them, and is no reason to keep a result off
   * a blank game. Legacy lists its 0-10 twice, 09:00 and 09:20; the Raptors list it all day and
   * blank, and a 4-4 at 10:15 Legacy does not list.
   */
  it("are no reason to keep a result off a blank game when far apart", () => {
    const l = legacy([at("l0", RAPTORS, "09:00", 0, 10), at("l1", RAPTORS, "09:20", 0, 10)]);
    const r = raptors([at("r2", LEGACY, undefined), at("r3", LEGACY, "10:15", 4, 4)]);
    for (const state of bothOrders(l, r)) {
      expect(
        legacySees(state)
          .filter((seen) => seen !== "unplayed")
          .sort()
      ).toEqual(["0-10", "4-4"]);
    }
  });

  // The Raptors' clock an hour behind Legacy's; Legacy's 4-4 at 10:00 is a game they do not list.
  it("do not outbid a clock an hour out when far apart at one start", () => {
    const l = legacy([
      at("l0", RAPTORS, "09:00"),
      at("l2", RAPTORS, "10:00", 4, 4),
      at("l3", RAPTORS, "11:00"),
      at("l5", RAPTORS, "12:00", 10, 0),
    ]);
    const r = raptors([
      at("r1", LEGACY, "08:00", 0, 10),
      at("r4", LEGACY, "10:00", 0, 10),
      at("r6", LEGACY, "11:00"),
    ]);
    for (const state of bothOrders(l, r)) {
      expect(legacySees(state).sort()).toEqual(["10-0", "10-0", "10-0", "4-4"]);
    }
  });
});

/*
 * Two clubs each list every game they play against each other, so a game on one schedule that
 * nothing on the other accounts for is one of the other's, under a clock or a score that did not
 * read as it. Each shape here is one the pool of 24 September 2026 counted twice.
 */
describe("a game each club lists that the other's games do not account for", () => {
  const bothOrders = (l: GcTeamSchedule, r: GcTeamSchedule) => [
    [l, r].reduce(pull, empty),
    [r, l].reduce(pull, empty),
  ];
  /** Which rows each game holds, as sorted ids. */
  const together = (state: GcImportState) =>
    state.games
      .map((game) =>
        [game.id, ...(game.alsoRows ?? []).map((row) => gcRowId(row.teamId, row.gameId))]
          .sort()
          .join(",")
      )
      .sort();

  it("is one game a side whatever the two clocks say", () => {
    for (const [l, r] of [
      // Neither scored, two hours apart: another zone's clock, or a tournament running behind.
      [legacy([at("l1", RAPTORS, "13:00")]), raptors([at("r1", LEGACY, "15:00")])],
      // One scored, the other's copy five hours on.
      [legacy([at("l1", RAPTORS, "12:00", 5, 8)]), raptors([at("r1", LEGACY, "17:00")])],
      // AM typed for PM.
      [legacy([at("l1", RAPTORS, "03:00")]), raptors([at("r1", LEGACY, "15:00")])],
      // Both scored, a run apart and two hours apart.
      [legacy([at("l1", RAPTORS, "15:00", 10, 8)]), raptors([at("r1", LEGACY, "17:00", 6, 9)])],
    ] as const) {
      for (const state of bothOrders(l, r)) expect(state.games).toHaveLength(1);
    }
  });

  it("keeps the game's own score on each club's page", () => {
    const l = legacy([at("l1", RAPTORS, "12:00", 5, 8)]);
    for (const state of bothOrders(l, raptors([at("r1", LEGACY, "17:00")]))) {
      expect(legacySees(state)).toEqual(["5-8"]);
      expect(raptorsSee(state)).toEqual(["8-5"]);
    }
    const r = raptors([at("r1", LEGACY, "17:00", 9, 6)]);
    for (const state of bothOrders(legacy([at("l1", RAPTORS, "15:00", 10, 8)]), r)) {
      expect(legacySees(state)).toEqual(["10-8"]);
      expect(raptorsSee(state)).toEqual(["9-6"]);
    }
  });

  it("pairs two a side in both schedules' order", () => {
    /*
     * A doubleheader on a clock four and a half hours out, the Raptors' ids sorting against their
     * starts. Neither club's copies scored yet; then Legacy's second game won 9-4 and the Raptors'
     * first lost 2-7, four runs from reading as one game: they are the two wins they are.
     */
    for (const [l1, l2, r1, r2] of [
      [[], [], [], []],
      [[], [9, 4], [2, 7], []],
    ] as const) {
      const l = legacy([at("l1", RAPTORS, "17:30", ...l1), at("l2", RAPTORS, "19:30", ...l2)]);
      const r = raptors([at("r9", LEGACY, "13:00", ...r1), at("r1", LEGACY, "15:00", ...r2)]);
      for (const state of bothOrders(l, r)) {
        expect(together(state)).toEqual([
          "gc_gcLEGACY0001_l1,gc_gcRAPTORS001_r9",
          "gc_gcLEGACY0001_l2,gc_gcRAPTORS001_r1",
        ]);
      }
    }
    // A clock three hours out, more than the time between the games: still first with first.
    const l = legacy([at("l1", RAPTORS, "17:00"), at("l2", RAPTORS, "18:30", 4, 4)]);
    const r = raptors([at("rB", LEGACY, "20:00", 2, 7), at("rA", LEGACY, "21:30")]);
    for (const state of bothOrders(l, r)) {
      expect(together(state)).toEqual([
        "gc_gcLEGACY0001_l1,gc_gcRAPTORS001_rB",
        "gc_gcLEGACY0001_l2,gc_gcRAPTORS001_rA",
      ]);
    }
  });

  /*
   * Legacy lists one game, a 3-14 loss at 04:30; the Raptors list a 13-3 win at 16:30 and a 3-1 win
   * at 18:30. The loss is the 13-3, typed twelve hours out and scored a run apart; the 3-1 is a
   * second game Legacy does not list.
   */
  it("gives the shorter list's game to the copy that reads most like it", () => {
    const l = legacy([at("l1", RAPTORS, "04:30", 3, 14)]);
    const r = raptors([at("r1", LEGACY, "16:30", 13, 3), at("r2", LEGACY, "18:30", 3, 1)]);
    for (const state of bothOrders(l, r)) {
      expect(together(state)).toEqual([
        "gc_gcLEGACY0001_l1,gc_gcRAPTORS001_r1",
        "gc_gcRAPTORS001_r2",
      ]);
      expect(legacySees(state).sort()).toEqual(["1-3", "3-14"]);
    }
    // An 8-3 win at 19:00 is the 6-8 loss at 15:30, a run apart, not the nearer 0-2.
    const runs = bothOrders(
      legacy([at("l1", RAPTORS, "15:30", 6, 8), at("l2", RAPTORS, "17:00", 0, 2)]),
      raptors([at("r1", LEGACY, "19:00", 8, 3)])
    );
    for (const state of runs) {
      expect(together(state)).toEqual([
        "gc_gcLEGACY0001_l1,gc_gcRAPTORS001_r1",
        "gc_gcLEGACY0001_l2",
      ]);
    }
    // Neither scored: the copy twelve hours out, rather than the nearer one.
    const blank = bothOrders(
      legacy([at("l1", RAPTORS, "13:00"), at("l2", RAPTORS, "15:00")]),
      raptors([at("r1", LEGACY, "03:00")])
    );
    for (const state of blank) {
      expect(together(state)).toEqual([
        "gc_gcLEGACY0001_l1",
        "gc_gcLEGACY0001_l2,gc_gcRAPTORS001_r1",
      ]);
    }
  });

  // Six a side is past what the plan weighs, and the links settle it (`sameGameGroups`).
  it("is counted the same on a day too crowded to plan", () => {
    const hours = ["08", "09", "10", "11", "12"];
    const l = legacy([
      ...hours.map((hour, i) => at(`l${i}`, RAPTORS, `${hour}:00`)),
      at("l5", RAPTORS, "13:00"),
    ]);
    const r = raptors([
      ...hours.map((hour, i) => at(`r${i}`, LEGACY, `${hour}:00`)),
      at("r5", LEGACY, "18:00"),
    ]);
    for (const state of bothOrders(l, r)) {
      expect(state.games).toHaveLength(6);
      expect(together(state)).toContain("gc_gcLEGACY0001_l5,gc_gcRAPTORS001_r5");
    }
  });

  it("never takes apart a game the links paired, or a second meeting's own game", () => {
    // Legacy lists two games, the Raptors one that agrees with the first: the second stays.
    const l = legacy([at("l1", RAPTORS, "10:00", 5, 3), at("l2", RAPTORS, "16:00", 2, 1)]);
    for (const state of bothOrders(l, raptors([at("r1", LEGACY, "10:30", 3, 5)]))) {
      expect(together(state)).toEqual([
        "gc_gcLEGACY0001_l1,gc_gcRAPTORS001_r1",
        "gc_gcLEGACY0001_l2",
      ]);
    }
  });
});

/*
 * One club dated the game a day off the other: a date typed a day out, or a game moved to the next
 * day on one schedule only. Each day alone holds one club's copy, and each copy counted as a game.
 */
describe("a game one club dated a day off the other's", () => {
  const bothOrders = (l: GcTeamSchedule, r: GcTeamSchedule) => [
    [l, r].reduce(pull, empty),
    [r, l].reduce(pull, empty),
  ];
  const onDay = (
    date: string,
    id: string,
    opponentName: string,
    time: string | undefined,
    teamScore?: number,
    opponentScore?: number
  ) => ({
    ...at(id, opponentName, time, teamScore, opponentScore),
    date,
    ...(time ? { startTs: `${date}T${time}:00.000Z` } : {}),
  });
  const days = (state: GcImportState) => state.games.map((game) => game.date).sort();

  it("is one game on the same result, or the same start a day apart", () => {
    for (const [l, r] of [
      // The same result at the same clock.
      [
        legacy([at("l1", RAPTORS, "19:10", 6, 1)]),
        raptors([onDay("2026-08-30", "r1", LEGACY, "19:10", 1, 6)]),
      ],
      // The same result at another clock.
      [
        legacy([at("l1", RAPTORS, "20:00", 6, 1)]),
        raptors([onDay("2026-08-30", "r1", LEGACY, "17:00", 1, 6)]),
      ],
      // The same start, neither scored yet.
      [legacy([at("l1", RAPTORS, "10:00")]), raptors([onDay("2026-08-30", "r1", LEGACY, "10:00")])],
      // The same start, the scorekeepers a run apart.
      [
        legacy([at("l1", RAPTORS, "10:00", 5, 4)]),
        raptors([onDay("2026-08-30", "r1", LEGACY, "10:00", 5, 5)]),
      ],
    ] as const) {
      for (const state of bothOrders(l, r)) {
        expect(state.games).toHaveLength(1);
        expect(tidyPool(state).state.games).toBe(state.games);
      }
    }
    const [state] = bothOrders(
      legacy([at("l1", RAPTORS, "19:10", 6, 1)]),
      raptors([onDay("2026-08-30", "r1", LEGACY, "19:10", 1, 6)])
    );
    expect(legacySees(state!)).toEqual(["6-1"]);
    expect(raptorsSee(state!)).toEqual(["1-6"]);
  });

  it("is two games on a result that differs hours apart, or nothing at all", () => {
    for (const [l, r] of [
      // The same start a day off, but two results that name different winners by ten runs.
      [
        legacy([at("l1", RAPTORS, "14:00", 7, 12)]),
        raptors([onDay("2026-08-30", "r1", LEGACY, "14:00", 3, 15)]),
      ],
      [
        legacy([at("l1", RAPTORS, "20:00", 6, 1)]),
        raptors([onDay("2026-08-30", "r1", LEGACY, "12:00", 2, 6)]),
      ],
      [legacy([at("l1", RAPTORS, "20:00")]), raptors([onDay("2026-08-30", "r1", LEGACY, "12:00")])],
    ] as const) {
      for (const state of bothOrders(l, r))
        expect(days(state)).toEqual(["2026-08-29", "2026-08-30"]);
    }
  });

  it("is two games where either club lists another game those days that it could be", () => {
    const l = legacy([at("l1", RAPTORS, "19:10", 6, 1)]);
    const r = raptors([
      at("r0", LEGACY, "12:00", 3, 3),
      onDay("2026-08-30", "r1", LEGACY, "19:10", 1, 6),
    ]);
    for (const state of bothOrders(l, r)) expect(state.games).toHaveLength(2);
  });

  /*
   * Legacy's two GameChanger teams and the Raptors each list a game on the first day that nothing
   * pairs, so which of the Raptors' games Legacy's is stays open: none joins across the night.
   */
  it("is left alone where the first day holds both clubs' unpaired games", () => {
    const u11: AgeGroup = { id: "u11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] };
    const row = (
      schedule: string,
      id: string,
      a: string,
      b: string,
      date: string,
      time: string
    ): ScoutGame => ({
      id: `gc_${schedule}_${id}`,
      teamAId: a,
      teamBId: b,
      ageGroupId: "u11",
      date,
      startTs: `${date}T${time}:00.000Z`,
      source: { kind: "gamechanger", teamId: schedule, gameId: id },
    });
    const rows = [
      row("gcL1", "l1", "L", "R", "2026-08-29", "10:00"),
      row("gcL2", "l2", "L", "R", "2026-08-29", "14:00"),
      row("gcR", "r1", "R", "L", "2026-08-29", "20:00"),
      row("gcR", "r2", "R", "L", "2026-08-30", "10:00"),
    ];
    expect(collapseSameGames(rows, [u11]).games).toBe(rows);
  });

  /*
   * Legacy lists its 9-10 loss on the Saturday and a blank placeholder at midnight on the Sunday;
   * the Raptors list their 10-9 win on the Sunday. The win is the Saturday's game, not a result for
   * the Sunday's blank one, which held it while each day was counted alone, and the loss counted
   * twice.
   */
  it("takes the same result a day off before a day's own count", () => {
    const l = legacy([
      at("l1", RAPTORS, "17:00", 9, 10),
      onDay("2026-08-30", "l2", RAPTORS, "00:00"),
    ]);
    const r = raptors([onDay("2026-08-30", "r1", LEGACY, "13:00", 10, 9)]);
    for (const state of bothOrders(l, r)) {
      expect(legacySees(state)).toEqual(["9-10", "unplayed"]);
      expect(raptorsSee(state)).toEqual(["10-9"]);
      expect(tidyPool(state).state.games).toBe(state.games);
    }
  });

  // One instant, dated in two zones: 16:55 UTC is the 29th on one schedule and the 30th on the other.
  it("is one game at the same instant dated a day apart, whatever it says", () => {
    const same = (id: string, opponent: string, score?: [number, number]) => ({
      ...at(id, opponent, "16:55", ...(score ?? [])),
      date: "2026-08-30",
    });
    for (const [l, r] of [
      [legacy([at("l1", RAPTORS, "16:55", 12, 4)]), raptors([same("r1", LEGACY, [4, 13])])],
      [legacy([at("l1", RAPTORS, "16:55")]), raptors([same("r1", LEGACY)])],
    ] as const) {
      for (const state of bothOrders(l, r)) expect(state.games).toHaveLength(1);
    }
  });

  /*
   * Two mercy-rule wins, one each day: the Raptors win 10-0 on the Saturday and again on the
   * Sunday, each club scoring one of the two and listing the other blank. Each day's count pairs
   * its own two copies; the same result across the night is no reason to take them apart.
   */
  it("keeps a doubleheader over two days that repeats its score", () => {
    const l = legacy([
      at("l1", RAPTORS, "13:00"),
      onDay("2026-08-30", "l2", RAPTORS, "18:30", 0, 10),
    ]);
    const r = raptors([
      at("r1", LEGACY, "15:00", 10, 0),
      onDay("2026-08-30", "r2", LEGACY, "16:30"),
    ]);
    for (const state of bothOrders(l, r)) {
      expect(state.games).toHaveLength(2);
      expect(legacySees(state)).toEqual(["0-10", "0-10"]);
    }
  });

  /*
   * The Raptors date their games a day early. Legacy's 9-4 win is the Raptors' copy the day before;
   * the other copy on Legacy's day, a 5-3, would make only a dispute of it, and the blank game the
   * day before is the Raptors' other copy's. The 9-4 counts once and the 5-3 stays a result.
   */
  it("takes the same result a day off over a day's own dispute", () => {
    const l = legacy([
      at("l2", RAPTORS, "11:30"),
      onDay("2026-08-30", "l6", RAPTORS, "12:00", 9, 4),
    ]);
    const r = raptors([
      at("r7", LEGACY, "10:00", 4, 9),
      onDay("2026-08-30", "r9", LEGACY, "07:00", 3, 5),
    ]);
    for (const state of bothOrders(l, r)) {
      expect(
        legacySees(state)
          .filter((seen) => seen !== "unplayed")
          .sort()
      ).toEqual(["5-3", "9-4"]);
    }
  });

  // The Raptors' copy, joined a day off, later reads as another game: it stands up on its own day.
  it("stands a copy back up on its own day", () => {
    let state = [
      legacy([at("l1", RAPTORS, "19:10", 6, 1)]),
      raptors([onDay("2026-08-30", "r1", LEGACY, "19:10", 1, 6)]),
    ].reduce(pull, empty);
    expect(state.games).toHaveLength(1);
    const [game] = state.games;
    expect(game!.alsoRows?.[0]?.date).toBe("2026-08-30");
    state = pull(state, raptors([onDay("2026-08-30", "r1", LEGACY, "12:00", 2, 6)]));
    expect(days(state)).toEqual(["2026-08-29", "2026-08-30"]);
    expect(state.games.find((entry) => entry.date === "2026-08-30")!.id).toBe("gc_gcRAPTORS001_r1");
  });
});

/*
 * A game put back to another day: each club edits its own row, keeping its id. Its day moved on
 * the game's own row was never taken, so the game stayed on the old day while the other club's
 * copy, filed on the new one, stood up beside it — one game counted twice once scored.
 */
describe("a game its clubs move to another day", () => {
  const onDay = (
    date: string,
    id: string,
    opponentName: string,
    time: string,
    teamScore?: number,
    opponentScore?: number
  ) => ({
    ...at(id, opponentName, time, teamScore, opponentScore),
    date,
    startTs: `${date}T${time}:00.000Z`,
  });
  const joined = [
    legacy([at("l1", RAPTORS, "10:00")]),
    raptors([at("r1", LEGACY, "10:00")]),
  ].reduce(pull, empty);

  it("stays one game on the new day, whichever club is pulled first", () => {
    expect(joined.games).toHaveLength(1);
    for (const [day, raptorsScore] of [
      ["2026-09-05", [3, 5]],
      ["2026-08-30", [4, 5]],
      ["2026-09-05", undefined],
    ] as const) {
      const l = legacy([onDay(day, "l1", RAPTORS, "10:00", 5, 3)]);
      const r = raptors([onDay(day, "r1", LEGACY, "10:00", ...(raptorsScore ?? []))]);
      for (const order of [
        [l, r],
        [r, l],
      ]) {
        const state = order.reduce(pull, joined);
        expect(state.games).toHaveLength(1);
        expect(state.games[0]!.date).toBe(day);
        expect(legacySees(state)).toEqual(["5-3"]);
        expect(tidyPool(state).state.games).toBe(state.games);
      }
    }
  });

  it("stays one game when only one club moves it", () => {
    const l = legacy([onDay("2026-09-05", "l1", RAPTORS, "10:00", 5, 3)]);
    const r = raptors([onDay("2026-09-05", "r1", LEGACY, "10:00", 3, 5)]);
    const legacyMoved = pull(joined, l);
    expect(legacyMoved.games.map((game) => game.date)).toEqual(["2026-09-05"]);
    const raptorsMoved = pull(joined, r);
    expect(raptorsMoved.games).toHaveLength(1);
    expect(raptorsSee(raptorsMoved)).toEqual(["3-5"]);
  });
});
