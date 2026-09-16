/**
 * The box-score arithmetic behind the league's team pages: a team's own splits, the league
 * averages to read them against, and the per-metric leaderboards.
 *
 * Pulled out of App.tsx — it is arithmetic over matchups and logs with no React in it, so it
 * belongs beside the rest of the model rather than above the views that render it.
 */
import type { GameLog, Matchup, PitchMode, TeamBase } from "./types";
import { isFinal, parseNumber } from "./util";

export type TeamSplitLine = {
  label: string;
  games: number;
  offense: { runs: number; hits: number; strikeouts: number; walks: number };
  defense: { runs: number; hits: number; strikeouts: number; errors: number; walks: number };
};

export type TeamSplitSummary = {
  all: TeamSplitLine;
  home: TeamSplitLine;
  away: TeamSplitLine;
};

export type LeagueAverageStats = {
  completedGames: number;
  teamGames: number;
  runs: number;
  hits: number;
  strikeouts: number;
  errors: number;
  walks: number;
};

export type StatRankingMetric = {
  key: string;
  label: string;
  direction: "asc" | "desc";
  average: number | null;
  entries: StatRankingEntry[];
};

export type StatRankingEntry = {
  teamId: string;
  teamName: string;
  rank: number;
  games: number;
  value: number | null;
};

export type StatRankings = {
  sampleGames: number;
  metrics: StatRankingMetric[];
};

/**
 * Balls in play: everything that was hit at, minus the ones that were struck out.
 *
 * Hits are the real measure and runs are the stand-in for a league that only records those, so a
 * blank hits box falls back to runs and a blank innings box to a six-inning game. A blank has to be
 * told apart from a zero for any of that to happen — `Number("")` is 0, and reading a box nobody
 * filled in as a genuine zero is what made these fallbacks unreachable.
 */
export const calcBip = (hits: string, runs: string, strikeouts: string, innings: string) => {
  const entered = (value: string) => (value.trim() === "" ? NaN : parseNumber(value, NaN));
  const h = entered(hits);
  const r = entered(runs);
  const k = entered(strikeouts);
  const inn = entered(innings);
  const contact = Number.isFinite(h) ? h : Number.isFinite(r) ? r : 0;
  return contact + (Number.isFinite(inn) ? inn : 6) * 3 - (Number.isFinite(k) ? k : 0);
};

export const emptySplitLine = (label: string): TeamSplitLine => ({
  label,
  games: 0,
  offense: { runs: 0, hits: 0, strikeouts: 0, walks: 0 },
  defense: { runs: 0, hits: 0, strikeouts: 0, errors: 0, walks: 0 },
});

export const addSplitGame = (
  line: TeamSplitLine,
  offense: { runs: number; hits: number; strikeouts: number; walks: number },
  defense: { runs: number; hits: number; strikeouts: number; errors: number; walks: number }
) => {
  line.games += 1;
  line.offense.runs += offense.runs;
  line.offense.hits += offense.hits;
  line.offense.strikeouts += offense.strikeouts;
  line.offense.walks += offense.walks;
  line.defense.runs += defense.runs;
  line.defense.hits += defense.hits;
  line.defense.strikeouts += defense.strikeouts;
  line.defense.errors += defense.errors;
  line.defense.walks += defense.walks;
};

export const buildTeamSplitSummary = (
  teamId: string,
  matchups: Matchup[],
  logs: Record<string, GameLog>
): TeamSplitSummary => {
  const summary: TeamSplitSummary = {
    all: emptySplitLine("Overall"),
    home: emptySplitLine("Home"),
    away: emptySplitLine("Away"),
  };

  matchups.forEach((game) => {
    if (game.away !== teamId && game.home !== teamId) return;
    const log = logs[game.id];
    if (!log || !isFinal(log)) return;

    const isAway = game.away === teamId;
    const offense = isAway
      ? {
          runs: parseNumber(log.awayRuns),
          hits: parseNumber(log.awayHits),
          strikeouts: parseNumber(log.awayK),
          walks: parseNumber(log.homeWalksAllowed ?? ""),
        }
      : {
          runs: parseNumber(log.homeRuns),
          hits: parseNumber(log.homeHits),
          strikeouts: parseNumber(log.homeK),
          walks: parseNumber(log.awayWalksAllowed ?? ""),
        };
    const defense = isAway
      ? {
          runs: parseNumber(log.homeRuns),
          hits: parseNumber(log.homeHits),
          strikeouts: parseNumber(log.homeK),
          errors: parseNumber(log.awayErrors ?? ""),
          walks: parseNumber(log.awayWalksAllowed ?? ""),
        }
      : {
          runs: parseNumber(log.awayRuns),
          hits: parseNumber(log.awayHits),
          strikeouts: parseNumber(log.awayK),
          errors: parseNumber(log.homeErrors ?? ""),
          walks: parseNumber(log.homeWalksAllowed ?? ""),
        };

    addSplitGame(summary.all, offense, defense);
    addSplitGame(isAway ? summary.away : summary.home, offense, defense);
  });

  return summary;
};

