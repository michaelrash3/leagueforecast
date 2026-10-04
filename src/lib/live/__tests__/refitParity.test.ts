import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { checkTheModel } from "../../scoutBacktest";
import { whatIfCurve } from "../../scoutWhatIf";
import {
  ageGroupYear,
  buildUpcomingSchedule,
  rankingPoolGroupIds,
  type AgeGroup,
  type ScoutGame,
  type SeasonSegment,
} from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadNamedAges,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "../allKnown";
import { asJson } from "../editHandle";
import { answerQuery, cardFixture } from "../queries";
import { coerceQueryAnswer } from "../queryAnswers";
import { boardWhatIfDeclines, poolGamesOfCard, teamsOfCard } from "../scoutingFromCards";
import { boardViews, buildBoardsAndFacts } from "../views/board";
import { coerceBoardView, withMine } from "../views/boardShape";
import { cardGamesOf, clubViews, panelGame } from "../views/clubs";
import { callableEncode } from "./callableEncode";
import { clubBucketOf, clubKey, coerceClubBucket, type ClubBucket } from "../views/clubShape";

/**
 * The questions the server answers by refitting a year with the copy's League Standings seasons
 * say what the page's own work says.
 * - A what-if (`scouting.whatIf`) is the page's own curve (`whatIfCurve` on the page's pool): the
 *   fixture named as the live board holds it, a game off the scouted club's published card whose id
 *   is its place there, and found on the server's pool by that place and what the card shows of it
 *   (`cardFixture`).
 * - A model check (`model.check`), as a device reads it back, is the page's own (`checkTheModel` on
 *   the year the page knows, League Standings' games in it).
 * The pool is the seeded fixture with its League Standings seasons (`scripts/poolFixture.ts`), as
 * `scoutingParity.test.ts` reads it.
 */

const fixture = poolFixture({ seed: 17, clubsPerPage: 60 });
/*
 * The fixture's League Standings seasons are all played, so one more is put on 12U 2027 with a game
 * still to play, between two clubs of that page by their names, which is how a season reaches them.
 */
