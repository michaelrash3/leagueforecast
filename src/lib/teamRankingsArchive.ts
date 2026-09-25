import {
  ageGroupLevel,
  ageGroupYear,
  inSegment,
  buildTeamRankings,
  filedTeamIds,
  SEASON_SEGMENT_ORDER,
  segmentLabel,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type SeasonSegment,
} from "./teamRankings";
import type { ScoutRankingRow } from "./teamRankings";

/**
 * A finished season, kept as its table rather than its games.
 *
 * A squad year that is over is three hundred and seventy-five thousand games and a hundred and
 * twelve thousand teams, and every one of them sits in the tab for as long as the pool holds it —
 * which is most of why a nationwide pool runs a browser out of memory. But nobody asks a finished
 * season for its game rows. They ask it who was good. So what is kept is the table the app showed:
 * rank, rating, record, strength of schedule, one row a team, and the games are let go.
 *
 * It is about a twentieth of the size, and the difference is the whole difference between carrying
 * the previous season and not being able to.
 *
 * The league's own games are archived with the rest of the season, not held back from it. They are
 * in the frozen table as records and ratings like any other game, and once the season's pages are
 * gone nothing derives them into a live ranking again. League Standings still holds its seasons —
 * this is the rankings side of the app, and it does not reach across.
 *
 * What it costs, and it is a real cost: an archived table cannot be recomputed. Change how ratings
 * are worked out and every live page changes with it while the archives keep the numbers they were
 * archived with. That is what "final" means, and it is the reason the card says which version of
 * the model stands behind each one — a table from a different model is not wrong, but it is not
 * comparable either.
 */

/**
 * Bumped when a row gains or loses a field, so a reader knows what it is looking at.
 *
 * 2: an archive is one half of a baseball year rather than the whole of it. A version-1 archive is
 * a whole-year table and reads fine, but it is not comparable with a half's.
 */
export const ARCHIVE_VERSION = 2;

/** One team's finishing position, and enough beside it to read the table without the games. */
export type ArchivedRankingRow = {
  rank: number;
  teamName: string;
  rating: number;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  strengthOfSchedule: number;
  sosRank: number;
  /** Where the club is, when the pull knew — the state filter in the live table reads the same. */
  state?: string;
  ageLevel?: number;
  crossAgeGames: number;
};

export type ArchivedSeason = {
  version: number;
  /** The archive's own id, minted from its name. Never a page id — see `archiveIdOf`. */
  id: string;
  /** What the page was called, kept as text: "9U 2026". */
  name: string;
  ageLevel?: number;
  year?: number;
  /** Which half of the year this is. Absent on a version-1 archive, which was the whole year. */
  segment?: SeasonSegment;
  archivedAt: string;
  /** What stood behind the table, so a reader can weigh it. */
  fromGames: number;
  fromTeams: number;
  rows: ArchivedRankingRow[];
};

/**
 * What the card lists without loading anything.
 *
 * The rows are the bulk — a hundred thousand of them a season — so the index carries only what a
 * list needs and each season's rows are fetched when somebody asks to see them. Loading every
 * archive at startup would put back the memory the archiving was for.
 */
export type ArchiveEntry = {
  id: string;
  name: string;
  ageLevel?: number;
  year?: number;
  segment?: SeasonSegment;
  archivedAt: string;
  fromGames: number;
  fromTeams: number;
  teams: number;
};

export const archiveEntryOf = (season: ArchivedSeason): ArchiveEntry => ({
  id: season.id,
  name: season.name,
  ...(season.ageLevel === undefined ? {} : { ageLevel: season.ageLevel }),
  ...(season.year === undefined ? {} : { year: season.year }),
  ...(season.segment === undefined ? {} : { segment: season.segment }),
  archivedAt: season.archivedAt,
  fromGames: season.fromGames,
  fromTeams: season.fromTeams,
  teams: season.rows.length,
});

/**
 * An archive's own id, minted from what it was called rather than taken from the page it came from.
 *
 * Deliberately not the age group's id, and this is the whole point of a snapshot. Nothing in an
 * archive may be linkable back to live data, because the live data is what is being deleted and it
 * can come back: League Standings keeps its own seasons whatever the rankings side does, so a page
 * for an archived year can be created again tomorrow and its fixtures derived all over. If the
 * archive carried `ag_9_2026` as its id, that new page would either collide with it or be joined
 * to it — a frozen table quietly re-attached to games that are no longer the ones it was built
 * from. Carrying the name as text instead means the respawn simply happens, beside the archive,
 * and destroys nothing.
 *
 * The rows hold no team ids for the same reason. An archived row is a name and some numbers; it
 * cannot be resolved into a club, and nothing should try.
 */
export const archiveIdOf = (name: string, year: number | undefined): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `arc_${year ?? "x"}_${slug || "season"}`;
};

