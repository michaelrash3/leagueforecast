import type { GameLog, Matchup, Settings, Team, TeamBase } from "./types";
import { clamp, isFinal, parseNumber } from "./util";
import { normalizeDateInput, parseDateValue, seasonStartMonth } from "./date";
import { dateInSquadYear } from "./teamRankings/seasons";
import { forecastRange, type ForecastRange } from "./forecastRange";
import {
  DEFAULT_SHRINKAGE,
  buildOpponentAdjustedRatings,
  byRating,
  bySchedule,
} from "./powerRating";

export type DataQualityTier = "Insufficient" | "Limited" | "Developing" | "Strong" | "Excellent";
export type ConfidenceTier = "Low" | "Moderate" | "Strong" | "High";

export type PowerRating = {
  teamId: string;
  teamName: string;
  rank: number;
  /** NET-style power rating in run units: opponent-adjusted expected margin vs an average team. */
  rating: number;
  record: string;
  games: number;
  /** Own capped net runs per game, before opponent adjustment. */
  rawMargin: number;
  /** Run-denominated strength of schedule: the average rating of opponents faced. */
  strengthOfSchedule: number;
  /** Schedule-toughness rank among all teams (1 = toughest schedule faced). */
  sosRank: number;
  recentForm: number;
  volatility: number;
  trend: "Up" | "Down" | "Stable" | "New";
};

/**
 * What one side brings to a matchup's forecast, for telling why it came out as it did (2.8,
 * `forecastExplanation.ts`).
 */
export type MatchupEvidence = {
  /** The opponent-adjusted rating, in runs against an average team. */
  rating: number;
  /** Its average margin in the games the rating was fitted from, each counted up to the cap. */
  rawMargin: number;
  /** The average rating of the opponents it faced. */
  strengthOfSchedule: number;
  /** Its recent margin, the last five games weighted toward the newest. */
  recentForm: number;
  /** League games final. */
  leagueGames: number;
  /** Games the rating was fitted from: the league's and any Team Rankings results. */
  fittedGames: number;
  /** League runs scored and allowed a game, or null before a league game is final. */
  runsFor: number | null;
  runsAgainst: number | null;
  /** The day of its newest dated result, league or Team Rankings, or null with none. */
  lastPlayed: string | null;
  /** Days from that result to this game, or null where either is undated. */
  daysOff: number | null;
};

/**
 * A matchup's projected margin, from team A's side (the away team), as the sum of its parts in
 * runs, which add up to it exactly:
 *
 * - `results`: the two sides' own margins, each shrunk toward average by the games it has played,
 *   as the rating's fit does (`n / (n + DEFAULT_SHRINKAGE)` of the average margin);
 * - `schedule`: the rest of the gap between the two ratings, which is the fit's allowance for the
 *   opponents each side faced (with unit weights and neutral games, exactly the opponents' share);
 * - `headToHead`: the small nudge for their own meetings;
 * - `homeField`: the fitted home edge taken off, nothing while every game is played as neutral;
 * - `capped`: what the cap on a projected margin took off, nothing below it.
 */
export type MarginParts = {
  results: number;
  schedule: number;
  headToHead: number;
  homeField: number;
  capped: number;
};

export type LeaguePrediction = {
  gameId: string;
  teamAId: string;
  teamBId: string;
  predictedWinnerId: string | null;
  projectedMargin: number | null;
  winProbability: { teamA: number; teamB: number };
  expectedScore?: { teamA: number; teamB: number };
  /**
   * The margins and scores eight games in ten like this one end within (2.10, `forecastRange.ts`):
   * how much a single game varies around the forecast, apart from the win chance and confidence.
   */
  range?: ForecastRange;
  confidence: { score: number; tier: ConfidenceTier; reasons: string[] };
  dataQuality: { tier: DataQualityTier; warnings: string[]; recommendedActions: string[] };
  keyFactors: string[];
  riskFactors: string[];
  /**
   * The forecast as data rather than words (2.8): the margin's parts and what each side brings.
   * Absent while the model has too little to forecast with.
   */
  explanation?: {
    parts: MarginParts;
    teamA: MatchupEvidence;
    teamB: MatchupEvidence;
    /** The projected margin before rounding, from team A's side: the sum of `parts`. */
    margin: number;
    /** Whether the win chance was held at its floor or ceiling (8% and 92%). */
    probabilityCapped: boolean;
    /** The most one game's margin counts in the ratings (`FORECAST_RUN_CAP`). */
    gameCap: number;
  };
};

