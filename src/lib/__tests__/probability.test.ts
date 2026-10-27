import { describe, expect, it } from "vitest";
import {
  formatProbabilityMargin,
  normalCdf,
  normalQuantile,
  wilsonScoreInterval,
} from "../probability";

describe("wilsonScoreInterval", () => {
  it("keeps bounds inside the probability scale", () => {
    const interval = wilsonScoreInterval(0.5, 220);
    expect(interval.lower).toBeGreaterThanOrEqual(0);
    expect(interval.upper).toBeLessThanOrEqual(1);
    expect(interval.lower).toBeLessThan(interval.estimate);
    expect(interval.upper).toBeGreaterThan(interval.estimate);
  });

  it("shrinks as sample size increases", () => {
    const small = wilsonScoreInterval(0.5, 50);
    const large = wilsonScoreInterval(0.5, 500);
    expect(large.margin).toBeLessThan(small.margin);
  });

  it("formats readable percentage margins", () => {
    expect(formatProbabilityMargin(0)).toBe("±0%");
    expect(formatProbabilityMargin(0.011)).toBe("±2%");
  });
});

describe("the normal curve", () => {
  it("finds the point below which a draw falls with a given chance", () => {
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 6);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 6);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 6);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(1.5)).toBeNaN();
  });

  it("gives the chance below a point, and the two undo each other", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
    for (const p of [0.001, 0.02, 0.3, 0.5, 0.8, 0.999]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
  });
});
