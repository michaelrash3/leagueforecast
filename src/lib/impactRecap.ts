/**
 * What changed in the standings when a game went final, in prose.
 *
 * This is the recap panel's whole supply: two rank snapshots of the same season — one with the
 * games in this recap window final, one with them not — diffed into sentences a manager reads
 * without doing the arithmetic themselves.
 *
 * It lived inside `App`, which is the app's only state container and its largest file, and that
 * is the reason it is here now. Nothing about it is React: given a season, a settings object and
 * the logs as they are about to become, the answer is a value. Inside a three-thousand-line
 * component it had no test of its own and could not have one without rendering the whole app;
 * out here the same code is called directly, which is how the numbers below came to be pinned.
 *
 * The two limits are about keeping scoring responsive rather than about baseball. Projecting a
 * whole season is the expensive half of a snapshot, so above `PROJECT_STANDINGS_REMAINING_GAME_LIMIT`
 * games remaining the projection falls back to the plain ranking; above
 * `IMPACT_RECAP_REMAINING_GAME_LIMIT` the detailed recap is skipped altogether and says so,
 * rather than making somebody wait to be told a game in April moved nobody.
 */

import { displayName } from "./format";
import { blankLog, isFinal, parseNumber } from "./util";
import { normalizeDateInput, sundayEndingWeekKey } from "./date";
import { weeklyRecap } from "./insights";
import {
  calculateTeams,
  getMathGoldStatus,
  getRemainingCounts,
  projectStandings,
  rankOptionsFromSettings,
  rankTeams,
} from "./sim";
import {
  buildProjectionSnapshot,
  diffProjectionSnapshots,
  type ProjectionRelevantSettings,
} from "./projectionDelta";
import { buildProjectionExplanations } from "./projectionExplanation";
import type {
  GameLog,
  LastImpact,
  Matchup,
  ProjectionExplanationEntry,
  Settings,
  Team,
  TeamBase,
} from "./types";

/** Above this many games remaining, a snapshot ranks rather than projects. */
export const PROJECT_STANDINGS_REMAINING_GAME_LIMIT = 250;

/** And above this many, the detailed recap is skipped and says so. */
export const IMPACT_RECAP_REMAINING_GAME_LIMIT = 120;

export type RankSnapshotEntry = Team & {
  rank: number;
  projectedRank: number;
  goldPct: number;
  goldStatus: "Clinched" | "In" | "Alive" | "Eliminated";
  maxPoints: number;
  blockersAhead: number;
  maxPct: number;
  minPct: number;
};

/** The season a recap is read against, which does not change while one is built. */
export type RecapPool = {
  teams: TeamBase[];
  matchups: Matchup[];
  settings: Settings;
  goldCutoff: number;
  hasCutLine: boolean;
};

/** A team id to the name a reader knows it by. */
export type NameOf = (teamId: string) => string;

/**
 * The usual one: the pool's own teams, by display name, falling back to the id.
 *
 * `||` rather than `??`, so a team carrying an empty name falls back to its id as well as one
 * carrying no name at all. The recap already read it that way; the projection explanations beside
 * it read `??` and so labelled such a team with an empty string. Unifying on the recap's reading
 * is the one behaviour this move changes, and it changes it towards saying something.
 */
export const nameFrom =
  (teamBaseById: ReadonlyMap<string, TeamBase>): NameOf =>
  (teamId) =>
    displayName(teamBaseById.get(teamId)?.name || teamId);

