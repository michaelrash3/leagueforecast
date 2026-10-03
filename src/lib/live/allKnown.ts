import {
  ageGroupYear,
  dateInSquadYear,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  leagueStandIns,
  segmentOfDate,
  type AgeGroup,
  type LeagueSeasonSnapshot,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "../teamRankings";

/**
 * Every team and game Team Rankings knows about for one squad year, as one pure function of the
 * stored pool, so the page and a server holding the same copy derive the same thing.
 *
 * It was the body of a memo in `TeamRankingsView`, which read each League Standings season out of
 * localStorage as it went. The seasons now arrive through `readSeason`, the one thing a browser and
 * a server read differently: the page hands it the storage loaders, a server the cloud copy's
 * `league` part. Nothing else moved, and the order of every walk is the order it was, because the
 * digits depend on it (`fitScoutYear` keeps its nodes in roster order and sums its games in pool
 * order) and so do the ids minted for league teams.
 */

/** One League Standings season's data, as `readSeason` hands it over. */
export type LeagueSeasonData = Omit<LeagueSeasonSnapshot, "seasonId">;

/**
 * A season's teams, schedule and results by its id. An id with nothing stored must come back empty,
 * `{ teams: [], matchups: [], logs: {} }`, as the storage loaders return it, not be left out: a
 * season with no data still has an entry in `leagueClubs` and `leagueHalves`.
 */
export type SeasonReader = (seasonId: string) => LeagueSeasonData;

export type AllKnown = {
  /** The stored roster, then every league team not already in it, in the order they were met. */
  teams: ScoutTeam[];
  /** Every game a League Standings season carries onto a page, before any are folded away. */
  derivedGames: ScoutGame[];
  /**
   * The clubs League Standings reaches only through a person's pick, on every page. A pick holds
   * by id, so a new name keeps the league's games where they are; a club any season reaches by its
   * name, a guess or two teams' clashing picks included, loses them to the rename, and stays
   * locked.
   */
  pickedOnly: Set<string>;
  /** Page, then league season, then league team, to the club it was carried onto. */
  leagueClubs: Map<string, Map<string, Map<string, string>>>;
  /** Page, then league season, to the halves of the year its schedule is played in. */
  leagueHalves: Map<string, Map<string, Set<SeasonSegment>>>;
  /**
   * The pool every rating, record and page is built from: the league's games then the stored ones,
   * one row per real fixture, so a pulled copy of a league game does not count the game twice.
   */
  games: ScoutGame[];
};

/**
 * Derived once, over every age group, because a scout id minted for a league team is only unique
 * against the roster it was minted alongside: `mintScoutTeamId` breaks a name collision by
 * counting, so "Lexington Legends" is `S-LEXI` when the 9U season is walked first and `S-LEXI2`
 * when a 10U "Lexington Lions" got there ahead of it. Two passes over different sets of age groups
 * therefore hand the same club two different ids, and anything that looked a row up in the other
 * pass's roster would miss, or worse, hit the wrong club. One pass, one set of ids, and every
 * narrower view is a filter of it rather than a second derivation.
 *
 * Teams already in the stored roster are matched by name and keep the ids they were saved with,
 * so widening this pass does not renumber anything already on disk.
 *
 * A league team Settings links to a club — picked, or the one club of its name on the season's
 * pages — is carried onto that club instead, read off `yearGames`, the stored games of the year
 * being shown, which is the year every board is built from. A season on a page of another year
 * keeps its picks and goes by name for the rest. So the result is a year's, and a server that
 * shows several years derives it once for each, always walking every age group.
 */
export const deriveAllKnown = ({
  ageGroups,
  teams: scoutTeams,
  yearGames,
  readSeason,
}: {
  ageGroups: AgeGroup[];
  /** The stored roster, as `loadScoutTeams` decodes it. */
  teams: ScoutTeam[];
  /** One squad year's stored games, as `loadScoutGamesForYear` decodes them. */
  yearGames: ScoutGame[];
  readSeason: SeasonReader;
}): AllKnown => {
  let teams = scoutTeams;
  const derivedGames: ScoutGame[] = [];
  const picked = new Set<string>();
  const named = new Set<string>();
  const leagueClubs = new Map<string, Map<string, Map<string, string>>>();
  const leagueHalves = new Map<string, Map<string, Set<SeasonSegment>>>();
  const stored = { games: yearGames, ageGroups };
  ageGroups.forEach((group) => {
    const seasons: LeagueSeasonSnapshot[] = group.seasonIds.map((seasonId) => {
      const { teams: leagueTeams, matchups, logs } = readSeason(seasonId);
      return { seasonId, teams: leagueTeams, matchups, logs };
    });
    // The page's squad year supplies the year a League Standings date does not carry.
    const year = ageGroupYear(group);
    const derived = deriveLeagueScoutGames(group.id, seasons, teams, year, stored);
    teams = derived.teams;
    derivedGames.push(...derived.games);
    derived.pickedClubIds.forEach((id) => picked.add(id));
    derived.namedClubIds.forEach((id) => named.add(id));
    leagueClubs.set(group.id, derived.clubByLeagueTeam);
    // The halves each season's schedule falls in, dated as its games just were.
    leagueHalves.set(
      group.id,
      new Map(
        seasons.map(({ seasonId, matchups }) => {
          const halves = new Set<SeasonSegment>();
          matchups.forEach((matchup) => {
            const half = segmentOfDate(dateInSquadYear(matchup.date, year), year);
            if (half) halves.add(half);
          });
          return [seasonId, halves];
        })
      )
    );
  });
  // `derivedGames` stays whole — the page reads it to decide which teams arrived from the league —
  // while `games` gets one row per real fixture.
  return {
    teams,
    derivedGames,
    pickedOnly: new Set([...picked].filter((id) => !named.has(id))),
    leagueClubs,
    leagueHalves,
    games: dedupeLeagueFixtures([...derivedGames, ...yearGames], leagueStandIns(teams, ageGroups)),
  };
};

/**
 * The games a year's boards are fitted over: those filed on the pages that share its pool
 * (`rankingPoolGroupIds`), in order. `games` itself when every game is on them, so a page that
 * switches from 9U to 10U hands the rankings worker the array it already holds; the worker is sent
 * the year again whenever the array is a new one.
 */
export const gamesOnPages = (games: ScoutGame[], pageIds: readonly string[]): ScoutGame[] => {
  const pages = new Set(pageIds);
  const kept = games.filter((game) => pages.has(game.ageGroupId));
  return kept.length === games.length ? games : kept;
};
