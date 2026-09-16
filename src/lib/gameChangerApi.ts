/**
 * GameChanger's public team API, as this app understands it.
 *
 * Everything here is pure and imports nothing else from the app, because it is shared between the
 * browser and the Vercel function in `api/gc-team.ts` (which `tsconfig.api.json` type-checks on
 * its own, without the React side). The browser cannot call GameChanger directly — the API's CORS
 * only admits web.gc.com — so the function fetches the raw JSON and both sides agree here on what
 * that JSON means: how a profile and a schedule normalize, how a status maps, and how the user's
 * list of team ids (bare ids, page URLs, or their spreadsheet export) is read.
 *
 * The shapes were taken from a real capture of web.gc.com's schedule page; the fixtures under
 * `src/lib/__tests__/fixtures/` are the ground truth for every normalizer.
 */

export type GcSeasonName = "fall" | "winter" | "spring" | "summer";

export type GcSeason = { season: GcSeasonName; year: number };

export type GcTeamProfile = {
  id: string;
  name: string;
  sport?: string;
  city?: string;
  state?: string;
  /** Age level as a number (9 for "9U"). Falls back to a label found in the name. */
  ageLevel?: number;
  season?: GcSeason;
  /** GameChanger's own record for the team's season — a check on the games read, never rated. */
  record?: { win: number; loss: number; tie: number };
  /** The media id of the team's avatar; the one stable thing that identifies an opponent. */
  avatarKey?: string;
  playerCount?: number;
};

export type GcGameStatus = "completed" | "scheduled" | "in_progress" | "canceled" | "unknown";

export type GcGame = {
  id: string;
  /** Calendar date ("YYYY-MM-DD") in the game's own time zone. */
  date?: string;
  startTs?: string;
  timezone?: string;
  opponentName: string;
  opponentAvatarKey?: string;
  homeAway?: "home" | "away";
  teamScore?: number;
  opponentScore?: number;
  status: GcGameStatus;
  /** GameChanger's status string verbatim, for diagnosing a mapping nobody has seen yet. */
  rawStatus?: string;
};

export type GcTeamSchedule = { profile: GcTeamProfile; games: GcGame[]; fetchedAt: string };

export type GcFetchErrorReason =
  | "invalid-id"
  | "not-found"
  | "blocked"
  | "throttled"
  | "upstream-error"
  | "unrecognized"
  | "network"
  | "unconfigured"
  | "timeout";

export type GcFetchDiagnostics = {
  url?: string;
  status?: number;
  contentType?: string;
  bodyPreview?: string;
  topLevelKeys?: string[];
  /** GameChanger's Retry-After header when it throttled the proxy, verbatim. */
  retryAfter?: string;
};

export type GcTeamResponse =
  | { ok: true; schedule: GcTeamSchedule }
  | {
      ok: false;
      reason: GcFetchErrorReason;
      message: string;
      status?: number;
      diagnostics?: GcFetchDiagnostics;
    };

/** One line of the user's team list: an id, plus whatever their spreadsheet said about it. */
export type GcTeamListEntry = {
  teamId: string;
  name?: string;
  ageLevel?: number;
  season?: GcSeason;
  city?: string;
  state?: string;
};

/** The app's own proxy for GameChanger (a Vercel function; see `api/gc-team.ts`). */
export const GC_TEAM_ENDPOINT = "/api/gc-team";

export const GC_PUBLIC_API_BASE = "https://api.team-manager.gc.com";

/** The `Accept` values web.gc.com sends; GameChanger versions its JSON through them. */
export const GC_PROFILE_ACCEPT = "application/vnd.gc.com.public_team_profile+json; version=0.1.0";
export const GC_GAMES_ACCEPT =
  "application/vnd.gc.com.public_team_schedule_event:list+json; version=0.0.0";

/**
 * Every GameChanger team id seen so far is 12 URL-safe characters; the range is loose so a longer
 * or shorter id from a newer GameChanger still gets through to the API, which is the real judge.
 */
export const GC_TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{8,24}$/;

export const GC_FETCH_ERROR_REASONS: readonly GcFetchErrorReason[] = [
  "invalid-id",
  "not-found",
  "blocked",
  "throttled",
  "upstream-error",
  "unrecognized",
  "network",
  "unconfigured",
  "timeout",
];

