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
import { type AutoRemovals } from "../autoRemoved";
import { NO_RETIRED, retireIds, type RetiredIds } from "../teamRankings/retiredIds";
import { removedClubIds } from "../removedClubs";
import { withoutClubs } from "../unrealClubs";
import type { TeamBase } from "../types";

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
 *
 * `picks`, where the reader holds every season (`seasonsReader`, a browser's `readStoredSeason`), is
 * every club a League Standings team picks in any of them, claimed by a page or not: what a mint
 * holds as taken (`retiredWithPicks`). A start of Team Rankings leaves no page claiming a season,
 * so the pages' seasons alone would say nothing of the picks a start exposes.
 */
export type SeasonReader = {
  (seasonId: string): LeagueSeasonData;
  readonly picks?: () => readonly string[];
};

const NO_SEASON: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

/** Every club the teams of `seasons` pick (`TeamBase.scoutTeamId`), each once, in order. */
export const picksOf = (seasons: Iterable<{ teams: readonly TeamBase[] }>): string[] => {
  const picked = new Set<string>();
  for (const { teams } of seasons) {
    teams.forEach((team) => {
      if (team.scoutTeamId) picked.add(team.scoutTeamId);
    });
  }
  return [...picked];
};

/** A reader of `seasons`, every season there is, which can say what they pick. */
export const seasonsReader = (seasons: ReadonlyMap<string, LeagueSeasonData>): SeasonReader =>
  Object.assign((seasonId: string) => seasons.get(seasonId) ?? NO_SEASON, {
    picks: () => picksOf(seasons.values()),
  });

/** Held by nothing: the picks of clubs gone are let go of whatever else a mint holds. */
const NOTHING_HELD = { has: () => false };

/**
 * The high-water a mint that can read League Standings is held to: `retired`, the roster's own,
 * raised over every club a League Standings team picks that `roster` does not hold
 * (`SeasonReader.picks`). Such a pick names an id let go of, before the roster kept a high-water or
 * across a start of Team Rankings, which empties it. Minted again, the pick named the new club: the
 * league's games went onto that club's record and the club's results into the league's forecast,
 * and nothing said so. Held, it reads as a club gone, and a pick kept with a GameChanger id is
 * followed (`readPick`).
 *
 * Worked out afresh by each run that mints, from the seasons it reads already, and never stored, so
 * it costs no read and no write: the pull and its tidy, a game added by name on either page, the
 * clubs a league's teams are carried onto, and the device's own pull, tidy and stand-ins.
 */
export const retiredWithPicks = (
  retired: RetiredIds,
  readSeason: SeasonReader | null | undefined,
  roster: readonly { id: string }[]
): RetiredIds => {
  const gone = new Set(readSeason?.picks?.());
  if (gone.size === 0) return retired;
  for (const team of roster) {
    if (gone.delete(team.id) && gone.size === 0) return retired;
  }
  return retireIds(retired, gone, NOTHING_HELD);
};

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
  /**
   * The clubs left out as plainly made up (`autoRemoved`), whose games are gone from `games`: what
   * a list of stored games leaves out too, so it does not name a club the roster no longer has.
   */
  removed: ReadonlySet<string>;
  /** The clubs the marks would take off that a League Standings team links, and so stay. */
  leagueKept: ReadonlySet<string>;
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
 *
 * A club taken off as plainly made up (`autoRemoved`, every GameChanger id of it marked, and no
 * page's own team) is left out, with every game naming it, as Delete club would take it out
 * (`withoutClubs`), unless a League Standings team picks it or is carried onto it by its name: the
 * user's league says it is real, and only this pass reads League Standings, so the guard is here.
 * It goes after the league pass, which links League Standings teams off the stored games as they
 * are, so a club the league links is still found, and with no club to leave out everything is
 * exactly as it was. Required, so no caller can forget the marks and draw a board with the club.
 *
 * A league team's club is minted under no id the stored roster has let go of (`retired`), as a
 * stored club is not: under a folded club's id, a pick of the folded club found it, and the
 * league's games went onto it. Nor under one a League Standings team picks that the roster no
 * longer holds, where `readSeason` can say (`retiredWithPicks`).
 */
export const deriveAllKnown = ({
  ageGroups,
  teams: scoutTeams,
  yearGames,
  readSeason,
  autoRemoved,
  retired = NO_RETIRED,
}: {
  ageGroups: AgeGroup[];
  /** The stored roster, as `loadScoutTeams` decodes it. */
  teams: ScoutTeam[];
  /** One squad year's stored games, as `loadScoutGamesForYear` decodes them. */
  yearGames: ScoutGame[];
  readSeason: SeasonReader;
  /** The clubs taken off as plainly made up, by GameChanger id (`loadAutoRemoved`). */
  autoRemoved: AutoRemovals;
  /** The ids the stored roster has let go of, as `loadRetiredIds` reads them off it. */
  retired?: RetiredIds;
}): AllKnown => {
  const pass = leaguePass(ageGroups, scoutTeams, yearGames, readSeason, retired);
  // Taken off as plainly made up, unless a League Standings team links it.
  const marked = removedClubIds(scoutTeams, ageGroups, autoRemoved);
  const removed = new Set([...marked].filter((id) => !pass.linked.has(id)));
  const leagueKept = new Set([...marked].filter((id) => pass.linked.has(id)));
  const left = withoutClubs(removed, pass.teams, yearGames, ageGroups);
  // `derivedGames` stays whole — the page reads it to decide which teams arrived from the league —
  // while `games` gets one row per real fixture.
  return {
    teams: left.teams,
    derivedGames: pass.derivedGames,
    pickedOnly: new Set([...pass.picked].filter((id) => !pass.named.has(id))),
    leagueClubs: pass.leagueClubs,
    leagueHalves: pass.leagueHalves,
    games: dedupeLeagueFixtures(
      [...pass.derivedGames, ...left.games],
      leagueStandIns(left.teams, ageGroups)
    ),
    removed,
    leagueKept,
  };
};

/**
 * The League Standings pass of `deriveAllKnown`, alone: every page's seasons carried onto the
 * roster, and the clubs a League Standings team links, picked, by name, or carried onto.
 */
const leaguePass = (
  ageGroups: AgeGroup[],
  scoutTeams: ScoutTeam[],
  yearGames: ScoutGame[],
  readSeason: SeasonReader,
  retired: RetiredIds = NO_RETIRED
) => {
  let teams = scoutTeams;
  const derivedGames: ScoutGame[] = [];
  const picked = new Set<string>();
  const named = new Set<string>();
  const leagueClubs = new Map<string, Map<string, Map<string, string>>>();
  const leagueHalves = new Map<string, Map<string, Set<SeasonSegment>>>();
  const stored = { games: yearGames, ageGroups };
  // A league team's club is minted under no id a League Standings team picks that the roster no
  // longer holds either: a season's pick found the club made under it, and a game added by name
  // adopted that club into the roster under the pick's id.
  const held = retiredWithPicks(retired, readSeason, scoutTeams);
  ageGroups.forEach((group) => {
    const seasons: LeagueSeasonSnapshot[] = group.seasonIds.map((seasonId) => {
      const { teams: leagueTeams, matchups, logs } = readSeason(seasonId);
      return { seasonId, teams: leagueTeams, matchups, logs };
    });
    // The page's squad year supplies the year a League Standings date does not carry.
    const year = ageGroupYear(group);
    const derived = deriveLeagueScoutGames(group.id, seasons, teams, year, stored, held);
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
  const linked = new Set([
    ...picked,
    ...named,
    ...[...leagueClubs.values()].flatMap((seasons) =>
      [...seasons.values()].flatMap((clubs) => [...clubs.values()])
    ),
  ]);
  return { teams, derivedGames, picked, named, leagueClubs, leagueHalves, linked };
};

/**
 * Every club a League Standings team links in any squad year with a page holding a season (picked,
 * by name, or carried onto), as the boards of each such year read it (`deriveAllKnown`): only the
 * League Standings pass, a year at a time, and none at all with no season on a page.
 *
 * What a step that reads no League deletes a club by must leave alone too: only this pass can see a
 * League team's link, so the tidy's not-a-team step is handed these with the clubs said to be real,
 * and a club the league plays stays whatever its pages are called.
 */
export const leagueLinkedClubs = ({
  ageGroups,
  teams,
  gamesOfYear,
  readSeason,
}: {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  /** A squad year's stored games (`loadScoutGamesForYear`). */
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  readSeason: SeasonReader;
}): Set<string> => {
  const linked = new Set<string>();
  const years = new Set(
    ageGroups.filter((group) => group.seasonIds.length > 0).map((group) => ageGroupYear(group))
  );
  years.forEach((year) => {
    leaguePass(ageGroups, teams, gamesOfYear(year), readSeason).linked.forEach((id) =>
      linked.add(id)
    );
  });
  return linked;
};

/**
 * `leagueLinkedClubs` of a whole pool held in memory, its games split by their pages' squad years:
 * what the tidy and the import, on a device or in the cloud, are told to spare.
 */
export const leagueLinkedClubsOf = (
  pool: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] },
  readSeason: SeasonReader
): Set<string> => {
  const yearOf = new Map(pool.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return leagueLinkedClubs({
    ageGroups: pool.ageGroups,
    teams: pool.teams,
    gamesOfYear: (year) => pool.games.filter((game) => yearOf.get(game.ageGroupId) === year),
    readSeason,
  });
};

/**
 * The clubs the marks would take off (`removedClubIds`) that a League Standings team links
 * (`leagueLinkedClubs`), and that therefore stay on their boards (`deriveAllKnown`'s guard): what
 * Pool health, which lists the whole pool rather than a year, says is kept rather than removed.
 * None at all, and no League pass, with no club to keep.
 */
export const leagueKeptClubs = ({
  ageGroups,
  teams,
  gamesOfYear,
  readSeason,
  autoRemoved,
}: {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  /** A squad year's stored games (`loadScoutGamesForYear`). */
  gamesOfYear: (year: number | undefined) => ScoutGame[];
  readSeason: SeasonReader;
  autoRemoved: AutoRemovals;
}): Set<string> => {
  const marked = removedClubIds(teams, ageGroups, autoRemoved);
  if (marked.size === 0) return new Set<string>();
  const linked = leagueLinkedClubs({ ageGroups, teams, gamesOfYear, readSeason });
  return new Set([...linked].filter((id) => marked.has(id)));
};

/**
 * What a squad year's archive is frozen from (`archiveSquadYear`'s `shown`): the year as its boards
 * show it, League Standings' games and every stored game of every year, one row per real fixture,
 * less the clubs `known` left out as plainly made up, taken out as `deriveAllKnown` takes them out
 * (`withoutClubs`, so a claimed row in one of their games stands back up). Every year's, since the
 * year archived need not be the one `known` was derived for; the archive keeps only its own.
 */
export const archivedFrom = (
  known: Pick<AllKnown, "teams" | "derivedGames" | "removed">,
  stored: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] }
): { teams: ScoutTeam[]; games: ScoutGame[] } => ({
  teams: known.teams,
  games: dedupeLeagueFixtures(
    [
      ...known.derivedGames,
      ...withoutClubs(known.removed, stored.teams, stored.games, stored.ageGroups).games,
    ],
    leagueStandIns(known.teams, stored.ageGroups)
  ),
});

/**
 * The clubs on a page whose games there came from a League Standings season rather than being
 * logged by hand: derived games only (`AllKnown.derivedGames`), so a game added by hand never reads
 * as a league one. The page badges them, and a server publishing its boards flags their rows.
 */
export const leagueTeamIdsOn = (derivedGames: readonly ScoutGame[], pageId: string): Set<string> =>
  new Set(
    derivedGames
      .filter((game) => game.ageGroupId === pageId)
      .flatMap((game) => [game.teamAId, game.teamBId])
  );

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
