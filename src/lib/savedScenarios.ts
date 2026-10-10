import { formatGameDate } from "./date";
import { SCENARIOS_KEY } from "./preferences";
import type { ScenarioPick } from "./scenario";
import { encodeRaw } from "./share";
import type { GameLog, Matchup } from "./types";
import { isFinal } from "./util";

/**
 * Playoff-machine scenarios kept to come back to (2.7): a name, the picks, and each picked game as
 * it stood when picked, so a scenario can tell when the season has moved on under it.
 *
 * Kept per device and per season (`readScenarios`), like the findings put aside: one parent's
 * "what if we win out" is theirs, not the season's, and a shared link carries a scenario to
 * another device without touching the season there.
 */
export type SavedScenario = {
  version: 1;
  id: string;
  name: string;
  seasonId: string;
  picks: Record<string, ScenarioPick>;
  /** Each picked game's teams and date when the scenario was last saved or brought up to date. */
  basis: Record<string, GameBasis>;
  createdAt: string;
  modifiedAt: string;
};

export type GameBasis = { away: string; home: string; date: string };

/** Why a pick no longer applies, or how its game has moved. */
export type PickTrouble =
  | { gameId: string; kind: "played"; game: Matchup; log: GameLog }
  | { gameId: string; kind: "removed"; basis: GameBasis | undefined }
  | { gameId: string; kind: "changed"; basis: GameBasis | undefined; game: Matchup }
  | { gameId: string; kind: "moved"; basis: GameBasis; game: Matchup };

/** A game's teams and date, as a pick made on it now records them. */
export const basisOf = (game: Matchup): GameBasis => ({
  away: game.away,
  home: game.home,
  date: game.date,
});

/** The picks' games as the season has them now, for a scenario saved or brought up to date. */
export const basisFor = (
  picks: Readonly<Record<string, ScenarioPick>>,
  matchups: readonly Matchup[]
): Record<string, GameBasis> => {
  const byId = new Map(matchups.map((game) => [game.id, game]));
  return Object.fromEntries(
    Object.keys(picks).flatMap((id) => {
      const game = byId.get(id);
      return game ? [[id, basisOf(game)]] : [];
    })
  );
};

/**
 * What has happened to a scenario's games since it was saved: played (the real result stands and
 * the pick goes), removed, given other teams (the pick no longer means what it did), or only moved
 * to another date (the pick still holds).
 */
export const scenarioTrouble = (
  scenario: Pick<SavedScenario, "picks" | "basis">,
  matchups: readonly Matchup[],
  logs: Readonly<Record<string, GameLog>>
): PickTrouble[] => {
  const byId = new Map(matchups.map((game) => [game.id, game]));
  return Object.entries(scenario.picks).flatMap(([gameId, pick]): PickTrouble[] => {
    const game = byId.get(gameId);
    const basis = scenario.basis[gameId];
    if (!game) return [{ gameId, kind: "removed", basis }];
    const log = logs[gameId];
    if (log && isFinal(log)) return [{ gameId, kind: "played", game, log }];
    const sameTeams = basis ? basis.away === game.away && basis.home === game.home : true;
    if (!sameTeams || (pick.winnerId !== game.away && pick.winnerId !== game.home))
      return [{ gameId, kind: "changed", basis, game }];
    if (basis && basis.date !== game.date) return [{ gameId, kind: "moved", basis, game }];
    return [];
  });
};

/** Whether a scenario's season has moved on under it in a way that changes what it says. */
export const isStale = (trouble: readonly PickTrouble[]) =>
  trouble.some((one) => one.kind !== "moved");

/** What happened to one of a scenario's games since it was saved, in words. */
export const troubleLine = (one: PickTrouble, nameOf: (id: string) => string): string => {
  const teamsOf = (game: { away: string; home: string } | undefined) =>
    game ? `${nameOf(game.away)} at ${nameOf(game.home)}` : "A game";
  switch (one.kind) {
    case "played":
      return `${teamsOf(one.game)} was played (${one.log.awayRuns}–${one.log.homeRuns}).`;
    case "removed":
      return `${teamsOf(one.basis)} was taken off the schedule.`;
    case "changed":
      return `${teamsOf(one.basis)} is now ${teamsOf(one.game)}.`;
    case "moved":
      return `${teamsOf(one.game)} moved to ${formatGameDate(one.game.date)}.`;
  }
};

/**
 * A scenario brought up to date with its season: picks on games played, removed or given other
 * teams dropped, the rest kept, games only moved noted at their new dates. What changed comes back
 * with it, to be said.
 */
