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
  formatGcSeason,
  gcSeasonIsCurrent,
  isNotBaseball,
  isAdultAgeLabel,
  isSchoolAgeLabel,
  isSchoolName,
  type GcGame,
  type GcTeamProfile,
  type GcTeamSchedule,
} from "./gameChangerApi";
import {
  ageGroupLevel,
  ageGroupYear,
  createAgeGroupId,
  isPlaceholderName,
  MIN_AGE_LEVEL,
  buildScoutTeam,
  cleanTeamName,
  formatAgeGroupName,
  gcSeasonLabel,
  isRankedAgeLevel,
  collapseSameGames,
  inSquadYear,
  matchExistingGame,
  MAX_AGE_LEVEL,
  nameFitter,
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
  ownPageFor,
  type FoldedRow,
  scoreSeenBy,
  mayTakeRow,
  gcRowId,
  startMinuteOf,
  squadNameKey,
  normalizeState,
  squadYearForGcSeason,
  standUpWithdrawn,
  teamNameKey,
  type AgeGroup,
  type GcTeamLink,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { buildStaffIndex, likelySameSquad, sharedStaff } from "./gcStaff";
import { isKeptApart, type KeptApart } from "./keptApart";
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
import { borderingStates, inOneRegion } from "./stateBorders";
import { namedAgeFor, type NamedAges } from "./namedAges";

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
  /** Pool key of an age group: its season year, or the group itself when it has none. */
  poolKeyOf: (ageGroupId: string) => string;
  /** Age level of an age group: the level half of a name match, and a side's fallback level. */
  levelOf: (ageGroupId: string) => number | undefined;
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
  const index: ImportIndex = {
    poolKeys,
    levels,
    poolKeyOf: (ageGroupId: string) => poolKeys.get(ageGroupId) ?? `g:${ageGroupId}`,
    levelOf: (ageGroupId: string) => levels.get(ageGroupId),
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

  if (level === undefined) return;
  const seen = index.levelsByTeam.get(teamId);
  if (seen) seen.add(level);
  else index.levelsByTeam.set(teamId, new Set([level]));
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

/** The things that are not coincidences when two GameChanger teams are the same club. */
export type GcPairingEvidence =
  /** The same badge. GameChanger keeps a club's picture across seasons; nobody else has it. */
  | "avatar"
  /**
   * Two or more coaches in common, neither of them an organisation's officer.
   *
   * The strongest thing in the data, and `gcStaff.ts` has the measurements: over an export of
   * 52,470 teams, two teams sharing two staff names are in the same town 89.0% of the time, where
   * sharing one is 43.1% — barely better than picking a team at random from the same part of the
   * country. It is the only field that says anything about an organisation, because GameChanger
   * never names one.
   */
  | "staff"
  /** Both give the same town. */
  | "city"
  /** Both give the same state. */
  | "state"
  /** They played a club in common. */
  | "shared-opponent"
  /**
   * One of the two has no schedule of its own: every game filed against it came off somebody
   * else's. That is what an abandoned duplicate looks like and what a club's second squad at one
   * age does not — a real B team has its own schedule, an id somebody created and never used has
   * none. It is the whole of what separates the two in a single season.
   */
  | "no-schedule";

/** What the panel calls each piece of evidence. */
export const GC_PAIRING_EVIDENCE_LABEL: Record<GcPairingEvidence, string> = {
  avatar: "same picture",
  staff: "the same coaches",
  city: "same town",
  state: "same state",
  "shared-opponent": "a club in common",
  "no-schedule": "one has no schedule of its own",
};

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
const seasonStep = (from: GcTeamLink, to: GcTeamLink): "same-year" | "ages-up" | null => {
  const fromIndex = SEASON_ORDER.indexOf((from.season ?? "") as (typeof SEASON_ORDER)[number]);
  const toIndex = SEASON_ORDER.indexOf((to.season ?? "") as (typeof SEASON_ORDER)[number]);
  if (fromIndex < 0 || toIndex < 0) return null;
  const fromYear = squadYearForGcSeason(from.season, from.seasonYear ?? 0);
  const toYear = squadYearForGcSeason(to.season, to.seasonYear ?? 0);
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
 * club across schedules and is what `resolveOpponent` already trusts. That is the whole reason
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
  const pool = `y:${squadYearForGcSeason(profile.season.season, profile.season.year)}`;
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
  state: GcImportState
): { ageGroups: AgeGroup[]; group: AgeGroup; created: boolean } | null => {
  // A different game entirely. Checked before the age, because a wiffle team filed under 12U has
  // a perfectly good age level and that is exactly what makes it invisible.
  if (isNotBaseball(profile.name)) return null;
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
  const year = squadYearForGcSeason(profile.season.season, profile.season.year);

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
  /** A wiffle ball or blitzball team. A different game, so its results belong to no baseball ranking. */
  | "not-baseball"
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

const skipReason = (profile: GcTeamProfile): { code: GcSkipReason; message: string } => {
  if (isNotBaseball(profile.name)) {
    return {
      code: "not-baseball",
      message:
        "This is a wiffle ball or blitzball team, which is a different game, so it was left out.",
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
const linkFor = (schedule: GcTeamSchedule, ageGroupId: string): GcTeamLink => {
  const { profile, fetchedAt, listed } = schedule;
  return {
    teamId: profile.id,
    name: profile.name,
    ageGroupId,
    ...(profile.season ? { season: profile.season.season, seasonYear: profile.season.year } : {}),
    ...(profileAgeLevel(profile) === undefined ? {} : { ageLevel: profileAgeLevel(profile) }),
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
  index: ImportIndex
): { teamId: string; created: boolean } => {
  const { profile } = schedule;
  const link = linkFor(schedule, ageGroupId);
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
  game: GcGame
): boolean => {
  if (!game.date) return false;
  const sameDay = index.gamesByTeamDate.get(`${candidateId}\u0000${game.date}`) ?? [];
  return sameDay.some((existing) => {
    const other = existing.teamAId === candidateId ? existing.teamBId : existing.teamAId;
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
 * Of the clubs of this name, the one whose schedule holds this game. Exactly one, or the schedules
 * cannot tell them apart either and the question is left to whatever comes after.
 */
const clubHoldingThisGame = (
  index: ImportIndex,
  ownTeamId: string,
  candidates: readonly string[],
  game: GcGame
): string | undefined => {
  const holders = candidates.filter((id) => holdsThisGame(index, ownTeamId, id, game));
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
 */
const opponentFromSameFixture = (
  index: ImportIndex,
  ownTeamId: string,
  ageGroupId: string,
  game: GcGame,
  sourceTeamId: string
): string | undefined => {
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
    // Either the result matches, or the day and the start time pin it on their own.
    const timeAgrees = sameStart(game.startTs, existing.startTs);
    return scoresAgree || timeAgrees;
  });

  if (candidates.length !== 1) return undefined;
  const found = candidates[0]!;
  const other = found.teamAId === ownTeamId ? found.teamBId : found.teamAId;
  // A slot answers for nobody; naming this game after one would put two games on one placeholder.
  return index.teamsById.get(other)?.placeholder ? undefined : other;
};

/**
 * The team an opponent name refers to. The avatar first, because it is the only identifier
 * GameChanger gives that means the same thing on two different schedules. Failing that, a name —
 * but only among teams already on this page, since a name on its own says nothing across levels or
 * seasons. Failing that, a new team, which is the honest answer for a club nobody has pulled.
 */
const resolveOpponent = (
  game: GcGame,
  ageGroupId: string,
  teams: ScoutTeam[],
  index: ImportIndex,
  ownTeamId: string,
  sourceTeamId: string
): OpponentMatch => {
  // The picture is a direct identifier, so it is asked first when the game carries one.
  if (game.opponentAvatarKey) {
    const byAvatar = index.teamsByAvatar.get(game.opponentAvatarKey) ?? [];
    // Exactly one, or the picture is shared and says nothing about which team this is.
    if (byAvatar.length === 1 && byAvatar[0]) {
      return { teamId: byAvatar[0].id, basis: "avatar" };
    }
  }

  /*
   * Then the game itself, which beats the name even when the name is a real one — and is the only
   * thing that can answer a name that identifies nobody, so it comes before the slot below.
   */
  const fromFixture = opponentFromSameFixture(index, ownTeamId, ageGroupId, game, sourceTeamId);
  if (fromFixture) return { teamId: fromFixture, basis: "avatar" };

  /**
   * "TBD", "Winner of Game 3", a blank cell on a bracket: a name that stands in for a team nobody
   * had decided yet. Matching one to anything is the mistake — a single shared "TBD" would collect
   * games from dozens of unrelated schedules and then sit in the rating graph as an opponent all
   * of them had played, which the fit would read as evidence about how they compare. Each gets a
   * slot of its own, marked as one, and the game is filed exactly as any other so it still counts
   * for the team that played it.
   */
  const key = teamNameKey(game.opponentName);
  const theirLevel = ageLevelFromName(game.opponentName) ?? index.levelOf(ageGroupId);
  const sameName =
    index.teamIdsByGroupName.get(nameSlotKey(index.poolKeyOf(ageGroupId), key, theirLevel)) ?? [];

  if (isPlaceholderName(game.opponentName)) {
    /*
     * ...unless a club somebody pulled by id is called this. A schedule that writes the weekend in
     * the opponent column — "USSSA Cactus Classic" — names nobody, but a club really can call its
     * travel squad "Miami Bulldogs Tournament", and 74 of them do in a nationwide pool. An id is
     * an identity and a reading of a name is not, so where exactly one club of this name at this
     * level was pulled, the mention is that club rather than a slot.
     */
    const pulled = sameName.filter((id) => index.teamsById.get(id)?.gcTeams?.length);
    if (pulled.length === 1 && pulled[0]) return { teamId: pulled[0], basis: "name" };
    const slot = buildScoutTeam(game.opponentName, index.usedTeamIds, { placeholder: true });
    addTeam(index, teams, slot);
    return { teamId: slot.id, basis: "created" };
  }

  /*
   * Of the clubs of this name, the one whose own schedule holds this game. This is the question
   * worth asking and it beats every other test, because it is about this fixture rather than
   * about the name: it tells a club apart from its namesakes however many of them there are.
   */
  const anyLevel =
    index.teamIdsByPoolName.get(`${index.poolKeyOf(ageGroupId)}\u0000${key}`) ?? sameName;
  const holder = clubHoldingThisGame(index, ownTeamId, anyLevel, game);
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
    if (sameState || corroborates(index, ownTeamId, only, game)) {
      return { teamId: only, basis: "name" };
    }
  }

  // Several of that name: the one something beyond the name agrees with.
  const corroborated = sameName.filter((id) => corroborates(index, ownTeamId, id, game));
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

  const created = buildScoutTeam(game.opponentName, index.usedTeamIds, { nameOnly: true });
  addTeam(index, teams, created);
  return { teamId: created.id, basis: "created" };
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
  return (
    scoreChanged ||
    existing.season !== candidate.season ||
    existing.ageLevelA !== candidate.ageLevelA ||
    existing.ageLevelB !== candidate.ageLevelB
  );
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

const importOne = (
  original: GcTeamSchedule,
  state: GcImportState,
  index: ImportIndex,
  options: GcImportOptions
): { state: GcImportState; outcome: GcImportOutcome } => {
  const deleted = options.deleted ?? NOTHING_DELETED;
  const droppedClubs = options.droppedClubs ?? NO_CLUBS;
  const tooYoung = options.tooYoung ?? NO_CLUBS;
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
  const seasonYear = profile.season
    ? squadYearForGcSeason(profile.season.season, profile.season.year)
    : undefined;
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

  const resolved = resolveAgeGroup(profile, state);
  if (!resolved) {
    const why = skipReason(profile);
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
  const own = resolveOwnTeam(schedule, group.id, teams, index);
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
  /** Every row this schedule lists now, by id, so a game whose own row it dropped can be told. */
  const listed = new Map(
    schedule.games.filter(isFilable).map((game) => [gcGameId(profile.id, game.id), game])
  );
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

    let opponentId = knownOpponentId;
    if (opponentId === undefined) {
      const opponent = resolveOpponent(game, group.id, teams, index, own.teamId, profile.id);
      opponentId = opponent.teamId;
      if (opponent.basis === "created") outcome.opponentsCreated += 1;
      else if (opponent.basis === "avatar") outcome.opponentsMatchedByAvatar += 1;
      else outcome.opponentsMatchedByName += 1;
    }

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
    /*
     * A row the user has thrown out stays thrown out. Deleting one without this is deleting it
     * until the next pull of the same schedule, which finds it and files it again — and the rows
     * worth deleting are the ones a schedule keeps on offering: a score on a day that has not
     * happened, which cannot be a result and which GameChanger will go on reporting.
     */
    if (isDeletedGame(deleted, gcGameId(profile.id, game.id))) {
      outcome.gamesUnchanged += 1;
      continue;
    }
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
      const updated = withSchedulesOf(
        folded,
        record &&
          record.date === undefined &&
          record.filedAgainst === undefined &&
          folded.date !== undefined
          ? { ...candidate, date: folded.date }
          : candidate
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
    const recorded = existing === known ? existing : withSchedulesOf(existing, candidate);
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
    const merged: ScoutGame = {
      ...(ownAtLast ? unborrowed : recorded),
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
   * A game standing on a row this schedule no longer lists — deleted, cancelled, moved off the day
   * — is marked for the tidy to take away, and one standing on a row listed again is unmarked
   * (`ScoutGame.withdrawn`). Not a game holding another row of this schedule's that it still lists:
   * that is the game entered again, which its next pull stands on the new row under the old id (the
   * folded row above). Nor a game that holds another club's copy only as a schedule on record
   * (`alsoFrom`, from before rows were kept): with no row to stand up, that club's copy would go
   * with it until its own next pull.
   */
  if (trusted) {
    const stillListed = (teamId: string, gameId: string) =>
      teamId === profile.id &&
      (listed.has(gcGameId(teamId, gameId)) || unread(gcGameId(teamId, gameId)));
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
  state: GcImportState
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
 * other club, that day or the day either side, that no row of theirs is paired with yet is the
 * collapse's to pair first; a row the club it names answers for, by a copy of its own that fits, is
 * that club's; a team the other club's own schedule plays is not that club — a pulled one only
 * where the result is not the same — nor is an age typed into its name more than `PLAYS_UP_TO`
 * from the one that club played at; and rows naming one team on one day go to one club or none.
 */
export const claimFiledRows = (input: GcImportState): { state: GcImportState; claimed: number } => {
  const orphans = releaseOrphanedClaims(input);
  const state = orphans.state;
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
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
  /** The same, less the rows the game holds as claims: what this club lists of it for itself. */
  const ownsRowIn = (game: ScoutGame, clubId: string): boolean => {
    if (mine(game.source?.teamId, clubId)) return true;
    const records = game.alsoRows ?? [];
    if (records.some((record) => mine(record.teamId, clubId) && !record.filedAgainst)) return true;
    const recorded = new Set(records.map((record) => record.teamId));
    return (game.alsoFrom ?? []).some(
      (schedule) => mine(schedule, clubId) && !recorded.has(schedule)
    );
  };
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
      // game of its own, counted, which the user had said not to count.
      if (game.excluded || !teamById.has(record.filedAgainst)) return;
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
    if (isStandIn(against) || (isClub(against) && !listedBy(game, against))) {
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

  filedByDay.forEach((filed, key) => {
    const { club, row: firstRow } = filed[0]!;
    const date = firstRow.date!;
    const otherOf = (game: ScoutGame) => (game.teamAId === club ? game.teamBId : game.teamAId);
    // Another club's own copy of a game against this club, none of this club's own rows in it but
    // claims. Most days have none, and there is nothing to read.
    const offered = (byTeamDay.get(key) ?? []).filter(
      (game) => !game.excluded && mine(game.source?.teamId, otherOf(game)) && !ownsRowIn(game, club)
    );
    if (offered.length === 0 && filed.every((entry) => !entry.holder)) return;
    /*
     * A club with a row of its own against that club, that day or the day either side, that no row
     * of theirs is paired with waits: which of its copies that row is, the collapse says.
     */
    const waiting = new Set<string>();
    [-1, 0, 1].forEach((days) => {
      const day = days === 0 ? date : isoDayFrom(date, days);
      if (day === undefined) return;
      (byTeamDay.get(dayKey(club, day)) ?? []).forEach((game) => {
        const otherId = otherOf(game);
        if (ownsRowIn(game, club) && !listedBy(game, otherId)) waiting.add(otherId);
      });
    });
    const copies = offered.filter((game) => !waiting.has(otherOf(game)));

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
    /** A row the club it names answers for, by a copy of its own that fits, is that club's. */
    const answered = (entry: Filed) =>
      isClub(entry.against) &&
      (byTeamDay.get(key) ?? []).some(
        (game) =>
          otherOf(game) === entry.against &&
          mine(game.source?.teamId, entry.against) &&
          strength({ ...entry, against: `${entry.against}\u0000` }, game) > 0
      );
    const rows = filed.filter((entry) => !answered(entry));

    type Link = { row: number; copy: number; strength: number };
    const links: Link[] = rows.flatMap((entry, r) =>
      copies.flatMap((copy, c) => {
        const found = strength(entry, copy);
        return found > 0 ? [{ row: r, copy: c, strength: found }] : [];
      })
    );
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
   * start time.
   */
  const halves: Half[] = [];
  const byResult = new Map<string, Half[]>();
  const byTime = new Map<string, Half[]>();
  const resultKey = (half: Half, mine: number | undefined, theirs: number | undefined) =>
    `${half.pool}\u0000${half.game.date}\u0000${mine}-${theirs}`;
  const timeKey = (half: Half) =>
    `${half.pool}\u0000${half.game.date}\u0000${startMinuteOf(half.game.startTs)}`;
  state.games.forEach((game) => {
    const half = halfOf(game);
    if (!half) return;
    halves.push(half);
    if (scored(half)) push(byResult, resultKey(half, half.clubScore, half.standInScore), half);
    if (startMinuteOf(half.game.startTs) !== undefined) push(byTime, timeKey(half), half);
  });
  if (halves.length < 2) return { state, joined: 0 };

  const sameTime = (x: Half, y: Half) => sameStart(x.game.startTs, y.game.startTs);
  const levelsAgree = (named: number | undefined, own: number | undefined) =>
    named === undefined || own === undefined || Math.abs(named - own) <= PLAYS_UP_TO;
  /** Whether `y` is, on everything but uniqueness, the other end of `x`'s game. */
  const couldBeOtherEnd = (x: Half, y: Half): boolean =>
    y.club.id !== x.club.id &&
    y.standIn.id !== x.standIn.id &&
    inOneRegion(x.club.state, y.club.state) &&
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
      (byResult.get(resultKey(x, x.standInScore, x.clubScore)) ?? []).forEach((y) => found.add(y));
      if (x.game.startTs) {
        (byTime.get(timeKey(x)) ?? []).forEach((y) => {
          if (!scored(y)) found.add(y);
        });
      }
    } else if (x.game.startTs) {
      (byTime.get(timeKey(x)) ?? []).forEach((y) => found.add(y));
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
    const disputed = (byTime.get(timeKey(x)) ?? []).filter((y) => couldBeOtherEnd(x, y));
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
  apart: KeptApart = new Set<string>()
): GcSeasonPairing[] => {
  const linked = teams.flatMap((team) => (team.gcTeams ?? []).map((link) => ({ team, link })));
  if (linked.length === 0) return [];

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
      const carriesOn = sameSeason ? null : seasonStep(from.link, to.link);
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
  const settled = proposeSeasonPairings(state.teams, state.games, apart).filter(isSettledPairing);
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
    if (teamAId === teamBId) return [];
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
  const failed = outcomes.length - filed.length - otherSeason;
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
      if (!merged.state && from.state) merged = { ...merged, state: from.state };
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
    // Both sides of the game turned out to be the same club: it was never two teams playing.
    if (teamAId === teamBId) return;
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
 * (`FoldedRow.filedAgainst`), did not file this game against that club, and does not count.
 */
const filedInto = (game: ScoutGame, schedules: ReadonlySet<string> | undefined): boolean =>
  (game.alsoFrom ?? []).some((id) => {
    if (!schedules?.has(id)) return false;
    const records = (game.alsoRows ?? []).filter((record) => record.teamId === id);
    return records.length === 0 || records.some((record) => record.filedAgainst === undefined);
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
  const holds = (clubId: string, pullerId: string, row: ScoutGame): boolean => {
    // The side of `row` that is not the puller: what the club being asked about would stand in.
    const rowClub = score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId);
    const rowPuller = score(row, pullerId);
    const puller = teamById.get(pullerId);
    return (ownByDay.get(`${clubId}\u0000${row.date}`) ?? []).some((own) => {
      const other = own.teamAId === clubId ? own.teamBId : own.teamAId;
      const ownClub = score(own, clubId);
      const ownPuller = score(own, other);
      if (other === pullerId) {
        if (ownClub === undefined || ownPuller === undefined) return true;
        if (rowClub === undefined || rowPuller === undefined) return true;
        return ownClub === rowClub && ownPuller === rowPuller;
      }
      const stand = teamById.get(other);
      if (!puller || !stand?.nameOnly || !fits(stand.name, puller.name)) return false;
      if (!inOneRegion(puller.state, teamById.get(clubId)?.state)) return false;
      // One start time is one game, whatever the two coaches scored it; at another time only a
      // mirrored result says so.
      if (sameStart(own.startTs, row.startTs)) return true;
      const scored = [ownClub, ownPuller, rowClub, rowPuller].every((value) => value !== undefined);
      return scored && ownClub === rowClub && ownPuller === rowPuller;
    });
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
    // Attached by name only: the club it sits on did not file it, and its own schedule does not
    // hold a row that could be it. A row a join or a slot fold made one of two keeps the other
    // club's schedule in `alsoFrom`, and that club filed it as surely as the puller did: reading
    // `source` alone moved a joined Stix–Hurricanes game onto another Ohio "Hurricanes" in the
    // very tidy that joined it.
    const alsoFiled = filedInto(game, ownIds.get(namedId));
    if (isOwnRow(game, namedId) || alsoFiled || holds(namedId, pullerId, game)) return game;
    const pool = poolKeyOf(game.ageGroupId);
    const level =
      (namedId === game.teamAId ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    const holders = (namesakes.get(teamNameKey(named.name)) ?? []).filter((clubId) => {
      if (clubId === namedId) return false;
      const club = teamById.get(clubId);
      const inPool = club?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool);
      /*
       * Only a namesake at a level the row could be played at — the test `resettleOffLevel` holds
       * a row to. Without it a "Hurricanes 12U" with a mirrored result against a "Stix" that day
       * took the 9U Stix's game, the next step handed it back for being three levels off, and
       * the two did it again every pass until the tidy gave up at its limit.
       */
      return (
        Boolean(inPool) && levelFits(levels.get(clubId), level) && holds(clubId, pullerId, game)
      );
    });
    if (holders.length !== 1) return game;
    reclaimed += 1;
    const holder = holders[0]!;
    return game.teamAId === namedId ? { ...game, teamAId: holder } : { ...game, teamBId: holder };
  });
  return reclaimed === 0 ? { state, reclaimed: 0 } : { state: { ...state, games }, reclaimed };
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
 */
export const resettleOffLevel = (
  state: GcImportState
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

  const used = new Set(state.teams.map((team) => team.id));
  const added: ScoutTeam[] = [];
  /**
   * One stand-in per name, level and squad year, rather than one per row. A club named on three
   * schedules is one club, and three stand-ins for it would be three unknowns in the fit where
   * there is one; a single stand-in across every level and year would be the opposite mistake,
   * the knot that ties unrelated clubs together, which is why the level and the year are in the
   * key.
   */
  const stand = new Map<string, string>();
  const standInFor = (name: string, slot: string): string => {
    const already = stand.get(slot);
    if (already !== undefined) return already;
    const team = buildScoutTeam(name, used, { nameOnly: true });
    used.add(team.id);
    added.push(team);
    stand.set(slot, team.id);
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
    // A game the named club's own schedule gave a row too, folded in or settled into it, is on that
    // club's schedule by its own word, as `reclaimMisfiled` reads it. Moved off, the club's own row
    // went with it into a game the club was not in, and the club's next pull filed that row again.
    if (filedInto(game, ownIds.get(namedId))) return game;
    const level =
      (namedId === game.teamAId ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    if (levelFits(levels.get(namedId), level)) return game;

    const pool = poolKeyOf(game.ageGroupId);
    const key = teamNameKey(named.name);
    const homes = (namesakes.get(key) ?? []).filter((clubId) => {
      if (clubId === namedId || clubId === game.teamAId || clubId === game.teamBId) return false;
      const club = teamById.get(clubId);
      const inPool = club?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool);
      return Boolean(inPool) && levelFits(levels.get(clubId), level);
    });
    const to =
      homes.length === 1
        ? homes[0]!
        : standInFor(named.name, `${pool}\u0000${level ?? "?"}\u0000${key}`);
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
 * any there, across a border.
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
export const refileStandIns = (state: GcImportState): { state: GcImportState; refiled: number } => {
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

  let refiled = 0;
  const games = state.games.map((game) => {
    const a = teamById.get(game.teamAId);
    const b = teamById.get(game.teamBId);
    const standIn = a?.nameOnly ? a : b?.nameOnly ? b : undefined;
    const puller = standIn === a ? b : a;
    if (!standIn || !puller?.gcTeams?.length || !puller.state) return game;
    const level = (standIn === a ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    const slot = `${poolKeyOf(game.ageGroupId)}\u0000${teamNameKey(standIn.name)}\u0000${level}`;
    const namesakes = clubs.get(slot) ?? [];
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
    refiled += 1;
    const club = chosen[0]!;
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
  /** Rows taken off a club that plays nowhere near the age they were played at. */
  resettled: number;
  /** Stand-in rows filed onto the one club of that name in the puller's state, or next door. */
  refiled: number;
  /**
   * Rows a club's own schedule filed by name that another club's own copy of the game claimed, or
   * that went back to the team they named when the schedules stopped bearing a claim out.
   */
  claimed: number;
  /** Levels read out of a name that had one all along, under rules that came later. */
  releveled: number;
  /** Teams deleted for playing a different game — wiffle ball or blitzball — along with their results. */
  notBaseball: number;
  /** Teams deleted for playing a high school season, along with their results. */
  highSchool: number;
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
 * The name only, not the age field: what is in the pool is a `ScoutTeam`, and GameChanger's own
 * age label is not kept on one — the level is. A squad whose name said nothing and whose age
 * field said "Varsity" was never filed in the first place, because the import refuses it on the
 * way in, so there is nothing here for this pass to find.
 */
const dropSchoolTeams = (state: GcImportState): { state: GcImportState; dropped: number } =>
  without(state, new Set(state.teams.filter((team) => isSchoolName(team.name)).map((t) => t.id)));

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
 * The nine things a tidy pass does, in the order it does them. The order is load-bearing and the
 * comments below say why; this is the same list, named, so a watcher can be told where it is.
 */
export const TIDY_STEPS = [
  "notBaseball",
  "highSchool",
  "releveled",
  "pruned",
  "withdrawn",
  "named",
  "joined",
  "reclaimed",
  "resettled",
  "refiled",
  "claimed",
  "folded",
  "paired",
  "collapsed",
  "regrouped",
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
  TIDY_STEPS.some((step) => tidy[step] > 0);

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
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const real = (game: ScoutGame) =>
    [game.teamAId, game.teamBId].every((id) => {
      const team = teamById.get(id);
      return team !== undefined && !team.placeholder && !team.nameOnly;
    });
  const rank = (game: ScoutGame) =>
    (real(game) ? 2 : 0) + ((game.alsoRows?.length ?? 0) > 0 ? 1 : 0);
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

const tidyOnce = (
  state: GcImportState,
  pass: number,
  watch?: TidyWatcher,
  apart?: KeptApart
): Omit<PoolTidy, "passes"> => {
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
  // Then levels, because every pass after it compares them: a side whose level is about to be
  // worked out should be worked out before anything decides whether two rows mean one game.
  starting("releveled", school.state);
  const levels = relevelFromNames(school.state);
  finished("releveled", levels.releveled, levels.state);
  starting("pruned", levels.state);
  const season = pruneOutOfSeason(levels.state);
  finished("pruned", season.pruned, season.state);
  // Before anything settles a stand-in into it or folds a row into it: the game is going.
  starting("withdrawn", season.state);
  const gone = standUpWithdrawn(season.state.games, season.state.ageGroups);
  const standing =
    gone.games !== season.state.games ? { ...season.state, games: gone.games } : season.state;
  finished("withdrawn", gone.withdrawn, standing);
  const unique = withoutRepeatedIds(standing);
  starting("named", unique.state);
  const named = resolveSlotGames(unique.state);
  finished("named", named.resolved, named.state);
  // Straight after the slots, and for the same reason: two stand-ins joined here are a pair of
  // clubs the passes after it can compare.
  starting("joined", named.state);
  const halves = joinCrossedHalves(named.state);
  finished("joined", halves.joined, halves.state);
  starting("reclaimed", halves.state);
  const moved = reclaimMisfiled(halves.state);
  finished("reclaimed", moved.reclaimed, moved.state);
  // After the fixture, which is better evidence than a level, and before the refile, which then
  // gets a look at whatever this had to leave as a stand-in.
  starting("resettled", moved.state);
  const graded = resettleOffLevel(moved.state);
  finished("resettled", graded.resettled, graded.state);
  starting("refiled", graded.state);
  const placed = refileStandIns(graded.state);
  finished("refiled", placed.refiled, placed.state);
  // After every step that settles who a row was played against by its name, so a claim is read
  // against what they left — a pair of halves joined, a row reclaimed by its namesake — and before
  // the collapse, which then regroups each claimed row with the copy it went into.
  starting("claimed", placed.state);
  const claims = claimFiledRows(placed.state);
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
  return {
    state: after,
    named: named.resolved,
    joined: halves.joined,
    folded: squads.merged,
    paired: seasons.paired,
    collapsed: same.collapsed + unique.dropped,
    regrouped: same.regrouped,
    pruned: season.pruned,
    withdrawn: gone.withdrawn,
    reclaimed: moved.reclaimed,
    resettled: graded.resettled,
    refiled: placed.refiled,
    claimed: claims.claimed,
    releveled: levels.releveled,
    notBaseball: kept.dropped,
    highSchool: school.dropped,
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
  apart?: KeptApart
): PoolTidy => {
  const total: PoolTidy = {
    state,
    named: 0,
    joined: 0,
    folded: 0,
    paired: 0,
    collapsed: 0,
    regrouped: 0,
    pruned: 0,
    withdrawn: 0,
    reclaimed: 0,
    resettled: 0,
    refiled: 0,
    claimed: 0,
    releveled: 0,
    notBaseball: 0,
    highSchool: 0,
    passes: 0,
  };
  for (let pass = 0; pass < TIDY_MAX_PASSES; pass += 1) {
    const step = tidyOnce(total.state, pass + 1, watch, apart);
    total.passes += 1;
    total.state = step.state;
    total.named += step.named;
    total.joined += step.joined;
    total.folded += step.folded;
    total.paired += step.paired;
    total.collapsed += step.collapsed;
    total.regrouped += step.regrouped;
    total.pruned += step.pruned;
    total.withdrawn += step.withdrawn;
    total.reclaimed += step.reclaimed;
    total.resettled += step.resettled;
    total.refiled += step.refiled;
    total.claimed += step.claimed;
    total.releveled += step.releveled;
    total.notBaseball += step.notBaseball;
    total.highSchool += step.highSchool;
    const changed =
      step.named +
      step.joined +
      step.folded +
      step.paired +
      step.collapsed +
      step.regrouped +
      step.pruned +
      step.withdrawn +
      step.reclaimed +
      step.resettled +
      step.refiled +
      step.claimed +
      step.releveled +
      step.notBaseball +
      step.highSchool;
    if (changed === 0) break;
  }
  return total;
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
 */
const TIDY_RULES_VERSION = 12;

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
    ...(tidy.reclaimed > 0
      ? [
          `${plural(tidy.reclaimed, "game", "games")} moved to the club of that name whose own schedule holds it.`,
        ]
      : []),
    ...(tidy.resettled > 0
      ? [
          `${plural(tidy.resettled, "game", "games")} taken off a club that plays nowhere near that age.`,
        ]
      : []),
    ...(tidy.refiled > 0
      ? [
          `${plural(tidy.refiled, "game", "games")} filed onto the one club of that name in the same state.`,
        ]
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
    ...(tidy.notBaseball > 0
      ? [
          `${plural(tidy.notBaseball, "wiffle ball or blitzball team", "wiffle ball or blitzball teams")} deleted, and their results with them.`,
        ]
      : []),
    ...(tidy.highSchool > 0
      ? [
          `${plural(tidy.highSchool, "high school squad", "high school squads")} deleted, and their results with them.`,
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
