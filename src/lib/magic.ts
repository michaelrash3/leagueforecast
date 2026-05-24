import { standingsPoints } from "./sim";
import type { Matchup, Settings, Team } from "./types";

export type MagicResult = {
  type: "magic" | "elimination" | "clinched" | "impossible";
  ownWinsNeeded: number;
  opponentLossesNeeded: number;
  description: string;
};

const remainingGamesFor = (teamId: string, remaining: Matchup[]) =>
  remaining.filter((g) => g.away === teamId || g.home === teamId);

/**
 * Magic number for finishing inside the top `cutoff`.
 *
 * For each candidate (own wins, opponent losses) combination we ask:
 * "If the team wins exactly W of its remaining games and the chasers
 *  collectively lose at least L of theirs, can fewer than `cutoff` teams
 *  still pass them?" We return the smallest W (then smallest L) that
 *  guarantees the answer is yes.
 */
export const magicForGold = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  cutoff: number,
  settings: Settings
): MagicResult => {
  const me = teams.find((t) => t.id === teamId);
  if (!me) return { type: "impossible", ownWinsNeeded: 0, opponentLossesNeeded: 0, description: "Unknown team." };

  const myRemaining = remainingGamesFor(teamId, remaining);
  const myCurrent = standingsPoints(me, settings);
  const winPts = settings.winPoints;

  // Chasers: teams currently outside the cut line (in points-rank sense)
  // that could still mathematically pass us.
  const myRank = teams
    .slice()
    .sort((a, b) => standingsPoints(b, settings) - standingsPoints(a, settings))
    .findIndex((t) => t.id === teamId) + 1;

  if (myRank <= cutoff) {
    // Can we clinch by zero more wins? Check if no other team can pass us
    // even with all remaining games.
    for (let w = 0; w <= myRemaining.length; w += 1) {
      const myMaxIfW = myCurrent + w * winPts;
      // Count teams that could still equal-or-exceed myMaxIfW.
      const threats = teams.filter((other) => {
        if (other.id === teamId) return false;
        const otherRemaining = remainingGamesFor(other.id, remaining).length;
        return standingsPoints(other, settings) + otherRemaining * winPts >= myMaxIfW;
      });
      // If fewer than (cutoff) threats exist (i.e. at most cutoff-1), team
      // is guaranteed a spot when reaching myMaxIfW.
      if (threats.length < cutoff) {
        if (w === 0) {
          return {
            type: "clinched",
            ownWinsNeeded: 0,
            opponentLossesNeeded: 0,
            description: "Already clinched.",
          };
        }
        return {
          type: "magic",
          ownWinsNeeded: w,
          opponentLossesNeeded: 0,
          description: `${w} more win${w === 1 ? "" : "s"} clinches a top-${cutoff} spot.`,
        };
      }
    }
  }

  // General case: combination search.
  for (let w = 0; w <= myRemaining.length; w += 1) {
    const myAt = myCurrent + w * winPts;
    // We need: at least (cutoff) teams (including us) to finish at or above myAt.
    // Equivalently: at most (totalTeams - cutoff) teams can finish strictly above us.
    // Compute, given each "chaser" loses L of its remaining, how many teams could still pass.
    // We pick smallest L such that no more than (cutoff-1) other teams can hit > myAt.
    const others = teams.filter((t) => t.id !== teamId);
    for (let l = 0; l <= remaining.length; l += 1) {
      // For each other team, after they lose `l` of their remaining games
      // distributed to them, what is their best-case points?
      // We approximate by allowing each other team to lose ceil(l / others.length) of theirs.
      // This is a fast lower bound; for the small leagues here it's accurate.
      const sharedLosses = Math.ceil(l / Math.max(others.length, 1));
      const threats = others.filter((other) => {
        const otherRemaining = remainingGamesFor(other.id, remaining).length;
        const otherWinsCapped = Math.max(0, otherRemaining - sharedLosses);
        const otherMax = standingsPoints(other, settings) + otherWinsCapped * winPts;
        return otherMax > myAt;
      });
      if (threats.length < cutoff) {
        if (w === 0 && l === 0) {
          return {
            type: "clinched",
            ownWinsNeeded: 0,
            opponentLossesNeeded: 0,
            description: "Already clinched.",
          };
        }
        return {
          type: "magic",
          ownWinsNeeded: w,
          opponentLossesNeeded: l,
          description:
            l === 0
              ? `${w} more win${w === 1 ? "" : "s"} clinches a top-${cutoff} spot.`
              : `${w} win${w === 1 ? "" : "s"} + ${l} chaser loss${l === 1 ? "" : "es"} clinches a top-${cutoff} spot.`,
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

/**
 * Elimination number: how many more losses (out of remaining games) before
 * the team is mathematically eliminated from the top `cutoff`.
 */
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

  const myRemaining = remainingGamesFor(teamId, remaining).length;
  const myCurrent = standingsPoints(me, settings);
  const winPts = settings.winPoints;
  const others = teams.filter((t) => t.id !== teamId);

  for (let l = 0; l <= myRemaining; l += 1) {
    const myMax = myCurrent + (myRemaining - l) * winPts;
    // Teams whose CURRENT points already exceed our max.
    const blockers = others.filter((other) => standingsPoints(other, settings) > myMax).length;
    if (blockers >= cutoff) {
      return {
        type: "elimination",
        ownWinsNeeded: 0,
        opponentLossesNeeded: l,
        description:
          l === 0
            ? `Already eliminated from top-${cutoff}.`
            : `${l} more loss${l === 1 ? "" : "es"} would eliminate the team from top-${cutoff}.`,
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