export const isGcFetchErrorReason = (value: unknown): value is GcFetchErrorReason =>
  typeof value === "string" && (GC_FETCH_ERROR_REASONS as readonly string[]).includes(value);

export const gcTeamPageUrl = (teamId: string): string => `https://web.gc.com/teams/${teamId}`;

export const gcProfileApiUrl = (teamId: string, base: string = GC_PUBLIC_API_BASE): string =>
  `${base.replace(/\/+$/, "")}/public/teams/${encodeURIComponent(teamId)}`;

export const gcGamesApiUrl = (teamId: string, base: string = GC_PUBLIC_API_BASE): string =>
  `${gcProfileApiUrl(teamId, base)}/games`;

/**
 * A team page URL in any of its forms: `https://web.gc.com/teams/<id>`, the same with the slug and
 * `/schedule` after it, or without a scheme. The id must end at a path, query, or word boundary so
 * the slug that follows it is never swallowed into it.
 */
const GC_TEAM_URL_PATTERN = /\bgc\.com\/teams\/([A-Za-z0-9_-]{8,24})(?![A-Za-z0-9_-])/i;

/** A bare id, or the id inside a team page URL, trimmed; `null` when the text holds neither. */
export const parseGcTeamId = (input: string): string | null => {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return null;
  if (GC_TEAM_ID_PATTERN.test(trimmed)) return trimmed;
  const match = GC_TEAM_URL_PATTERN.exec(trimmed);
  return match?.[1] ?? null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const MIN_GC_AGE_LEVEL = 6;
const MAX_GC_AGE_LEVEL = 19;

const inAgeRange = (level: number): boolean =>
  Number.isInteger(level) && level >= MIN_GC_AGE_LEVEL && level <= MAX_GC_AGE_LEVEL;

/**
 * Strict reading of an age-group value: the whole value must be the label ("9U", "9u", "U9",
 * "11U", or a bare number). Anything else — blank, "Varsity", a sentence — is unknown, so a CSV
 * column or GameChanger's `age_group` never invents a level. Use `ageLevelFromName` to find a
 * label inside a longer name.
 */
export const parseGcAgeLevel = (label: unknown): number | undefined => {
  if (typeof label === "number") return inAgeRange(label) ? label : undefined;
  if (typeof label !== "string") return undefined;
  const value = label.trim();
  if (!value) return undefined;
  const match = /^(?:(\d{1,2})\s*[uU]|[uU]\s*(\d{1,2})|(\d{1,2}))$/.exec(value);
  if (!match) return undefined;
  const level = Number(match[1] ?? match[2] ?? match[3]);
  return inAgeRange(level) ? level : undefined;
};

/**
 * The age label a team name carries ("9u Astros", "Trash Pandas 9u", "U11 Bandits") — the
 * fallback when GameChanger's profile or a CSV column leaves the age blank. The label is loose
 * evidence, so callers only use it when nothing better is known.
 *
 * The tier letters travel ball hangs off the level — "9UA", "9UB", "11UAA" — are part of the
 * label, not a different word, so they are consumed rather than read as the end of the name. A
 * plain word boundary rejected every one of them, and a blank age column with the level only in
 * the name is exactly when this function is asked. Only A through D are allowed through, so
 * "12UNDER" is still not a 12U team.
 */
export const ageLevelFromName = (name: string): number | undefined => {
  if (typeof name !== "string") return undefined;
  const match = /\b(?:(\d{1,2})\s*[uU][A-Da-d]{0,3}|[uU]\s*(\d{1,2}))\b/.exec(name);
  if (!match) return undefined;
  const level = Number(match[1] ?? match[2]);
  return inAgeRange(level) ? level : undefined;
};

const SEASON_NAMES: Record<string, GcSeasonName> = {
  fall: "fall",
  autumn: "fall",
  winter: "winter",
  spring: "spring",
  summer: "summer",
};

const parseGcSeasonName = (value: unknown): GcSeasonName | undefined =>
  typeof value === "string" ? SEASON_NAMES[value.trim().toLowerCase()] : undefined;

/**
 * "Fall 2026", "fall 2026", "2027-spring", "Winter 2026-2027" (the first year). The year has to
 * be four digits: "Spring 27" is not read, because a two-digit number in a season cell is just as
 * likely to be something else.
 */
export const parseGcSeasonLabel = (label: string): GcSeason | null => {
  if (typeof label !== "string") return null;
  const value = label.trim().toLowerCase();
  if (!value) return null;
  const name = /\b(fall|autumn|winter|spring|summer)\b/.exec(value);
  const year = /\b((?:19|20)\d{2})\b/.exec(value);
  const season = name ? SEASON_NAMES[name[1] ?? ""] : undefined;
  if (!season || !year) return null;
  return { season, year: Number(year[1]) };
};

export const formatGcSeason = (season: GcSeason): string =>
  `${season.season.charAt(0).toUpperCase()}${season.season.slice(1)} ${season.year}`;

/**
 * The squad year a GameChanger season belongs to. Youth baseball's Fall 2026 and Spring 2027 are
 * the same squad, which this app files under the spring's year ("9U 2027"), so fall and winter
 * roll forward and spring and summer stay put.
 */
export const squadYearForGcSeason = (season: GcSeason): number =>
  season.season === "fall" || season.season === "winter" ? season.year + 1 : season.year;

/**
 * The media id in a GameChanger avatar URL: the path segment after the media-service host, with
 * the signed-URL query (Policy, Signature, expiry) left behind. That segment is stable for a team
 * while the query changes on every page load, so only the segment can identify a team.
 */
export const avatarKeyFromUrl = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const match = /(?:^|\/\/)media-service\.gc\.com\/([^/?#\s]+)/i.exec(url.trim());
  const key = match?.[1];
  if (!key) return undefined;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatDateParts = (date: Date, timeZone: string): string | undefined => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) return undefined;
  return `${year.padStart(4, "0")}-${month}-${day}`;
};

/**
 * The calendar date of an instant in a time zone, as "YYYY-MM-DD". GameChanger gives `start_ts`
 * in UTC, so an evening game in Kentucky is already "tomorrow" in UTC; the schedule's own
 * `timezone` says which day the game was actually played. A zone Intl does not know falls back to
 * UTC rather than losing the game. A bare date is returned as it is.
 */
export const localDateInZone = (iso: string, timeZone?: string): string | undefined => {
  if (typeof iso !== "string") return undefined;
  const trimmed = iso.trim();
  if (!trimmed) return undefined;
  if (DATE_ONLY_PATTERN.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  if (timeZone && timeZone.trim()) {
    try {
      return formatDateParts(date, timeZone.trim());
    } catch {
      // An unknown zone throws a RangeError; UTC is the honest fallback.
    }
  }
  return formatDateParts(date, "UTC");
};

const normalizeRecord = (raw: unknown): GcTeamProfile["record"] | undefined => {
  if (!isRecord(raw)) return undefined;
  const win = asNumber(raw.win ?? raw.wins);
  const loss = asNumber(raw.loss ?? raw.losses);
  const tie = asNumber(raw.tie ?? raw.ties) ?? 0;
  if (win === undefined || loss === undefined) return undefined;
  return { win, loss, tie };
};

const normalizeSeason = (raw: unknown): GcSeason | undefined => {
  if (!isRecord(raw)) return undefined;
  const season = parseGcSeasonName(raw.season ?? raw.name);
  const year = asNumber(raw.year);
  if (!season || year === undefined || !Number.isInteger(year)) return undefined;
  return { season, year };
};

/**
 * Unwraps an envelope such as `{ data: {...} }` or `{ team: {...} }` when the body itself does not
 * look like the profile, so a future wrapping of the same payload still reads.
 */
const unwrapProfile = (raw: unknown): Record<string, unknown> | null => {
  if (!isRecord(raw)) return null;
  if (typeof raw.name === "string") return raw;
  for (const key of ["team", "profile", "data"]) {
    const inner = raw[key];
    if (isRecord(inner) && typeof inner.name === "string") return inner;
  }
  return null;
};

/**
 * Reads GameChanger's public team profile. `null` when the body is not a profile at all (no
 * name, or no id anywhere), which the proxy reports as "unrecognized" with diagnostics. The
 * `fallbackId` is the id the caller asked for, in case a future payload leaves `id` out.
 */
export const normalizeGcTeamProfile = (raw: unknown, fallbackId?: string): GcTeamProfile | null => {
  const source = unwrapProfile(raw);
  if (!source) return null;
  const name = asString(source.name);
  const id = asString(source.id) ?? asString(fallbackId);
  if (!name || !id) return null;

  const location = isRecord(source.location) ? source.location : {};
  const profile: GcTeamProfile = { id, name };

  const sport = asString(source.sport);
  if (sport) profile.sport = sport.toLowerCase();
  const city = asString(location.city ?? source.city);
  if (city) profile.city = city;
  const state = asString(location.state ?? source.state);
  if (state) profile.state = state;

  const ageLevel = parseGcAgeLevel(source.age_group ?? source.ageGroup) ?? ageLevelFromName(name);
  if (ageLevel !== undefined) profile.ageLevel = ageLevel;

  const teamSeason = isRecord(source.team_season) ? source.team_season : undefined;
  const season = normalizeSeason(teamSeason ?? source.season);
  if (season) profile.season = season;

  const record = normalizeRecord(teamSeason?.record ?? source.record);
  if (record) profile.record = record;

  const avatarKey = avatarKeyFromUrl(source.avatar_url ?? source.avatarUrl);
  if (avatarKey) profile.avatarKey = avatarKey;

  const playerCount = asNumber(source.player_count ?? source.playerCount);
  if (playerCount !== undefined) profile.playerCount = playerCount;

  return profile;
};

const COMPLETED_STATUSES = new Set(["completed", "complete", "final", "finished", "done"]);
const CANCELED_STATUSES = new Set([
  "canceled",
  "cancelled",
  "postponed",
  "forfeit",
  "forfeited",
  "abandoned",
  "rained_out",
  "rainout",
]);
const IN_PROGRESS_STATUSES = new Set(["in_progress", "inprogress", "live", "started", "ongoing"]);
const SCHEDULED_STATUSES = new Set(["scheduled", "upcoming", "pending", "not_started", "tbd"]);

/**
 * GameChanger's status words, mapped. Only `completed` has been seen; the rest are the values a
 * schedule API is expected to use. A missing status is read from the scores (two numbers mean a
 * played game), but an unfamiliar word stays "unknown" rather than being guessed at, so the
 * consumer never counts a game GameChanger did not clearly call final.
 */
export const normalizeGcGameStatus = (raw: unknown, hasScores: boolean): GcGameStatus => {
  const value =
    typeof raw === "string"
      ? raw
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      : "";
  if (!value) return hasScores ? "completed" : "scheduled";
  if (COMPLETED_STATUSES.has(value)) return "completed";
  if (CANCELED_STATUSES.has(value)) return "canceled";
  if (IN_PROGRESS_STATUSES.has(value)) return "in_progress";
  if (SCHEDULED_STATUSES.has(value)) return "scheduled";
  return "unknown";
};

const GAME_LIST_KEYS = ["games", "events", "data", "items"] as const;

/** The list of raw schedule entries in a body, whether it is the array itself or wraps one. */
export const gcGameListFrom = (raw: unknown): unknown[] | null => {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return null;
  for (const key of GAME_LIST_KEYS) {
    const inner = raw[key];
    if (Array.isArray(inner)) return inner;
  }
  return null;
};

const normalizeGcGame = (raw: unknown): GcGame | null => {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;

  const opponent = isRecord(raw.opponent_team)
    ? raw.opponent_team
    : isRecord(raw.opponent)
      ? raw.opponent
      : {};
  const opponentName = asString(opponent.name ?? raw.opponent_name);
  // An entry with no opponent is a practice or a placeholder slot: nothing to rate or to show.
  if (!opponentName) return null;

  const score = isRecord(raw.score) ? raw.score : {};
  const teamScore = asNumber(score.team);
  const opponentScore = asNumber(score.opponent_team ?? score.opponent);
  /*
   * 0-0 is GameChanger's "nobody entered a score", not a tie: its own season record leaves these
   * games out, and a pull of twenty thousand schedules carried 852 of them — none a real 0-0 in
   * a sport where that scarcely happens — each one counted here as a draw.
   */
  const hasScores =
    teamScore !== undefined &&
    opponentScore !== undefined &&
    !(teamScore === 0 && opponentScore === 0);

  const game: GcGame = {
    id,
    opponentName,
    status: normalizeGcGameStatus(raw.game_status ?? raw.status, hasScores),
  };

  const startTs = asString(raw.start_ts ?? raw.start);
  const timezone = asString(raw.timezone ?? raw.time_zone);
  if (startTs) game.startTs = startTs;
  if (timezone) game.timezone = timezone;
  const date = startTs ? localDateInZone(startTs, timezone) : undefined;
  if (date) game.date = date;

  const avatarKey = avatarKeyFromUrl(opponent.avatar_url ?? opponent.avatarUrl);
  if (avatarKey) game.opponentAvatarKey = avatarKey;

  const homeAway = asString(raw.home_away ?? raw.homeAway)?.toLowerCase();
  if (homeAway === "home" || homeAway === "away") game.homeAway = homeAway;

  if (hasScores) {
    game.teamScore = teamScore;
    game.opponentScore = opponentScore;
  }

  const rawStatus = asString(raw.game_status ?? raw.status);
  if (rawStatus) game.rawStatus = rawStatus;

  return game;
};

/**
 * Reads GameChanger's schedule list. Accepts the bare array the API returns today or an object
 * holding it under `games`/`events`/`data`/`items`. Entries that cannot be read (no id, no
 * opponent) are skipped rather than failing the whole schedule.
 */
export const normalizeGcGames = (raw: unknown): GcGame[] => {
  const list = gcGameListFrom(raw);
  if (!list) return [];
  const games: GcGame[] = [];
  for (const entry of list) {
    const game = normalizeGcGame(entry);
    if (game) games.push(game);
  }
  return games;
};

// ---------- The user's team list ----------

const BOM = "\uFEFF";

const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);

/** One delimited line, honouring quotes and doubled quotes; cells come back trimmed. */
const splitDelimitedLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"' && (inQuotes || current.trim().length === 0)) {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

const normalizeHeader = (header: string): string =>
  stripBom(header).trim().toLowerCase().replace(/\s+/g, " ");

const ID_HEADERS = ["team id", "teamid", "id", "gamechanger id", "gc id", "gamechanger team id"];
const URL_HEADERS = ["gamechanger url", "url", "team url", "link", "gamechanger link"];
const NAME_HEADERS = ["team name", "name", "team"];
const AGE_HEADERS = ["age group", "age", "age level", "division"];
const SEASON_HEADERS = ["season"];
const CITY_HEADERS = ["city"];
const STATE_HEADERS = ["state"];

const columnIndex = (headers: string[], names: string[]): number => {
  for (const name of names) {
    const at = headers.indexOf(name);
    if (at >= 0) return at;
  }
  return -1;
};

/**
 * A bare token that is more likely an id than a word: it has a digit, or a capital letter after a
 * lowercase one, the way GameChanger's generated ids do and a capitalised word does not. A
 * headerless paste of spreadsheet rows still contains city and team names that happen to be 8–24
 * letters ("Georgetown"); when a line also holds a real-looking id, those words are dropped, but a
 * lone alphabetic token on its own line is still taken as an id, because the API is the final
 * judge and a wrong id fails loudly there.
 */
const looksLikeGeneratedId = (token: string): boolean =>
  /\d/.test(token) || /[a-z][A-Z]/.test(token);

const idsFromFreeText = (line: string): string[] => {
  const tokens = line.split(/[\s,;]+/).filter(Boolean);
  const fromUrls: string[] = [];
  const strong: string[] = [];
  const weak: string[] = [];
  for (const token of tokens) {
    const id = parseGcTeamId(token);
    if (!id) continue;
    if (GC_TEAM_URL_PATTERN.test(token)) fromUrls.push(id);
    else if (looksLikeGeneratedId(id)) strong.push(id);
    else weak.push(id);
  }
  if (fromUrls.length > 0 || strong.length > 0) return [...fromUrls, ...strong];
  return weak;
};

type ListColumns = {
  id: number;
  url: number;
  name: number;
  age: number;
  season: number;
  city: number;
  state: number;
};

const readColumns = (headers: string[]): ListColumns | null => {
  const id = columnIndex(headers, ID_HEADERS);
  const url = columnIndex(headers, URL_HEADERS);
  if (id < 0 && url < 0) return null;
  return {
    id,
    url,
    name: columnIndex(headers, NAME_HEADERS),
    age: columnIndex(headers, AGE_HEADERS),
    season: columnIndex(headers, SEASON_HEADERS),
    city: columnIndex(headers, CITY_HEADERS),
    state: columnIndex(headers, STATE_HEADERS),
  };
};

const cellAt = (cells: string[], index: number): string =>
  index >= 0 ? (cells[index] ?? "").trim() : "";

/** The id a spreadsheet row names: the id column, the URL column, then any cell holding a URL. */
const idFromRow = (cells: string[], columns: ListColumns): string | null => {
  const fromId = parseGcTeamId(cellAt(cells, columns.id));
  if (fromId) return fromId;
  const fromUrl = parseGcTeamId(cellAt(cells, columns.url));
  if (fromUrl) return fromUrl;
  for (const cell of cells) {
    const match = GC_TEAM_URL_PATTERN.exec(cell);
    if (match?.[1]) return match[1];
  }
  // A bare id pasted under the header, on a line of its own.
  const nonEmpty = cells.filter((cell) => cell.length > 0);
  if (nonEmpty.length === 1 && nonEmpty[0] !== undefined) return parseGcTeamId(nonEmpty[0]);
  return null;
};

/**
 * The club's name out of a list cell that carries more than the name.
 *
 * A team list exported from GameChanger's own pages writes the whole card into one cell —
 * "101 Baseball Bros 9U Fall 2026 • Staff: Eric Deskins • 10 players" — and everything after the
 * first bullet describes the team rather than naming it. Keeping it would put the coach and a
 * player count into a team's name on any row the pull cannot reach, and into every line of the
 * review before it. The bullet is the separator GameChanger uses; a name that genuinely contains
 * one is not a thing.
 */
const nameFromListCell = (cell: string): string => {
  const [first = ""] = cell.split(/\s*[•·]\s*/);
  return first.trim() || cell.trim();
};

const entryFromRow = (teamId: string, cells: string[], columns: ListColumns): GcTeamListEntry => {
  const entry: GcTeamListEntry = { teamId };
  const name = nameFromListCell(cellAt(cells, columns.name));
  if (name) entry.name = name;
  // The same fallback `normalizeGcTeamProfile` makes: an export can leave the age column blank
  // and still name the level in the team name, which is how every such row in the wild reads.
  const ageLevel = parseGcAgeLevel(cellAt(cells, columns.age)) ?? ageLevelFromName(name);
  if (ageLevel !== undefined) entry.ageLevel = ageLevel;
  const season = parseGcSeasonLabel(cellAt(cells, columns.season));
  if (season) entry.season = season;
  const city = cellAt(cells, columns.city);
  if (city) entry.city = city;
  const state = cellAt(cells, columns.state);
  if (state) entry.state = state;
  return entry;
};

/**
 * Reads whatever the user pastes as their team list.
 *
 * Two shapes: their spreadsheet export (a header row naming at least a `Team ID` or `GameChanger
 * URL` column, the rest — Team Name, Age Group, Season, City, State — in any order, BOM and
 * quoted names tolerated, tab-separated when copied straight out of a sheet), or a headerless
 * list of ids and/or page URLs separated by newlines, commas, or spaces. Ids are deduplicated
 * with the first line winning, so a re-pasted row cannot double a team. `skipped` lists every
 * non-blank line that produced no entry, so the panel can say how many were ignored.
 */
export const parseGcTeamList = (
  text: string
): { entries: GcTeamListEntry[]; skipped: string[] } => {
  const entries: GcTeamListEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  if (typeof text !== "string") return { entries, skipped };

  const lines = stripBom(text).split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim().length > 0) ?? "";
  // Sheets copy out as tab-separated text; the export file is comma-separated.
  const delimiter = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const headerCells = splitDelimitedLine(firstLine, delimiter).map(normalizeHeader);
  const columns = readColumns(headerCells);

  const add = (teamId: string, build: () => GcTeamListEntry): boolean => {
    if (seen.has(teamId)) return false;
    seen.add(teamId);
    entries.push(build());
    return true;
  };

  let headerSkipped = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (columns && !headerSkipped) {
      headerSkipped = true;
      continue;
    }

    if (columns) {
      const cells = splitDelimitedLine(line, delimiter);
      const teamId = idFromRow(cells, columns);
      if (!teamId || !add(teamId, () => entryFromRow(teamId, cells, columns))) {
        skipped.push(line);
      }
      continue;
    }

    const ids = idsFromFreeText(line);
    let added = 0;
    for (const teamId of ids) {
      if (add(teamId, () => ({ teamId }))) added += 1;
    }
    if (added === 0) skipped.push(line);
  }

  return { entries, skipped };
};
