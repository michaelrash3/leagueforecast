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
  matchExistingGame,
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
  const key = nameSlotKey(index.poolKeyOf(ageGroupId), teamNameKey(team.name), level);
  const bucket = index.teamIdsByGroupName.get(key);
  if (!bucket) index.teamIdsByGroupName.set(key, [teamId]);
  else if (!bucket.includes(teamId)) bucket.push(teamId);
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
  if (ageLevel === undefined || ageLevel < MIN_AGE_LEVEL || !profile.season) return null;
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
 * The team a pulled schedule belongs to. By GameChanger id and nothing else: a team pulled by id
 * *is* that id, and pairing a Fall squad to a Spring one is the user's call, not a guess made
 * here.
 */
const resolveOwnTeam = (
  profile: GcTeamProfile,
  ageGroupId: string,
  fetchedAt: string,
  teams: ScoutTeam[],
  index: ImportIndex
): { teamId: string; created: boolean } => {
  const link = linkFor(profile, ageGroupId, fetchedAt);
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
  const key = teamNameKey(profile.name);
  const sameName =
    index.teamIdsByGroupName.get(
      nameSlotKey(index.poolKeyOf(ageGroupId), key, profileAgeLevel(profile))
    ) ?? [];
  // Exactly one, or picking between them is a guess — and a wrong one folds a club's games into
  // somebody else's team.
  const placeholders = sameName.map((teamId) => index.teamsById.get(teamId)).filter(isStub);
  const placeholder = placeholders.length === 1 ? placeholders[0] : undefined;
  if (placeholder) {
    const updated = withLink(placeholder, link);
    const placeholderState = normalizeState(profile.state ?? "");
    if (placeholderState && !updated.state) updated.state = placeholderState;
    if (profile.city && !updated.city) updated.city = profile.city;
    replaceTeam(index, teams, updated);
    return { teamId: placeholder.id, created: false };
  }

  const extras: Partial<ScoutTeam> = { gcTeams: [link] };
  const state = normalizeState(profile.state ?? "");
  if (state) extras.state = state;
  if (profile.city) extras.city = profile.city;
  const team = buildScoutTeam(profile.name, index.usedTeamIds, extras);
  addTeam(index, teams, team);
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
      return other === ownTeamId || index.teamsById.get(other)?.placeholder === true;
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
  ownTeamId: string
): OpponentMatch => {
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

  if (game.opponentAvatarKey) {
    const byAvatar = index.teamsByAvatar.get(game.opponentAvatarKey) ?? [];
    // Exactly one, or the picture is shared and says nothing about which team this is.
    if (byAvatar.length === 1 && byAvatar[0]) {
      return { teamId: byAvatar[0].id, basis: "avatar" };
    }
  }

  const key = teamNameKey(game.opponentName);
  const theirLevel = ageLevelFromName(game.opponentName) ?? index.levelOf(ageGroupId);
  const sameName =
    index.teamIdsByGroupName.get(nameSlotKey(index.poolKeyOf(ageGroupId), key, theirLevel)) ?? [];

  /*
   * Attaching this game to a club somebody has actually pulled is a claim about identity, so it
   * takes more than a shared name: exactly one candidate, and something beyond the name agreeing.
   */
  const only = sameName.length === 1 ? sameName[0] : undefined;
  if (only && corroborates(index, ownTeamId, only, game)) {
    return { teamId: only, basis: "name" };
  }

  /*
   * Failing that, an entry nobody has pulled — a name some schedule wrote down, and no more than
   * that. Reusing one is not the claim that attaching to a real club is, and refusing to reuse it
   * is far worse than it sounds: the second entry of a name makes every later mention ambiguous,
   * so it mints a third, and a fourth, until one club is hundreds of teams and its games are
   * scattered across all of them. A pull of a few thousand schedules did exactly that.
   *
   * A picture is what splits two clubs of one name, and it is checked above, before any of this:
   * a stub carrying a different picture from the one in this game was never a candidate. So what
   * is left to reuse is an entry with no picture to contradict this one.
   */
  const reusable = sameName
    .map((teamId) => index.teamsById.get(teamId))
    .find(
      (team): team is ScoutTeam =>
        team !== undefined &&
        !team.placeholder &&
        !team.gcTeams?.length &&
        (team.avatarKey === undefined || team.avatarKey === game.opponentAvatarKey)
    );
  if (reusable) {
    // The first schedule to give this club a picture leaves it here for the next one to find.
    if (game.opponentAvatarKey && !reusable.avatarKey) {
      replaceTeam(index, teams, { ...reusable, avatarKey: game.opponentAvatarKey });
    }
    return { teamId: reusable.id, basis: "name" };
  }

  const created = buildScoutTeam(game.opponentName, index.usedTeamIds, {
    nameOnly: true,
    ...(game.opponentAvatarKey ? { avatarKey: game.opponentAvatarKey } : {}),
  });
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
  const own = resolveOwnTeam(profile, group.id, schedule.fetchedAt, teams, index);
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

  for (const game of schedule.games) {
    if (!isFilable(game)) {
      outcome.gamesIgnored += 1;
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
      const opponent = resolveOpponent(game, group.id, teams, index, own.teamId);
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
  const isSlot = (teamId: string) => teamById.get(teamId)?.placeholder === true;

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

  slotGames.forEach((slotGame) => {
    const knownId = isSlot(slotGame.teamAId) ? slotGame.teamBId : slotGame.teamAId;
    const candidates = (namedByTeamDay.get(dayKey(knownId, slotGame.date!)) ?? []).filter(
      (named) =>
        !spoken.has(named.id) &&
        // The other club's schedule, never the same one this slot came from.
        sourceOf(named) !== undefined &&
        sourceOf(named) !== sourceOf(slotGame) &&
        // A time on both sides has to agree; a doubleheader is two games, not one.
        (slotGame.startTs === undefined ||
          named.startTs === undefined ||
          slotGame.startTs === named.startTs)
    );

    // With times on both rows, an exact time is the answer even on a day holding several games.
    const timed = candidates.filter(
      (named) => slotGame.startTs !== undefined && named.startTs === slotGame.startTs
    );
    /*
     * Failing a time, the score. A pool-play day against one club is two or three games with no
     * times posted, and picking between them by the day alone is the guess this function refuses
     * to make — but the same fixture written down twice agrees on what it finished, from each
     * side's point of view. Where exactly one named row agrees, that is the one.
     */
    const agreeing = candidates.filter((named) => {
      if (!isScored(slotGame) || !isScored(named)) return false;
      const slotKnown = slotGame.teamAId === knownId ? slotGame.teamAScore : slotGame.teamBScore;
      const slotOther = slotGame.teamAId === knownId ? slotGame.teamBScore : slotGame.teamAScore;
      const namedKnown = named.teamAId === knownId ? named.teamAScore : named.teamBScore;
      const namedOther = named.teamAId === knownId ? named.teamBScore : named.teamAScore;
      return slotKnown === namedKnown && slotOther === namedOther;
    });
    const shortlist = timed.length > 0 ? timed : agreeing.length > 0 ? agreeing : candidates;
    if (shortlist.length !== 1) return;

    const named = shortlist[0]!;
    spoken.add(named.id);
    merges.set(slotGame.id, named);
  });

  if (merges.size === 0) return { state, resolved: 0 };

  // The named row keeps its id and its side order; only a score it does not have is taken from the
  // slot's row, since a placeholder's schedule can carry a result the other's has not posted yet.
  const filled = new Map<string, ScoutGame>();
  merges.forEach((named, slotId) => {
    const slotGame = state.games.find((game) => game.id === slotId);
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

  // A slot nothing else references is not a club and should not linger in the roster.
  const stillUsed = new Set(games.flatMap((game) => [game.teamAId, game.teamBId]));
  const teams = state.teams.filter((team) => !team.placeholder || stillUsed.has(team.id));

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

  /** Who each team has played, so "a club in common" can be asked without scanning the games. */
  const opponents = new Map<string, Set<string>>();
  const note = (teamId: string, opponentId: string) => {
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

  const candidates: GcSeasonPairing[] = [];
  for (const from of linked) {
    for (const to of linked) {
      if (from.team.id === to.team.id) continue;
      if (!isNextSeason(from.link, to.link)) continue;
      // A level apart is an age-up, not the same squad carrying on through a season.
      if (from.link.ageLevel !== to.link.ageLevel) continue;

      const sameName = teamNameKey(from.link.name) === teamNameKey(to.link.name);
      const evidence: GcPairingEvidence[] = [];
      if (from.link.avatarKey && from.link.avatarKey === to.link.avatarKey) evidence.push("avatar");
      const city = from.team.city?.toLowerCase();
      if (city && city === to.team.city?.toLowerCase()) evidence.push("city");
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
