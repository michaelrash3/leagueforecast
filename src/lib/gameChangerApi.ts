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
  /**
   * GameChanger's own `age_group`, exactly as it sent it — "9U", "11U/12U", "2027", or nothing.
   *
   * Kept beside the parsed level because the parse throws away the only evidence of why it failed.
   * Thousands of teams reach the pool with no level at all, and the answer to what to do about
   * them is in the label they were filed under: an unreadable bracket is a parser fix, a
   * graduation year is a different rule, and an empty field means the club never set one.
   */
  ageLabel?: string;
  season?: GcSeason;
  /** GameChanger's own record for the team's season — a check on the games read, never rated. */
  record?: { win: number; loss: number; tie: number };
  /** The media id of the team's avatar; the one stable thing that identifies an opponent. */
  avatarKey?: string;
  playerCount?: number;
  /**
   * The bodies the team plays under — `["usssa"]`, `["little league"]` — lowercased.
   *
   * The one field in the payload that says which circuit a club belongs to, and the answer to the
   * question the division words cannot settle on their own. "Majors" is a Little League division
   * of nine- to twelve-year-olds and a USSSA skill class at any age; "AAA" is a local Little
   * League convention and a USSSA grade and, in Canada, a provincial tier. The word is the same
   * and the meaning is not, so reading an age out of one means knowing whose word it is.
   */
  ngb?: string[];
  /**
   * The coaches GameChanger names on the public profile.
   *
   * Worth as much here as it is on a pasted row, and for the measured reason recorded on
   * `GcTeamListEntry.staff`: two teams sharing two of these are the same club 97% of the time by
   * state and 89% by town.
   */
  staff?: string[];
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

export type GcTeamSchedule = {
  profile: GcTeamProfile;
  games: GcGame[];
  fetchedAt: string;
  /**
   * What the user's own team list said about this team, when they pasted one that carried it.
   *
   * Kept apart from `profile` because the two have different authority: a field in there is
   * something GameChanger said, and this is something the user's spreadsheet said. Where both
   * speak, `linkFor` prefers this one — the export is the newer reading and the one its owner can
   * correct.
   *
   * This used to say GameChanger's public endpoints return neither the staff nor the roster size,
   * and the code followed the comment. The captured profile returns both: `player_count` was read
   * anyway, `staff` was not, and the strongest club-matching signal in the data was arriving free
   * on every fetch and being dropped on the floor.
   */
  listed?: {
    staff?: string[];
    playerCount?: number;
    /**
     * The age the list implies, from a league association naming one — see `ageFromLeagueNames`.
     *
     * Here rather than on `profile` because GameChanger did not say it: the API has no route from
     * a team to its leagues, so this is the user's crawl answering a question the API cannot.
     */
    ageLevel?: number;
  };
};

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
  /** A wiffle ball team, which is a different game. Never fetched and never filed. */
  notBaseball?: true;
  /** A high school squad, which plays its own season. Never fetched and never filed. */
  highSchool?: true;
  /**
   * Grown men or a college side, by GameChanger's own age field. Never fetched and never filed.
   *
   * Marked from the list rather than learned from the profile because the export carries the
   * field verbatim, and a team nobody will ever rank is not worth two requests to confirm.
   */
  notYouth?: true;
  ageLevel?: number;
  season?: GcSeason;
  city?: string;
  state?: string;
  /**
   * The coaches named on the team's card, in the order the export lists them.
   *
   * Two teams sharing two of these are almost always one club: measured over a forty-thousand-team
   * export, such a pair is in the same state 97% of the time and the same town 89%. Sharing one is
   * worth much less — 58% and 45% — because clubs often require an organisation officer on every
   * team's staff, which puts one shared name on teams with nothing else to do with each other.
   */
  staff?: string[];
  /**
   * Players on the roster when the list was taken.
   *
   * It takes nine to field a side, so a team with fewer is probably not a team yet — a page
   * somebody made and did not finish, or a squad still being assembled. Worth keeping and worth
   * looking at again rather than importing as though it were a club.
   */
  playerCount?: number;
  /**
   * The organization the team belongs to, when the list names one.
   *
   * The answer GameChanger's public API will not give: there is no team-to-organization route, so
   * nothing the app fetches can say which club or league a team is part of. A crawl that found
   * the team through its organization knows, and this is where it says so.
   */
  org?: {
    orgId?: string;
    name?: string;
    kind?: GcOrgKind;
    city?: string;
    state?: string;
    season?: GcSeason;
  };
  /**
   * The leagues it plays in. A league is where a team plays its own age, so a league that names
   * one — "NKB 11u" — is saying something about the team.
   */
  leagues?: GcTeamAssociation[];
  /**
   * The tournaments it entered. Not the same thing at all: a tournament is where a team plays
   * **up**, so an age in a tournament's name is a ceiling it reached rather than the age it is.
   * The sample that made this plain is an 11U team in "NB Summer Slam 12U".
   */
  tournaments?: GcTeamAssociation[];
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

/**
 * A name that says the team is not playing baseball.
 *
 * Wiffle ball is a different game — a plastic ball, a plastic bat, and scores that say nothing
 * about how a baseball team would fare. Nine such teams were in a 48,035-team export, filed under
 * ordinary age groups (10U to 16U) in five states, and nothing in the GameChanger record marks
 * them apart: it is a baseball platform and reports them as baseball. The name is the only signal
 * there is.
 *
 * Both spellings, because the export carries eight "Wiffle" to one "Whiffle", and the compound
 * with them — "Wiffleball", "Whiffleball". No baseball word contains the sequence, so matching it
 * anywhere in the name costs nothing in false positives.
 *
 * Here rather than beside the pool's other name rules because both sides need it: the list parse,
 * which drops these before a request is ever spent on one, and the import, which refuses a
 * schedule and deletes a team already filed.
 */
const NOT_BASEBALL = /wh?iffle/i;

export const isNotBaseball = (name: unknown): boolean =>
  typeof name === "string" && NOT_BASEBALL.test(name);

/**
 * The sanctioning bodies off a profile's `ngb` field.
 *
 * The shape is odd and has to be read leniently: the captured profile carries the *string*
 * `"[\"usssa\"]"` — a JSON array that something serialised on its way out and nothing parsed on
 * its way back. So a JSON array in a string, a bare string, and a real array are all read, and
 * anything else comes back empty rather than guessed at.
 *
 * Lowercased, trimmed and deduplicated, because it is compared against, never displayed: the
 * question asked of it is "is this Little League?", and the answer must not turn on spacing.
 */
export const parseGcNgb = (raw: unknown): string[] => {
  const asList = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        // A string that opens like an array and is not one says nothing; it is not a body name.
        return [];
      }
    }
    return [text];
  };
  const seen = new Set<string>();
  const bodies: string[] = [];
  for (const entry of asList(raw)) {
    if (typeof entry !== "string") continue;
    const body = entry.replace(/\s+/g, " ").trim().toLowerCase();
    if (!body || seen.has(body)) continue;
    seen.add(body);
    bodies.push(body);
  }
  return bodies;
};

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

/**
 * An organization's page URL. GameChanger's leagues, tournaments and travel clubs are all the
 * same `organizations` object, reached at `/organizations/{id}/home`, `/teams` or `/schedule`.
 */
