/**
 * League Standings' bridge to the pool: which club each league team is, a pick or a guess by name,
 * the results of those clubs and their opponents that the league's forecast is handed, the clubs a
 * pick could land on, and the league's own fixtures, so a pulled copy of one is not counted twice.
 *
 * Split out of `teamRankings.ts`, which re-exports all of it, because League Standings works the
 * bridge out as it starts (`useScoutBridge`), and the rest of that file, the rating fit, the
 * scouting report and the editing of the pool, only Team Rankings runs: the first download carried
 * all of it.
 */
import type { GameLog, Matchup, TeamBase } from "../types";
import { isFinal, parseNumber } from "../util";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "./types";
import {
  ageGroupLevel,
  ageGroupYear,
  squadYearForGcSeason,
  squadYearForLeagueSeason,
} from "./seasons";
import { ageLevelFromName } from "../gcAge";
import {
  countsTowardRating,
  LEAGUE_GAME_PREFIX,
  leagueCopiesFiledAgainstNobody,
  type LeagueRowReader,
  ratedMargin,
} from "./games";
import { isOffClubId, nameFitter, SCOUT_ID_PREFIX, teamNameKey } from "./names";
import { normalizeDateInput } from "../date";
import { coachesOf } from "../gcStaff";

export const scoreFor = (log: GameLog | undefined, side: "away" | "home") =>
  parseNumber(side === "away" ? (log?.awayRuns ?? "") : (log?.homeRuns ?? ""), Number.NaN);

/**
 * Age groups looked up once per call rather than once per game: a season-wide pool fed from
 * GameChanger can hold tens of thousands of games, and a legacy group's level and year come from
 * parsing its name.
 */
export type GroupIndex = {
  level: (ageGroupId: string) => number | undefined;
  year: (ageGroupId: string) => number | undefined;
};

