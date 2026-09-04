import type { GameLog, Matchup, TeamBase } from "./types";
import { buildOpponentAdjustedRatings } from "./powerRating";
import { clamp, isFinal, parseNumber } from "./util";
import { createTeamId } from "./sim";

/**
 * Team Rankings is a separate, age-group-scoped-but-globally-rostered ranking pool: teams are a
 * single global list (the same real-world opponent is one entity across seasons/age levels), but a
 * ranking is only ever computed for one age group's games at a time (different age levels aren't
 * comparable). An age group is a user-defined label bundling together whichever League Standings
 * seasons belong to the same age level — e.g. "2027" might bundle a "Fall 2026" and a "Spring
 * 2027" season, since a club often runs two (or more) League Standings seasons per age-group year.
 */
export type AgeGroup = {
  id: string;
  name: string;
  /** League Standings `SeasonMeta.id`s that belong to this age group. */
  seasonIds: string[];
  /**
   * The earlier age group this one carries on from — last year's squad, e.g. "9U 2027" for a
   * "10U 2028". Only used to carry team-name suggestions forward as a squad ages up; results are
   * never pooled across age groups, since a 9U score says nothing about a 10U game.
   */
  continuesFromId?: string;
  /** "Our" team *in this age group*, so two squads running at once can each have one. */
  myTeamId?: string;
};

export type ScoutTeam = {
  id: string;
  name: string;
  /**
   * Legacy global "our team" marker, kept so rankings saved before `AgeGroup.myTeamId` existed
   * still highlight the right team. `AgeGroup.myTeamId` supersedes it — a club can run a 9U and an
   * 11U squad at once, and each needs its own — so new marks are written there instead.
   * Cosmetic/organizational only, either way: neither flag may feed into `buildTeamRankings` or
   * `predictMatchup`'s math. Our own team is ranked by the exact same opponent-adjusted formula as
   * everyone else.
   */
  isMine?: boolean;
};

export type ScoutGame = {
  id: string;
  teamAId: string;
  teamBId: string;
  /**
   * Both present = a completed result (counts toward ratings/record). Both absent = a scheduled/
   * future game — logged so the team shows up in the pool ahead of time, but excluded from every
   * rating and record calculation until a score is entered.
   */
  teamAScore?: number;
  teamBScore?: number;
  /** References an `AgeGroup.id` — the age level this result belongs to. */
  ageGroupId: string;
  date?: string;
  event?: string;
  note?: string;
};

/** A game only counts toward ratings/records once both scores are recorded. */
export const isScoutGamePlayed = (game: ScoutGame): boolean =>
  Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore);

export type ScoutRankingRow = {
  teamId: string;
  teamName: string;
  isMine: boolean;
  rank: number;
  /** Opponent-adjusted expected margin vs an average team in this age group's pool, in runs. */
  rating: number;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  rawMargin: number;
  strengthOfSchedule: number;
  sosRank: number;
};

export type MatchupTier = "Favored" | "Toss-up" | "Underdog";

export type MatchupPreview = {
  opponentId: string;
  opponentName: string;
  opponentRank: number;
  /** Positive favors the team the report was built for. */
  projectedMargin: number;
  winProb: number;
  tier: MatchupTier;
};

const RATING_CAP = 8;
/** Prefix guarantees a scout-created id can never collide with a league season's own team ids
 * (those are plain alphanumeric codes from `createTeamId` in sim.ts). */
const SCOUT_ID_PREFIX = "S-";

/** "9U", "9u", "12 U", "U10" — an age level, anywhere in the name. */
const AGE_LABEL = /\b(?:\d{1,2}\s*[uU]|[uU]\s*\d{1,2})\b/g;

/**
 * Drops the age label from a team name: an age level describes *this year's* squad, not the club,
 * and the same club plays up a level every year ("South Lexington Red 9u" becomes "…10u"). Keeping
 * the label would fragment one real-world team into a new entity every season, which is exactly
 * what the age-group scoping already handles. Handles labels anywhere in the name, so
 * "NV Stars 9u Scout" becomes "NV Stars Scout".
 */
export const stripAgeLabel = (name: string): string => {
  const stripped = name
    .replace(AGE_LABEL, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—,]+|[\s\-–—,]+$/g, "");
  // A name that is *only* an age label still has to be called something.
  return stripped || name.trim();
};

/**
 * The key two names are compared by: age-label-free and case-insensitive. Exported so callers that
 * need to look a name up in the roster (the screenshot importer, for one) match names exactly the
 * way `resolveOrCreateTeam` does, instead of re-deriving the rule.
 */
export const teamNameKey = (name: string) => stripAgeLabel(name).toLowerCase();

const normalizeName = teamNameKey;

