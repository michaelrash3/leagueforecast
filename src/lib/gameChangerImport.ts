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
  ageLevelFromName,
  formatGcSeason,
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
  formatAgeGroupName,
  gcSeasonLabel,
  isRankedAgeLevel,
  collapseSameGames,
  inSquadYear,
  matchExistingGame,
  MAX_AGE_LEVEL,
  mergeScoutTeams,
  squadNameKey,
  normalizeState,
  squadYearForGcSeason,
  teamNameKey,
  type AgeGroup,
  type GcTeamLink,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";

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
    opponentsByTeam: new Map(),
    gamesByTeamDate: new Map(),
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
};

/** Records that two teams have met, both ways round. */
const noteOpponent = (index: ImportIndex, teamId: string, opponentId: string) => {
  const met = index.opponentsByTeam.get(teamId);
  if (met) met.add(opponentId);
  else index.opponentsByTeam.set(teamId, new Set([opponentId]));
};

const indexGame = (index: ImportIndex, game: ScoutGame) => {
  index.gamesById.set(game.id, game);
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
  /** Set when the schedule could not be filed at all; the pool is returned untouched. */
  issue?: string;
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
   * What says these are one club, beyond the name. Never empty: a shared name alone is not
   * evidence, because the country is full of clubs that share one.
   */
  evidence: GcPairingEvidence[];
  /** Whether the name matches too, which is corroboration rather than the case on its own. */
  sameName: boolean;
  /** A picture, or a name plus a place they both give, is as strong as this gets. */
  confidence: "strong" | "likely";
};

/** The things that are not coincidences when two GameChanger teams are the same club. */
export type GcPairingEvidence =
  /** The same badge. GameChanger keeps a club's picture across seasons; nobody else has it. */
  | "avatar"
  /** Both give the same town. */
  | "city"
  /** Both give the same state. */
  | "state"
  /** They played a club in common. */
  | "shared-opponent";

/** What the panel calls each piece of evidence. */
export const GC_PAIRING_EVIDENCE_LABEL: Record<GcPairingEvidence, string> = {
  avatar: "same picture",
  city: "same town",
  state: "same state",
  "shared-opponent": "a club in common",
};

/** Seasons in the order a squad plays them, so "the next one" has a meaning. */
const SEASON_ORDER = ["fall", "winter", "spring", "summer"] as const;

/**
 * A squad year runs Fall through the following Summer, so these two labels are consecutive within
 * one squad year. Anything else — Summer to the next Fall — is a new squad at a new age level, and
 * that is an age-up rather than a pairing.
 */
const isNextSeason = (from: GcTeamLink, to: GcTeamLink): boolean => {
  const fromIndex = SEASON_ORDER.indexOf((from.season ?? "") as (typeof SEASON_ORDER)[number]);
  const toIndex = SEASON_ORDER.indexOf((to.season ?? "") as (typeof SEASON_ORDER)[number]);
  if (fromIndex < 0 || toIndex < 0 || toIndex <= fromIndex) return false;
  return (
    squadYearForGcSeason(from.season, from.seasonYear ?? 0) ===
    squadYearForGcSeason(to.season, to.seasonYear ?? 0)
  );
};

/** The level a profile is for: what GameChanger says, else what the name says. */
const profileAgeLevel = (profile: GcTeamProfile): number | undefined =>
  profile.ageLevel ?? ageLevelFromName(profile.name);

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

/** Why a schedule was left where it was, in the words the panel shows. */
const skipReason = (profile: GcTeamProfile): string => {
  const ageLevel = profileAgeLevel(profile);
  if (ageLevel === undefined) {
    return "GameChanger gave no age group for this team, and its name does not say one.";
  }
  if (ageLevel < MIN_AGE_LEVEL) {
    return `${ageLevel}U is below the youngest level ranked here, so this team was skipped.`;
  }
  if (ageLevel > MAX_AGE_LEVEL) {
    return `${ageLevel}U is above the oldest level ranked here, so this team was skipped.`;
  }
  return "GameChanger gave no season for this team, so there is no squad year to file it under.";
};

