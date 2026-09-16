import type { GameLog, Matchup, TeamBase } from "./types";
import { buildOpponentAdjustedRatings } from "./powerRating";
import { clamp, isFinal, parseNumber } from "./util";
import { createTeamId } from "./sim";
import { normalizeDateInput } from "./date";

/**
 * Team Rankings is a separate, age-group-scoped-but-globally-rostered ranking pool: teams are a
 * single global list (the same real-world opponent is one entity across seasons/age levels), but a
 * ranking is only ever computed for one age group's games at a time (different age levels aren't
 * comparable). An age group is a user-defined label bundling together whichever League Standings
 * seasons belong to the same age level — e.g. "2027" might bundle a "Fall 2026" and a "Spring
 * 2027" season, since a club often runs two (or more) League Standings seasons per age-group year.
 */
export type AgeGroup = {
  id: string;
  /**
   * Display label, always derived from `ageLevel` + `year` for anything created since the season
   * picker shipped (`formatAgeGroupName`). Older groups were free text ("2027, 10U"), so this
   * stays the authoritative thing to *show*; `ageGroupSeason` is the thing to *reason* with.
   */
  name: string;
  /** Age level in years, 8-18, as in 10U. Absent on groups saved before the picker existed. */
  ageLevel?: number;
  /** Season year, as in the 2028 of "10U 2028". Absent on groups saved before the picker. */
  year?: number;
  /** League Standings `SeasonMeta.id`s that belong to this age group. */
  seasonIds: string[];
  /**
   * The earlier age group this one carries on from — last year's squad, e.g. "9U 2027" for a
   * "10U 2028". Only used to carry team-name suggestions forward as a squad ages up; results are
   * never pooled across age groups, since a 9U score says nothing about a 10U game.
   */
  continuesFromId?: string;
  /** "Our" team *in this age group*, so two squads running at once can each have one. */
  myTeamId?: string;
};

export type ScoutTeam = {
  id: string;
  name: string;
  /**
   * Legacy global "our team" marker, kept so rankings saved before `AgeGroup.myTeamId` existed
   * still highlight the right team. `AgeGroup.myTeamId` supersedes it — a club can run a 9U and an
   * 11U squad at once, and each needs its own — so new marks are written there instead.
   * Cosmetic/organizational only, either way: neither flag may feed into `buildTeamRankings` or
   * `predictMatchup`'s math. Our own team is ranked by the exact same opponent-adjusted formula as
   * everyone else.
   */
  isMine?: boolean;
  /**
   * Two-letter state, uppercase, when it is known. Optional on purpose: most opponents arrive from
   * a screenshot or a schedule that never says where they are from, and a team with no state is a
   * team you simply have not told, not a team from nowhere.
   */
  state?: string;
  /** City, when a source gave one. Display only, like `state`; it never reaches the maths. */
  city?: string;
  /**
   * A name that stood in for a team nobody had decided yet — "TBD", "Winner of Game 3", a blank
   * cell on a bracket. The game it came from is real and is kept, but the club on the other side
   * of it is not known, so this entity is a slot rather than a team.
   *
   * Two things follow, and both matter. Each placeholder is its own slot, never pooled with
   * another of the same name: one shared "TBD" would sit in the rating graph as an opponent that
   * dozens of unrelated teams had all played, and the fit would read that as evidence about how
   * they compare to each other. And a slot is never ranked, because there is no club to rank.
   *
   * It still stands in the fit as one unknown opponent of its own, which is how the game counts
   * for the team that played it: beating a slot reads as beating an ordinary team, because a
   * single game against a single opponent is pulled to the middle by the same shrinkage as any
   * other. Naming it later — renaming the slot onto the real club, which merges the two — moves
   * the game to where it always belonged.
   */
  placeholder?: true;
  /**
   * A club known only because somebody else's schedule named it as their opponent.
   *
   * There is no club behind it yet, only a name and perhaps a picture: no id anybody pulled, no
   * town, no state, and a record made of whatever fraction of its season happens to face a team
   * that *was* pulled. Rating that against clubs whose whole schedule is here would put a team
   * with one recorded win above teams that played thirty games, so it is left out of the tables —
   * exactly as a bracket slot is, and for the same reason.
   *
   * It still stands in the fit as the opponent it was, which is how the game counts for the club
   * that played it. Pull the club's own id, or add it by hand, and the mark comes off: at that
   * point it is a team somebody has vouched for, and it is ranked like any other.
   */
  nameOnly?: true;
  /**
   * The picture a club was listed with by whoever named it as their opponent.
   *
   * An opponent has no GameChanger id — a schedule never gives one — so there is no link to hang
   * its avatar on, and a name is not an identity in a pool holding a dozen clubs called the same
   * thing. The picture is, and it is the one thing that means the same on two schedules, so it is
   * kept here: the next schedule to name this club recognises it, and so does the club itself when
   * its own id is finally pulled. Without it a club named by two schedules becomes two teams and
   * its games are filed twice.
   */
  avatarKey?: string;
  /**
   * The GameChanger teams this team is known by, one per GameChanger season: GameChanger mints a
   * new team id every season, so a club's Fall and Spring squads arrive as two ids that the user
   * has paired onto one team here. Identity by id is what keeps the country's many "Yankees" apart:
   * two teams with different GameChanger ids are two teams, whatever they are called.
   */
  gcTeams?: GcTeamLink[];
};

/** One GameChanger team id and what GameChanger said about it the last time it was pulled. */
export type GcTeamLink = {
  /** GameChanger's public team id — the 12 characters in web.gc.com/teams/<id>. */
  teamId: string;
  /** The name exactly as GameChanger has it, age label and all, for matching and display. */
  name: string;
  /** The age group this GameChanger team's schedule is filed under. */
  ageGroupId: string;
  /** GameChanger's season for this team id: "fall", "winter", "spring" or "summer". */
  season?: string;
  /** The calendar year GameChanger gives that season ("Fall 2026" → 2026). */
  seasonYear?: number;
  /** The age level GameChanger lists, as a number (9 for "9U"). */
  ageLevel?: number;
  /**
   * The id of the team's avatar image. GameChanger names an opponent but never gives its team id;
   * the avatar it shows beside that name is the one stable thing that survives the trip, so a
   * matching avatar on someone else's schedule is how a name-only opponent is recognised as a team
   * already pulled by id.
   */
  avatarKey?: string;
  /** GameChanger's own season record when last pulled — a check on the games read, never rated. */
  record?: { win: number; loss: number; tie: number };
  /** When this id's schedule was last pulled, ISO timestamp. */
  importedAt?: string;
};

/** Where a game came from, when it was not typed in here. */
export type ScoutGameSource = {
  kind: "gamechanger";
  /** The GameChanger team whose schedule listed the game. */
  teamId: string;
  /** GameChanger's id for the game on that team's schedule — what a re-pull matches on. */
  gameId: string;
};

export type ScoutGame = {
  id: string;
  teamAId: string;
  teamBId: string;
  /**
   * Both present = a completed result (counts toward ratings/record). Both absent = a scheduled/
   * future game — logged so the team shows up in the pool ahead of time, but excluded from every
   * rating and record calculation until a score is entered.
   */
  teamAScore?: number;
  teamBScore?: number;
  /** References an `AgeGroup.id` — the age level this result belongs to. */
  ageGroupId: string;
  /**
   * Logged, but deliberately kept out of the ratings and records.
   *
   * Fall tournaments routinely pair a team against the age group above or below, depending on who
   * entered. Those games happened and are worth keeping — but a 10U beating an 8U says nothing
   * about how it stacks up against other 10Us, and letting it count would flatter or punish both
   * sides for something neither chose.
   */
  excluded?: boolean;
  date?: string;
  event?: string;
  note?: string;
  /**
   * The age level each side was playing at, when the source said (8 for 8U). Absent means the
   * level of the age group the game is filed under. They differ when a team plays up or down —
   * an 8U entering a 9U tournament — and that difference is what the rating model reads as an
   * age gap: see `AGE_GAP_RUNS_PER_YEAR` in powerRating.ts. Recorded per game rather than per
   * team because a team's level is a fact about a season, while what the source knows is which
   * level each game was played at.
   */
  ageLevelA?: number;
  ageLevelB?: number;
  /** Season label from the source, as in "Fall 2026" — display and filtering only. */
  season?: string;
  /**
   * When the game started, as the source gave it (an instant, in UTC). Only some sources know it,
   * and nothing is rated by it — it is here to tell two games of a doubleheader apart, which is
   * what makes it safe to say that one schedule's "TBD" and another schedule's named game are the
   * same fixture.
   */
  startTs?: string;
  /** Present when the game was pulled from GameChanger rather than typed in. */
  source?: ScoutGameSource;
};

/** A game only counts toward ratings/records once both scores are recorded. */
export const isScoutGamePlayed = (game: ScoutGame): boolean =>
  Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore);

export type ScoutRankingRow = {
  /** Rank in the unfiltered table, set only when a filter has renumbered `rank`. */
  overallRank?: number;
  teamId: string;
  teamName: string;
  isMine: boolean;
  rank: number;
  /** Opponent-adjusted expected margin vs an average team in this age group's pool, in runs. */
  rating: number;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  rawMargin: number;
  strengthOfSchedule: number;
  sosRank: number;
  /** Home level of this team in the pool's year, when known. */
  ageLevel?: number;
  /** Counted games against a side at a different level. */
  crossAgeGames: number;
  /** True when the team is pinned to at least one GameChanger id. */
  fromGameChanger: boolean;
};

export type MatchupTier = "Favored" | "Toss-up" | "Underdog";

export type MatchupPreview = {
  opponentId: string;
  opponentName: string;
  opponentRank: number;
  /** Positive favors the team the report was built for. */
  projectedMargin: number;
  winProb: number;
  tier: MatchupTier;
};