export const indexGroups = (ageGroups: AgeGroup[]): GroupIndex => {
  const levels = new Map(ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const years = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return { level: (id) => levels.get(id), year: (id) => years.get(id) };
};

/**
 * The squad year a link sits in: the year of the group it is filed under, since that is where the
 * user (or the importer, with the user's approval) put it; otherwise what its GameChanger season
 * implies. A link filed under a legacy group with no year and carrying no season has no year.
 */
export const gcLinkYear = (link: GcTeamLink, index: GroupIndex): number | undefined => {
  const filed = index.year(link.ageGroupId);
  if (filed !== undefined) return filed;
  return link.seasonYear === undefined
    ? undefined
    : squadYearForGcSeason(link.season, link.seasonYear);
};

/** `gcLinkSquadYear` for a whole pool's links, with the groups indexed once rather than per link. */
export const gcLinkSquadYearIn = (
  ageGroups: AgeGroup[]
): ((link: GcTeamLink) => number | undefined) => {
  const index = indexGroups(ageGroups);
  return (link) => gcLinkYear(link, index);
};

/**
 * How far below a board's own level a club may still belong on it.
 *
 * A 10U board holds 10U clubs and the 9U clubs that play up into it, and nothing else. Younger
 * than that is a different game, and older is a club that has simply been listed on the wrong
 * page. One, not two: `PLAYS_UP_TO` in the importer is about where a *game* may land, which is a
 * looser question than which clubs a person should be offered when they say who a team is.
 */
export const PLAYS_UP_ONE = 1;

/**
 * The age levels GameChanger itself has a club at, for one squad year.
 *
 * Read off the links rather than off the games: a link is what somebody pulled, so its level is
 * the club's own, while a game's level is only where that game was filed and a club that entered
 * one tournament up is not that level. Three places a pull can leave it, in order of how directly
 * it was stated — the link's own `ageLevel`, the level of the group it is filed under, and the
 * level written into its name ("Cincy Stix Navy 10u").
 *
 * A year of `undefined` takes every link, which is what a season on a legacy page with no year
 * needs; otherwise only the links sitting in that squad year are read, so a club pulled for three
 * seasons is 10U on a 10U board rather than 9U, 10U and 11U at once.
 */
export const gcAgeLevels = (
  team: ScoutTeam,
  year: number | undefined,
  ageGroups: AgeGroup[]
): number[] => {
  const index = indexGroups(ageGroups);
  const levels = new Set<number>();
  (team.gcTeams ?? []).forEach((link) => {
    if (year !== undefined && gcLinkYear(link, index) !== year) return;
    const level = link.ageLevel ?? index.level(link.ageGroupId) ?? ageLevelFromName(link.name);
    if (level !== undefined) levels.add(level);
  });
  return [...levels].sort((a, b) => a - b);
};

/**
 * Whether a club could be the team on a board at `level` — its own level, or one below it.
 *
 * A club whose level cannot be read at all passes. That is deliberate: a freshly pulled club whose
 * links carry no age and whose name does not spell one out is a club nobody has told us about, not
 * a club at the wrong level, and dropping it out of the picker would hide the very entry somebody
 * had come to choose.
 */
export const clubFitsLevel = (levels: readonly number[], level: number | undefined): boolean =>
  level === undefined ||
  levels.length === 0 ||
  levels.some((at) => at <= level && at >= level - PLAYS_UP_ONE);

/** The board levels a League Standings season sits on: every age group that claims it. */
export const levelsForSeason = (seasonId: string, ageGroups: AgeGroup[]): number[] => {
  const levels = new Set<number>();
  ageGroups.forEach((group) => {
    if (!group.seasonIds.includes(seasonId)) return;
    const level = ageGroupLevel(group);
    if (level !== undefined) levels.add(level);
  });
  return [...levels].sort((a, b) => a - b);
};

/** The squad years a League Standings season sits in, for reading a club's level in that year. */
export const yearsForSeason = (
  seasonId: string,
  ageGroups: AgeGroup[]
): Array<number | undefined> => {
  const years = new Set<number | undefined>();
  ageGroups.forEach((group) => {
    if (group.seasonIds.includes(seasonId)) years.add(ageGroupYear(group));
  });
  return [...years];
};

/**
 * Whether a club is worth offering when somebody says which club a league team is.
 *
 * Two conditions, and they are the two a person would apply by hand. It has to be a club
 * GameChanger knows — a slot names nobody and a name-only stand-in has no schedule of its own to
 * bridge, so linking to either gives the league nothing it did not already have. And it has to be
 * at the board's level or one below, because an 18U club is not the 10U team you are naming
 * however well the name matches.
 */
export const clubIsPickable = (
  team: ScoutTeam,
  levels: readonly number[],
  years: ReadonlyArray<number | undefined>,
  ageGroups: AgeGroup[]
): boolean => {
  if (team.placeholder || team.nameOnly || !hasGcLinks(team)) return false;
  if (levels.length === 0) return true;
  const seen = years.length > 0 ? years : [undefined];
  return seen.some((year) => {
    const at = gcAgeLevels(team, year, ageGroups);
    return levels.some((level) => clubFitsLevel(at, level));
  });
};

/**
 * Whether a club has a GameChanger team behind it — a schedule that was pulled, or can be.
 *
 * Exported because linking a League Standings team to a club is only worth doing when there is
 * one: a name-only stand-in is a club known solely because somebody else's schedule named it, and
 * linking to it brings in nothing but the one-sided games that already reach the league through
 * the opponents who reported them.
 */
export const hasGcLinks = (team: ScoutTeam): boolean => Boolean(team.gcTeams?.length);

/**
 * For `dedupeLeagueFixtures`, what the roster says about a stored row.
 *
 * Whether a side could be a league opponent under no name of its own: a slot names nobody, so it
 * could be anyone; a club known only from somebody else's schedule could be the opponent when its
 * name fits the opponent's, "Hornets" for "Cincinnati Hornets"; a pulled club is itself and never a
 * stand-in for another. And whether the row is the club's own, pulled from one of its GameChanger
 * schedules, rather than typed in by hand. The roster is read on the first question, so a pool with
 * no league game to compare costs nothing.
 */
/** Each page's squad year as a pool key, or the page itself for one with no year. */
const squadYearOf = (ageGroups: readonly AgeGroup[]): ((ageGroupId: string) => string) => {
  const pools = new Map(
    ageGroups.map((group) => {
      const year = ageGroupYear(group);
      return [group.id, year === undefined ? `page:${group.id}` : `year:${year}`] as const;
    })
  );
  return (ageGroupId) => pools.get(ageGroupId) ?? `page:${ageGroupId}`;
};

export const leagueStandIns = (
  teams: readonly ScoutTeam[],
  /**
   * The pages, so a league game and a club's own copy of it are looked for across the squad year
   * the rating is fitted over (`LeagueRowReader.poolOf`) rather than on one page. Left out, each
   * page is its own, as the League Standings forecast reads it: it only reads the pages that claim
   * the league.
   */
  ageGroups?: readonly AgeGroup[]
): LeagueRowReader => {
  let byId: Map<string, ScoutTeam> | undefined;
  const teamOf = (teamId: string) => {
    byId ??= new Map(teams.map((team) => [team.id, team]));
    return byId.get(teamId);
  };
  const fits = nameFitter();
  const poolOf = ageGroups ? squadYearOf(ageGroups) : undefined;
  return {
    ...(poolOf ? { poolOf } : {}),
    standsInFor: (sideId, opponentId) => {
      const side = teamOf(sideId);
      if (!side) return false;
      if (side.placeholder) return true;
      if (!side.nameOnly || hasGcLinks(side)) return false;
      const opponent = teamOf(opponentId);
      return opponent !== undefined && fits(side.name, opponent.name);
    },
    pulledBy: (game, clubId) => {
      const schedule = game.source?.teamId;
      if (!schedule) return false;
      return teamOf(clubId)?.gcTeams?.some((link) => link.teamId === schedule) ?? false;
    },
    isOffClub: isOffClubId,
    namesakeOf: (sideId, offClubId) => {
      const side = teamOf(sideId);
      const off = teamOf(offClubId);
      return (
        side !== undefined && off !== undefined && !side.placeholder && fits(side.name, off.name)
      );
    },
  };
};

/** A league team has said it is not in Team Rankings at all. Never a real pool id: those start "S-". */
export const NO_SCOUT_TEAM = "__none__";

/**
 * A league team as this side of the app needs it: its id, its name, and its answer if it has one,
 * with the GameChanger id the club it picked carried then (`TeamBase.scoutGcTeamId`).
 */
export type LeagueTeamLink = {
  id: string;
  name: string;
  scoutTeamId?: string;
  scoutGcTeamId?: string;
};

/**
 * A club as something kept on this device or in a season remembers it: its id, and a GameChanger
 * id it carried then (`pageGcId`), where it had one. A club's id is the pool's own and can come to
 * name another club (Start again mints every one afresh); GameChanger's is never another team's.
 */
export type RememberedClub = { id: string; gc?: string };

/**
 * What a reader knows of the clubs: each by its id, with the GameChanger teams it carries, and the
 * clubs carrying a GameChanger id. The whole roster where the device holds the pool
 * (`clubLookupOf`), or only the clubs it holds cards of, which is enough to tell its own.
 */
export type ClubLookup = {
  byId: { get: (id: string) => { gcTeams?: readonly { teamId: string }[] } | undefined };
  carriersOf: (gcTeamId: string) => readonly string[];
};

/**
 * What a remembered club names now: its id while that names a club carrying the GameChanger id
 * kept beside it; else the one club carrying that id, whatever its id, which a club folded into
 * another is, since a fold carries the folded club's GameChanger teams on (`mergeScoutTeams`), and
 * a club pulled again after Start again is; else, where the id names a club that does not carry it
 * and no one club does, `moved`: the id is another club's now, and the store shows its club as gone
 * rather than read that one as it. One kept with no GameChanger id, or of a club absent and carried
 * on by none, reads as it always has. The one rule every store's reader and League's picks share.
 */
export const readClub = (
  club: RememberedClub,
  lookup: ClubLookup
): { id: string } | { moved: string } => {
  const { id, gc } = club;
  if (!gc) return { id };
  const held = lookup.byId.get(id);
  if (held?.gcTeams?.some((link) => link.teamId === gc)) return { id };
  const now = lookup.carriersOf(gc);
  if (now.length === 1 && now[0] !== undefined) return { id: now[0] };
  return held ? { moved: id } : { id };
};

/**
 * What a league team's pick names in `teams` now (`readClub`). Where it was kept with a GameChanger
 * id and the club under its id no longer carries that id, the pool has given the id to another
 * club (Start again mints every id afresh) or folded the club away: the pick is the one club
 * carrying the id, where exactly one does, and otherwise `moved`, used for no club at all. A pick
 * kept with no GameChanger id, or of a club absent and carried on by none, reads as it always has.
 */
export const readPick = (
  team: LeagueTeamLink,
  byId: ClubLookup["byId"],
  carriersOf: (gcTeamId: string) => readonly string[]
): { pick?: string; moved?: string } => {
  const pick = team.scoutTeamId;
  if (!pick || pick === NO_SCOUT_TEAM) return pick ? { pick } : {};
  const gc = team.scoutGcTeamId;
  const read = readClub({ id: pick, ...(gc ? { gc } : {}) }, { byId, carriersOf });
  return "moved" in read ? { moved: read.moved } : { pick: read.id };
};

/** A club as a lookup reads it: its id and the GameChanger teams it carries. */
type CarrierClub = { id: string; gcTeams?: readonly { teamId: string }[] };

/**
 * The clubs of `teams` carrying a GameChanger id, which `readPick` follows a moved pick by: every
 * link of the roster gathered the first time a pick needs following, and kept for the rest. Most
 * reads follow none, and the links of a nationwide roster are walked for each season read.
 */
export const gcCarriersOf = (
  teams: readonly CarrierClub[]
): ((gcTeamId: string) => readonly string[]) => {
  let byGcId: Map<string, string[]> | undefined;
  return (gcTeamId) => {
    if (!byGcId) {
      const gathered = new Map<string, string[]>();
      teams.forEach((team) =>
        (team.gcTeams ?? []).forEach((link) => {
          const held = gathered.get(link.teamId);
          if (!held) gathered.set(link.teamId, [team.id]);
          else if (!held.includes(team.id)) held.push(team.id);
        })
      );
      byGcId = gathered;
    }
    return byGcId.get(gcTeamId) ?? [];
  };
};

const lookups = new WeakMap<readonly CarrierClub[], ClubLookup>();

/**
 * `teams` as `readClub` reads them, by id and by GameChanger id, each worked out the first time it
 * is asked and kept for the rest: one lookup for one roster array, however many stores read it, and
 * a new one exactly when the roster is a new array.
 */
export const clubLookupOf = (teams: readonly CarrierClub[]): ClubLookup => {
  const held = lookups.get(teams);
  if (held) return held;
  let byId: Map<string, CarrierClub> | undefined;
  const lookup: ClubLookup = {
    byId: { get: (id) => (byId ??= new Map(teams.map((team) => [team.id, team]))).get(id) },
    carriersOf: gcCarriersOf(teams),
  };
  lookups.set(teams, lookup);
  return lookup;
};

/**
 * Old picks, kept before the GameChanger id was, given the id of the club picked where that club
 * carries exactly one: a club with several could be any of them, and the season's own team cannot
 * be told without the season's pages, so it waits for a person to pick it again. `teams` itself
 * where none takes one, and every team it leaves as it was, so a save writes only those it changed.
 * Laid on the season's next save of its own (`SeasonStore.amendEdits`), never one made for it.
 */
export const stampPicks = (teams: TeamBase[], lookup: ClubLookup): TeamBase[] => {
  let changed = false;
  const stamped = teams.map((team) => {
    const pick = team.scoutTeamId;
    if (!pick || pick === NO_SCOUT_TEAM || team.scoutGcTeamId) return team;
    const ids = new Set((lookup.byId.get(pick)?.gcTeams ?? []).map((link) => link.teamId));
    const [only] = ids;
    if (ids.size !== 1 || only === undefined) return team;
    changed = true;
    return { ...team, scoutGcTeamId: only };
  });
  return changed ? stamped : teams;
};

/**
 * A league team with its pick as it now reads (`withPicksRead`), and, where the pick moved and
 * cannot be followed, the club under its id (`movedScoutTeamId`), which a reader matches the team
 * onto by nothing, its name included, as the bridge uses it for nothing.
 */
export type PickRead = LeagueTeamLink & { movedScoutTeamId?: string };

/**
 * `leagueTeams` with each pick as it now reads (`readPick`): followed where it moved and can be,
 * dropped where it moved and cannot, with the club in its place named, so whatever reads the picks
 * after reads none that names the wrong club, nor guesses the team back onto it by its name. The
 * same array where no pick moved.
 */
export const withPicksRead = (
  leagueTeams: readonly LeagueTeamLink[],
  teams: readonly ScoutTeam[]
): readonly PickRead[] => {
  if (!leagueTeams.some((team) => team.scoutGcTeamId)) return leagueTeams;
  const byId = new Map(teams.map((team) => [team.id, team]));
  const carriersOf = gcCarriersOf(teams);
  let changed = false;
  const read = leagueTeams.map((team): PickRead => {
    const { pick, moved } = readPick(team, byId, carriersOf);
    if (pick === team.scoutTeamId) return team;
    changed = true;
    const { id, name, scoutGcTeamId } = team;
    if (moved) return { id, name, movedScoutTeamId: moved };
    return pick
      ? { id, name, scoutTeamId: pick, ...(scoutGcTeamId ? { scoutGcTeamId } : {}) }
      : { id, name };
  });
  return changed ? read : leagueTeams;
};

/**
 * One league fixture as the bridge reads it: the league's names for the two teams and its own date
 * string, and, once the game is final, its runs. The runs are what let a club's own row filed
 * against "TBD" be recognised as the league's game (`leagueCopiesFiledAgainstNobody`).
 */
export type LeagueFixture = {
  away: string;
  home: string;
  date: string;
  awayRuns?: number;
  homeRuns?: number;
};

/**
 * The final scores of a season's games as one string, for a memo to key on.
 *
 * The bridge reads the pool from storage each time its fixtures change, and a season's logs change
 * with every keystroke in a score box. Keyed on this instead, it reads again when a final result
 * changes and not when a game in progress is typed into, or a hit is added to a finished one.
 */
export const finalScoresKey = (matchups: Matchup[], logs: Record<string, GameLog>): string => {
  const finals: [string, number, number][] = [];
  matchups.forEach((matchup) => {
    const log = logs[matchup.id];
    if (!isFinal(log)) return;
    const away = scoreFor(log, "away");
    const home = scoreFor(log, "home");
    if (Number.isFinite(away) && Number.isFinite(home)) finals.push([matchup.id, away, home]);
  });
  return JSON.stringify(finals);
};

/** A season's schedule as the bridge reads it, with the runs of each final game (`finalScoresKey`). */
export const leagueFixturesOf = (
  teams: TeamBase[],
  matchups: Matchup[],
  finalScores: string
): LeagueFixture[] => {
  const nameById = new Map(teams.map((team) => [team.id, team.name]));
  const runs = new Map<string, [number, number]>();
  (JSON.parse(finalScores) as [string, number, number][]).forEach(([id, away, home]) =>
    runs.set(id, [away, home])
  );
  return matchups.map((matchup) => {
    const final = runs.get(matchup.id);
    return {
      away: nameById.get(matchup.away) ?? "",
      home: nameById.get(matchup.home) ?? "",
      date: matchup.date,
      ...(final ? { awayRuns: final[0], homeRuns: final[1] } : {}),
    };
  });
};

/** One outside result, in the shape `buildPredictionEngine` takes (`ExternalResult`). */
export type ScoutBridgeResult = {
  home: string;
  away: string;
  homeMargin: number;
  /**
   * When it was played, in the league's own date format. Carried so the parts of the forecast that
   * care *when* — recent form, which walks a season in order — can place a tournament
   * game among the league's own. Optional exactly as the game's own date is: an undated result
   * still rates, because the rating does not care about order, and is left out of the two that do
   * rather than guessed into a position.
   */
  date?: string;
  /** The pair order is the order it was typed, so this must not reach the home-field estimate. */
  neutral: true;
};

/** How a league team came to be pointed at a pool club, if it is. */
export type ScoutLinkHow =
  /** A person chose it. */
  | "picked"
  /** The name matched, and nobody has said otherwise. Shown as a guess, never as settled. */
  | "guessed"
  /** A person said this team is not in Team Rankings. */
  | "off"
  /** Nothing is behind it, for one of the reasons the fields below name. */
  | "none";

export type ScoutLinkRow = {
  leagueTeamId: string;
  leagueTeamName: string;
  how: ScoutLinkHow;
  /** The pool club behind it, for "picked" and "guessed". */
  scoutTeamId?: string;
  /** That club's name, so a guess can be shown rather than merely reported. */
  suggestedName?: string;
  /** The stored pick, when the pool no longer holds a club with that id. */
  staleScoutTeamId?: string;
  /**
   * The stored pick, when the club under its id no longer carries the GameChanger id it was picked
   * by and no one club does: another club's id now, and used for none (`readPick`).
   */
  movedScoutTeamId?: string;
  /** The other league teams that picked the same club. Set on every row of the clash. */
  conflictWith?: string[];
  /** How many pool clubs on this season's pages carry this name, when it is more than one. */
  ambiguousCount?: number;
  /**
   * League opponents this club has also played. Set when that is what picked it out of several of
   * one name, so a guess can say what convinced it rather than merely asserting.
   */
  sharedOpponents?: number;
};

export type LeagueScoutBridge = {
  results: ScoutBridgeResult[];
  /** Whether any age group claims this season. Nothing can come across when none does. */
  seasonLinked: boolean;
  /** One row per league team, in roster order. */
  rows: ScoutLinkRow[];
  /** Rows with a pool club behind them, chosen or guessed. */
  linkedCount: number;
  /** `results.length`, named so the UI does not have to explain what it is counting. */
  countedResults: number;
  /**
   * The squad year the season is linked to, which is what places the league's "M/D" dates among
   * the results' ISO days when the forecast puts them in order (`playedOn`). Absent when no page
   * claiming the season has a year.
   */
  squadYear?: number;
};

/** Who each league team is, as `linkLeagueTeams` settles it, and the lookups built on the way. */
type LeagueTeamLinks = {
  /** The pages that claim this season. */
  linked: Set<string>;
  /** The roster's clubs by id, kept for as long as the roster is (`clubsById`): read, never added to. */
  scoutById: ReadonlyMap<string, ScoutTeam>;
  /** The games on the pages that claim this season, in the order the list holds them. */
  seasonGames: ScoutGame[];
  /** One row per league team, in roster order. */
  rows: ScoutLinkRow[];
  /** The league team a person picked each club for. */
  leagueIdByScoutId: Map<string, string>;
  /** The league team each guessed name key went to. */
  leagueIdByName: Map<string, string>;
  /**
   * The clubs under a moved pick's id (`movedScoutTeamId`): the clubs the picks are not. The name
   * match passes them by, and so must anything that reads a club as its league team by its name.
   */
  movedAway: Set<string>;
};

/**
 * A roster's clubs by id, and where each page's games sit in a list of games, each made once for
 * the array it reads. `linkLeagueTeams` runs for every League Standings season, on every open of
 * League Standings and every change on Team Rankings, and on the server for every board and every
 * question, and it is handed the same nationwide roster and the same year's games every time: each
 * run indexed the whole roster and walked every game of the year twice to find its own pages', and
 * the bridge walked them twice more. On the seeded full-size pool (121,204 clubs, 344,553 games),
 * asked again, the bridge for its three seasons took about 0.95 s with these kept against 1.2 s
 * with the names remembered alone (`teamNameKey`), the same to the digit. Kept, they hold about
 * 12 MB of the roster and 2 MB of a year's 239,405 games in Node, for as long as their arrays.
 *
 * Kept against the array, as the indexes of a roster's names are (`similarIndex`, `idsByName`): a
 * roster and a list of games are replaced when what they hold changes, never changed in place, and
 * the storage cache hands out the arrays it decodes on those terms, so an array stands for what it
 * held when it was indexed. The WeakMap lets go of an index with its array.
 */
const clubsByIdOf = new WeakMap<readonly ScoutTeam[], ReadonlyMap<string, ScoutTeam>>();
const clubsById = (teams: readonly ScoutTeam[]): ReadonlyMap<string, ScoutTeam> => {
  const held = clubsByIdOf.get(teams);
  if (held) return held;
  const made = new Map(teams.map((team) => [team.id, team]));
  clubsByIdOf.set(teams, made);
  return made;
};
const placesByPageOf = new WeakMap<readonly ScoutGame[], ReadonlyMap<string, readonly number[]>>();
/** The games of `games` on `pages`, in the order `games` holds them, as a walk of it finds them. */
const gamesOnPagesOf = (games: readonly ScoutGame[], pages: ReadonlySet<string>): ScoutGame[] => {
  let places = placesByPageOf.get(games);
  if (!places) {
    const made = new Map<string, number[]>();
    games.forEach((game, at) => {
      const held = made.get(game.ageGroupId);
      if (held) held.push(at);
      else made.set(game.ageGroupId, [at]);
    });
    placesByPageOf.set(games, made);
    places = made;
  }
  const found: number[] = [];
  pages.forEach((page) => {
    for (const at of places.get(page) ?? []) found.push(at);
  });
  // Two pages' games lie mixed in the list, and whatever reads them in order reads the list's.
  if (pages.size > 1) found.sort((a, b) => a - b);
  const onPages: ScoutGame[] = [];
  for (const at of found) {
    const game = games[at];
    if (game) onPages.push(game);
  }
  return onPages;
};

/**
 * Which pool club each league team is: the club a person picked (`TeamBase.scoutTeamId`), and
 * otherwise the one club of its name with a game on this season's pages, told apart from a
 * namesake there by who it has played. Its own function because both directions across the bridge
 * read it — the league's forecast (`leagueScoutBridge`) and the league's games carried into Team
 * Rankings (`deriveLeagueScoutGames`) — and two answers to "who is this team" are how one game
 * comes to be counted twice.
 */
export const linkLeagueTeams = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  leagueTeams: LeagueTeamLink[],
  seasonFixtures: LeagueFixture[]
): LeagueTeamLinks => {
  const linked = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  const scoutById = clubsById(teams);
  const seasonGames = gamesOnPagesOf(games, linked);

  // Only clubs with a game on one of this season's pages can ever reach it, so only those are
  // candidates for a name match — which also means two clubs of one name elsewhere in a nationwide
  // pool are not an ambiguity here.
  const inSeason = new Set<string>();
  seasonGames.forEach((game) => {
    inSeason.add(game.teamAId);
    inSeason.add(game.teamBId);
  });
  const scoutIdsByName = new Map<string, string[]>();
  inSeason.forEach((scoutTeamId) => {
    const team = scoutById.get(scoutTeamId);
    // A slot names nobody; matching a league team onto one would attach it to another game's
    // unknown opponent. And a club made for a league team said not to be in Team Rankings is that
    // team's alone, found by no name (`offClubIdFor`), whatever has since been filed against it.
    if (!team || team.placeholder || isOffClubId(scoutTeamId)) return;
    const key = teamNameKey(team.name);
    const bucket = scoutIdsByName.get(key);
    if (bucket) bucket.push(scoutTeamId);
    else scoutIdsByName.set(key, [scoutTeamId]);
  });

  /**
   * Who each pool club on this season's pages has played, and who each league team plays, both by
   * name key. Two clubs of one name are told apart by who they have played: a schedule is much
   * harder to coincide with than a name, and it is the same reasoning the importer uses to decide
   * which club an opponent's name belongs to.
   */
  const playedByScoutId = new Map<string, Set<string>>();
  seasonGames.forEach((game) => {
    const note = (id: string, otherId: string) => {
      const other = scoutById.get(otherId);
      if (!other || other.placeholder) return;
      const bucket = playedByScoutId.get(id) ?? new Set<string>();
      bucket.add(teamNameKey(other.name));
      playedByScoutId.set(id, bucket);
    };
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });
  const leagueOpponentsByTeam = new Map<string, Set<string>>();
  leagueTeams.forEach((team) => {
    const key = teamNameKey(team.name);
    const opponents = new Set<string>();
    seasonFixtures.forEach((fixture) => {
      if (teamNameKey(fixture.away) === key) opponents.add(teamNameKey(fixture.home));
      else if (teamNameKey(fixture.home) === key) opponents.add(teamNameKey(fixture.away));
    });
    leagueOpponentsByTeam.set(team.id, opponents);
  });
  const sharedOpponents = (leagueTeamId: string, scoutTeamId: string): number => {
    const mine = leagueOpponentsByTeam.get(leagueTeamId);
    const theirs = playedByScoutId.get(scoutTeamId);
    if (!mine || !theirs) return 0;
    let shared = 0;
    theirs.forEach((key) => {
      if (mine.has(key)) shared += 1;
    });
    return shared;
  };

  // Each pick as it now reads: followed by its GameChanger id where the pool gave its id to another
  // club, and `moved` where no one club carries the id (`readPick`).
  const carriersOf = gcCarriersOf(teams);
  const picks = new Map(
    leagueTeams.map((team) => [team.id, readPick(team, scoutById, carriersOf)] as const)
  );

  // Who has picked what, so a club two league teams both claim can be refused rather than given to
  // whichever happens to be first in the roster.
  const claimedBy = new Map<string, string[]>();
  leagueTeams.forEach((team) => {
    const pick = picks.get(team.id)?.pick;
    if (!pick || pick === NO_SCOUT_TEAM || !scoutById.has(pick)) return;
    const holders = claimedBy.get(pick);
    if (holders) holders.push(team.id);
    else claimedBy.set(pick, [team.id]);
  });

  const rows: ScoutLinkRow[] = [];
  const leagueIdByScoutId = new Map<string, string>();
  const movedAway = new Set<string>();
  /** The league teams still open to a name match, once every answer has been read. */
  const unanswered: { team: LeagueTeamLink; key: string; not?: string }[] = [];

  leagueTeams.forEach((team) => {
    const base = { leagueTeamId: team.id, leagueTeamName: team.name };
    const { pick, moved } = picks.get(team.id) ?? {};

    if (moved) {
      // The club under the pick's id is another club now, and no one club carries the id it was
      // picked by: that club is not used, and the name match recovers as for a pick gone, never
      // onto the club the id now names.
      unanswered.push({ team, key: teamNameKey(team.name), not: moved });
      movedAway.add(moved);
      rows.push({ ...base, how: "none", movedScoutTeamId: moved });
      return;
    }
    if (pick === NO_SCOUT_TEAM) {
      // An answer, so the name match is off for this team too.
      rows.push({ ...base, how: "off" });
      return;
    }
    if (pick && !scoutById.has(pick)) {
      // A reset, a restore from elsewhere, or a tidy that folded this club into another. The fold
      // keeps the name (see mergeSameSquadIds / isSettledPairing), so the name match is the right
      // recovery — but the person is told, because the fold is not obliged to.
      unanswered.push({ team, key: teamNameKey(team.name) });
      rows.push({ ...base, how: "none", staleScoutTeamId: pick });
      return;
    }
    if (pick) {
      const holders = claimedBy.get(pick) ?? [];
      if (holders.length > 1) {
        // Two teams cannot be one club. Neither pick is honoured and neither falls back to a name:
        // re-guessing what a person has answered contradictorily is the very thing this replaced.
        rows.push({
          ...base,
          how: "none",
          scoutTeamId: pick,
          conflictWith: holders.filter((id) => id !== team.id),
        });
        return;
      }
      leagueIdByScoutId.set(pick, team.id);
      rows.push({
        ...base,
        how: "picked",
        scoutTeamId: pick,
        ...(scoutById.get(pick) ? { suggestedName: scoutById.get(pick)!.name } : {}),
      });
      return;
    }

    unanswered.push({ team, key: teamNameKey(team.name) });
    rows.push({ ...base, how: "none" });
  });

  const rowFor = new Map(rows.map((row) => [row.leagueTeamId, row]));
  const leagueIdByName = new Map<string, string>();
  unanswered.forEach(({ team, key, not }) => {
    const row = rowFor.get(team.id)!;
    // A club somebody has already chosen is spoken for; its namesake is not a substitute for it.
    const candidates = (scoutIdsByName.get(key) ?? []).filter(
      (scoutTeamId) => !leagueIdByScoutId.has(scoutTeamId) && scoutTeamId !== not
    );
    if (candidates.length === 0) return;
    let only = candidates[0]!;
    if (candidates.length > 1) {
      // Two clubs of one name: ask their schedules. The one that has played the clubs this league
      // team plays is the one, and where that is not decisive the answer is to say so rather than
      // to credit both clubs' games to whichever came first.
      const scored = candidates
        .map((scoutTeamId) => ({ scoutTeamId, shared: sharedOpponents(team.id, scoutTeamId) }))
        .sort((a, b) => b.shared - a.shared);
      const best = scored[0]!;
      const tied = scored.filter((candidate) => candidate.shared === best.shared);
      if (best.shared === 0 || tied.length > 1) {
        row.ambiguousCount = candidates.length;
        return;
      }
      only = best.scoutTeamId;
      row.sharedOpponents = best.shared;
    }
    leagueIdByName.set(key, team.id);
    row.how = "guessed";
    row.scoutTeamId = only;
    row.suggestedName = scoutById.get(only)?.name;
  });

  return {
    linked,
    scoutById,
    seasonGames,
    rows,
    leagueIdByScoutId,
    leagueIdByName,
    movedAway,
  };
};

