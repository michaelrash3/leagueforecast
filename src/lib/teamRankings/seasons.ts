/**
 * Age levels, age groups, and the calendar a squad year runs on.
 *
 * A squad year runs August 1 to July 31, so "2027" is the side that plays Fall 2026 and Spring
 * 2027 — the same players, one year of baseball. Everything here follows from that: the windows a
 * game has to fall inside to count, the two segments a year splits into, how a group advances to
 * the next year, and how GameChanger's own season labels map onto it.
 *
 * Split out of `teamRankings.ts`, which was three thousand lines. This is arithmetic over dates
 * and labels and depends on nothing else in the pool, which is what makes it a seam rather than a
 * slice. `teamRankings.ts` re-exports it, so no caller changed.
 */
import type { AgeGroup, GcTeamLink, ScoutTeam } from "./types";

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

/**
 * A League Standings date, placed in the squad year it must belong to.
 *
 * League Standings stores a date as bare "M/D" — `normalizeDateInput` makes every shape into one,
 * including an ISO date typed into a browser date picker — because a league season is one year and
 * the year is on the page. Team Rankings is not one year, and every one of its date tests is a
 * string comparison against `squadYearWindow`. "9/13" is not less than "2027-07-31", so every
 * League Standings game carried across failed `inSquadYear`, was in neither half of the season by
 * `segmentOfDate`, and was silently left out of the fit, the record and the table it was carried
 * across for. Worse where the club had also been pulled from GameChanger: the league row displaces
 * the stored row as the better account of that fixture, and then removes itself.
 *
 * The squad year is what resolves the missing year, which is the whole point of its August
 * boundary: a month from August belongs to the calendar year before the squad year's number, and
 * a month before August to the number itself. A date already in ISO is returned as it is, and a
 * date with no squad year to place it in is left alone — an unplaceable date passes every test
 * here, which counts the game, where a date that parses wrongly does not.
 */
export const dateInSquadYear = (
  date: string | undefined,
  year: number | undefined
): string | undefined => {
  if (!date) return date;
  // Only a bare "M/D" is ours to place. Anything else — an ISO date, a shape nothing recognises —
  // fails this and is handed back as it came, which is what the callers below already expect.
  const parts = /^(\d{1,2})\/(\d{1,2})$/.exec(date);
  if (!parts || year === undefined) return date;
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return date;
  const calendar = month >= 8 ? year - 1 : year;
  return `${calendar}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Whether a game's date falls in its squad year. A game with no date, or a page with no year, passes. */
export const inSquadYear = (date: string | undefined, year: number | undefined): boolean => {
  if (year === undefined || !date) return true;
  const { start, end } = squadYearWindow(year);
  return date >= start && date <= end;
};

/**
 * The two halves of a baseball year.
 *
 * A baseball year runs August 1 to July 31 — `squadYearWindow` — and it is played in two halves
 * with a winter between them: August to December, then January to July. They are one season, and
 * they are not one table. A club's Fall standing must not be worked out from games it had not
 * played yet, and on a real pool the two halves are nearly different populations anyway: of
 * 111,790 clubs in one year, 27,260 played only the autumn and 73,068 only the spring, with 11,462
 * in both. Ranking them together answers neither question.
 */
export type SeasonSegment = "fall" | "spring";

/** Both halves, in the order a season plays them. */
export const SEASON_SEGMENT_ORDER: SeasonSegment[] = ["fall", "spring"];

/**
 * The dates a half covers, inside `squadYearWindow(year)`.
 *
 * The two are contiguous and together are exactly the year, so every dated game in a year is in
 * one half or the other and none is in both.
 */
export const segmentWindow = (
  year: number,
  segment: SeasonSegment
): { start: string; end: string } =>
  segment === "fall"
    ? { start: `${year - 1}-08-01`, end: `${year - 1}-12-31` }
    : { start: `${year}-01-01`, end: `${year}-07-31` };

/**
 * How a half is named: by the calendar year it is actually played in.
 *
 * So baseball year 2027 is "Fall 2026" and "Spring 2027" — which is what a coach says, and the
 * reason the year number alone is not a label anybody would recognise on a board.
 */
export const segmentLabel = (year: number, segment: SeasonSegment): string =>
  segment === "fall" ? `Fall ${year - 1}` : `Spring ${year}`;

/** Which half a date is in, or nothing when the date is absent or outside the year. */
export const segmentOfDate = (
  date: string | undefined,
  year: number | undefined
): SeasonSegment | undefined => {
  if (year === undefined || !date || !inSquadYear(date, year)) return undefined;
  const { end } = segmentWindow(year, "fall");
  return date <= end ? "fall" : "spring";
};

/**
 * The squad year a League Standings season sits in, from the age group that claims it.
 *
 * The link already exists and is the user's own: an age group names the league seasons that belong
 * to it, and carries the year — "Fall 2026" is part of squad year 2027. So a league schedule's
 * bare "M/D" can be placed on a real day without asking anybody anything, and the two halves of
 * the app agree about which season a date is in because they are reading the same answer.
 *
 * Undefined when no age group claims the season, or when the one that does predates the year
 * picker. A caller that cannot place a date has to say so rather than guess.
 */
export const squadYearForLeagueSeason = (
  seasonId: string,
  ageGroups: AgeGroup[]
): number | undefined => {
  for (const group of ageGroups) {
    if (!group.seasonIds.includes(seasonId)) continue;
    const year = ageGroupYear(group);
    if (year !== undefined) return year;
  }
  return undefined;
};

/** Whether a game belongs in one half's table. A game with no date is in neither. */
export const inSegment = (
  date: string | undefined,
  year: number | undefined,
  segment: SeasonSegment | undefined
): boolean => {
  if (segment === undefined) return inSquadYear(date, year);
  return segmentOfDate(date, year) === segment;
};

/**
 * The baseball year a day is in, and which half of it.
 *
 * August starts a new year, so any day from August 1 belongs to the next one: September 17, 2026 is
 * the autumn of baseball year 2027.
 */
export const segmentOn = (today: string): { year: number; segment: SeasonSegment } => {
  const calendar = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month >= 8
    ? { year: calendar + 1, segment: "fall" }
    : { year: calendar, segment: "spring" };
};

/**
 * The previous season, for either half of a year.
 *
 * Fall and Spring are one season, referred to by its spring: the season before both halves of 2027
 * is Spring 2026, never Fall 2026. That is the whole reason this is a function rather than a
 * subtraction at each call site — "the half before this one" is a different and wrong answer.
 */
export const previousSeason = (year: number): { year: number; segment: SeasonSegment } => ({
  year: year - 1,
  segment: "spring",
});

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