export const buildRankSnapshot = (
  nextLogs: Record<string, GameLog>,
  { teams, matchups, settings, goldCutoff }: RecapPool
): RankSnapshotEntry[] => {
  const nextLive = calculateTeams(teams, matchups, nextLogs, settings);
  const nextRanked = rankTeams(nextLive, rankOptionsFromSettings(settings));
  const nextRemaining = matchups.filter((game) => !isFinal(nextLogs[game.id]));
  const nextRemainingCounts = getRemainingCounts(nextLive, nextRemaining);
  const nextProjected =
    nextRemaining.length <= PROJECT_STANDINGS_REMAINING_GAME_LIMIT
      ? projectStandings(nextLive, nextRemaining, settings)
      : rankTeams(nextLive, rankOptionsFromSettings(settings));

  return nextRanked.map((team) => {
    const projectedTeam = nextProjected.find((item) => item.id === team.id);
    const status = getMathGoldStatus(team, nextRanked, nextRemainingCounts, goldCutoff, settings);
    return {
      ...team,
      projectedRank: projectedTeam?.rank ?? team.rank ?? 99,
      goldPct: 0, // snapshot-only, odds shown live from worker
      ...status,
    };
  });
};
export const summarizeChanges = (
  before: RankSnapshotEntry[],
  after: RankSnapshotEntry[],
  goldCutoff: number
) => {
  const messages: string[] = [];
  after.forEach((team) => {
    const old = before.find((item) => item.id === team.id);
    if (!old) return;
    const oldRank = old.rank ?? 99;
    const newRank = team.rank ?? 99;
    const teamName = displayName(team.name);
    if (oldRank !== newRank) {
      const direction = newRank < oldRank ? "moved up" : "dropped";
      messages.push(`${teamName} ${direction} from #${oldRank} to #${newRank}`);
    }
    if (oldRank <= goldCutoff && newRank > goldCutoff) {
      messages.push(`${teamName} dropped below the Gold cut line`);
    }
    if (oldRank > goldCutoff && newRank <= goldCutoff) {
      messages.push(`${teamName} moved above the Gold cut line into Gold position`);
    }
    if (old.goldStatus !== team.goldStatus) {
      if (team.goldStatus === "Eliminated")
        messages.push(`${teamName} is now eliminated from Gold Bracket contention`);
      else if (team.goldStatus === "Clinched")
        messages.push(`${teamName} clinched the Gold Bracket`);
    }
  });
  return Array.from(new Set(messages)).slice(0, 10);
};

const projectionSettingsForDelta = (settings: Settings): ProjectionRelevantSettings => ({
  goldCutoff: settings.goldCutoff,
  regularSeasonGamesPerTeam: settings.regularSeasonGamesPerTeam,
  winPoints: settings.winPoints,
  tiePoints: settings.tiePoints,
  runDiffTiebreaker: settings.runDiffTiebreaker,
  tiebreakerOrder: settings.tiebreakerOrder,
  maxScoreCap: settings.maxScoreCap,
  modelAggression: settings.modelAggression,
});

// Plain-English "why the projection moved" bullets per team, derived from the same
// before/after rank snapshots the recap already builds (lib/projectionExplanation.ts).
export const projectionExplanationsFor = (
  before: RankSnapshotEntry[],
  after: RankSnapshotEntry[],
  settings: Settings,
  nameOf: NameOf
): ProjectionExplanationEntry[] => {
  const toSnapshotTeam = (entry: RankSnapshotEntry) => ({
    id: entry.id,
    w: entry.w,
    t: entry.t,
    rs: entry.rs,
    ra: entry.ra,
    runDiff: entry.runDiff,
    rank: entry.rank,
    projectedRank: entry.projectedRank,
  });
  const projectionSettings = projectionSettingsForDelta(settings);
  const delta = diffProjectionSnapshots(
    buildProjectionSnapshot({ teams: before.map(toSnapshotTeam), settings: projectionSettings }),
    buildProjectionSnapshot({ teams: after.map(toSnapshotTeam), settings: projectionSettings })
  );
  return delta.teams
    .map((teamDelta) => ({
      teamId: teamDelta.teamId,
      teamName: nameOf(teamDelta.teamId),
      items: buildProjectionExplanations(teamDelta, { maxItems: 2 }),
    }))
    .filter((entry) => entry.items.length > 0);
};

/**
 * The recap for one game going final, or `null` when there is nothing to say.
 *
 * `current` is the log as it stands before the final flag flips and `nextLogs` is the whole set
 * as it is about to become — both are passed rather than derived, because the caller has already
 * built them inside its state updater and rebuilding them here would be a second chance to
 * disagree about what "next" means.
 *
 * Returns `null` for a game the season does not hold, which is the same answer the caller wants
 * for un-marking a final: nothing to recap either way.
 */
