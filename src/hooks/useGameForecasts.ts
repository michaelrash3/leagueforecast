import { startTransition, useEffect, useMemo, useState } from "react";
import type { BracketProjection } from "../lib/bracket";
import { byStart, parseDateValue } from "../lib/date";
import { displayName } from "../lib/format";
import { predictGame } from "../lib/sim";
import { projectedRunLine } from "../lib/teamLink";
import type { ActiveShareView, GameLog, Matchup, Settings, Team, TeamBase } from "../lib/types";
import { isFinal } from "../lib/util";
import type { useGoldRace } from "./useGoldRace";

export type ScoreboardPrediction = {
  spread: string;
  pickName: string;
  pickPct: number;
  scenarioBadges: string[];
  impactScore: number;
};

// The Schedule's picks are worked out this many games at a time, each chunk in a task of its own.
// A full season's import can leave hundreds of games open, and calling every one of them at once
// can block the browser just after the import, or while a final is being saved.
const SCOREBOARD_PREDICTION_CHUNK_SIZE = 24;

/**
 * Every game still to play called by the model: the Forecast's list of them, the regular season's
 * in date order and then, once the seeding is locked, the Gold and Silver brackets'; and the
 * Schedule's pick, run line and odds for each open game, worked out a chunk at a time after the
 * tab opens so a full season's schedule never holds up the first frame. The Schedule's own order
 * of its games, with its team filter, is here too.
 *
 * App.tsx worked these out under "Game forecasts". They moved here whole, with the state the
 * Schedule's picks are kept in, which nothing else writes, and are called where they were, so the
 * effect that fills the picks keeps its place among App's.
 */
export type GameForecastsInputs = {
  activeView: ActiveShareView;
  bracketProjection: BracketProjection;
  bracketSeedingLocked: boolean;
  getGameScenarioImpactMap: ReturnType<typeof useGoldRace>["getGameScenarioImpactMap"];
  liveById: Map<string, Team>;
  liveTeams: Team[];
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  remainingGames: Matchup[];
  scoreboardTeamFilter: string;
  seasonStart: number;
  settings: Settings;
  silverBracketProjection: BracketProjection;
  teamBaseById: Map<string, TeamBase>;
};

