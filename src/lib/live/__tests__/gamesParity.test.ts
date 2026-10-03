import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { ageGroupYear, type AgeGroup, type ScoutGame } from "../../teamRankings";
import { gamesWindowFor, loggedGamesOn, windowGames } from "../../teamRankings/gamesWindow";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { deriveAllKnown, type SeasonReader } from "../allKnown";
import { buildBoardsAndFacts } from "../views/board";
import { gamesViews } from "../views/games";
import { coerceGames, gamesKey, type GamesView } from "../views/gamesShape";

/**
 * The Games lists a server publishes say what the page's own Games tab says (`GamesSection` over
 * `TeamRankingsView`'s list): for every page, every stored game in the tab's order, each by its
 * clubs' names, its score or that it is still to be played, its event, its day and whether it
 * counts, and so the same games on any day the tab lists first and the same counts of the rest.
 * The page reads its year's stored games and names them by its own derivation; the server reads
 * the store and the boards' build, through JSON and back; the two must agree. The pool is the
 * seeded fixture (`scripts/poolFixture.ts`), with a game set not to count, one still to be played
 * and one with no day added.
 */

const fixture = poolFixture({ seed: 13, clubsPerPage: 200 });
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
  const [first, second, third, ...rest] = fixture.games;
  if (!first || !second || !third) throw new Error("the fixture has too few games");
  const { teamAScore: _a, teamBScore: _b, ...unplayed } = second;
  const { date: _date, ...undated } = third;
  saveScoutGames([{ ...first, excluded: true }, unplayed, undated, ...rest]);
  ageGroups = loadAgeGroups();
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

/** What a row of the tab reads of a game, with its id as its place in the list. */
const rowOf = (game: ScoutGame, at: number, names: ReadonlyMap<string, string>) => ({
  id: String(at),
  a: names.get(game.teamAId) ?? "?",
  b: names.get(game.teamBId) ?? "?",
  scores: [game.teamAScore ?? null, game.teamBScore ?? null],
  date: game.date ?? null,
  event: game.event ?? null,
  excluded: game.excluded === true,
});

describe("the Games lists a server publishes", { timeout: 30_000 }, () => {
  it("say what the page's own Games tab says, on every page", () => {
    const teams = loadScoutTeams();
    const built = buildBoardsAndFacts({
      ageGroups,
      teams,
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today: FIXTURE_TODAY,
      past: false,
    });
    const lists = new Map<string, GamesView>();
    for (const { key, value } of gamesViews({
      ageGroups,
      built,
      gamesOfYear: loadScoutGamesForYear,
    })) {
      // Read back as a device reads it: through JSON and the list's own check.
      const read = coerceGames(JSON.parse(JSON.stringify(value)));
      if (!read) throw new Error(`list ${key} does not read back`);
      lists.set(key, read);
    }
    expect(lists.size).toBe(ageGroups.length);
    const seen = { games: 0, unplayed: 0, excluded: 0, undated: 0, today: 0 };
    for (const group of ageGroups) {
      const year = ageGroupYear(group);
      // The page on this page: its year's stored games, named by its own derivation.
      const yearGames = loadScoutGamesForYear(year);
      const allKnown = deriveAllKnown({ ageGroups, teams, yearGames, readSeason });
      const names = new Map(allKnown.teams.map((team) => [team.id, team.name]));
      const logged = loggedGamesOn(yearGames, group.id);
      const list = lists.get(gamesKey(year, group.id));
      if (!list) throw new Error(`no list for ${group.id}`);
      expect(list.page).toBe(group.id);
      expect(list.games.every((game) => game.ageGroupId === group.id)).toBe(true);
      expect(
        list.games.map((game, at) => rowOf(game, at, list.names)),
        group.id
      ).toEqual(logged.map((game, at) => rowOf(game, at, names)));
      // The day the tab lists first, and the counts of the rest, on the members' day and on the
      // busiest day of the page.
      const days = logged.flatMap((game) => (game.date ? [game.date] : []));
      const busiest = days.sort().find((day, at, all) => all.indexOf(day) !== at) ?? FIXTURE_TODAY;
      for (const today of [FIXTURE_TODAY, busiest]) {
        const ours = gamesWindowFor({ today, year, games: list.games });
        const theirs = gamesWindowFor({ today, year, games: logged });
        expect(ours, group.id).toEqual(theirs);
        const shown = windowGames(list.games, ours, new Set());
        const page = windowGames(logged, theirs, new Set());
        expect({ ...shown, shown: shown.shown.length }).toEqual({
          ...page,
          shown: page.shown.length,
        });
        seen.today += shown.shown.length;
      }
      seen.games += logged.length;
      seen.unplayed += logged.filter((game) => game.teamAScore === undefined).length;
      seen.excluded += logged.filter((game) => game.excluded).length;
      seen.undated += logged.filter((game) => !game.date).length;
    }
    // Every case a list carries is reached.
    expect(
      Object.values(seen).every((count) => count > 0),
      JSON.stringify(seen)
    ).toBe(true);
  });
});
