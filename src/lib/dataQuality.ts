import { normalizeDateInput } from "./date";
import type { GameLog, Matchup, Settings, TeamBase } from "./types";
import { isFinal } from "./util";

export type FindingSeverity = "needs-attention" | "review" | "info";
export type FindingCode =
  | "duplicate-fixture"
  | "missing-date"
  | "invalid-date"
  | "implausible-score"
  | "uneven-schedule"
  | "no-completed-games"
  | "schedule-total-mismatch"
  | "unknown-team";

export type DataQualityFinding = {
  code: FindingCode;
  severity: FindingSeverity;
  teamIds: string[];
  gameIds: string[];
  summary: string;
  explanation: string;
  suggestedRepair: string;
  safeRepair: "remove-duplicate" | null;
  fingerprint: string;
  deepLink: { view: "games" | "settings"; gameId?: string; teamId?: string };
  affectsForecast: boolean;
};

export type FindingDismissals = Record<string, { severity: FindingSeverity; dismissedAt: string }>;

const severityRank: Record<FindingSeverity, number> = {
  info: 0,
  review: 1,
  "needs-attention": 2,
};

const fingerprint = (code: FindingCode, ids: readonly string[], detail = ""): string =>
  `${code}:${[...ids].sort().join(",")}:${detail}`;

const finding = (
  value: Omit<DataQualityFinding, "fingerprint">,
  detail = ""
): DataQualityFinding => ({
  ...value,
  fingerprint: fingerprint(value.code, [...value.teamIds, ...value.gameIds], detail),
});