export function useGameForecasts({
  activeView,
  bracketProjection,
  bracketSeedingLocked,
  getGameScenarioImpactMap,
  liveById,
  liveTeams,
  logs,
  matchups,
  remainingGames,
  scoreboardTeamFilter,
  seasonStart,
  settings,
  silverBracketProjection,
  teamBaseById,
}: GameForecastsInputs) {
  // The Schedule's pick for each open game, filled in a chunk at a time by the effect below.
  const [scoreboardPredictions, setScoreboardPredictions] = useState<
    Map<string, ScoreboardPrediction>
  >(() => new Map());

  const gameForecasts = useMemo(() => {
    if (activeView !== "model") return [];

    const regularSeasonForecasts = [...remainingGames].map((game) => {
      const prediction = predictGame(game, liveTeams, settings, liveById);
      const winner = teamBaseById.get(prediction.winnerId);
      const away = teamBaseById.get(game.away);
      const home = teamBaseById.get(game.home);
      const winnerPct =
        prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
      const impact = getGameScenarioImpactMap.get(game.id);
      return {
        game,
        prediction,
        awayName: displayName(away?.name || game.away),
        homeName: displayName(home?.name || game.home),
        winnerName: displayName(winner?.name || prediction.winnerId),
        winnerPct,
        impact,
        sourceLabel: "Regular Season",
        sortValue: parseDateValue(game.date, seasonStart),
      };
    });

    const bracketForecasts = bracketSeedingLocked
      ? [
          ...bracketProjection.rounds.flatMap((round) =>
            round.map((game) => ({ game, bracketLabel: "Gold Bracket" }))
          ),
          ...silverBracketProjection.rounds.flatMap((round) =>
            round.map((game) => ({ game, bracketLabel: "Silver Bracket" }))
          ),
        ]
          .filter(({ game }) => game.matchup && game.prediction && !isFinal(game.log))
          .map(({ game, bracketLabel }) => {
            const matchup = game.matchup!;
            const prediction = game.prediction!;
            const winner = teamBaseById.get(prediction.winnerId);
            const away = teamBaseById.get(matchup.away);
            const home = teamBaseById.get(matchup.home);
            const winnerPct =
              prediction.winnerId === matchup.away
                ? prediction.awayWinPct
                : 1 - prediction.awayWinPct;
            return {
              game: matchup,
              prediction,
              awayName: displayName(away?.name || matchup.away),
              homeName: displayName(home?.name || matchup.home),
              winnerName: displayName(winner?.name || prediction.winnerId),
              winnerPct,
              impact: undefined,
              sourceLabel: `${bracketLabel} · ${game.roundName}`,
              sortValue: Number.POSITIVE_INFINITY,
            };
          })
      : [];

    return [...regularSeasonForecasts, ...bracketForecasts].sort(
      (a, b) => a.sortValue - b.sortValue || a.game.id.localeCompare(b.game.id)
    );
  }, [
    activeView,
    remainingGames,
    seasonStart,
    liveTeams,
    settings,
    liveById,
    teamBaseById,
    getGameScenarioImpactMap,
    bracketSeedingLocked,
    bracketProjection,
    silverBracketProjection,
  ]);

  const scoreboardGames = useMemo(() => {
    const dateCompare = (a: Matchup, b: Matchup) => {
      const aFinal = isFinal(logs[a.id]);
      const bFinal = isFinal(logs[b.id]);
      const aNoDate = !(a.date ?? "").trim();
      const bNoDate = !(b.date ?? "").trim();
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      if (!aFinal && aNoDate !== bNoDate) return aNoDate ? -1 : 1;
      return (
        parseDateValue(a.date, seasonStart) - parseDateValue(b.date, seasonStart) ||
        byStart(a, b) ||
        a.id.localeCompare(b.id)
      );
    };
    const filtered =
      scoreboardTeamFilter === "ALL"
        ? matchups
        : matchups.filter(
            (game) => game.away === scoreboardTeamFilter || game.home === scoreboardTeamFilter
          );
    return [...filtered].sort(dateCompare);
  }, [matchups, logs, scoreboardTeamFilter, seasonStart]);

  useEffect(() => {
    // Clearing first is the point: predictions are filled in incrementally over many chunks, and
    // without the wipe a stale entry would sit in the map until its game happened to be
    // recomputed. Deriving it instead would mean carrying a key through every chunk write, which
    // is more moving parts than the one render this costs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScoreboardPredictions(new Map());
    if (activeView !== "games" || !remainingGames.length) return;

    let cancelled = false;
    let timer: ReturnType<typeof window.setTimeout> | null = null;
    let index = 0;
    const games = [...remainingGames];

    const queueNextChunk = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const entries: [string, ScoreboardPrediction][] = [];
        const chunkEnd = Math.min(index + SCOREBOARD_PREDICTION_CHUNK_SIZE, games.length);

        // A `while`, not a `for (; …)`: the React Compiler the hooks lint runs on gives up on a
        // loop with no initialiser, and then checks nothing else in the function. In App.tsx this
        // loop kept every one of those rules off the whole component.
        while (index < chunkEnd) {
          const game = games[index];
          index += 1;
          if (!game) continue;
          const prediction = predictGame(game, liveTeams, settings, liveById);
          const winner = teamBaseById.get(prediction.winnerId);
          const winnerPct =
            prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
          entries.push([
            game.id,
            {
              spread: projectedRunLine(prediction, liveById),
              pickName: displayName(winner?.name || prediction.winnerId),
              pickPct: winnerPct,
              // Keep Schedule score entry lightweight. Exact clinch/elimination badges are
              // still computed in the Model view, but doing them for every open game on
              // each score keystroke makes the scoring workflow feel frozen.
              scenarioBadges: [],
              impactScore: 0,
            },
          ]);
        }

        if (entries.length) {
          startTransition(() => {
            setScoreboardPredictions((prev) => {
              if (cancelled) return prev;
              const next = new Map(prev);
              entries.forEach(([gameId, prediction]) => next.set(gameId, prediction));
              return next;
            });
          });
        }

        if (index < games.length) queueNextChunk();
      }, 0);
    };

    queueNextChunk();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeView, remainingGames, liveTeams, settings, liveById, teamBaseById]);

  return { gameForecasts, scoreboardGames, scoreboardPredictions };
}
