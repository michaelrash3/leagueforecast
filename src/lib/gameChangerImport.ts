/**
 * Folding a pulled GameChanger schedule into the Team Rankings pool.
 *
 * Everything here is pure: it takes the pool as it stands and a schedule, and returns the pool as
 * it would stand plus a report of what happened to that team. Nothing is saved, so the panel can
 * pull first, show the report, and only then write — and a re-pull of the same schedule is a
 * no-op rather than a second copy of every game.
 *
 * The identity rules are the whole of the difficulty, and they are deliberately asymmetric:
 *
 * - **A team pulled by id is that id.** GameChanger mints a new team id every season, so a club's
 *   Fall and Spring squads arrive as two ids. They are two teams here until somebody says
 *   otherwise — see `proposeSeasonPairings`, which suggests the pairing and waits. Folding them
 *   together automatically would be guessing, and the country has a great many Yankees.
 * - **An opponent is a name and a picture.** GameChanger never gives an opponent's team id, so the
 *   avatar is the only stable thing that survives the trip. A matching avatar is the same club. A
 *   matching name is only the same club within one age level and season year, because "Yankees" on
 *   a 9U schedule in Kentucky and "Yankees" on an 11U schedule in California are not related.
 */

import {
  ageFitsBand,
  ageFromGradYearInName,
  ageLevelFromLooseName,
  ageLevelFromName,
  ageLevelOf,
  ageSpanFromName,
  formatGcSeason,
  gcSeasonIsCurrent,
  isNotBaseball,
  isAdultAgeLabel,
  isSchoolAgeLabel,
  isSchoolName,
  MIN_HIGH_SCHOOL_AGE,
  squadYearOfGcTeam,
  type GcGame,
  type GcTeamProfile,
  type GcTeamSchedule,
} from "./gameChangerApi";
import { notATeamWord, type NotATeamWord } from "./teamNameRules";
import {
  ageGroupLevel,
  ageGroupYear,
  createAgeGroupId,
  isOffClubId,
  isPlaceholderName,
  namesNobody,
  MIN_AGE_LEVEL,
  buildScoutTeam,
  cleanTeamName,
  formatAgeGroupName,
  gcSeasonLabel,
  isRankedAgeLevel,
  collapseSameGames,
  dayApartStrength,
  inSquadYear,
  matchExistingGame,
  MAX_AGE_LEVEL,
  nameFitter,
  nameFitWords,
  sameGameEvidence,
  withNote,
  sameStart,
  withSchedulesOf,
  withSideBReport,
  CLOSE_DISPUTE_RUNS,
  startsWithinTheHour,
  claimInto,
  filedRowOf,
  filedTeamIds,
  withFiledRepointed,
  releaseClaim,
  isHeldAsOwn,
  isJoinedClaim,
  ownPageFor,
  unjoinedRow,
  type FoldedRow,
  scoreSeenBy,
  mayTakeRow,
  gcRowId,
  minutesApart,
  startMinuteOf,
  squadNameKey,
  normalizeState,
  squadYearForGcSeason,
  standUpWithdrawn,
  teamNameKey,
  nameFitsWithin,
  withFiledMark,
  type AgeGroup,
  type GcAgeSource,
  type GcTeamLink,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { buildStaffIndex, likelySameSquad, sharedStaff } from "./gcStaff";
import { isKeptApart, type KeptApart } from "./keptApart";
import { listedByOwn, NO_REFUSALS, refusesName, type NotThisTeam } from "./notThisTeam";
import {
  isDeletedClub,
  isDeletedGame,
  isInventedSchedule,
  type DeletedClubs,
  type DeletedGames,
} from "./deletedGames";
import { isTooYoungClub, type TooYoungClubs } from "./tooYoungClubs";
import { agelessEvidence, type AgelessEvidence } from "./agelessEvidence";
import { todayIsoDay } from "./date";
import { borderingStates, farApart, inOneRegion } from "./stateBorders";
import { namedAgeFor, type NamedAges } from "./namedAges";
import { GC_PAIRING_EVIDENCE_LABEL, type GcPairingEvidence } from "./gcPairingEvidence";
import { fillMissingStates } from "./clubStates";

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
type ImportIndex = {
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
  /** Every scout id in use, kept as the fold goes so minting a new one does not rescan the roster. */
  usedTeamIds: Set<string>;
  /** Games by pool, pair and date — the three things a match must agree on. */
  gamesByMatch: Map<string, ScoutGame[]>;
  teamsById: Map<string, ScoutTeam>;
  /** The team carrying a GameChanger id. One id lives on one team. */
  teamByGcId: Map<string, ScoutTeam>;
  teamsByAvatar: Map<string, ScoutTeam[]>;
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
   * is the whole of how a club that played up is recognised, now that the picture has turned out
   * to be no kind of identifier.
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
};

const pairKeyOf = (game: ScoutGame): string =>
  [game.teamAId, game.teamBId].slice().sort().join("|");

const matchKeyOf = (game: ScoutGame, poolKeyOf: (ageGroupId: string) => string): string =>
  `${poolKeyOf(game.ageGroupId)}\u0000${pairKeyOf(game)}\u0000${game.date ?? ""}`;

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
};

/**
 * Records what a page is, for both lookups at once — the pool it rates in and the level it is at.
 * Called for the pages the pool already has and again for every page the fold creates.
 */
const noteAgeGroup = (index: ImportIndex, group: AgeGroup): void => {
  // Mirrors `rankingPoolGroupIds`: groups sharing a season year are one pool, and a group with no
  // year is a pool of one.
  const year = ageGroupYear(group);
  index.poolKeys.set(group.id, year === undefined ? `g:${group.id}` : `y:${year}`);
  if (year !== undefined) index.years.set(group.id, year);
  const level = ageGroupLevel(group);
  if (level !== undefined) index.levels.set(group.id, level);
};

/** The pool key rule, for a pass that runs outside the index: a season year is one pool. */
const buildPoolKeyOf = (ageGroups: AgeGroup[]): ((ageGroupId: string) => string) => {
  const keys = new Map<string, string>();
  ageGroups.forEach((group) => {
    const year = ageGroupYear(group);
    keys.set(group.id, year === undefined ? `g:${group.id}` : `y:${year}`);
  });
  return (ageGroupId: string) => keys.get(ageGroupId) ?? `g:${ageGroupId}`;
};

const buildIndex = (state: GcImportState): ImportIndex => {
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
    usedTeamIds: new Set(),
    gamesByMatch: new Map(),
    teamsById: new Map(),
    teamByGcId: new Map(),
    teamsByAvatar: new Map(),
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
  const noteAvatar = (avatarKey: string | undefined) => {
    if (!avatarKey) return;
    const bucket = index.teamsByAvatar.get(avatarKey);
    if (!bucket) index.teamsByAvatar.set(avatarKey, [team]);
    else if (!bucket.some((entry) => entry.id === team.id)) bucket.push(team);
  };
  // A club named as somebody's opponent has no link to carry its picture, so it keeps its own.
  noteAvatar(team.avatarKey);
  (team.gcTeams ?? []).forEach((link) => {
    index.teamByGcId.set(link.teamId, team);
    noteAvatar(link.avatarKey);
  });
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
const PLAYS_UP_TO = 2;

/** Whether a club seen at these levels could plausibly have played a game at `level`. */
const levelFits = (seen: ReadonlySet<number> | undefined, level: number | undefined): boolean => {
  // Nothing known either way is not a disagreement; only a level that is known and far is.
  if (level === undefined || seen === undefined || seen.size === 0) return true;
  for (const at of seen) {
    if (Math.abs(at - level) <= PLAYS_UP_TO) return true;
  }
  return false;
};

const nameSlotKey = (poolKey: string, nameKey: string, level: number | undefined): string =>
  `${poolKey}\u0000${level ?? "?"}\u0000${nameKey}`;

const noteInPool = (
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
const noteOpponent = (index: ImportIndex, teamId: string, opponentId: string) => {
  const met = index.opponentsByTeam.get(teamId);
  if (met) met.add(opponentId);
  else index.opponentsByTeam.set(teamId, new Set([opponentId]));
};

const halfResultKey = (pool: string, date: string, club: number, standIn: number): string =>
  `${pool}\u0000${date}\u0000${club}-${standIn}`;
/** Keyed by the minute rather than the text, so one start spelt or rounded two ways is one key. */
const halfTimeKey = (pool: string, minute: number): string => `${pool}\u0000${minute}`;

/** Whether a team is somebody's written name and nothing more: no GameChanger id behind it. */
const isStandIn = (team: ScoutTeam | undefined): boolean =>
  Boolean(team?.nameOnly) && !team?.gcTeams?.length;

/**
 * Files a row one side filed against a stand-in, under the keys `ageFromFixtures` looks it up by.
 * Filed again when a row is updated, since a result posted later changes the first key; the
 * lookup reads each row as it now stands and passes over one that no longer fits the key.
 */
const indexHalf = (index: ImportIndex, game: ScoutGame): void => {
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
const indexFolded = (index: ImportIndex, game: ScoutGame): void => {
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
  const onPage = index.teamIdsByGroup.get(game.ageGroupId) ?? new Set<string>();
  onPage.add(game.teamAId);
  onPage.add(game.teamBId);
  index.teamIdsByGroup.set(game.ageGroupId, onPage);
  noteOpponent(index, game.teamAId, game.teamBId);
  noteOpponent(index, game.teamBId, game.teamAId);
  if (game.date) {
    push(index.gamesByTeamDate, `${game.teamAId}\u0000${game.date}`, game);
    push(index.gamesByTeamDate, `${game.teamBId}\u0000${game.date}`, game);
  }
  // A side's level is what the game recorded for it, falling back to the page it is filed under.
  const pageLevel = index.levelOf(game.ageGroupId);
  noteInPool(index, game.ageGroupId, game.teamAId, game.ageLevelA ?? pageLevel);
  noteInPool(index, game.ageGroupId, game.teamBId, game.ageLevelB ?? pageLevel);
};

/** Appends a team to the working roster and records where it went. */
const addTeam = (index: ImportIndex, teams: ScoutTeam[], team: ScoutTeam): void => {
  index.teamPos.set(team.id, teams.length);
  index.usedTeamIds.add(team.id);
  teams.push(team);
  indexTeam(index, team);
};

/** Takes a team out of the avatar index, so a key it no longer carries stops pointing at it. */
const unindexAvatars = (index: ImportIndex, team: ScoutTeam): void => {
  const forget = (avatarKey: string | undefined) => {
    if (!avatarKey) return;
    const bucket = index.teamsByAvatar.get(avatarKey);
    if (!bucket) return;
    const at = bucket.findIndex((entry) => entry.id === team.id);
    if (at >= 0) bucket.splice(at, 1);
    if (bucket.length === 0) index.teamsByAvatar.delete(avatarKey);
  };
  forget(team.avatarKey);
  (team.gcTeams ?? []).forEach((link) => forget(link.avatarKey));
};

/**
 * Replaces a team in place. Its id does not change, so nothing it is filed under moves — except
 * its avatars, which a re-pull can change: GameChanger teams do get new pictures, and the old key
 * left behind would go on claiming this team, or worse make it ambiguous with whoever takes that
 * picture next.
 */
const replaceTeam = (index: ImportIndex, teams: ScoutTeam[], team: ScoutTeam): void => {
  const position = index.teamPos.get(team.id);
  if (position === undefined) {
    addTeam(index, teams, team);
    return;
  }
  const previous = teams[position];
  if (previous) unindexAvatars(index, previous);
  teams[position] = team;
  indexTeam(index, team);
};

/** Appends a game to the working list and records where it went. */
const addGame = (index: ImportIndex, games: ScoutGame[], game: ScoutGame): void => {
  index.gamePos.set(game.id, games.length);
  games.push(game);
  indexGame(index, game);
};

/** The pool, as the importer reads and returns it. */
export type GcImportState = {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
};

/** What one team's schedule did to the pool. One row of the panel's report. */
export type GcImportOutcome = {
  gcTeamId: string;
  teamName: string;
  /** The team in our roster this schedule belongs to. */
  teamId: string;
  /** The page its games were filed under. */
  ageGroupId: string;
  ageGroupName: string;
  /** A group that did not exist until this schedule arrived. */
  createdAgeGroup: boolean;
  /** This GameChanger id had never been pulled before. */
  createdTeam: boolean;
  gamesAdded: number;
  /** Matched an existing game and changed something — usually a score that has since been played. */
  gamesUpdated: number;
  /** Matched an existing game with nothing to change. */
  gamesUnchanged: number;
  /** Listed by GameChanger but not filed: cancelled, or missing the date a game is matched on. */
  gamesIgnored: number;
  /** Dated before this squad year began (or after it ends): last year's squad's games. */
  gamesOutOfSeason: number;
  opponentsCreated: number;
  opponentsMatchedByAvatar: number;
  opponentsMatchedByName: number;
  /**
   * The level this team was filed under because its opponents named one, GameChanger having named
   * none. Absent whenever the team said its own age, which is nearly always.
   */
  ageFromOpponents?: number;
  /** The level a person named by hand, which was used in place of whatever GameChanger said. */
  ageNamedByUser?: number;
  /**
   * The level a league the user's list names filed this team under, GameChanger having named
   * none. Recorded for the same reason as the two above: a level the club did not state itself
   * is worth being able to trace back to whoever did.
   */
  ageFromLeague?: number;
  /**
   * The level this team was filed under because the pulled clubs whose own schedules hold its
   * games are filed there (`ageFromFixtures`). Also counted in `ageFromOpponents`, which it is a
   * kind of; kept apart so a level can be traced to the rung that set it.
   */
  ageFromFixtures?: number;
  /**
   * The level read off the name by `ageLevelFromLooseName` — glued to its other words, or a span
   * written without its U — nothing else having answered. Kept so the level can be traced.
   */
  ageFromLooseName?: number;
  /** Which way it could not be filed, for anything deciding what to do about it. */
  skip?: GcSkipReason;
  /** Set when the schedule could not be filed at all; the pool is returned untouched. */
  issue?: string;
  /**
   * The squad year the team plays in, on a team refused as another season's (`other-season`), so
   * the refusal can be remembered against that year and hold only while it is not asked for.
   */
  otherSeasonYear?: number;
  /**
   * What GameChanger said about a team nobody could age.
   *
   * Present only with `skip: "no-age"`. The team is filed nowhere, so this outcome is the only
   * route out for anything a person would need to judge it by later.
   */
  noAgeEvidence?: AgelessEvidence;
};

/** A club that looks like the same club a season later, offered for the user to confirm. */
export type GcSeasonPairing = {
  /** The earlier squad. */
  fromTeamId: string;
  fromTeamName: string;
  fromSeason: string;
  /** The later squad, a season on. */
  toTeamId: string;
  toTeamName: string;
  toSeason: string;
  /**
   * The two GameChanger ids this pairing is really about.
   *
   * The team ids above are this app's own and do not survive the answer: folding deletes one of
   * them, and a reset mints new ones for everybody. A GameChanger id is minted once by
   * GameChanger and never again, so it is what a decision about this pair — "yes, fold" or "no,
   * these are two clubs" — has to be recorded against if it is to mean anything after the next
   * pull. See `keptApart.ts`.
   */
  fromGcId: string;
  toGcId: string;
  /**
   * What says these are one club, beyond the name. Never empty: a shared name alone is not
   * evidence, because the country is full of clubs that share one.
   */
  evidence: GcPairingEvidence[];
  /** Whether the name matches too, which is corroboration rather than the case on its own. */
  sameName: boolean;
  /** A picture, or a name plus a place they both give, is as strong as this gets. */
  confidence: "strong" | "likely";
  /**
   * What kind of pairing this is, because the two read very differently to whoever is deciding.
   *
   * "next-season" is a squad carrying on — a Fall id and the Spring id that follows it. "same
   * season" is one squad listed twice inside a single season, which is not a squad carrying on at
   * all: GameChanger mints an id per team per season, and a club that creates one, abandons it and
   * creates another ends up with two ids for one roster in one season, one of them holding every
   * game and the other holding whatever other schedules happened to name it.
   */
  kind: "next-season" | "same-season";
};

/**
 * The age a GameChanger listing plays at: the level it gives, or the one written in its name.
 *
 * GameChanger's own field is often blank while the name says "11U" plainly, and the two are the
 * same fact. Undefined means nobody wrote it down anywhere, which is not an age — and is never
 * an age two listings have in common.
 */
const linkAgeLevel = (link: GcTeamLink): number | undefined =>
  link.ageLevel ?? ageLevelFromName(link.name);

export { GC_PAIRING_EVIDENCE_LABEL, type GcPairingEvidence };

/** Seasons in the order a squad plays them, so "the next one" has a meaning. */
const SEASON_ORDER = ["fall", "winter", "spring", "summer"] as const;

/**
 * Whether `to` is a season `from` could have carried on into, and what the ages must do if it is.
 *
 * A squad year runs Fall through the following Summer. Inside one, the squad is the same squad at
 * the same age: Fall 2026, Winter 2026, Spring 2027 and Summer 2027 are one roster playing 11U all
 * the way through, so an age that changes means two different squads and there is nothing to pair.
 * Crossing into the next squad year — Spring or Summer, then the following Fall — is the same
 * roster too, but a year older, which is the whole reason the boundary is where it is. Refusing
 * that crossing outright, which is what this did, broke the carry-over at every birthday: a club's
 * 10U in Spring and its 11U in Fall were two teams with no game between them, and a rating had
 * nothing to follow from one to the other.
 *
 * So the answer is not yes or no but which of the two, and the caller checks the ages against it.
 */
const seasonStep = (
  from: GcTeamLink,
  to: GcTeamLink,
  /** The squad year a link plays in: its page's where known (`squadYearOfGcTeam` filed it there). */
  yearOf: (link: GcTeamLink) => number
): "same-year" | "ages-up" | null => {
  const fromIndex = SEASON_ORDER.indexOf((from.season ?? "") as (typeof SEASON_ORDER)[number]);
  const toIndex = SEASON_ORDER.indexOf((to.season ?? "") as (typeof SEASON_ORDER)[number]);
  if (fromIndex < 0 || toIndex < 0) return null;
  const fromYear = yearOf(from);
  const toYear = yearOf(to);
  if (fromYear === toYear) return toIndex > fromIndex ? "same-year" : null;
  // One squad year on, and forward in time. Two years on is a squad somebody stopped following.
  return toYear === fromYear + 1 ? "ages-up" : null;
};

/**
 * The same season, on both cards. Not a squad carrying on — the same squad, twice.
 *
 * Both labels have to be there. An id GameChanger gave no season is not evidence of anything, and
 * treating two unlabelled ids as one season would pair every such id in the pool with every other.
 */
const isSameSeason = (from: GcTeamLink, to: GcTeamLink): boolean =>
  from.season !== undefined &&
  from.season === to.season &&
  from.seasonYear !== undefined &&
  from.seasonYear === to.seasonYear;

/** The level a profile is for: what GameChanger says, else what the name says. */
const profileAgeLevel = (profile: GcTeamProfile): number | undefined =>
  profile.ageLevel ?? ageLevelFromName(profile.name);

/**
 * How many distinct opponents have to name an age before their names settle a team's level.
 *
 * Counted per opponent rather than per game, because a tournament against the same club four times
 * is one club's opinion and not four. Three is where the evidence stops being a coincidence: over
 * a 48,035-team export 90.4% of names carry a readable age label, so a team with any schedule at
 * all almost always has three, and three independent names agreeing is not something a mislabelled
 * squad produces by accident.
 */
export const MIN_OPPONENT_AGE_EVIDENCE = 3;

/**
 * The age level a team's opponents say it is, when they agree.
 *
 * Thousands of teams reach the pool with no age at all — GameChanger's field is empty, the name
 * says nothing, and there is no graduating class to read — and a team with no level is a team
 * nothing ranks and whose results count for nobody on either side. But a schedule is a list of
 * clubs that mostly do put their age in their name, and a side plays its own age nearly all of
 * the time. So the opponents answer the question the team itself would not.
 *
 * It refuses far more readily than it answers. Fewer than three opponents naming an age, a tie, or
 * anything short of a clear majority all come back undefined, because the cost is not symmetric: a
 * team left unrated costs its own ranking, and a team rated at the wrong age corrupts every club
 * it played.
 */
export const ageFromOpponentNames = (games: readonly GcGame[]): number | undefined => {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  let readable = 0;
  games.forEach((game) => {
    const key = teamNameKey(game.opponentName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const level = ageLevelFromName(game.opponentName);
    if (level === undefined) return;
    readable += 1;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  });
  if (readable < MIN_OPPONENT_AGE_EVIDENCE) return undefined;

  let best: number | undefined;
  let bestCount = 0;
  let tied = false;
  counts.forEach((count, level) => {
    if (count > bestCount) {
      best = level;
      bestCount = count;
      tied = false;
      return;
    }
    if (count === bestCount) tied = true;
  });
  if (best === undefined || tied) return undefined;
  // A strict majority of the opponents who said anything. Half of them is not an answer.
  if (bestCount * 2 <= readable) return undefined;
  return bestCount >= MIN_OPPONENT_AGE_EVIDENCE ? best : undefined;
};

/**
 * The age two opponents give a team when they both name it and nobody names another.
 *
 * Below `ageFromOpponentNames`' three, and measured before it was allowed: over the pool-names
 * export of 23 September 2026, on the teams whose age the pool already files, exactly two opponents
 * naming one age with none naming another matched the filed age for 10,330 of 10,623 teams — 97.2%
 * exact, 99.7% within a year — where three agreeing is 99.0%. The two-opponent case is also the
 * clean measurement: nothing could have been aged by two opponents before this, so none of those
 * teams was filed by the rule being measured. On the waiting list of the same day it answers 554
 * teams inside GameChanger's own band.
 *
 * Unanimous or nothing: two against one is not two agreeing, it is a split, and a split is the
 * three-opponent rule's to judge. The caller holds it to the band, which the three-opponent reading
 * has never been, and is left as it was.
 */
export const ageFromTwoOpponents = (games: readonly GcGame[]): number | undefined => {
  const seen = new Set<string>();
  const levels: number[] = [];
  games.forEach((game) => {
    const key = teamNameKey(game.opponentName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const level = ageLevelFromName(game.opponentName);
    if (level !== undefined) levels.push(level);
  });
  if (levels.length !== 2 || levels[0] !== levels[1]) return undefined;
  return levels[0];
};

/**
 * The schedule with an age filled in from its opponents, when it had none and they agree.
 *
 * Done here rather than in the API layer on purpose: `GcTeamProfile` is what GameChanger said
 * about a team, and this is not. It is the pool's reading of the company a team keeps, and it
 * belongs to the import that has the schedule in hand.
 */
/**
 * The age the pool already files this team's opponents at.
 *
 * `ageFromOpponentNames` above reads an age out of an opponent's *name*, which is the only thing
 * a schedule says about a club the pool has never met. But the pool has usually met them. A team
 * refused for having no age has just had its whole schedule fetched, and most of the clubs on it
 * are already in the pool, already filed, already at an age somebody or something settled. That
 * answer was sitting one lookup away and nothing asked for it.
 *
 * It matters most exactly where the name rule fails. The backlog's worst population is the closed
 * league where nobody writes an age in anything — "Team 4" playing "Team 2" and "Team 5" — and
 * `ageFromOpponentNames` can never settle one of those, because it only reads names and the names
 * say nothing. This rule can, as soon as one of those teams has been filed by any other route.
 *
 * **By identity, never by name.** The opponent is matched on its avatar key, which is stable per
 * club across schedules and is what `planOpponent` already trusts. That is the whole reason
 * this is safe: a name match on "Team 4" would collect a stranger from the other side of the
 * country, and a pool holding tens of thousands of teams has a great many "Team 4"s.
 *
 * Held to the same evidence bar as the name rule — `MIN_OPPONENT_AGE_EVIDENCE` distinct opponents
 * agreeing, a tie refused — because it is the same kind of claim: circumstantial, about the
 * company a club keeps, and wrong in the same way if a squad plays up all season. An opponent the
 * pool has filed at two different levels says nothing and is skipped rather than guessed at.
 */
export const ageFromPooledOpponents = (
  games: readonly GcGame[],
  index: ImportIndex,
  needed: number
): number | undefined => {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  let readable = 0;
  games.forEach((game) => {
    const key = game.opponentAvatarKey;
    if (!key) return;
    const known = index.teamsByAvatar.get(key) ?? [];
    // Two clubs sharing a picture is two clubs, and neither is evidence about this one.
    if (known.length !== 1) return;
    const team = known[0];
    if (!team || seen.has(team.id)) return;
    seen.add(team.id);
    const levels = index.levelsByTeam.get(team.id);
    // A club filed at two ages is a club running two squads: it says nothing about this one.
    if (!levels || levels.size !== 1) return;
    const level = [...levels][0];
    if (level === undefined) return;
    readable += 1;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  });
  if (readable < needed) return undefined;

  let best: number | undefined;
  let bestCount = 0;
  let tied = false;
  counts.forEach((count, level) => {
    if (count > bestCount) {
      best = level;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) tied = true;
  });
  return tied ? undefined : best;
};

/**
 * The age the pulled clubs a no-age team played are filed at — the clubs found by the games.
 *
 * A team refused for having no age has usually been met already. Each club that played it and was
 * pulled holds its own half of the game, filed against a stand-in carrying whatever its coach
 * typed for this team, so the evidence of who this team played is sitting in the pool. The names
 * alone cannot find it: this team's coach wrote "Stix" and theirs wrote "Hurricanes", and a pool
 * of a hundred thousand teams holds a great many of each. The game can. A row a pulled club filed
 * that day, against a stand-in whose name is a shorthand for this team, with the result mirrored
 * or at the same start time, is the other half of one of this team's games — once the name this
 * team typed is a shorthand for that club and the two are in one region, as the crossed-halves
 * join asks (`joinCrossedHalves`). Where two clubs could each have been one game, that game names
 * nobody.
 *
 * The level read off each club is its own listing's, and a club listed at two levels says
 * nothing. The answer is held to the name rule's bar (`ageFromOpponentNames`): `needed` distinct
 * clubs, a strict majority, and at least `needed` of them on the level it gives. The bar is not a
 * formality. On the stand-in fixtures export of 22 September 2026 the two clubs of a game joined
 * this way were filed at the same level 73.5% of the time and a level apart 22%, so one opponent's
 * level is a guess and three agreeing is not.
 */
export const ageFromFixtures = (
  schedule: GcTeamSchedule,
  index: ImportIndex,
  needed: number
): number | undefined => {
  const { profile } = schedule;
  if (!profile.season) return undefined;
  // `today` only decides for a winter team with no dated game, and then there is nothing to read.
  const pool = `y:${squadYearOfGcTeam(profile.season, schedule.games, todayIsoDay())}`;
  const fits = nameFitter();
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  let readable = 0;
  schedule.games.forEach((game) => {
    if (!game.date) return;
    const scored = game.teamScore !== undefined && game.opponentScore !== undefined;
    const ids = new Set([
      ...(scored
        ? (index.halvesByResult.get(
            halfResultKey(pool, game.date, game.opponentScore!, game.teamScore!)
          ) ?? [])
        : []),
      ...(startMinuteOf(game.startTs) === undefined
        ? []
        : (index.halvesByTime.get(halfTimeKey(pool, startMinuteOf(game.startTs)!)) ?? [])),
    ]);
    const clubs = new Set<string>();
    ids.forEach((id) => {
      const row = index.gamesById.get(id);
      if (!row) return;
      const standInIsA = isStandIn(index.teamsById.get(row.teamAId));
      const standIn = index.teamsById.get(standInIsA ? row.teamAId : row.teamBId);
      const club = index.teamsById.get(standInIsA ? row.teamBId : row.teamAId);
      // Still a stand-in: one a club has adopted since, pulled under that name, is that club's.
      if (!club || !standIn || !isStandIn(standIn)) return;
      // The club's own half, off its own schedule.
      if (!club.gcTeams?.some((link) => link.teamId === row.source?.teamId)) return;
      const clubScore = standInIsA ? row.teamBScore : row.teamAScore;
      const standInScore = standInIsA ? row.teamAScore : row.teamBScore;
      const mirrored =
        scored && clubScore === game.opponentScore && standInScore === game.teamScore;
      if (!mirrored && !sameStart(game.startTs, row.startTs)) return;
      if (!fits(standIn.name, profile.name) || !fits(game.opponentName, club.name)) return;
      if (!inOneRegion(profile.state, club.state)) return;
      clubs.add(club.id);
    });
    if (clubs.size !== 1) return;
    const clubId = [...clubs][0]!;
    if (seen.has(clubId)) return;
    seen.add(clubId);
    const levels = new Set<number>();
    index.teamsById.get(clubId)?.gcTeams?.forEach((link) => {
      const level = link.ageLevel ?? index.levelOf(link.ageGroupId);
      if (level !== undefined) levels.add(level);
    });
    if (levels.size !== 1) return;
    const level = [...levels][0]!;
    readable += 1;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  });

  let best: number | undefined;
  let bestCount = 0;
  let tied = false;
  counts.forEach((count, level) => {
    if (count > bestCount) {
      best = level;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) tied = true;
  });
  if (best === undefined || tied) return undefined;
  // A strict majority of the clubs that said anything, and enough of them on its level.
  if (bestCount * 2 <= readable) return undefined;
  return bestCount >= needed ? best : undefined;
};

const withOpponentAge = (
  schedule: GcTeamSchedule
): { schedule: GcTeamSchedule; inferred?: number } => {
  if (profileAgeLevel(schedule.profile) !== undefined) return { schedule };
  const two = ageFromTwoOpponents(schedule.games);
  const inferred =
    ageFromOpponentNames(schedule.games) ??
    (two !== undefined && ageFitsBand(two, schedule.profile.ageLabel) ? two : undefined);
  if (inferred === undefined) return { schedule };
  return {
    schedule: { ...schedule, profile: { ...schedule.profile, ageLevel: inferred } },
    inferred,
  };
};

/** A game id nobody else will mint, derived from the GameChanger ids it came from. */
const gcGameId = (gcTeamId: string, gameId: string): string => `gc_${gcTeamId}_${gameId}`;

/**
 * The page a pulled schedule belongs on: its age level, in the squad year its GameChanger season
 * falls in. Creates the group when there is not one, because a nationwide pull cannot expect the
 * user to have made a page for every level first.
 */
const resolveAgeGroup = (
  profile: GcTeamProfile,
  state: GcImportState,
  /** The squad year the team plays in (`squadYearOfGcTeam`), where the caller has worked it out. */
  squadYear: number | undefined,
  /** Whether the owner vouched for the club (`vouchedFor`), whose name then refuses nothing. */
  vouched: boolean
): { ageGroups: AgeGroup[]; group: AgeGroup; created: boolean } | null => {
  // A different game entirely. Checked before the age, because a wiffle team filed under 12U has
  // a perfectly good age level and that is exactly what makes it invisible.
  if (isNotBaseball(profile.name)) return null;
  // No team at all, a practice or an old page somebody marked do not use, and the same trap: a
  // "Practice 12U" has a perfectly good level, and filing it would rank a coach's practice account.
  if (!vouched && notATeamWord(profile.name)) return null;
  // A different season entirely, and the same trap: a varsity side whose age field reads 18U has
  // a perfectly good level, and filing it would put a closed cluster in the 18U table.
  if (isSchoolTeam(profile)) return null;
  const ageLevel = profileAgeLevel(profile);
  // Below the youngest level the app ranks there is nothing worth filing. A nationwide team list
  // is full of 6U and 7U squads whose results say more about which league plays coach pitch than
  // about any team, and filing them would mint pages nobody asked for and fetch schedules nobody
  // reads. They are skipped outright rather than ranked or half-created.
  if (ageLevel === undefined || ageLevel < MIN_AGE_LEVEL || ageLevel > MAX_AGE_LEVEL) return null;
  if (!profile.season) return null;
  const year = squadYear ?? squadYearForGcSeason(profile.season.season, profile.season.year);

  // Few enough age groups that a scan is honest here — one per level per year, not one per team.
  const existing = state.ageGroups.find(
    (group) => ageGroupLevel(group) === ageLevel && ageGroupYear(group) === year
  );
  if (existing) return { ageGroups: state.ageGroups, group: existing, created: false };

  const group: AgeGroup = {
    id: createAgeGroupId(),
    name: formatAgeGroupName(ageLevel, year),
    ageLevel,
    year,
    seasonIds: [],
  };
  return { ageGroups: [...state.ageGroups, group], group, created: true };
};

/**
 * Why a schedule was left where it was — a code as well as a sentence.
 *
 * The code matters because the four are not the same kind of problem. A team with no age might
 * have one next week: GameChanger's field gets filled in, a club renames a squad, or the team
 * plays more games against opponents who do name an age. A 6U team never will. So one of these is
 * worth asking about again every week and the others are not, and telling them apart by reading
 * the sentence would break the first time somebody reworded it.
 */
export type GcSkipReason =
  /** A club the user threw out. Refused before a game is read, or the pull rebuilds it. */
  | "deleted"
  | "no-age"
  | "below-min-age"
  | "above-max-age"
  | "no-season"
  /**
   * A wiffle ball, blitzball or softball team. A different game, so its results belong to no
   * baseball ranking.
   */
  | "not-baseball"
  /**
   * A page whose name says it is no team (`notATeamWord`): a practice, a scrimmage, a test, an old
   * page marked do not use. Not remembered for good, since a coach can rename the page.
   */
  | "not-a-team"
  /** A high school squad. A different season, played against a pool this app does not hold. */
  | "high-school"
  /** Grown men or a college side. There is no youth age to find, so it is never asked about. */
  | "not-youth"
  /**
   * Every game on the schedule has a result on a day that has not happened. Refused before its
   * age is asked, and remembered with the clubs the user threw out; see `isInventedSchedule`.
   */
  | "invented"
  /**
   * No age, no games, and a season that is not the one being played. Not remembered anywhere:
   * the team leaves the waiting list, and a later pull may find it again once its season comes
   * round with a schedule. See `gcSeasonIsCurrent`.
   */
  | "out-of-season"
  /**
   * A team from a season this pull was not asked for: its GameChanger season falls in a baseball
   * year outside `GcImportOptions.seasonYears`. Refused before its age is read, and not remembered
   * anywhere, because a later pull that ticks that year should file it as normal.
   */
  | "other-season";

/**
 * Whether GameChanger's answer describes a high school squad, by either of the two things it says.
 *
 * The name and the age field are both read because a club that writes "Varsity" in one of them
 * very often leaves the other as the school's plain name.
 */
const isSchoolTeam = (profile: GcTeamProfile): boolean =>
  isSchoolName(profile.name) || isSchoolAgeLabel(profile.ageLabel);

const skipReason = (
  profile: GcTeamProfile,
  /** As `resolveAgeGroup` was asked it: a club the owner vouched for is not refused on a word. */
  vouched: boolean
): { code: GcSkipReason; message: string } => {
  if (isNotBaseball(profile.name)) {
    return {
      code: "not-baseball",
      message:
        "This is a wiffle ball, blitzball or softball team, which is a different game, so it was left out.",
    };
  }
  // Before the age readings, as `resolveAgeGroup` asks it: a good age does not make a practice
  // account a team. The word goes in the sentence, so a page refused on a word can be checked.
  const notATeam = vouched ? null : notATeamWord(profile.name);
  if (notATeam?.word === "team") {
    return {
      code: "not-a-team",
      message:
        "This page is named only “Team”, with nothing more than a number, a letter or an age: " +
        "the name a page has when nobody named it, so it was left out. Its name says " +
        `“${notATeam.text}”.`,
    };
  }
  if (notATeam) {
    return {
      code: "not-a-team",
      message:
        "This page's name says it is not a real team (a practice, scrimmage, test or placeholder " +
        `page, or one marked do not use), so it was left out. Its name says “${notATeam.text}”.`,
    };
  }
  /*
   * Before the school test, because the two read the same field and an over-18 men's league is
   * the more certain of the two readings: `college` and `Over 18` describe who is playing rather
   * than what season they play it in.
   */
  if (isAdultAgeLabel(profile.ageLabel)) {
    return {
      code: "not-youth",
      message:
        "GameChanger files this team as adult or college. This app ranks youth baseball, so " +
        "there is no age here to find and it is left out.",
    };
  }
  if (isSchoolTeam(profile)) {
    return {
      code: "high-school",
      message:
        "This is a high school squad. Those play their own season against other high school " +
        "squads, so their results join nothing this app ranks and they are left out.",
    };
  }
  const ageLevel = profileAgeLevel(profile);
  if (ageLevel === undefined) {
    return {
      code: "no-age",
      message:
        "GameChanger gave no age group for this team, its name does not say one, and its " +
        `opponents do not settle one either: that takes two naming one age and none another, or ${MIN_OPPONENT_AGE_EVIDENCE} agreeing.`,
    };
  }
  if (ageLevel < MIN_AGE_LEVEL) {
    return {
      code: "below-min-age",
      message: `${ageLevel}U is below the youngest level ranked here, so this team was skipped.`,
    };
  }
  if (ageLevel > MAX_AGE_LEVEL) {
    return {
      code: "above-max-age",
      message: `${ageLevel}U is above the oldest level ranked here, so this team was skipped.`,
    };
  }
  return {
    code: "no-season",
    message:
      "GameChanger gave no season for this team, so there is no squad year to file it under.",
  };
};

/** The link this pull records against a team, so a later pull knows what it already has. */
const linkFor = (
  schedule: GcTeamSchedule,
  ageGroupId: string,
  ageFrom?: GcAgeSource
): GcTeamLink => {
  const { profile, fetchedAt, listed } = schedule;
  return {
    teamId: profile.id,
    name: profile.name,
    ageGroupId,
    ...(profile.season ? { season: profile.season.season, seasonYear: profile.season.year } : {}),
    ...(profileAgeLevel(profile) === undefined ? {} : { ageLevel: profileAgeLevel(profile) }),
    // What GameChanger's own field said, and which rule filed it: see `GcTeamLink.ageFrom`.
    ...(profile.ageLabel ? { ageLabel: profile.ageLabel } : {}),
    ...(ageFrom === undefined ? {} : { ageFrom }),
    ...(profile.avatarKey ? { avatarKey: profile.avatarKey } : {}),
    ...(profile.record ? { record: profile.record } : {}),
    /*
     * The user's list first, GameChanger's profile behind it. The list is the newer reading and
     * the one its owner can correct; the profile is what every pull carries whether a list was
     * pasted or not, which is what makes the staff index worth having at all on a pull by id.
     */
    ...(listed?.staff?.length
      ? { staff: listed.staff }
      : profile.staff?.length
        ? { staff: profile.staff }
        : {}),
    ...(listed?.playerCount === undefined
      ? {}
      : { playerCount: listed.playerCount, countedAt: fetchedAt }),
    importedAt: fetchedAt,
  };
};

/**
 * What a new link keeps from the one it replaces.
 *
 * The staff and the roster size come from the user's pasted list and from nowhere else —
 * GameChanger's public endpoints return neither — so a refresh run without the list in the box
 * carries none, and replacing the link outright erased them. A weekly rota is exactly that run,
 * which made every refresh quietly strip the evidence the merge suggestions and the under-strength
 * watch list are built on.
 *
 * A newer list still wins: these are only carried forward when the incoming link has nothing to
 * say about them. `countedAt` travels with `playerCount`, because a count without the day it was
 * taken cannot be re-checked.
 */
const carryListedFields = (link: GcTeamLink, prior: GcTeamLink | undefined): GcTeamLink => {
  if (!prior) return link;
  const kept: GcTeamLink = { ...link };
  if (kept.staff === undefined && prior.staff !== undefined) kept.staff = prior.staff;
  if (kept.playerCount === undefined && prior.playerCount !== undefined) {
    kept.playerCount = prior.playerCount;
    if (prior.countedAt !== undefined) kept.countedAt = prior.countedAt;
  }
  return kept;
};

const withLink = (team: ScoutTeam, link: GcTeamLink): ScoutTeam => {
  const prior = (team.gcTeams ?? []).find((entry) => entry.teamId === link.teamId);
  const rest = (team.gcTeams ?? []).filter((entry) => entry.teamId !== link.teamId);
  const linked: ScoutTeam = { ...team, gcTeams: [...rest, carryListedFields(link, prior)] };
  // Its own schedule is here now, so it is a club rather than a name on somebody else's.
  delete linked.nameOnly;
  /*
   * The stored name is cleaned again here, because this is the only chance it gets. A club that
   * has been pulled before is found by its GameChanger id and never by its name, so the healing
   * `resolveOrCreateTeam` does when a name matches never reaches one: an entry stored as "Premier
   * Ohio Lopez /" by a cleaner that took a bracket off as two labels would carry the debris for
   * as long as the pool existed. A rename is cleaned on its way in too, so a stored name that
   * still holds a label is always something a rule left behind rather than somebody's choice.
   */
  const cleaned = cleanTeamName(linked.name);
  if (cleaned !== linked.name) linked.name = cleaned;
  return linked;
};

/**
 * The states of the pulled clubs whose schedules named this stand-in. A stand-in has no state of
 * its own — a schedule names an opponent and says nothing about where it is from — but the clubs
 * that named it do, and a club is nearly always named by neighbours: of known-correct pairs in a
 * nationwide pull, nine in ten were in one state.
 */
const pullerStates = (index: ImportIndex, teamId: string): Set<string> => {
  const states = new Set<string>();
  index.opponentsByTeam.get(teamId)?.forEach((opponentId) => {
    const opponent = index.teamsById.get(opponentId);
    if (opponent?.gcTeams?.length && opponent.state) states.add(opponent.state);
  });
  return states;
};

/** Whether a club in `state` could be the one these pullers named: nobody knows, or somebody agrees. */
const stateFits = (state: string | undefined, pullers: Set<string>): boolean =>
  !state || pullers.size === 0 || pullers.has(state);

/** Lower-cased for comparing; GameChanger's towns arrive as typed. */
const townKey = (city: string | undefined): string | undefined =>
  city?.trim().toLowerCase() || undefined;

/**
 * Whether the schedule in hand holds a game that a stand-in's row is the other half of: the same
 * day, an opponent of the name the stand-in's row was filed against, and the result mirrored
 * where both sides have one. Run from the club's own side as its schedule arrives, this is the
 * same fixture test `holdsThisGame` runs from the opponent's — and it is what tells a club's own
 * stand-in from a namesake's when several share the name.
 */
const scheduleConfirms = (index: ImportIndex, standInId: string, games: GcGame[]): boolean =>
  games.some((game) => {
    if (!game.date) return false;
    const rows = index.gamesByTeamDate.get(`${standInId}\u0000${game.date}`) ?? [];
    const opponentKey = teamNameKey(game.opponentName);
    return rows.some((row) => {
      const otherId = row.teamAId === standInId ? row.teamBId : row.teamAId;
      const other = index.teamsById.get(otherId);
      if (!other || teamNameKey(other.name) !== opponentKey) return false;
      const mine = row.teamAId === standInId ? row.teamAScore : row.teamBScore;
      const theirs = row.teamAId === standInId ? row.teamBScore : row.teamAScore;
      if (mine === undefined || theirs === undefined) return true;
      if (game.teamScore === undefined || game.opponentScore === undefined) return true;
      return mine === game.teamScore && theirs === game.opponentScore;
    });
  });

/**
 * The team a pulled schedule belongs to. By GameChanger id and nothing else: a team pulled by id
 * *is* that id, and pairing a Fall squad to a Spring one is the user's call, not a guess made
 * here.
 */
const resolveOwnTeam = (
  schedule: GcTeamSchedule,
  ageGroupId: string,
  teams: ScoutTeam[],
  index: ImportIndex,
  ageFrom?: GcAgeSource
): { teamId: string; created: boolean } => {
  const { profile } = schedule;
  const link = linkFor(schedule, ageGroupId, ageFrom);
  const known = index.teamByGcId.get(profile.id);
  if (known) {
    replaceTeam(index, teams, withLink(known, link));
    return { teamId: known.id, created: false };
  }

  /** An entry put here by somebody else's schedule, with no GameChanger id of its own yet. */
  const isStub = (team: ScoutTeam | undefined): team is ScoutTeam =>
    Boolean(team) && !team?.gcTeams?.length;

  /*
   * The picture first, for the same reason opponents are matched on it first: it is the only
   * identifier that means the same thing on two schedules. It also settles the case a name cannot
   * — a club that plays up, listed as an opponent by an older team and so filed at that team's
   * level, is still recognisably itself here when its own schedule arrives.
   */
  if (profile.avatarKey) {
    const byAvatar = (index.teamsByAvatar.get(profile.avatarKey) ?? []).filter(isStub);
    // Exactly one, or the picture is shared and says nothing about which of them this is.
    if (byAvatar.length === 1 && byAvatar[0]) {
      const adopted = withLink(byAvatar[0], link);
      const avatarState = normalizeState(profile.state ?? "");
      if (avatarState && !adopted.state) adopted.state = avatarState;
      if (profile.city && !adopted.city) adopted.city = profile.city;
      replaceTeam(index, teams, adopted);
      return { teamId: byAvatar[0].id, created: false };
    }
  }

  /**
   * Failing that: this club is very likely already here as a name-only opponent, put there
   * by a schedule pulled earlier. Adopting that entry is what keeps one club one team — in a pull
   * of a whole list nearly every team appears as somebody's opponent before its own turn comes,
   * so creating a second would duplicate most of the pull. Only an entry with no GameChanger id
   * of its own qualifies, and only on this page, which is the same rule opponents are matched by.
   */
  /*
   * Any level, not just this club's own. An entry put here by somebody else's schedule was filed
   * at whatever level *they* play at — the schedule that named it never said what level the club
   * was — so matching on that level misses the club that played up, and mints a second team for
   * it. What the level would have guarded against, one club's 9U and 11U squads folding together,
   * is guarded instead by there being exactly one such entry to adopt.
   */
  const key = teamNameKey(profile.name);
  const pool = index.poolKeyOf(ageGroupId);
  const sameName = index.teamIdsByPoolName.get(`${pool}\u0000${key}`) ?? [];
  const placeholders = sameName.map((teamId) => index.teamsById.get(teamId)).filter(isStub);
  const level = profileAgeLevel(profile);
  const ownState = normalizeState(profile.state ?? "") || undefined;

  /*
   * Which of them is this club. The game first: a stand-in whose row this schedule holds — same
   * day, that opponent, the result mirrored — was made for this club. Then the level, since the
   * stand-in a schedule named at 9U is not the club's 10U squad. Then the state: a stand-in named
   * only by clubs in other states is somebody else's namesake, however lonely it looks. Refusing
   * whenever two stand-ins shared the name, which is what this did before, left 1,589 clubs
   * standing beside their own stand-in — 4,283 games on an entry with no id — because a club
   * named at two levels is two stand-ins.
   */
  const confirmed = placeholders.filter((stub) => scheduleConfirms(index, stub.id, schedule.games));
  const atLevel =
    level === undefined
      ? placeholders
      : placeholders.filter((stub) =>
          (index.teamIdsByGroupName.get(nameSlotKey(pool, key, level)) ?? []).includes(stub.id)
        );
  const inState = (stubs: ScoutTeam[]) =>
    stubs.filter((stub) => stateFits(ownState, pullerStates(index, stub.id)));
  const pick = (stubs: ScoutTeam[]): ScoutTeam | undefined =>
    stubs.length === 1 ? stubs[0] : undefined;
  /*
   * ...and only a stand-in this club could have been. Adopting the sole stand-in of the name
   * whatever level it was filed at is what put a 15U result on a 9U club: one schedule named
   * "Lookouts Baseball Club" at 15U, the 9U club of that name was pulled next, and being the only
   * one it took the stand-in and the 15U loss with it. The 15U club arrived afterwards as a second
   * team, and no later step could undo it — the fixture tests all need the real club's own
   * schedule to hold the row, and it did not. A level that disagrees by more than `PLAYS_UP_TO`
   * is the one thing that says this stand-in belongs to a namesake rather than to this club.
   */
  const couldBe = placeholders.filter((stub) => levelFits(index.levelsByTeam.get(stub.id), level));
  const placeholder =
    pick(confirmed) ??
    pick(inState(atLevel)) ??
    (couldBe.length === 1 ? pick(inState(couldBe)) : undefined);
  if (placeholder) {
    const updated = withLink(placeholder, link);
    if (ownState && !updated.state) updated.state = ownState;
    if (profile.city && !updated.city) updated.city = profile.city;
    replaceTeam(index, teams, updated);
    noteInPool(index, ageGroupId, placeholder.id, level);
    return { teamId: placeholder.id, created: false };
  }

  const extras: Partial<ScoutTeam> = { gcTeams: [link] };
  if (ownState) extras.state = ownState;
  if (profile.city) extras.city = profile.city;
  const team = buildScoutTeam(profile.name, index.usedTeamIds, extras);
  addTeam(index, teams, team);
  /*
   * Named in the index now, not when its first game is filed: a club whose schedule is empty or
   * entirely in the future is still the club its neighbours' schedules name, and a pull carried
   * 3,272 of those with nothing to file — each of which then got a stand-in beside it.
   */
  noteInPool(index, ageGroupId, team.id, level);
  return { teamId: team.id, created: true };
};

type OpponentMatch = {
  teamId: string;
  basis: "avatar" | "name" | "created";
};

/**
 * Whether anything beyond a shared name says these two are the same club.
 *
 * A name is not an identity. A nationwide pool holds twenty clubs called the Yankees and a dozen
 * Trash Pandas, and at one age level in one season year there can easily be two — so a bare name
 * match is a coin toss dressed up as a fact. These are the things that are not coincidences: two
 * clubs that have played each other, two that have a club in common, and two that give the same
 * town or state.
 *
 * Where none of them holds, the importer makes a separate team instead. That leaves duplicates,
 * which is the cheaper mistake by a distance: a duplicate is visible in the table and can be
 * folded together in a few seconds, while a wrong merge silently pools two clubs' results into one
 * rating and leaves nothing behind to notice.
 */
/**
 * Whether this club's own schedule already holds the game being filed.
 *
 * This is the question a person would ask. The Raiders' schedule says they played the River City
 * Raptors on the 2nd: go and look at the Raptors' schedule for a game that day and see whether it
 * is the same one. A club that has it is the club that played it; a club that does not, is not.
 *
 * What counts as "the same one": the day has to match, a start time on both sides has to agree,
 * and where both rows carry a result the results have to mirror. The other side of their row must
 * be this very team, or a stand-in — a bracket slot, or a club nobody has pulled yet — because
 * that is what their row looks like before this team's own turn comes round. The start has to be
 * the same one, not merely within the hour: this is choosing between namesakes, and a namesake's
 * own game against this team an hour later would read as holding this one too.
 */
const holdsThisGame = (
  index: ImportIndex,
  ownTeamId: string,
  candidateId: string,
  game: GcGame,
  /**
   * Only the candidate's own row naming this very team: asked of a club the owner has said this
   * name is not (`notThisTeam.ts`), where only the club's own word that it played this team beats
   * the refusal, and a row of its own against some stand-in that day is a name and no more.
   */
  ownWordOnly = false
): boolean => {
  if (!game.date) return false;
  const sameDay = index.gamesByTeamDate.get(`${candidateId}\u0000${game.date}`) ?? [];
  const candidate = ownWordOnly ? index.teamsById.get(candidateId) : undefined;
  return sameDay.some((existing) => {
    const other = existing.teamAId === candidateId ? existing.teamBId : existing.teamAId;
    if (ownWordOnly && (other !== ownTeamId || !listedByOwn(existing, candidate))) return false;
    if (game.startTs && existing.startTs && !sameStart(game.startTs, existing.startTs))
      return false;
    const theirs = existing.teamAId === candidateId ? existing.teamAScore : existing.teamBScore;
    const ours = existing.teamAId === candidateId ? existing.teamBScore : existing.teamAScore;
    const resultsAgree =
      theirs === undefined ||
      ours === undefined ||
      game.teamScore === undefined ||
      game.opponentScore === undefined ||
      (theirs === game.opponentScore && ours === game.teamScore);
    if (!resultsAgree) return false;
    if (other === ownTeamId) return true;
    const stand = index.teamsById.get(other);
    return Boolean(stand?.placeholder || stand?.nameOnly);
  });
};

/**
 * Whether a club a name points at could have played this game: a stand-in, which has no schedule
 * to ask, or a pulled club whose own schedules have a game that day.
 *
 * The double check a name needs before it files a game onto a pulled club. GameChanger gives an
 * opponent as the words somebody typed and nothing else, so a name is where to look rather than
 * who played; the club it points at either has a game that day on its own schedule or did not
 * play this one. Asked only of the name's own guesses: the game itself (`clubHoldingThisGame`,
 * `opponentFromSameFixture`) and the picture already are the club's own word.
 */
const couldHavePlayed = (index: ImportIndex, clubId: string, date: string | undefined): boolean => {
  const club = index.teamsById.get(clubId);
  if (!club?.gcTeams?.length) return true;
  if (!date) return false;
  const own = new Set(club.gcTeams.map((link) => link.teamId));
  const near = new Set(aroundDay(date));
  const ofClub = (schedule: string) => (own.has(schedule) ? clubId : undefined);
  /*
   * Games are filed under their own day and a row folded into one keeps its own, a day off at most
   * (`ownRowDays`), so the games two days either side are read and each row at its own day.
   */
  return [-2, -1, 0, 1, 2].some((offset) => {
    const day = isoDayFrom(date, offset);
    return (index.gamesByTeamDate.get(`${clubId}\u0000${day}`) ?? []).some((game) =>
      ownRowDays(game, ofClub).some(([, rowDay]) => near.has(rowDay))
    );
  });
};

/**
 * Of the clubs of this name, the one whose schedule holds this game. Exactly one, or the schedules
 * cannot tell them apart either and the question is left to whatever comes after.
 */
const clubHoldingThisGame = (
  index: ImportIndex,
  ownTeamId: string,
  candidates: readonly string[],
  game: GcGame,
  /** The candidates asked for their own word alone (`holdsThisGame`'s `ownWordOnly`). */
  ownWordOnly: (teamId: string) => boolean = () => false
): string | undefined => {
  const holders = candidates.filter((id) =>
    holdsThisGame(index, ownTeamId, id, game, ownWordOnly(id))
  );
  return holders.length === 1 ? holders[0] : undefined;
};

const corroborates = (
  index: ImportIndex,
  ownTeamId: string,
  candidateId: string,
  game: GcGame
): boolean => {
  /**
   * The strongest of the lot, and the one that makes a bracket work: the club of that name already
   * has a game on this day that this could be — against this very team, or against a placeholder
   * that nobody has named yet. Two schedules describing one fixture is not a coincidence. Where
   * both give a start time they have to agree on it, so the two halves of a doubleheader cannot
   * stand in for each other.
   */
  if (game.date) {
    const sameDay = index.gamesByTeamDate.get(`${candidateId}\u0000${game.date}`) ?? [];
    const couldBeThisGame = sameDay.some((existing) => {
      if (game.startTs && existing.startTs && !sameStart(game.startTs, existing.startTs)) {
        return false;
      }
      const other = existing.teamAId === candidateId ? existing.teamBId : existing.teamAId;
      if (other === ownTeamId) return true;
      /*
       * The result, mirrored, from the two sides of one fixture. This is what settles it when the
       * other row was filed against a stand-in — a bracket slot, or a club some schedule named
       * before anybody pulled it — which is exactly what the row looks like before the club whose
       * game this is has had its turn.
       */
      const stand = index.teamsById.get(other);
      if (!stand?.placeholder && !stand?.nameOnly) return false;
      const theirs = existing.teamAId === candidateId ? existing.teamAScore : existing.teamBScore;
      const ours = existing.teamAId === candidateId ? existing.teamBScore : existing.teamAScore;
      const scored = theirs !== undefined && ours !== undefined;
      if (!scored) return true;
      return theirs === game.opponentScore && ours === game.teamScore;
    });
    if (couldBeThisGame) return true;
  }

  const met = index.opponentsByTeam.get(candidateId);
  // They have played each other, so the club on the other side of that game is this one.
  if (met?.has(ownTeamId)) return true;

  const ours = index.opponentsByTeam.get(ownTeamId);
  if (ours && met) {
    for (const opponent of met) {
      if (ours.has(opponent)) return true;
    }
  }

  const own = index.teamsById.get(ownTeamId);
  const candidate = index.teamsById.get(candidateId);
  if (!own || !candidate) return false;
  if (own.city && candidate.city && own.city.toLowerCase() === candidate.city.toLowerCase()) {
    return true;
  }
  return Boolean(own.state && candidate.state && own.state === candidate.state);
};

/**
 * The club on the other side of this very game, found by the game rather than by the name.
 *
 * Both clubs post the fixture, and the two rows agree on the things a fixture actually is: the
 * day, the time it started, and how it finished, mirrored. That is a far better identifier than a
 * name — it needs no picture, survives the two schedules spelling the club differently, and works
 * on a name that identifies nobody at all, which is what makes it the answer for a bracket's
 * "TBD". Where exactly one game already filed for this team that day says the same thing, the club
 * it was filed against is who this game was against.
 *
 * The row has to come from a *different* GameChanger schedule. A club's own schedule listing two
 * games that day is listing two games, and letting one answer for the other would file them both
 * against the same opponent and lose one.
 *
 * Given with the row that answered, so the caller can ask whose schedule gave it (`planOpponent`).
 */
const opponentFromSameFixture = (
  index: ImportIndex,
  ownTeamId: string,
  ageGroupId: string,
  game: GcGame,
  sourceTeamId: string
): { teamId: string; row: ScoutGame } | undefined => {
  if (!game.date) return undefined;
  const pool = index.poolKeyOf(ageGroupId);
  const sameDay = index.gamesByTeamDate.get(`${ownTeamId}\u0000${game.date}`) ?? [];

  const candidates = sameDay.filter((existing) => {
    if (existing.source?.teamId === sourceTeamId) return false;
    if (index.poolKeyOf(existing.ageGroupId) !== pool) return false;
    // A time on both sides has to agree: two games in a day are two games.
    if (game.startTs && existing.startTs && !sameStart(game.startTs, existing.startTs))
      return false;

    const ourScore = existing.teamAId === ownTeamId ? existing.teamAScore : existing.teamBScore;
    const theirScore = existing.teamAId === ownTeamId ? existing.teamBScore : existing.teamAScore;
    const scoresAgree =
      ourScore !== undefined &&
      theirScore !== undefined &&
      ourScore === game.teamScore &&
      theirScore === game.opponentScore;
    /*
     * Either the result matches, or the day and the start time pin it on their own — but not two
     * results further apart than two scorekeepers are (`CLOSE_DISPUTE_RUNS`), which the claim step
     * reads as two games. Taken on the clock alone, the reading hung on which club was pulled first:
     * on the pool of 26 September 2026 the claim step left 69 rows at the very start of another
     * club's copy with results more than four runs apart, 20 against a slot and 49 against a name
     * none of which fitted that club, where 13 of the 27 with the same result did.
     */
    const scoredApart =
      ourScore !== undefined &&
      theirScore !== undefined &&
      game.teamScore !== undefined &&
      game.opponentScore !== undefined &&
      Math.abs(ourScore - game.teamScore) + Math.abs(theirScore - game.opponentScore) >
        CLOSE_DISPUTE_RUNS;
    const timeAgrees = sameStart(game.startTs, existing.startTs) && !scoredApart;
    return scoresAgree || timeAgrees;
  });

  if (candidates.length !== 1) return undefined;
  const found = candidates[0]!;
  const other = found.teamAId === ownTeamId ? found.teamBId : found.teamAId;
  // A slot answers for nobody; naming this game after one would put two games on one placeholder.
  return index.teamsById.get(other)?.placeholder ? undefined : { teamId: other, row: found };
};

/** The team `planOpponent` found for a name, or the kind of team it would make for one. */
type OpponentPlan = OpponentMatch | { create: Partial<ScoutTeam>; basis: "created" };

/**
 * The team an opponent name refers to. The avatar first, because it is the only identifier
 * GameChanger gives that means the same thing on two different schedules. Failing that, a name —
 * but only among teams already on this page, since a name on its own says nothing across levels or
 * seasons. Failing that, a new team, which is the honest answer for a club nobody has pulled.
 *
 * Only looked up here, never made: `teamOfPlan` makes the team a plan asks for. `byFixture`
 * asks the game itself as well, which a caller asking what a name says leaves out.
 */
const planOpponent = (
  game: GcGame,
  ageGroupId: string,
  index: ImportIndex,
  ownTeamId: string,
  sourceTeamId: string,
  byFixture: boolean,
  refused: NotThisTeam = NO_REFUSALS
): OpponentPlan => {
  // The picture is a direct identifier, so it is asked first when the game carries one.
  if (game.opponentAvatarKey) {
    const byAvatar = index.teamsByAvatar.get(game.opponentAvatarKey) ?? [];
    // Exactly one, or the picture is shared and says nothing about which team this is.
    if (byAvatar.length === 1 && byAvatar[0]) {
      return { teamId: byAvatar[0].id, basis: "avatar" };
    }
  }

  /*
   * A club the owner has said this name, on this schedule, is not ("Not this team",
   * `notThisTeam.ts`) is no answer to the name: not as the one club of it, nor as the one something
   * corroborates, nor as the club its own row of the day could be. It is still the answer to the
   * game where its own schedule lists the game against this very club: a refusal is about a name,
   * and the club's own word that it played this team is not a reading of one. Kept from the fixture
   * as well, the two clubs' next meeting stood twice on this club's record, once against the club
   * from its schedule and once against a stand-in from this one.
   */
  const refusedHere = (teamId: string) =>
    refusesName(refused, sourceTeamId, game.opponentName, index.teamsById.get(teamId));
  const allowed = (teamId: string) => !refusedHere(teamId);

  /*
   * Then the game itself, which beats the name even when the name is a real one — and is the only
   * thing that can answer a name that identifies nobody, so it comes before the slot below.
   */
  const fixture = byFixture
    ? opponentFromSameFixture(index, ownTeamId, ageGroupId, game, sourceTeamId)
    : undefined;
  if (
    fixture &&
    (allowed(fixture.teamId) || listedByOwn(fixture.row, index.teamsById.get(fixture.teamId)))
  ) {
    return { teamId: fixture.teamId, basis: "avatar" };
  }

  /**
   * "TBD", "Winner of Game 3", a blank cell on a bracket: a name that stands in for a team nobody
   * had decided yet. Matching one to anything is the mistake — a single shared "TBD" would collect
   * games from dozens of unrelated schedules and then sit in the rating graph as an opponent all
   * of them had played, which the fit would read as evidence about how they compare. Each gets a
   * slot of its own, marked as one, and the game is filed exactly as any other so it still counts
   * for the team that played it.
   */
  const key = teamNameKey(game.opponentName);
  const pool = index.poolKeyOf(ageGroupId);
  const typed = ageLevelFromName(game.opponentName);
  const year = index.yearOf(ageGroupId);
  /*
   * A graduating class is an age as well, read against the page's squad year just as the row is
   * filed at it: "Mojo Gold 2036" on a 10U page of 2027 is a 9U squad. Looked up at the page's own
   * level it was filed at another, and never found again: Oklahoma's 10U clubs had made ten stand-ins
   * of it by 24 September 2026, and 55 fewer of all such names would have been made at the class's.
   */
  const classLevel =
    typed === undefined && year !== undefined
      ? ageFromGradYearInName(game.opponentName, year)
      : undefined;
  const pageLevel = typed ?? index.levelOf(ageGroupId);
  const theirLevel = classLevel ?? pageLevel;
  const atLevel = index.teamIdsByGroupName.get(nameSlotKey(pool, key, theirLevel)) ?? [];
  /*
   * ...and a club pulled under that name and found at the page's level is still found there: "NWNC
   * Elite 2034" lists itself at 10U though its class reads 11U, and five 10U clubs named it. Looked
   * up at the class alone, 13 rows naming six such clubs went to stand-ins beside them.
   */
  const pulledAtPage =
    theirLevel === pageLevel
      ? []
      : (index.teamIdsByGroupName.get(nameSlotKey(pool, key, pageLevel)) ?? []).filter(
          (id) => index.teamsById.get(id)?.gcTeams?.length && !atLevel.includes(id)
        );
  const named = [...atLevel, ...pulledAtPage];
  const sameName = named.filter(allowed);

  /*
   * A name that marks a real team's old page — void, do not use, delete, duplicate, placeholder —
   * names nobody this pool can rank, and is filed the way "TBD" is: a slot of its own, so the result
   * stays on the record of the club that played it (`OpponentGate`).
   */
  if (
    isPlaceholderName(game.opponentName) ||
    notATeamWord(game.opponentName)?.opponent === "slot"
  ) {
    /*
     * ...unless a club somebody pulled by id is called this. A schedule that writes the weekend in
     * the opponent column — "USSSA Cactus Classic" — names nobody, but a club really can call its
     * travel squad "Miami Bulldogs Tournament", and 74 of them do in a nationwide pool. An id is
     * an identity and a reading of a name is not, so where exactly one club of this name at this
     * level was pulled, the mention is that club rather than a slot.
     */
    const pulled = sameName.filter((id) => index.teamsById.get(id)?.gcTeams?.length);
    // Not a name that could be nothing but a slot, which a pulled "Tbd" is a coach's placeholder
    // for rather than a club anybody plays (`namesNobody`); and only a club that played that day.
    if (
      pulled.length === 1 &&
      pulled[0] &&
      !namesNobody(game.opponentName) &&
      couldHavePlayed(index, pulled[0], game.date)
    ) {
      return { teamId: pulled[0], basis: "name" };
    }
    return { create: { placeholder: true }, basis: "created" };
  }

  /*
   * Of the clubs of this name, the one whose own schedule holds this game. This is the question
   * worth asking and it beats every other test, because it is about this fixture rather than
   * about the name: it tells a club apart from its namesakes however many of them there are.
   */
  const anyLevel = index.teamIdsByPoolName.get(`${pool}\u0000${key}`) ?? named;
  const holder = clubHoldingThisGame(index, ownTeamId, anyLevel, game, refusedHere);
  if (holder) return { teamId: holder, basis: "name" };

  /*
   * Failing that, one club of that name at that level in this pool — and a pool is one season year
   * at one age, not the whole country. Insisting on more than that was making a second entry to
   * stand beside a club already here and shadow it: the name matched, nothing corroborated because
   * the two had not met yet, and the game went to a copy. A club a schedule names is nearly always
   * the one club of that name here; where it is not, there is more than one and the tests below
   * decide between them rather than inventing a third.
   */
  const own = index.teamsById.get(ownTeamId);
  const only = sameName.length === 1 ? sameName[0] : undefined;
  if (only) {
    /*
     * ...provided it is where this club's opponents are. A sole club of the name in another state
     * is, four times in ten, not the one this schedule played but a namesake pulled first, with
     * the real one — in the puller's own state — arriving later or not at all. A schedule's
     * opponents are in its own state nine times in ten; the tenth needs the game or a club in
     * common to vouch for it, and otherwise waits as a stand-in for the tidy to settle.
     */
    const candidate = index.teamsById.get(only);
    // A pulled club is where it says; a stand-in is where the clubs that named it are.
    const sameState = candidate?.gcTeams?.length
      ? !own?.state || !candidate.state || own.state === candidate.state
      : stateFits(own?.state, pullerStates(index, only));
    if (
      (sameState || corroborates(index, ownTeamId, only, game)) &&
      couldHavePlayed(index, only, game.date)
    ) {
      return { teamId: only, basis: "name" };
    }
  }

  // Several of that name: the one something beyond the name agrees with, that played that day.
  const corroborated = sameName.filter(
    (id) => corroborates(index, ownTeamId, id, game) && couldHavePlayed(index, id, game.date)
  );
  if (corroborated.length === 1 && corroborated[0]) {
    return { teamId: corroborated[0], basis: "name" };
  }

  /*
   * Failing that, an entry nobody has pulled — a name some schedule wrote down, and no more than
   * that. Reusing one is not the claim that attaching to a real club is, and refusing to reuse it
   * is far worse than it sounds: the second entry of a name makes every later mention ambiguous,
   * so it mints a third, and a fourth, until one club is hundreds of teams and its games are
   * scattered across all of them. A pull of a few thousand schedules did exactly that.
   *
   * Nothing about the picture enters into it. GameChanger mints a fresh one for every listing
   * rather than giving a club one that follows it about — measured over a nationwide pull, 7,948
   * teams carried 7,948 distinct pictures and not one was shared by two of them, while the clubs
   * actually pulled by id often carried none at all. Read as identity it said "different club"
   * about every mention of the same club, which is how one River City Raptors became six.
   */
  const reusable = sameName
    .map((teamId) => index.teamsById.get(teamId))
    .find(
      (team): team is ScoutTeam =>
        team !== undefined &&
        !team.placeholder &&
        !team.gcTeams?.length &&
        /*
         * ...named by this club's neighbours. One "Red Sox" stand-in shared by twenty-nine clubs
         * in ten states is not a club; it is a knot in the rating graph that ties every one of
         * them to every other. A stand-in per state keeps a name that is nobody in particular
         * from being everybody's opponent.
         */
        stateFits(own?.state, pullerStates(index, team.id))
    );
  if (reusable) return { teamId: reusable.id, basis: "name" };

  return { create: { nameOnly: true }, basis: "created" };
};

/**
 * The club a row's picture names after this pull (`ScoutGame.namedByAvatar`), given the one it
 * named before. `pictured` is the pulled club this pull's picture names, where it names one: the
 * row's club where the row is filed against it (`filedAgainst`, the club it faces and, for a
 * claimed row, the team it goes back to); none where it is another club, since what the row named
 * before it names no longer; and the one before where the picture names no pulled club at all, as
 * GameChanger often sends a row with no picture.
 */
const pictureNow = (
  before: string | undefined,
  pictured: string | undefined,
  filedAgainst: ReadonlyArray<string | undefined>
): string | undefined =>
  pictured === undefined ? before : filedAgainst.includes(pictured) ? pictured : undefined;

/**
 * `existing`, a row this schedule filed before, carrying the club its picture names after this pull
 * (`pictureNow`) where that is a club the row is filed against. The same object when nothing
 * changes.
 */
const withPictureOf = (
  existing: ScoutGame,
  candidate: ScoutGame,
  pictured: string | undefined
): ScoutGame => {
  const named = pictureNow(existing.namedByAvatar, pictured, [candidate.teamBId]);
  if (named === existing.namedByAvatar) return existing;
  if (named === undefined) {
    const { namedByAvatar: _before, ...rest } = existing;
    return rest;
  }
  if (existing.teamAId !== named && existing.teamBId !== named) return existing;
  return { ...existing, namedByAvatar: named };
};

/** The team `plan` asks for, made where it asks for one and added to the roster. */
const teamOfPlan = (
  plan: OpponentPlan,
  name: string,
  index: ImportIndex,
  teams: ScoutTeam[]
): string => {
  if (!("create" in plan)) return plan.teamId;
  const created = buildScoutTeam(name, index.usedTeamIds, plan.create);
  addTeam(index, teams, created);
  return created.id;
};

/**
 * A club's own row held in another club's copy of the game with nothing to say where it was filed
 * (`FoldedRow.filedAgainst`), read on its schedule's next pull: the team its name says, where that
 * is a stand-in or a slot the row is claimed from (`claimFiledRows`), or nothing.
 *
 * #270 settled a row filed by name against a stand-in into the other club's copy of the game with
 * no such mark, and the pools it tidied hold those folds with nothing that can give them back: on
 * the pool of 24 September 2026, 1,223 of them. The row's name is not kept in the pool, so its
 * next pull is where it can be read, and the fold marked as the claim step would have made it.
 * A fold the name files against the other club is left as it is:
 *
 * - The same day, the club's own row on side B of the other club's own copy, and no other row of
 *   the club in it: a claim is read by its own day, and a copy holding the club's own row is not
 *   one the claim step offers.
 * - A name that is not the other club's, by its key, a GameChanger listing's or its picture, nor a
 *   shorthand for it at the very start, as the slot settle files one; nor one this pull's other
 *   rows already stand against the other club under, which is what a hand merge leaves. The name
 *   is read as a pull reads one, less the game itself (`planOpponent`), and a pulled club is not
 *   marked.
 * - Not the same result, nor the very start with results that do not disagree: the slot settle
 *   folds those back with no mark (`resolveSlotGames`), and a mark it undid would be made again,
 *   with a new stand-in, on every pull.
 * - The claim step's own rules for a stand-in: levels in reach, a stand-in the other club has not
 *   played, the clock, scores within four runs, and no row of the club's against the other club
 *   waiting that day or either side of it that could yet be the copy (`couldStillBeCopy`). Its
 *   rule for the whole day, one club for one name, is read over all of the pull's marks at once,
 *   where they are made.
 *
 * A fold the fixture match or the slot settle made at the very start with results a run or so
 * apart is marked too, the first time its club is pulled after it: it is the claim the claim step
 * makes where the two clubs' rows come in the other order. A merge settles the rows it folds
 * (`isSettledClaim`), so nothing a merge made is read here.
 */
const filedMarkFor = (
  index: ImportIndex,
  fold: {
    /** The row as the schedule lists it now. */
    game: GcGame;
    /** That row, filed against the club whose copy holds it. */
    candidate: ScoutGame;
    holder: ScoutGame;
    record: FoldedRow;
    ownTeamId: string;
    sourceTeamId: string;
    ageGroupId: string;
    /** The level the row's name gives, as a standing row would carry it (`ageLevelB`). */
    theirLevel: number | undefined;
    /** Every team this pull's own standing rows are filed against, by the name each was typed. */
    standingByName: ReadonlyMap<string, ReadonlySet<string>>;
  }
): OpponentPlan | undefined => {
  const { game, candidate, holder, record, ownTeamId, sourceTeamId } = fold;
  if (candidate.date === undefined || candidate.date !== holder.date || holder.excluded) {
    return undefined;
  }
  const clubId = holder.teamAId;
  const club = index.teamsById.get(clubId);
  // The other club's own copy, as the claim step offers one: a copy nobody's schedule gave, typed
  // in by hand, is not offered, and a row marked in it went back beside it.
  const copyClub = holder.source && index.teamByGcId.get(holder.source.teamId)?.id;
  if (!club || holder.teamBId !== ownTeamId || copyClub !== clubId) return undefined;
  const ours = (schedule: string) => index.teamByGcId.get(schedule)?.id === ownTeamId;
  const alsoOurs =
    (holder.alsoRows ?? []).some(
      (other) =>
        ours(other.teamId) && (other.teamId !== record.teamId || other.gameId !== record.gameId)
    ) || (holder.alsoFrom ?? []).some((schedule) => schedule !== sourceTeamId && ours(schedule));
  if (alsoOurs) return undefined;

  const key = teamNameKey(game.opponentName);
  const links = club.gcTeams ?? [];
  const listings = [club.name, ...links.map((link) => link.name)].filter((name): name is string =>
    Boolean(name)
  );
  if (listings.some((name) => teamNameKey(name) === key)) return undefined;
  const pictures = [club.avatarKey, ...links.map((link) => link.avatarKey)];
  if (game.opponentAvatarKey && pictures.includes(game.opponentAvatarKey)) return undefined;
  if (fold.standingByName.get(key)?.has(clubId)) return undefined;

  const mine: [number, number] | undefined = isScored(candidate)
    ? [candidate.teamAScore!, candidate.teamBScore!]
    : undefined;
  // The copy's own score: one lent it by this club's row (`scoreFromB`) is this club's word.
  const theirs: [number, number] | undefined =
    isScored(holder) && !holder.scoreFromB ? [holder.teamBScore!, holder.teamAScore!] : undefined;
  const same =
    mine !== undefined && theirs !== undefined && mine[0] === theirs[0] && mine[1] === theirs[1];
  const disagree = mine !== undefined && theirs !== undefined && !same;
  const atStart = sameStart(candidate.startTs, holder.startTs);
  if (same || (atStart && !disagree)) return undefined;
  if (
    disagree &&
    Math.abs(mine[0] - theirs[0]) + Math.abs(mine[1] - theirs[1]) > CLOSE_DISPUTE_RUNS
  ) {
    return undefined;
  }
  if (!atStart && !startsWithinTheHour(candidate.startTs, holder.startTs)) return undefined;
  // A shorthand for the other club's name at the very start is what the slot settle files against
  // it wherever the two clubs are (`resolveSlotGames`), and the joins in one region; the same
  // result is left above.
  if (atStart && listings.some((name) => nameFitsWithin(game.opponentName, name))) {
    return undefined;
  }
  const level = holder.ageLevelA ?? index.levelOf(holder.ageGroupId);
  if (
    fold.theirLevel !== undefined &&
    level !== undefined &&
    Math.abs(fold.theirLevel - level) > PLAYS_UP_TO
  ) {
    return undefined;
  }

  const plan = planOpponent(game, fold.ageGroupId, index, ownTeamId, sourceTeamId, false);
  if ("teamId" in plan) {
    const named = index.teamsById.get(plan.teamId);
    if (
      !named ||
      !(named.placeholder || named.nameOnly) ||
      named.gcTeams?.length ||
      index.opponentsByTeam.get(clubId)?.has(plan.teamId)
    ) {
      return undefined;
    }
  }

  // A row of this club's own against the other club, that day or either side, that no row of
  // theirs answers and that could yet be the copy: the claim step waits on it, and a mark made now
  // would be stood back up.
  const clubOwns = (other: ScoutGame, teamId: string) => {
    const of = (schedule: string | undefined) =>
      schedule !== undefined && index.teamByGcId.get(schedule)?.id === teamId;
    return (
      of(other.source?.teamId) ||
      (other.alsoRows ?? []).some((row) => of(row.teamId)) ||
      (other.alsoFrom ?? []).some(of)
    );
  };
  const waiting = [-1, 0, 1].some((days) => {
    const day = days === 0 ? candidate.date : isoDayFrom(candidate.date!, days);
    if (day === undefined) return false;
    return (index.gamesByTeamDate.get(`${ownTeamId}\u0000${day}`) ?? []).some((stale) => {
      const other = index.gamesById.get(stale.id);
      if (!other || other.id === holder.id) return false;
      const sides = [other.teamAId, other.teamBId];
      return (
        sides.includes(clubId) &&
        sides.includes(ownTeamId) &&
        clubOwns(other, ownTeamId) &&
        !clubOwns(other, clubId) &&
        couldStillBeCopy(other, holder)
      );
    });
  });
  return waiting ? undefined : plan;
};

/**
 * The one copy of another club's holding `sourceTeamId` on record with no row kept (`alsoFrom`
 * alone) that `row`, one of that schedule's rows, can be: its club on one side, the other club's own
 * copy, the same day, within the hour, and not scored further apart than scorekeepers are
 * (`CLOSE_DISPUTE_RUNS`). None where two could be.
 */
const heldOnRecord = (
  index: ImportIndex,
  row: GcGame,
  ownTeamId: string,
  sourceTeamId: string
): ScoutGame | undefined => {
  if (!row.date) return undefined;
  const mine =
    row.teamScore !== undefined && row.opponentScore !== undefined
      ? [row.teamScore, row.opponentScore]
      : undefined;
  const found = new Map<string, ScoutGame>();
  (index.gamesByTeamDate.get(`${ownTeamId}\u0000${row.date}`) ?? []).forEach((stale) => {
    const holder = index.gamesById.get(stale.id);
    if (!holder || found.has(holder.id) || holder.date !== row.date) return;
    if (!(holder.alsoFrom ?? []).includes(sourceTeamId)) return;
    if ((holder.alsoRows ?? []).some((record) => record.teamId === sourceTeamId)) return;
    const ownOnA = holder.teamAId === ownTeamId;
    const clubId = ownOnA ? holder.teamBId : holder.teamAId;
    if (!ownOnA && holder.teamBId !== ownTeamId) return;
    if (!holder.source || index.teamByGcId.get(holder.source.teamId)?.id !== clubId) return;
    if (!startsWithinTheHour(row.startTs, holder.startTs)) return;
    const theirs =
      isScored(holder) && !holder.scoreFromB
        ? ownOnA
          ? [holder.teamAScore!, holder.teamBScore!]
          : [holder.teamBScore!, holder.teamAScore!]
        : undefined;
    if (
      mine &&
      theirs &&
      Math.abs(mine[0]! - theirs[0]!) + Math.abs(mine[1]! - theirs[1]!) > CLOSE_DISPUTE_RUNS
    ) {
      return;
    }
    found.set(holder.id, holder);
  });
  return found.size === 1 ? [...found.values()][0] : undefined;
};

/** Games GameChanger lists but that cannot be filed: no date to match on, or called off. */
const isFilable = (game: GcGame): boolean => Boolean(game.date) && game.status !== "canceled";

/**
 * Whether a re-pull actually says anything new. A schedule is pulled repeatedly as a season runs,
 * and almost every game comes back exactly as it was; only a game that has since been played, or
 * whose score GameChanger has corrected, is worth writing.
 */
/** Whether a game carries a result at all. One score without the other is not one. */
const isScored = (game: ScoutGame): boolean =>
  game.teamAScore !== undefined && game.teamBScore !== undefined;

/**
 * The candidate's scores as they would sit on the existing row's sides.
 *
 * The same game is on both teams' schedules and each lists itself first, so the copy arriving may
 * be the mirror of the row already here. Comparing them side for side would call every mirrored
 * game a change and rewrite it on every pull.
 */
const scoresAsExisting = (
  existing: ScoutGame,
  candidate: ScoutGame
): { a: number | undefined; b: number | undefined } =>
  existing.teamAId === candidate.teamAId
    ? { a: candidate.teamAScore, b: candidate.teamBScore }
    : { a: candidate.teamBScore, b: candidate.teamAScore };

const differs = (existing: ScoutGame, candidate: ScoutGame): boolean => {
  const scores = scoresAsExisting(existing, candidate);
  // An unscored copy says nothing about the result; it must not be read as disagreeing with one.
  const scoreChanged =
    isScored(candidate) && (existing.teamAScore !== scores.a || existing.teamBScore !== scores.b);
  /*
   * A game the namesake join made carries side B's own level, and keeps beside it the level the
   * row's name gave (`ScoutGame.joinedFromLevel`), which is what the schedule says again. Read
   * against side B's own, every pull of the club rewrote the game and counted it updated.
   *
   * No other level is news, because the update writes no other level: the club's own stays as it
   * was filed (rewritten in place it would leave the import's index, `levelsByTeam` and the name
   * lookup by level, on the old one for the rest of the batch), and side B's on a game nothing
   * joined may be B's own, put in by the crossed-halves join from B's schedule with no mark to say
   * so. Read as changes and never written, a club GameChanger moved a level, or a coach's retyped
   * age for an opponent, counted the game updated on every pull.
   */
  const levelB =
    existing.joinedFrom !== undefined && existing.joinedFromLevel !== candidate.ageLevelB;
  return scoreChanged || existing.season !== candidate.season || levelB;
};

/**
 * One pulled schedule, folded in.
 *
 * Returns the pool it would produce and a report of what it did. When the schedule cannot be filed
 * — no age level, or no season, so there is no page it belongs on — the pool comes back untouched
 * with the reason in `issue`, because filing a nationwide pull's worth of games under a guess is
 * worse than saying so.
 */
/**
 * The answers a pull carries with it: what the user has already decided, and what the app has
 * already learned.
 *
 * An object rather than a run of positional arguments because there are now three of them and
 * there will be more. Measured across the repo, 142 of the 147 calls to the three entry points
 * below pass only the schedule and the pool, so this costs five call sites and stops the next
 * answer being a fifth positional parameter nobody can read at a glance.
 */
export type GcImportOptions = {
  /** Rows the user has thrown out, so a re-pull does not file them again. */
  deleted?: DeletedGames;
  /** Clubs the user has thrown out, whose schedules are refused outright. */
  droppedClubs?: DeletedClubs;
  /** Ids already known to be below the youngest level ranked here. */
  tooYoung?: TooYoungClubs;
  /** The levels somebody named by hand, which beat GameChanger's own field. */
  namedAges?: NamedAges;
  /**
   * The names the owner has said are not a club, by the schedule that wrote them ("Not this
   * team", `notThisTeam.ts`): a row of the name off that schedule is filed onto anything but that
   * club, as though the club did not carry the name, unless the club's own schedule lists the game
   * against this one.
   */
  notThisTeam?: NotThisTeam;
  /**
   * The clubs the owner has vouched for, by club id or any GameChanger id of theirs, beside the
   * user's own club and a page's own team, which the pool itself says: those said to be real, and
   * the clubs a League Standings team links (`leagueLinkedClubs`). The tidy deletes none of them for
   * its name (`dropNotATeam`), so neither does the import refuse one's schedule on a word in it,
   * nor drop another club's row of a name that is one of them: the club kept would stop updating,
   * and the rows that confirm its games would come off them.
   */
  realClubs?: ReadonlySet<string>;
  /**
   * Whether `realClubs` is known to be short of clubs the owner vouched for: a cloud run that could
   * not read League Standings has the real list alone. The gate still turns away a drop word's row
   * then, as such a run files no page the rules refuse, but a game filed on the row before is left
   * standing rather than withdrawn (`refused`). The row may name a club League links, and the tidy
   * would take that club's game away for the night, where this run's tidy deletes no club for its
   * name at all. The next run that reads League settles the row.
   */
  realClubsShort?: boolean;
  /**
   * The day "you cannot score a game early" is judged against, as an ISO day.
   *
   * Only read to describe a team nobody could age, which is why it is here rather than threaded
   * through the fold: passing it means a test can say which day it is instead of depending on the
   * afternoon it runs on.
   */
  today?: string;
  /**
   * The baseball years this pull files, by `squadYearForGcSeason`: 2027 is Fall 2026 through
   * Summer 2027. A team whose GameChanger season falls in any other year is refused before its age
   * is read.
   *
   * A crawl that searches every season of a calendar year hands over last spring's and summer's
   * squads beside this fall's, and GameChanger mints a new id per team per season, so nothing
   * else in a list tells a finished year's team from one playing now. The panel passes the season
   * being played unless somebody ticks another. Absent means every year: the rota refreshes what
   * the pool already holds, and every caller before this one passed nothing.
   */
  seasonYears?: ReadonlySet<number>;
};

const NOTHING_DELETED: DeletedGames = new Set<string>();
const NO_CLUBS: DeletedClubs = new Set<string>();
const NOTHING_NAMED: NamedAges = new Map();

export const importGcSchedule = (
  schedule: GcTeamSchedule,
  state: GcImportState,
  options: GcImportOptions = {}
): { state: GcImportState; outcome: GcImportOutcome } => {
  // The fold works in place, so it is handed copies: a caller's pool is never altered under it.
  const working: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const result = importOne(schedule, working, buildIndex(working), options);
  // Nothing could be filed, so hand back exactly what came in rather than a copy of it.
  return result.outcome.issue ? { state, outcome: result.outcome } : result;
};

/**
 * A pulled schedule with GameChanger's own reading of its age done again in the squad year the team
 * plays in, where that is not the year its season's label reads as (`squadYearOfGcTeam`).
 *
 * Only a class year reads differently from one year to the next — "2034" in the age field is 11U
 * in 2027 and 12U in 2028 — and only a level the profile's own ladder gave (`ageLevelOf`, read in
 * the label's year) is read again, so a level that came from anywhere else stands as it is.
 */
const withAgeReadIn = (schedule: GcTeamSchedule, squadYear: number): GcTeamSchedule => {
  const { profile } = schedule;
  if (!profile.season) return schedule;
  const labelYear = squadYearForGcSeason(profile.season.season, profile.season.year);
  if (squadYear === labelYear) return schedule;
  if (ageLevelOf(profile.ageLabel, profile.name, labelYear) !== profile.ageLevel) return schedule;
  const ageLevel = ageLevelOf(profile.ageLabel, profile.name, squadYear);
  if (ageLevel === profile.ageLevel) return schedule;
  const next: GcTeamProfile = { ...profile };
  if (ageLevel === undefined) delete next.ageLevel;
  else next.ageLevel = ageLevel;
  return { ...schedule, profile: next };
};

/**
 * Whether a club's own names carry the word a row's name hit: its stored name, or the GameChanger
 * name on one of its links. A row is matched to a club by the name key, and the key drops what a
 * bracket says, so "Tamberlane Tigers 12U (Scrimmage)" keys as plain "Tamberlane Tigers". The key
 * alone cannot tell a club whose own name reads as a tryout ("Workout Warriors"), which every row
 * of its name hits, from a row that adds a practice's word to a plain club's name; the club's own
 * names can.
 */
const carriesWord = (team: ScoutTeam, word: NotATeamWord): boolean =>
  [team.name, ...(team.gcTeams ?? []).map((link) => link.name)].some(
    (name) => notATeamWord(name)?.word === word
  );

/**
 * Whether the owner vouched for a club the pool holds (`GcImportOptions.realClubs`): the user's own
 * club, a page's own team, or one `real` names by its club id or any GameChanger id of it. No word
 * in such a club's name refuses its schedule, nor drops another club's row of its name.
 */
const vouchedClub = (
  team: ScoutTeam,
  real: ReadonlySet<string>,
  ageGroups: readonly AgeGroup[]
): boolean =>
  team.isMine === true ||
  real.has(team.id) ||
  (team.gcTeams ?? []).some((link) => real.has(link.teamId)) ||
  ageGroups.some((group) => group.myTeamId === team.id);

/**
 * Whether the import would file a GameChanger id's schedule whatever its name says, as its gate
 * asks it (`vouched` in `importOne`): the id is in `real`, or the club in `state` that carries it is
 * one the owner vouched for (`vouchedClub`). `real` is what the import is handed as `realClubs`,
 * the clubs League Standings links among them.
 *
 * For a pasted list, which reads a row's name before any request: a row whose name says it is no
 * team is left out there, and one of a club vouched for has to be kept, or the import could never
 * refresh that club from a paste although it would file the schedule.
 */
export const vouchedByImport = (
  state: GcImportState,
  real: ReadonlySet<string>
): ((gcTeamId: string) => boolean) => {
  // Each id's club as the import's index holds it (`indexTeam`): the last club carrying it.
  const carrier = new Map<string, ScoutTeam>();
  state.teams.forEach((team) =>
    (team.gcTeams ?? []).forEach((link) => carrier.set(link.teamId, team))
  );
  return (gcTeamId) => {
    if (real.has(gcTeamId)) return true;
    const team = carrier.get(gcTeamId);
    return team !== undefined && vouchedClub(team, real, state.ageGroups);
  };
};

const importOne = (
  pulled: GcTeamSchedule,
  state: GcImportState,
  index: ImportIndex,
  options: GcImportOptions
): { state: GcImportState; outcome: GcImportOutcome } => {
  const deleted = options.deleted ?? NOTHING_DELETED;
  const droppedClubs = options.droppedClubs ?? NO_CLUBS;
  const tooYoung = options.tooYoung ?? NO_CLUBS;
  const real = options.realClubs ?? NO_CLUBS;
  /** A club the owner vouched for (`GcImportOptions.realClubs`), whose name refuses nothing. */
  const vouchedFor = (team: ScoutTeam | undefined): boolean =>
    team !== undefined && vouchedClub(team, real, state.ageGroups);
  /*
   * The squad year the team plays in, which is its season label's except for a winter's: that
   * names either year it straddles, and the team's own games say which (`squadYearOfGcTeam`). Read
   * first, because the age is read in it too — the profile read a class year against the label's
   * later year, and a Winter 2027 squad playing from November 2026 is a level younger than that.
   */
  const seasonYear = pulled.profile.season
    ? squadYearOfGcTeam(pulled.profile.season, pulled.games, options.today ?? todayIsoDay())
    : undefined;
  const original = seasonYear === undefined ? pulled : withAgeReadIn(pulled, seasonYear);
  /*
   * Filled in before anything else looks at the profile, so the page, the link and the games all
   * agree on one level. A team GameChanger did not file under an age is filed under the one its
   * opponents keep naming, or under none at all.
   */
  /*
   * What GameChanger says right now, read before anything rewrites it. A level somebody named by
   * hand stands in only while this is what it was when they named it: the moment the club's own
   * page says something different, the club wins and the hand-named level is ignored.
   */
  const gcSaysNow = profileAgeLevel(original.profile);
  const named = namedAgeFor(options.namedAges ?? NOTHING_NAMED, original.profile.id, gcSaysNow);
  /*
   * A level somebody named by hand, applied before anything else looks at the profile — ahead of
   * GameChanger's own field rather than only in its absence. Everything downstream then agrees on
   * one level with no other change: the page it is filed under, the link written against the
   * team, and the age carried on each of its games.
   */
  const withNamed: GcTeamSchedule =
    named === undefined
      ? original
      : { ...original, profile: { ...original.profile, ageLevel: named } };
  /*
   * Then the league the user's list says this team plays in, when GameChanger itself said nothing.
   *
   * Below the club's own word and above its opponents': a league naming an age — "NKB 11u" — is a
   * statement about every team in it, which is stronger than reading the company a team keeps and
   * weaker than the club filling in its own page. It reaches here from `listed` rather than from
   * `profile` because GameChanger never said it: its public API has no route from a team to its
   * leagues, and only a crawl that found the team through one knows.
   *
   * Leagues only. A tournament is where a team plays up, so an age in one is a ceiling it reached
   * rather than the age it is — see `ageFromLeagueNames`.
   */
  /*
   * Never against GameChanger's own band. "Under 13" and "Between 13 - 18" bound an age without
   * giving one, and a list's age outside the bound is the list being wrong about the team: of the
   * 141 waiting teams a partial Organizations export of 22 September 2026 would age, the two whose
   * band it contradicted were "Ritter", filed "Under 13" and under a 16U organization, and
   * "Monster Blue", filed "Between 13 - 18" and under a 7U one.
   */
  const listedAge = withNamed.listed?.ageLevel;
  const fromLeague =
    profileAgeLevel(withNamed.profile) === undefined &&
    listedAge !== undefined &&
    ageFitsBand(listedAge, withNamed.profile.ageLabel)
      ? listedAge
      : undefined;
  const withLeague: GcTeamSchedule =
    fromLeague === undefined
      ? withNamed
      : { ...withNamed, profile: { ...withNamed.profile, ageLevel: fromLeague } };
  const fromNames = withOpponentAge(withLeague);
  /*
   * And last, the age the pool already files this team's opponents at.
   *
   * Below the name reading above it, and for a reason worth stating: a club that writes "12U" in
   * its own name is telling you something about itself, while this is telling you about the
   * company it keeps. But it reaches where the name rule cannot. The closed league where nobody
   * writes an age in anything is the backlog's largest population and its most hopeless one —
   * `ageFromOpponentNames` can never settle a team whose opponents are all called "Team 4" — and
   * this settles it the moment any of those opponents has been filed by another route.
   */
  const fromPool =
    profileAgeLevel(fromNames.schedule.profile) === undefined
      ? ageFromPooledOpponents(fromNames.schedule.games, index, MIN_OPPONENT_AGE_EVIDENCE)
      : undefined;
  const withPool: GcTeamSchedule =
    fromPool === undefined
      ? fromNames.schedule
      : {
          ...fromNames.schedule,
          profile: { ...fromNames.schedule.profile, ageLevel: fromPool },
        };
  /*
   * And after that, the clubs the games themselves identify. The picture above turned out to be
   * no kind of identifier — every one of 7,948 was different — so it seldom answers; the other
   * halves of this team's games are already in the pool, filed by the clubs that played it.
   */
  const fromFixtures =
    profileAgeLevel(withPool.profile) === undefined
      ? ageFromFixtures(withPool, index, MIN_OPPONENT_AGE_EVIDENCE)
      : undefined;
  const withFixtures: GcTeamSchedule =
    fromFixtures === undefined
      ? withPool
      : { ...withPool, profile: { ...withPool.profile, ageLevel: fromFixtures } };
  /*
   * And very last, an age the name writes against its other words or without its U — "Spiders12U",
   * "10U_Hartman", "Giants 11-12". Last of everything rather than beside the name reader, so a team
   * anything else can age is aged by that, and no team the pool already files moves; see
   * `ageLevelFromLooseName`. Never against GameChanger's own band.
   */
  const loose =
    profileAgeLevel(withFixtures.profile) === undefined
      ? ageLevelFromLooseName(withFixtures.profile.name)
      : undefined;
  const fromLooseName =
    loose !== undefined && ageFitsBand(loose, withFixtures.profile.ageLabel) ? loose : undefined;
  const schedule: GcTeamSchedule =
    fromLooseName === undefined
      ? withFixtures
      : { ...withFixtures, profile: { ...withFixtures.profile, ageLevel: fromLooseName } };
  const inferred = fromNames.inferred ?? fromPool ?? fromFixtures;
  const { profile } = schedule;
  const base: GcImportOutcome = {
    gcTeamId: profile.id,
    teamName: profile.name,
    teamId: "",
    ageGroupId: "",
    ageGroupName: "",
    createdAgeGroup: false,
    createdTeam: false,
    gamesAdded: 0,
    gamesUpdated: 0,
    gamesUnchanged: 0,
    gamesIgnored: 0,
    gamesOutOfSeason: 0,
    opponentsCreated: 0,
    opponentsMatchedByAvatar: 0,
    opponentsMatchedByName: 0,
    ...(inferred === undefined ? {} : { ageFromOpponents: inferred }),
    ...(named === undefined ? {} : { ageNamedByUser: named }),
    ...(fromLeague === undefined ? {} : { ageFromLeague: fromLeague }),
    ...(fromFixtures === undefined ? {} : { ageFromFixtures: fromFixtures }),
    ...(fromLooseName === undefined ? {} : { ageFromLooseName: fromLooseName }),
  };

  /*
   * A club the user threw out, refused before a single game is read off it. Nothing later can do
   * this: the games would be filed, the team rebuilt from the profile, and the deletion undone by
   * the very pull that was meant to keep the pool clean.
   */
  if (isDeletedClub(droppedClubs, profile.id)) {
    return {
      state,
      outcome: {
        ...base,
        skip: "deleted",
        issue: "You deleted this club, so its schedule was not read.",
      },
    };
  }

  /*
   * A club GameChanger has already told us is too young, refused without reading its schedule.
   * The age is a fact about the squad and a GameChanger id is minted per team per season, so it
   * cannot come good as the club ages up — next year is a different id.
   */
  if (isTooYoungClub(tooYoung, profile.id)) {
    return {
      state,
      outcome: {
        ...base,
        skip: "below-min-age",
        issue: `This club is below ${MIN_AGE_LEVEL}U, so its schedule was not read again.`,
      },
    };
  }

  /*
   * A team from a season this pull was not asked for. Refused ahead of its age for the reason the
   * invented schedule below is: a team with no age would otherwise join the waiting list and be
   * asked about every week for a season nobody wanted. GameChanger's own season decides it, since
   * the list's column is a claim about the id and this is the answer. A team GameChanger gives no
   * season at all is left to the refusal that already says so, a few lines on.
   */
  if (
    options.seasonYears &&
    profile.season &&
    seasonYear !== undefined &&
    !options.seasonYears.has(seasonYear)
  ) {
    return {
      state,
      outcome: {
        ...base,
        skip: "other-season",
        otherSeasonYear: seasonYear,
        issue: `${formatGcSeason(profile.season)} falls in the ${seasonYear} season, which this pull was not asked for, so its schedule was not read.`,
      },
    };
  }

  /*
   * A schedule nothing on which has happened yet and all of which already has a result. Refused
   * here, ahead of its age, because the age is the wrong question for it: an invented team with
   * no age would otherwise join the waiting list and be asked about every week, and one with an
   * age would file results nobody played. `inventedFromOutcomes` hands the id on to be remembered,
   * so the refusal outlasts the dates that give it away.
   */
  if (isInventedSchedule(schedule.games, options.today ?? todayIsoDay())) {
    return {
      state,
      outcome: {
        ...base,
        skip: "invented",
        issue:
          "Every game on its schedule has a result on a day that has not happened, so it was thrown out as invented.",
      },
    };
  }

  /*
   * The owner's word on a club beats a word in its name, at the door as in the tidy: a club on the
   * real list, the user's own, a page's own team, or one League Standings links, whose GameChanger
   * name happens to read as a practice or a tryout ("Workout Warriors"), is filed as any other.
   */
  const vouched = real.has(profile.id) || vouchedFor(index.teamByGcId.get(profile.id));
  const resolved = resolveAgeGroup(profile, state, seasonYear, vouched);
  if (!resolved) {
    const why = skipReason(profile, vouched);
    /*
     * A team nobody could age is filed nowhere and leaves no trace in the pool, so this outcome is
     * the only thing that ever escapes with what GameChanger said about it. Somebody has to look
     * at these by hand eventually, and the schedule that is in hand right here — the opponent
     * names, the dates, the scores, the roster count — is what they will need to tell a rec-league
     * team from an invention. Computed only for "no age", because it is the only refusal anyone
     * is ever asked to reconsider.
     */
    const today = options.today ?? todayIsoDay();
    /*
     * A team with nothing on its schedule is only worth asking about again in its own season, when
     * the schedule is a thing somebody has yet to write. From a season that is over or not begun,
     * nothing changes week to week, so it leaves the list rather than being asked every week —
     * and is not remembered, so the pull that meets it in its season files it as normal. A team
     * whose season GameChanger does not say is asked about as before.
     */
    if (
      why.code === "no-age" &&
      schedule.games.length === 0 &&
      profile.season &&
      !gcSeasonIsCurrent(profile.season, today)
    ) {
      return {
        state,
        outcome: {
          ...base,
          skip: "out-of-season",
          issue: `No age and no games, and its season (${formatGcSeason(profile.season)}) is not the one being played, so it was left for a later pull.`,
        },
      };
    }
    const evidence =
      why.code === "no-age" ? agelessEvidence(profile, schedule.games, today) : undefined;
    return {
      state,
      outcome: {
        ...base,
        skip: why.code,
        issue: why.message,
        ...(evidence ? { noAgeEvidence: evidence } : {}),
      },
    };
  }

  const { group, created: createdAgeGroup } = resolved;
  if (createdAgeGroup) noteAgeGroup(index, group);
  // The working arrays are mutated from here on; the public entry hands in copies.
  const teams = state.teams;
  const games = state.games;
  /*
   * Which rule of the ladder above answered, written on the link so the club's panel can say why
   * it is filed where it is. GameChanger's own reading is a ladder of its own (`ageLevelOf`): a
   * bracket in the name outranks the age field, and a name is read when the field says nothing,
   * so the field is read alone to tell which of the two it was.
   */
  const ageFrom: GcAgeSource | undefined =
    named !== undefined
      ? "you"
      : gcSaysNow !== undefined
        ? ageSpanFromName(original.profile.name) === undefined &&
          ageLevelOf(original.profile.ageLabel, "", seasonYear) === gcSaysNow
          ? "gamechanger"
          : "name"
        : fromLeague !== undefined
          ? "list"
          : fromNames.inferred !== undefined
            ? "opponents"
            : fromPool !== undefined
              ? "pool"
              : fromFixtures !== undefined
                ? "fixtures"
                : fromLooseName !== undefined
                  ? "name"
                  : undefined;
  const own = resolveOwnTeam(schedule, group.id, teams, index, ageFrom);
  const ourLevel = profileAgeLevel(profile);
  const outcome: GcImportOutcome = {
    ...base,
    teamId: own.teamId,
    ageGroupId: group.id,
    ageGroupName: group.name,
    createdAgeGroup,
    createdTeam: own.created,
  };

  const ageGroups = resolved.ageGroups;

  const squadYear = ageGroupYear(group);
  /*
   * The games this schedule's rows have matched from another schedule's copy, by the row that
   * matched each. One schedule lists one game once, so a second row off it is a second game unless
   * it is that same game listed twice — however close a doubleheader's other slot sits to it — and
   * the row that matched first is what says whether it is.
   */
  const claimed = new Map<string, ScoutGame>();
  // Same id, same pool, same pair, same date, so nothing a game is filed under moves.
  const writeInPlace = (previous: ScoutGame, next: ScoutGame) => {
    const position = index.gamePos.get(previous.id);
    if (position !== undefined) games[position] = next;
    index.gamesById.set(next.id, next);
    indexFolded(index, next);
    indexHalf(index, next);
    const sameBucket = index.gamesByMatch.get(matchKeyOf(next, index.poolKeyOf));
    if (sameBucket) {
      const at = sameBucket.findIndex((entry) => entry.id === next.id);
      if (at >= 0) sameBucket[at] = next;
    }
  };
  /*
   * The same, for a game its own schedule has moved to another day: what is keyed by the day moves
   * with it. The rows folded into it that were filed on its old day move too, as the game their
   * clubs' schedules described (`FoldedRow.date` is only for a row filed a day off its game).
   */
  const refileInPlace = (previous: ScoutGame, moved: ScoutGame) => {
    const rows = (moved.alsoRows ?? []).map((record) => {
      /*
       * A claimed row (`FoldedRow.filedAgainst`) is on its own schedule's day, not on the day of the
       * copy that claimed it: the copy moving takes the game to another day and leaves that row
       * where its schedule put it. Carried along, the row went back to the team it was filed
       * against on the copy's new day, beside its own schedule's start on the old one.
       */
      if (
        record.filedAgainst !== undefined &&
        record.date === undefined &&
        previous.date !== undefined &&
        previous.date !== moved.date
      ) {
        const { teamId, gameId, startTs, ...rest } = record;
        return { teamId, gameId, ...(startTs ? { startTs } : {}), date: previous.date, ...rest };
      }
      if (record.date !== moved.date) return record;
      const { date: _same, ...rest } = record;
      return rest;
    });
    const next: ScoutGame = rows.length > 0 ? { ...moved, alsoRows: rows } : moved;
    const without = <K>(map: Map<K, ScoutGame[]>, key: K) => {
      const list = map.get(key);
      if (!list) return;
      const kept = list.filter((entry) => entry.id !== previous.id);
      if (kept.length > 0) map.set(key, kept);
      else map.delete(key);
    };
    without(index.gamesByMatch, matchKeyOf(previous, index.poolKeyOf));
    push(index.gamesByMatch, matchKeyOf(next, index.poolKeyOf), next);
    if (previous.date) {
      without(index.gamesByTeamDate, `${previous.teamAId}\u0000${previous.date}`);
      without(index.gamesByTeamDate, `${previous.teamBId}\u0000${previous.date}`);
    }
    if (next.date) {
      push(index.gamesByTeamDate, `${next.teamAId}\u0000${next.date}`, next);
      push(index.gamesByTeamDate, `${next.teamBId}\u0000${next.date}`, next);
    }
    const position = index.gamePos.get(previous.id);
    if (position !== undefined) games[position] = next;
    index.gamesById.set(next.id, next);
    indexFolded(index, next);
    indexHalf(index, next);
  };
  /** Every row this pull filed or matched, so a record of one it no longer lists can go. */
  const seen = new Set<string>();
  /** Rows found folded into a game with nothing to say where they were filed (`filedMarkFor`). */
  const unmarkedFolds: {
    holderId: string;
    game: GcGame;
    candidate: ScoutGame;
    theirLevel: number | undefined;
  }[] = [];
  /** Every row this schedule lists now, by id, so a game whose own row it dropped can be told. */
  const listed = new Map(
    schedule.games.filter(isFilable).map((game) => [gcGameId(profile.id, game.id), game])
  );
  /*
   * The listed rows the opponent gate turned away for a drop word in the name. Counted as listed,
   * they kept a game filed on them before the rule from ever being withdrawn, and only the gate
   * reads a row's own name. A stand-in is stored under the cleaned name, so "Rowanberry Rooks
   * (Scrimmage)" stood against plain "Rowanberry Rooks", which the tidy reads as a plain name and
   * keeps. Read as no longer listed (below), the game goes as a row a schedule drops goes, and the
   * pool is the one a fresh pull of the schedule makes.
   */
  const refused = new Set<string>();
  for (const game of schedule.games) {
    if (!isFilable(game)) {
      outcome.gamesIgnored += 1;
      continue;
    }
    // A game before August 1 of the year the squad year starts is last year's squad's, however
    // GameChanger lists it. Filed nowhere: it would count on this year's table at this level.
    if (!inSquadYear(game.date, squadYear)) {
      outcome.gamesOutOfSeason += 1;
      continue;
    }

    /*
     * This schedule's own copy of this game, if it has been pulled before. Found first, because the
     * opponent it already settled on is the answer — working it out again on a name that is
     * ambiguous would mint a fresh team, and a weekly re-pull would do that every week forever.
     */
    const byId = index.gamesById.get(gcGameId(profile.id, game.id));
    /*
     * Or the game this row was folded into, the last time it came: the other club's copy of it, or
     * this schedule's own copy listed twice. That is the same game whatever its start and result
     * say now, and it is found by id rather than asked about again.
     */
    const foldedId = byId ? undefined : index.foldedInto.get(gcGameId(profile.id, game.id));
    const foldedGame = foldedId === undefined ? undefined : index.gamesById.get(foldedId);
    // Only while this club is still on it: a game since moved to another club is not its copy.
    const onIt =
      foldedGame && (foldedGame.teamAId === own.teamId || foldedGame.teamBId === own.teamId)
        ? foldedGame
        : undefined;
    // A game standing on this very row under an earlier row's id, since that row went, is its own.
    const standsHere =
      onIt?.source?.teamId === profile.id && onIt.source.gameId === game.id ? onIt : undefined;
    const known = byId ?? standsHere;
    const folded = standsHere ? undefined : onIt;
    // A row folded into a game names its opponent too: the game's other side.
    const placedIn = known ?? folded;
    const knownOpponentId = placedIn
      ? placedIn.teamAId === own.teamId
        ? placedIn.teamBId
        : placedIn.teamAId
      : undefined;

    /*
     * A wiffle ball opponent takes the game with it. The result is not a baseball result, and
     * keeping it would both count for the club that played it and mint a wiffle team in the pool
     * off the back of somebody else's schedule — the one route by which one could arrive without
     * ever having been pulled.
     */
    if (isNotBaseball(game.opponentName)) {
      outcome.gamesIgnored += 1;
      continue;
    }

    /*
     * An opponent whose name says it is no team takes the game with it, on the same terms: a
     * practice, a scrimmage, a tryout or a squad playing itself is not a result for the club that
     * played it, and keeping it would mint the page in the pool off somebody else's schedule. Not
     * an old page's name (`OpponentGate`): that is a real team's old page, and its game is filed
     * against a slot of its own (`planOpponent`).
     */
    const word = notATeamWord(game.opponentName);
    /*
     * ...unless the name is a club the owner vouched for in this pool, filed then as any name is:
     * its games are real to them, and this row is the other side's word on one, which the club's
     * games keep as it confirms them. Only the club's own game that day takes it, as any name-filed
     * row; one its schedule does not bear out stands against a stand-in of the name, which the tidy
     * keeps as it keeps the club (`namedAfterSpared`), for the refile and claim steps to settle as
     * they settle any stand-in. Deleted, it took the game, and the next pull filed the row again
     * with nothing to stop it, every night. An old page's word needs no such reading:
     * its slot gate already files the row onto the one pulled club of the name that played that day.
     * Read only for a name a rule hits, which is few.
     *
     * Only where the club's own names carry the word the row hit (`carriesWord`): the club whose
     * name reads as a tryout. A row that puts the word in a bracket beside a plain club's name,
     * "(Scrimmage)", keys as that club, but says the game was a scrimmage, and goes as one would
     * against a club nobody vouched for. Let through, it went onto the club on a day it played, a
     * game more than its schedule lists, or onto a stand-in stored without the bracket, which the
     * tidy then read as a plain name and kept.
     */
    const namesVouched =
      word?.opponent === "drop" &&
      (
        index.teamIdsByPoolName.get(
          `${index.poolKeyOf(group.id)}\u0000${teamNameKey(game.opponentName)}`
        ) ?? []
      ).some((id) => {
        const team = index.teamsById.get(id);
        return team !== undefined && vouchedFor(team) && carriesWord(team, word.word);
      });
    if (word?.opponent === "drop" && !namesVouched) {
      outcome.gamesIgnored += 1;
      if (!options.realClubsShort) refused.add(gcGameId(profile.id, game.id));
      continue;
    }

    /*
     * A high school opponent takes the game with it, for the second of those two reasons rather
     * than the first. The result is a real baseball result — a travel side really did play the
     * local varsity — but the opponent is a club this app refuses, and keeping the row would mint
     * it into the pool off the back of somebody else's schedule. That is the one route by which a
     * refused team could arrive without ever having been pulled, and it would arrive un-refusable,
     * because nothing downstream re-reads an opponent's name.
     */
    if (isSchoolName(game.opponentName)) {
      outcome.gamesIgnored += 1;
      continue;
    }

    /*
     * A row the user has thrown out stays thrown out. Deleting one without this is deleting it
     * until the next pull of the same schedule, which finds it and files it again — and the rows
     * worth deleting are the ones a schedule keeps on offering: a score on a day that has not
     * happened, which cannot be a result and which GameChanger will go on reporting. Before its
     * opponent is looked for, too: a name nothing answered made a stand-in on every pull, for a
     * row that was never filed, and nothing took the stand-ins out again.
     */
    if (isDeletedGame(deleted, gcGameId(profile.id, game.id))) {
      outcome.gamesUnchanged += 1;
      continue;
    }

    let opponentId = knownOpponentId;
    /*
     * The other club's copy holding this schedule on record with no row kept (`alsoFrom` alone, from
     * before rows were kept), where this row is one its name files against nobody the pool knows,
     * within the hour of the copy and not scored apart from it (`heldOnRecord`). The record stood
     * for a row of this schedule's that day, and this is it: it goes back on record there, whole,
     * as it would have stayed had rows been kept. Filed as a game of its own, the record came off
     * (below), and the tidy could pair the copy with this club's other game against that club that
     * day, a 3-12 folded into a 6-3, where the kept row held the day apart.
     */
    let onRecord: ScoutGame | undefined;
    if (opponentId === undefined) {
      const plan = planOpponent(
        game,
        group.id,
        index,
        own.teamId,
        profile.id,
        true,
        options.notThisTeam
      );
      const named = "teamId" in plan ? index.teamsById.get(plan.teamId) : undefined;
      if ("create" in plan || named?.placeholder || isStandIn(named)) {
        onRecord = heldOnRecord(index, game, own.teamId, profile.id);
      }
      if (onRecord) {
        opponentId = onRecord.teamAId === own.teamId ? onRecord.teamBId : onRecord.teamAId;
      } else {
        opponentId = teamOfPlan(plan, game.opponentName, index, teams);
        if (plan.basis === "created") outcome.opponentsCreated += 1;
        else if (plan.basis === "avatar") outcome.opponentsMatchedByAvatar += 1;
        else outcome.opponentsMatchedByName += 1;
      }
    }
    /*
     * A pulled club this row names by its picture is that club whoever else carries its name
     * (`ScoutGame.namedByAvatar`): so on arrival, and on a later pull of a row already filed against
     * the club its picture names, which is how a row filed before the picture was kept comes to
     * carry it.
     */
    const byPicture =
      game.opponentAvatarKey === undefined
        ? undefined
        : index.teamsByAvatar.get(game.opponentAvatarKey);
    /** The pulled club the picture names, where it names exactly one. */
    const pictured =
      byPicture?.length === 1 && byPicture[0]!.gcTeams?.length ? byPicture[0]!.id : undefined;
    const namedByAvatar =
      pictured !== undefined && pictured === opponentId ? opponentId : undefined;

    /*
     * Their level is only ever a guess from the name; ours is what GameChanger said.
     *
     * A graduating class counts as one of those guesses. Above about 13U most names carry a year
     * rather than an age — "Elite 2031" — and reading nothing from them left the game with no
     * level for that side at all, which the rating reads as a game between equals: a 16U side
     * playing the class of 2031 was recorded as a same-level game, so no age adjustment was made
     * and `crossAgeGames` counted it as none. The year is read against the squad year of the page
     * the game is filed under, which is the season both sides were playing.
     */
    const theirYear = ageGroupYear(group);
    const theirLevel =
      ageLevelFromName(game.opponentName) ??
      (theirYear === undefined ? undefined : ageFromGradYearInName(game.opponentName, theirYear));
    const candidate: ScoutGame = {
      id: gcGameId(profile.id, game.id),
      teamAId: own.teamId,
      teamBId: opponentId,
      ageGroupId: group.id,
      ...(game.teamScore === undefined ? {} : { teamAScore: game.teamScore }),
      ...(game.opponentScore === undefined ? {} : { teamBScore: game.opponentScore }),
      ...(game.date ? { date: game.date } : {}),
      ...(ourLevel === undefined ? {} : { ageLevelA: ourLevel }),
      ...(theirLevel === undefined ? {} : { ageLevelB: theirLevel }),
      ...(profile.season ? { season: formatGcSeason(profile.season) } : {}),
      ...(game.startTs ? { startTs: game.startTs } : {}),
      ...(namedByAvatar === undefined ? {} : { namedByAvatar }),
      source: { kind: "gamechanger", teamId: profile.id, gameId: game.id },
    };

    seen.add(candidate.id);

    /*
     * A row folded into a game: its record there takes what the schedule now says, and side B's own
     * score goes beside side A's. Nothing else is decided here. Whether the row still belongs to
     * that game is the tidy's to say, with every row of the day in front of it
     * (`collapseSameGames`), and it moves the row or stands it up as a game of its own if a start
     * or a score now says otherwise.
     */
    if (folded) {
      claimed.set(folded.id, candidate);
      /*
       * A row filed on its game's day that its schedule has moved stays with the game: the game
       * moves when its own row does (`refileInPlace`), and a record dated apart from it here stood
       * up on the new day beside a game still on the old one — one rescheduled game counted twice.
       * A row already filed a day off its game (`FoldedRow.date`) keeps its schedule's day, and so
       * does a claimed row (`FoldedRow.filedAgainst`), which is not the game's copy by its id but a
       * row the claim reads by its day and start, and goes back if they stop fitting.
       */
      const record = (folded.alsoRows ?? []).find(
        (entry) => gcRowId(entry.teamId, entry.gameId) === candidate.id
      );
      // The record keeps the club the row's picture named as a row filed on its own does
      // (`withPictureOf`): through a pull with no picture, and not past one naming another club.
      // A claimed row's club is the team it goes back to as well (`FoldedRow.filedAgainst`), so a
      // row stood back up there is still the row that named it.
      const named = pictureNow(record?.namedByAvatar, pictured, [
        candidate.teamBId,
        record?.filedAgainst,
      ]);
      const pictureKept =
        named === candidate.namedByAvatar ? candidate : { ...candidate, namedByAvatar: named };
      const updated = withSchedulesOf(
        folded,
        record &&
          record.date === undefined &&
          record.filedAgainst === undefined &&
          folded.date !== undefined
          ? { ...pictureKept, date: folded.date }
          : pictureKept
      );
      /*
       * This schedule's own game whose own row the schedule no longer lists — deleted, and entered
       * again under a new id. The game stands on this row from now: its source is this row, which
       * comes off the record, and its result and start are what this row says, set or cleared, the
       * deleted row's going with it. Kept as a record beside a row nobody lists, a correction to it
       * never reached the game — a 6-0 re-entered and put right as 7-0 stayed 6-0 — and one entered
       * again all day was split from the row it replaced, counted twice. The id stays, so nothing
       * filed against it moves; the index finds the game by this row's id. A second listing of a
       * game whose own row is still listed gives the game its score through the tidy instead, marked
       * as that listing's (`scoreFromTwin`), so it goes with the listing.
       */
      const ownSchedule = folded.source?.teamId === profile.id;
      const orphaned = ownSchedule && !listed.has(gcGameId(profile.id, folded.source!.gameId));
      const reentered: ScoutGame = orphaned
        ? (() => {
            const {
              alsoRows,
              scoreFromB,
              scoreFromTwin: _twin,
              startTs: _start,
              teamAScore,
              teamBScore,
              ...rest
            } = updated;
            const rows = (alsoRows ?? []).filter(
              (record) => gcRowId(record.teamId, record.gameId) !== candidate.id
            );
            const scores = scoresAsExisting(updated, candidate);
            return {
              ...rest,
              source: candidate.source!,
              ...(isScored(candidate)
                ? { teamAScore: scores.a, teamBScore: scores.b }
                : scoreFromB
                  ? { teamAScore, teamBScore, scoreFromB }
                  : {}),
              ...(candidate.startTs ? { startTs: candidate.startTs } : {}),
              ...(candidate.date ? { date: candidate.date } : {}),
              ...(rows.length > 0 ? { alsoRows: rows } : {}),
            };
          })()
        : updated;
      const next = withSideBReport(reentered, candidate) ?? reentered;
      if (record && record.filedAgainst === undefined) {
        unmarkedFolds.push({ holderId: folded.id, game, candidate, theirLevel });
      }
      const before = scoreSeenBy(folded, candidate.teamAId);
      const after = scoreSeenBy(next, candidate.teamAId);
      if (next.date !== folded.date) refileInPlace(folded, next);
      else if (next !== folded) writeInPlace(folded, next);
      if (before?.own !== after?.own || before?.opponent !== after?.opponent) {
        outcome.gamesUpdated += 1;
      } else {
        outcome.gamesUnchanged += 1;
      }
      continue;
    }

    // Two ways the game may already be here. The same schedule's same game id is certainly it —
    // and `matchExistingGame` will not find that one, because it looks for a *different* row
    // meaning the same thing. Failing that, the other team's copy of the game.
    const existing =
      known ??
      onRecord ??
      matchExistingGame(
        candidate,
        index.gamesByMatch.get(matchKeyOf(candidate, index.poolKeyOf)) ?? [],
        ageGroups,
        (game) => {
          const evidence = sameGameEvidence(candidate, game);
          if (evidence === undefined) return false;
          // Taken by a row off this schedule already: only as that same game listed twice.
          const earlier = claimed.get(game.id);
          if (earlier !== undefined) return sameGameEvidence(candidate, earlier) !== undefined;
          return mayTakeRow(game, candidate, evidence);
        }
      );
    // Back on record as it was folded, for the note to read as any fold with nothing to say where
    // its row was filed (`filedMarkFor`).
    if (onRecord) unmarkedFolds.push({ holderId: onRecord.id, game, candidate, theirLevel });
    if (!existing) {
      addGame(index, games, candidate);
      outcome.gamesAdded += 1;
      continue;
    }
    if (existing !== known) claimed.set(existing.id, candidate);
    /*
     * A start this schedule has since moved is taken, on its own row only. Every later comparison
     * reads the stored start, and one left behind made the next copy of the game look like another
     * game. Another schedule's start is never written over a row: that is the other coach's clock.
     */
    const moved =
      existing === known &&
      candidate.startTs !== undefined &&
      !sameStart(existing.startTs, candidate.startTs);
    /*
     * And a day it has since moved the game to, the same way: kept on the old day, the game stayed
     * there while the other club's copy of it, moved too, stood up on the new one.
     */
    const redated =
      existing === known && candidate.date !== undefined && candidate.date !== existing.date;
    /*
     * Another schedule's copy of a game leaves its schedule on record, which is how the tidy's
     * count knows this game already took this club's row for the day (`withSchedulesOf`).
     */
    const recorded =
      existing === known
        ? withPictureOf(existing, candidate, pictured)
        : withSchedulesOf(existing, candidate);
    /*
     * The other club's own copy of the game: its score goes beside this one's rather than over it
     * (`withSideBReport`), so neither club's schedule speaks for the other's and the score no longer
     * flips to whichever of the two was pulled last. Only a change to what that club's own page
     * shows is news; the rest is bookkeeping.
     */
    const reported = existing === known ? undefined : withSideBReport(recorded, candidate);
    if (reported) {
      const before = scoreSeenBy(existing, candidate.teamAId);
      const after = scoreSeenBy(reported, candidate.teamAId);
      if (reported !== existing) writeInPlace(existing, reported);
      if (before?.own !== after?.own || before?.opponent !== after?.opponent) {
        outcome.gamesUpdated += 1;
      } else {
        outcome.gamesUnchanged += 1;
      }
      continue;
    }
    /*
     * This schedule's second listing of a game it already has: its score fills the game where the
     * row the game stands on has none of its own, marked as the listing's (`scoreFromTwin`) so it
     * goes with the listing, and is noted beside one it disagrees with — as the tidy has it
     * (`collapseSameGames`). Written over the game's own score, the listing's was then read as the
     * game's own row's, and neither a correction to the listing nor the listing proving to be a
     * second game ever took it back.
     */
    if (existing !== known && existing.source?.teamId === profile.id) {
      const own = isScored(existing) && !existing.scoreFromB && !existing.scoreFromTwin;
      const scores = scoresAsExisting(existing, candidate);
      const next: ScoutGame = !isScored(candidate)
        ? recorded
        : !own
          ? (() => {
              const { scoreFromB: _borrowed, scoreFromTwin: _twin, ...rest } = recorded;
              return { ...rest, teamAScore: scores.a, teamBScore: scores.b, scoreFromTwin: true };
            })()
          : existing.teamAScore !== scores.a || existing.teamBScore !== scores.b
            ? {
                ...recorded,
                note: withNote(recorded.note, `Also reported ${scores.a}-${scores.b}.`),
              }
            : recorded;
      const before = scoreSeenBy(existing, candidate.teamAId);
      const after = scoreSeenBy(next, candidate.teamAId);
      if (next !== existing) writeInPlace(existing, next);
      if (before?.own !== after?.own || before?.opponent !== after?.opponent) {
        outcome.gamesUpdated += 1;
      } else {
        outcome.gamesUnchanged += 1;
      }
      continue;
    }
    /*
     * Side A posting its own score over one borrowed from side B's schedule: the score is its own
     * now, even where it is the same one, and must not go with side B's row (`scoreFromB`).
     */
    const ownAtLast =
      existing === known &&
      isScored(candidate) &&
      (existing.scoreFromB === true || existing.scoreFromTwin === true);
    if (!differs(existing, candidate) && !moved && !redated && !ownAtLast) {
      // The record is bookkeeping, not news: nothing the reader would call a change.
      if (recorded !== existing) writeInPlace(existing, recorded);
      outcome.gamesUnchanged += 1;
      continue;
    }
    /*
     * The existing row keeps its id and its side order; only what the pull actually learned is
     * written. In particular an unscored copy leaves the score alone: GameChanger posts a result on
     * one team's schedule before the other's, so the opponent's copy of a game that has been played
     * routinely arrives with nothing in it, and writing that over a real result would erase it.
     */
    const scores = scoresAsExisting(existing, candidate);
    /*
     * A result written over a different result is not a correction, it is a disagreement, and it
     * has to stay visible. Two rows for one fixture can report different scores — GameChanger
     * lists a game twice and the two copies do not always agree — and silently keeping the later
     * one would leave a club's record resting on whichever row happened to arrive second.
     *
     * Noted the way `collapseSameGames` notes the same thing when the two sides of a fixture
     * disagree, so there is one convention for it rather than two.
     */
    const displaced =
      !existing.scoreFromB &&
      !existing.scoreFromTwin &&
      isScored(candidate) &&
      isScored(existing) &&
      (existing.teamAScore !== scores.a || existing.teamBScore !== scores.b)
        ? `Also reported ${existing.teamAScore}-${existing.teamBScore}.`
        : undefined;
    const { scoreFromB: _borrowed, scoreFromTwin: _twin, ...unborrowed } = recorded;
    /*
     * A game the namesake join made, on its own schedule's pull: the age that schedule types for
     * side B now is the one to put back (`joinedFromLevel`), as `differs` reads it. Kept at the age
     * typed when it was joined, every pull after counted the game updated again, and a join taken
     * back put the row back at an age its schedule no longer says. Side B's own level stays.
     */
    const kept = ownAtLast ? unborrowed : recorded;
    const { joinedFromLevel: _typed, ...untyped } = kept;
    const joined = existing === known && existing.joinedFrom !== undefined;
    const base = joined
      ? candidate.ageLevelB === undefined
        ? untyped
        : { ...kept, joinedFromLevel: candidate.ageLevelB }
      : kept;
    const merged: ScoutGame = {
      ...base,
      ...(isScored(candidate) ? { teamAScore: scores.a, teamBScore: scores.b } : {}),
      ...(candidate.season ? { season: candidate.season } : {}),
      ...(displaced ? { note: withNote(existing.note, displaced) } : {}),
      ...(moved ? { startTs: candidate.startTs } : {}),
      ...(redated ? { date: candidate.date } : {}),
    };
    if (redated) refileInPlace(existing, merged);
    else writeInPlace(existing, merged);
    outcome.gamesUpdated += 1;
  }

  /*
   * The other club's copy holding a row of this schedule with nothing to say where the row was
   * filed, whose name says it was filed against somebody else (`filedMarkFor`): marked as the claim
   * it is, so the claim step can give it back. Read once every row of the answer is in the pool, as
   * a row it waits on, or one standing under the same name, may come later in the answer than the
   * fold does. A team is made for the name only here, once the mark is decided, and noted as the row
   * standing against it would have been.
   */
  if (unmarkedFolds.length > 0) {
    const standingByName = new Map<string, Set<string>>();
    (index.gamesBySchedule.get(profile.id) ?? new Set<string>()).forEach((gameId) => {
      const standing = index.gamesById.get(gameId);
      if (standing?.source?.teamId !== profile.id) return;
      const typed = listed.get(gcGameId(profile.id, standing.source.gameId));
      if (!typed) return;
      const against = standing.teamAId === own.teamId ? standing.teamBId : standing.teamAId;
      const key = teamNameKey(typed.opponentName);
      const bucket = standingByName.get(key);
      if (bucket) bucket.add(against);
      else standingByName.set(key, new Set([against]));
    });
    const marks = unmarkedFolds.flatMap(({ holderId, game, candidate, theirLevel }) => {
      const holder = index.gamesById.get(holderId);
      const record = holder?.alsoRows?.find(
        (entry) => gcRowId(entry.teamId, entry.gameId) === candidate.id
      );
      if (!holder || !record) return [];
      const plan = filedMarkFor(index, {
        game,
        candidate,
        holder,
        record,
        ownTeamId: own.teamId,
        sourceTeamId: profile.id,
        ageGroupId: group.id,
        theirLevel,
        standingByName,
      });
      return plan ? [{ holder, game, candidate, theirLevel, plan }] : [];
    });
    type Mark = (typeof marks)[number];
    /*
     * Rows naming one team on one day go to one club or none (`claimFiledRows`). Marks under one
     * name that day in two clubs' copies, or beside a claim of this club's against that team in
     * another club's copy, were all stood back up by the claim step, each beside the copy it had
     * been in: two games, each counted twice.
     */
    const nameOf = (mark: Mark) =>
      "teamId" in mark.plan ? mark.plan.teamId : `\u0000${teamNameKey(mark.game.opponentName)}`;
    const dayOf = (mark: Mark) => `${mark.candidate.date}\u0000${nameOf(mark)}`;
    const clubsOn = new Map<string, Set<string>>();
    const onDay = (key: string, clubId: string) => {
      const bucket = clubsOn.get(key);
      if (bucket) bucket.add(clubId);
      else clubsOn.set(key, new Set([clubId]));
    };
    marks.forEach((mark) => {
      onDay(dayOf(mark), mark.holder.teamAId);
      if (!("teamId" in mark.plan)) return;
      const against = mark.plan.teamId;
      (index.gamesByTeamDate.get(`${own.teamId}\u0000${mark.candidate.date}`) ?? []).forEach(
        (stale) => {
          const other = index.gamesById.get(stale.id);
          other?.alsoRows?.forEach((record) => {
            if (record.filedAgainst !== against) return;
            if (index.teamByGcId.get(record.teamId)?.id !== own.teamId) return;
            onDay(dayOf(mark), record.onSideB ? other.teamAId : other.teamBId);
          });
        }
      );
    });
    /** The team each name is marked against: made once, where the plan makes one. */
    const markedAgainst = new Map<string, string>();
    marks.forEach((mark) => {
      if ((clubsOn.get(dayOf(mark))?.size ?? 0) > 1) return;
      let against = markedAgainst.get(nameOf(mark));
      if (against === undefined) {
        against = teamOfPlan(mark.plan, mark.game.opponentName, index, teams);
        if ("create" in mark.plan) {
          noteInPool(index, group.id, against, mark.theirLevel ?? index.levelOf(group.id));
          noteOpponent(index, own.teamId, against);
          noteOpponent(index, against, own.teamId);
          outcome.opponentsCreated += 1;
        }
        markedAgainst.set(nameOf(mark), against);
      }
      const holder = index.gamesById.get(mark.holder.id) ?? mark.holder;
      writeInPlace(holder, withFiledMark(holder, mark.candidate.id, against, mark.theirLevel));
    });
  }

  /*
   * What this answer can say is gone. Nothing, from an answer with no row it could file: every row
   * undated, or cancelled, is as likely a field GameChanger renamed as a club that cancelled its
   * season, and trusting it took a club's every game. And not a row the answer held in a shape this
   * app could not read — an entry with no opponent (`rowIds`) — which is not a row it dropped.
   */
  const readable = new Set(schedule.games.map((game) => gcGameId(profile.id, game.id)));
  const returned = schedule.rowIds
    ? new Set(schedule.rowIds.map((id) => gcGameId(profile.id, id)))
    : undefined;
  const unread = (rowId: string) =>
    returned !== undefined && returned.has(rowId) && !readable.has(rowId);
  const trusted = listed.size > 0;

  /*
   * A game standing on a row this schedule no longer lists — deleted, cancelled, moved off the day,
   * or turned away by the opponent gate for a drop word in the name (`refused`, above) — is marked
   * for the tidy to take away, and one standing on a row listed again is unmarked
   * (`ScoutGame.withdrawn`). Not a game holding another row of this schedule's that it still lists:
   * that is the game entered again, which its next pull stands on the new row under the old id (the
   * folded row above). Nor a game that holds another club's copy only as a schedule on record
   * (`alsoFrom`, from before rows were kept): with no row to stand up, that club's copy would go
   * with it until its own next pull.
   */
  if (trusted) {
    const stillListed = (teamId: string, gameId: string) =>
      teamId === profile.id &&
      ((listed.has(gcGameId(teamId, gameId)) && !refused.has(gcGameId(teamId, gameId))) ||
        unread(gcGameId(teamId, gameId)));
    (index.gamesBySchedule.get(profile.id) ?? new Set<string>()).forEach((gameId) => {
      const game = index.gamesById.get(gameId);
      if (!game?.source || game.source.teamId !== profile.id) return;
      const named = new Set((game.alsoRows ?? []).map((record) => record.teamId));
      const onRecordOnly = (game.alsoFrom ?? []).some((schedule) => !named.has(schedule));
      const gone =
        !onRecordOnly &&
        !stillListed(game.source.teamId, game.source.gameId) &&
        !(game.alsoRows ?? []).some((record) => stillListed(record.teamId, record.gameId));
      if (gone === (game.withdrawn === true)) return;
      if (gone) {
        writeInPlace(game, { ...game, withdrawn: true });
      } else {
        const { withdrawn: _gone, ...rest } = game;
        writeInPlace(game, rest);
      }
    });
  }

  /*
   * A record of a row this schedule no longer files — deleted, cancelled, moved off the day — goes,
   * so a game does not go on standing for a row that is not there, and the tidy does not stand up
   * a row nobody lists. From the same answers only, and never a row the answer held unread: an
   * empty answer took the other club's copy out of every game this club's rows were folded into.
   *
   * And this schedule on record in a game with no row of it kept (`alsoFrom` alone, from before
   * rows were kept), where this answer filed no row into the game. Every row it files goes on
   * record whole, so the one the game held on record is a row it no longer files there — deleted,
   * or filed now against another name. Left on record, it answered for this club's row that day
   * with no row to read: the claim step took the game as this club's already, and the row filed
   * against another name, the same game, stood beside it and counted twice. Which row the record
   * stood for is not known, so one the answer held unread cannot keep it.
   */
  (trusted ? (index.recordsBySchedule.get(profile.id) ?? new Set<string>()) : []).forEach(
    (holderId) => {
      const holder = index.gamesById.get(holderId);
      if (!holder) return;
      const rows = holder.alsoRows ?? [];
      const onRecordOnly =
        (holder.alsoFrom ?? []).includes(profile.id) &&
        !rows.some((row) => row.teamId === profile.id);
      const kept = rows.filter(
        (row) =>
          row.teamId !== profile.id ||
          seen.has(gcRowId(row.teamId, row.gameId)) ||
          unread(gcRowId(row.teamId, row.gameId))
      );
      if (kept.length === rows.length && !onRecordOnly) return;
      const named = kept.some((row) => row.teamId === profile.id);
      const alsoFrom = named
        ? holder.alsoFrom
        : (holder.alsoFrom ?? []).filter((source) => source !== profile.id);
      const { alsoRows: _rows, alsoFrom: _from, ...rest } = holder;
      writeInPlace(holder, {
        ...rest,
        ...(alsoFrom && alsoFrom.length > 0 ? { alsoFrom } : {}),
        ...(kept.length > 0 ? { alsoRows: kept } : {}),
      });
    }
  );

  return { state: { ageGroups, teams, games }, outcome };
};

/** Every schedule in turn, each seeing what the ones before it added. */
/**
 * A fold held open across schedules, for a caller that gets them one at a time.
 *
 * `importGcSchedule` is a whole fold in itself: it copies the pool and builds an index of it, uses
 * them once, and throws the index away. That is right for one schedule and ruinous for thousands —
 * a pull calls it per team as each answer lands, so the work is redone over a pool that is growing
 * underneath it, and a run of several thousand spends most of its time rebuilding what it just
 * built. `importGcSchedules` already avoids that, but only for a caller holding every schedule at
 * once, which a pull never is: it folds each one in as it arrives so that stopping keeps what has
 * already been fetched.
 *
 * So this is the same fold with the index kept. One copy, one index, and each schedule costs what
 * it actually adds. `state` is the pool as it stands after everything folded in so far, safe to
 * hand to a save at any point.
 */
export type GcImporter = {
  /** Folds one schedule in and reports what happened to that team. */
  add: (schedule: GcTeamSchedule) => GcImportOutcome;
  /** The pool as it stands. The same arrays the fold is working in, not a copy. */
  readonly state: GcImportState;
};

export const createGcImporter = (
  state: GcImportState,
  options: GcImportOptions = {}
): GcImporter => {
  let next: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const index = buildIndex(next);
  return {
    add: (schedule) => {
      const result = importOne(schedule, next, index, options);
      next = result.state;
      return result.outcome;
    },
    get state() {
      return next;
    },
  };
};

export const importGcSchedules = (
  schedules: GcTeamSchedule[],
  state: GcImportState,
  options: GcImportOptions = {}
): { state: GcImportState; outcomes: GcImportOutcome[] } => {
  // One index and one set of working arrays for the whole fold. Rebuilding either per schedule is
  // what made a large import quadratic: the index turned every lookup into a scan, and copying the
  // arrays turned every added game into a copy of every game before it.
  let next: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const index = buildIndex(next);
  const outcomes: GcImportOutcome[] = [];
  for (const schedule of schedules) {
    const result = importOne(schedule, next, index, options);
    next = result.state;
    outcomes.push(result.outcome);
  }
  return { state: next, outcomes };
};

/**
 * The most rows, and the most copies, one club's day may hold for `resolveSlotGames` to read the
 * day's stand-in rows against the copies its schedules leave out. Every reading is tried, and five
 * a side is under two thousand of them; a day with more is left as it is.
 */
const MISSING_COPY_MAX = 5;

/** The ISO day `days` from `date`, or undefined for a date that is not one. */
const isoDayFrom = (date: string, days: number): string | undefined => {
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(at) ? undefined : new Date(at + days * 86_400_000).toISOString().slice(0, 10);
};

/**
 * A game's day and the day either side of it: where a club's own schedule has to have a game for a
 * name to put one on the club. Two clubs' schedules can date one game a day apart — a late start
 * read across midnight, a date typed a day off — and the collapse joins those copies later
 * (`dayApartStrength`), so a row named a day off the club's own copy of it is left for that.
 */
const aroundDay = (date: string): string[] =>
  [date, isoDayFrom(date, -1), isoDayFrom(date, 1)].filter(
    (day): day is string => day !== undefined
  );

/**
 * The days `game` holds a row of a pulled club's own schedules on, as [club, day]: the game's day
 * for the row it stands on and for a schedule on record with no row kept, and a folded row's own
 * day where it keeps one (`FoldedRow.date`), as a row joined into a copy dated a day off does. Read
 * at the game's day alone, such a club looked to have played on the copy's day and not on its own.
 */
const ownRowDays = (
  game: ScoutGame,
  clubOfSchedule: (schedule: string) => string | undefined
): [string, string][] => {
  const out: [string, string][] = [];
  const note = (schedule: string, day: string | undefined) => {
    const club = clubOfSchedule(schedule);
    if (club !== undefined && day) out.push([club, day]);
  };
  if (game.source) note(game.source.teamId, game.date);
  game.alsoRows?.forEach((record) => note(record.teamId, record.date ?? game.date));
  game.alsoFrom?.forEach((schedule) => {
    if (!game.alsoRows?.some((record) => record.teamId === schedule)) note(schedule, game.date);
  });
  return out;
};

/**
 * Whether the collapse could yet read a club's own row against another club, that no row of the
 * other club's is paired with, as that club's copy of a game: on the copy's own day, whose count
 * settles it, or a day off where the two read as one game across the night (`dayApartStrength`).
 * The claim step waits on such a row before it gives the copy to a row filed by name, and a pull's
 * mark with it (`filedMarkFor`). A row a day off that no reading joins is a game of its own, and
 * waiting on it waited for good. G3 - Bonanno's 3-9 against "CBU" on 19 September 2026 was CBU
 * United Faber Navy's own 9-3 at the same start; the step waited on G3's 1-2 against CBU United at
 * two the next afternoon, which no schedule of theirs lists, and the 3-9 counted twice. On the pool
 * of 24 September 2026 waiting only where the collapse could join left 41 fewer games and moved 73
 * clubs' records: 71 toward GameChanger's own, 46 of them onto it, none off it. On the pool of 26
 * September, pulled since under the rules after it, it was 3 games and 6 records, all toward.
 */
const couldStillBeCopy = (row: ScoutGame, copy: ScoutGame): boolean => {
  if (row.date === copy.date) return true;
  // A score the copy borrowed from side B (`scoreFromB`) is the word of the club whose row this is,
  // lent by a claim into the copy: read as the copy's, it matched the row a day off, the claim that
  // lent it went back, and the pass after made the claim again.
  if (!copy.scoreFromB) return dayApartStrength(row, copy) > 0;
  const { teamAScore: _a, teamBScore: _b, ...unscored } = copy;
  return dayApartStrength(row, unscored) > 0;
};

/**
 * Names the slots that another schedule already answered.
 *
 * A bracket posts "TBD" on one team's schedule and the real fixture on the other's, so the same
 * game arrives twice and disagrees with itself: one row says the club played a placeholder, the
 * other names both sides. Left alone that is a fixture counted twice, and a slot standing where a
 * real opponent belongs. The named row is the better evidence — a schedule that names a club is
 * saying who turned up — so it wins, and the slot's row is folded into it.
 *
 * What makes this safe rather than a guess is where the naming row comes from and when it kicked
 * off. It usually has to come from a *different* GameChanger team's schedule: if a club's own
 * schedule lists both a placeholder and a named opponent that day, those are as a rule two
 * different games it is playing, and neither names the other. Where both rows carry a start time
 * they must agree on it, which is what tells the two halves of a doubleheader apart. Without
 * times, the day has to hold exactly one candidate; anything less certain is left as it is,
 * because a wrong answer here silently moves a result onto a club that never played it.
 *
 * The exception is the clock, and it is not a heuristic. One schedule listing a placeholder and a
 * named opponent at the *same instant* is not two games: nobody plays two at once. That is a
 * bracket slot the club posted before the opponent was known and then posted again once it was,
 * and left alone it stands in the pool as a second result — a phantom extra win or loss on a
 * record that already counts the real one. Every GameChanger row carries the time, because the
 * date is worked out from it, so this costs nothing to ask.
 *
 * The clock also settles a result the two coaches scored differently. A club's own row against a
 * stand-in, and the other club's row naming it at the very same start time, are one game however
 * they were scored, provided the stand-in's name is a shorthand for that other club. On the
 * stand-in fixtures export of 22 September 2026 that held 479 games twice: 358 a single run apart
 * with the same winner, 13 with the winner changed. The named row's result stands and carries the
 * other, as `collapseSameGames` keeps a game two pulled clubs scored apart. Where the names do not
 * fit (303 more) or the slot is a bracket placeholder (143), the two rows stay — unless the named
 * row is one none of the club's own schedules gives a row, which `claimFiledRows` reads later in the
 * tidy by the clock and the scores alone.
 */
export const resolveSlotGames = (
  state: GcImportState,
  /**
   * The names the owner has said are not a club (`notThisTeam.ts`): a slot of such a name settles
   * into no row of the day against that club but the club's own.
   */
  refused: NotThisTeam = NO_REFUSALS
): { state: GcImportState; resolved: number } => {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const fits = nameFitter();
  /*
   * A side nobody has vouched for: a bracket slot, or a club known only because some schedule
   * wrote its name down. Both are stand-ins that a later schedule can turn out to have named
   * properly, and both have to be reconsidered every time a pull adds teams — the club that
   * settles a stand-in may not have been pulled when the stand-in was made.
   */
  const isSlot = (teamId: string) => {
    const team = teamById.get(teamId);
    return team?.placeholder === true || team?.nameOnly === true;
  };

  const slotGames = state.games.filter(
    (game) => isSlot(game.teamAId) !== isSlot(game.teamBId) && Boolean(game.date)
  );
  if (slotGames.length === 0) return { state, resolved: 0 };

  /** Games with two real sides, indexed by the known team and day they could answer for. */
  const namedByTeamDay = new Map<string, ScoutGame[]>();
  const dayKey = (teamId: string, date: string) => `${teamId}@${date}`;
  state.games.forEach((game) => {
    if (!game.date) return;
    if (isSlot(game.teamAId) || isSlot(game.teamBId)) return;
    [game.teamAId, game.teamBId].forEach((teamId) => {
      const key = dayKey(teamId, game.date!);
      const bucket = namedByTeamDay.get(key);
      if (bucket) bucket.push(game);
      else namedByTeamDay.set(key, [game]);
    });
  });
  if (namedByTeamDay.size === 0) return { state, resolved: 0 };

  const sourceOf = (game: ScoutGame) => game.source?.teamId;
  /**
   * Whether a game has a row off the slot row's schedule other than the slot row itself: its own,
   * or one folded into it. The slot row's own record does not count — a refresh of one page files
   * again a row the pool holds folded into a game on another page, and that copy settles back into
   * the game that holds it.
   */
  const holdsSchedule = (game: ScoutGame, slotGame: ScoutGame) => {
    const schedule = sourceOf(slotGame);
    if (schedule === undefined) return false;
    if (sourceOf(game) === schedule) return true;
    const slotRow = gcRowId(schedule, slotGame.source!.gameId);
    const records = (game.alsoRows ?? []).filter((record) => record.teamId === schedule);
    if (records.length > 0) {
      return records.some((record) => gcRowId(record.teamId, record.gameId) !== slotRow);
    }
    return (game.alsoFrom ?? []).includes(schedule);
  };
  /** A named row already used to answer a slot cannot answer a second one. */
  const spoken = new Set<string>();
  /** Slot rows to drop, and the named row each one's scores were folded into. */
  const merges = new Map<string, ScoutGame>();

  /**
   * Settles one slot. `exact` asks for a start time that agrees as well; the exact round runs
   * first over every slot, so that where two slots on one day could both take the same named row
   * — a doubleheader against one club, written as two "TBD"s with the same score — the one whose
   * time matches claims it, and the other is left rather than given the wrong half.
   */
  const settle = (slotGame: ScoutGame, exact: boolean) => {
    if (merges.has(slotGame.id)) return;
    const knownId = isSlot(slotGame.teamAId) ? slotGame.teamBId : slotGame.teamAId;
    const slotKnown = slotGame.teamAId === knownId ? slotGame.teamAScore : slotGame.teamBScore;
    const slotOther = slotGame.teamAId === knownId ? slotGame.teamBScore : slotGame.teamAScore;
    /** The two rows give the same result from the known club's seat. */
    const mirrors = (named: ScoutGame): boolean => {
      if (!isScored(slotGame) || !isScored(named)) return false;
      const namedKnown = named.teamAId === knownId ? named.teamAScore : named.teamBScore;
      const namedOther = named.teamAId === knownId ? named.teamBScore : named.teamAScore;
      return slotKnown === namedKnown && slotOther === namedOther;
    };
    const sameTime = (named: ScoutGame): boolean => sameStart(slotGame.startTs, named.startTs);
    const timeAgrees = (named: ScoutGame): boolean =>
      slotGame.startTs === undefined || named.startTs === undefined || sameTime(named);
    const standIn = teamById.get(
      knownId === slotGame.teamAId ? slotGame.teamBId : slotGame.teamAId
    );
    const refusedAgainst = (slot: ScoutGame, named: ScoutGame): boolean => {
      const club = teamById.get(named.teamAId === knownId ? named.teamBId : named.teamAId);
      return refusesName(refused, sourceOf(slot), standIn?.name, club) && !listedByOwn(named, club);
    };
    /**
     * Asked only of a named row whose result contradicts the slot's: whether it is still this
     * game. It is when the other club's schedule has it at this very start time — the known club
     * cannot have played two games at once — and the stand-in's name is a shorthand for the club
     * that row is against. A bracket slot has no name to hold the row to, and is left as it was.
     */
    const scoredApart = (named: ScoutGame): boolean => {
      if (!sameTime(named) || sourceOf(named) === sourceOf(slotGame)) return false;
      if (!standIn?.nameOnly) return false;
      const namedOther = teamById.get(named.teamAId === knownId ? named.teamBId : named.teamAId);
      return namedOther !== undefined && fits(standIn.name, namedOther.name);
    };

    const candidates = (namedByTeamDay.get(dayKey(knownId, slotGame.date!)) ?? []).filter(
      (named) =>
        !spoken.has(named.id) &&
        /*
         * A game none of whose rows is off this schedule — or one that is, where the two start at
         * the same instant, since a club cannot be playing both of them. One schedule lists one
         * game once: a row settled into a game already holding its own schedule's row was one the
         * tidy's regroup then stood back up against the named club, a result filed against a club
         * that never played it (`collapseSameGames` keeps no stand-in on the record).
         */
        sourceOf(named) !== undefined &&
        (!holdsSchedule(named, slotGame) || sameTime(named)) &&
        /*
         * Not a game against a club the owner has said the stand-in's name is not, unless the
         * club's own schedule gave it a row: then the club says it played this game, and the
         * refusal, which is about a name, has nothing to say (`listedByOwn`).
         */
        !refusedAgainst(slotGame, named) &&
        /*
         * Two results that contradict are two games, unless they are one game scored apart
         * (`scoredApart`). Folding the slot into the one named row of the day regardless was
         * deleting real results: on a pool with no start times to hold it back, that fallback
         * threw away 1,976 scored games in one tidy.
         */
        (!(isScored(slotGame) && isScored(named) && !mirrors(named)) || scoredApart(named))
    );

    /*
     * The score first. The same fixture written down twice agrees on what it finished, from each
     * side's point of view, and that is true even when the two coaches typed different start
     * times — which they do often enough that requiring the time to agree left a thousand
     * settled games standing as stand-ins. Where exactly one named row mirrors the result, that
     * is the one; where several do, the time picks between them. Failing a result on both sides,
     * the day — provided a time on both sides agrees. A pool-play day against one club is two or
     * three games with no times posted, and picking between them by the day alone is the guess
     * this function refuses to make.
     */
    const agreeing = candidates.filter(mirrors);
    const pool = agreeing.length > 0 ? agreeing : candidates;
    const shortlist = exact
      ? pool.filter(sameTime)
      : agreeing.length === 1
        ? agreeing
        : pool.filter(timeAgrees);
    if (shortlist.length !== 1) return;

    const named = shortlist[0]!;
    /*
     * Across regions, the clock alone is not a game (`claimFiledRows` says why): a row with no
     * result on either side settles nowhere there, whatever the stand-in is called. "Blue" is in
     * "Marucci Prospects New York Blue", and an Indiana club of that name is not the team a
     * Connecticut club typed. A refusal and not a filter, so the region never picks between two
     * games the clock could not.
     */
    const otherSide = teamById.get(named.teamAId === knownId ? named.teamBId : named.teamAId);
    if (
      (!isScored(slotGame) || !isScored(named)) &&
      !inOneRegion(teamById.get(knownId)?.state, otherSide?.state)
    ) {
      return;
    }
    spoken.add(named.id);
    merges.set(slotGame.id, named);
  };
  slotGames.forEach((slotGame) => settle(slotGame, true));
  slotGames.forEach((slotGame) => settle(slotGame, false));

  if (merges.size === 0) return { state, resolved: 0 };

  // The named row keeps its id and its side order; only a score it does not have is taken from the
  // slot's row, since a placeholder's schedule can carry a result the other's has not posted yet.
  const filled = new Map<string, ScoutGame>();
  const gamesById = new Map(state.games.map((game) => [game.id, game]));
  merges.forEach((named, slotId) => {
    const slotGame = gamesById.get(slotId);
    if (!slotGame) return;
    const current = filled.get(named.id) ?? named;

    /*
     * Where the settled row came from, remembered on the row that survives.
     *
     * The fold is about to remove a row, and with it the fact that its schedule listed this
     * opponent that day. That fact decides whether a later contradicting result is a second game
     * or a scorekeeping dispute: a club writing one named game and one "TBD" against the same
     * opponent is saying they met twice, and without this the two results are indistinguishable
     * from one game written down differently — which is how a real result came to be deleted.
     */
    const recorded = withSchedulesOf(current, slotGame);

    // A score is only taken from the stand-in's row when the surviving row has none: the other
    // schedule may have posted a result this one has not.
    const fillScore = isScored(slotGame) && !isScored(named);
    const knownId = isSlot(slotGame.teamAId) ? slotGame.teamBId : slotGame.teamAId;
    const knownScore = slotGame.teamAId === knownId ? slotGame.teamAScore : slotGame.teamBScore;
    const otherScore = slotGame.teamAId === knownId ? slotGame.teamBScore : slotGame.teamAScore;
    // Settled against a result it contradicts, at one start time: the named row's result stands
    // and carries the slot's, as `collapseSameGames` keeps a game two pulled clubs scored apart.
    const namedKnownScore = named.teamAId === knownId ? named.teamAScore : named.teamBScore;
    const namedOtherScore = named.teamAId === knownId ? named.teamBScore : named.teamAScore;
    const disputed =
      isScored(slotGame) &&
      isScored(named) &&
      (namedKnownScore !== knownScore || namedOtherScore !== otherScore);
    const [reportedA, reportedB] =
      named.teamAId === knownId ? [knownScore, otherScore] : [otherScore, knownScore];

    /*
     * The slot's row is the known club's own copy. Where that club is the named row's side B, its
     * score goes beside the named row's (`reportedByB`) rather than into a note, as every other
     * copy off the other club's schedule does; where it is side A, it is that club's own schedule
     * scoring the game twice.
     */
    if (named.teamBId === knownId && isScored(slotGame)) {
      const report = { teamAScore: otherScore!, teamBScore: knownScore! };
      // A score taken where the named row had none is only side B's, and is marked so, as
      // `withSideBReport` marks it: side A's own score replaces it when that schedule posts one.
      filled.set(named.id, {
        ...recorded,
        ...(fillScore ? { ...report, scoreFromB: true } : {}),
        reportedByB: report,
      });
      return;
    }
    filled.set(named.id, {
      ...recorded,
      ...(disputed
        ? {
            note: [current.note, `Also reported ${reportedA}-${reportedB}.`]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
      ...(fillScore
        ? named.teamAId === knownId
          ? { teamAScore: knownScore, teamBScore: otherScore }
          : { teamAScore: otherScore, teamBScore: knownScore }
        : {}),
    });
  });

  const games = state.games
    .filter((game) => !merges.has(game.id))
    .map((game) => filled.get(game.id) ?? game);

  // A stand-in nothing references any more is not a club and should not linger in the roster.
  // One carrying GameChanger ids is a club a hand merge left flagged, and is never removed here.
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter(
    (team) =>
      (!team.placeholder && !team.nameOnly) ||
      Boolean(team.gcTeams?.length) ||
      stillUsed.has(team.id)
  );

  return { state: { ...state, teams, games }, resolved: merges.size };
};

/**
 * Claims a row a club's own schedule filed by name for the club whose own schedule lists the game.
 *
 * A schedule names its opponent, and the import files the row against a club of that name, or a
 * stand-in where it finds none. The name is a guess; the game is not. Where another pulled club's
 * own schedule lists a game against this club that day that none of this club's own schedules gives
 * a row, that game is on this club's schedule somewhere — under whatever its coach typed. So a row
 * of this club's filed by name, against a stand-in or against a pulled club whose own schedules
 * never list the game, and the other club's copy beside it are one game, and the row goes into that
 * copy as this club's own (`claimInto`).
 *
 * Against a stand-in, whose name says nothing, the clock and the scores decide, as two schedules'
 * copies of one game are read (`ONE_GAME_WINDOW_MINUTES`): within the hour or at the very start
 * with a result still to come or two within `CLOSE_DISPUTE_RUNS`, or the same result. On the pool
 * of 24 September 2026 the stand-in's name shared a word with the club the other schedule named in
 * 68% of the pairs within the hour with a result to come and 67% of those scored close, against 3%
 * to 10% of the pairs the same search makes a week either side; most of the rest were shorthand —
 * "R.E.B." for Rockland Elite Black. Scores further apart shared one in 13% of the pairs within the
 * hour, and are left as two games.
 *
 * Against a pulled club the name did say something, and only scores that agree outweigh it: the
 * same result within the hour, or two within four runs at the very start or within the hour. The
 * same pool held 1,358 rows filed against a pulled club whose schedules never listed them beside
 * another club's copy with the same result within the hour; the two clubs' names shared a word in
 * 81% of them, and 356 more scored within four runs at one start shared one in 90%. Kentucky
 * Athletics' 9-3 over "Dream Chasers Blue" was Hit Dogs Evansville's own 3-9 fifteen minutes on:
 * that weekend's opponents all filed the Hit Dogs under the name they played the tournament as, a
 * GameChanger team with no games of its own, and each game stood twice. A result still to come says
 * nothing against a real name — blank rows at one start paired "Rangers" typed with the DBACKS'
 * copy — and waits until the scores are in.
 *
 * Nothing claimed is final. The record keeps the team the row was filed against
 * (`FoldedRow.filedAgainst`), every pass reads each club's day again with its claims stood back up,
 * and a claim the schedules no longer bear out goes back: the other club's copy withdrawn, a score
 * posted that says two games, the club's own schedule naming the other club after all, a better
 * copy pulled since. Kept as a bare fold, a claim outlived every one of those, and the row stood up
 * against the club that had claimed it, a game that club's schedules never listed.
 *
 * Every row and copy of the club's day is read at once: as many pairs as the day allows, then in
 * both schedules' order, then the stronger links — the same result, the very same start, within the
 * hour. Where two readings are as good as each other, only what they agree on is settled: one game
 * off two GameChanger teams of one club, 5-1 at 9:30 on both, is not a choice to make on the order
 * the pool holds them in. A claim already made weighs nothing of its own — preferred, it kept a row
 * in the first of two copies that fitted it as well, where the same clubs pulled in the other order
 * left it standing — so the day reads the same whichever club was pulled first.
 * And the day waits for whatever would answer it better: a club with a row of its own against the
 * other club, that day or the day either side, that no row of theirs is paired with yet and that
 * could yet be the other club's copy is the collapse's to pair first (`couldStillBeCopy`); a row
 * the club it names answers for, by a copy of its own that fits, is that club's; a team the other
 * club's own schedule plays is not that club — a pulled one only where the result is not the same
 * — nor is an age typed into its name more than `PLAYS_UP_TO` from the one that club played at;
 * and rows naming one team on one day go to one club or none.
 */
export const claimFiledRows = (input: GcImportState): { state: GcImportState; claimed: number } => {
  const orphans = releaseOrphanedClaims(input);
  const state = orphans.state;
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const fits = nameFitter();
  const clubOfSchedule = new Map<string, string>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
  );
  /** A side nobody pulled: a bracket slot, or a club known only because a schedule named it. */
  const isStandIn = (teamId: string) => {
    const team = teamById.get(teamId);
    return (team?.placeholder === true || team?.nameOnly === true) && !team.gcTeams?.length;
  };
  const isClub = (teamId: string) => Boolean(teamById.get(teamId)?.gcTeams?.length);
  const mine = (schedule: string | undefined, clubId: string) =>
    schedule !== undefined && clubOfSchedule.get(schedule) === clubId;
  /** Whether any of this club's own schedules gave the game a row: its own, folded in, or on record. */
  const listedBy = (game: ScoutGame, clubId: string): boolean =>
    mine(game.source?.teamId, clubId) ||
    (game.alsoRows ?? []).some((record) => mine(record.teamId, clubId)) ||
    (game.alsoFrom ?? []).some((schedule) => mine(schedule, clubId));
  /**
   * The same, less the rows the game holds as claims: what this club lists of it for itself. A
   * claim settled on the club it faces (`isSettledClaim`) is the club's own row by name, and the
   * namesake join's claim (`isJoinedClaim`) the club's own row the join holds.
   */
  const ownsRowIn = (game: ScoutGame, clubId: string): boolean => {
    if (mine(game.source?.teamId, clubId)) return true;
    const records = game.alsoRows ?? [];
    if (
      records.some(
        (record) =>
          mine(record.teamId, clubId) && (!record.filedAgainst || isHeldAsOwn(game, record))
      )
    ) {
      return true;
    }
    const recorded = new Set(records.map((record) => record.teamId));
    return (game.alsoFrom ?? []).some(
      (schedule) => mine(schedule, clubId) && !recorded.has(schedule)
    );
  };
  /**
   * The same, less a schedule on record with no row of it kept (`alsoFrom` alone): which row that
   * was is not known, so it cannot say the club's row of the game is in it already. Since rows
   * are kept whole, a pull files its row into such a copy and one that files none takes the record
   * off; the record left beside a row of the club's standing against another name is one an older
   * pull left, and the row is the one it stood for. On the pool of 26 September 2026 a club's own
   * row stood so 353 times, the same result within the hour as the copy holding its schedule on
   * record: a game counted twice. Further off than the hour the record may be another meeting that
   * day, so there it still holds (`strength`).
   */
  const keepsRowIn = (game: ScoutGame, clubId: string): boolean =>
    mine(game.source?.teamId, clubId) ||
    (game.alsoRows ?? []).some(
      (record) => mine(record.teamId, clubId) && (!record.filedAgainst || isHeldAsOwn(game, record))
    );
  const dayKey = (teamId: string, date: string) => `${teamId}@${date}`;

  /** A row filed by name: standing, or claimed already and read here as if it stood. */
  type Filed = {
    /** The row as its schedule filed it: its club on side A, the team it named on side B. */
    row: ScoutGame;
    club: string;
    against: string;
    level: number | undefined;
    holder?: ScoutGame;
    record?: FoldedRow;
  };
  const filedByDay = new Map<string, Filed[]>();
  /** What each club's own schedules have played, claims included: a club never plays itself. */
  const played = new Map<string, Set<string>>();
  const plays = (clubId: string, teamId: string) => {
    const bucket = played.get(clubId);
    if (bucket) bucket.add(teamId);
    else played.set(clubId, new Set([teamId]));
  };
  /** Games between two sides that are not stand-ins, by each side and day. */
  const byTeamDay = new Map<string, ScoutGame[]>();
  state.games.forEach((game) => {
    const club = game.source ? clubOfSchedule.get(game.source.teamId) : undefined;
    /*
     * Every schedule that gave the game a row of its own played the game's other side: the row it
     * stands on, and the rows folded in or on record, which are the same game. Read off the row it
     * stands on alone, which of two clubs' copies the collapse happened to keep decided what the
     * other club had played, and a claim it should have refused went through in one pool order.
     */
    const playedIn = (schedule: string) => {
      const own = clubOfSchedule.get(schedule);
      if (own === undefined) return;
      if (game.teamAId === own) plays(own, game.teamBId);
      else if (game.teamBId === own) plays(own, game.teamAId);
    };
    if (game.source) playedIn(game.source.teamId);
    const named = new Set((game.alsoRows ?? []).map((record) => record.teamId));
    game.alsoRows?.forEach((record) => {
      if (record.filedAgainst === undefined) playedIn(record.teamId);
    });
    game.alsoFrom?.forEach((schedule) => {
      if (!named.has(schedule)) playedIn(schedule);
    });
    game.alsoRows?.forEach((record) => {
      const recordClub = clubOfSchedule.get(record.teamId);
      if (record.filedAgainst === undefined || recordClub === undefined) return;
      plays(recordClub, record.filedAgainst);
      // A game the user has thrown out keeps what it holds: a claim released from it stood up as a
      // game of its own, counted, which the user had said not to count. A claim settled on the
      // club it faces has no other team to go to, and read as one it went back against that club
      // beside the club's own copy. And the namesake join's claim is the join's to read again
      // (`joinNamesakeHalves`): weighed here by the claim step's own rules as well, the two steps
      // could each undo what the other had decided.
      if (game.excluded || !teamById.has(record.filedAgainst) || isHeldAsOwn(game, record)) {
        return;
      }
      const row = filedRowOf(game, record);
      if (!row.date || row.teamAId !== recordClub || row.teamBId === recordClub) return;
      push(filedByDay, dayKey(recordClub, row.date), {
        row,
        club: recordClub,
        against: record.filedAgainst,
        level: record.filedLevel,
        holder: game,
        record,
      });
    });
    if (!game.date) return;
    if (!isStandIn(game.teamAId) && !isStandIn(game.teamBId)) {
      push(byTeamDay, dayKey(game.teamAId, game.date), game);
      push(byTeamDay, dayKey(game.teamBId, game.date), game);
    }
    // A club's own row, nothing folded into it, against a team none of whose schedules gives it a
    // row. One the user has thrown out stays as the user left it.
    if (
      club === undefined ||
      game.teamAId !== club ||
      game.excluded ||
      game.alsoRows?.length ||
      game.reportedByB ||
      game.scoreFromB ||
      game.scoreFromTwin
    ) {
      return;
    }
    const against = game.teamBId;
    if (against === club) return;
    // A club the row named by its picture is not a name to be claimed away from.
    if (
      isStandIn(against) ||
      (isClub(against) && !listedBy(game, against) && game.namedByAvatar !== against)
    ) {
      push(filedByDay, dayKey(club, game.date), {
        row: game,
        club,
        against,
        level: game.ageLevelB,
      });
    }
  });
  if (filedByDay.size === 0) return { state, claimed: orphans.released };

  const pageLevel = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const ownPage = ownPageFor(state.ageGroups);
  const updated = new Map<string, ScoutGame>();
  const current = (game: ScoutGame) => updated.get(game.id) ?? game;
  const removed = new Set<string>();
  const added: ScoutGame[] = [];
  let claimed = 0;
  /** What each day decided for each of its rows: the copy it goes into, or none. */
  const decisions: { entry: Filed; copy: ScoutGame | undefined }[] = [];
  /** Copies a row of their own day could be and went into none: no day either side's to take. */
  const wantedOnTheirDay = new Set<string>();

  filedByDay.forEach((filed, key) => {
    const { club, row: firstRow } = filed[0]!;
    const date = firstRow.date!;
    const otherOf = (game: ScoutGame) => (game.teamAId === club ? game.teamBId : game.teamAId);
    // Another club's own copy of a game against this club, none of this club's own rows in it but
    // claims: that day, and the day either side for a stand-in row with the same result
    // (`strength`). Most days have none, and there is nothing to read.
    const offerable = (game: ScoutGame) =>
      !game.excluded && mine(game.source?.teamId, otherOf(game)) && !keepsRowIn(game, club);
    const offered = [date, isoDayFrom(date, -1), isoDayFrom(date, 1)].flatMap((day) =>
      day === undefined ? [] : (byTeamDay.get(dayKey(club, day)) ?? []).filter(offerable)
    );
    if (offered.length === 0 && filed.every((entry) => !entry.holder)) return;
    /*
     * A copy of a club's with a row of this club's own against that club, that day or the day
     * either side, that no row of theirs is paired with and that could yet be the copy waits:
     * which of its copies that row is, the collapse says (`couldStillBeCopy`).
     */
    const waiting = new Map<string, ScoutGame[]>();
    [-1, 0, 1].forEach((days) => {
      const day = days === 0 ? date : isoDayFrom(date, days);
      if (day === undefined) return;
      (byTeamDay.get(dayKey(club, day)) ?? []).forEach((game) => {
        const otherId = otherOf(game);
        if (ownsRowIn(game, club) && !listedBy(game, otherId)) push(waiting, otherId, game);
      });
    });
    const copies = offered.filter(
      (copy) => !(waiting.get(otherOf(copy)) ?? []).some((row) => couldStillBeCopy(row, copy))
    );

    // A copy's score borrowed from this club's own rows (`scoreFromB`) is this club's word, not the
    // copy's: read as its own, a claim agreed with itself and outweighed a better copy pulled since.
    const seatOf = (game: ScoutGame): [number, number] | undefined =>
      !isScored(game) || (game.scoreFromB && game.teamBId === club)
        ? undefined
        : game.teamAId === club
          ? [game.teamAScore!, game.teamBScore!]
          : [game.teamBScore!, game.teamAScore!];
    /**
     * How strongly a filed row and a copy read as one game; 0 for not at all. A stand-in's name says
     * nothing, so a result still to come is enough on the clock; a pulled club's name does, so only
     * scores that agree outweigh it.
     */
    const strength = (entry: Filed, copy: ScoutGame): number => {
      const otherId = otherOf(copy);
      if (otherId === entry.against) return 0;
      /*
       * A team the other club's own schedule has played is one that club knows as another team. A
       * stand-in's name is then that team's and nobody else's. A pulled club's still gives way to
       * the same result — the NL Vandals' 15-3 against "Downingtown West Wolfpack Blue" was
       * Downingtown Wolfpack Gold's own 3-15 at the very same start, the Blue listing nothing that
       * day, though the Gold play the Blue — but to nothing less. On the pool of 24 September 2026,
       * among rows filed against a pulled club the other club had played, the two clubs' names
       * shared a word in 81% of the 47 with the same result within the hour, and in 13% of the 30
       * scored apart within the hour, about what chance gives.
       */
      const knownApart = played.get(otherId)?.has(entry.against) === true;
      if (knownApart && isStandIn(entry.against)) return 0;
      const typed = entry.level;
      const level =
        (copy.teamAId === otherId ? copy.ageLevelA : copy.ageLevelB) ??
        pageLevel.get(copy.ageGroupId);
      if (typed !== undefined && level !== undefined && Math.abs(typed - level) > PLAYS_UP_TO) {
        return 0;
      }
      const ours = seatOf(entry.row);
      const theirs = seatOf(copy);
      const near = startsWithinTheHour(entry.row.startTs, copy.startTs);
      const same = ours && theirs && ours[0] === theirs[0] && ours[1] === theirs[1];
      /*
       * The very same result against a slot, or a stand-in whose name fits the copy's club, is the
       * copy's game whatever the clock says: "Chicos Augusta" at 16:30 is Chicos Augusta's own
       * 17:35 copy, 10-1 both. On the tidy of the 26 September 2026 backup that joined 44 rows to a
       * copy holding the club's schedule on record more than an hour off, moving 44 records toward
       * the club's own schedule and 43 toward GameChanger's. Any stand-in's name would have joined
       * 15 more on the result alone, where a name for nobody on the copy's side, hours off, may be
       * another meeting that day; a name that fits is the bar.
       */
      const standIn = teamById.get(entry.against);
      const standsForCopy =
        isStandIn(entry.against) &&
        Boolean(same) &&
        standIn !== undefined &&
        (standIn.placeholder === true || fits(standIn.name, teamById.get(otherId)?.name ?? ""));
      // A copy holding this club's schedule on record with no row kept takes a row within the hour
      // only: further off, the record may stand for another meeting that day (`keepsRowIn`).
      if (!near && ownsRowIn(copy, club) && !standsForCopy) return 0;
      /*
       * A day apart, the same result against a name that fits or a slot, and only into a copy not
       * holding the club on record: a schedule dated a day off, as two clubs' own copies are read
       * (`dayApartStrength`). Catoosa Mudcats' 9-16 against "Frost Falcons" on the 12th was Frost
       * Falcons' own copy at the same 13:00 on the 13th. 47 rows on that pool, 45 records toward
       * GameChanger's; a week off, the same search found 2.
       */
      if (copy.date !== entry.row.date) return standsForCopy && !ownsRowIn(copy, club) ? 1 : 0;
      const close =
        ours !== undefined &&
        theirs !== undefined &&
        Math.abs(ours[0] - theirs[0]) + Math.abs(ours[1] - theirs[1]) <= CLOSE_DISPUTE_RUNS;
      const onClock = sameStart(entry.row.startTs, copy.startTs) ? 2 : near ? 1 : 0;
      if (isStandIn(entry.against)) {
        if (same) return near ? 4 : 3;
        if (ours && theirs && !close) return 0;
        return onClock;
      }
      if (same) return near ? 4 : 0;
      return close && !knownApart ? onClock : 0;
    };
    /**
     * A row the club it names answers for, by a copy of its own that fits, is that club's. Its
     * own copy standing, or its own row claimed into somebody else's copy, read as if it stood as
     * every claim is here. Read off the standing copies alone, the answer went back and forth: on
     * the pool of 26 September 2026, Power Baseball 2028 Victus and JR7 Baseball each filed their
     * 3-2 against the other, and each club had a second GameChanger team whose copy named the
     * first. Each pass claimed the row that stood into the second team's copy and gave back the
     * one that was claimed, since the standing row answered it, and every tidy ran to its limit.
     */
    const answered = (entry: Filed) =>
      isClub(entry.against) &&
      [
        ...(byTeamDay.get(key) ?? []).filter((game) => mine(game.source?.teamId, entry.against)),
        ...(filedByDay.get(dayKey(entry.against, date)) ?? []).flatMap((other) =>
          other.holder && other.row.teamBId === club ? [other.row] : []
        ),
      ].some(
        (game) =>
          otherOf(game) === entry.against &&
          strength({ ...entry, against: `${entry.against}\u0000` }, game) > 0
      );
    const rows = filed.filter((entry) => !answered(entry));

    type Link = { row: number; copy: number; strength: number };
    const everyLink: Link[] = rows.flatMap((entry, r) =>
      copies.flatMap((copy, c) => {
        const found = strength(entry, copy);
        return found > 0 ? [{ row: r, copy: c, strength: found }] : [];
      })
    );
    // A row with a copy of its own day is read on that day alone: the day either side is only for
    // a row the day itself has nothing for.
    const sameDay = (link: Link) => copies[link.copy]!.date === rows[link.row]!.row.date;
    const linkedOnItsDay = new Set(everyLink.filter(sameDay).map((link) => link.row));
    const links = everyLink.filter((link) => sameDay(link) || !linkedOnItsDay.has(link.row));
    const byRow = new Map<number, Link[]>();
    links.forEach((link) => push(byRow, link.row, link));
    const chosen = new Map<Filed, ScoutGame>();
    if (
      links.length > 0 &&
      byRow.size <= MISSING_COPY_MAX &&
      new Set(links.map((link) => link.copy)).size <= MISSING_COPY_MAX
    ) {
      const minuteOf = (game: ScoutGame) => startMinuteOf(game.startTs);
      /** Two links whose rows and copies run in opposite orders, all four with a start. */
      const crossed = (a: Link, b: Link): boolean => {
        const [ra, rb, ca, cb] = [
          minuteOf(rows[a.row]!.row),
          minuteOf(rows[b.row]!.row),
          minuteOf(copies[a.copy]!),
          minuteOf(copies[b.copy]!),
        ];
        if (ra === undefined || rb === undefined || ca === undefined || cb === undefined) {
          return false;
        }
        return (ra - rb) * (ca - cb) < 0;
      };
      type Reading = { links: Link[]; crossings: number; strength: number };
      /** More pairs, fewer crossings, then stronger links. */
      const compare = (a: Reading, b: Reading): number =>
        a.links.length - b.links.length || b.crossings - a.crossings || a.strength - b.strength;
      let best: Reading[] = [];
      const picked: Link[] = [];
      const used = new Set<number>();
      const rowOrder = [...byRow.keys()];
      const visit = (at: number) => {
        if (at === rowOrder.length) {
          if (picked.length === 0) return;
          let crossings = 0;
          picked.forEach((a, i) =>
            picked.slice(i + 1).forEach((b) => (crossings += crossed(a, b) ? 1 : 0))
          );
          const reading: Reading = {
            links: picked.slice(),
            crossings,
            strength: picked.reduce((sum, link) => sum + link.strength, 0),
          };
          const order = best.length === 0 ? 1 : compare(reading, best[0]!);
          if (order > 0) best = [reading];
          else if (order === 0) best.push(reading);
          return;
        }
        visit(at + 1);
        byRow.get(rowOrder[at]!)!.forEach((link) => {
          if (used.has(link.copy)) return;
          used.add(link.copy);
          picked.push(link);
          visit(at + 1);
          picked.pop();
          used.delete(link.copy);
        });
      };
      visit(0);
      best[0]?.links
        .filter((link) => best.every((reading) => reading.links.includes(link)))
        .forEach((link) => chosen.set(rows[link.row]!, copies[link.copy]!));
    }
    /*
     * The clock alone, across regions, is not a game. The copy names this club because its coach
     * typed a name the import found here, and a common name is found in many places: a 9U club in
     * Iowa that played "Cubs" was filed against the 11U Cubs of Frisco, Texas, one of 75 teams of
     * that name, and the Texas club's 11-6 over the Diamondbacks at the same 15:45 went into the
     * Iowa club's blank copy as its loss. Of the 3,714 claims in the pool of 26 September 2026, 7
     * joined clubs of two regions, 6 of them on scores that agree or nearly do; the seventh was a
     * blank row naming a New York team claimed into an Indiana club's blank copy. Refused once the
     * day is read rather than weighed in it, so the region never picks between two copies the
     * clock could not.
     */
    chosen.forEach((copy, entry) => {
      if (
        isStandIn(entry.against) &&
        (!seatOf(entry.row) || !seatOf(copy)) &&
        !inOneRegion(teamById.get(club)?.state, teamById.get(otherOf(copy))?.state)
      ) {
        chosen.delete(entry);
      }
    });
    // Rows naming one team on one day go to one club or none: a team is one team.
    const clubsFor = new Map<string, Set<string>>();
    chosen.forEach((copy, entry) => {
      const bucket = clubsFor.get(entry.against);
      if (bucket) bucket.add(otherOf(copy));
      else clubsFor.set(entry.against, new Set([otherOf(copy)]));
    });
    chosen.forEach((_copy, entry) => {
      if ((clubsFor.get(entry.against)?.size ?? 0) > 1) chosen.delete(entry);
    });

    /*
     * A row of the copy's own day that could be it and went into nothing — two copies it could not
     * choose between — wants it as surely as one that did. Read off the decisions alone, the day
     * before took the copy: a 5-3 against a stand-in on the 6th that fits both the Bears' and the
     * Cubs' copies of the 6th went into neither, and the same result on the 5th went into the
     * Bears' as a day-off row.
     */
    rows.forEach((entry, at) => {
      if (chosen.has(entry)) return;
      everyLink.forEach((link) => {
        if (link.row === at && sameDay(link)) wantedOnTheirDay.add(copies[link.copy]!.id);
      });
    });
    filed.forEach((entry) => decisions.push({ entry, copy: chosen.get(entry) }));
  });

  /*
   * A club's own row claimed away this pass is not a copy to claim into this pass. One standing row
   * can be both: the Bears' row against the Aces, which no Aces schedule lists, was the copy an Aces
   * row went into and a row the Bears filed by name that the Yanks' copy took, both decided on the
   * pool as it came in; the Aces' row went into it, it went into the Yanks' copy without that row,
   * and the Aces' row was in the pool nowhere. What went to it waits a pass, and is read again
   * against the day as the claim away leaves it.
   */
  /*
   * A copy offered to the days either side of its own can be chosen from two of them. It goes to
   * the row on its own day, or where there is not exactly one, to none: two days' rows wanting one
   * copy is no reading of either.
   */
  decisions.forEach((decision) => {
    const copy = decision.copy;
    if (copy && copy.date !== decision.entry.row.date && wantedOnTheirDay.has(copy.id)) {
      decision.copy = undefined;
    }
  });
  const byCopy = new Map<string, (typeof decisions)[number][]>();
  decisions.forEach((decision) => {
    if (decision.copy) push(byCopy, decision.copy.id, decision);
  });
  byCopy.forEach((wanting) => {
    if (wanting.length < 2) return;
    const onItsDay = wanting.filter((decision) => decision.entry.row.date === decision.copy!.date);
    wanting.forEach((decision) => {
      if (onItsDay.length === 1 && decision === onItsDay[0]) return;
      decision.copy = undefined;
    });
  });
  const goingAway = new Set(
    decisions.flatMap(({ entry, copy }) => (copy && !entry.holder ? [entry.row.id] : []))
  );
  decisions.forEach(({ entry, copy }) => {
    if (copy && goingAway.has(copy.id)) return;
    if (entry.holder && entry.record) {
      if (copy === entry.holder) return;
      // A claim the day no longer reads that way goes back to the team its row named.
      updated.set(entry.holder.id, releaseClaim(current(entry.holder), entry.record));
      claimed += 1;
      if (!copy) {
        added.push(ownPage(entry.row));
        return;
      }
    } else if (!copy) {
      return;
    } else {
      removed.add(entry.row.id);
      claimed += 1;
    }
    updated.set(copy.id, claimInto(current(copy), entry.row, entry.against, entry.level));
  });

  if (claimed === 0) return { state, claimed: orphans.released };
  const games = [
    ...state.games.flatMap((game) => (removed.has(game.id) ? [] : [updated.get(game.id) ?? game])),
    ...added,
  ];
  return { state: { ...state, games }, claimed: claimed + orphans.released };
};

/**
 * Stands a claim back up where the game holding it no longer has its club on either side.
 *
 * A claim is one club's row inside another club's copy, and the copy can change sides after it is
 * made: `reclaimMisfiled` moves a copy filed against the wrong namesake onto the club of that name
 * whose own schedule lists the game. The claim goes with it, into a game its club is not in, where
 * no reading of that club's day will ever look for it. So before any day is read, such a claim goes
 * back to the team its row was filed against, as a row of its club's own, and the day is read with
 * it standing.
 */
const releaseOrphanedClaims = (
  state: GcImportState
): { state: GcImportState; released: number } => {
  const clubOfSchedule = new Map<string, string>();
  const levelOfSchedule = new Map<string, number>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => {
      clubOfSchedule.set(link.teamId, team.id);
      if (link.ageLevel !== undefined) levelOfSchedule.set(link.teamId, link.ageLevel);
    })
  );
  const ownPage = ownPageFor(state.ageGroups);
  const added: ScoutGame[] = [];
  let released = 0;
  const games = state.games.map((game) => {
    let next = game;
    (game.alsoRows ?? []).forEach((record) => {
      const club = clubOfSchedule.get(record.teamId);
      if (
        record.filedAgainst === undefined ||
        club === undefined ||
        club === record.filedAgainst ||
        club === game.teamAId ||
        club === game.teamBId
      ) {
        return;
      }
      next = releaseClaim(next, record);
      // Neither of the game's sides is the club's now, so neither of their levels says anything of
      // it: the row takes its club's own level off the schedule it came from, which files it on its
      // own page, and the level its name gave the team it was filed against.
      // A game the user threw out is still thrown out for the row that leaves it.
      const { ageLevelA: _own, ageLevelB: _other, ...row } = filedRowOf(game, record);
      const level = levelOfSchedule.get(record.teamId);
      added.push(
        ownPage({
          ...row,
          teamAId: club,
          teamBId: record.filedAgainst,
          ...(level === undefined ? {} : { ageLevelA: level }),
          ...(record.filedLevel === undefined ? {} : { ageLevelB: record.filedLevel }),
          ...(game.excluded ? { excluded: true } : {}),
        })
      );
      released += 1;
    });
    return next;
  });
  return released === 0
    ? { state, released: 0 }
    : { state: { ...state, games: [...games, ...added] }, released };
};

/**
 * Joins one game that each club filed against a stand-in for the other.
 *
 * The Cincy Stix 9U Navy beat a club called "Hurricanes" 13-2 on 20 September 2026, and both
 * clubs are on GameChanger and both were pulled. The Stix's coach typed "Hurricanes"; the
 * Hurricanes' coach typed "Stix". Neither is the other club's name as GameChanger lists it, and
 * the two clubs are in different states, so each end of the game was filed against a stand-in —
 * a "Hurricanes" named by an Ohio club, a "Stix" named by a Kentucky one — and the pool held two
 * games, two clubs with no GameChanger id, and no edge at all between two clubs that had met.
 * `resolveSlotGames` could not help, because it needs one of the two rows to name the other club
 * already, and here neither does.
 *
 * The two rows are still plainly one fixture, and the evidence is the same kind that settles a
 * slot: the same day, the same result from opposite seats, and a pair of names that fit — each
 * stand-in's name is the other club's name or a shorthand for it (`nameFitsWithin`). Each of those
 * alone is weak and all of them together are not: a false pair would need a second club, whose
 * name fits one of these stand-ins, to have played a second club, whose name fits the other, on
 * that same day, with that same score mirrored.
 *
 * Two more things guard it. The clubs have to be in one region — one state, or two that share a
 * border (`inOneRegion`) — because youth clubs play their neighbours, and a pair of fits across
 * the country is the coincidence this must not fall for. And the match has to be the only one
 * from both ends: where either row could be the partner of two, nothing is joined, because a wrong
 * join moves a result onto a club that never played it and leaves nothing behind to notice.
 *
 * A result on both rows has to mirror, and when it does the two start times are not compared at
 * all. Coaches type them independently, and on the stand-in fixtures export of 22 September 2026
 * — 89,876 rows filed against a stand-in — this rule joined 1,211 games, of which 487 had the
 * same start time on both schedules and 104 were more than an hour apart: an hour or two is a
 * clock set a time zone out, and 19 were exactly twelve hours apart, AM for PM. Held to within
 * the hour it joined 1,108. The same searches run a week either side, where the game is not,
 * joined 9.5 pairs at every window from none to a whole day, and each was the same two clubs
 * meeting in another week. A club's other squad in another slot is told apart by its squad
 * number and its typed age, not by the clock. A row with no result yet has only the clock to go
 * on: it joins a scored row that starts at the same instant, and two unplayed rows are left to
 * wait until they are scored, because joining them throws away one row's id and a game put back
 * a day came back as a second game.
 *
 * Two results that do not mirror are joined only at one start time, and only where no half with a
 * result that agrees fits either end: one instant is one game, and two scores for it are two
 * coaches' accounts of it. On that same export 265 games were scored apart like this — 190 of them
 * a single run, 7 with the winner changed — against 5.5 such joins a week off, each again the same
 * two clubs meeting in another week. The first row's result stands and carries what the other
 * side reported, which is how `collapseSameGames` keeps a game two pulled clubs scored apart.
 *
 * An age a coach typed into a stand-in's name has to be the other club's own: "Mustangs 11U" is a
 * statement about which squad was played, and the age label comes off every name before names are
 * compared. A team carrying GameChanger ids is never a stand-in, whatever flags a hand merge left
 * on it, and only the stand-ins this pass emptied leave the roster.
 *
 * The surviving row is the first of the two in the pool, with the stand-in replaced by the club
 * that filed the other; the other club's schedule is recorded in `alsoFrom`, and the level its own
 * schedule gave for its side replaces the one read off a coach's spelling of its name.
 */
export const joinCrossedHalves = (
  state: GcImportState
): { state: GcImportState; joined: number } => {
  const fits = nameFitter();
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const ownIds = new Map<string, Set<string>>();
  state.teams.forEach((team) => {
    if (team.gcTeams?.length) ownIds.set(team.id, new Set(team.gcTeams.map((l) => l.teamId)));
  });
  if (ownIds.size < 2) return { state, joined: 0 };

  /** A row one pulled club filed from its own schedule, against a name nobody has pulled. */
  type Half = {
    game: ScoutGame;
    club: ScoutTeam;
    standIn: ScoutTeam;
    pool: string;
    clubScore: number | undefined;
    standInScore: number | undefined;
    clubLevel: number | undefined;
    standInLevel: number | undefined;
    /**
     * The age a coach typed into the stand-in's name, and nothing else — no page level standing in.
     * "Mustangs 11U" is a statement about which squad was played, and a club's 12U squad is not it
     * however close the two levels are; `PLAYS_UP_TO` is the slack for a level nobody stated.
     */
    standInNamedLevel: number | undefined;
  };
  const halfOf = (game: ScoutGame): Half | undefined => {
    if (!game.date || !game.source) return undefined;
    const source = game.source.teamId;
    const clubIsA = ownIds.get(game.teamAId)?.has(source) ?? false;
    const clubIsB = ownIds.get(game.teamBId)?.has(source) ?? false;
    if (clubIsA === clubIsB) return undefined;
    const club = teamById.get(clubIsA ? game.teamAId : game.teamBId);
    const standIn = teamById.get(clubIsA ? game.teamBId : game.teamAId);
    // A team carrying GameChanger ids is a club, whatever flags a hand merge left on it: merging a
    // pulled club into a stand-in keeps the stand-in's `nameOnly`, and reading that as a stand-in
    // moved the merged club's rows and then deleted it, links and all.
    if (!club || !standIn?.nameOnly || standIn.gcTeams?.length) return undefined;
    const pageLevel = levelOf.get(game.ageGroupId);
    return {
      game,
      club,
      standIn,
      pool: poolKeyOf(game.ageGroupId),
      clubScore: clubIsA ? game.teamAScore : game.teamBScore,
      standInScore: clubIsA ? game.teamBScore : game.teamAScore,
      clubLevel: (clubIsA ? game.ageLevelA : game.ageLevelB) ?? pageLevel,
      standInLevel: (clubIsA ? game.ageLevelB : game.ageLevelA) ?? pageLevel,
      standInNamedLevel: clubIsA ? game.ageLevelB : game.ageLevelA,
    };
  };
  const scored = (half: Half) => half.clubScore !== undefined && half.standInScore !== undefined;
  /** Each end's result is the other's, read from the other seat. */
  const mirrored = (x: Half, y: Half) =>
    x.clubScore === y.standInScore && x.standInScore === y.clubScore;

  /*
   * Two lookups rather than a scan of the day. A Saturday in a nationwide pool is thousands of
   * rows, and comparing each with each is millions of pairs a day; a scored row's partner can only
   * be in the bucket with the mirrored result, and an unscored row's only in the bucket at its
   * start time. Within a bucket each half is filed under the words of its club's name, and looked
   * for under the words of the stand-in's: two names fit only where every word of the shorter is in
   * the longer (`nameFitWords`), so a club sharing no word with the stand-in cannot be its club.
   * On the tidied pool of 24 September 2026 a half looked up met 131 others in its buckets, 9.5
   * million pairs over the pass, and joined none; filed by word it met 2.5, 180,000 pairs.
   */
  const halves: Half[] = [];
  const byResult = new Map<string, Map<string, Half[]>>();
  const byTime = new Map<string, Map<string, Half[]>>();
  const wordsRead = new Map<string, ReadonlySet<string>>();
  const wordsOf = (name: string): ReadonlySet<string> => {
    const known = wordsRead.get(name);
    if (known) return known;
    const made = nameFitWords(name);
    wordsRead.set(name, made);
    return made;
  };
  const file = (lookup: Map<string, Map<string, Half[]>>, key: string, half: Half) => {
    let byWord = lookup.get(key);
    if (!byWord) {
      byWord = new Map();
      lookup.set(key, byWord);
    }
    const into = byWord;
    wordsOf(half.club.name).forEach((word) => push(into, word, half));
  };
  /** The halves filed at `key` whose club's name shares a word with `x`'s stand-in's, once each. */
  const under = (lookup: Map<string, Map<string, Half[]>>, key: string, x: Half): Half[] => {
    const byWord = lookup.get(key);
    if (!byWord) return [];
    const found = new Set<Half>();
    wordsOf(x.standIn.name).forEach((word) => byWord.get(word)?.forEach((y) => found.add(y)));
    return [...found];
  };
  const resultKey = (half: Half, mine: number | undefined, theirs: number | undefined) =>
    `${half.pool}\u0000${half.game.date}\u0000${mine}-${theirs}`;
  const timeKey = (half: Half) =>
    `${half.pool}\u0000${half.game.date}\u0000${startMinuteOf(half.game.startTs)}`;
  state.games.forEach((game) => {
    const half = halfOf(game);
    if (!half) return;
    halves.push(half);
    if (scored(half)) file(byResult, resultKey(half, half.clubScore, half.standInScore), half);
    if (startMinuteOf(half.game.startTs) !== undefined) file(byTime, timeKey(half), half);
  });
  if (halves.length < 2) return { state, joined: 0 };

  const sameTime = (x: Half, y: Half) => sameStart(x.game.startTs, y.game.startTs);
  const levelsAgree = (named: number | undefined, own: number | undefined) =>
    named === undefined || own === undefined || Math.abs(named - own) <= PLAYS_UP_TO;
  /**
   * The same result from opposite seats within the hour, each stand-in named for the other club:
   * the game, wherever the two clubs are from. On the pool of 26 September 2026 the join left 100
   * such pairs standing between states that share no border — Impact of Illinois and TC Toros of
   * Georgia, 6-14 at five and 14-6 at half past, a tournament's travel — and the same search a week
   * or a fortnight either side, where the game is not, found none. Let through, 93 more pairs were
   * joined on that pool and 89 on the pool of 24 September. A weaker link, a result still to
   * come or two that disagree, still has to be between neighbours. The age a coach typed holds
   * whatever the result: two clubs' sibling squads at one event can mirror a score at one instant.
   */
  const certain = (x: Half, y: Half) =>
    scored(x) && scored(y) && mirrored(x, y) && startsWithinTheHour(x.game.startTs, y.game.startTs);
  /** Whether `y` is, on everything but uniqueness, the other end of `x`'s game. */
  const couldBeOtherEnd = (x: Half, y: Half): boolean =>
    y.club.id !== x.club.id &&
    y.standIn.id !== x.standIn.id &&
    (certain(x, y) || inOneRegion(x.club.state, y.club.state)) &&
    levelsAgree(x.standInLevel, y.clubLevel) &&
    levelsAgree(y.standInLevel, x.clubLevel) &&
    (x.standInNamedLevel === undefined || x.standInNamedLevel === y.clubLevel) &&
    (y.standInNamedLevel === undefined || y.standInNamedLevel === x.clubLevel) &&
    fits(x.standIn.name, y.club.name) &&
    fits(y.standIn.name, x.club.name);

  const partnerOf = (x: Half): Half | undefined => {
    const found = new Set<Half>();
    if (scored(x)) {
      // The mirrored result, whatever the clocks say — and a row with no result yet at this time.
      under(byResult, resultKey(x, x.standInScore, x.clubScore), x).forEach((y) => found.add(y));
      if (x.game.startTs) {
        under(byTime, timeKey(x), x).forEach((y) => {
          if (!scored(y)) found.add(y);
        });
      }
    } else if (x.game.startTs) {
      under(byTime, timeKey(x), x).forEach((y) => found.add(y));
    }
    const fits = [...found].filter((y) => couldBeOtherEnd(x, y));
    // Where several fit, the clock picks between them or nothing is picked.
    const shortlist = fits.length > 1 ? fits.filter((y) => sameTime(x, y)) : fits;
    if (shortlist.length === 1) return shortlist[0];
    /*
     * Failing any half that agrees, one at the same instant that does not: one start time is one
     * game, and two scores for it are two coaches' accounts of it. Never where an agreeing half
     * fits and the clock could not choose, which is a guess between games rather than a dispute
     * about one.
     */
    if (fits.length > 0) return undefined;
    // Everything at this instant that agrees was asked about above, so what fits here does not.
    const disputed = under(byTime, timeKey(x), x).filter((y) => couldBeOtherEnd(x, y));
    return disputed.length === 1 ? disputed[0] : undefined;
  };

  /** The surviving row, by id, and the rows folded away into it. */
  const replaced = new Map<string, ScoutGame>();
  const dropped = new Set<string>();
  halves.forEach((x) => {
    if (replaced.has(x.game.id) || dropped.has(x.game.id)) return;
    const y = partnerOf(x);
    if (!y || replaced.has(y.game.id) || dropped.has(y.game.id)) return;
    // From both ends, or it is a guess between two.
    if (partnerOf(y) !== x) return;
    /*
     * Neither row has a result: wait. An unplayed game counts for nothing yet, and joining it on
     * the clock alone throws away the dropped row's id — so when the game was put back a day and
     * both clubs scored it, the dropped club's re-pull could no longer find its own row and filed
     * the game a second time. Once both results are in, the mirrored result joins them.
     */
    if (!scored(x) && !scored(y)) return;

    const clubIsA = x.game.teamAId === x.club.id;
    const takeScore = !scored(x) && scored(y);
    // The first row's result stands and carries the other side's, as `collapseSameGames` does.
    const disputed = scored(x) && scored(y) && !mirrored(x, y);
    const [theirA, theirB] = clubIsA
      ? [y.standInScore, y.clubScore]
      : [y.clubScore, y.standInScore];
    const otherLevel = y.game.teamAId === y.club.id ? y.game.ageLevelA : y.game.ageLevelB;
    /*
     * The other club goes in for its stand-in before the dropped row is put on record, so the
     * record reads which side that row's club is on (`recordOf`); against the stand-in it matched
     * neither, and the next tidy stood the row back up on the wrong side.
     *
     * No start is taken from the other schedule. That is the other coach's clock, and the next
     * regroup would read it as this schedule's, as `collapseSameGames` never does.
     */
    const named: ScoutGame = {
      ...x.game,
      ...(clubIsA ? { teamBId: y.club.id } : { teamAId: y.club.id }),
    };
    const joinedRow: ScoutGame = {
      ...withSchedulesOf(named, y.game),
      ...(otherLevel === undefined
        ? {}
        : clubIsA
          ? { ageLevelB: otherLevel }
          : { ageLevelA: otherLevel }),
      // A result taken from the other club's schedule is marked borrowed where that club is side
      // B, as `withSideBReport` marks it, so side A's own score replaces it once posted.
      ...(takeScore
        ? clubIsA
          ? { teamAScore: y.standInScore, teamBScore: y.clubScore, scoreFromB: true }
          : { teamAScore: y.clubScore, teamBScore: y.standInScore }
        : {}),
      /*
       * The other club's own score, beside this one's rather than in a note: it is that club's
       * schedule, and its page reads it (`reportedByB`). Only where the joined row's side B is that
       * club, which is every row a schedule of its own filed.
       */
      ...(clubIsA && scored(y)
        ? { reportedByB: { teamAScore: y.standInScore!, teamBScore: y.clubScore! } }
        : disputed
          ? {
              note: [x.game.note, `Other side reported ${theirA}-${theirB}.`]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
    };
    replaced.set(x.game.id, joinedRow);
    dropped.add(y.game.id);
  });
  if (replaced.size === 0) return { state, joined: 0 };

  const games = state.games
    .filter((game) => !dropped.has(game.id))
    .map((game) => replaced.get(game.id) ?? game);
  /*
   * A stand-in the join emptied is not a club, and should not linger in the roster — but only the
   * ones this pass emptied. Every idle name-only team is not this pass's to remove, and one that
   * carries GameChanger ids is never a stand-in at all.
   */
  const touched = new Set(
    halves
      .filter((half) => replaced.has(half.game.id) || dropped.has(half.game.id))
      .map((half) => half.standIn.id)
  );
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter((team) => !touched.has(team.id) || stillUsed.has(team.id));
  return { state: { ...state, teams, games }, joined: replaced.size };
};

/**
 * A result this wide or wider is no sign of one game on a stand-in sharing no word with the namer's
 * name (`joinNamesakeHalves`): a game won by ten is often one the run rule called, and the same
 * score turns up week after week.
 */
const UNWORDED_MARGIN = 10;

/**
 * Joins one game held twice because both pulled clubs filed it against a stand-in, where one of the
 * two stand-ins carries the other club's very name.
 *
 * One club's coach types the other club's name as GameChanger lists it, but a name goes onto a
 * pulled club only where the import can say which one, and the named club can be a level up, on
 * another page; the other club's coach types a shorthand of the first club's name nobody pulled,
 * and files the same game at the same minute, the result mirrored, against it. Each row stands
 * against a stand-in and both clubs count the game. The crossed-halves join wants each stand-in's
 * name to fit the other club and the clubs to be neighbours, and the slot settle and the claim
 * step want one of the rows to name the other club already, so none of them joins it: on the
 * backup of 11 October 2026 an audit found 714 scored rows this way, on 633 stand-ins, the
 * namesake out of reach a level off (294), out of the namer's region (241), among several of the
 * name in its state (78) or named from no state (65).
 *
 * The game says it is one game. Club A's own row is against a stand-in whose name is pulled club
 * B's (`teamNameKey`, in the squad year, at any level, from any state), and B's own row of the game
 * is against a stand-in or a slot, starts within the hour, and gives the result mirrored. A false
 * pair needs another club of B's name, or another club naming B, to have played that hour with that
 * score, so the match has to be the only one each way, counted over every row that could be either
 * end. Measured against the same search with B's row a week or a fortnight either side, where the
 * game is not, two more things are asked:
 *
 * - B's opponent is a slot, or a stand-in sharing a word of three letters or more with A's name,
 *   filler words off (`nameFitWords`). Over the backups of 25, 26 and 29 September and 11 October
 *   2026, a stand-in sharing no word made a false pair 5.0% of the time (374 pairs), against 0.80%
 *   for one that shared a word and 0.28% for a slot. One sharing no word is read as A all the same
 *   where everything else about the game agrees (`nearAndPlain`): B in A's state or next door, the
 *   clubs not of one town, their levels at most one apart, the game not won by ten or more, and the
 *   stand-in's name no other pulled club's. With A's row one to four weeks either side, on those
 *   four backups after a tidy, that joins 15, 15, 19 and 28 more pairs, 77 in all, against 0.25 a
 *   shift off (0.32%); with B in A's state or next door alone it found 134 on 25 and 29 September
 *   and 11 October against 5.25 a shift off (3.9%), the false ones on a stand-in of another pulled
 *   club's name, between clubs of one town, two levels apart or in games won by ten.
 * - The two clubs' own levels for the game are no more than two apart (`PLAYS_UP_TO`), as far as a
 *   squad plays up or down: three or more apart was false 11.9% of the time (88 pairs).
 *
 * Held to those, the measurement found 225, 215, 304 and 500 pairs on those backups, 1,244 in all,
 * against 7.75 a shift off: 0.62%, and 5.75 of the 7.75 were the same two clubs meeting in another
 * week. With B's score the same from its own seat rather than mirrored it found none. The
 * crossed-halves join was accepted at 0.8%. With the guards in `holds` as well, the tidy joins 220,
 * 211, 301 and 486, 1,218 in all, against 7 pairs a shift off, under 0.6%. A row with no result
 * waits for one: blank rows at the same minute paired as often a week off as on the day (1,796
 * such pairs, against 1,809 a shift off).
 *
 * The game stays on A's row, the one that named B, on A's page: the stand-in gives way to B, at the
 * level B's own row gives it, and B's row goes into the game as a claim filed against the team it
 * named (`claimInto`), as the claim step holds the rows it claims, so it counts once in the squad
 * year's one fit and for both clubs. A level written from the row matters: read at A's page level
 * where no typed age said otherwise, 122 of the 253 joined games across two pages on the 11
 * October backup would have rated B at A's level. Nothing joined is final, as a claim is not. The
 * game's own row keeps the stand-in it named and the level the name gave (`ScoutGame.joinedFrom`),
 * every tidy reads the two rows again as their schedules filed them, and a join the schedules no
 * longer bear out — a score or a start since posted that no longer fits, a second club of the name
 * with a row that does, a copy of the game naming either club itself, the owner's refusal of either
 * name, the other club's row gone — puts each row back as it was (`unjoinedRow`).
 */
export const joinNamesakeHalves = (
  state: GcImportState,
  /** The names the owner has said are not a club (`notThisTeam.ts`): never joined onto it. */
  refused: NotThisTeam = NO_REFUSALS
): { state: GcImportState; joined: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const clubOfSchedule = new Map<string, string>();
  /** The pulled clubs a stand-in's name could be, by squad year and name key. */
  const clubsByName = new Map<string, string[]>();
  let clubs = 0;
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    clubs += 1;
    team.gcTeams.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
    new Set(team.gcTeams.map((link) => poolKeyOf(link.ageGroupId))).forEach((pool) =>
      push(clubsByName, `${pool}\u0000${teamNameKey(team.name)}`, team.id)
    );
  });
  if (clubs < 2) return { state, joined: 0 };
  const ownPage = ownPageFor(state.ageGroups);
  const pulled = (team: ScoutTeam | undefined) => Boolean(team?.gcTeams?.length);
  // As the measurement read them: a slot is a placeholder, and a stand-in any other name only.
  const isSlot = (team: ScoutTeam | undefined) => team?.placeholder === true && !pulled(team);
  const isStandIn = (team: ScoutTeam | undefined) =>
    team?.nameOnly === true && team.placeholder !== true && !pulled(team);

  /*
   * Each game the join made, taken apart into the rows its two schedules filed, to be read again
   * beside every other row: its own row back against the stand-in it named, at the level the name
   * gave, and each row of the other club's it holds stood up as that schedule filed it, the claim
   * against the team it named, on its club's page. `key` is the pair as the reading below names it.
   * A game whose stand-in has since gone from the roster keeps the join, as a claim the claim step
   * reads from then on: there is nothing to put its row back against.
   */
  type Apart = { row: ScoutGame; back: ScoutGame[]; key: string | undefined };
  const apart = new Map<string, Apart>();
  state.games.forEach((game) => {
    // A game the user has thrown out keeps what it holds, as it keeps a claim (`claimFiledRows`).
    if (game.joinedFrom === undefined || game.excluded) return;
    if (!teamById.has(game.joinedFrom)) {
      const { joinedFrom: _from, joinedFromLevel: _level, ...unmarked } = game;
      apart.set(game.id, { row: unmarked, back: [], key: undefined });
      return;
    }
    const theirs = (game.alsoRows ?? []).filter((record) => record.onSideB === true);
    const row = unjoinedRow(game);
    const claim = theirs.find((record) => isJoinedClaim(game, record));
    apart.set(game.id, {
      row,
      back: theirs.map((record) => ownPage(filedRowOf(game, record))),
      key: claim ? `${row.id}\u0000${gcRowId(claim.teamId, claim.gameId)}` : undefined,
    });
  });

  /** A club's own scored row against a side nobody pulled, as one end of a game. */
  type Half = {
    game: ScoutGame;
    club: string;
    other: string;
    pool: string;
    own: number;
    theirs: number;
    /** The level the club played it at, as its own row gives it. */
    level: number | undefined;
  };
  /** Every club's rows, by squad year and club: where the other end of a namer's row is found. */
  const rowsOf = new Map<string, Half[]>();
  const nameKeys = new Map<string, string>();
  const nameKeyOf = (team: ScoutTeam) => {
    const known = nameKeys.get(team.id);
    if (known !== undefined) return known;
    const made = teamNameKey(team.name);
    nameKeys.set(team.id, made);
    return made;
  };
  /** The rows against a stand-in of a pulled club's name, and the clubs of that name. */
  const namers: { half: Half; namesakes: string[] }[] = [];
  const read = (game: ScoutGame) => {
    // Rows with no result wait for one, and a row with no start has no hour to be in.
    if (!game.source || !game.startTs || game.withdrawn || !isScored(game) || game.scoreFromB) {
      return;
    }
    const club = clubOfSchedule.get(game.source.teamId);
    if (club === undefined || club !== game.teamAId) return;
    const other = teamById.get(game.teamBId);
    if (!other || pulled(other)) return;
    const pool = poolKeyOf(game.ageGroupId);
    const half: Half = {
      game,
      club,
      other: other.id,
      pool,
      own: game.teamAScore!,
      theirs: game.teamBScore!,
      level: game.ageLevelA ?? levelOf.get(game.ageGroupId),
    };
    push(rowsOf, `${pool}\u0000${club}`, half);
    if (!isStandIn(other)) return;
    const namesakes = (clubsByName.get(`${pool}\u0000${nameKeyOf(other)}`) ?? []).filter(
      (id) => id !== club
    );
    if (namesakes.length > 0) namers.push({ half, namesakes });
  };
  state.games.forEach((game) => {
    const taken = apart.get(game.id);
    if (!taken) read(game);
    else [taken.row, ...taken.back].forEach(read);
  });
  if (namers.length === 0 && apart.size === 0) return { state, joined: 0 };

  /*
   * Every pair that could be one game, each way it can be read: the namer's row, and a row of a
   * club of the name within the hour with the result mirrored. A pair is one game only where
   * neither row is in any other pair, counted before anything else is asked of it, so a second
   * candidate either way, however poor, leaves both rows where they are.
   */
  type Reading = { a: Half; b: Half };
  const readingsOf = new Map<string, Reading[]>();
  const pairsOf = new Map<string, Set<string>>();
  const note = (gameId: string, pair: string) => {
    const bucket = pairsOf.get(gameId);
    if (bucket) bucket.add(pair);
    else pairsOf.set(gameId, new Set([pair]));
  };
  namers.forEach(({ half: a, namesakes }) =>
    namesakes.forEach((clubId) =>
      (rowsOf.get(`${a.pool}\u0000${clubId}`) ?? []).forEach((b) => {
        if (b.game.id === a.game.id || a.own !== b.theirs || a.theirs !== b.own) return;
        if (!startsWithinTheHour(a.game.startTs, b.game.startTs)) return;
        const pair = [a.game.id, b.game.id].sort().join("\u0000");
        push(readingsOf, pair, { a, b });
        note(a.game.id, pair);
        note(b.game.id, pair);
      })
    )
  );

  /** A's row as one that can take B in: nothing another club's held in it, nothing of B's lent. */
  const takesIn = ({ game, club }: Half) =>
    !game.excluded &&
    game.namedByAvatar === undefined &&
    game.reportedByB === undefined &&
    (game.alsoRows ?? []).every((record) => clubOfSchedule.get(record.teamId) === club) &&
    (game.alsoFrom ?? []).every((schedule) => clubOfSchedule.get(schedule) === club);
  /** B's row as one that can go into A's whole: a bare row, found by its own id. */
  const goesIn = ({ game }: Half) =>
    !game.excluded &&
    game.namedByAvatar === undefined &&
    game.reportedByB === undefined &&
    !game.scoreFromTwin &&
    !game.alsoRows?.length &&
    !game.alsoFrom?.length &&
    game.id === gcRowId(game.source!.teamId, game.source!.gameId);
  const words = (name: string) =>
    new Set([...nameFitWords(name)].filter((word) => word.length >= 3));
  const sharesWord = (a: string, b: string) => {
    const theirs = words(b);
    return [...words(a)].some((word) => theirs.has(word));
  };
  /*
   * B's stand-in for A sharing no word with A's name, read as A all the same where nothing else
   * about the game says otherwise: B in A's state or next door, the two clubs not of one town (a
   * coach there knows the other club's name), their levels a level apart at most, the game not won
   * by ten or more (`UNWORDED_MARGIN`), and the stand-in's name no other pulled club's, which would
   * say B played that club. Measured in the step's own description above.
   */
  const nearAndPlain = (a: Half, b: Half, opponent: ScoutTeam): boolean => {
    const namer = teamById.get(a.club);
    const named = teamById.get(b.club);
    if (!namer?.state || !named?.state) return false;
    if (named.state !== namer.state && !borderingStates(namer.state).has(named.state)) return false;
    const town = townKey(namer.city);
    if (town !== undefined && town === townKey(named.city)) return false;
    if (a.level !== undefined && b.level !== undefined && Math.abs(a.level - b.level) > 1) {
      return false;
    }
    if (Math.abs(a.own - a.theirs) >= UNWORDED_MARGIN) return false;
    return !clubsListedAs(a.pool, nameKeyOf(opponent)).some((id) => id !== a.club && id !== b.club);
  };
  /*
   * The pulled clubs by every name they are listed under: their own, and each of their GameChanger
   * teams' as GameChanger has it, which a merged or renamed club keeps beside a name of its own.
   * Built the first time a pair asks, since most passes ask nothing of it.
   */
  let listedAs: Map<string, string[]> | undefined;
  const clubsListedAs = (pool: string, key: string): string[] => {
    if (!listedAs) {
      listedAs = new Map();
      state.teams.forEach((team) =>
        team.gcTeams?.forEach((link) =>
          [team.name, link.name].forEach((name) =>
            push(listedAs!, `${poolKeyOf(link.ageGroupId)}\u0000${teamNameKey(name)}`, team.id)
          )
        )
      );
    }
    return listedAs.get(`${pool}\u0000${key}`) ?? [];
  };
  /*
   * Whether a club's own schedules have played a stand-in as a team of its own, read off the rows
   * as their schedules filed them: a stand-in a club has played is not a name for that club. Asked
   * only of the stand-ins the pairs below name for A, and answered for all of them in one reading
   * of the rows: filling in every club's opponents instead took a third of the step's 1.6 seconds
   * a pass on the backup of 11 October 2026, and the step now takes 1.3.
   */
  const asked = new Map<string, Set<string>>();
  readingsOf.forEach((readings) =>
    readings.forEach(({ a, b }) => {
      if (!isStandIn(teamById.get(b.other))) return;
      const bucket = asked.get(a.club);
      if (bucket) bucket.add(b.other);
      else asked.set(a.club, new Set([b.other]));
    })
  );
  const played = new Set<string>();
  /*
   * And a copy of the game already standing between either club and another pulled club, within
   * the hour with a result no further from the club's own row's than two scorekeepers' are
   * (`CLOSE_DISPUTE_RUNS`), as the claim step reads a row against a stand-in beside a copy, is one
   * more reading of the game: a pair read beside it is not the only one, so it is noted as a second
   * pair for that club's row. read() leaves such copies out, as no end of a pair, and so the join
   * once never saw them: a second club of B's name pulled after the join, its own row naming A,
   * went onto A by that name beside the joined game, since A's row no longer stood against the
   * stand-in the import would have folded it into, and A counted the game twice, through every
   * tidy after, where the tidy before the join counted it once; so did B, where a club pulled after
   * the join named B. Read beside the copy, the join comes apart, and the steps after it settle the
   * row into the copy, as they do where every schedule is in at the first tidy. Asked only of the
   * clubs the pairs name, in the same reading of the rows. No pair joined on the backups of 25, 26
   * and 29 September and 11 October 2026 has such a copy beside it, and the tidy of each is the
   * same to the byte with the question and without: it is there for the order schedules come in.
   */
  const halvesOf = new Map<string, Half[]>();
  const seen = new Set<string>();
  readingsOf.forEach((readings) =>
    readings.forEach(({ a, b }) =>
      [a, b].forEach((half) => {
        if (seen.has(half.game.id)) return;
        seen.add(half.game.id);
        push(halvesOf, half.club, half);
      })
    )
  );
  if (asked.size > 0 || halvesOf.size > 0) {
    const plays = (club: string | undefined, team: string) => {
      if (club !== undefined && asked.get(club)?.has(team)) played.add(`${club}\u0000${team}`);
    };
    /** `game` from `club`'s seat, set against the halves of that club at its hour. */
    const rivals = (game: ScoutGame, club: string, own: number, theirs: number) =>
      halvesOf.get(club)?.forEach((half) => {
        if (Math.abs(half.own - own) + Math.abs(half.theirs - theirs) > CLOSE_DISPUTE_RUNS) return;
        if (half.pool !== poolKeyOf(game.ageGroupId)) return;
        if (!startsWithinTheHour(half.game.startTs, game.startTs)) return;
        note(half.game.id, `\u0001${game.id}`);
      });
    const of = (game: ScoutGame) => {
      const club = game.source ? clubOfSchedule.get(game.source.teamId) : undefined;
      if (club === game.teamAId) plays(club, game.teamBId);
      else if (club === game.teamBId) plays(club, game.teamAId);
      game.alsoRows?.forEach((record) =>
        plays(
          clubOfSchedule.get(record.teamId),
          record.filedAgainst ?? (record.onSideB ? game.teamAId : game.teamBId)
        )
      );
      if (game.excluded || game.withdrawn || !game.startTs || !isScored(game)) return;
      if (!halvesOf.has(game.teamAId) && !halvesOf.has(game.teamBId)) return;
      if (!pulled(teamById.get(game.teamAId)) || !pulled(teamById.get(game.teamBId))) return;
      rivals(game, game.teamAId, game.teamAScore!, game.teamBScore!);
      rivals(game, game.teamBId, game.teamBScore!, game.teamAScore!);
    };
    state.games.forEach((game) => {
      const taken = apart.get(game.id);
      if (!taken) of(game);
      else [taken.row, ...taken.back].forEach(of);
    });
  }
  const hasPlayed = (clubId: string, teamId: string) => played.has(`${clubId}\u0000${teamId}`);
  const holds = ({ a, b }: Reading): boolean => {
    if (!takesIn(a) || !goesIn(b)) return false;
    const opponent = teamById.get(b.other);
    const namer = teamById.get(a.club);
    if (
      !isSlot(opponent) &&
      !(
        isStandIn(opponent) &&
        (sharesWord(opponent!.name, namer?.name ?? "") || nearAndPlain(a, b, opponent!))
      )
    ) {
      return false;
    }
    if (
      a.level !== undefined &&
      b.level !== undefined &&
      Math.abs(a.level - b.level) > PLAYS_UP_TO
    ) {
      return false;
    }
    /*
     * Two clubs' sibling squads at one event can mirror a score at one instant
     * (`joinCrossedHalves`): one club's 11U beats the other's 11U 5-3 at six while the second
     * club's 12U loses 3-5 to the first's 12U, each coach typing its own squad's age for the other.
     * So where both coaches typed an age, one of the two has to be the other club's own level. One
     * age a level off on its own is let through: on the backup of 11 October 2026, refusing every
     * typed age that was not the other club's own turned away 173 of the 500 pairs, and the same
     * search with B's row a week or a fortnight either side found 7 pairs with it and 7 without;
     * refusing only where both disagree turns away 13. Nor is a stand-in A's own schedule has
     * played as a team of its own a name for A, as the claim step holds it.
     */
    const typedA = a.game.ageLevelB;
    const typedB = b.game.ageLevelB;
    if (typedA !== undefined && typedB !== undefined && typedA !== b.level && typedB !== a.level) {
      return false;
    }
    if (isStandIn(opponent) && hasPlayed(a.club, b.other)) return false;
    /*
     * A name the owner refused files nothing onto the club it was refused for, whichever row wrote
     * it: A's name for B, and B's name for A. Asked of A's alone, a pair where each stand-in carried
     * the other club's very name was joined the other way round, on B's row with A's row as the
     * claim, though the owner had said A's name for B is not B. A refusal is kept under the
     * club's exact name key, so the second question finds one only where B's stand-in carries a
     * name the owner turned away for A, A's very name for one.
     */
    return (
      !refusesName(
        refused,
        a.game.source!.teamId,
        teamById.get(a.other)?.name,
        teamById.get(b.club)
      ) &&
      !refusesName(
        refused,
        b.game.source!.teamId,
        teamById.get(b.other)?.name,
        teamById.get(a.club)
      )
    );
  };
  /** The pairs read as one game, by A's row: each the reading that holds, the earlier A by id. */
  const chosen = new Map<string, Reading>();
  readingsOf.forEach((readings, pair) => {
    const [x, y] = pair.split("\u0000") as [string, string];
    if (pairsOf.get(x)?.size !== 1 || pairsOf.get(y)?.size !== 1) return;
    const reading = readings
      .filter(holds)
      .sort((p, q) => (p.a.game.id < q.a.game.id ? -1 : p.a.game.id > q.a.game.id ? 1 : 0))[0];
    if (reading) chosen.set(reading.a.game.id, reading);
  });

  let joined = 0;
  /** The games the join made that the reading makes again, left exactly as they are. */
  const kept = new Set<string>();
  apart.forEach((taken, id) => {
    const reading = chosen.get(taken.row.id);
    if (taken.key !== undefined && reading && taken.key === `${id}\u0000${reading.b.game.id}`) {
      kept.add(id);
    } else {
      joined += 1;
    }
  });
  const made = new Map<string, ScoutGame>();
  const folded = new Set<string>();
  chosen.forEach(({ a, b }, id) => {
    if (kept.has(id)) return;
    const { ageLevelB: typed, ...row } = a.game;
    const named: ScoutGame = {
      ...row,
      teamBId: b.club,
      ...(b.level === undefined ? {} : { ageLevelB: b.level }),
      joinedFrom: a.other,
      ...(typed === undefined ? {} : { joinedFromLevel: typed }),
    };
    made.set(id, claimInto(named, b.game, b.other, b.game.ageLevelB));
    folded.add(b.game.id);
    joined += 1;
  });
  if (joined === 0) return { state, joined: 0 };

  const games = state.games.flatMap((game) => {
    const taken = apart.get(game.id);
    const rows = !taken || kept.has(game.id) ? [game] : [taken.row, ...taken.back];
    return rows.flatMap((row) => (folded.has(row.id) ? [] : [made.get(row.id) ?? row]));
  });
  return { state: { ...state, games }, joined };
};

/** A game two pulled clubs each hold a copy of: one opponent, one start, one result. */
export type GcTwinGame = {
  date: string;
  startTs: string;
  opponentName: string;
  /** From the clubs' seat, which is the same on both copies. */
  ownScore: number;
  opponentScore: number;
};

/** One squad on GameChanger twice, offered for the user to fold or keep apart. */
export type GcTwinSquad = {
  /** Offered as the one folded away: the club with fewer games of its own schedule. */
  fromTeamId: string;
  fromTeamName: string;
  toTeamId: string;
  toTeamName: string;
  /** A GameChanger id of each, which a "not the same" is recorded against (`keptApart.ts`). */
  fromGcId: string;
  toGcId: string;
  /** What GameChanger says each has played, and how many players it lists, where known. */
  fromRecord?: { win: number; loss: number; tie: number };
  toRecord?: { win: number; loss: number; tie: number };
  fromPlayers?: number;
  toPlayers?: number;
  /** The games both clubs hold, oldest first. */
  shared: GcTwinGame[];
};

/**
 * Two pulled clubs that are one squad on GameChanger twice: a tournament desk's copy, a parent's,
 * a coach's second setup under another name. Both post the same games, so every opponent is
 * credited with each of those games twice and the rating counts them twice; and the season pairing
 * above never offers them, since the names need not match at all.
 *
 * The games say it where the names do not. A pair is offered where the two clubs hold at least two
 * games against the same opponent at the same minute with the same result, have never been
 * scheduled against each other, and never had a game within the hour of each other against
 * different opponents, which one squad cannot do. On the pool of 24 September 2026 that was 55
 * pairs, holding 145 of the 283 games two pulled clubs held twice. One game in common is not
 * enough: the same search run with one club's games moved a week, where no such game is, found 68
 * pairs sharing one against 125 on the real dates, and none sharing two a week or a fortnight
 * either way. A pair that played each other is two squads whatever else they share, so is never
 * offered.
 *
 * Offered, never applied: folding keeps one club's name and drops the other, and only the user can
 * say which is the squad's own. "Not the same" is remembered against the GameChanger ids.
 */
export const proposeTwinSquads = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  apart: KeptApart = new Set<string>()
): GcTwinSquad[] => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const isPulled = (teamId: string) => Boolean(byId.get(teamId)?.gcTeams?.length);
  const gamesOf = new Map<string, ScoutGame[]>();
  /** Each pulled club's side of each timed, scored game, keyed by opponent, minute and result. */
  const sides = new Map<string, { club: string; game: ScoutGame }[]>();
  const keyOf = (opponent: string, minute: number, own: number, theirs: number) =>
    `${opponent}\u0000${minute}\u0000${own}-${theirs}`;
  games.forEach((game) => {
    push(gamesOf, game.teamAId, game);
    push(gamesOf, game.teamBId, game);
    const minute = startMinuteOf(game.startTs);
    if (minute === undefined || game.excluded) return;
    [game.teamAId, game.teamBId].forEach((club) => {
      if (!isPulled(club)) return;
      const seen = scoreSeenBy(game, club);
      if (!seen) return;
      const opponent = club === game.teamAId ? game.teamBId : game.teamAId;
      push(sides, keyOf(opponent, minute, seen.own, seen.opponent), { club, game });
    });
  });
  /** Every pair of clubs sharing a game, with the copies each holds: one game each, once. */
  const pairs = new Map<string, { a: string; b: string; copies: [ScoutGame, ScoutGame][] }>();
  sides.forEach((bucket) => {
    bucket.forEach((x, i) =>
      bucket.slice(i + 1).forEach((y) => {
        if (x.club === y.club || x.game === y.game) return;
        const [a, b] = x.club < y.club ? [x, y] : [y, x];
        const key = `${a.club}\u0000${b.club}`;
        let pair = pairs.get(key);
        if (!pair) {
          pair = { a: a.club, b: b.club, copies: [] };
          pairs.set(key, pair);
        }
        pair.copies.push([a.game, b.game]);
      })
    );
  });

  const fits = nameFitter();
  const offers: GcTwinSquad[] = [];
  pairs.forEach(({ a, b, copies }) => {
    const usedA = new Set<ScoutGame>();
    const usedB = new Set<ScoutGame>();
    const shared = copies
      .slice()
      .sort((p, q) => (p[0].startTs ?? "").localeCompare(q[0].startTs ?? ""))
      .filter(([x, y]) => {
        if (usedA.has(x) || usedB.has(y)) return false;
        usedA.add(x);
        usedB.add(y);
        return true;
      });
    if (shared.length < 2) return;
    const teamA = byId.get(a)!;
    const teamB = byId.get(b)!;
    const linksA = teamA.gcTeams ?? [];
    const linksB = teamB.gcTeams ?? [];
    if (linksA.some((x) => linksB.some((y) => isKeptApart(apart, x.teamId, y.teamId)))) return;
    const gamesA = gamesOf.get(a) ?? [];
    const gamesB = gamesOf.get(b) ?? [];
    if (gamesA.some((game) => game.teamAId === b || game.teamBId === b)) return;
    /*
     * One squad is in one game at a time: two games within the hour on one day are two squads. Two
     * games, though, and not one game each schedule named its own way — "No Chance Wildthings" and
     * "No Chance Wild Things", 2-6 on both at a quarter past six. So the results have to say two
     * games; unplayed, only two different pulled clubs do. Read off names alone, 17 of the 61 pairs
     * sharing two games on the pool of 24 September 2026 were refused for a clash, most of them
     * over one game typed two ways; read off the results, 6. One result against two pulled clubs is
     * one game too: "Music City Saints - Thompson" and "Music City Saints - Walsh", 3-8 on both at
     * one start, are two squads of one club of which one schedule named the wrong one. Three of
     * the 76 offers on the pool of 26 September 2026 rest on such a game.
     */
    const otherOf = (game: ScoutGame, club: string) =>
      game.teamAId === club ? game.teamBId : game.teamAId;
    const clash = gamesA.some((x) => {
      if (usedA.has(x) || !x.date) return false;
      const ox = byId.get(otherOf(x, a));
      if (!ox || ox.placeholder) return false;
      const seenX = scoreSeenBy(x, a);
      return gamesB.some((y) => {
        if (usedB.has(y) || y.date !== x.date || !startsWithinTheHour(x.startTs, y.startTs)) {
          return false;
        }
        const oy = byId.get(otherOf(y, b));
        if (!oy || oy.placeholder || oy.id === ox.id || fits(ox.name, oy.name)) return false;
        const seenY = scoreSeenBy(y, b);
        if (seenX && seenY) return seenX.own !== seenY.own || seenX.opponent !== seenY.opponent;
        return Boolean(ox.gcTeams?.length) && Boolean(oy.gcTeams?.length);
      });
    });
    if (clash) return;
    const own = (club: ScoutTeam) => {
      const ids = new Set((club.gcTeams ?? []).map((link) => link.teamId));
      return (gamesOf.get(club.id) ?? []).filter(
        (game) => game.source && ids.has(game.source.teamId)
      ).length;
    };
    const [from, to] =
      own(teamA) < own(teamB) || (own(teamA) === own(teamB) && teamA.id > teamB.id)
        ? [teamA, teamB]
        : [teamB, teamA];
    const fromLink = from.gcTeams![0]!;
    const toLink = to.gcTeams![0]!;
    offers.push({
      fromTeamId: from.id,
      fromTeamName: from.name,
      toTeamId: to.id,
      toTeamName: to.name,
      fromGcId: fromLink.teamId,
      toGcId: toLink.teamId,
      ...(fromLink.record ? { fromRecord: fromLink.record } : {}),
      ...(toLink.record ? { toRecord: toLink.record } : {}),
      ...(fromLink.playerCount === undefined ? {} : { fromPlayers: fromLink.playerCount }),
      ...(toLink.playerCount === undefined ? {} : { toPlayers: toLink.playerCount }),
      shared: shared.map(([x]) => {
        const seen = scoreSeenBy(x, a)!;
        return {
          date: x.date ?? "",
          startTs: x.startTs ?? "",
          opponentName: byId.get(otherOf(x, a))?.name ?? "",
          ownScore: seen.own,
          opponentScore: seen.opponent,
        };
      }),
    });
  });
  return offers.sort(
    (p, q) =>
      q.shared.length - p.shared.length ||
      p.fromTeamName.localeCompare(q.fromTeamName) ||
      p.fromTeamId.localeCompare(q.fromTeamId)
  );
};

/** How far from the game both schedules hold a third team's copy of it is read as that game. */
const COPY_REACH_MINUTES = 180;

/**
 * Sets a club's own row of a game not to count (`ScoutGame.countedElsewhere`) where it is a third
 * copy: the club it names already has the game against another pulled club, and both of those
 * clubs' own schedules hold it.
 *
 * One squad on GameChanger twice posts each game twice, and the second GameChanger team's row of a
 * game its opponent and the squad's first team both list stands as a game of its own, typed against
 * the opponent: the opponent is credited with the one game twice, once from each squad's copy.
 * Folding the two teams into one is the owner's to do (`proposeTwinSquads`), and is offered only
 * where they share two games or more; until then, and for a pair sharing one, the copy is read here.
 * A row of club X against pulled club C that none of C's schedules holds, beside a game of C's
 * against pulled club Y (not X) that both C's and Y's own schedules hold, within the hour, with the
 * same result from C's seat, is that game: C cannot have played two at once to one score, and the
 * game both schedules agree on is the one that counts. Asked of a bare row only, found by its own
 * id and holding nothing else, where one such game fits it, and where X's own schedules hold no
 * other game that hour, which one squad cannot play.
 *
 * On the backup of 11 October 2026, tidied, that sets 678 copies not to count, against 1.75 a shift
 * off with each such row moved one to four weeks either side, where its game is not: 0.26%. On the
 * backup of 25 September 2026, before most of those squads' second teams were pulled, it sets 33
 * against 2.25: about two a pool either way. Pool Health's list of games counted twice
 * (`countedTwice`) went from 957 groups to 279 on the first, 830 to 152 of those within the hour.
 * The row stays where it is, X's own game on X's page, and still feeds the offer to fold X and Y.
 * Nothing set is final: every pass reads the day again, and a copy the schedules stop bearing out —
 * Y's row gone, a score posted apart, a second game that fits as well — counts again.
 *
 * Out to three hours (`COPY_REACH_MINUTES`) where nothing fits within the hour: the squad's second
 * team often lists the game at another clock. Past the hour the rule is weaker, and the owner chose
 * it anyway on 21 October 2026, knowing so. On the 11 October backup, tidied, it sets 52 more copies
 * not to count, 41 of them within two hours, against 0.75 and 0.625 a shift off with each row moved one to four weeks
 * (61 to 120 minutes and 121 to 180). That shift finds few games near a moved row, though, and the
 * truer check is the games themselves: two real games of one club an hour to two apart give it one
 * result 0.69% of the time (226 of 32,913 pairs both sides' own schedules hold), two to three hours
 * apart 0.80% (113 of 14,165), and those copies had 1,007 and 575 such games near them. So as many
 * as seven and five of them, about one in five, may be a real game the club's own schedule left
 * out, now not counted. Within the hour nothing changes: one game that fits there is the game,
 * whatever fits further out, and two that fit there are left alone without looking further.
 * Past the hour the club's own schedules are asked about the game's hour too (below): 14 of the 52
 * were a club's playing a game of its own then, and count again, leaving 38 not to count.
 */
export const markCountedElsewhere = (
  state: GcImportState
): { state: GcImportState; marked: number } => {
  const pulled = new Set<string>();
  const clubOfSchedule = new Map<string, string>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    pulled.add(team.id);
    team.gcTeams.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
  });
  /** The pulled clubs whose own schedules hold a game: the row it stands on and every row in it. */
  const holdersOf = (game: ScoutGame) => {
    const holders = new Set<string>();
    const add = (schedule: string | undefined) => {
      const club = schedule === undefined ? undefined : clubOfSchedule.get(schedule);
      if (club !== undefined) holders.add(club);
    };
    add(game.source?.teamId);
    game.alsoRows?.forEach((record) => add(record.teamId));
    game.alsoFrom?.forEach(add);
    return holders;
  };
  /** Each pulled club's games both its and its opponent's own schedules hold, timed and scored. */
  const confirmed = new Map<string, ScoutGame[]>();
  /** Each pulled club's games its own schedules hold, timed: what it was playing at each hour. */
  const busy = new Map<string, ScoutGame[]>();
  const copies: ScoutGame[] = [];
  state.games.forEach((game) => {
    if (game.excluded || game.withdrawn || !game.date || !game.startTs || !isScored(game)) return;
    const holders = holdersOf(game);
    holders.forEach((club) => push(busy, club, game));
    const { teamAId: a, teamBId: b } = game;
    if (a !== b && pulled.has(a) && pulled.has(b) && holders.has(a) && holders.has(b)) {
      push(confirmed, a, game);
      push(confirmed, b, game);
    }
    const club = game.source ? clubOfSchedule.get(game.source.teamId) : undefined;
    if (club === undefined || club !== a || b === a || !pulled.has(b) || holders.size !== 1) return;
    if (game.alsoRows?.length || game.alsoFrom?.length || game.reportedByB) return;
    if (game.scoreFromB || game.scoreFromTwin || game.joinedFrom !== undefined) return;
    if (game.id !== gcRowId(game.source!.teamId, game.source!.gameId)) return;
    copies.push(game);
  });
  const marks = new Set<string>();
  copies.forEach((copy) => {
    const { teamAId: x, teamBId: c } = copy;
    const sameResult = (confirmed.get(c) ?? []).filter((game) => {
      const y = game.teamAId === c ? game.teamBId : game.teamAId;
      if (y === x) return false;
      const gap = minutesApart(game.startTs, copy.startTs);
      if (gap === undefined || gap > COPY_REACH_MINUTES) return false;
      const seen = scoreSeenBy(game, c);
      return (
        seen !== undefined && seen.own === copy.teamBScore && seen.opponent === copy.teamAScore
      );
    });
    // Within the hour first, as ever; out to three hours only where nothing fits within it.
    const near = sameResult.filter((game) => startsWithinTheHour(game.startTs, copy.startTs));
    const fits = near.length > 0 ? near : sameResult;
    if (fits.length !== 1) return;
    const [fit] = fits;
    /*
     * Past the hour, X's own schedules are asked about the game's hour too, not the copy's alone:
     * a squad playing another game when C played Y did not post that game, and its row against C
     * is a game of its own, C's own row of it missing (found by Codex on #432).
     */
    const elsewhere = (busy.get(x) ?? []).some(
      (game) =>
        game.id !== copy.id &&
        (startsWithinTheHour(game.startTs, copy.startTs) ||
          (near.length === 0 && startsWithinTheHour(game.startTs, fit!.startTs)))
    );
    if (!elsewhere) marks.add(copy.id);
  });
  let marked = 0;
  const games = state.games.map((game) => {
    const mark = marks.has(game.id);
    if (mark === (game.countedElsewhere === true)) return game;
    marked += 1;
    if (mark) return { ...game, countedElsewhere: true as const };
    const { countedElsewhere: _counted, ...rest } = game;
    return rest;
  });
  return marked === 0 ? { state, marked: 0 } : { state: { ...state, games }, marked };
};

/**
 * Clubs that look like one club listed twice. Offered, never applied: only the user can say that
 * two rosters are the same team, and merging two clubs that merely share a name would quietly ruin
 * both their ratings.
 *
 * Two shapes, because GameChanger mints an id per team per season and both of its consequences
 * reach the pool. A squad carrying on is the one this started as — a Fall id and the Spring id
 * that follows it, which must be joined or a rating cannot carry across a winter it cannot see.
 * The other is a squad listed *twice in one season*: a club creates an id, abandons it, creates
 * another, and the pool ends up with two entries for one roster — one holding every game, the
 * other holding only what other schedules happened to name it. That one was invisible here until
 * now, because the test for a pairing was that the seasons were consecutive, and these are the
 * same season.
 *
 * Teams already paired onto one entry are not offered again, since they are the same team here
 * already.
 */
export const proposeSeasonPairings = (
  teams: ScoutTeam[],
  games: readonly ScoutGame[] = [],
  apart: KeptApart = new Set<string>(),
  /**
   * The pool's pages, so a link is read in the squad year it was filed in. A winter label names
   * either year it straddles (`squadYearOfGcTeam`), and read off the label a Winter 2027 squad
   * playing from November 2026 was a year after its own Fall 2026 and Spring 2027.
   */
  ageGroups: readonly AgeGroup[] = []
): GcSeasonPairing[] => {
  const linked = teams.flatMap((team) => (team.gcTeams ?? []).map((link) => ({ team, link })));
  if (linked.length === 0) return [];
  const pageYear = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const linkYear = (link: GcTeamLink): number =>
    pageYear.get(link.ageGroupId) ?? squadYearForGcSeason(link.season, link.seasonYear ?? 0);

  /**
   * Who each team has played, so "a club in common" can be asked without scanning the games. Only
   * pulled clubs count as an opponent in common: a stand-in called "Warriors" that two schedules
   * both named is two clubs' rec-league neighbours, not one club both of them met.
   */
  const pulledIds = new Set(teams.filter((team) => team.gcTeams?.length).map((team) => team.id));
  const opponents = new Map<string, Set<string>>();
  const note = (teamId: string, opponentId: string) => {
    if (!pulledIds.has(opponentId)) return;
    const met = opponents.get(teamId);
    if (met) met.add(opponentId);
    else opponents.set(teamId, new Set([opponentId]));
  };
  games.forEach((game) => {
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });
  const shareAnOpponent = (a: string, b: string): boolean => {
    const mine = opponents.get(a);
    const theirs = opponents.get(b);
    if (!mine || !theirs) return false;
    for (const opponent of mine) {
      if (theirs.has(opponent)) return true;
    }
    return false;
  };

  /*
   * Only a shared name or a shared picture can make a pairing, so those are the only ids worth
   * looking at for each team. Comparing every id with every other was fine for one club's list
   * and several seconds for a nationwide one, at the end of every pull.
   */
  const byName = new Map<string, typeof linked>();
  const byAvatar = new Map<string, typeof linked>();
  const file = (map: Map<string, typeof linked>, key: string, entry: (typeof linked)[number]) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  };
  linked.forEach((entry) => {
    file(byName, teamNameKey(entry.link.name), entry);
    if (entry.link.avatarKey) file(byAvatar, entry.link.avatarKey, entry);
  });
  const candidatesFor = (from: (typeof linked)[number]): typeof linked => {
    const same = byName.get(teamNameKey(from.link.name)) ?? [];
    const pictured = from.link.avatarKey ? (byAvatar.get(from.link.avatarKey) ?? []) : [];
    return pictured.length === 0 ? same : [...new Set([...same, ...pictured])];
  };

  /**
   * Who coaches each team, over every GameChanger id it is linked to.
   *
   * The staff comes off the user's own team list — GameChanger's public API returns none — so a
   * pool built by hand, or pulled before the list carried it, simply has no staff and everything
   * that reads this falls back on what it always used. Where it is there it is the best thing in
   * the data: `gcStaff.ts` has the measurements.
   */
  const staffIndex = buildStaffIndex(
    teams.map((team) => ({
      teamId: team.id,
      staff: [...new Set((team.gcTeams ?? []).flatMap((link) => link.staff ?? []))],
    }))
  );

  /**
   * How many games each GameChanger id put into the pool off its own schedule.
   *
   * Zero is the tell. An id somebody created and never used still collects games — every club that
   * played it lists the fixture, and those arrive filed against it from the other side — so it
   * looks like a team with a record until you ask which of those games it listed itself. None of
   * them. A club's real second squad at one age level has its own schedule; an abandoned duplicate
   * cannot have one, because nobody ever put a game on it.
   */
  const ownSchedule = new Map<string, number>();
  games.forEach((game) => {
    const listed = game.source?.teamId;
    if (listed === undefined) return;
    ownSchedule.set(listed, (ownSchedule.get(listed) ?? 0) + 1);
  });
  const ownGames = (link: GcTeamLink): number => ownSchedule.get(link.teamId) ?? 0;

  /**
   * The offers, each with the two things the filters below need and the caller does not: whether
   * it crosses into the next squad year, and how far into that year the target season sits.
   */
  const candidates: { pairing: GcSeasonPairing; crossing: boolean; at: number }[] = [];
  for (const from of linked) {
    for (const to of candidatesFor(from)) {
      if (from.team.id === to.team.id) continue;
      if (isKeptApart(apart, from.link.teamId, to.link.teamId)) continue;
      const sameSeason = isSameSeason(from.link, to.link);
      const carriesOn = sameSeason ? null : seasonStep(from.link, to.link, linkYear);
      if (!sameSeason && carriesOn === null) continue;
      /*
       * The ages, which mean different things either side of a season boundary.
       *
       * Inside one season a squad is one age, so two ids at two ages are two squads and there is
       * nothing to discuss. Across seasons the age is exactly what changes: a club's 10U in Spring
       * 2026 is its 11U in Fall 2026 and still its 11U in Spring 2027, and refusing the pairing
       * whenever the levels differed — which is what this did — broke the carry-over at every
       * birthday and left the rating with nothing to follow across the winter. One year, forward
       * only: a squad ages up or stays, it never gets younger, and a two-year jump is somebody
       * else's team.
       *
       * Both ages have to be known. An age nobody wrote down is not an age two ids have in
       * common, and treating two blanks as a match is how "same name, different age" pairs were
       * being offered at all. Where GameChanger gave no level the name usually did, and
       * `relevelFromNames` has already read it by the time anything gets here.
       */
      const fromLevel = linkAgeLevel(from.link);
      const toLevel = linkAgeLevel(to.link);
      if (fromLevel === undefined || toLevel === undefined) continue;
      if (toLevel - fromLevel !== (carriesOn === "ages-up" ? 1 : 0)) continue;
      /*
       * One direction only, for a pair in one season. There is no earlier and later to order them
       * by, so both directions qualify and the pair would be offered twice, pointing opposite
       * ways. The one folded away is the one with less of a schedule of its own — which in the
       * case this was written for is the one with none at all — and the id settles a tie so the
       * list does not depend on which team the loop reached first.
       */
      if (sameSeason) {
        const mine = ownGames(from.link);
        const theirs = ownGames(to.link);
        if (mine > theirs) continue;
        if (mine === theirs && from.link.teamId >= to.link.teamId) continue;
      }

      /*
       * The listings' own key, not the club key. `teamNameKey` drops a parenthetical, because
       * "Heat 9U (Ealey)" and "Heat 9U" are one club for an opponent to have played — but they
       * are two squads, and this is the question of whether two ids are one roster. Matching on
       * the club key was offering "(Ealey)" against "(Brown)" as the same team under a chip that
       * said "same name", which is exactly the kind of wrong that gets approved in bulk.
       */
      const sameName = squadNameKey(from.link.name) === squadNameKey(to.link.name);
      const evidence: GcPairingEvidence[] = [];
      if (from.link.avatarKey && from.link.avatarKey === to.link.avatarKey) evidence.push("avatar");
      if (sharedStaff(from.team.id, to.team.id, staffIndex).length >= 2) evidence.push("staff");
      // A town is evidence only in its own state: Lawrenceburg IN is not Lawrenceburg KY.
      const city = townKey(from.team.city);
      if (city && city === townKey(to.team.city) && from.team.state === to.team.state) {
        evidence.push("city");
      }
      if (from.team.state && from.team.state === to.team.state) evidence.push("state");
      if (shareAnOpponent(from.team.id, to.team.id)) evidence.push("shared-opponent");
      if (sameSeason && (ownGames(from.link) === 0 || ownGames(to.link) === 0)) {
        evidence.push("no-schedule");
      }

      /**
       * A shared name is not enough on its own, and this is where that used to be the whole test.
       * A pool pulled from a nationwide list holds dozens of clubs called the same thing, so a
       * name-only rule offered a page of pairings that were mostly wrong, which is worse than
       * offering none: read enough of them and they all start looking approvable.
       */
      /*
       * The name and the state are asked of every pairing now, not weighed against the rest.
       *
       * A picture used to stand in for the name, on the reasoning that GameChanger keeps a club's
       * badge across seasons. It does not: over a nationwide pull 7,948 teams carried 7,948
       * distinct pictures and not one was shared by two of them. So a pairing made on a picture
       * against a name that did not match was a pairing made on nothing, and the state is the
       * cheapest thing that is true of a club and not of its namesake three states away.
       */
      if (!sameName) continue;
      if (!evidence.includes("state")) continue;
      /*
       * Two GameChanger accounts a season apart with one name in one state are, as often as not,
       * two rec-league teams in two towns. A town in common, a pulled club in common, the same
       * picture, or two coaches is what makes one squad out of them.
       */
      if (evidence.every((item) => item === "state")) continue;

      /*
       * A single season asks for all of it, because inside one season the innocent explanation is
       * a real one: a club running an A and a B squad at 9U names them the same thing, in the same
       * town, in the same state, and merging those two destroys both. So a same-season offer needs
       * the listings to agree on everything there is to agree on — the name exactly, the age, the
       * town and the state — and then the coaches on top, which is the only field in the data that
       * says anything about an organisation. Two in common is the same town 89% of the time
       * against 43% for one; `likelySameSquad` is that rule written down with the age level and
       * the season it needs.
       */
      if (sameSeason) {
        const squadOf = (teamId: string) => {
          const link = teamId === from.team.id ? from.link : to.link;
          return {
            ...(link.ageLevel === undefined ? {} : { ageLevel: link.ageLevel }),
            ...(link.season === undefined || link.seasonYear === undefined
              ? {}
              : { season: { season: link.season, year: link.seasonYear } }),
          };
        };
        if (!evidence.includes("city")) continue;
        if (!likelySameSquad(from.team.id, to.team.id, staffIndex, squadOf)) continue;
      }

      candidates.push({
        crossing: carriesOn === "ages-up",
        at: SEASON_ORDER.indexOf((to.link.season ?? "") as (typeof SEASON_ORDER)[number]),
        pairing: {
          fromTeamId: from.team.id,
          fromTeamName: from.team.name,
          fromSeason: gcSeasonLabel(from.link) || "an unlabelled season",
          toTeamId: to.team.id,
          toTeamName: to.team.name,
          toSeason: gcSeasonLabel(to.link) || "an unlabelled season",
          fromGcId: from.link.teamId,
          toGcId: to.link.teamId,
          evidence,
          sameName,
          /*
           * The name and the state are asked of everything here now, so neither can grade
           * anything: counting them made every offer "strong", which is a grading that says
           * nothing. What is left is what a pairing actually rests on beyond them — the same
           * picture, two coaches in common, or the same town — against a club in common or an
           * empty id, which get this far and are worth reading but not worth approving in bulk.
           */
          confidence:
            evidence.includes("avatar") || evidence.includes("staff") || evidence.includes("city")
              ? "strong"
              : "likely",
          kind: sameSeason ? "same-season" : "next-season",
        },
      });
    }
  }

  /**
   * A squad carries on into exactly one next season. Where two clubs both qualify as the one this
   * team became, neither is offered: the whole point of asking is that the answer is not obvious,
   * and a list that offers both invites picking whichever was read first.
   */
  const outgoing = new Map<string, number>();
  candidates.forEach(({ pairing }) => {
    const key = `${pairing.fromTeamId}\u0000${pairing.toSeason}`;
    outgoing.set(key, (outgoing.get(key) ?? 0) + 1);
  });

  /**
   * And into exactly one next squad *year*, at the first season of it that is here.
   *
   * A club that ran Spring 2026, Fall 2026 and Spring 2027 qualifies twice over on the crossing:
   * the Spring 2026 squad became the Fall 2026 one, and by the same arithmetic it became the
   * Spring 2027 one. Both are true and only the first is worth offering — the second is the same
   * fold arrived at the long way round, and folding along the chain reaches it anyway. Offering
   * both is two rows for one decision, which is precisely the noise that makes a list stop being
   * read.
   */
  const earliest = new Map<string, number>();
  candidates.forEach(({ pairing, crossing, at }) => {
    if (!crossing) return;
    const seen = earliest.get(pairing.fromTeamId);
    if (seen === undefined || at < seen) earliest.set(pairing.fromTeamId, at);
  });

  return (
    candidates
      .filter(
        ({ pairing, crossing, at }) =>
          outgoing.get(`${pairing.fromTeamId}\u0000${pairing.toSeason}`) === 1 &&
          (!crossing || at === earliest.get(pairing.fromTeamId))
      )
      .map(({ pairing }) => pairing)
      // Strongest first, so the ones worth approving in bulk are together at the top.
      .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "strong" ? -1 : 1))
  );
};

/**
 * A pairing that needs nobody's say-so: the same name, the same town and the same state, a season
 * apart at one level. That is a club, not a coincidence — two Butler Baseballs in one town in one
 * state at 9U, one Fall and one Spring, are the same roster with a new GameChanger id. Anything
 * short of all three is offered rather than applied: a name and a state alone still fit a dozen
 * clubs across a state, and a name and a club in common fits any two teams from one league.
 *
 * Never a pairing inside one season, however much evidence it carries. A season apart, the same
 * name in one town is one roster because a club does not run two squads a season apart under one
 * name at one age; inside a season it is exactly what an A squad and a B squad look like, and the
 * thing telling those apart from one roster listed twice — a side with no schedule of its own, or
 * the coaches — is inference rather than arithmetic. `gcStaff.ts` says it plainly of its own
 * evidence: nothing there merges anything, it proposes. So does this.
 */
export const isSettledPairing = (pairing: GcSeasonPairing): boolean =>
  pairing.kind === "next-season" &&
  pairing.sameName &&
  pairing.evidence.includes("city") &&
  pairing.evidence.includes("state");

/**
 * Applies the settled pairings — earlier squad folded into the later one, as the panel does when
 * a pairing is ticked. A squad paired on into a season that was itself paired on follows the
 * chain to whichever entry survived, so Fall → Winter → Spring ends as one team whatever order
 * the pairs come in.
 */
export const pairSettledSquads = (
  state: GcImportState,
  progress?: (processed: number, total: number, paired: number) => void,
  apart: KeptApart = new Set<string>()
): { state: GcImportState; paired: number } => {
  const settled = proposeSeasonPairings(state.teams, state.games, apart, state.ageGroups).filter(
    isSettledPairing
  );
  if (settled.length === 0) return { state, paired: 0 };

  /*
   * Resolve the graph before touching the pool. Calling `mergeScoutTeams` here used to walk every
   * team and every game once per edge (and collapse games along the way). A nationwide batch has
   * thousands of edges. The map below makes the decision once, then each array is walked once.
   */
  const outgoing = new Map<string, string[]>();
  settled.forEach((pairing, index) => {
    push(outgoing, pairing.fromTeamId, pairing.toTeamId);
    // Frequent enough to prove a large pass is alive without flooding the worker port.
    if (progress && ((index + 1) % 100 === 0 || index + 1 === settled.length))
      progress(index + 1, settled.length, outgoing.size);
  });

  /*
   * A season can have both a direct Fall -> Spring edge and Fall -> Winter -> Spring edges. Follow
   * any branch to its sink; settled branches converge on the same latest squad. Resolving after
   * collecting them makes the answer independent of proposal order.
   */
  const movedTo = new Map<string, string>();
  const survivorOf = (teamId: string, seen = new Set<string>()): string => {
    const known = movedTo.get(teamId);
    if (known) return known;
    if (seen.has(teamId)) return teamId;
    const next = outgoing.get(teamId)?.[0];
    if (!next) return teamId;
    seen.add(teamId);
    const survivor = survivorOf(next, seen);
    movedTo.set(teamId, survivor);
    return survivor;
  };
  outgoing.forEach((_into, from) => survivorOf(from));
  const paired = movedTo.size;
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const removed = new Set(movedTo.keys());
  const members = new Map<string, ScoutTeam[]>();
  movedTo.forEach((into, from) => {
    const team = byId.get(from);
    if (team) push(members, into, team);
  });
  const teams = state.teams.flatMap((team) => {
    if (removed.has(team.id)) return [];
    const folded = members.get(team.id);
    if (!folded?.length) return [team];
    const links = [...(team.gcTeams ?? [])];
    const linked = new Set(links.map((link) => link.teamId));
    folded.forEach((old) =>
      (old.gcTeams ?? []).forEach((link) => {
        if (!linked.has(link.teamId)) {
          linked.add(link.teamId);
          links.push(link);
        }
      })
    );
    const fallback = (field: "name" | "state" | "city") =>
      folded.map((old) => old[field]).find(Boolean);
    return [
      {
        ...team,
        ...(!team.name.trim() && fallback("name") ? { name: fallback("name") } : {}),
        ...(!team.state && fallback("state") ? { state: fallback("state") } : {}),
        ...(!team.city && fallback("city") ? { city: fallback("city") } : {}),
        ...(team.isMine || folded.some((old) => old.isMine) ? { isMine: true } : {}),
        ...(links.length ? { gcTeams: links } : {}),
      },
    ];
  });
  const games = state.games.flatMap((game) => {
    const teamAId = movedTo.get(game.teamAId) ?? game.teamAId;
    const teamBId = movedTo.get(game.teamBId) ?? game.teamBId;
    // A game the pairing made one squad's against itself; one some team already had against itself
    // is not the pairing's to take (`mergeScoutTeams`).
    if (teamAId === teamBId && game.teamAId !== game.teamBId) return [];
    const moved =
      teamAId === game.teamAId && teamBId === game.teamBId ? game : { ...game, teamAId, teamBId };
    // A row claimed from a squad paired away was filed against the squad it pairs into.
    return [withFiledRepointed(moved, (id) => movedTo.get(id) ?? id)];
  });
  return { state: { ...state, teams, games }, paired };
};

/** One side of a pairing, as the user would compare it with the other. */
export type GcPairingSide = {
  teamName: string;
  /** The name exactly as GameChanger has it for this season's id. */
  gcName: string;
  season: string;
  city?: string;
  state?: string;
  record?: { win: number; loss: number; tie: number };
  /** Games this entry holds here. */
  games: number;
  /** Everyone this entry has played, by name. */
  opponents: string[];
};

export type GcPairingComparison = {
  from: GcPairingSide;
  to: GcPairingSide;
  /** Opponents both have played — the strongest thing two rosters a season apart can share. */
  sharedOpponents: string[];
};

/**
 * The two clubs of a pairing side by side: what GameChanger said about each, where each is from,
 * and who each has played. This is what a person looks at before saying two rosters are one — the
 * list offers a pill's worth of evidence, and a pill is not enough to decide an amber one on.
 */
export const comparePairing = (
  pairing: GcSeasonPairing,
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[]
): GcPairingComparison | null => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const side = (teamId: string, season: string): GcPairingSide | null => {
    const team = byId.get(teamId);
    if (!team) return null;
    const link =
      team.gcTeams?.find((candidate) => gcSeasonLabel(candidate) === season) ?? team.gcTeams?.[0];
    const opponents = new Set<string>();
    let count = 0;
    games.forEach((game) => {
      if (game.teamAId !== teamId && game.teamBId !== teamId) return;
      count += 1;
      const other = byId.get(game.teamAId === teamId ? game.teamBId : game.teamAId);
      if (other) opponents.add(other.name);
    });
    return {
      teamName: team.name,
      gcName: link?.name ?? team.name,
      season,
      ...(team.city ? { city: team.city } : {}),
      ...(team.state ? { state: team.state } : {}),
      ...(link?.record ? { record: link.record } : {}),
      games: count,
      opponents: [...opponents].sort((a, b) => a.localeCompare(b)),
    };
  };
  const from = side(pairing.fromTeamId, pairing.fromSeason);
  const to = side(pairing.toTeamId, pairing.toSeason);
  if (!from || !to) return null;
  const theirs = new Set(to.opponents);
  return { from, to, sharedOpponents: from.opponents.filter((name) => theirs.has(name)) };
};

/**
 * What a finished pull did, in one line per thing worth saying. The panel shows this above the
 * per-team rows, which for a nationwide pull are far too many to read.
 */
export const summarizeGcImport = (outcomes: GcImportOutcome[]): string[] => {
  const filed = outcomes.filter((outcome) => !outcome.issue);
  // Left out because the pull was told to leave them out, which is not the same as failing.
  const otherSeason = outcomes.filter((outcome) => outcome.skip === "other-season").length;
  // Left for the pull that meets them in their season, which is not failing either.
  const later = outcomes.filter((outcome) => outcome.skip === "out-of-season").length;
  const failed = outcomes.length - filed.length - otherSeason - later;
  const sum = (pick: (outcome: GcImportOutcome) => number) =>
    filed.reduce((total, outcome) => total + pick(outcome), 0);

  const lines: string[] = [];
  lines.push(
    `${filed.length} schedule${filed.length === 1 ? "" : "s"} read${
      failed ? `, ${failed} that could not be filed` : ""
    }.`
  );
  if (otherSeason > 0) {
    lines.push(
      `${otherSeason} team${otherSeason === 1 ? "" : "s"} from a season this pull was not asked for left out.`
    );
  }
  if (later > 0) {
    lines.push(
      `${later} team${later === 1 ? "" : "s"} with no age and no games, from a season not being played, left for a later pull.`
    );
  }

  const outOfSeason = sum((outcome) => outcome.gamesOutOfSeason);
  if (outOfSeason > 0) {
    lines.push(
      `${outOfSeason} game${outOfSeason === 1 ? "" : "s"} dated before the season began (August 1) left out.`
    );
  }
  const added = sum((outcome) => outcome.gamesAdded);
  const updated = sum((outcome) => outcome.gamesUpdated);
  const unchanged = sum((outcome) => outcome.gamesUnchanged);
  lines.push(
    `${added} game${added === 1 ? "" : "s"} added, ${updated} updated, ${unchanged} already had.`
  );

  const createdTeams = filed.filter((outcome) => outcome.createdTeam).length;
  const createdOpponents = sum((outcome) => outcome.opponentsCreated);
  const byAvatar = sum((outcome) => outcome.opponentsMatchedByAvatar);
  const byName = sum((outcome) => outcome.opponentsMatchedByName);
  lines.push(
    `${createdTeams + createdOpponents} team${
      createdTeams + createdOpponents === 1 ? "" : "s"
    } new, ${byAvatar} opponent${byAvatar === 1 ? "" : "s"} recognised by picture, ${byName} by name.`
  );

  const newPages = filed.filter((outcome) => outcome.createdAgeGroup);
  if (newPages.length) {
    lines.push(
      `${newPages.length} page${newPages.length === 1 ? "" : "s"} created: ${newPages
        .map((outcome) => outcome.ageGroupName)
        .join(", ")}.`
    );
  }

  const unranked = filed.filter((outcome) => !isRankedAgeLevel(ageLevelOfOutcome(outcome))).length;
  if (unranked) {
    lines.push(
      `${unranked} went to a level that is not ranked; those games count as evidence about the older teams that played them.`
    );
  }

  const ignored = sum((outcome) => outcome.gamesIgnored);
  if (ignored) {
    lines.push(`${ignored} listed game${ignored === 1 ? " was" : "s were"} cancelled or undated.`);
  }
  return lines;
};

/** The level a report row landed on, read back off the page name it was filed under. */
const ageLevelOfOutcome = (outcome: GcImportOutcome): number | undefined => {
  const match = /^(\d{1,2})U\b/.exec(outcome.ageGroupName);
  return match ? Number(match[1]) : undefined;
};

/**
 * Folds together the GameChanger ids that turned out to be one squad.
 *
 * A team pulled by id *is* that id, and pairing a club's Fall roster to its Spring one is the
 * user's call — that rule is right and it stays. What it was never meant to cover is one squad
 * holding several ids inside a single rating pool: a nationwide list turned up "Yeager Davis" as
 * a Fall 2026 id and two Spring 2027 ids, all 11U, all landing on the 11U 2027 table, two of them
 * carrying the very same game. The table showed the club twice, each copy 1-0 off one half of its
 * own season. That is not a pairing decision, it is one club the app failed to recognise.
 *
 * What proves it is the game, as ever: two ids that filed the same fixture — same day, same
 * opponent, and the same result from their side of it — played that game, and only one team can
 * have. Two clubs of one name that never met and never shared a result are left alone, which is
 * what keeps this from being the name matching the user threw out.
 *
 * The survivor is the id with the most games, so the fold is towards whichever copy the pull knows
 * best, and `mergeScoutTeams` carries the games and both ids across.
 */
export const mergeSameSquadIds = (
  state: GcImportState
): { state: GcImportState; merged: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const pulled = state.teams.filter((team) => team.gcTeams?.length);
  if (pulled.length < 2) return { state, merged: 0 };

  /** The GameChanger ids each team is known by, so a row can be told to be its own schedule's. */
  const ownIds = new Map(
    pulled.map((team) => [team.id, new Set((team.gcTeams ?? []).map((link) => link.teamId))])
  );

  /**
   * A game as the club that filed it would describe it: the day, who, and how it went — counted
   * only from the team's own schedule. A row that somebody else's schedule filed against this
   * team by name is the very thing that may be wrong, and reading it as this team's account of
   * the game let a misfiled row "prove" two clubs one squad: ten 8U Dodgers in ten states were
   * folded on fixtures none of them had filed.
   */
  const fixtureKeys = new Map<string, Set<string>>();
  const nameOf = new Map(state.teams.map((team) => [team.id, teamNameKey(team.name)]));
  state.games.forEach((game) => {
    if (!game.date || !game.source) return;
    [game.teamAId, game.teamBId].forEach((teamId, side) => {
      if (!ownIds.get(teamId)?.has(game.source!.teamId)) return;
      const otherId = side === 0 ? game.teamBId : game.teamAId;
      const other = nameOf.get(otherId);
      if (!other) return;
      const mine = side === 0 ? game.teamAScore : game.teamBScore;
      const theirs = side === 0 ? game.teamBScore : game.teamAScore;
      // Unscored rows say only that a fixture is planned, which two clubs can share.
      if (mine === undefined || theirs === undefined) return;
      const key = [poolKeyOf(game.ageGroupId), game.date, other, mine, theirs].join(" ");
      const bucket = fixtureKeys.get(teamId);
      if (bucket) bucket.add(key);
      else fixtureKeys.set(teamId, new Set([key]));
    });
  });

  /**
   * Whether two pulled teams could even be one squad: the same level on every id, the same state
   * where both give one, and the same listing name once only the age label is removed. A club's
   * 9U and 10U are two rosters; so are "Heat 9U (Ealey)" and "Heat 9U (Campana)"; and a Chico
   * Aces and a Pansey Aces are two clubs whatever they filed.
   */
  const couldBeOneSquad = (a: ScoutTeam, b: ScoutTeam): boolean => {
    const links = [...(a.gcTeams ?? []), ...(b.gcTeams ?? [])];
    const levels = new Set(links.map((link) => link.ageLevel));
    if (levels.size !== 1 || levels.has(undefined)) return false;
    if (a.state && b.state && a.state !== b.state) return false;
    return new Set(links.map((link) => squadNameKey(link.name))).size === 1;
  };

  /** Ids to fold, newest-known first, keyed by the id they fold into. */
  const foldInto = new Map<string, string>();
  // Counted once. Counting by scanning the games for each team made this pass quadratic, and it
  // runs at the end of every pull over the whole pool.
  const gameCounts = new Map<string, number>();
  state.games.forEach((game) => {
    gameCounts.set(game.teamAId, (gameCounts.get(game.teamAId) ?? 0) + 1);
    gameCounts.set(game.teamBId, (gameCounts.get(game.teamBId) ?? 0) + 1);
  });
  const gamesFor = (teamId: string): number => gameCounts.get(teamId) ?? 0;

  const byName = new Map<string, ScoutTeam[]>();
  pulled.forEach((team) => {
    const key = teamNameKey(team.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(team);
    else byName.set(key, [team]);
  });

  byName.forEach((group) => {
    if (group.length < 2) return;
    const ranked = group.slice().sort((a, b) => gamesFor(b.id) - gamesFor(a.id));
    ranked.forEach((team, index) => {
      if (index === 0 || foldInto.has(team.id)) return;
      const mine = fixtureKeys.get(team.id);
      if (!mine || mine.size === 0) return;
      for (const other of ranked.slice(0, index)) {
        if (foldInto.has(other.id)) continue;
        if (!couldBeOneSquad(team, other)) continue;
        const theirs = fixtureKeys.get(other.id);
        if (!theirs) continue;
        const shared = [...mine].some((key) => theirs.has(key));
        if (shared) {
          foldInto.set(team.id, other.id);
          break;
        }
      }
    });
  });

  if (foldInto.size === 0) return { state, merged: 0 };
  return { state: applyFolds(foldInto, state), merged: foldInto.size };
};

/**
 * Applies every fold in one pass.
 *
 * `mergeScoutTeams` walks the whole pool for each merge — every game repointed, every team
 * filtered, then a collapse over what came out. One at a time that is right and readable, and on a
 * nationwide pool it is the wrong shape entirely: the cost is the number of folds times the number
 * of games, and the number of folds is itself a measure of how messy the pool is. Measured at two
 * hundred thousand games a single fold is about 20ms, so a thousand of them — which a nationwide
 * pull produces easily — is twenty seconds, per tidy pass, of which there are up to six.
 *
 * Here the games are walked once however many folds there are, and the collapse afterwards is one
 * pass rather than one per fold. The result is the same pool: the merges are independent of each
 * other, because a team folded away is never also a target (the pass above never picks one that is
 * already folding), so there is no order in which they have to be applied.
 */
const applyFolds = (foldInto: ReadonlyMap<string, string>, state: GcImportState): GcImportState => {
  /**
   * Where an id ends up. Flat in practice — the pass above never folds into a team that is itself
   * folding — but followed to a fixed point anyway, with a guard, because a chain arriving here
   * would otherwise leave half the pool pointing at a team that no longer exists.
   */
  const finalOf = (id: string): string => {
    let at = id;
    for (let hops = 0; hops < foldInto.size; hops += 1) {
      const next = foldInto.get(at);
      if (next === undefined || next === at) return at;
      at = next;
    }
    return at;
  };

  /** The teams folding into each survivor, in the order the pass decided them. */
  const sources = new Map<string, ScoutTeam[]>();
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  foldInto.forEach((_intoId, fromId) => {
    const into = finalOf(fromId);
    const team = byId.get(fromId);
    if (!team || into === fromId) return;
    const bucket = sources.get(into);
    if (bucket) bucket.push(team);
    else sources.set(into, [team]);
  });

  const teams = state.teams.flatMap((team): ScoutTeam[] => {
    if (foldInto.has(team.id) && finalOf(team.id) !== team.id) return [];
    const folded = sources.get(team.id);
    if (!folded || folded.length === 0) return [team];

    // Field by field, in the order the folds were decided — the first source to carry something
    // the survivor lacks is the one that fills it, which is what merging them one at a time did.
    let merged = team;
    const linkedIds = new Set((team.gcTeams ?? []).map((link) => link.teamId));
    const gcTeams = [...(team.gcTeams ?? [])];
    folded.forEach((from) => {
      (from.gcTeams ?? []).forEach((link) => {
        if (linkedIds.has(link.teamId)) return;
        linkedIds.add(link.teamId);
        gcTeams.push(link);
      });
      if (!merged.name.trim() && from.name.trim()) merged = { ...merged, name: from.name };
      // A state the owner cleared stays clear (`ScoutTeam.stateCleared`).
      if (!merged.state && !merged.stateCleared && from.state) {
        merged = { ...merged, state: from.state };
      }
      if (!merged.city && from.city) merged = { ...merged, city: from.city };
      // "Our team" is a fact about the club, so it survives whichever half carried it.
      if (!merged.isMine && from.isMine) merged = { ...merged, isMine: true };
    });
    if (gcTeams.length !== (team.gcTeams?.length ?? 0)) merged = { ...merged, gcTeams };
    return [merged];
  });

  const repointed: ScoutGame[] = [];
  state.games.forEach((game) => {
    const teamAId = finalOf(game.teamAId);
    const teamBId = finalOf(game.teamBId);
    // Both sides of the game turned out to be the same club: it was never two teams playing. A game
    // some team already had against itself is not the fold's to take (`mergeScoutTeams`): taken
    // here, every scrimmage in the pool went whenever any two squads folded.
    if (teamAId === teamBId && game.teamAId !== game.teamBId) return;
    const moved =
      teamAId === game.teamAId && teamBId === game.teamBId ? game : { ...game, teamAId, teamBId };
    // A row claimed from a squad folded away was filed against the squad it folded into.
    repointed.push(withFiledRepointed(moved, finalOf));
  });

  // One collapse for every fold rather than one each: the rows a fold made into duplicates are all
  // in this array now, and the pass is over the whole array either way.
  const collapsed = collapseSameGames(repointed, state.ageGroups);
  return { ...state, teams, games: collapsed.games };
};

/**
 * Whether one of `schedules` gave `game` a row of its own that `game` holds folded in or on record
 * (`ScoutGame.alsoFrom`): the club they belong to filed the game as surely as its source did. A
 * schedule on record only through rows it filed against somebody else, which `game`'s club claimed
 * (`FoldedRow.filedAgainst`), did not file this game against that club, and does not count. A claim
 * a merge settled on that very club (`isSettledClaim`) is filed against it by name, and does: read
 * as a claim, a namesake pulled later took the copy, and the row stood back up against the club
 * whose copy it had been, one loss counted twice. So does the claim the namesake join holds
 * (`isJoinedClaim`), the club's own row of the game, which only the join takes back.
 */
const filedInto = (game: ScoutGame, schedules: ReadonlySet<string> | undefined): boolean =>
  (game.alsoFrom ?? []).some((id) => {
    if (!schedules?.has(id)) return false;
    const records = (game.alsoRows ?? []).filter((record) => record.teamId === id);
    return (
      records.length === 0 ||
      records.some((record) => record.filedAgainst === undefined || isHeldAsOwn(game, record))
    );
  });

/**
 * Moves a game filed by name onto the namesake whose own schedule holds it.
 *
 * A schedule names an opponent; the import attaches the row to a pulled club of that name. When
 * a second club of the name is pulled later and *its* own schedule lists this very game — same
 * day, this puller, the result mirrored — the row was on the wrong club, and nothing at arrival
 * time could have known. The fixture beats the name, order-independently: the row moves to the
 * club that filed it, where the collapse then makes one game of the two. Only where exactly one
 * namesake holds it and the club it sits on does not; anything less stays as it is.
 */
export const reclaimMisfiled = (
  state: GcImportState
): { state: GcImportState; reclaimed: number } => {
  const fits = nameFitter();
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const ownIds = new Map<string, Set<string>>();
  /** The levels each pulled club is listed at, as `resettleOffLevel` reads them. */
  const levels = new Map<string, Set<number>>();
  const namesakes = new Map<string, string[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    ownIds.set(team.id, new Set(team.gcTeams.map((link) => link.teamId)));
    const listed = new Set<number>();
    team.gcTeams.forEach((link) => {
      const level = link.ageLevel ?? levelOf.get(link.ageGroupId);
      if (level !== undefined) listed.add(level);
    });
    levels.set(team.id, listed);
    const key = teamNameKey(team.name);
    const bucket = namesakes.get(key);
    if (bucket) bucket.push(team.id);
    else namesakes.set(key, [team.id]);
  });
  if (namesakes.size === 0) return { state, reclaimed: 0 };

  const isOwnRow = (game: ScoutGame, teamId: string): boolean =>
    game.source !== undefined && (ownIds.get(teamId)?.has(game.source.teamId) ?? false);
  /** Each pulled team's own-schedule rows by day. */
  const ownByDay = new Map<string, ScoutGame[]>();
  state.games.forEach((game) => {
    if (!game.date) return;
    [game.teamAId, game.teamBId].forEach((teamId) => {
      if (!isOwnRow(game, teamId)) return;
      const key = `${teamId}\u0000${game.date}`;
      const bucket = ownByDay.get(key);
      if (bucket) bucket.push(game);
      else ownByDay.set(key, [game]);
    });
  });

  const score = (game: ScoutGame, teamId: string) =>
    game.teamAId === teamId ? game.teamAScore : game.teamBScore;
  /**
   * Whether this club's own schedule has a row that day that could be `row`: against the puller
   * itself, or against a stand-in for it.
   *
   * The second is the same game written down by a coach who did not type the puller's name the
   * way GameChanger lists it. A club called "Hurricanes" lost 2-13 to the Cincy Stix 9U Navy on
   * 20 September 2026 and wrote its opponent as "Stix"; with another Ohio club called "Hurricanes"
   * pulled first, the Stix's own row went to that one by name, and nothing could move it, because
   * the real Hurricanes' schedule held the game against a "Stix" stand-in rather than against the
   * Stix. A stand-in whose name is a shorthand for the puller's (`nameFitsWithin`), in the same
   * region, is that row — but only on stronger evidence than the puller's own name needs: the same
   * start time, or at another time both results mirrored. A name that fits is weaker evidence than
   * a name that is the puller's, so it does not get the benefit of a missing score. The same start
   * time holds whatever the two coaches scored: on the stand-in fixtures export of 22 September
   * 2026, 35 rows sat at one instant with results that differed, against 3 in the same search a
   * week either side.
   */
  const holdsAs = (
    clubId: string,
    pullerId: string,
    row: ScoutGame,
    own: ScoutGame,
    exact = false
  ): boolean => {
    // The side of `row` that is not the puller: what the club being asked about would stand in.
    const rowClub = score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId);
    const rowPuller = score(row, pullerId);
    const puller = teamById.get(pullerId);
    {
      const other = own.teamAId === clubId ? own.teamBId : own.teamAId;
      const ownClub = score(own, clubId);
      const ownPuller = score(own, other);
      if (other === pullerId) {
        if (ownClub === undefined || ownPuller === undefined) return true;
        if (rowClub === undefined || rowPuller === undefined) return true;
        return ownClub === rowClub && ownPuller === rowPuller;
      }
      if (exact) return false;
      const stand = teamById.get(other);
      if (!puller || !stand?.nameOnly || !fits(stand.name, puller.name)) return false;
      if (!inOneRegion(puller.state, teamById.get(clubId)?.state)) return false;
      // One start time is one game, whatever the two coaches scored it; at another time only a
      // mirrored result says so.
      if (sameStart(own.startTs, row.startTs)) return true;
      const scored = [ownClub, ownPuller, rowClub, rowPuller].every((value) => value !== undefined);
      return scored && ownClub === rowClub && ownPuller === rowPuller;
    }
  };
  const holds = (clubId: string, pullerId: string, row: ScoutGame, exact = false): boolean =>
    (ownByDay.get(`${clubId}\u0000${row.date}`) ?? []).some((own) =>
      holdsAs(clubId, pullerId, row, own, exact)
    );

  /*
   * Each pulled club's own scored rows, by start minute and the result from the club's own seat:
   * where a club's own row of a game is, found by the game rather than by the club's name. Looking
   * each namesake up by name instead cost about 6 s a pass on the pool of 26 September 2026.
   */
  const ownAtStart = new Map<string, { clubId: string; own: ScoutGame }[]>();
  const atStartKey = (minute: number, club: number, other: number) => `${minute}|${club}-${other}`;
  state.games.forEach((game) => {
    if (!isScored(game) || game.scoreFromB || game.scoreFromTwin) return;
    const minute = startMinuteOf(game.startTs);
    if (minute === undefined || !isOwnRow(game, game.teamAId)) return;
    push(ownAtStart, atStartKey(minute, game.teamAScore!, game.teamBScore!), {
      clubId: game.teamAId,
      own: game,
    });
  });
  /**
   * The clubs whose own schedule has `row` at its very start with the result mirrored, against the
   * puller or against a team that could be the puller by another name: a slot, any stand-in, or a
   * pulled club named like the puller whose own schedules never list the game. What `holds` asks of
   * one club, asked of the game, and without the name: a coach who typed the puller as "TBD", or as
   * a name another club of the puller's name was pulled under, still wrote this game down, at this
   * start, with this score. The puller's own row is among them where the game was a tie against a
   * club of its own name, and is never a holder (below).
   */
  const atTheStart = (row: ScoutGame, pullerId: string, exact = false): Set<string> => {
    const minute = startMinuteOf(row.startTs);
    const rowClub = score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId);
    const rowPuller = score(row, pullerId);
    const puller = teamById.get(pullerId);
    if (minute === undefined || rowClub === undefined || rowPuller === undefined || !puller) {
      return new Set();
    }
    const found = new Set<string>();
    (ownAtStart.get(atStartKey(minute, rowClub, rowPuller)) ?? []).forEach(({ clubId, own }) => {
      if (exact ? own.teamBId === pullerId : standsForPuller(own, pullerId, puller)) {
        found.add(clubId);
      }
    });
    return found;
  };
  /** Whether the other side of a club's own row could be the puller by another name. */
  const standsForPuller = (own: ScoutGame, pullerId: string, puller: ScoutTeam): boolean => {
    const other = own.teamBId;
    const vs = teamById.get(other);
    return (
      other === pullerId ||
      vs?.placeholder === true ||
      vs?.nameOnly === true ||
      (vs !== undefined &&
        Boolean(vs.gcTeams?.length) &&
        (teamNameKey(vs.name) === teamNameKey(puller.name) || fits(vs.name, puller.name)) &&
        !filedInto(own, ownIds.get(other)))
    );
  };
  /** `atTheStart` asked of one row of the club's own: the very start, the result mirrored. */
  const atItsStart = (row: ScoutGame, pullerId: string, own: ScoutGame): boolean => {
    const puller = teamById.get(pullerId);
    const minute = startMinuteOf(row.startTs);
    return (
      puller !== undefined &&
      minute !== undefined &&
      isScored(row) &&
      isScored(own) &&
      startMinuteOf(own.startTs) === minute &&
      own.teamAScore === score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId) &&
      own.teamBScore === score(row, pullerId) &&
      standsForPuller(own, pullerId, puller)
    );
  };

  let reclaimed = 0;
  const games = state.games.map((game) => {
    if (!game.date || !game.source) return game;
    // The puller is the side whose schedule filed the row; the other side was attached by name.
    const pullerId = isOwnRow(game, game.teamAId)
      ? game.teamAId
      : isOwnRow(game, game.teamBId)
        ? game.teamBId
        : undefined;
    if (!pullerId) return game;
    const namedId = pullerId === game.teamAId ? game.teamBId : game.teamAId;
    const named = teamById.get(namedId);
    if (!named?.gcTeams?.length) return game;
    // Named by its picture, not attached by name (`ScoutGame.namedByAvatar`).
    if (game.namedByAvatar === namedId) return game;
    // Attached by name only: the club it sits on did not file it, and its own schedule does not
    // hold a row that could be it. A row a join or a slot fold made one of two keeps the other
    // club's schedule in `alsoFrom`, and that club filed it as surely as the puller did: reading
    // `source` alone moved a joined Stix–Hurricanes game onto another Ohio "Hurricanes" in the
    // very tidy that joined it.
    const alsoFiled = filedInto(game, ownIds.get(namedId));
    if (isOwnRow(game, namedId) || alsoFiled || holds(namedId, pullerId, game)) return game;
    /*
     * The club it sits on may hold the game all the same: its own row of it folded in as a claim,
     * filed against a stand-in or a slot (`FoldedRow.filedAgainst`), is out of `ownByDay` and so
     * out of `holds`. Read as no evidence, a namesake whose own row stood against another stand-in
     * of the name took the copy, the claim then stood back up and held the game again, and the two
     * clubs took turns with it on every pass: on the backup of 11 October 2026 four copies did, and
     * every tidy ran to its six-pass limit. Where the claim holds the game, only a namesake whose
     * own row stands against the puller itself has better evidence. Only a claim of the game's day
     * counts, as only a standing row of that day does (`ownByDay`): a claim folded in from a day
     * apart (`FoldedRow.date`) would otherwise keep the copy from a namesake whose own row that day
     * holds it.
     */
    const claimed = (game.alsoRows ?? []).flatMap((record) => {
      if (record.filedAgainst === undefined || !ownIds.get(namedId)?.has(record.teamId)) return [];
      const own = filedRowOf(game, record);
      return own.date === game.date ? [own] : [];
    });
    const heldByClaim = claimed.some(
      (own) => holdsAs(namedId, pullerId, game, own) || atItsStart(game, pullerId, own)
    );
    const atStart = atTheStart(game, pullerId);
    if (atStart.has(namedId)) return game;
    const pool = poolKeyOf(game.ageGroupId);
    const level =
      (namedId === game.teamAId ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    /*
     * Only a namesake at a level the row could be played at — the test `resettleOffLevel` holds a
     * row to. Without it a "Hurricanes 12U" with a mirrored result against a "Stix" that day took
     * the 9U Stix's game, the next step handed it back for being three levels off, and the two did
     * it again every pass until the tidy gave up at its limit. And never the puller: a tie between
     * two squads of one club mirrors itself, and moved onto its puller the 9U Texas Takeover played
     * itself.
     */
    const placed = (clubId: string) =>
      clubId !== namedId &&
      clubId !== pullerId &&
      Boolean(teamById.get(clubId)?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool)) &&
      levelFits(levels.get(clubId), level);
    const holders = new Set(
      (namesakes.get(teamNameKey(named.name)) ?? []).filter(
        (clubId) => placed(clubId) && holds(clubId, pullerId, game, heldByClaim)
      )
    );
    /*
     * And a club whose own schedule has the game at its very start, the result mirrored (`atTheStart`),
     * named as the row names it or with a name that fits it in one region. The Padres and Marlins of
     * one Texas rec league, pulled several of each, were filed crossed: each club's own row of one
     * 5-9 went to the other club's namesake, and neither namesake's schedule listed the game.
     */
    (heldByClaim ? atTheStart(game, pullerId, true) : atStart).forEach((clubId) => {
      const club = teamById.get(clubId);
      if (!club || !placed(clubId)) return;
      const sameName = teamNameKey(club.name) === teamNameKey(named.name);
      if (sameName || (fits(club.name, named.name) && inOneRegion(club.state, named.state))) {
        holders.add(clubId);
      }
    });
    if (holders.size !== 1) return game;
    reclaimed += 1;
    const [holder] = [...holders] as [string];
    return game.teamAId === namedId ? { ...game, teamAId: holder } : { ...game, teamBId: holder };
  });
  return reclaimed === 0 ? { state, reclaimed: 0 } : { state: { ...state, games }, reclaimed };
};

/**
 * How rare a word of a name has to be among the pulled clubs' names for the name to be one club's
 * wherever it is written: in no more of them than one in every 18,000. On the pool of 29 September
 * 2026 that was two of its 38,296 pulled names. The "bouley" of "513 Force - Bouley" was in one,
 * "eagles" in 212, and the names the rule must never read as one club's — "Samurai", "Arrows",
 * "Walkoff", "Firebirds" — in 8 to 15. A share rather than a count, because a word is rare only
 * against enough names to say so: in a fifth of that pool "Walkoff" was in two names and "Samurai"
 * in three, and a pool of fewer than 18,000 pulled names holds no word rare enough.
 */
const RARE_WORD_AMONG = 18_000;

/**
 * How many days before a club's first game of its own in a squad year a name can still mean it. A
 * row from before that is last season's squad of the name or somebody else's: an Illinois club's
 * 8 August loss to "Eagles" was not the Eagles of Independence, Kentucky, whose own schedule opened
 * on 3 September.
 */
const NAMED_BEFORE_OWN_DAYS = 7;

/** A row a name filed, as `soleNamesakes` asks of it. */
type NamedRow = {
  /** The squad year's pool key (`buildPoolKeyOf`). */
  pool: string;
  /** The name it was filed under, as `teamNameKey` reads it. */
  key: string;
  /** The level the name gave, or the page's. */
  level: number | undefined;
  /** The pulled club whose schedule wrote the name down. */
  namer: ScoutTeam | undefined;
  date: string | undefined;
};

/**
 * The pulled club a name can mean and no other, though its own schedules have no game that day:
 * the one pulled club carrying the name at that level in that squad year anywhere, in the namer's
 * state or one bordering it, under a name holding a word no other club's name has
 * (`RARE_WORD_AMONG`), on a day no earlier than a week before its own first game of the year,
 * where it has one.
 *
 * A name is where to look, not who played, and a club's own schedule says whether it played that
 * day (`refileStandIns`, `unlisted`). But a schedule is written ahead only as far as its coach has
 * got: "513 Force - Bouley" of Cincinnati had one game of its own on 29 September 2026, and a
 * Kentucky club's and an Ohio club's schedules each named it for a game in October. The rule left
 * both rows on stand-ins of the name, and the search showed the club three times. The user said on
 * 29 September that a name that specific can only be the one club — and that a vague "Eagles" can't
 * be combined, which the rare word is for. On the backup of that day the tidy filed 3,660 stand-in
 * rows onto 2,018 clubs, 1,047 of them scored, which emptied 1,985 stand-ins; four games two clubs
 * had each filed against a stand-in for the other were then one game, not two. A second tidy
 * moved nothing.
 *
 * A club whose own schedule is empty is held to no first day, since it has none to be held to and
 * never will: the name is all there is to go on. On the backup of 29 September 246 pulled clubs
 * had no game of their own anywhere in the pool, each one link already pulled, and other clubs'
 * schedules named them on 575 rows, 313 of them scored, from August to June. Holding them to a
 * first day would leave every one of those on a stand-in for good, the rule refusing outright the
 * one club a name that specific can mean.
 *
 * Both tidy steps that read a club's own days ask this of the same row, and must agree: the refile
 * files the row, and the step that takes a name's rows off a club with no game that day leaves it.
 * Read only once a row asks, since most tidies ask nothing.
 */
const soleNamesakes = (
  state: GcImportState,
  poolKeyOf: (ageGroupId: string) => string
): ((row: NamedRow) => ScoutTeam | undefined) => {
  let index:
    | {
        /** Pulled clubs by pool, name and level, as the refile files them. */
        clubs: Map<string, ScoutTeam[]>;
        /** How many pulled names hold each word. */
        holding: Map<string, number>;
        names: number;
        /** Each pulled club's first day with a row of its own, by club and pool. */
        firstDay: Map<string, string>;
      }
    | undefined;
  const indexNow = () => {
    if (index) return index;
    const clubs = new Map<string, ScoutTeam[]>();
    const keys = new Set<string>();
    const clubOfSchedule = new Map<string, string>();
    state.teams.forEach((team) => {
      if (!team.gcTeams?.length) return;
      const key = teamNameKey(team.name);
      keys.add(key);
      team.gcTeams.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
      new Set(
        team.gcTeams.map(
          (link) => `${poolKeyOf(link.ageGroupId)}\u0000${key}\u0000${link.ageLevel}`
        )
      ).forEach((slot) => push(clubs, slot, team));
    });
    const holding = new Map<string, number>();
    keys.forEach((key) =>
      new Set(key.split(" ")).forEach((word) => {
        if (word) holding.set(word, (holding.get(word) ?? 0) + 1);
      })
    );
    const firstDay = new Map<string, string>();
    state.games.forEach((game) => {
      const pool = poolKeyOf(game.ageGroupId);
      ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([club, day]) => {
        const at = `${club}\u0000${pool}`;
        const first = firstDay.get(at);
        if (first === undefined || day < first) firstDay.set(at, day);
      });
    });
    index = { clubs, holding, names: keys.size, firstDay };
    return index;
  };
  return ({ pool, key, level, namer, date }) => {
    if (date === undefined || !namer?.state) return undefined;
    const { clubs, holding, names, firstDay } = indexNow();
    const found = (clubs.get(`${pool}\u0000${key}\u0000${level}`) ?? []).filter(
      (club) => club.id !== namer.id
    );
    if (found.length !== 1) return undefined;
    const club = found[0]!;
    if (!club.state || isPlaceholderName(club.name) || namesNobody(club.name)) return undefined;
    if (club.state !== namer.state && !borderingStates(namer.state).has(club.state)) {
      return undefined;
    }
    const words = key.split(" ").filter(Boolean);
    const rarest = Math.min(...words.map((word) => holding.get(word) ?? 0));
    if (words.length === 0 || rarest * RARE_WORD_AMONG > names) return undefined;
    // No first day is no limit: a schedule that is empty says nothing of when the season began.
    const first = firstDay.get(`${club.id}\u0000${pool}`);
    const from = first === undefined ? undefined : isoDayFrom(first, -NAMED_BEFORE_OWN_DAYS);
    if (from !== undefined && date < from) return undefined;
    return club;
  };
};

/**
 * Takes a game off a club that does not play anywhere near the age it was played at.
 *
 * The arrival-time rule that let this happen is fixed — `resolveOwnTeam` no longer hands a club
 * the sole stand-in of its name at whatever level somebody else filed it under — but a pool
 * already holding the result keeps it, and no other step can shift it: every one of them asks the
 * real club's own schedule to hold the row, and the row is there precisely because it does not.
 * One club's 9U squad was carrying a 15U loss to a club its players have never faced.
 *
 * The level is what settles it, and only when it disagrees by a lot: `PLAYS_UP_TO` is two, which
 * over this app's own nationwide pool covers 99.7% of the sides resting on a club pulled by id.
 * Beyond that the row is somebody else's. Where exactly one namesake in the same squad year does
 * play near that level, the row goes there. Where none does, or several do, it goes to a stand-in
 * instead — which is what the importer makes of a club it cannot identify, and is honest in a way
 * that leaving it is not: the game happened, the club it names is not this one, and a stand-in is
 * kept out of the rankings rather than ranked on somebody else's result.
 *
 * Only a row filed by name. A row a club put on its own GameChanger schedule says what level that
 * club played at, whatever its listing claims, and is never moved.
 *
 * Two levels off is inside `PLAYS_UP_TO`, and still somebody else's where the age was typed into
 * the name and nothing of the club's own says it plays there: every listing it has two off, none of
 * its own rows within a level of it, and no row of its own that day. On the pool of 24 September
 * 2026, of the scored games filed on a pulled club two levels from its own, GameChanger's own record
 * left out 82% of those it decided, against 14% at the club's own level. Those rows go to a
 * stand-in and to no namesake, which only the game itself can pick: on the pool of 26 September
 * the move took 522 rows off, 164 clubs' records moved toward GameChanger's own, 106 of them onto
 * it, and 14 away, 5 of those off it — a squad that did play up, and a namesake the game was then
 * matched to.
 *
 * And a row filed by name onto a pulled club in a region its filer does not play in — two states on
 * the border map that neither match nor meet (`farApart`) — where nothing of the two clubs' own
 * backs it: no game both their schedules have a row in, and no pulled club each has met in a game
 * both sides' schedules have. Two Texas clubs' games against "Braves" sat on a Florida Braves as
 * two wins its own schedules do not have, 2-4 on its page against 0-4 on its own rows. They go to
 * a stand-in, which the refile then files onto the one club of the name in the filer's state, or
 * next door. On the pool of 26 September 2026 at 18:40 the tidy took 121 rows off and 31 clubs'
 * records changed: 30 toward GameChanger's own, 13 of them onto it, and one away — a loss its
 * club's schedule has not scored yet, whose row the move let join the club's own copy of the game.
 * Met on either club's own schedules alone, where one misfile can vouch for another, five of those
 * records stayed further from their own schedules'.
 *
 * And any row filed by name onto a pulled club whose own schedules have no game that day or the day
 * either side (`unlisted`): the double check the user asked for on 28 September 2026, a name being
 * where to look rather than who played. An Illinois club's 8 August loss to "Eagles" sat on the
 * Eagles of Independence, Kentucky, whose own schedule opened on 3 September. On the pool of 26
 * September 2026 at 18:40 the tidy took 23,282 rows off, and 4,700 single-link records changed: 4,395
 * toward GameChanger's own record, 3,094 onto it, and 278 away, 106 off it — 191 of those a club
 * whose GameChanger record counts more games than its own rows in the pool, a game the pull did not
 * bring back that the name had stood in for. Except a name no other club carries, which can only be
 * its one club (`soleNamesakes`), and which the refile files onto it.
 */
export const resettleOffLevel = (
  state: GcImportState,
  /**
   * The names the owner has said are not a club (`notThisTeam.ts`): a row of such a name, off the
   * schedule that wrote it, comes off the club as a row the rules refuse it does, and goes onto no
   * namesake it is refused either.
   */
  refused: NotThisTeam = NO_REFUSALS
): { state: GcImportState; resettled: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));

  /** For each pulled club: the GameChanger ids it filed under, and the levels it plays. */
  const ownIds = new Map<string, Set<string>>();
  const levels = new Map<string, Set<number>>();
  const namesakes = new Map<string, string[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    ownIds.set(team.id, new Set(team.gcTeams.map((link) => link.teamId)));
    const seen = new Set<number>();
    team.gcTeams.forEach((link) => {
      const at = link.ageLevel ?? levelOf.get(link.ageGroupId);
      if (at !== undefined) seen.add(at);
    });
    levels.set(team.id, seen);
    push(namesakes, teamNameKey(team.name), team.id);
  });
  if (namesakes.size === 0) return { state, resettled: 0 };

  const isOwnRow = (game: ScoutGame, teamId: string): boolean =>
    game.source !== undefined && (ownIds.get(teamId)?.has(game.source.teamId) ?? false);
  const within = (seen: ReadonlySet<number> | undefined, level: number, slack: number): boolean =>
    [...(seen ?? [])].some((at) => Math.abs(at - level) <= slack);
  const sole = soleNamesakes(state, poolKeyOf);

  /**
   * What each pulled club's own schedules say of it: the levels its own rows were played at and the
   * days they fall on, standing, folded into another club's copy, claimed, or on record. Read only
   * once a row two levels off needs it.
   */
  let ownWord:
    | {
        levels: Map<string, Set<number>>;
        days: Map<string, Set<string>>;
        /**
         * The pulled clubs it has met in a game both clubs' own schedules have a row in. A row only
         * one side's schedules hold may be the very misfile being asked about: a Tennessee "White
         * Sox" that named "Cardinals" onto Illinois's, and Illinois's Cardinals that named "White
         * Sox" onto Tennessee's, each read as the other's opponent.
         */
        opponents: Map<string, Set<string>>;
      }
    | undefined;
  const ownWordNow = () => {
    if (ownWord) return ownWord;
    const clubOfSchedule = new Map<string, string>();
    ownIds.forEach((ids, clubId) => ids.forEach((id) => clubOfSchedule.set(id, clubId)));
    const ownLevels = new Map<string, Set<number>>();
    const days = new Map<string, Set<string>>();
    const opponents = new Map<string, Set<string>>();
    const add = <T>(into: Map<string, Set<T>>, key: string, value: T) => {
      const bucket = into.get(key);
      if (bucket) bucket.add(value);
      else into.set(key, new Set([value]));
    };
    state.games.forEach((game) => {
      const clubs = new Set<string>();
      const of = (schedule: string) => {
        const club = clubOfSchedule.get(schedule);
        if (club !== undefined) clubs.add(club);
      };
      if (game.source) of(game.source.teamId);
      game.alsoRows?.forEach((record) => of(record.teamId));
      game.alsoFrom?.forEach(of);
      // Each row on its own day: a row folded into a copy dated a day off keeps its own.
      ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([clubId, day]) =>
        add(days, clubId, day)
      );
      clubs.forEach((clubId) => {
        const side = clubId === game.teamAId ? "A" : clubId === game.teamBId ? "B" : undefined;
        if (side === undefined) return;
        const at = (side === "A" ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
        if (at !== undefined) add(ownLevels, clubId, at);
      });
      if (clubs.has(game.teamAId) && clubs.has(game.teamBId)) {
        add(opponents, game.teamAId, game.teamBId);
        add(opponents, game.teamBId, game.teamAId);
      }
    });
    ownWord = { levels: ownLevels, days, opponents };
    return ownWord;
  };
  /**
   * A club two levels from an age typed into the name it was filed under, where nothing of its own
   * says it plays there: its listings all two off, none of its own rows within one of it, and no
   * row of its own that day.
   */
  const twoOff = (clubId: string, typed: number | undefined, date: string | undefined): boolean => {
    const listed = levels.get(clubId);
    if (typed === undefined || !listed?.size || within(listed, typed, 1)) return false;
    const own = ownWordNow();
    if (within(own.levels.get(clubId), typed, 1)) return false;
    return date === undefined || !own.days.get(clubId)?.has(date);
  };

  /**
   * A pulled club whose own schedules have no game that day: it did not play that day, so it did
   * not play this game, whatever the name says. The check a name needs before it files a row onto
   * a club (`refileStandIns`, `planOpponent`), asked here of the rows a name filed before it was
   * asked. A row with no day has nothing to be checked against, and stays.
   */
  const unlisted = (clubId: string, date: string | undefined): boolean => {
    if (date === undefined) return false;
    const days = ownWordNow().days.get(clubId);
    return !aroundDay(date).some((day) => days?.has(day));
  };

  /**
   * A row filed by name onto a pulled club in a region the club that filed it does not play in
   * (`farApart`), which nothing of the two clubs' own backs: no game both their schedules have a
   * row in, this or another, and no pulled club each has met in a game both sides' schedules have.
   * A slot's name is left alone, as the import files one onto the one pulled club that carries it.
   */
  const unvouched = (namedId: string, moverId: string): boolean => {
    const named = teamById.get(namedId);
    if (!named || !farApart(teamById.get(moverId)?.state, named.state)) return false;
    if (isPlaceholderName(named.name)) return false;
    const { opponents } = ownWordNow();
    const theirs = opponents.get(namedId);
    if (!theirs) return true;
    if (theirs.has(moverId)) return false;
    const ours = opponents.get(moverId);
    return ![...theirs].some((clubId) => clubId !== namedId && ours?.has(clubId));
  };

  const used = new Set(state.teams.map((team) => team.id));
  const added: ScoutTeam[] = [];
  /**
   * The stand-ins already here by squad year, level and name, and the states of the pulled clubs
   * that named each: read only once a move needs one, since most passes move nothing.
   */
  let standing: { bySlot: Map<string, string[]>; namedFrom: Map<string, Set<string>> } | undefined;
  const standingNow = () => {
    if (standing) return standing;
    const bySlot = new Map<string, string[]>();
    const namedFrom = new Map<string, Set<string>>();
    const note = (game: ScoutGame, side: string, other: string, typed: number | undefined) => {
      const team = teamById.get(side);
      if (!team?.nameOnly || team.placeholder || team.gcTeams?.length) return;
      const at = typed ?? levelOf.get(game.ageGroupId);
      const slot = `${poolKeyOf(game.ageGroupId)}\u0000${at ?? "?"}\u0000${teamNameKey(team.name)}`;
      const bucket = bySlot.get(slot);
      if (!bucket) bySlot.set(slot, [side]);
      else if (!bucket.includes(side)) bucket.push(side);
      const states = namedFrom.get(side) ?? new Set<string>();
      const namer = teamById.get(other);
      if (namer?.gcTeams?.length && namer.state) states.add(namer.state);
      namedFrom.set(side, states);
    };
    state.games.forEach((game) => {
      note(game, game.teamAId, game.teamBId, game.ageLevelA);
      note(game, game.teamBId, game.teamAId, game.ageLevelB);
    });
    standing = { bySlot, namedFrom };
    return standing;
  };
  /**
   * One stand-in per name, level, squad year and state of the club that named it, rather than one
   * per row. A club named on three schedules is one club, and three stand-ins for it would be three
   * unknowns in the fit where there is one; a single stand-in across every level and year would be
   * the opposite mistake, the knot that ties unrelated clubs together, which is why the level and
   * the year are in the key — and the state, as the import keeps one stand-in per state
   * (`planOpponent`): one "Pirates" named from Arizona and New Jersey is nobody's opponent.
   *
   * And one already here, of that name, level and year, named by a club of the mover's state
   * (`stateFits`), before one is made, which is what the import reuses for a name it cannot place.
   * Made afresh, the move stood a second "Pirates" beside the one the import had filed the same
   * state's games against. With the rows it had moved on the backup of 24 September 2026 put back
   * where the import filed them, the step made 64 stand-ins and put one row on a stand-in already
   * here; reusing, it makes 44 and puts 34 rows on the import's, and the tidied pool holds 179
   * stand-ins a pull would have reused another for, not 206.
   */
  const stand = new Map<string, string>();
  const standInFor = (name: string, slot: string, moverState: string | undefined): string => {
    const key = `${slot}\u0000${moverState ?? ""}`;
    const already = stand.get(key);
    if (already !== undefined) return already;
    const { bySlot, namedFrom } = standingNow();
    const found = (bySlot.get(slot) ?? []).find((id) =>
      stateFits(moverState, namedFrom.get(id) ?? new Set())
    );
    if (found !== undefined) {
      stand.set(key, found);
      return found;
    }
    const team = buildScoutTeam(name, used, { nameOnly: true });
    used.add(team.id);
    added.push(team);
    stand.set(key, team.id);
    return team.id;
  };

  let resettled = 0;
  const games = state.games.map((game) => {
    if (!game.source) return game;
    // The side that did not file the row is the side that was attached by name.
    const namedId = isOwnRow(game, game.teamAId)
      ? game.teamBId
      : isOwnRow(game, game.teamBId)
        ? game.teamAId
        : undefined;
    if (namedId === undefined) return game;
    const named = teamById.get(namedId);
    if (!named?.gcTeams?.length) return game;
    // A club the row named by its picture is that club whatever its listings or its state say:
    // nothing here reads more than a name (`ScoutGame.namedByAvatar`).
    if (game.namedByAvatar === namedId) return game;
    // A game the named club's own schedule gave a row too, folded in or settled into it, is on that
    // club's schedule by its own word, as `reclaimMisfiled` reads it. Moved off, the club's own row
    // went with it into a game the club was not in, and the club's next pull filed that row again.
    if (filedInto(game, ownIds.get(namedId))) return game;
    const typed = namedId === game.teamAId ? game.ageLevelA : game.ageLevelB;
    const level = typed ?? levelOf.get(game.ageGroupId);
    const moverId = namedId === game.teamAId ? game.teamBId : game.teamAId;
    /*
     * A pulled club called "Tbd" or "14U" holds a date on its coach's schedule, and a row filed on
     * it by name is some other club's undecided game (`namesNobody`). It goes to a slot of its own,
     * as the import now files one, and out of every rating. One called "Practice" or "Scrimmage" is
     * deleted before this (`dropNotATeam`), unless the owner keeps it, and is then read here too.
     */
    if (namesNobody(named.name)) {
      const slot = buildScoutTeam(named.name, used, { placeholder: true });
      used.add(slot.id);
      added.push(slot);
      resettled += 1;
      return namedId === game.teamAId
        ? { ...game, teamAId: slot.id }
        : { ...game, teamBId: slot.id };
    }
    const farOff = !levelFits(levels.get(namedId), level);
    /*
     * The owner's "Not this team" for the name on this schedule. The pool keeps no row's name, and
     * a name files a row onto a club only where the two read the same, so the club's name is the
     * name: the namer's other rows of it come off with the one the owner took off, which is what
     * the refusal says of them, and a row restored from a copy that never heard it comes off too.
     * Never a game the club's own schedule gave a row, claimed into it or on record: the club says
     * it played that one, and the refusal is about a name (`listedByOwn`).
     */
    const refusedHere =
      refusesName(refused, game.source.teamId, named.name, named) && !listedByOwn(game, named);
    const offByRule =
      refusedHere || farOff || twoOff(namedId, typed, game.date) || unvouched(namedId, moverId);
    // A name no other club carries is the club's though it has no game that day, which is where
    // the refile files it (`soleNamesakes`).
    const meant = () =>
      sole({
        pool: poolKeyOf(game.ageGroupId),
        key: teamNameKey(named.name),
        level,
        namer: teamById.get(moverId),
        date: game.date,
      })?.id === namedId;
    if (!offByRule && (!unlisted(namedId, game.date) || meant())) return game;

    /*
     * A club whose name reads as a slot's ("USSSA Cactus Classic") is the one a row names only by
     * being the one pulled club that carries it, which the import no longer reads as that club
     * where it did not play that day (`planOpponent`). The row goes to a slot, as the import files
     * it, and out of every rating.
     */
    if (!offByRule && isPlaceholderName(named.name)) {
      const slot = buildScoutTeam(named.name, used, { placeholder: true });
      used.add(slot.id);
      added.push(slot);
      resettled += 1;
      return namedId === game.teamAId
        ? { ...game, teamAId: slot.id }
        : { ...game, teamBId: slot.id };
    }

    const pool = poolKeyOf(game.ageGroupId);
    const key = teamNameKey(named.name);
    const mover = teamById.get(moverId);
    /*
     * Two off, the row goes to a stand-in and to no namesake on the name alone: the club it was
     * filed on did not play it, and nothing yet says which did. Handed to the namesake at or next to
     * the typed age, the games mostly were not that club's either — on the pool of 26 September
     * 2026, 47 of the 49 clubs that took one moved away from GameChanger's own record, and 30 that
     * matched it stopped matching. A namesake whose own schedule holds the game is the claim step's
     * and the reclaim's to find, on the game.
     */
    const homes = (farOff ? (namesakes.get(key) ?? []) : []).filter((clubId) => {
      if (clubId === namedId || clubId === game.teamAId || clubId === game.teamBId) return false;
      const club = teamById.get(clubId);
      if (refusesName(refused, game.source?.teamId, named.name, club)) return false;
      const inPool = club?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool);
      return Boolean(inPool) && levelFits(levels.get(clubId), level);
    });
    const to =
      homes.length === 1
        ? homes[0]!
        : standInFor(named.name, `${pool}\u0000${level ?? "?"}\u0000${key}`, mover?.state);
    resettled += 1;
    return namedId === game.teamAId ? { ...game, teamAId: to } : { ...game, teamBId: to };
  });
  if (resettled === 0) return { state, resettled: 0 };

  // A stand-in the move emptied is not a club, and neither is one it never filled.
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = [...state.teams, ...added].filter(
    (team) => !team.nameOnly || stillUsed.has(team.id)
  );
  return { state: { ...state, teams, games }, resettled };
};

/**
 * Files a stand-in's rows onto the one pulled club of that name in the puller's state, or failing
 * any there, across a border — where that club's own schedules have a game that day, or the name is
 * one no other club carries (`soleNamesakes`).
 *
 * A stand-in is a name a schedule wrote down before — or instead of — the club being pulled. Once
 * the whole pool is in, most of them have a pulled namesake, and where exactly one of those is in
 * the state of the club that named it, that is the club: right in about nine cases in ten on
 * known pairs, and the tenth is a traveller the game itself will usually settle first. Two in the
 * state stays a stand-in — a guess between namesakes is what made six River City Raptors — unless
 * exactly one is in the puller's own town. None in the state looks next door, because youth clubs
 * play their neighbours: on the stand-in fixtures export of 22 September 2026, a sole namesake in
 * a bordering state (`borderingStates`) was the club the game itself identified 1,174 times in
 * 1,240, and where the file said anything about the other picks it backed about nine in ten.
 * Two across the borders, or one further away, stays a stand-in. Nothing at arrival time could do
 * this, because the namesake was pulled after the mention 70 times in 100.
 */
export const refileStandIns = (
  state: GcImportState,
  /** The names the owner has said are not a club (`notThisTeam.ts`), never refiled onto it. */
  refused: NotThisTeam = NO_REFUSALS
): { state: GcImportState; refiled: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  /** Pulled clubs by pool, name and level. */
  const clubs = new Map<string, ScoutTeam[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    const key = teamNameKey(team.name);
    new Set(
      team.gcTeams.map((link) => `${poolKeyOf(link.ageGroupId)}\u0000${key}\u0000${link.ageLevel}`)
    ).forEach((slot) => {
      const bucket = clubs.get(slot);
      if (bucket) bucket.push(team);
      else clubs.set(slot, [team]);
    });
  });
  if (clubs.size === 0) return { state, refiled: 0 };

  /** Each pulled club's days with a row of its own schedules, read only once a refile asks. */
  let ownDays: Set<string> | undefined;
  const listsThatDay = (clubId: string, date: string | undefined): boolean => {
    if (!ownDays) {
      const clubOfSchedule = new Map<string, string>();
      state.teams.forEach((team) =>
        team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
      );
      const days = new Set<string>();
      state.games.forEach((game) =>
        ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([club, day]) =>
          days.add(`${club}\u0000${day}`)
        )
      );
      ownDays = days;
    }
    return (
      date !== undefined && aroundDay(date).some((day) => ownDays!.has(`${clubId}\u0000${day}`))
    );
  };

  const sole = soleNamesakes(state, poolKeyOf);
  let refiled = 0;
  const games = state.games.map((game) => {
    const a = teamById.get(game.teamAId);
    const b = teamById.get(game.teamBId);
    const standIn = a?.nameOnly ? a : b?.nameOnly ? b : undefined;
    const puller = standIn === a ? b : a;
    if (!standIn || !puller?.gcTeams?.length || !puller.state) return game;
    const level = (standIn === a ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    const pool = poolKeyOf(game.ageGroupId);
    const key = teamNameKey(standIn.name);
    const slot = `${pool}\u0000${key}\u0000${level}`;
    // Never the club on the row's other side: a squad naming its own club's other squad ("Texas
    // Takeover" on Texas Takeover 10U's own schedule) would be filed as playing itself.
    // Nor a club the owner has said the name, written on this schedule, is not.
    const namesakes = (clubs.get(slot) ?? []).filter(
      (club) =>
        club.id !== puller.id && !refusesName(refused, game.source?.teamId, standIn.name, club)
    );
    const inState = namesakes.filter((club) => club.state === puller.state);
    // Two in the state: the one in the puller's own town, if exactly one is.
    const pullerTown = townKey(puller.city);
    // None in the state: the one across a border, if exactly one is.
    const near = borderingStates(puller.state);
    const chosen =
      inState.length === 1
        ? inState
        : inState.length > 1
          ? pullerTown
            ? inState.filter((club) => townKey(club.city) === pullerTown)
            : []
          : namesakes.filter((club) => club.state !== undefined && near.has(club.state));
    if (chosen.length !== 1) return game;
    const club = chosen[0]!;
    /*
     * ...and only a club whose own schedules have a game that day. A name is where to look, not
     * who played: the club it points at either played that day or did not play this game, and its
     * own schedule says which (`resettleOffLevel` takes off a row filed on one that did not). This
     * was asked only where the name was a club's at another level within reach too; everywhere else
     * the name alone decided, and on the pool of 26 September 2026 an Illinois club's 8 August loss
     * to "Eagles" sat on the Eagles of Independence, Kentucky, the one Eagles at 9U across the
     * border, whose own schedule opened on 3 September. Refiled onto a club that has no game that
     * day, the row would only be taken off again on the next pass.
     *
     * Unless the name can mean no other club (`soleNamesakes`): "513 Force - Bouley" is its club's
     * on a day its coach has not yet put on its schedule.
     */
    if (
      !listsThatDay(club.id, game.date) &&
      sole({ pool, key, level, namer: puller, date: game.date })?.id !== club.id
    ) {
      return game;
    }
    refiled += 1;
    return standIn === a ? { ...game, teamAId: club.id } : { ...game, teamBId: club.id };
  });
  if (refiled === 0) return { state, refiled: 0 };

  // A stand-in with nothing left on it is not a club and should not linger in the roster.
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter((team) => !team.nameOnly || stillUsed.has(team.id));
  return { state: { ...state, teams, games }, refiled };
};

/**
 * Makes one of the stand-ins that are one opponent filed twice.
 *
 * A name nobody pulled becomes a stand-in, one per name, level and squad year among the clubs of a
 * state that named it (`planOpponent`). A lookup that missed made a second — a class year looked up
 * at the page's age rather than the class's, a pull run before a rule — and the clubs that named
 * the team found one entry or the other, so one team's games were split over entries of a game or
 * two each and the clubs that played it were rated against strangers. On the pool of 26 September
 * 2026, 173 stand-ins shared a name, a level, a squad year and a naming club's state with one
 * earlier in the roster; ten were "Mojo Gold 2036", named by Oklahoma's 10U clubs.
 *
 * Two kinds are merged without asking: a name that carries a graduating class, and a name no more
 * than one pulled club in the pool carries. A common name is as often two teams — two Arizona
 * clubs' "Pirates" — and is left for the user. Nor are two merged whose games clash, one within
 * the hour of the other against another opponent the same day, which one team cannot do: two
 * "Padres" named by Texas clubs both played at eight on 19 September. The later entry goes into
 * the earlier, its games and the claims filed against it with it. On that pool this merged 127 of
 * the 173 — 50 by class, 77 by a rare name — and moved 226 clubs' ratings by more than a tenth of a
 * run and no record: No Pressure Sports, whose one game against Mojo Gold 2036 had stood against an
 * entry of its own, went from -1.10 to -0.03.
 */
export const mergeDuplicateStandIns = (
  state: GcImportState
): { state: GcImportState; merged: number } => {
  const groupById = new Map(state.ageGroups.map((group) => [group.id, group]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const isStandInTeam = (team: ScoutTeam | undefined): team is ScoutTeam =>
    Boolean(team?.nameOnly) && !team?.placeholder && !team?.gcTeams?.length;
  /** What a stand-in's games say of it: where it was filed, who named it, and when it played. */
  type Seen = {
    slots: Set<string>;
    year: number | undefined;
    namedFrom: Set<string>;
    games: { date: string | undefined; startTs: string | undefined; other: string }[];
  };
  const seen = new Map<string, Seen>();
  const note = (game: ScoutGame, side: string, other: string, typed: number | undefined) => {
    const team = teamById.get(side);
    if (!isStandInTeam(team)) return;
    const group = groupById.get(game.ageGroupId);
    const year = group ? ageGroupYear(group) : undefined;
    const level = typed ?? (group ? ageGroupLevel(group) : undefined);
    let entry = seen.get(side);
    if (!entry) {
      entry = { slots: new Set(), year, namedFrom: new Set(), games: [] };
      seen.set(side, entry);
    }
    entry.slots.add(
      `${year ?? `g:${game.ageGroupId}`}\u0000${level ?? "?"}\u0000${teamNameKey(team.name)}`
    );
    const namer = teamById.get(other);
    if (namer?.gcTeams?.length && namer.state) entry.namedFrom.add(namer.state);
    entry.games.push({ date: game.date, startTs: game.startTs, other });
  };
  state.games.forEach((game) => {
    note(game, game.teamAId, game.teamBId, game.ageLevelA);
    note(game, game.teamBId, game.teamAId, game.ageLevelB);
  });

  // In roster order, so the entry kept is the one the pool has held longest.
  const bySlot = new Map<string, string[]>();
  state.teams.forEach((team) => {
    const entry = seen.get(team.id);
    if (entry?.slots.size === 1) push(bySlot, [...entry.slots][0]!, team.id);
  });
  if (![...bySlot.values()].some((ids) => ids.length > 1)) return { state, merged: 0 };

  const pulledOfName = new Map<string, number>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    const key = teamNameKey(team.name);
    pulledOfName.set(key, (pulledOfName.get(key) ?? 0) + 1);
  });
  const clash = (a: Seen["games"], b: Seen["games"]) =>
    a.some((x) =>
      b.some(
        (y) =>
          x.date !== undefined &&
          x.date === y.date &&
          x.other !== y.other &&
          startsWithinTheHour(x.startTs, y.startTs)
      )
    );
  const into = new Map<string, string>();
  bySlot.forEach((ids) => {
    if (ids.length < 2) return;
    /*
     * Each entry is held up against every earlier one it was not merged into, not only the slot's
     * first. Held up against the first alone, two entries named from one state stayed two whenever
     * the roster listed an entry named from another state ahead of them: five on the pool of 26
     * September 2026, "Canes National 2031" named from Florida ahead of two named from Virginia
     * among them, which another order of the same roster made one. A merged entry's naming states
     * join its keeper's, as its games do, which is what the next tidy would read off them.
     */
    const keepers: { id: string; namedFrom: Set<string>; games: Seen["games"] }[] = [];
    ids.forEach((id) => {
      const entry = seen.get(id)!;
      const name = teamById.get(id)!.name;
      const byClass =
        entry.year !== undefined && ageFromGradYearInName(name, entry.year) !== undefined;
      const rare = (pulledOfName.get(teamNameKey(name)) ?? 0) <= 1;
      const keeper =
        byClass || rare
          ? keepers.find(
              (kept) =>
                [...entry.namedFrom].some((named) => kept.namedFrom.has(named)) &&
                !clash(kept.games, entry.games)
            )
          : undefined;
      if (!keeper) {
        keepers.push({ id, namedFrom: new Set(entry.namedFrom), games: [...entry.games] });
        return;
      }
      into.set(id, keeper.id);
      keeper.games.push(...entry.games);
      entry.namedFrom.forEach((named) => keeper.namedFrom.add(named));
    });
  });
  if (into.size === 0) return { state, merged: 0 };

  const to = (teamId: string) => into.get(teamId) ?? teamId;
  const games = state.games.map((game) => {
    const a = to(game.teamAId);
    const b = to(game.teamBId);
    const moved =
      a === game.teamAId && b === game.teamBId ? game : { ...game, teamAId: a, teamBId: b };
    return withFiledRepointed(moved, to);
  });
  const teams = state.teams.filter((team) => !into.has(team.id));
  return { state: { ...state, teams, games }, merged: into.size };
};

/**
 * Drops the games dated outside their page's squad year — last year's squad's results, which
 * GameChanger lists under this year's id often enough that a nationwide pull carried three
 * thousand of them. The import refuses them on arrival now; this is the same rule applied to a
 * pool filed before it did, so "Check for doubles" cleans an existing pool the same way.
 */
export const pruneOutOfSeason = (
  state: GcImportState
): { state: GcImportState; pruned: number } => {
  const yearOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const games = state.games.filter((game) => inSquadYear(game.date, yearOf.get(game.ageGroupId)));
  if (games.length === state.games.length) return { state, pruned: 0 };
  return { state: { ...state, games }, pruned: state.games.length - games.length };
};

/** What one tidy of the pool did, in the order it did it. */
export type PoolTidy = {
  state: GcImportState;
  /** Bracket slots and name-only stand-ins settled from the other team's schedule. */
  named: number;
  /** Games each club filed against a stand-in for the other, joined into one game between them. */
  joined: number;
  /**
   * Games one club filed against a stand-in of the other's very name, and the other against a
   * stand-in or a slot, joined into one game between them, or put back where the two rows no longer
   * read as one (`joinNamesakeHalves`).
   */
  namesakeJoined: number;
  /** Teams folded into a club already here under another GameChanger id. */
  folded: number;
  /** Squads paired on into their next season on the same name, town and state. */
  paired: number;
  /** Rows that were the same game written twice, now one. */
  collapsed: number;
  /**
   * Games whose folded rows were grouped again without a row going: a copy moved to the game it now
   * fits, a borrowed score taken back, or a folded row stood up as a game of its own.
   */
  regrouped: number;
  /** Rows dated outside their squad year, dropped. */
  pruned: number;
  /**
   * Games whose own row their schedule no longer lists, taken away, with the rows folded into each
   * stood up to be placed again (`ScoutGame.withdrawn`).
   */
  withdrawn: number;
  /** Rows moved to the namesake whose own schedule holds the game. */
  reclaimed: number;
  /**
   * Rows taken off a club that plays nowhere near the age they were played at, or in a region
   * nowhere near the club that filed them.
   */
  resettled: number;
  /** Stand-in rows filed onto the one club of that name in the puller's state, or next door. */
  refiled: number;
  /** Stand-ins that were one opponent filed twice, made one (`mergeDuplicateStandIns`). */
  merged: number;
  /**
   * Rows a club's own schedule filed by name that another club's own copy of the game claimed, or
   * that went back to the team they named when the schedules stopped bearing a claim out.
   */
  claimed: number;
  /** Levels read out of a name that had one all along, under rules that came later. */
  releveled: number;
  /** Pulled clubs GameChanger gave no state, given the one their club's other teams are in. */
  stateFilled: number;
  /**
   * Third copies of a game that already counts, set not to count, or counted again once the
   * schedules stop bearing them out (`markCountedElsewhere`).
   */
  countedElsewhere: number;
  /**
   * Teams deleted for playing a different game — wiffle ball, blitzball or softball — along with
   * their results.
   */
  notBaseball: number;
  /** Teams deleted for playing a high school season, along with their results. */
  highSchool: number;
  /**
   * Pulled clubs deleted because every GameChanger name they carry says the page is no team — a
   * practice, a test, an old page marked do not use — and stand-ins whose one name says so, with
   * their results, bar an old page's games another club's own schedule lists, which stay on that
   * club's record against a slot (`dropNotATeam`).
   */
  notATeam: number;
  /**
   * Stand-ins nothing stands on any more — in no game, with no claimed row to go back to them —
   * taken out of the roster once the passes are done (`idleStandIns`).
   */
  idle: number;
  /** How many passes it took to find nothing more. */
  passes: number;
};

/** The most times the tidy repeats itself. Four passes were enough on a twenty-thousand-team pool. */
const TIDY_MAX_PASSES = 6;

/**
 * The passes that only make sense once a whole run is in, in the order they depend on each other.
 *
 * Naming the stand-ins first, because a slot the other side's schedule can now name is the pair
 * the next passes match on. Then the clubs holding several GameChanger ids in one pool, folded
 * where they filed the same game. Then the squads whose next season is settled — same name, town
 * and state — paired on. Then the rows those folds made into one game — and any other pair of
 * rows that has come to mean one game — collapsed. Each pass changes what the next one sees, so
 * they run together, and they run over everything rather than the schedules just pulled: the half
 * that settles a stand-in, or proves two ids one squad, may have been here for weeks.
 */
/**
 * Deletes the teams that are not playing baseball, and everything they played.
 *
 * A tidy pass rather than only an import rule, because "leave it out from now on" and "it is not
 * in the pool" are different things. A wiffle team pulled before the rule existed is filed under
 * an ordinary age group with an ordinary-looking record, and it would sit in the 12U table next to
 * clubs it has nothing to do with until somebody noticed it by eye.
 *
 * Its games go with it. A result against a wiffle team is not a baseball result on either side, so
 * deleting the team and leaving the games would hand every club that played one a free win or loss
 * against nobody.
 */
const dropNotBaseball = (state: GcImportState): { state: GcImportState; dropped: number } => {
  const going = new Set(
    state.teams.filter((team) => isNotBaseball(team.name)).map((team) => team.id)
  );
  return without(state, going);
};

/**
 * Teams and the games either side of them, gone — and a row claimed for another club's copy that
 * its own schedule filed against one of them (`FoldedRow.filedAgainst`): by that schedule it was a
 * game against a team that is going, as the import now refuses to file one, and left on record it
 * would go back to a team that is not there.
 */
const without = (
  state: GcImportState,
  going: ReadonlySet<string>
): { state: GcImportState; dropped: number } => {
  if (going.size === 0) return { state, dropped: 0 };
  return {
    state: {
      ...state,
      teams: state.teams.filter((team) => !going.has(team.id)),
      games: state.games.flatMap((game) => {
        if (going.has(game.teamAId) || going.has(game.teamBId)) return [];
        const filedAgainstGoing = (game.alsoRows ?? []).filter(
          (record) => record.filedAgainst !== undefined && going.has(record.filedAgainst)
        );
        return [filedAgainstGoing.reduce(releaseClaim, game)];
      }),
    },
    dropped: going.size,
  };
};

/**
 * Deletes the high school squads, and everything they played.
 *
 * The same shape as the pass above and for the same reason — "left out from now on" and "not in
 * the pool" are different things, and a varsity side pulled before the rule existed is filed
 * under 18U looking like any other club. But the reason the games go is not the reason wiffle
 * games go, and it is worth being straight about: a travel side really did play the local varsity
 * and that really was a baseball game. It goes because the other half of it is a club this app
 * refuses, and a game with one side missing is not a result, it is a dangling row. Losing the
 * handful of real results that cross the line is the price of not carrying the cluster they lead
 * into, which is a trade this pool makes knowingly.
 *
 * The name only, not the age field: a squad whose name said nothing and whose age field said
 * "Varsity" was never filed in the first place, because the import refuses it on the way in, so
 * there is nothing here for this pass to find.
 *
 * And the name the import read, not the one the pool stores, which has the age taken off
 * (`cleanTeamName`): "Brackenfield Owls 12U V" is held as "Brackenfield Owls V", and the age is
 * the one thing that says a travel club, so read off the stored name the pass deleted a club the
 * import files, and the next pull filed it again. A pulled club goes when every name GameChanger
 * gives it reads as a school's (the club's own name standing in for a link that carries none), as
 * the not-a-team pass reads one; a stand-in, which has only the stored name, unless a row named it
 * at an age under fourteen off an age label (`schoolNamedTravelStandIns`). That mattered from the
 * owner's ruling of 18 October 2026 that a lone V is varsity: on the backup of 11 October the
 * stored names of 11 pulled clubs read so, and the names GameChanger gives 7 of them do not, 6
 * stating an age under 14U and one carrying no lone V at all. A slot, or a club added by hand, is
 * read by its name.
 */
const dropSchoolTeams = (state: GcImportState): { state: GcImportState; dropped: number } => {
  const travel = schoolNamedTravelStandIns(state);
  const going = state.teams.filter((team) => {
    const links = team.gcTeams ?? [];
    if (links.length > 0) return links.every((link) => isSchoolName(link.name.trim() || team.name));
    return isSchoolName(team.name) && !travel.has(team.id);
  });
  return without(state, new Set(going.map((team) => team.id)));
};

/**
 * The stand-ins whose stored name reads as a school squad's (`isSchoolName`) that some row named at
 * an age under the youngest a freshman is (`MIN_HIGH_SCHOOL_AGE`) read off an age label: a travel
 * club's, as the import read that row, and kept by the tidy's school pass and on the clubs worth
 * pulling.
 *
 * A stand-in is stored under the name a schedule wrote with its age taken off (`cleanTeamName`),
 * and the age stays on the row, as the level the name gave its side (`ScoutGame.ageLevelB`, or A
 * on a row filed the other way round). The import drops a row whose opponent's name reads as a
 * school's, so a row naming a stand-in so without an age came before the rule that drops it.
 *
 * Off an age label, because that is the only age the school rule excuses. The import reads a side's
 * level from a label or, failing one, from a class year read against the page's squad year, and
 * `relevelFromNames` reads the stored name the same way; but `isSchoolName` reads no year, so the
 * import refuses "Quillmoor V 2033" on a 2027 page, the class of 2033 being 12U. The year stays on
 * the stored name, so a row at the very age the name's class year gives on that row's page is read
 * as the year's: the stand-in goes, where kept it stood on the clubs worth pulling while every pull
 * refused it. A label and the year it agrees with cannot be told apart from the year alone once
 * the label is off, and are read as the year. On the backup of 11 October 2026 no row naming such a
 * stand-in carries the age its class year gives, and 2 of the 24 stand-ins a lone V reads had every
 * row name them at an age under fourteen, 3 games in all, none with rows of both kinds.
 */
export const schoolNamedTravelStandIns = (
  state: Pick<GcImportState, "ageGroups" | "teams" | "games">
): ReadonlySet<string> => {
  const school = new Map(
    state.teams
      .filter((team) => team.nameOnly && !team.placeholder && isSchoolName(team.name))
      .map((team) => [team.id, team.name])
  );
  const travel = new Set<string>();
  if (school.size === 0) return travel;
  const squadYear = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const labelled = (teamId: string, level: number | undefined, ageGroupId: string) => {
    const name = school.get(teamId);
    if (name === undefined || level === undefined || level >= MIN_HIGH_SCHOOL_AGE) return false;
    const year = squadYear.get(ageGroupId);
    return year === undefined || ageFromGradYearInName(name, year) !== level;
  };
  state.games.forEach((game) => {
    if (labelled(game.teamAId, game.ageLevelA, game.ageGroupId)) travel.add(game.teamAId);
    if (labelled(game.teamBId, game.ageLevelB, game.ageGroupId)) travel.add(game.teamBId);
  });
  return travel;
};

/** No club said to be real: the tidy's default, for a caller with no answers to give it. */
const NONE_REAL: ReadonlySet<string> = new Set<string>();

/**
 * The ids of the stand-ins among `standIns` that are named, in a pool they play in, after a club
 * the not-a-team tidy spares: the user's own club, a page's own team, or a club in `real` by its
 * id or any of its GameChanger ids.
 *
 * The import files a row of such a club's name as it files any name (the opponent gate reads the
 * club's own names, `carriesWord`). A row the club's own schedule does not bear out, on a day it
 * has no game, goes onto a stand-in of the name, so that stand-in holds the club's rows, and the
 * refile and claim steps settle it as they settle any other stand-in. Deleting it took the club's
 * game, and since no row was marked deleted, the next pull filed the row again against a new
 * stand-in, and the tidy deleted that too. That happened every night, and each night told the owner
 * a practice page had gone.
 *
 * Read the way the gate reads it: by the pool and the name key. A pool holds the clubs its games
 * name and the clubs whose links are filed there. The stand-in's own name is stored cleaned, with
 * no bracket left, so a club of the same key carries the stand-in's word, as the gate requires.
 */
const namedAfterSpared = (
  state: GcImportState,
  standIns: readonly ScoutTeam[],
  pageTeams: ReadonlySet<string>,
  real: ReadonlySet<string>
): Set<string> => {
  const named = new Set<string>();
  if (standIns.length === 0) return named;
  const spared = (team: ScoutTeam): boolean =>
    team.isMine === true ||
    pageTeams.has(team.id) ||
    real.has(team.id) ||
    (team.gcTeams ?? []).some((link) => real.has(link.teamId));
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const asked = new Set(standIns.map((team) => team.id));
  const keys = new Map<string, string>();
  const nameIn = (pool: string, team: ScoutTeam): string => {
    let key = keys.get(team.id);
    if (key === undefined) {
      key = teamNameKey(team.name);
      keys.set(team.id, key);
    }
    return `${pool}\u0000${key}`;
  };
  /** Each spared club by its pool and name key, as the gate's lookup holds it. */
  const sparedNames = new Set<string>();
  /** The pools each asked stand-in plays in. */
  const poolsOf = new Map<string, Set<string>>();
  state.games.forEach((game) => {
    const pool = poolKeyOf(game.ageGroupId);
    [game.teamAId, game.teamBId].forEach((id) => {
      if (asked.has(id)) {
        const pools = poolsOf.get(id);
        if (pools) pools.add(pool);
        else poolsOf.set(id, new Set([pool]));
        return;
      }
      const team = byId.get(id);
      if (team && spared(team)) sparedNames.add(nameIn(pool, team));
    });
  });
  state.teams.forEach((team) => {
    if (!spared(team)) return;
    (team.gcTeams ?? []).forEach((link) =>
      sparedNames.add(nameIn(poolKeyOf(link.ageGroupId), team))
    );
  });
  standIns.forEach((team) => {
    const pools = [...(poolsOf.get(team.id) ?? [])];
    if (pools.some((pool) => sparedNames.has(nameIn(pool, team)))) named.add(team.id);
  });
  return named;
};

/**
 * Deletes the pulled clubs whose every GameChanger name says the page is no team
 * (`notATeamWord`): a practice, a scrimmage, a test, a tryout, a scorekeeper's or a camera's
 * account, an old page marked void, do not use, delete, duplicate or placeholder; and the
 * stand-ins whose one name says so.
 *
 * A tidy pass beside the import's refusal for the reason the wiffle pass is one: a page pulled
 * before the rule existed sits in its age's table with an ordinary record, and nothing else takes
 * it out. On the backup of 11 October 2026 this deletes 520 pulled clubs, 121 of them old pages;
 * 76 were on a board that day and 237 already off every board by the nightly sweep's marks.
 *
 * A stand-in is read too. The import drops a game against a drop word and files one against an old
 * page on a slot, but an old page's row it already filed keeps its opponent, and a drop word's goes
 * only when its schedule is next pulled (the gate's rows read as no longer listed, `refused` in
 * `importOne`), which for a club pulled seldom is a long time. Left, a practice result filed then
 * went on rating the club that played it, out of every table but in the fit, while the same
 * schedule pulled into a fresh pool had no such game. A word only in a bracket is the pull's alone
 * to find, since a stand-in is stored under the cleaned name. On that backup 130 drop-word
 * stand-ins go with their 166 games against pulled clubs (47 scored), and 56 old-page stand-ins' 85
 * games (16 scored) move onto slots; a full tidy leaves no stand-in of these words, where it left
 * 175. A slot of the name is left: it names nobody, and is what the import files an old page on.
 *
 * Narrower than the wiffle pass in four ways, each because a wrongly deleted club leaves nothing
 * behind to notice it by:
 *
 * - A pulled club or a stand-in, never a slot.
 * - Every one of the club's GameChanger names, as GameChanger gives them on its links, and the
 *   club's own name only for a link that carries none. A club holding one practice id and one real
 *   one is the real one, folded together; and the club's stored name has lost what a bracket said,
 *   "(Practice Squad)", which 33 of the 520 say only there. Two clubs whose stored name has a word
 *   none of their links has are left. A name that is only "Team" and a number is the exception: the
 *   import keeps it as it is, having nothing but an age to clean off it, so a club GameChanger calls
 *   "Team 7" or "Team 7 12U" that the pool holds under another name than "Team 7" was named by
 *   somebody, renamed by hand or merged into a club with a name, and keeps that name, unless that
 *   name says no team too ("Practice", "Team 7 Practice"), which spares nothing. On the backup of
 *   11 October 2026 each of the 31 pulled clubs GameChanger calls so is called so in the pool.
 * - Never the user's own club, a page's own team, or a club in `real` (by club id or any of its
 *   GameChanger ids), a stand-in included: those said to be real, and every club a League
 *   Standings team links, picked or carried onto by its name, which the callers add
 *   (`leagueLinkedClubs`) because only the League pass sees the link. A pick left pointing at a
 *   deleted club is a stale id, and the league's team goes to a namesake. Nor a drop-word stand-in
 *   named after one of those in a pool it plays in (`namedAfterSpared`): the import files a row of
 *   that club's name against such a stand-in on a day the club played nobody, so the stand-in
 *   holds the club's game. Deleted, it lost that game, and every pull filed the row again.
 * - An old page's games another club's own schedule lists are kept, with the old page's side
 *   turned into a slot of its own (`ScoutTeam.placeholder`), as the import now files a game against
 *   one: the result is real and the club that played it keeps it, its opponent out of every table
 *   as every slot is. A drop word's games go with it, as a wiffle team's do: a practice's result is
 *   not a game, on either side. On that backup the 520 clubs held 434 games, 251 scored; 35 are
 *   kept (27 scored), 31 on slots and 4 stood back up against the stand-in their own row named.
 */
export const dropNotATeam = (
  state: GcImportState,
  real: ReadonlySet<string> = NONE_REAL
): { state: GcImportState; dropped: number } => {
  const pageTeams = new Set(
    state.ageGroups.flatMap((group) => (group.myTeamId ? [group.myTeamId] : []))
  );
  const going = new Set<string>();
  /** The going clubs whose names mark an old page, whose games another schedule lists are kept. */
  const oldPages = new Set<string>();
  /** Every GameChanger id of a going club: the rows its own schedules gave, wherever they are. */
  const goingRows = new Set<string>();
  /** The drop-word stand-ins, read against the spared clubs' names before any of them goes. */
  const dropWords: ScoutTeam[] = [];
  state.teams.forEach((team) => {
    const links = team.gcTeams ?? [];
    if (team.isMine || pageTeams.has(team.id) || real.has(team.id)) return;
    if (links.length === 0) {
      // A stand-in, by the one name it has; never a slot, which names nobody (see above).
      if (team.placeholder || !team.nameOnly) return;
      const hit = notATeamWord(team.name);
      if (!hit) return;
      if (hit.opponent === "drop") {
        dropWords.push(team);
        return;
      }
      going.add(team.id);
      oldPages.add(team.id);
      return;
    }
    if (links.some((link) => real.has(link.teamId))) return;
    let slot = false;
    for (const link of links) {
      const hit = notATeamWord(link.name.trim() || team.name);
      if (!hit) return;
      // GameChanger calls it only "Team 7", and the pool calls it something else: somebody named
      // it, by hand or by a merge, and it is that name's club (see above), unless the name they
      // gave it says no team as well.
      if (hit.word === "team" && !notATeamWord(team.name)) return;
      if (hit.opponent === "slot") slot = true;
    }
    going.add(team.id);
    links.forEach((link) => goingRows.add(link.teamId));
    if (slot) oldPages.add(team.id);
  });
  const named = namedAfterSpared(state, dropWords, pageTeams, real);
  dropWords.forEach((team) => {
    if (!named.has(team.id)) going.add(team.id);
  });
  if (going.size === 0) return { state, dropped: 0 };

  const nameOf = new Map(state.teams.map((team) => [team.id, team.name]));
  const used = new Set(state.teams.map((team) => team.id));
  const slots: ScoutTeam[] = [];
  /** A slot of its own for each game kept off an old page, as the import makes one per game. */
  const slotFor = (clubId: string): string => {
    const slot = buildScoutTeam(nameOf.get(clubId) ?? "", used, { placeholder: true });
    used.add(slot.id);
    slots.push(slot);
    return slot.id;
  };
  const ownPage = ownPageFor(state.ageGroups);
  /** A row of a going club's own schedule, or one claimed for a copy and filed against one. */
  const goes = (record: FoldedRow) =>
    goingRows.has(record.teamId) ||
    (record.filedAgainst !== undefined && going.has(record.filedAgainst));
  /** `game` without anything a going club's schedule said of it, and the picture naming one. */
  const unsaid = (game: ScoutGame): ScoutGame => {
    const dropped = (game.alsoRows ?? []).filter(goes).reduce(releaseClaim, game);
    const {
      alsoFrom,
      namedByAvatar,
      reportedByB,
      scoreFromB,
      teamAScore,
      teamBScore,
      alsoRows,
      ...rest
    } = dropped;
    const from = (alsoFrom ?? []).filter((schedule) => !goingRows.has(schedule));
    // Side B's own report, and a score lent by it, were the old page's word where it is side B.
    const sideBGoes = going.has(dropped.teamBId);
    const rows = (alsoRows ?? []).map((record) =>
      record.namedByAvatar !== undefined && going.has(record.namedByAvatar)
        ? (({ namedByAvatar: _gone, ...kept }) => kept)(record)
        : record
    );
    return {
      ...rest,
      ...(scoreFromB && sideBGoes
        ? {}
        : {
            ...(teamAScore === undefined ? {} : { teamAScore }),
            ...(teamBScore === undefined ? {} : { teamBScore }),
            ...(scoreFromB ? { scoreFromB } : {}),
          }),
      ...(reportedByB && !sideBGoes ? { reportedByB } : {}),
      ...(namedByAvatar !== undefined && !going.has(namedByAvatar) ? { namedByAvatar } : {}),
      ...(from.length > 0 ? { alsoFrom: from } : {}),
      ...(rows.length > 0 ? { alsoRows: rows } : {}),
    };
  };
  /** `game` with each going side, an old page, on a slot of its own. */
  const onSlots = (game: ScoutGame): ScoutGame => ({
    ...game,
    ...(going.has(game.teamAId) ? { teamAId: slotFor(game.teamAId) } : {}),
    ...(going.has(game.teamBId) ? { teamBId: slotFor(game.teamBId) } : {}),
  });

  const games = state.games.flatMap((game): ScoutGame[] => {
    const a = going.has(game.teamAId);
    const b = going.has(game.teamBId);
    if (!a && !b) {
      // A row claimed for this copy that its own schedule filed against a going club, as `without`.
      const claimed = (game.alsoRows ?? []).filter(
        (record) => record.filedAgainst !== undefined && going.has(record.filedAgainst)
      );
      return [claimed.reduce(releaseClaim, game)];
    }
    const page = a ? game.teamAId : game.teamBId;
    if ((a && b) || !oldPages.has(page)) return [];
    // The other club's own row is the game: what the old page said of it comes off.
    if (game.source === undefined || !goingRows.has(game.source.teamId)) {
      return [onSlots(unsaid(game))];
    }
    /*
     * The old page's own row is the game: it goes, as a row its schedule no longer lists does, and
     * every other schedule's row folded into it stands up as a game of its own, as
     * `standUpWithdrawn` stands one up, facing a slot where it faced an old page. A row claimed
     * here that its own schedule filed against the old page by name is one of them: it stands up
     * against the team it was filed against, the old page, and so on a slot. One that stands up
     * against a page no team at all goes, as every game against one does.
     */
    return (game.alsoRows ?? []).flatMap((record): ScoutGame[] => {
      if (goingRows.has(record.teamId)) return [];
      const stood = ownPage(filedRowOf(game, record));
      const faced = [stood.teamAId, stood.teamBId].filter((id) => going.has(id));
      if (faced.some((id) => !oldPages.has(id))) return [];
      const { namedByAvatar, ...rest } = stood;
      return [
        onSlots({
          ...rest,
          ...(namedByAvatar !== undefined && !going.has(namedByAvatar) ? { namedByAvatar } : {}),
          ...(game.excluded ? { excluded: true } : {}),
          ...(game.event ? { event: game.event } : {}),
        }),
      ];
    });
  });
  return {
    state: {
      ...state,
      teams: [...state.teams.filter((team) => !going.has(team.id)), ...slots],
      games,
    },
    dropped: going.size,
  };
};

/**
 * Levels worked out for what is already in the pool, under the rules as they now stand.
 *
 * Every other pass here is about the shape of the pool. This one is about the rules having
 * changed: reading a graduating class out of a name is new, and everything pulled before it went
 * in was filed by the old reading. A club called "Nationals 2031" that has been sitting in the
 * pool for a month has no level, and every game against it was recorded as a game between equals,
 * because a side with no level falls back to the level of the page the game is filed under.
 *
 * Re-pulling would fix it, but only for the teams that get re-pulled: a club known only from
 * somebody else's schedule has no id of its own to pull, and nothing in the weekly rotation will
 * ever reach it. So the pool is re-read where it stands.
 *
 * A level is only ever *added*, never overwritten: what a pull recorded is what GameChanger said,
 * and this is a reading of a name. And a level is only recorded when it says something the page
 * does not already say — one equal to the page's changes no answer, and writing it anyway would
 * rewrite every row in the pool to say nothing new.
 */
const relevelFromNames = (state: GcImportState): { state: GcImportState; releveled: number } => {
  const pageYear = new Map<string, number | undefined>();
  const pageLevel = new Map<string, number | undefined>();
  state.ageGroups.forEach((group) => {
    pageYear.set(group.id, ageGroupYear(group));
    pageLevel.set(group.id, ageGroupLevel(group));
  });

  const levelFromName = (name: string, year: number | undefined): number | undefined =>
    ageLevelFromName(name) ?? (year === undefined ? undefined : ageFromGradYearInName(name, year));

  let releveled = 0;

  const teams = state.teams.map((team) => {
    const links = team.gcTeams;
    if (!links || links.length === 0) return team;
    let changed = false;
    const next = links.map((link) => {
      if (link.ageLevel !== undefined) return link;
      const year =
        pageYear.get(link.ageGroupId) ??
        (link.seasonYear === undefined
          ? undefined
          : squadYearForGcSeason(link.season, link.seasonYear));
      const level = levelFromName(link.name, year);
      if (level === undefined) return link;
      changed = true;
      releveled += 1;
      return { ...link, ageLevel: level };
    });
    return changed ? { ...team, gcTeams: next } : team;
  });

  const byId = new Map(teams.map((team) => [team.id, team]));
  const games = state.games.map((game) => {
    const year = pageYear.get(game.ageGroupId);
    const filed = pageLevel.get(game.ageGroupId);
    const side = (teamId: string, current: number | undefined): number | undefined => {
      if (current !== undefined) return undefined;
      const team = byId.get(teamId);
      // A slot names nobody, so there is no name to read.
      if (!team || team.placeholder) return undefined;
      const level = levelFromName(team.name, year);
      return level === undefined || level === filed ? undefined : level;
    };
    const a = side(game.teamAId, game.ageLevelA);
    const b = side(game.teamBId, game.ageLevelB);
    if (a === undefined && b === undefined) return game;
    releveled += (a === undefined ? 0 : 1) + (b === undefined ? 0 : 1);
    return {
      ...game,
      ...(a === undefined ? {} : { ageLevelA: a }),
      ...(b === undefined ? {} : { ageLevelB: b }),
    };
  });

  return releveled === 0
    ? { state, releveled: 0 }
    : { state: { ...state, teams, games }, releveled };
};

/**
 * The things a tidy pass does, in the order it does them. The order is load-bearing and the
 * comments below say why; this is the same list, named, so a watcher can be told where it is.
 */
export const TIDY_STEPS = [
  "notBaseball",
  "highSchool",
  "notATeam",
  "releveled",
  "stateFilled",
  "pruned",
  "withdrawn",
  "named",
  "joined",
  "namesakeJoined",
  "reclaimed",
  "resettled",
  "refiled",
  "merged",
  "claimed",
  "folded",
  "paired",
  "collapsed",
  "regrouped",
  "countedElsewhere",
] as const;

export type TidyStepName = (typeof TIDY_STEPS)[number];

/**
 * Whether a tidy actually changed the pool, and so whether it is worth saving.
 *
 * Read off `TIDY_STEPS` rather than written out as a sum, because a sum written out is a list
 * that has to be kept in step with this one by hand — and was not. The caller's version named
 * eight of the eleven, leaving out `notBaseball`, `highSchool` and `resettled`, while the tidy
 * stamp was written whatever happened: a pass whose only effect was deleting wiffle-ball or high
 * school teams stamped the pool as tidied and then did not save it, so the deletions were lost
 * and nothing would redo them until `TIDY_RULES_VERSION` moved.
 *
 * `passes` is not a change — it is at least one on a tidy that found nothing — and `state` is the
 * pool itself, which is why this asks the step list rather than every numeric field.
 */
export const tidyChangedAnything = (tidy: PoolTidy): boolean =>
  TIDY_STEPS.some((step) => tidy[step] > 0) || tidy.idle > 0;

/**
 * One step of one pass, reported twice: once as it starts and once as it finishes.
 *
 * Twice because a step is where the time goes. Reported only on the way out, a step that takes ten
 * seconds shows nothing moving for ten seconds, which is the thing this was built to stop. The
 * step that is *running* is what says the work is alive, and it is the honest signal too: it comes
 * from the worker, so it stops arriving if the worker stops.
 */
export type TidyStep = {
  /** 1-based, as a person counts passes. */
  pass: number;
  step: TidyStepName;
  /** How many rows or teams this step changed. Zero on the way in, since it has not run yet. */
  found: number;
  /** The pool as the step found it, and then as it leaves it. */
  teams: number;
  games: number;
  /** False on the way in, true on the way out. */
  done: boolean;
  /** Candidate progress for a long-running step; absent for ordinary start/finish notices. */
  processed?: number;
  total?: number;
};

/** Told after every step, so a caller can show the work rather than a spinner. */
export type TidyWatcher = (step: TidyStep) => void;

/**
 * How two copies of one row are ranked for keeping: one between two real clubs over one against a
 * stand-in or a slot, then one holding other schedules' rows.
 */
const copyRanks = (teams: readonly ScoutTeam[]) => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const real = (game: ScoutGame) =>
    [game.teamAId, game.teamBId].every((id) => {
      const team = teamById.get(id);
      return team !== undefined && !team.placeholder && !team.nameOnly;
    });
  const rank = (game: ScoutGame) =>
    (real(game) ? 2 : 0) + ((game.alsoRows?.length ?? 0) > 0 ? 1 : 0);
  return { real, rank };
};

/**
 * The pool with one game per GameChanger row. One row is one game, and two games standing on one
 * row — under one id, or a game that took over a re-entered row and a refresh's copy of that row
 * under its own id — are that row filed twice: a refresh of one page that could not see the other
 * page's copy. Every pass after this one keys its work on the id, and folding one of the two away
 * took both.
 *
 * The copy kept is the one against two real clubs over one against a stand-in, then one holding the
 * rows folded into it, then the earlier; the last copy with a score gives it that score and start,
 * since a refresh's copy against a stand-in was often the only one carrying a result posted since
 * — kept by the rank alone, the result was dropped on every refresh. Rows folded into a copy that
 * goes are kept on the one that stays.
 */
const withoutRepeatedIds = (state: GcImportState): { state: GcImportState; dropped: number } => {
  const rowOf = (game: ScoutGame) =>
    game.source ? gcRowId(game.source.teamId, game.source.gameId) : game.id;
  const copies = new Map<string, number[]>();
  let repeated = false;
  state.games.forEach((game, at) => {
    const key = rowOf(game);
    const list = copies.get(key);
    if (list) {
      list.push(at);
      repeated = true;
    } else copies.set(key, [at]);
  });
  if (!repeated) return { state, dropped: 0 };
  const { rank } = copyRanks(state.teams);
  const kept = new Map<number, ScoutGame>();
  const gone = new Set<number>();
  copies.forEach((at) => {
    if (at.length < 2) return;
    const games = at.map((i) => state.games[i]!);
    let keepAt = 0;
    games.forEach((game, i) => {
      if (rank(game) > rank(games[keepAt]!)) keepAt = i;
    });
    let game = games[keepAt]!;
    const latest = games
      .slice()
      .reverse()
      .find((copy) => isScored(copy) && !copy.scoreFromB && !copy.scoreFromTwin);
    if (latest && latest !== game && latest.teamAId === game.teamAId) {
      const { scoreFromB: _borrowed, scoreFromTwin: _twin, startTs: _start, ...rest } = game;
      game = {
        ...rest,
        teamAScore: latest.teamAScore!,
        teamBScore: latest.teamBScore!,
        ...(latest.startTs ? { startTs: latest.startTs } : {}),
      };
    }
    const own = rowOf(game);
    const rows = new Map(
      games.flatMap((copy) =>
        (copy.alsoRows ?? []).map(
          (record) => [gcRowId(record.teamId, record.gameId), record] as const
        )
      )
    );
    rows.delete(own);
    rows.delete(game.id);
    if (rows.size > 0) game = { ...game, alsoRows: [...rows.values()] };
    kept.set(at[keepAt]!, game);
    at.forEach((i, n) => {
      if (n !== keepAt) gone.add(i);
    });
  });
  const games = state.games.flatMap((game, at) => (gone.has(at) ? [] : [kept.get(at) ?? game]));
  return { state: { ...state, games }, dropped: gone.size };
};

/**
 * The pool with each GameChanger row in one game, whether it stands as a game or is folded into
 * one (`ScoutGame.alsoRows`).
 *
 * A game played across two ages is filed on one club's page, and the other club's row folded into
 * it there. A refresh of that club's own page cannot see the other page (`pullSections`), so it
 * filed the row again as a game of its own, against a stand-in or a slot where the name found
 * nobody at that level, and the club was credited with one game twice. The regroup
 * (`collapseSameGames`) only compares rows of one pair on one day, and the check above only two
 * games standing on one row, so both copies came through every tidy: on the pool of 26 September
 * 2026, 246 rows stood as a game and sat folded in another, and 10 more sat folded in two.
 *
 * A row folded into two games stays in the one ranked higher (`copyRanks`), or fitting it better.
 * A row standing as a game and folded into another stays standing where the game it stands as is
 * between two real clubs or holds another schedule's row, and comes out of the other game.
 * Otherwise the standing copy is the refresh's, and it goes; its start, day and score — the newest
 * word on the row — go onto the record in the other game, and the regroup then reads that game
 * again.
 *
 * Except where the standing copy says the other game is not this one: its own result has the club
 * winning where the other game's own row has it losing, or tying, or the other way round. Or the
 * other game's only score is the one this row lent it: the other club has posted nothing, so all
 * that ties this row to that game is the club's own word, and its word now names someone else.
 * There the standing copy stays and the row comes out of the other game. Read the other way, a
 * 5-6 loss to "Western 2" was written into another club's 16-3 game as that club winning 6-5, and
 * a 9U club's only result, a tie lent by a row that had since been scored 11-6 against the
 * Diamondbacks, became an 11-6 loss.
 */
const oneRowOnePlace = (state: GcImportState): { state: GcImportState; settled: number } => {
  const standingAt = new Map<string, number>();
  state.games.forEach((game, at) => {
    if (game.source) standingAt.set(gcRowId(game.source.teamId, game.source.gameId), at);
  });
  const heldAt = new Map<string, number[]>();
  state.games.forEach((game, at) =>
    game.alsoRows?.forEach((record) => {
      const key = gcRowId(record.teamId, record.gameId);
      if (standingAt.get(key) === at) return;
      const list = heldAt.get(key);
      if (!list) heldAt.set(key, [at]);
      else if (!list.includes(at)) list.push(at);
    })
  );
  const { real, rank } = copyRanks(state.teams);
  const sign = (runs: number) => Math.sign(runs);
  const ownResult = (game: ScoutGame): number | undefined =>
    isScored(game) && !game.scoreFromB && !game.scoreFromTwin
      ? sign(game.teamAScore! - game.teamBScore!)
      : undefined;
  /** Whether the standing copy says the other game is another game (above). */
  const another = (standing: ScoutGame, other: ScoutGame, record: FoldedRow): boolean => {
    if (other.scoreFromB && record.onSideB) return true;
    const mine = ownResult(standing);
    const theirs = ownResult(other);
    if (mine === undefined || theirs === undefined) return false;
    return mine !== (record.onSideB ? -theirs : theirs);
  };
  const recordIn = (game: ScoutGame, key: string) =>
    game.alsoRows?.find((record) => gcRowId(record.teamId, record.gameId) === key);
  /**
   * Between two games ranked alike, how well one fits the row it holds: its own result agreeing
   * with the row's, then its start the row's. Two real clubs' copies both holding one row is the
   * usual shape of a row folded twice, and a copy whose only score is the row's own fits nothing:
   * 5 Star Coastal Gold's 6-13 sat in CBU Georgia's own 13-6 at 14:00 and in the WA Bulldogs'
   * blank copy at 15:00, the row's own start, and there counted the Bulldogs one more win than
   * GameChanger gives them.
   */
  const fit = (game: ScoutGame, key: string): number => {
    const record = recordIn(game, key)!;
    const theirs = ownResult(game);
    const agrees =
      theirs !== undefined &&
      record.ownScore !== undefined &&
      record.opponentScore !== undefined &&
      (record.onSideB ? -theirs : theirs) === sign(record.ownScore - record.opponentScore);
    return (agrees ? 2 : 0) + (sameStart(game.startTs, record.startTs) ? 1 : 0);
  };

  const dropped = new Set<number>();
  const released = new Map<number, string[]>();
  const rewritten = new Map<number, Map<string, ScoutGame>>();
  const release = (at: number, key: string) => {
    const keys = released.get(at);
    if (keys) keys.push(key);
    else released.set(at, [key]);
  };
  let settled = 0;
  heldAt.forEach((everyHolder, key) => {
    /*
     * A copy the user has thrown out is left as the user left it, and is no copy for the others to
     * be read against: it does not count, so only the copies that do are two. Resolved with the
     * rest, a thrown-out standing copy went and the copy it had been kept out beside counted in its
     * place; left out with the whole row, three copies with one thrown out kept counting twice.
     */
    const counted = (at: number) => !state.games[at]!.excluded;
    const standsAt = standingAt.get(key);
    const standing = standsAt !== undefined && counted(standsAt) ? standsAt : undefined;
    const holders = everyHolder.filter(counted);
    if (holders.length === 0 || (standing === undefined && holders.length < 2)) return;
    settled += 1;
    const ranked = holders.sort(
      (x, y) =>
        rank(state.games[y]!) - rank(state.games[x]!) ||
        fit(state.games[y]!, key) - fit(state.games[x]!, key) ||
        x - y
    );
    const best = ranked[0]!;
    if (standing === undefined) {
      ranked.slice(1).forEach((at) => release(at, key));
      return;
    }
    const copy = state.games[standing]!;
    const other = state.games[best]!;
    const stays =
      real(copy) || (copy.alsoRows?.length ?? 0) > 0 || another(copy, other, recordIn(other, key)!);
    if (stays) {
      ranked.forEach((at) => release(at, key));
      return;
    }
    dropped.add(standing);
    const rewrites = rewritten.get(best) ?? new Map<string, ScoutGame>();
    rewrites.set(key, copy);
    rewritten.set(best, rewrites);
    ranked.slice(1).forEach((at) => release(at, key));
  });
  if (settled === 0) return { state, settled: 0 };

  const games = state.games.flatMap((game, at) => {
    if (dropped.has(at)) return [];
    let next = game;
    released.get(at)?.forEach((key) => {
      const record = recordIn(next, key);
      if (record) next = releaseClaim(next, record);
    });
    const rewrites = rewritten.get(at);
    if (rewrites && next.alsoRows) {
      next = {
        ...next,
        alsoRows: next.alsoRows.map((record) => {
          const copy = rewrites.get(gcRowId(record.teamId, record.gameId));
          return copy ? newestWord(record, copy, next) : record;
        }),
      };
    }
    return [next];
  });
  return { state: { ...state, games }, settled };
};

/**
 * The record of a row, as the refresh's own copy of it (`copy`, standing on it) now has it: its
 * start, its day where that is not the game's, and its score where the copy's own schedule gave
 * one. A score the copy only borrowed is not the row's word, and a row now blank is blank.
 */
const newestWord = (record: FoldedRow, copy: ScoutGame, game: ScoutGame): FoldedRow => {
  const { ownScore: _own, opponentScore: _theirs, startTs: _start, date: _date, ...rest } = record;
  const scored = isScored(copy) && !copy.scoreFromB && !copy.scoreFromTwin;
  return {
    ...rest,
    ...(copy.startTs ? { startTs: copy.startTs } : {}),
    ...(copy.date && copy.date !== game.date ? { date: copy.date } : {}),
    ...(scored ? { ownScore: copy.teamAScore!, opponentScore: copy.teamBScore! } : {}),
  };
};

const tidyOnce = (
  state: GcImportState,
  pass: number,
  watch?: TidyWatcher,
  apart?: KeptApart,
  refused: NotThisTeam = NO_REFUSALS,
  real: ReadonlySet<string> = NONE_REAL
): Omit<PoolTidy, "passes" | "idle"> => {
  /*
   * Reported from here rather than from the passes themselves: each one is a pure function of a
   * pool that knows nothing about being watched, and it should stay that way. A watcher that
   * throws must not take the tidy down with it — half an hour of work is not worth a progress bar.
   */
  const say = (step: TidyStepName, found: number, at: GcImportState, done: boolean) => {
    if (!watch) return;
    try {
      watch({ pass, step, found, teams: at.teams.length, games: at.games.length, done });
    } catch {
      /* never at the tidy's expense */
    }
  };
  /** Going in: no count yet, and the pool as this step found it. */
  const starting = (step: TidyStepName, at: GcImportState) => say(step, 0, at, false);
  /** Coming out: what it changed, and the pool as it leaves it. */
  const finished = (step: TidyStepName, found: number, at: GcImportState) =>
    say(step, found, at, true);
  // Before everything, because a team that should not be here at all should not be settled,
  // folded, paired or levelled first.
  starting("notBaseball", state);
  const kept = dropNotBaseball(state);
  finished("notBaseball", kept.dropped, kept.state);
  // Beside it, and for the same reason: a club that does not belong in the pool should not be
  // settled, folded, paired or levelled first.
  starting("highSchool", kept.state);
  const school = dropSchoolTeams(kept.state);
  finished("highSchool", school.dropped, school.state);
  // And a page that is no team, for the same reason again.
  starting("notATeam", school.state);
  const pages = dropNotATeam(school.state, real);
  finished("notATeam", pages.dropped, pages.state);
  // Then levels, because every pass after it compares them: a side whose level is about to be
  // worked out should be worked out before anything decides whether two rows mean one game.
  starting("releveled", pages.state);
  const levels = relevelFromNames(pages.state);
  finished("releveled", levels.releveled, levels.state);
  // Then where each club is, before every step that reads a namer's state to file what it named.
  starting("stateFilled", levels.state);
  const located = fillMissingStates(levels.state.teams);
  const placedAt = located.filled === 0 ? levels.state : { ...levels.state, teams: located.teams };
  finished("stateFilled", located.filled, placedAt);
  starting("pruned", placedAt);
  const season = pruneOutOfSeason(placedAt);
  finished("pruned", season.pruned, season.state);
  // Before anything settles a stand-in into it or folds a row into it: the game is going.
  starting("withdrawn", season.state);
  const gone = standUpWithdrawn(season.state.games, season.state.ageGroups);
  const standing =
    gone.games !== season.state.games ? { ...season.state, games: gone.games } : season.state;
  finished("withdrawn", gone.withdrawn, standing);
  const repeated = withoutRepeatedIds(standing);
  const onePlace = oneRowOnePlace(repeated.state);
  const unique = { state: onePlace.state, dropped: repeated.dropped + onePlace.settled };
  starting("named", unique.state);
  const named = resolveSlotGames(unique.state, refused);
  finished("named", named.resolved, named.state);
  // Straight after the slots, and for the same reason: two stand-ins joined here are a pair of
  // clubs the passes after it can compare.
  starting("joined", named.state);
  const halves = joinCrossedHalves(named.state);
  finished("joined", halves.joined, halves.state);
  // After the crossed halves, which join a pair whose names each fit the other club, and before
  // every step that reads a copy as a pulled club's: the game it makes holds the named club's own
  // row, which the reclaim and the step after it read as that club's word that it played.
  starting("namesakeJoined", halves.state);
  const namesakes = joinNamesakeHalves(halves.state, refused);
  finished("namesakeJoined", namesakes.joined, namesakes.state);
  starting("reclaimed", namesakes.state);
  const moved = reclaimMisfiled(namesakes.state);
  finished("reclaimed", moved.reclaimed, moved.state);
  // After the fixture, which is better evidence than a level, and before the refile, which then
  // gets a look at whatever this had to leave as a stand-in.
  starting("resettled", moved.state);
  const graded = resettleOffLevel(moved.state, refused);
  finished("resettled", graded.resettled, graded.state);
  starting("refiled", graded.state);
  const placed = refileStandIns(graded.state, refused);
  finished("refiled", placed.refiled, placed.state);
  // After the refile, which files a stand-in's rows onto a club where it can, so only the stand-ins
  // that stay stand-ins are made one; and before the claims, which read the day against them.
  starting("merged", placed.state);
  const doubled = mergeDuplicateStandIns(placed.state);
  finished("merged", doubled.merged, doubled.state);
  // After every step that settles who a row was played against by its name, so a claim is read
  // against what they left — a pair of halves joined, a row reclaimed by its namesake — and before
  // the collapse, which then regroups each claimed row with the copy it went into.
  starting("claimed", doubled.state);
  const claims = claimFiledRows(doubled.state);
  finished("claimed", claims.claimed, claims.state);
  starting("folded", claims.state);
  const squads = mergeSameSquadIds(claims.state);
  finished("folded", squads.merged, squads.state);
  starting("paired", squads.state);
  const seasons = pairSettledSquads(
    squads.state,
    (processed, total, found) => {
      if (!watch) return;
      try {
        watch({
          pass,
          step: "paired",
          found,
          teams: squads.state.teams.length,
          games: squads.state.games.length,
          done: false,
          processed,
          total,
        });
      } catch {
        /* never at the tidy's expense */
      }
    },
    apart
  );
  finished("paired", seasons.paired, seasons.state);
  starting("collapsed", seasons.state);
  const same = collapseSameGames(seasons.state.games, seasons.state.ageGroups);
  const after =
    same.games !== seasons.state.games ? { ...seasons.state, games: same.games } : seasons.state;
  finished("collapsed", same.collapsed + unique.dropped, after);
  // The same pass, reported as its own step: a regroup that folds nothing away is still a change,
  // and one the pool has to be saved for.
  starting("regrouped", after);
  finished("regrouped", same.regrouped, after);
  // Last, once every row that could be the game's own has gone where it goes: what is left
  // standing beside a game both clubs' schedules hold is a copy of it.
  starting("countedElsewhere", after);
  const copies = markCountedElsewhere(after);
  finished("countedElsewhere", copies.marked, copies.state);
  return {
    state: copies.state,
    named: named.resolved,
    joined: halves.joined,
    namesakeJoined: namesakes.joined,
    folded: squads.merged,
    paired: seasons.paired,
    collapsed: same.collapsed + unique.dropped,
    regrouped: same.regrouped,
    pruned: season.pruned,
    withdrawn: gone.withdrawn,
    reclaimed: moved.reclaimed,
    resettled: graded.resettled,
    refiled: placed.refiled,
    merged: doubled.merged,
    claimed: claims.claimed,
    releveled: levels.releveled,
    stateFilled: located.filled,
    countedElsewhere: copies.marked,
    notBaseball: kept.dropped,
    highSchool: school.dropped,
    notATeam: pages.dropped,
  };
};

/**
 * Runs the passes until a pass finds nothing. Each one changes what the next can see — a slot
 * settled in pass one is the row that lets a second slot settle in pass two — so a single pass
 * left 416 stand-ins that the next pass found, then 54, then 5.
 */
export const tidyPool = (
  state: GcImportState,
  watch?: TidyWatcher,
  /** Pairs the user has already said are two clubs, so the tidy does not join them behind them. */
  apart?: KeptApart,
  /**
   * Names the owner has said are not a club ("Not this team", `notThisTeam.ts`), so no step files a
   * row of one onto the club by the name, and the step that takes a name's rows off a club takes
   * them off it; the club's own schedule listing a game still makes it the club's.
   */
  refused: NotThisTeam = NO_REFUSALS,
  /**
   * The clubs the owner has said are real ("This club is real"), by club id or GameChanger id, so
   * the step that deletes a page whose name says it is no team never deletes one of them; and every
   * caller adds the clubs a League Standings team links (`leagueLinkedClubs`), which only the League
   * pass can see.
   */
  real: ReadonlySet<string> = NONE_REAL
): PoolTidy => {
  const total: PoolTidy = {
    state,
    named: 0,
    joined: 0,
    namesakeJoined: 0,
    folded: 0,
    paired: 0,
    collapsed: 0,
    regrouped: 0,
    pruned: 0,
    withdrawn: 0,
    reclaimed: 0,
    resettled: 0,
    refiled: 0,
    merged: 0,
    claimed: 0,
    releveled: 0,
    stateFilled: 0,
    countedElsewhere: 0,
    notBaseball: 0,
    highSchool: 0,
    notATeam: 0,
    idle: 0,
    passes: 0,
  };
  for (let pass = 0; pass < TIDY_MAX_PASSES; pass += 1) {
    const step = tidyOnce(total.state, pass + 1, watch, apart, refused, real);
    total.passes += 1;
    total.state = step.state;
    total.named += step.named;
    total.joined += step.joined;
    total.namesakeJoined += step.namesakeJoined;
    total.folded += step.folded;
    total.paired += step.paired;
    total.collapsed += step.collapsed;
    total.regrouped += step.regrouped;
    total.pruned += step.pruned;
    total.withdrawn += step.withdrawn;
    total.reclaimed += step.reclaimed;
    total.resettled += step.resettled;
    total.refiled += step.refiled;
    total.merged += step.merged;
    total.claimed += step.claimed;
    total.releveled += step.releveled;
    total.stateFilled += step.stateFilled;
    total.countedElsewhere += step.countedElsewhere;
    total.notBaseball += step.notBaseball;
    total.highSchool += step.highSchool;
    total.notATeam += step.notATeam;
    const changed =
      step.named +
      step.joined +
      step.namesakeJoined +
      step.folded +
      step.paired +
      step.collapsed +
      step.regrouped +
      step.pruned +
      step.withdrawn +
      step.reclaimed +
      step.resettled +
      step.refiled +
      step.merged +
      step.claimed +
      step.releveled +
      step.stateFilled +
      step.countedElsewhere +
      step.notBaseball +
      step.highSchool +
      step.notATeam;
    if (changed === 0) break;
  }
  /*
   * Once the passes are done rather than in each of them: a roster pruned in a pass is a pool that
   * changed, and the tidy went round again to find nothing. On the pool of 24 September 2026 with
   * its 76 put back, that took a tidy with nothing else to do from 11.3 s to 22.9 s.
   */
  const idle = idleStandIns(total.state);
  if (idle.size > 0) {
    total.state = {
      ...total.state,
      teams: total.state.teams.filter((team) => !idle.has(team.id)),
    };
    total.idle = idle.size;
  }
  return total;
};

/**
 * The stand-ins nothing stands on: in no game on either side, with no claimed row to go back to
 * them (`filedTeamIds`), and no page's own team. A step that empties a stand-in takes it out as it
 * goes, but a game or a club the user deletes, or a game dated ahead taken out, leaves its stand-in
 * behind, and only a later step that happened to change something took it: the backup of 24
 * September 2026 held 76, 19 of them bracket slots, each an opponent Pool Health counted.
 */
const idleStandIns = (state: GcImportState): Set<string> => {
  const used = new Set<string>(filedTeamIds(state.games));
  state.games.forEach((game) => {
    used.add(game.teamAId);
    used.add(game.teamBId);
  });
  state.ageGroups.forEach((group) => {
    if (group.myTeamId) used.add(group.myTeamId);
  });
  return new Set(
    state.teams
      .filter(
        (team) =>
          (team.placeholder || team.nameOnly) &&
          !team.gcTeams?.length &&
          !team.isMine &&
          !used.has(team.id)
      )
      .map((team) => team.id)
  );
};

/**
 * Bumped whenever a tidy pass changes what it does to a pool.
 *
 * It rides in the signature so a pool the tidy has already seen reads as one it has not, exactly
 * once, after a release that changes a rule. Without it a pool nobody has touched keeps whatever
 * the old rules decided for ever: the stamp still matches, so the tidy never runs, so the new rule
 * never reaches anything already here.
 *
 *   2 — reading a graduating class out of a name
 *   3 — deleting the teams that are not playing baseball
 *   4 — taking a game off a club that plays nowhere near the age it was played at
 *   5 — deleting the high school squads
 *   6 — joining a game each club filed against a stand-in for the other, and reclaiming a row
 *       from a namesake when the other club's schedule holds it against a stand-in for the puller
 *   7 — keeping once a game two coaches scored differently at one start time: joining the two
 *       halves, settling a stand-in into the named row, and taking a row back from a namesake
 *   8 — filing a stand-in onto the one namesake in a bordering state when none is in the puller's
 *   9 — keeping once a game two clubs' schedules started within the hour of each other, or gave
 *       the same result at any start, with the other club's score kept beside it rather than in a
 *       note; the blitzball refusal released before it had no bump of its own, and reaches a pool
 *       already tidied with this one
 *  10 — keeping once a game each club's schedule lists that nothing on the other's accounts for,
 *       whatever the two clocks say, and taking away a game its club's schedule no longer lists
 *  11 — settling a club's own row against a stand-in into a game another club's schedule lists
 *       against it that none of its own schedules does, within the hour and scored within four runs
 *  12 — that settle read again on every tidy and put back where the schedules stop bearing it out,
 *       and made for a row filed against a pulled club whose schedules never list the game, on
 *       scores that agree
 *  13 — that settle left alone for a row the named club answers with a row of its own claimed
 *       elsewhere, held back only for a row of the club's the collapse could still join, and no
 *       longer refused a copy that holds the club's schedule on record with no row kept; a row
 *       typed two levels from a club that nothing of its own plays at taken off it; a stand-in
 *       filed twice under a class-year or rare name made one; and two halves whose results
 *       mirror within the hour joined across any border
 *  14 — across regions, a row with no result on either side neither settled nor claimed into a
 *       copy on the clock alone
 *  15 — a row standing as a game and folded into another, or folded into two, kept in one
 *  16 — a copy moved to the club whose own schedule has it at its very start, the result mirrored,
 *       against a slot, any stand-in, or a club of the puller's name, a namesake or a name that
 *       fits in one region; never onto the puller
 *  17 — a row against a slot or a stand-in whose name fits, with the very same result, claimed at
 *       any clock into a copy holding the club on record, and from the day either side into a
 *       copy that does not
 *  18 — a stand-in merged into any earlier entry of its name it shares a naming state with, not
 *       the first alone; and a row filed by name onto a pulled club regions away, which nothing of
 *       that club's own backs, taken off it
 *  19 — a copy a row of its own day could be and went into none of left to no row a day off; and
 *       a row that named its opponent by the club's picture never moved off it on a name
 *  20 — a row filed by name onto a pulled club whose own schedules have no game that day taken
 *       off it, and a name no longer filing a row onto such a club, at arrival or in the refile
 *  21 — a stand-in filed onto the one pulled club a name no other club carries can mean, in the
 *       namer's state or next door, though its own schedules have no game that day, and such a
 *       row left on it
 *  22 — deleting the pulled clubs every one of whose GameChanger names says the page is no team, a
 *       practice, a test or an old page marked do not use, an old page's games another club's own
 *       schedule lists kept on a slot; and softball, fastpitch, slowpitch and kickball read as not
 *       baseball
 *  23 — joining a game one club filed against a stand-in of the other's very name and the other
 *       against a stand-in or a slot, mirrored within the hour and the only match each way
 *  24 — a name that is only "Team", with nothing more than a number, a letter or an age, read as
 *       a page that is no team: such a pulled club deleted where the pool calls it so too, and
 *       such a stand-in's games kept on slots of their own
 *  25 — a lone capital V, one nothing joins to a word, read as varsity, the owner's ruling of 18
 *       October 2026, and "J.V." as JV, so such a club deleted as a high school squad; and the
 *       school pass reading a pulled club by the names GameChanger gives it and keeping a stand-in
 *       a row named at an age under fourteen off an age label, so it deletes no club the import
 *       files
 *  26 — a copy holding its club's own row of the game as a claim left on that club unless a
 *       namesake's own row stands against the puller itself, so two namesakes stop taking turns
 *  27 — a pulled club GameChanger gave no state given the one its club's other teams are in
 *  28 — the namesake join reading a stand-in sharing no word with the namer's name as the namer
 *       where the two clubs are neighbours and nothing else about the game says otherwise
 *  29 — a third GameChanger team's copy of a game both clubs' own schedules hold set not to count
 *  30 — such a copy read out to three hours from the game where nothing fits within the hour, the
 *       owner's choice of 21 October 2026
 *  31 — such a copy past the hour left counting where its own club's schedule has a game of its
 *       own at the hour of the game it fits
 */
const TIDY_RULES_VERSION = 31;

/**
 * A cheap fingerprint of a pool: enough to tell "this is the pool the tidy last saw" from "this
 * is not", without hashing forty thousand rows. Counts and the newest GameChanger fetch cover a
 * pull, a restore and a reset; a hand edit that keeps every count the same and lands on an
 * already-tidied pool has nothing for the tidy to do anyway.
 */
/**
 * When the newest GameChanger schedule in the pool was fetched, or null for a pool nobody has
 * pulled into. What "these rankings are from data pulled nine days ago" reads.
 */
export const latestImportedAt = (teams: readonly ScoutTeam[]): string | null => {
  let latest = "";
  teams.forEach((team) => {
    team.gcTeams?.forEach((link) => {
      if (link.importedAt && link.importedAt > latest) latest = link.importedAt;
    });
  });
  return latest || null;
};

/**
 * The fingerprint from its parts, for a caller that knows how many games there are without
 * holding them: the games are stored a year at a time and counted off the store, so deciding
 * whether the tidy has seen this pool need not decode two hundred thousand of them to find out.
 */
export const poolSignatureOf = (
  counts: { ageGroups: number; teams: number; games: number },
  latestImport: string | null
): string =>
  `r${TIDY_RULES_VERSION}|${counts.ageGroups}|${counts.teams}|${counts.games}|${latestImport ?? ""}`;

/**
 * Whether a stored stamp was written by tidy rules newer than this build's. Such a pool is left
 * alone: this build's older rules would undo some of what the newer ones did, and with the cloud
 * copy carrying the pool between devices, a device on each build would take the other's pool and
 * tidy it back, every time either opened, each time re-sending the whole pool.
 */
export const stampFromNewerRules = (stamp: string | null): boolean => {
  const rules = /^r(\d+)\|/.exec(stamp ?? "");
  return rules !== null && Number(rules[1]) > TIDY_RULES_VERSION;
};

export const poolSignature = (state: GcImportState): string =>
  poolSignatureOf(
    { ageGroups: state.ageGroups.length, teams: state.teams.length, games: state.games.length },
    latestImportedAt(state.teams)
  );

/** One line per thing the tidy did; nothing for a pass that found nothing. */
export const describeTidy = (tidy: PoolTidy): string[] => {
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  return [
    ...(tidy.pruned > 0
      ? [
          `${plural(tidy.pruned, "game", "games")} dated before the season began (August 1), left out.`,
        ]
      : []),
    ...(tidy.withdrawn > 0
      ? [
          `${plural(tidy.withdrawn, "game", "games")} its club's schedule no longer lists, taken out, and the other club's copy placed again.`,
        ]
      : []),
    ...(tidy.named > 0
      ? [
          `${plural(tidy.named, "placeholder", "placeholders")} named from the other team's schedule.`,
        ]
      : []),
    ...(tidy.joined > 0
      ? [
          `${plural(tidy.joined, "game", "games")} both clubs had filed against a stand-in for the other, now one game between them.`,
        ]
      : []),
    ...(tidy.namesakeJoined > 0
      ? [
          `${plural(tidy.namesakeJoined, "game", "games")} one club filed under the other's very name and the other against a stand-in, now one game between them, or put back apart.`,
        ]
      : []),
    ...(tidy.reclaimed > 0
      ? [
          `${plural(tidy.reclaimed, "game", "games")} moved to the club of that name whose own schedule holds it.`,
        ]
      : []),
    ...(tidy.resettled > 0
      ? [
          `${plural(tidy.resettled, "game", "games")} taken off a club that plays nowhere near that age, or nowhere near the club that filed it.`,
        ]
      : []),
    ...(tidy.refiled > 0
      ? [
          `${plural(tidy.refiled, "game", "games")} filed onto the one club of that name in the same state.`,
        ]
      : []),
    ...(tidy.merged > 0
      ? [`${plural(tidy.merged, "opponent", "opponents")} entered twice under one name, made one.`]
      : []),
    ...(tidy.claimed > 0
      ? [
          `${plural(tidy.claimed, "game", "games")} filed under a name matched to the other club's own copy, or put back where that copy no longer fits.`,
        ]
      : []),
    ...(tidy.releveled > 0
      ? [
          `${plural(tidy.releveled, "age level", "age levels")} worked out from a name that said one all along.`,
        ]
      : []),
    ...(tidy.stateFilled > 0
      ? [
          `${plural(tidy.stateFilled, "club's state", "clubs' states")} filled in from the same club's other teams.`,
        ]
      : []),
    ...(tidy.countedElsewhere > 0
      ? [
          `${plural(tidy.countedElsewhere, "copy", "copies")} of a game both clubs' own schedules already hold set not to count, or counted again once they stop holding it.`,
        ]
      : []),
    ...(tidy.notBaseball > 0
      ? [
          `${plural(tidy.notBaseball, "wiffle ball, blitzball or softball team", "wiffle ball, blitzball or softball teams")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.highSchool > 0
      ? [
          `${plural(tidy.highSchool, "high school squad", "high school squads")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.notATeam > 0
      ? [
          `${plural(tidy.notATeam, "practice, test, old or unnamed team page", "practice, test, old or unnamed team pages")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.idle > 0
      ? [
          `${plural(tidy.idle, "opponent", "opponents")} no game names any more, taken off the list.`,
        ]
      : []),
    ...(tidy.folded > 0
      ? [
          `${plural(tidy.folded, "team", "teams")} folded into a club already here under another GameChanger id.`,
        ]
      : []),
    ...(tidy.paired > 0
      ? [
          `${plural(tidy.paired, "squad", "squads")} paired on into the next season — same name, same town, same state.`,
        ]
      : []),
    ...(tidy.collapsed > 0
      ? [`${plural(tidy.collapsed, "game", "games")} that had been written down twice, now once.`]
      : []),
    ...(tidy.regrouped > 0
      ? [
          `${plural(tidy.regrouped, "game", "games")} whose copies from the other club's schedule were matched again.`,
        ]
      : []),
  ];
};
