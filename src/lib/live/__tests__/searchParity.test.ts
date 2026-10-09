import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { clubSearchGames, clubSearchOptions, clubSearchPages } from "../../clubSearch";
import { whereIsGcId } from "../../gcIdWhereabouts";
import { ageGroupYear, type AgeGroup } from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadAgeUnknown,
  loadDroppedClubs,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTooYoungClubs,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveAgeUnknown,
  saveDroppedClubs,
  saveScoutGames,
  saveScoutTeams,
  saveTooYoungClubs,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { deriveAllKnown, type SeasonReader } from "../allKnown";
import { buildBoardsAndFacts } from "../views/board";
import { searchViews } from "../views/search";
import { coerceSearch, searchKey, type SearchView } from "../views/searchShape";

/**
 * The Find a team lists a server publishes say what the page's own search says (`useClubSearch`
 * over `TeamRankingsView`'s derivation): for every year with a page, every club the box offers,
 * with its line, coaches and GameChanger ids, the page a pick opens, and where a pasted id the copy
 * keeps off every page went. The page works its list out from its own year's derivation and every
 * stored game; the server from the boards' build and the store, through JSON and back; the two must
 * agree. The pool is the seeded fixture (`scripts/poolFixture.ts`), with coaches on one club and an
 * id on each of the copy's held lists added. Placeholder names throughout.
 */

const fixture = poolFixture({ seed: 11, clubsPerPage: 300 });
const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

const COACHES = ["Placeholder Coach A", "Placeholder Coach B"];

let ageGroups: AgeGroup[] = [];
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${FIXTURE_TODAY}T12:00:00`));
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  // Coaches on the first linked club, which the box searches and lists under its name.
  let coached = false;
  saveScoutTeams(
    fixture.teams.map((team) => {
      const [link, ...links] = team.gcTeams ?? [];
      if (coached || !link) return team;
      coached = true;
      return { ...team, gcTeams: [{ ...link, staff: COACHES }, ...links] };
    })
  );
  saveScoutGames(fixture.games);
  saveAgeUnknown([
    {
      teamId: "gcWAITING001",
      name: "Placeholder Waiting",
      firstSeen: "2027-03-01",
      lastTried: "2027-03-02",
      tries: 1,
    },
    { teamId: "gcWAITING002", firstSeen: "2027-03-01", lastTried: "2027-03-02", tries: 1 },
  ]);
  saveDroppedClubs(new Set(["gcDROPPED001"]));
  saveTooYoungClubs(new Set(["gcTOOYOUNG01"]));
  ageGroups = loadAgeGroups();
});
afterAll(() => {
  vi.useRealTimers();
  resetTeamRankingsStore();
});

describe("the Find a team lists a server publishes", { timeout: 30_000 }, () => {
  it("say what the page's own search says, on every year with a page", () => {
    const teams = loadScoutTeams();
    const built = buildBoardsAndFacts({
      ageGroups,
      teams,
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today: FIXTURE_TODAY,
      past: false,
    });
    const held = {
      dropped: loadDroppedClubs(),
      ageless: loadAgeUnknown(),
      tooYoung: loadTooYoungClubs(),
    };
    const lists = new Map<string, SearchView>();
    for (const { key, value } of searchViews({
      ageGroups,
      built,
      storedGames: loadScoutGames(),
      held,
    })) {
      // Read back as a device reads it: through JSON and the list's own check.
      const read = coerceSearch(JSON.parse(JSON.stringify(value)));
      if (!read) throw new Error(`list ${key} does not read back`);
      lists.set(key, read);
    }
    const years = [...new Set(ageGroups.map((group) => ageGroupYear(group)))];
    expect(lists.size).toBe(years.length);
    const seen = { options: 0, coached: 0, linked: 0, league: 0, playedBy: 0 };
    for (const year of years) {
      // The page on a page of this year: its own derivation, over the year's stored games.
      const allKnown = deriveAllKnown({
        ageGroups,
        teams,
        yearGames: loadScoutGamesForYear(year),
        readSeason,
      });
      const games = clubSearchGames(
        allKnown.derivedGames,
        loadScoutGames(),
        allKnown.teams,
        ageGroups
      );
      const { pagesByTeam, playedBy } = clubSearchPages(allKnown.teams, games, ageGroups);
      const options = clubSearchOptions(allKnown.teams, pagesByTeam, playedBy);
      const list = lists.get(searchKey(year));
      if (!list) throw new Error(`no list for ${String(year)}`);
      expect(list.options, String(year)).toEqual(options);
      expect(Object.fromEntries(list.pageOf), String(year)).toEqual(
        Object.fromEntries([...pagesByTeam].map(([teamId, page]) => [teamId, page.ageGroupId]))
      );
      seen.options += options.length;
      seen.coached += options.filter((option) => option.coaches).length;
      seen.linked += options.filter((option) => option.gcIds).length;
      seen.playedBy += options.filter((option) => option.detail?.includes("played by")).length;
      const leagueIds = new Set(
        allKnown.derivedGames.flatMap((game) => [game.teamAId, game.teamBId])
      );
      seen.league += options.filter((option) => leagueIds.has(option.id)).length;
      // A pasted id the copy keeps off every page is answered as the page answers it.
      for (const gcId of [
        "gcWAITING001",
        "gcWAITING002",
        "gcDROPPED001",
        "gcTOOYOUNG01",
        "gcNOWHERE001",
      ])
        expect(whereIsGcId(gcId, list.held), gcId).toBe(whereIsGcId(gcId, held));
    }
    // Every case a list carries is reached.
    expect(
      Object.values(seen).every((count) => count > 0),
      JSON.stringify(seen)
    ).toBe(true);
  });
});