/**
 * Case-insensitive, age-label-insensitive name match against the pool; creates a new team if none
 * matches. A team stored before age labels were stripped ("Velocirabbits 9U") is healed in place on
 * its next match, so old entries converge without a migration.
 */
export const resolveOrCreateTeam = (
  name: string,
  teams: ScoutTeam[]
): { teams: ScoutTeam[]; teamId: string } => {
  const display = stripAgeLabel(name);
  const key = normalizeName(name);
  const existingIndex = teams.findIndex((team) => normalizeName(team.name) === key);

  if (existingIndex >= 0) {
    const existing = teams[existingIndex]!;
    // Clean the *stored* name rather than adopting the incoming one, so its capitalization stands.
    const cleaned = stripAgeLabel(existing.name);
    if (cleaned === existing.name) return { teams, teamId: existing.id };
    const next = teams.slice();
    next[existingIndex] = { ...existing, name: cleaned };
    return { teams: next, teamId: existing.id };
  }

  const existingIds = new Set(teams.map((team) => team.id));
  const id = `${SCOUT_ID_PREFIX}${createTeamId(display, new Set())}`;
  let uniqueId = id;
  let counter = 2;
  while (existingIds.has(uniqueId)) {
    uniqueId = `${id}${counter}`;
    counter += 1;
  }
  return { teams: [...teams, { id: uniqueId, name: display }], teamId: uniqueId };
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
/** Marks a game carried in from a League Standings schedule rather than logged here. */
export const LEAGUE_GAME_PREFIX = "league_";

export const deriveLeagueScoutGames = (
  ageGroupId: string,
  seasons: LeagueSeasonSnapshot[],
  scoutTeams: ScoutTeam[]
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
          date: matchup.date,
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
    if (game.ageGroupId !== ageGroupId) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  return teams.filter((team) => active.has(team.id));
};

/**
 * The age groups whose rosters belong together, nearest first: this one, then whatever it
 * continues from, and so on back through the chain. A squad keeps its opponents as it ages up —
 * last year's 9U schedule is a good guess at this year's 10U one — but two age groups running at
 * the same time (a 9U and an 11U squad) are unrelated, so neither sees the other's names.
 *
 * `continuesFromId` is user-entered, so a chain could be pointed at itself; `seen` stops that from
 * looping forever.
 */
export const ageGroupChain = (ageGroupId: string, ageGroups: AgeGroup[]): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = ageGroupId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = ageGroups.find((group) => group.id === current)?.continuesFromId;
  }
  return chain;
};

/**
 * The team names to offer when logging a game in this age group: everyone played in it, plus
 * everyone played in the age groups it continues from. Scoped rather than global so a 9U opponent
 * never shows up in the 11U ranking's name list — the two squads share a roster store but play
 * nobody in common.
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
  return teams.filter((team) => active.has(team.id));
};

const scoreOf = (game: ScoutGame, teamId: string): number | undefined =>
  game.teamAId === teamId ? game.teamAScore : game.teamBScore;

/**
 * Finds an existing game that looks like the same game as `candidate` — same two teams (in either
 * order), same date, same score. That is the shape a double-entry takes, whether it came from
 * typing a game twice, importing a screenshot twice, or re-entering one the league schedule
 * already supplied. Two scoreless scheduled games on the same date count as a match too, since
 * "no score yet" is the same on both sides.
 */
export const findDuplicateGame = (candidate: ScoutGame, games: ScoutGame[]): ScoutGame | null => {
  const pairKey = [candidate.teamAId, candidate.teamBId].slice().sort().join("|");
  const found = games.find((game) => {
    if (game.id === candidate.id) return false;
    if (game.ageGroupId !== candidate.ageGroupId) return false;
    if ([game.teamAId, game.teamBId].slice().sort().join("|") !== pairKey) return false;
    if ((game.date ?? "") !== (candidate.date ?? "")) return false;
    return (
      scoreOf(game, candidate.teamAId) === candidate.teamAScore &&
      scoreOf(game, candidate.teamBId) === candidate.teamBScore
    );
  });
  return found ?? null;
};

const recordFor = (teamId: string, playedGames: ScoutGame[]) => {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  playedGames.forEach((game) => {
    if (game.teamAId !== teamId && game.teamBId !== teamId) return;
    const own = (game.teamAId === teamId ? game.teamAScore : game.teamBScore)!;
    const opp = (game.teamAId === teamId ? game.teamBScore : game.teamAScore)!;
    if (own > opp) wins += 1;
    else if (own < opp) losses += 1;
    else ties += 1;
  });
  return { wins, losses, ties };
};

