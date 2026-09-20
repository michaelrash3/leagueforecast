import type { RecapItem } from "./insights";
export type TeamBase = {
  id: string;
  name: string;
  /**
   * The Team Rankings club this league team *is*, chosen by a person rather than guessed from the
   * name. Team Rankings keeps its own ids for the same clubs, and the two halves rarely agree on
   * how long a club's name is — a league roster says "Trash Pandas" where GameChanger says "Trash
   * Pandas Baseball Club" — so matching on the name alone sent that club's tournament results to
   * an opponent of their own, where they sharpened nothing and nothing said so.
   *
   * Three states, and the third is the point. Absent means nobody has decided, so the name match
   * still applies as a suggestion. A pool team's id means this club, whatever either side calls
   * it. `NO_SCOUT_TEAM` means a person has said this team is not in Team Rankings at all, and it
   * is then never matched by name either — an answer, not a gap.
   */
  scoutTeamId?: string;
};

export type HeadToHeadRecord = {
  wins: number;
  losses: number;
  ties: number;
};

export type TiebreakerFactor = "headToHead" | "runDifferential" | "runsAgainst" | "runsFor";

export type Team = TeamBase & {
  errorsPerGame?: number;
  walksAllowedPerGame?: number;
  walksReceivedPerGame?: number;
  hitDiff?: number;
  errorDiff?: number;
  walkDiff?: number;
  w: number;
  l: number;
  t: number;
  rs: number;
  ra: number;
  games: number;
  pct: number;
  runDiff: number;
  rsg: number;
  rag: number;
  hpg: number;
  kpg: number;
  oppKpg: number;
  tpi: number;
  baseTpi: number;
  sos: number;
  momentum: number;
  awayK6: number | null;
  homeK6: number | null;
  totalK6: number | null;
  /**
   * The part of `baseTpi` that comes from how little this side strikes out, against the league's
   * own rate — see `calculateTeams`. It is kept rather than recomputed because a simulated game
   * carries no strikeouts: `settleGame` books a result onto a scratch season and then rebuilds
   * `baseTpi`, and without this it rebuilt a *different* number than the one the real games gave,
   * dropping a term worth up to 1.25 the moment the first model game was booked.
   *
   * Optional, so a team assembled by hand rather than by `calculateTeams` reads 0 and behaves
   * exactly as it did before the field existed.
   */
  contactBonus?: number;
  machineDifficulty: number;
  headToHead?: Record<string, HeadToHeadRecord>;
  /**
   * Opponent-adjusted power rating in runs (see `buildOpponentAdjustedRatings`): the expected
   * margin against a league-average team, so the difference between two teams' ratings *is* their
   * expected run margin. It is the one number here that knows who a team played rather than only
   * what it scored, and where Team Rankings results are counted it knows about games this league
   * never saw.
   *
   * Optional on purpose. A league that has never built one leaves this undefined, and every
   * forecast then stays exactly the number it was before this field existed.
   */
  adjustedRating?: number;
  /** Games that rating was fitted from: this league's, plus any counted Team Rankings results. */
  ratedGames?: number;
  rank?: number;
};

export type GameLog = {
  awayRuns: string;
  awayHits: string;
  awayK: string;
  homeRuns: string;
  homeHits: string;
  homeK: string;
  awayErrors?: string;
  homeErrors?: string;
  awayWalksAllowed?: string;
  homeWalksAllowed?: string;
  innings: string;
  isFinal?: boolean;
};

export type Matchup = {
  id: string;
  date: string;
  away: string;
  home: string;
};

export type Confidence = "Low" | "Medium" | "High";

export type Prediction = {
  awayScore: number;
  homeScore: number;
  awayWinPct: number;
  winnerId: string;
  confidence: Confidence;
};

export type GoldStatus = "Clinched" | "In" | "Alive" | "Eliminated";

export type TeamWithProjection = Team & {
  projectedRank: number;
  projectedRecord: string;
  projectedRunDiff: number;
  goldPct: number;
  goldPctMargin?: number;
  goldTrend: number[];
  goldStatus: GoldStatus;
  maxPoints: number;
  blockersAhead: number;
  /**
   * The best and worst PCT this team can still finish on — the currency the cut is decided in,
   * by `rankTeams` and by the Monte Carlo both. Standings points are reported beside them and
   * decide nothing: they only ever go up, so reading a cut line off them made a club that had
   * played twice as many games look twice as close to it.
   */
  maxPct: number;
  minPct: number;
};

export type SwingGame = {
  game: Matchup;
  opponentName: string;
  teamIsAway: boolean;
  winSeed: number;
  lossSeed: number;
  modelPick: string;
  winPct: number;
};

export type ModelAggression = "Conservative" | "Balanced" | "Aggressive";
// "machine" and "coach" both use R/H/K (no walks/errors); only "player" (Kid Pitch) tracks BB/E.
export type PitchMode = "machine" | "coach" | "player";
export type ActiveShareView =
  "dashboard" | "power" | "standings" | "teamStats" | "games" | "model" | "settings";
export type RecapGrouping = "game" | "date" | "week";

export const TIEBREAKER_LABELS: Record<TiebreakerFactor, string> = {
  headToHead: "Head to Head",
  runDifferential: "Run Differential",
  runsAgainst: "Runs Allowed",
  runsFor: "Runs Scored",
};

export const DEFAULT_TIEBREAKER_ORDER: TiebreakerFactor[] = [
  "headToHead",
  "runDifferential",
  "runsAgainst",
  "runsFor",
];

