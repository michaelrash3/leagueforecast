import { recordText } from "./format";
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
  };
  /** The magic number's sentence, where one has been worked out. */
  magic?: string;
};

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
  options: { hasCutLine: boolean; swings: readonly SwingGame[]; magic?: string }
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
          },
        }
      : {}),
    ...(options.hasCutLine && options.magic ? { magic: options.magic } : {}),
  };
};
