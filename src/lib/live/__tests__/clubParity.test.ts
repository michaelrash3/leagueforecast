import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import {
  ageGroupYear,
  countedInWindow,
  countsTowardRating,
  gamesForTeam,
  gcLinkSquadYear,
  isScoutGamePlayed,
  playsItself,
  rankingPoolGroupIds,
  scoreSeenBy,
  teamRecordInPool,
  type AgeGroup,
  type ScoutGame,
  type SeasonSegment,
} from "../../teamRankings";
import { clubAgeOf } from "../../teamRankings/clubAge";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadNamedAges,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveNamedAges,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { leagueTeamIdsOn, type SeasonReader } from "../allKnown";
import { buildBoardsAndFacts } from "../views/board";
import { clubViews } from "../views/clubs";
import {
  clubBucketOf,
  clubKey,
  coerceClubBucket,
  leagueLinkOf,
  type ClubBucket,
} from "../views/clubShape";

/**
 * The club cards a server publishes say what the page's own team panel says, for every club and
 * every page of its year (`TeamDetailPanel`): its record over each span, each game's line, how many
 * games it has elsewhere, its League Standings link and its age. The page reads all of these off
 * the year's whole pool; a card holds only the club's own games, trimmed, from the club's side and
 * without their stored ids, so each is worked out both ways here and must agree. The pool is the
 * seeded fixture (`scripts/poolFixture.ts`), with one age a person pinned added.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
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
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  ageGroups = loadAgeGroups();
  // One club's GameChanger link pinned at an age by hand, as its panel does.
  const pinned = loadScoutTeams().find((team) =>
    (team.gcTeams ?? []).some((link) => gcLinkSquadYear(link, ageGroups) !== undefined)
  );
  const link = pinned?.gcTeams?.[0];
  if (!link) throw new Error("the fixture has no linked club");
  saveNamedAges(
    new Map([
      [
        link.teamId,
        { teamId: link.teamId, level: 11, namedAt: "2027-01-01", pinned: true as const, was: 10 },
      ],
    ])
  );
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

const SPANS: Array<SeasonSegment | undefined> = [undefined, "fall", "spring"];

/**
 * `expect(actual).toEqual(expected)`, asked only when their JSON differs: the loop below compares
 * some fifty thousand values, and each `expect` costs more than the work it checks. Both sides are
 * built by the same code in the same order, so equal values give equal JSON.
 */
const same = (actual: unknown, expected: unknown, at: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) expect(actual, at).toEqual(expected);
};

/**
 * What the panel draws of one game for club `teamId`, read off it as the panel reads it, with
 * whether it is counted over each span.
 */
const lineOf = (game: ScoutGame, teamId: string, nameOf: (id: string) => string) => {
  const isA = game.teamAId === teamId;
  const seen = isScoutGamePlayed(game) ? scoreSeenBy(game, teamId) : undefined;
  return {
    opponent: nameOf(isA ? game.teamBId : game.teamAId),
    seen: seen ?? null,
    date: game.date ?? null,
    event: game.event ?? null,
    excluded: game.excluded === true,
    playsItself: playsItself(game),
    counted: SPANS.map((segment) => countedInWindow(game, ageGroups, segment)),
    notCounted: isScoutGamePlayed(game) && !countsTowardRating(game) && !playsItself(game),
  };
};

/*
 * Every club against every page of its year, three spans each: 11.6 s under coverage on its own
 * (measured), and the gate runs it beside three hundred other files.
 */