/**
 * How the season ends.
 *
 * - `cut`  — the top `goldCutoff` teams make the Gold Bracket (the default).
 * - `all`  — every team makes the bracket, seeded by final standings, so there
 *            is a postseason but nothing to be inside or outside of.
 * - `none` — regular season only; no bracket, no cut line, no Gold odds.
 */
export type PostseasonFormat = "cut" | "all" | "none";

/**
 * How much of each game gets written down.
 *
 * - `runs` — the final score only, which is all most leagues ever record.
 * - `full` — the fuller box score as well: hits, strikeouts, errors and walks.
 */
export type ScoreDetail = "runs" | "full";

export type Settings = {
  goldCutoff: number;
  /** Whether a cut line exists at all, and whether there is a postseason. */
  postseasonFormat: PostseasonFormat;
  seasonLabel: string;
  regularSeasonGamesPerTeam: number;
  defaultGameInnings: number;
  winPoints: number;
  tiePoints: number;
  runDiffTiebreaker: boolean;
  tiebreakerOrder: TiebreakerFactor[];
  maxScoreCap: number;
  maxRunDifferential: number;
  /** When true, the run-differential cap follows the pitch format (machine 8 / player 12) instead of maxRunDifferential. */
  autoRunDiffCap: boolean;
  /**
   * Whether tournament results logged in Team Rankings sharpen this league's game forecasts.
   * League games always flow the other way; this is the direction worth a choice, because a
   * scrimmage against a travel team is not obviously evidence about a league season.
   */
  useScoutResults: boolean;
  modelAggression: ModelAggression;
  pitchMode: PitchMode;
  /**
   * How much of each game gets recorded. Most leagues only ever write down the
   * final score, and runs alone drive the standings, records and every
   * projection, so `runs` is the default and the fuller box score — hits,
   * strikeouts, errors, walks — is opt-in for the leagues that keep it.
   *
   * A season saved before this setting existed has no stored value, so it lands
   * on the `runs` default. That is deliberate: it keeps everything those seasons
   * are judged on intact, and the box-score numbers they did record stay in the
   * logs, ready to reappear the moment the league switches to `full`.
   */
  scoreDetail: ScoreDetail;
  /**
   * Whether kid-pitch games record fielding errors. Plenty of leagues do not
   * score them, and an always-blank E column is worse than no column. Ignored
   * outside kid pitch, which tracks strikeouts instead, and outside the full box
   * score, which is the only place an E column appears at all.
   */
  trackErrors: boolean;
  recapGrouping: RecapGrouping;
};

export type RankSnapshot = (Team & {
  rank: number;
  projectedRank: number;
  goldPct: number;
  goldStatus: GoldStatus;
  maxPoints: number;
  blockersAhead: number;
})[];

export type UndoSnapshot = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs?: Record<string, GameLog>;
  label: string;
  timestamp: number;
};

export const DEFAULT_GOLD_CUTOFF = 7;
export const DEFAULT_SEASON_LABEL = "Current Season";
export const DEFAULT_SEASON_YEAR = 2026;
/**
 * The most seasons the playoff-odds simulation plays out. A ceiling, not a count: the loop stops
 * once every team's odds are known to two points (see `ODDS_PRECISION`), which a settled league
 * reaches in a couple of hundred. At even odds this ceiling gives about ±1.5 points, and at the
 * loop's current speed it costs on the order of a tenth of a second in the worker.
 */
export const SIM_ITERATIONS = 4000;
/** Seasons per past week in the trend chart: about ±4 points at even odds, on eight weeks. */
export const TREND_ITERATIONS = 600;
export const TREND_STATES = 8;
export const STORAGE_VERSION = 1;
export const RUN_SCORE_CAP = 35;
export const GAME_STAT_CAP = 99;

export const POSTSEASON_FORMAT_VALUES: PostseasonFormat[] = ["cut", "all", "none"];

export const SCORE_DETAIL_VALUES: ScoreDetail[] = ["runs", "full"];

export const DEFAULT_SETTINGS: Settings = {
  goldCutoff: DEFAULT_GOLD_CUTOFF,
  postseasonFormat: "cut",
  seasonLabel: DEFAULT_SEASON_LABEL,
  regularSeasonGamesPerTeam: 0,
  defaultGameInnings: 6,
  winPoints: 1,
  tiePoints: 0.5,
  runDiffTiebreaker: true,
  tiebreakerOrder: DEFAULT_TIEBREAKER_ORDER,
  maxScoreCap: RUN_SCORE_CAP,
  maxRunDifferential: 8,
  autoRunDiffCap: false,
  useScoutResults: true,
  modelAggression: "Balanced",
  pitchMode: "player",
  scoreDetail: "runs",
  trackErrors: true,
  recapGrouping: "date",
};

export const MODEL_AGGRESSION: Record<ModelAggression, number> = {
  Conservative: 0.6,
  Balanced: 1.0,
  Aggressive: 1.4,
};

/**
 * What the last score entry changed: the headline, the scores, what moved and why.
 *
 * Here rather than in App.tsx because both the app that builds it and the views that show it need
 * to name it, and a type that only one file can name is a type that pins everything to that file.
 */
export type LastImpact = {
  title: string;
  scores: string[];
  messages: string[];
  recapItems: RecapItem[];
  projectionExplanations?: ProjectionExplanationEntry[];
};

/** Why one team's projection moved, in the words the standings row shows. */
export type ProjectionExplanationEntry = {
  teamId: string;
  teamName: string;
  items: string[];
};
