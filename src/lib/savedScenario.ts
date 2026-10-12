import type { GameLog, Matchup } from "./types";
import { isFinal } from "./util";
import { isNumber, isRecord, isString } from "./validate";
import type { ScenarioPick } from "./scenario";

export const SAVED_SCENARIO_VERSION = 1 as const;
export const MAX_SCENARIO_SHARE_BYTES = 8_000;

export type SavedScenario = {
  version: typeof SAVED_SCENARIO_VERSION;
  id: string;
  name: string;
  seasonId: string;
  picks: Record<string, ScenarioPick>;
  createdAt: string;
  modifiedAt: string;
  sourceFingerprint: string;
};

export type ScenarioStaleReason =
  | { gameId: string; kind: "became-final" }
  | { gameId: string; kind: "removed" }
  | { gameId: string; kind: "participants-changed" };

const participantKey = (game: Matchup): string => `${game.id}:${game.away}:${game.home}`;

/** Stable for meaningful schedule state; display-only changes do not stale a scenario. */
export const scenarioFingerprint = (
  matchups: readonly Matchup[],
  logs: Readonly<Record<string, GameLog>>
): string =>
  [...matchups]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((game) => `${participantKey(game)}:${game.date}:${isFinal(logs[game.id]) ? "F" : "O"}`)
    .join("|");

export const createSavedScenario = (
  input: Omit<SavedScenario, "version" | "createdAt" | "modifiedAt">,
  now: string
): SavedScenario => ({
  version: SAVED_SCENARIO_VERSION,
  ...input,
  createdAt: now,
  modifiedAt: now,
});

export const duplicateSavedScenario = (
  scenario: SavedScenario,
  id: string,
  now: string
): SavedScenario => ({
  ...scenario,
  id,
  name: `${scenario.name} copy`,
  createdAt: now,
  modifiedAt: now,
});

export const renameSavedScenario = (
  scenario: SavedScenario,
  name: string,
  now: string
): SavedScenario => ({ ...scenario, name: name.trim() || scenario.name, modifiedAt: now });

export const staleScenarioReasons = (
  scenario: SavedScenario,
  matchups: readonly Matchup[],
  logs: Readonly<Record<string, GameLog>>
): ScenarioStaleReason[] => {
  const games = new Map(matchups.map((game) => [game.id, game]));
  return Object.entries(scenario.picks).flatMap(([gameId, pick]): ScenarioStaleReason[] => {
    const game = games.get(gameId);
    if (!game) return [{ gameId, kind: "removed" }];
    if (isFinal(logs[gameId])) return [{ gameId, kind: "became-final" }];
    if (pick.winnerId !== game.away && pick.winnerId !== game.home) {
      return [{ gameId, kind: "participants-changed" }];
    }
    return [];
  });
};

export type ScenarioRebase = { scenario: SavedScenario; removed: ScenarioStaleReason[] };

export const rebaseSavedScenario = (
  scenario: SavedScenario,
  matchups: readonly Matchup[],
  logs: Readonly<Record<string, GameLog>>,
  now: string
): ScenarioRebase => {
  const removed = staleScenarioReasons(scenario, matchups, logs);
  const invalid = new Set(removed.map((reason) => reason.gameId));
  return {
    scenario: {
      ...scenario,
      picks: Object.fromEntries(Object.entries(scenario.picks).filter(([id]) => !invalid.has(id))),
      sourceFingerprint: scenarioFingerprint(matchups, logs),
      modifiedAt: now,
    },
    removed,
  };
};

const coercePick = (raw: unknown): ScenarioPick | null => {
  if (!isRecord(raw) || !isString(raw.winnerId) || !raw.winnerId) return null;
  const awayRuns = isNumber(raw.awayRuns) ? raw.awayRuns : undefined;
  const homeRuns = isNumber(raw.homeRuns) ? raw.homeRuns : undefined;
  return {
    winnerId: raw.winnerId,
    ...(awayRuns === undefined ? {} : { awayRuns }),
    ...(homeRuns === undefined ? {} : { homeRuns }),
  };
};

export const coerceSavedScenario = (raw: unknown): SavedScenario | null => {
  if (
    !isRecord(raw) ||
    raw.version !== SAVED_SCENARIO_VERSION ||
    !isString(raw.id) ||
    !raw.id ||
    !isString(raw.name) ||
    !isString(raw.seasonId) ||
    !isString(raw.createdAt) ||
    !isString(raw.modifiedAt) ||
    !isString(raw.sourceFingerprint) ||
    !isRecord(raw.picks)
  ) {
    return null;
  }
  const picks: Record<string, ScenarioPick> = {};
  Object.entries(raw.picks).forEach(([gameId, value]) => {
    const pick = coercePick(value);
    if (pick) picks[gameId] = pick;
  });
  return {
    version: SAVED_SCENARIO_VERSION,
    id: raw.id,
    name: raw.name,
    seasonId: raw.seasonId,
    picks,
    createdAt: raw.createdAt,
    modifiedAt: raw.modifiedAt,
    sourceFingerprint: raw.sourceFingerprint,
  };
};

export const encodeSharedScenario = (scenario: SavedScenario): string => {
  const encoded = encodeURIComponent(JSON.stringify(scenario));
  if (new TextEncoder().encode(encoded).byteLength > MAX_SCENARIO_SHARE_BYTES) {
    throw new Error("Scenario is too large to share in a URL.");
  }
  return encoded;
};

export const decodeSharedScenario = (encoded: string): SavedScenario | null => {
  if (new TextEncoder().encode(encoded).byteLength > MAX_SCENARIO_SHARE_BYTES) return null;
  try {
    return coerceSavedScenario(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return null;
  }
};

const scenarioKey = (seasonId: string): string =>
  `league_forecast_scenarios_v${SAVED_SCENARIO_VERSION}_${seasonId}`;

export const loadSavedScenarios = (seasonId: string): SavedScenario[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(scenarioKey(seasonId)) ?? "[]");
    return Array.isArray(raw)
      ? raw
          .map(coerceSavedScenario)
          .filter(
            (scenario): scenario is SavedScenario =>
              scenario !== null && scenario.seasonId === seasonId
          )
      : [];
  } catch {
    return [];
  }
};

export const saveSavedScenarios = (seasonId: string, scenarios: SavedScenario[]): boolean => {
  try {
    localStorage.setItem(
      scenarioKey(seasonId),
      JSON.stringify(scenarios.filter((scenario) => scenario.seasonId === seasonId))
    );
    return true;
  } catch {
    return false;
  }
};