/**
 * The most run-differential any single game can contribute. A 20-0 counts as an 8-0: without a cap
 * one blowout against a weak team would outweigh a season of close wins against strong ones.
 *
 * Exported because the app explains its own ranking to the reader, and a number quoted in prose
 * that has drifted from the number in the maths is worse than not quoting it.
 */
export const RATING_CAP = 8;
/** Prefix guarantees a scout-created id can never collide with a league season's own team ids
 * (those are plain alphanumeric codes from `createTeamId` in sim.ts). */
const SCOUT_ID_PREFIX = "S-";

/**
 * "9U", "9u", "12 U", "U10" — an age level, anywhere in the name — and the division letters that
 * run straight on from it, as in "9UA" or "11UAA". The letters have to follow with no space, so
 * "12 United" and "9u Scout" keep the word that happens to come next.
 */
const AGE_LABEL = /\b(?:\d{1,2}\s*[uU][A-Da-d]{0,3}|[uU]\s*\d{1,2})\b/g;

/** An innermost bracketed aside, so nesting comes apart a layer at a time. */
const PARENTHETICAL = /\([^()]*\)/;

/**
 * Tidies a team name down to what the club is actually called.
 *
 * Two things come off. The **age label**, because an age level describes *this year's* squad, not
 * the club, and the same club plays up a level every year ("South Lexington Red 9u" becomes
 * "…10u") — keeping it would fragment one real-world team into a new entity every season, which
 * is what the age-group scoping already handles — the division letters on "11UAA" go with it,
 * since they are part of the same label. And anything in **parentheses**, which on a
 * GameChanger schedule is an aside rather than part of the name: a season, a division, a
 * tournament, a note somebody typed. Labels anywhere in the name are handled, so
 * "NV Stars 9u Scout" becomes "NV Stars Scout".
 *
 * What is *not* touched is a dash suffix — "9U North Oldham Knights - Navy", "Frisco Dodgers -
 * Gomez 11UAA". That is how a club tells its own squads apart, and it is the only thing
 * distinguishing two teams that would otherwise read alike, so it stays in the name and in the key
 * two names are compared by.
 */
export const cleanTeamName = (name: string): string => {
  let stripped = name;
  while (PARENTHETICAL.test(stripped)) stripped = stripped.replace(PARENTHETICAL, " ");
  stripped = stripped
    .replace(AGE_LABEL, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—,]+|[\s\-–—,]+$/g, "");
  // A name that is *only* an age label, or only an aside, still has to be called something.
  return stripped || name.trim();
};

/**
 * The key two names are compared by: age-label-free and case-insensitive. Exported so callers that
 * need to look a name up in the roster (the screenshot importer, for one) match names exactly the
 * way `resolveOrCreateTeam` does, instead of re-deriving the rule.
 */
export const teamNameKey = (name: string) =>
  cleanTeamName(name)
    .toLowerCase()
    // Punctuation between words is spacing, not spelling: "Wheaton Warriors - Grey", "Wheaton
    // Warriors Grey" and "Wheaton Warriors/Grey" are one name written three ways, and a pull
    // reads all three off different schedules. The suffix words themselves stay, so "Frisco
    // Dodgers Gomez" is still not "Frisco Dodgers".
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s*[-\u2013\u2014/]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const normalizeName = teamNameKey;

/**
 * Case-insensitive, age-label-insensitive name match against the pool; creates a new team if none
 * matches. A team stored before age labels were stripped ("Velocirabbits 9U") is healed in place on
 * its next match, so old entries converge without a migration.
 */
export const resolveOrCreateTeam = (
  name: string,
  teams: ScoutTeam[]
): { teams: ScoutTeam[]; teamId: string } => {
  const display = cleanTeamName(name);
  const key = normalizeName(name);
  // A placeholder names nobody, so two of them are not the same team and must never be matched
  // onto one another. Each gets a slot of its own, marked as one.
  if (isPlaceholderName(name)) {
    const minted = mintScoutTeamId(display, teams);
    return {
      teams: [...teams, { id: minted, name: display, placeholder: true }],
      teamId: minted,
    };
  }
  const existingIndex = teams.findIndex(
    (team) => !team.placeholder && normalizeName(team.name) === key
  );

  if (existingIndex >= 0) {
    const existing = teams[existingIndex]!;
    // Clean the *stored* name rather than adopting the incoming one, so its capitalization stands.
    const cleaned = cleanTeamName(existing.name);
    if (cleaned === existing.name) return { teams, teamId: existing.id };
    const next = teams.slice();
    next[existingIndex] = { ...existing, name: cleaned };
    return { teams: next, teamId: existing.id };
  }

  const uniqueId = mintScoutTeamId(display, teams);
  return { teams: [...teams, { id: uniqueId, name: display }], teamId: uniqueId };
};

/**
 * A fresh scout id for this name that none of `existingIds` already has.
 *
 * Taking the set rather than the roster matters when thousands of teams are created in one pass:
 * rebuilding it from the roster each time is what made a large import quadratic. A caller that
 * keeps its own set hands it in and the minting is constant.
 */
const mintScoutTeamIdFrom = (display: string, existingIds: ReadonlySet<string>): string => {
  const id = `${SCOUT_ID_PREFIX}${createTeamId(display, new Set())}`;
  let uniqueId = id;
  let counter = 2;
  while (existingIds.has(uniqueId)) {
    uniqueId = `${id}${counter}`;
    counter += 1;
  }
  return uniqueId;
};

/** A fresh scout id for this name that no team in the pool already has. */
const mintScoutTeamId = (display: string, teams: ScoutTeam[]): string =>
  mintScoutTeamIdFrom(display, new Set(teams.map((team) => team.id)));

/**
 * Creates a team without looking for one by name first. The GameChanger importer decides identity
 * itself — a team pulled by id *is* that id, and a name-only opponent is only ever matched after
 * the level and year have been checked — so it needs a way to add a team that will not quietly
 * fold "Yankees" into whichever other Yankees was stored first. Same id minting and age-label
 * stripping as `resolveOrCreateTeam`, so the two produce indistinguishable teams. `extras` fills
 * the optional fields (state, city, links); the id and name always come from here, and an
 * undefined extra adds no key, so a caller can pass what it has without checking each field.
 */
export const createScoutTeam = (
  name: string,
  teams: ScoutTeam[],
  extras: Partial<ScoutTeam> = {}
): { teams: ScoutTeam[]; teamId: string; team: ScoutTeam } => {
  const team = buildScoutTeam(name, new Set(teams.map((entry) => entry.id)), extras);
  return { teams: [...teams, team], teamId: team.id, team };
};

/**
 * The team `createScoutTeam` would make, without building a new roster to hold it. For a caller
 * adding thousands in one pass, which cannot afford a copy of the roster per team; the two share
 * this so the teams they produce stay indistinguishable.
 */
export const buildScoutTeam = (
  name: string,
  existingIds: ReadonlySet<string>,
  extras: Partial<ScoutTeam> = {}
): ScoutTeam => {
  const display = cleanTeamName(name).trim();
  const team: ScoutTeam = { id: mintScoutTeamIdFrom(display, existingIds), name: display };
  (Object.keys(extras) as (keyof ScoutTeam)[]).forEach((key) => {
    if (key === "id" || key === "name") return;
    const value = extras[key];
    if (value !== undefined) Object.assign(team, { [key]: value });
  });
  return team;
};

const scoreFor = (log: GameLog | undefined, side: "away" | "home") =>
  parseNumber(side === "away" ? (log?.awayRuns ?? "") : (log?.homeRuns ?? ""), Number.NaN);

export type LeagueSeasonSnapshot = {
  seasonId: string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
};

/**
 * Convert every League Standings season in an age group's *entire schedule* — not just completed
 * games — into scout-style games tagged with that age group, resolving each league team name into
 * the given global scout pool (creating entries the first time a league team name is seen — a team
 * that plays across two seasons in the same age group, e.g. Fall and Spring, resolves to the same
 * scout team both times). A not-yet-final league game comes across as a scheduled entry (no score,
 * same as a manually-logged future game), so its opponent already shows up in the age group ahead
 * of time; a completed one carries its score. Since this runs fresh from live League Standings data
 * on every call, a game that gets finalized there is picked up here as a real result automatically
 * the next time this runs — no separate sync step. Pure — the caller is responsible for loading
 * each season's data and for persisting any newly-created scout teams.
 */
/** Marks a game carried in from a League Standings schedule rather than logged here. */
export const LEAGUE_GAME_PREFIX = "league_";

export const deriveLeagueScoutGames = (
  ageGroupId: string,
  seasons: LeagueSeasonSnapshot[],
  scoutTeams: ScoutTeam[]
): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  let teams = scoutTeams;
  const games: ScoutGame[] = [];

  seasons.forEach(
    ({ seasonId, teams: leagueTeams, matchups: leagueMatchups, logs: leagueLogs }) => {
      const leagueNameById = new Map(leagueTeams.map((team) => [team.id, team.name]));
      const resolvedIdByLeagueId = new Map<string, string>();
      const resolveLeagueTeam = (leagueId: string): string | null => {
        const cached = resolvedIdByLeagueId.get(leagueId);
        if (cached) return cached;
        const name = leagueNameById.get(leagueId);
        if (!name) return null;
        const result = resolveOrCreateTeam(name, teams);
        teams = result.teams;
        resolvedIdByLeagueId.set(leagueId, result.teamId);
        return result.teamId;
      };

      leagueMatchups.forEach((matchup) => {
        const teamAId = resolveLeagueTeam(matchup.away);
        const teamBId = resolveLeagueTeam(matchup.home);
        if (!teamAId || !teamBId) return;

        const log = leagueLogs[matchup.id];
        const awayScore = scoreFor(log, "away");
        const homeScore = scoreFor(log, "home");
        const played = isFinal(log) && Number.isFinite(awayScore) && Number.isFinite(homeScore);

        games.push({
          id: `${LEAGUE_GAME_PREFIX}${seasonId}_${matchup.id}`,
          teamAId,
          teamBId,
          ageGroupId,
          ...(played ? { teamAScore: awayScore, teamBScore: homeScore } : {}),
          date: matchup.date,
        });
      });
    }
  );

  return { teams, games };
};

