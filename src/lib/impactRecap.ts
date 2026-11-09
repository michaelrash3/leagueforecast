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
import { normalizeDateInput, parseDateValue, seasonStartMonth, sundayEndingWeekKey } from "./date";
import { weeklyRecap } from "./insights";
import {
  bracketBegun,
  calculateTeams,
  effectiveGoldCutoff,
  getMathGoldStatus,
  getRemainingCounts,
  projectStandings,
  rankOptionsFromSettings,
  rankTeams,
  regularSeasonSettings,
} from "./sim";
import {
  buildProjectionSnapshot,
  diffProjectionSnapshots,
  type ProjectionRelevantSettings,
} from "./projectionDelta";
import { buildProjectionExplanations } from "./projectionExplanation";
import type { SeasonState } from "./seasonStore";
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

/**
 * The pool a season's recap reads against: its teams and games, the settings its regular season is
 * forecast under (`regularSeasonSettings`, which owe no games once the bracket has a kept score),
 * the cut line its format gives for its number of teams (`effectiveGoldCutoff`), and whether it has
 * one. The page's own pool is this of the season it draws; a recap read once a change is in reads
 * it of the season as that change left it, which may hold teams and games the page has not drawn.
 */
export const recapPoolOf = ({
  teams,
  matchups,
  bracketLogs,
  settings,
}: Pick<SeasonState, "teams" | "matchups" | "bracketLogs" | "settings">): RecapPool => ({
  teams,
  matchups,
  settings: regularSeasonSettings(settings, bracketBegun(bracketLogs)),
  goldCutoff: effectiveGoldCutoff(settings, teams.length),
  hasCutLine: settings.postseasonFormat === "cut",
});

/**
 * The standings the logs make, by place now and projected and by Gold status, but not by Gold %.
 *
 * The odds are the worker's. When a final is pressed they are at best the season's as it stood
 * before the press, and the season after it has none until the worker answers; under date or week
 * grouping the snapshot without the update's finals is not the season they describe either, since
 * it reopens the finals entered earlier that day or week. Simulating both snapshots here would run
 * the Monte Carlo twice on the main thread at every press. So a snapshot carries no Gold %, where it
 * once carried 0, which the bubble line printed as two teams' odds and between which the recap
 * could never find a shift.
 */