/**
 * Builds the table for a page and keeps it, using the app's own ranking function.
 *
 * The same call the Rankings tab makes, so what is archived is what was on screen rather than a
 * second opinion about it. `state` is carried across from the team because the row does not hold
 * it and the live table's state filter reads it from there.
 */
export const archiveSeason = (
  group: AgeGroup,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  archivedAt: string,
  /** One half of the year. Left out only for a page with no year to be half of. */
  segment?: SeasonSegment
): ArchivedSeason => {
  const rows = buildTeamRankings(group.id, teams, games, group.myTeamId, ageGroups, segment);
  const stateOf = new Map(teams.map((team) => [team.id, team.state]));
  const year = ageGroupYear(group);
  const level = ageGroupLevel(group);
  /*
   * "9U · Spring 2026", not "9U 2026 · Spring 2026". The page's name already carries the baseball
   * year and the half's label carries the calendar one, so spelling both would read as two dates.
   * A page with no readable level keeps its own name, which is all there is to call it.
   */
  const name =
    segment && year !== undefined && level !== undefined
      ? `${level}U · ${segmentLabel(year, segment)}`
      : group.name;
  const onPage = games.filter((game) => game.ageGroupId === group.id);
  return {
    version: ARCHIVE_VERSION,
    id: archiveIdOf(name, year),
    name,
    ...(level === undefined ? {} : { ageLevel: level }),
    ...(year === undefined ? {} : { year }),
    ...(segment === undefined ? {} : { segment }),
    archivedAt,
    /*
     * The games behind *this* table. A half's rows stand on that half's games, so counting the
     * page's whole year here would tell a reader the spring table was built from twice what it was.
     */
    fromGames: onPage.filter((game) => inSegment(game.date, year, segment)).length,
    fromTeams: new Set(
      onPage
        .filter((game) => inSegment(game.date, year, segment))
        .flatMap((game) => [game.teamAId, game.teamBId])
    ).size,
    rows: rows.map((row) => keepRow(row, stateOf.get(row.teamId))),
  };
};

const keepRow = (row: ScoutRankingRow, state: string | undefined): ArchivedRankingRow => ({
  rank: row.rank,
  teamName: row.teamName,
  rating: row.rating,
  record: row.record,
  wins: row.wins,
  losses: row.losses,
  ties: row.ties,
  games: row.games,
  strengthOfSchedule: row.strengthOfSchedule,
  sosRank: row.sosRank,
  ...(state ? { state } : {}),
  ...(row.ageLevel === undefined ? {} : { ageLevel: row.ageLevel }),
  crossAgeGames: row.crossAgeGames,
});

/** The pool a table was built from: everything the tab had in hand, league fixtures included. */
export type ShownPool = { teams: ScoutTeam[]; games: ScoutGame[] };

/** The pool that is written to disk, and so the only one an archive can take anything from. */
export type StoredPool = { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] };

/**
 * Freezes a whole squad year's tables and takes the year out of the live pool.
 *
 * A squad year, not a page, because a page is not fitted on its own: every group sharing a season
 * year is rated together, so a 9U table is computed partly from the 8U teams that played down
 * against it. Archive one page of a year and the ones left behind lose games their ratings stood
 * on — the tables would quietly change, which is the one thing an archive must not cause.
 *
 * Two pools, and the difference between them is the whole reason this takes two arguments. The
 * table on screen is built from the merged pool: the pulled games plus the league's own fixtures,
 * derived fresh from League Standings on every render and never stored. The pool on disk holds only
 * the pulled half. Hand this one pool and it is wrong either way — the merged one and the delete
 * writes a permanent second copy of every league fixture, the stored one and the frozen table
 * silently omits every league game and every league-only club's record while claiming to be what
 * was on screen. So: `shown` decides what the table says, `stored` decides what survives. The
 * league's games are archived with the rest of the season, as rows in the table and nowhere else,
 * and because the page goes with them they stop being derived into any live rating.
 *
 * League Standings keeps its own seasons; this does not reach into them. What it does is sever the
 * link — the archived pages carried `seasonIds`, and those ids come back in `leagueSeasonIds` so
 * the caller can say which league seasons will no longer feed a ranking.
 *
 * Some pages have no table to keep. 8U is below `MIN_RANKED_AGE_LEVEL` on purpose, so its games
 * exist only to inform the ages above it, and on a real pool that is a hundred and seventy-five
 * thousand of them. They go without a row, and the caller is told so it can say as much: they were
 * never a table, and the tables they did inform are frozen by the same call.
 */
