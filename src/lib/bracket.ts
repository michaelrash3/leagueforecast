import {
  bracketNextPowerOfTwo as nextPowerOfTwo,
  bracketSeedOrder as seedOrder,
  predictGame,
} from "./sim";
import type { GameLog, Matchup, Prediction, Settings, Team } from "./types";
import { isFinal, parseNumber } from "./util";

export type BracketEntrant = Team & { bracketSeed: number };

export type BracketSlot = {
  seed: number;
  team: BracketEntrant | null;
  sourceGameId?: string;
};

export type BracketGameProjection = {
  id: string;
  roundIndex: number;
  gameIndex: number;
  roundName: string;
  top: BracketSlot;
  bottom: BracketSlot;
  log: GameLog;
  matchup: Matchup | null;
  prediction: Prediction | null;
  actualWinnerId: string | null;
  predictedWinnerId: string | null;
  winnerId: string | null;
  winnerSource: "actual" | "projected" | "bye" | "pending";
};

export type BracketProjection = {
  size: number;
  entrantCount: number;
  rounds: BracketGameProjection[][];
  champion: BracketEntrant | null;
  championSource: BracketGameProjection["winnerSource"] | "none";
};

const roundName = (roundIndex: number, totalRounds: number) => {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return "Championship";
  if (remaining === 2) return "Semifinals";
  if (remaining === 3) return "Quarterfinals";
  return `Round ${roundIndex + 1}`;
};

const getTeamWinPct = (prediction: Prediction, matchup: Matchup, teamId: string) => {
  if (teamId === matchup.away) return prediction.awayWinPct;
  if (teamId === matchup.home) return 1 - prediction.awayWinPct;
  return 0;
};

/*
 * The team a game still to play sends on: the one the model gives the better chance, and the top
 * slot where the two are level, which in a first round is the better seed.
 *
 * Until 15 November 2026 this sent the underdog on in some close games on purpose: where the
 * favourite was the better seed with no more than a 66% chance, a roll hashed from the game and its
 * two teams decided it. The card then read "Model pick" over a team the same card gave 48%, and on
 * the demo season the Projected Champion was the team fourth in the title odds printed beneath it
 * (17%, against the favourite's 30%). Measured on that season cut at each of its 19 counts of
 * finals and seeded at every cutoff, Gold and Silver: 159 of 817 games still to play went to the
 * underdog, in 123 of 266 brackets. How likely an upset is belongs to the title odds, which play
 * the bracket out thousands of times (`sim.ts`); a single drawn bracket says who is favoured.
 */
const pickBracketWinner = (
  top: BracketSlot,
  bottom: BracketSlot,
  matchup: Matchup,
  prediction: Prediction
) => {
  const topTeam = top.team;
  const bottomTeam = bottom.team;
  if (!topTeam || !bottomTeam) return prediction.winnerId;
  return getTeamWinPct(prediction, matchup, topTeam.id) >=
    getTeamWinPct(prediction, matchup, bottomTeam.id)
    ? topTeam.id
    : bottomTeam.id;
};

const winnerFromFinalScore = (log: GameLog, topTeamId: string, bottomTeamId: string) => {
  if (!isFinal(log)) return null;
  const topRuns = parseNumber(log.homeRuns, NaN);
  const bottomRuns = parseNumber(log.awayRuns, NaN);
  if (!Number.isFinite(topRuns) || !Number.isFinite(bottomRuns) || topRuns === bottomRuns)
    return null;
  return topRuns > bottomRuns ? topTeamId : bottomTeamId;
};

const bySeed = (teams: Team[], startIndex: number, count: number): BracketEntrant[] =>
  teams
    .slice(Math.max(0, startIndex), Math.max(0, startIndex) + Math.max(0, count))
    .map((team, index) => ({ ...team, bracketSeed: index + 1 }));

export const buildBracketProjection = ({
  teams,
  cutoff,
  logs,
  settings,
  startIndex = 0,
  idPrefix = "bracket",
}: {
  teams: Team[];
  cutoff: number;
  logs: Record<string, GameLog>;
  settings: Settings;
  startIndex?: number;
  idPrefix?: string;
}): BracketProjection => {
  const entrants = bySeed(teams, startIndex, cutoff);
  const entrantCount = entrants.length;
  if (entrantCount < 2) {
    return {
      size: entrantCount,
      entrantCount,
      rounds: [],
      champion: entrants[0] ?? null,
      championSource: entrants[0] ? "bye" : "none",
    };
  }

  const size = nextPowerOfTwo(entrantCount);
  const totalRounds = Math.log2(size);
  const seeds = seedOrder(size);
  const slots = seeds.map<BracketSlot>((seed) => ({
    seed,
    team: entrants[seed - 1] ?? null,
  }));
  const rounds: BracketGameProjection[][] = [];
  let currentSlots = slots;

  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex += 1) {
    const round: BracketGameProjection[] = [];
    const nextSlots: BracketSlot[] = [];

    for (let gameIndex = 0; gameIndex < currentSlots.length; gameIndex += 2) {
      const top = currentSlots[gameIndex] ?? { seed: 0, team: null };
      const bottom = currentSlots[gameIndex + 1] ?? { seed: 0, team: null };
      const id = `${idPrefix}-r${roundIndex + 1}-g${gameIndex / 2 + 1}`;
      const log = logs[id] ?? {
        innings: "6",
        awayRuns: "",
        awayHits: "",
        awayK: "",
        homeRuns: "",
        homeHits: "",
        homeK: "",
        isFinal: false,
      };

      const matchup =
        top.team && bottom.team ? { id, date: "", away: bottom.team.id, home: top.team.id } : null;
      const prediction = matchup ? predictGame(matchup, entrants, settings) : null;
      const actualWinnerId =
        top.team && bottom.team ? winnerFromFinalScore(log, top.team.id, bottom.team.id) : null;
      const byeWinnerId =
        top.team && !bottom.team ? top.team.id : bottom.team && !top.team ? bottom.team.id : null;
      const predictedWinnerId =
        matchup && prediction ? pickBracketWinner(top, bottom, matchup, prediction) : null;
      const winnerId = actualWinnerId ?? byeWinnerId ?? predictedWinnerId;
      const winnerSource: BracketGameProjection["winnerSource"] = actualWinnerId
        ? "actual"
        : byeWinnerId
          ? "bye"
          : predictedWinnerId
            ? "projected"
            : "pending";
      const winnerTeam = entrants.find((team) => team.id === winnerId) ?? null;

      round.push({
        id,
        roundIndex,
        gameIndex: gameIndex / 2,
        roundName: roundName(roundIndex, totalRounds),
        top,
        bottom,
        log,
        matchup,
        prediction,
        actualWinnerId,
        predictedWinnerId,
        winnerId,
        winnerSource,
      });
      nextSlots.push({
        seed:
          winnerTeam?.bracketSeed ??
          Math.min(top.seed || Number.POSITIVE_INFINITY, bottom.seed || Number.POSITIVE_INFINITY),
        team: winnerTeam,
        sourceGameId: id,
      });
    }

    rounds.push(round);
    currentSlots = nextSlots;
  }

  const finalGame = rounds[rounds.length - 1]?.[0];
  return {
    size,
    entrantCount,
    rounds,
    champion: entrants.find((team) => team.id === finalGame?.winnerId) ?? null,
    championSource: finalGame?.winnerSource ?? "none",
  };
};