export const auditLeagueData = ({
  teams,
  matchups,
  logs,
  settings,
}: {
  teams: readonly TeamBase[];
  matchups: readonly Matchup[];
  logs: Readonly<Record<string, GameLog>>;
  settings: Settings;
}): DataQualityFinding[] => {
  const findings: DataQualityFinding[] = [];
  const teamIds = new Set(teams.map((team) => team.id));
  const fixture = new Map<string, Matchup>();
  const scheduled = new Map(teams.map((team) => [team.id, 0]));
  const completed = new Map(teams.map((team) => [team.id, 0]));

  matchups.forEach((game) => {
    if (!teamIds.has(game.away) || !teamIds.has(game.home) || game.away === game.home) {
      findings.push(
        finding({
          code: "unknown-team",
          severity: "needs-attention",
          teamIds: [game.away, game.home].filter((id) => !teamIds.has(id)),
          gameIds: [game.id],
          summary: "Game has an unknown or repeated team",
          explanation: "This game cannot be ranked or simulated reliably.",
          suggestedRepair: "Edit or remove the game in Schedule.",
          safeRepair: null,
          deepLink: { view: "games", gameId: game.id },
          affectsForecast: true,
        })
      );
    }
    scheduled.set(game.away, (scheduled.get(game.away) ?? 0) + 1);
    scheduled.set(game.home, (scheduled.get(game.home) ?? 0) + 1);
    if (isFinal(logs[game.id])) {
      completed.set(game.away, (completed.get(game.away) ?? 0) + 1);
      completed.set(game.home, (completed.get(game.home) ?? 0) + 1);
    }

    if (!game.date.trim()) {
      findings.push(
        finding({
          code: "missing-date",
          severity: "review",
          teamIds: [game.away, game.home],
          gameIds: [game.id],
          summary: "Game is missing a date",
          explanation: "Ordering, recency, and schedule-change detection need a game date.",
          suggestedRepair: "Add the date in Schedule.",
          safeRepair: null,
          deepLink: { view: "games", gameId: game.id },
          affectsForecast: true,
        })
      );
    } else if (!normalizeDateInput(game.date)) {
      findings.push(
        finding(
          {
            code: "invalid-date",
            severity: "needs-attention",
            teamIds: [game.away, game.home],
            gameIds: [game.id],
            summary: "Game date cannot be read",
            explanation: `“${game.date}” is not a supported date.`,
            suggestedRepair: "Enter a calendar date in Schedule.",
            safeRepair: null,
            deepLink: { view: "games", gameId: game.id },
            affectsForecast: true,
          },
          game.date
        )
      );
    }

    const key = `${game.date}|${[game.away, game.home].sort().join("|")}`;
    const duplicate = fixture.get(key);
    if (duplicate) {
      findings.push(
        finding({
          code: "duplicate-fixture",
          severity:
            isFinal(logs[duplicate.id]) && isFinal(logs[game.id]) ? "needs-attention" : "review",
          teamIds: [game.away, game.home],
          gameIds: [duplicate.id, game.id],
          summary: "Possible duplicate fixture",
          explanation: "The same teams appear twice on the same date.",
          suggestedRepair: "Compare the two entries, then remove the duplicate.",
          safeRepair: "remove-duplicate",
          deepLink: { view: "games", gameId: game.id },
          affectsForecast: true,
        })
      );
    } else fixture.set(key, game);

    const log = logs[game.id];
    if (log && isFinal(log)) {
      const away = Number(log.awayRuns);
      const home = Number(log.homeRuns);
      if (
        !Number.isFinite(away) ||
        !Number.isFinite(home) ||
        away < 0 ||
        home < 0 ||
        away > 99 ||
        home > 99
      ) {
        findings.push(
          finding(
            {
              code: "implausible-score",
              severity: "needs-attention",
              teamIds: [game.away, game.home],
              gameIds: [game.id],
              summary: "Final score looks implausible",
              explanation: "A final must have numeric scores between 0 and 99.",
              suggestedRepair: "Correct the final score in Schedule.",
              safeRepair: null,
              deepLink: { view: "games", gameId: game.id },
              affectsForecast: true,
            },
            `${log.awayRuns}-${log.homeRuns}`
          )
        );
      }
    }
  });

  teams.forEach((team) => {
    if ((completed.get(team.id) ?? 0) === 0) {
      findings.push(
        finding({
          code: "no-completed-games",
          severity: "info",
          teamIds: [team.id],
          gameIds: [],
          summary: `${team.name} has no completed games`,
          explanation: "Its forecast relies on limited league evidence.",
          suggestedRepair: "Enter completed scores when they are available.",
          safeRepair: null,
          deepLink: { view: "games", teamId: team.id },
          affectsForecast: true,
        })
      );
    }
    const count = scheduled.get(team.id) ?? 0;
    if (settings.regularSeasonGamesPerTeam > 0 && count !== settings.regularSeasonGamesPerTeam) {
      findings.push(
        finding(
          {
            code: "schedule-total-mismatch",
            severity: "review",
            teamIds: [team.id],
            gameIds: [],
            summary: `${team.name} has ${count} of ${settings.regularSeasonGamesPerTeam} scheduled games`,
            explanation: "The schedule total differs from the league setting.",
            suggestedRepair: "Add missing games or update the season length in Settings.",
            safeRepair: null,
            deepLink: { view: "settings", teamId: team.id },
            affectsForecast: true,
          },
          String(count)
        )
      );
    }
  });

  const counts = [...scheduled.values()];
  if (counts.length > 1 && Math.max(...counts) - Math.min(...counts) > 2) {
    findings.push(
      finding(
        {
          code: "uneven-schedule",
          severity: "review",
          teamIds: teams.map((team) => team.id),
          gameIds: [],
          summary: "Schedules are unexpectedly uneven",
          explanation: "Teams differ by more than two scheduled games.",
          suggestedRepair: "Review missing or duplicate fixtures.",
          safeRepair: null,
          deepLink: { view: "games" },
          affectsForecast: true,
        },
        counts.join(",")
      )
    );
  }
  return findings;
};

export const visibleFindings = (
  findings: readonly DataQualityFinding[],
  dismissals: FindingDismissals
): DataQualityFinding[] =>
  findings.filter((item) => {
    const dismissed = dismissals[item.fingerprint];
    return !dismissed || severityRank[item.severity] > severityRank[dismissed.severity];
  });

export const dismissFinding = (
  dismissals: FindingDismissals,
  finding: DataQualityFinding,
  now: string
): FindingDismissals => ({
  ...dismissals,
  [finding.fingerprint]: { severity: finding.severity, dismissedAt: now },
});

const dismissalsKey = (seasonId: string): string =>
  `league_forecast_quality_dismissals_v1_${seasonId}`;

export const loadFindingDismissals = (seasonId: string): FindingDismissals => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(dismissalsKey(seasonId)) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result: FindingDismissals = {};
    Object.entries(raw).forEach(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const entry = value as Record<string, unknown>;
      if (
        (entry.severity === "info" ||
          entry.severity === "review" ||
          entry.severity === "needs-attention") &&
        typeof entry.dismissedAt === "string"
      ) {
        result[key] = { severity: entry.severity, dismissedAt: entry.dismissedAt };
      }
    });
    return result;
  } catch {
    return {};
  }
};

export const saveFindingDismissals = (seasonId: string, dismissals: FindingDismissals): boolean => {
  try {
    localStorage.setItem(dismissalsKey(seasonId), JSON.stringify(dismissals));
    return true;
  } catch {
    return false;
  }
};