/**
 * Which Team Rankings club each league team is, and the outside results that follow from it.
 *
 * The results half is what the league's ratings read: games logged in Team Rankings for an age
 * group that includes this season, minus the ones that came *from* the league schedule in the first
 * place. Counting those twice would quietly double the weight of every league game. "Came from the
 * league" covers two shapes: a row `deriveLeagueScoutGames` built carries the `league_` prefix, and
 * a row a GameChanger pull stored for a league fixture does not — it looks exactly like a tournament
 * result — so it is matched against `seasonFixtures` the way `dedupeLeagueFixtures` matches one:
 * same two clubs, by name or by the league teams they are linked to, same calendar day.
 *
 * The linking half used to be a name match and nothing else, and it failed silently: the league
 * roster says "Trash Pandas" where GameChanger says "Trash Pandas Baseball Club", so that club's
 * results were filed under an opponent of its own and sharpened nothing, with no message anywhere.
 * A person's answer (`TeamBase.scoutTeamId`) now decides it; the name match survives as the
 * suggestion, and every row says which of the two it was — which is the point of returning `rows`
 * rather than only the results.
 *
 * An opponent with no league counterpart still keeps an id of its own, so the rating model can
 * estimate how good it was instead of assuming — that is the whole value of the bridge: a shared
 * tournament opponent is what lets two league teams that never met be compared.
 */