export const buildLeagueAverageStats = (
  matchups: Matchup[],
  logs: Record<string, GameLog>
): LeagueAverageStats => {
  return matchups.reduce<LeagueAverageStats>(
    (totals, game) => {
      const log = logs[game.id];
      if (!log || !isFinal(log)) return totals;

      totals.completedGames += 1;
      totals.teamGames += 2;
      totals.runs += parseNumber(log.awayRuns) + parseNumber(log.homeRuns);
      totals.hits += parseNumber(log.awayHits) + parseNumber(log.homeHits);
      totals.strikeouts += parseNumber(log.awayK) + parseNumber(log.homeK);
      totals.errors += parseNumber(log.awayErrors ?? "") + parseNumber(log.homeErrors ?? "");
      totals.walks +=
        parseNumber(log.awayWalksAllowed ?? "") + parseNumber(log.homeWalksAllowed ?? "");
      return totals;
    },
    { completedGames: 0, teamGames: 0, runs: 0, hits: 0, strikeouts: 0, errors: 0, walks: 0 }
  );
};

export const buildTeamStatRankings = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  pitchMode: PitchMode,
  trackErrors: boolean,
  runsOnly: boolean
): StatRankings => {
  const summaries = teams.map((team) => ({
    team,
    line: buildTeamSplitSummary(team.id, matchups, logs).all,
  }));

  const rankedEntries = (
    valueForLine: (line: TeamSplitLine) => number,
    direction: "asc" | "desc"
  ): StatRankingEntry[] =>
    summaries
      .map(({ team, line }) => ({
        teamId: team.id,
        teamName: team.name,
        games: line.games,
        value: line.games > 0 ? valueForLine(line) / line.games : null,
      }))
      .sort((a, b) => {
        if (a.value === null && b.value === null) return a.teamName.localeCompare(b.teamName);
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        const valueDiff = direction === "asc" ? a.value - b.value : b.value - a.value;
        if (Math.abs(valueDiff) > 0.0001) return valueDiff;
        return a.teamName.localeCompare(b.teamName);
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const averageFor = (valueForLine: (line: TeamSplitLine) => number): number | null => {
    const totals = summaries.reduce(
      (acc, { line }) => {
        if (line.games === 0) return acc;
        acc.value += valueForLine(line);
        acc.games += line.games;
        return acc;
      },
      { value: 0, games: 0 }
    );

    return totals.games > 0 ? totals.value / totals.games : null;
  };

  const sampleGames = matchups.filter((game) => isFinal(logs[game.id])).length;

  const runsScored: StatRankingMetric = {
    key: "runs-scored",
    label: "R/G",
    direction: "desc",
    average: averageFor((line) => line.offense.runs),
    entries: rankedEntries((line) => line.offense.runs, "desc"),
  };

  const runsAllowed: StatRankingMetric = {
    key: "runs-allowed",
    label: "RA/G",
    direction: "asc",
    average: averageFor((line) => line.defense.runs),
    entries: rankedEntries((line) => line.defense.runs, "asc"),
  };

  // A runs-only league records nothing else, so a leaderboard of hits or
  // strikeouts would be every team tied at 0.0. Runs for and against are the
  // whole box score here, and they are also the only ones the standings use.
  if (runsOnly) {
    return { sampleGames, metrics: [runsScored, runsAllowed] };
  }

  const baseMetrics: StatRankingMetric[] = [
    runsScored,
    {
      key: "hits",
      label: "H/G",
      direction: "desc",
      average: averageFor((line) => line.offense.hits),
      entries: rankedEntries((line) => line.offense.hits, "desc"),
    },
  ];

  const modeMetrics: StatRankingMetric[] =
    pitchMode === "player"
      ? [
          {
            key: "walks-drawn",
            label: "BB/G",
            direction: "desc",
            average: averageFor((line) => line.offense.walks),
            entries: rankedEntries((line) => line.offense.walks, "desc"),
          },
          ...(trackErrors
            ? [
                {
                  key: "errors",
                  label: "E/G",
                  direction: "asc" as const,
                  average: averageFor((line) => line.defense.errors),
                  entries: rankedEntries((line) => line.defense.errors, "asc"),
                },
              ]
            : []),
        ]
      : [
          {
            key: "least-strikeouts",
            label: "K/G",
            direction: "asc",
            average: averageFor((line) => line.offense.strikeouts),
            entries: rankedEntries((line) => line.offense.strikeouts, "asc"),
          },
          {
            key: "opponent-strikeouts",
            label: "Opp K/G",
            direction: "desc",
            average: averageFor((line) => line.defense.strikeouts),
            entries: rankedEntries((line) => line.defense.strikeouts, "desc"),
          },
        ];

  return {
    sampleGames,
    metrics: [
      ...baseMetrics,
      ...modeMetrics,
      runsAllowed,
      {
        key: pitchMode === "player" ? "walks-allowed" : "hits-allowed",
        label: pitchMode === "player" ? "BB Allowed/G" : "HA/G",
        direction: "asc",
        average: averageFor((line) =>
          pitchMode === "player" ? line.defense.walks : line.defense.hits
        ),
        entries: rankedEntries(
          (line) => (pitchMode === "player" ? line.defense.walks : line.defense.hits),
          "asc"
        ),
      },
    ],
  };
};

export const perGame = (value: number, games: number) => (games ? (value / games).toFixed(1) : "—");