describe("the club cards a server publishes", { timeout: 60_000 }, () => {
  it("say what the page's own panel says, for every club on every page of its year", () => {
    const built = buildBoardsAndFacts({
      ageGroups,
      teams: loadScoutTeams(),
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today: FIXTURE_TODAY,
      past: false,
    });
    const namedAges = loadNamedAges();
    const buckets = new Map<string, ClubBucket>();
    for (const { key, value } of clubViews({ ageGroups, built, namedAges })) {
      // Read back as a device reads it: through JSON and the card's own check.
      const read = coerceClubBucket(JSON.parse(JSON.stringify(value)));
      if (!read) throw new Error(`bucket ${key} does not read back`);
      buckets.set(key, read);
    }
    const seen = { clubs: 0, league: 0, picked: 0, pinned: 0, excluded: 0, outside: 0 };
    for (const [year, known] of built.known) {
      const pages = [...new Set(ageGroups.map((group) => group.id))].filter(
        (pageId) => ageGroupYear(ageGroups.find((group) => group.id === pageId)) === year
      );
      const names = new Map(known.teams.map((team) => [team.id, team.name]));
      // Each page's pool and League Standings clubs, worked out once for every club.
      const poolOf = new Map(
        pages.map((pageId) => [pageId, new Set(rankingPoolGroupIds(pageId, ageGroups))])
      );
      const leagueOn = new Map(
        pages.map((pageId) => [pageId, leagueTeamIdsOn(known.derivedGames, pageId)])
      );
      // A club's own games of the year, by the page's function over the whole year, once each.
      const gamesOf = new Map(known.teams.map((team) => [team.id, [] as ScoutGame[]]));
      for (const game of known.games)
        for (const teamId of new Set([game.teamAId, game.teamBId])) gamesOf.get(teamId)?.push(game);
      let wholeYear = 0;
      for (const team of known.teams) {
        const theirs = gamesForTeam(team.id, gamesOf.get(team.id) ?? []);
        const card = buckets.get(clubKey(year, clubBucketOf(team.id)))?.clubs[team.id];
        if (theirs.length === 0) {
          // Only clubs with a game in the year have a card: no page lists the others.
          expect(card, team.id).toBeUndefined();
          continue;
        }
        if (!card) throw new Error(`no card for ${team.id} in ${year}`);
        seen.clubs += 1;
        const { isMine: _mine, ...club } = team;
        expect(card.team, team.id).toEqual(club);
        expect(card.age, team.id).toEqual(clubAgeOf(team, year, ageGroups, namedAges));
        if (card.age?.pinned) seen.pinned += 1;
        const cardName = (id: string) => card.names[id] ?? "Unknown";
        const poolName = (id: string) => names.get(id) ?? "Unknown";
        const ours = gamesForTeam(team.id, card.games);
        expect(ours.length, team.id).toBe(theirs.length);
        // The pages whose pool holds any of its games; on every other page both sides say nothing.
        const filed = new Set(theirs.map((game) => game.ageGroupId));
        const reached = pages.filter((pageId) =>
          [...(poolOf.get(pageId) ?? [])].some((id) => filed.has(id))
        );
        for (const pageId of reached) {
          const pool = poolOf.get(pageId) ?? new Set<string>();
          const here = theirs.filter((game) => pool.has(game.ageGroupId));
          const hereOurs = ours.filter((game) => pool.has(game.ageGroupId));
          const at = `${team.id} on ${pageId}`;
          same(hereOurs.length, here.length, at);
          for (const segment of SPANS) {
            // The page hands the panel the whole year; for a year's first clubs it is asked that
            // way too, and for the rest over the club's own games, which is all it reads of it.
            const record = teamRecordInPool(
              team.id,
              pageId,
              wholeYear < 10 ? known.games : theirs,
              ageGroups,
              segment
            );
            same(teamRecordInPool(team.id, pageId, card.games, ageGroups, segment), record, at);
            if (record.outsideWindow > 0) seen.outside += 1;
          }
          same(
            hereOurs.map((game) => lineOf(game, team.id, cardName)),
            here.map((game) => lineOf(game, team.id, poolName)),
            at
          );
          seen.excluded += here.filter((game) => game.excluded).length;
          const inLeague = leagueOn.get(pageId)?.has(team.id) === true;
          const link = inLeague ? (known.pickedOnly.has(team.id) ? "pick" : "name") : undefined;
          same(leagueLinkOf(card, pageId), link, at);
          if (link) seen[link === "pick" ? "picked" : "league"] += 1;
        }
        wholeYear += 1;
      }
    }
    // The fixture reaches every case a card carries but a game against a club's own name, which
    // `clubShape.test.ts` reads back on its own.
    expect(
      Object.values(seen).every((count) => count > 0),
      JSON.stringify(seen)
    ).toBe(true);
  });

  it("list a game against a club's own name once, as the page does, and give it no opponent", () => {
    const itself: ScoutGame = {
      id: "self",
      teamAId: "S-A",
      teamBId: "S-A",
      ageGroupId: "ag_10u_2027",
      teamAScore: 3,
      teamBScore: 3,
    };
    // Everything a panel line reads, and some it does not: a start, a source and a note.
    const other: ScoutGame = {
      ...itself,
      id: "other",
      teamBId: "S-B",
      reportedByB: { teamAScore: 3, teamBScore: 4 },
      excluded: true,
      scoreConfirmed: 40,
      date: "2027-03-20",
      startTs: "2027-03-20T15:00:00Z",
      event: "Placeholder Classic",
      ageLevelA: 10,
      ageLevelB: 9,
      note: "kept apart",
      source: { kind: "gamechanger", teamId: "gcAAAAAAAAAA", gameId: "g-1" },
    };
    const known = {
      teams: [
        { id: "S-A", name: "Placeholder Aces" },
        { id: "S-B", name: "Placeholder Bees" },
      ],
      games: [itself, other],
      derivedGames: [],
      pickedOnly: new Set<string>(),
      leagueClubs: new Map(),
      leagueHalves: new Map(),
    };
    const views = clubViews({
      ageGroups: [],
      built: { known: new Map([[2027, known]]) },
      namedAges: new Map(),
    });
    const cards = views.flatMap(({ value }) => Object.values(value.clubs));
    const aces = cards.find((card) => card.team.id === "S-A");
    expect(aces?.games.map((game) => [game.s, game.o])).toEqual([
      [0, -1],
      [0, 0],
    ]);
    expect(aces?.opponents).toEqual([["S-B", "Placeholder Bees"]]);
    const read = coerceClubBucket(
      JSON.parse(
        JSON.stringify(views.find(({ key }) => key === clubKey(2027, clubBucketOf("S-A")))?.value)
      )
    )?.clubs["S-A"];
    // Listed as the panel lists them, the dated game first.
    expect(read && gamesForTeam("S-A", read.games).map((game) => playsItself(game))).toEqual([
      false,
      true,
    ]);
    // Read back, each game is what the panel reads of it, and nothing it does not.
    const { startTs: _start, note: _note, source: _source, ...panelled } = other;
    expect(read?.games).toEqual([
      { ...itself, id: "0" },
      { ...panelled, id: "1" },
    ]);
  });
});