const GC_ORG_URL_PATTERN = /\bgc\.com\/organizations\/([A-Za-z0-9_-]{8,24})(?![A-Za-z0-9_-])/i;

/**
 * A bare organization id, or the id inside an organization URL.
 *
 * An org id and a team id are the same shape — both are short URL-safe strings against
 * `GC_TEAM_ID_PATTERN` — so nothing here can tell one from the other, and nothing tries. What
 * keeps them apart is the file a row arrives in: the team list means teams and the organization
 * list means organizations, which is why they are two files rather than one with a type column.
 */
export const parseGcOrgId = (input: string): string | null => {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return null;
  const match = GC_ORG_URL_PATTERN.exec(trimmed);
  if (match?.[1]) return match[1];
  return GC_TEAM_ID_PATTERN.test(trimmed) ? trimmed : null;
};

export const gcOrgPageUrl = (orgId: string): string =>
  `https://web.gc.com/organizations/${orgId}/home`;

/**
 * What kind of thing an organization is, which decides what its teams are.
 *
 * A travel organization is a club and its teams are ranked as any other. A tournament is an event
 * whose brackets often name an age. A league is neither automatically: "NKB 11u" is a travel
 * league and "Mt. Carmel Little League" is rec ball, and only the name says which — the kind says
 * the shape of the thing, not how its teams should be rated.
 */
export type GcOrgKind = "league" | "tournament" | "travel";

const ORG_KINDS: Record<string, GcOrgKind> = {
  league: "league",
  leagues: "league",
  tournament: "tournament",
  tournaments: "tournament",
  travel: "travel",
  "travel org": "travel",
  "travel organization": "travel",
  "travel organisation": "travel",
  club: "travel",
  organization: "travel",
  organisation: "travel",
  org: "travel",
};

export const parseGcOrgKind = (raw: unknown): GcOrgKind | undefined =>
  typeof raw === "string" ? ORG_KINDS[raw.trim().toLowerCase()] : undefined;

/** One row of the user's organization list. */
export type GcOrgListEntry = {
  orgId: string;
  name?: string;
  kind?: GcOrgKind;
  city?: string;
  state?: string;
  sport?: string;
  /** Both halves known. A season word with no year, or a year with no word, is neither. */
  season?: GcSeason;
  /** The year on its own, for the rows that carry one without a season word. */
  seasonYear?: number;
  /** How many teams the org had when the list was taken — an estimate before anything is fetched. */
  teamCount?: number;
  /**
   * The GameChanger ids of the teams under it, when the list names them.
   *
   * GameChanger's public API has no route from a team to its organizations, so this column is the
   * only way the app learns which league a team plays in when the team list's own row names none
   * — and that is most of them: every row of three real team exports left the league column empty.
   */
  teamIds?: string[];
};

/** One league or tournament a team belongs to: `"NKB 11u|Pqy5Av4tHncy"`. */
export type GcTeamAssociation = { name: string; orgId?: string };

/**
 * The associations out of one cell: `"Name|Id;Name|Id"`.
 *
 * Semicolons between entries and a pipe between a name and its id, which is the shape the export
 * writes. Either half may be missing — a name with no id is still worth keeping, because the name
 * is what carries an age — and a repeated id is one association.
 */
export const parseGcAssociations = (cell: string): GcTeamAssociation[] => {
  if (typeof cell !== "string" || !cell.trim()) return [];
  const seen = new Set<string>();
  const out: GcTeamAssociation[] = [];
  for (const part of cell.split(";")) {
    const [rawName = "", rawId = ""] = part.split("|");
    const name = rawName.replace(/\s+/g, " ").trim();
    const orgId = parseGcOrgId(rawId);
    if (!name && !orgId) continue;
    const key = (orgId ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, ...(orgId ? { orgId } : {}) });
  }
  return out;
};

/**
 * The age a team's leagues say it plays at, when they say one and agree.
 *
 * A league is where a team plays its own age. A tournament is where it plays **up**, so this
 * deliberately takes only the leagues: the row that settles it is an 11U team whose league is
 * "NKB 11u" and whose tournaments include "NB Summer Slam 12U", and reading the tournament would
 * file it a year old and make every game in its own league read as playing down.
 *
 * Two leagues naming different ages is not an answer — one of them is about a different squad of
 * the same club — so it refuses rather than picking, which is the rule `ageFromOpponentNames`
 * already holds a tie to.
 */
/**
 * An organization's name that is an event rather than a standing body.
 *
 * "(09/25/2026) 17/18u Super Fall Invitational", "FS 4th Annual Mid-Atlantic Labor Day Classic".
 * A tournament's age is a ceiling teams reached rather than the age they are, which is the same
 * distinction `ageFromLeagueNames` draws between a league and a tournament — except that a crawl
 * types every organization the same way, so the name is all there is to go on.
 */
const EVENT_NAME =
  /\(\d{1,2}\/\d{1,2}\/\d{2,4}\)|\b(?:classic|invitational|tournament|showdown|championship|cup|slam|bash|shootout|opener|qualifier|series|festival|jamboree|clash|brawl|showcase|annual)\b/i;

/**
 * "13U-16U COBRA Fall 2026", "Suburban Travel 13/14u", "17-19u" — several ages share the
 * organization, so its top end is nobody's age in particular.
 *
 * The optional `U` after the *first* number is load-bearing: clubs write the span both ways, and
 * without it "13U-16U" reads as a plain 16U and files thirteen-year-olds three years old.
 */
const MULTI_AGE = /\b\d{1,2}\s*[uU]?\s*[-\u2013/]\s*\d{1,2}\s*[uU]\b/;

/**
 * The age an organization's own name states, where that is a statement about its teams.
 *
 * An organization named "TPABL 12U" or "GLL 8u Fall 2026" is saying what age plays under it, and
 * for a team that has no age of its own that is worth more than nothing — which is what such a
 * team has. GameChanger's public API has no route from a team to its organization, so this only
 * ever arrives from a crawl that found the team through one.
 *
 * Refused for events and for spans, and both refusals are measured. Over 17,003 teams carrying an
 * organization, 2,240 had both an org naming an age and an age of their own to check it against.
 * The org's age agreed 90.1% of the time. Excluding event-sounding names took that to 94.1%,
 * excluding spans to 93.9%, and excluding both to **95.1%** — and the errors are overwhelmingly
 * one-directional: of 221 disagreements, 197 had the organization *older* than the team. That is
 * the play-up signature. "(09/25/2026) 17/18u Super Fall Invitational" holds 16U teams;
 * "Suburban Travel 13/14u" holds 13U ones.
 *
 * 95% is not good enough to outrank anything a team says about itself, so this sits at the very
 * bottom of the ladder, under the league rung and under the company a team keeps. It only ever
 * answers a team that has no other answer at all.
 */
export const ageFromOrgName = (name: unknown): number | undefined => {
  if (typeof name !== "string" || !name.trim()) return undefined;
  if (EVENT_NAME.test(name) || MULTI_AGE.test(name)) return undefined;
  return ageLevelFromName(name);
};

