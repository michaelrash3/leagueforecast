import { MAX_AGE_LEVEL, MIN_AGE_LEVEL, type SeasonSegment } from "./teamRankings";
import type { AppMode } from "./preferences";

/**
 * The areas Team Rankings is divided into. One at a time is on screen, the season year and age
 * tabs above them scoping all of them alike.
 */
export type RankingsSection = "rankings" | "games" | "import" | "scouting" | "archive" | "setup";

/** What a link with no `?section=` opens on: the tables, which is what people come here for. */
export const DEFAULT_RANKINGS_SECTION: RankingsSection = "rankings";

/**
 * Which page of Team Rankings the URL is asking for. Every part is optional and independent: a
 * link can name a season year without an age level ("show me 2028, whichever level you were on")
 * or a level without a year, and the view fills the rest in from what exists. A link naming no
 * section opens on `DEFAULT_RANKINGS_SECTION`.
 */
export type RankingsRoute = {
  mode?: AppMode;
  ageLevel?: number;
  year?: number;
  /** Which half of the baseball year's rankings — `?half=fall`. */
  segment?: SeasonSegment;
  section?: RankingsSection;
};

/** `?view=rankings` — which of the two modes the link opens in. */
export const VIEW_PARAM = "view";
/** `?age=10` — the age level, without the U. */
export const AGE_PARAM = "age";
/** `?year=2028` — the season year, as the app labels squads. */
export const YEAR_PARAM = "year";
/** `?section=games` — which area of Team Rankings is on screen. */
export const SECTION_PARAM = "section";
/** `?half=fall` — which half of the baseball year the boards are for. */
export const HALF_PARAM = "half";

/**
 * The value `?half=` takes. Spelled out like the views and sections are, so the names in the URL
 * read the way a coach says them without pinning the internal ones.
 */
const HALF_VALUES: Record<string, SeasonSegment> = {
  fall: "fall",
  spring: "spring",
};

const HALF_URLS: Record<SeasonSegment, string> = {
  fall: "fall",
  spring: "spring",
};

/**
 * The value `?view=` takes for each mode. Spelled out rather than reusing the stored `AppMode`
 * strings so the URL stays readable and the storage format is free to change without breaking
 * links people have already shared.
 */
const VIEW_VALUES: Record<string, AppMode> = {
  rankings: "rankings",
  league: "league",
};

const MODE_VIEWS: Record<AppMode, string> = {
  rankings: "rankings",
  league: "league",
};

/**
 * The value `?section=` takes for each area, and back again. Spelled out the same way the views
 * are, so the names in the URL are free to read well without pinning the internal ones.
 */
const SECTION_VALUES: Record<string, RankingsSection> = {
  rankings: "rankings",
  games: "games",
  import: "import",
  scouting: "scouting",
  archive: "archive",
  setup: "setup",
};

const SECTION_URLS: Record<RankingsSection, string> = {
  rankings: "rankings",
  games: "games",
  import: "import",
  scouting: "scouting",
  archive: "archive",
  setup: "setup",
};

/**
 * Every section there is, in URL order.
 *
 * Read off `SECTION_URLS`, whose type forces a key per section, so adding one to the union and
 * forgetting it here is a type error rather than a section nothing tests and no tab reaches.
 */
export const RANKINGS_SECTIONS = Object.keys(SECTION_URLS) as RankingsSection[];

/**
 * The sections the palette can jump to, and the key that jumps there.
 *
 * Here rather than in the view because App reads it too, and the view is lazy-loaded: importing
 * this from there would pull the whole Team Rankings chunk into the first bundle to get at two
 * constants. The label and the key sit together so a section added to the union arrives with both
 * or with a type error, rather than with a command nobody can reach from the keyboard.
 *
 * The letters collide with the league half's on purpose — `g g` is Schedule there and Games here.
 * Only one half is ever on screen, and somebody in Team Rankings pressing `g g` means this one.
 */
export const RANKINGS_COMMAND_SECTIONS: {
  section: RankingsSection;
  label: string;
  key: string;
}[] = [
  { section: "rankings", label: "Rankings", key: "r" },
  { section: "games", label: "Games", key: "g" },
  { section: "import", label: "Import", key: "i" },
  { section: "scouting", label: "Scouting", key: "s" },
  { section: "archive", label: "Archive", key: "a" },
  { section: "setup", label: "Setup", key: "e" },
];

