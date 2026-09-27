import { standingsPoints } from "./sim";
import type { Matchup, Settings, Team } from "./types";

export type MagicResult = {
  type: "magic" | "elimination" | "clinched" | "impossible";
  ownWinsNeeded: number;
  opponentLossesNeeded: number;
  description: string;
  /**
   * The answer comes down to a tie on points that only the tiebreakers settle: the wins that
   * guarantee at least a share of the last spot, or the losses after which only a won tiebreak
   * keeps the team in. Not a clinch and not an elimination.
   */
  tiebreak?: boolean;
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
 * Where a team finishes on points, with every team level with it counted ahead or none of them.
 *
 * The solver works on points alone, and a tie on points is settled in the table by fewer losses
 * and then the league's tiebreakers, which depend on results nobody has yet. It used to settle
 * the tie by the teams' ids, which are the first letters of their names, so a team level on
 * points at the cut line was told it had clinched or been eliminated by how its name sorted: in
 * this league "513 FORCE - BOULEY" won every tie. Simulated over double round robins with the
 * pool's own 3.3% tie rate, 11-20% of finished seasons had a line that contradicted the table.
 *
 * So each claim asks the side of the tie that makes it safe. "Clinches" counts every level team
 * ahead (`tiesAhead`), and "eliminated" counts none of them; where only the other side holds, the
 * answer is that the tiebreakers decide (`MagicResult.tiebreak`).
 */
const rankOfTeam = (teamId: string, points: PointsMap, teams: Team[], tiesAhead: boolean) => {
  const my = points[teamId] ?? 0;
  let above = 0;
  for (const t of teams) {
    if (t.id === teamId) continue;
    const p = points[t.id] ?? 0;
    if (p > my || (p === my && tiesAhead)) above += 1;
  }
  return above + 1;
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
  mode: OutcomeMode,
  tiesAhead: boolean
) => {
  const base = buildPointsMap(teams, settings);
  const myRemaining = remainingGamesFor(teamId, remaining).length;
  /*
   * The wins and the losses come out of the same games, so it is their total that has to fit.
   *
   * Checked against the count each on its own, an unsatisfiable pair got through — one win and
   * three losses out of three games — and every branch then fell outside the scenario. Vacuously
   * true under `all`, which is to say the team was told a scenario it cannot reach would clinch
   * for it. Asking for a win in a season with nothing left to play is the same mistake, and this
   * covers that too, since both terms are counts of games.
   */
  if (requiredOwnWins + extraForcedLosses > myRemaining) return false;

  const ids = sortedTeamIds(teams);
  const memo = new Map<string, boolean>();
  const finalRank =
    remaining.length === 0 ? teams.find((team) => team.id === teamId)?.rank : undefined;

  const dfs = (idx: number, ownWins: number, forcedLosses: number, points: PointsMap): boolean => {
    if (idx === remaining.length) {
      /*
       * This branch is outside the scenario being asserted, so it is not evidence either way.
       *
       * Which way "not evidence" falls depends on what is being asked. "all" asks whether the
       * team is in the cutoff in *every* branch where it wins at least `requiredOwnWins` and
       * loses at least `extraForcedLosses` — so a branch that does not meet those minimums is
       * vacuously fine and must not count against it. "any" asks whether there is *some* such
       * branch, and a branch outside the scenario is not one.
       *
       * Returning false either way is what made a magic number unreachable. `every` over the
       * branches meant the claim "N more wins clinches" was refused by the branch where the team
       * wins none — which is every schedule with a game left in it — so `magicForGold` fell
       * through to "Cannot mathematically clinch a Gold Bracket spot." for every team that had
       * not already clinched, including the ones a single win would settle it for.
       */
      if (ownWins < requiredOwnWins || forcedLosses < extraForcedLosses) return mode === "all";
      // A season with nothing left is the table's to answer, tiebreakers and all.
      if (finalRank !== undefined) return finalRank <= settings.goldCutoff;
      return rankOfTeam(teamId, points, teams, tiesAhead) <= settings.goldCutoff;
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

/** The fewest wins, and losses on top, that put the team in whatever else happens. */
const findMagic = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  settings: Settings,
  tiesAhead: boolean
): "clinched" | { wins: number; losses: number } | null => {
  if (solveCutoff(teamId, teams, remaining, settings, 0, 0, "all", tiesAhead)) return "clinched";
  const myRemaining = remainingGamesFor(teamId, remaining).length;
  for (let wins = 0; wins <= myRemaining; wins += 1) {
    for (let losses = 0; losses <= myRemaining; losses += 1) {
      if (solveCutoff(teamId, teams, remaining, settings, wins, losses, "all", tiesAhead)) {
        return { wins, losses };
      }
    }
  }
  return null;
};

/** The fewest more losses after which no result puts the team in. */
const findElimination = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  settings: Settings,
  tiesAhead: boolean
): number | null => {
  const myRemaining = remainingGamesFor(teamId, remaining).length;
  for (let losses = 0; losses <= myRemaining; losses += 1) {
    if (!solveCutoff(teamId, teams, remaining, settings, 0, losses, "any", tiesAhead)) {
      return losses;
    }
  }
  return null;
};

const winsWord = (wins: number) => `${wins} more win${wins === 1 ? "" : "s"}`;

export const magicForGold = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  cutoff: number,
  settings: Settings
): MagicResult => {
  const me = teams.find((t) => t.id === teamId);
  if (!me)
    return {
      type: "impossible",
      ownWinsNeeded: 0,
      opponentLossesNeeded: 0,
      description: "Unknown team.",
    };

  const effectiveSettings = { ...settings, goldCutoff: cutoff };

  // A clinch is a claim about every tie going against the team: nothing else makes it one.
  const sure = findMagic(teamId, teams, remaining, effectiveSettings, true);
  if (sure === "clinched") {
    return {
      type: "clinched",
      ownWinsNeeded: 0,
      opponentLossesNeeded: 0,
      description: "Already clinched.",
    };
  }
  if (sure) {
    return {
      type: "magic",
      ownWinsNeeded: sure.wins,
      opponentLossesNeeded: sure.losses,
      description:
        sure.losses === 0
          ? `${winsWord(sure.wins)} clinches a Gold Bracket spot.`
          : `${sure.wins} win${sure.wins === 1 ? "" : "s"}, even with ${sure.losses} more loss${sure.losses === 1 ? "" : "es"}, still clinches a Gold Bracket spot.`,
    };
  }

  // Short of that, what the team can guarantee is a share of the last spot, and no more.
  const share = findMagic(teamId, teams, remaining, effectiveSettings, false);
  if (share === "clinched") {
    return {
      type: "magic",
      ownWinsNeeded: 0,
      opponentLossesNeeded: 0,
      tiebreak: true,
      description: "Level for the last Gold Bracket spot at worst; the tiebreakers decide.",
    };
  }
  if (share) {
    return {
      type: "magic",
      ownWinsNeeded: share.wins,
      opponentLossesNeeded: share.losses,
      tiebreak: true,
      description: `${winsWord(share.wins)} guarantee${share.wins === 1 ? "s" : ""} at least a share of the last Gold Bracket spot; the tiebreakers decide.`,
    };
  }

  return {
    type: "impossible",
    ownWinsNeeded: 0,
    opponentLossesNeeded: 0,
    description: `Cannot mathematically clinch a Gold Bracket spot.`,
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

  // Eliminated is a claim about every tie going the team's way, and still falling short.
  const out = findElimination(teamId, teams, remaining, effectiveSettings, false);
  if (out !== null) {
    return {
      type: "elimination",
      ownWinsNeeded: 0,
      opponentLossesNeeded: out,
      description:
        out === 0
          ? `Already eliminated from the Gold Bracket.`
          : `${out} more loss${out === 1 ? "" : "es"} would eliminate the team from the Gold Bracket.`,
    };
  }

  // Short of that, the losses after which only a tie won on the tiebreakers keeps the team in.
  const onTheBreak = findElimination(teamId, teams, remaining, effectiveSettings, true);
  if (onTheBreak !== null) {
    return {
      type: "elimination",
      ownWinsNeeded: 0,
      opponentLossesNeeded: onTheBreak,
      tiebreak: true,
      description:
        onTheBreak === 0
          ? "Only a won tiebreak can still put the team in the Gold Bracket."
          : `After ${onTheBreak} more loss${onTheBreak === 1 ? "" : "es"}, only a won tiebreak keeps the team in the Gold Bracket.`,
    };
  }

  return {
    type: "magic",
    ownWinsNeeded: 0,
    opponentLossesNeeded: 0,
    description: `Cannot be eliminated from the Gold Bracket this season.`,
  };
};
