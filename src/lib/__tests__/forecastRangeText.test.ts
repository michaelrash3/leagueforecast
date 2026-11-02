import { describe, expect, it } from "vitest";
import { marginSpanText, runSpanText } from "../forecastRangeText";
import { drawnMarginSpan, drawWidths } from "../sim";

/*
 * A game card's range in words (2.10): the margins eight games in ten end within, from the
 * underdog's end to the favorite's, and each side's runs. The numbers are the Gold odds' draws of
 * the game (`gameForecast.test.ts`). Placeholder teams.
 */

describe("the range in words", () => {
  const names = { teamA: "Aces", teamB: "Bears" };

  it("runs from the underdog's end to the favorite's across zero", () => {
    expect(marginSpanText({ low: -7, high: 11 }, names)).toBe("Bears by 7 to Aces by 11");
    expect(marginSpanText({ low: -11, high: 7 }, names)).toBe("Aces by 7 to Bears by 11");
    expect(marginSpanText({ low: -9, high: 9 }, names)).toBe("either side by up to 9");
  });

  it("names one side's two margins, the nearer first, when the range does not cross zero", () => {
    expect(marginSpanText({ low: 2, high: 20 }, names)).toBe("Aces by 2 to 20");
    expect(marginSpanText({ low: 0, high: 18 }, names)).toBe("a tie to Aces by 18");
    expect(marginSpanText({ low: -20, high: -2 }, names)).toBe("Bears by 2 to 20");
    expect(marginSpanText({ low: -18, high: 0 }, names)).toBe("a tie to Bears by 18");
  });

  it("says the same of a game whichever side is read as team A", () => {
    for (const pitchMode of ["player", "machine"] as const) {
      const widths = drawWidths([], { pitchMode });
      for (let predicted = -14; predicted <= 14; predicted += 1)
        for (const chance of [0.1, 0.35, 0.5, 0.65, 0.9]) {
          const asListed = marginSpanText(drawnMarginSpan(widths, chance, predicted), names);
          const turned = marginSpanText(drawnMarginSpan(widths, 1 - chance, -predicted), {
            teamA: "Bears",
            teamB: "Aces",
          });
          expect(turned, `${chance} at ${predicted}`).toBe(asListed);
        }
    }
  });

  it("writes a side's runs as a span, or one number when both ends meet", () => {
    expect(runSpanText({ low: 0, high: 13 })).toBe("0–13");
    expect(runSpanText({ low: 5, high: 5 })).toBe("5");
  });
});