export const leagueScoutBridge = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  leagueTeams: LeagueTeamLink[],
  /**
   * This season's own schedule — league team *names* and the league's own date string — so a
   * stored game that is really one of these fixtures can be recognised. Required rather than
   * optional so a new caller has to answer the question instead of silently reopening the leak.
   */
  seasonFixtures: LeagueFixture[]
): LeagueScoutBridge => {
  const { linked, scoutById, seasonGames, rows, leagueIdByScoutId, leagueIdByName, movedAway } =
    linkLeagueTeams(seasonId, ageGroups, teams, games, leagueTeams, seasonFixtures);
  const seasonLinked = linked.size > 0;

  /** A league team's own id where one is behind this club; otherwise an id of this club's own. */
  const ratingId = (scoutTeamId: string): string => {
    const explicit = leagueIdByScoutId.get(scoutTeamId);
    if (explicit) return explicit;
    // The club a moved pick is not, though it bears the name a namesake was guessed by: its
    // results are its own, never the league team's (Codex, on #503).
    if (movedAway.has(scoutTeamId)) return `${SCOUT_ID_PREFIX}${scoutTeamId}`;
    const team = scoutById.get(scoutTeamId);
    const matched = team ? leagueIdByName.get(teamNameKey(team.name)) : undefined;
    return matched ?? `${SCOUT_ID_PREFIX}${scoutTeamId}`;
  };

  /** Two names and a day as one order-free key, so away-vs-home compares equal either way. */
  const nameFixtureKey = (away: string, home: string, date: string): string => {
    const day = normalizeDateInput(date ?? "");
    if (!day) return "";
    return `${[teamNameKey(away), teamNameKey(home)].sort().join("|")}|${day}`;
  };
  const fixtureKeys = new Set(
    seasonFixtures
      .map(({ away, home, date }) => nameFixtureKey(away, home, date))
      .filter((key) => key !== "")
  );
  /*
   * The same fixtures as pairs of league teams, for a club linked under a name of its own: a
   * roster's "Trash Pandas" picked as GameChanger's "Trash Pandas Baseball Club". By names alone
   * the pull's copy of a league game read as a tournament result, and the forecast counted the
   * league's own game twice — which is the leak this whole check exists to close.
   */
  const leagueIdByKey = new Map<string, string>();
  leagueTeams.forEach((team) => {
    const key = teamNameKey(team.name);
    if (!leagueIdByKey.has(key)) leagueIdByKey.set(key, team.id);
  });
  const teamsFixtureKey = (a: string, b: string, date: string): string => {
    const day = normalizeDateInput(date ?? "");
    return day ? `${[a, b].sort().join("|")}|${day}` : "";
  };
  const fixtureTeamKeys = new Set(
    seasonFixtures
      .map(({ away, home, date }) => {
        const awayId = leagueIdByKey.get(teamNameKey(away));
        const homeId = leagueIdByKey.get(teamNameKey(home));
        return awayId && homeId ? teamsFixtureKey(awayId, homeId, date) : "";
      })
      .filter((key) => key !== "")
  );
  /*
   * A league team answered Not here has no club behind it, so a copy of its league game names some
   * club of its name: the import's stand-in for it, a pulled club the import filed it against, a
   * club typed in, any whose name fits the team's ("Angels Red" for "Cincinnati Angels Red"). The
   * rankings file such a copy with the league's game (`dedupeLeagueFixtures`), and so does this:
   * a copy whose one club is the league team that played such a team that day and whose other
   * club's name fits that team's, or, for a game between two such teams, whose clubs fit one name
   * each, where only one league game that day is one it could be.
   */
  const offIds = new Set(
    leagueTeams.filter((team) => team.scoutTeamId === NO_SCOUT_TEAM).map((team) => team.id)
  );
  const offGamesOn = new Map<string, Map<string, readonly [string, string]>>();
  if (offIds.size > 0) {
    seasonFixtures.forEach(({ away, home, date }) => {
      const awayId = leagueIdByKey.get(teamNameKey(away));
      const homeId = leagueIdByKey.get(teamNameKey(home));
      if (!awayId || !homeId || (!offIds.has(awayId) && !offIds.has(homeId))) return;
      const day = normalizeDateInput(date ?? "");
      if (!day) return;
      const games = offGamesOn.get(day) ?? new Map<string, readonly [string, string]>();
      games.set([awayId, homeId].sort().join("|"), [awayId, homeId]);
      offGamesOn.set(day, games);
    });
  }
  const leagueNameOf = new Map(leagueTeams.map((team) => [team.id, team.name]));
  const fits = nameFitter();
  /** Whether a club in a copy could be what it called this league team. */
  const standsFor = (scoutTeamId: string, leagueTeamId: string): boolean => {
    if (!offIds.has(leagueTeamId)) return ratingId(scoutTeamId) === leagueTeamId;
    const club = scoutById.get(scoutTeamId);
    const name = leagueNameOf.get(leagueTeamId);
    return club !== undefined && !club.placeholder && name !== undefined && fits(club.name, name);
  };
  const isOffTeamFixture = (game: ScoutGame): boolean => {
    if (offGamesOn.size === 0) return false;
    const day = normalizeDateInput(game.date ?? "");
    const fixtures = day ? offGamesOn.get(day) : undefined;
    if (!fixtures) return false;
    const { teamAId: x, teamBId: y } = game;
    let could = 0;
    fixtures.forEach(([a, b]) => {
      if ((standsFor(x, a) && standsFor(y, b)) || (standsFor(x, b) && standsFor(y, a))) could += 1;
    });
    return could === 1;
  };

  /*
   * A league club's own pulled row filed against nobody the league names: "TBD- 09/25/26, 7:15 PM"
   * for 513 Force - Bouley's 0-13 to the Hornets, or "513 Force" on the Angels' schedule. It shares
   * no names with the fixture, so it read as a tournament result and the forecast counted the
   * league's game twice. The same rule the rankings apply picks these out, read against the league's
   * own final scores under the clubs the league teams are linked to: a team with no club behind it
   * has no row of its own in the pool to be a copy.
   */
  const slotCopies = new Set<string>();
  if (seasonLinked && seasonFixtures.some((fixture) => fixture.awayRuns !== undefined)) {
    const clubOfLeague = new Map<string, string>();
    rows.forEach((row) => {
      if ((row.how === "picked" || row.how === "guessed") && row.scoutTeamId) {
        clubOfLeague.set(row.leagueTeamId, row.scoutTeamId);
      }
    });
    /*
     * A league team with no club behind it stands in under its league name, so a row filed against
     * "TBD" by the club it played still pairs, and a stand-in's name can still be read against it.
     * It has no schedule in the pool, so no row is ever taken for its own.
     */
    const unlinked = new Map<string, ScoutTeam>();
    const clubOf = (name: string): string | undefined => {
      const leagueTeamId = leagueIdByKey.get(teamNameKey(name));
      if (!leagueTeamId) return undefined;
      const club = clubOfLeague.get(leagueTeamId);
      if (club) return club;
      const id = `${SCOUT_ID_PREFIX}league:${leagueTeamId}`;
      if (!unlinked.has(id)) unlinked.set(id, { id, name, nameOnly: true });
      return id;
    };
    const finals: ScoutGame[] = [];
    seasonFixtures.forEach((fixture, index) => {
      if (fixture.awayRuns === undefined || fixture.homeRuns === undefined) return;
      const away = clubOf(fixture.away);
      const home = clubOf(fixture.home);
      if (!away || !home) return;
      linked.forEach((ageGroupId) =>
        finals.push({
          id: `${LEAGUE_GAME_PREFIX}${seasonId}_fixture${index}_${ageGroupId}`,
          ageGroupId,
          teamAId: away,
          teamBId: home,
          teamAScore: fixture.awayRuns,
          teamBScore: fixture.homeRuns,
          date: fixture.date,
        })
      );
    });
    if (finals.length > 0) {
      const rowsHere = seasonGames.filter((game) => !game.id.startsWith(LEAGUE_GAME_PREFIX));
      const both = [...finals, ...rowsHere];
      leagueCopiesFiledAgainstNobody(
        both,
        leagueStandIns([...teams, ...unlinked.values()])
      ).forEach((index) => slotCopies.add(both[index]!.id));
    }
  }

  const isSeasonFixture = (game: ScoutGame): boolean => {
    if (slotCopies.has(game.id)) return true;
    if (isOffTeamFixture(game)) return true;
    if (fixtureKeys.size === 0) return false;
    const away = scoutById.get(game.teamAId)?.name;
    const home = scoutById.get(game.teamBId)?.name;
    if (!away || !home) return false;
    const key = nameFixtureKey(away, home, game.date ?? "");
    if (key !== "" && fixtureKeys.has(key)) return true;
    // A club with no league team behind it keeps an id of its own, which no fixture carries.
    const teamsKey = teamsFixtureKey(
      ratingId(game.teamAId),
      ratingId(game.teamBId),
      game.date ?? ""
    );
    return teamsKey !== "" && fixtureTeamKeys.has(teamsKey);
  };

  /** Whether a pool club is one of this league's teams, rather than a stranger on the same page. */
  const isLeagueClub = (scoutTeamId: string): boolean =>
    !ratingId(scoutTeamId).startsWith(SCOUT_ID_PREFIX);

  const onLinkedPage = seasonGames.filter(
    (game) =>
      !game.id.startsWith(LEAGUE_GAME_PREFIX) && !isSeasonFixture(game) && countsTowardRating(game)
  );

  /**
   * Clubs a league team has actually played. Their other results are what place the league on the
   * same scale as everyone else — beating a club that beat a good club is the evidence an
   * opponent-adjusted rating runs on — so they come too, one step out and no further.
   */
  const played = new Set<string>();
  onLinkedPage.forEach((game) => {
    if (isLeagueClub(game.teamAId)) played.add(game.teamBId);
    if (isLeagueClub(game.teamBId)) played.add(game.teamAId);
  });

  /**
   * Only the games that touch the league.
   *
   * A linked page used to mean "this league's own age group", where every game on it was about
   * these teams. A GameChanger pull files the whole country there instead: on a real pool the page
   * a ten-team league was linked to held 8,689 clubs and 9,266 scored games, every one of which
   * was handed to the forecast. They carry nothing — a club in another state never played anyone
   * here, so the fit cannot learn anything about the league from it — and they cost, because ridge
   * shrinkage then pulls each league team toward the mean of a national pool it has no connection
   * to. What is kept is the league's own results and its opponents', which is the whole of what
   * the graph can reach.
   */
  const touchesLeague = (game: ScoutGame): boolean =>
    isLeagueClub(game.teamAId) ||
    isLeagueClub(game.teamBId) ||
    played.has(game.teamAId) ||
    played.has(game.teamBId);

  const results: ScoutBridgeResult[] = !seasonLinked
    ? []
    : onLinkedPage.filter(touchesLeague).map((game) => ({
        home: ratingId(game.teamAId),
        away: ratingId(game.teamBId),
        homeMargin: ratedMargin(game)!,
        ...(game.date ? { date: game.date } : {}),
        neutral: true as const,
      }));

  const squadYear = squadYearForLeagueSeason(seasonId, ageGroups);
  return {
    results,
    seasonLinked,
    rows,
    linkedCount: rows.filter((row) => row.how === "picked" || row.how === "guessed").length,
    countedResults: results.length,
    ...(squadYear !== undefined ? { squadYear } : {}),
  };
};