/**
 * The teams that actually belong to one age group: those with at least one game tagged to it,
 * played or scheduled. The stored roster stays global — the same club resolves to one entity as it
 * ages up — but a team only *ranks* where it has games, so logging a 10U opponent never drops that
 * team into the 12U ranking, where its results say nothing.
 */
export const teamsInAgeGroup = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[]
): ScoutTeam[] => {
  const active = new Set<string>();
  games.forEach((game) => {
    if (game.ageGroupId !== ageGroupId || !countsTowardRating(game)) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  return teams.filter((team) => active.has(team.id));
};

/** Youngest age level offered. Below 8U there are no standings worth ranking. */
export const MIN_AGE_LEVEL = 8;
/**
 * Youngest age level that gets a ranking table. 8U teams can exist — their games are evidence
 * about the 9U teams that played down against them, and an 8U squad that plays up needs an
 * identity — but 8U itself is not ranked: at that age the results say more about which league
 * is machine pitch than about the teams.
 */
export const MIN_RANKED_AGE_LEVEL = 9;
/** Whether an age level gets a ranking table of its own. */
export const isRankedAgeLevel = (ageLevel: number | undefined): boolean =>
  ageLevel === undefined || ageLevel >= MIN_RANKED_AGE_LEVEL;
/**
 * Oldest age level offered. 18U is the top of the youth pipeline — there is nothing to age up
 * into — so `nextSeason` holds an 18U squad there rather than inventing a 19U, which is also the
 * real-world case: a player can spend two years at 18U.
 */
export const MAX_AGE_LEVEL = 18;
/** First season year offered. Earlier years are only listed when an age group already uses one. */
export const MIN_SEASON_YEAR = 2027;
/** How many years past `MIN_SEASON_YEAR` the picker offers without being asked. */
const SEASON_YEAR_SPAN = 14;

/** 8U through 18U, the whole ladder, oldest last. */
export const AGE_LEVELS: number[] = Array.from(
  { length: MAX_AGE_LEVEL - MIN_AGE_LEVEL + 1 },
  (_, index) => MIN_AGE_LEVEL + index
);

/** A season is an age level and the year it is played in — "10U 2028". */
export type AgeGroupSeason = { ageLevel: number; year: number };

/** The one place the label is spelled, so a group renamed by an edit still reads the same. */
export const formatAgeGroupName = (ageLevel: number, year: number): string =>
  `${ageLevel}U ${year}`;

/**
 * Reads an age level and year back out of a free-text name. Age groups created before the season
 * picker existed stored only a name the user typed — "2027, 10U", "10u", "2028" — so the picker
 * has something to pre-select when one of those is edited, instead of silently resetting it to the
 * defaults and relabelling the group.
 */
export const parseAgeGroupName = (name: string): Partial<AgeGroupSeason> => {
  const season: Partial<AgeGroupSeason> = {};
  const age = /\b(?:(\d{1,2})\s*[uU]|[uU]\s*(\d{1,2}))\b/.exec(name);
  const ageLevel = Number(age?.[1] ?? age?.[2]);
  if (Number.isFinite(ageLevel) && ageLevel >= MIN_AGE_LEVEL && ageLevel <= MAX_AGE_LEVEL) {
    season.ageLevel = ageLevel;
  }
  const year = /\b(20\d{2})\b/.exec(name);
  if (year) season.year = Number(year[1]);
  return season;
};

/**
 * The season an age group is for: the stored fields when it has them, otherwise whatever its name
 * can be read as. Either half can still come back missing — a group named "Travel squad" says
 * nothing — so callers that need both have to handle that.
 */
export const ageGroupSeason = (group: AgeGroup): Partial<AgeGroupSeason> => {
  const parsed = parseAgeGroupName(group.name);
  return {
    ...(group.ageLevel !== undefined ? { ageLevel: group.ageLevel } : {}),
    ...(group.year !== undefined ? { year: group.year } : {}),
    ...(group.ageLevel === undefined && parsed.ageLevel !== undefined
      ? { ageLevel: parsed.ageLevel }
      : {}),
    ...(group.year === undefined && parsed.year !== undefined ? { year: parsed.year } : {}),
  };
};

/** Level of a group: stored field, else parsed from its name. */
export const ageGroupLevel = (group: AgeGroup | undefined): number | undefined =>
  group ? ageGroupSeason(group).ageLevel : undefined;

/** Season year of a group (stored or parsed). */
export const ageGroupYear = (group: AgeGroup | undefined): number | undefined =>
  group ? ageGroupSeason(group).year : undefined;

/** Levels sort youngest first; a group whose level cannot be read goes after the ladder. */
const levelSortKey = (group: AgeGroup): number => ageGroupLevel(group) ?? MAX_AGE_LEVEL + 1;

/**
 * Every group rated together with this one: all groups sharing its season year, itself included,
 * youngest level first. A season year is one calendar of tournaments, and a 9U that enters a 10U
 * bracket in it produces a result about both squads — so the year's groups form one rating pool,
 * with the age-gap term (`AGE_GAP_RUNS_PER_YEAR` in powerRating.ts) accounting for the level
 * difference. A group with no year stands alone: there is nothing to say which other groups it
 * played alongside. The sort is stable, so groups at one level keep their stored order.
 */
export const rankingPoolGroupIds = (ageGroupId: string, ageGroups: AgeGroup[]): string[] => {
  const year = ageGroupYear(ageGroups.find((group) => group.id === ageGroupId));
  if (year === undefined) return [ageGroupId];
  return ageGroups
    .filter((group) => ageGroupYear(group) === year)
    .slice()
    .sort((a, b) => levelSortKey(a) - levelSortKey(b))
    .map((group) => group.id);
};

/**
 * The years the picker offers: a fixed run forward from `MIN_SEASON_YEAR`, plus any year an age
 * group already sits in. The union matters in both directions — a season imported from an older
 * install can be before the run, and advancing a season enough times walks past the end of it.
 */
export const seasonYearOptions = (ageGroups: AgeGroup[] = []): number[] => {
  const years = new Set<number>();
  for (let index = 0; index < SEASON_YEAR_SPAN; index += 1) years.add(MIN_SEASON_YEAR + index);
  ageGroups.forEach((group) => {
    const { year } = ageGroupSeason(group);
    if (year !== undefined) years.add(year);
  });
  return [...years].sort((a, b) => a - b);
};

/**
 * Next season for the same squad: a year older and a year later. The age stops at `MAX_AGE_LEVEL`
 * while the year keeps going, so a second year at 18U advances the way it does in real life.
 */
export const nextSeason = (season: AgeGroupSeason): AgeGroupSeason => ({
  ageLevel: Math.min(season.ageLevel + 1, MAX_AGE_LEVEL),
  year: season.year + 1,
});

/** The age group already covering this season, if there is one — advancing twice must not make two. */
export const findAgeGroupForSeason = (
  season: AgeGroupSeason,
  ageGroups: AgeGroup[]
): AgeGroup | undefined =>
  ageGroups.find((group) => {
    const current = ageGroupSeason(group);
    return current.ageLevel === season.ageLevel && current.year === season.year;
  });

/**
 * When a squad year runs: August 1 of the year before to July 31. "9U 2027" is the squad that
 * plays Fall 2026 and Spring 2027, and its season starts on August 1, 2026 — a game dated before
 * that belongs to last year's squad, whatever schedule it turned up on. GameChanger lists a club's
 * older games under a new id often enough that a nationwide pull carried three thousand rows from
 * the previous spring and the autumn before it, all counting on the 2027 tables.
 */
export const squadYearWindow = (year: number): { start: string; end: string } => ({
  start: `${year - 1}-08-01`,
  end: `${year}-07-31`,
});

/** Whether a game's date falls in its squad year. A game with no date, or a page with no year, passes. */
export const inSquadYear = (date: string | undefined, year: number | undefined): boolean => {
  if (year === undefined || !date) return true;
  const { start, end } = squadYearWindow(year);
  return date >= start && date <= end;
};

/** Ids are minted here so every caller that creates an age group produces the same shape. */
export const createAgeGroupId = (): string =>
  `ag_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

/**
 * Puts one League Standings season at an age, making the age group if it is not there yet.
 *
 * This is the one thing about age groups nobody can work out for you. The groups themselves arrive
 * with the GameChanger import — a 9U schedule makes the 9U page — but nothing in a GameChanger
 * schedule mentions your league, so which page your own league season belongs on is yours to say.
 *
 * A season comes off whatever group held it before, because one league season is played at one
 * age: leaving it on both would count its games twice, once on each table. `null` takes it off
 * Team Rankings altogether.
 */
export const seasonAtAge = (
  seasonId: string,
  season: AgeGroupSeason | null,
  ageGroups: AgeGroup[]
): { ageGroups: AgeGroup[]; group?: AgeGroup; created: boolean } => {
  const without = ageGroups.map((group) =>
    group.seasonIds.includes(seasonId)
      ? { ...group, seasonIds: group.seasonIds.filter((id) => id !== seasonId) }
      : group
  );
  if (!season) return { ageGroups: without, created: false };

  const existing = findAgeGroupForSeason(season, without);
  if (existing) {
    const group = { ...existing, seasonIds: [...existing.seasonIds, seasonId] };
    return {
      ageGroups: without.map((current) => (current.id === group.id ? group : current)),
      group,
      created: false,
    };
  }

  const group: AgeGroup = {
    id: createAgeGroupId(),
    name: formatAgeGroupName(season.ageLevel, season.year),
    ageLevel: season.ageLevel,
    year: season.year,
    seasonIds: [seasonId],
  };
  return { ageGroups: [...without, group], group, created: true };
};

// ---------- GameChanger seasons and links ----------

/**
 * The squad year a GameChanger season belongs to. Youth baseball's year runs Fall through the
 * following Summer — Fall 2026 and Spring 2027 are the same squad, and this app already calls that
 * squad "9U 2027" — so fall/winter roll forward and spring/summer keep their calendar year. An
 * unrecognised season keeps its year too, which is the least surprising reading of a label nobody
 * expected.
 */
export const squadYearForGcSeason = (season: string | undefined, seasonYear: number): number => {
  const name = (season ?? "").trim().toLowerCase();
  return name === "fall" || name === "winter" ? seasonYear + 1 : seasonYear;
};

/** "Fall 2026" from a link's season and year; "" when either half is unknown. */
export const gcSeasonLabel = (link: Pick<GcTeamLink, "season" | "seasonYear">): string => {
  const name = (link.season ?? "").trim();
  if (!name || link.seasonYear === undefined) return "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()} ${link.seasonYear}`;
};

/** The team carrying this GameChanger id, and the link itself. A GameChanger id lives on one team. */
export const findGcLink = (
  gcTeamId: string,
  teams: ScoutTeam[]
): { team: ScoutTeam; link: GcTeamLink } | null => {
  for (const team of teams) {
    const link = team.gcTeams?.find((candidate) => candidate.teamId === gcTeamId);
    if (link) return { team, link };
  }
  return null;
};

/**
 * Teams whose links carry this avatar key. Usually one; two means two GameChanger ids sharing an
 * image that the user has not paired, which is itself worth surfacing.
 */
export const findTeamsByAvatarKey = (avatarKey: string, teams: ScoutTeam[]): ScoutTeam[] =>
  avatarKey
    ? teams.filter((team) => team.gcTeams?.some((link) => link.avatarKey === avatarKey))
    : [];

/**
 * The age group that carries a squad into its next season: a year older, a year later, pointed at
 * the one it came from so last year's opponents keep showing up in the name list, and carrying
 * "our team" over since that is the same real-world club either way. Seasons are deliberately not
 * copied — a new year's League Standings seasons do not exist yet, and inheriting last year's
 * would pull last year's league games into this year's ratings.
 */
export const advancedAgeGroup = (group: AgeGroup, season: AgeGroupSeason): AgeGroup => ({
  id: createAgeGroupId(),
  name: formatAgeGroupName(season.ageLevel, season.year),
  ageLevel: season.ageLevel,
  year: season.year,
  seasonIds: [],
  continuesFromId: group.id,
  ...(group.myTeamId ? { myTeamId: group.myTeamId } : {}),
});

/**
 * The age groups whose rosters belong together, nearest first: this one, then whatever it
 * continues from, and so on back through the chain. A squad keeps its opponents as it ages up —
 * last year's 9U schedule is a good guess at this year's 10U one — but two age groups running at
 * the same time (a 9U and an 11U squad) are unrelated, so neither sees the other's names.
 *
 * `continuesFromId` is user-entered, so a chain could be pointed at itself; `seen` stops that from
 * looping forever.
 */
export const ageGroupChain = (ageGroupId: string, ageGroups: AgeGroup[]): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = ageGroupId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = ageGroups.find((group) => group.id === current)?.continuesFromId;
  }
  return chain;
};

