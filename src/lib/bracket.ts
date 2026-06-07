import { hashSeed, predictGame } from "./sim";
import type { GameLog, Matchup, Prediction, Settings, Team } from "./types";
import { clamp, isFinal, parseNumber } from "./util";

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

const nextPowerOfTwo = (value: number) => {
  let size = 1;
  while (size < value) size *= 2;
  return size;
};

const seedOrder = (size: number): number[] => {
  if (size <= 1) return [1];
  const previous = seedOrder(size / 2);
  return previous.flatMap((seed) => [seed, size + 1 - seed]);
};

const roundName = (roundIndex: number, totalRounds: number) => {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return "Championship";
  if (remaining === 2) return "Semifinals";
  if (remaining === 3) return "Quarterfinals";
  return `Round ${roundIndex + 1}`;
};

const bracketPickRoll = (gameId: string, topTeamId: string, bottomTeamId: string) =>
  (hashSeed(`${gameId}:${topTeamId}:${bottomTeamId}:bracket-volatility`) % 10_000) / 10_000;

const getTeamWinPct = (prediction: Prediction, matchup: Matchup, teamId: string) => {
  if (teamId === matchup.away) return prediction.awayWinPct;
  if (teamId === matchup.home) return 1 - prediction.awayWinPct;
  return 0;
};

const pickBracketWinner = (
  id: string,
  roundIndex: number,
  top: BracketSlot,
  bottom: BracketSlot,
  matchup: Matchup,
  prediction: Prediction
) => {
  const topTeam = top.team;
  const bottomTeam = bottom.team;
  if (!topTeam || !bottomTeam) return prediction.winnerId;

  const topWinPct = getTeamWinPct(prediction, matchup, topTeam.id);
  const bottomWinPct = getTeamWinPct(prediction, matchup, bottomTeam.id);
  const favorite = topWinPct >= bottomWinPct ? topTeam : bottomTeam;
  const underdog = favorite.id === topTeam.id ? bottomTeam : topTeam;
  const favoritePct = Math.max(topWinPct, bottomWinPct);
  const underdogPct = Math.min(topWinPct, bottomWinPct);

  // The single-game bracket predictor should not be a chalk-only advancement tool.
  // In close matchups where the model favorite is the better seed, apply a small,
  // deterministic upset lane so a plausible lower-seed run can appear without
  // making the bracket reshuffle randomly on each render.
  const favoriteIsHigherSeed = favorite.bracketSeed < underdog.bracketSeed;
  if (!favoriteIsHigherSeed || favoritePct > 0.66) return favorite.id;

  const seedGap = Math.max(0, underdog.bracketSeed - favorite.bracketSeed);
  const closeness = clamp((0.66 - favoritePct) / 0.16, 0, 1);
  const seedGapBoost = clamp(seedGap / 8, 0, 0.25);
  const roundDecay = Math.max(0.65, 1 - roundIndex * 0.12);
  const upsetChance = clamp(underdogPct * (0.6 + seedGapBoost) * closeness * roundDecay, 0, 0.28);
  const roll = bracketPickRoll(id, topTeam.id, bottomTeam.id);

  return roll < upsetChance ? underdog.id : favorite.id;
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
        matchup && prediction
          ? pickBracketWinner(id, roundIndex, top, bottom, matchup, prediction)
          : null;
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