export const rebaseScenario = (
  scenario: SavedScenario,
  matchups: readonly Matchup[],
  logs: Readonly<Record<string, GameLog>>,
  now: string
): { scenario: SavedScenario; dropped: PickTrouble[]; moved: PickTrouble[] } => {
  const trouble = scenarioTrouble(scenario, matchups, logs);
  const dropped = trouble.filter((one) => one.kind !== "moved");
  const gone = new Set(dropped.map((one) => one.gameId));
  const picks = Object.fromEntries(Object.entries(scenario.picks).filter(([id]) => !gone.has(id)));
  return {
    scenario: { ...scenario, picks, basis: basisFor(picks, matchups), modifiedAt: now },
    dropped,
    moved: trouble.filter((one) => one.kind === "moved"),
  };
};

/** The picks that still apply to the season as it stands: what a scenario plays out. */
export const livePicks = (
  picks: Readonly<Record<string, ScenarioPick>>,
  trouble: readonly PickTrouble[]
): Record<string, ScenarioPick> => {
  const gone = new Set(trouble.filter((one) => one.kind !== "moved").map((one) => one.gameId));
  return Object.fromEntries(Object.entries(picks).filter(([id]) => !gone.has(id)));
};

export type Preset = "winOut" | "loseOut" | "favorites" | "fillFavorites";

/**
 * The picks a preset makes of the games left: one team winning or losing every game it has left
 * (its others left as they were), the model's favorite winning every game, or the favorites
 * filling every game not yet picked.
 */
export const presetPicks = (
  preset: Preset,
  {
    remaining,
    current,
    favoriteOf,
    teamId,
  }: {
    remaining: readonly Matchup[];
    current: Readonly<Record<string, ScenarioPick>>;
    /** The model's pick to win a game. */
    favoriteOf: (game: Matchup) => string;
    /** The team winning or losing out. */
    teamId?: string | null;
  }
): Record<string, ScenarioPick> => {
  if (preset === "favorites")
    return Object.fromEntries(remaining.map((game) => [game.id, { winnerId: favoriteOf(game) }]));
  if (preset === "fillFavorites")
    return {
      ...Object.fromEntries(remaining.map((game) => [game.id, { winnerId: favoriteOf(game) }])),
      ...current,
    };
  if (!teamId) return { ...current };
  const next = { ...current };
  for (const game of remaining) {
    if (game.away !== teamId && game.home !== teamId) continue;
    const other = game.away === teamId ? game.home : game.away;
    next[game.id] = { winnerId: preset === "winOut" ? teamId : other };
  }
  return next;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The most runs a pick's typed score keeps, stored or carried in a link: more than any game at this
 * level scores, and two digits in a link. The playoff machine takes no more, so a score is saved as
 * it was shown rather than dropped on being read back.
 */
export const MOST_RUNS = 99;

const runs = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MOST_RUNS
    ? value
    : undefined;

/** A pick read back, or null for anything that is not one. */
export const coercePick = (value: unknown): ScenarioPick | null => {
  if (!isRecord(value) || typeof value.winnerId !== "string" || value.winnerId === "") return null;
  const awayRuns = runs(value.awayRuns);
  const homeRuns = runs(value.homeRuns);
  return {
    winnerId: value.winnerId,
    ...(awayRuns !== undefined ? { awayRuns } : {}),
    ...(homeRuns !== undefined ? { homeRuns } : {}),
  };
};

/**
 * A stored scenario read back, or null for anything that is not one: a version this app does not
 * know (a later app's) is left alone rather than misread.
 */
export const coerceScenario = (value: unknown): SavedScenario | null => {
  if (!isRecord(value) || value.version !== 1) return null;
  const { id, name, seasonId, createdAt, modifiedAt } = value;
  if (
    ![id, name, seasonId, createdAt, modifiedAt].every((field) => typeof field === "string") ||
    !isRecord(value.picks) ||
    !isRecord(value.basis)
  )
    return null;
  const picks: Record<string, ScenarioPick> = {};
  for (const [gameId, pick] of Object.entries(value.picks)) {
    const read = coercePick(pick);
    if (read) picks[gameId] = read;
  }
  const basis: Record<string, GameBasis> = {};
  for (const [gameId, game] of Object.entries(value.basis)) {
    if (
      isRecord(game) &&
      typeof game.away === "string" &&
      typeof game.home === "string" &&
      typeof game.date === "string"
    )
      basis[gameId] = { away: game.away, home: game.home, date: game.date };
  }
  return {
    version: 1,
    id: id as string,
    name: name as string,
    seasonId: seasonId as string,
    picks,
    basis,
    createdAt: createdAt as string,
    modifiedAt: modifiedAt as string,
  };
};

/** The longest scenario link the app makes, in characters after the `#`: well inside any browser. */
export const MAX_SCENARIO_LINK = 6000;

export type CompactPick = [gameId: string, side: 0 | 1, awayRuns?: number, homeRuns?: number];
export type CompactScenario = {
  v: 1;
  /** The scenario's name. */
  n: string;
  /** Each pick, its winner told as the side, away (0) or home (1). */
  p: CompactPick[];
  /** Each picked game's teams and date, to tell the games apart in a season that has moved on. */
  b: Record<string, [away: string, home: string, date: string]>;
};

/**
 * A scenario as the part of a link after `#`, or null when it would be longer than
 * `MAX_SCENARIO_LINK`. It carries the picks and their games' teams and dates, and nothing of the
 * season: opening it never replaces anything on the device that opens it.
 */
export const scenarioLinkHash = (scenario: SavedScenario): string | null => {
  const compact: CompactScenario = {
    v: 1,
    n: scenario.name,
    p: Object.entries(scenario.picks).flatMap(([gameId, pick]): CompactPick[] => {
      const basis = scenario.basis[gameId];
      if (!basis) return [];
      const side = pick.winnerId === basis.home ? 1 : 0;
      return [
        pick.awayRuns !== undefined && pick.homeRuns !== undefined
          ? [gameId, side, pick.awayRuns, pick.homeRuns]
          : [gameId, side],
      ];
    }),
    b: Object.fromEntries(
      Object.entries(scenario.basis).map(([id, game]) => [id, [game.away, game.home, game.date]])
    ),
  };
  const hash = `scenario=${encodeRaw(JSON.stringify(compact))}`;
  return hash.length <= MAX_SCENARIO_LINK ? hash : null;
};

/** Scenarios kept per season: more than anyone picks between two looks at the standings. */
const SCENARIOS_KEPT = 30;

/*
 * Kept here, not with the other preferences, so that only the playoff machine's chunk and an
 * opened scenario link load them: nothing about scenarios is in the page's first download.
 */
const readAllScenarios = (): Record<string, unknown[]> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SCENARIOS_KEY) ?? "{}");
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, unknown[]] =>
        Array.isArray(entry[1])
      )
    );
  } catch {
    return {};
  }
};