export type PredictionEngineResult = {
  powerRatings: PowerRating[];
  predictions: LeaguePrediction[];
  dataQuality: LeaguePrediction["dataQuality"];
  // Realized forecast accuracy is measured by the walk-forward backtest (see lib/backtest.ts),
  // which replays each finalized game; the engine only reports how many games it has to learn from.
  accuracy: {
    gamesEvaluated: number;
  };
  /**
   * The opponent-adjusted fit itself, so the forecast can use the same numbers the Power Ratings
   * table shows rather than fitting its own. `attachAdjustedRatings` puts these onto the teams
   * that `predictGame` reads.
   */
  ratings: {
    byTeam: Map<string, number>;
    games: Map<string, number>;
  };
};

type CompletedGame = Matchup & { awayScore: number; homeScore: number; margin: number };

const scoreFor = (log: GameLog | undefined, side: "away" | "home") =>
  parseNumber(side === "away" ? (log?.awayRuns ?? "") : (log?.homeRuns ?? ""), Number.NaN);

const completedGamesFrom = (matchups: Matchup[], logs: Record<string, GameLog>) =>
  matchups.flatMap((game): CompletedGame[] => {
    const log = logs[game.id];
    const awayScore = scoreFor(log, "away");
    const homeScore = scoreFor(log, "home");
    if (!isFinal(log) || !Number.isFinite(awayScore) || !Number.isFinite(homeScore)) return [];
    return [{ ...game, awayScore, homeScore, margin: awayScore - homeScore }];
  });

const tierForData = (
  teams: TeamBase[],
  completedGames: CompletedGame[],
  futureGames: Matchup[],
  externalCount = 0
) => {
  const teamGameCounts = new Map(teams.map((team) => [team.id, 0]));
  completedGames.forEach((game) => {
    teamGameCounts.set(game.away, (teamGameCounts.get(game.away) ?? 0) + 1);
    teamGameCounts.set(game.home, (teamGameCounts.get(game.home) ?? 0) + 1);
  });
  const teamsWithNoGames = [...teamGameCounts.values()].filter((games) => games === 0).length;
  const minGames = Math.min(...[...teamGameCounts.values(), 0]);
  const warnings: string[] = [];
  const recommendedActions: string[] = [];
  if (teams.length < 2) {
    warnings.push("Add at least two teams before the model can compare matchups.");
    recommendedActions.push("Add teams or import a schedule.");
  }
  if (completedGames.length === 0) {
    warnings.push(
      "No completed scores are available, so forecasts are only league-average placeholders."
    );
    recommendedActions.push("Enter completed game scores.");
  }
  if (teamsWithNoGames) {
    warnings.push(
      `${teamsWithNoGames} team${teamsWithNoGames === 1 ? " has" : "s have"} no completed results.`
    );
    recommendedActions.push("Add scores for teams with no completed games.");
  }
  if (futureGames.length === 0)
    recommendedActions.push("Add future scheduled games to generate upcoming predictions.");

  const tier: DataQualityTier =
    // Results from outside the league count toward there being *something* to go on. A league
    // whose season has not started, but whose teams played a preseason tournament, can be
    // forecast — that thin-schedule case is the one external results help most, and gating it on
    // a league final would have made them useless exactly when they mattered. The higher tiers
    // still want league games, since only those carry the full box score.
    teams.length < 2 || completedGames.length + externalCount === 0
      ? "Insufficient"
      : completedGames.length >= teams.length * 4 && minGames >= 4
        ? "Excellent"
        : completedGames.length >= teams.length * 3 && minGames >= 3
          ? "Strong"
          : completedGames.length >= teams.length && minGames >= 1
            ? "Developing"
            : "Limited";
  return { tier, warnings, recommendedActions };
};

