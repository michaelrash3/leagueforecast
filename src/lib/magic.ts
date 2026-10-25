import { rankOptionsFromSettings, rankTeams, standingsPoints, withScore } from "./sim";
import { RUN_SCORE_CAP, type Matchup, type Settings, type Team } from "./types";

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
const rankOfTeam = (
  teamId: string,
  points: PointsMap,
  losses: PointsMap | null,
  teams: Team[],
  tiesAhead: boolean
) => {
  const my = points[teamId] ?? 0;
  const myLosses = losses?.[teamId] ?? 0;
  let above = 0;
  for (const t of teams) {
    if (t.id === teamId) continue;
    const p = points[t.id] ?? 0;
    if (p > my) above += 1;
    else if (p === my) {
      // The table's next step after points (`rankTeams`): fewer losses goes ahead, before any
      // tiebreaker. Only a tie on both, or losses not known, is the tiebreakers' to settle.
      const l = losses?.[t.id] ?? 0;
      if (losses && l !== myLosses) {
        if (l < myLosses) above += 1;
      } else if (tiesAhead) above += 1;
    }
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
  /*
   * Each team's losses at the end of a branch, where they can be known from its points alone: with
   * ties worth nothing, the points a team gains are its wins, every game left is played by the end,
   * and so its losses are its losses so far plus its games left less those wins. Carrying losses
   * through the search instead multiplied the states it remembers, and made the exact answer ten
   * times slower on a full table; read off the points, they cost nothing. Where a tie scores,
   * points cannot tell a win from two ties, so losses go unread and a level finish on points is
   * left to the tiebreakers, as before.
   */
  const gamesLeft: PointsMap = {};
  remaining.forEach((game) => {
    gamesLeft[game.away] = (gamesLeft[game.away] ?? 0) + 1;
    gamesLeft[game.home] = (gamesLeft[game.home] ?? 0) + 1;
  });
  const lossesAtEnd = (points: PointsMap): PointsMap | null => {
    if (settings.tiePoints > 0 || settings.winPoints <= 0) return null;
    const out: PointsMap = {};
    teams.forEach((team) => {
      const wins = ((points[team.id] ?? 0) - (base[team.id] ?? 0)) / settings.winPoints;
      out[team.id] = team.l + (gamesLeft[team.id] ?? 0) - wins;
    });
    return out;
  };
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
      return (
        rankOfTeam(teamId, points, lossesAtEnd(points), teams, tiesAhead) <= settings.goldCutoff
      );
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

  /*
   * No number of its own losses settles it. That is not the same as being safe: the search above
   * asks only whether the team's own losses can shut it out, and a team that loses every game left
   * can still be passed by others' wins. Safe is in at the cut in every branch where it loses out,
   * with every tie counted against it; anything short of that is out of its own hands.
   */
  const myRemaining = remainingGamesFor(teamId, remaining).length;
  const safe = solveCutoff(
    teamId,
    teams,
    remaining,
    effectiveSettings,
    0,
    myRemaining,
    "all",
    true
  );
  return {
    type: "magic",
    ownWinsNeeded: 0,
    opponentLossesNeeded: 0,
    description: safe
      ? `Cannot be eliminated from the Gold Bracket this season.`
      : "Its own losses cannot eliminate it, but other results still can.",
  };
};

/**
 * A result the followed team cannot reach the cut without (`neededResults`): `side` must not lose
 * to `against`. A tie is enough where `orTie`; otherwise `side` has to win.
 */
export type NeededResult = {
  gameId: string;
  date: string;
  side: string;
  against: string;
  orTie: boolean;
};

/**
 * The league after one game has gone a given way: only the records move. Asked only with games
 * still to come after it, where the search reads points and losses and never the table's ranks.
 */
const after = (teams: Team[], game: Matchup, winnerId: string | null): Team[] =>
  teams.map((team) => {
    if (team.id !== game.away && team.id !== game.home) return team;
    if (winnerId === null) return { ...team, t: team.t + 1 };
    return team.id === winnerId ? { ...team, w: team.w + 1 } : { ...team, l: team.l + 1 };
  });

/**
 * Whether the team can finish inside the cut once the season's last game goes a given way, and
 * whether it is sure to: the game booked at every score that result allows, up to the most runs a
 * side is ever credited (`RUN_SCORE_CAP`), and the table ranked as the standings rank it.
 *
 * With the last game decided the table is complete but for that game's score, and the score is
 * what the tiebreakers after head-to-head read: run differential as capped, runs allowed, runs
 * scored. Ranking the table with them as they stood before the game told a team it needed a result
 * it could reach the cut without; leaving every level finish to go its way dropped needs a
 * head-to-head record the game cannot change makes real. Trying the scores answers both, and costs
 * little: about 14 ms for one team on a fourteen-team table (measured in Node, ties worth half),
 * against the 245 ms the search takes at worst with ten games left.
 */
const lastGameChances = (
  teamId: string,
  teams: Team[],
  game: Matchup,
  winnerId: string | null,
  cutoff: number,
  settings: Settings
): { possible: boolean; sure: boolean } => {
  const options = rankOptionsFromSettings(settings);
  /*
   * `withScore` books the one game as the simulator does, which is exact for points, losses and
   * the tiebreakers up to run differential and head-to-head, but not for the rating the standings
   * fall back on last: `calculateTeams` recomputes strength of schedule and the contact bonus
   * across the whole league once a real result is in, and booking the one game here does not. So a
   * place that comes down to that rating, or to the id after it, is not to be trusted. The team's
   * `tpi` is set to the far end of the range to read the place both ways: with it ahead on any
   * such tie, for whether the team *can* get in, and behind, for whether it is in *whatever
   * happens*. Where the place is settled before the rating — which is almost always — the two
   * agree and this is the plain ranking. Resolving the fallback in the team's favour for "can"
   * keeps a result from being called needed on a rating that would be recomputed; resolving it
   * against the team for "sure" keeps one from being called safe on the same.
   */
  const placeWith = (booked: Team[], tpi: number): number =>
    rankTeams(
      booked.map((team) => (team.id === teamId ? { ...team, tpi } : team)),
      options
    ).findIndex((team) => team.id === teamId) + 1;
  let possible = false;
  let sure = true;
  for (let high = 0; high <= RUN_SCORE_CAP; high += 1) {
    const lows = winnerId === null ? [high] : Array.from({ length: high }, (_, low) => low);
    for (const low of lows) {
      const [awayRuns, homeRuns] = winnerId === game.home ? [low, high] : [high, low];
      const booked = withScore(teams, game, awayRuns, homeRuns, settings);
      if (placeWith(booked, Number.POSITIVE_INFINITY) <= cutoff) possible = true;
      if (placeWith(booked, Number.NEGATIVE_INFINITY) > cutoff) sure = false;
      if (possible && !sure) return { possible, sure };
    }
  }
  return { possible, sure };
};

/**
 * `neededResults` with one game left, read off every way it can end (`lastGameChances`). Whether
 * the team can get in at all, and whether it is in whatever happens, come from the same answers as
 * each result's, so a side is never needed to win alongside the side it plays.
 */
const lastGameNeeds = (
  teamId: string,
  teams: Team[],
  game: Matchup,
  cutoff: number,
  settings: Settings
): NeededResult[] | null => {
  const ways = [game.away, game.home, ...(settings.tiePoints > 0 ? [null] : [])].map(
    (winnerId) => ({
      winnerId,
      ...lastGameChances(teamId, teams, game, winnerId, cutoff, settings),
    })
  );
  if (!ways.some((way) => way.possible) || ways.every((way) => way.sure)) return null;
  const possible = (winnerId: string | null) =>
    ways.some((way) => way.winnerId === winnerId && way.possible);
  const orTie = settings.tiePoints > 0 && possible(null);
  return [
    [game.away, game.home],
    [game.home, game.away],
  ].flatMap(([side, against]) =>
    !side || !against || possible(against)
      ? []
      : [{ gameId: game.id, date: game.date, side, against, orTie }]
  );
};

/**
 * The results the team cannot finish inside the cut without, in its own games or in anyone's:
 * those where, with the game going the other way (or tied, where a tie scores), no way the rest
 * can go puts it in, even with every level finish going its way. Null where there is nothing to
 * need: in whatever happens, or out whatever happens.
 *
 * Exact, by the same search as the magic number, run once for each side of each game left; so it
 * is asked only as late in the season as the magic number is. With one game left there is no
 * level finish to leave to chance: every score it can end with is ranked (`lastGameNeeds`).
 */
export const neededResults = (
  teamId: string,
  teams: Team[],
  remaining: Matchup[],
  cutoff: number,
  settings: Settings
): NeededResult[] | null => {
  const effective = { ...settings, goldCutoff: cutoff };
  if (!teams.some((team) => team.id === teamId)) return null;
  const [last, ...more] = remaining;
  if (
    last &&
    more.length === 0 &&
    teams.some((team) => team.id === last.away) &&
    teams.some((team) => team.id === last.home)
  )
    return lastGameNeeds(teamId, teams, last, cutoff, settings);
  if (!solveCutoff(teamId, teams, remaining, effective, 0, 0, "any", false)) return null;
  if (solveCutoff(teamId, teams, remaining, effective, 0, 0, "all", true)) return null;
  const needed: NeededResult[] = [];
  remaining.forEach((game) => {
    const rest = remaining.filter((other) => other !== game);
    const stillIn = (winnerId: string | null) =>
      solveCutoff(teamId, after(teams, game, winnerId), rest, effective, 0, 0, "any", false);
    const tieEnough = settings.tiePoints > 0 && stillIn(null);
    [
      [game.away, game.home],
      [game.home, game.away],
    ].forEach(([side, against]) => {
      // Needed where the other side winning leaves no way in.
      if (!side || !against || stillIn(against)) return;
      needed.push({ gameId: game.id, date: game.date, side, against, orTie: tieEnough });
    });
  });
  return needed;
};
