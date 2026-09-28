import {
  gcLinkSquadYear,
  type AgeGroup,
  type GcAgeSource,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import {
  ageGroupLevel,
  ageGroupYear,
  createAgeGroupId,
  formatAgeGroupName,
  MAX_AGE_LEVEL,
  MIN_AGE_LEVEL,
} from "./teamRankings/seasons";

/** The part of the pool a club's age touches: the roster, one year's games, and the pages. */
export type ClubAgeState = { teams: ScoutTeam[]; games: ScoutGame[]; ageGroups: AgeGroup[] };

export type ClubAgeChange = ClubAgeState & {
  /** The GameChanger ids the club is known by in that year, which the level is stored against. */
  gcTeamIds: string[];
  /** The level the club was filed at before, when its links agreed on one. */
  was?: number;
  /** The level each of those ids was filed at before, where it had one, agreeing or not. */
  levels: Record<string, number>;
  /** The page the club is filed on now. */
  page: AgeGroup;
  /** Rows of the club's own schedules moved onto that page. */
  moved: number;
};

/**
 * A pulled club filed at the age somebody says it plays at, for one squad year.
 *
 * The level a club is filed at is where everything about it is read from: its page, the table it
 * ranks on (`homeLevelOf` reads the link first) and the age each side of its games played at,
 * which the rating's age gap is taken from. So all three move together, the way a pull files them
 * together: the links in that year, the rows its own schedules filed (onto the new page, with the
 * club's side at the new level), and the club's side of any other row that recorded an age for it.
 * A row another club's schedule filed stays on that club's page, since the page is where a row was
 * filed rather than an age, and a side it recorded no age for is still read off that page, as it
 * was before.
 *
 * Null for a club with no GameChanger link in the year, whose level is read off its games and
 * whose games were all filed by other clubs, and for a level this app does not rank.
 *
 * `source` is what the links say decided the level (`GcTeamLink.ageFrom`): "you" when somebody
 * sets it, and null to say nothing when it is handed back, since what the app had used is only
 * known again once a pull asks. Absent leaves it as it was.
 *
 * `only` narrows it to some of the club's ids in the year, for putting back a club whose ids the
 * app had filed at different levels: each id's link and the rows its own schedule filed. Another
 * club's row is left as it is then, since nothing on it says which of the club's ids it was about.
 */
export const setClubAge = (
  state: ClubAgeState,
  clubId: string,
  level: number,
  year: number,
  source?: GcAgeSource | null,
  only?: ReadonlySet<string>
): ClubAgeChange | null => {
  if (!Number.isInteger(level) || level < MIN_AGE_LEVEL || level > MAX_AGE_LEVEL) return null;
  const club = state.teams.find((team) => team.id === clubId);
  const links = (club?.gcTeams ?? []).filter(
    (link) =>
      gcLinkSquadYear(link, state.ageGroups) === year &&
      (only === undefined || only.has(link.teamId))
  );
  if (!club || links.length === 0) return null;

  const groupById = new Map(state.ageGroups.map((group) => [group.id, group]));
  const levels: Record<string, number> = {};
  links.forEach((link) => {
    const at = link.ageLevel ?? ageGroupLevel(groupById.get(link.ageGroupId));
    if (at !== undefined) levels[link.teamId] = at;
  });
  const agreed = new Set(Object.values(levels));
  const was = agreed.size === 1 ? [...agreed][0] : undefined;

  const existing = state.ageGroups.find(
    (group) => ageGroupLevel(group) === level && ageGroupYear(group) === year
  );
  const page: AgeGroup = existing ?? {
    id: createAgeGroupId(),
    name: formatAgeGroupName(level, year),
    ageLevel: level,
    year,
    seasonIds: [],
  };
  const ageGroups = existing ? state.ageGroups : [...state.ageGroups, page];

  const gcTeamIds = links.map((link) => link.teamId);
  const own = new Set(gcTeamIds);
  const sourced = (link: NonNullable<ScoutTeam["gcTeams"]>[number]) => {
    if (source === undefined || link.ageFrom === (source ?? undefined)) return link;
    const { ageFrom: _was, ...rest } = link;
    return source === null ? rest : { ...rest, ageFrom: source };
  };
  const relinked = club.gcTeams?.map((link) => {
    if (!own.has(link.teamId)) return link;
    const moved =
      link.ageGroupId !== page.id || link.ageLevel !== level
        ? { ...link, ageGroupId: page.id, ageLevel: level }
        : link;
    return sourced(moved);
  });
  const teams =
    relinked && relinked.some((link, at) => link !== club.gcTeams?.[at])
      ? state.teams.map((team) => (team.id === clubId ? { ...club, gcTeams: relinked } : team))
      : state.teams;

  let moved = 0;
  let changed = false;
  const games = state.games.map((game) => {
    if (ageGroupYear(groupById.get(game.ageGroupId)) !== year) return game;
    const onA = game.teamAId === clubId;
    const onB = game.teamBId === clubId;
    if (!onA && !onB) return game;
    const ownRow = game.source?.teamId !== undefined && own.has(game.source.teamId);
    if (only !== undefined && !ownRow) return game;
    const refile = ownRow && game.ageGroupId !== page.id;
    const levelA = onA && (ownRow || game.ageLevelA !== undefined) && game.ageLevelA !== level;
    const levelB = onB && (ownRow || game.ageLevelB !== undefined) && game.ageLevelB !== level;
    if (!refile && !levelA && !levelB) return game;
    changed = true;
    if (refile) moved += 1;
    return {
      ...game,
      ...(refile ? { ageGroupId: page.id } : {}),
      ...(levelA ? { ageLevelA: level } : {}),
      ...(levelB ? { ageLevelB: level } : {}),
    };
  });

  return {
    teams,
    games: changed ? games : state.games,
    ageGroups,
    gcTeamIds,
    ...(was === undefined ? {} : { was }),
    levels,
    page,
    moved,
  };
};