/** The link this pull records against a team, so a later pull knows what it already has. */
const linkFor = (profile: GcTeamProfile, ageGroupId: string, fetchedAt: string): GcTeamLink => ({
  teamId: profile.id,
  name: profile.name,
  ageGroupId,
  ...(profile.season ? { season: profile.season.season, seasonYear: profile.season.year } : {}),
  ...(profileAgeLevel(profile) === undefined ? {} : { ageLevel: profileAgeLevel(profile) }),
  ...(profile.avatarKey ? { avatarKey: profile.avatarKey } : {}),
  ...(profile.record ? { record: profile.record } : {}),
  importedAt: fetchedAt,
});

const withLink = (team: ScoutTeam, link: GcTeamLink): ScoutTeam => {
  const rest = (team.gcTeams ?? []).filter((entry) => entry.teamId !== link.teamId);
  const linked: ScoutTeam = { ...team, gcTeams: [...rest, link] };
  // Its own schedule is here now, so it is a club rather than a name on somebody else's.
  delete linked.nameOnly;
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
  const link = linkFor(profile, ageGroupId, schedule.fetchedAt);
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
  const placeholder =
    pick(confirmed) ??
    pick(inState(atLevel)) ??
    (placeholders.length === 1 ? pick(inState(placeholders)) : undefined);
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
 * that is what their row looks like before this team's own turn comes round.
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
    if (game.startTs && existing.startTs && game.startTs !== existing.startTs) return false;
    const other = existing.teamAId === candidateId ? existing.teamBId : existing.teamAId;
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
      if (game.startTs && existing.startTs && game.startTs !== existing.startTs) return false;
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
    if (game.startTs && existing.startTs && game.startTs !== existing.startTs) return false;

    const ourScore = existing.teamAId === ownTeamId ? existing.teamAScore : existing.teamBScore;
    const theirScore = existing.teamAId === ownTeamId ? existing.teamBScore : existing.teamAScore;
    const scoresAgree =
      ourScore !== undefined &&
      theirScore !== undefined &&
      ourScore === game.teamScore &&
      theirScore === game.opponentScore;
    // Either the result matches, or the day and the start time pin it on their own.
    const timeAgrees = Boolean(game.startTs) && game.startTs === existing.startTs;
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
  if (isPlaceholderName(game.opponentName)) {
    const slot = buildScoutTeam(game.opponentName, index.usedTeamIds, { placeholder: true });
    addTeam(index, teams, slot);
    return { teamId: slot.id, basis: "created" };
  }

  const key = teamNameKey(game.opponentName);
  const theirLevel = ageLevelFromName(game.opponentName) ?? index.levelOf(ageGroupId);
  const sameName =
    index.teamIdsByGroupName.get(nameSlotKey(index.poolKeyOf(ageGroupId), key, theirLevel)) ?? [];

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
export const importGcSchedule = (
  schedule: GcTeamSchedule,
  state: GcImportState
): { state: GcImportState; outcome: GcImportOutcome } => {
  // The fold works in place, so it is handed copies: a caller's pool is never altered under it.
  const working: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const result = importOne(schedule, working, buildIndex(working));
  // Nothing could be filed, so hand back exactly what came in rather than a copy of it.
  return result.outcome.issue ? { state, outcome: result.outcome } : result;
};

const importOne = (
  schedule: GcTeamSchedule,
  state: GcImportState,
  index: ImportIndex
): { state: GcImportState; outcome: GcImportOutcome } => {
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
  };

  const resolved = resolveAgeGroup(profile, state);
  if (!resolved) {
    return {
      state,
      outcome: {
        ...base,
        issue: skipReason(profile),
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
    const known = index.gamesById.get(gcGameId(profile.id, game.id));
    const knownOpponentId = known
      ? known.teamAId === own.teamId
        ? known.teamBId
        : known.teamAId
      : undefined;

    let opponentId = knownOpponentId;
    if (opponentId === undefined) {
      const opponent = resolveOpponent(game, group.id, teams, index, own.teamId, profile.id);
      opponentId = opponent.teamId;
      if (opponent.basis === "created") outcome.opponentsCreated += 1;
      else if (opponent.basis === "avatar") outcome.opponentsMatchedByAvatar += 1;
      else outcome.opponentsMatchedByName += 1;
    }

    // Their level is only ever a guess from the name; ours is what GameChanger said.
    const theirLevel = ageLevelFromName(game.opponentName);
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

    // Two ways the game may already be here. The same schedule's same game id is certainly it —
    // and `matchExistingGame` will not find that one, because it looks for a *different* row
    // meaning the same thing. Failing that, the other team's copy of the game.
    const existing =
      known ??
      matchExistingGame(
        candidate,
        index.gamesByMatch.get(matchKeyOf(candidate, index.poolKeyOf)) ?? [],
        ageGroups
      );
    if (!existing) {
      addGame(index, games, candidate);
      outcome.gamesAdded += 1;
      continue;
    }
    if (!differs(existing, candidate)) {
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
    const merged: ScoutGame = {
      ...existing,
      ...(isScored(candidate) ? { teamAScore: scores.a, teamBScore: scores.b } : {}),
      ...(candidate.season ? { season: candidate.season } : {}),
    };
    // Same id, same pool, same pair, same date, so nothing it is filed under moves.
    const position = index.gamePos.get(existing.id);
    if (position !== undefined) games[position] = merged;
    index.gamesById.set(merged.id, merged);
    const sameBucket = index.gamesByMatch.get(matchKeyOf(merged, index.poolKeyOf));
    if (sameBucket) {
      const at = sameBucket.findIndex((entry) => entry.id === merged.id);
      if (at >= 0) sameBucket[at] = merged;
    }
    outcome.gamesUpdated += 1;
  }

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

export const createGcImporter = (state: GcImportState): GcImporter => {
  let next: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const index = buildIndex(next);
  return {
    add: (schedule) => {
      const result = importOne(schedule, next, index);
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
  state: GcImportState
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
    const result = importOne(schedule, next, index);
    next = result.state;
    outcomes.push(result.outcome);
  }
  return { state: next, outcomes };
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
 * off. It has to come from a *different* GameChanger team's schedule: if a club's own schedule
 * lists both a placeholder and a named opponent that day, those are two different games it is
 * playing, and neither names the other. Where both rows carry a start time they must agree on it,
 * which is what tells the two halves of a doubleheader apart. Without times, the day has to hold
 * exactly one candidate; anything less certain is left as it is, because a wrong answer here
 * silently moves a result onto a club that never played it.
 */
export const resolveSlotGames = (
  state: GcImportState
): { state: GcImportState; resolved: number } => {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
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
    const sameTime = (named: ScoutGame): boolean =>
      slotGame.startTs !== undefined && named.startTs === slotGame.startTs;
    const timeAgrees = (named: ScoutGame): boolean =>
      slotGame.startTs === undefined || named.startTs === undefined || sameTime(named);

    const candidates = (namedByTeamDay.get(dayKey(knownId, slotGame.date!)) ?? []).filter(
      (named) =>
        !spoken.has(named.id) &&
        // The other club's schedule, never the same one this slot came from.
        sourceOf(named) !== undefined &&
        sourceOf(named) !== sourceOf(slotGame) &&
        /*
         * Two results that contradict are two games, full stop. Folding the slot into the one
         * named row of the day regardless was deleting real results: on a pool with no start
         * times to hold it back, that fallback threw away 1,976 scored games in one tidy.
         */
        !(isScored(slotGame) && isScored(named) && !mirrors(named))
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
    if (!slotGame || !isScored(slotGame) || isScored(named)) return;
    const knownId = isSlot(slotGame.teamAId) ? slotGame.teamBId : slotGame.teamAId;
    const knownScore = slotGame.teamAId === knownId ? slotGame.teamAScore : slotGame.teamBScore;
    const otherScore = slotGame.teamAId === knownId ? slotGame.teamBScore : slotGame.teamAScore;
    const current = filled.get(named.id) ?? named;
    filled.set(named.id, {
      ...current,
      ...(named.teamAId === knownId
        ? { teamAScore: knownScore, teamBScore: otherScore }
        : { teamAScore: otherScore, teamBScore: knownScore }),
    });
  });

  const games = state.games
    .filter((game) => !merges.has(game.id))
    .map((game) => filled.get(game.id) ?? game);

  // A stand-in nothing references any more is not a club and should not linger in the roster.
  const stillUsed = new Set(games.flatMap((game) => [game.teamAId, game.teamBId]));
  const teams = state.teams.filter(
    (team) => (!team.placeholder && !team.nameOnly) || stillUsed.has(team.id)
  );

  return { state: { ...state, teams, games }, resolved: merges.size };
};

/**
 * Clubs that look like the same club a season on — a Fall squad and a Spring squad with the same
 * picture, or the same name at the same level. Offered, never applied: only the user can say that
 * a Fall roster and a Spring roster are the same team, and merging two clubs that merely share a
 * name would quietly ruin both their ratings.
 *
 * Teams already paired onto one entry are not offered again, since they are the same team here
 * already.
 */
export const proposeSeasonPairings = (
  teams: ScoutTeam[],
  games: readonly ScoutGame[] = []
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

  const candidates: GcSeasonPairing[] = [];
  for (const from of linked) {
    for (const to of candidatesFor(from)) {
      if (from.team.id === to.team.id) continue;
      if (!isNextSeason(from.link, to.link)) continue;
      // A level apart is an age-up, not the same squad carrying on through a season.
      if (from.link.ageLevel !== to.link.ageLevel) continue;

      const sameName = teamNameKey(from.link.name) === teamNameKey(to.link.name);
      const evidence: GcPairingEvidence[] = [];
      if (from.link.avatarKey && from.link.avatarKey === to.link.avatarKey) evidence.push("avatar");
      // A town is evidence only in its own state: Lawrenceburg IN is not Lawrenceburg KY.
      const city = townKey(from.team.city);
      if (city && city === townKey(to.team.city) && from.team.state === to.team.state) {
        evidence.push("city");
      }
      if (from.team.state && from.team.state === to.team.state) evidence.push("state");
      if (shareAnOpponent(from.team.id, to.team.id)) evidence.push("shared-opponent");

      /**
       * A shared name is not enough on its own, and this is where that used to be the whole test.
       * A pool pulled from a nationwide list holds dozens of clubs called the same thing, so a
       * name-only rule offered a page of pairings that were mostly wrong, which is worse than
       * offering none: read enough of them and they all start looking approvable.
       */
      if (evidence.length === 0) continue;
      if (!sameName && !evidence.includes("avatar")) continue;
      /*
       * Same name and same state alone is no offer. Two GameChanger accounts a season apart with
       * one name in one state are, as often as not, two rec-league teams in two towns; a town in
       * common, a pulled club in common, or the same picture is what makes one squad.
       */
      if (evidence.every((item) => item === "state")) continue;

      candidates.push({
        fromTeamId: from.team.id,
        fromTeamName: from.team.name,
        fromSeason: gcSeasonLabel(from.link) || "an unlabelled season",
        toTeamId: to.team.id,
        toTeamName: to.team.name,
        toSeason: gcSeasonLabel(to.link) || "an unlabelled season",
        evidence,
        sameName,
        confidence:
          evidence.includes("avatar") || (sameName && evidence.length > 1) ? "strong" : "likely",
      });
    }
  }

  /**
   * A squad carries on into exactly one next season. Where two clubs both qualify as the one this
   * team became, neither is offered: the whole point of asking is that the answer is not obvious,
   * and a list that offers both invites picking whichever was read first.
   */
  const outgoing = new Map<string, number>();
  candidates.forEach((pairing) => {
    const key = `${pairing.fromTeamId}\u0000${pairing.toSeason}`;
    outgoing.set(key, (outgoing.get(key) ?? 0) + 1);
  });

  return (
    candidates
      .filter((pairing) => outgoing.get(`${pairing.fromTeamId}\u0000${pairing.toSeason}`) === 1)
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
 */
export const isSettledPairing = (pairing: GcSeasonPairing): boolean =>
  pairing.sameName && pairing.evidence.includes("city") && pairing.evidence.includes("state");

/**
 * Applies the settled pairings — earlier squad folded into the later one, as the panel does when
 * a pairing is ticked. A squad paired on into a season that was itself paired on follows the
 * chain to whichever entry survived, so Fall → Winter → Spring ends as one team whatever order
 * the pairs come in.
 */
export const pairSettledSquads = (
  state: GcImportState
): { state: GcImportState; paired: number } => {
  const settled = proposeSeasonPairings(state.teams, state.games).filter(isSettledPairing);
  if (settled.length === 0) return { state, paired: 0 };

  let teams = state.teams;
  let games = state.games;
  let paired = 0;
  const movedTo = new Map<string, string>();
  const survivorOf = (teamId: string): string => {
    let current = teamId;
    while (movedTo.has(current)) current = movedTo.get(current)!;
    return current;
  };
  settled.forEach((pairing) => {
    const from = survivorOf(pairing.fromTeamId);
    const into = survivorOf(pairing.toTeamId);
    if (from === into) return;
    const result = mergeScoutTeams(from, into, teams, games, state.ageGroups);
    if (result.teams === teams) return;
    teams = result.teams;
    games = result.games;
    movedTo.set(from, into);
    paired += 1;
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
  const failed = outcomes.length - filed.length;
  const sum = (pick: (outcome: GcImportOutcome) => number) =>
    filed.reduce((total, outcome) => total + pick(outcome), 0);

  const lines: string[] = [];
  lines.push(
    `${filed.length} schedule${filed.length === 1 ? "" : "s"} read${
      failed ? `, ${failed} that could not be filed` : ""
    }.`
  );

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
  let teams = state.teams;
  let games = state.games;
  foldInto.forEach((intoId, fromId) => {
    const result = mergeScoutTeams(fromId, intoId, teams, games, state.ageGroups);
    teams = result.teams;
    games = result.games;
  });
  return { state: { ...state, teams, games }, merged: foldInto.size };
};

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
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const ownIds = new Map<string, Set<string>>();
  const namesakes = new Map<string, string[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    ownIds.set(team.id, new Set(team.gcTeams.map((link) => link.teamId)));
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
  /** Whether this club's own schedule has a row that day against `pullerId` that could be `row`. */
  const holds = (clubId: string, pullerId: string, row: ScoutGame): boolean =>
    (ownByDay.get(`${clubId}\u0000${row.date}`) ?? []).some((own) => {
      const other = own.teamAId === clubId ? own.teamBId : own.teamAId;
      if (other !== pullerId) return false;
      const ownClub = score(own, clubId);
      const ownPuller = score(own, pullerId);
      if (ownClub === undefined || ownPuller === undefined) return true;
      const rowClub = score(row, clubId === row.teamAId ? row.teamAId : row.teamBId);
      const rowPuller = score(row, pullerId);
      if (rowClub === undefined || rowPuller === undefined) return true;
      return ownClub === rowClub && ownPuller === rowPuller;
    });

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
    // hold a row that could be it.
    if (isOwnRow(game, namedId) || holds(namedId, pullerId, game)) return game;
    const pool = poolKeyOf(game.ageGroupId);
    const holders = (namesakes.get(teamNameKey(named.name)) ?? []).filter((clubId) => {
      if (clubId === namedId) return false;
      const club = teamById.get(clubId);
      const inPool = club?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool);
      return Boolean(inPool) && holds(clubId, pullerId, game);
    });
    if (holders.length !== 1) return game;
    reclaimed += 1;
    const holder = holders[0]!;
    return game.teamAId === namedId ? { ...game, teamAId: holder } : { ...game, teamBId: holder };
  });
  return reclaimed === 0 ? { state, reclaimed: 0 } : { state: { ...state, games }, reclaimed };
};

/**
 * Files a stand-in's rows onto the one pulled club of that name in the puller's state.
 *
 * A stand-in is a name a schedule wrote down before — or instead of — the club being pulled. Once
 * the whole pool is in, most of them have a pulled namesake, and where exactly one of those is in
 * the state of the club that named it, that is the club: right in about nine cases in ten on
 * known pairs, and the tenth is a traveller the game itself will usually settle first. Two in the
 * state, or none, stays a stand-in — a guess between namesakes is what made six River City
 * Raptors — and a lone namesake in another state is refused for the same reason. Nothing at
 * arrival time could do this, because the namesake was pulled after the mention 70 times in 100.
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
    const inState = (clubs.get(slot) ?? []).filter((club) => club.state === puller.state);
    // Two in the state: the one in the puller's own town, if exactly one is.
    const pullerTown = townKey(puller.city);
    const chosen =
      inState.length === 1
        ? inState
        : pullerTown
          ? inState.filter((club) => townKey(club.city) === pullerTown)
          : [];
    if (chosen.length !== 1) return game;
    refiled += 1;
    const club = chosen[0]!;
    return standIn === a ? { ...game, teamAId: club.id } : { ...game, teamBId: club.id };
  });
  if (refiled === 0) return { state, refiled: 0 };

  // A stand-in with nothing left on it is not a club and should not linger in the roster.
  const stillUsed = new Set(games.flatMap((game) => [game.teamAId, game.teamBId]));
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
  /** Teams folded into a club already here under another GameChanger id. */
  folded: number;
  /** Squads paired on into their next season on the same name, town and state. */
  paired: number;
  /** Rows that were the same game written twice, now one. */
  collapsed: number;
  /** Rows dated outside their squad year, dropped. */
  pruned: number;
  /** Rows moved to the namesake whose own schedule holds the game. */
  reclaimed: number;
  /** Stand-in rows filed onto the one club of that name in the puller's state. */
  refiled: number;
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
const tidyOnce = (state: GcImportState): Omit<PoolTidy, "passes"> => {
  const season = pruneOutOfSeason(state);
  const named = resolveSlotGames(season.state);
  const moved = reclaimMisfiled(named.state);
  const placed = refileStandIns(moved.state);
  const squads = mergeSameSquadIds(placed.state);
  const seasons = pairSettledSquads(squads.state);
  const same = collapseSameGames(seasons.state.games, seasons.state.ageGroups);
  return {
    state: same.collapsed > 0 ? { ...seasons.state, games: same.games } : seasons.state,
    named: named.resolved,
    folded: squads.merged,
    paired: seasons.paired,
    collapsed: same.collapsed,
    pruned: season.pruned,
    reclaimed: moved.reclaimed,
    refiled: placed.refiled,
  };
};

/**
 * Runs the passes until a pass finds nothing. Each one changes what the next can see — a slot
 * settled in pass one is the row that lets a second slot settle in pass two — so a single pass
 * left 416 stand-ins that the next pass found, then 54, then 5.
 */
export const tidyPool = (state: GcImportState): PoolTidy => {
  const total: PoolTidy = {
    state,
    named: 0,
    folded: 0,
    paired: 0,
    collapsed: 0,
    pruned: 0,
    reclaimed: 0,
    refiled: 0,
    passes: 0,
  };
  for (let pass = 0; pass < TIDY_MAX_PASSES; pass += 1) {
    const step = tidyOnce(total.state);
    total.passes += 1;
    total.state = step.state;
    total.named += step.named;
    total.folded += step.folded;
    total.paired += step.paired;
    total.collapsed += step.collapsed;
    total.pruned += step.pruned;
    total.reclaimed += step.reclaimed;
    total.refiled += step.refiled;
    const changed =
      step.named +
      step.folded +
      step.paired +
      step.collapsed +
      step.pruned +
      step.reclaimed +
      step.refiled;
    if (changed === 0) break;
  }
  return total;
};

/**
 * A cheap fingerprint of a pool: enough to tell "this is the pool the tidy last saw" from "this
 * is not", without hashing forty thousand rows. Counts and the newest GameChanger fetch cover a
 * pull, a restore and a reset; a hand edit that keeps every count the same and lands on an
 * already-tidied pool has nothing for the tidy to do anyway.
 */
export const poolSignature = (state: GcImportState): string => {
  let latest = "";
  state.teams.forEach((team) => {
    team.gcTeams?.forEach((link) => {
      if (link.importedAt && link.importedAt > latest) latest = link.importedAt;
    });
  });
  return `${state.ageGroups.length}|${state.teams.length}|${state.games.length}|${latest}`;
};

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
    ...(tidy.named > 0
      ? [
          `${plural(tidy.named, "placeholder", "placeholders")} named from the other team's schedule.`,
        ]
      : []),
    ...(tidy.reclaimed > 0
      ? [
          `${plural(tidy.reclaimed, "game", "games")} moved to the club of that name whose own schedule holds it.`,
        ]
      : []),
    ...(tidy.refiled > 0
      ? [
          `${plural(tidy.refiled, "game", "games")} filed onto the one club of that name in the same state.`,
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
  ];
};
