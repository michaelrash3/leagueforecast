import { describe, expect, it } from "vitest";
import { coerceLogs, coerceSettings } from "../validate";
import { DEFAULT_SETTINGS, type Settings } from "../types";

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

describe("score detail coercion", () => {
  it("keeps a stored choice", () => {
    expect(coerceSettings({ scoreDetail: "runs" }).scoreDetail).toBe("runs");
    expect(coerceSettings({ scoreDetail: "full" }).scoreDetail).toBe("full");
  });

  it("falls back to runs only for unknown or missing values", () => {
    expect(coerceSettings({ scoreDetail: "boxscore" }).scoreDetail).toBe("runs");
    expect(coerceSettings({ scoreDetail: 3 }).scoreDetail).toBe("runs");
    // A season saved before the setting existed records runs only, which is
    // what it was really tracking, and keeps every stat it already logged.
    expect(coerceSettings({}).scoreDetail).toBe("runs");
    expect(DEFAULT_SETTINGS.scoreDetail).toBe("runs");
  });
});

describe("what a final needs, by score detail", () => {
  const scoredGame = {
    game: {
      awayRuns: "7",
      awayHits: "",
      awayK: "",
      homeRuns: "4",
      homeHits: "",
      homeK: "",
      innings: "6",
      isFinal: true,
    },
  };

  it("keeps a runs-only final in a league that never records strikeouts", () => {
    // Machine and coach pitch normally require strikeouts before a game counts
    // as final; a runs-only league has none to give, and the score is enough.
    const settings: Settings = { ...DEFAULT_SETTINGS, pitchMode: "machine", scoreDetail: "runs" };
    expect(coerceLogs(scoredGame, [], settings).game?.isFinal).toBe(true);
  });

  it("still requires strikeouts under a full box score", () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, pitchMode: "machine", scoreDetail: "full" };
    expect(coerceLogs(scoredGame, [], settings).game?.isFinal).toBe(false);
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
