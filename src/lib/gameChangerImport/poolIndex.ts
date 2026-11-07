/**
 * The lookups an import and the tidy keep over the pool as they fold games into it
 * (`ImportIndex`): games by id and by fixture, teams by name and level, each schedule's rows, kept
 * up to date as the fold goes so that the work stays linear in the pool. Split out of
 * `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  type AgeGroup,
  ageGroupLevel,
  ageGroupYear,
  gcRowId,
  isOffClubId,
  type ScoutGame,
  type ScoutTeam,
  startMinuteOf,
  teamNameKey,
} from "../teamRankings";
import { mintedIds, type MintedIds, NO_RETIRED, type RetiredIds } from "../teamRankings/retiredIds";
import type { AnsweredLookup } from "./namesakes";
import type { GcImportState } from "./types";

/**
 * The lookups an import does, precomputed.
 *
 * Every one of them — is this game already here, is this opponent a team I know, has this club
 * been pulled before — was a scan of the whole pool, once per incoming game. That is quadratic,
 * and measurably so: a thousand teams took thirty-five seconds where two hundred and fifty took
 * two. Keyed instead, and kept up to date as the fold goes, the same work is linear.
 *
 * The keys mirror exactly what the functions they stand in for compare on, and the game bucket is
 * still handed to `matchExistingGame` rather than matched here, so this changes how fast a match
 * is found and never what counts as one.
 */
export type ImportIndex = {
  gamesById: Map<string, ScoutGame>;
  /**
   * The game each folded row went into, by the row's own id (`ScoutGame.alsoRows`), so a re-pull
   * of the schedule it came off finds its game rather than filing the row a second time.
   */
  foldedInto: Map<string, string>;
  /**
   * The games holding a folded row of each schedule, or the schedule on record with no row kept
   * (`alsoFrom` alone), so a pull can clear the ones it dropped.
   */
  recordsBySchedule: Map<string, Set<string>>;
  /** The games standing on a row of each schedule, so a pull can tell the ones it no longer lists. */
  gamesBySchedule: Map<string, Set<string>>;
  /** Where each game sits in the working array, so an update is an assignment rather than a map. */
  gamePos: Map<string, number>;
  /** Where each team sits, for the same reason. */
  teamPos: Map<string, number>;
  /**
   * Every scout id in use, kept as the fold goes so minting a new one does not rescan the roster,
   * and every one the stored pool let go of (`GcImportOptions.retired`), which none is minted as.
   */
  usedTeamIds: MintedIds;
  /** Games by pool, pair and date — the three things a match must agree on. */
  gamesByMatch: Map<string, ScoutGame[]>;
  teamsById: Map<string, ScoutTeam>;
  /** The team carrying a GameChanger id. One id lives on one team. */
  teamByGcId: Map<string, ScoutTeam>;
  /** Team ids with a game filed on a page, for the "on this page" that name matching needs. */
  teamIdsByGroup: Map<string, Set<string>>;
  /**
   * Who each team has played. A name on its own cannot say which of the country's many clubs of
   * that name this is; having met, or having a club in common, can.
   */
  opponentsByTeam: Map<string, Set<string>>;
  /** A team's games on one day, for asking whether an arriving game is one it already has. */
  gamesByTeamDate: Map<string, ScoutGame[]>;
  /**
   * The same, keyed by page *and* name. Name matching asks "is there a team called this on this
   * page?", and walking the page's whole roster to answer it is a scan per game — which for a pool
   * where everyone is on one page is the whole pool, per game.
   */
  teamIdsByGroupName: Map<string, string[]>;
  /**
   * The same, without the level. Only the fixture check searches this: it is looking for a club
   * whose schedule holds this very game, and a game is evidence enough to cross a level — which
   * is the whole of how a club that played up is recognised.
   */
  teamIdsByPoolName: Map<string, string[]>;
  /**
   * Every age level each team has been seen at, across the pages it appears on.
   *
   * The level a club plays is a fact about the club, and a stand-in's level is a fact about the
   * schedules that named it — so this is what says a club and a stand-in of the same name are not
   * the same squad at all. Kept beside the name lookups rather than derived on demand, because the
   * question is asked once per pulled schedule and the answer is a scan of the whole pool.
   */
  levelsByTeam: Map<string, Set<number>>;
  /**
   * The rows a pulled club filed against a stand-in, by id, where the other end of the game can
   * find them: by the day and the result from the club's seat, and by the start time. A schedule
   * that names no age asks these which pulled clubs it played (`ageFromFixtures`). Ids rather than
   * rows, because a row is updated in place and the lookup must read what it says now.
   */
  halvesByResult: Map<string, string[]>;
  halvesByTime: Map<string, string[]>;
  /**
   * What each page is, by id, behind the two lookups below.
   *
   * Maps rather than closures because the fold creates pages as it goes and both lookups have to
   * learn about one the moment it exists. A page whose level is still unknown files its games
   * under a name key that says so, and then the club that page belongs to is not found when its
   * own schedule arrives — which is a duplicate of every team in the run.
   */
  poolKeys: Map<string, string>;
  levels: Map<string, number>;
  years: Map<string, number>;
  /** Pool key of an age group: its season year, or the group itself when it has none. */
  poolKeyOf: (ageGroupId: string) => string;
  /** Age level of an age group: the level half of a name match, and a side's fallback level. */
  levelOf: (ageGroupId: string) => number | undefined;
  /** Squad year of an age group, which a graduating class in a name is read against. */
  yearOf: (ageGroupId: string) => number | undefined;
  /** The owner's answers (`answeredNamesakes`), made the first time a name asks them. */
  answered?: AnsweredLookup;
};