/** A pool club that could be this league team, and the evidence for it. */
const SEASON_ORDER = ["winter", "spring", "summer", "fall"];

/**
 * The GameChanger seasons a club's teams are set up in, oldest first: "Fall 2026, Spring 2027".
 * One club name can be a fall team and a spring team at the same age, and the rows read the same
 * without it.
 */
export const seasonsOf = (club: {
  gcTeams?: readonly { season?: string; seasonYear?: number }[];
}): string => {
  const seen = new Map<string, { year: number; order: number; label: string }>();
  for (const link of club.gcTeams ?? []) {
    const season = link.season?.trim().toLowerCase();
    if (!season || link.seasonYear === undefined) continue;
    const label = `${season.charAt(0).toUpperCase()}${season.slice(1)} ${link.seasonYear}`;
    const order = SEASON_ORDER.indexOf(season);
    seen.set(label, {
      year: link.seasonYear,
      order: order < 0 ? SEASON_ORDER.length : order,
      label,
    });
  }
  return [...seen.values()]
    .sort((a, b) => a.year - b.year || a.order - b.order)
    .map((one) => one.label)
    .join(", ");
};

export type ScoutLinkCandidate = {
  scoutTeamId: string;
  name: string;
  city?: string;
  state?: string;
  /**
   * Clubs this league team plays in its league, that this pool club has also played. This is the
   * evidence that matters: two clubs of one name are told apart by who they have played, and a
   * schedule is far harder to coincide with than a name.
   */
  sharedOpponents: string[];
  /** Games it has on this season's pages at all, as a tiebreak when nobody shares an opponent. */
  games: number;
  /**
   * The age GameChanger has it at in this season's year, when it says. Shown in the picker: two
   * clubs of one name in one town are told apart by nothing else on the row, and a person looking
   * at "Cincy Stix Navy · Harrison, OH" twice over cannot pick between them.
   */
  ageLevel?: number;
  /** Who coaches it (`coachesOf`), which a person linking their own league's team usually knows. */
  coaches?: string[];
  /**
   * Its GameChanger ids, so a pasted id or link finds it in the picker, the season's own first: the
   * one a pick of it keeps (`gcIdsForSeason`).
   */
  gcIds?: string[];
  /** The GameChanger seasons its teams are set up in (`seasonsOf`), "Fall 2026, Spring 2027". */
  seasons?: string;
};