const AHEAD_PAGE = "ag_12u_2027";
const met = fixture.games.find(
  (game) => game.ageGroupId === AHEAD_PAGE && game.teamAScore !== undefined
);
const nameOf = (teamId: string) => fixture.teams.find((team) => team.id === teamId)?.name ?? "";
const AHEAD = {
  teams: [
    { id: "home", name: nameOf(met?.teamAId ?? "") },
    { id: "away", name: nameOf(met?.teamBId ?? "") },
  ],
  matchups: [{ id: "ahead", date: "4/25", away: "away", home: "home" }],
  logs: {},
};
const readSeason: SeasonReader = (seasonId) => {
  const stored = seasonId === "ahead" ? AHEAD : fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

let ageGroups: AgeGroup[] = [];
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  if (!met) throw new Error("the fixture has no game played on 12U 2027");
  saveAgeGroups(
    fixture.ageGroups.map((group) =>
      group.id === AHEAD_PAGE ? { ...group, seasonIds: [...group.seasonIds, "ahead"] } : group
    )
  );
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  ageGroups = loadAgeGroups();
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

const HALVES: Array<[string, SeasonSegment | undefined]> = [
  ["year", undefined],
  ["spring", "spring"],
];

describe("a what-if asked of the server", { timeout: 60_000 }, () => {
  it("says what the page's own says, its fixture named as the club's card holds it", () => {
    const built = buildBoardsAndFacts({
      ageGroups,
      teams: loadScoutTeams(),
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today: FIXTURE_TODAY,
      past: false,
    });
    const boards = new Map(
      boardViews(ageGroups, built).map(({ key, value }) => [
        key,
        coerceBoardView(JSON.parse(JSON.stringify(value))),
      ])
    );
    const buckets = new Map<string, ClubBucket>();
    for (const { key, value } of clubViews({ ageGroups, built, namedAges: loadNamedAges() })) {
      const read = coerceClubBucket(JSON.parse(JSON.stringify(value)));
      if (!read) throw new Error(`bucket ${key} does not read back`);
      buckets.set(key, read);
    }
    const seen = { asked: 0, drawn: 0, league: 0 };
    for (const group of ageGroups.filter((one) => ageGroupYear(one) !== undefined)) {
      const year = ageGroupYear(group);
      const known = built.known.get(year);
      if (!known) continue;
      const poolIdList = rankingPoolGroupIds(group.id, ageGroups);
      const poolIds = new Set(poolIdList);
      const poolGames = gamesOnPages(known.games, poolIdList);
      const poolGameById = new Map(poolGames.map((game) => [game.id, game]));
      const derived = new Set(known.derivedGames.map((game) => game.id));
      for (const [half, segment] of HALVES) {
        const board = boards.get(`board:${year}:${group.id}:${half}`);
        if (!board || board.rows.length === 0) continue;
        const rows = withMine(board.rows, undefined);
        const rated = new Set(rows.map((row) => row.teamId));
        // The board's top clubs, and those with a League Standings fixture still to play here.
        const leagueSides = known.derivedGames
          .filter((game) => game.ageGroupId === group.id && game.teamAScore === undefined)
          .flatMap((game) => [game.teamAId, game.teamBId])
          .filter((teamId) => rated.has(teamId));
        const scouted = [
          ...new Set([...rows.slice(0, 4).map(({ teamId }) => teamId), ...leagueSides.slice(0, 4)]),
        ];
        for (const teamId of scouted) {
          const card = buckets.get(clubKey(year, clubBucketOf(teamId)))?.clubs[teamId];
          if (!card) throw new Error(`no card for ${teamId}`);
          const cardGames = new Map(poolGamesOfCard(card, poolIds).map((game) => [game.id, game]));
          const ours = buildUpcomingSchedule(
            teamId,
            rows,
            poolGamesOfCard(card, poolIds),
            teamsOfCard(card),
            FIXTURE_TODAY
          );
          const theirs = buildUpcomingSchedule(teamId, rows, poolGames, known.teams, FIXTURE_TODAY);
          const offered = boardWhatIfDeclines(
            ours.flatMap((one) => cardGames.get(one.gameId) ?? []),
            teamId,
            rated,
            ageGroups,
            segment
          );
          for (const [index, one] of ours.slice(0, 2).entries()) {
            const shown = cardGames.get(one.gameId);
            const real = poolGameById.get(theirs[index]?.gameId ?? "");
            if (!shown || !real || offered.get(shown.id) !== null) continue;
            const at = `${teamId}'s game ${index} on ${group.id} ${half}`;
            const asked = answerQuery(
              {
                kind: "scouting.whatIf",
                page: group.id,
                segment: segment ?? null,
                forTeamId: teamId,
                game: shown,
                today: FIXTURE_TODAY,
              },
              readSeason
            );
            const page = whatIfCurve(
              real,
              teamId,
              group.id,
              known.teams,
              poolGames,
              group.myTeamId,
              ageGroups,
              segment,
              FIXTURE_TODAY
            );
            expect(asked, at).toEqual({
              kind: "scouting.whatIf",
              curve: page && { ...page, gameId: shown.id },
            });
            seen.asked += 1;
            if (page) seen.drawn += 1;
            if (derived.has(real.id)) seen.league += 1;
          }
        }
      }
    }
    // Enough asked to mean something, curves drawn among them, and League Standings' own fixtures.
    expect(seen.asked).toBeGreaterThanOrEqual(10);
    expect(seen.drawn).toBeGreaterThanOrEqual(5);
    expect(seen.league).toBeGreaterThanOrEqual(1);
  });

  it("is no curve without the copy's League Standings seasons to fit with", () => {
    const group = ageGroups.find((one) => ageGroupYear(one) !== undefined);
    if (!group) throw new Error("the fixture has no page with a year");
    const game: ScoutGame = { id: "0", teamAId: "S-1", teamBId: "S-2", ageGroupId: group.id };
    expect(
      answerQuery({
        kind: "scouting.whatIf",
        page: group.id,
        segment: null,
        forTeamId: "S-1",
        game,
        today: FIXTURE_TODAY,
      })
    ).toEqual({ kind: "scouting.whatIf", curve: null });
  });
});

describe("a fixture named by its place on a club's card", () => {
  const game = (id: string, more: Partial<ScoutGame> = {}): ScoutGame => ({
    id,
    teamAId: "A",
    teamBId: "B",
    ageGroupId: "p",
    date: "2027-04-20",
    ...more,
  });
  // As the card lists them, and each as a device reads it off the card, its id its place.
  const GAMES = [
    game("g1", { teamAScore: 3, teamBScore: 1 }),
    game("g2"),
    game("g3", { date: "2027-04-21" }),
  ];
  const shown = (at: number, more: Partial<ScoutGame> = {}) => ({
    ...panelGame(GAMES[at]!),
    id: String(at),
    ...more,
  });

  it("is the game at its place while it still reads so on a card", () => {
    expect(cardFixture(GAMES, shown(1))).toBe(GAMES[1]);
    // The stored record's own fields beyond what a card shows are no part of it.
    expect(
      cardFixture([GAMES[0]!, { ...GAMES[1]!, startTs: "2027-04-20T18:00:00Z" }], shown(1))?.id
    ).toBe("g2");
  });

  it("is the one game that reads so anywhere, once the card has moved", () => {
    expect(cardFixture([GAMES[2]!, GAMES[0]!, GAMES[1]!], shown(1))).toBe(GAMES[1]);
  });

  it("is none where none reads so, or two do and neither at its place", () => {
    expect(cardFixture(GAMES, shown(1, { date: "2027-04-22" }))).toBeNull();
    // An id that is no place: found by what it shows alone.
    expect(cardFixture(GAMES, shown(1, { id: "x" }))).toBe(GAMES[1]);
    const twice = [GAMES[0]!, game("g2b"), GAMES[1]!];
    expect(cardFixture(twice, shown(1))?.id).toBe("g2b");
    expect(cardFixture([GAMES[0]!, GAMES[2]!, game("g2b"), GAMES[1]!], shown(1))).toBeNull();
  });

  it("is looked for among the club's games as its card lists them", () => {
    const year = [
      game("x1", { teamAId: "C", teamBId: "D" }),
      ...GAMES,
      game("x2", { teamAId: "B", teamBId: "B" }),
    ];
    expect(cardGamesOf(year, "A").map(({ id }) => id)).toEqual(["g1", "g2", "g3"]);
    expect(cardGamesOf(year, "B").map(({ id }) => id)).toEqual(["g1", "g2", "g3", "x2"]);
  });
});

describe("a model check asked of the server", { timeout: 120_000 }, () => {
  it("reads back as the page's own, worked out on the year with League Standings' games", () => {
    const page = ageGroups.find((one) => one.id === AHEAD_PAGE);
    if (!page) throw new Error(`the fixture has no ${AHEAD_PAGE}`);
    const asked = answerQuery({ kind: "model.check", page: page.id }, readSeason);
    // As the callable sends it: its own encoding throws on a number with no end, so the edit
    // function writes every reply as JSON first (`asJson`).
    expect(() => callableEncode(asked)).toThrow(/Infinity/);
    const read = coerceQueryAnswer(callableEncode(asJson(asked)), "model.check");
    const known = deriveAllKnown({
      ageGroups,
      teams: loadScoutTeams(),
      yearGames: loadScoutGamesForYear(ageGroupYear(page)),
      readSeason,
    });
    const own = checkTheModel(page.id, known.teams, known.games, ageGroups);
    expect(read).toEqual({ kind: "model.check", answer: own });
    // Numbers with no end among them, which JSON writes as null: the uncapped run, the last bucket.
    expect(own.caps.some(({ cap }) => cap === Infinity)).toBe(true);
    const buckets = own.result.buckets;
    expect(buckets[buckets.length - 1]?.toDays).toBe(Infinity);
    expect(own.result.sampleSize).toBeGreaterThan(0);
    // And League Standings' games in it: the year without them checks otherwise.
    const league = new Set(known.derivedGames.map(({ id }) => id));
    const without = known.games.filter(({ id }) => !league.has(id));
    expect(without.length).toBeLessThan(known.games.length);
    expect(checkTheModel(page.id, known.teams, without, ageGroups)).not.toEqual(own);
  });

  it("is no answer for a page the copy does not hold, or without its League Standings seasons", () => {
    expect(answerQuery({ kind: "model.check", page: "ag_nowhere" }, readSeason)).toEqual({
      kind: "model.check",
      answer: null,
    });
    expect(answerQuery({ kind: "model.check", page: AHEAD_PAGE })).toEqual({
      kind: "model.check",
      answer: null,
    });
  });
});
