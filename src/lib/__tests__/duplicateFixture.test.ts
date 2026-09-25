import { describe, expect, it } from "vitest";
import {
  importGcSchedule,
  importGcSchedules,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { normalizeGcGames, type GcTeamSchedule } from "../gameChangerApi";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

const schedule = (games: GcTeamSchedule["games"]): GcTeamSchedule => ({
  profile: {
    id: "gcTRASH00001",
    name: "Trash Pandas Baseball Club",
    ageLevel: 12,
    season: { season: "fall", year: 2026 },
  },
  games,
  fetchedAt: "2026-09-20T12:00:00.000Z",
});

const game = (
  id: string,
  opponentName: string,
  extra: Partial<GcTeamSchedule["games"][number]> = {}
) => ({
  id,
  date: "2026-09-18",
  opponentName,
  status: "completed" as const,
  teamScore: 13,
  opponentScore: 21,
  ...extra,
});

const gamesAfter = (games: GcTeamSchedule["games"]) =>
  importGcSchedule(schedule(games), empty).state.games.length;

/**
 * One fixture, listed twice on one schedule.
 *
 * GameChanger does this: the same game arrives under two game ids, with the opponent spelled two
 * ways — "Cincinnati Angels Red" and "Cincinnati Angels- Red" — and the same score on both. The
 * opponent resolves to one team either way, because `teamNameKey` reads punctuation between words
 * as spacing. The two rows were still filed as two games, and a club's record counted the loss
 * twice.
 *
 * Both rows come from the same schedule, and that is what made them invisible: a club's own
 * schedule listing two games on a day is normally listing two games, so `matchExistingGame`
 * skipped the comparison entirely rather than reasoning about it.
 */
describe("one fixture listed twice on a club's own schedule", () => {
  it("is one game when the score and the start time agree", () => {
    expect(
      gamesAfter([
        game("a", "Cincinnati Angels Red", { startTs: "2026-09-18T18:00:00.000Z" }),
        game("b", "Cincinnati Angels- Red", { startTs: "2026-09-18T18:00:00.000Z" }),
      ])
    ).toBe(1);
  });

  /*
   * And it stays two when neither row carries a start time, however alike they look. A real pull
   * found four games against one club on a single day; with no times to tell a repeated fixture
   * from a repeated row, folding them would delete three results, and losing a real game is the
   * worse error. GameChanger gives a start time on every game in the captured fixture, so this is
   * the rare case rather than the common one.
   */
  it("stays two games when neither row carries a start time", () => {
    expect(
      gamesAfter([game("a", "Cincinnati Angels Red"), game("b", "Cincinnati Angels- Red")])
    ).toBe(2);
  });

  /*
   * A doubleheader is two games and must stay two. Nobody plays two games at once, so two start
   * times settle it — and GameChanger gives one on every game in the captured fixture, all twelve
   * of them.
   */
  it("is two games when the start times differ", () => {
    expect(
      gamesAfter([
        game("a", "Cincinnati Angels Red", { startTs: "2026-09-18T18:00:00.000Z" }),
        game("b", "Cincinnati Angels Red", { startTs: "2026-09-18T20:30:00.000Z" }),
      ])
    ).toBe(2);
  });

  it("is two games when the results differ, whatever the times say", () => {
    expect(
      gamesAfter([
        game("a", "Cincinnati Angels Red"),
        game("b", "Cincinnati Angels Red", { teamScore: 5, opponentScore: 4 }),
      ])
    ).toBe(2);
  });

  /*
   * Same moment, two different results, and still one game: nobody plays two at once, so that is
   * a disagreement about one fixture rather than two fixtures. Keeping both would have counted a
   * loss and a win for a game played once.
   */
  it("is one game when two rows share a start time and disagree about the score", () => {
    expect(
      gamesAfter([
        game("a", "Cincinnati Angels Red", { startTs: "2026-09-18T18:00:00.000Z" }),
        game("b", "Cincinnati Angels- Red", {
          startTs: "2026-09-18T18:00:00.000Z",
          teamScore: 5,
          opponentScore: 4,
        }),
      ])
    ).toBe(1);
  });

  it("keeps the displaced result visible rather than losing it", () => {
    const { state } = importGcSchedule(
      schedule([
        game("a", "Cincinnati Angels Red", { startTs: "2026-09-18T18:00:00.000Z" }),
        game("b", "Cincinnati Angels- Red", {
          startTs: "2026-09-18T18:00:00.000Z",
          teamScore: 5,
          opponentScore: 4,
        }),
      ]),
      empty
    );
    expect(state.games).toHaveLength(1);
    expect(state.games[0]?.note).toContain("13-21");
  });

  /*
   * And an unscored row is not evidence of anything. GameChanger posts a result on one schedule
   * before the other, so a scheduled copy of a played game is ordinary; merging it into the played
   * one is right, and it must not take the score with it.
   */
  it("folds a scheduled copy into the played one without erasing the result", () => {
    const { state } = importGcSchedule(
      schedule([
        game("a", "Cincinnati Angels Red", { startTs: "2026-09-18T18:00:00.000Z" }),
        game("b", "Cincinnati Angels- Red", {
          startTs: "2026-09-18T18:00:00.000Z",
          status: "scheduled",
          teamScore: undefined,
          opponentScore: undefined,
        }),
      ]),
      empty
    );
    expect(state.games).toHaveLength(1);
    expect(state.games[0]?.teamAScore).toBe(13);
    expect(state.games[0]?.teamBScore).toBe(21);
  });
});

/*
 * All-day entries. GameChanger writes midnight UTC as the start of one, and read as a time that
 * made two all-day games against one club on one date look like one fixture listed twice — the
 * later score kept and the other only noted.
 */
describe("two all-day games on one schedule", () => {
  const allDay = (id: string, teamScore: number, opponentScore: number) => ({
    id,
    opponent_team: { name: "Cincinnati Angels Red" },
    is_full_day: true,
    start_ts: "2026-09-18T00:00:00.000Z",
    timezone: null,
    score: { team: teamScore, opponent_team: opponentScore },
    game_status: "completed",
  });

  it("stay two games, since midnight is not when either was played", () => {
    expect(gamesAfter(normalizeGcGames([allDay("a", 13, 21), allDay("b", 9, 4)]))).toBe(2);
  });
});

/*
 * One game on two clubs' schedules, at two starts.
 *
 * A start on a schedule is when the game was planned, and a tournament that runs behind leaves
 * both coaches' placeholders where they were. Legacy Baseball Club's schedule had its 14-2 win over
 * River City Raptors on 29 August 2026 at 17:00Z; the Raptors' had the same game at 18:00Z; and the
 * pool held it twice, because two starts used to mean two games whoever wrote them down.
 */
describe("one game on two clubs' schedules", () => {
  const club = (id: string, name: string, games: GcTeamSchedule["games"]): GcTeamSchedule => ({
    profile: { id, name, ageLevel: 11, season: { season: "fall", year: 2026 } },
    games,
    fetchedAt: "2026-09-20T12:00:00.000Z",
  });
  const at = (
    id: string,
    opponentName: string,
    time: string,
    teamScore: number | undefined,
    opponentScore: number | undefined
  ) => ({
    id,
    date: "2026-08-29",
    startTs: `2026-08-29T${time}:00.000Z`,
    opponentName,
    status: teamScore === undefined ? ("scheduled" as const) : ("completed" as const),
    ...(teamScore === undefined ? {} : { teamScore }),
    ...(opponentScore === undefined ? {} : { opponentScore }),
  });
  const legacy = (games: GcTeamSchedule["games"]) =>
    club("gcLEGACY0001", "Legacy Baseball Club 11U", games);
  const raptors = (games: GcTeamSchedule["games"]) =>
    club("gcRAPTORS001", "River City Raptors 11U", games);
  const between = (state: GcImportState, a: string, b: string) =>
    state.games.filter((game) => {
      const names = new Set(
        [game.teamAId, game.teamBId].map(
          (teamId) => state.teams.find((team) => team.id === teamId)?.name
        )
      );
      return names.has(a) && names.has(b);
    });

  it("is one game when the Raptors' copy starts an hour after Legacy's", () => {
    const { state } = importGcSchedules(
      [
        legacy([at("l2", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([at("r2", "Legacy Baseball Club 11U", "18:00", 2, 14)]),
      ],
      empty
    );
    expect(state.games).toHaveLength(1);
    // Two copies that agree have nothing to say about each other.
    expect(state.games[0]?.note).toBeUndefined();
  });

  it("stays one game when the Raptors are pulled again, finding their copy by its id", () => {
    const first = importGcSchedules(
      [
        legacy([at("l2", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([at("r2", "Legacy Baseball Club 11U", "18:00", 2, 14)]),
      ],
      empty
    );
    // A day later the Raptors' coach has moved the start well past the hour and corrected the
    // score, so nothing but the row's own id says it is the game it was.
    const again = importGcSchedule(
      raptors([at("r2", "Legacy Baseball Club 11U", "19:30", 3, 14)]),
      first.state
    );
    expect(again.state.games).toHaveLength(1);
    expect(again.outcome.gamesAdded).toBe(0);
  });

  it("is one game on the same result however far apart the two clocks are", () => {
    const { state } = importGcSchedules(
      [
        legacy([at("l2", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([at("r2", "Legacy Baseball Club 11U", "20:30", 2, 14)]),
      ],
      empty
    );
    expect(state.games).toHaveLength(1);
  });

  it("is one game scored two ways within the hour, and two past it", () => {
    const within = importGcSchedules(
      [
        legacy([at("l2", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([at("r2", "Legacy Baseball Club 11U", "18:00", 3, 14)]),
      ],
      empty
    );
    expect(within.state.games).toHaveLength(1);

    const past = importGcSchedules(
      [
        legacy([at("l2", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([at("r2", "Legacy Baseball Club 11U", "18:01", 3, 14)]),
      ],
      empty
    );
    expect(past.state.games).toHaveLength(2);
  });

  it("keeps a doubleheader two games when the Raptors' clock sits between Legacy's slots", () => {
    const { state } = importGcSchedules(
      [
        legacy([
          at("l1", "River City Raptors 11U", "13:30", 14, 5),
          at("l2", "River City Raptors 11U", "14:30", 14, 2),
        ]),
        raptors([
          at("r1", "Legacy Baseball Club 11U", "14:00", 5, 14),
          at("r2", "Legacy Baseball Club 11U", "15:00", 2, 14),
        ]),
      ],
      empty
    );
    const scores = state.games.map((game) => `${game.teamAScore}-${game.teamBScore}`).sort();
    expect(scores).toEqual(["14-2", "14-5"]);
  });

  /*
   * Bulls-Baker's schedule had two games against LC Falcons on 22 August 2026, 12-3 and 6-3; the
   * Falcons' had only the second. Once the two copies of the 6-3 were one game, a count of each
   * schedule's rows that forgot the fold saw one game a side and folded the 12-3 into it.
   */
  it("keeps the game only one schedule listed once the other copy is folded in", () => {
    const imported = importGcSchedules(
      [
        club("gcBULLS00001", "Bulls-Baker 11U", [
          at("b1", "LC Falcons 11U", "15:00", 12, 3),
          at("b2", "LC Falcons 11U", "21:30", 6, 3),
        ]),
        club("gcFALCONS001", "LC Falcons 11U", [at("f2", "Bulls-Baker 11U", "21:00", 3, 6)]),
      ],
      empty
    );
    const { state } = tidyPool(imported.state);
    const scores = between(state, "Bulls-Baker", "LC Falcons").map((game) =>
      game.teamAId === state.teams.find((team) => team.name === "Bulls-Baker")?.id
        ? `${game.teamAScore}-${game.teamBScore}`
        : `${game.teamBScore}-${game.teamAScore}`
    );
    expect(scores.sort()).toEqual(["12-3", "6-3"]);
  });

  /*
   * Next Level Prospects lost to Bama Ballers 10-2 twice on 12 September 2026, and both schedules
   * listed both games. Each game took one of the Bama rows, and a record that named only the
   * schedule let the tidy read the two games as one listed twice.
   */
  it("keeps two games with one result apart when each has taken a row off both schedules", () => {
    const imported = importGcSchedules(
      [
        club("gcPROSPECTS1", "Next Level Prospects 11U", [
          at("p1", "Bama Ballers 11U", "12:00", 2, 10),
          at("p2", "Bama Ballers 11U", "22:00", 2, 10),
        ]),
        club("gcBAMA000001", "Bama Ballers 11U", [
          at("m1", "Next Level Prospects 11U", "14:00", 10, 2),
          at("m2", "Next Level Prospects 11U", "22:50", 10, 2),
        ]),
      ],
      empty
    );
    expect(imported.state.games).toHaveLength(2);
    expect(tidyPool(imported.state).state.games).toHaveLength(2);
  });

  // The Raptors list two games against Legacy half an hour apart with two results, which one
  // schedule does only for two games. Legacy's one copy is the first of them, and cannot also be
  // the second just because it starts within the hour of it too.
  it("does not let one game take two rows off one schedule", () => {
    const { state } = importGcSchedules(
      [
        legacy([at("l1", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([
          at("r1", "Legacy Baseball Club 11U", "17:10", 2, 14),
          at("r2", "Legacy Baseball Club 11U", "17:40", 3, 14),
        ]),
      ],
      empty
    );
    expect(state.games).toHaveLength(2);
    expect(tidyPool(state).state.games).toHaveLength(2);
  });

  it("folds the Raptors listing it twice into the one game Legacy's copy already is", () => {
    const { state } = importGcSchedules(
      [
        legacy([at("l1", "River City Raptors 11U", "17:00", 14, 2)]),
        raptors([
          at("r1", "Legacy Baseball Club 11U", "17:10", 2, 14),
          at("r1-again", "Legacy Baseball Club 11U", "17:10", 2, 14),
        ]),
      ],
      empty
    );
    expect(state.games).toHaveLength(1);
  });

  it("takes a start its own schedule has moved", () => {
    const first = importGcSchedule(
      legacy([at("l2", "River City Raptors 11U", "17:00", 14, 2)]),
      empty
    );
    const moved = importGcSchedule(
      legacy([at("l2", "River City Raptors 11U", "19:30", 14, 2)]),
      first.state
    );
    expect(moved.state.games[0]?.startTs).toBe("2026-08-29T19:30:00.000Z");
  });
});

describe("one club's own schedule within the hour", () => {
  it("is two games when the two results differ, a doubleheader at its slot times", () => {
    expect(
      gamesAfter([
        game("a", "Johnson", {
          startTs: "2026-09-18T19:00:00.000Z",
          teamScore: 23,
          opponentScore: 6,
        }),
        game("b", "Johnson", {
          startTs: "2026-09-18T20:00:00.000Z",
          teamScore: 12,
          opponentScore: 2,
        }),
      ])
    ).toBe(2);
  });

  it("is one game when both rows give the same result", () => {
    expect(
      gamesAfter([
        game("a", "Gulf Coast Gorillas", {
          startTs: "2026-09-18T01:00:00.000Z",
          teamScore: 1,
          opponentScore: 9,
        }),
        game("b", "Gulf Coast Gorillas", {
          startTs: "2026-09-18T02:00:00.000Z",
          teamScore: 1,
          opponentScore: 9,
        }),
      ])
    ).toBe(1);
  });

  it("reads two starts a fraction of a second apart as the same start", () => {
    expect(
      gamesAfter([
        game("a", "Cincinnati Angels Red", { startTs: "2026-09-18T18:00:00.000Z" }),
        game("b", "Cincinnati Angels- Red", {
          startTs: "2026-09-18T18:00:00.355Z",
          teamScore: 5,
          opponentScore: 4,
        }),
      ])
    ).toBe(1);
  });
});
