import { describe, expect, it } from "vitest";
import { coerceSettings } from "../validate";
import { DEFAULT_SETTINGS } from "../types";

describe("postseason format coercion", () => {
  it("keeps a stored format", () => {
    expect(coerceSettings({ postseasonFormat: "none" }).postseasonFormat).toBe("none");
    expect(coerceSettings({ postseasonFormat: "all" }).postseasonFormat).toBe("all");
    expect(coerceSettings({ postseasonFormat: "cut" }).postseasonFormat).toBe("cut");
  });

  it("falls back to a cut line for unknown or missing values", () => {
    expect(coerceSettings({ postseasonFormat: "nonsense" }).postseasonFormat).toBe("cut");
    expect(coerceSettings({}).postseasonFormat).toBe("cut");
    // A league saved before the setting existed keeps its cut line.
    expect(DEFAULT_SETTINGS.postseasonFormat).toBe("cut");
  });
});

describe("error tracking coercion", () => {
  it("keeps an explicit preference either way", () => {
    expect(coerceSettings({ trackErrors: false }).trackErrors).toBe(false);
    expect(coerceSettings({ trackErrors: true }).trackErrors).toBe(true);
  });

  it("defaults to scoring errors, including for non-boolean values", () => {
    expect(coerceSettings({}).trackErrors).toBe(true);
    expect(coerceSettings({ trackErrors: "yes" }).trackErrors).toBe(true);
    expect(DEFAULT_SETTINGS.trackErrors).toBe(true);
  });
});
