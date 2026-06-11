import {
  DEFAULT_SETTINGS,
  GAME_STAT_CAP,
  RUN_SCORE_CAP,
  DEFAULT_TIEBREAKER_ORDER,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type RecapGrouping,
  type Settings,
  type TeamBase,
  type TiebreakerFactor,
} from "./types";
import { normalizeDateInput } from "./date";

const AGGRESSION_VALUES: ModelAggression[] = ["Conservative", "Balanced", "Aggressive"];
const RECAP_GROUPING_VALUES: RecapGrouping[] = ["game", "date", "week"];
const TIEBREAKER_VALUES: TiebreakerFactor[] = [
  "headToHead",
  "runDifferential",
  "runsAgainst",
  "runsFor",
];

export const isString = (v: unknown): v is string => typeof v === "string";
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const cleanId = (value: string) => value.trim();
const cleanName = (value: string) => value.trim().slice(0, 120);
const clampStatText = (value: unknown, maxValue: number) => {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.min(maxValue, Math.max(0, Math.round(numeric))));
};
const clampRunText = (value: unknown) => clampStatText(value, RUN_SCORE_CAP);
const clampGameStatText = (value: unknown) => clampStatText(value, GAME_STAT_CAP);
const clampInningsText = (value: unknown) => {
  const numeric = Number(String(value ?? "").trim());
  if (!Number.isFinite(numeric)) return "6";
  return String(Math.min(10, Math.max(1, Math.round(numeric))));
};

export const isTeamBase = (v: unknown): v is TeamBase =>
  isRecord(v) &&
  isString(v.id) &&
  isString(v.name) &&
  cleanId(v.id).length > 0 &&
  cleanName(v.name).length > 0;
export const isMatchup = (v: unknown): v is Matchup =>
  isRecord(v) &&
  isString(v.id) &&
  isString(v.date) &&
  isString(v.away) &&
  isString(v.home) &&
  cleanId(v.id).length > 0 &&
  cleanId(v.away).length > 0 &&
  cleanId(v.home).length > 0 &&
  cleanId(v.away) !== cleanId(v.home);
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

export const coerceTeams = (raw: unknown): TeamBase[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TeamBase[] = [];
  raw.forEach((item) => {
    if (!isRecord(item) || !isString(item.id) || !isString(item.name)) return;
    const id = cleanId(item.id);
    const name = cleanName(item.name);
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name });
  });
  return out;
};

export const coerceMatchups = (raw: unknown, teams: TeamBase[] = []): Matchup[] => {
  if (!Array.isArray(raw)) return [];
  const teamIds = new Set(teams.map((team) => team.id));
  const requireKnownTeams = teamIds.size > 0;
  const seen = new Set<string>();
  const out: Matchup[] = [];
  raw.forEach((item) => {
    if (!isRecord(item)) return;
    const id = isString(item.id) ? cleanId(item.id) : "";
    const away = isString(item.away) ? cleanId(item.away) : "";
    const home = isString(item.home) ? cleanId(item.home) : "";
    if (!id || !away || !home || away === home || seen.has(id)) return;
    if (requireKnownTeams && (!teamIds.has(away) || !teamIds.has(home))) return;
    seen.add(id);
    out.push({
      id,
      away,
      home,
      date: normalizeDateInput(isString(item.date) ? item.date : ""),
    });
  });
  return out;
};

export const coerceLogs = (
  raw: unknown,
  matchups: Matchup[] = [],
  _settings: Pick<Settings, "maxScoreCap"> = DEFAULT_SETTINGS
): Record<string, GameLog> => {
  if (!isRecord(raw)) return {};
  const matchupIds = new Set(matchups.map((matchup) => matchup.id));
  const requireKnownGames = matchupIds.size > 0;
  const out: Record<string, GameLog> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (requireKnownGames && !matchupIds.has(key)) return;
    if (!isRecord(value)) return;
    const log: GameLog = {
      awayRuns: clampRunText(value.awayRuns),
      awayHits: clampGameStatText(value.awayHits),
      awayK: clampGameStatText(value.awayK),
      homeRuns: clampRunText(value.homeRuns),
      homeHits: clampGameStatText(value.homeHits),
      homeK: clampGameStatText(value.homeK),
      innings: clampInningsText(value.innings),
      isFinal: isBoolean(value.isFinal) ? value.isFinal : undefined,
    };
    const hasScore = log.awayRuns !== "" && log.homeRuns !== "";
    const hasKs = log.awayK !== "" && log.homeK !== "";
    log.isFinal = Boolean(log.isFinal && hasScore && hasKs);
    out[key] = log;
  });
  return out;
};

const coerceTiebreakerOrder = (raw: unknown, runDiffTiebreaker: boolean): TiebreakerFactor[] => {
  if (!Array.isArray(raw)) {
    return runDiffTiebreaker
      ? [...DEFAULT_TIEBREAKER_ORDER]
      : ["headToHead", "runsAgainst", "runsFor"];
  }

  const order: TiebreakerFactor[] = [];
  raw.forEach((value) => {
    if (!isString(value)) return;
    const factor = value as TiebreakerFactor;
    if (!TIEBREAKER_VALUES.includes(factor) || order.includes(factor)) return;
    order.push(factor);
  });

  if (!order.length) return [...DEFAULT_TIEBREAKER_ORDER];

  const oldDefaultOrder: TiebreakerFactor[] = ["headToHead", "runDifferential", "runsAgainst"];
  const isLegacyDefaultOrder =
    order.length === oldDefaultOrder.length &&
    oldDefaultOrder.every((factor, index) => order[index] === factor);
  return isLegacyDefaultOrder ? [...DEFAULT_TIEBREAKER_ORDER] : order;
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
    maxScoreCap: RUN_SCORE_CAP,
    modelAggression,
    recapGrouping,
  };
};
