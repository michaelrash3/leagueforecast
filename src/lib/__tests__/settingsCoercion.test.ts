import { describe, expect, it } from "vitest";
import { coerceLogs, coerceSettings } from "../validate";
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

  it("keeps a final with a score and no strikeouts, whatever the league records", () => {
    // Nothing on the way in ever asked for strikeouts: Verify Final takes a score, Fill scores
    // from Team Rankings writes runs, and a league that switched to the full box score had a
    // season of runs-only finals already. Machine and coach pitch under the full box score used
    // to revoke them on load, which erased every one on the next reload, and the save after it
    // wrote the erasure back, so switching back to runs only did not undo it. The reading takes
    // no settings now, so no setting can do that again.
    expect(coerceLogs(scoredGame, []).game?.isFinal).toBe(true);
  });

  it("still takes a final away from a game with no score", () => {
    const unscored = { game: { ...scoredGame.game, homeRuns: "" } };
    expect(coerceLogs(unscored, []).game?.isFinal).toBe(false);
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

describe("tiebreaker order coercion", () => {
  it("keeps a league's choice of no tiebreakers at all", () => {
    // Settings lets all four be None, and the session honours it; a reload read the empty list as
    // missing and put the defaults back, so standings ties broke differently after every refresh.
    expect(coerceSettings({ tiebreakerOrder: [] }).tiebreakerOrder).toEqual([]);
  });

  it("still falls back to the defaults for a missing or unreadable order", () => {
    expect(coerceSettings({}).tiebreakerOrder).toEqual(DEFAULT_SETTINGS.tiebreakerOrder);
    expect(coerceSettings({ tiebreakerOrder: ["nonsense", 4] }).tiebreakerOrder).toEqual(
      DEFAULT_SETTINGS.tiebreakerOrder
    );
  });
});