/**
 * The scenarios kept on this device for a season, the most recently changed first. An entry this
 * app cannot read (a later app's version) is left out here and kept as it was by `writeScenarios`.
 */
export const readScenarios = (seasonId: string): SavedScenario[] =>
  (readAllScenarios()[seasonId] ?? [])
    .map(coerceScenario)
    .filter(
      (scenario): scenario is SavedScenario => scenario !== null && scenario.seasonId === seasonId
    )
    .sort((one, two) => two.modifiedAt.localeCompare(one.modifiedAt));

export const writeScenarios = (seasonId: string, scenarios: readonly SavedScenario[]): boolean => {
  const all = readAllScenarios();
  const unreadable = (all[seasonId] ?? []).filter((entry) => coerceScenario(entry) === null);
  const kept = [...scenarios]
    .sort((one, two) => two.modifiedAt.localeCompare(one.modifiedAt))
    .slice(0, SCENARIOS_KEPT);
  const next = [...kept, ...unreadable];
  if (next.length === 0) delete all[seasonId];
  else all[seasonId] = next;
  try {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
};

/** A new scenario's id: unique enough within one device's scenarios for a season. */
export const newScenarioId = () =>
  `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A season's scenarios after a change, and any the change pushed out of the `SCENARIOS_KEPT`. */
export type Kept = { list: SavedScenario[]; pushedOut: SavedScenario[] };

/*
 * Each change is made to the scenarios as stored, read afresh, rather than to a list held on the
 * page: a scenario kept from a link in another tab meanwhile is kept, not written over. Null when
 * the browser would not store it (its storage full or turned off).
 */
const change = (
  seasonId: string,
  edit: (list: SavedScenario[]) => SavedScenario[]
): Kept | null => {
  const before = readScenarios(seasonId);
  const wanted = edit(before);
  if (!writeScenarios(seasonId, wanted)) return null;
  const list = readScenarios(seasonId);
  const kept = new Set(list.map((one) => one.id));
  return { list, pushedOut: wanted.filter((one) => !kept.has(one.id)) };
};

/** Keeps a scenario for its season, in place of any of the same id. */
export const keepScenario = (scenario: SavedScenario): Kept | null =>
  change(scenario.seasonId, (list) => [scenario, ...list.filter((one) => one.id !== scenario.id)]);

/** Lets a season's scenario go. */
export const dropScenario = (seasonId: string, id: string): Kept | null =>
  change(seasonId, (list) => list.filter((one) => one.id !== id));
