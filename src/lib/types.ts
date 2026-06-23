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
export type PitchMode = "machine" | "player";
export type ActiveShareView =
  | "dashboard"
  | "power"
  | "standings"
  | "teamStats"
  | "games"
  | "model"
  | "settings";
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

export type Settings = {
  goldCutoff: number;
  seasonLabel: string;
  regularSeasonGamesPerTeam: number;
  defaultGameInnings: number;
  winPoints: number;
  tiePoints: number;
  runDiffTiebreaker: boolean;
  tiebreakerOrder: TiebreakerFactor[];
  maxScoreCap: number;
  maxRunDifferential: number;
  modelAggression: ModelAggression;
  pitchMode: PitchMode;
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

export const DEFAULT_SETTINGS: Settings = {
  goldCutoff: DEFAULT_GOLD_CUTOFF,
  seasonLabel: DEFAULT_SEASON_LABEL,
  regularSeasonGamesPerTeam: 0,
  defaultGameInnings: 6,
  winPoints: 1,
  tiePoints: 0.5,
  runDiffTiebreaker: true,
  tiebreakerOrder: DEFAULT_TIEBREAKER_ORDER,
  maxScoreCap: RUN_SCORE_CAP,
  maxRunDifferential: 8,
  modelAggression: "Balanced",
  pitchMode: "machine",
  recapGrouping: "date",
};

export const MODEL_AGGRESSION: Record<ModelAggression, number> = {
  Conservative: 0.6,
  Balanced: 1.0,
  Aggressive: 1.4,
};
