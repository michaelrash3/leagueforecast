import { myTeamGlance } from "./myTeamGlance";
import type { Movement } from "./rankMovement";
import type { ScoutRankingRow } from "./teamRankings";

/**
 * Where a League Standings team's club stands on its Team Rankings board, as that board last
 * stood: the national place, the place in its state, and how far it has moved in a week.
 */
export type LeagueClubRank = {
  clubId: string;
  /** The board it was read off, as its page names it: "9U 2027", with the half when there is one. */
  board: string;
  rank: number;
  of: number;
  state?: string;
  stateRank?: number;
  stateOf?: number;
  movement?: Movement;
  /** When the board was read, as an ISO time. */
  at: string;
};

/** Season id to league team id to where its club stands. */
export type LeagueClubRanks = Record<string, Record<string, LeagueClubRank>>;

/**
 * The places a League Standings team's club holds on Team Rankings, carried across to the League
 * Dashboard's "Our team" card.
 *
 * League Standings cannot rank a club itself: a board is a fit of the whole year's pool, which is
 * a worker's job on the Team Rankings side and seconds of it. So each time a board is up there,
 * the places of the clubs its league seasons' teams are linked to are written here, a handful of
 * numbers a season, and the card reads them with the day they were read. Per browser, as the pick
 * of a team is (`readOurTeam`), and gone with a reset, since it is only ever a copy.
 */
const KEY = "lf_league_club_ranks_v1";

const safeGet = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const coerceRank = (raw: unknown): LeagueClubRank | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Partial<LeagueClubRank>;
  if (typeof row.clubId !== "string" || typeof row.board !== "string") return null;
  if (!isCount(row.rank) || !isCount(row.of) || typeof row.at !== "string") return null;
  const movement =
    row.movement === "new" || (typeof row.movement === "number" && Number.isFinite(row.movement))
      ? row.movement
      : undefined;
  return {
    clubId: row.clubId,
    board: row.board,
    rank: row.rank,
    of: row.of,
    ...(typeof row.state === "string" && isCount(row.stateRank) && isCount(row.stateOf)
      ? { state: row.state, stateRank: row.stateRank, stateOf: row.stateOf }
      : {}),
    ...(movement === undefined ? {} : { movement }),
    at: row.at,
  };
};

/** Whatever was stored, as ranks; anything unreadable is left out rather than guessed at. */
export const readLeagueClubRanks = (): LeagueClubRanks => {
  try {
    const parsed: unknown = JSON.parse(safeGet() ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LeagueClubRanks = {};
    Object.entries(parsed).forEach(([seasonId, teams]) => {
      if (!teams || typeof teams !== "object" || Array.isArray(teams)) return;
      const kept: Record<string, LeagueClubRank> = {};
      Object.entries(teams as Record<string, unknown>).forEach(([teamId, rank]) => {
        const read = coerceRank(rank);
        if (read) kept[teamId] = read;
      });
      if (Object.keys(kept).length > 0) out[seasonId] = kept;
    });
    return out;
  } catch {
    return {};
  }
};

/** Where one league team's club stood when its board was last up, if it ever was. */
export const leagueClubRankFor = (
  seasonId: string,
  leagueTeamId: string
): LeagueClubRank | undefined => readLeagueClubRanks()[seasonId]?.[leagueTeamId];

/**
 * Replaces one season's places with the ones just read. Every team of it at once, so a team whose
 * club has left the board takes its old place with it rather than keeping a stale one.
 */
export const writeLeagueClubRanks = (
  seasonId: string,
  ranks: Record<string, LeagueClubRank>
): boolean => {
  const all = readLeagueClubRanks();
  if (Object.keys(ranks).length === 0) delete all[seasonId];
  else all[seasonId] = ranks;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
};

/**
 * The places of a season's league teams on the board just built, read the way the "My team" card
 * reads its own (`myTeamGlance`): the national place off the whole table, the state's off the clubs
 * of that state on it, and the week's movement off last week's board.
 */
export const leagueClubRanksFrom = (
  rankings: readonly ScoutRankingRow[],
  clubByLeagueTeam: ReadonlyMap<string, string>,
  stateOf: (teamId: string) => string | undefined,
  lastWeek: Readonly<Record<string, number>> | null,
  board: string,
  at: string
): Record<string, LeagueClubRank> => {
  const out: Record<string, LeagueClubRank> = {};
  clubByLeagueTeam.forEach((clubId, leagueTeamId) => {
    const glance = myTeamGlance(rankings, clubId, stateOf, [], lastWeek);
    if (!glance) return;
    out[leagueTeamId] = {
      clubId,
      board,
      rank: glance.nationalRank,
      of: glance.nationalOf,
      ...(glance.state !== undefined &&
      glance.stateRank !== undefined &&
      glance.stateOf !== undefined
        ? { state: glance.state, stateRank: glance.stateRank, stateOf: glance.stateOf }
        : {}),
      ...(glance.movement === undefined ? {} : { movement: glance.movement }),
      at,
    };
  });
  return out;
};