/** The id a section's palette command carries, and what a shortcut matches against. */
export const rankingsSectionCommandId = (section: RankingsSection) => `rankings-section-${section}`;

/**
 * Both halves, for a picker and for a test that must not hardcode them.
 *
 * Off `HALF_URLS`, whose type forces a key per half, so a half added to the union and forgotten
 * here is a type error rather than a board nothing reaches. Same order as
 * `SEASON_SEGMENT_ORDER`, which is the order a season plays them.
 */
export const SEASON_SEGMENTS = Object.keys(HALF_URLS) as SeasonSegment[];

/**
 * Widest season year a link may name. Years are only ever a label for a squad, so this is about
 * rejecting junk — `?year=99999999` — rather than about any real limit on how far ahead a club
 * plans.
 */
const MIN_ROUTE_YEAR = 1900;
const MAX_ROUTE_YEAR = 2999;

const readInt = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const trimmed = value.trim();
  // `Number("")` is 0 and `Number(" 9 ")` is 9, so an empty param would otherwise read as a level.
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

/** Whether a URL could be naming this age level. Levels outside the ladder are dropped. */
export const isRouteAgeLevel = (value: number | undefined): value is number =>
  value !== undefined && value >= MIN_AGE_LEVEL && value <= MAX_AGE_LEVEL;

/** Whether a URL could be naming this season year. */
export const isRouteYear = (value: number | undefined): value is number =>
  value !== undefined && value >= MIN_ROUTE_YEAR && value <= MAX_ROUTE_YEAR;

/**
 * Reads a route out of a query string. Anything unparseable is left out rather than defaulted, so
 * a mistyped link lands on whatever page the app would have opened anyway instead of an empty one.
 * Accepts the string with or without its leading `?`.
 */
export const parseRankingsRoute = (search: string): RankingsRoute => {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const route: RankingsRoute = {};

  const view = params.get(VIEW_PARAM)?.trim().toLowerCase();
  const mode = view ? VIEW_VALUES[view] : undefined;
  if (mode) route.mode = mode;

  const ageLevel = readInt(params.get(AGE_PARAM));
  if (isRouteAgeLevel(ageLevel)) route.ageLevel = ageLevel;

  const year = readInt(params.get(YEAR_PARAM));
  if (isRouteYear(year)) route.year = year;

  // Left out rather than defaulted, like everything else here: a link naming a section nobody has
  // heard of should open the section the app would have opened anyway.
  const section = params.get(SECTION_PARAM)?.trim().toLowerCase();
  const named = section ? SECTION_VALUES[section] : undefined;
  if (named) route.section = named;

  const half = params.get(HALF_PARAM)?.trim().toLowerCase();
  const segment = half ? HALF_VALUES[half] : undefined;
  if (segment) route.segment = segment;

  return route;
};

/**
 * Writes a route back into a query string, preserving every other parameter already there — the
 * app is one page and other features may be using the query string too, so this only ever touches
 * its own four keys. A field left `undefined` removes its parameter, which is how the league mode
 * drops `age` and `year` on the way out.
 *
 * Returns the string including its leading `?`, or `""` when nothing is left, so the result can be
 * handed straight to `history.replaceState` without a separate emptiness check.
 */
export const rankingsSearch = (currentSearch: string, route: RankingsRoute): string => {
  const params = new URLSearchParams(
    currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch
  );

  const set = (key: string, value: string | undefined) => {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  };

  set(VIEW_PARAM, route.mode ? MODE_VIEWS[route.mode] : undefined);
  set(AGE_PARAM, isRouteAgeLevel(route.ageLevel) ? String(route.ageLevel) : undefined);
  set(YEAR_PARAM, isRouteYear(route.year) ? String(route.year) : undefined);
  set(SECTION_PARAM, route.section ? SECTION_URLS[route.section] : undefined);
  set(HALF_PARAM, route.segment ? HALF_URLS[route.segment] : undefined);

  const next = params.toString();
  return next ? `?${next}` : "";
};

/** Whether two routes name the same page — used to avoid pushing a history entry for a no-op. */
export const sameRankingsRoute = (a: RankingsRoute, b: RankingsRoute): boolean =>
  a.mode === b.mode &&
  a.ageLevel === b.ageLevel &&
  a.year === b.year &&
  a.segment === b.segment &&
  a.section === b.section;
