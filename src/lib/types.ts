export type TeamBase = {
  id: string;
  name: string;
};

export type Team = TeamBase & {
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
  tpi: number;
  baseTpi: number;
  sos: number;
  momentum: number;
  awayK6: number | null;
  homeK6: number | null;
  totalK6: number | null;
  machineDifficulty: number;
  rank?: number;
};

export type GameLog = {
  awayRuns: string;
  awayHits: string;
  awayK: string;
  homeRuns: string;
  homeHits: string;
  homeK: string;
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

export type Settings = {
  goldCutoff: number;
  seasonLabel: string;
  winPoints: number;
  tiePoints: number;
  runDiffTiebreaker: boolean;
  maxScoreCap: number;
  modelAggression: ModelAggression;
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
  label: string;
  timestamp: number;
};

export const DEFAULT_GOLD_CUTOFF = 7;
export const DEFAULT_SEASON_LABEL = "Spring 26";
export const DEFAULT_SEASON_YEAR = 2026;
export const SIM_ITERATIONS = 220;
export const TREND_STATES = 8;
export const STORAGE_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  goldCutoff: DEFAULT_GOLD_CUTOFF,
  seasonLabel: DEFAULT_SEASON_LABEL,
  winPoints: 1,
  tiePoints: 0.5,
  runDiffTiebreaker: true,
  maxScoreCap: 18,
  modelAggression: "Balanced",
};

export const MODEL_AGGRESSION: Record<ModelAggression, number> = {
  Conservative: 0.6,
  Balanced: 1.0,
  Aggressive: 1.4,
};