/**
 * When a game was played, as a number, for putting a league's own games and its Team Rankings
 * results in one order.
 *
 * League Standings writes "M/D" and Team Rankings an ISO day. With no year, both are read in one
 * calendar year (`parseDateValue`), which is all a league on its own has. That put a spring
 * league's autumn tournaments after its May games: recent form weighed September as the newest,
 * and every point on the Gold-odds trend but the last left the autumn out. Given the squad year the
 * season is linked to, a league date is placed in it (`dateInSquadYear`, August onward in the year
 * before) and an ISO day is read as the day it is, so the two compare as the days they were.
 * Undated is +Infinity, as `parseDateValue` has it.
 */
export const playedOn = (
  date: string | undefined,
  squadYear?: number,
  /** Where no squad year is known, the month the season's year turns in (`seasonStartMonth`). */
  startMonth = 1
): number => {
  if (squadYear === undefined) return parseDateValue(date ?? "", startMonth);
  const trimmed = (date ?? "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? trimmed
    : dateInSquadYear(normalizeDateInput(trimmed), squadYear);
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

/**
 * Oldest first by the day played, for walking a team's games in order.
 *
 * Not by the text: league dates are "M/D" and Team Rankings' are ISO, so as strings "9/12" came
 * before "9/5", every October day before every September one, and every tournament game before
 * every league game. Recent form then weighed games that were not the last ones played, and from a
 * team's first October game the Trend column read its September. An undated game stays first,
 * where it always sorted, since it cannot be placed and read as the newest it would set the trend.
 */
const byDayIn =
  (squadYear: number | undefined, startMonth: number) =>
  (a: { date: string }, b: { date: string }): number => {
    const dayOf = (date: string) => {
      const value = playedOn(date, squadYear, startMonth);
      return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
    };
    return dayOf(a.date) - dayOf(b.date) || 0;
  };

const confidenceTier = (score: number): ConfidenceTier =>
  score >= 82 ? "High" : score >= 66 ? "Strong" : score >= 46 ? "Moderate" : "Low";

/**
 * A result from outside the league schedule — a tournament game logged in Team Rankings.
 * `home`/`away` are rating ids: a league team's own id where the name matches one, otherwise a
 * synthetic id for an opponent the league never plays.
 */
export type ExternalResult = {
  home: string;
  away: string;
  homeMargin: number;
  /**
   * When it was played, in the same format as a league game's date. Optional: a caller with no
   * date still gets the rating, which does not care about order — only recent form does, and an
   * undated result is left out of it rather than guessed into a position.
   */
  date?: string;
  /** These are tournament games with no home side; see `RatingGame.neutral`. */
  neutral?: boolean;
};

/**
 * How far one game's margin counts in the forecast's rating, whatever the league's rule caps its
 * standings at.
 *
 * The league's cap is a rule about standings — a run-differential tiebreaker that stops a team
 * being rewarded for running up a score — and the standings keep it. A forecast is a different
 * question, how good each team is, and the user ruled on 28 September 2026 that it need not be
 * bound by the rule. So it was measured. Every state's pulled clubs on a 2027 page of the pool of
 * 26 September (20 or more clubs) were made a pseudo-league: its games among themselves up to 13,
 * 19 or 20 September were the season so far, the pool's other games touching those clubs were the
 * Team Rankings results a linked league is handed, and the 54,265 league games after each cut were
 * scored, through the app's own `buildPredictionEngine`, `attachAdjustedRatings` and
 * `predictGame`. The cap was tried at 8, 12, 20 and none, and the rating weight in the per-game
 * model (`RATING_EDGE_PER_RUN`) with it.
 *
 * Twenty and none were one answer to four places, and both beat 8 and 12 with the weight refitted:
 * the per-game log loss that drives Gold % fell from 0.6431 (8, 0.25, as the app had it) to 0.6230
 * with the Team Rankings results and from 0.6484 to 0.6303 without them, and the favourite called
 * at about 75% won 90% of the time at 8 and 76% at 20. Twenty rather than none, so one mistyped
 * 91-1 in a league's own entry does not count as a ninety-run win.
 */
export const FORECAST_RUN_CAP = 20;

/**
 * The spread of the Dashboard's matchup odds (`predictionFor`): the projected margin that moves a
 * matchup from even to about 73%.
 *
 * It was 2.8 runs, fitted to ratings capped at the league's 8. Ratings capped at
 * `FORECAST_RUN_CAP` stretch further, and on the same pseudo-leagues the spread that fitted best
 * was 4.70 with Team Rankings results and 4.75 without, the log loss falling from 0.6254 to 0.6188
 * and from 0.6330 to 0.6265 against 2.8 on ratings capped at 8. The 9U to 18U pages each fitted
 * between 3.80 and 5.45 with no trend in age, so one number serves them. The 8U pages, which are
 * machine and coach pitch, fitted 3.95 (5,123 games in 78 pseudo-leagues of ten clubs or more): a
 * margin says more about who wins where the pitching is the same for everybody.
 */
export const MATCHUP_ODDS_SPREAD = 4.7;
export const MATCHUP_ODDS_SPREAD_MACHINE_PITCH = 3.95;

export const buildPredictionEngine = (
  teams: Team[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings?: Pick<Settings, "maxRunDifferential" | "pitchMode" | "autoRunDiffCap">,
  externalResults: ExternalResult[] = [],
  /**
   * The squad year the season is linked to in Team Rankings, which places the league's "M/D" dates
   * among the outside results' ISO days (`playedOn`). Without one, both are read in one calendar
   * year, as a league with nothing linked has always been.
   */
  squadYear?: number
): PredictionEngineResult => {
  // Read over the outside results' days too: an October tournament before a November-to-January
  // league is the start of its year, not the newest thing in it.
  const start = seasonStartMonth([
    ...matchups.map((game) => game.date),
    ...externalResults.map((result) => result.date),
  ]);
  const byDay = byDayIn(squadYear, start);
  const byId = new Map(teams.map((team) => [team.id, team]));
  const completedGames = completedGamesFrom(matchups, logs);
  const futureGames = matchups.filter((game) => !isFinal(logs[game.id]));
  const dataQuality = tierForData(teams, completedGames, futureGames, externalResults.length);
  const leagueAvgScoring = completedGames.length
    ? completedGames.reduce((sum, game) => sum + game.awayScore + game.homeScore, 0) /
      (completedGames.length * 2)
    : 0;

  // NET-in-spirit power ratings: opponent-adjusted run margin, each game counted up to
  // `FORECAST_RUN_CAP` rather than the league's standings cap, with small-sample shrinkage.
  const runDiffCap = FORECAST_RUN_CAP;
  const oddsSpread =
    settings?.pitchMode === "machine" || settings?.pitchMode === "coach"
      ? MATCHUP_ODDS_SPREAD_MACHINE_PITCH
      : MATCHUP_ODDS_SPREAD;
  // Results from outside the league sharpen the ratings, and are worth the most exactly where the
  // league schedule is weakest: two teams that have not played each other, but have both played
  // the same tournament opponent, become comparable through it. Those outside opponents are given
  // ids of their own so the regression can estimate their strength rather than assuming it.
  //
  // What stays league-only is the *record*: W-L, runs for and against describe a team's season in
  // this league, and a tournament in March is not part of that. Everything that is a claim about
  // how good a team is — the rating, its strength of schedule, recent form, and how much the model
  // reckons it knows — counts them, because a game is a game.
  const ratingIds = new Set(teams.map((team) => team.id));
  externalResults.forEach((game) => {
    ratingIds.add(game.home);
    ratingIds.add(game.away);
  });
  const adjusted = buildOpponentAdjustedRatings(
    [...ratingIds],
    [
      // Which side is recorded as home is settled by a coin flip in very nearly every game at this
      // level, so it is not a venue assignment: no travel, no crowd, no familiar park. Fitting a
      // home-field coefficient from it fits noise, which every prediction then subtracts from its
      // margin.
      //
      // Batting last is the one thing being home does buy, and it is real — a final chance to come
      // back. But it is a win-probability effect in close games, not a run-margin one, so it does
      // not belong in this term either. It is simply not modelled.
      ...completedGames.map((game) => ({
        home: game.home,
        away: game.away,
        homeMargin: game.homeScore - game.awayScore,
        neutral: true,
      })),
      ...externalResults,
    ],
    { cap: runDiffCap }
  );

  /**
   * Tournament results in the same shape the league's own games are read in, for the parts below
   * that walk a season in date order.
   *
   * Only the ones that name a date and touch a league team: an undated result cannot be placed
   * among the league's games, and a game between two outside clubs says nothing about form here
   * (it still counts in the fit above, where order does not matter and a third party is exactly
   * how two league teams become comparable).
   */
  const leagueIds = new Set(teams.map((team) => team.id));
  const externalByDate = externalResults
    .filter((game) => game.date && (leagueIds.has(game.home) || leagueIds.has(game.away)))
    .map((game) => ({
      date: game.date!,
      away: game.away,
      home: game.home,
      margin: -game.homeMargin,
    }))
    .sort(byDay);

  /** A team's finished games, league and tournament together, oldest first. */
  const gamesFor = (teamId: string) =>
    [
      ...completedGames
        .filter((game) => game.away === teamId || game.home === teamId)
        .map((game) => ({
          date: game.date,
          margin: game.away === teamId ? game.margin : -game.margin,
        })),
      ...externalByDate
        .filter((game) => game.away === teamId || game.home === teamId)
        .map((game) => ({
          date: game.date,
          margin: game.away === teamId ? game.margin : -game.margin,
        })),
    ].sort(byDay);

  // Each team's newest dated result, read once here for every forecast's explanation (2.8).
  const newestById = new Map<string, { date: string; day: number }>();
  const powerRatings = teams
    .map((team): PowerRating => {
      // Form is form: a tournament last weekend is how this team is playing now, and leaving it
      // out was how a team could go 0-4 in June and still read "Stable" here.
      const played = gamesFor(team.id);
      // Oldest first with the undated before the rest, so the newest dated is the last one dated.
      for (let at = played.length - 1; at >= 0; at -= 1) {
        const date = played[at]?.date ?? "";
        const day = playedOn(date, squadYear, start);
        if (Number.isFinite(day)) {
          newestById.set(team.id, { date, day });
          break;
        }
      }
      const recentGames = played.slice(-5);
      /*
       * A weighted mean divides by the weights, not by how many there are.
       *
       * The weights ramp from 1/n to 1 and sum to (n+1)/2, so dividing by n shrank the answer —
       * to 60% of itself over five games, 67% over three. `trend` then compared that shrunken
       * number against `avgMargin`, which is a plain mean at full scale, and the two are not on
       * the same scale at all: a team winning every game by exactly six read 3.6 against an
       * average of 6 and came out "Down", while a team losing every game by six read -3.6 against
       * -6 and came out "Up". The column said good teams were sliding and bad ones were climbing,
       * about teams that had not changed at all.
       */
      const weight = (index: number) => (index + 1) / recentGames.length;
      const weightedRecent = recentGames.reduce(
        (sum, game, index) => sum + game.margin * weight(index),
        0
      );
      const weightTotal = recentGames.reduce((sum, _game, index) => sum + weight(index), 0);
      const recentForm = weightTotal > 0 ? weightedRecent / weightTotal : 0;
      const margins = played.map((game) => game.margin);
      const avgMargin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
      const volatility = margins.length
        ? Math.sqrt(
            margins.reduce((sum, margin) => sum + (margin - avgMargin) ** 2, 0) / margins.length
          )
        : 0;
      const rating = adjusted.ratings.get(team.id) ?? 0;
      const rawMargin = adjusted.rawMargin.get(team.id) ?? 0;
      return {
        teamId: team.id,
        teamName: team.name,
        rank: 0,
        rating,
        record: `${team.w}-${team.l}${team.t ? `-${team.t}` : ""}`,
        games: team.games,
        rawMargin,
        strengthOfSchedule: adjusted.strengthOfSchedule.get(team.id) ?? 0,
        sosRank: 0,
        recentForm,
        volatility,
        trend:
          played.length === 0
            ? "New"
            : recentForm > avgMargin + 1
              ? "Up"
              : recentForm < avgMargin - 1
                ? "Down"
                : "Stable",
      };
    })
    .sort(byRating)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  // Schedule-toughness rank: 1 = faced the strongest opponents (highest average opponent rating).
  const teamsPlayed = powerRatings.filter((row) => row.games > 0);
  const sosOrder = [...teamsPlayed].sort(bySchedule);
  const sosRankById = new Map(sosOrder.map((row, index) => [row.teamId, index + 1]));
  powerRatings.forEach((row) => {
    row.sosRank = sosRankById.get(row.teamId) ?? 0;
  });
  const powerById = new Map(powerRatings.map((rating) => [rating.teamId, rating]));

  const predictionFor = (game: Matchup): LeaguePrediction => {
    const a = byId.get(game.away);
    const b = byId.get(game.home);
    const ar = powerById.get(game.away);
    const br = powerById.get(game.home);
    if (!a || !b || !ar || !br || dataQuality.tier === "Insufficient") {
      return {
        gameId: game.id,
        teamAId: game.away,
        teamBId: game.home,
        predictedWinnerId: null,
        projectedMargin: null,
        winProbability: { teamA: 0.5, teamB: 0.5 },
        confidence: {
          score: 12,
          tier: "Low",
          reasons: ["The model needs completed scores before it can forecast this matchup."],
        },
        dataQuality,
        keyFactors: ["Insufficient completed game data."],
        riskFactors: dataQuality.warnings,
      };
    }
    const headToHead = a.headToHead?.[b.id];
    // Ratings are opponent-adjusted expected margins (runs), so their difference IS the projected
    // margin; the home team gets the estimated home-field bump, plus a small head-to-head nudge.
    const h2hEdge = headToHead ? clamp((headToHead.wins - headToHead.losses) * 0.4, -1.5, 1.5) : 0;
    const unclamped = ar.rating - br.rating - adjusted.homeAdvantage + h2hEdge;
    const margin = clamp(unclamped, -14, 14);
    const rawProbA = 1 / (1 + Math.exp(-margin / oddsSpread));
    const probA = clamp(rawProbA, 0.08, 0.92);
    const projectedWinnerId = margin >= 0 ? a.id : b.id;
    // Games the rating was fitted from, not league games alone. The margin above is a difference
    // of two ratings, so what the confidence in it turns on is how well *those* are pinned down —
    // and a team with one league game and eight tournament results is not a one-game unknown.
    const knownA = Math.max(a.games, adjusted.games.get(a.id) ?? 0);
    const knownB = Math.max(b.games, adjusted.games.get(b.id) ?? 0);
    const knownGames = Math.min(knownA, knownB);
    const samplePenalty = Math.max(0, 3 - knownGames) * 13;
    const volatilityPenalty = clamp((ar.volatility + br.volatility) * 1.1, 0, 20);
    const qualityBonus = {
      Insufficient: -35,
      Limited: -18,
      Developing: 0,
      Strong: 9,
      Excellent: 14,
    }[dataQuality.tier];
    const confidenceScore = clamp(
      42 + Math.abs(margin) * 4.0 + qualityBonus - samplePenalty - volatilityPenalty,
      5,
      94
    );
    const confidence = {
      score: Math.round(confidenceScore),
      tier: confidenceTier(confidenceScore),
      reasons: [] as string[],
    };
    if (knownGames < 3)
      confidence.reasons.push(
        "Confidence is reduced because at least one team has fewer than three completed games."
      );
    if (Math.abs(margin) < 3)
      confidence.reasons.push("Projected margin is tight, so winner certainty remains limited.");
    if (ar.volatility + br.volatility > 12)
      confidence.reasons.push("Recent results are volatile, which lowers model confidence.");
    const favorite = projectedWinnerId === a.id ? a : b;
    const favRating = projectedWinnerId === a.id ? ar : br;
    const underRating = projectedWinnerId === a.id ? br : ar;
    const keyFactors = [
      `${favorite.name} holds the stronger opponent-adjusted rating (${favRating.rating >= 0 ? "+" : ""}${favRating.rating.toFixed(1)} vs ${underRating.rating >= 0 ? "+" : ""}${underRating.rating.toFixed(1)} runs).`,
    ];
    if (favRating.strengthOfSchedule - underRating.strengthOfSchedule >= 0.5)
      keyFactors.push(`${favorite.name} has also faced the tougher schedule.`);
    // Only when the favourite is the one in form: the difference used to be taken either way, so
    // an underdog on a winning run was read as support for the side it was catching.
    if (favRating.recentForm - underRating.recentForm >= 1)
      keyFactors.push("Recent form supports the projected winner.");
    if (headToHead && headToHead.wins + headToHead.losses + headToHead.ties > 0)
      keyFactors.push(
        "Head-to-head results are included but capped so one game does not dominate."
      );
    const riskFactors = [...dataQuality.warnings];
    if (knownGames < 3) riskFactors.push("Small sample size can make ratings unstable.");
    if (Math.abs(margin) < 3) riskFactors.push("Similar team ratings create a close-game risk.");
    // The rating gap told as its parts (`MarginParts`): each side's own results as the fit shrinks
    // them, and the rest of its rating, the allowance for the opponents it faced.
    const resultsOf = (id: string) => {
      const games = adjusted.games.get(id) ?? 0;
      return games ? (games * (adjusted.rawMargin.get(id) ?? 0)) / (games + DEFAULT_SHRINKAGE) : 0;
    };
    const results = resultsOf(a.id) - resultsOf(b.id);
    const gameDay = playedOn(game.date, squadYear, start);
    const evidence = (team: Team, rating: PowerRating): MatchupEvidence => {
      const newest = newestById.get(team.id);
      return {
        rating: rating.rating,
        rawMargin: rating.rawMargin,
        strengthOfSchedule: rating.strengthOfSchedule,
        recentForm: rating.recentForm,
        leagueGames: team.games,
        fittedGames: adjusted.games.get(team.id) ?? 0,
        runsFor: team.games ? team.rs / team.games : null,
        runsAgainst: team.games ? team.ra / team.games : null,
        lastPlayed: newest?.date ?? null,
        daysOff:
          newest && Number.isFinite(gameDay)
            ? Math.round((gameDay - newest.day) / 86_400_000)
            : null,
      };
    };
    const expectedScore = leagueAvgScoring
      ? {
          teamA: Math.max(0, Number((leagueAvgScoring + margin / 2).toFixed(1))),
          teamB: Math.max(0, Number((leagueAvgScoring - margin / 2).toFixed(1))),
        }
      : undefined;
    return {
      gameId: game.id,
      teamAId: a.id,
      teamBId: b.id,
      predictedWinnerId: projectedWinnerId,
      projectedMargin: Math.abs(Number(margin.toFixed(1))),
      winProbability: { teamA: Number(probA.toFixed(2)), teamB: Number((1 - probA).toFixed(2)) },
      expectedScore,
      range: forecastRange({
        margin: Number(margin.toFixed(1)),
        ...(expectedScore ? { expectedScore } : {}),
        machinePitch: oddsSpread === MATCHUP_ODDS_SPREAD_MACHINE_PITCH,
      }),
      confidence,
      dataQuality,
      keyFactors,
      riskFactors,
      explanation: {
        parts: {
          results,
          schedule: ar.rating - br.rating - results,
          headToHead: h2hEdge,
          homeField: -adjusted.homeAdvantage,
          capped: margin - unclamped,
        },
        teamA: evidence(a, ar),
        teamB: evidence(b, br),
        margin,
        probabilityCapped: probA !== rawProbA,
        gameCap: runDiffCap,
      },
    };
  };

  return {
    powerRatings,
    predictions: futureGames.map(predictionFor),
    dataQuality,
    accuracy: {
      gamesEvaluated: completedGames.length,
    },
    ratings: { byTeam: adjusted.ratings, games: adjusted.games },
  };
};
