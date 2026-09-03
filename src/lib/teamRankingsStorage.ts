import type { ScoutGame, ScoutTeam } from "./teamRankings";
import { isNumber, isRecord, isString } from "./validate";

/**
 * Team Rankings persistence is intentionally separate from `storage.ts`'s season-namespaced
 * layout: this is a single global pool, not scoped to any one League Standings season.
 */
const TEAMS_KEY = "league_forecast_scout_teams_v1";
const GAMES_KEY = "league_forecast_scout_games_v1";

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const coerceScoutTeams = (raw: unknown): ScoutTeam[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && isString(entry.id) && isString(entry.name)
    )
    .map((entry) => ({
      id: entry.id as string,
      name: entry.name as string,
      ...(entry.isMine === true ? { isMine: true } : {}),
    }));
};

const coerceScoutGames = (raw: unknown): ScoutGame[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.teamAId) &&
        isString(entry.teamBId) &&
        isString(entry.seasonId) &&
        (entry.teamAScore === undefined || isNumber(entry.teamAScore)) &&
        (entry.teamBScore === undefined || isNumber(entry.teamBScore))
    )
    .map((entry) => ({
      id: entry.id as string,
      teamAId: entry.teamAId as string,
      teamBId: entry.teamBId as string,
      seasonId: entry.seasonId as string,
      ...(isNumber(entry.teamAScore) ? { teamAScore: entry.teamAScore } : {}),
      ...(isNumber(entry.teamBScore) ? { teamBScore: entry.teamBScore } : {}),
      ...(isString(entry.date) ? { date: entry.date } : {}),
      ...(isString(entry.event) ? { event: entry.event } : {}),
      ...(isString(entry.note) ? { note: entry.note } : {}),
    }));
};

export const loadScoutTeams = (): ScoutTeam[] => coerceScoutTeams(parseJson(safeGet(TEAMS_KEY)));
export const saveScoutTeams = (teams: ScoutTeam[]): boolean =>
  safeSet(TEAMS_KEY, JSON.stringify(teams));

export const loadScoutGames = (): ScoutGame[] => coerceScoutGames(parseJson(safeGet(GAMES_KEY)));
export const saveScoutGames = (games: ScoutGame[]): boolean =>
  safeSet(GAMES_KEY, JSON.stringify(games));