/**
 * The team names to offer when logging a game in this age group: everyone played in it, everyone
 * played in the age groups it continues from, and everyone whose home level this year is this
 * group's level — a team pulled from GameChanger onto the 9U page is a 9U team before it has
 * played anyone here. Scoped rather than global so a 9U opponent never shows up in the 11U
 * ranking's name list — the two squads share a roster store but play nobody in common.
 */
export const teamNameSuggestions = (
  ageGroupId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[]
): ScoutTeam[] => {
  const chain = new Set(ageGroupChain(ageGroupId, ageGroups));
  const active = new Set<string>();
  games.forEach((game) => {
    if (!chain.has(game.ageGroupId)) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  const group = ageGroups.find((candidate) => candidate.id === ageGroupId);
  const level = ageGroupLevel(group);
  const year = ageGroupYear(group);
  // Only a group with a year has a pool to be at home in; a legacy group stands alone.
  if (level !== undefined && year !== undefined) {
    const homeLevels = homeLevelsForYear(year, teams, games, ageGroups);
    teams.forEach((team) => {
      if (homeLevels.get(team.id) === level) active.add(team.id);
    });
  }
  // A slot is never offered as a name to log a game against: picking one would attach this
  // game to some other game's unknown opponent.
  return teams.filter((team) => !team.placeholder && active.has(team.id));
};

/**
 * Whether a game feeds the ratings and records: it has to have been played, and not be one of the
 * cross-age tournament games kept only for the record. Every ranking calculation goes through this,
 * so there is one answer to the question rather than four filters that can drift apart.
 */
export const countsTowardRating = (game: ScoutGame): boolean =>
  isScoutGamePlayed(game) && game.excluded !== true;

const scoreOf = (game: ScoutGame, teamId: string): number | undefined =>
  game.teamAId === teamId ? game.teamAScore : game.teamBScore;

/**
 * Finds an existing game that looks like the same game as `candidate` — same two teams (in either
 * order), same date, same score. That is the shape a double-entry takes, whether it came from
 * typing a game twice, importing a screenshot twice, or re-entering one the league schedule
 * already supplied. Two scoreless scheduled games on the same date count as a match too, since
 * "no score yet" is the same on both sides.
 */
/** The two sides of a game as one order-free key, so A-vs-B and B-vs-A compare equal. */
const pairKeyOf = (game: ScoutGame): string =>
  [game.teamAId, game.teamBId].slice().sort().join("|");

export const findDuplicateGame = (candidate: ScoutGame, games: ScoutGame[]): ScoutGame | null => {
  const pairKey = pairKeyOf(candidate);
  const found = games.find((game) => {
    if (game.id === candidate.id) return false;
    if (game.ageGroupId !== candidate.ageGroupId) return false;
    if (pairKeyOf(game) !== pairKey) return false;
    if ((game.date ?? "") !== (candidate.date ?? "")) return false;
    return (
      scoreOf(game, candidate.teamAId) === candidate.teamAScore &&
      scoreOf(game, candidate.teamBId) === candidate.teamBScore
    );
  });
  return found ?? null;
};

/**
 * One fixture's identity: the age group, the two sides in either order, and the calendar day.
 *
 * The day is what decides it. Two clubs that meet again in October are not playing the same game
 * over — that is a tournament meeting outside league play, and it has to stay a game of its own.
 * Dates run through `normalizeDateInput` because the two sources spell a day differently: the
 * league keeps month-and-day ("4/12") while a pulled game keeps an ISO date ("2027-04-12"), so a
 * raw string compare would never match the pair it is meant to catch.
 *
 * Returns "" for a game with no readable date, which callers read as "this one cannot be matched"
 * — better to leave a dateless game alone than to fold it into a fixture it may not belong to.
 */
const fixtureKeyOf = (game: ScoutGame): string => {
  const day = normalizeDateInput(game.date ?? "");
  return day ? `${game.ageGroupId}|${pairKeyOf(game)}|${day}` : "";
};

/**
 * Collapses a league-derived game and the stored game that is the same real fixture down to one
 * row.
 *
 * Team Rankings pools two sources: `deriveLeagueScoutGames` rebuilds a row for every League
 * Standings matchup on every render, and a GameChanger pull stores rows of its own. A club that
 * pulls the schedule of a team playing in a league it also tracks here ends up holding the same
 * real fixture twice, and once it goes final both copies carry a score — so the rating fits it
 * twice and the record counts the win twice. Filling in a league game from a pull is wanted;
 * adding a second league game is not.
 *
 * Which copy survives follows from which one is actually evidence:
 *  - Every league row for the fixture already scored: the league's own book is authoritative for
 *    its own games, so the league rows stay and the stored duplicates go.
 *  - Otherwise the stored row carries the only result anyone has, so it stays and the league row
 *    it stands in for — an unscored one first, since that is the row with nothing in it — goes.
 *    League rows beyond the number of stored rows stay put, so a fixture nobody has a result for
 *    still shows up as scheduled.
 *
 * Only a league row triggers any of this. Two stored games between the same pair on the same day
 * with no league row are a doubleheader somebody logged twice on purpose, and both are kept; a
 * doubleheader that the league *does* carry is resolved by count rather than by guessing which
 * stored row pairs with which league row, because nothing in either source says.
 */
export const dedupeLeagueFixtures = (games: ScoutGame[]): ScoutGame[] => {
  // Indexed in a single pass rather than scanned per game: this runs on every render over a pool
  // that can hold tens of thousands of rows, and comparing each game against all the others would
  // not survive that.
  const byFixture = new Map<string, { league: number[]; stored: number[] }>();
  games.forEach((game, index) => {
    const key = fixtureKeyOf(game);
    if (!key) return;
    let bucket = byFixture.get(key);
    if (!bucket) {
      bucket = { league: [], stored: [] };
      byFixture.set(key, bucket);
    }
    (game.id.startsWith(LEAGUE_GAME_PREFIX) ? bucket.league : bucket.stored).push(index);
  });

  const dropped = new Set<number>();
  byFixture.forEach(({ league, stored }) => {
    // A fixture only one source knows about is not a duplicate of anything.
    if (league.length === 0 || stored.length === 0) return;

    if (league.every((index) => isScoutGamePlayed(games[index]!))) {
      stored.forEach((index) => dropped.add(index));
      return;
    }

    // Unscored league rows are the ones the stored rows are standing in for, so they go first.
    const emptiestFirst = league
      .slice()
      .sort((a, b) => Number(isScoutGamePlayed(games[a]!)) - Number(isScoutGamePlayed(games[b]!)));
    emptiestFirst.slice(0, stored.length).forEach((index) => dropped.add(index));
  });

  // The common case is a pool with nothing to collapse; hand back the same array so callers that
  // memoize on identity are not re-run for a list that did not change.
  if (dropped.size === 0) return games;
  return games.filter((_, index) => !dropped.has(index));
};

type WinLoss = { wins: number; losses: number; ties: number };

/**
 * Every team's record in one pass. Asking per team meant a scan of the games for each ranked row,
 * which on a nationwide pool is the table's whole cost several times over.
 */
const recordsFor = (playedGames: ScoutGame[]): Map<string, WinLoss> => {
  const records = new Map<string, WinLoss>();
  const tally = (teamId: string, own: number, opp: number) => {
    let record = records.get(teamId);
    if (!record) {
      record = { wins: 0, losses: 0, ties: 0 };
      records.set(teamId, record);
    }
    if (own > opp) record.wins += 1;
    else if (own < opp) record.losses += 1;
    else record.ties += 1;
  };
  playedGames.forEach((game) => {
    tally(game.teamAId, game.teamAScore!, game.teamBScore!);
    tally(game.teamBId, game.teamBScore!, game.teamAScore!);
  });
  return records;
};

const NO_RECORD: WinLoss = { wins: 0, losses: 0, ties: 0 };

// ---------- Levels, pools and cross-age games ----------

/**
 * Age groups looked up once per call rather than once per game: a season-wide pool fed from
 * GameChanger can hold tens of thousands of games, and a legacy group's level and year come from
 * parsing its name.
 */
type GroupIndex = {
  level: (ageGroupId: string) => number | undefined;
  year: (ageGroupId: string) => number | undefined;
};

const indexGroups = (ageGroups: AgeGroup[]): GroupIndex => {
  const levels = new Map(ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const years = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  return { level: (id) => levels.get(id), year: (id) => years.get(id) };
};

type SideLevels = { a?: number; b?: number };

const sideLevelsWith = (game: ScoutGame, index: GroupIndex): SideLevels => {
  const filed = index.level(game.ageGroupId);
  const a = game.ageLevelA ?? filed;
  const b = game.ageLevelB ?? filed;
  return { ...(a === undefined ? {} : { a }), ...(b === undefined ? {} : { b }) };
};

/** The level each side played a game at: recorded on the game, else the filed group's level. */
export const gameSideLevels = (game: ScoutGame, ageGroups: AgeGroup[]): SideLevels =>
  sideLevelsWith(game, indexGroups(ageGroups));

/**
 * Team A's level minus team B's — the age gap the rating model reads, with A in the home seat as
 * every Team Rankings game is passed. Zero when either level is unknown: a game that cannot say
 * who was older is treated as a same-level game rather than guessed at.
 */
const ageGapOf = (levels: SideLevels): number =>
  levels.a === undefined || levels.b === undefined ? 0 : levels.a - levels.b;

/** GameChanger's seasons in the order a squad year plays them, so the latest pulled season wins. */
const GC_SEASON_ORDER: Record<string, number> = { fall: 0, winter: 1, spring: 2, summer: 3 };

/**
 * The squad year a link sits in: the year of the group it is filed under, since that is where the
 * user (or the importer, with the user's approval) put it; otherwise what its GameChanger season
 * implies. A link filed under a legacy group with no year and carrying no season has no year.
 */
const gcLinkYear = (link: GcTeamLink, index: GroupIndex): number | undefined => {
  const filed = index.year(link.ageGroupId);
  if (filed !== undefined) return filed;
  return link.seasonYear === undefined
    ? undefined
    : squadYearForGcSeason(link.season, link.seasonYear);
};

/** The value seen most often, the first seen winning a tie; undefined when there are none. */
const mostCommon = (values: (number | undefined)[]): number | undefined => {
  const counts = new Map<number, number>();
  values.forEach((value) => {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

/**
 * The home-level rule, given a team's own games in the year. GameChanger's word comes first
 * because it is the one source that states a team's level outright; the latest season wins
 * because a squad that was 9U in the fall and is listed 10U in the spring has aged up. Failing a
 * link, what the games recorded for this side; failing that, where the games were filed.
 */
const homeLevelOf = (
  team: ScoutTeam | undefined,
  teamId: string,
  year: number | undefined,
  teamGamesInYear: ScoutGame[],
  index: GroupIndex
): number | undefined => {
  let linked: { order: number; level: number } | undefined;
  for (const link of team?.gcTeams ?? []) {
    if (gcLinkYear(link, index) !== year) continue;
    const level = index.level(link.ageGroupId) ?? link.ageLevel;
    if (level === undefined) continue;
    const order = GC_SEASON_ORDER[(link.season ?? "").trim().toLowerCase()] ?? -1;
    if (!linked || order > linked.order) linked = { order, level };
  }
  if (linked) return linked.level;

  const recorded = mostCommon(
    teamGamesInYear.map((game) => (game.teamAId === teamId ? game.ageLevelA : game.ageLevelB))
  );
  if (recorded !== undefined) return recorded;
  return mostCommon(teamGamesInYear.map((game) => index.level(game.ageGroupId)));
};

/** Home level for every team at once — one pass over the games instead of one per team. */
const homeLevelsForYear = (
  year: number | undefined,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): Map<string, number | undefined> => {
  const index = indexGroups(ageGroups);
  const gamesByTeam = new Map<string, ScoutGame[]>();
  games.forEach((game) => {
    if (index.year(game.ageGroupId) !== year) return;
    [game.teamAId, game.teamBId].forEach((id) => {
      const list = gamesByTeam.get(id);
      if (list) list.push(game);
      else gamesByTeam.set(id, [game]);
    });
  });
  return new Map(
    teams.map((team) => [
      team.id,
      homeLevelOf(team, team.id, year, gamesByTeam.get(team.id) ?? [], index),
    ])
  );
};

/**
 * A team's home level in a season year: the level of the age group its GameChanger link for that
 * year is filed under (latest season wins: fall < winter < spring < summer within a squad year);
 * else the level its games in that year most often record for it (ageLevelA/B); else the level
 * most of its games that year are filed under; else undefined.
 *
 * "Home" is the level the team belongs to, as opposed to the level of any one game: a 9U squad
 * that enters a 10U tournament is still a 9U team, ranked on the 9U page, with that tournament
 * counted as playing up. `year` undefined asks about the legacy pool of groups with no year.
 */
export const teamHomeAgeLevel = (
  teamId: string,
  year: number | undefined,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): number | undefined => {
  const index = indexGroups(ageGroups);
  const team = teams.find((candidate) => candidate.id === teamId);
  const teamGamesInYear = games.filter(
    (game) =>
      (game.teamAId === teamId || game.teamBId === teamId) && index.year(game.ageGroupId) === year
  );
  return homeLevelOf(team, teamId, year, teamGamesInYear, index);
};

/**
 * Same pair (either order) on the same date in the same pool, ignoring score — what a re-pull or
 * the other team's copy of a game matches. Unlike `findDuplicateGame`, the score is exactly what
 * may have changed: a scheduled game is now final, or the other side's schedule reports the same
 * result from its seat. The pool rather than the group, because the two sides of a cross-age game
 * file it under different pages.
 *
 * When several games fit, the same GameChanger game id on the same schedule is certainly it, then
 * one whose scores agree, then the first. Two different game ids on one schedule are never the
 * same game — a doubleheader is two games on one date against one opponent, and a schedule lists
 * each game once — so those are passed over rather than matched to each other.
 */
export const matchExistingGame = (
  candidate: ScoutGame,
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): ScoutGame | null => {
  const pool = new Set(rankingPoolGroupIds(candidate.ageGroupId, ageGroups));
  const pairKey = pairKeyOf(candidate);
  const date = candidate.date ?? "";
  const source = candidate.source;

  let best: { rank: number; game: ScoutGame } | null = null;
  for (const game of games) {
    if (game.id === candidate.id || !pool.has(game.ageGroupId)) continue;
    if (pairKeyOf(game) !== pairKey || (game.date ?? "") !== date) continue;

    let rank = 0;
    if (source && game.source && game.source.teamId === source.teamId) {
      if (game.source.gameId !== source.gameId) continue;
      rank = 2;
    } else if (
      scoreOf(game, candidate.teamAId) === candidate.teamAScore &&
      scoreOf(game, candidate.teamBId) === candidate.teamBScore
    ) {
      rank = 1;
    } else {
      /*
       * Same pair, same day, and two results that contradict each other: a doubleheader, not one
       * game written down twice. Treating it as one lost the second game whenever the other side's
       * schedule listed both and this one listed only the first. A start time settles it the same
       * way, and earlier, when both rows carry one.
       */
      const bothScored =
        candidate.teamAScore !== undefined &&
        candidate.teamBScore !== undefined &&
        game.teamAScore !== undefined &&
        game.teamBScore !== undefined;
      if (bothScored) continue;
      if (candidate.startTs && game.startTs && candidate.startTs !== game.startTs) continue;
    }
    if (!best || rank > best.rank) best = { rank, game };
    if (rank === 2) break;
  }
  return best ? best.game : null;
};

/**
 * A row's place in the rating pool, so two copies of a cross-age game — each side files it under
 * its own page — land in one bucket. A group with no year stands alone, as `rankingPoolGroupIds`
 * has it.
 */
const poolKeyFor = (ageGroupId: string, index: GroupIndex): string => {
  const year = index.year(ageGroupId);
  return year === undefined ? `g${ageGroupId}` : `y${year}`;
};

/** A result on the row being dropped fills a blank on the one kept; a result already there stands. */
const filledFrom = (keep: ScoutGame, drop: ScoutGame): ScoutGame => {
  const scored = (game: ScoutGame) =>
    game.teamAScore !== undefined && game.teamBScore !== undefined;
  if (scored(keep) || !scored(drop)) return keep;
  return {
    ...keep,
    teamAScore: scoreOf(drop, keep.teamAId),
    teamBScore: scoreOf(drop, keep.teamBId),
  };
};

/**
 * Folds together rows that describe one game.
 *
 * Same rule as the import applies to each row as it arrives (`matchExistingGame`): the same two
 * teams on the same day in the same pool, results that mirror or a side with none, and never two
 * game ids off one schedule, which is a doubleheader. Applying it on arrival is enough for as long
 * as the two teams stay the two teams. It stops being enough the moment two entries are folded
 * into one club — a squad's Fall and Spring ids proving to be one squad, or the user's own "same
 * team as" — because each id filed its own row for the game, against the same opponent, and those
 * rows only *become* the same game once the pair matches, which is after both were already here.
 * Yeager Davis held three GameChanger ids and showed its 8-2 loss twice.
 *
 * The earlier row is kept, so ids and side order stay put. `teamId` narrows the pass to the rows
 * one team is on, which is all a single fold can have changed.
 */
export const collapseSameGames = (
  games: ScoutGame[],
  ageGroups: AgeGroup[],
  teamId?: string
): { games: ScoutGame[]; collapsed: number } => {
  const index = indexGroups(ageGroups);
  const buckets = new Map<string, ScoutGame[]>();
  games.forEach((game) => {
    if (teamId !== undefined && game.teamAId !== teamId && game.teamBId !== teamId) return;
    const key = `${poolKeyFor(game.ageGroupId, index)}|${pairKeyOf(game)}|${game.date ?? ""}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(game);
    else buckets.set(key, [game]);
  });

  const replaced = new Map<string, ScoutGame>();
  const dropped = new Set<string>();
  buckets.forEach((bucket) => {
    if (bucket.length < 2) return;
    const kept: ScoutGame[] = [];
    bucket.forEach((game) => {
      const same = matchExistingGame(game, kept, ageGroups);
      if (!same) {
        kept.push(game);
        return;
      }
      const filled = filledFrom(same, game);
      if (filled !== same) {
        kept[kept.indexOf(same)] = filled;
        replaced.set(same.id, filled);
      }
      dropped.add(game.id);
    });
  });

  if (dropped.size === 0) return { games, collapsed: 0 };
  return {
    games: games.flatMap((game) => (dropped.has(game.id) ? [] : [replaced.get(game.id) ?? game])),
    collapsed: dropped.size,
  };
};

/**
 * The teams with a counted game anywhere in this group's pool — the roster the pool is rated
 * over, which is wider than `teamsInAgeGroup`: a 10U that only ever played down against 9Us is
 * rated alongside them even though no game is filed under its own page.
 */
export const teamsInRankingPool = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): ScoutTeam[] => {
  const pool = new Set(rankingPoolGroupIds(ageGroupId, ageGroups));
  const active = new Set<string>();
  games.forEach((game) => {
    if (!pool.has(game.ageGroupId) || !countsTowardRating(game)) return;
    active.add(game.teamAId);
    active.add(game.teamBId);
  });
  return teams.filter((team) => active.has(team.id));
};

/**
 * One team's record over every counted game in the pool, cross-age games included — the number
 * the detail panel shows, and the one the ranking row shows, so the two agree.
 */
export const teamRecordInPool = (
  teamId: string,
  ageGroupId: string,
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): { wins: number; losses: number; ties: number; games: number; crossAgeGames: number } => {
  const index = indexGroups(ageGroups);
  const pool = new Set(rankingPoolGroupIds(ageGroupId, ageGroups));
  const counted = games.filter(
    (game) =>
      pool.has(game.ageGroupId) &&
      countsTowardRating(game) &&
      (game.teamAId === teamId || game.teamBId === teamId)
  );
  const { wins, losses, ties } = recordsFor(counted).get(teamId) ?? NO_RECORD;
  const crossAgeGames = counted.filter(
    (game) => ageGapOf(sideLevelsWith(game, index)) !== 0
  ).length;
  return { wins, losses, ties, games: counted.length, crossAgeGames };
};

const hasGcLinks = (team: ScoutTeam): boolean => Boolean(team.gcTeams?.length);

/** Sort by rating, number the ranks, and number strength of schedule among teams that played. */
const rankRows = (rows: ScoutRankingRow[]): ScoutRankingRow[] => {
  rows.sort(
    (a, b) =>
      b.rating - a.rating || b.rawMargin - a.rawMargin || a.teamName.localeCompare(b.teamName)
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  const sosOrder = rows
    .filter((row) => row.games > 0)
    .slice()
    .sort(
      (a, b) => b.strengthOfSchedule - a.strengthOfSchedule || a.teamName.localeCompare(b.teamName)
    );
  const sosRankById = new Map(sosOrder.map((row, index) => [row.teamId, index + 1]));
  rows.forEach((row) => {
    row.sosRank = sosRankById.get(row.teamId) ?? 0;
  });

  return rows;
};

/**
 * Ranks the given teams using only *completed* games. Scheduled/unplayed games are ignored here
 * entirely; they exist only so a future opponent can be logged ahead of time. Every team is rated
 * by this exact same formula — which team is "ours" plays no part in the computation; `myTeamId`
 * (falling back to the legacy `ScoutTeam.isMine`) only sets a display flag.
 *
 * Without `ageGroups`, this is the one-group ranking it has always been: games tagged with
 * `ageGroupId` (defensive filter — callers should already be passing an age-group-scoped game
 * list), one row per team passed. With `ageGroups`, the group's whole season-year pool is rated
 * together — see `rankingPoolGroupIds` — with each game's age gap passed to the model, and the
 * rows are the teams at home on this page: those whose home level is this group's level, plus
 * those of unknown level with a counted game filed here. A team that only played *up* onto this
 * page is rated (it is a node in the same regression) but listed on its own page. Records count
 * every counted game in the pool, so a 9U's win over a 10U is a win. A group below
 * `MIN_RANKED_AGE_LEVEL` has no table at all.
 */
export const buildTeamRankings = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  myTeamId?: string,
  ageGroups?: AgeGroup[]
): ScoutRankingRow[] => {
  if (ageGroups) return buildPooledTeamRankings(ageGroupId, teams, games, myTeamId, ageGroups);

  const playedGames = games.filter(
    (game) => game.ageGroupId === ageGroupId && countsTowardRating(game)
  );
  const adjusted = buildOpponentAdjustedRatings(
    teams.map((team) => team.id),
    playedGames.map((game) => ({
      home: game.teamAId,
      away: game.teamBId,
      homeMargin: game.teamAScore! - game.teamBScore!,
      // Team A is simply the side entered first, not the home team.
      neutral: true,
    })),
    { cap: RATING_CAP }
  );

  const records = recordsFor(playedGames);
  const rows = teams
    /*
     * Everyone is in the fit above, because every one of them was somebody's opponent. Only clubs
     * go in the table: not a slot, which names nobody, and not a club known only from somebody
     * else's schedule, whose record here is a fraction of a season it would be ranked on.
     */
    .filter((team) => !team.placeholder && !team.nameOnly)
    .map((team): ScoutRankingRow => {
      const { wins, losses, ties } = records.get(team.id) ?? NO_RECORD;
      const gamesPlayed = adjusted.games.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        isMine: myTeamId ? team.id === myTeamId : Boolean(team.isMine),
        rank: 0,
        rating: adjusted.ratings.get(team.id) ?? 0,
        record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
        wins,
        losses,
        ties,
        games: gamesPlayed,
        rawMargin: adjusted.rawMargin.get(team.id) ?? 0,
        strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
        sosRank: 0,
        crossAgeGames: 0,
        fromGameChanger: hasGcLinks(team),
      };
    });

  return rankRows(rows);
};

const buildPooledTeamRankings = (
  ageGroupId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  myTeamId: string | undefined,
  ageGroups: AgeGroup[]
): ScoutRankingRow[] => {
  const index = indexGroups(ageGroups);
  const level = index.level(ageGroupId);
  if (!isRankedAgeLevel(level)) return [];
  const year = index.year(ageGroupId);
  const pool = new Set(rankingPoolGroupIds(ageGroupId, ageGroups));

  // A game whose team is missing from the roster cannot be rated — there is nothing to rate.
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const rated = games
    .filter(
      (game) =>
        pool.has(game.ageGroupId) &&
        countsTowardRating(game) &&
        // Last year's squad's games, listed under this year's id, are not this squad's results.
        inSquadYear(game.date, index.year(game.ageGroupId)) &&
        teamById.has(game.teamAId) &&
        teamById.has(game.teamBId)
    )
    .map((game) => ({ game, ageGap: ageGapOf(sideLevelsWith(game, index)) }));
  const ratedGames = rated.map(({ game }) => game);

  const active = new Set<string>();
  const filedHere = new Set<string>();
  ratedGames.forEach((game) => {
    active.add(game.teamAId);
    active.add(game.teamBId);
    if (game.ageGroupId === ageGroupId) {
      filedHere.add(game.teamAId);
      filedHere.add(game.teamBId);
    }
  });
  const nodes = teams.filter((team) => active.has(team.id));

  const adjusted = buildOpponentAdjustedRatings(
    nodes.map((team) => team.id),
    rated.map(({ game, ageGap }) => ({
      home: game.teamAId,
      away: game.teamBId,
      homeMargin: game.teamAScore! - game.teamBScore!,
      // Team A is simply the side entered first, not the home team.
      neutral: true,
      ...(ageGap ? { ageGap } : {}),
    })),
    { cap: RATING_CAP }
  );

  const homeLevels = homeLevelsForYear(year, nodes, games, ageGroups);
  // A page with no readable level (a legacy group) lists whoever played there, as it always has.
  const belongsHere = (teamId: string): boolean => {
    if (level === undefined) return filedHere.has(teamId);
    const home = homeLevels.get(teamId);
    return home === level || (home === undefined && filedHere.has(teamId));
  };

  const records = recordsFor(ratedGames);
  // Likewise counted once: how many of each team's games crossed a level.
  const crossAgeCounts = new Map<string, number>();
  rated.forEach(({ game, ageGap }) => {
    if (ageGap === 0) return;
    crossAgeCounts.set(game.teamAId, (crossAgeCounts.get(game.teamAId) ?? 0) + 1);
    crossAgeCounts.set(game.teamBId, (crossAgeCounts.get(game.teamBId) ?? 0) + 1);
  });
  const rows = nodes
    /*
     * Both kinds of non-club are in the fit as opponents and out of the table: a slot, which names
     * nobody, and a club known only from somebody else's schedule, whose record here is a fraction
     * of its season and would rank against clubs whose whole season is present.
     */
    .filter((team) => !team.placeholder && !team.nameOnly && belongsHere(team.id))
    .map((team): ScoutRankingRow => {
      const { wins, losses, ties } = records.get(team.id) ?? NO_RECORD;
      const crossAgeGames = crossAgeCounts.get(team.id) ?? 0;
      const ageLevel = homeLevels.get(team.id);
      return {
        teamId: team.id,
        teamName: team.name,
        isMine: myTeamId ? team.id === myTeamId : Boolean(team.isMine),
        rank: 0,
        rating: adjusted.ratings.get(team.id) ?? 0,
        record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
        wins,
        losses,
        ties,
        games: adjusted.games.get(team.id) ?? 0,
        rawMargin: adjusted.rawMargin.get(team.id) ?? 0,
        strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
        sosRank: 0,
        ...(ageLevel === undefined ? {} : { ageLevel }),
        crossAgeGames,
        fromGameChanger: hasGcLinks(team),
      };
    });

  return rankRows(rows);
};

/** Same margin-clamp/logistic formula `predictionEngine.ts` uses for League Standings' own
 * matchup predictions — kept identical so the two features read consistently. Deliberately ignores
 * home-field advantage: Team Rankings games are treated as neutral-site. */
/** Widest projected margin a matchup preview will state, in runs. */
export const MATCHUP_MARGIN_CAP = 14;
/**
 * Win probability never leaves this range. Youth baseball has no locks, and a model that says 99%
 * is claiming a certainty the sport does not have.
 */
export const MATCHUP_PROBABILITY_FLOOR = 0.08;

export const predictMatchup = (ratingA: number, ratingB: number) => {
  const margin = clamp(ratingA - ratingB, -MATCHUP_MARGIN_CAP, MATCHUP_MARGIN_CAP);
  const winProbA = clamp(
    1 / (1 + Math.exp(-margin / 2.8)),
    MATCHUP_PROBABILITY_FLOOR,
    1 - MATCHUP_PROBABILITY_FLOOR
  );
  return { projectedMargin: margin, winProbA, winProbB: 1 - winProbA };
};

const tierFor = (winProb: number): MatchupTier =>
  winProb > 0.6 ? "Favored" : winProb < 0.4 ? "Underdog" : "Toss-up";

/** For the given team, project the result against every other team in the same ranked pool,
 * ordered by opponent rank. */
export const buildScoutingReport = (
  forTeamId: string,
  rows: ScoutRankingRow[]
): MatchupPreview[] => {
  const forRow = rows.find((row) => row.teamId === forTeamId);
  if (!forRow) return [];
  return rows
    .filter((row) => row.teamId !== forTeamId)
    .map((opponent): MatchupPreview => {
      const { projectedMargin, winProbA } = predictMatchup(forRow.rating, opponent.rating);
      return {
        opponentId: opponent.teamId,
        opponentName: opponent.teamName,
        opponentRank: opponent.rank,
        projectedMargin,
        winProb: winProbA,
        tier: tierFor(winProbA),
      };
    })
    .sort((a, b) => a.opponentRank - b.opponentRank);
};

/**
 * The results this season's league does not already know about: games logged in Team Rankings for
 * an age group that includes this season, minus the ones that came *from* the league schedule in
 * the first place. Counting those twice would quietly double the weight of every league game.
 *
 * "Came from the league" covers two shapes. A row `deriveLeagueScoutGames` built carries the
 * `league_` prefix and is easy to spot. A row a GameChanger pull stored for a league fixture does
 * not — it looks exactly like a tournament result — so it is matched against `seasonFixtures` the
 * way `dedupeLeagueFixtures` matches one: same two clubs by name, same calendar day. The day is
 * again what decides it, so the same two clubs meeting at a fall tournament still comes back as
 * the outside result it is.
 *
 * Teams are matched to the league by name, since the two sides keep separate ids for the same club.
 * An opponent with no league counterpart keeps an id of its own, so the rating model can estimate
 * how good it was instead of assuming — which is the whole point: a shared tournament opponent is
 * what lets two league teams that never met be compared.
 */
export const externalResultsForSeason = (
  seasonId: string,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  games: ScoutGame[],
  leagueTeams: { id: string; name: string }[],
  /**
   * This season's own schedule — league team *names* and the league's own date string — so a
   * stored game that is really one of these fixtures can be recognised. Required rather than
   * optional so a new caller has to answer the question instead of silently reopening the leak.
   */
  seasonFixtures: { away: string; home: string; date: string }[]
): { home: string; away: string; homeMargin: number }[] => {
  const linked = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  if (linked.size === 0) return [];

  const leagueIdByName = new Map(leagueTeams.map((team) => [teamNameKey(team.name), team.id]));
  const scoutNameById = new Map(teams.map((team) => [team.id, team.name]));

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

  const isSeasonFixture = (game: ScoutGame): boolean => {
    if (fixtureKeys.size === 0) return false;
    const away = scoutNameById.get(game.teamAId);
    const home = scoutNameById.get(game.teamBId);
    if (!away || !home) return false;
    const key = nameFixtureKey(away, home, game.date ?? "");
    return key !== "" && fixtureKeys.has(key);
  };

  // A league team's own id where the name matches; otherwise an id of this opponent's own that
  // cannot collide with a league one.
  const ratingId = (scoutTeamId: string): string => {
    const name = scoutNameById.get(scoutTeamId);
    const matched = name ? leagueIdByName.get(teamNameKey(name)) : undefined;
    return matched ?? `${SCOUT_ID_PREFIX}${scoutTeamId}`;
  };

  return games
    .filter(
      (game) =>
        linked.has(game.ageGroupId) &&
        !game.id.startsWith(LEAGUE_GAME_PREFIX) &&
        !isSeasonFixture(game) &&
        countsTowardRating(game)
    )
    .map((game) => ({
      home: ratingId(game.teamAId),
      away: ratingId(game.teamBId),
      homeMargin: game.teamAScore! - game.teamBScore!,
      // The pair order is the order it was typed, so this must not reach the home-field estimate.
      neutral: true,
    }));
};

/**
 * Renames a team, merging it into an existing one when the new name is already taken.
 *
 * The merge is the point. A schedule that listed an opponent as "TBD", or a name typed two ways,
 * becomes a second team holding a few games that belong to a real one. Renaming it onto that real
 * name is how those games get routed home, so this repoints them rather than refusing the name.
 *
 * A game between the two teams being merged would become a team playing itself, which is not a
 * result; those are dropped rather than kept as a nonsense row.
 */
export const renameScoutTeam = (
  teamId: string,
  nextName: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): {
  teams: ScoutTeam[];
  games: ScoutGame[];
  mergedInto: ScoutTeam | null;
  droppedGames: number;
  collapsedGames: number;
} => {
  const display = cleanTeamName(nextName).trim();
  if (!display) return { teams, games, mergedInto: null, droppedGames: 0, collapsedGames: 0 };

  const key = teamNameKey(display);
  const target = teams.find((team) => team.id !== teamId && teamNameKey(team.name) === key);

  if (!target) {
    return {
      teams: teams.map((team) => (team.id === teamId ? { ...team, name: display } : team)),
      games,
      mergedInto: null,
      droppedGames: 0,
      collapsedGames: 0,
    };
  }

  const merged = mergeScoutTeams(teamId, target.id, teams, games, ageGroups);
  return { ...merged, mergedInto: target };
};

/**
 * Folds one team into another, keeping the survivor's id. This is the manual override behind
 * every identity decision the app cannot make on its own: pairing a Fall GameChanger id with the
 * Spring one when the names differ, sending a name-only placeholder's games to the team it turned
 * out to be, or undoing a wrong match by merging the pieces back together.
 *
 * Games are repointed at the survivor; a game between the two (a team playing itself once merged)
 * is not a result and is dropped. Two rows that were each half's copy of one game — both ids
 * filed the same fixture, which is usually what proved them one squad — are one row afterwards
 * (`collapseSameGames`). GameChanger links are unioned by id, since both halves may have been
 * pulled — that union is exactly what "the same squad across seasons" means here. Blank name,
 * state and city on the survivor are filled from the team folded in; anything the survivor
 * already has stands, because the user chose which one survives.
 */
export const mergeScoutTeams = (
  fromId: string,
  intoId: string,
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups: AgeGroup[]
): { teams: ScoutTeam[]; games: ScoutGame[]; droppedGames: number; collapsedGames: number } => {
  const removed = teams.find((team) => team.id === fromId);
  const survivor = teams.find((team) => team.id === intoId);
  if (!removed || !survivor || fromId === intoId) {
    return { teams, games, droppedGames: 0, collapsedGames: 0 };
  }

  const repointed: ScoutGame[] = [];
  let droppedGames = 0;
  games.forEach((game) => {
    const teamAId = game.teamAId === fromId ? intoId : game.teamAId;
    const teamBId = game.teamBId === fromId ? intoId : game.teamBId;
    if (teamAId === teamBId) {
      droppedGames += 1;
      return;
    }
    repointed.push(
      teamAId === game.teamAId && teamBId === game.teamBId ? game : { ...game, teamAId, teamBId }
    );
  });

  const linkedIds = new Set((survivor.gcTeams ?? []).map((link) => link.teamId));
  const gcTeams = [
    ...(survivor.gcTeams ?? []),
    ...(removed.gcTeams ?? []).filter((link) => !linkedIds.has(link.teamId)),
  ];
  const fillName = !survivor.name.trim() && removed.name.trim();
  const fillState = !survivor.state && removed.state;
  const fillCity = !survivor.city && removed.city;
  // "Our team" is a fact about the club, so it survives whichever half carried it.
  const fillMine = !survivor.isMine && removed.isMine;
  const linksChanged = gcTeams.length !== (survivor.gcTeams?.length ?? 0);
  const changed = fillName || fillState || fillCity || fillMine || linksChanged;

  const merged: ScoutTeam = changed
    ? {
        ...survivor,
        ...(fillName ? { name: removed.name } : {}),
        ...(fillState ? { state: removed.state } : {}),
        ...(fillCity ? { city: removed.city } : {}),
        ...(fillMine ? { isMine: true } : {}),
        ...(gcTeams.length ? { gcTeams } : {}),
      }
    : survivor;

  const collapsed = collapseSameGames(repointed, ageGroups, intoId);
  return {
    teams: teams.flatMap((team) =>
      team.id === fromId ? [] : team.id === intoId ? [merged] : [team]
    ),
    games: collapsed.games,
    droppedGames,
    collapsedGames: collapsed.collapsed,
  };
};

/**
 * Removes one GameChanger link from a team. The games that link brought in stay: they happened,
 * and they still belong to this team as far as the user has said. Unlinking is how a wrong pairing
 * is taken apart (the id can then be pulled again onto a team of its own), so the last link coming
 * off leaves a plain name-only team rather than one holding an empty list.
 */
export const unlinkGcTeam = (teamId: string, gcTeamId: string, teams: ScoutTeam[]): ScoutTeam[] =>
  teams.map((team) => {
    if (team.id !== teamId || !team.gcTeams?.some((link) => link.teamId === gcTeamId)) return team;
    const remaining = team.gcTeams.filter((link) => link.teamId !== gcTeamId);
    const next: ScoutTeam = { ...team, gcTeams: remaining };
    if (!remaining.length) delete next.gcTeams;
    return next;
  });

/**
 * Every GameChanger id the pool has already been pulled by.
 *
 * A team list grows rather than changes: a few dozen clubs are added to an export of several
 * thousand, and fetching the whole file again to find them costs the same minutes as the first
 * run did. What is already here is exactly what carries one of these ids, so this is what the
 * import panel subtracts to leave the teams it has never seen.
 */
export const pulledGcTeamIds = (teams: readonly ScoutTeam[]): Set<string> => {
  const ids = new Set<string>();
  teams.forEach((team) => (team.gcTeams ?? []).forEach((link) => ids.add(link.teamId)));
  return ids;
};

/** Every game this team has, newest first, across every age group. */
export const gamesForTeam = (teamId: string, games: ScoutGame[]): ScoutGame[] =>
  games
    .filter((game) => game.teamAId === teamId || game.teamBId === teamId)
    .slice()
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

/**
 * Names that stand in for a team nobody has decided yet: a bracket slot, a rained-out reschedule,
 * a blank cell. Worth flagging on import, because logging one creates a "team" that will collect
 * games belonging to whoever actually turns up.
 */
const PLACEHOLDER_NAMES = new Set([
  "tbd",
  "tba",
  "tbc",
  "bye",
  "n/a",
  "na",
  "none",
  "unknown",
  "opponent",
  "team",
  "?",
  "??",
  "???",
  "-",
  "--",
]);

/**
 * A name that is the round, not the opponent: "Tournament", "Playoffs", "Bracket Play", "DH". A
 * nationwide pull carried a hundred of these as shared clubs, each one "played" by up to nine
 * unrelated schedules.
 */
const ROUND_WORDS =
  /^(?:tournament|tourney|playoffs?|championships?|bracket(?: play)?|pool play|scrimmage|practice|double ?header|dh|semis?|semi-?finals?|finals?|consolation|elimination)\b/;

export const isPlaceholderName = (name: string): boolean => {
  const raw = name.trim();
  if (!raw) return true;
  // A name that is nothing but an age level names no team. `cleanTeamName` keeps it rather than
  // returning an empty string, so it has to be recognised here.
  if (/^(?:\d{1,2}\s*u|u\s*\d{1,2})$/i.test(raw)) return true;

  // Dots go so "T.B.D." reads as "tbd"; they are punctuation in an abbreviation, not a name.
  const value = cleanTeamName(raw)
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s{2,}/g, " ");
  if (!value) return true;
  if (PLACEHOLDER_NAMES.has(value)) return true;
  if (ROUND_WORDS.test(value)) return true;
  /**
   * A placeholder rarely arrives on its own. GameChanger writes an undecided bracket slot as
   * "TBD- 08/04/26, 5:00 PM", so the date and the start time are part of the name, and every one
   * of them is a different string — which made them all look like different clubs and put a
   * thousand of them in the rankings. Matching the opening token catches the whole family without
   * having to know what a source will append to it.
   *
   * Only the tokens that name nothing on their own are matched this way. "Bye" and "Team" stay
   * exact matches above, because a real club can begin with either.
   */
  if (/^(tbd|tba|tbc)\b/.test(value)) return true;
  // "To be determined", "Winner of Game 3", "Loser of semifinal" — a slot, not a club.
  return /^(to be (determined|announced)|winner of\b|loser of\b|game \d+|seed \d+)/.test(value);
};

/** Levenshtein distance, capped short-circuit free — names here are at most a line long. */
const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const row = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((row[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = row[j] ?? 0;
  }
  return prev[b.length] ?? 0;
};

/**
 * The team this name was probably meant to be, when it is close to one already known but not the
 * same. Returns nothing for an exact match — that is not a near miss, it is the team.
 *
 * Two kinds of "close" matter here, and they are different mistakes. One name containing the other
 * is usually a suffix nobody agreed on ("NV Stars" against "NV Stars Scout"). A small edit distance
 * is a typo. Both are offered as a suggestion and never applied automatically, because
 * "South Lexington Red" and "South Lexington Blue" are two real teams four characters apart.
 */
export const findSimilarTeam = (name: string, teams: ScoutTeam[]): ScoutTeam | null => {
  const key = teamNameKey(name);
  if (key.length < 4 || isPlaceholderName(name)) return null;

  let best: { team: ScoutTeam; score: number } | null = null;
  teams.forEach((team) => {
    const other = teamNameKey(team.name);
    if (other === key || other.length < 4) return;

    const contains = other.startsWith(key) || key.startsWith(other);
    const distance = editDistance(key, other);
    const ratio = 1 - distance / Math.max(key.length, other.length);
    // A shared prefix is strong evidence; otherwise the names have to be nearly identical.
    const score = contains ? Math.max(ratio, 0.9) : ratio;
    // 0.82 admits a two-edit typo in a twelve-character name. It deliberately stops short of
    // "South Lexington Red" against "…Blue", which lands at 0.80 and is two real teams.
    if (score < 0.82) return;
    if (!best || score > best.score) best = { team, score };
  });

  return best ? (best as { team: ScoutTeam }).team : null;
};

/** Two letters, uppercased. Anything else is not a state and is stored as no state at all. */
export const normalizeState = (value: string): string | undefined => {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : undefined;
};

/**
 * The states represented among these teams, alphabetically. Drives the filter's options, so it
 * only ever offers a state that some team on the table actually has.
 */
export const statesInUse = (teams: ScoutTeam[]): string[] =>
  [
    ...new Set(teams.map((team) => team.state).filter((state): state is string => Boolean(state))),
  ].sort();

/**
 * Narrows a ranking to one state, or to the teams whose state is unknown.
 *
 * Filtering is presentational — the ratings themselves are computed from every game, because a
 * team's strength does not change based on which rows you are looking at. Ranks are renumbered so
 * a filtered table reads 1, 2, 3 rather than 4, 9, 12; each row keeps `overallRank` so the
 * position in the full table is still there to show.
 */
export const filterRankingsByState = (
  rows: ScoutRankingRow[],
  teams: ScoutTeam[],
  state: string
): ScoutRankingRow[] => {
  if (!state) return rows;
  const stateById = new Map(teams.map((team) => [team.id, team.state]));
  const matches = (id: string) =>
    state === UNKNOWN_STATE ? !stateById.get(id) : stateById.get(id) === state;

  return rows
    .filter((row) => matches(row.teamId))
    .map((row, index) => ({ ...row, overallRank: row.rank, rank: index + 1 }));
};

/** Filter value for "teams I have not given a state to". */
export const UNKNOWN_STATE = "__unknown__";
