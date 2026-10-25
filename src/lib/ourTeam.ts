import { recordText } from "./format";
import type { RootFor } from "./goldSwing";
import type { NeededResult } from "./magic";
import type { SwingGame, TeamWithProjection } from "./types";

/** What the Dashboard's "Our team" card says about the team this browser follows. */
export type OurTeamSummary = {
  teamId: string;
  name: string;
  /** Its place in the standings as they stand, and how many teams are in them. */
  place: number;
  of: number;
  record: string;
  /** Gold %, in a league with a cut line, and how far the last result moved it. */
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
 * The needed results as the card says them: the team's own games as what it must do, anyone
 * else's as what it needs to happen. "Not lose" where a tie is enough, "beat" where it is not.
 */
export const needsLines = (
  teamId: string,
  needed: readonly NeededResult[],
  nameOf: (id: string) => string
): string[] =>
  needed.map((need) => {
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
  const swing = options.swings[0];
  return {
    teamId: team.id,
    name: team.name,
    place: team.rank ?? teamCount,
    of: teamCount,
    record: recordText(team),
    ...(options.hasCutLine ? { goldPct: team.goldPct } : {}),
    ...(options.hasCutLine && last !== undefined && before !== undefined
      ? { goldChange: last - before }
      : {}),
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
