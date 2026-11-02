import { formatGameDate } from "./date";
import type { LeaguePrediction, MatchupEvidence } from "./predictionEngine";
import { GAME_CHANCE_CEILING, GAME_CHANCE_FLOOR } from "./sim";

/**
 * Why a Dashboard forecast came out as it did (2.8), read from the account the prediction engine
 * gives with each forecast (`LeaguePrediction.explanation`).
 *
 * The win chance shown is the per-game model's (`predictGame`), the one every League screen gives
 * a game; the engine's own, read off its margin, is shown nowhere (sweep item 29). What is told is
 * the engine's projected margin, the sum of its parts: each side's own results, the allowance for
 * the opponents each faced, their meetings, home field and the cap. Those are the factors in the
 * margin, each with the runs it gives one side, and they add up to it. Beside them is what the
 * margin does not count again or at all: recent form (already in the results), scoring and runs
 * allowed, the Team Rankings results behind the ratings, how many games each rating rests on, how
 * recent they are, and the per-game model the chance comes from. What could move the forecast is
 * said apart, a margin and a chance that part ways among it.
 *
 * The card's own margin, score, range and reading are the per-game model's too (`forecastGame`), so
 * the engine's margin is called the rating margin here: it is the gap between the two ratings, which
 * the per-game model counts beside the league's own games, with the head-to-head nudge and the cap,
 * and not the margin the card gives.
 */

export type Side = "teamA" | "teamB";

export type FactorKey =
  | "results"
  | "schedule"
  | "headToHead"
  | "homeField"
  | "capped"
  | "form"
  | "offense"
  | "defense"
  | "external"
  | "sample"
  | "freshness"
  | "gameModel";

export type Factor = {
  key: FactorKey;
  /** A short name for it. */
  label: string;
  /** The side it leans toward, or null for neither. */
  favors: Side | null;
  /**
   * The runs it gives the side it favors, for a part of the margin. The cap is the one part with
   * runs that favors neither side: they are what it takes off the leader's margin.
   */
  runs?: number;
  /** What it is, in a sentence. */
  text: string;
  /** Part of the margin the win chance is read from, or context beside it. */
  inMargin: boolean;
};

export type ForecastExplanation = {
  /** The side with the better chance as shown, or null for an even game. */
  favorite: Side | null;
  /** Each side's chance of winning, 0 to 1, as the card shows them. */
  chance: Record<Side, number>;
  /** The projected margin from team A's side, in runs: the sum of the margin's parts. */
  margin: number;
  /** The strongest factor for each side: a part of the margin where there is one. */
  strongest: Record<Side, Factor | null>;
  /** The margin's parts, the biggest first, then the context beside them. */
  factors: Factor[];
  /** What could move the forecast, in words. */
  sensitivities: string[];
  /** Whether the chance was held at the per-game model's floor or ceiling (4% and 96%). */
  probabilityCapped: boolean;
};

export type ExplainOptions = {
  nameOf: (id: string) => string;
  /**
   * Team A's chance of winning as the page shows it: the per-game model's (`predictGame`), which
   * the Schedule's pick, the Our team card and the Gold odds read too.
   */
  chanceA: number;
  /** League teams whose Team Rankings link is a guess among clubs of one name. */
  ambiguous?: ReadonlySet<string>;
};

/** Below this many runs a part leans neither way: a tenth of a run, rounded, reads as nothing. */
const EVEN_RUNS = 0.05;
/** Recent form, scoring and runs allowed lean a way only past these, in runs a game. */
const FORM_GAP = 1;
const SCORING_GAP = 0.5;
/** Fewer games than this behind a rating, and one more result can move it a long way. */
const THIN_GAMES = 3;
/** More days than this from a side's newest result to the game, and it may not show them now. */
const STALE_DAYS = 21;
/**
 * The margin and the chance disagree when they back different sides, or when the chance the
 * engine reads off the margin is this far from the one shown.
 */
const MODELS_APART = 0.15;