/**
 * Ranks the given teams using only *completed* games tagged with `ageGroupId` (defensive filter —
 * callers should already be passing an age-group-scoped game list). Scheduled/unplayed games are
 * ignored here entirely; they exist only so a future opponent can be logged ahead of time. Every
 * team is rated by this exact same formula — which team is "ours" plays no part in the
 * computation; `myTeamId` (falling back to the legacy `ScoutTeam.isMine`) only sets a display flag.
 */
export const buildTeamRankings = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  myTeamId?: string
): ScoutRankingRow[] => {
  const playedGames = games.filter(
    (game) => game.ageGroupId === ageGroupId && isScoutGamePlayed(game)
  );
  const adjusted = buildOpponentAdjustedRatings(
    teams.map((team) => team.id),
    playedGames.map((game) => ({
      home: game.teamAId,
      away: game.teamBId,
      homeMargin: game.teamAScore! - game.teamBScore!,
    })),
    { cap: RATING_CAP }
  );

  const rows = teams.map((team): ScoutRankingRow => {
    const { wins, losses, ties } = recordFor(team.id, playedGames);
    const gamesPlayed = adjusted.games.get(team.id) ?? 0;
    return {
      teamId: team.id,
      teamName: team.name,
      isMine: myTeamId ? team.id === myTeamId : Boolean(team.isMine),
      rank: 0,
      rating: adjusted.ratings.get(team.id) ?? 0,
      record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
      wins,
      losses,
      ties,
      games: gamesPlayed,
      rawMargin: adjusted.rawMargin.get(team.id) ?? 0,
      strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
      sosRank: 0,
    };
  });

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

/** Same margin-clamp/logistic formula `predictionEngine.ts` uses for League Standings' own
 * matchup predictions — kept identical so the two features read consistently. Deliberately ignores
 * home-field advantage: Team Rankings games are treated as neutral-site. */
export const predictMatchup = (ratingA: number, ratingB: number) => {
  const margin = clamp(ratingA - ratingB, -14, 14);
  const winProbA = clamp(1 / (1 + Math.exp(-margin / 2.8)), 0.08, 0.92);
  return { projectedMargin: margin, winProbA, winProbB: 1 - winProbA };
};

const tierFor = (winProb: number): MatchupTier =>
  winProb > 0.6 ? "Favored" : winProb < 0.4 ? "Underdog" : "Toss-up";

/** For the given team, project the result against every other team in the same ranked pool,
 * ordered by opponent rank. */
export const buildScoutingReport = (
  forTeamId: string,
  rows: ScoutRankingRow[]
): MatchupPreview[] => {
  const forRow = rows.find((row) => row.teamId === forTeamId);
  if (!forRow) return [];
  return rows
    .filter((row) => row.teamId !== forTeamId)
    .map((opponent): MatchupPreview => {
      const { projectedMargin, winProbA } = predictMatchup(forRow.rating, opponent.rating);
      return {
        opponentId: opponent.teamId,
        opponentName: opponent.teamName,
        opponentRank: opponent.rank,
        projectedMargin,
        winProb: winProbA,
        tier: tierFor(winProbA),
      };
    })
    .sort((a, b) => a.opponentRank - b.opponentRank);
};

/**
 * The results this season's league does not already know about: games logged in Team Rankings for
 * an age group that includes this season, minus the ones that came *from* the league schedule in
 * the first place. Counting those twice would quietly double the weight of every league game.
 *
 * Teams are matched to the league by name, since the two sides keep separate ids for the same club.
 * An opponent with no league counterpart keeps an id of its own, so the rating model can estimate
 * how good it was instead of assuming — which is the whole point: a shared tournament opponent is
 * what lets two league teams that never met be compared.
 */
export const externalResultsForSeason = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  leagueTeams: { id: string; name: string }[]
): { home: string; away: string; homeMargin: number }[] => {
  const linked = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  if (linked.size === 0) return [];

  const leagueIdByName = new Map(leagueTeams.map((team) => [teamNameKey(team.name), team.id]));
  const scoutNameById = new Map(teams.map((team) => [team.id, team.name]));

  // A league team's own id where the name matches; otherwise an id of this opponent's own that
  // cannot collide with a league one.
  const ratingId = (scoutTeamId: string): string => {
    const name = scoutNameById.get(scoutTeamId);
    const matched = name ? leagueIdByName.get(teamNameKey(name)) : undefined;
    return matched ?? `${SCOUT_ID_PREFIX}${scoutTeamId}`;
  };

  return games
    .filter(
      (game) =>
        linked.has(game.ageGroupId) &&
        !game.id.startsWith(LEAGUE_GAME_PREFIX) &&
        isScoutGamePlayed(game)
    )
    .map((game) => ({
      home: ratingId(game.teamAId),
      away: ratingId(game.teamBId),
      // Team Rankings is neutral-site; the pair order carries no home meaning.
      homeMargin: game.teamAScore! - game.teamBScore!,
    }));
};
