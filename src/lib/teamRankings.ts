import type { GameLog, Matchup, TeamBase } from "./types";
import { buildOpponentAdjustedRatings } from "./powerRating";
import { clamp, isFinal, parseNumber } from "./util";
import { createTeamId } from "./sim";

/**
 * Team Rankings is a separate, season-scoped-but-globally-rostered ranking pool: teams are a
 * single global list (the same real-world opponent is one entity across seasons/age levels), but
 * a ranking is only ever computed for one season's games at a time (age levels aren't comparable).
 */
export type ScoutTeam = {
  id: string;
  name: string;
  /**
   * At most one team should carry this at a time; marks "our" team in the pool so the UI can
   * default to it (scouting report, highlighting, "use my team" shortcuts). Cosmetic/organizational
   * only — this flag must never feed into `buildTeamRankings` or `predictMatchup`'s math. Our own
   * team is ranked using the exact same opponent-adjusted formula as everyone else.
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
  /** References a League Standings `SeasonMeta.id` — the age/period this result belongs to. */
  seasonId: string;
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
  /** Opponent-adjusted expected margin vs an average team in this season's pool, in runs. */
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

const normalizeName = (name: string) => name.trim().toLowerCase();

/** Case-insensitive/trimmed name match against the pool; creates a new team if none matches. */
export const resolveOrCreateTeam = (
  name: string,
  teams: ScoutTeam[]
): { teams: ScoutTeam[]; teamId: string } => {
  const trimmed = name.trim();
  const existing = teams.find((team) => normalizeName(team.name) === normalizeName(trimmed));
  if (existing) return { teams, teamId: existing.id };

  const existingIds = new Set(teams.map((team) => team.id));
  const id = `${SCOUT_ID_PREFIX}${createTeamId(trimmed, new Set())}`;
  let uniqueId = id;
  let counter = 2;
  while (existingIds.has(uniqueId)) {
    uniqueId = `${id}${counter}`;
    counter += 1;
  }
  return { teams: [...teams, { id: uniqueId, name: trimmed }], teamId: uniqueId };
};

const scoreFor = (log: GameLog | undefined, side: "away" | "home") =>
  parseNumber(side === "away" ? (log?.awayRuns ?? "") : (log?.homeRuns ?? ""), Number.NaN);

/**
 * Convert a League Standings season's completed games into scout-style games tagged with that
 * season, resolving each league team name into the given global scout pool (creating entries the
 * first time a league team name is seen). Pure — the caller is responsible for loading the
 * season's data and for persisting any newly-created scout teams.
 */
export const deriveLeagueScoutGames = (
  seasonId: string,
  leagueTeams: TeamBase[],
  leagueMatchups: Matchup[],
  leagueLogs: Record<string, GameLog>,
  scoutTeams: ScoutTeam[]
): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  const leagueNameById = new Map(leagueTeams.map((team) => [team.id, team.name]));
  let teams = scoutTeams;
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

  const games: ScoutGame[] = [];
  leagueMatchups.forEach((matchup) => {
    const log = leagueLogs[matchup.id];
    if (!isFinal(log)) return;
    const awayScore = scoreFor(log, "away");
    const homeScore = scoreFor(log, "home");
    if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return;
    const teamAId = resolveLeagueTeam(matchup.away);
    const teamBId = resolveLeagueTeam(matchup.home);
    if (!teamAId || !teamBId) return;
    games.push({
      id: `league_${seasonId}_${matchup.id}`,
      teamAId,
      teamBId,
      teamAScore: awayScore,
      teamBScore: homeScore,
      seasonId,
      date: matchup.date,
    });
  });

  return { teams, games };
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
 * Ranks the given teams using only *completed* games tagged with `seasonId` (defensive filter —
 * callers should already be passing a season-scoped game list). Scheduled/unplayed games are
 * ignored here entirely; they exist only so a future opponent can be logged ahead of time. Every
 * team is rated by this exact same formula — `isMine` plays no part in the computation.
 */
export const buildTeamRankings = (
  seasonId: string,
  teams: ScoutTeam[],
  games: ScoutGame[]
): ScoutRankingRow[] => {
  const playedGames = games.filter((game) => game.seasonId === seasonId && isScoutGamePlayed(game));
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
      isMine: Boolean(team.isMine),
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