/**
 * A club's GameChanger ids as a League pick is offered them, the one the pick keeps beside it first
 * (`TeamBase.scoutGcTeamId`): the teams filed on a page that claims the season (`pages`), then those
 * in a squad year it sits in (`years`), then the rest, and in each the last pulled first, since a
 * pull puts the team it pulled at the end of the club's list (`withLink`).
 *
 * The season's own team, because it is the one that stays the club's longest. A club carries a
 * team for every season it was pulled in, and the first listed is the one pulled longest ago: kept
 * with a pick, last year's squad deleted, that team taken off the club, or Team Rankings started
 * again and only this season's teams pulled back, each took it off a club that was still the
 * league's, and the pick read as moved, its outside results gone from the forecast.
 */
export const gcIdsForSeason = (
  pages: ReadonlySet<string>,
  years: Iterable<number | undefined>,
  ageGroups: AgeGroup[]
): ((club: { gcTeams?: readonly GcTeamLink[] }) => string[]) => {
  const yearOf = gcLinkSquadYearIn(ageGroups);
  const inYears = new Set(years);
  inYears.delete(undefined);
  const placeOf = (link: GcTeamLink): number => {
    if (pages.has(link.ageGroupId)) return 0;
    const year = yearOf(link);
    return year !== undefined && inYears.has(year) ? 1 : 2;
  };
  return (club) =>
    (club.gcTeams ?? [])
      .map((link, at) => ({ id: link.teamId, place: placeOf(link), at }))
      .sort((a, b) => a.place - b.place || b.at - a.at)
      .map((link) => link.id);
};