const MINUS = "−";
/** Runs with their sign, to a tenth: a value that rounds to nothing reads +0.0, never −0.0. */
const signed = (value: number) => {
  const tenths = Math.round(value * 10) / 10;
  return `${tenths < 0 ? MINUS : "+"}${Math.abs(tenths).toFixed(1)}`;
};
const runs = (value: number) =>
  `${value.toFixed(1)} ${value.toFixed(1) === "1.0" ? "run" : "runs"}`;
const games = (count: number) =>
  count === 0 ? "no games" : count === 1 ? "one game" : `${count} games`;
const lean = (value: number, gap: number): Side | null =>
  value >= gap ? "teamA" : value <= -gap ? "teamB" : null;

/** A part of the margin, from team A's side, as a factor. */
const part = (key: FactorKey, label: string, value: number, text: string): Factor => {
  const favors = lean(value, EVEN_RUNS);
  return { key, label, favors, ...(favors ? { runs: Math.abs(value) } : {}), text, inMargin: true };
};

/** Which context factors stand in for a side's strongest when no part of the margin is its. */
const CONTEXT_ORDER: readonly FactorKey[] = ["form", "offense", "defense", "gameModel"];

/**
 * A matchup's forecast explained, or null when the engine had too little to forecast it with (no
 * scores yet, or a side it does not know).
 */
