import type { GameLog, Matchup, TeamBase } from "./types";
import {
  buildOpponentAdjustedRatings,
  DEFAULT_SHRINKAGE,
  type OpponentAdjustedRatings,
} from "./powerRating";
import { clamp, isFinal, parseNumber } from "./util";
import { normalizeDateInput, todayIsoDay } from "./date";
import { weightsForGames } from "./ratingRecency";
import { ageLevelFromName } from "./gameChangerApi";

/**
 * What has been split out so far, re-exported so nothing that imports from here had to change.
 *
 * This file was three thousand lines and a hundred and four exports covering rating maths, name
 * handling, season arithmetic, GameChanger linking and ranking assembly. The split is by seam
 * rather than by size: `types` so the pieces can share shapes without importing each other, and
 * `names` because name handling is the one part with no dependency on any of the rest — a club's
 * name is text, and everything done to it is done before a game or a rating exists.
 */
export * from "./teamRankings/types";
export * from "./teamRankings/names";
export * from "./teamRankings/seasons";
export * from "./teamRankings/games";

import {
  gcRowId,
  isScoutGamePlayed,
  type AgeGroup,
  type FoldedRow,
  type GcTeamLink,
  type MatchupPreview,
  type MatchupTier,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
} from "./teamRankings/types";
import {
  countsTowardRating,
  LEAGUE_GAME_PREFIX,
  minutesApart,
  ONE_GAME_WINDOW_MINUTES,
  pairKeyOf,
  ratedMargin,
  sameStart,
  scoreOf,
  scoreSeenBy,
  startMinuteOf,
  startsWithinTheHour,
} from "./teamRankings/games";
import {
  ageGroupChain,
  ageGroupLevel,
  ageGroupYear,
  dateInSquadYear,
  inSegment,
  isRankedAgeLevel,
  rankingPoolGroupIds,
  squadYearForGcSeason,
  type SeasonSegment,
} from "./teamRankings/seasons";
import {
  cleanTeamName,
  filterRankingsByState,
  resolveOrCreateTeam,
  SCOUT_ID_PREFIX,
  teamNameKey,
} from "./teamRankings/names";

/**
 * Team Rankings is a separate, age-group-scoped-but-globally-rostered ranking pool: teams are a
 * single global list (the same real-world opponent is one entity across seasons/age levels), but a
 * ranking is only ever computed for one age group's games at a time (different age levels aren't
 * comparable). An age group is a user-defined label bundling together whichever League Standings
 * seasons belong to the same age level — e.g. "2027" might bundle a "Fall 2026" and a "Spring
 * 2027" season, since a club often runs two (or more) League Standings seasons per age-group year.
 */

/**
 * The most run-differential any single game can contribute. A 20-0 counts as an 8-0: without a cap
 * one blowout against a weak team would outweigh a season of close wins against strong ones.
 *
 * Exported because the app explains its own ranking to the reader, and a number quoted in prose
 * that has drifted from the number in the maths is worse than not quoting it.
 */
export const RATING_CAP = 8;

/**
 * How many standard errors a rating is discounted by before it is ranked or shown.
 *
 * The fit's rating is a best guess, and a best guess from four games is not the same claim as the
 * same number from forty. The ridge already pulls a thin record toward the mean — that is what
 * makes the guess as good as it can be — but it does not make the table honest, because two teams
 * whose best guess is +8 are not equally likely to actually be +8. A four-game team's rating has a
 * standard error of about 1.4 runs on a real pool; a forty-game team's is about 0.6.
 *
 * So what is ranked and shown is the rating less one standard error: not what a team might be, but
 * what it is confidently worth. It is the "conservative rating" a skill system reports, for the
 * same reason, and it is why a 4-0 club sits behind an 11-1 club that has proved as much over
 * nearly three times the schedule.
 *
 * One, measured rather than picked. On the real pool's 2026 year — 59,408 out-of-sample games
 * between teams the fit had seen — discounts from a quarter of an error to one and a half were all
 * inside noise against no discount at all: the best, half an error, was +41 games net of the 1,349
 * the two orders disagreed on (1.1σ), and one error was −15 of 2,649 (−0.3σ). On the 2027 year the
 * picks were identical to four figures. What the discount changes is the table: thin teams in the
 * national top 100 fell from 18 to 6 on the mature year, and on the current one `MTBA Dawgs Moore
 * 4-0` went from first in the nation to third, behind an 11-1 and a 10-1. One standard error is the
 * plain reading of the thing and costs nothing, so it is not tuned any finer than that.
 *
 * Deliberately not a minimum-games cut-off. A cut-off says a team with nine games does not exist
 * and a team with ten is believed outright; this says a thin record counts for as much as it can
 * support, which is the truth and needs no threshold to argue about.
 */
export const EVIDENCE_STANDARD_ERRORS = 1;

/**
 * How far a rating could be off, in runs: `scale / sqrt(games + shrinkage)`.
 *
 * The denominator is the fit's own — a rating stands on its games plus the ridge's virtual ones —
 * and the numerator is the pool's own noise, measured by the fit rather than assumed, because a
 * league of one-run games and a pool of blowouts are not equally uncertain about the same number
 * of games.
 */
export const ratingSpread = (
  games: number,
  residualScale: number,
  shrinkage: number = DEFAULT_SHRINKAGE
): number => residualScale / Math.sqrt(Math.max(0, games) + shrinkage);

/**
 * The discount one fit applies to its ratings before they are ranked or shown.
 *
 * Built per fit rather than per team, because it needs one thing no team knows on its own: how much
 * evidence an *average* team in this pool has. The discount is centred on that, so the table still
 * means what it meant — the rating of a middling team stays near zero and "expected margin against
 * an average team" is still a fair reading of it — while a club with less than its share of
 * evidence loses ground and one with more gains a little.
 *
 * Centring is a single constant added to every rating, so it cannot change any order, and
 * `predictMatchup` takes a difference, so it cancels there too. What it buys is that a pool where
 * everybody has played the same amount is left *exactly* as the fit left it, to the last digit —
 * which is right, because when every club has equal evidence, evidence says nothing about which is
 * better. The per-component zero-sum property of the fit survives that untouched.
 *
 * Centred over the clubs, and over all of them in the year rather than one page's rows. Not one
 * page's rows, because the pages of a year share a fit and a club's shown rating must not depend on
 * which page it happens to be listed on. And not every fitted node either: two thirds of the nodes
 * in a nationwide year are stand-ins and clubs known from a single line of somebody else's
 * schedule, which nothing ever ranks. Centring on those put the average at two games where the
 * average club has fifteen, and lifted the whole table by a run for no reason anybody could read.
 *
 * One subtraction, the same for a good club and a bad one, and no clamp. Both of those were tried
 * the other way round first and both were wrong. Shrinking *toward* zero from either side reads
 * well — "a thin record is weak evidence of being bad, too" — and inverts the table around zero: a
 * twenty-one-game club at +0.085 moved to −0.689 while one at −0.255 moved to +0.519, so the worse
 * club outranked the better one. Clamping at zero to stop that collapses every club within a
 * standard error of average onto exactly 0 — most of the middle of the table — where the sort falls
 * through to raw margin, which is not opponent-adjusted at all. A fixture caught both.
 */
export const evidenceDiscount = (
  adjusted: Pick<OpponentAdjustedRatings, "games" | "residualScale">,
  /** The clubs to centre on. Every fitted team when left out, which is right for a pool of clubs. */
  centreOn?: Iterable<string>,
  shrinkage: number = DEFAULT_SHRINKAGE,
  standardErrors: number = EVIDENCE_STANDARD_ERRORS
): ((rating: number, games: number) => number) => {
  let sum = 0;
  let count = 0;
  const note = (games: number) => {
    sum += ratingSpread(games, adjusted.residualScale, shrinkage);
    count += 1;
  };
  if (centreOn) for (const id of centreOn) note(adjusted.games.get(id) ?? 0);
  else adjusted.games.forEach(note);
  const middle = count > 0 ? sum / count : 0;
  return (rating, games) => {
    const spread = ratingSpread(games, adjusted.residualScale, shrinkage);
    if (!Number.isFinite(spread) || !Number.isFinite(middle)) return rating;
    return rating - standardErrors * (spread - middle);
  };
};

const scoreFor = (log: GameLog | undefined, side: "away" | "home") =>
  parseNumber(side === "away" ? (log?.awayRuns ?? "") : (log?.homeRuns ?? ""), Number.NaN);

export type LeagueSeasonSnapshot = {
  seasonId: string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
};

/**
 * Convert every League Standings season in an age group's *entire schedule* — not just completed
 * games — into scout-style games tagged with that age group, resolving each league team name into
 * the given global scout pool (creating entries the first time a league team name is seen — a team
 * that plays across two seasons in the same age group, e.g. Fall and Spring, resolves to the same
 * scout team both times). A not-yet-final league game comes across as a scheduled entry (no score,
 * same as a manually-logged future game), so its opponent already shows up in the age group ahead
 * of time; a completed one carries its score. Since this runs fresh from live League Standings data
 * on every call, a game that gets finalized there is picked up here as a real result automatically
 * the next time this runs — no separate sync step. Pure — the caller is responsible for loading
 * each season's data and for persisting any newly-created scout teams.
 */

export const deriveLeagueScoutGames = (
  ageGroupId: string,
  seasons: LeagueSeasonSnapshot[],
  scoutTeams: ScoutTeam[],
  /**
   * The squad year of the page these are being carried onto, which is what supplies the year a
   * League Standings date does not carry. Without it every row here reads as dated outside its
   * own season — see `dateInSquadYear`.
   */
  squadYear?: number
): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  let teams = scoutTeams;
  const games: ScoutGame[] = [];

  seasons.forEach(
    ({ seasonId, teams: leagueTeams, matchups: leagueMatchups, logs: leagueLogs }) => {
      const leagueNameById = new Map(leagueTeams.map((team) => [team.id, team.name]));
      const resolvedIdByLeagueId = new Map<string, string>();
      const resolveLeagueTeam = (leagueId: string): string | null => {
        const cached = resolvedIdByLeagueId.get(leagueId);
        if (cached) return cached;
        const name = leagueNameById.get(leagueId);
        if (!name) return null;
        const result = resolveOrCreateTeam(name, teams);
        teams = result.teams;
        resolvedIdByLeagueId.set(leagueId, result.teamId);
        return result.teamId;
      };

      leagueMatchups.forEach((matchup) => {
        const teamAId = resolveLeagueTeam(matchup.away);
        const teamBId = resolveLeagueTeam(matchup.home);
        if (!teamAId || !teamBId) return;

        const log = leagueLogs[matchup.id];
        const awayScore = scoreFor(log, "away");
        const homeScore = scoreFor(log, "home");
        const played = isFinal(log) && Number.isFinite(awayScore) && Number.isFinite(homeScore);

        games.push({
          id: `${LEAGUE_GAME_PREFIX}${seasonId}_${matchup.id}`,
          teamAId,
          teamBId,
          ageGroupId,
          ...(played ? { teamAScore: awayScore, teamBScore: homeScore } : {}),
          date: dateInSquadYear(matchup.date, squadYear),
        });
      });
    }
  );

  return { teams, games };
};

/**
 * The teams that actually belong to one age group: those with at least one game tagged to it,
 * played or scheduled. The stored roster stays global — the same club resolves to one entity as it
 * ages up — but a team only *ranks* where it has games, so logging a 10U opponent never drops that
 * team into the 12U ranking, where its results say nothing.
 */
