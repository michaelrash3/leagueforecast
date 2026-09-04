export type TeamBase = {
  id: string;
  name: string;
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
  machineDifficulty: number;
  headToHead?: Record<string, HeadToHeadRecord>;
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
   * Whether kid-pitch games record fielding errors. Plenty of leagues do not
   * score them, and an always-blank E column is worse than no column. Ignored
   * outside kid pitch, which tracks strikeouts instead.
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
export const SIM_ITERATIONS = 220;
export const TREND_STATES = 8;
export const STORAGE_VERSION = 1;
export const RUN_SCORE_CAP = 35;
export const GAME_STAT_CAP = 99;

export const POSTSEASON_FORMAT_VALUES: PostseasonFormat[] = ["cut", "all", "none"];

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
  trackErrors: true,
  recapGrouping: "date",
};

export const MODEL_AGGRESSION: Record<ModelAggression, number> = {
  Conservative: 0.6,
  Balanced: 1.0,
  Aggressive: 1.4,
};