const pairKeyOf = (game: ScoutGame): string =>
  [game.teamAId, game.teamBId].slice().sort().join("|");

export const matchKeyOf = (game: ScoutGame, poolKeyOf: (ageGroupId: string) => string): string =>
  `${poolKeyOf(game.ageGroupId)}\u0000${pairKeyOf(game)}\u0000${game.date ?? ""}`;

export const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
};

/**
 * Records what a page is, for both lookups at once — the pool it rates in and the level it is at.
 * Called for the pages the pool already has and again for every page the fold creates.
 */
export const noteAgeGroup = (index: ImportIndex, group: AgeGroup): void => {
  // Mirrors `rankingPoolGroupIds`: groups sharing a season year are one pool, and a group with no
  // year is a pool of one.
  const year = ageGroupYear(group);
  index.poolKeys.set(group.id, year === undefined ? `g:${group.id}` : `y:${year}`);
  if (year !== undefined) index.years.set(group.id, year);
  const level = ageGroupLevel(group);
  if (level !== undefined) index.levels.set(group.id, level);
};

/** The pool key rule, for a pass that runs outside the index: a season year is one pool. */
export const buildPoolKeyOf = (ageGroups: AgeGroup[]): ((ageGroupId: string) => string) => {
  const keys = new Map<string, string>();
  ageGroups.forEach((group) => {
    const year = ageGroupYear(group);
    keys.set(group.id, year === undefined ? `g:${group.id}` : `y:${year}`);
  });
  return (ageGroupId: string) => keys.get(ageGroupId) ?? `g:${ageGroupId}`;
};

export const buildIndex = (state: GcImportState, retired: RetiredIds = NO_RETIRED): ImportIndex => {
  const poolKeys = new Map<string, string>();
  const levels = new Map<string, number>();
  const years = new Map<string, number>();
  const index: ImportIndex = {
    poolKeys,
    levels,
    years,
    poolKeyOf: (ageGroupId: string) => poolKeys.get(ageGroupId) ?? `g:${ageGroupId}`,
    levelOf: (ageGroupId: string) => levels.get(ageGroupId),
    yearOf: (ageGroupId: string) => years.get(ageGroupId),
    gamesById: new Map(),
    foldedInto: new Map(),
    recordsBySchedule: new Map(),
    gamesBySchedule: new Map(),
    gamePos: new Map(),
    teamPos: new Map(),
    usedTeamIds: mintedIds([], retired),
    gamesByMatch: new Map(),
    teamsById: new Map(),
    teamByGcId: new Map(),
    teamIdsByGroup: new Map(),
    teamIdsByGroupName: new Map(),
    teamIdsByPoolName: new Map(),
    levelsByTeam: new Map(),
    opponentsByTeam: new Map(),
    gamesByTeamDate: new Map(),
    halvesByResult: new Map(),
    halvesByTime: new Map(),
  };
  // Before any game is indexed: a game's name keys are built from its page's level.
  state.ageGroups.forEach((group) => noteAgeGroup(index, group));
  state.teams.forEach((team, position) => {
    index.teamPos.set(team.id, position);
    index.usedTeamIds.add(team.id);
    indexTeam(index, team);
  });
  state.games.forEach((game, position) => {
    index.gamePos.set(game.id, position);
    indexGame(index, game);
  });
  return index;
};