export const archiveSquadYear = (
  year: number,
  shown: ShownPool,
  stored: StoredPool,
  archivedAt: string
): {
  seasons: ArchivedSeason[];
  state: StoredPool;
  /** Stored games the delete takes. League fixtures are not among them — they were never stored. */
  droppedGames: number;
  /** Teams no remaining stored game mentions. */
  droppedTeams: number;
  /** The pages whose games went without a table of their own, and how many each held. */
  unranked: Array<{ name: string; games: number }>;
  /** Games that were only ever derived, now kept as table rows and nowhere else. */
  archivedLeagueGames: number;
  /** The league seasons the archived pages were attached to, which stop feeding rankings. */
  leagueSeasonIds: string[];
} => {
  /*
   * `ageGroupYear`, not `group.year`. The stored field can be absent on a page whose name says the
   * year anyway — "2027, 10U" — and everything that decides what is rated together reads it the
   * same way, through the parse. Comparing the raw field would leave such a page out of the
   * archive while `rankingPoolGroupIds` still counted it in the year's pool: the page would stay
   * behind and its ratings would change, which is the one thing the year-at-a-time rule exists to
   * prevent.
   */
  const ofYear = stored.ageGroups.filter((group) => ageGroupYear(group) === year);
  const seasons: ArchivedSeason[] = [];
  const unranked: Array<{ name: string; games: number }> = [];

  /*
   * Every table is built against the pool as it was, before anything is removed — so a page
   * archived second is frozen from the same games as the page archived first.
   */
  ofYear.forEach((group) => {
    /*
     * A table per half, because that is what the boards are. A single whole-year table would
     * freeze something nobody can see any more, and the two halves genuinely disagree: on the real
     * pool 9U 2026's autumn had 5,128 clubs and its spring 10,242, with different sides on top.
     */
    const halves = SEASON_SEGMENT_ORDER.map((segment) =>
      archiveSeason(group, shown.teams, shown.games, stored.ageGroups, archivedAt, segment)
    );
    halves.forEach((kept) => {
      if (kept.rows.length > 0) seasons.push(kept);
    });
    /*
     * Reported once per page, not once per half. A page below `MIN_RANKED_AGE_LEVEL` has no table
     * in either half, and saying so twice would read as twice the games going.
     */
    if (halves.every((kept) => kept.rows.length === 0)) {
      const held = shown.games.filter((game) => game.ageGroupId === group.id).length;
      if (held > 0) unranked.push({ name: group.name, games: held });
    }
  });

  const going = new Set(ofYear.map((group) => group.id));
  const remaining = stored.games.filter((game) => !going.has(game.ageGroupId));
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const wanted = new Set([
    ...remaining.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(remaining),
  ]);
  const keptTeams = stored.teams.filter((team) => wanted.has(team.id));

  // A frozen game the stored pool never held came from the league, so the table is now its record.
  const onDisk = new Set(stored.games.map((game) => game.id));
  const frozen = shown.games.filter((game) => going.has(game.ageGroupId));
  return {
    seasons,
    state: {
      ageGroups: stored.ageGroups.filter((group) => !going.has(group.id)),
      teams: keptTeams,
      games: remaining,
    },
    droppedGames: stored.games.length - remaining.length,
    droppedTeams: stored.teams.length - keptTeams.length,
    unranked,
    archivedLeagueGames: frozen.filter((game) => !onDisk.has(game.id)).length,
    leagueSeasonIds: [...new Set(ofYear.flatMap((group) => group.seasonIds))],
  };
};

/**
 * The same seasons with ids nothing else is using.
 *
 * An id is minted from a name, so freezing "9U 2026" a second time — a page re-created after an
 * archive, re-pulled and archived again — would mint the id the first archive already has. That
 * must not overwrite it: the two are different freezes of different games, and the older one is
 * the only record of the games it stood on. So a taken id gets a suffix and both are kept.
 *
 * Suffixed by count rather than by clock, because an archive is written once and read forever: an
 * id with a timestamp in it would be a different id every time the same call ran, which makes a
 * retry after a failed write into a second archive instead of the same one.
 */
export const withUniqueIds = (
  seasons: ArchivedSeason[],
  taken: Iterable<string>
): ArchivedSeason[] => {
  const used = new Set(taken);
  return seasons.map((season) => {
    if (!used.has(season.id)) {
      used.add(season.id);
      return season;
    }
    let at = 2;
    while (used.has(`${season.id}_${at}`)) at += 1;
    const id = `${season.id}_${at}`;
    used.add(id);
    return { ...season, id };
  });
};

/** The squad years a pool could freeze, newest first. A year with no page is not one. */
export const archivableYears = (ageGroups: AgeGroup[]): number[] =>
  [
    ...new Set(
      ageGroups.flatMap((group) => {
        const year = ageGroupYear(group);
        return year === undefined ? [] : [year];
      })
    ),
  ].sort((a, b) => b - a);