/**
 * Which pool clubs could be a given league team, best evidence first.
 *
 * The country is full of Trash Pandas, so a name cannot answer "which one". A schedule can. This
 * league team plays a known set of opponents; a pool club has played a known set of opponents; the
 * club that has played the same clubs is the club. One name in common is weak and three is close to
 * certain, so the count is returned rather than a verdict — the panel shows it and a person decides.
 *
 * Opponents are compared by name because that is the only thing the two halves share: the league
 * and Team Rankings keep separate ids for the same club, which is the very problem being solved.
 */
export const scoutLinkCandidates = (
  leagueTeamName: string,
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  /** This season's own schedule, as league names: who this team plays. */
  seasonFixtures: LeagueFixture[]
): ScoutLinkCandidate[] => {
  const pages = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  if (pages.size === 0) return [];
  const scoutById = new Map(teams.map((team) => [team.id, team]));
  const meKey = teamNameKey(leagueTeamName);

  // Who this league team plays, by name key.
  const leagueOpponents = new Set<string>();
  seasonFixtures.forEach((fixture) => {
    if (teamNameKey(fixture.away) === meKey) leagueOpponents.add(teamNameKey(fixture.home));
    else if (teamNameKey(fixture.home) === meKey) leagueOpponents.add(teamNameKey(fixture.away));
  });

  // Who each pool club on this season's pages has played, by name key.
  const played = new Map<string, Map<string, string>>();
  const gameCount = new Map<string, number>();
  const note = (id: string, otherId: string) => {
    const other = scoutById.get(otherId);
    gameCount.set(id, (gameCount.get(id) ?? 0) + 1);
    if (!other || other.placeholder) return;
    const bucket = played.get(id) ?? new Map<string, string>();
    bucket.set(teamNameKey(other.name), other.name);
    played.set(id, bucket);
  };
  games.forEach((game) => {
    if (!pages.has(game.ageGroupId)) return;
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });

  /*
   * The board this season is on, and the squad year it sits in. A page holds cross-age games, so
   * being on it is not on its own evidence of being the right age: an 11U club that played down
   * here is on this page and is not the 10U team anybody is naming.
   */
  const levels = levelsForSeason(seasonId, ageGroups);
  const years = yearsForSeason(seasonId, ageGroups);
  const gcIdsOf = gcIdsForSeason(pages, years, ageGroups);

  const candidates: ScoutLinkCandidate[] = [];
  gameCount.forEach((count, scoutTeamId) => {
    const team = scoutById.get(scoutTeamId);
    // GameChanger-known, and at this board's level or one below it — see `clubIsPickable`.
    if (!team || !clubIsPickable(team, levels, years, ageGroups)) return;
    const opponents = played.get(scoutTeamId);
    const shared: string[] = [];
    opponents?.forEach((name, key) => {
      if (leagueOpponents.has(key)) shared.push(name);
    });
    shared.sort((a, b) => a.localeCompare(b));
    const ageLevel = gcAgeLevels(team, years[0], ageGroups)[0];
    const coaches = coachesOf(team);
    const seasons = seasonsOf(team);
    candidates.push({
      scoutTeamId,
      name: team.name,
      ...(team.city ? { city: team.city } : {}),
      ...(team.state ? { state: team.state } : {}),
      ...(ageLevel === undefined ? {} : { ageLevel }),
      ...(coaches.length > 0 ? { coaches } : {}),
      ...(team.gcTeams?.length ? { gcIds: gcIdsOf(team) } : {}),
      ...(seasons ? { seasons } : {}),
      sharedOpponents: shared,
      games: count,
    });
  });

  return candidates.sort(
    (a, b) =>
      b.sharedOpponents.length - a.sharedOpponents.length ||
      b.games - a.games ||
      a.name.localeCompare(b.name)
  );
};