const indexTeam = (index: ImportIndex, team: ScoutTeam) => {
  index.teamsById.set(team.id, team);
  (team.gcTeams ?? []).forEach((link) => index.teamByGcId.set(link.teamId, team));
};

/**
 * The scope a name is allowed to match in: one rating pool, at one age level.
 *
 * The pool rather than the page, because the two sides of a cross-age game are filed under
 * different pages — a 9U beating an 11U puts the 11U opponent on the 9U page, and pulling that 11U
 * team afterwards looked for it on the 11U page, found nothing, and made a second one. The level
 * still has to agree, so a club's own 9U and 11U squads stay two teams, which is what scoping by
 * page was really protecting.
 */
/**
 * How far from its own age a squad can really be found playing.
 *
 * Teams play up and down a level all the time — a fall tournament pairs whoever entered — so a
 * level that disagrees is not on its own a sign that a row is on the wrong club. A level that
 * disagrees *by a lot* is. Measured over this app's own nationwide pool of 203,538 games:
 * 99.845% have the two sides within two levels of each other, and of the 318,353 sides resting on
 * a club pulled by id, 99.698% are within two of the level that club's own GameChanger listing
 * gives. Two is therefore generous; six — a 9U club holding a 15U result — is not a squad playing
 * up, it is a different squad that happens to share a name.
 */
export const PLAYS_UP_TO = 2;

/** Whether a club seen at these levels could plausibly have played a game at `level`. */
export const levelFits = (
  seen: ReadonlySet<number> | undefined,
  level: number | undefined
): boolean => {
  // Nothing known either way is not a disagreement; only a level that is known and far is.
  if (level === undefined || seen === undefined || seen.size === 0) return true;
  for (const at of seen) {
    if (Math.abs(at - level) <= PLAYS_UP_TO) return true;
  }
  return false;
};

export const nameSlotKey = (poolKey: string, nameKey: string, level: number | undefined): string =>
  `${poolKey}\u0000${level ?? "?"}\u0000${nameKey}`;

export const noteInPool = (
  index: ImportIndex,
  ageGroupId: string,
  teamId: string,
  level: number | undefined
) => {
  const team = index.teamsById.get(teamId);
  if (!team) return;
  if (level !== undefined) {
    const seen = index.levelsByTeam.get(teamId);
    if (seen) seen.add(level);
    else index.levelsByTeam.set(teamId, new Set([level]));
  }
  // A club made for a league team said not to be in Team Rankings is that team's alone, and no
  // name a schedule writes is filed onto it (`offClubIdFor`), whatever has been filed against it.
  if (isOffClubId(teamId)) return;

  const pool = index.poolKeyOf(ageGroupId);
  const name = teamNameKey(team.name);
  const key = nameSlotKey(pool, name, level);
  const bucket = index.teamIdsByGroupName.get(key);
  if (!bucket) index.teamIdsByGroupName.set(key, [teamId]);
  else if (!bucket.includes(teamId)) bucket.push(teamId);

  const anyLevel = `${pool}\u0000${name}`;
  const wide = index.teamIdsByPoolName.get(anyLevel);
  if (!wide) index.teamIdsByPoolName.set(anyLevel, [teamId]);
  else if (!wide.includes(teamId)) wide.push(teamId);
};

