import { recordText } from "./format";
import type { RootFor } from "./goldSwing";
import type { NeededResult } from "./magic";
import { OWED_OPPONENT } from "./sim";
import type { SwingGame, TeamWithProjection } from "./types";

/** What the Dashboard's "Our team" card says about the team this browser follows. */
export type OurTeamSummary = {
  teamId: string;
  name: string;
  /** Its place in the standings as they stand, and how many teams are in them. */
  place: number;
  of: number;
  record: string;
  /**
   * Gold %, in a league with a cut line, and how far the last result moved it, where it moved it
   * `GOLD_MOVE_SHOWN` points or more.
   */
  goldPct?: number;
  goldChange?: number;
  /** Its next game: who, when, the chance of winning it, and where a win or a loss leaves it. */
  next?: {
    opponentName: string;
    date: string;
    teamIsAway: boolean;
    winPct: number;
    winSeed: number;
    lossSeed: number;
    /** Its Gold chance with a win and with a loss, as the odds' own seasons have it (`ownGameSwing`). */
    goldIfWin?: number;
    goldIfLoss?: number;
  };
  /** The magic number's sentence, where one has been worked out. */
  magic?: string;
  /** The results it cannot reach the cut without, late in the season (`neededResults`). */
  needs?: string[];
  /** Who to root for in the games it is not in that matter most to it (`rootFor`). */
  rootFor?: string[];
};

/**
 * A need in the games a team owes beyond the schedule (`NeededResult.owed`), which have no opponent
 * or day to name, so the team that owes them is named whichever side of them is needed: the team's
 * own to win, or another team's to lose or to win. The team losing one never helps it, and another
 * team winning one only lifts that team on the points and losses the search reads; but the season's
 * last game is ranked with every tiebreaker (`lastGameNeeds`), and there that win can be the result
 * needed: clear of a three-way tie, the team that owes the game leaves a two-way one that the
 * followed team takes on head-to-head.
 */
const owedNeed = (teamId: string, need: NeededResult, nameOf: (id: string) => string): string => {
  const one = need.owed === 1;
  const games = one ? "game" : `${need.owed} games`;
  if (need.side === teamId)
    return need.orTie
      ? `Don't lose ${one ? "the game" : `any of the ${games}`} not yet on the schedule`
      : `Win the ${games} not yet on the schedule`;
  if (need.against === OWED_OPPONENT) {
    const owing = nameOf(need.side);
    return need.orTie
      ? `${owing} not to lose ${one ? "their game" : `any of their ${games}`} not yet on the schedule`
      : `${owing} to win their ${games} not yet on the schedule`;
  }
  const rival = nameOf(need.against);
  return need.orTie
    ? `${rival} not to win ${one ? "their game" : `any of their ${games}`} not yet on the schedule`
    : `${rival} to lose their ${games} not yet on the schedule`;
};

/**
 * The needed results as the card says them: the team's own games as what it must do, anyone
 * else's as what it needs to happen. "Not lose" where a tie is enough, "beat" where it is not.
 */
export const needsLines = (
  teamId: string,
  needed: readonly NeededResult[],
  nameOf: (id: string) => string
): string[] =>
  needed.map((need) => {
    if (need.owed) return owedNeed(teamId, need, nameOf);
    const when = need.date ? ` (${need.date})` : "";
    const against = nameOf(need.against);
    if (need.side === teamId)
      return need.orTie ? `Don't lose to ${against}${when}` : `Beat ${against}${when}`;
    const side = nameOf(need.side);
    return need.orTie
      ? `${side} not to lose to ${against}${when}`
      : `${side} to beat ${against}${when}`;
  });

/**
 * The least move in Gold % the card reports. The last step of the trend is drawn paired
 * (`buildTrendStates`), and still came 0.48 to 0.66 points from a long run's on synthetic leagues,
 * so a smaller move is as likely the simulation's as the result's. It was shown from a twentieth of
 * a point: of the 209 moves that showed on 40 eight-team leagues, the 3 the wrong way were all
 * under two points.
 */
export const GOLD_MOVE_SHOWN = 2;

/**
 * The line a family reads at the field, for the one team they follow.
 *
 * Everything in it is already worked out for the team's drawer — the place, the Gold odds and the
 * trend behind them, the next game's odds and what it does to the seed, the magic number — and it
 * is gathered here so the Dashboard can lead with it instead of with the whole league. The change
 * in Gold % is the last step of the trend line, which is one game: what the result just entered did.
 */
export const ourTeamSummary = (
  team: TeamWithProjection | undefined,
  teamCount: number,
  options: {
    hasCutLine: boolean;
    swings: readonly SwingGame[];
    magic?: string;
    needs?: string[];
    /** The next game's Gold chance with a win and with a loss. */
    nextGold?: { ifWin: number; ifLoss: number };
    rootFor?: string[];
  }
): OurTeamSummary | null => {
  if (!team) return null;
  const trend = team.goldTrend;
  const last = trend[trend.length - 1];
  const before = trend[trend.length - 2];
  const moved = last !== undefined && before !== undefined ? last - before : 0;
  const swing = options.swings[0];
  return {
    teamId: team.id,
    name: team.name,
    place: team.rank ?? teamCount,
    of: teamCount,
    record: recordText(team),
    ...(options.hasCutLine ? { goldPct: team.goldPct } : {}),
    ...(options.hasCutLine && Math.abs(moved) >= GOLD_MOVE_SHOWN ? { goldChange: moved } : {}),
    ...(swing
      ? {
          next: {
            opponentName: swing.opponentName,
            date: swing.game.date,
            teamIsAway: swing.teamIsAway,
            winPct: swing.winPct,
            winSeed: swing.winSeed,
            lossSeed: swing.lossSeed,
            ...(options.hasCutLine && options.nextGold
              ? { goldIfWin: options.nextGold.ifWin, goldIfLoss: options.nextGold.ifLoss }
              : {}),
          },
        }
      : {}),
    ...(options.hasCutLine && options.magic ? { magic: options.magic } : {}),
    ...(options.hasCutLine && options.needs?.length ? { needs: options.needs } : {}),
    ...(options.hasCutLine && options.rootFor?.length ? { rootFor: options.rootFor } : {}),
  };
};

/** The root-for games as the card says them: who over whom, and what each result does. */
export const rootForLines = (picks: readonly RootFor[], nameOf: (id: string) => string): string[] =>
  picks.map(
    (pick) =>
      `${nameOf(pick.winnerId)} over ${nameOf(pick.loserId)}${pick.date ? ` (${pick.date})` : ""}: Gold ${Math.round(pick.ifWin * 100)}% against ${Math.round(pick.ifLoss * 100)}%`
  );
