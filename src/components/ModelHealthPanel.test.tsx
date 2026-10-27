import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BacktestResult } from "../lib/backtest";
import { ModelHealthPanel } from "./ModelHealthPanel";

/*
 * Model Health was hard to read: its buckets were named by the away side's chance as "40-50% away",
 * each bar drew only how often the away side won, with nothing to hold it against, and the Brier
 * score came with nothing to say what a good one is. Each bar now marks the chance the model gave,
 * and Brier is set beside a coin flip's 0.25.
 */
const result: BacktestResult = {
  brierScore: 0.18,
  confidentMissRate: 0.2,
  sampleSize: 12,
  calibration: [{ min: 0.6, max: 0.7, predicted: 0.64, actual: 0.75, samples: 8 }],
  winnerAccuracy: 0.75,
  averageMarginError: 3.1,
  highConfidenceAccuracy: 0.8,
  highConfidenceSamples: 5,
};

describe("Model Health", () => {
  it("names each bucket by the away side's chance, and marks the chance given beside the rate seen", () => {
    render(<ModelHealthPanel backtestResult={result} cardClassName="" />);
    expect(screen.getByText(/Away side given 60–70%/)).toBeInTheDocument();
    const marker = screen.getByTestId("predicted-0.6");
    expect(marker).toHaveStyle({ left: "64%" });
    expect(screen.getByText("Won 75% · given 64%")).toBeInTheDocument();
  });

  it("sets Brier beside a coin flip's", () => {
    render(<ModelHealthPanel backtestResult={result} cardClassName="" />);
    expect(screen.getByText(/A coin flip scores 0\.250; lower is better/)).toBeInTheDocument();
  });
});