/** Records that two teams have met, both ways round. */
export const noteOpponent = (index: ImportIndex, teamId: string, opponentId: string) => {
  const met = index.opponentsByTeam.get(teamId);
  if (met) met.add(opponentId);
  else index.opponentsByTeam.set(teamId, new Set([opponentId]));
};

export const halfResultKey = (pool: string, date: string, club: number, standIn: number): string =>
  `${pool}\u0000${date}\u0000${club}-${standIn}`;

/** Keyed by the minute rather than the text, so one start spelt or rounded two ways is one key. */
export const halfTimeKey = (pool: string, minute: number): string => `${pool}\u0000${minute}`;

/** Whether a team is somebody's written name and nothing more: no GameChanger id behind it. */
export const isStandIn = (team: ScoutTeam | undefined): boolean =>
  Boolean(team?.nameOnly) && !team?.gcTeams?.length;

/**
 * Files a row one side filed against a stand-in, under the keys `ageFromFixtures` looks it up by.
 * Filed again when a row is updated, since a result posted later changes the first key; the
 * lookup reads each row as it now stands and passes over one that no longer fits the key.
 */
export const indexHalf = (index: ImportIndex, game: ScoutGame): void => {
  if (!game.date || !game.source) return;
  const standInIsA = isStandIn(index.teamsById.get(game.teamAId));
  if (standInIsA === isStandIn(index.teamsById.get(game.teamBId))) return;
  const pool = index.poolKeyOf(game.ageGroupId);
  const club = standInIsA ? game.teamBScore : game.teamAScore;
  const standIn = standInIsA ? game.teamAScore : game.teamBScore;
  if (club !== undefined && standIn !== undefined) {
    push(index.halvesByResult, halfResultKey(pool, game.date, club, standIn), game.id);
  }
  const minute = startMinuteOf(game.startTs);
  if (minute !== undefined) push(index.halvesByTime, halfTimeKey(pool, minute), game.id);
};

/**
 * Records where each row folded into `game` went, and the row it stands on where that is not the
 * row its id was made from (a game whose first row was deleted and entered again).
 */
export const indexFolded = (index: ImportIndex, game: ScoutGame): void => {
  if (game.source) {
    const own = gcRowId(game.source.teamId, game.source.gameId);
    if (own !== game.id) index.foldedInto.set(own, game.id);
    const standing = index.gamesBySchedule.get(game.source.teamId);
    if (standing) standing.add(game.id);
    else index.gamesBySchedule.set(game.source.teamId, new Set([game.id]));
  }
  const holds = (schedule: string) => {
    const holders = index.recordsBySchedule.get(schedule);
    if (holders) holders.add(game.id);
    else index.recordsBySchedule.set(schedule, new Set([game.id]));
  };
  (game.alsoRows ?? []).forEach((row) => {
    index.foldedInto.set(gcRowId(row.teamId, row.gameId), game.id);
    holds(row.teamId);
  });
  game.alsoFrom?.forEach(holds);
};

const indexGame = (index: ImportIndex, game: ScoutGame) => {
  index.gamesById.set(game.id, game);
  indexFolded(index, game);
  indexHalf(index, game);
  push(index.gamesByMatch, matchKeyOf(game, index.poolKeyOf), game);
  noteOpponent(index, game.teamAId, game.teamBId);
  noteOpponent(index, game.teamBId, game.teamAId);
  if (game.date) {
    push(index.gamesByTeamDate, `${game.teamAId}\u0000${game.date}`, game);
    push(index.gamesByTeamDate, `${game.teamBId}\u0000${game.date}`, game);
  }
  notePlaces(index, game);
};

/** The page each side of a game is on, and the level it played at there. */
export const notePlaces = (index: ImportIndex, game: ScoutGame) => {
  const onPage = index.teamIdsByGroup.get(game.ageGroupId) ?? new Set<string>();
  onPage.add(game.teamAId);
  onPage.add(game.teamBId);
  index.teamIdsByGroup.set(game.ageGroupId, onPage);
  // A side's level is what the game recorded for it, falling back to the page it is filed under.
  const pageLevel = index.levelOf(game.ageGroupId);
  noteInPool(index, game.ageGroupId, game.teamAId, game.ageLevelA ?? pageLevel);
  noteInPool(index, game.ageGroupId, game.teamBId, game.ageLevelB ?? pageLevel);
};