export const buildRankSnapshot = (
  nextLogs: Record<string, GameLog>,
  { teams, matchups, settings, goldCutoff }: RecapPool
): RankSnapshotEntry[] => {
  const nextLive = calculateTeams(teams, matchups, nextLogs, settings);
  const nextRanked = rankTeams(nextLive, rankOptionsFromSettings(settings));
  const nextRemaining = matchups.filter((game) => !isFinal(nextLogs[game.id]));
  // Games the season owes but has not scheduled count too, as they do in the table.
  const nextRemainingCounts = getRemainingCounts(
    nextLive,
    nextRemaining,
    Math.max(0, Math.round(settings.regularSeasonGamesPerTeam || 0))
  );
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
 * The recap of games just made final, or `null` when there is nothing to say: the one game a press
 * of "final" on the Schedule makes (`finalToggled`), or the several that Fill scores, Data
 * Quality's Mark them final or a pasted schedule's scores make at once.
 *
 * `nextLogs` is the whole set as it is with them final, and `gameIds` the games that went final in
 * it. A game is recapped with every final in its window (`settings.recapGrouping`: the game alone,
 * its date or its week), and several games are one update, recapped over all of their windows at
 * once, so a fill of two weekends says what the two weekends did together rather than what the
 * last of them did. Where they share a window, that is the recap marking the last of them final
 * on the Schedule gives; across several, the title runs from the first window to the last in the
 * season's order. With too many games still to play for the detail, each of their scores is said,
 * as one game's is.
 *
 * Returns `null` when none of them is a final game the season holds, which is the same answer the
 * caller wants for un-marking a final: nothing to recap either way.
 */
export const impactOfFinals = (
  gameIds: Iterable<string>,
  nextLogs: Record<string, GameLog>,
  pool: RecapPool,
  nameOf: NameOf
): LastImpact | null => {
  const { matchups, settings, goldCutoff, hasCutLine } = pool;
  const asked = new Set(gameIds);
  // In the schedule's order, the order a window's finals have always been listed in.
  const made = matchups.filter((game) => asked.has(game.id) && isFinal(nextLogs[game.id]));
  const game = made[0];
  if (!game) return null;

  // On the season's own calendar, so a week from December into January is one.
  const startMonth = seasonStartMonth(matchups.map((matchup) => matchup.date));
  const dayOf = (m: Matchup) => normalizeDateInput(m.date);
  const weekOf = (m: Matchup) => sundayEndingWeekKey(m.date, startMonth);
  const dateLabel = dayOf(game);
  const weekLabel = weekOf(game);
  const nextRemainingCount = matchups.reduce(
    (count, matchup) => count + (isFinal(nextLogs[matchup.id]) ? 0 : 1),
    0
  );
  if (nextRemainingCount > IMPACT_RECAP_REMAINING_GAME_LIMIT) {
    return {
      title:
        made.length === 1
          ? `Latest Update — ${nameOf(game.away)} vs ${nameOf(game.home)}`
          : `Latest Update — ${made.length} Games`,
      scores: made.map((m) => {
        const log = nextLogs[m.id] || blankLog();
        return `${nameOf(m.away)} ${parseNumber(log.awayRuns)}, ${nameOf(m.home)} ${parseNumber(log.homeRuns)}`;
      }),
      messages: [
        `${made.length === 1 ? "Final" : "Finals"} saved. Detailed standings-impact recap is paused until ${IMPACT_RECAP_REMAINING_GAME_LIMIT} or fewer games remain to keep scoring responsive.`,
      ],
      recapItems: [],
    };
  }
  const ids = new Set(made.map((m) => m.id));
  const dates = new Set(made.map(dayOf));
  const weeks = new Set(made.map(weekOf));
  const sameRecapWindow = (m: Matchup) => {
    if (settings.recapGrouping === "game") return ids.has(m.id);
    if (settings.recapGrouping === "week") return weeks.has(weekOf(m));
    return dates.has(dayOf(m));
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
      goldStatus: entry.goldStatus,
      name: entry.name,
    })),
    finalsSinceLast,
    cutoff: goldCutoff,
    hasCutLine,
  });
  const projectionExplanations = projectionExplanationsFor(before, after, settings, nameOf);
  // Over several windows, from the first game's to the last's, in the season's order.
  const span = (labelOf: (m: Matchup) => string) => {
    const inOrder = [...made].sort(
      (a, b) => parseDateValue(a.date, startMonth) - parseDateValue(b.date, startMonth)
    );
    const label = (m: Matchup | undefined) => labelOf(m ?? game) || "No Date";
    return `${label(inOrder[0])} to ${label(inOrder[inOrder.length - 1])}`;
  };
  const title = () => {
    if (settings.recapGrouping === "game") {
      return made.length === 1
        ? `Latest Update — ${finalsSinceLast[0]?.awayName ?? "Away"} vs ${finalsSinceLast[0]?.homeName ?? "Home"}`
        : `Latest Update — ${made.length} Games`;
    }
    if (settings.recapGrouping === "week") {
      return weeks.size === 1
        ? `Latest Update — Week Ending ${weekLabel || "No Date"}`
        : `Latest Update — Weeks Ending ${span(weekOf)}`;
    }
    if (dates.size > 1) return `Latest Update — ${span(dayOf)}`;
    return dateLabel ? `Latest Update — ${dateLabel}` : "Latest Update — No Date";
  };
  return {
    title: title(),
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
 * `logs` is the whole set as the handler sees it, not a `prev` from an updater, and the recap is
 * worked out from it. The scores themselves must not be: a score's keystrokes are a transition,
 * so a press can come before they are on screen, and a whole set written from the handler's view
 * puts back the scores without them. The handler writes the final alone, onto the latest scores,
 * with `withFinal`, as an updater, and `nextLogs` is only what the recap was read against.
 */
/**
 * `logs` with game `gameId` marked final, or not, as `isFinal` says: set, not flipped, so an
 * updater asked twice gives the same scores, and onto the scores as they are, not as a handler saw
 * them.
 */
export const withFinal = (
  logs: Record<string, GameLog>,
  gameId: string,
  isFinal: boolean,
  defaultGameInnings: number
): Record<string, GameLog> => {
  const current = logs[gameId] || blankLog(String(defaultGameInnings));
  if (current.isFinal === isFinal && logs[gameId]) return logs;
  return { ...logs, [gameId]: { ...current, isFinal } };
};

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
    impact: isMarkingFinal ? impactOfFinals([gameId], nextLogs, pool, nameOf) : null,
  };
};
