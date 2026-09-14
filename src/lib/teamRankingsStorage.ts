import type { AgeGroup, GcTeamLink, ScoutGame, ScoutGameSource, ScoutTeam } from "./teamRankings";
import { isNumber, isRecord, isString } from "./validate";
import {
  decodeScoutGames,
  decodeScoutTeams,
  encodeScoutGames,
  encodeScoutTeams,
} from "./teamRankingsCompact";

/**
 * Team Rankings persistence is intentionally separate from `storage.ts`'s season-namespaced
 * layout: this is a single global pool, not scoped to any one League Standings season — age groups
 * are the only scoping concept here, and one age group can bundle several League Standings seasons.
 */
const TEAMS_KEY = "league_forecast_scout_teams_v1";
const GAMES_KEY = "league_forecast_scout_games_v1";
const AGE_GROUPS_KEY = "league_forecast_scout_age_groups_v1";

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

/** A string with something in it — an id made of whitespace identifies nothing. */
const isFilledString = (value: unknown): value is string => isString(value) && value.trim() !== "";

const coerceGcRecord = (raw: unknown): GcTeamLink["record"] | undefined =>
  isRecord(raw) && isNumber(raw.win) && isNumber(raw.loss) && isNumber(raw.tie)
    ? { win: raw.win, loss: raw.loss, tie: raw.tie }
    : undefined;

/**
 * One GameChanger link, or null when it cannot be one. The three ids are what a link *is* — the
 * GameChanger team, what it is called there, and the page its schedule is filed under — so a link
 * missing any of them is dropped. Everything else is what GameChanger said last time and is kept
 * only when it is the right shape; a bad record or a numeric season loses that field, not the link.
 */
export const coerceGcTeamLink = (raw: unknown): GcTeamLink | null => {
  if (!isRecord(raw)) return null;
  if (!isFilledString(raw.teamId) || !isString(raw.name) || !isFilledString(raw.ageGroupId)) {
    return null;
  }
  const record = coerceGcRecord(raw.record);
  return {
    teamId: raw.teamId,
    name: raw.name,
    ageGroupId: raw.ageGroupId,
    ...(isString(raw.season) ? { season: raw.season } : {}),
    ...(isNumber(raw.seasonYear) ? { seasonYear: raw.seasonYear } : {}),
    ...(isNumber(raw.ageLevel) ? { ageLevel: raw.ageLevel } : {}),
    ...(isString(raw.avatarKey) ? { avatarKey: raw.avatarKey } : {}),
    ...(record ? { record } : {}),
    ...(isString(raw.importedAt) ? { importedAt: raw.importedAt } : {}),
  };
};

/** The usable links out of a stored list; anything that is not a list yields none. */
export const coerceGcTeamLinks = (raw: unknown): GcTeamLink[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const link = coerceGcTeamLink(entry);
    return link ? [link] : [];
  });
};

/**
 * Where a game came from, when the stored shape says GameChanger. Anything else — an unknown
 * kind, a missing id — reads as no source, which turns the game back into a typed-in one rather
 * than losing it: the result is still real even if its provenance is not.
 */
const coerceGameSource = (raw: unknown): ScoutGameSource | undefined =>
  isRecord(raw) &&
  raw.kind === "gamechanger" &&
  isFilledString(raw.teamId) &&
  isFilledString(raw.gameId)
    ? { kind: "gamechanger", teamId: raw.teamId, gameId: raw.gameId }
    : undefined;

export const coerceScoutTeams = (raw: unknown): ScoutTeam[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && isString(entry.id) && isString(entry.name)
    )
    .map((entry) => {
      // Malformed links are dropped one at a time; the team itself is never lost over one.
      const gcTeams = coerceGcTeamLinks(entry.gcTeams);
      return {
        id: entry.id as string,
        name: entry.name as string,
        ...(entry.isMine === true ? { isMine: true } : {}),
        ...(isString(entry.state) ? { state: entry.state } : {}),
        ...(isString(entry.city) ? { city: entry.city } : {}),
        ...(gcTeams.length ? { gcTeams } : {}),
      };
    });
};

export const coerceScoutGames = (raw: unknown): ScoutGame[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.teamAId) &&
        isString(entry.teamBId) &&
        isString(entry.ageGroupId) &&
        (entry.teamAScore === undefined || isNumber(entry.teamAScore)) &&
        (entry.teamBScore === undefined || isNumber(entry.teamBScore))
    )
    .map((entry) => {
      const source = coerceGameSource(entry.source);
      return {
        id: entry.id as string,
        teamAId: entry.teamAId as string,
        teamBId: entry.teamBId as string,
        ageGroupId: entry.ageGroupId as string,
        ...(isNumber(entry.teamAScore) ? { teamAScore: entry.teamAScore } : {}),
        ...(isNumber(entry.teamBScore) ? { teamBScore: entry.teamBScore } : {}),
        ...(isString(entry.date) ? { date: entry.date } : {}),
        ...(isString(entry.event) ? { event: entry.event } : {}),
        ...(isString(entry.note) ? { note: entry.note } : {}),
        ...(entry.excluded === true ? { excluded: true } : {}),
        ...(isNumber(entry.ageLevelA) ? { ageLevelA: entry.ageLevelA } : {}),
        ...(isNumber(entry.ageLevelB) ? { ageLevelB: entry.ageLevelB } : {}),
        ...(isString(entry.season) ? { season: entry.season } : {}),
        ...(source ? { source } : {}),
      };
    });
};

export const coerceAgeGroups = (raw: unknown): AgeGroup[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.name) &&
        Array.isArray(entry.seasonIds)
    )
    .map((entry) => ({
      id: entry.id as string,
      name: entry.name as string,
      seasonIds: (entry.seasonIds as unknown[]).filter(isString),
      ...(isNumber(entry.ageLevel) ? { ageLevel: entry.ageLevel } : {}),
      ...(isNumber(entry.year) ? { year: entry.year } : {}),
      ...(isString(entry.continuesFromId) ? { continuesFromId: entry.continuesFromId } : {}),
      ...(isString(entry.myTeamId) ? { myTeamId: entry.myTeamId } : {}),
    }));
};

/**
 * Written compactly — tuples and dictionaries rather than the objects themselves — because a
 * GameChanger pull reaches a size the readable form does not fit in: see `teamRankingsCompact.ts`.
 * A pool saved before that existed is an array, and is still read as one; the next save rewrites
 * it. The in-memory shape is unchanged either way, so nothing above this line knows.
 */
export const loadScoutTeams = (): ScoutTeam[] =>
  decodeScoutTeams(parseJson(safeGet(TEAMS_KEY)), coerceScoutTeams);
export const saveScoutTeams = (teams: ScoutTeam[]): boolean =>
  safeSet(TEAMS_KEY, JSON.stringify(encodeScoutTeams(teams)));

export const loadScoutGames = (): ScoutGame[] =>
  decodeScoutGames(parseJson(safeGet(GAMES_KEY)), coerceScoutGames);
export const saveScoutGames = (games: ScoutGame[]): boolean =>
  safeSet(GAMES_KEY, JSON.stringify(encodeScoutGames(games)));

export const loadAgeGroups = (): AgeGroup[] => coerceAgeGroups(parseJson(safeGet(AGE_GROUPS_KEY)));
export const saveAgeGroups = (ageGroups: AgeGroup[]): boolean =>
  safeSet(AGE_GROUPS_KEY, JSON.stringify(ageGroups));