/** Whether a game written over another moved page, or either side's recorded level. */
export const movedPlace = (previous: ScoutGame, next: ScoutGame): boolean =>
  previous.ageGroupId !== next.ageGroupId ||
  previous.ageLevelA !== next.ageLevelA ||
  previous.ageLevelB !== next.ageLevelB;

/**
 * The levels some teams are filed at, and the name slots they are found under, read again from the
 * games that still name them. `notePlaces` only adds, which is right for a game that arrives; a
 * club whose rows left a guessed age took the guess's level along as well as its new one, and read
 * as filed at two ages it was no evidence of either (`pooledOpponentLevels`) for the rest of the
 * run, where a run starting from the same pool reads it at one (Codex on #438). One pass over the
 * games for all of them; a slot is dropped only where no game names the team at that level now.
 */
export const restatePlaces = (
  index: ImportIndex,
  games: readonly ScoutGame[],
  teamIds: ReadonlySet<string>
) => {
  if (teamIds.size === 0) return;
  const levels = new Map<string, Set<number>>();
  const slots = new Map<string, Set<string>>();
  const pools = new Map<string, Set<string>>();
  const note = (teamId: string, level: number | undefined, ageGroupId: string) => {
    const team = index.teamsById.get(teamId);
    if (!team) return;
    if (level !== undefined) levels.set(teamId, (levels.get(teamId) ?? new Set()).add(level));
    const pool = index.poolKeyOf(ageGroupId);
    pools.set(teamId, (pools.get(teamId) ?? new Set()).add(pool));
    const slot = nameSlotKey(pool, teamNameKey(team.name), level);
    slots.set(teamId, (slots.get(teamId) ?? new Set()).add(slot));
  };
  games.forEach((game) => {
    const onA = teamIds.has(game.teamAId);
    const onB = teamIds.has(game.teamBId);
    if (!onA && !onB) return;
    const pageLevel = index.levelOf(game.ageGroupId);
    if (onA) note(game.teamAId, game.ageLevelA ?? pageLevel, game.ageGroupId);
    if (onB) note(game.teamBId, game.ageLevelB ?? pageLevel, game.ageGroupId);
  });
  teamIds.forEach((teamId) => {
    const team = index.teamsById.get(teamId);
    if (!team) return;
    const was = index.levelsByTeam.get(teamId) ?? new Set<number>();
    const now = levels.get(teamId);
    if (now) index.levelsByTeam.set(teamId, now);
    else index.levelsByTeam.delete(teamId);
    const kept = slots.get(teamId) ?? new Set<string>();
    const name = teamNameKey(team.name);
    (pools.get(teamId) ?? new Set<string>()).forEach((pool) => {
      [...was, undefined].forEach((level) => {
        const slot = nameSlotKey(pool, name, level);
        if (kept.has(slot)) return;
        const bucket = index.teamIdsByGroupName.get(slot);
        const at = bucket?.indexOf(teamId) ?? -1;
        if (!bucket || at < 0) return;
        bucket.splice(at, 1);
        if (bucket.length === 0) index.teamIdsByGroupName.delete(slot);
      });
    });
  });
};

/** Appends a team to the working roster and records where it went. */
export const addTeam = (index: ImportIndex, teams: ScoutTeam[], team: ScoutTeam): void => {
  index.teamPos.set(team.id, teams.length);
  index.usedTeamIds.add(team.id);
  teams.push(team);
  indexTeam(index, team);
};

/** Replaces a team in place. Its id does not change, so nothing it is filed under moves. */
export const replaceTeam = (index: ImportIndex, teams: ScoutTeam[], team: ScoutTeam): void => {
  const position = index.teamPos.get(team.id);
  if (position === undefined) {
    addTeam(index, teams, team);
    return;
  }
  teams[position] = team;
  indexTeam(index, team);
};

/** Appends a game to the working list and records where it went. */
export const addGame = (index: ImportIndex, games: ScoutGame[], game: ScoutGame): void => {
  index.gamePos.set(game.id, games.length);
  games.push(game);
  indexGame(index, game);
};
