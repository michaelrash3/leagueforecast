import { describe, expect, it } from "vitest";
import type { GameForecast } from "../gameForecast";
import { modelRead } from "../modelRead";
import type { GameRead } from "../sim";

/*
 * A card's Model Read (`modelRead`): what the per-game model's projected score is made of, as that
 * model reads it, the league's own games and the ratings, counted at the weight it gives the
 * ratings. It was the prediction engine's own line, which could back the other side from the chance
 * and the score beside it. Placeholder teams.
 */

const names = { away: "Aces", home: "Bears" };

const forecastWith = (read: GameRead, few: GameForecast["few"] = []): GameForecast => ({
  awayWinPct: 0.6,
  awayScore: 7,
  homeScore: 4,
  scored: true,
  few,
  range: {
    margin: { low: -7, high: 13 },
    away: { low: 2, high: 13 },
    home: { low: 0, high: 9 },
  },
  read,
});

describe("a card's Model Read", () => {
  it("gives the league's games and the ratings each their margin, and the ratings' weight", () => {
    expect(
      modelRead(forecastWith({ runs: 7.84, rating: 3.11, weight: 0.6, margin: 5 }), names)
    ).toBe(
      "This league's games alone (runs scored and allowed, and form) make it Aces by 7.8; the ratings, Aces by 3.1. The projection counts the ratings 60%."
    );
  });

  it("says when the two readings back different sides, or neither", () => {
    expect(
      modelRead(forecastWith({ runs: -1.2, rating: 2.4, weight: 0.7, margin: 1.32 }), names)
    ).toBe(
      "This league's games alone (runs scored and allowed, and form) make it Bears by 1.2; the ratings, Aces by 2.4. The projection counts the ratings 70%."
    );
    expect(
      modelRead(forecastWith({ runs: 0.02, rating: -0.04, weight: 0.52, margin: 0 }), names)
    ).toBe(
      "This league's games alone (runs scored and allowed, and form) make it even; the ratings, even. The projection counts the ratings 52%."
    );
  });

  it("reads the league's games alone where a side carries no rating", () => {
    expect(
      modelRead(forecastWith({ runs: 4.2, rating: null, weight: 0, margin: 4.2 }), names)
    ).toBe(
      "This league's games alone (runs scored and allowed, and form) make it Aces by 4.2, and with no rating for one side they are all the projection reads."
    );
  });

  it("names the side with too few league games, where the model reads the ratings alone", () => {
    expect(
      modelRead(
        forecastWith({ runs: null, rating: -2.5, weight: 0.52, margin: -1.3 }, ["home"]),
        names
      )
    ).toBe(
      "With fewer than two league games behind Bears, the projection reads the ratings, Bears by 2.5, counted 52% against an even game."
    );
    expect(
      modelRead(
        forecastWith({ runs: null, rating: null, weight: 0, margin: 0.4 }, ["away", "home"]),
        names
      )
    ).toBe(
      "With fewer than two league games behind Aces and Bears and no ratings, the projection has only their records to go on."
    );
  });
});