export const impactOfFinal = (
  gameId: string,
  current: GameLog,
  nextLogs: Record<string, GameLog>,
  pool: RecapPool,
  nameOf: NameOf
): LastImpact | null => {
  const { matchups, settings, goldCutoff, hasCutLine } = pool;
  const game = matchups.find((item) => item.id === gameId);
  if (!game) return null;

  const dateLabel = normalizeDateInput(game.date);
  const weekLabel = sundayEndingWeekKey(game.date);
  const nextRemainingCount = matchups.reduce(
    (count, matchup) => count + (isFinal(nextLogs[matchup.id]) ? 0 : 1),
    0
  );
  if (nextRemainingCount > IMPACT_RECAP_REMAINING_GAME_LIMIT) {
    return {
      title: `Latest Update — ${nameOf(game.away)} vs ${nameOf(game.home)}`,
      scores: [
        `${nameOf(game.away)} ${parseNumber(current.awayRuns)}, ${nameOf(game.home)} ${parseNumber(current.homeRuns)}`,
      ],
      messages: [
        `Final saved. Detailed standings-impact recap is paused until ${IMPACT_RECAP_REMAINING_GAME_LIMIT} or fewer games remain to keep scoring responsive.`,
      ],
      recapItems: [],
    };
  }
  const sameRecapWindow = (m: Matchup) => {
    if (settings.recapGrouping === "game") return m.id === gameId;
    if (settings.recapGrouping === "week") {
      return sundayEndingWeekKey(m.date) === weekLabel;
    }
    return normalizeDateInput(m.date) === dateLabel;
  };
  const groupedFinals = matchups.filter((m) => {
    if (!sameRecapWindow(m)) return false;
    const log = nextLogs[m.id];
    return !!log?.isFinal;
  });

  const beforeLogs = { ...nextLogs };
  groupedFinals.forEach((m) => {
    const log = beforeLogs[m.id] || blankLog();
    beforeLogs[m.id] = { ...log, isFinal: false };
  });

  const before = buildRankSnapshot(beforeLogs, pool);
  const after = buildRankSnapshot(nextLogs, pool);
  const messages = summarizeChanges(before, after, goldCutoff);
  const finalsSinceLast = groupedFinals.map((m) => {
    const log = nextLogs[m.id] || blankLog();
    return {
      game: m,
      awayScore: parseNumber(log.awayRuns),
      homeScore: parseNumber(log.homeRuns),
      awayName: nameOf(m.away),
      homeName: nameOf(m.home),
    };
  });
  const recapItems = weeklyRecap({
    before,
    after: after.map((entry) => ({
      id: entry.id,
      rank: entry.rank,
      goldPct: entry.goldPct,
      goldStatus: entry.goldStatus,
      name: entry.name,
    })),
    finalsSinceLast,
    cutoff: goldCutoff,
    hasCutLine,
  });
  const projectionExplanations = projectionExplanationsFor(before, after, settings, nameOf);
  return {
    title:
      settings.recapGrouping === "game"
        ? `Latest Update — ${finalsSinceLast[0]?.awayName ?? "Away"} vs ${finalsSinceLast[0]?.homeName ?? "Home"}`
        : settings.recapGrouping === "week"
          ? `Latest Update — Week Ending ${weekLabel || "No Date"}`
          : dateLabel
            ? `Latest Update — ${dateLabel}`
            : "Latest Update — No Date",
    scores: finalsSinceLast.map(
      (item) => `${item.awayName} ${item.awayScore}, ${item.homeName} ${item.homeScore}`
    ),
    messages: messages.length
      ? messages
      : ["This update was recorded; no standings-impact detail to summarize."],
    recapItems,
    projectionExplanations,
  };
};

/**
 * Marking a game final, or un-marking it: the logs as they become, and the recap that goes with.
 *
 * Both answers come from one call because they are one decision, and because the caller is a
 * React event handler that must not make this decision inside a state updater. It used to: the
 * recap was computed and `setLastImpact` called from inside `setLogs`'s updater, which React is
 * entitled to run more than once and does run twice under `StrictMode`. That is a side effect in
 * a function that is required to be pure, and it meant two full rank snapshots and two
 * projections per final in development. Production was unaffected — `StrictMode` is inert in a
 * production build — so this is correctness and dev cost rather than a bug anybody saw.
 *
 * `logs` is the whole set as the handler sees it, not a `prev` from an updater. That is safe
 * because one press toggles one game and nothing calls this in a loop; if that ever changes, the
 * updater form has to come back and the recap has to move to an effect.
 */
export const finalToggled = (
  gameId: string,
  logs: Record<string, GameLog>,
  defaultGameInnings: number,
  pool: RecapPool,
  nameOf: NameOf
): { nextLogs: Record<string, GameLog>; impact: LastImpact | null } => {
  const current = logs[gameId] || blankLog(String(defaultGameInnings));
  const isMarkingFinal = !current.isFinal;
  const nextLogs = { ...logs, [gameId]: { ...current, isFinal: !current.isFinal } };
  return {
    nextLogs,
    impact: isMarkingFinal ? impactOfFinal(gameId, current, nextLogs, pool, nameOf) : null,
  };
};