export const teamsInAgeGroup = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[]
): ScoutTeam[] => {
  const active = new Set<string>();
  games.forEach((game) => {
    if (game.ageGroupId !== ageGroupId || !countsTowardRating(game)) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  return teams.filter((team) => active.has(team.id));
};

/**
 * The team names to offer when logging a game in this age group: everyone played in it, everyone
 * played in the age groups it continues from, and everyone whose home level this year is this
 * group's level — a team pulled from GameChanger onto the 9U page is a 9U team before it has
 * played anyone here. Scoped rather than global so a 9U opponent never shows up in the 11U
 * ranking's name list — the two squads share a roster store but play nobody in common.
 */
export const teamNameSuggestions = (
  ageGroupId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[]
): ScoutTeam[] => {
  const chain = new Set(ageGroupChain(ageGroupId, ageGroups));
  const active = new Set<string>();
  games.forEach((game) => {
    if (!chain.has(game.ageGroupId)) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  const group = ageGroups.find((candidate) => candidate.id === ageGroupId);
  const level = ageGroupLevel(group);
  const year = ageGroupYear(group);
  // Only a group with a year has a pool to be at home in; a legacy group stands alone.
  if (level !== undefined && year !== undefined) {
    const homeLevels = homeLevelsForYear(year, teams, games, ageGroups);
    teams.forEach((team) => {
      if (homeLevels.get(team.id) === level) active.add(team.id);
    });
  }
  // A slot is never offered as a name to log a game against: picking one would attach this
  // game to some other game's unknown opponent.
  return teams.filter((team) => !team.placeholder && active.has(team.id));
};

type WinLoss = { wins: number; losses: number; ties: number };

/**
 * Every team's record in one pass. Asking per team meant a scan of the games for each ranked row,
 * which on a nationwide pool is the table's whole cost several times over.
 */
const recordsFor = (playedGames: ScoutGame[]): Map<string, WinLoss> => {
  const records = new Map<string, WinLoss>();
  const tally = (teamId: string, own: number, opp: number) => {
    let record = records.get(teamId);
    if (!record) {
      record = { wins: 0, losses: 0, ties: 0 };
      records.set(teamId, record);
    }
    if (own > opp) record.wins += 1;
    else if (own < opp) record.losses += 1;
    else record.ties += 1;
  };
  playedGames.forEach((game) => {
    // Each side by its own schedule's score, so a result the two disagree about is each club's own.
    [game.teamAId, game.teamBId].forEach((teamId) => {
      const seen = scoreSeenBy(game, teamId);
      if (seen) tally(teamId, seen.own, seen.opponent);
    });
  });
  return records;
};

const NO_RECORD: WinLoss = { wins: 0, losses: 0, ties: 0 };

// ---------- Levels, pools and cross-age games ----------

/**
 * Age groups looked up once per call rather than once per game: a season-wide pool fed from
 * GameChanger can hold tens of thousands of games, and a legacy group's level and year come from
 * parsing its name.
 */
type GroupIndex = {
  level: (ageGroupId: string) => number | undefined;
  year: (ageGroupId: string) => number | undefined;
};

const indexGroups = (ageGroups: AgeGroup[]): GroupIndex => {
  const levels = new Map(ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const years = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return { level: (id) => levels.get(id), year: (id) => years.get(id) };
};

type SideLevels = { a?: number; b?: number };

const sideLevelsWith = (game: ScoutGame, index: GroupIndex): SideLevels => {
  const filed = index.level(game.ageGroupId);
  const a = game.ageLevelA ?? filed;
  const b = game.ageLevelB ?? filed;
  return { ...(a === undefined ? {} : { a }), ...(b === undefined ? {} : { b }) };
};

/** The level each side played a game at: recorded on the game, else the filed group's level. */
export const gameSideLevels = (game: ScoutGame, ageGroups: AgeGroup[]): SideLevels =>
  sideLevelsWith(game, indexGroups(ageGroups));

/**
 * Team A's level minus team B's — the age gap the rating model reads, with A in the home seat as
 * every Team Rankings game is passed. Zero when either level is unknown: a game that cannot say
 * who was older is treated as a same-level game rather than guessed at.
 */
const ageGapOf = (levels: SideLevels): number =>
  levels.a === undefined || levels.b === undefined ? 0 : levels.a - levels.b;

/** GameChanger's seasons in the order a squad year plays them, so the latest pulled season wins. */
const GC_SEASON_ORDER: Record<string, number> = { fall: 0, winter: 1, spring: 2, summer: 3 };

/**
 * The squad year a link sits in: the year of the group it is filed under, since that is where the
 * user (or the importer, with the user's approval) put it; otherwise what its GameChanger season
 * implies. A link filed under a legacy group with no year and carrying no season has no year.
 */
const gcLinkYear = (link: GcTeamLink, index: GroupIndex): number | undefined => {
  const filed = index.year(link.ageGroupId);
  if (filed !== undefined) return filed;
  return link.seasonYear === undefined
    ? undefined
    : squadYearForGcSeason(link.season, link.seasonYear);
};

/** The value seen most often, the first seen winning a tie; undefined when there are none. */
const mostCommon = (values: (number | undefined)[]): number | undefined => {
  const counts = new Map<number, number>();
  values.forEach((value) => {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

/**
 * The home-level rule, given a team's own games in the year. GameChanger's word comes first
 * because it is the one source that states a team's level outright; the latest season wins
 * because a squad that was 9U in the fall and is listed 10U in the spring has aged up. Failing a
 * link, what the games recorded for this side; failing that, where the games were filed.
 */
const homeLevelOf = (
  team: ScoutTeam | undefined,
  teamId: string,
  year: number | undefined,
  teamGamesInYear: ScoutGame[],
  index: GroupIndex
): number | undefined => {
  let linked: { order: number; level: number } | undefined;
  for (const link of team?.gcTeams ?? []) {
    if (gcLinkYear(link, index) !== year) continue;
    const level = index.level(link.ageGroupId) ?? link.ageLevel;
    if (level === undefined) continue;
    const order = GC_SEASON_ORDER[(link.season ?? "").trim().toLowerCase()] ?? -1;
    if (!linked || order > linked.order) linked = { order, level };
  }
  if (linked) return linked.level;

  const recorded = mostCommon(
    teamGamesInYear.map((game) => (game.teamAId === teamId ? game.ageLevelA : game.ageLevelB))
  );
  if (recorded !== undefined) return recorded;
  return mostCommon(teamGamesInYear.map((game) => index.level(game.ageGroupId)));
};

/** Home level for every team at once — one pass over the games instead of one per team. */
const homeLevelsForYear = (
  year: number | undefined,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): Map<string, number | undefined> => {
  const index = indexGroups(ageGroups);
  const gamesByTeam = new Map<string, ScoutGame[]>();
  games.forEach((game) => {
    if (index.year(game.ageGroupId) !== year) return;
    [game.teamAId, game.teamBId].forEach((id) => {
      const list = gamesByTeam.get(id);
      if (list) list.push(game);
      else gamesByTeam.set(id, [game]);
    });
  });
  return new Map(
    teams.map((team) => [
      team.id,
      homeLevelOf(team, team.id, year, gamesByTeam.get(team.id) ?? [], index),
    ])
  );
};

/** The page a team is found on: its age group, and that group's level and year for display. */
export type TeamPage = {
  ageGroupId: string;
  level: number | undefined;
  year: number | undefined;
};

/**
 * Where to find each team — the one page in the whole pool that team belongs on.
 *
 * Searching for a club is the one thing the age tabs cannot help with: "Canes Triad Black" is on
 * exactly one page and you have to already know which season and which level to get there, which
 * is the opposite of what searching is for. This answers it once for every team, so a search box
 * can take a name and go.
 *
 * A team's page is its home level in the most recent year it played, rather than the level of any
 * one game: a 9U squad that entered a 10U tournament is a 9U team with a game played up, and
 * landing somebody on the 10U page because of it would be wrong. Most recent, because a club that
 * has been pulled for three seasons should be found where it is now.
 *
 * A team with no page — nothing but games in groups that no longer exist — is absent rather than
 * guessed at. So is a placeholder, which names nobody, and a club known only from somebody else's
 * schedule, which has no page of its own to be on.
 */
export const teamPages = (
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): Map<string, TeamPage> => {
  const index = indexGroups(ageGroups);
  const pages = new Map<string, TeamPage>();
  if (ageGroups.length === 0) return pages;

  /** Age group by level and year, so a home level can be turned back into a page. */
  const groupAt = new Map<string, AgeGroup>();
  ageGroups.forEach((group) => {
    const level = ageGroupLevel(group);
    const year = ageGroupYear(group);
    groupAt.set(`${level ?? "?"}|${year ?? "?"}`, group);
  });

  // The years each team has games in, and the group of its most recent game as a fallback.
  const yearsByTeam = new Map<string, Set<number | undefined>>();
  const latestGroupByTeam = new Map<string, { at: string; ageGroupId: string }>();
  games.forEach((game) => {
    const year = index.year(game.ageGroupId);
    const at = game.date ?? "";
    [game.teamAId, game.teamBId].forEach((teamId) => {
      const years = yearsByTeam.get(teamId);
      if (years) years.add(year);
      else yearsByTeam.set(teamId, new Set([year]));
      const latest = latestGroupByTeam.get(teamId);
      if (!latest || at > latest.at)
        latestGroupByTeam.set(teamId, { at, ageGroupId: game.ageGroupId });
    });
  });

  // One home-level pass per distinct year rather than one per team.
  const eligible = teams.filter((team) => !team.placeholder && !team.nameOnly);
  const years = new Set<number | undefined>();
  yearsByTeam.forEach((teamYears) => teamYears.forEach((year) => years.add(year)));
  const homeLevels = new Map<number | undefined, Map<string, number | undefined>>();
  years.forEach((year) =>
    homeLevels.set(year, homeLevelsForYear(year, eligible, games, ageGroups))
  );

  eligible.forEach((team) => {
    const teamYears = [...(yearsByTeam.get(team.id) ?? [])];
    if (teamYears.length === 0) return;
    // The most recent year it played; a group with no year sorts below every year that has one.
    const latestYear = teamYears.reduce((best, year) =>
      best === undefined ? year : year === undefined ? best : Math.max(best, year)
    );
    const level = homeLevels.get(latestYear)?.get(team.id);
    const group = groupAt.get(`${level ?? "?"}|${latestYear ?? "?"}`);
    if (group) {
      pages.set(team.id, {
        ageGroupId: group.id,
        level: ageGroupLevel(group),
        year: ageGroupYear(group),
      });
      return;
    }
    // No page at that level — a team whose only games are filed somewhere unexpected. Its most
    // recent game's own group is where somebody looking for it would actually find its results.
    const fallbackId = latestGroupByTeam.get(team.id)?.ageGroupId;
    const fallback = ageGroups.find((entry) => entry.id === fallbackId);
    if (fallback) {
      pages.set(team.id, {
        ageGroupId: fallback.id,
        level: ageGroupLevel(fallback),
        year: ageGroupYear(fallback),
      });
    }
  });

  return pages;
};

/**
 * A team's home level in a season year: the level of the age group its GameChanger link for that
 * year is filed under (latest season wins: fall < winter < spring < summer within a squad year);
 * else the level its games in that year most often record for it (ageLevelA/B); else the level
 * most of its games that year are filed under; else undefined.
 *
 * "Home" is the level the team belongs to, as opposed to the level of any one game: a 9U squad
 * that enters a 10U tournament is still a 9U team, ranked on the 9U page, with that tournament
 * counted as playing up. `year` undefined asks about the legacy pool of groups with no year.
 */
export const teamHomeAgeLevel = (
  teamId: string,
  year: number | undefined,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): number | undefined => {
  const index = indexGroups(ageGroups);
  const team = teams.find((candidate) => candidate.id === teamId);
  const teamGamesInYear = games.filter(
    (game) =>
      (game.teamAId === teamId || game.teamBId === teamId) && index.year(game.ageGroupId) === year
  );
  return homeLevelOf(team, teamId, year, teamGamesInYear, index);
};

/**
 * How strongly two rows about the same two clubs on the same day say they are one game, or
 * `undefined` when they are two. Callers ask it only of rows already known to share the pair, the
 * date and the rating pool; this is the rest of the question, answered once for both the import
 * (`matchExistingGame`) and the tidy (`collapseSameGames`) so the two cannot drift apart.
 *
 * Rows off one schedule are two games unless they are the same row or one game listed twice:
 * GameChanger does list a game twice, under two ids with the opponent spelled two ways, and then the
 * two rows give the same start (`sameStart`), or give the same result within the hour
 * (`ONE_GAME_WINDOW_MINUTES` says why only then). A doubleheader is two rows at two slots, often
 * exactly an hour apart, and must stay two.
 *
 * Rows off two schedules are the two clubs' copies of what may be one game, and the clock there is
 * only what each coach typed. So, strongest first: starts within the hour and the same result; the
 * same result whatever the clocks say (1,213 such pairs off two schedules in the pool of 24
 * September 2026, against 7 in the same search a week off); starts within the hour with a result
 * still to come on one side; starts within the hour whose scorekeepers disagree. A result that
 * agrees outranks a slot that merely has none yet, so a copy posted between the two games of a
 * doubleheader goes to the game it reports rather than the empty slot nearer its clock. With no
 * start on one side the result is all there is: the same result, or no result yet, is one game, and
 * two results that contradict are a doubleheader.
 */
export type SameGameEvidence = {
  /** Higher is stronger; see `EVIDENCE`. */
  strength: number;
  /** Minutes between the two starts, or Infinity when either has none — nearer wins a tie. */
  gap: number;
};

export const EVIDENCE = {
  /** One schedule's own game id: the same row, pulled again. */
  sameRow: 7,
  /** Two schedules within the hour and the same result; one schedule at the same start. */
  togetherScored: 6,
  /** Two schedules' same result at any start; one schedule's same result within the hour. */
  sameResult: 5,
  /** Two schedules within the hour, with a result still to come on one side or both. */
  together: 4,
  /** Two schedules within the hour, with two different results. */
  scoredApart: 3,
  /** No start on one side, and no result on either. */
  untimedUnplayed: 2,
  /** No start on one side, and a result on only one. */
  untimedOneResult: 1,
} as const;

const scoredGame = (game: ScoutGame): boolean =>
  game.teamAScore !== undefined && game.teamBScore !== undefined;

/** Both scored, and the same result read from either seat. */
const sameResultAs = (row: ScoutGame, other: ScoutGame): boolean =>
  scoredGame(row) &&
  scoredGame(other) &&
  scoreOf(other, row.teamAId) === row.teamAScore &&
  scoreOf(other, row.teamBId) === row.teamBScore;

export const sameGameEvidence = (
  row: ScoutGame,
  other: ScoutGame
): SameGameEvidence | undefined => {
  const gap = minutesApart(row.startTs, other.startTs) ?? Infinity;
  const at = (strength: number): SameGameEvidence => ({ strength, gap });
  const bothScored = scoredGame(row) && scoredGame(other);
  const same = sameResultAs(row, other);

  const source = row.source;
  if (source && other.source && other.source.teamId === source.teamId) {
    if (other.source.gameId === source.gameId) return at(EVIDENCE.sameRow);
    if (sameStart(row.startTs, other.startTs)) return at(EVIDENCE.togetherScored);
    if (startsWithinTheHour(row.startTs, other.startTs) && same) return at(EVIDENCE.sameResult);
    return undefined;
  }

  const bothTimed = row.startTs !== undefined && other.startTs !== undefined;
  if (bothTimed) {
    const near = startsWithinTheHour(row.startTs, other.startTs);
    if (near && same) return at(EVIDENCE.togetherScored);
    if (same) return at(EVIDENCE.sameResult);
    if (near) return at(bothScored ? EVIDENCE.scoredApart : EVIDENCE.together);
    return undefined;
  }
  if (bothScored) return same ? at(EVIDENCE.sameResult) : undefined;
  return at(
    scoredGame(row) || scoredGame(other) ? EVIDENCE.untimedOneResult : EVIDENCE.untimedUnplayed
  );
};

/** Within the hour and not contradicting: all a schedule-only record takes back (`mayTakeRow`). */
const agreesWithinTheHour = (evidence: SameGameEvidence): boolean =>
  evidence.gap <= ONE_GAME_WINDOW_MINUTES &&
  (evidence.strength === EVIDENCE.togetherScored || evidence.strength === EVIDENCE.together);

const strongerEvidence = (a: SameGameEvidence, b: SameGameEvidence): boolean =>
  a.strength !== b.strength ? a.strength > b.strength : a.gap < b.gap;

/**
 * Same pair (either order) on the same date in the same pool — what a re-pull or the other team's
 * copy of a game matches. Unlike `findDuplicateGame`, the score is exactly what may have changed: a
 * scheduled game is now final, or the other side's schedule reports the same result from its seat.
 * The pool rather than the group, because the two sides of a cross-age game file it under
 * different pages.
 *
 * Of the rows that could be it, the one `sameGameEvidence` rates strongest, the nearer start
 * breaking a tie. `accept` lets a caller pass over rows it has already spoken for: an import that
 * matched one of a schedule's rows to a game should not match a second row off that schedule to it
 * as well, since one schedule lists one game once.
 */
export const matchExistingGame = (
  candidate: ScoutGame,
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  accept: (game: ScoutGame) => boolean = () => true
): ScoutGame | null => {
  const pool = new Set(rankingPoolGroupIds(candidate.ageGroupId, ageGroups));
  const pairKey = pairKeyOf(candidate);
  const date = candidate.date ?? "";

  let best: { evidence: SameGameEvidence; game: ScoutGame } | null = null;
  for (const game of games) {
    if (game.id === candidate.id || !pool.has(game.ageGroupId)) continue;
    if (pairKeyOf(game) !== pairKey || (game.date ?? "") !== date) continue;
    const evidence = sameGameEvidence(candidate, game);
    if (!evidence || !accept(game)) continue;
    if (!best || strongerEvidence(evidence, best.evidence)) best = { evidence, game };
    if (evidence.strength === EVIDENCE.sameRow) break;
  }
  return best ? best.game : null;
};

/**
 * A row's place in the rating pool, so two copies of a cross-age game — each side files it under
 * its own page — land in one bucket. A group with no year stands alone, as `rankingPoolGroupIds`
 * has it.
 */
const poolKeyFor = (ageGroupId: string, index: GroupIndex): string => {
  const year = index.year(ageGroupId);
  return year === undefined ? `g${ageGroupId}` : `y${year}`;
};

/**
 * The record a game keeps of a row folded into it (`ScoutGame.alsoRows`): the schedule and id, the
 * start, and the score as the row's own schedule gave it. A score the row had only borrowed from the
 * other club's schedule (`scoreFromB`) is not its own and is not kept. Undefined for a row with no
 * schedule behind it — a league fixture or a game typed in — which has nothing to be found by.
 */
export const recordOf = (holder: ScoutGame, row: ScoutGame): FoldedRow | undefined => {
  if (!row.source) return undefined;
  const onSideB = row.teamAId === holder.teamBId && holder.teamAId !== holder.teamBId;
  const own = !row.scoreFromB && scoredGame(row);
  return {
    teamId: row.source.teamId,
    gameId: row.source.gameId,
    ...(row.startTs ? { startTs: row.startTs } : {}),
    ...(own ? { ownScore: row.teamAScore!, opponentScore: row.teamBScore! } : {}),
    ...(onSideB ? { onSideB: true } : {}),
  };
};

/** A folded row stood back up as the row it was: its own club on side A, as a pulled row has it. */
export const rowOfRecord = (holder: ScoutGame, record: FoldedRow): ScoutGame => {
  const [own, other] = record.onSideB
    ? [holder.teamBId, holder.teamAId]
    : [holder.teamAId, holder.teamBId];
  const [ownLevel, otherLevel] = record.onSideB
    ? [holder.ageLevelB, holder.ageLevelA]
    : [holder.ageLevelA, holder.ageLevelB];
  return {
    id: gcRowId(record.teamId, record.gameId),
    teamAId: own,
    teamBId: other,
    ageGroupId: holder.ageGroupId,
    ...(holder.date ? { date: holder.date } : {}),
    ...(record.startTs ? { startTs: record.startTs } : {}),
    ...(record.ownScore !== undefined && record.opponentScore !== undefined
      ? { teamAScore: record.ownScore, teamBScore: record.opponentScore }
      : {}),
    ...(ownLevel === undefined ? {} : { ageLevelA: ownLevel }),
    ...(otherLevel === undefined ? {} : { ageLevelB: otherLevel }),
    ...(holder.season ? { season: holder.season } : {}),
    source: { kind: "gamechanger", teamId: record.teamId, gameId: record.gameId },
  };
};

/** A result on the row being dropped fills a blank on the one kept; a result already there stands. */
const filledFrom = (keep: ScoutGame, drop: ScoutGame): ScoutGame => {
  if (scoredGame(keep) || !scoredGame(drop)) return keep;
  return {
    ...keep,
    teamAScore: scoreOf(drop, keep.teamAId),
    teamBScore: scoreOf(drop, keep.teamBId),
    ...(drop.scoreFromB ? { scoreFromB: true } : {}),
  };
};

/**
 * `keep`, with `drop` and every row folded into it put on record (`alsoFrom` names the schedules,
 * `alsoRows` keeps each row whole). A newer record of a row replaces an older one.
 *
 * A fold removes a row, and with it the fact that the schedule it came off listed this game. That
 * fact is what the count in `sameGameGroups` reads: without it, a game that has taken the other
 * club's copy still looks like a game only one schedule listed, and the next pass hands it that
 * club's other game of the day as well. On the pool of 24 September 2026 that took a 12-3 win of
 * Bulls-Baker's into a 6-3 against the same club, once the two copies of the 6-3 had been folded.
 * Unchanged, and the same object, when there is nothing new to record.
 */
export const withSchedulesOf = (keep: ScoutGame, drop: ScoutGame): ScoutGame => {
  const own = keep.source?.teamId;
  const schedules = new Set(keep.alsoFrom ?? []);
  const addedSchedules = [
    ...new Set(
      [drop.source?.teamId, ...(drop.alsoFrom ?? [])].filter(
        (source): source is string =>
          source !== undefined && source !== own && !schedules.has(source)
      )
    ),
  ];
  const incoming = [
    recordOf(keep, drop),
    ...(drop.alsoRows ?? []).map((record) => recordOf(keep, rowOfRecord(drop, record))),
  ].filter(
    (record): record is FoldedRow =>
      record !== undefined && gcRowId(record.teamId, record.gameId) !== keep.id
  );
  const rows = new Map(
    (keep.alsoRows ?? []).map((record) => [gcRowId(record.teamId, record.gameId), record])
  );
  let rowsChanged = false;
  incoming.forEach((record) => {
    const id = gcRowId(record.teamId, record.gameId);
    const before = rows.get(id);
    if (before && JSON.stringify(before) === JSON.stringify(record)) return;
    rows.set(id, record);
    rowsChanged = true;
  });
  if (addedSchedules.length === 0 && !rowsChanged) return keep;
  return {
    ...keep,
    ...(addedSchedules.length > 0
      ? { alsoFrom: [...(keep.alsoFrom ?? []), ...addedSchedules] }
      : {}),
    ...(rowsChanged ? { alsoRows: [...rows.values()] } : {}),
  };
};

/**
 * `keep` with the score side B's own copy of the game gave (`reportedByB`), or undefined when
 * `drop` is not that: a row off another schedule whose own club — its side A — is `keep`'s side B.
 *
 * Side B's score goes beside side A's rather than over it, and fills side A's only where side A
 * has posted nothing yet, marked as borrowed (`scoreFromB`) so it goes with side B's row. Each
 * club's page and record then read its own schedule, and the rating both (`ratedMargin`). A copy
 * with no score of its own says nothing and leaves the game as it was.
 */
export const withSideBReport = (keep: ScoutGame, drop: ScoutGame): ScoutGame | undefined => {
  if (drop.source === undefined || keep.teamAId === keep.teamBId) return undefined;
  if (drop.teamAId !== keep.teamBId) return undefined;
  if (!scoredGame(drop) || drop.scoreFromB) return keep;
  const report = {
    teamAScore: scoreOf(drop, keep.teamAId)!,
    teamBScore: scoreOf(drop, keep.teamBId)!,
  };
  const fill = !scoredGame(keep) || keep.scoreFromB === true;
  const known =
    keep.reportedByB?.teamAScore === report.teamAScore &&
    keep.reportedByB.teamBScore === report.teamBScore;
  if (
    known &&
    (!fill || (keep.teamAScore === report.teamAScore && keep.teamBScore === report.teamBScore))
  ) {
    return keep;
  }
  return {
    ...keep,
    ...(fill ? { ...report, scoreFromB: true } : {}),
    reportedByB: report,
  };
};

/**
 * Whether a game may take a row off a schedule it already has on record.
 *
 * A game takes one row off each schedule, so a row off a schedule already on record is one of
 * three things. The same row pulled again. The same game that schedule has since listed twice, or
 * entered again under a new id after deleting the first — read off the record, which keeps the
 * row's start and score (`sameGameEvidence` between the two). Or another game. A record from before
 * rows were kept (`alsoFrom` alone) cannot say, and there a row is taken back only when it starts
 * within the hour of the game and agrees with it — the folded row coming back, which is what 21 of
 * the 23 results listed twice that way in the pool of 24 September 2026 were — and never on a same
 * result alone, which is also what the two games of a doubleheader can give.
 */
export const mayTakeRow = (
  game: ScoutGame,
  row: ScoutGame,
  evidence: SameGameEvidence
): boolean => {
  const schedule = row.source?.teamId;
  if (schedule === undefined || game.source?.teamId === schedule) return true;
  const named = (game.alsoRows ?? []).filter((record) => record.teamId === schedule);
  if (named.length > 0) {
    return named.some(
      (record) =>
        gcRowId(record.teamId, record.gameId) === row.id ||
        sameGameEvidence(row, rowOfRecord(game, record)) !== undefined
    );
  }
  if ((game.alsoFrom ?? []).includes(schedule)) return agreesWithinTheHour(evidence);
  return true;
};

/** Adds a sentence to a note once, so a fold the tidy makes again on every run is written once. */
export const withNote = (note: string | undefined, sentence: string): string =>
  note && note.includes(sentence) ? note : [note, sentence].filter(Boolean).join(" ");

/**
 * What folding `drop` into `keep` leaves on `keep`. The row goes on record (`withSchedulesOf`) and a
 * start fills a missing start. The other club's own copy leaves its score beside this one's
 * (`withSideBReport`). A copy off side A's own schedules — the same game listed twice, or another
 * of its ids — fills a blank result, and one that scores the game differently goes into the note,
 * "Also reported", as the import words it; two that agree leave no note, since there is nothing to
 * say.
 */
const foldedInto = (keep: ScoutGame, drop: ScoutGame): ScoutGame => {
  const recorded = withSchedulesOf(keep, drop);
  let next = withSideBReport(recorded, drop) ?? filledFrom(recorded, drop);
  if (next.startTs === undefined && drop.startTs !== undefined) {
    next = { ...next, startTs: drop.startTs };
  }
  const sideA = withSideBReport(keep, drop) === undefined;
  if (
    sideA &&
    scoredGame(keep) &&
    scoredGame(drop) &&
    !keep.scoreFromB &&
    !drop.scoreFromB &&
    !sameResultAs(keep, drop)
  ) {
    const theirs = `${scoreOf(drop, keep.teamAId)}-${scoreOf(drop, keep.teamBId)}`;
    next = { ...next, note: withNote(next.note, `Also reported ${theirs}.`) };
  }
  return next;
};

/**
 * The rows of one bucket — one pool, one pair of clubs, one day — grouped into games, each group
 * listed in the order the rows were given.
 *
 * Every two rows `sameGameEvidence` links could be one game, and the links are taken strongest
 * first, so each game takes the copy that fits it best rather than the first one found. Where two
 * schedules list the same number of games that day, a link between their games in the same order
 * — first with first — comes before one that crosses, then the nearer start: one coach's clock runs
 * behind the other's all day, so the nearest start pairs game 1 with game 2 as soon as the lag
 * passes half the time between the slots. A game takes at most one row off each schedule: a second
 * row off the same schedule joins only as that schedule listing the game twice, which is what keeps
 * a doubleheader two games when the other club's clock sits between its two slots. And two games
 * that each hold rows off the same two schedules stay two unless those rows share a start: both
 * clubs listing both games at two slots is the doubleheader it looks like, whatever the results.
 *
 * A schedule on record without its row (`alsoFrom` from before rows were kept) is a row folded in
 * that is not here to compare, so it adds another row only where the results agree within the hour
 * — the folded row pulled again, as `mayTakeRow` has it — and only a row standing alone. A
 * different result is its second meeting that day, which is what the record was kept to show.
 *
 * What the links leave is settled by count. Two results that contradict are a doubleheader only if
 * one schedule lists more games against this club that day than the other accounts for. When all
 * that is left is one game off each of two schedules, both scored, it is one game two coaches
 * scored differently — 1,076 such pairs on a nationwide pull, 654 of them a single run apart.
 */
const sameGameGroups = (bucket: ScoutGame[]): number[][] => {
  const sourceOf = (row: number) => bucket[row]?.source?.teamId;
  /** The schedules a group accounts for: its own rows', and the ones on record on them. */
  const schedulesOf = (group: number[]) =>
    new Set(
      group.flatMap((row) => {
        const game = bucket[row];
        if (!game) return [];
        return [...(game.source ? [game.source.teamId] : []), ...(game.alsoFrom ?? [])];
      })
    );
  const groupOf = bucket.map((_, row) => row);
  const groups = new Map<number, number[]>(bucket.map((_, row) => [row, [row]]));

  const canJoin = (a: number[], b: number[], evidence: SameGameEvidence): boolean => {
    const inB = schedulesOf(b);
    const onBothSides: [number[], number[]][] = [];
    for (const schedule of schedulesOf(a)) {
      if (!inB.has(schedule)) continue;
      const hereA = a.filter((row) => sourceOf(row) === schedule);
      const hereB = b.filter((row) => sourceOf(row) === schedule);
      if (hereA.length > 0 && hereB.length > 0) {
        const listedTwice = hereA.every((x) =>
          hereB.every((y) => sameGameEvidence(bucket[x]!, bucket[y]!) !== undefined)
        );
        if (!listedTwice) return false;
        onBothSides.push([hereA, hereB]);
        continue;
      }
      // Both groups already took a row of this schedule, and neither row is here to compare.
      if (hereA.length === 0 && hereB.length === 0) return false;
      const [rows, side] = hereA.length > 0 ? [hereA, a] : [hereB, b];
      // A row coming back alone, never a group that already stands for another schedule's game.
      if (rows.length !== side.length || schedulesOf(rows).size !== 1) return false;
      if (!agreesWithinTheHour(evidence)) return false;
    }
    if (onBothSides.length >= 2) {
      return onBothSides.every(([hereA, hereB]) =>
        hereA.every((x) => hereB.every((y) => sameStart(bucket[x]!.startTs, bucket[y]!.startTs)))
      );
    }
    return true;
  };
  const join = (a: number, b: number) => {
    const into = Math.min(groupOf[a] ?? a, groupOf[b] ?? b);
    const from = Math.max(groupOf[a] ?? a, groupOf[b] ?? b);
    const moving = groups.get(from) ?? [];
    moving.forEach((row) => (groupOf[row] = into));
    groups.set(
      into,
      [...(groups.get(into) ?? []), ...moving].sort((x, y) => x - y)
    );
    groups.delete(from);
  };

  /**
   * The last word on a tie, by the rows themselves rather than where they sit in the list: a row
   * folded into a game on one pass is listed after the games standing on the next, and a tie broken
   * by position chose the other row each time, two copies trading places for ever.
   */
  const byId = (x: number, y: number): number => {
    const left = bucket[x]!.id;
    const right = bucket[y]!.id;
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const linkId = (a: number, b: number): string =>
    [bucket[a]!.id, bucket[b]!.id].sort().join("\u0000");

  /** Each row's place among its own schedule's rows that day, earliest start first. */
  const bySchedule = new Map<string, number[]>();
  bucket.forEach((row, at) => {
    const source = row.source?.teamId;
    if (source === undefined) return;
    const list = bySchedule.get(source);
    if (list) list.push(at);
    else bySchedule.set(source, [at]);
  });
  const placeOf = new Map<number, number>();
  bySchedule.forEach((rows) =>
    rows
      .slice()
      .sort(
        (x, y) =>
          (startMinuteOf(bucket[x]!.startTs) ?? Infinity) -
            (startMinuteOf(bucket[y]!.startTs) ?? Infinity) || byId(x, y)
      )
      .forEach((row, place) => placeOf.set(row, place))
  );
  /** How far two rows' places cross, where their two schedules list the same number of games. */
  const crossing = (a: number, b: number): number => {
    const left = sourceOf(a);
    const right = sourceOf(b);
    if (left === undefined || right === undefined || left === right) return 0;
    if (bySchedule.get(left)?.length !== bySchedule.get(right)?.length) return 0;
    return Math.abs((placeOf.get(a) ?? 0) - (placeOf.get(b) ?? 0));
  };

  const links: { a: number; b: number; evidence: SameGameEvidence; crossing: number }[] = [];
  bucket.forEach((row, b) => {
    for (let a = 0; a < b; a += 1) {
      const other = bucket[a];
      const evidence = other && sameGameEvidence(row, other);
      if (evidence) links.push({ a, b, evidence, crossing: crossing(a, b) });
    }
  });
  links.sort((x, y) => {
    const ordered =
      y.evidence.strength - x.evidence.strength ||
      x.crossing - y.crossing ||
      x.evidence.gap - y.evidence.gap;
    if (ordered !== 0) return ordered;
    const left = linkId(x.a, x.b);
    const right = linkId(y.a, y.b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  links.forEach(({ a, b, evidence }) => {
    const left = groupOf[a] ?? a;
    const right = groupOf[b] ?? b;
    if (left === right) return;
    if (canJoin(groups.get(left) ?? [], groups.get(right) ?? [], evidence)) join(a, b);
  });

  const schedules = new Set(bucket.map((_, row) => sourceOf(row)));
  if (schedules.size === 2 && !schedules.has(undefined)) {
    const [first, second] = [...schedules] as [string, string];
    const accounts = (group: number[], source: string) => schedulesOf(group).has(source);
    const played = (group: number[]) => group.some((row) => scoredGame(bucket[row]!));
    const all = [...groups.values()];
    const onlyFirst = all.filter((group) => accounts(group, first) && !accounts(group, second));
    const onlySecond = all.filter((group) => accounts(group, second) && !accounts(group, first));
    const [left] = onlyFirst;
    const [right] = onlySecond;
    // A count is no evidence about the rows, so it clears the same bar a weak link does.
    const byCount: SameGameEvidence = { strength: 0, gap: Infinity };
    if (
      onlyFirst.length === 1 &&
      onlySecond.length === 1 &&
      left &&
      right &&
      played(left) &&
      played(right) &&
      canJoin(left, right, byCount)
    ) {
      join(left[0]!, right[0]!);
    }
  }
  return [...groups.values()];
};

/**
 * A standing game as the tidy regroups it: the rows folded into it taken off (they are put back
 * beside it as rows of their own), the schedules still on record without a row kept, and a score
 * borrowed from side B's schedule taken off with side B's own score, since both go with that row.
 */
const bareRow = (game: ScoutGame): ScoutGame => {
  const named = new Set((game.alsoRows ?? []).map((record) => record.teamId));
  const unnamed = (game.alsoFrom ?? []).filter((source) => !named.has(source));
  const {
    alsoRows: _rows,
    alsoFrom: _from,
    reportedByB: _reported,
    scoreFromB,
    teamAScore,
    teamBScore,
    ...rest
  } = game;
  return {
    ...rest,
    ...(scoreFromB || teamAScore === undefined || teamBScore === undefined
      ? {}
      : { teamAScore, teamBScore }),
    ...(unnamed.length > 0 ? { alsoFrom: unnamed } : {}),
  };
};

/** What the tidy compares to tell a regrouped game from the one it had. */
const foldedFields = (game: ScoutGame): string =>
  JSON.stringify([
    game.teamAScore,
    game.teamBScore,
    game.scoreFromB ?? false,
    game.reportedByB ?? null,
    game.startTs ?? null,
    game.note ?? null,
    game.alsoFrom ?? [],
    game.alsoRows ?? [],
  ]);

/**
 * Folds together rows that describe one game, and takes apart a fold the schedules no longer bear
 * out.
 *
 * The same judgement the import makes of each row as it arrives (`sameGameEvidence`), made again
 * over everything the pool knows of each day: the games standing, and every row folded into them,
 * stood back up from its record (`rowOfRecord`). Grouping them all afresh (`sameGameGroups`) folds
 * what now reads as one game and takes back out what no longer does — a start moved off a
 * placeholder slot, a score posted that says a copy belongs to the other game of a doubleheader, a
 * schedule that now lists as two what it once listed at one slot. A folded row that fits no game
 * stands up as a game of its own under its own id, which its schedule's next pull then finds.
 *
 * Applying it on arrival is not enough, either. The two teams do not stay the two teams: when two
 * entries are folded into one club — a squad's Fall and Spring ids proving to be one squad, or the
 * user's own "same team as" — each id filed its own row for the game, and those rows only *become*
 * the same game once the pair matches (Yeager Davis held three GameChanger ids and showed its 8-2
 * loss twice). And the import sees one row at a time.
 *
 * The earliest standing row of each game is kept, so ids and side order stay put. `teamId` narrows
 * the pass to the rows one team is on, which is all a single fold can have changed. `collapsed`
 * counts the rows folded away and the rows stood back up.
 */
export const collapseSameGames = (
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  teamId?: string
): { games: ScoutGame[]; collapsed: number } => {
  const index = indexGroups(ageGroups);
  const buckets = new Map<string, ScoutGame[]>();
  games.forEach((game) => {
    if (teamId !== undefined && game.teamAId !== teamId && game.teamBId !== teamId) return;
    const key = `${poolKeyFor(game.ageGroupId, index)}|${pairKeyOf(game)}|${game.date ?? ""}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(game);
    else buckets.set(key, [game]);
  });

  const replaced = new Map<string, ScoutGame>();
  const dropped = new Set<string>();
  const stoodUp: ScoutGame[] = [];
  buckets.forEach((bucket) => {
    // A lone game is looked at again only if something on it came from another row.
    const folded = (game: ScoutGame) =>
      (game.alsoRows?.length ?? 0) > 0 || game.reportedByB !== undefined || game.scoreFromB;
    if (bucket.length < 2 && !bucket.some(folded)) return;
    const standing = new Map(bucket.map((game) => [game.id, game]));
    const rows = bucket.map(bareRow);
    const known = new Set(standing.keys());
    bucket.forEach((game) =>
      (game.alsoRows ?? []).forEach((record) => {
        const row = rowOfRecord(game, record);
        if (known.has(row.id)) return;
        known.add(row.id);
        rows.push(row);
      })
    );
    sameGameGroups(rows).forEach((group) => {
      const [first, ...rest] = group.map((row) => rows[row]!);
      if (!first) return;
      const kept = rest.reduce(foldedInto, first);
      rest.forEach((row) => {
        if (standing.has(row.id)) dropped.add(row.id);
      });
      const before = standing.get(first.id);
      if (!before) {
        stoodUp.push(kept);
        return;
      }
      if (foldedFields(kept) !== foldedFields(before)) replaced.set(before.id, kept);
    });
  });

  if (dropped.size === 0 && replaced.size === 0 && stoodUp.length === 0) {
    return { games, collapsed: 0 };
  }
  return {
    games: [
      ...games.flatMap((game) => (dropped.has(game.id) ? [] : [replaced.get(game.id) ?? game])),
      ...stoodUp,
    ],
    collapsed: dropped.size + stoodUp.length,
  };
};

/**
 * The teams with a counted game anywhere in this group's pool — the roster the pool is rated
 * over, which is wider than `teamsInAgeGroup`: a 10U that only ever played down against 9Us is
 * rated alongside them even though no game is filed under its own page.
 */
export const teamsInRankingPool = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): ScoutTeam[] => {
  const pool = new Set(rankingPoolGroupIds(ageGroupId, ageGroups));
  const active = new Set<string>();
  games.forEach((game) => {
    if (!pool.has(game.ageGroupId) || !countsTowardRating(game)) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  return teams.filter((team) => active.has(team.id));
};

/**
 * One team's record over every counted game in the pool, cross-age games included — the number the
 * detail panel shows, and the one the ranking row shows, so the two agree.
 *
 * Agreeing is the whole job, and it takes the same window the fit takes. `scoutRatingGames` keeps
 * out a game dated outside the squad year — last year's squad's results, still filed under this
 * year's id — and, with a half named, the other half's as well. This counted both, so the panel
 * read one record beside a row reading another: on a four-game fixture the board said 2-0 for the
 * autumn while the panel under it said 3-1, and even with no half selected the stray year made it
 * 2-1 against 3-1.
 *
 * `outsideWindow` is what the window left out, so the panel can say where the missing games went
 * rather than quietly showing a smaller number than the list beneath it.
 */
export const teamRecordInPool = (
  teamId: string,
  ageGroupId: string,
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  /** One half of the year, or the whole of it when left out — as `buildTeamRankings` takes it. */
  segment?: SeasonSegment
): {
  wins: number;
  losses: number;
  ties: number;
  games: number;
  crossAgeGames: number;
  outsideWindow: number;
} => {
  const index = indexGroups(ageGroups);
  const pool = new Set(rankingPoolGroupIds(ageGroupId, ageGroups));
  const mine = games.filter(
    (game) =>
      pool.has(game.ageGroupId) &&
      countsTowardRating(game) &&
      (game.teamAId === teamId || game.teamBId === teamId)
  );
  const counted = mine.filter((game) => inSegment(game.date, index.year(game.ageGroupId), segment));
  const { wins, losses, ties } = recordsFor(counted).get(teamId) ?? NO_RECORD;
  const crossAgeGames = counted.filter(
    (game) => ageGapOf(sideLevelsWith(game, index)) !== 0
  ).length;
  return {
    wins,
    losses,
    ties,
    games: counted.length,
    crossAgeGames,
    outsideWindow: mine.length - counted.length,
  };
};

/** Whether a game is inside the window `teamRecordInPool` counts, for a list that shows both. */
export const countedInWindow = (
  game: ScoutGame,
  ageGroups: AgeGroup[],
  segment?: SeasonSegment
): boolean =>
  countsTowardRating(game) &&
  inSegment(game.date, indexGroups(ageGroups).year(game.ageGroupId), segment);

/**
 * How far below a board's own level a club may still belong on it.
 *
 * A 10U board holds 10U clubs and the 9U clubs that play up into it, and nothing else. Younger
 * than that is a different game, and older is a club that has simply been listed on the wrong
 * page. One, not two: `PLAYS_UP_TO` in the importer is about where a *game* may land, which is a
 * looser question than which clubs a person should be offered when they say who a team is.
 */
export const PLAYS_UP_ONE = 1;

/**
 * The age levels GameChanger itself has a club at, for one squad year.
 *
 * Read off the links rather than off the games: a link is what somebody pulled, so its level is
 * the club's own, while a game's level is only where that game was filed and a club that entered
 * one tournament up is not that level. Three places a pull can leave it, in order of how directly
 * it was stated — the link's own `ageLevel`, the level of the group it is filed under, and the
 * level written into its name ("Cincy Stix Navy 10u").
 *
 * A year of `undefined` takes every link, which is what a season on a legacy page with no year
 * needs; otherwise only the links sitting in that squad year are read, so a club pulled for three
 * seasons is 10U on a 10U board rather than 9U, 10U and 11U at once.
 */
export const gcAgeLevels = (
  team: ScoutTeam,
  year: number | undefined,
  ageGroups: AgeGroup[]
): number[] => {
  const index = indexGroups(ageGroups);
  const levels = new Set<number>();
  (team.gcTeams ?? []).forEach((link) => {
    if (year !== undefined && gcLinkYear(link, index) !== year) return;
    const level = link.ageLevel ?? index.level(link.ageGroupId) ?? ageLevelFromName(link.name);
    if (level !== undefined) levels.add(level);
  });
  return [...levels].sort((a, b) => a - b);
};

/**
 * Whether a club could be the team on a board at `level` — its own level, or one below it.
 *
 * A club whose level cannot be read at all passes. That is deliberate: a freshly pulled club whose
 * links carry no age and whose name does not spell one out is a club nobody has told us about, not
 * a club at the wrong level, and dropping it out of the picker would hide the very entry somebody
 * had come to choose.
 */
export const clubFitsLevel = (levels: readonly number[], level: number | undefined): boolean =>
  level === undefined ||
  levels.length === 0 ||
  levels.some((at) => at <= level && at >= level - PLAYS_UP_ONE);

/** The board levels a League Standings season sits on: every age group that claims it. */
export const levelsForSeason = (seasonId: string, ageGroups: AgeGroup[]): number[] => {
  const levels = new Set<number>();
  ageGroups.forEach((group) => {
    if (!group.seasonIds.includes(seasonId)) return;
    const level = ageGroupLevel(group);
    if (level !== undefined) levels.add(level);
  });
  return [...levels].sort((a, b) => a - b);
};

/** The squad years a League Standings season sits in, for reading a club's level in that year. */
export const yearsForSeason = (
  seasonId: string,
  ageGroups: AgeGroup[]
): Array<number | undefined> => {
  const years = new Set<number | undefined>();
  ageGroups.forEach((group) => {
    if (group.seasonIds.includes(seasonId)) years.add(ageGroupYear(group));
  });
  return [...years];
};

/**
 * Whether a club is worth offering when somebody says which club a league team is.
 *
 * Two conditions, and they are the two a person would apply by hand. It has to be a club
 * GameChanger knows — a slot names nobody and a name-only stand-in has no schedule of its own to
 * bridge, so linking to either gives the league nothing it did not already have. And it has to be
 * at the board's level or one below, because an 18U club is not the 10U team you are naming
 * however well the name matches.
 */
export const clubIsPickable = (
  team: ScoutTeam,
  levels: readonly number[],
  years: ReadonlyArray<number | undefined>,
  ageGroups: AgeGroup[]
): boolean => {
  if (team.placeholder || team.nameOnly || !hasGcLinks(team)) return false;
  if (levels.length === 0) return true;
  const seen = years.length > 0 ? years : [undefined];
  return seen.some((year) => {
    const at = gcAgeLevels(team, year, ageGroups);
    return levels.some((level) => clubFitsLevel(at, level));
  });
};

/**
 * Whether a club has a GameChanger team behind it — a schedule that was pulled, or can be.
 *
 * Exported because linking a League Standings team to a club is only worth doing when there is
 * one: a name-only stand-in is a club known solely because somebody else's schedule named it, and
 * linking to it brings in nothing but the one-sided games that already reach the league through
 * the opponents who reported them.
 */
export const hasGcLinks = (team: ScoutTeam): boolean => Boolean(team.gcTeams?.length);

/**
 * The connected pieces of a schedule: which clubs can be compared to which at all.
 *
 * A rating is a claim about a margin against the pool's average, and the ridge pins every
 * *connected* piece of the schedule to average zero independently. That is correct arithmetic and
 * it has a consequence nobody reads off the table: two clubs joined by no chain of opponents are
 * measured against two different zeros, so the difference between their ratings is not a
 * prediction about anything. It is two unrelated numbers subtracted.
 *
 * On the real pool this is not an edge case. 9U 2027's autumn holds 15,629 clubs in 2,107 pieces,
 * the largest with 28.4% of them, and 39 of the national top 100 sit outside it — one of them off
 * an island of twelve clubs. And it is a different problem from a thin record: `The Chill Dogs
 * 17-5` was seventh in the nation on 22 games off an island of 21, which no amount of evidence
 * discounting touches, because the games are real and the rating is well determined. It is well
 * determined *relative to twenty other clubs*.
 *
 * Returned as a lookup rather than a list of sets, because every caller wants "which piece is this
 * club in, and how big is it".
 */
export const scheduleComponents = (
  ids: string[],
  pairs: Array<[string, string]>
): { pieceOf: (id: string) => string; sizeOf: (id: string) => number; largest: string | null } => {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Flattened on the way back, so a long chain is walked once rather than once per lookup.
    let walk = id;
    while (parent.get(walk) !== walk) {
      const next = parent.get(walk)!;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  pairs.forEach(([a, b]) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  });

  const sizes = new Map<string, number>();
  ids.forEach((id) => {
    const root = find(id);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  });
  let largest: string | null = null;
  let biggest = 0;
  sizes.forEach((size, root) => {
    // Ties broken by id so the answer does not depend on Map iteration order.
    if (size > biggest || (size === biggest && largest !== null && root < largest)) {
      biggest = size;
      largest = root;
    }
  });
  return {
    pieceOf: find,
    sizeOf: (id) => (parent.has(id) ? (sizes.get(find(id)) ?? 0) : 0),
    largest,
  };
};

/** Sort by rating, number the ranks, and number strength of schedule among teams that played. */
const rankRows = (rows: ScoutRankingRow[]): ScoutRankingRow[] => {
  rows.sort(
    (a, b) =>
      b.rating - a.rating || b.rawMargin - a.rawMargin || a.teamName.localeCompare(b.teamName)
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  const sosOrder = rows
    .filter((row) => row.games > 0)
    .slice()
    .sort(
      (a, b) => b.strengthOfSchedule - a.strengthOfSchedule || a.teamName.localeCompare(b.teamName)
    );
  const sosRankById = new Map(sosOrder.map((row, index) => [row.teamId, index + 1]));
  rows.forEach((row) => {
    row.sosRank = sosRankById.get(row.teamId) ?? 0;
  });

  return rows;
};

/**
 * Ranks the given teams using only *completed* games. Scheduled/unplayed games are ignored here
 * entirely; they exist only so a future opponent can be logged ahead of time. Every team is rated
 * by this exact same formula — which team is "ours" plays no part in the computation; `myTeamId`
 * (falling back to the legacy `ScoutTeam.isMine`) only sets a display flag.
 *
 * Without `ageGroups`, this is the one-group ranking it has always been: games tagged with
 * `ageGroupId` (defensive filter — callers should already be passing an age-group-scoped game
 * list), one row per team passed. With `ageGroups`, the group's whole season-year pool is rated
 * together — see `rankingPoolGroupIds` — with each game's age gap passed to the model, and the
 * rows are the teams at home on this page: those whose home level is this group's level, plus
 * those of unknown level with a counted game filed here. A team that only played *up* onto this
 * page is rated (it is a node in the same regression) but listed on its own page. Records count
 * every counted game in the pool, so a 9U's win over a 10U is a win. A group below
 * `MIN_RANKED_AGE_LEVEL` has no table at all.
 *
 * With a `segment`, the fit is over that half of the year alone and the records, cross-age counts
 * and strength of schedule are that half's too. Fitted, not filtered: a Fall table built from a
 * whole-year fit would have read the spring before saying who was best in the autumn. Which page a
 * club is listed on does not change between halves — its age level is a fact about the club for the
 * season — so the same club is on the same board in both.
 */
/**
 * The recency weights for these games, in the order given, or `null` to fit them unchanged.
 *
 * An old result is evidence about a squad that no longer quite exists — eleven months of growth
 * and several players later — so it is counted less rather than counted the same. `null` comes
 * back when the active scheme has no opinion or the pool holds no date it can read, and the fit is
 * then handed exactly what it was handed before weighting existed.
 *
 * It changes the fit and nothing else: games played, record and strength of schedule are
 * descriptions of a season rather than beliefs about a team, and a side played twelve games
 * whatever the fit leans on.
 */
const recencyWeightsFor = (games: readonly ScoutGame[]): number[] | null =>
  weightsForGames(
    games.map((game) => ({ date: game.date, home: game.teamAId, away: game.teamBId }))
  );

export const buildTeamRankings = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  myTeamId?: string,
  ageGroups?: AgeGroup[],
  /**
   * One half of the baseball year — "fall" or "spring" — or the whole of it when left out.
   *
   * Only the pooled path honours it, because a half needs a year to be a half of and the one-group
   * path has none. The app always passes `ageGroups`, so this is a limit on the legacy call rather
   * than on a board anybody sees.
   */
  segment?: SeasonSegment
): ScoutRankingRow[] => {
  if (ageGroups) {
    return buildPooledTeamRankings(ageGroupId, teams, games, myTeamId, ageGroups, segment);
  }

  const playedGames = games.filter(
    (game) => game.ageGroupId === ageGroupId && countsTowardRating(game)
  );
  const weights = recencyWeightsFor(playedGames);
  const adjusted = buildOpponentAdjustedRatings(
    teams.map((team) => team.id),
    playedGames.map((game, at) => ({
      home: game.teamAId,
      away: game.teamBId,
      homeMargin: ratedMargin(game)!,
      // Team A is simply the side entered first, not the home team.
      neutral: true,
      ...(weights ? { weight: weights[at] ?? 1 } : {}),
    })),
    { cap: RATING_CAP }
  );

  const records = recordsFor(playedGames);
  const pieces = scheduleComponents(
    teams.map((team) => team.id),
    playedGames.map((game) => [game.teamAId, game.teamBId] as [string, string])
  );
  const isClub = (team: ScoutTeam) => !team.placeholder && !team.nameOnly;
  const confident = evidenceDiscount(
    adjusted,
    teams.filter(isClub).map((team) => team.id)
  );
  const rows = teams
    /*
     * Everyone is in the fit above, because every one of them was somebody's opponent. Only clubs
     * go in the table: not a slot, which names nobody, and not a club known only from somebody
     * else's schedule, whose record here is a fraction of a season it would be ranked on.
     */
    .filter(isClub)
    .map((team): ScoutRankingRow => {
      const { wins, losses, ties } = records.get(team.id) ?? NO_RECORD;
      const gamesPlayed = adjusted.games.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        isMine: myTeamId ? team.id === myTeamId : Boolean(team.isMine),
        rank: 0,
        rating: confident(adjusted.ratings.get(team.id) ?? 0, gamesPlayed),
        pointRating: adjusted.ratings.get(team.id) ?? 0,
        record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
        wins,
        losses,
        ties,
        games: gamesPlayed,
        rawMargin: adjusted.rawMargin.get(team.id) ?? 0,
        strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
        sosRank: 0,
        crossAgeGames: 0,
        componentSize: pieces.sizeOf(team.id),
        componentId: pieces.pieceOf(team.id),
        comparable: pieces.largest !== null && pieces.pieceOf(team.id) === pieces.largest,
        fromGameChanger: hasGcLinks(team),
      };
    });

  return rankRows(rows);
};

/**
 * The games one page's rating is fitted over, each with the age gap between the two sides.
 *
 * Pulled out of the fit so that anything measuring the model — a hold-out backtest, a comparison
 * of one age-gap prior against another — reads exactly the games the rankings read. A measurement
 * over a different set of games than the thing it is measuring is not a measurement of it.
 */
/**
 * A day nothing is ahead of, for a caller that is reading history rather than a live table.
 *
 * `scoutRatingGames` leaves out a game dated after today, because you cannot score a game early.
 * A backtest has no "today" — it is handed a set of games and cuts them in time itself — so it
 * says so with this rather than inheriting the afternoon it happens to run on.
 */
export const EVERY_DAY = "9999-12-31";

export const scoutRatingGames = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  /**
   * One half of the year, or the whole of it when left out.
   *
   * A half is fitted on its own games alone — not on the year's, filtered afterwards — because a
   * rating fitted over both halves has read the spring before saying who was best in the autumn.
   */
  segment?: SeasonSegment,
  /**
   * The day to judge "has this been played yet" against, as an ISO day.
   *
   * The live tables want the real one: a row carrying a score on a day still to come is somebody's
   * mistake and must not rate anybody. A backtest wants `EVERY_DAY` instead, because it is a
   * historical exercise over a fixed set of games that it splits in time itself — filtered by the
   * wall clock it would score differently depending on the afternoon it was run on.
   */
  today: string = todayIsoDay()
): Array<{ game: ScoutGame; ageGap: number }> => {
  const index = indexGroups(ageGroups);
  const pool = new Set(rankingPoolGroupIds(ageGroupId, ageGroups));
  // A game whose team is missing from the roster cannot be rated — there is nothing to rate.
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return games
    .filter(
      (game) =>
        pool.has(game.ageGroupId) &&
        countsTowardRating(game, today) &&
        /*
         * Last year's squad's games, listed under this year's id, are not this squad's results —
         * and with a half named, this is also what keeps the other half out. A game with no date
         * is in the year but in neither half, so it informs the year's table and neither board.
         */
        inSegment(game.date, index.year(game.ageGroupId), segment) &&
        teamById.has(game.teamAId) &&
        teamById.has(game.teamBId)
    )
    .map((game) => ({ game, ageGap: ageGapOf(sideLevelsWith(game, index)) }));
};

/** One page's games as the fit reads them: the row, and the age gap between the two sides. */
export type RatedScoutGame = { game: ScoutGame; ageGap: number };

/**
 * The table, from a set of games already chosen.
 *
 * Split from the selection above it so that a caller can rank a pool the selection would never
 * hand it. A what-if is exactly that caller: the game it asks about is dated in a day that has not
 * happened and carries a score, which is the one shape `countsTowardRating` exists to reject, so
 * splicing it into the pool and re-selecting drops it and answers the question that was not asked.
 * Measured: appending a future-dated 20-0 win to a four-club pool moved the winner not at all —
 * same rank, same record, same rating to three decimals — while the same game dated yesterday
 * moved it from #4 to #3 and from -2.656 to -0.443.
 *
 * `games` is still the whole pool rather than the rated slice, because a club's home age level is
 * a fact about its season and is read off every game it played, not off the ones this page counts.
 */
export const rankScoutPool = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  rated: readonly RatedScoutGame[],
  myTeamId: string | undefined,
  ageGroups: AgeGroup[]
): ScoutRankingRow[] => {
  const index = indexGroups(ageGroups);
  const level = index.level(ageGroupId);
  if (!isRankedAgeLevel(level)) return [];
  const year = index.year(ageGroupId);

  const ratedGames = rated.map(({ game }) => game);

  const active = new Set<string>();
  const filedHere = new Set<string>();
  ratedGames.forEach((game) => {
    active.add(game.teamAId);
    active.add(game.teamBId);
    if (game.ageGroupId === ageGroupId) {
      filedHere.add(game.teamAId);
      filedHere.add(game.teamBId);
    }
  });
  const nodes = teams.filter((team) => active.has(team.id));

  const weights = recencyWeightsFor(rated.map(({ game }) => game));
  const adjusted = buildOpponentAdjustedRatings(
    nodes.map((team) => team.id),
    rated.map(({ game, ageGap }, at) => ({
      home: game.teamAId,
      away: game.teamBId,
      homeMargin: ratedMargin(game)!,
      // Team A is simply the side entered first, not the home team.
      neutral: true,
      ...(ageGap ? { ageGap } : {}),
      ...(weights ? { weight: weights[at] ?? 1 } : {}),
    })),
    { cap: RATING_CAP }
  );

  /*
   * Over the whole year, not the half. A club's age level is a fact about the club for the season,
   * so it is on the same page in both halves — a club that appears on the 9U board in the autumn
   * must not move to the 10U board in the spring because of which games fell where.
   */
  const homeLevels = homeLevelsForYear(year, nodes, games, ageGroups);
  // A page with no readable level (a legacy group) lists whoever played there, as it always has.
  const belongsHere = (teamId: string): boolean => {
    if (level === undefined) return filedHere.has(teamId);
    const home = homeLevels.get(teamId);
    return home === level || (home === undefined && filedHere.has(teamId));
  };

  const records = recordsFor(ratedGames);
  // Likewise counted once: how many of each team's games crossed a level.
  const crossAgeCounts = new Map<string, number>();
  rated.forEach(({ game, ageGap }) => {
    if (ageGap === 0) return;
    crossAgeCounts.set(game.teamAId, (crossAgeCounts.get(game.teamAId) ?? 0) + 1);
    crossAgeCounts.set(game.teamBId, (crossAgeCounts.get(game.teamBId) ?? 0) + 1);
  });
  /*
   * Centred on the year's clubs, which is the same set whichever page is being built — so a club's
   * shown rating is the same number wherever it is listed, and an 8U that played up is still on
   * the same scale as the 9Us it played.
   */
  const confident = evidenceDiscount(
    adjusted,
    nodes.filter((team) => !team.placeholder && !team.nameOnly).map((team) => team.id)
  );
  /*
   * Over the same games the fit read, so "the piece this club is in" means the piece the ridge
   * pinned to zero on its own. Nodes rather than rows: a club reaches the rest of the table through
   * whatever it played, including sides listed on other pages and stand-ins, all of which are in
   * the fit.
   */
  const pieces = scheduleComponents(
    nodes.map((team) => team.id),
    ratedGames.map((game) => [game.teamAId, game.teamBId] as [string, string])
  );
  const rows = nodes
    /*
     * Both kinds of non-club are in the fit as opponents and out of the table: a slot, which names
     * nobody, and a club known only from somebody else's schedule, whose record here is a fraction
     * of its season and would rank against clubs whose whole season is present.
     */
    .filter((team) => !team.placeholder && !team.nameOnly && belongsHere(team.id))
    .map((team): ScoutRankingRow => {
      const { wins, losses, ties } = records.get(team.id) ?? NO_RECORD;
      const crossAgeGames = crossAgeCounts.get(team.id) ?? 0;
      const ageLevel = homeLevels.get(team.id);
      const gamesPlayed = adjusted.games.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        isMine: myTeamId ? team.id === myTeamId : Boolean(team.isMine),
        rank: 0,
        rating: confident(adjusted.ratings.get(team.id) ?? 0, gamesPlayed),
        pointRating: adjusted.ratings.get(team.id) ?? 0,
        record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
        wins,
        losses,
        ties,
        games: gamesPlayed,
        rawMargin: adjusted.rawMargin.get(team.id) ?? 0,
        strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
        sosRank: 0,
        ...(ageLevel === undefined ? {} : { ageLevel }),
        crossAgeGames,
        componentSize: pieces.sizeOf(team.id),
        componentId: pieces.pieceOf(team.id),
        comparable: pieces.largest !== null && pieces.pieceOf(team.id) === pieces.largest,
        fromGameChanger: hasGcLinks(team),
      };
    });

  return rankRows(rows);
};

const buildPooledTeamRankings = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  myTeamId: string | undefined,
  ageGroups: AgeGroup[],
  segment?: SeasonSegment
): ScoutRankingRow[] =>
  rankScoutPool(
    ageGroupId,
    teams,
    games,
    scoutRatingGames(ageGroupId, teams, games, ageGroups, segment),
    myTeamId,
    ageGroups
  );

/** Same margin-clamp/logistic formula `predictionEngine.ts` uses for League Standings' own
 * matchup predictions — kept identical so the two features read consistently. Deliberately ignores
 * home-field advantage: Team Rankings games are treated as neutral-site. */
/**
 * Whether two rows have never been compared, by any chain of opponents.
 *
 * Off the piece each is in, which is the whole point: the question is not "have these two played"
 * but "is there any path of results between them at all". A club three opponents removed is
 * compared; a club in another piece of the schedule is not, however many games either has played.
 *
 * On the piece's identity rather than its size, because two different islands of the same size are
 * still two different zeros — comparing sizes would call them compared, which is the exact error
 * this function exists to name.
 */
const notCompared = (a: ScoutRankingRow, b: ScoutRankingRow): boolean =>
  a.componentId !== b.componentId;

/** Widest projected margin a matchup preview will state, in runs. */
export const MATCHUP_MARGIN_CAP = 14;
/**
 * Win probability never leaves this range. Youth baseball has no locks, and a model that says 99%
 * is claiming a certainty the sport does not have.
 */
export const MATCHUP_PROBABILITY_FLOOR = 0.08;

export const predictMatchup = (ratingA: number, ratingB: number) => {
  const margin = clamp(ratingA - ratingB, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP);
  const winProbA = clamp(
    1 / (1 + Math.exp(-margin / 2.8)),
    MATCHUP_PROBABILITY_FLOOR,
    1 - MATCHUP_PROBABILITY_FLOOR
  );
  return { projectedMargin: margin, winProbA, winProbB: 1 - winProbA };
};

const tierFor = (winProb: number): MatchupTier =>
  winProb > 0.6 ? "Favored" : winProb < 0.4 ? "Underdog" : "Toss-up";

/** For the given team, project the result against every other team in the same ranked pool,
 * ordered by opponent rank. */
/** How many of the national table the scouting report shows without being asked. */
export const SCOUT_REPORT_NATIONAL_TOP = 25;
/** And how many of the scouted team's own state. */
export const SCOUT_REPORT_STATE_TOP = 10;

export type ScoutingReport = {
  /** The best in the pool, by rank. */
  national: MatchupPreview[];
  /** The best in the scouted team's own state, by rank within it. */
  state: MatchupPreview[];
  /** Which state those are, so the heading can say. Absent when the team has no state on it. */
  stateName?: string;
  /** Opponents asked for by name, whatever they rank. */
  picked: MatchupPreview[];
  /** Ranked teams besides this one — what the two lists are a slice of. */
  opponentCount: number;
};

/** A report for nobody: no team picked, or one that is not in this page's table. */
export const EMPTY_SCOUTING_REPORT: ScoutingReport = Object.freeze({
  national: [],
  state: [],
  picked: [],
  opponentCount: 0,
});

/**
 * One team against the opposition worth naming: the top of the national table, the top of its own
 * state, and anyone else asked for.
 *
 * It used to be every ranked team, which on a league of ten was a useful page and on a nationwide
 * pool is thousands of rows in rank order — a list nobody reads and nobody can find anything in.
 * The two that answer a real question are "how do we sit against the best" and "how do we sit
 * against the ones we might actually draw", and for the rest a name is faster than a scroll.
 *
 * A team in the national top 25 and in its own state's top 10 appears in both, because both lists
 * are answering their own question and a gap where a team should be is worse than a repeat.
 */
export const buildScoutingReport = (
  forTeamId: string,
  rows: ScoutRankingRow[],
  teams: ScoutTeam[] = [],
  options: { pickedIds?: string[]; nationalTop?: number; stateTop?: number } = {}
): ScoutingReport => {
  const forRow = rows.find((row) => row.teamId === forTeamId);
  if (!forRow) return EMPTY_SCOUTING_REPORT;

  const nationalTop = options.nationalTop ?? SCOUT_REPORT_NATIONAL_TOP;
  const stateTop = options.stateTop ?? SCOUT_REPORT_STATE_TOP;
  const opponents = rows.filter((row) => row.teamId !== forTeamId);

  const preview = (opponent: ScoutRankingRow): MatchupPreview => {
    const { projectedMargin, winProbA } = predictMatchup(forRow.rating, opponent.rating);
    return {
      opponentId: opponent.teamId,
      opponentName: opponent.teamName,
      opponentRank: opponent.rank,
      projectedMargin,
      winProb: winProbA,
      tier: tierFor(winProbA),
      unconnected: notCompared(forRow, opponent),
    };
  };
  const byRank = (a: MatchupPreview, b: MatchupPreview) => a.opponentRank - b.opponentRank;

  const state = teams.find((team) => team.id === forTeamId)?.state;
  const stateRows = state
    ? filterRankingsByState(rows, teams, state)
        .filter((row) => row.teamId !== forTeamId)
        .slice(0, stateTop)
    : [];

  // Ranked by the state table, shown with their place in it: a state list numbered by national
  // rank would read #4, #87, #212 and mean nothing. The scouted team's own place is left as a gap
  // rather than closed up, because #1 and #3 is what its opponents are and renumbering them would
  // say otherwise.
  const picked = new Set(options.pickedIds ?? []);
  return {
    national: opponents
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .slice(0, nationalTop)
      .map(preview)
      .sort(byRank),
    state: stateRows.map(preview).sort(byRank),
    ...(state ? { stateName: state } : {}),
    picked: opponents
      .filter((row) => picked.has(row.teamId))
      .map(preview)
      .sort(byRank),
    opponentCount: opponents.length,
  };
};

/** A game on a team's schedule that has not been played yet, with the projection for it. */
export type UpcomingMatchup = {
  gameId: string;
  /** As the source gave it, "2026-09-20". Empty when the schedule carries no date. */
  date: string;
  event?: string;
  opponentId: string;
  opponentName: string;
  /**
   * Absent when the opponent has no rating on this page — a stand-in nobody has pulled, a club
   * whose own games are all on another page, or one that has not played yet. The game is still
   * listed, because a schedule is a fact and "we cannot rate them yet" is the honest answer.
   */
  opponentRank?: number;
  projectedMargin?: number;
  winProb?: number;
  tier?: MatchupTier;
  /** True when no chain of opponents joins the two, so the projection is not one. */
  unconnected?: boolean;
};

/**
 * The games still to be played on one team's schedule, each with the projection for it.
 *
 * This is the question a coach actually asks — not "how would we do against the country", but
 * "what happens on Saturday". A pulled GameChanger schedule carries its future fixtures with no
 * score, which is exactly what an unplayed game looks like here, so the answer is already in the
 * pool. Games with no date sort last: a schedule that forgot to say when is still a schedule.
 */
export const buildUpcomingSchedule = (
  forTeamId: string,
  rows: ScoutRankingRow[],
  games: ScoutGame[],
  teams: ScoutTeam[],
  /** Today, as "2026-09-16". Anything before it has been played, whatever the score says. */
  today: string
): UpcomingMatchup[] => {
  const forRow = rows.find((row) => row.teamId === forTeamId);
  if (!forRow) return [];
  const rowByTeamId = new Map(rows.map((row) => [row.teamId, row]));
  const nameById = new Map(teams.map((team) => [team.id, team.name]));

  return games
    .filter((game) => {
      if (game.teamAId !== forTeamId && game.teamBId !== forTeamId) return false;
      if (isScoutGamePlayed(game)) return false;
      // A dateless row could be any day, so it is kept; a dated one has to be today or later.
      return !game.date || game.date >= today;
    })
    .map((game): UpcomingMatchup => {
      const opponentId = game.teamAId === forTeamId ? game.teamBId : game.teamAId;
      const opponent = rowByTeamId.get(opponentId);
      const base = {
        gameId: game.id,
        date: game.date ?? "",
        ...(game.event ? { event: game.event } : {}),
        opponentId,
        opponentName: nameById.get(opponentId) ?? "Unknown team",
      };
      if (!opponent) return base;
      const across = notCompared(forRow, opponent);
      const { projectedMargin, winProbA } = predictMatchup(forRow.rating, opponent.rating);
      return {
        ...base,
        opponentRank: opponent.rank,
        projectedMargin,
        winProb: winProbA,
        tier: tierFor(winProbA),
        ...(across ? { unconnected: true } : {}),
      };
    })
    .sort(
      (a, b) =>
        (a.date ? 0 : 1) - (b.date ? 0 : 1) ||
        a.date.localeCompare(b.date) ||
        a.opponentName.localeCompare(b.opponentName)
    );
};

/** A league team has said it is not in Team Rankings at all. Never a real pool id: those start "S-". */
export const NO_SCOUT_TEAM = "__none__";

/** A league team as this side of the app needs it: its id, its name, and its answer if it has one. */
export type LeagueTeamLink = { id: string; name: string; scoutTeamId?: string };

/** One outside result, in the shape `buildPredictionEngine` takes (`ExternalResult`). */
export type ScoutBridgeResult = {
  home: string;
  away: string;
  homeMargin: number;
  /**
   * When it was played, in the league's own date format. Carried so the parts of the forecast that
   * care *when* — recent form, which walks a season in order — can place a tournament
   * game among the league's own. Optional exactly as the game's own date is: an undated result
   * still rates, because the rating does not care about order, and is left out of the two that do
   * rather than guessed into a position.
   */
  date?: string;
  /** The pair order is the order it was typed, so this must not reach the home-field estimate. */
  neutral: true;
};

/** How a league team came to be pointed at a pool club, if it is. */
export type ScoutLinkHow =
  /** A person chose it. */
  | "picked"
  /** The name matched, and nobody has said otherwise. Shown as a guess, never as settled. */
  | "guessed"
  /** A person said this team is not in Team Rankings. */
  | "off"
  /** Nothing is behind it, for one of the reasons the fields below name. */
  | "none";

export type ScoutLinkRow = {
  leagueTeamId: string;
  leagueTeamName: string;
  how: ScoutLinkHow;
  /** The pool club behind it, for "picked" and "guessed". */
  scoutTeamId?: string;
  /** That club's name, so a guess can be shown rather than merely reported. */
  suggestedName?: string;
  /** The stored pick, when the pool no longer holds a club with that id. */
  staleScoutTeamId?: string;
  /** The other league teams that picked the same club. Set on every row of the clash. */
  conflictWith?: string[];
  /** How many pool clubs on this season's pages carry this name, when it is more than one. */
  ambiguousCount?: number;
  /**
   * League opponents this club has also played. Set when that is what picked it out of several of
   * one name, so a guess can say what convinced it rather than merely asserting.
   */
  sharedOpponents?: number;
};

export type LeagueScoutBridge = {
  results: ScoutBridgeResult[];
  /** Whether any age group claims this season. Nothing can come across when none does. */
  seasonLinked: boolean;
  /** One row per league team, in roster order. */
  rows: ScoutLinkRow[];
  /** Rows with a pool club behind them, chosen or guessed. */
  linkedCount: number;
  /** `results.length`, named so the UI does not have to explain what it is counting. */
  countedResults: number;
};

/**
 * Which Team Rankings club each league team is, and the outside results that follow from it.
 *
 * The results half is what the league's ratings read: games logged in Team Rankings for an age
 * group that includes this season, minus the ones that came *from* the league schedule in the first
 * place. Counting those twice would quietly double the weight of every league game. "Came from the
 * league" covers two shapes: a row `deriveLeagueScoutGames` built carries the `league_` prefix, and
 * a row a GameChanger pull stored for a league fixture does not — it looks exactly like a tournament
 * result — so it is matched against `seasonFixtures` the way `dedupeLeagueFixtures` matches one:
 * same two clubs by name, same calendar day.
 *
 * The linking half used to be a name match and nothing else, and it failed silently: the league
 * roster says "Trash Pandas" where GameChanger says "Trash Pandas Baseball Club", so that club's
 * results were filed under an opponent of its own and sharpened nothing, with no message anywhere.
 * A person's answer (`TeamBase.scoutTeamId`) now decides it; the name match survives as the
 * suggestion, and every row says which of the two it was — which is the point of returning `rows`
 * rather than only the results.
 *
 * An opponent with no league counterpart still keeps an id of its own, so the rating model can
 * estimate how good it was instead of assuming — that is the whole value of the bridge: a shared
 * tournament opponent is what lets two league teams that never met be compared.
 */
export const leagueScoutBridge = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  leagueTeams: LeagueTeamLink[],
  /**
   * This season's own schedule — league team *names* and the league's own date string — so a
   * stored game that is really one of these fixtures can be recognised. Required rather than
   * optional so a new caller has to answer the question instead of silently reopening the leak.
   */
  seasonFixtures: { away: string; home: string; date: string }[]
): LeagueScoutBridge => {
  const linked = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  const seasonLinked = linked.size > 0;
  const scoutById = new Map(teams.map((team) => [team.id, team]));

  // Only clubs with a game on one of this season's pages can ever reach it, so only those are
  // candidates for a name match — which also means two clubs of one name elsewhere in a nationwide
  // pool are not an ambiguity here.
  const inSeason = new Set<string>();
  games.forEach((game) => {
    if (!linked.has(game.ageGroupId)) return;
    inSeason.add(game.teamAId);
    inSeason.add(game.teamBId);
  });
  const scoutIdsByName = new Map<string, string[]>();
  inSeason.forEach((scoutTeamId) => {
    const team = scoutById.get(scoutTeamId);
    // A slot names nobody; matching a league team onto one would attach it to another game's
    // unknown opponent.
    if (!team || team.placeholder) return;
    const key = teamNameKey(team.name);
    const bucket = scoutIdsByName.get(key);
    if (bucket) bucket.push(scoutTeamId);
    else scoutIdsByName.set(key, [scoutTeamId]);
  });

  /**
   * Who each pool club on this season's pages has played, and who each league team plays, both by
   * name key. Two clubs of one name are told apart by who they have played: a schedule is much
   * harder to coincide with than a name, and it is the same reasoning the importer uses to decide
   * which club an opponent's name belongs to.
   */
  const playedByScoutId = new Map<string, Set<string>>();
  games.forEach((game) => {
    if (!linked.has(game.ageGroupId)) return;
    const note = (id: string, otherId: string) => {
      const other = scoutById.get(otherId);
      if (!other || other.placeholder) return;
      const bucket = playedByScoutId.get(id) ?? new Set<string>();
      bucket.add(teamNameKey(other.name));
      playedByScoutId.set(id, bucket);
    };
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });
  const leagueOpponentsByTeam = new Map<string, Set<string>>();
  leagueTeams.forEach((team) => {
    const key = teamNameKey(team.name);
    const opponents = new Set<string>();
    seasonFixtures.forEach((fixture) => {
      if (teamNameKey(fixture.away) === key) opponents.add(teamNameKey(fixture.home));
      else if (teamNameKey(fixture.home) === key) opponents.add(teamNameKey(fixture.away));
    });
    leagueOpponentsByTeam.set(team.id, opponents);
  });
  const sharedOpponents = (leagueTeamId: string, scoutTeamId: string): number => {
    const mine = leagueOpponentsByTeam.get(leagueTeamId);
    const theirs = playedByScoutId.get(scoutTeamId);
    if (!mine || !theirs) return 0;
    let shared = 0;
    theirs.forEach((key) => {
      if (mine.has(key)) shared += 1;
    });
    return shared;
  };

  // Who has picked what, so a club two league teams both claim can be refused rather than given to
  // whichever happens to be first in the roster.
  const claimedBy = new Map<string, string[]>();
  leagueTeams.forEach((team) => {
    const pick = team.scoutTeamId;
    if (!pick || pick === NO_SCOUT_TEAM || !scoutById.has(pick)) return;
    const holders = claimedBy.get(pick);
    if (holders) holders.push(team.id);
    else claimedBy.set(pick, [team.id]);
  });

  const rows: ScoutLinkRow[] = [];
  const leagueIdByScoutId = new Map<string, string>();
  /** The league teams still open to a name match, once every answer has been read. */
  const unanswered: { team: LeagueTeamLink; key: string }[] = [];

  leagueTeams.forEach((team) => {
    const base = { leagueTeamId: team.id, leagueTeamName: team.name };
    const pick = team.scoutTeamId;

    if (pick === NO_SCOUT_TEAM) {
      // An answer, so the name match is off for this team too.
      rows.push({ ...base, how: "off" });
      return;
    }
    if (pick && !scoutById.has(pick)) {
      // A reset, a restore from elsewhere, or a tidy that folded this club into another. The fold
      // keeps the name (see mergeSameSquadIds / isSettledPairing), so the name match is the right
      // recovery — but the person is told, because the fold is not obliged to.
      unanswered.push({ team, key: teamNameKey(team.name) });
      rows.push({ ...base, how: "none", staleScoutTeamId: pick });
      return;
    }
    if (pick) {
      const holders = claimedBy.get(pick) ?? [];
      if (holders.length > 1) {
        // Two teams cannot be one club. Neither pick is honoured and neither falls back to a name:
        // re-guessing what a person has answered contradictorily is the very thing this replaced.
        rows.push({
          ...base,
          how: "none",
          scoutTeamId: pick,
          conflictWith: holders.filter((id) => id !== team.id),
        });
        return;
      }
      leagueIdByScoutId.set(pick, team.id);
      rows.push({
        ...base,
        how: "picked",
        scoutTeamId: pick,
        ...(scoutById.get(pick) ? { suggestedName: scoutById.get(pick)!.name } : {}),
      });
      return;
    }

    unanswered.push({ team, key: teamNameKey(team.name) });
    rows.push({ ...base, how: "none" });
  });

  const rowFor = new Map(rows.map((row) => [row.leagueTeamId, row]));
  const leagueIdByName = new Map<string, string>();
  unanswered.forEach(({ team, key }) => {
    const row = rowFor.get(team.id)!;
    // A club somebody has already chosen is spoken for; its namesake is not a substitute for it.
    const candidates = (scoutIdsByName.get(key) ?? []).filter(
      (scoutTeamId) => !leagueIdByScoutId.has(scoutTeamId)
    );
    if (candidates.length === 0) return;
    let only = candidates[0]!;
    if (candidates.length > 1) {
      // Two clubs of one name: ask their schedules. The one that has played the clubs this league
      // team plays is the one, and where that is not decisive the answer is to say so rather than
      // to credit both clubs' games to whichever came first.
      const scored = candidates
        .map((scoutTeamId) => ({ scoutTeamId, shared: sharedOpponents(team.id, scoutTeamId) }))
        .sort((a, b) => b.shared - a.shared);
      const best = scored[0]!;
      const tied = scored.filter((candidate) => candidate.shared === best.shared);
      if (best.shared === 0 || tied.length > 1) {
        row.ambiguousCount = candidates.length;
        return;
      }
      only = best.scoutTeamId;
      row.sharedOpponents = best.shared;
    }
    leagueIdByName.set(key, team.id);
    row.how = "guessed";
    row.scoutTeamId = only;
    row.suggestedName = scoutById.get(only)?.name;
  });

  /** A league team's own id where one is behind this club; otherwise an id of this club's own. */
  const ratingId = (scoutTeamId: string): string => {
    const explicit = leagueIdByScoutId.get(scoutTeamId);
    if (explicit) return explicit;
    const team = scoutById.get(scoutTeamId);
    const matched = team ? leagueIdByName.get(teamNameKey(team.name)) : undefined;
    return matched ?? `${SCOUT_ID_PREFIX}${scoutTeamId}`;
  };

  /** Two names and a day as one order-free key, so away-vs-home compares equal either way. */
  const nameFixtureKey = (away: string, home: string, date: string): string => {
    const day = normalizeDateInput(date ?? "");
    if (!day) return "";
    return `${[teamNameKey(away), teamNameKey(home)].sort().join("|")}|${day}`;
  };
  const fixtureKeys = new Set(
    seasonFixtures
      .map(({ away, home, date }) => nameFixtureKey(away, home, date))
      .filter((key) => key !== "")
  );
  const isSeasonFixture = (game: ScoutGame): boolean => {
    if (fixtureKeys.size === 0) return false;
    const away = scoutById.get(game.teamAId)?.name;
    const home = scoutById.get(game.teamBId)?.name;
    if (!away || !home) return false;
    const key = nameFixtureKey(away, home, game.date ?? "");
    return key !== "" && fixtureKeys.has(key);
  };

  /** Whether a pool club is one of this league's teams, rather than a stranger on the same page. */
  const isLeagueClub = (scoutTeamId: string): boolean =>
    !ratingId(scoutTeamId).startsWith(SCOUT_ID_PREFIX);

  const onLinkedPage = games.filter(
    (game) =>
      linked.has(game.ageGroupId) &&
      !game.id.startsWith(LEAGUE_GAME_PREFIX) &&
      !isSeasonFixture(game) &&
      countsTowardRating(game)
  );

  /**
   * Clubs a league team has actually played. Their other results are what place the league on the
   * same scale as everyone else — beating a club that beat a good club is the evidence an
   * opponent-adjusted rating runs on — so they come too, one step out and no further.
   */
  const played = new Set<string>();
  onLinkedPage.forEach((game) => {
    if (isLeagueClub(game.teamAId)) played.add(game.teamBId);
    if (isLeagueClub(game.teamBId)) played.add(game.teamAId);
  });

  /**
   * Only the games that touch the league.
   *
   * A linked page used to mean "this league's own age group", where every game on it was about
   * these teams. A GameChanger pull files the whole country there instead: on a real pool the page
   * a ten-team league was linked to held 8,689 clubs and 9,266 scored games, every one of which
   * was handed to the forecast. They carry nothing — a club in another state never played anyone
   * here, so the fit cannot learn anything about the league from it — and they cost, because ridge
   * shrinkage then pulls each league team toward the mean of a national pool it has no connection
   * to. What is kept is the league's own results and its opponents', which is the whole of what
   * the graph can reach.
   */
  const touchesLeague = (game: ScoutGame): boolean =>
    isLeagueClub(game.teamAId) ||
    isLeagueClub(game.teamBId) ||
    played.has(game.teamAId) ||
    played.has(game.teamBId);

  const results: ScoutBridgeResult[] = !seasonLinked
    ? []
    : onLinkedPage.filter(touchesLeague).map((game) => ({
        home: ratingId(game.teamAId),
        away: ratingId(game.teamBId),
        homeMargin: ratedMargin(game)!,
        ...(game.date ? { date: game.date } : {}),
        neutral: true as const,
      }));

  return {
    results,
    seasonLinked,
    rows,
    linkedCount: rows.filter((row) => row.how === "picked" || row.how === "guessed").length,
    countedResults: results.length,
  };
};

/** A pool club that could be this league team, and the evidence for it. */
export type ScoutLinkCandidate = {
  scoutTeamId: string;
  name: string;
  city?: string;
  state?: string;
  /**
   * Clubs this league team plays in its league, that this pool club has also played. This is the
   * evidence that matters: two clubs of one name are told apart by who they have played, and a
   * schedule is far harder to coincide with than a name.
   */
  sharedOpponents: string[];
  /** Games it has on this season's pages at all, as a tiebreak when nobody shares an opponent. */
  games: number;
  /**
   * The age GameChanger has it at in this season's year, when it says. Shown in the picker: two
   * clubs of one name in one town are told apart by nothing else on the row, and a person looking
   * at "Cincy Stix Navy · Harrison, OH" twice over cannot pick between them.
   */
  ageLevel?: number;
};

/**
 * Which pool clubs could be a given league team, best evidence first.
 *
 * The country is full of Trash Pandas, so a name cannot answer "which one". A schedule can. This
 * league team plays a known set of opponents; a pool club has played a known set of opponents; the
 * club that has played the same clubs is the club. One name in common is weak and three is close to
 * certain, so the count is returned rather than a verdict — the panel shows it and a person decides.
 *
 * Opponents are compared by name because that is the only thing the two halves share: the league
 * and Team Rankings keep separate ids for the same club, which is the very problem being solved.
 */
export const scoutLinkCandidates = (
  leagueTeamName: string,
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  /** This season's own schedule, as league names: who this team plays. */
  seasonFixtures: { away: string; home: string; date: string }[]
): ScoutLinkCandidate[] => {
  const pages = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  if (pages.size === 0) return [];
  const scoutById = new Map(teams.map((team) => [team.id, team]));
  const meKey = teamNameKey(leagueTeamName);

  // Who this league team plays, by name key.
  const leagueOpponents = new Set<string>();
  seasonFixtures.forEach((fixture) => {
    if (teamNameKey(fixture.away) === meKey) leagueOpponents.add(teamNameKey(fixture.home));
    else if (teamNameKey(fixture.home) === meKey) leagueOpponents.add(teamNameKey(fixture.away));
  });

  // Who each pool club on this season's pages has played, by name key.
  const played = new Map<string, Map<string, string>>();
  const gameCount = new Map<string, number>();
  const note = (id: string, otherId: string) => {
    const other = scoutById.get(otherId);
    gameCount.set(id, (gameCount.get(id) ?? 0) + 1);
    if (!other || other.placeholder) return;
    const bucket = played.get(id) ?? new Map<string, string>();
    bucket.set(teamNameKey(other.name), other.name);
    played.set(id, bucket);
  };
  games.forEach((game) => {
    if (!pages.has(game.ageGroupId)) return;
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });

  /*
   * The board this season is on, and the squad year it sits in. A page holds cross-age games, so
   * being on it is not on its own evidence of being the right age: an 11U club that played down
   * here is on this page and is not the 10U team anybody is naming.
   */
  const levels = levelsForSeason(seasonId, ageGroups);
  const years = yearsForSeason(seasonId, ageGroups);

  const candidates: ScoutLinkCandidate[] = [];
  gameCount.forEach((count, scoutTeamId) => {
    const team = scoutById.get(scoutTeamId);
    // GameChanger-known, and at this board's level or one below it — see `clubIsPickable`.
    if (!team || !clubIsPickable(team, levels, years, ageGroups)) return;
    const opponents = played.get(scoutTeamId);
    const shared: string[] = [];
    opponents?.forEach((name, key) => {
      if (leagueOpponents.has(key)) shared.push(name);
    });
    shared.sort((a, b) => a.localeCompare(b));
    const ageLevel = gcAgeLevels(team, years[0], ageGroups)[0];
    candidates.push({
      scoutTeamId,
      name: team.name,
      ...(team.city ? { city: team.city } : {}),
      ...(team.state ? { state: team.state } : {}),
      ...(ageLevel === undefined ? {} : { ageLevel }),
      sharedOpponents: shared,
      games: count,
    });
  });

  return candidates.sort(
    (a, b) =>
      b.sharedOpponents.length - a.sharedOpponents.length ||
      b.games - a.games ||
      a.name.localeCompare(b.name)
  );
};

/**
 * The outside results alone. Kept as its own export because that is all the rating path wants, and
 * because every test written against the old name still describes exactly what it does.
 */
export const externalResultsForSeason = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  leagueTeams: LeagueTeamLink[],
  seasonFixtures: { away: string; home: string; date: string }[]
): ScoutBridgeResult[] =>
  leagueScoutBridge(seasonId, ageGroups, teams, games, leagueTeams, seasonFixtures).results;

/**
 * Renames a team, merging it into an existing one when the new name is already taken.
 *
 * The merge is the point. A schedule that listed an opponent as "TBD", or a name typed two ways,
 * becomes a second team holding a few games that belong to a real one. Renaming it onto that real
 * name is how those games get routed home, so this repoints them rather than refusing the name.
 *
 * A game between the two teams being merged would become a team playing itself, which is not a
 * result; those are dropped rather than kept as a nonsense row.
 */
export const renameScoutTeam = (
  teamId: string,
  nextName: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): {
  teams: ScoutTeam[];
  games: ScoutGame[];
  mergedInto: ScoutTeam | null;
  droppedGames: number;
  collapsedGames: number;
} => {
  const display = cleanTeamName(nextName).trim();
  if (!display) return { teams, games, mergedInto: null, droppedGames: 0, collapsedGames: 0 };

  const key = teamNameKey(display);
  const target = teams.find((team) => team.id !== teamId && teamNameKey(team.name) === key);

  if (!target) {
    return {
      teams: teams.map((team) => (team.id === teamId ? { ...team, name: display } : team)),
      games,
      mergedInto: null,
      droppedGames: 0,
      collapsedGames: 0,
    };
  }

  const merged = mergeScoutTeams(teamId, target.id, teams, games, ageGroups);
  return { ...merged, mergedInto: target };
};

/**
 * Folds one team into another, keeping the survivor's id. This is the manual override behind
 * every identity decision the app cannot make on its own: pairing a Fall GameChanger id with the
 * Spring one when the names differ, sending a name-only placeholder's games to the team it turned
 * out to be, or undoing a wrong match by merging the pieces back together.
 *
 * Games are repointed at the survivor; a game between the two (a team playing itself once merged)
 * is not a result and is dropped. Two rows that were each half's copy of one game — both ids
 * filed the same fixture, which is usually what proved them one squad — are one row afterwards
 * (`collapseSameGames`). GameChanger links are unioned by id, since both halves may have been
 * pulled — that union is exactly what "the same squad across seasons" means here. Blank name,
 * state and city on the survivor are filled from the team folded in; anything the survivor
 * already has stands, because the user chose which one survives.
 */
export const mergeScoutTeams = (
  fromId: string,
  intoId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): { teams: ScoutTeam[]; games: ScoutGame[]; droppedGames: number; collapsedGames: number } => {
  const removed = teams.find((team) => team.id === fromId);
  const survivor = teams.find((team) => team.id === intoId);
  if (!removed || !survivor || fromId === intoId) {
    return { teams, games, droppedGames: 0, collapsedGames: 0 };
  }

  const repointed: ScoutGame[] = [];
  let droppedGames = 0;
  games.forEach((game) => {
    const teamAId = game.teamAId === fromId ? intoId : game.teamAId;
    const teamBId = game.teamBId === fromId ? intoId : game.teamBId;
    if (teamAId === teamBId) {
      droppedGames += 1;
      return;
    }
    repointed.push(
      teamAId === game.teamAId && teamBId === game.teamBId ? game : { ...game, teamAId, teamBId }
    );
  });

  const linkedIds = new Set((survivor.gcTeams ?? []).map((link) => link.teamId));
  const gcTeams = [
    ...(survivor.gcTeams ?? []),
    ...(removed.gcTeams ?? []).filter((link) => !linkedIds.has(link.teamId)),
  ];
  const fillName = !survivor.name.trim() && removed.name.trim();
  const fillState = !survivor.state && removed.state;
  const fillCity = !survivor.city && removed.city;
  // "Our team" is a fact about the club, so it survives whichever half carried it.
  const fillMine = !survivor.isMine && removed.isMine;
  const linksChanged = gcTeams.length !== (survivor.gcTeams?.length ?? 0);
  const changed = fillName || fillState || fillCity || fillMine || linksChanged;

  const merged: ScoutTeam = changed
    ? {
        ...survivor,
        ...(fillName ? { name: removed.name } : {}),
        ...(fillState ? { state: removed.state } : {}),
        ...(fillCity ? { city: removed.city } : {}),
        ...(fillMine ? { isMine: true } : {}),
        ...(gcTeams.length ? { gcTeams } : {}),
      }
    : survivor;

  const collapsed = collapseSameGames(repointed, ageGroups, intoId);
  return {
    teams: teams.flatMap((team) =>
      team.id === fromId ? [] : team.id === intoId ? [merged] : [team]
    ),
    games: collapsed.games,
    droppedGames,
    collapsedGames: collapsed.collapsed,
  };
};

/**
 * Removes one GameChanger link from a team. The games that link brought in stay: they happened,
 * and they still belong to this team as far as the user has said. Unlinking is how a wrong pairing
 * is taken apart (the id can then be pulled again onto a team of its own), so the last link coming
 * off leaves a plain name-only team rather than one holding an empty list.
 */
export const unlinkGcTeam = (teamId: string, gcTeamId: string, teams: ScoutTeam[]): ScoutTeam[] =>
  teams.map((team) => {
    if (team.id !== teamId || !team.gcTeams?.some((link) => link.teamId === gcTeamId)) return team;
    const remaining = team.gcTeams.filter((link) => link.teamId !== gcTeamId);
    const next: ScoutTeam = { ...team, gcTeams: remaining };
    if (!remaining.length) delete next.gcTeams;
    return next;
  });

/**
 * Every GameChanger id the pool has already been pulled by.
 *
 * A team list grows rather than changes: a few dozen clubs are added to an export of several
 * thousand, and fetching the whole file again to find them costs the same minutes as the first
 * run did. What is already here is exactly what carries one of these ids, so this is what the
 * import panel subtracts to leave the teams it has never seen.
 */
export const pulledGcTeamIds = (teams: readonly ScoutTeam[]): Set<string> => {
  const ids = new Set<string>();
  teams.forEach((team) => (team.gcTeams ?? []).forEach((link) => ids.add(link.teamId)));
  return ids;
};

/** Every game this team has, newest first, across every age group. */
export const gamesForTeam = (teamId: string, games: ScoutGame[]): ScoutGame[] =>
  games
    .filter((game) => game.teamAId === teamId || game.teamBId === teamId)
    .slice()
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
