import { myTeamGlance } from "./myTeamGlance";
import { CLUB_RANKS_KEY } from "./preferences";
import type { Movement } from "./movement";
import { isRouteAgeLevel, isRouteYear, type RankingsRoute } from "./rankingsRoute";
import type { ScoutRankingRow, SeasonSegment } from "./teamRankings";
import { topShare } from "./standing";
import { readClub, type ClubLookup } from "./teamRankings/leagueBridge";

/**
 * The Team Rankings page a board was read off: its age level and squad year, and the half when the
 * page has halves. What League Standings' Scout button opens (`scoutRoute`), so the club is
 * reported on against the very board its place was read from.
 */
export type ClubRankPage = {
  ageLevel?: number;
  year?: number;
  segment?: SeasonSegment;
};

/** A page's level, year and half as a board's writer knows them, leaving out what it does not. */
export const clubRankPage = (
  ageLevel: number | undefined,
  year: number | undefined,
  segment: SeasonSegment | undefined
): ClubRankPage => ({
  ...(ageLevel === undefined ? {} : { ageLevel }),
  ...(year === undefined ? {} : { year }),
  ...(segment === undefined ? {} : { segment }),
});

/**
 * Where a League Standings team's club stands on its Team Rankings board, as that board last
 * stood: the national place, the place in its state, and how far it has moved in a week.
 */
export type LeagueClubRank = {
  clubId: string;
  /**
   * A GameChanger id the club carried on the page (`pageGcId`): its id here is the pool's own, and
   * a fold or Team Rankings started again can leave it naming another club, so the place is read by
   * this where League Standings holds the pool (`leagueClubRankFor`).
   */
  gc?: string;
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
} & ClubRankPage;

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
 * of a team is (`readOurTeam`), gone with its season as that is (`forgetSeasons`), and gone with a
 * reset, since it is only ever a copy.
 */
const KEY = CLUB_RANKS_KEY;

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
    ...(typeof row.gc === "string" && row.gc ? { gc: row.gc } : {}),
    board: row.board,
    rank: row.rank,
    of: row.of,
    ...(typeof row.state === "string" && isCount(row.stateRank) && isCount(row.stateOf)
      ? { state: row.state, stateRank: row.stateRank, stateOf: row.stateOf }
      : {}),
    ...(movement === undefined ? {} : { movement }),
    at: row.at,
    // Places written before the page was kept carry none, and Scout then opens whatever page
    // Team Rankings would have opened anyway.
    ...(isRouteAgeLevel(row.ageLevel) ? { ageLevel: row.ageLevel } : {}),
    ...(isRouteYear(row.year) ? { year: row.year } : {}),
    ...(row.segment === "fall" || row.segment === "spring" ? { segment: row.segment } : {}),
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

/** A club's place nationally as the standings say it under a team's name: "#12 of 3,947 nationally". */
export const nationalRankText = (rank: LeagueClubRank): string =>
  `#${rank.rank.toLocaleString("en-US")} of ${rank.of.toLocaleString("en-US")} nationally · top ${topShare(rank.rank, rank.of)}%`;

/**
 * How strong a league is, by where its teams' clubs stand on Team Rankings: how many have a place,
 * the median team's share of its national board (`topShare`), and, where most of them share a
 * state, how high in that state's clubs they stand on average. Null with fewer than two placed.
 *
 * Not a place among the state's leagues: nothing in the pool says which other leagues there are, a
 * league being what its season names, and the groups the fit finds by who played whom are not
 * leagues (the Longhorns' league of 8 was a group of 60 to the fit). Where its teams stand among
 * the state's clubs is what the boards can say.
 */
export type LeagueStrength = {
  ranked: number;
  of: number;
  medianTop: number;
  state?: { name: string; teams: number; averageTop: number };
};

// Rounded up as `topShare` rounds, past the last bits of a sum: (0.2 + 0.4) / 2 is 0.30000000000000004,
// which rounded up read the top 31%.
const percent = (share: number): number =>
  Math.min(100, Math.max(1, Math.ceil(100 * share - 1e-9)));

export const leagueStrength = (
  ranks: readonly (LeagueClubRank | undefined)[]
): LeagueStrength | null => {
  const placed = ranks.filter((rank): rank is LeagueClubRank => rank !== undefined);
  if (placed.length < 2) return null;
  const shares = placed.map((rank) => rank.rank / rank.of).sort((a, b) => a - b);
  const middle = Math.floor(shares.length / 2);
  const median =
    shares.length % 2 === 1 ? shares[middle]! : (shares[middle - 1]! + shares[middle]!) / 2;
  const inState = new Map<string, number[]>();
  for (const rank of placed) {
    if (!rank.state || rank.stateRank === undefined || rank.stateOf === undefined) continue;
    const list = inState.get(rank.state);
    const share = rank.stateRank / rank.stateOf;
    if (list) list.push(share);
    else inState.set(rank.state, [share]);
  }
  const [name, stateShares] = [...inState].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  const most = name !== undefined && stateShares && stateShares.length * 2 >= placed.length;
  return {
    ranked: placed.length,
    of: ranks.length,
    medianTop: percent(median),
    ...(most
      ? {
          state: {
            name,
            teams: stateShares.length,
            averageTop: percent(
              stateShares.reduce((sum, one) => sum + one, 0) / stateShares.length
            ),
          },
        }
      : {}),
  };
};

/**
 * Where League Standings' Scout button takes a team's club: Team Rankings' Scouting, on the page
 * its place was read off when that is known. The club itself rides beside the route
 * (`scoutRequest.ts`), since a link with a club in it would keep opening that club's report.
 */
export const scoutRoute = (rank: LeagueClubRank): RankingsRoute => ({
  mode: "rankings",
  ...(rank.ageLevel === undefined ? {} : { ageLevel: rank.ageLevel }),
  ...(rank.year === undefined ? {} : { year: rank.year }),
  ...(rank.segment === undefined ? {} : { segment: rank.segment }),
  section: "scouting",
});

/**
 * Where one league team's club stood when its board was last up, if it ever was, its club read by
 * the GameChanger id kept with it where the pool is at hand (`readClub`): followed where it moved,
 * so Scout opens the club the place was of, and none where its id is another club's now, as a club
 * that left the board has none. A place kept with no id, or read with no pool, is as it was kept.
 */
export const leagueClubRankFor = (
  seasonId: string,
  leagueTeamId: string,
  clubs: ClubLookup | null = null
): LeagueClubRank | undefined => {
  const rank = readLeagueClubRanks()[seasonId]?.[leagueTeamId];
  if (!rank?.gc || !clubs) return rank;
  const read = readClub({ id: rank.clubId, gc: rank.gc }, clubs);
  if ("moved" in read) return undefined;
  return read.id === rank.clubId ? rank : { ...rank, clubId: read.id };
};

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
  at: string,
  page: ClubRankPage = {},
  /** The GameChanger id each club carries on the page, where the writer holds the clubs. */
  gcOf: (clubId: string) => string | undefined = () => undefined
): Record<string, LeagueClubRank> => {
  const out: Record<string, LeagueClubRank> = {};
  clubByLeagueTeam.forEach((clubId, leagueTeamId) => {
    const glance = myTeamGlance(rankings, clubId, stateOf, [], lastWeek);
    if (!glance) return;
    const gc = gcOf(clubId);
    out[leagueTeamId] = {
      clubId,
      ...(gc ? { gc } : {}),
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
      ...page,
    };
  });
  return out;
};
