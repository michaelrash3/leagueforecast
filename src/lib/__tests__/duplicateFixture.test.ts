import { describe, expect, it } from "vitest";
import { importGcSchedule, type GcImportState } from "../gameChangerImport";
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
