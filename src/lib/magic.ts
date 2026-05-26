import { standingsPoints } from "./sim";
import type { Matchup, Settings, Team } from "./types";

export type MagicResult = {
  type: "magic" | "elimination" | "clinched" | "impossible";
  ownWinsNeeded: number;
  opponentLossesNeeded: number;
  description: string;
};

type PointsMap = Record<string, number>;

type OutcomeMode = "any" | "all";

const remainingGamesFor = (teamId: string, remaining: Matchup[]) =>
  remaining.filter((g) => g.away === teamId || g.home === teamId);

const buildPointsMap = (teams: Team[], settings: Settings): PointsMap => {
  const out: PointsMap = {};
  teams.forEach((t) => {
    out[t.id] = standingsPoints(t, settings);
  });
  return out;
};

const sortedTeamIds = (teams: Team[]) => teams.map((t) => t.id).sort();

/**
 * Solver ranking policy:
 * - This module intentionally solves on standings points only.
 * - For equal points, it uses a deterministic team-id tie-break (lexicographic ascending).
 *
 * This keeps playoff math deterministic and cache-stable while avoiding implicit dependency
 * on richer UI tie-break rules (e.g. run differential). If app-wide tie policy changes,
 * update this function and matching tests together.
 */
const rankOfTeam = (teamId: string, points: PointsMap, teams: Team[]) => {
  const my = points[teamId] ?? 0;
  let above = 0;
  let tiedAhead = 0;
  for (const t of teams) {
    if (t.id === teamId) continue;
    const p = points[t.id] ?? 0;
    if (p > my) {
      above += 1;
    } else if (p === my && t.id < teamId) {
      tiedAhead += 1;
    }
  }
  return above + tiedAhead + 1;
};

/**
 * Exact playoff-math solver.
 *
 * Complexity is exponential in remaining games: O(branches^G), where branches is 2 (W/L)
 * or 3 (W/L/T when tiePoints > 0) and G is remaining.length.
 *
 * Guardrails:
 * - Memoization collapses many equivalent states and is effective in practical schedules.
 * - This must stay exact: when schedules grow too large for acceptable latency, callers
 *   should cap usage by remaining-game count and/or route to a future approximation mode.
 */
const solveCutoff = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  settings: Settings,
  requiredOwnWins: number,
  extraForcedLosses: number,
  mode: OutcomeMode
) => {
  const base = buildPointsMap(teams, settings);
  const myRemaining = remainingGamesFor(teamId, remaining).length;
  if (requiredOwnWins > myRemaining || extraForcedLosses > myRemaining) return false;

  const ids = sortedTeamIds(teams);
  const memo = new Map<string, boolean>();

  const dfs = (idx: number, ownWins: number, forcedLosses: number, points: PointsMap): boolean => {
    if (idx === remaining.length) {
      if (ownWins < requiredOwnWins || forcedLosses < extraForcedLosses) return false;
      return rankOfTeam(teamId, points, teams) <= settings.goldCutoff;
    }

    const pointsKey = ids.map((id) => points[id] ?? 0).join(",");
    const key = `${mode}|${idx}|${ownWins}|${forcedLosses}|${pointsKey}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const g = remaining[idx];
    if (!g) {
      memo.set(key, false);
      return false;
    }

    const outcomes: Array<{ next: PointsMap; own: number; loss: number }> = [
      {
        next: { ...points, [g.away]: (points[g.away] ?? 0) + settings.winPoints },
        own: ownWins + (g.away === teamId ? 1 : 0),
        loss: forcedLosses + (g.home === teamId ? 1 : 0),
      },
      {
        next: { ...points, [g.home]: (points[g.home] ?? 0) + settings.winPoints },
        own: ownWins + (g.home === teamId ? 1 : 0),
        loss: forcedLosses + (g.away === teamId ? 1 : 0),
      },
    ];

    if (settings.tiePoints > 0) {
      outcomes.push({
        next: {
          ...points,
          [g.away]: (points[g.away] ?? 0) + settings.tiePoints,
          [g.home]: (points[g.home] ?? 0) + settings.tiePoints,
        },
        own: ownWins,
        loss: forcedLosses,
      });
    }

    const result =
      mode === "any"
        ? outcomes.some((o) => dfs(idx + 1, o.own, o.loss, o.next))
        : outcomes.every((o) => dfs(idx + 1, o.own, o.loss, o.next));

    memo.set(key, result);
    return result;
  };

  return dfs(0, 0, 0, base);
};

export const magicForGold = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  cutoff: number,
  settings: Settings
): MagicResult => {
  const me = teams.find((t) => t.id === teamId);
  if (!me) return { type: "impossible", ownWinsNeeded: 0, opponentLossesNeeded: 0, description: "Unknown team." };

  const effectiveSettings = { ...settings, goldCutoff: cutoff };
  const myRemaining = remainingGamesFor(teamId, remaining).length;

  if (solveCutoff(teamId, teams, remaining, effectiveSettings, 0, 0, "all")) {
    return {
      type: "clinched",
      ownWinsNeeded: 0,
      opponentLossesNeeded: 0,
      description: "Already clinched.",
    };
  }

  for (let winsNeeded = 0; winsNeeded <= myRemaining; winsNeeded += 1) {
    for (let lossesNeeded = 0; lossesNeeded <= myRemaining; lossesNeeded += 1) {
      if (solveCutoff(teamId, teams, remaining, effectiveSettings, winsNeeded, lossesNeeded, "all")) {
        return {
          type: "magic",
          ownWinsNeeded: winsNeeded,
          opponentLossesNeeded: lossesNeeded,
          description:
            lossesNeeded === 0
              ? `${winsNeeded} more win${winsNeeded === 1 ? "" : "s"} clinches a top-${cutoff} spot.`
              : `${winsNeeded} win${winsNeeded === 1 ? "" : "s"} + ${lossesNeeded} additional own-opponent loss${lossesNeeded === 1 ? "" : "es"} clinches a top-${cutoff} spot.`,
        };
      }
    }
  }

  return {
    type: "impossible",
    ownWinsNeeded: 0,
    opponentLossesNeeded: 0,
    description: `Cannot mathematically clinch a top-${cutoff} spot.`,
  };
};

export const eliminationNumberForGold = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  cutoff: number,
  settings: Settings
): MagicResult => {
  const me = teams.find((t) => t.id === teamId);
  if (!me) {
    return {
      type: "impossible",
      ownWinsNeeded: 0,
      opponentLossesNeeded: 0,
      description: "Unknown team.",
    };
  }

  const effectiveSettings = { ...settings, goldCutoff: cutoff };
  const myRemaining = remainingGamesFor(teamId, remaining).length;

  for (let losses = 0; losses <= myRemaining; losses += 1) {
    const stillCan = solveCutoff(teamId, teams, remaining, effectiveSettings, 0, losses, "any");
    if (!stillCan) {
      return {
        type: "elimination",
        ownWinsNeeded: 0,
        opponentLossesNeeded: losses,
        description:
          losses === 0
            ? `Already eliminated from top-${cutoff}.`
            : `${losses} more loss${losses === 1 ? "" : "es"} would eliminate the team from top-${cutoff}.`,
      };
    }
  }

  return {
    type: "magic",
    ownWinsNeeded: 0,
    opponentLossesNeeded: 0,
    description: `Cannot be eliminated from top-${cutoff} this season.`,
  };
};