/**
 * The pool with a page's games gone, and the teams no remaining game mentions.
 *
 * A team is not owned by a page — it plays on whichever ones its games are filed under — so
 * dropping a season drops its games first and then only the teams nothing else needs. A club that
 * played in the archived year and is playing in the live one stays exactly where it was; it is in
 * the archive as a row and in the pool as a team, which is what makes an archive readable on its
 * own and a restore unnecessary.
 *
 * One page at a time, which is almost never what a caller wants: use `archiveSquadYear`, because
 * the pages of a year are rated together and removing one of them changes the others. This is kept
 * for the single-page case and for the tests that pin the team-keeping rule.
 */
export const withoutSeason = (
  groupId: string,
  state: { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[] }
): { ageGroups: AgeGroup[]; teams: ScoutTeam[]; games: ScoutGame[]; dropped: number } => {
  const games = state.games.filter((game) => game.ageGroupId !== groupId);
  const wanted = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter((team) => wanted.has(team.id));
  return {
    // The page goes with its games: a page exists exactly when something is filed on it.
    ageGroups: state.ageGroups.filter((group) => group.id !== groupId),
    teams,
    games,
    dropped: state.teams.length - teams.length,
  };
};

/** Reads an archive back, or null because this is not one. Null rather than a throw, as elsewhere. */
export const coerceArchivedSeason = (raw: unknown): ArchivedSeason | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (!Array.isArray(value.rows)) return null;
  const num = (at: unknown, fallback = 0) =>
    typeof at === "number" && Number.isFinite(at) ? at : fallback;
  const str = (at: unknown) => (typeof at === "string" ? at : undefined);
  return {
    version: num(value.version, ARCHIVE_VERSION),
    id: value.id,
    name: value.name,
    ...(typeof value.ageLevel === "number" ? { ageLevel: value.ageLevel } : {}),
    ...(typeof value.year === "number" ? { year: value.year } : {}),
    archivedAt: str(value.archivedAt) ?? "",
    fromGames: num(value.fromGames),
    fromTeams: num(value.fromTeams),
    rows: value.rows.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const entry = row as Record<string, unknown>;
      const teamName = str(entry.teamName);
      if (!teamName) return [];
      return [
        {
          rank: num(entry.rank),
          teamName,
          rating: num(entry.rating),
          record: str(entry.record) ?? "",
          wins: num(entry.wins),
          losses: num(entry.losses),
          ties: num(entry.ties),
          games: num(entry.games),
          strengthOfSchedule: num(entry.strengthOfSchedule),
          sosRank: num(entry.sosRank),
          ...(str(entry.state) ? { state: str(entry.state)! } : {}),
          ...(typeof entry.ageLevel === "number" ? { ageLevel: entry.ageLevel } : {}),
          crossAgeGames: num(entry.crossAgeGames),
        },
      ];
    }),
  };
};

/**
 * The states an archive has teams in, for the state board's picker.
 *
 * Read off the rows, not off the pool. The pool no longer holds these teams — that is the point of
 * an archive — so the row's own `state` is the only thing left that knows, which is why it is
 * copied in when the table is frozen.
 */
export const archiveStates = (season: ArchivedSeason): string[] =>
  [...new Set(season.rows.flatMap((row) => (row.state ? [row.state] : [])))].sort();

/**
 * One state's rows, renumbered by their place in that list, with the national place carried along.
 *
 * The same rule the live board follows: a state top ten is not the national table with gaps in it,
 * so `rank` is the position here and `nationalRank` is where the team finished overall. Passing no
 * state gives the national list back untouched, national ranks and all.
 */
export const archiveRowsInState = (
  season: ArchivedSeason,
  state: string
): Array<ArchivedRankingRow & { nationalRank: number }> => {
  const rows = state ? season.rows.filter((row) => (row.state ?? "") === state) : season.rows;
  return rows.map((row, index) => ({
    ...row,
    nationalRank: row.rank,
    rank: state ? index + 1 : row.rank,
  }));
};

/**
 * Rows whose name contains the search, case-insensitively.
 *
 * A name is all there is to search on: an archived row holds no team id, so there is nothing to
 * look a club up by and nothing to join it to. Finding a club in a finished season means typing
 * what it was called, which is also all anybody remembers.
 */
export const searchArchiveRows = (season: ArchivedSeason, query: string): ArchivedRankingRow[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return season.rows.filter((row) => row.teamName.toLowerCase().includes(needle));
};

/** Archives newest first, then by age level, which is the order a list of seasons reads in. */
export const sortArchiveEntries = (entries: ArchiveEntry[]): ArchiveEntry[] =>
  [...entries].sort(
    (a, b) =>
      (b.year ?? 0) - (a.year ?? 0) ||
      (a.ageLevel ?? 0) - (b.ageLevel ?? 0) ||
      a.name.localeCompare(b.name)
  );
