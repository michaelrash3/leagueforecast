/**
 * How a team is playing lately against how it has played all season — the numbers behind the
 * drawer's form panel.
 *
 * Recent form is a short window off the end of the schedule, so it moves fast by design; the
 * thresholds are what it takes for a move to be worth pointing out rather than noise.
 */
import { formatGameDate, parseDateValue } from "./date";
import type { GameLog, Matchup } from "./types";
import { blankLog, isFinal, parseNumber } from "./util";

export type TeamTrendGame = {
  id: string;
  date: string;
  label: string;
  runsFor: number;
  hitsFor: number;
  runsAgainst: number;
  hitsAgainst: number;
};

export type TeamTrendMetric = {
  key: string;
  label: string;
  shortLabel: string;
  season: number | null;
  recent: number | null;
  delta: number | null;
  direction: "higher" | "lower";
  status: "Hot" | "Cold" | "Steady" | "No data";
  values: number[];
};

export type TeamTrendSummary = {
  games: TeamTrendGame[];
  recentWindow: number;
  metrics: TeamTrendMetric[];
  headline: string;
};

export const gameSortValue = (game: Matchup) => parseDateValue(game.date);

export const averageRecent = (values: number[], window: number) => {
  if (!values.length) return null;
  const sample = values.slice(-window);
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
};

export const trendStatusFor = (
  delta: number | null,
  direction: TeamTrendMetric["direction"],
  threshold: number
): TeamTrendMetric["status"] => {
  if (delta === null) return "No data";
  if (Math.abs(delta) < threshold) return "Steady";
  const isBetter = direction === "higher" ? delta > 0 : delta < 0;
  return isBetter ? "Hot" : "Cold";
};

export const buildTeamTrendSummary = (
  teamId: string,
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  runsOnly: boolean
): TeamTrendSummary => {
  const games = matchups
    .filter((game) => game.away === teamId || game.home === teamId)
    .filter((game) => isFinal(logs[game.id]))
    .sort((a, b) => {
      const dateDiff = gameSortValue(a) - gameSortValue(b);
      return dateDiff === 0 ? a.id.localeCompare(b.id) : dateDiff;
    })
    .map<TeamTrendGame>((game, index) => {
      const log = logs[game.id] ?? blankLog();
      const isAway = game.away === teamId;
      const date = game.date ? formatGameDate(game.date) : `Game ${index + 1}`;

      return {
        id: game.id,
        date: game.date,
        label: date,
        runsFor: parseNumber(isAway ? log.awayRuns : log.homeRuns),
        hitsFor: parseNumber(isAway ? log.awayHits : log.homeHits),
        runsAgainst: parseNumber(isAway ? log.homeRuns : log.awayRuns),
        hitsAgainst: parseNumber(isAway ? log.homeHits : log.awayHits),
      };
    });

  const recentWindow = Math.min(3, games.length);
  const metricConfigs: Array<{
    key: string;
    label: string;
    shortLabel: string;
    direction: TeamTrendMetric["direction"];
    threshold: number;
    value: (game: TeamTrendGame) => number;
  }> = [
    {
      key: "runs-for",
      label: "Runs scored",
      shortLabel: "R/G",
      direction: "higher",
      threshold: 0.5,
      value: (game) => game.runsFor,
    },
    {
      key: "hits-for",
      label: "Hits",
      shortLabel: "H/G",
      direction: "higher",
      threshold: 0.75,
      value: (game) => game.hitsFor,
    },
    {
      key: "runs-against",
      label: "Runs allowed",
      shortLabel: "RA/G",
      direction: "lower",
      threshold: 0.5,
      value: (game) => game.runsAgainst,
    },
    {
      key: "hits-against",
      label: "Hits allowed",
      shortLabel: "HA/G",
      direction: "lower",
      threshold: 0.75,
      value: (game) => game.hitsAgainst,
    },
  ];

  // A runs-only league never records a hit, so the two hit trends would be flat
  // lines at zero for the whole season. Runs carry the trend on their own.
  const visibleConfigs = runsOnly
    ? metricConfigs.filter((config) => config.key === "runs-for" || config.key === "runs-against")
    : metricConfigs;

  const metrics = visibleConfigs.map<TeamTrendMetric>((config) => {
    const values = games.map(config.value);
    const season = averageRecent(values, values.length);
    const recent = recentWindow ? averageRecent(values, recentWindow) : null;
    const delta = season === null || recent === null ? null : recent - season;

    return {
      key: config.key,
      label: config.label,
      shortLabel: config.shortLabel,
      direction: config.direction,
      season,
      recent,
      delta,
      status: trendStatusFor(delta, config.direction, config.threshold),
      values,
    };
  });

  const hotCount = metrics.filter((metric) => metric.status === "Hot").length;
  const coldCount = metrics.filter((metric) => metric.status === "Cold").length;
  const headline =
    games.length < 2
      ? "Need more finals for a real trend."
      : hotCount > coldCount
        ? "Heating up"
        : coldCount > hotCount
          ? "Cooling off"
          : "Holding steady";

  return { games, recentWindow, metrics, headline };
};