export const ageFromLeagueNames = (
  leagues: readonly GcTeamAssociation[] | undefined
): number | undefined => {
  if (!leagues?.length) return undefined;
  const levels = new Set<number>();
  for (const league of leagues) {
    const level = ageLevelFromName(league.name);
    if (level !== undefined) levels.add(level);
  }
  return levels.size === 1 ? [...levels][0] : undefined;
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

/** One age label on its own: "9U", "9u", "U9", "12UA", or a bare number. */
const AGE_TOKEN = /^(?:(\d{1,2})\s*[uU][A-Da-d]{0,3}|[uU]\s*(\d{1,2})|(\d{1,2}))$/;

const ageToken = (part: string): number | undefined => {
  const match = AGE_TOKEN.exec(part.trim());
  if (!match) return undefined;
  const level = Number(match[1] ?? match[2] ?? match[3]);
  return inAgeRange(level) ? level : undefined;
};

/**
 * Strict reading of an age-group value: the whole value must be the label ("9U", "9u", "U9",
 * "11U", "12UA", or a bare number). Anything else — blank, "Varsity", a sentence — is unknown, so
 * a CSV column or GameChanger's `age_group` never invents a level. Use `ageLevelFromName` to find
 * a label inside a longer name.
 *
 * The tier letters travel ball hangs off the level — "12UA", "11UAA" — are part of the label here
 * for the same reason they are in a name: they say which bracket within the age, not a different
 * age. No row in a 48,035-team export carries one in this column, so this costs nothing today; it
 * is here so the two readers agree rather than disagreeing by accident.
 *
 * A bracket spanning two ages — "11U/12U", and sometimes written the other way round as
 * "12U/11U" — reads as the OLDER of them, because that is the level the team is competing at: a
 * bracket that admits twelve-year-olds is a 12U bracket, and rating such a team as 11U would make
 * every game it plays against a 12U side look like playing up. Every part still has to be an age
 * label, so "2026-2027" and "Varsity/JV" stay unknown rather than becoming a guess.
 */
export const parseGcAgeLevel = (label: unknown): number | undefined => {
  if (typeof label === "number") return inAgeRange(label) ? label : undefined;
  if (typeof label !== "string") return undefined;
  const value = label.trim();
  if (!value) return undefined;
  const parts = value.split(/[/\-\u2013]/).filter((part) => part.trim() !== "");
  if (parts.length === 0) return undefined;
  let oldest: number | undefined;
  for (const part of parts) {
    const level = ageToken(part);
    // One unreadable part makes the whole value unreadable: half a label is not a level.
    if (level === undefined) return undefined;
    oldest = oldest === undefined ? level : Math.max(oldest, level);
  }
  return oldest;
};

/**
 * The bracket a team name spells out — "Braves 9u/10u Fall", "Astros (9U/10U)", "AZ Core 17U/18U",
 * and the shorthand "OM 9/10U" where only the second age carries its U. Undefined when the name
 * carries no bracket, or when either end is not an age this app ranks.
 *
 * Its own function, rather than a step inside `ageLevelFromName`, because a bracket is not simply
 * another way of writing a level. A single label is one age somebody typed; a bracket is the team
 * saying which two ages it takes the field against, which is why `ageLevelOf` lets it outrank an
 * age written anywhere else, and why `cleanTeamName` takes it off a name as one thing rather than
 * as two labels with a separator stranded between them.
 *
 * The second age must carry the U, which is what keeps "Mears 1 - 2026" and other stray number
 * pairs out.
 */
export const ageSpanFromName = (name: string): { low: number; high: number } | undefined => {
  if (typeof name !== "string") return undefined;
  const span =
    /\b(\d{1,2})\s*(?:[uU][A-Da-d]{0,3})?\s*[/\-\u2013]\s*(\d{1,2})\s*[uU][A-Da-d]{0,3}/.exec(name);
  if (!span) return undefined;
  const first = Number(span[1]);
  const second = Number(span[2]);
  if (!inAgeRange(first) || !inAgeRange(second)) return undefined;
  // Written both ways round in the wild — "9U/10U" and "12U/11U" are both in the export — so the
  // two ends are sorted rather than assumed to be in order.
  return { low: Math.min(first, second), high: Math.max(first, second) };
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
  // A bracket reads as its older end, the same as the age column does. Checked first, because the
  // plain search below would stop on the younger number and never see the rest of it. A bracket
  // with an unrankable end is no bracket at all, and falls through to that search.
  const span = ageSpanFromName(name);
  if (span) return span.high;
  const match = /\b(?:(\d{1,2})\s*[uU][A-Da-d]{0,3}|[uU]\s*(\d{1,2}))\b/.exec(name);
  if (!match) return undefined;
  const level = Number(match[1] ?? match[2]);
  return inAgeRange(level) ? level : undefined;
};

/**
 * A name that says the team plays a high school season.
 *
 * These are refused outright rather than filed at 18U, and the reason is the rating, not the age.
 * A school squad plays other school squads — a varsity side's whole schedule is other varsity
 * sides — so the fit sees a cluster joined to the rest of the pool by almost nothing. A
 * least-squares rating across a component that barely touches the others is not so much wrong as
 * meaningless: the numbers inside it are relative to each other and to nothing else, and putting
 * them in the 18U table beside travel ball invites exactly the comparison the data cannot carry.
 *
 * So the whole category is out. It costs nothing that was ever going to be ranked honestly, and
 * it takes off the "waiting on an age" list thousands of teams no amount of asking could settle.
 *
 * Read from the name, like `isNotBaseball` and for the same reason: the name is on the pasted row,
 * so these are dropped before a request is spent on one, and every later export drops them again
 * without anything having to remember an id.
 *
 * Three ways a name says it, and one that only half says it:
 *
 * - **"Varsity", "JV", "Junior Varsity"** name a school-season squad and nothing else does. The
 *   long form needs no separate pattern: it contains "Varsity". Refused whatever else the name
 *   carries, because a side calling itself varsity is playing the school season even if it also
 *   writes an age.
 * - **"JV/V"** is a programme listing both its squads, and falls out of the same rule — the JV is
 *   what says the lone "V" beside it is varsity.
 * - **"HS" or "High School" with no age label** is the school's own team. "Lincoln HS" on a
 *   schedule means Lincoln's side, not a club named after a building.
 * - **"HS" with an age label** — "Lincoln HS 16U" — is deliberately left alone. That is a summer
 *   squad playing an age bracket against travel ball, which is connected to the pool and belongs
 *   in it. The age label is the thing that says so.
 *
 * And one thing outranks all of it: an age nobody in high school could be playing at. A freshman
 * is fourteen at the youngest, so "Varsity Elite 12U" and "JV Sluggers 10U" are travel clubs that
 * like the words, not school sides, and no squad word can make them otherwise. Without this the
 * rule quietly deleted them, and a wrongly refused club leaves nothing behind to notice it by.
 *
 * A lone "V" with no JV beside it is not enough on its own: see `maybeSchoolTeam`.
 */
const SCHOOL_SQUAD = /\b(?:varsity|jv)\b/i;
const HIGH_SCHOOL = /\b(?:hs|high\s+school)\b/i;

/** The youngest a freshman is, and so the youngest a name can say and still mean high school. */
export const MIN_HIGH_SCHOOL_AGE = 14;

export const isSchoolName = (name: unknown): boolean => {
  if (typeof name !== "string") return false;
  const stated = ageLevelFromName(name);
  if (stated !== undefined && stated < MIN_HIGH_SCHOOL_AGE) return false;
  if (SCHOOL_SQUAD.test(name)) return true;
  if (!HIGH_SCHOOL.test(name)) return false;
  return stated === undefined;
};

/*
 * ---------------------------------------------------------------------------------------------
 * GameChanger's own age vocabulary
 * ---------------------------------------------------------------------------------------------
 *
 * The age field does not only carry "12U" and "Varsity". It carries a small closed vocabulary of
 * its own, and until these readers existed this app understood none of it — `parseGcAgeLevel`,
 * `ageLevelOf` and `isSchoolAgeLabel` all returned nothing for every value below, which is why
 * teams whose page plainly said what they were sat on the waiting list being asked about weekly.
 *
 * Measured over the 36,194 teams waiting on an age on 22 September 2026, where the field is set
 * on 36,182 of them — 99.97% — and holds exactly eleven distinct values:
 *
 *   Under 13            27,485   75.9%   a ceiling, not an age
 *   Between 13 - 18      3,967   11.0%   a band, not an age
 *   Over 18              2,049    5.7%   adults
 *   college                719    2.0%   college
 *   18O                    535    1.5%   adults
 *   middle_13O             419    1.2%   a school season
 *   middle_12U             379    1.0%   a school season
 *   high_varsity           313    0.9%   a school season
 *   high_freshman          164    0.5%   a school season
 *   elementary             104    0.3%   a school season
 *   high_junior_varsity     48    0.1%   a school season
 *
 * The values are truthful where they were sampled: the `Over 18` rows include "Long island Angels
 * 44" playing "LISM Patriots 44+", the `college` rows "MCC Wolves" playing "Coffeyville CC", and
 * the `high_varsity` rows "Flaming Bulldogs" playing "Casa Roble Varsity Rams".
 */

/**
 * The school squads, in GameChanger's own age field.
 *
 * Two vocabularies in one test. "Varsity" and "JV" arrive verbatim — this file has cited
 * "Varsity" as an unreadable value for as long as the parser has existed — and beside them sits
 * GameChanger's own school taxonomy, `high_`, `middle_` and `elementary`, which names the school
 * band outright. A middle school team plays the school season exactly as a varsity side does, so
 * it is refused on the same grounds and by the same rule rather than by a second one.
 *
 * Note `middle_12U` names an age and is still not read as one. A seventh-grade school side is a
 * school side; reading the 12 would file it against travel clubs it never plays.
 *
 * Whole value only, the same strictness `parseGcAgeLevel` holds the column to: a team whose age
 * field is a sentence containing the word is not thereby a high school team.
 */
const SCHOOL_LABEL =
  /^(?:varsity|jv|junior\s+varsity|hs|high\s+school|jv\s*[/\-\u2013]\s*v|v\s*[/\-\u2013]\s*jv|high_[a-z_]+|middle_[a-z0-9]+|elementary)$/i;

export const isSchoolAgeLabel = (label: unknown): boolean =>
  typeof label === "string" && SCHOOL_LABEL.test(label.trim());

/**
 * Grown men, in GameChanger's own age field.
 *
 * This app ranks youth baseball — `MAX_AGE_LEVEL` is 18 — and an over-40 men's league is not a
 * hard age to read so much as a different sport's worth of irrelevance. These teams can never be
 * aged, because there is no youth age to find, so they are refused rather than asked about.
 *
 * `18O` means eighteen and over, which is the one value here that brushes against a real 18U
 * squad. Of the 3,303 rows carrying any of these three, thirty have a name that reads 18U-ish,
 * and almost all of those are plainly college ("UNT Club Baseball 2026-2027") or a league's own
 * administrative account ("FALL Board 2027", "2026-2027 AAA Board Members"). The handful left is
 * the price of the other three thousand, and a refusal here is undoable where a wrong age is not.
 */
const ADULT_LABEL = /^(?:over\s*18|18\s*o|college|adult)$/i;

export const isAdultAgeLabel = (label: unknown): boolean =>
  typeof label === "string" && ADULT_LABEL.test(label.trim());

/**
 * The bands, which bound an age without giving one.
 *
 * "Under 13" and "Between 13 - 18" are the two values that say something true about the age
 * without saying what it is, and they cover 87% of the backlog between them. They cannot file a
 * team — there is no single age in either — but they can refuse one, and that turns out to be
 * where their value is.
 *
 * Measured against every candidate rule in `agelessTriage.ts` over the same 36,194 rows: 1,186 of
 * the 1,203 ages those rules derive sit inside the band GameChanger states, 98.6%. All seventeen
 * that do not are the same rule reading a mascot or a university as a PONY division — "SMSU
 * Mustangs Home" is Southwest Minnesota State and is labelled `college`; "Owls Colt" and "Canes
 * Colts" are labelled `Under 13` and would have been filed at 16U. The band catches every one.
 *
 * `Under 13` is read as a ceiling of 13 rather than 12, deliberately loosely. Little League's
 * Intermediate division is ages 11 to 13 and this app files it at 13U, so a twelve-year-old in
 * that division is `Under 13` and 13U at the same time and neither is wrong. Read strictly, the
 * band would veto 178 Intermediate teams it has no business vetoing.
 */
export type GcAgeBand = { low?: number; high?: number };

export const ageBandFromLabel = (label: unknown): GcAgeBand | undefined => {
  if (typeof label !== "string") return undefined;
  const value = label.trim().toLowerCase();
  if (/^under\s*13$/.test(value)) return { high: 13 };
  if (/^between\s*13\s*[-\u2013]\s*18$/.test(value)) return { low: 13, high: 18 };
  return undefined;
};

/**
 * Whether an age this app derived could be true of a team GameChanger filed under that label.
 *
 * Every reading of the field at once, because the question a caller has is one question. The two
 * bands bound the age. The adult and school labels admit no youth age at all — a side filed
 * `college` or `high_varsity` is not a nine-year-old team that happens to be labelled oddly, and
 * a rule that derived a youth age for one has misread what the team is rather than by how much.
 *
 * A label this app does not recognise says nothing, and nothing is what it is taken to say: the
 * common case is an ordinary unreadable label like "Minors", where the rules are on their own.
 */
export const ageFitsBand = (level: number, label: unknown): boolean => {
  if (isAdultAgeLabel(label) || isSchoolAgeLabel(label)) return false;
  const band = ageBandFromLabel(label);
  if (!band) return true;
  if (band.low !== undefined && level < band.low) return false;
  return !(band.high !== undefined && level > band.high);
};

/**
 * A lone "V", with no letter against it on either side, and nothing else saying what it means.
 *
 * On a school schedule that is the varsity side. It is also how a club writes a second squad, a
 * colour, a coach's initial or a division, and the name gives no way to tell which. One letter is
 * too thin to refuse a team on — a wrong refusal loses a real club silently, with nothing left
 * behind to notice it by — so this never refuses anything. It only marks the row as worth a look,
 * so the question in front of a person is "is this the varsity side?" rather than "who is this?".
 *
 * Uppercase only, because a lone lowercase "v" between two names is "versus". Written without a
 * lookbehind so it runs wherever the app does.
 */
const LONE_V = /(?:^|[^A-Za-z])V(?:[^A-Za-z]|$)/;

export const maybeSchoolTeam = (name: unknown): boolean =>
  typeof name === "string" &&
  !isSchoolName(name) &&
  ageLevelFromName(name) === undefined &&
  LONE_V.test(name);

/**
 * Reading a graduation year as an age.
 *
 * Above about 13U, travel ball stops naming an age and names the year the squad graduates high
 * school: "Elite 2029", "Midwest Nationals 2030". The class of 2027 are seniors in the 2026-27
 * season — which this app files as squad year 2027 — and seniors are 18U, so every year further
 * out is a year younger.
 *
 * The danger is that a four-digit number in a name is just as often a season. "Warriors Spring
 * 2027" is a spring squad, not the class of 2027, and reading it as one would file a nine-year-old
 * team at 18U and rate every game it plays against a level it never played. Measured over a
 * 48,035-team export, a year equal to the season year is a graduation year 0.2% of the time; one
 * year out, 44.8%; two years out, 85.6%; three, 95.3%.
 *
 * So the rule is two years out and further, which is where the evidence turns. Everything nearer
 * is left with no level at all rather than a wrong one — an unrated team costs its own ranking, a
 * misrated one corrupts everybody it played.
 */

/** A senior — the squad graduating at the end of the season being played — is 18U. */
const SENIOR_AGE_LEVEL = 18;

/** How far past the season a year has to be before it reads as a graduation year, not a season. */
export const GRAD_YEAR_MARGIN = 2;

export const ageFromGradYear = (gradYear: number, squadYear: number): number | undefined => {
  const level = SENIOR_AGE_LEVEL - (gradYear - squadYear);
  return inAgeRange(level) ? level : undefined;
};

/** Any four-digit year this side of the century's middle. Narrow enough to skip a jersey number. */
const YEAR = /\b(20[2-5]\d)\b/g;

/**
 * A season written immediately before or after the year — "Spring 2027", "2026 Fall". The offset
 * rule already refuses these, because a season label is always the season being played or the one
 * after it; this catches the club that writes a season further out than anybody expects.
 */
const SEASON_BESIDE_YEAR =
  /(?:\b(?:spring|summer|fall|autumn|winter)\s+20[2-5]\d\b)|(?:\b20[2-5]\d\s+(?:spring|summer|fall|autumn|winter)\b)/i;

/** A span of two years — "2026-2027", "2026/27" — which is a season, never a graduating class. */
const YEAR_SPAN = /\b20[2-5]\d\s*[/\-\u2013]\s*(?:20)?[2-5]\d\b/;

/**
 * The graduation year a name carries, when it can be read as one at all.
 *
 * Refuses rather than guesses: a season word beside the year, a span of two years, a year too near
 * the season to tell apart from it, or two different years in one name all come back undefined.
 */
export const gradYearFromName = (name: string, squadYear: number): number | undefined => {
  if (typeof name !== "string" || !Number.isFinite(squadYear)) return undefined;
  if (SEASON_BESIDE_YEAR.test(name) || YEAR_SPAN.test(name)) return undefined;
  YEAR.lastIndex = 0;
  let found: number | undefined;
  for (const match of name.matchAll(YEAR)) {
    const year = Number(match[1]);
    // Two different years and there is no telling which is the class; one repeated is still one.
    if (found !== undefined && found !== year) return undefined;
    found = year;
  }
  if (found === undefined) return undefined;
  return found - squadYear >= GRAD_YEAR_MARGIN ? found : undefined;
};

/** The age level a name's graduation year implies, if it has a readable one. */
export const ageFromGradYearInName = (name: string, squadYear: number): number | undefined => {
  const gradYear = gradYearFromName(name, squadYear);
  return gradYear === undefined ? undefined : ageFromGradYear(gradYear, squadYear);
};

/**
 * The age level a bare year in GameChanger's own `age_group` implies.
 *
 * Read without the two-year margin the name needs. This is a field whose whole job is to say what
 * age group a team is in, and nobody writes a season into it — so a year here is a graduating
 * class, and the only thing to check is that it lands on an age that exists.
 */
export const ageFromGradYearLabel = (
  label: string | undefined,
  squadYear: number
): number | undefined => {
  if (!label) return undefined;
  const year = /^\s*(20[2-5]\d)\s*$/.exec(label);
  return year ? ageFromGradYear(Number(year[1]), squadYear) : undefined;
};

/**
 * The age level a team plays at, out of everything that says anything about it: the age field
 * (GameChanger's own `age_group`, or the age column of a pasted list), the team's name, and the
 * squad year the two of them sit in.
 *
 * One function because a listing and the team it names must not read as two different ages. The
 * profile normalizer and the list-row reader used to climb this ladder separately, side by side,
 * agreeing only for as long as somebody kept editing both.
 *
 * Best evidence first, and the best evidence is a bracket in the name:
 *
 * 1. **A bracket in the name** — "Premier Ohio Lopez 9U/10U" — read as its older end, because a
 *    club that writes both ages is naming the bracket it takes the field in. Above the age field
 *    rather than below it, which is the one place this ladder trusts a name over a stated age, and
 *    it is deliberate: the field holds one value, chosen from a dropdown when the team was
 *    created, and a club running a 9U/10U squad routinely picks the younger of the two. The two
 *    are then not so much in conflict as one being half of the other — and filing such a team at
 *    the younger end makes every game it plays in its own bracket read as playing up, which is an
 *    advantage in the rating it did not earn.
 *
 *    It is also the one comparison where the name is the measured better witness. Over a pull of
 *    40,760 teams where a pasted list and GameChanger described the same teams, the two disagreed
 *    about the age by one 343 times, and in 267 of those the team's own *name* carried the list's
 *    level — so it is the age field that wanders. The README's "Check the id" table is that
 *    measurement.
 * 2. **The age field**, read strictly: the whole value has to be a label, so "9U", "12UA" and
 *    "9U/10U" are levels and "Varsity" is not.
 * 3. **A graduating class in the age field** — "2029" — which is an age once the squad year is known.
 * 4. **A single age label in the name** — "Trash Pandas 9u".
 * 5. **A graduating class in the name**, held to the two-year margin `gradYearFromName` needs,
 *    because a four-digit number in a name is just as often a season.
 *
 * Undefined means nobody wrote an age anywhere this can read, which is not an age: see
 * `ageFromOpponentNames` for what the pool makes of that, and `namedAges` for a person answering
 * it outright, which beats every rung here.
 */
/**
 * A name that states an age this app cannot read at all — "4U Sparrows", "5U T-Ball Couto".
 *
 * Not the same as a name that says nothing. The club has stated its age and the answer is simply
 * younger than `MIN_GC_AGE_LEVEL`, and on a pasted list that matters: with no reading of its own,
 * the ladder would fall through to the age column, and a column that says 9U would file a team of
 * four-year-olds against nine-year-olds. Measured over an 83,941-row export, 298 names state an
 * age below the floor and the column offers 9U or 8U for 248 of them.
 *
 * Refusing leaves the team ageless, which is the safe direction: an unaged team costs its own
 * ranking, where a team aged five years wrong corrupts every club it played.
 */
const UNRANKABLE_AGE_IN_NAME = /\b(?:(\d{1,2})\s*[uU][A-Da-d]{0,3}|[uU]\s*(\d{1,2}))\b/;

export const nameStatesUnrankableAge = (name: string): boolean => {
  if (typeof name !== "string") return false;
  if (ageLevelFromName(name) !== undefined) return false;
  const match = UNRANKABLE_AGE_IN_NAME.exec(name);
  if (!match) return false;
  const level = Number(match[1] ?? match[2]);
  return Number.isInteger(level) && !inAgeRange(level);
};

/**
 * The age a name writes, whether or not it is one this app can rank — "5U Pirates" is 5, "Cubs 4U"
 * is 4. For asking whether a team says it is too young; `ageLevelFromName` is what reads an age.
 */
export const ageWrittenInName = (name: string): number | undefined => {
  if (typeof name !== "string") return undefined;
  const match = UNRANKABLE_AGE_IN_NAME.exec(name);
  if (!match) return undefined;
  const level = Number(match[1] ?? match[2]);
  return Number.isInteger(level) ? level : undefined;
};

/**
 * An age written against the rest of a name, where `ageLevelFromName` reads none — "Spiders12U",
 * "10U_Hartman", "Donegal Green 12u2", "U13s Blue" — or a span written without its U, "Giants
 * 11-12", "Braves 9/10", read as its older end the way `ageSpanFromName` reads one with it.
 *
 * The ordinary reader's word boundaries are what keep "12UNDER" out, and its demand for a U on a
 * span is what keeps a date or a team number out, so neither is loosened there: this is a separate
 * reading, and only ever the last word — see `importOne`, where it answers a team nothing else
 * could age, so no team the pool already files moves.
 *
 * Measured over the 115,053 teams in the pool-names export of 23 September 2026, on the 102,845
 * whose name the ordinary reader finds nothing in. The glued forms fire on 254 and 236 (92.9%)
 * are filed at exactly the age read, 251 (98.8%) within a year. The spans fire on 283, 205
 * (72.4%) exactly and 264 (93.3%) within a year, most of the rest filed at the younger end. A span
 * can be two school grades as well as two ages; the user settled that in these names it is ages,
 * and a name that says "grade", or puts an ordinal against a number, is left alone. On the 38,603
 * teams waiting on an age the week before, it reads 545, and GameChanger's own band refuses 12.
 */
const GLUED_AGE =
  /(?<![0-9])(\d{1,2})\s*[uU][A-Da-d]{0,3}(?![a-zA-Z])|(?<![a-zA-Z0-9])[uU]\s*(\d{1,2})(?![0-9])/;
const BARE_SPAN = /(?<![\d/.:$#-])(\d{1,2})\s*[-/&\u2013]\s*(\d{1,2})(?![\d/:%.-])/g;
const SAYS_GRADE = /\bgrades?\b|\b\d{1,2}(?:st|nd|rd|th)\b/i;

export const ageLevelFromLooseName = (name: string): number | undefined => {
  if (typeof name !== "string") return undefined;
  const glued = GLUED_AGE.exec(name);
  if (glued) {
    const level = Number(glued[1] ?? glued[2]);
    if (inAgeRange(level)) return level;
  }
  if (SAYS_GRADE.test(name)) return undefined;
  for (const [, first, second] of name.matchAll(BARE_SPAN)) {
    const low = Number(first);
    const high = Number(second);
    // Two ages a year or two apart, in order: "11-12", "13/14", "15-17". Anything else is a date,
    // a score or a squad number.
    if (inAgeRange(low) && inAgeRange(high) && high > low && high - low <= 2) return high;
  }
  return undefined;
};

export type AgeFieldSource =
  /** GameChanger's own `age_group`, first-hand from its API. */
  | "profile"
  /** The age column of a pasted list: second-hand, and only as good as whoever built the file. */
  | "list";

export const ageLevelOf = (
  ageField: unknown,
  name: string,
  squadYear: number | undefined,
  source: AgeFieldSource = "profile"
): number | undefined => {
  const label = typeof ageField === "string" ? ageField : undefined;
  const stated = ageLevelFromName(name);
  /*
   * On a pasted list the name outranks the column, and a name too young to read stops the ladder
   * rather than letting the column answer for it. See `nameStatesUnrankableAge`.
   */
  if (source === "list") {
    if (stated !== undefined) return stated;
    if (nameStatesUnrankableAge(name)) return undefined;
  }
  return (
    ageSpanFromName(name)?.high ??
    parseGcAgeLevel(ageField) ??
    (squadYear === undefined ? undefined : ageFromGradYearLabel(label, squadYear)) ??
    stated ??
    (squadYear === undefined ? undefined : ageFromGradYearInName(name, squadYear))
  );
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
 * The months each GameChanger season is played in, as [first, last] of the calendar year, 1-12.
 *
 * Generous and overlapping on purpose. A club picks its season label when it builds the team, and
 * a spring league still finishing in June or a fall league starting in August is labelled either
 * way; where two seasons overlap a team in either is counted as being played. Winter runs over the
 * new year, so it is handled apart.
 */
const SEASON_MONTHS: Record<Exclude<GcSeasonName, "winter">, [number, number]> = {
  spring: [2, 6],
  summer: [5, 8],
  fall: [8, 11],
};

/**
 * Whether a GameChanger season is the one being played on `today` (an ISO day).
 *
 * What it is for is a team with no games at all: in its season that is a schedule not written yet,
 * worth asking about again next week; outside it, a team from a season that is over or has not
 * started, which nothing will change until it comes round. Erring towards "current" costs a
 * weekly request; erring the other way only lets a later pull find the team again, so the windows
 * are wide rather than tight.
 *
 * Winter is November to February and belongs to either year it straddles — "Winter 2026" and
 * "Winter 2027" are both labels somebody might give the winter that starts in November 2026.
 */
export const gcSeasonIsCurrent = (season: GcSeason, today: string): boolean => {
  const match = /^(\d{4})-(\d{2})/.exec(today);
  if (!match) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (season.season === "winter") {
    if (month >= 11) return season.year === year || season.year === year + 1;
    if (month <= 2) return season.year === year || season.year === year - 1;
    return false;
  }
  const [first, last] = SEASON_MONTHS[season.season];
  return season.year === year && month >= first && month <= last;
};

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

  // Read before the age, because the two ways a year can mean an age both need to know which
  // season is being played: the class of 2029 is 16U one year and 15U the next.
  const teamSeason = isRecord(source.team_season) ? source.team_season : undefined;
  const season = normalizeSeason(teamSeason ?? source.season);
  if (season) profile.season = season;
  const squadYear = season ? squadYearForGcSeason(season) : undefined;

  const ageLabel = asString(source.age_group ?? source.ageGroup);
  if (ageLabel) profile.ageLabel = ageLabel;
  const ageLevel = ageLevelOf(source.age_group ?? source.ageGroup, name, squadYear);
  if (ageLevel !== undefined) profile.ageLevel = ageLevel;

  const record = normalizeRecord(teamSeason?.record ?? source.record);
  if (record) profile.record = record;

  const avatarKey = avatarKeyFromUrl(source.avatar_url ?? source.avatarUrl);
  if (avatarKey) profile.avatarKey = avatarKey;

  const playerCount = asNumber(source.player_count ?? source.playerCount);
  if (playerCount !== undefined) profile.playerCount = playerCount;

  const ngb = parseGcNgb(source.ngb);
  if (ngb.length > 0) profile.ngb = ngb;

  // From the profile as well as from a pasted list. See `GcTeamSchedule.listed` for the comment
  // that said this never arrives, and the fixture that has always disproved it.
  const staff = Array.isArray(source.staff) ? staffNames(source.staff) : [];
  if (staff.length > 0) profile.staff = staff;

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
const STAFF_HEADERS = ["staff", "coaches", "coach", "staff names"];
const PLAYER_COUNT_HEADERS = ["player count", "players", "roster size", "player_count"];
/*
 * The organization a team belongs to, and the leagues and tournaments it plays in.
 *
 * GameChanger's public API has no team-to-organization route, so nothing the app fetches can say
 * which league a club is in. The user's own crawl can and does, which is why these columns are
 * worth reading: they carry the answer the API withholds, at no request cost.
 */
const ORG_ID_HEADERS = ["organization id", "org id", "organisation id"];
const ORG_NAME_HEADERS = ["organization name", "org name", "organisation name"];
const ORG_TYPE_HEADERS = ["organization type", "org type", "organisation type"];
const ORG_CITY_HEADERS = ["organization city", "org city"];
const ORG_STATE_HEADERS = ["organization state", "org state"];
const ORG_SEASON_HEADERS = ["organization season", "org season"];
const ORG_URL_HEADERS = ["organization url", "org url", "organisation url"];
const LEAGUE_HEADERS = ["league associations", "leagues", "league"];
const TOURNAMENT_HEADERS = ["tournament associations", "tournaments", "tournament"];

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
  staff: number;
  playerCount: number;
  orgId: number;
  orgName: number;
  orgType: number;
  orgCity: number;
  orgState: number;
  orgSeason: number;
  orgUrl: number;
  leagues: number;
  tournaments: number;
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
    staff: columnIndex(headers, STAFF_HEADERS),
    playerCount: columnIndex(headers, PLAYER_COUNT_HEADERS),
    // All optional, and each on its own: a row can name a tournament and no organization, which
    // is what an independent team playing one event looks like.
    orgId: columnIndex(headers, ORG_ID_HEADERS),
    orgName: columnIndex(headers, ORG_NAME_HEADERS),
    orgType: columnIndex(headers, ORG_TYPE_HEADERS),
    orgCity: columnIndex(headers, ORG_CITY_HEADERS),
    orgState: columnIndex(headers, ORG_STATE_HEADERS),
    orgSeason: columnIndex(headers, ORG_SEASON_HEADERS),
    orgUrl: columnIndex(headers, ORG_URL_HEADERS),
    leagues: columnIndex(headers, LEAGUE_HEADERS),
    tournaments: columnIndex(headers, TOURNAMENT_HEADERS),
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

/**
 * The coaches out of a staff cell: "Jason Croft, Burt Wallace" as two names.
 *
 * Commas are what the export separates them with, so a name containing one cannot be told from two
 * names and is read as two. That costs nothing here — a half-name matches a half-name, and two
 * teams sharing both halves still share both.
 */
export const parseGcStaffCell = (cell: string): string[] =>
  cell ? staffNames(cell.split(/[,;]/)) : [];

/**
 * A list of coach names, tidied: whitespace collapsed, blanks dropped, and the same name twice
 * counted once — a card that names one coach twice is one coach, not corroboration.
 *
 * Shared because the names now arrive two ways. The pasted list gives one cell to split; the
 * public profile gives an array of its own (see `normalizeGcTeamProfile`), and both have to come
 * out the same or `gcStaff`'s matching would see two spellings of one club as two clubs.
 */
export const staffNames = (raw: readonly unknown[]): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
};

/** A roster size, or nothing when the cell is blank or not a whole number of players. */
const parsePlayerCount = (cell: string): number | undefined => {
  if (!cell) return undefined;
  const count = Number(cell.replace(/[^\d-]/g, ""));
  return Number.isInteger(count) && count >= 0 ? count : undefined;
};

const entryFromRow = (teamId: string, cells: string[], columns: ListColumns): GcTeamListEntry => {
  const entry: GcTeamListEntry = { teamId };
  const name = nameFromListCell(cellAt(cells, columns.name));
  if (name) entry.name = name;
  // Marked here rather than filtered, so the panel can say how many were left out and why.
  if (isNotBaseball(name)) entry.notBaseball = true;
  const season = parseGcSeasonLabel(cellAt(cells, columns.season));
  if (season) entry.season = season;
  const squadYear = season ? squadYearForGcSeason(season) : undefined;
  // The same ladder `normalizeGcTeamProfile` climbs, because it is the same function: a row and
  // the team it names cannot read as two different ages.
  const ageCell = cellAt(cells, columns.age);
  // Marked, not filtered, like the wiffle mark above — the panel says how many were left out and
  // why. Read from the age column as well as the name, because a club that writes "Varsity" in
  // one of them often leaves the other as the school's plain name.
  if (isSchoolName(name) || isSchoolAgeLabel(ageCell)) entry.highSchool = true;
  // The same field, read for the other thing it says. This app ranks youth baseball, so an
  // over-18 or college side has no age to find and costs no request to refuse.
  if (isAdultAgeLabel(ageCell)) entry.notYouth = true;
  const ageLevel = ageLevelOf(ageCell, name, squadYear, "list");
  if (ageLevel !== undefined) entry.ageLevel = ageLevel;
  const city = cellAt(cells, columns.city);
  if (city) entry.city = city;
  const state = cellAt(cells, columns.state);
  if (state) entry.state = state;
  const staff = parseGcStaffCell(cellAt(cells, columns.staff));
  if (staff.length > 0) entry.staff = staff;
  const playerCount = parsePlayerCount(cellAt(cells, columns.playerCount));
  if (playerCount !== undefined) entry.playerCount = playerCount;

  const orgId =
    parseGcOrgId(cellAt(cells, columns.orgId)) ?? parseGcOrgId(cellAt(cells, columns.orgUrl));
  const orgName = cellAt(cells, columns.orgName);
  const orgKind = parseGcOrgKind(cellAt(cells, columns.orgType));
  const orgCity = cellAt(cells, columns.orgCity);
  const orgState = cellAt(cells, columns.orgState);
  const orgSeason = parseGcSeasonLabel(cellAt(cells, columns.orgSeason));
  const org = {
    ...(orgId ? { orgId } : {}),
    ...(orgName ? { name: orgName } : {}),
    ...(orgKind ? { kind: orgKind } : {}),
    ...(orgCity ? { city: orgCity } : {}),
    ...(orgState ? { state: orgState } : {}),
    ...(orgSeason ? { season: orgSeason } : {}),
  };
  // Only when the row said something. A team that plays a tournament and belongs to no club has
  // every one of these blank, and an empty object would read as "an organization with no name".
  if (Object.keys(org).length > 0) entry.org = org;

  const leagues = parseGcAssociations(cellAt(cells, columns.leagues));
  if (leagues.length > 0) entry.leagues = leagues;
  const tournaments = parseGcAssociations(cellAt(cells, columns.tournaments));
  if (tournaments.length > 0) entry.tournaments = tournaments;

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

// ---------- The user's organization list ----------

const ORG_LIST_ID_HEADERS = [...ORG_ID_HEADERS, "id"];
const ORG_LIST_NAME_HEADERS = [
  "entity name",
  ...ORG_NAME_HEADERS,
  "name",
  "organization",
  "league",
  "tournament",
];
const ORG_LIST_KIND_HEADERS = ["entity type", ...ORG_TYPE_HEADERS, "type", "kind", "entity"];
const ORG_LIST_URL_HEADERS = [
  "home url",
  "teams url",
  "schedule url",
  ...ORG_URL_HEADERS,
  "url",
  "link",
];
const ORG_LIST_SEASON_NAME_HEADERS = ["season name", "season"];
const ORG_LIST_SEASON_YEAR_HEADERS = ["season year", "year"];
const ORG_LIST_SPORT_HEADERS = ["sport"];
const ORG_LIST_TEAM_COUNT_HEADERS = ["team count", "teams"];
const ORG_LIST_TEAM_IDS_HEADERS = ["team ids", "team id list"];

type OrgColumns = {
  id: number;
  url: number[];
  name: number;
  kind: number;
  city: number;
  state: number;
  seasonName: number;
  seasonYear: number;
  sport: number;
  teamCount: number;
  teamIds: number;
};

const orgColumns = (headers: string[]): OrgColumns | null => {
  const id = columnIndex(headers, ORG_LIST_ID_HEADERS);
  // Every URL column, not the first: the export writes three of them, and a row whose id column
  // was mangled by a spreadsheet still parses from whichever link survived.
  const url = ORG_LIST_URL_HEADERS.map((name) => headers.indexOf(name)).filter((at) => at >= 0);
  if (id < 0 && url.length === 0) return null;
  return {
    id,
    url,
    name: columnIndex(headers, ORG_LIST_NAME_HEADERS),
    kind: columnIndex(headers, ORG_LIST_KIND_HEADERS),
    city: columnIndex(headers, CITY_HEADERS),
    state: columnIndex(headers, STATE_HEADERS),
    seasonName: columnIndex(headers, ORG_LIST_SEASON_NAME_HEADERS),
    seasonYear: columnIndex(headers, ORG_LIST_SEASON_YEAR_HEADERS),
    sport: columnIndex(headers, ORG_LIST_SPORT_HEADERS),
    teamCount: columnIndex(headers, ORG_LIST_TEAM_COUNT_HEADERS),
    teamIds: columnIndex(headers, ORG_LIST_TEAM_IDS_HEADERS),
  };
};

/**
 * The season off an organization row, read leniently across its two columns.
 *
 * The export does not always put a season word in the season column: a real row reads
 * `Season Name="2027"` with `Season Year` empty, so the year arrived in the name's cell. Both
 * halves are therefore read from either, and a season word with no year — or a year with no
 * word — is reported as the half it is rather than dropped.
 */
const orgSeasonFrom = (
  nameCell: string,
  yearCell: string
): { season?: GcSeason; seasonYear?: number } => {
  const joined = [nameCell, yearCell].filter(Boolean).join(" ");
  const full = parseGcSeasonLabel(joined);
  if (full) return { season: full };
  const year = /\b((?:19|20)\d{2})\b/.exec(joined);
  return year ? { seasonYear: Number(year[1]) } : {};
};

const orgEntryFromRow = (orgId: string, cells: string[], columns: OrgColumns): GcOrgListEntry => {
  const entry: GcOrgListEntry = { orgId };
  const name = nameFromListCell(cellAt(cells, columns.name));
  if (name) entry.name = name;
  const kind = parseGcOrgKind(cellAt(cells, columns.kind));
  if (kind) entry.kind = kind;
  const city = cellAt(cells, columns.city);
  if (city) entry.city = city;
  const state = cellAt(cells, columns.state);
  if (state) entry.state = state;
  const sport = cellAt(cells, columns.sport);
  if (sport) entry.sport = sport.toLowerCase();
  const { season, seasonYear } = orgSeasonFrom(
    cellAt(cells, columns.seasonName),
    cellAt(cells, columns.seasonYear)
  );
  if (season) entry.season = season;
  if (seasonYear !== undefined) entry.seasonYear = seasonYear;
  const teamCount = parsePlayerCount(cellAt(cells, columns.teamCount));
  if (teamCount !== undefined) entry.teamCount = teamCount;
  // "KJz7is1kgzOm; 1AF7a2UggAi7": whatever separates them, only what reads as an id is kept.
  const teamIds = [
    ...new Set(
      cellAt(cells, columns.teamIds)
        .split(/[\s,;|]+/)
        .filter((id) => GC_TEAM_ID_PATTERN.test(id))
    ),
  ];
  if (teamIds.length > 0) entry.teamIds = teamIds;
  return entry;
};

const orgIdFromRow = (cells: string[], columns: OrgColumns): string | null => {
  const fromId = parseGcOrgId(cellAt(cells, columns.id));
  if (fromId) return fromId;
  for (const at of columns.url) {
    const fromUrl = parseGcOrgId(cellAt(cells, at));
    if (fromUrl) return fromUrl;
  }
  for (const cell of cells) {
    const match = GC_ORG_URL_PATTERN.exec(cell);
    if (match?.[1]) return match[1];
  }
  const nonEmpty = cells.filter((cell) => cell.length > 0);
  if (nonEmpty.length === 1 && nonEmpty[0] !== undefined) return parseGcOrgId(nonEmpty[0]);
  return null;
};

/**
 * Reads the user's organization list: the leagues, tournaments and travel clubs they found.
 *
 * A second file rather than rows mixed into the team list, and the reason is that nothing could
 * tell the two apart inside one: an organization id and a team id are the same shape. Two files
 * make every row unambiguous by where it is, leave `parseGcTeamList` untouched, and mean no list
 * already saved can be misread.
 *
 * Everything else is the team list's machinery: the same BOM strip, the same tab-or-comma sniff
 * so a spreadsheet copy works, the same header aliasing, the same first-line-wins de-duplication,
 * and the same headerless mode for a plain list of ids or URLs.
 */
export const parseGcOrgList = (text: string): { orgs: GcOrgListEntry[]; skipped: string[] } => {
  const orgs: GcOrgListEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  if (typeof text !== "string") return { orgs, skipped };

  const lines = stripBom(text).split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim().length > 0) ?? "";
  const delimiter = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const headerCells = splitDelimitedLine(firstLine, delimiter).map(normalizeHeader);
  const columns = orgColumns(headerCells);

  const add = (orgId: string, build: () => GcOrgListEntry): boolean => {
    if (seen.has(orgId)) return false;
    seen.add(orgId);
    orgs.push(build());
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
      const orgId = orgIdFromRow(cells, columns);
      if (!orgId || !add(orgId, () => orgEntryFromRow(orgId, cells, columns))) {
        skipped.push(line);
      }
      continue;
    }

    // Headerless: a bare id or a pasted URL per line. No `looksLikeGeneratedId` weighing here,
    // because an organization list has no team names in it to be mistaken for ids.
    let added = 0;
    for (const token of line.split(/[\s,;]+/).filter(Boolean)) {
      const orgId = parseGcOrgId(token);
      if (orgId && add(orgId, () => ({ orgId }))) added += 1;
    }
    if (added === 0) skipped.push(line);
  }

  return { orgs, skipped };
};
