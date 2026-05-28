import {
  DEFAULT_SETTINGS,
  DEFAULT_TIEBREAKER_ORDER,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type RecapGrouping,
  type Settings,
  type TeamBase,
  type TiebreakerFactor,
} from "./types";

const AGGRESSION_VALUES: ModelAggression[] = ["Conservative", "Balanced", "Aggressive"];
const RECAP_GROUPING_VALUES: RecapGrouping[] = ["game", "date", "week"];
const TIEBREAKER_VALUES: TiebreakerFactor[] = ["headToHead", "runsAgainst", "runDifferential"];

export const isString = (v: unknown): v is string => typeof v === "string";
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isTeamBase = (v: unknown): v is TeamBase =>
  isRecord(v) && isString(v.id) && isString(v.name);
export const isMatchup = (v: unknown): v is Matchup =>
  isRecord(v) && isString(v.id) && isString(v.date) && isString(v.away) && isString(v.home);
export const isGameLog = (v: unknown): v is GameLog =>
  isRecord(v) &&
  isString(v.awayRuns) &&
  isString(v.awayHits) &&
  isString(v.awayK) &&
  isString(v.homeRuns) &&
  isString(v.homeHits) &&
  isString(v.homeK) &&
  isString(v.innings) &&
  (v.isFinal === undefined || isBoolean(v.isFinal));

const coerceTiebreakerOrder = (raw: unknown, runDiffTiebreaker: boolean): TiebreakerFactor[] => {
  if (!Array.isArray(raw)) {
    return runDiffTiebreaker ? [...DEFAULT_TIEBREAKER_ORDER] : ["headToHead", "runsAgainst"];
  }

  const order: TiebreakerFactor[] = [];
  raw.forEach((value) => {
    if (!isString(value)) return;
    const factor = value as TiebreakerFactor;
    if (!TIEBREAKER_VALUES.includes(factor) || order.includes(factor)) return;
    order.push(factor);
  });

  return order.length ? order : [...DEFAULT_TIEBREAKER_ORDER];
};

export const coerceSettings = (raw: unknown): Settings => {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const aggressionRaw = raw.modelAggression;
  const modelAggression: ModelAggression =
    isString(aggressionRaw) && AGGRESSION_VALUES.includes(aggressionRaw as ModelAggression)
      ? (aggressionRaw as ModelAggression)
      : DEFAULT_SETTINGS.modelAggression;
  const recapGroupingRaw = raw.recapGrouping;
  const recapGrouping: RecapGrouping =
    isString(recapGroupingRaw) && RECAP_GROUPING_VALUES.includes(recapGroupingRaw as RecapGrouping)
      ? (recapGroupingRaw as RecapGrouping)
      : DEFAULT_SETTINGS.recapGrouping;

  const runDiffTiebreaker = isBoolean(raw.runDiffTiebreaker)
    ? raw.runDiffTiebreaker
    : DEFAULT_SETTINGS.runDiffTiebreaker;

  return {
    goldCutoff: isNumber(raw.goldCutoff)
      ? Math.min(64, Math.max(1, Math.round(raw.goldCutoff)))
      : DEFAULT_SETTINGS.goldCutoff,
    seasonLabel: isString(raw.seasonLabel)
      ? raw.seasonLabel.slice(0, 80)
      : DEFAULT_SETTINGS.seasonLabel,
    regularSeasonGamesPerTeam: isNumber(raw.regularSeasonGamesPerTeam)
      ? Math.min(200, Math.max(0, Math.round(raw.regularSeasonGamesPerTeam)))
      : DEFAULT_SETTINGS.regularSeasonGamesPerTeam,
    winPoints: isNumber(raw.winPoints)
      ? Math.min(10, Math.max(0, raw.winPoints))
      : DEFAULT_SETTINGS.winPoints,
    tiePoints: isNumber(raw.tiePoints)
      ? Math.min(10, Math.max(0, raw.tiePoints))
      : DEFAULT_SETTINGS.tiePoints,
    runDiffTiebreaker,
    tiebreakerOrder: coerceTiebreakerOrder(raw.tiebreakerOrder, runDiffTiebreaker),
    maxScoreCap: isNumber(raw.maxScoreCap)
      ? Math.min(99, Math.max(1, Math.round(raw.maxScoreCap)))
      : DEFAULT_SETTINGS.maxScoreCap,
    modelAggression,
    recapGrouping,
  };
};