export const explainForecast = (
  prediction: LeaguePrediction,
  { nameOf, chanceA, ambiguous }: ExplainOptions
): ForecastExplanation | null => {
  const explanation = prediction.explanation;
  if (!explanation) return null;
  const { parts, teamA, teamB, margin } = explanation;
  const side: Record<Side, MatchupEvidence> = { teamA, teamB };
  const ids: Record<Side, string> = { teamA: prediction.teamAId, teamB: prediction.teamBId };
  const name: Record<Side, string> = { teamA: nameOf(ids.teamA), teamB: nameOf(ids.teamB) };
  const chance = { teamA: chanceA, teamB: 1 - chanceA };
  // Each side's own share rounded, as the card and every other League screen round it.
  const shownA = Math.round(chance.teamA * 100);
  const shownB = Math.round(chance.teamB * 100);
  const favorite: Side | null = shownA > shownB ? "teamA" : shownB > shownA ? "teamB" : null;

  const inMargin: Factor[] = [
    part(
      "results",
      "Results",
      parts.results,
      `Average margin: ${name.teamA} ${signed(teamA.rawMargin)} a game, ${name.teamB} ${signed(teamB.rawMargin)}. Each game counts up to ${explanation.gameCap} runs, and a side with fewer games counts for less.`
    ),
    part(
      "schedule",
      "Opponents faced",
      parts.schedule,
      // The averages alone could point the other way from the part: it is the shares the ratings
      // count, and a side with fewer games has less of its opponents counted, for better or worse,
      // so one game against weak opponents can cost less than five against slightly better ones.
      `Average opponent rating: ${name.teamA} ${signed(teamA.strengthOfSchedule)}, ${name.teamB} ${signed(teamB.strengthOfSchedule)}, counted as ${signed(teamA.scheduleShare)} and ${signed(teamB.scheduleShare)}, the shares the ratings take, which are smaller the fewer games a side has played. Tougher opponents add to a rating, and weaker ones take from it.`
    ),
  ];
  if (Math.abs(parts.headToHead) >= EVEN_RUNS) {
    const winner = parts.headToHead > 0 ? name.teamA : name.teamB;
    inMargin.push(
      part(
        "headToHead",
        "Head-to-head",
        parts.headToHead,
        `${winner} won more of their meetings. It counts, but no more than 1.5 runs, so one game cannot decide it.`
      )
    );
  }
  inMargin.push(
    Math.abs(parts.homeField) >= EVEN_RUNS
      ? part(
          "homeField",
          "Home field",
          parts.homeField,
          `${parts.homeField > 0 ? name.teamA : name.teamB} gets ${runs(Math.abs(parts.homeField))} for the home edge fitted from games with a home side.`
        )
      : part(
          "homeField",
          "Home field",
          0,
          "Not counted. Who bats last is a coin toss at this level, so neither side gets an edge for it."
        )
  );
  // The cap is a limit on the forecast, not evidence for either side: it only ever takes runs off
  // the leader's margin, and read as leaning the other way it came out as the trailing side's
  // strongest reason. It leans neither way, so it is never one, and keeps its runs for the margin.
  if (Math.abs(parts.capped) >= EVEN_RUNS)
    inMargin.push({
      key: "capped",
      label: "Cap",
      favors: null,
      runs: Math.abs(parts.capped),
      text: `The rating margin stops at 14 runs, so ${runs(Math.abs(parts.capped))} over it are left out.`,
      inMargin: true,
    });
  inMargin.sort((one, two) => (two.runs ?? 0) - (one.runs ?? 0));

  const context: Factor[] = [
    {
      key: "form",
      label: "Recent form",
      favors: lean(teamA.recentForm - teamB.recentForm, FORM_GAP),
      text: `The last five games, the newest counting most: ${name.teamA} ${signed(teamA.recentForm)} a game, ${name.teamB} ${signed(teamB.recentForm)}. Already part of the results, so not counted again.`,
      inMargin: false,
    },
  ];
  if (
    teamA.runsFor !== null &&
    teamB.runsFor !== null &&
    teamA.runsAgainst !== null &&
    teamB.runsAgainst !== null
  ) {
    context.push(
      {
        key: "offense",
        label: "Scoring",
        favors: lean(teamA.runsFor - teamB.runsFor, SCORING_GAP),
        text: `In league games ${name.teamA} score ${teamA.runsFor.toFixed(1)} a game and ${name.teamB} ${teamB.runsFor.toFixed(1)}.`,
        inMargin: false,
      },
      {
        key: "defense",
        label: "Runs allowed",
        favors: lean(teamB.runsAgainst - teamA.runsAgainst, SCORING_GAP),
        text: `In league games ${name.teamA} allow ${teamA.runsAgainst.toFixed(1)} a game and ${name.teamB} ${teamB.runsAgainst.toFixed(1)}.`,
        inMargin: false,
      }
    );
  }
  const outside = (one: MatchupEvidence) => Math.max(0, one.fittedGames - one.leagueGames);
  context.push(
    {
      key: "external",
      label: "Team Rankings results",
      favors: null,
      text:
        outside(teamA) + outside(teamB) === 0
          ? "None: both ratings rest on league games alone."
          : `Counted beside the league's games: ${games(outside(teamA))} for ${name.teamA}, ${games(outside(teamB))} for ${name.teamB}.`,
      inMargin: false,
    },
    {
      key: "sample",
      label: "Games behind each rating",
      favors: null,
      text: `${name.teamA}: ${games(teamA.fittedGames)}. ${name.teamB}: ${games(teamB.fittedGames)}.`,
      inMargin: false,
    },
    {
      key: "freshness",
      label: "Newest results",
      favors: null,
      text: (["teamA", "teamB"] as const)
        .map((one) => {
          const evidence = side[one];
          if (evidence.lastPlayed === null) return `${name[one]}: none dated.`;
          // A game whose date has passed with no score is still forecast, and a side may have
          // played since or on the same day (a doubleheader): those are said as such, not as a
          // count of days before it below one.
          const off = evidence.daysOff;
          const days =
            off === null
              ? ""
              : off === 1
                ? ", the day before this game"
                : off === 0
                  ? ", the same day as this game"
                  : off === -1
                    ? ", the day after this game's date"
                    : off < 0
                      ? `, ${-off} days after this game's date`
                      : `, ${off} days before this game`;
          return `${name[one]}: ${formatGameDate(evidence.lastPlayed)}${days}.`;
        })
        .join(" "),
      inMargin: false,
    }
  );
  // Where the chance comes from, and so the reason for its favorite where no part of the margin
  // is: in a close game the margin can lean to one side and the per-game model to the other.
  context.push({
    key: "gameModel",
    label: "The per-game model",
    favors: lean(chanceA - 0.5, 0.005),
    text: `The win chance is the per-game model's, the one behind the Schedule's odds and the Gold chances: it reads runs scored and allowed beside the rating, and gives ${name.teamA} ${shownA}% and ${name.teamB} ${shownB}%.`,
    inMargin: false,
  });

  const strongestFor = (one: Side): Factor | null =>
    inMargin.find((factor) => factor.favors === one) ??
    CONTEXT_ORDER.map((key) => context.find((factor) => factor.key === key)).find(
      (factor): factor is Factor => factor?.favors === one
    ) ??
    null;

  const sensitivities: string[] = [];
  for (const one of ["teamA", "teamB"] as const) {
    const evidence = side[one];
    if (evidence.fittedGames < THIN_GAMES)
      sensitivities.push(
        `${name[one]} has ${games(evidence.fittedGames)} the rating can use, so one more result could move this a long way.`
      );
  }
  for (const one of ["teamA", "teamB"] as const) {
    const days = side[one].daysOff;
    if (days !== null && days > STALE_DAYS)
      sensitivities.push(
        `${name[one]}'s newest result is ${days} days before this game, so it may not show how they play now.`
      );
  }
  for (const one of ["teamA", "teamB"] as const) {
    if (ambiguous?.has(ids[one]) && outside(side[one]) > 0)
      sensitivities.push(
        `${name[one]}'s Team Rankings results come from a club picked by name, and more than one club carries it: they may be another club's.`
      );
  }
  if (
    teamA.runsFor !== null &&
    teamB.runsFor !== null &&
    teamA.runsAgainst !== null &&
    teamB.runsAgainst !== null
  ) {
    const scoringA = teamA.runsFor - teamA.runsAgainst;
    const scoringB = teamB.runsFor - teamB.runsAgainst;
    const ratingGap = teamA.rating - teamB.rating;
    if (
      Math.abs(scoringA - scoringB) >= FORM_GAP &&
      Math.abs(ratingGap) >= 0.5 &&
      Math.sign(scoringA - scoringB) !== Math.sign(ratingGap)
    ) {
      const rated = ratingGap > 0 ? "teamA" : "teamB";
      const outscorer = rated === "teamA" ? "teamB" : "teamA";
      sensitivities.push(
        `The rating and the raw scoring point different ways: ${name[rated]} is rated higher, but ${name[outscorer]} has outscored its opponents by more (${signed(outscorer === "teamA" ? scoringA : scoringB)} a game to ${signed(rated === "teamA" ? scoringA : scoringB)}). The rating allows for who each has played.`
      );
    }
  }
  /*
   * The margin above is the rating's reading of the game and the chance is the per-game model's.
   * Where they part ways it is said, without the chance the engine reads off its margin: that is
   * shown nowhere, and a second number here would be the two chances again.
   */
  const leader = lean(margin, EVEN_RUNS);
  if (favorite !== null && leader !== null && leader !== favorite) {
    sensitivities.push(
      `The rating margin backs ${name[leader]}, but the per-game model, which also reads runs scored and allowed, makes ${name[favorite]} the pick: the two ways of reading the season disagree on this game.`
    );
  } else if (Math.abs(prediction.winProbability.teamA - chanceA) >= MODELS_APART) {
    const closer = Math.abs(prediction.winProbability.teamA - 0.5) < Math.abs(chanceA - 0.5);
    sensitivities.push(
      `The rating margin alone reads this game as ${closer ? "closer" : "more one-sided"} than the per-game model does, which also reads runs scored and allowed: the two ways of reading the season disagree on how sure to be.`
    );
  }

  return {
    favorite,
    chance,
    margin,
    strongest: { teamA: strongestFor("teamA"), teamB: strongestFor("teamB") },
    factors: [...inMargin, ...context],
    sensitivities,
    probabilityCapped: chanceA <= GAME_CHANCE_FLOOR || chanceA >= GAME_CHANCE_CEILING,
  };
};
